// 口の確定の調査用ログ（Ctrl+Shift+L で書き出し）
import { tracking } from "../pointer/tracking.js";
import {
    CLICK_FEEDBACK_MS, gesture, isMouthOpen, jawOpenConsecutiveFrames, jawOpenFilteredScore,
    jawOpenRawInstantScore, jawOpenRawScore, mouthOpenRatio, mouthOpenRatioBaseline
} from "./gesture.js";

const CLICK_DEBUG_LOG = true;
const CLICK_DEBUG_CONSOLE = false;
const CLICK_DEBUG_MAX_ENTRIES = 6000;
const CLICK_DEBUG_STORAGE_KEY = "click_debug_log_entries_v1";
const CLICK_DEBUG_SEQ_STORAGE_KEY = "click_debug_log_seq_v1";
const CLICK_DEBUG_AUTO_PERSIST = true;
const CLICK_DEBUG_PERSIST_INTERVAL_MS = 1200;
let clickDebugSeq = 0;
let clickDebugEntries = [];
let clickDebugPersistTimer = null;

function persistClickDebugToLocalStorage() {
    if (!CLICK_DEBUG_AUTO_PERSIST) return;
    try {
        localStorage.setItem(CLICK_DEBUG_STORAGE_KEY, JSON.stringify(clickDebugEntries));
        localStorage.setItem(CLICK_DEBUG_SEQ_STORAGE_KEY, String(clickDebugSeq));
    } catch (err) {
        if (CLICK_DEBUG_CONSOLE) {
            console.warn("[CLICK_DEBUG] localStorage persist failed", err);
        }
    }
}

function scheduleClickDebugPersist() {
    if (!CLICK_DEBUG_AUTO_PERSIST) return;
    if (clickDebugPersistTimer) return;
    clickDebugPersistTimer = setTimeout(() => {
        clickDebugPersistTimer = null;
        persistClickDebugToLocalStorage();
    }, CLICK_DEBUG_PERSIST_INTERVAL_MS);
}

function loadClickDebugFromLocalStorage() {
    if (!CLICK_DEBUG_AUTO_PERSIST) return;
    try {
        const rawEntries = localStorage.getItem(CLICK_DEBUG_STORAGE_KEY);
        const rawSeq = localStorage.getItem(CLICK_DEBUG_SEQ_STORAGE_KEY);
        if (rawEntries) {
            const parsed = JSON.parse(rawEntries);
            if (Array.isArray(parsed)) {
                clickDebugEntries = parsed.slice(-CLICK_DEBUG_MAX_ENTRIES);
            }
        }
        if (rawSeq && Number.isFinite(Number(rawSeq))) {
            clickDebugSeq = Number(rawSeq);
        } else {
            clickDebugSeq = clickDebugEntries.length;
        }
    } catch (err) {
        clickDebugEntries = [];
        clickDebugSeq = 0;
        if (CLICK_DEBUG_CONSOLE) {
            console.warn("[CLICK_DEBUG] localStorage load failed", err);
        }
    }
}

function exportClickDebugLogFile() {
    if (clickDebugEntries.length === 0) return false;
    const jsonl = clickDebugEntries.map((entry) => JSON.stringify(entry)).join("\n");
    const blob = new Blob([jsonl], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[.:]/g, "-");
    const a = document.createElement("a");
    a.href = url;
    a.download = `click-debug-${stamp}.jsonl`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
}

function clearClickDebugLog() {
    clickDebugEntries = [];
    clickDebugSeq = 0;
    if (clickDebugPersistTimer) {
        clearTimeout(clickDebugPersistTimer);
        clickDebugPersistTimer = null;
    }
    try {
        localStorage.removeItem(CLICK_DEBUG_STORAGE_KEY);
        localStorage.removeItem(CLICK_DEBUG_SEQ_STORAGE_KEY);
    } catch {
        // no-op
    }
}

export function logClickDebug(event, extra = {}) {
    if (!CLICK_DEBUG_LOG) return;
    const hoverBtn = document.querySelector(".h-btn.hover");
    const hoverKey = hoverBtn ? `${hoverBtn.dataset.row}|${hoverBtn.dataset.name}` : "";
    const payload = {
        seq: ++clickDebugSeq,
        t: new Date().toISOString(),
        event,
        isMouthOpen,
        jawRaw: Number(jawOpenRawScore.toFixed(4)),
        jawRawInstant: Number(jawOpenRawInstantScore.toFixed(4)),
        jawFilt: Number(jawOpenFilteredScore.toFixed(4)),
        jawBaseline: Number((gesture.jawClosedBaseline ?? 0).toFixed(4)),
        mouthRatio: Number((mouthOpenRatio ?? 0).toFixed(4)),
        mouthRatioBaseline: Number((mouthOpenRatioBaseline ?? 0).toFixed(4)),
        jawOpenTh: Number(gesture.debugJawOpenThreshold.toFixed(4)),
        jawCloseTh: Number(gesture.debugJawCloseThreshold.toFixed(4)),
        openFrames: jawOpenConsecutiveFrames,
        hoverKey,
        pendingClickTargetKey: gesture.pendingClickTargetKey,
        hasPendingClick: Boolean(gesture.pendingClickTimer),
        pointerX: Math.round(tracking.pointerX),
        pointerY: Math.round(tracking.pointerY),
        ...extra
    };
    clickDebugEntries.push(payload);
    if (clickDebugEntries.length > CLICK_DEBUG_MAX_ENTRIES) {
        clickDebugEntries.splice(0, clickDebugEntries.length - CLICK_DEBUG_MAX_ENTRIES);
    }
    scheduleClickDebugPersist();
    if (CLICK_DEBUG_CONSOLE) {
        console.log("[CLICK_DEBUG]", payload);
    }
}

export function markClickFeedback() {
    gesture.clickFeedbackUntil = Date.now() + CLICK_FEEDBACK_MS;
}

export function initClickDebug() {
    loadClickDebugFromLocalStorage();
    window.exportClickDebugLogFile = exportClickDebugLogFile;
    window.clearClickDebugLog = clearClickDebugLog;
    window.addEventListener("keydown", (e) => {
        if (!e.ctrlKey || !e.shiftKey || e.key.toLowerCase() !== "l") return;
        e.preventDefault();
        const exported = exportClickDebugLogFile();
        if (!exported) {
            alert("click-debugログがまだありません。");
        }
    });
}
