// 設定画面: 質問モードのタブ（出す質問・答えのパネル・質問を追加）
import {
    questionAnswerDetail, questionAnswerFilter, questionAnswerPagesContainer, questionAnswerPalette,
    questionAnswerSelect, questionAnswerSummary, questionCustomAnswersInput, questionCustomEmojiInput,
    questionCustomLabelInput, questionCustomTextInput, questionEditorList, questionEndBtn,
    questionGridSizeSelect, questionPanelPickClearBtn, questionPanelPickSummary, questionPanelPicker,
    questionSpeakInput, simpleCustomAddBtn
} from "../core/dom.js";
import { clamp } from "../core/math.js";
import { appState, isQuestionMode } from "../core/app-state.js";
import { SIMPLE_FILTER_ALL, buildSimpleSentence } from "../panels/catalog.js";
import { getQuestionGridSize } from "../panels/layout.js";
import {
    QUESTION_CONFIG_KEY, QUESTION_CUSTOM_KEY, QUESTION_DEFAULT_HIDDEN_IDS, QUESTION_PRESETS,
    getAnswerPanelCatalog, getDefaultQuestionAnswerKeys, getQuestionAnswerCandidates, getQuestionAnswers,
    getQuestionCatalog, getQuestionEmoji, getQuestionIcon, getQuestionLabel, getVisibleQuestions,
    questionStore
} from "./model.js";
import { endQuestion, ensureQuestionModeQuestion, renderQuestionButtons, startQuestion } from "./screen.js";
import { bindLayoutDrag, bindLayoutDrop, createLayoutThumb } from "../settings/layout-drag.js";
import {
    addSimpleCustomPanel, deleteSimpleCustomPanel, getSimplePanelGroup, simpleCustomDraft
} from "../panels/custom-panel-editor.js";
import { activateSettingsTab } from "../settings/settings-modal.js";

// 「絵文字 表示名=発話文」を1行1つで受け取る（絵文字・発話文は省略可）
function parseQuestionAnswers(text) {
    return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line) => {
        let emoji = "";
        // 絵文字（異体字セレクタ・肌色・ZWJ連結）、国旗、キーキャップ(1️⃣)を先頭の絵文字として扱う
        const match = line.match(/^((?:\p{Extended_Pictographic}[\u{FE0F}\u{1F3FB}-\u{1F3FF}]*(?:\u{200D}\p{Extended_Pictographic}[\u{FE0F}\u{1F3FB}-\u{1F3FF}]*)*)|\p{Regional_Indicator}{2}|[0-9#*]\u{FE0F}?\u{20E3})\s*(.*)$/u);
        if (match) {
            emoji = match[1];
            line = match[2];
        }
        const [rawName, ...rest] = line.split("=");
        const name = rawName.trim();
        const sentence = rest.join("=").trim();
        if (!name) return null;
        const answer = { name, sentence: sentence || `${name}。` };
        if (emoji) answer.emoji = emoji;
        return answer;
    }).filter(Boolean);
}

// ---------------------------------------------------------
// 設定画面: 質問テンプレート
// ---------------------------------------------------------
let questionHiddenDraft = new Set();
let questionCustomDraft = [];
let questionOrderDraft = [];  // 並び順（質問 id。画面の上のボタン・「今すぐ質問する」の順）

let questionPanelPickDraft = []; // 追加する質問の答えにする既存パネル（選んだ順）
let questionAnswerLayoutsDraft = {}; // 答えを編集した質問の答えの並び（質問 id → key）
let questionAnswerEditId = null;     // 「答えのパネル」で編集中の質問
let questionAnswerSelectedKey = null;
let questionAnswerPaletteFilter = SIMPLE_FILTER_ALL;
const QUESTION_ANSWER_GROUP_OWN = "この質問";

export function openQuestionEditor() {
    questionHiddenDraft = new Set(questionStore.questionConfig.hiddenIds);
    questionCustomDraft = questionStore.questionCustom.map(q => ({ ...q, answers: q.answers.map(a => ({ ...a })), panelIds: [...q.panelIds] }));
    questionOrderDraft = getQuestionCatalog(questionCustomDraft).map(q => q.id);
    questionPanelPickDraft = [];
    questionAnswerLayoutsDraft = Object.fromEntries(Object.entries(questionStore.questionConfig.answerLayouts).map(([id, keys]) => [id, [...keys]]));
    if (questionGridSizeSelect) questionGridSizeSelect.value = questionStore.questionConfig.gridSize;
    // 質問モードで出している質問の答えから編集を始める
    questionAnswerEditId = appState.activeQuestion?.id ?? null;
    questionAnswerSelectedKey = null;
    questionAnswerPaletteFilter = SIMPLE_FILTER_ALL;
    if (questionSpeakInput) questionSpeakInput.checked = questionStore.questionConfig.speakQuestion;
    if (questionCustomTextInput) questionCustomTextInput.value = "";
    if (questionCustomLabelInput) questionCustomLabelInput.value = "";
    if (questionCustomEmojiInput) questionCustomEmojiInput.value = "";
    if (questionCustomAnswersInput) questionCustomAnswersInput.value = "";
    renderQuestionEditor();
    renderQuestionPanelPicker();
}

// 一覧に出す答えの説明（パネルは編集中の任意パネルも含める）
function describeQuestionAnswers(q) {
    const edited = Boolean(questionAnswerLayoutsDraft[q.id]);
    const names = getDraftQuestionAnswers(q).map(a => `${a.emoji ? a.emoji + " " : ""}${a.name}`).join(" ／ ");
    if (edited) return `✏️ ${names || "（答えなし）"}`;
    return q.panelSource ? `🧩 パネル「${q.panelSource}」${q.panelIds?.length ? "ほか" : ""}: ${names}` : names;
}

// 編集中の内容（任意パネルも編集中のもの）での答え
function getDraftQuestionAnswerOptions() {
    return { customPanels: simpleCustomDraft, answerLayouts: questionAnswerLayoutsDraft };
}

function getDraftQuestionAnswers(q) {
    return getQuestionAnswers(q, getDraftQuestionAnswerOptions());
}

// 並び・出す質問を既定に戻す（作った質問は残して、おすすめの並びの後ろに置く）
function resetQuestionOrder() {
    questionOrderDraft = getQuestionCatalog(questionCustomDraft, []).map(q => q.id);
    const customIds = new Set(questionCustomDraft.map(q => q.id));
    questionHiddenDraft = new Set([...QUESTION_DEFAULT_HIDDEN_IDS, ...[...questionHiddenDraft].filter(id => customIds.has(id))]);
    // 旧バージョンで編集した答えの並び・パネル数もおすすめに戻す（作った質問の分は残す）
    questionAnswerLayoutsDraft = Object.fromEntries(Object.entries(questionAnswerLayoutsDraft).filter(([id]) => customIds.has(id)));
    renderQuestionEditor();
}

function moveQuestionInDraft(id, step) {
    const from = questionOrderDraft.indexOf(id);
    const to = from + step;
    if (from === -1 || to < 0 || to >= questionOrderDraft.length) return;
    questionOrderDraft.splice(from, 1);
    questionOrderDraft.splice(to, 0, id);
    renderQuestionEditor();
}

export function renderQuestionEditor() {
    if (!questionEditorList) return;
    questionEditorList.innerHTML = "";

    const ordered = getQuestionCatalog(questionCustomDraft, questionOrderDraft);
    ordered.forEach((q, index) => {
        const row = document.createElement("div");
        const isShown = !questionHiddenDraft.has(q.id);
        row.className = "simple-editor-row question-editor-row" + (isShown ? "" : " is-disabled");

        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = isShown;
        check.title = "質問モードと「今すぐ質問する」に出す";
        check.addEventListener("change", () => {
            if (check.checked) questionHiddenDraft.delete(q.id);
            else questionHiddenDraft.add(q.id);
            renderQuestionEditor();
        });
        row.appendChild(check);

        const text = document.createElement("div");
        text.className = "simple-editor-text";
        const title = document.createElement("strong");
        const iconSrc = getQuestionIcon(q);
        if (iconSrc) {
            const img = document.createElement("img");
            img.className = "question-editor-icon";
            img.src = iconSrc;
            img.alt = "";
            title.appendChild(img);
            title.append(` ${q.question}`);
        } else {
            title.textContent = `${getQuestionEmoji(q)} ${q.question}`;
        }
        if (q.custom) {
            const badge = document.createElement("span");
            badge.className = "simple-editor-group";
            badge.textContent = "任意";
            title.appendChild(badge);
        }
        const answers = document.createElement("small");
        answers.textContent = describeQuestionAnswers(q);
        text.append(title, answers);
        row.appendChild(text);

        const actions = document.createElement("div");
        actions.className = "simple-editor-actions";
        const addAction = (label, title, disabled, onClick) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "ctrl-btn secondary";
            btn.textContent = label;
            btn.title = title;
            btn.disabled = disabled;
            btn.addEventListener("click", onClick);
            actions.appendChild(btn);
        };
        addAction("✏️ 答え", "答えのパネルをドラッグで編集", false, () => {
            questionAnswerEditId = q.id;
            questionAnswerSelectedKey = null;
            renderQuestionAnswerEditor();
            questionAnswerPagesContainer?.closest(".settings-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        addAction("▲", "前へ（先に聞く）", index === 0, () => moveQuestionInDraft(q.id, -1));
        addAction("▼", "後ろへ", index === ordered.length - 1, () => moveQuestionInDraft(q.id, 1));
        if (q.custom) {
            addAction("削除", "この質問を消す", false, () => {
                questionCustomDraft = questionCustomDraft.filter(c => c.id !== q.id);
                questionOrderDraft = questionOrderDraft.filter(id => id !== q.id);
                questionHiddenDraft.delete(q.id);
                delete questionAnswerLayoutsDraft[q.id];
                renderQuestionEditor();
            });
        }
        row.appendChild(actions);

        questionEditorList.appendChild(row);
    });
    renderQuestionAnswerEditor();
}

// ---------------------------------------------------------
// 設定画面: 質問の答えのパネル（ドラッグで並べ替え・追加・外す）
// ---------------------------------------------------------
export function getAnswerEditQuestion() {
    const catalog = getQuestionCatalog(questionCustomDraft, questionOrderDraft);
    return catalog.find(q => q.id === questionAnswerEditId) ?? catalog[0] ?? null;
}

export function getDraftAnswerKeys(q) {
    const candidates = getQuestionAnswerCandidates(q, simpleCustomDraft);
    const keys = questionAnswerLayoutsDraft[q.id]
        || getDefaultQuestionAnswerKeys(q, simpleCustomDraft);
    return [...new Set(keys)].filter(key => candidates.has(key));
}

// key を insertIndex の位置へ移す（未配置なら追加）。insertIndex は動かす前の並びでの位置
export function moveQuestionAnswer(key, insertIndex) {
    const q = getAnswerEditQuestion();
    if (!q || !getQuestionAnswerCandidates(q, simpleCustomDraft).has(key)) return;
    const keys = getDraftAnswerKeys(q);
    let target = clamp(insertIndex, 0, keys.length);
    const from = keys.indexOf(key);
    if (from !== -1) {
        // 同じ場所に落としただけなら何もしない（選択だけ移す）
        if (target === from || target === from + 1) {
            questionAnswerSelectedKey = key;
            renderQuestionAnswerEditor();
            return;
        }
        keys.splice(from, 1);
        if (from < target) target -= 1;
    }
    keys.splice(target, 0, key);
    questionAnswerLayoutsDraft[q.id] = keys;
    questionAnswerSelectedKey = key;
    renderQuestionEditor();
}

function removeQuestionAnswer(key) {
    const q = getAnswerEditQuestion();
    // 答えに入っていない候補を候補の一覧へ落としたときなどは何もしない
    if (!q || !getDraftAnswerKeys(q).includes(key)) return;
    questionAnswerLayoutsDraft[q.id] = getDraftAnswerKeys(q).filter(k => k !== key);
    if (questionAnswerSelectedKey === key) questionAnswerSelectedKey = null;
    renderQuestionEditor();
}

function resetQuestionAnswers() {
    const q = getAnswerEditQuestion();
    if (!q) return;
    delete questionAnswerLayoutsDraft[q.id];
    questionAnswerSelectedKey = null;
    renderQuestionEditor();
}

function clearQuestionAnswers() {
    const q = getAnswerEditQuestion();
    if (!q) return;
    questionAnswerLayoutsDraft[q.id] = [];
    questionAnswerSelectedKey = null;
    renderQuestionEditor();
}

function getQuestionAnswerGroup(item) {
    return item.panelId ? getSimplePanelGroup(item) : QUESTION_ANSWER_GROUP_OWN;
}

function renderQuestionAnswerEditor() {
    if (!questionAnswerPagesContainer) return;
    const q = getAnswerEditQuestion();
    questionAnswerEditId = q?.id ?? null;

    if (questionAnswerSelect) {
        questionAnswerSelect.innerHTML = "";
        getQuestionCatalog(questionCustomDraft, questionOrderDraft).forEach((item) => {
            const edited = questionAnswerLayoutsDraft[item.id] ? " ✏️" : "";
            questionAnswerSelect.add(new Option(`${getQuestionEmoji(item)} ${getQuestionLabel(item)}${edited}`, item.id));
        });
        if (q) questionAnswerSelect.value = q.id;
    }
    questionAnswerPagesContainer.innerHTML = "";
    if (!q) return;

    const candidates = getQuestionAnswerCandidates(q, simpleCustomDraft);
    const keys = getDraftAnswerKeys(q);
    if (!keys.includes(questionAnswerSelectedKey)) questionAnswerSelectedKey = null;
    const { cols, rows } = getQuestionGridSize(keys.length, questionGridSizeSelect?.value || questionStore.questionConfig.gridSize);
    const pageSize = cols * rows;
    const pageCount = Math.max(1, Math.ceil(keys.length / pageSize));
    if (questionAnswerSummary) {
        questionAnswerSummary.textContent = `${keys.length} 枚 ・ ${cols}×${rows} ・ ${pageCount} ページ${questionAnswerLayoutsDraft[q.id] ? " ・ 編集済み" : ""}`;
    }

    const aspect = `${window.innerWidth} / ${Math.round(window.innerHeight * 0.7)}`;
    for (let page = 0; page < pageCount; page++) {
        const pageEl = document.createElement("div");
        pageEl.className = "layout-page";
        const label = document.createElement("div");
        label.className = "layout-page-label";
        label.textContent = `${page + 1}ページ目`;
        pageEl.appendChild(label);

        const grid = document.createElement("div");
        grid.className = "layout-grid";
        grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
        grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
        grid.style.aspectRatio = aspect;
        for (let slot = 0; slot < pageSize; slot++) {
            const index = page * pageSize + slot;
            const key = keys[index];
            const item = key ? candidates.get(key) : null;
            if (!item) {
                const empty = document.createElement("div");
                empty.className = "layout-tile is-empty";
                bindLayoutDrop(empty, dragKey => moveQuestionAnswer(dragKey, keys.length));
                grid.appendChild(empty);
                continue;
            }
            const tile = document.createElement("div");
            tile.className = "layout-tile" + (key === questionAnswerSelectedKey ? " selected" : "");
            tile.title = `${item.name}（ドラッグで移動・左半分なら前／右半分なら後ろ。クリックで選択）`;
            tile.appendChild(createLayoutThumb(item));
            const name = document.createElement("div");
            name.className = "layout-tile-name";
            name.textContent = item.name;
            tile.appendChild(name);
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "layout-tile-remove";
            remove.title = "答えから外す";
            remove.textContent = "✕";
            remove.addEventListener("click", (e) => {
                e.stopPropagation();
                removeQuestionAnswer(key);
            });
            tile.appendChild(remove);
            tile.addEventListener("click", () => {
                questionAnswerSelectedKey = questionAnswerSelectedKey === key ? null : key;
                renderQuestionAnswerEditor();
            });
            bindLayoutDrag(tile, key);
            bindLayoutDrop(tile, (dragKey, after) => moveQuestionAnswer(dragKey, index + (after ? 1 : 0)), { sided: true });
            grid.appendChild(tile);
        }
        pageEl.appendChild(grid);
        questionAnswerPagesContainer.appendChild(pageEl);
    }

    // 枚数に合わせてマスが増えるので、空きマスが無くても最後へ足せる受け口を置く
    const dropzone = document.createElement("div");
    dropzone.className = "question-answer-dropzone";
    dropzone.textContent = "＋ ここへドロップすると最後に追加";
    bindLayoutDrop(dropzone, dragKey => moveQuestionAnswer(dragKey, keys.length));
    questionAnswerPagesContainer.appendChild(dropzone);

    renderQuestionAnswerDetail(candidates, keys);
    renderQuestionAnswerPalette(candidates, keys);
}

function renderQuestionAnswerDetail(candidates, keys) {
    if (!questionAnswerDetail) return;
    questionAnswerDetail.innerHTML = "";
    const key = questionAnswerSelectedKey;
    const item = key ? candidates.get(key) : null;
    const index = key ? keys.indexOf(key) : -1;
    if (!item || index === -1) {
        questionAnswerDetail.classList.add("is-empty");
        questionAnswerDetail.textContent = "タイルをクリックすると、ここで1つずつ動かせます。";
        return;
    }
    questionAnswerDetail.classList.remove("is-empty");
    questionAnswerDetail.appendChild(createLayoutThumb(item, "simple-editor-thumb"));

    const text = document.createElement("div");
    text.className = "simple-editor-text";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const badge = document.createElement("span");
    badge.className = "simple-editor-group";
    badge.textContent = getQuestionAnswerGroup(item);
    name.appendChild(badge);
    const info = document.createElement("small");
    info.textContent = `${index + 1}番目 ／ 「${buildSimpleSentence(item)}」`;
    text.append(name, info);
    questionAnswerDetail.appendChild(text);

    const actions = document.createElement("div");
    actions.className = "simple-editor-actions";
    const addAction = (label, title, disabled, handler) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ctrl-btn secondary";
        btn.textContent = label;
        btn.title = title;
        btn.disabled = disabled;
        btn.addEventListener("click", handler);
        actions.appendChild(btn);
    };
    const last = keys.length - 1;
    addAction("⏮", "先頭へ", index === 0, () => moveQuestionAnswer(key, 0));
    addAction("◀", "1つ前へ", index === 0, () => moveQuestionAnswer(key, index - 1));
    addAction("▶", "1つ後ろへ", index === last, () => moveQuestionAnswer(key, index + 2));
    addAction("⏭", "最後へ", index === last, () => moveQuestionAnswer(key, keys.length));
    addAction("外す", "答えから外す", false, () => removeQuestionAnswer(key));
    questionAnswerDetail.appendChild(actions);
}

// 答えにしていない候補（この質問の答え・用意したパネル・任意パネル・相づち）。ドラッグかクリックで追加
function renderQuestionAnswerPalette(candidates, keys) {
    if (!questionAnswerPalette) return;
    const used = new Set(keys);
    const unused = Array.from(candidates.values()).filter(item => !used.has(item.key));

    if (questionAnswerFilter) {
        const groups = [];
        unused.forEach((item) => {
            const group = getQuestionAnswerGroup(item);
            if (!groups.includes(group)) groups.push(group);
        });
        if (questionAnswerPaletteFilter !== SIMPLE_FILTER_ALL && !groups.includes(questionAnswerPaletteFilter)) questionAnswerPaletteFilter = SIMPLE_FILTER_ALL;
        questionAnswerFilter.innerHTML = "";
        [{ key: SIMPLE_FILTER_ALL, label: "すべて" }, ...groups.map(g => ({ key: g, label: g }))].forEach(({ key, label }) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "filter-chip" + (key === questionAnswerPaletteFilter ? " active" : "");
            const count = key === SIMPLE_FILTER_ALL ? unused.length : unused.filter(i => getQuestionAnswerGroup(i) === key).length;
            chip.append(label, Object.assign(document.createElement("span"), { className: "filter-chip-count", textContent: String(count) }));
            chip.addEventListener("click", () => {
                questionAnswerPaletteFilter = key;
                renderQuestionAnswerEditor();
            });
            questionAnswerFilter.appendChild(chip);
        });
    }

    questionAnswerPalette.innerHTML = "";
    const visible = unused.filter(item => questionAnswerPaletteFilter === SIMPLE_FILTER_ALL || getQuestionAnswerGroup(item) === questionAnswerPaletteFilter);
    visible.forEach((item) => {
        const el = document.createElement("div");
        el.className = "palette-item";
        el.title = `「${buildSimpleSentence(item)}」（ドラッグで配置・クリックで追加）`;
        el.appendChild(createLayoutThumb(item));
        const name = document.createElement("div");
        name.className = "layout-tile-name";
        name.textContent = item.name;
        el.appendChild(name);
        // 選んでいるタイルの後ろへ（選んでいなければ最後へ）
        el.addEventListener("click", () => {
            const at = questionAnswerSelectedKey ? keys.indexOf(questionAnswerSelectedKey) : -1;
            moveQuestionAnswer(item.key, at >= 0 ? at + 1 : keys.length);
        });
        if (item.custom) {
            const del = document.createElement("button");
            del.type = "button";
            del.className = "layout-tile-remove";
            del.title = "この任意パネルを削除（ほかの質問の答えからも外れる）";
            del.textContent = "🗑";
            del.addEventListener("click", (e) => {
                e.stopPropagation();
                if (!confirm(`「${item.name}」を削除しますか？`)) return;
                deleteSimpleCustomPanel(item.id);
            });
            el.appendChild(del);
        }
        bindLayoutDrag(el, item.key);
        questionAnswerPalette.appendChild(el);
    });
    if (visible.length === 0) {
        const note = document.createElement("p");
        note.className = "settings-help";
        note.textContent = "すべて答えに入っています。";
        questionAnswerPalette.appendChild(note);
    }
}

// 追加する質問の答えを既存のパネルから選ぶ（グループごと。見出しを押すとグループを丸ごと選ぶ／外す）
export function renderQuestionPanelPicker() {
    if (!questionPanelPicker) return;
    questionPanelPicker.innerHTML = "";

    const groups = new Map();
    getAnswerPanelCatalog(simpleCustomDraft).forEach((p) => {
        const group = getSimplePanelGroup(p);
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(p);
    });

    groups.forEach((panels, group) => {
        const section = document.createElement("div");
        section.className = "question-picker-group";
        const allPicked = panels.every(p => questionPanelPickDraft.includes(p.id));
        const head = document.createElement("button");
        head.type = "button";
        head.className = "question-picker-head" + (allPicked ? " active" : "");
        head.textContent = `${group}${allPicked ? " ✓" : ""}`;
        head.title = allPicked ? "このグループを外す" : "このグループを丸ごと選ぶ";
        head.addEventListener("click", () => {
            if (allPicked) questionPanelPickDraft = questionPanelPickDraft.filter(id => !panels.some(p => p.id === id));
            else panels.forEach((p) => { if (!questionPanelPickDraft.includes(p.id)) questionPanelPickDraft.push(p.id); });
            renderQuestionPanelPicker();
        });
        section.appendChild(head);

        const chips = document.createElement("div");
        chips.className = "question-picker-chips";
        panels.forEach((p) => {
            const order = questionPanelPickDraft.indexOf(p.id);
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "question-picker-chip" + (order !== -1 ? " active" : "");
            chip.appendChild(createLayoutThumb(p, "question-picker-thumb"));
            const name = document.createElement("span");
            name.textContent = order !== -1 ? `${order + 1}. ${p.name}` : p.name;
            chip.appendChild(name);
            chip.title = buildSimpleSentence(p);
            chip.addEventListener("click", () => {
                if (order !== -1) questionPanelPickDraft.splice(order, 1);
                else questionPanelPickDraft.push(p.id);
                renderQuestionPanelPicker();
            });
            chips.appendChild(chip);
        });
        section.appendChild(chips);
        questionPanelPicker.appendChild(section);
    });

    if (questionPanelPickSummary) {
        questionPanelPickSummary.textContent = questionPanelPickDraft.length > 0
            ? `${questionPanelPickDraft.length} 枚を選択中（番号の順に並ぶ）`
            : "未選択";
    }
    if (questionPanelPickClearBtn) questionPanelPickClearBtn.disabled = questionPanelPickDraft.length === 0;
}

// 消した任意パネルを、選んでいる途中の答えからも外して出し直す
export function forgetDeletedPanel(id) {
    questionPanelPickDraft = questionPanelPickDraft.filter(x => x !== id);
    renderQuestionPanelPicker();
    renderQuestionEditor();
}

function clearQuestionPanelPick() {
    questionPanelPickDraft = [];
    renderQuestionPanelPicker();
}

function addCustomQuestion() {
    const question = questionCustomTextInput?.value.trim() || "";
    const answers = parseQuestionAnswers(questionCustomAnswersInput?.value || "");
    const panelIds = [...questionPanelPickDraft];
    if (!question) {
        alert("質問文を入力してください。");
        return;
    }
    if (answers.length + panelIds.length < 2) {
        alert("答えを2つ以上用意してください（パネルを選ぶか、1行に1つずつ入力）。");
        return;
    }
    const id = `qc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    questionCustomDraft.push({
        id,
        label: questionCustomLabelInput?.value.trim() || "",
        emoji: questionCustomEmojiInput?.value.trim() || "",
        question,
        answers,
        panelIds
    });
    questionOrderDraft.push(id);
    questionAnswerEditId = id;
    questionAnswerSelectedKey = null;
    questionCustomTextInput.value = "";
    if (questionCustomLabelInput) questionCustomLabelInput.value = "";
    if (questionCustomEmojiInput) questionCustomEmojiInput.value = "";
    questionCustomAnswersInput.value = "";
    questionPanelPickDraft = [];
    renderQuestionEditor();
    renderQuestionPanelPicker();
}

// 最初の答えと同じ並びに戻した質問は保存しない（パネルの増減に、元どおり追従させる）
function getQuestionAnswerLayoutsToSave() {
    const result = {};
    getQuestionCatalog(questionCustomDraft, questionOrderDraft).forEach((q) => {
        const keys = questionAnswerLayoutsDraft[q.id];
        if (!keys) return;
        const candidates = getQuestionAnswerCandidates(q, simpleCustomDraft);
        const defaults = getDefaultQuestionAnswerKeys(q, simpleCustomDraft).filter(key => candidates.has(key));
        if (keys.length === defaults.length && keys.every((key, i) => key === defaults[i])) return;
        result[q.id] = [...keys];
    });
    return result;
}

export function saveQuestionEditor() {
    // 答えを全部外した質問は、出しても本人が答えられないので保存しない
    const empty = getQuestionCatalog(questionCustomDraft, questionOrderDraft).filter(q => questionAnswerLayoutsDraft[q.id]?.length === 0);
    if (empty.length > 0) {
        alert(`答えがない質問があります: ${empty.map(getQuestionLabel).join("、")}
設定 → 質問モード →「答えのパネル」で答えを追加するか、「最初の答えに戻す」を押してください。`);
        questionAnswerEditId = empty[0].id;
        activateSettingsTab("question-tab");
        return false;
    }
    const nextConfig = {
        hiddenIds: Array.from(questionHiddenDraft),
        speakQuestion: questionSpeakInput ? questionSpeakInput.checked : questionStore.questionConfig.speakQuestion,
        order: [...questionOrderDraft],
        answerLayouts: getQuestionAnswerLayoutsToSave(),
        gridSize: questionGridSizeSelect ? questionGridSizeSelect.value : questionStore.questionConfig.gridSize,
        knownIds: QUESTION_PRESETS.map(q => q.id)
    };
    try {
        localStorage.setItem(QUESTION_CUSTOM_KEY, JSON.stringify(questionCustomDraft));
        localStorage.setItem(QUESTION_CONFIG_KEY, JSON.stringify(nextConfig));
    } catch (error) {
        console.error("question save failed:", error);
        alert("質問の設定を保存できませんでした。");
        return false;
    }
    questionStore.questionCustom = questionCustomDraft;
    questionStore.questionConfig = nextConfig;
    // 回答中の質問が削除されたら終了する（質問モードは出す質問の先頭へ切り替える）
    if (isQuestionMode()) {
        // 答えのパネル（任意パネル）が変わったかもしれないので、読み上げずに出し直す
        if (appState.activeQuestion && getVisibleQuestions().some(q => q.id === appState.activeQuestion.id)) startQuestion(appState.activeQuestion.id, { speak: false });
        else ensureQuestionModeQuestion();
    } else if (appState.activeQuestion && !getQuestionCatalog().some(q => q.id === appState.activeQuestion.id)) {
        endQuestion();
    }
    renderQuestionButtons();
    return true;
}

export function initQuestionEditor() {
    if (simpleCustomAddBtn) simpleCustomAddBtn.addEventListener("click", addSimpleCustomPanel);
    document.getElementById("question-custom-add-btn")?.addEventListener("click", addCustomQuestion);
    questionPanelPickClearBtn?.addEventListener("click", clearQuestionPanelPick);
    questionAnswerSelect?.addEventListener("change", () => {
        questionAnswerEditId = questionAnswerSelect.value;
        questionAnswerSelectedKey = null;
        renderQuestionAnswerEditor();
    });
    document.getElementById("question-answer-reset-btn")?.addEventListener("click", resetQuestionAnswers);
    document.getElementById("question-reset-order-btn")?.addEventListener("click", resetQuestionOrder);
    questionGridSizeSelect?.addEventListener("change", renderQuestionAnswerEditor);
    document.getElementById("question-answer-clear-btn")?.addEventListener("click", clearQuestionAnswers);
    // 候補の一覧へドラッグすると答えから外す
    if (questionAnswerPalette) bindLayoutDrop(questionAnswerPalette, key => removeQuestionAnswer(key));
    if (questionEndBtn) questionEndBtn.addEventListener("click", endQuestion);
}
