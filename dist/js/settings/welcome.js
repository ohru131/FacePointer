// 初回の案内
import { welcomeModal } from "../core/dom.js";
import { POINTER_MODE_ABSOLUTE, pointerConfig } from "../pointer/config.js";
import { calibrationWizard } from "../calibration/wizard.js";
import { startFrontRecapture } from "../calibration/front.js";

export function openWelcome() {
    welcomeModal?.classList.add("active");
}

export function initWelcome() {
    document.getElementById("welcome-start-btn")?.addEventListener("click", () => {
        welcomeModal?.classList.remove("active");
        calibrationWizard.start();
    });
    // あとで: いつもの起動と同じく正面だけ登録する（正面固定のとき）
    document.getElementById("welcome-later-btn")?.addEventListener("click", () => {
        welcomeModal?.classList.remove("active");
        if (pointerConfig.pointerMode === POINTER_MODE_ABSOLUTE) startFrontRecapture();
    });
}
