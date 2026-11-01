// 右上のボタン（全画面・設定・正面の取り直し）と画面全体の操作
import { calibrateBtn, fullscreenBtn, recaptureFrontBtn } from "../core/dom.js";
import {
    ANGLE_NOISE_KEY, NOSE_NOISE_KEY, SIDE_GAIN_RATIO_KEYS, VERTICAL_GAIN_RATIO_KEY, pointerConfig
} from "../pointer/config.js";
import { resetPointerMotionHistory } from "../pointer/tracking.js";
import { speak } from "../speech/speak.js";
import { JAW_CLOSE_MIN_GAP, gesture } from "../face/gesture.js";
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
        gesture.jawClosedBaseline = null;
        gesture.debugJawOpenThreshold = gesture.jawOpenThreshold;
        gesture.debugJawCloseThreshold = Math.max(0, gesture.jawOpenThreshold - JAW_CLOSE_MIN_GAP);
        // キャリブレーションで決めた揺れ幅・向きごとの倍率はスライダーが無いので、ここで初期値へ戻す
        pointerConfig.noseNoise = 0;
        pointerConfig.angleNoise = 0;
        pointerConfig.sideGainRatios = { left: 1, right: 1, up: 1, down: 1 };
        localStorage.removeItem(NOSE_NOISE_KEY);
        localStorage.removeItem(ANGLE_NOISE_KEY);
        localStorage.removeItem(VERTICAL_GAIN_RATIO_KEY);
        Object.values(SIDE_GAIN_RATIO_KEYS).forEach(key => localStorage.removeItem(key));
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
        if (!document.fullscreenEnabled) {
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
