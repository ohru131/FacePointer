// 設定画面の開く・保存・閉じる・タブ切り替え
import {
    apiKeyInput, apiKeyRevealBtn, axisLockInput, calibFarPassInput, closeSettingsBtn, distanceCompInput,
    dwellTimeSelect, geminiStyleInput, geminiVoiceSelect, iconStyleSelect, modeSelect, panelSnapInput,
    pointerModeSelect, recenterInput, saveSettingsBtn, settingsBtn, settingsCloseX, settingsModal,
    settingsTabButtons, settingsTabContents, ttsModelSelect, ttsModelStatus, ttsPreviewStatus,
    voicevoxStatus, voicevoxUrlInput
} from "../core/dom.js";
import { appState } from "../core/app-state.js";
import { iconStyle, saveIconStyle } from "../ui/icons.js";
import {
    AXIS_LOCK_KEY, DISTANCE_COMP_KEY, NOSE_GAIN_KEY, PANEL_SNAP_KEY, POINTER_MODE_ABSOLUTE,
    POINTER_MODE_KEY, POINTER_MODE_RELATIVE, RECENTER_KEY, YAW_GAIN_KEY, pointerConfig
} from "../pointer/config.js";
import { clearPostureHint, resetPanelSnap, resetPointerMotionHistory } from "../pointer/tracking.js";
import { dwellTimeMs, saveDwellTime } from "../panels/selection.js";
import { renderAll, setAppMode, updateSideNextClearance } from "../panels/screen.js";
import {
    GEMINI_STYLE_KEY, GEMINI_VOICE_KEY, TTS_MODEL_KEY, VOICEVOX_URL_KEY, getTtsProvider,
    getVoicevoxBaseUrl, loadTtsModelList, ttsSettings
} from "../speech/tts.js";
import { prefetchAllAudio } from "../speech/prefetch.js";
import { JAW_OPEN_THRESHOLD_KEY, jawOpenThreshold } from "../face/gesture.js";
import { calibrationWizard, isCalibFarPassEnabled, saveCalibFarPass } from "../calibration/wizard.js";
import { openSimplePanelEditor, saveSimplePanelEditor } from "../panels/custom-panel-editor.js";
import { openTalkEditor, saveTalkEditor } from "../talk/editor.js";
import {
    openQuestionEditor, renderQuestionEditor, renderQuestionPanelPicker, saveQuestionEditor
} from "../question/editor.js";
import {
    applyPointerModeState, refreshPointerOptionAvailability, refreshTuningSliderLabels,
    updateCalibStatusBadge
} from "./pointer-settings.js";
import { previewTts, renderTtsModelOptions, updateAudioCacheSummary, updateTtsCreditNote } from "./voice-settings.js";

// 音声タブの入力（API Key・TTSモデル・VOICEVOX・Gemini 話者・口調）を保存して使い始める。
// 「保存して閉じる」と「音声データを作成」の両方から呼ぶ（作成ボタンだけ押しても、画面の入力で作れるように）
export function saveVoiceSettingsFromForm() {
    const newKey = apiKeyInput.value.trim();
    ttsSettings.GEMINI_API_KEY = newKey;
    ttsSettings.geminiAuthBlocked = false;
    ttsSettings.ttsDailyLimitModel = null;
    localStorage.setItem("gemini_api_key", newKey);
    if (ttsModelSelect && ttsModelSelect.value) {
        ttsSettings.ttsModel = ttsModelSelect.value;
        localStorage.setItem(TTS_MODEL_KEY, ttsSettings.ttsModel);
    }
    if (voicevoxUrlInput) {
        ttsSettings.voicevoxUrl = getVoicevoxBaseUrl(voicevoxUrlInput.value);
        localStorage.setItem(VOICEVOX_URL_KEY, ttsSettings.voicevoxUrl);
    }
    if (geminiVoiceSelect && geminiVoiceSelect.value) {
        ttsSettings.geminiVoice = geminiVoiceSelect.value;
        localStorage.setItem(GEMINI_VOICE_KEY, ttsSettings.geminiVoice);
    }
    if (geminiStyleInput) {
        ttsSettings.geminiStyle = geminiStyleInput.value.trim();
        localStorage.setItem(GEMINI_STYLE_KEY, ttsSettings.geminiStyle);
    }
}

// 設定を保存して閉じる。保存できなかったら（容量超過など）開いたままで false
export function saveSettingsAndClose() {
    // 画像を含み容量超過しやすいパネル設定を先に保存し、失敗したら他も保存しない
    if (!saveSimplePanelEditor()) return false;
    if (!saveQuestionEditor()) return false;
    if (!saveTalkEditor()) return false;

    const previousTtsModel = ttsSettings.ttsModel;
    saveVoiceSettingsFromForm();

    localStorage.setItem(JAW_OPEN_THRESHOLD_KEY, String(jawOpenThreshold));
    localStorage.setItem(NOSE_GAIN_KEY, String(pointerConfig.noseGain));
    localStorage.setItem(YAW_GAIN_KEY, String(pointerConfig.yawGain));
    if (iconStyleSelect) {
        saveIconStyle(iconStyleSelect.value);
    }
    if (dwellTimeSelect) {
        saveDwellTime(dwellTimeSelect.value);
    }
    if (panelSnapInput) {
        pointerConfig.isPanelSnapEnabled = panelSnapInput.checked;
        localStorage.setItem(PANEL_SNAP_KEY, pointerConfig.isPanelSnapEnabled ? "1" : "0");
        resetPanelSnap();
    }
    if (axisLockInput) {
        pointerConfig.isAxisLockEnabled = axisLockInput.checked;
        localStorage.setItem(AXIS_LOCK_KEY, pointerConfig.isAxisLockEnabled ? "1" : "0");
    }
    if (distanceCompInput) {
        pointerConfig.isDistanceCompEnabled = distanceCompInput.checked;
        localStorage.setItem(DISTANCE_COMP_KEY, pointerConfig.isDistanceCompEnabled ? "1" : "0");
    }
    if (recenterInput) {
        pointerConfig.isRecenterEnabled = recenterInput.checked;
        localStorage.setItem(RECENTER_KEY, pointerConfig.isRecenterEnabled ? "1" : "0");
    }
    if (calibFarPassInput) {
        saveCalibFarPass(calibFarPassInput.checked);
    }
    const nextPointerMode = pointerModeSelect?.value === POINTER_MODE_RELATIVE ? POINTER_MODE_RELATIVE : POINTER_MODE_ABSOLUTE;
    if (pointerModeSelect && nextPointerMode !== pointerConfig.pointerMode) {
        pointerConfig.pointerMode = nextPointerMode;
        localStorage.setItem(POINTER_MODE_KEY, pointerConfig.pointerMode);
        clearPostureHint();
        resetPointerMotionHistory();
        applyPointerModeState();
    }

    renderAll();
    if (modeSelect) setAppMode(modeSelect.value);
    settingsModal.classList.remove("active");
    // 右上の ⛶ ⚙ ◎ は設定を開いている間は隠れていて、次への上の空きを測れなかったので測り直す
    updateSideNextClearance();
    // 音声を変えたら、新しい音声で前もって作り始める（Gemini TTS は遅く回数制限があるので手動）。
    // 保存した文言で作るよう最後に呼ぶ
    if (ttsSettings.ttsModel !== previousTtsModel && ["cloud", "voicevox", "sapi"].includes(getTtsProvider())) void prefetchAllAudio({ quiet: true });
    return true;
}

export function activateSettingsTab(tabId) {
    settingsTabButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tabId));
    settingsTabContents.forEach(content => content.classList.toggle("active", content.id === tabId));
    // 前のタブのスクロール位置のまま開かないよう、先頭から見せる
    document.querySelector(".settings-panes")?.scrollTo({ top: 0 });
    // 編集中の任意パネルを、質問の答えの候補に反映する
    if (tabId === "question-tab") {
        renderQuestionEditor();
        renderQuestionPanelPicker();
    }
}

export function initSettingsModal() {
    // 設定の「キャリブレーションを始める」（基本タブの手順・ポインタと確定タブ）。設定を保存して閉じてから始める
    document.querySelectorAll(".calib-start-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (calibrationWizard.isActive()) return;
            if (!saveSettingsAndClose()) return;
            calibrationWizard.start();
        });
    });
    document.querySelectorAll(".tts-preview-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const input = document.getElementById(btn.dataset.target);
            previewTts(input ? input.value : "", btn);
        });
    });
    settingsBtn.addEventListener("click", () => {
        updateCalibStatusBadge();
        apiKeyInput.value = ttsSettings.GEMINI_API_KEY;
        apiKeyInput.type = "password";
        if (apiKeyRevealBtn) apiKeyRevealBtn.textContent = "表示";
        renderTtsModelOptions(loadTtsModelList(), ttsSettings.ttsModel);
        if (voicevoxUrlInput) voicevoxUrlInput.value = ttsSettings.voicevoxUrl;
        if (voicevoxStatus) voicevoxStatus.textContent = "";
        const cacheClearStatus = document.getElementById("audio-cache-clear-result");
        if (cacheClearStatus) cacheClearStatus.textContent = "";
        const cacheCreateStatus = document.getElementById("audio-cache-create-result");
        if (cacheCreateStatus) cacheCreateStatus.textContent = "";
        void updateAudioCacheSummary();
        updateTtsCreditNote();
        if (ttsModelStatus) ttsModelStatus.textContent = "";
        if (geminiVoiceSelect) geminiVoiceSelect.value = ttsSettings.geminiVoice;
        if (geminiStyleInput) geminiStyleInput.value = ttsSettings.geminiStyle;
        if (ttsPreviewStatus) ttsPreviewStatus.textContent = "";
        if (iconStyleSelect) iconStyleSelect.value = iconStyle;
        if (modeSelect) modeSelect.value = appState.appMode;
        if (dwellTimeSelect) dwellTimeSelect.value = String(dwellTimeMs);
        if (pointerModeSelect) pointerModeSelect.value = pointerConfig.pointerMode;
        if (panelSnapInput) panelSnapInput.checked = pointerConfig.isPanelSnapEnabled;
        if (axisLockInput) axisLockInput.checked = pointerConfig.isAxisLockEnabled;
        if (distanceCompInput) distanceCompInput.checked = pointerConfig.isDistanceCompEnabled;
        if (recenterInput) recenterInput.checked = pointerConfig.isRecenterEnabled;
        if (calibFarPassInput) calibFarPassInput.checked = isCalibFarPassEnabled;
        refreshPointerOptionAvailability();
        openSimplePanelEditor();
        openQuestionEditor();
        openTalkEditor();
        refreshTuningSliderLabels();
        settingsModal.classList.add("active");
    });
    closeSettingsBtn.addEventListener("click", () => {
        settingsModal.classList.remove("active");
    });
    if (settingsCloseX) {
        settingsCloseX.addEventListener("click", () => settingsModal.classList.remove("active"));
    }
    if (apiKeyRevealBtn) {
        apiKeyRevealBtn.addEventListener("click", () => {
            const isHidden = apiKeyInput.type === "password";
            apiKeyInput.type = isHidden ? "text" : "password";
            apiKeyRevealBtn.textContent = isHidden ? "隠す" : "表示";
        });
    }
    saveSettingsBtn.addEventListener("click", saveSettingsAndClose);
    settingsTabButtons.forEach(btn => {
        btn.addEventListener("click", () => activateSettingsTab(btn.dataset.tab));
    });
    // 基本タブの「はじめて使うとき」から各タブへ移る
    document.querySelectorAll("[data-goto-tab]").forEach(btn => {
        btn.addEventListener("click", () => activateSettingsTab(btn.dataset.gotoTab));
    });
    settingsModal.addEventListener("click", (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.remove("active");
        }
    });
}
