// 操作モード（質問モード / お話モード）と、回答中の質問

// 操作モード
// 質問モード（既定）: 上に並べた質問を介助者がマウスで切り替え、本人が回答パネルで答える。答えても質問モードのまま
// お話モード: 会話を選んでいく
export const APP_MODE_KEY = "app_mode";
const APP_MODE_TALK = "talk";
export const APP_MODE_QUESTION = "question";
export const APP_MODES = [APP_MODE_QUESTION, APP_MODE_TALK];
// 旧「文づくりモード」はお話モードに、廃止した症状モード・シンプルモードは質問モードに置き換えた
const APP_MODE_LEGACY = { compose: APP_MODE_TALK, symptom: APP_MODE_QUESTION, simple: APP_MODE_QUESTION };
function loadAppMode() {
    const stored = localStorage.getItem(APP_MODE_KEY);
    const mode = APP_MODE_LEGACY[stored] || stored;
    return APP_MODES.includes(mode) ? mode : APP_MODE_QUESTION;
}

// 他のモジュールからも読み書きする状態
export const appState = {
    appMode: loadAppMode(),
    // 介助者が出した質問への回答中
    activeQuestion: null
};

export function isTalkScreen() {
    return appState.appMode === APP_MODE_TALK && appState.activeQuestion === null;
}

export function isQuestionMode() {
    return appState.appMode === APP_MODE_QUESTION;
}

// 設定画面（と初回の案内）を開いている間は、確定・発話などの機能を止める
export function isSettingsOpen() {
    return document.querySelector(".modal.active") !== null;
}
