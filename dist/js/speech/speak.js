// 文を読み上げる（保存した音声 → 合成 → ブラウザの音声）
import { canSynthesizeSpeech, getTtsProvider, parseTtsRateLimit, synthesizeSpeech, ttsSettings } from "./tts.js";
import { AUDIO_MIN_BYTES, audioCacheKey, deleteCachedAudio, getCachedAudio, setCachedAudio } from "./audio-cache.js";

let voices = [];
export let preferredVoice = null;

let currentAudio = null;
let currentAudioResolve = null;
const SPEECH_SYNTH_TIMEOUT_MS = 30000;
// 話す文の音声を作っている数。裏の作成（prefetch）は、これが 0 になるまで待つ
let speechFetchCount = 0;
// 最後に頼まれた発話の番号。作り終えたとき別の文に変わっていたら、保存だけして流さない
let speechRequestSeq = 0;

function initVoices() {
    voices = window.speechSynthesis.getVoices();
    // 日本語の声の中から、自然な声（Edge の Nanami / Natural / Online）を優先する
    const japanese = voices.filter(v => (v.lang || "").toLowerCase().replace("_", "-").startsWith("ja"));
    preferredVoice = japanese.find(v => v.name.includes("Nanami"))
        || japanese.find(v => v.name.includes("Natural") || v.name.includes("Online"))
        || japanese[0]
        || null;
}

async function speakGemini(text, silent = false) {
    // 前の文の音声を作っている途中でも、新しい文はすぐ話す。前の文は作り終えたら保存だけする
    const seq = ++speechRequestSeq;
    const isLatest = () => seq === speechRequestSeq;
    // ブラウザ内蔵の音声を選んでいれば、合成もキャッシュも使わない
    if (getTtsProvider() === "browser") return false;

    const phrase = text.trim();
    const cacheKey = audioCacheKey(phrase);
    const cachedBlob = await getCachedAudio(cacheKey);
    if (cachedBlob) {
        if (silent || !isLatest()) return true;
        // 読めない音声は消して、ブラウザ内蔵の音声で話す（次は作り直す）
        if (await playBlob(cachedBlob) !== "invalid") return true;
        deleteCachedAudio(cacheKey);
        return !isLatest();
    }

    // 別の文に切り替わっていれば、この文をブラウザの音声で話さない
    if (!canSynthesizeSpeech()) return !isLatest();

    speechFetchCount += 1;
    try {
        // 応答が返らないと裏の作成が待ち続けるので、時間で打ち切る
        const blob = await synthesizeSpeech(phrase, AbortSignal.timeout(SPEECH_SYNTH_TIMEOUT_MS));
        // 初めて話した文も、作れた音声は保存して次からすぐ話す
        if (blob.size >= AUDIO_MIN_BYTES) await setCachedAudio(cacheKey, blob);

        // 作っている間に次の文へ切り替わっていたら流さない（作った音声は保存済み）
        if (!silent && isLatest()) {
            await playBlob(blob);
        }
        return true;
    } catch (err) {
        console.error("Gemini TTS Error:", err);
        if (parseTtsRateLimit(err)?.daily) ttsSettings.ttsDailyLimitModel = ttsSettings.ttsModel;
        // 別の文に切り替わっていれば、この文をブラウザの音声で話し直さない
        return !isLatest();
    } finally {
        speechFetchCount -= 1;
    }
}

export function playBlob(blob) {
    return new Promise((resolve) => {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            if (currentAudioResolve) {
                currentAudioResolve();
                currentAudioResolve = null;
            }
        }

        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        let settled = false;
        // 結果: "ended"（再生した・止められた）/ "invalid"（音声データとして読めない）/ "blocked"（再生を許可されなかった等）
        const finish = (result = "ended") => {
            if (settled) return;
            settled = true;
            URL.revokeObjectURL(url);
            if (currentAudio === audio) currentAudio = null;
            if (currentAudioResolve === finish) currentAudioResolve = null;
            resolve(result);
        };

        currentAudio = audio;
        currentAudioResolve = finish;
        audio.onended = () => finish("ended");
        audio.onerror = () => {
            const code = audio.error?.code;
            finish(code === 3 || code === 4 ? "invalid" : "blocked");
        };
        audio.play().catch((error) => finish(error?.name === "NotSupportedError" ? "invalid" : "blocked"));
    });
}

// 話している・話す音声を作っている間は、裏の作成を待つ（VOICEVOX は1つずつしか合成できず、発話が遅れるため）
export async function waitForSpeechIdle() {
    while (speechFetchCount > 0 || currentAudio) await new Promise(r => setTimeout(r, 200));
}

export async function speak(text) {
    window.speechSynthesis.cancel();
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
        if (currentAudioResolve) {
            currentAudioResolve();
            currentAudioResolve = null;
        }
    }

    const success = await speakGemini(text);
    if (success) return;

    await new Promise((resolve) => {
        const uttr = new SpeechSynthesisUtterance(text);
        if (preferredVoice) uttr.voice = preferredVoice;
        uttr.lang = "ja-JP";
        uttr.rate = 0.95;
        uttr.onend = () => resolve();
        uttr.onerror = () => resolve();
        window.speechSynthesis.speak(uttr);
    });
}

export function initSpeak() {
    window.speechSynthesis.onvoiceschanged = initVoices;
    initVoices();
}
