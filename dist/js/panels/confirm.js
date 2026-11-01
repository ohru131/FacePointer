// 確定した文の大きな表示（確認オーバーレイ）
import { confirmOverlay, confirmText } from "../core/dom.js";

// 他のモジュールからも読み書きする状態
export const confirmState = {
    isConfirmInProgress: false
};
let confirmOverlayHideWaiters = [];

export function waitForConfirmOverlayToHide() {
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

export function showConfirm(sentence, displayMs = 3500) {
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
