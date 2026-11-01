// 起動処理
import { isQuestionMode } from "./core/app-state.js";
import { initPanelButton } from "./panels/panel-button.js";
import { ensureQuestionModeQuestion, initQuestionScreen } from "./question/screen.js";
import { renderAll } from "./panels/screen.js";
import { initDB, mergeAudioCacheKeys } from "./speech/audio-cache.js";
import { initSpeak } from "./speech/speak.js";
import { initClickDebug } from "./face/click-debug.js";
import { setupMediaPipe } from "./face/face-loop.js";
import { initCustomPanelEditor } from "./panels/custom-panel-editor.js";
import { initTalkEditor } from "./talk/editor.js";
import { initQuestionEditor } from "./question/editor.js";
import { initWelcome } from "./settings/welcome.js";
import { initPointerSettings } from "./settings/pointer-settings.js";
import { initVoiceSettings } from "./settings/voice-settings.js";
import { initSettingsModal } from "./settings/settings-modal.js";
import { initQuickActions } from "./ui/quick-actions.js";

// 画面の部品のイベントを登録する（元の app.js での順）
initPanelButton();
initSpeak();
initClickDebug();
initQuickActions();
initVoiceSettings();
initSettingsModal();
initWelcome();
initPointerSettings();
initQuestionEditor();
initQuestionScreen();
initTalkEditor();
initCustomPanelEditor();

(async () => {
    await initDB();
    await mergeAudioCacheKeys();
    if (isQuestionMode()) ensureQuestionModeQuestion();
    renderAll();
    await setupMediaPipe();
})();
