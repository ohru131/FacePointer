// 右上のボタン（全画面 or 終了・設定・正面の取り直し）と画面全体の操作
import { calibrateBtn, fullscreenBtn, recaptureFrontBtn } from "../core/dom.js";
import { pointerConfig, resetCalibrationTuning } from "../pointer/config.js";
import { resetPointerMotionHistory } from "../pointer/tracking.js";
import { speak } from "../speech/speak.js";
import { resetJawBaseline } from "../face/gesture.js";
import { startFrontRecapture } from "../calibration/front.js";

function updateFullscreenButton() {
    const isFullscreen = Boolean(document.fullscreenElement);
    document.body.classList.toggle("is-fullscreen", isFullscreen);
    if (!fullscreenBtn) return;
    fullscreenBtn.textContent = isFullscreen ? "⤡" : "⛶";
    const title = isFullscreen ? "全画面を解除" : "全画面表示（Escでも解除）";
    fullscreenBtn.title = title;
    fullscreenBtn.setAttribute("aria-label", title);
}

export function initQuickActions() {
    calibrateBtn.addEventListener("click", () => {
        if (!confirm("静止時の揺れ幅と向きごとの倍率を初期値に戻し、今の向きを正面にします。よろしいですか？")) return;
        pointerConfig.isCalibrating = true;
        resetPointerMotionHistory();
        resetJawBaseline();
        resetCalibrationTuning();
        speak("リセット");
    });
    // ファイルを画像入力以外に落としたとき、画面がそのファイルに切り替わってアプリが消えないようにする
    ["dragover", "drop"].forEach((type) => {
        document.addEventListener(type, (event) => {
            if (!event.dataTransfer?.types?.includes("Files")) return;
            if (event.target?.closest?.('input[type="file"]')) return;
            event.preventDefault();
        });
    });
    if (recaptureFrontBtn) {
        recaptureFrontBtn.addEventListener("click", startFrontRecapture);
    }
    if (fullscreenBtn) {
        const tauriWindow = window.__TAURI__?.window;
        if (tauriWindow?.getCurrentWindow) {
            // デスクトップ版は起動時から全画面で画面を占有するので、このボタンはアプリの終了にする
            fullscreenBtn.textContent = "✕";
            fullscreenBtn.title = "アプリを終了";
            fullscreenBtn.setAttribute("aria-label", "アプリを終了");
            fullscreenBtn.addEventListener("click", async () => {
                if (!confirm("FacePointer を終了します。よろしいですか？")) return;
                try {
                    await tauriWindow.getCurrentWindow().close();
                } catch (error) {
                    console.warn("app close failed:", error);
                }
            });
        } else if (!document.fullscreenEnabled) {
            fullscreenBtn.style.display = "none";
        } else {
            fullscreenBtn.addEventListener("click", async () => {
                try {
                    if (document.fullscreenElement) await document.exitFullscreen();
                    else await document.documentElement.requestFullscreen();
                } catch (error) {
                    console.warn("fullscreen toggle failed:", error);
                }
            });
            document.addEventListener("fullscreenchange", updateFullscreenButton);
            updateFullscreenButton();
        }
    }
}
