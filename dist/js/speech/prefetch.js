// パネルの文を前もって音声にしておく
import { clamp } from "../core/math.js";
import { buildSimpleSentence, getSimpleCatalog } from "../panels/catalog.js";
import { TALK_AIZUCHI } from "../talk/model.js";
import { getQuestionAnswers, getQuestionCatalog } from "../question/model.js";
import {
    canSynthesizeSpeech, describeTtsError, getTtsProvider, parseTtsRateLimit, synthesizeSpeech,
    ttsSettings
} from "./tts.js";
import { AUDIO_MIN_BYTES, audioCacheKey, db, getCachedAudioKeys, setCachedAudio } from "./audio-cache.js";
import { waitForSpeechIdle } from "./speak.js";
import { renderAudioCacheSummary, updateAudioCacheSummary } from "../settings/voice-settings.js";

// 前もって音声にしておく文: パネルを選んですぐ話す文（用意したパネル・質問と答え）だけ。
// お話モードの文は数が多く使わないものも多いので作らない（話したときに作った音声を保存して、次からすぐ話す）
export function collectPrefetchPhrases() {
    const phrases = [];

    getSimpleCatalog().forEach(panel => {
        phrases.push(buildSimpleSentence(panel));
    });

    getQuestionCatalog().forEach(q => {
        if (!q.silent) phrases.push(q.question);
        getQuestionAnswers(q).forEach(answer => phrases.push(buildSimpleSentence(answer)));
    });

    // お話モードの相づちタブもパネルを選んですぐ話すので作る
    TALK_AIZUCHI.forEach(item => phrases.push(item.sentence));

    return Array.from(new Set(phrases.map(p => (p || "").trim()).filter(Boolean)));
}

// 音声の作成は1つずつ。作成中に呼ばれたら、終わってからもう一度（増えた文だけ）作る
let isPrefetchRunning = false;
let prefetchQueued = null; // 次に作るときの { quiet }

// 合成の間隔: Gemini TTS は回数制限が厳しいので空ける。VOICEVOX は手元の PC で1つずつ合成するので、話す分の余裕を少し空ける
// 回数制限（429）で待つとき: 応答に待ち時間が無ければ 30 秒、長くても 5 分。続けて 6 回来たら止める
const PREFETCH_RATE_LIMIT_DEFAULT_WAIT_MS = 30000;
const PREFETCH_RATE_LIMIT_MAX_WAIT_MS = 300000;
const PREFETCH_RATE_LIMIT_MAX_WAITS = 6;

function getPrefetchIntervalMs() {
    const provider = getTtsProvider();
    if (provider === "gemini") return 600;
    return 150;
}

// まだ音声にしていない文
export async function getMissingPrefetchPhrases() {
    const saved = await getCachedAudioKeys();
    const missing = [];
    for (const text of collectPrefetchPhrases()) {
        if (!saved.has(audioCacheKey(text))) missing.push(text);
    }
    return missing;
}

// まだ音声にしていない文だけ作る。話すときの合成（speakGemini）とは別に動くので、作成中も話せる
// quiet: 作るものが無ければ何も表示しない（自動で作るとき）
export async function prefetchAllAudio({ quiet = false } = {}) {
    if (!canSynthesizeSpeech()) {
        // 手動で押したときは、作らない理由を表示する（何も出ないと押せていないように見える）
        if (!quiet) {
            [document.getElementById("audio-status-voice")].filter(Boolean).forEach((box) => {
                box.style.display = "block";
                const label = box.querySelector(".status-label");
                if (label) label.textContent = ttsSettings.ttsDailyLimitModel === ttsSettings.ttsModel
                    ? "⚠ 音声サービスの1日の上限（無料枠）に達しているため作れません"
                    : "⚠ 音声を作れません（API Key・TTSモデルを確認してください）";
            });
        }
        return;
    }
    if (isPrefetchRunning) {
        // 手動で押されたら、次の回は進み具合を表示する
        prefetchQueued = { quiet: (prefetchQueued?.quiet ?? true) && quiet };
        if (!quiet) {
            [document.getElementById("audio-status-voice")].filter(Boolean).forEach((box) => {
                box.style.display = "block";
                const label = box.querySelector(".status-label");
                if (label) label.textContent = "音声を作成中です（終わったら続けて残りを作ります）";
            });
        }
        return;
    }
    isPrefetchRunning = true;

    // 進み具合は設定の音声タブに出す
    const statusBoxes = [document.getElementById("audio-status-voice")].filter(Boolean);
    const showStatus = (text, pct) => {
        statusBoxes.forEach((box) => {
            box.style.display = "block";
            const label = box.querySelector(".status-label");
            const fill = box.querySelector(".status-progress-fill");
            if (label) label.textContent = text;
            if (fill && pct !== undefined) fill.style.width = `${pct}%`;
        });
    };
    const hideStatus = (ms) => setTimeout(() => {
        if (!isPrefetchRunning) statusBoxes.forEach((box) => { box.style.display = "none"; });
    }, ms);
    // 作り始めた音声の設定で作る（途中で設定が変わったら止める）
    const model = ttsSettings.ttsModel;
    let missing = [];
    let createdCount = 0;
    let failed = null;
    let stopped = false;

    let total = 0;
    try {
        if (!db) throw new Error("このブラウザでは音声を保存できません");
        if (!quiet) showStatus("作る文を調べています…", 0);
        total = collectPrefetchPhrases().length;
        missing = await getMissingPrefetchPhrases();
        let rateLimitWaits = 0;
        for (let i = 0; i < missing.length; i++) {
            const text = missing[i];
            if (ttsSettings.ttsModel !== model || !canSynthesizeSpeech()) {
                stopped = true;
                break;
            }
            showStatus(`音声を作成中: ${createdCount}/${missing.length}`, (createdCount / missing.length) * 100);
            await waitForSpeechIdle();
            try {
                const blob = await synthesizeSpeech(text, undefined, { model });
                if (blob.size >= AUDIO_MIN_BYTES) await setCachedAudio(audioCacheKey(text), blob);
                createdCount++;
                rateLimitWaits = 0;
                // 数え直さず、作った分だけ件数を進める
                if (ttsSettings.ttsModel === model) renderAudioCacheSummary(total - (missing.length - createdCount), total);
            } catch (error) {
                const limit = parseTtsRateLimit(error);
                // 1分あたりの回数制限は、言われた時間だけ待って同じ文からやり直す（続けて何度も来たらあきらめる）
                if (limit && !limit.daily && rateLimitWaits < PREFETCH_RATE_LIMIT_MAX_WAITS) {
                    rateLimitWaits++;
                    const waitMs = clamp(limit.retryMs ?? PREFETCH_RATE_LIMIT_DEFAULT_WAIT_MS, 1000, PREFETCH_RATE_LIMIT_MAX_WAIT_MS) + 1000;
                    showStatus(`回数制限のため ${Math.ceil(waitMs / 1000)} 秒待ってから続けます（${createdCount}/${missing.length}）`, (createdCount / missing.length) * 100);
                    await new Promise(r => setTimeout(r, waitMs));
                    i--;
                    continue;
                }
                if (limit?.daily) ttsSettings.ttsDailyLimitModel = model;
                console.error("audio prefetch failed:", error);
                failed = error;
                break;
            }
            const interval = getPrefetchIntervalMs();
            if (interval > 0) await new Promise(r => setTimeout(r, interval));
        }
    } catch (error) {
        // 作る文を調べる段階の失敗（保存領域が使えないなど）
        console.error("audio prefetch setup failed:", error);
        failed = error;
    } finally {
        isPrefetchRunning = false;
    }

    if (failed) {
        showStatus(`⚠ 音声の作成を中断しました（${createdCount}/${missing.length}）: ${describeTtsError(failed)}`, 0);
        hideStatus(20000);
    } else if (stopped) {
        showStatus("音声の設定が変わったため、作成を止めました", 0);
        hideStatus(3000);
    } else if (createdCount > 0 || !quiet) {
        showStatus(createdCount > 0 ? `✓ 音声を ${createdCount} 件作りました（すべてそろっています）` : "✓ すべての文の音声がそろっています", 100);
        hideStatus(4000);
    }

    void updateAudioCacheSummary();
    if (prefetchQueued) {
        const next = prefetchQueued;
        prefetchQueued = null;
        void prefetchAllAudio(next);
    }
}
