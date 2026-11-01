// 設定画面: 任意パネルを作る・消す
import {
    simpleConfirmSoundInput, simpleCustomEmojiInput, simpleCustomImageInput, simpleCustomImagePreview,
    simpleCustomNameInput, simpleCustomSentenceInput, simpleGridSizeSelect, simpleShowRestInput
} from "../core/dom.js";
import {
    SIMPLE_CONFIG_KEY, SIMPLE_CUSTOM_PANELS_KEY, SIMPLE_GRID_SIZES, SIMPLE_GROUP_BASE,
    SIMPLE_GROUP_CUSTOM, panelStore
} from "./catalog.js";
import { panelScreen } from "./screen.js";
import {
    forgetDeletedPanel, getAnswerEditQuestion, getDraftAnswerKeys, moveQuestionAnswer,
    renderQuestionEditor, renderQuestionPanelPicker
} from "../question/editor.js";

const CUSTOM_IMAGE_MAX_PX = 256;

// ---------------------------------------------------------
// 設定画面: 任意パネル（質問の答えに使う）・休憩・確定音・お話モードのパネルの数
// ---------------------------------------------------------
export let simpleCustomDraft = [];   // 保存前の任意パネル

export function getSimplePanelGroup(item) {
    if (item.custom) return SIMPLE_GROUP_CUSTOM;
    return item.group || SIMPLE_GROUP_BASE;
}

export function openSimplePanelEditor() {
    simpleCustomDraft = panelStore.simpleCustomPanels.map(p => ({ ...p }));
    if (simpleGridSizeSelect) simpleGridSizeSelect.value = panelStore.simpleConfig.gridSize;
    if (simpleShowRestInput) simpleShowRestInput.checked = panelStore.simpleConfig.showRest;
    if (simpleConfirmSoundInput) simpleConfirmSoundInput.checked = panelStore.simpleConfig.confirmSound;
    resetSimpleCustomForm();
}

let simpleCustomImageData = "";

function resetSimpleCustomForm() {
    simpleCustomImageData = "";
    if (simpleCustomNameInput) simpleCustomNameInput.value = "";
    if (simpleCustomSentenceInput) simpleCustomSentenceInput.value = "";
    if (simpleCustomEmojiInput) simpleCustomEmojiInput.value = "";
    if (simpleCustomImageInput) simpleCustomImageInput.value = "";
    if (simpleCustomImagePreview) {
        simpleCustomImagePreview.removeAttribute("src");
        simpleCustomImagePreview.style.display = "none";
    }
}

// localStorage を圧迫しないよう、画像は縮小してから保存する
function readImageAsResizedDataUrl(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, CUSTOM_IMAGE_MAX_PX / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL("image/webp", 0.85));
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("画像を読み込めませんでした"));
        };
        img.src = url;
    });
}

export function addSimpleCustomPanel() {
    const name = simpleCustomNameInput?.value.trim() || "";
    if (!name) {
        alert("表示名を入力してください。");
        return;
    }
    const sentence = simpleCustomSentenceInput?.value.trim() || "";
    const emoji = simpleCustomEmojiInput?.value.trim() || "";
    const panel = {
        id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        sentence: sentence || `${name}。`
    };
    if (simpleCustomImageData) panel.image = simpleCustomImageData;
    else if (emoji) panel.emoji = emoji;

    simpleCustomDraft.push(panel);
    resetSimpleCustomForm();
    renderQuestionPanelPicker();
    // 作ったパネルは、編集中の質問の答えの最後に入れる
    const q = getAnswerEditQuestion();
    if (q) moveQuestionAnswer(panel.id, getDraftAnswerKeys(q).length);
    else renderQuestionEditor();
}

export function deleteSimpleCustomPanel(id) {
    simpleCustomDraft = simpleCustomDraft.filter(p => p.id !== id);
    forgetDeletedPanel(id);
}

// 保存に失敗したら false（画像が多すぎて容量超過など）
export function saveSimplePanelEditor() {
    const nextConfig = {
        gridSize: SIMPLE_GRID_SIZES[simpleGridSizeSelect?.value] ? simpleGridSizeSelect.value : panelStore.simpleConfig.gridSize,
        showRest: simpleShowRestInput ? simpleShowRestInput.checked : panelStore.simpleConfig.showRest,
        confirmSound: simpleConfirmSoundInput ? simpleConfirmSoundInput.checked : panelStore.simpleConfig.confirmSound
    };
    try {
        localStorage.setItem(SIMPLE_CUSTOM_PANELS_KEY, JSON.stringify(simpleCustomDraft));
        localStorage.setItem(SIMPLE_CONFIG_KEY, JSON.stringify(nextConfig));
    } catch (error) {
        console.error("simple panel save failed:", error);
        alert("パネル設定を保存できませんでした。画像付きの任意パネルを減らしてください。");
        return false;
    }
    panelStore.simpleCustomPanels = simpleCustomDraft.map(p => ({ ...p }));
    panelStore.simpleConfig = nextConfig;
    // 休憩パネルを消したときに休憩中のまま戻れなくならないようにする
    if (!panelStore.simpleConfig.showRest) panelScreen.isSimplePaused = false;
    return true;
}

export function initCustomPanelEditor() {
    if (simpleCustomImageInput) {
        simpleCustomImageInput.addEventListener("change", async () => {
            const file = simpleCustomImageInput.files?.[0];
            simpleCustomImageData = "";
            if (simpleCustomImagePreview) simpleCustomImagePreview.style.display = "none";
            if (!file) return;
            try {
                simpleCustomImageData = await readImageAsResizedDataUrl(file);
                if (simpleCustomImagePreview) {
                    simpleCustomImagePreview.src = simpleCustomImageData;
                    simpleCustomImagePreview.style.display = "";
                }
            } catch (error) {
                alert(error.message);
                simpleCustomImageInput.value = "";
            }
        });
    }
}
