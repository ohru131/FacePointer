// 画面の要素（index.html の id から引く）

export const video = document.getElementById("webcam");
export const canvasElement = document.getElementById("canvas-overlay");
export const canvasCtx = canvasElement.getContext("2d");
export const pointerElement = document.getElementById("pointer");
export const calibrateBtn = document.getElementById("calibrate-btn");
export const loadingOverlay = document.getElementById("loading");
export const gestureIndicator = document.getElementById("gesture-indicator");
export const telemetryValues = document.getElementById("telemetry-values");

export const confirmOverlay = document.getElementById("confirm-overlay");
export const confirmText = document.getElementById("confirm-text");
export const appRoot = document.getElementById("app");
export const simplePanelContainer = document.getElementById("simple-panel");
export const simpleGridContainer = document.getElementById("simple-grid");
export const simpleBarContainer = document.getElementById("simple-bar");
export const simpleSidePrev = document.getElementById("simple-side-prev");
export const simpleSideNext = document.getElementById("simple-side-next");
export const simpleMessageContainer = document.getElementById("simple-message");
export const dwellIndicator = document.getElementById("dwell-indicator");

export const recaptureFrontBtn = document.getElementById("recapture-front-btn");

export const audioCacheBtn = document.getElementById("audio-cache-btn");

// ブラウザ版: 全画面表示の切り替え（Escでも解除）／デスクトップ版: アプリの終了
export const fullscreenBtn = document.getElementById("fullscreen-btn");

export const settingsBtn = document.getElementById("settings-btn");
export const settingsModal = document.getElementById("settings-modal");
export const apiKeyInput = document.getElementById("api-key-input");
export const ttsModelSelect = document.getElementById("tts-model-select");
export const ttsModelFetchBtn = document.getElementById("tts-model-fetch-btn");
export const ttsModelStatus = document.getElementById("tts-model-status");
export const geminiVoiceSelect = document.getElementById("gemini-voice-select");
export const geminiStyleInput = document.getElementById("gemini-style-input");
export const geminiStyleResetBtn = document.getElementById("gemini-style-reset-btn");
export const jawOpenThresholdSlider = document.getElementById("jaw-open-threshold-slider");
export const noseGainSlider = document.getElementById("nose-gain-slider");
export const yawGainSlider = document.getElementById("yaw-gain-slider");
export const iconStyleSelect = document.getElementById("icon-style-select");
export const cameraSelect = document.getElementById("camera-select");
export const cameraStatus = document.getElementById("camera-status");
// ラジオボタン群を <select> と同じ感覚(value / change)で扱う
function radioGroup(name) {
    const inputs = () => Array.from(document.querySelectorAll(`input[type="radio"][name="${name}"]`));
    if (inputs().length === 0) return null;
    return {
        get value() {
            return inputs().find(input => input.checked)?.value ?? "";
        },
        set value(next) {
            inputs().forEach(input => { input.checked = input.value === String(next); });
        },
        addEventListener(type, handler) {
            inputs().forEach(input => input.addEventListener(type, handler));
        }
    };
}

export const modeSelect = radioGroup("app-mode");
export const dwellTimeSelect = radioGroup("dwell-time");
export const pointerModeSelect = radioGroup("pointer-mode");
export const panelSnapInput = document.getElementById("panel-snap-input");
export const axisLockInput = document.getElementById("axis-lock-input");
export const distanceCompInput = document.getElementById("distance-comp-input");
export const recenterInput = document.getElementById("recenter-input");
export const calibFarPassInput = document.getElementById("calib-far-pass-input");
export const pointerTab = document.getElementById("pointer-tab");
export const simpleGridSizeSelect = radioGroup("simple-grid-size");
export const simpleTabsContainer = document.getElementById("simple-tabs");
export const talkWordList = document.getElementById("talk-word-list");
export const talkWordFilter = document.getElementById("talk-word-filter");
export const talkLearnInput = document.getElementById("talk-learn-input");
export const talkHistorySummary = document.getElementById("talk-history-summary");
export const talkCustomLabelInput = document.getElementById("talk-custom-label-input");
export const talkCustomEmojiInput = document.getElementById("talk-custom-emoji-input");
export const talkCustomSayInput = document.getElementById("talk-custom-say-input");
export const talkSetList = document.getElementById("talk-set-list");
export const talkProfileGenderSelect = document.getElementById("talk-profile-gender");
export const talkProfileAgeInput = document.getElementById("talk-profile-age");
export const talkAiModelInput = document.getElementById("talk-ai-model-input");
export const talkInterviewCarryInput = document.getElementById("talk-interview-carry");
export const talkInterviewStartBtn = document.getElementById("talk-interview-start-btn");
export const talkGenerateBtn = document.getElementById("talk-generate-btn");
export const talkInterviewList = document.getElementById("talk-interview-list");
export const talkAiStatus = document.getElementById("talk-ai-status");
export const questionButtonsContainer = document.getElementById("question-buttons");
export const questionModeBar = document.getElementById("question-mode-bar");
export const questionEndBtn = document.getElementById("question-end-btn");
export const questionEditorList = document.getElementById("question-editor-list");
export const questionSpeakInput = document.getElementById("question-speak-input");
export const questionCustomTextInput = document.getElementById("question-custom-text-input");
export const questionCustomLabelInput = document.getElementById("question-custom-label-input");
export const questionCustomEmojiInput = document.getElementById("question-custom-emoji-input");
export const questionAnswerSelect = document.getElementById("question-answer-select");
export const questionGridSizeSelect = radioGroup("question-grid-size");
export const questionAnswerSummary = document.getElementById("question-answer-summary");
export const questionAnswerPagesContainer = document.getElementById("question-answer-pages");
export const questionAnswerDetail = document.getElementById("question-answer-detail");
export const questionAnswerFilter = document.getElementById("question-answer-filter");
export const questionAnswerPalette = document.getElementById("question-answer-palette");
export const questionCustomAnswersInput = document.getElementById("question-custom-answers-input");
export const questionPanelPicker = document.getElementById("question-panel-picker");
export const questionPanelPickSummary = document.getElementById("question-panel-pick-summary");
export const questionPanelPickClearBtn = document.getElementById("question-panel-pick-clear-btn");
export const settingsCloseX = document.getElementById("settings-close-x");
export const apiKeyRevealBtn = document.getElementById("api-key-reveal-btn");
export const simpleShowRestInput = document.getElementById("simple-show-rest-input");
export const simpleConfirmSoundInput = document.getElementById("simple-confirm-sound-input");
export const simpleCustomNameInput = document.getElementById("simple-custom-name-input");
export const simpleCustomSentenceInput = document.getElementById("simple-custom-sentence-input");
export const simpleCustomEmojiInput = document.getElementById("simple-custom-emoji-input");
export const simpleCustomImageInput = document.getElementById("simple-custom-image-input");
export const simpleCustomImagePreview = document.getElementById("simple-custom-image-preview");
export const simpleCustomAddBtn = document.getElementById("simple-custom-add-btn");
export const settingsTabButtons = document.querySelectorAll(".settings-tab-btn");
export const settingsTabContents = document.querySelectorAll(".settings-tab-content");
export const jawOpenThresholdValue = document.getElementById("jaw-open-threshold-value");
export const noseGainValue = document.getElementById("nose-gain-value");
export const yawGainValue = document.getElementById("yaw-gain-value");
export const saveSettingsBtn = document.getElementById("save-settings");
export const closeSettingsBtn = document.getElementById("close-settings");

// 初回の案内: キャリブレーションがまだなら起動時に出す
export const welcomeModal = document.getElementById("welcome-modal");

export const voicevoxUrlInput = document.getElementById("voicevox-url-input");
export const voicevoxFetchBtn = document.getElementById("voicevox-fetch-btn");
export const voicevoxStatus = document.getElementById("voicevox-status");
export const sapiSection = document.getElementById("sapi-section");
export const sapiFetchBtn = document.getElementById("sapi-fetch-btn");
export const sapiStatus = document.getElementById("sapi-status");
export const ttsCreditNote = document.getElementById("tts-credit-note");
export const audioTransferResult = document.getElementById("audio-cache-transfer-result");

export const audioCacheImportInput = document.getElementById("audio-cache-import-input");

// 設定画面の未保存の値 (API Key / モデル / 話者 / 口調) でキャッシュを使わず即時発話する（音声タブの「試聴」）
export const ttsPreviewStatus = document.getElementById("tts-preview-status");
