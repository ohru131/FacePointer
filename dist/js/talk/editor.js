// 設定画面: お話モードのタブ（会話パターン・言葉・AI で作る）
import { TALK_AI_MODEL_DEFAULT, generateInterviewQuestions, generateTalkSet, countTalkTreeNodes } from "../../talk-generator.js";
import {
    apiKeyInput, settingsModal, talkAiModelInput, talkAiStatus, talkCustomEmojiInput,
    talkCustomLabelInput, talkCustomSayInput, talkGenerateBtn, talkHistorySummary,
    talkInterviewCarryInput, talkInterviewList, talkInterviewStartBtn, talkLearnInput,
    talkProfileAgeInput, talkProfileGenderSelect, talkSetList, talkWordFilter, talkWordList
} from "../core/dom.js";
import { isTalkScreen } from "../core/app-state.js";
import {
    DEFAULT_TALK_SET, TALK_ACTIVE_SET_KEY, TALK_AI_MODEL_KEY, TALK_CALL_PLACEHOLDER, TALK_CONFIG_KEY,
    TALK_CUSTOM_KEY, TALK_CUSTOM_TOPIC_ID, TALK_PROFILE_KEY, TALK_TAB_TREE, getActiveTalkSet,
    getTalkPartners, getTalkSets, getTalkTree, saveTalkSets, talkSets, talkState
} from "./model.js";
import { clearTalkHistory } from "./screen.js";
import { panelScreen, rerenderSimpleMode } from "../panels/screen.js";
import { ttsSettings } from "../speech/tts.js";

// ---------------------------------------------------------
// 設定画面: お話の言葉
// ---------------------------------------------------------
let talkHiddenDraft = new Set();
let talkCustomDraft = [];
let talkEditorFilter = "";

export function openTalkEditor() {
    talkHiddenDraft = new Set(talkState.talkConfig.hiddenIds);
    talkCustomDraft = talkState.talkCustom.map(n => ({ ...n }));
    talkEditorFilter = getTalkTree(talkCustomDraft)[0]?.id || "";
    openTalkSetEditor();
    if (talkLearnInput) talkLearnInput.checked = talkState.talkConfig.learn;
    updateTalkHistorySummary();
    resetTalkCustomForm();
    renderTalkEditor();
}

function countTalkNodes(nodes) {
    return nodes.reduce((sum, node) => sum + 1 + countTalkNodes(node.children || []), 0);
}

function renderTalkEditor() {
    if (!talkWordList) return;
    const tree = getTalkTree(talkCustomDraft);
    if (!tree.some(topic => topic.id === talkEditorFilter)) talkEditorFilter = tree[0]?.id || "";

    if (talkWordFilter) {
        talkWordFilter.innerHTML = "";
        tree.forEach((topic) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "filter-chip" + (topic.id === talkEditorFilter ? " active" : "")
                + (talkHiddenDraft.has(topic.id) ? " is-disabled" : "");
            chip.append(`${topic.emoji || ""} ${topic.label}`.trim(), Object.assign(document.createElement("span"), {
                className: "filter-chip-count", textContent: String(countTalkNodes(topic.children || []))
            }));
            chip.addEventListener("click", () => {
                talkEditorFilter = topic.id;
                renderTalkEditor();
            });
            talkWordFilter.appendChild(chip);
        });
    }

    talkWordList.innerHTML = "";
    const topic = tree.find(t => t.id === talkEditorFilter);
    if (!topic) return;
    // 話題そのものと、その下の言葉を段ごとに字下げして並べる。外した言葉の下はまとめて出なくなる
    const appendRow = (node, depth, parentHidden) => {
        const hidden = talkHiddenDraft.has(node.id);
        const row = document.createElement("label");
        row.className = "talk-editor-row" + (hidden || parentHidden ? " is-disabled" : "");
        row.style.setProperty("--depth", String(depth));
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = !hidden;
        check.addEventListener("change", () => {
            if (check.checked) talkHiddenDraft.delete(node.id);
            else talkHiddenDraft.add(node.id);
            renderTalkEditor();
        });
        const name = document.createElement("span");
        name.className = "talk-editor-name";
        name.textContent = `${node.emoji || ""} ${node.label}`.trim();
        row.append(check, name);
        const notes = [];
        if (node.for) notes.push(`👤${node.for.map(id => getTalkPartners().find(p => p.id === id)?.name || id).join("・")}のとき`);
        if (node.time) notes.push({ morning: "🌅朝", day: "☀️昼", evening: "🌙夜" }[node.time]);
        if (node.say || notes.length > 0) {
            const say = document.createElement("small");
            say.className = "talk-editor-say";
            say.textContent = [node.say ? `「${node.say.replace(TALK_CALL_PLACEHOLDER, "（呼び名）、")}」` : "", ...notes].filter(Boolean).join(" ");
            row.appendChild(say);
        }
        if (talkCustomDraft.some(n => n.id === node.id)) {
            const del = document.createElement("button");
            del.type = "button";
            del.className = "talk-editor-remove";
            del.title = "この文を削除";
            del.textContent = "✕";
            del.addEventListener("click", (e) => {
                e.preventDefault();
                talkCustomDraft = talkCustomDraft.filter(n => n.id !== node.id);
                talkHiddenDraft.delete(node.id);
                renderTalkEditor();
            });
            row.appendChild(del);
        }
        talkWordList.appendChild(row);
        (node.children || []).forEach(child => appendRow(child, depth + 1, parentHidden || hidden));
    };
    appendRow(topic, 0, false);
}

function resetTalkCustomForm() {
    if (talkCustomLabelInput) talkCustomLabelInput.value = "";
    if (talkCustomEmojiInput) talkCustomEmojiInput.value = "";
    if (talkCustomSayInput) talkCustomSayInput.value = "";
}

function addTalkCustomPhrase() {
    const label = talkCustomLabelInput?.value.trim() || "";
    if (!label) {
        alert("パネルの言葉を入力してください。");
        return;
    }
    const say = talkCustomSayInput?.value.trim() || `${label}。`;
    const node = { id: `tc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, label, say };
    const emoji = talkCustomEmojiInput?.value.trim() || "";
    if (emoji) node.emoji = emoji;
    talkCustomDraft.push(node);
    talkEditorFilter = TALK_CUSTOM_TOPIC_ID;
    resetTalkCustomForm();
    renderTalkEditor();
}

function updateTalkHistorySummary() {
    if (!talkHistorySummary) return;
    const sentences = Object.keys(talkState.talkHistory.sentences).length;
    talkHistorySummary.textContent = sentences === 0 ? "まだ記録していません" : `よく話す文 ${sentences} 件を記録中`;
}

// ---------------------------------------------------------
// 設定画面: 会話パターンの切り替えと、AI インタビューでの作成
// ---------------------------------------------------------
const TALK_INTERVIEW_FREE_QUESTION = "その他、本人について伝えたいこと（自由に）";
let talkInterviewDraft = [];   // [{ q, a }]
let isTalkAiBusy = false;

// 使うパターンを切り替える。相手や途中の位置は前のパターンのものなので最初に戻す
function setActiveTalkSet(id) {
    talkState.talkActiveSetId = getTalkSets().some(set => set.id === id) ? id : DEFAULT_TALK_SET.id;
    try {
        localStorage.setItem(TALK_ACTIVE_SET_KEY, talkState.talkActiveSetId);
    } catch (error) {
        // 保存容量が足りなくても、今の画面では切り替える
        console.warn("talk active set save failed:", error);
    }
    // 引き継ぐ回答は使うパターンごとに違うので、作りかけのインタビューは捨てる
    talkInterviewDraft = [];
    talkState.talkPartnerId = "";
    talkState.talkPath = [];
    talkState.talkTab = TALK_TAB_TREE;
    talkState.talkFavoriteOrder = null;
    panelScreen.simplePage = 0;
    if (isTalkScreen()) rerenderSimpleMode();
}

function openTalkSetEditor() {
    if (talkProfileGenderSelect) talkProfileGenderSelect.value = talkState.talkProfile.gender;
    if (talkProfileAgeInput) talkProfileAgeInput.value = talkState.talkProfile.age ?? "";
    if (talkAiModelInput) talkAiModelInput.value = localStorage.getItem(TALK_AI_MODEL_KEY) || "";
    renderTalkSetList();
    renderTalkInterview();
    updateTalkAiButtons();
}

function readTalkProfileForm() {
    const age = Number.parseInt(talkProfileAgeInput?.value || "", 10);
    return {
        gender: talkProfileGenderSelect?.value || "",
        age: Number.isFinite(age) && age > 0 && age < 130 ? age : null
    };
}

function saveTalkProfileForm() {
    talkState.talkProfile = readTalkProfileForm();
    localStorage.setItem(TALK_PROFILE_KEY, JSON.stringify(talkState.talkProfile));
    const model = talkAiModelInput?.value.trim() || "";
    if (model) localStorage.setItem(TALK_AI_MODEL_KEY, model);
    else localStorage.removeItem(TALK_AI_MODEL_KEY);
}

// 設定画面で入力したばかり（未保存）のキーも使う
function getTalkAiApiKey() {
    return apiKeyInput?.value.trim() || ttsSettings.GEMINI_API_KEY;
}

function getTalkAiModel() {
    return localStorage.getItem(TALK_AI_MODEL_KEY) || TALK_AI_MODEL_DEFAULT;
}

function formatTalkSetDate(time) {
    const date = new Date(time);
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

function renderTalkSetList() {
    if (!talkSetList) return;
    talkSetList.innerHTML = "";
    getTalkSets().forEach((set) => {
        const row = document.createElement("label");
        row.className = "talk-set-row" + (set.id === talkState.talkActiveSetId ? " active" : "");
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "talk-set";
        radio.checked = set.id === talkState.talkActiveSetId;
        radio.addEventListener("change", () => {
            setActiveTalkSet(set.id);
            talkEditorFilter = "";
            renderTalkSetList();
            renderTalkInterview();
            renderTalkEditor();
            updateTalkAiButtons();
        });
        const body = document.createElement("span");
        body.className = "talk-set-body";
        const name = document.createElement("span");
        name.className = "talk-set-name";
        name.textContent = set.name;
        const meta = document.createElement("small");
        meta.className = "talk-set-meta";
        const partners = set.partners.map(p => p.name).join("・");
        meta.textContent = [
            set.createdAt ? `${new Date(set.createdAt).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })} 作成` : "",
            `${countTalkTreeNodes(set.tree)} 項目`,
            partners ? `相手: ${partners}` : ""
        ].filter(Boolean).join(" ／ ");
        body.append(name, meta);
        row.append(radio, body);
        if (!set.builtin) {
            const rename = document.createElement("button");
            rename.type = "button";
            rename.className = "ctrl-btn secondary talk-set-btn";
            rename.textContent = "名前";
            rename.addEventListener("click", (e) => {
                e.preventDefault();
                const next = prompt("会話パターンの名前", set.name);
                if (!next || !next.trim()) return;
                saveTalkSets(talkSets.map(s => (s.id === set.id ? { ...s, name: next.trim().slice(0, 40) } : s)));
                renderTalkSetList();
            });
            const del = document.createElement("button");
            del.type = "button";
            del.className = "ctrl-btn secondary talk-set-btn";
            del.textContent = "削除";
            del.addEventListener("click", (e) => {
                e.preventDefault();
                if (!confirm(`「${set.name}」を削除しますか？（元に戻せません）`)) return;
                if (!saveTalkSets(talkSets.filter(s => s.id !== set.id))) return;
                if (set.id === talkState.talkActiveSetId) setActiveTalkSet(DEFAULT_TALK_SET.id);
                talkEditorFilter = "";
                renderTalkSetList();
                renderTalkInterview();
                renderTalkEditor();
                updateTalkAiButtons();
            });
            // talk studio（npm run talk:studio）に読み込んで、文の手直しや絵の作成をするためのファイル
            const exportBtn = document.createElement("button");
            exportBtn.type = "button";
            exportBtn.className = "ctrl-btn secondary talk-set-btn";
            exportBtn.textContent = "書き出し";
            exportBtn.addEventListener("click", (e) => {
                e.preventDefault();
                const blob = new Blob([JSON.stringify(set, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `talk-set-${set.id}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            });
            row.append(rename, exportBtn, del);
        }
        talkSetList.appendChild(row);
    });
}

function renderTalkInterview() {
    if (!talkInterviewList) return;
    talkInterviewList.innerHTML = "";
    talkInterviewDraft.forEach((item, index) => {
        const field = document.createElement("label");
        field.className = "field talk-interview-item";
        const q = document.createElement("span");
        q.textContent = `Q${index + 1}. ${item.q}`;
        const a = document.createElement("textarea");
        a.rows = 2;
        a.value = item.a;
        a.placeholder = "わかる範囲で（空欄でもよい）";
        a.addEventListener("input", () => {
            item.a = a.value;
            item.carried = false;
            updateTalkAiButtons();
        });
        field.append(q, a);
        talkInterviewList.appendChild(field);
    });
}

// 今のパターンを作ったときの回答（引き継ぐ設定のとき）
function getCarriedTalkInterview() {
    if (talkInterviewCarryInput && !talkInterviewCarryInput.checked) return [];
    return (getActiveTalkSet().interview || []).map(item => ({ q: item.q, a: item.a }));
}

// 引き継いだ回答と画面で答えた内容を合わせる（同じ質問は画面の答えを優先）。
// 引き継ぎOFFなら、引き継いだまま手を加えていない回答は使わない
function mergeTalkInterview({ includeUnanswered = false } = {}) {
    const carryOn = !talkInterviewCarryInput || talkInterviewCarryInput.checked;
    const merged = getCarriedTalkInterview();
    talkInterviewDraft.forEach((item) => {
        if (item.carried && !carryOn) return;
        const existing = merged.find(m => m.q === item.q);
        if (existing) existing.a = item.a;
        else merged.push({ q: item.q, a: item.a });
    });
    return merged
        .map(item => ({ q: item.q, a: (item.a || "").trim() }))
        .filter(item => includeUnanswered || item.a);
}

function updateTalkAiButtons() {
    if (talkInterviewStartBtn) talkInterviewStartBtn.disabled = isTalkAiBusy;
    if (talkGenerateBtn) talkGenerateBtn.disabled = isTalkAiBusy || mergeTalkInterview().length === 0;
}

function setTalkAiStatus(text, isError = false) {
    if (!talkAiStatus) return;
    talkAiStatus.textContent = text;
    talkAiStatus.classList.toggle("is-error", isError);
}

async function startTalkInterview() {
    if (isTalkAiBusy) return;
    saveTalkProfileForm();
    // 未回答の質問も渡して、同じ質問をくり返させない
    const base = mergeTalkInterview({ includeUnanswered: true });
    isTalkAiBusy = true;
    updateTalkAiButtons();
    setTalkAiStatus("質問を考えています…");
    try {
        const questions = await generateInterviewQuestions({
            apiKey: getTalkAiApiKey(), model: getTalkAiModel(), profile: talkState.talkProfile, interview: base
        });
        const asked = new Set(base.map(item => item.q));
        const fresh = questions.filter(q => !asked.has(q)).map(q => ({ q, a: "" }));
        const carriedQuestions = new Set(getCarriedTalkInterview().map(item => item.q));
        // 前回までの質問は下に続ける。引き継いだまま手を加えていない回答には印を付ける
        const previous = base
            .filter(item => item.q !== TALK_INTERVIEW_FREE_QUESTION)
            .map(item => ({ ...item, carried: carriedQuestions.has(item.q) && !talkInterviewDraft.some(d => d.q === item.q && !d.carried) }));
        const free = base.find(item => item.q === TALK_INTERVIEW_FREE_QUESTION) || { q: TALK_INTERVIEW_FREE_QUESTION, a: "" };
        talkInterviewDraft = [...fresh, ...previous, free];
        renderTalkInterview();
        setTalkAiStatus(`${fresh.length} 個の質問を作りました。答えてから「会話パターンを作る」を押してください。前回の回答は下に続いています。`);
    } catch (error) {
        console.error("talk interview failed:", error);
        setTalkAiStatus(error.message, true);
    } finally {
        isTalkAiBusy = false;
        updateTalkAiButtons();
    }
}

async function generateTalkSetFromInterview() {
    if (isTalkAiBusy) return;
    saveTalkProfileForm();
    // 画面で質問を出していなければ、今のパターンの回答（引き継ぎON時）から作り直す
    const source = mergeTalkInterview();
    if (source.length === 0) {
        setTalkAiStatus("質問に1つ以上答えてください。", true);
        return;
    }
    isTalkAiBusy = true;
    updateTalkAiButtons();
    setTalkAiStatus("会話パターンを作っています…（1〜3分かかります。設定は閉じずにお待ちください）");
    try {
        const id = `ai${Date.now().toString(36)}`;
        const createdAt = Date.now();
        const result = await generateTalkSet({
            apiKey: getTalkAiApiKey(), model: getTalkAiModel(), profile: talkState.talkProfile, interview: source, setId: id
        });
        const set = {
            id,
            name: `${result.name}（${formatTalkSetDate(createdAt)}）`,
            createdAt,
            profile: { ...talkState.talkProfile },
            interview: source,
            partners: result.partners,
            tree: result.tree
        };
        if (!saveTalkSets([...talkSets, set])) {
            setTalkAiStatus("保存できませんでした。使わないパターンを削除してから、もう一度お試しください。", true);
            return;
        }
        // 作っている間に設定を閉じて会話を始めていたら、途中で切り替えない（保存だけ）
        const isSettingsStillOpen = settingsModal.classList.contains("active");
        if (isSettingsStillOpen) setActiveTalkSet(id);
        else talkInterviewDraft = [];
        talkEditorFilter = "";
        renderTalkSetList();
        renderTalkInterview();
        renderTalkEditor();
        setTalkAiStatus(isSettingsStillOpen
            ? `「${set.name}」を作って保存し、使う設定にしました（${countTalkTreeNodes(set.tree)} 項目）。`
            : `「${set.name}」を作って保存しました（${countTalkTreeNodes(set.tree)} 項目）。上の一覧で選ぶと使えます。`);
    } catch (error) {
        console.error("talk set generation failed:", error);
        setTalkAiStatus(error.message, true);
    } finally {
        isTalkAiBusy = false;
        updateTalkAiButtons();
    }
}

export function saveTalkEditor() {
    const nextConfig = {
        hiddenIds: Array.from(talkHiddenDraft),
        learn: talkLearnInput ? talkLearnInput.checked : talkState.talkConfig.learn
    };
    try {
        localStorage.setItem(TALK_CUSTOM_KEY, JSON.stringify(talkCustomDraft));
        localStorage.setItem(TALK_CONFIG_KEY, JSON.stringify(nextConfig));
    } catch (error) {
        console.error("talk save failed:", error);
        alert("お話の設定を保存できませんでした。");
        return false;
    }
    talkState.talkCustom = talkCustomDraft;
    talkState.talkConfig = nextConfig;
    saveTalkProfileForm();
    // たどっている途中の言葉が消えたかもしれないので、最初の話題選びへ戻す
    talkState.talkPath = [];
    panelScreen.simplePage = 0;
    return true;
}

export function initTalkEditor() {
    document.getElementById("talk-custom-add-btn")?.addEventListener("click", addTalkCustomPhrase);
    talkInterviewStartBtn?.addEventListener("click", () => void startTalkInterview());
    talkGenerateBtn?.addEventListener("click", () => void generateTalkSetFromInterview());
    talkInterviewCarryInput?.addEventListener("change", updateTalkAiButtons);
    document.getElementById("talk-history-clear-btn")?.addEventListener("click", () => {
        if (!confirm("お話の「よく話す」記録を消去しますか？")) return;
        clearTalkHistory();
        updateTalkHistorySummary();
        if (isTalkScreen()) rerenderSimpleMode();
    });
}
