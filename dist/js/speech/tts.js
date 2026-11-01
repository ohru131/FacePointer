// 音声合成のサービス（Gemini / Cloud TTS / VOICEVOX / Windows の SAPI）への問い合わせ
import { readStoredList } from "../core/storage.js";

// TTSモデル: "cloud:<voice名>" (Google Cloud TTS) / "gemini:<モデル名>" (Gemini API TTS)
//   / "voicevox:<話者スタイルID>" (PCで起動した VOICEVOX) / "browser:" (ブラウザ内蔵の音声。通信なし)
//   / "sapi:<トークンID>" (Windows の SAPI5 の声。デスクトップ版だけ)
export const TTS_MODEL_KEY = "tts_model";
const TTS_BROWSER_MODEL = "browser:";
export const VOICEVOX_URL_KEY = "voicevox_url";
export const VOICEVOX_SPEAKERS_KEY = "voicevox_speakers";
const DEFAULT_VOICEVOX_URL = "http://127.0.0.1:50021";
export const SAPI_VOICES_KEY = "sapi_voices";
export const TTS_MODEL_LIST_KEY = "tts_model_list";
const DEFAULT_TTS_MODEL = "cloud:ja-JP-Neural2-B";
export const GEMINI_VOICE_KEY = "gemini_tts_voice";
export const GEMINI_STYLE_KEY = "gemini_tts_style";
const DEFAULT_GEMINI_VOICE = "Zephyr";
export const DEFAULT_GEMINI_STYLE = "明るく、はきはきと、元気な若い日本人女性の声で、聞き取りやすく読み上げてください";
// Gemini TTS のプリセット話者 (日本語も発話可)。女性声を先頭に並べる
export const GEMINI_VOICES = [
    { name: "Zephyr", label: "Zephyr (女性・明るい)" },
    { name: "Autonoe", label: "Autonoe (女性・明るい)" },
    { name: "Laomedeia", label: "Laomedeia (女性・アップビート)" },
    { name: "Leda", label: "Leda (女性・若々しい)" },
    { name: "Aoede", label: "Aoede (女性・軽やか)" },
    { name: "Erinome", label: "Erinome (女性・クリア)" },
    { name: "Kore", label: "Kore (女性・しっかり)" },
    { name: "Callirrhoe", label: "Callirrhoe (女性・おおらか)" },
    { name: "Despina", label: "Despina (女性・なめらか)" },
    { name: "Vindemiatrix", label: "Vindemiatrix (女性・やさしい)" },
    { name: "Sulafat", label: "Sulafat (女性・温かい)" },
    { name: "Achernar", label: "Achernar (女性・柔らかい)" },
    { name: "Puck", label: "Puck (男性・アップビート)" },
    { name: "Fenrir", label: "Fenrir (男性・興奮気味)" },
    { name: "Charon", label: "Charon (男性・情報的)" },
    { name: "Orus", label: "Orus (男性・しっかり)" }
];
const GEMINI_TTS_SAMPLE_RATE = 24000;

// 選べる音声: ブラウザ内蔵（常に）+ Windows の声（デスクトップ版で取得済みなら）+ VOICEVOX の話者（取得済みなら）
//   + Google の一覧（取得済みなら既定のみ）
export function loadTtsModelList() {
    const google = readStoredList(TTS_MODEL_LIST_KEY);
    return [
        { value: TTS_BROWSER_MODEL, label: "ブラウザ内蔵の音声（無料・通信なし・遅延なし）" },
        ...(isSapiAvailable() ? readStoredList(SAPI_VOICES_KEY) : []),
        ...readStoredList(VOICEVOX_SPEAKERS_KEY),
        ...(google.length ? google : [{ value: DEFAULT_TTS_MODEL, label: "Cloud TTS: ja-JP-Neural2-B" }])
    ];
}

export function getTtsProvider(model = ttsSettings.ttsModel) {
    return model.split(":")[0];
}

export function getVoicevoxBaseUrl(url = ttsSettings.voicevoxUrl) {
    return (url || DEFAULT_VOICEVOX_URL).trim().replace(/\/+$/, "");
}

// VOICEVOX ENGINE: audio_query で読み方を作り、synthesis で WAV にする
async function requestVoicevoxTts(text, speaker, signal, opts = {}) {
    const base = getVoicevoxBaseUrl(opts.voicevoxUrl);
    const speakerId = encodeURIComponent(speaker);
    let queryResponse;
    try {
        queryResponse = await fetch(`${base}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`, { method: "POST", signal });
    } catch (error) {
        if (error.name === "AbortError") throw error;
        throw new Error(`VOICEVOX に接続できません（${base}）。VOICEVOX を起動し、CORS の許可を確認してください。`);
    }
    if (!queryResponse.ok) throw new Error(`VOICEVOX Error: ${queryResponse.status}`);
    const query = await queryResponse.json();
    let response;
    try {
        response = await fetch(`${base}/synthesis?speaker=${speakerId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(query),
            signal
        });
    } catch (error) {
        if (error.name === "AbortError") throw error;
        throw new Error(`VOICEVOX との通信が切れました（${base}）。VOICEVOX が起動しているか確認してください。`);
    }
    if (!response.ok) throw new Error(`VOICEVOX Error: ${response.status}`);
    return new Blob([await response.arrayBuffer()], { type: "audio/wav" });
}

export async function fetchVoicevoxSpeakers(url) {
    const base = getVoicevoxBaseUrl(url);
    let response;
    try {
        response = await fetch(`${base}/speakers`);
    } catch {
        throw new Error(`VOICEVOX に接続できません（${base}）。VOICEVOX を起動し、CORS の許可を確認してください。`);
    }
    if (!response.ok) throw new Error(`VOICEVOX Error: ${response.status}`);
    const speakers = await response.json();
    // 歌唱用などの話せないスタイルは除く（type が無い古いエンジンは話す用とみなす）
    return (Array.isArray(speakers) ? speakers : []).flatMap(speaker => (speaker.styles || [])
        .filter(style => !style.type || style.type === "talk")
        .map(style => ({
        value: `voicevox:${style.id}`,
        label: `VOICEVOX: ${speaker.name}（${style.name}）`,
        credit: `VOICEVOX:${speaker.name}`
    })));
}

// デスクトップ版（Tauri）の Windows でだけ、Rust 側の SAPI を呼べる
function getTauriInvoke() {
    return window.__TAURI__?.core?.invoke || null;
}

export function isSapiAvailable() {
    return Boolean(getTauriInvoke()) && /Windows/i.test(navigator.userAgent);
}

// SAPI5 に登録された声。WebView2 の speechSynthesis には出てこない声
// （NaturalVoiceSAPIAdapter で入れた「Microsoft Nanami (Natural)」など）も使える
export async function fetchSapiVoices() {
    const invoke = getTauriInvoke();
    if (!invoke) throw new Error("Windows の声はデスクトップ版でだけ使えます");
    const voices = await invoke("sapi_voices");
    const list = Array.isArray(voices) ? voices : [];
    // 日本語（LCID 411）の声だけにする。日本語の声が無ければ全部出す
    const isJapanese = v => String(v.language || "").split(";").some(l => l.trim().toLowerCase() === "411");
    const japanese = list.filter(isJapanese);
    // 自然な声（Natural）を先に並べる
    const rank = v => (/Natural/i.test(v.name) ? 0 : 1);
    return (japanese.length ? japanese : list)
        .sort((a, b) => rank(a) - rank(b))
        .map(v => ({ value: `sapi:${v.id}`, label: `Windows の声: ${v.name}` }));
}

async function requestSapiTts(text, voiceId, signal) {
    const invoke = getTauriInvoke();
    if (!invoke) throw new Error("Windows の声はデスクトップ版でだけ使えます");
    let bytes;
    try {
        bytes = await invoke("sapi_synthesize", { voiceId, text });
    } catch (error) {
        throw new Error(String(error?.message || error));
    }
    // 合成は途中で止められないので、作り終えてから中止を反映する
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return new Blob([bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes)], { type: "audio/wav" });
}

// 選んでいる音声で1文を合成する（キャッシュは見ない）。ブラウザ内蔵は合成しない
export async function synthesizeSpeech(phrase, signal, opts = {}) {
    const model = opts.model ?? ttsSettings.ttsModel;
    const provider = getTtsProvider(model);
    const name = model.slice(provider.length + 1);
    if (provider === "voicevox") return requestVoicevoxTts(phrase, name, signal, opts);
    if (provider === "sapi") return requestSapiTts(phrase, name, signal);
    if (provider === "gemini") return requestGeminiTts(phrase, name, signal, opts);
    return requestCloudTts(phrase, name || "ja-JP-Neural2-B", signal, opts);
}

// 今の音声設定で合成できるか（ブラウザ内蔵、キー未設定、認証エラー後は不可）
export function canSynthesizeSpeech() {
    const provider = getTtsProvider();
    if (provider === "browser") return false;
    if (provider === "voicevox") return true;
    if (provider === "sapi") return isSapiAvailable();
    if (ttsSettings.ttsDailyLimitModel === ttsSettings.ttsModel) return false;
    return Boolean(ttsSettings.GEMINI_API_KEY) && !ttsSettings.geminiAuthBlocked;
}

function getCloudTtsUrl(apiKey) {
    return `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${apiKey}`;
}

function getGeminiTtsUrl(model, apiKey) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
}

export async function fetchAvailableTtsModels(apiKey) {
    const models = [];
    const errors = [];

    try {
        const res = await fetch(`https://texttospeech.googleapis.com/v1/voices?languageCode=ja-JP&key=${apiKey}`);
        if (!res.ok) throw new Error(`Cloud TTS ${res.status}`);
        const data = await res.json();
        (data.voices || [])
            .map(v => v.name)
            .sort()
            .forEach(name => models.push({ value: `cloud:${name}`, label: `Cloud TTS: ${name}` }));
    } catch (err) {
        errors.push(err.message);
    }

    try {
        let pageToken = "";
        do {
            const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${apiKey}` +
                (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Gemini ${res.status}`);
            const data = await res.json();
            (data.models || [])
                .filter(m => /tts/i.test(m.name) && (m.supportedGenerationMethods || []).includes("generateContent"))
                .forEach(m => {
                    const id = m.name.replace(/^models\//, "");
                    models.push({ value: `gemini:${id}`, label: `Gemini: ${m.displayName || id} (${id})` });
                });
            pageToken = data.nextPageToken || "";
        } while (pageToken);
    } catch (err) {
        errors.push(err.message);
    }

    return { models, errors };
}

function pcm16ToWavBlob(pcmBytes, sampleRate) {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + pcmBytes.length, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, pcmBytes.length, true);
    return new Blob([header, pcmBytes], { type: "audio/wav" });
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function throwIfTtsError(response, blockOnAuthError) {
    if (response.ok) return;
    const errorBody = await response.text().catch(() => "");
    if (blockOnAuthError && (response.status === 401 || response.status === 403)) {
        ttsSettings.geminiAuthBlocked = true;
    }
    const error = new Error(`API Error: ${response.status}${errorBody ? ` ${errorBody}` : ""}`);
    error.status = response.status;
    error.body = errorBody;
    throw error;
}

// 429（回数制限）の中身。retryMs: 待てば再開できる時間（応答の RetryInfo）、daily: 1日の上限に達した
export function parseTtsRateLimit(error) {
    if (error?.status !== 429) return null;
    let details = [];
    let message = "";
    try {
        const data = JSON.parse(error.body || "{}");
        details = data?.error?.details || [];
        message = data?.error?.message || "";
    } catch {
        message = error.body || "";
    }
    const retryDelay = details.find(d => String(d?.["@type"] || "").endsWith("RetryInfo"))?.retryDelay;
    const seconds = Number.parseFloat(String(retryDelay || ""));
    const quotaIds = details.flatMap(d => (d?.violations || []).map(v => String(v?.quotaId || v?.quotaMetric || "")));
    const daily = quotaIds.some(id => /per ?day/i.test(id)) || /per day|daily/i.test(message);
    return { retryMs: Number.isFinite(seconds) ? seconds * 1000 : null, daily };
}

// 画面に出す短い説明（API の生の応答は長く、読んでも分かりにくい）
export function describeTtsError(error) {
    const limit = parseTtsRateLimit(error);
    if (limit?.daily) return "音声サービスの1日の上限（無料枠）に達しました。続きは明日、または音声を Cloud TTS・VOICEVOX・Windows の声に変えてください";
    if (limit) return "音声サービスの回数制限（429）に達しました。しばらく待つと続けられます";
    if (error?.status === 401 || error?.status === 403) return "API Key が使えません（設定 → 音声 で確認してください）";
    return String(error?.message || error).slice(0, 80);
}

// 他のモジュールからも読み書きする状態
export const ttsSettings = {
    GEMINI_API_KEY: localStorage.getItem("gemini_api_key") || "",
    geminiAuthBlocked: false,
    ttsModel: localStorage.getItem(TTS_MODEL_KEY) || DEFAULT_TTS_MODEL,
    voicevoxUrl: localStorage.getItem(VOICEVOX_URL_KEY) || DEFAULT_VOICEVOX_URL,
    geminiVoice: localStorage.getItem(GEMINI_VOICE_KEY) || DEFAULT_GEMINI_VOICE,
    geminiStyle: localStorage.getItem(GEMINI_STYLE_KEY) ?? DEFAULT_GEMINI_STYLE,
    // 1日の上限に達した音声設定。その日はそれ以上頼まず、保存済みの音声とブラウザの音声で話す（設定を保存すると解除）
    ttsDailyLimitModel: null
};

// opts: { apiKey, voice, style, preview } — 省略時は保存済み設定を使う。preview は試聴用で認証エラー時も発話をブロックしない
async function requestCloudTts(text, voiceName, signal, opts = {}) {
    const requestBody = {
        audioConfig: {
            audioEncoding: "LINEAR16",
            pitch: 0,
            speakingRate: 1.05
        },
        input: {
            text
        },
        voice: {
            languageCode: "ja-JP",
            name: voiceName
        }
    };

    const response = await fetch(getCloudTtsUrl(opts.apiKey ?? ttsSettings.GEMINI_API_KEY), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal
    });
    await throwIfTtsError(response, !opts.preview);

    const data = await response.json();
    const base64Audio = data.audioContent || data.audio;
    if (!base64Audio) {
        throw new Error("No audio content in response");
    }
    return new Blob([base64ToBytes(base64Audio)], { type: "audio/wav" });
}

async function requestGeminiTts(text, model, signal, opts = {}) {
    const style = opts.style ?? ttsSettings.geminiStyle;
    const voice = opts.voice ?? ttsSettings.geminiVoice;
    const requestBody = {
        // 口調は自然文で指示する (例: "明るく読み上げてください: こんにちは")
        contents: [{ parts: [{ text: style ? `${style}:\n${text}` : text }] }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }
            }
        }
    };

    const response = await fetch(getGeminiTtsUrl(model, opts.apiKey ?? ttsSettings.GEMINI_API_KEY), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal
    });
    await throwIfTtsError(response, !opts.preview);

    const data = await response.json();
    const part = (data.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
    if (!part) {
        throw new Error("No audio content in response");
    }
    // Gemini は audio/L16;codec=pcm;rate=24000 の生PCMを返すため WAV ヘッダを付与
    const mime = part.inlineData.mimeType || "";
    const bytes = base64ToBytes(part.inlineData.data);
    if (/wav/i.test(mime)) return new Blob([bytes], { type: "audio/wav" });
    const rate = Number.parseInt((mime.match(/rate=(\d+)/) || [])[1], 10) || GEMINI_TTS_SAMPLE_RATE;
    return pcm16ToWavBlob(bytes, rate);
}
