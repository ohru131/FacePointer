// パネルの画面を描き、パネル・操作ボタンを選んだときの処理をする
import {
    appRoot, simpleBarContainer, simpleGridContainer, simpleMessageContainer, simpleSideNext,
    simpleSidePrev
} from "../core/dom.js";
import { clamp } from "../core/math.js";
import {
    APP_MODES, APP_MODE_KEY, APP_MODE_QUESTION, appState, isQuestionMode, isTalkScreen
} from "../core/app-state.js";
import { getGeneratedIcon } from "../ui/icons.js";
import { centerPointerOnSimpleGrid, resetPointerMotionHistory } from "../pointer/tracking.js";
import { buildSimpleSentence, panelStore } from "./catalog.js";
import { getSimpleLayout } from "./layout.js";
import { createSimpleButton, refitAllButtonText } from "./panel-button.js";
import { isConfirmInProgress, speakSimpleSentence } from "./confirm.js";
import { playConfirmSound } from "./sound.js";
import {
    checkPointerCollision, getSimpleRowKey, lockSimpleKeyAfterConfirm, lockUntilPointerLeaves
} from "./selection.js";
import {
    TALK_TAB_AIZUCHI, TALK_TAB_FAVORITE, TALK_TAB_PARTNER, TALK_TAB_PREFIX, TALK_TAB_TREE,
    getTalkCurrentSentence, getTalkPartner, resetTalkNavigation, talkState
} from "../talk/model.js";
import { goToTalkTab, handleTalkPanel, refreshTalkScreen, renderTalkTabs } from "../talk/screen.js";
import { createQuestionIcon, getShownQuestionAnswer, recordQuestionAnswer } from "../question/model.js";
import {
    endQuestion, ensureQuestionModeQuestion, renderQuestionButtons, renderQuestionModeBar,
    resetQuestionScreen
} from "../question/screen.js";

export const SIMPLE_ROW_ID = "s";
// 次へと右上の ⛶ ⚙ ◎ の列とのすき間
const QUICK_ACTIONS_CLEAR_GAP_PX = 8;

export function renderAll() {
    renderSimpleMode();
}
const SIMPLE_CTRL_PREV = "ctrl-prev";
const SIMPLE_CTRL_NEXT = "ctrl-next";
export const SIMPLE_CTRL_REST = "ctrl-rest";
const SIMPLE_CTRL_CANCEL = "ctrl-cancel";
const SIMPLE_CTRL_BACKSPACE = "ctrl-backspace";
const SIMPLE_CTRL_CLEAR = "ctrl-clear";

// 他のモジュールからも読み書きする状態
export const panelScreen = {
    simplePage: 0,
    isSimplePaused: false
};

function renderSimpleMessage() {
    if (!simpleMessageContainer) return;
    simpleMessageContainer.innerHTML = "";
    simpleMessageContainer.classList.remove("is-question", "is-talk");

    if (appState.activeQuestion) {
        simpleMessageContainer.classList.add("is-question");
        simpleMessageContainer.style.display = "";
        const text = document.createElement("div");
        text.className = "simple-message-question";
        text.append(createQuestionIcon(appState.activeQuestion, "simple-message-question-icon"), ` ${appState.activeQuestion.question}`);
        simpleMessageContainer.appendChild(text);
        // 質問モード: 直前の答えを右に出す（この質問への答えは強調、前の質問への答えは控えめに）
        const shown = isQuestionMode() ? getShownQuestionAnswer() : null;
        if (shown) {
            const answer = document.createElement("div");
            answer.className = "simple-message-answer" + (shown.isCurrent ? " is-current" : "");
            answer.textContent = `${shown.isCurrent ? "💬" : "前の答え:"} ${shown.sentence}`;
            simpleMessageContainer.appendChild(answer);
        }
        return;
    }

    if (!isTalkScreen()) {
        simpleMessageContainer.style.display = "none";
        return;
    }

    simpleMessageContainer.classList.add("is-talk");
    simpleMessageContainer.style.display = "";
    const partner = getTalkPartner();
    const chips = document.createElement("div");
    chips.className = "simple-message-chips";
    const addChip = (label, extraClass = "") => {
        const chip = document.createElement("span");
        chip.className = `simple-message-chip ${extraClass}`.trim();
        chip.textContent = label;
        chips.appendChild(chip);
    };
    if (partner) addChip(`${partner.emoji} ${partner.name}と`, "simple-message-chip--partner");
    const preview = document.createElement("div");
    preview.className = "simple-message-preview";
    if (talkState.talkTab === TALK_TAB_TREE) {
        talkState.talkPath.forEach(node => addChip(`${node.emoji || ""} ${node.label}`.trim()));
        const sentence = getTalkCurrentSentence();
        preview.textContent = sentence ? `🔊 ${sentence}`
            : talkState.talkPath.length === 0 ? "話したいことを選んでください（どの段でも「これで話す」で話せます）"
            : "続きを選んでください";
    } else {
        preview.textContent = {
            [TALK_TAB_AIZUCHI]: "相手の話に、ひとことで返します",
            [TALK_TAB_FAVORITE]: "よく話す文を、そのまま話します",
            [TALK_TAB_PARTNER]: "だれと話していますか？（呼びかけに名前が入ります）"
        }[talkState.talkTab] || "";
    }
    if (!/^🔊/.test(preview.textContent)) preview.classList.add("is-placeholder");
    const body = document.createElement("div");
    body.className = "simple-message-body";
    if (chips.childElementCount > 0) body.appendChild(chips);
    body.appendChild(preview);
    simpleMessageContainer.appendChild(body);
}

function appendSimpleControl(control, label, extraClass = "", disabled = false, container = simpleBarContainer) {
    const btn = createSimpleButton(control, label, {
        className: `simple-ctrl ${extraClass}${disabled ? " is-disabled" : ""}`.trim(),
        onClick: () => handleSimpleControl(control)
    });
    container.appendChild(btn);
}

function renderSimpleMode() {
    if (appRoot) {
        appRoot.dataset.simplePaused = panelScreen.isSimplePaused ? "1" : "0";
        appRoot.dataset.question = appState.activeQuestion ? "1" : "0";
        appRoot.dataset.talk = isTalkScreen() ? "1" : "0";
        // 質問モード: 上の質問ボタンを右上の ⛶ ⚙ ◎ と同じ高さにそろえる
        appRoot.dataset.questionMode = isQuestionMode() ? "1" : "0";
    }

    if (!simpleGridContainer || !simpleBarContainer) return;

    renderQuestionModeBar();
    renderSimpleMessage();
    renderTalkTabs();

    const { cols, rows, panels } = getSimpleLayout();
    const pageSize = cols * rows;
    const pageCount = Math.max(1, Math.ceil(panels.length / pageSize));
    panelScreen.simplePage = clamp(panelScreen.simplePage, 0, pageCount - 1);

    simpleGridContainer.innerHTML = "";
    simpleGridContainer.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    simpleGridContainer.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    simpleGridContainer.dataset.cols = String(cols);

    const pagePanels = panels.slice(panelScreen.simplePage * pageSize, (panelScreen.simplePage + 1) * pageSize);
    pagePanels.forEach((item) => {
        simpleGridContainer.appendChild(createSimpleButton(item.id, item.name, {
            icon: item.icon,
            emoji: item.emoji,
            // 質問の答えは id が振り直されているので、元のパネル・元の答えの生成アイコンを引く
            image: item.image || (item.iconId ? getGeneratedIcon(item.iconId, item.icon) : ""),
            className: item.type ? `talk-panel talk-panel--${item.type}${item.selected ? " is-selected" : ""}` : "",
            onClick: () => (isTalkScreen() ? handleTalkPanel(item) : handleSimpleClick(item))
        }));
    });
    // 最終ページの空きは枠だけ置いて、パネルの大きさと位置をページ間で揃える
    for (let i = pagePanels.length; i < pageSize; i++) {
        const empty = document.createElement("div");
        empty.className = "h-btn h-btn--empty";
        simpleGridContainer.appendChild(empty);
    }

    simpleBarContainer.innerHTML = "";
    // 前へ・次へは、パネルの左端・右端に縦長で置く（下のバーは休憩・戻るなど）
    const sidePaging = pageCount > 1 && simpleSidePrev && simpleSideNext;
    [simpleSidePrev, simpleSideNext].forEach((el) => {
        if (!el) return;
        el.innerHTML = "";
        el.style.display = sidePaging ? "" : "none";
    });
    if (sidePaging) {
        // 休憩中はページも送らない（押しても滞留しても動かない。見た目も無効にする）
        appendSimpleControl(SIMPLE_CTRL_PREV, "◀\n前へ", "simple-ctrl--side", panelScreen.isSimplePaused, simpleSidePrev);
        appendSimpleControl(SIMPLE_CTRL_NEXT, "次へ\n▶", "simple-ctrl--side", panelScreen.isSimplePaused, simpleSideNext);
        const pageLabel = document.createElement("div");
        pageLabel.className = "simple-page-label simple-page-label--side";
        pageLabel.textContent = `${panelScreen.simplePage + 1}/${pageCount}`;
        simpleSideNext.insertBefore(pageLabel, simpleSideNext.firstChild);
    }
    if (appState.activeQuestion && !isQuestionMode()) {
        appendSimpleControl(SIMPLE_CTRL_CANCEL, "✕ やめる", "simple-ctrl--cancel");
    } else {
        if (isTalkScreen() && talkState.talkTab === TALK_TAB_TREE) {
            const isTop = talkState.talkPath.length === 0;
            appendSimpleControl(SIMPLE_CTRL_BACKSPACE, "◀ 戻る", "", isTop);
            appendSimpleControl(SIMPLE_CTRL_CLEAR, "🏠 最初から", "", isTop);
        }
        // 質問モードは続けて答えるので休憩も出す（出す質問が無ければ出さない）
        if (panelStore.simpleConfig.showRest && (!isQuestionMode() || appState.activeQuestion)) {
            appendSimpleControl(SIMPLE_CTRL_REST, panelScreen.isSimplePaused ? "▶️ 再開" : "⏸️ 休憩", "simple-ctrl--rest");
        }
    }
    simpleBarContainer.style.display = simpleBarContainer.childElementCount > 0 ? "" : "none";

    if (panels.length === 0) {
        const notice = document.createElement("div");
        notice.className = "simple-empty-notice";
        notice.textContent = isQuestionMode() && !appState.activeQuestion
            ? "出す質問がありません（設定 → 質問モードで選択）"
            : appState.activeQuestion
            ? "答えがありません（設定 → 質問モード →「答えのパネル」で追加）"
            : talkState.talkTab === TALK_TAB_FAVORITE ? "まだ話した文がありません（話すとここに出ます）" : "表示する言葉がありません（設定 → お話モードで選択）";
        simpleGridContainer.appendChild(notice);
    }

    refitAllButtonText();
    updateSideNextClearance();
}

// 次へは右上の ⛶ ⚙ ◎ の列の下まで寄せているので、列と重なる高さだけ上を空ける
export function updateSideNextClearance() {
    const actions = document.getElementById("quick-actions");
    if (!simpleSideNext || !actions || simpleSideNext.style.display === "none") return;
    const actionsRect = actions.getBoundingClientRect();
    // 設定・キャリブレーション中は列を隠しているので測れない（前の値のまま。閉じたときに測り直す）
    if (actionsRect.height <= 0) return;
    simpleSideNext.style.removeProperty("--side-next-clear");
    const overlap = actionsRect.bottom + QUICK_ACTIONS_CLEAR_GAP_PX - simpleSideNext.getBoundingClientRect().top;
    if (overlap > 0) simpleSideNext.style.setProperty("--side-next-clear", `${Math.ceil(overlap)}px`);
}

// パネル・ボタンを描画し直したあと、ホバー表示を付け直す
export function rerenderSimpleMode() {
    renderSimpleMode();
    checkPointerCollision();
}

async function handleSimpleClick(item) {
    if (isConfirmInProgress || panelScreen.isSimplePaused) return;

    const sentence = buildSimpleSentence(item);
    if (!sentence) return;

    lockSimpleKeyAfterConfirm(getSimpleRowKey(item.id));

    const answeredQuestionId = appState.activeQuestion?.id ?? null;
    // 質問モード: 質問文の横に答えを出す（上のボタンは変えない）
    if (isQuestionMode() && appState.activeQuestion) {
        recordQuestionAnswer(item);
        renderSimpleMessage();
    }
    await speakSimpleSentence(sentence);
    // 質問モードは答えても同じ質問のまま（次の質問は介助者が上のボタンで選ぶ）。
    // 話し終えた時点でポインタの下にあるパネルは、一度離れるまで選ばない（動かさずにいると同じ答えを繰り返すため）
    if (isQuestionMode()) {
        if (appState.activeQuestion?.id === answeredQuestionId) lockUntilPointerLeaves();
        return;
    }
    // 発話中に別の質問へ切り替わっていたら、そちらは閉じない
    if (answeredQuestionId && appState.activeQuestion?.id === answeredQuestionId) endQuestion();
}

function isSimpleControlDisabled(control) {
    const needsPath = [SIMPLE_CTRL_BACKSPACE, SIMPLE_CTRL_CLEAR].includes(control);
    return needsPath && talkState.talkPath.length === 0;
}

export function handleSimpleControl(control) {
    if (isConfirmInProgress) return;
    if (panelScreen.isSimplePaused && control !== SIMPLE_CTRL_REST) return;
    if (isSimpleControlDisabled(control)) return;

    lockSimpleKeyAfterConfirm(getSimpleRowKey(control));

    if (control === SIMPLE_CTRL_CANCEL) {
        playConfirmSound();
        endQuestion();
        return;
    }
    if (control.startsWith(TALK_TAB_PREFIX)) {
        goToTalkTab(control.slice(TALK_TAB_PREFIX.length));
    } else if (control === SIMPLE_CTRL_REST) {
        panelScreen.isSimplePaused = !panelScreen.isSimplePaused;
    } else if (control === SIMPLE_CTRL_BACKSPACE) {
        talkState.talkPath.pop();
        refreshTalkScreen();
    } else if (control === SIMPLE_CTRL_CLEAR) {
        talkState.talkPath = [];
        refreshTalkScreen();
    } else {
        const { cols, rows, panels } = getSimpleLayout();
        const pageCount = Math.max(1, Math.ceil(panels.length / (cols * rows)));
        // 端から押したら反対側へ回り込む
        const step = control === SIMPLE_CTRL_NEXT ? 1 : -1;
        panelScreen.simplePage = (panelScreen.simplePage + step + pageCount) % pageCount;
    }

    playConfirmSound();
    rerenderSimpleMode();
}

export function setAppMode(mode) {
    const nextMode = APP_MODES.includes(mode) ? mode : APP_MODE_QUESTION;
    if (nextMode === appState.appMode) return;

    appState.appMode = nextMode;
    localStorage.setItem(APP_MODE_KEY, appState.appMode);
    lockUntilPointerLeaves();
    panelScreen.isSimplePaused = false;
    panelScreen.simplePage = 0;
    resetTalkNavigation();
    // 質問中に切り替えたら質問は終える
    resetQuestionScreen();
    resetPointerMotionHistory();
    renderAll();
    if (isQuestionMode()) ensureQuestionModeQuestion({ speak: true });
    renderQuestionButtons();

    // グリッド中央へ乗せ直す
    centerPointerOnSimpleGrid();
}
