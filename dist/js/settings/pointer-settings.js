// 設定画面: ポインタと確定のタブ
import {
    jawOpenThresholdSlider, jawOpenThresholdValue, noseGainSlider, noseGainValue, pointerModeSelect,
    pointerTab, yawGainSlider, yawGainValue
} from "../core/dom.js";
import {
    NOSE_GAIN_KEY, POINTER_MODE_ABSOLUTE, YAW_GAIN_KEY, isCalibrationDone, pointerConfig
} from "../pointer/config.js";
import { tracking } from "../pointer/tracking.js";
import { JAW_OPEN_THRESHOLD_KEY, gesture } from "../face/gesture.js";

export function updateCalibStatusBadge() {
    const badge = document.getElementById("calib-status-badge");
    if (!badge) return;
    const done = isCalibrationDone();
    badge.textContent = done ? "✓ 済み" : "まだです";
    badge.classList.toggle("is-done", done);
}

export function applyPointerModeState() {
    document.body.classList.toggle("pointer-absolute", pointerConfig.pointerMode === POINTER_MODE_ABSOLUTE);
}

// 設定画面: 選んだ動かし方で働かない補助を薄くする
export function refreshPointerOptionAvailability() {
    if (!pointerTab || !pointerModeSelect) return;
    const mode = pointerModeSelect.value;
    pointerTab.querySelectorAll("[data-pointer-mode]").forEach((row) => {
        row.classList.toggle("is-inactive", row.dataset.pointerMode !== mode);
    });
}

export function refreshTuningSliderLabels() {
    if (jawOpenThresholdValue) jawOpenThresholdValue.textContent = gesture.jawOpenThreshold.toFixed(2);
    if (noseGainValue) noseGainValue.textContent = pointerConfig.noseGain.toFixed(1);
    if (yawGainValue) yawGainValue.textContent = pointerConfig.yawGain.toFixed(1);
}

export function syncTuningSliders() {
    if (jawOpenThresholdSlider) jawOpenThresholdSlider.value = String(gesture.jawOpenThreshold);
    if (noseGainSlider) noseGainSlider.value = String(pointerConfig.noseGain);
    if (yawGainSlider) yawGainSlider.value = String(pointerConfig.yawGain);
    refreshTuningSliderLabels();
}

export function initPointerSettings() {
    applyPointerModeState();
    pointerModeSelect?.addEventListener("change", refreshPointerOptionAvailability);
    if (jawOpenThresholdSlider) {
        jawOpenThresholdSlider.addEventListener("input", (e) => {
            gesture.jawOpenThreshold = Number.parseFloat(e.target.value);
            localStorage.setItem(JAW_OPEN_THRESHOLD_KEY, String(gesture.jawOpenThreshold));
            refreshTuningSliderLabels();
        });
    }
    if (noseGainSlider) {
        noseGainSlider.addEventListener("input", (e) => {
            pointerConfig.noseGain = Number.parseFloat(e.target.value);
            localStorage.setItem(NOSE_GAIN_KEY, String(pointerConfig.noseGain));
            refreshTuningSliderLabels();
        });
    }
    if (yawGainSlider) {
        yawGainSlider.addEventListener("input", (e) => {
            pointerConfig.yawGain = Number.parseFloat(e.target.value);
            localStorage.setItem(YAW_GAIN_KEY, String(pointerConfig.yawGain));
            pointerConfig.isCalibrating = true;
            tracking.lastYaw = null;
            tracking.filteredYaw = null;
            tracking.lastPitch = null;
            tracking.filteredPitch = null;
            refreshTuningSliderLabels();
        });
    }
    syncTuningSliders();
}
