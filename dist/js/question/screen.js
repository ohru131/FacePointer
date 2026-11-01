// 質問モードの画面（上の質問バー・質問の切り替え）
import { questionButtonsContainer, questionEndBtn, questionModeBar } from "../core/dom.js";
import { appState, isQuestionMode } from "../core/app-state.js";
import { centerPointerOnSimpleGrid } from "../pointer/tracking.js";
import { dismissConfirmOverlay, isConfirmInProgress } from "../panels/confirm.js";
import { lockUntilPointerLeaves } from "../panels/selection.js";
import {
    QUESTION_MODE_LAST_KEY, QUESTION_TIMEOUT_MS, createQuestionIcon, getQuestionAnswers,
    getQuestionCatalog, getQuestionLabel, getVisibleQuestions, questionStore
} from "./model.js";
import { panelScreen, renderAll } from "../panels/screen.js";
import { speak } from "../speech/speak.js";
import { cancelPendingClick } from "../face/gesture.js";
import { saveSettingsAndClose } from "../settings/settings-modal.js";

let activeQuestionStartedAt = 0;

let pageBeforeQuestion = 0;

// 質問モードで、出す質問の中から回答中の質問を決める（前回の質問 → 先頭の質問）。出す質問が無ければ空の画面
export function ensureQuestionModeQuestion({ speak: shouldSpeak = false } = {}) {
    if (!isQuestionMode()) return;
    const visible = getVisibleQuestions();
    if (appState.activeQuestion && visible.some(q => q.id === appState.activeQuestion.id)) return;
    const lastId = localStorage.getItem(QUESTION_MODE_LAST_KEY);
    const next = visible.find(q => q.id === lastId) ?? visible[0];
    if (next) {
        startQuestion(next.id, { speak: shouldSpeak });
    } else if (appState.activeQuestion) {
        appState.activeQuestion = null;
        renderAll();
    }
}

// 質問モードの上のボタン。回答の確定表示中でも待たせず、表示を閉じてから切り替える
function selectQuestionFromBar(questionId) {
    if (!isConfirmInProgress) {
        startQuestion(questionId);
        return;
    }
    dismissConfirmOverlay();
    // 確定表示の後始末（isConfirmInProgress の解除）が済んでから切り替える
    setTimeout(() => startQuestion(questionId), 0);
}

// 質問のボタンは会話で並びも中身も変わらない（介助者が場所で覚えられるよう固定。押した質問だけ色が変わる）
export function renderQuestionModeBar() {
    if (!questionModeBar) return;
    questionModeBar.innerHTML = "";
    if (!isQuestionMode()) {
        questionModeBar.style.display = "none";
        return;
    }
    questionModeBar.style.display = "";
    getVisibleQuestions().forEach((q) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "question-mode-btn" + (appState.activeQuestion?.id === q.id ? " active" : "");
        const label = document.createElement("span");
        label.className = "question-mode-label";
        label.textContent = getQuestionLabel(q);
        btn.append(createQuestionIcon(q, "question-mode-icon", { emojiClass: "question-mode-icon" }), label);
        btn.title = appState.activeQuestion?.id === q.id && !q.silent ? `${q.question}（押すともう一度読み上げ）` : q.question;
        btn.addEventListener("click", () => selectQuestionFromBar(q.id));
        questionModeBar.appendChild(btn);
    });
}

export function startQuestion(questionId, { speak: shouldSpeak = true } = {}) {
    const question = getQuestionCatalog().find(q => q.id === questionId);
    if (!question || isConfirmInProgress) return;
    if (isQuestionMode()) {
        try {
            localStorage.setItem(QUESTION_MODE_LAST_KEY, question.id);
        } catch (error) {
            console.warn("question mode last id save failed:", error);
        }
    }
    // 切り替える前の画面で予約された口のクリックは実行しない（同じ質問を出し直すと回答 id が同じで、古いパネルが確定してしまう）
    cancelPendingClick();

    if (!appState.activeQuestion) pageBeforeQuestion = panelScreen.simplePage;
    // 回答 id は質問ごとに振り直す（パネルの元の id は panelId に残る）
    appState.activeQuestion = {
        ...question,
        // 画面の id は並び順の番号。生成アイコンの id（${質問}-a${元の番号}）と重ならないよう別の形にする
        answers: getQuestionAnswers(question).map((answer, i) => ({ ...answer, id: `${question.id}-ans${i}` }))
    };
    activeQuestionStartedAt = Date.now();
    panelScreen.isSimplePaused = false;
    panelScreen.simplePage = 0;
    // 質問が出た瞬間にポインタの下の回答を選ばないよう、一度動くまで滞留しない
    lockUntilPointerLeaves();
    renderAll();
    centerPointerOnSimpleGrid();
    renderQuestionButtons();

    if (shouldSpeak && questionStore.questionConfig.speakQuestion && !question.silent) void speak(question.question);
}

export function endQuestion() {
    // 回答の確認表示中は閉じない（表示が消えた後に handleSimpleClick が閉じる）
    if (!appState.activeQuestion || isConfirmInProgress) return;
    // 質問モードは質問を閉じない（切り替えだけ）
    if (isQuestionMode()) return;

    appState.activeQuestion = null;
    panelScreen.simplePage = pageBeforeQuestion;
    lockUntilPointerLeaves();
    renderAll();
    centerPointerOnSimpleGrid();
    renderQuestionButtons();
}

// 操作モードを切り替えたとき: 質問は終え、前の答えの表示も消す（終了後に古いページへ戻らないようにする）
export function resetQuestionScreen() {
    appState.activeQuestion = null;
    questionStore.lastQuestionAnswer = null;
    pageBeforeQuestion = 0;
}

export function checkQuestionTimeout() {
    if (!appState.activeQuestion || isConfirmInProgress || isQuestionMode()) return;
    if (Date.now() - activeQuestionStartedAt >= QUESTION_TIMEOUT_MS) endQuestion();
}

// 設定 → 質問モード の「今すぐ質問する」ボタン
export function renderQuestionButtons() {
    if (!questionButtonsContainer) return;

    questionButtonsContainer.innerHTML = "";
    const visible = getVisibleQuestions();
    visible.forEach((q) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "question-btn" + (appState.activeQuestion?.id === q.id ? " active" : "");
        btn.append(createQuestionIcon(q, "question-inline-icon"), ` ${getQuestionLabel(q)}`);
        btn.title = q.question;
        btn.addEventListener("click", () => {
            // 設定で変えた内容も保存してから、利用者が回答画面を見られるよう閉じる
            if (!saveSettingsAndClose()) return;
            if (appState.activeQuestion?.id === q.id && !isQuestionMode()) {
                endQuestion();
                return;
            }
            // 質問モードは上のボタンと同じ（回答中の質問なら読み上げ直す）
            if (isQuestionMode()) selectQuestionFromBar(q.id);
            else startQuestion(q.id);
        });
        questionButtonsContainer.appendChild(btn);
    });
    if (visible.length === 0) {
        const note = document.createElement("p");
        note.className = "settings-help";
        note.textContent = "表示する質問がありません（設定 → 質問モード）";
        questionButtonsContainer.appendChild(note);
    }
    if (questionEndBtn) questionEndBtn.style.display = appState.activeQuestion && !isQuestionMode() ? "" : "none";
    // 質問モードは画面の上に同じ質問が並ぶので出さない
    const questionSection = document.getElementById("question-now-section");
    if (questionSection) questionSection.style.display = isQuestionMode() ? "none" : "";
}

export function initQuestionScreen() {
    renderQuestionButtons();
}
