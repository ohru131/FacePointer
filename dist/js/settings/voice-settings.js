// 設定画面: 音声のタブ（合成のモデル・声・音声の保存）
import {
    apiKeyInput, audioCacheBtn, audioCacheImportInput, audioTransferResult, geminiStyleInput,
    geminiStyleResetBtn, geminiVoiceSelect, ttsCreditNote, ttsModelFetchBtn, ttsModelSelect,
    sapiFetchBtn, sapiSection, sapiStatus, ttsModelStatus, ttsPreviewStatus, voicevoxFetchBtn, voicevoxStatus,
    voicevoxUrlInput
} from "../core/dom.js";
import { readStoredList } from "../core/storage.js";
import {
    DEFAULT_GEMINI_STYLE, GEMINI_STYLE_KEY, GEMINI_VOICES, GEMINI_VOICE_KEY, SAPI_VOICES_KEY, TTS_MODEL_KEY,
    TTS_MODEL_LIST_KEY, VOICEVOX_SPEAKERS_KEY, VOICEVOX_URL_KEY, describeTtsError,
    fetchAvailableTtsModels, fetchSapiVoices, fetchVoicevoxSpeakers, getTtsProvider, getVoicevoxBaseUrl,
    isSapiAvailable, loadTtsModelList, synthesizeSpeech, ttsSettings
} from "../speech/tts.js";
import {
    AUDIO_MIN_BYTES, STORE_NAME, clearAudioCache, db, mergeAudioCacheKeys, setCachedAudio
} from "../speech/audio-cache.js";
import { playBlob, preferredVoice } from "../speech/speak.js";
import { collectPrefetchPhrases, getMissingPrefetchPhrases, prefetchAllAudio } from "../speech/prefetch.js";
import { activateSettingsTab, saveVoiceSettingsFromForm } from "./settings-modal.js";

// 設定の音声タブ: 話す文のうち何件の音声が保存済みか（どのモデルで作ったものも数える）
export function renderAudioCacheSummary(saved, total) {
    const el = document.getElementById("audio-cache-summary");
    if (!el) return;
    el.textContent = `保存済み ${saved} / ${total} 文${saved >= total ? " ✓ すべてそろっています" : ""}`;
}

let audioCacheSummarySeq = 0;
export async function updateAudioCacheSummary() {
    const el = document.getElementById("audio-cache-summary");
    if (!el) return;
    const seq = ++audioCacheSummarySeq;
    if (getTtsProvider() === "browser") {
        el.textContent = "ブラウザ内蔵の音声を使用中（保存は不要）";
        return;
    }
    if (!db) {
        el.textContent = "音声を保存できません（このブラウザでは保存領域が使えません）";
        return;
    }
    const total = collectPrefetchPhrases().length;
    const missing = (await getMissingPrefetchPhrases()).length;
    if (seq !== audioCacheSummarySeq) return;
    renderAudioCacheSummary(total - missing, total);
}

export function renderTtsModelOptions(list, selected) {
    if (!ttsModelSelect) return;
    const options = list.some(m => m.value === selected)
        ? list
        : [{ value: selected, label: `${selected} (一覧に無し)` }, ...list];
    ttsModelSelect.innerHTML = "";
    options.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.value;
        opt.textContent = m.label;
        ttsModelSelect.appendChild(opt);
    });
    ttsModelSelect.value = selected;
}

// VOICEVOX の話者を選んでいるときは、利用規約に沿ってクレジットを表示する
export function updateTtsCreditNote() {
    // 選んだ声で使わない設定（Gemini の話者・口調）は薄くする
    const provider = getTtsProvider(ttsModelSelect ? ttsModelSelect.value : ttsSettings.ttsModel);
    document.querySelectorAll("#voice-tab [data-tts-provider]").forEach((section) => {
        section.classList.toggle("is-inactive", section.dataset.ttsProvider !== provider);
    });
    if (!ttsCreditNote) return;
    const model = ttsModelSelect ? ttsModelSelect.value : ttsSettings.ttsModel;
    const speaker = readStoredList(VOICEVOX_SPEAKERS_KEY).find(m => m.value === model);
    ttsCreditNote.textContent = speaker ? `音声: ${speaker.credit}（VOICEVOX を使って作った音声を公開するときはこのクレジットを表記）` : "";
}

// 保存した音声の書き出し・読み込み（ほかの端末へコピーする）。
// ファイルの中身: "FDAUDIO1" / 目次の長さ（4バイト）/ 目次 JSON { version, entries: [{ key, type, size }] } / 音声を目次の順に連結
const AUDIO_EXPORT_MAGIC = "FDAUDIO1";
const setAudioTransferResult = (text) => { if (audioTransferResult) audioTransferResult.textContent = text; };

function getAllCachedAudioEntries() {
    if (!db) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
        const entries = [];
        const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).openCursor();
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) { resolve(entries); return; }
            const blob = cursor.value;
            if (blob instanceof Blob && blob.size >= AUDIO_MIN_BYTES) entries.push({ key: String(cursor.key), blob });
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
    });
}

// 書き出したときの音声設定。読み込んだ端末で同じ設定を選び、読み込んだ音声がそのまま使われるようにする
function getVoiceSettingsForExport() {
    return {
        ttsModel: ttsSettings.ttsModel,
        geminiVoice: ttsSettings.geminiVoice,
        geminiStyle: ttsSettings.geminiStyle,
        voicevoxUrl: getVoicevoxBaseUrl(),
        // VOICEVOX の話者は、読み込み先で「話者を取得」していなくても名前とクレジットを出せるように一緒に入れる
        voicevoxSpeaker: readStoredList(VOICEVOX_SPEAKERS_KEY).find(m => m.value === ttsSettings.ttsModel) || null,
        label: loadTtsModelList().find(m => m.value === ttsSettings.ttsModel)?.label || ttsSettings.ttsModel
    };
}

// 読み込んだファイルの音声設定を選んで保存し、開いている設定画面の入力にも反映する（API Key は変えない）
function applyImportedVoiceSettings(settings) {
    if (!settings || typeof settings.ttsModel !== "string" || !settings.ttsModel.includes(":")) return null;
    ttsSettings.ttsModel = settings.ttsModel;
    localStorage.setItem(TTS_MODEL_KEY, ttsSettings.ttsModel);
    if (typeof settings.geminiVoice === "string" && settings.geminiVoice) {
        ttsSettings.geminiVoice = settings.geminiVoice;
        localStorage.setItem(GEMINI_VOICE_KEY, ttsSettings.geminiVoice);
    }
    if (typeof settings.geminiStyle === "string") {
        ttsSettings.geminiStyle = settings.geminiStyle;
        localStorage.setItem(GEMINI_STYLE_KEY, ttsSettings.geminiStyle);
    }
    if (typeof settings.voicevoxUrl === "string" && settings.voicevoxUrl) {
        ttsSettings.voicevoxUrl = getVoicevoxBaseUrl(settings.voicevoxUrl);
        localStorage.setItem(VOICEVOX_URL_KEY, ttsSettings.voicevoxUrl);
    }
    const speaker = settings.voicevoxSpeaker;
    if (speaker && speaker.value === ttsSettings.ttsModel) {
        const speakers = readStoredList(VOICEVOX_SPEAKERS_KEY);
        if (!speakers.some(m => m.value === speaker.value)) {
            localStorage.setItem(VOICEVOX_SPEAKERS_KEY, JSON.stringify([...speakers, speaker]));
        }
    }
    ttsSettings.ttsDailyLimitModel = null;

    renderTtsModelOptions(loadTtsModelList(), ttsSettings.ttsModel);
    if (voicevoxUrlInput) voicevoxUrlInput.value = ttsSettings.voicevoxUrl;
    if (geminiVoiceSelect) geminiVoiceSelect.value = ttsSettings.geminiVoice;
    if (geminiStyleInput) geminiStyleInput.value = ttsSettings.geminiStyle;
    updateTtsCreditNote();
    return loadTtsModelList().find(m => m.value === ttsSettings.ttsModel)?.label || settings.label || ttsSettings.ttsModel;
}

async function exportAudioCache() {
    if (!db) { setAudioTransferResult("このブラウザでは音声を保存できません。"); return; }
    setAudioTransferResult("書き出し中…");
    const entries = await getAllCachedAudioEntries();
    if (entries.length === 0) { setAudioTransferResult("保存した音声がありません。"); return; }
    const header = new TextEncoder().encode(JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        settings: getVoiceSettingsForExport(),
        entries: entries.map(({ key, blob }) => ({ key, type: blob.type, size: blob.size }))
    }));
    const headerLength = new Uint8Array(4);
    new DataView(headerLength.buffer).setUint32(0, header.length, true);
    const file = new Blob([AUDIO_EXPORT_MAGIC, headerLength, header, ...entries.map(e => e.blob)], { type: "application/octet-stream" });
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = `audio-cache-${stamp}.fdaudio`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    setAudioTransferResult(`${entries.length} 件を書き出しました（${(file.size / 1024 / 1024).toFixed(1)} MB）。`);
}

async function importAudioCache(file) {
    if (!db) { setAudioTransferResult("このブラウザでは音声を保存できません。"); return; }
    setAudioTransferResult("読み込み中…");
    const magic = await file.slice(0, AUDIO_EXPORT_MAGIC.length).text();
    if (magic !== AUDIO_EXPORT_MAGIC) { setAudioTransferResult("⚠ 音声の書き出しファイルではありません。"); return; }
    const lengthOffset = AUDIO_EXPORT_MAGIC.length;
    const headerLength = new DataView(await file.slice(lengthOffset, lengthOffset + 4).arrayBuffer()).getUint32(0, true);
    let header;
    try {
        header = JSON.parse(await file.slice(lengthOffset + 4, lengthOffset + 4 + headerLength).text());
    } catch {
        setAudioTransferResult("⚠ ファイルが壊れています。");
        return;
    }
    const entries = Array.isArray(header?.entries) ? header.entries : [];
    let offset = lengthOffset + 4 + headerLength;
    let saved = 0;
    for (const entry of entries) {
        const size = Number(entry?.size) || 0;
        const blob = file.slice(offset, offset + size, entry?.type || "");
        offset += size;
        if (typeof entry?.key !== "string" || size < AUDIO_MIN_BYTES || blob.size !== size) continue;
        // file.slice は元ファイルへの参照なので、中身を読み込んでから保存する
        const data = new Blob([await blob.arrayBuffer()], { type: blob.type });
        if (await setCachedAudio(entry.key, data)) saved++;
        if (saved % 20 === 0) setAudioTransferResult(`読み込み中… ${saved}/${entries.length}`);
    }
    // 以前の書き出しファイルは、モデル・話者ごとの名前で入っているので文だけの名前にまとめる
    await mergeAudioCacheKeys();
    const appliedLabel = saved > 0 ? applyImportedVoiceSettings(header.settings) : null;
    setAudioTransferResult((saved === entries.length
        ? `${saved} 件を読み込みました。`
        : `${saved}/${entries.length} 件を読み込みました（残りは壊れているか保存できませんでした）。`)
        + (appliedLabel ? ` 音声を「${appliedLabel}」に切り替えました。` : ""));
    void updateAudioCacheSummary();
}
let ttsPreviewController = null;

export async function previewTts(text, button) {
    const phrase = (text || "").trim();
    const apiKey = apiKeyInput.value.trim();
    const setStatus = (msg) => { if (ttsPreviewStatus) ttsPreviewStatus.textContent = msg; };
    if (!phrase) { setStatus("文言が空です。"); return; }

    const model = (ttsModelSelect && ttsModelSelect.value) || ttsSettings.ttsModel;
    const provider = getTtsProvider(model);
    const modelName = model.slice(provider.length + 1) || "ブラウザ内蔵";
    if (!apiKey && (provider === "cloud" || provider === "gemini")) { setStatus("API Key を入力してください。"); return; }

    if (ttsPreviewController) ttsPreviewController.abort();
    const controller = new AbortController();
    ttsPreviewController = controller;
    window.speechSynthesis.cancel();

    if (provider === "browser") {
        ttsPreviewController = null;
        const uttr = new SpeechSynthesisUtterance(phrase);
        if (preferredVoice) uttr.voice = preferredVoice;
        uttr.lang = "ja-JP";
        uttr.rate = 0.95;
        window.speechSynthesis.speak(uttr);
        setStatus(`再生中: ${preferredVoice ? preferredVoice.name : "ブラウザ内蔵の音声"}`);
        return;
    }

    document.querySelectorAll(".tts-preview-btn").forEach(b => b.classList.remove("is-loading"));
    button.classList.add("is-loading");
    setStatus(`合成中: ${modelName}`);
    try {
        const opts = {
            model,
            apiKey,
            voice: geminiVoiceSelect ? geminiVoiceSelect.value : ttsSettings.geminiVoice,
            style: geminiStyleInput ? geminiStyleInput.value.trim() : ttsSettings.geminiStyle,
            voicevoxUrl: voicevoxUrlInput ? voicevoxUrlInput.value : ttsSettings.voicevoxUrl,
            preview: true
        };
        const blob = await synthesizeSpeech(phrase, controller.signal, opts);
        if (ttsPreviewController !== controller) return;
        button.classList.remove("is-loading");
        setStatus(`再生中: ${modelName}`);
        await playBlob(blob);
        if (ttsPreviewController === controller) setStatus("");
    } catch (err) {
        if (err.name === "AbortError") return;
        console.error("TTS preview error:", err);
        setStatus(`発話失敗: ${describeTtsError(err)}`);
    } finally {
        button.classList.remove("is-loading");
        if (ttsPreviewController === controller) ttsPreviewController = null;
    }
}

export function initVoiceSettings() {
    audioCacheBtn.addEventListener("click", () => {
        // 画面で入力した API Key・TTSモデルで作る（「保存して閉じる」を先に押さなくてよい）。
        // 押し直したときは、前の認証エラー・1日の上限の記録も解除してもう一度試す
        saveVoiceSettingsFromForm();
        const provider = getTtsProvider();
        if (provider === "browser") {
            alert("今はブラウザ内蔵の音声を使っています（前もって作る必要はありません）。\n上の TTSモデルで音声を変えると、ここで作れます。");
            return;
        }
        if (!["voicevox", "sapi"].includes(provider) && !ttsSettings.GEMINI_API_KEY) {
            alert("音声データを作るには、Gemini API Key を入力してください。");
            activateSettingsTab("voice-tab");
            apiKeyInput?.focus();
            return;
        }
        // すぐ始め、進み具合をこのタブに出す（作成済みの文はそのまま。作成中も話せる）。
        // Gemini TTS だけは1日の回数制限を使い切るおそれがあるので確かめる
        if (provider === "gemini" && !confirm("Gemini TTS は1文に数秒かかり、1日の回数制限で途中で止まることがあります（Cloud TTS・VOICEVOX がおすすめ）。作成しますか？")) return;
        const createStatus = document.getElementById("audio-cache-create-result");
        if (createStatus) createStatus.textContent = "";
        void prefetchAllAudio();
    });
    if (geminiVoiceSelect) {
        GEMINI_VOICES.forEach(v => {
            const opt = document.createElement("option");
            opt.value = v.name;
            opt.textContent = v.label;
            geminiVoiceSelect.appendChild(opt);
        });
    }
    if (geminiStyleResetBtn && geminiStyleInput) {
        geminiStyleResetBtn.addEventListener("click", () => {
            geminiStyleInput.value = DEFAULT_GEMINI_STYLE;
        });
    }
    if (ttsModelFetchBtn) {
        ttsModelFetchBtn.addEventListener("click", async () => {
            const key = apiKeyInput.value.trim();
            if (!key) {
                if (ttsModelStatus) ttsModelStatus.textContent = "API Key を入力してください。";
                return;
            }
            ttsModelFetchBtn.disabled = true;
            if (ttsModelStatus) ttsModelStatus.textContent = "取得中...";
            const current = ttsModelSelect ? ttsModelSelect.value : ttsSettings.ttsModel;
            const { models, errors } = await fetchAvailableTtsModels(key);
            ttsModelFetchBtn.disabled = false;

            if (!models.length) {
                if (ttsModelStatus) ttsModelStatus.textContent = `取得失敗: ${errors.join(" / ")}`;
                return;
            }
            localStorage.setItem(TTS_MODEL_LIST_KEY, JSON.stringify(models));
            renderTtsModelOptions(loadTtsModelList(), current);
            if (ttsModelStatus) {
                ttsModelStatus.textContent = `${models.length} 件取得` + (errors.length ? ` (一部失敗: ${errors.join(" / ")})` : "");
            }
        });
    }
    if (ttsModelSelect) ttsModelSelect.addEventListener("change", updateTtsCreditNote);
    if (voicevoxFetchBtn) {
        voicevoxFetchBtn.addEventListener("click", async () => {
            voicevoxFetchBtn.disabled = true;
            if (voicevoxStatus) voicevoxStatus.textContent = "取得中...";
            const current = ttsModelSelect ? ttsModelSelect.value : ttsSettings.ttsModel;
            try {
                const speakers = await fetchVoicevoxSpeakers(voicevoxUrlInput ? voicevoxUrlInput.value : ttsSettings.voicevoxUrl);
                localStorage.setItem(VOICEVOX_SPEAKERS_KEY, JSON.stringify(speakers));
                renderTtsModelOptions(loadTtsModelList(), current);
                if (voicevoxStatus) voicevoxStatus.textContent = `${speakers.length} 件の話者を取得しました。上の「TTSモデル」から選んでください。`;
            } catch (error) {
                if (voicevoxStatus) voicevoxStatus.textContent = `取得失敗: ${error.message}`;
            } finally {
                voicevoxFetchBtn.disabled = false;
                updateTtsCreditNote();
            }
        });
    }
    initSapiVoices();
    document.getElementById("audio-cache-clear-btn")?.addEventListener("click", () => {
        if (!confirm("前もって作った音声をすべて消去しますか？（次に話すときに作り直します）")) return;
        clearAudioCache();
        const status = document.getElementById("audio-cache-clear-result");
        if (status) status.textContent = "消去しました。";
        setTimeout(() => void updateAudioCacheSummary(), 300);
    });
    document.getElementById("audio-cache-export-btn")?.addEventListener("click", () => {
        exportAudioCache().catch((error) => {
            console.error("audio export failed:", error);
            setAudioTransferResult(`⚠ 書き出せませんでした: ${String(error?.message || error).slice(0, 80)}`);
        });
    });
    document.getElementById("audio-cache-import-btn")?.addEventListener("click", () => audioCacheImportInput?.click());
    audioCacheImportInput?.addEventListener("change", () => {
        const file = audioCacheImportInput.files?.[0];
        audioCacheImportInput.value = "";
        if (!file) return;
        importAudioCache(file).catch((error) => {
            console.error("audio import failed:", error);
            setAudioTransferResult(`⚠ 読み込めませんでした: ${String(error?.message || error).slice(0, 80)}`);
        });
    });
}

// Windows の声（SAPI5）。デスクトップ版の Windows でだけ欄を出し、起動時に一覧を取り直す
// （声を入れたり消したりしても、設定を開けば一覧に反映される）
async function refreshSapiVoices({ quiet = false } = {}) {
    if (sapiFetchBtn) sapiFetchBtn.disabled = true;
    if (!quiet && sapiStatus) sapiStatus.textContent = "取得中...";
    try {
        const voices = await fetchSapiVoices();
        localStorage.setItem(SAPI_VOICES_KEY, JSON.stringify(voices));
        // 取得中に選び直されても戻さないよう、選択は取得し終えてから読む（起動直後は一覧が空）
        renderTtsModelOptions(loadTtsModelList(), ttsModelSelect?.value || ttsSettings.ttsModel);
        if (sapiStatus) sapiStatus.textContent = `${voices.length} 件の声があります。上の「TTSモデル」から選んでください。`;
    } catch (error) {
        if (sapiStatus) sapiStatus.textContent = `取得失敗: ${error.message}`;
    } finally {
        if (sapiFetchBtn) sapiFetchBtn.disabled = false;
    }
}

function initSapiVoices() {
    if (!isSapiAvailable()) return;
    if (sapiSection) sapiSection.style.display = "";
    sapiFetchBtn?.addEventListener("click", () => void refreshSapiVoices());
    void refreshSapiVoices({ quiet: true });
}
