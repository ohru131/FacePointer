// 合成した音声の保存（IndexedDB）
import { ttsSettings } from "./tts.js";

// 音声は文ごとに1つだけ保存し、どのモデル・話者で作ったものも使う
// （無料枠を使い切ったら別のモデルで残りを作れるように。モデルを変えても作り直さない）
export function audioCacheKey(text) {
    return text;
}

// 以前はモデル・話者ごとに別の名前で保存していた（"モデル|文"、Gemini は "モデル|話者|口調|文"、
// VOICEVOX は "voicevox:番号@接続先|文"）。文だけの名前にまとめる。同じ文が複数あれば、
// 文だけの名前のもの → 今のモデルで作ったもの → それ以外 の順に残す
const PREFIXED_AUDIO_KEY = /^(cloud|gemini|voicevox):[^|]*\|/;

function textFromPrefixedAudioKey(key) {
    const parts = key.split("|");
    return (key.startsWith("gemini:") ? parts.slice(3) : parts.slice(1)).join("|");
}

export function mergeAudioCacheKeys() {
    if (!db) return Promise.resolve(0);
    return new Promise((resolve) => {
        let merged = 0;
        try {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAllKeys();
            request.onsuccess = () => {
                const keys = request.result.map(String);
                const prefixed = keys.filter(k => PREFIXED_AUDIO_KEY.test(k));
                if (prefixed.length === 0) return;
                const saved = new Set(keys.filter(k => !PREFIXED_AUDIO_KEY.test(k)));
                const isCurrent = (k) => k.startsWith(`${ttsSettings.ttsModel}|`) || k.startsWith(`${ttsSettings.ttsModel}@`);
                [...prefixed.filter(isCurrent), ...prefixed.filter(k => !isCurrent(k))].forEach((key) => {
                    const text = textFromPrefixedAudioKey(key);
                    if (!text || saved.has(text)) {
                        store.delete(key);
                        return;
                    }
                    saved.add(text);
                    merged++;
                    const get = store.get(key);
                    get.onsuccess = () => {
                        if (get.result) store.put(get.result, text);
                        store.delete(key);
                    };
                });
            };
            tx.oncomplete = () => resolve(merged);
            tx.onerror = () => resolve(0);
            tx.onabort = () => resolve(0);
        } catch (error) {
            console.warn("audio cache merge failed:", error);
            resolve(0);
        }
    });
}

const DB_NAME = "AudioCacheDB";
export const STORE_NAME = "audioBlobs";
export let db = null;

export async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const dbObj = e.target.result;
            if (!dbObj.objectStoreNames.contains(STORE_NAME)) {
                dbObj.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

export async function getCachedAudio(text) {
    if (!db) return null;
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(text);
        request.onsuccess = () => resolve(request.result && request.result.size >= AUDIO_MIN_BYTES ? request.result : null);
        request.onerror = () => resolve(null);
    });
}

// 容量不足などで保存できなくても待ち続けない（待ち続けると以後の発話が止まる）
export async function setCachedAudio(text, blob) {
    if (!db) return false;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).put(blob, text);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
            tx.onabort = () => resolve(false);
        } catch (error) {
            console.warn("audio cache save failed:", error);
            resolve(false);
        }
    });
}

export function deleteCachedAudio(text) {
    if (!db) return;
    try {
        db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(text);
    } catch (error) {
        console.warn("audio cache delete failed:", error);
    }
}

// 壊れた・空の音声は使わない（再生できずに無音になるのを防ぐ）
export const AUDIO_MIN_BYTES = 100;

export function clearAudioCache() {
    if (!db) return;
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
}

// 保存済みのキーを一度に読む（1文ずつ読むと千件以上の読み出しになる）
export function getCachedAudioKeys() {
    if (!db) return Promise.resolve(new Set());
    return new Promise((resolve) => {
        try {
            const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAllKeys();
            request.onsuccess = () => resolve(new Set(request.result));
            request.onerror = () => resolve(new Set());
        } catch {
            resolve(new Set());
        }
    });
}
