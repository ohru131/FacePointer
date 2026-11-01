// 確定した文の大きな表示（確認オーバーレイ）
import { confirmOverlay, confirmText } from "../core/dom.js";
import { playConfirmSound } from "./sound.js";
import { speak } from "../speech/speak.js";

export let isConfirmInProgress = false;
let confirmOverlayHideWaiters = [];

function waitForConfirmOverlayToHide() {
    if (!confirmOverlay || !confirmOverlay.classList.contains("active")) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        confirmOverlayHideWaiters.push(resolve);
    });
}

function resolveConfirmOverlayHideWaiters() {
    if (confirmOverlayHideWaiters.length === 0) return;

    const waiters = confirmOverlayHideWaiters;
    confirmOverlayHideWaiters = [];
    waiters.forEach((resolve) => resolve());
}

function showConfirm(sentence, displayMs = 3500) {
    if (confirmOverlay.classList.contains("active") && confirmText.textContent === sentence) {
        return;
    }

    confirmText.textContent = sentence;
    confirmOverlay.classList.add("active");
    flashScreen();

    if (window.confirmTimer) clearTimeout(window.confirmTimer);
    window.confirmTimer = setTimeout(() => {
        confirmOverlay.classList.remove("active");
        resolveConfirmOverlayHideWaiters();
    }, displayMs);
}

export function dismissConfirmOverlay() {
    if (window.confirmTimer) clearTimeout(window.confirmTimer);
    confirmOverlay.classList.remove("active");
    resolveConfirmOverlayHideWaiters();
}

function flashScreen() {
    const flash = document.createElement("div");
    flash.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.4);z-index:3000;pointer-events:none;";
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 120);
}

const SIMPLE_CONFIRM_DISPLAY_MS = 2200;

// 選んだ文を確定音・大きな表示とともに読み上げ、表示が消えるまで次の確定を受け付けない
export async function speakSimpleSentence(sentence) {
    playConfirmSound();
    // 長い文は読み終える前に表示が消えないよう、文字数に応じて表示を延ばす
    showConfirm(sentence, Math.max(SIMPLE_CONFIRM_DISPLAY_MS, sentence.length * 160));
    isConfirmInProgress = true;
    void speak(sentence);

    try {
        await waitForConfirmOverlayToHide();
    } finally {
        isConfirmInProgress = false;
    }
}
