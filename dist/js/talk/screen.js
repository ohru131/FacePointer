// お話モードの画面（タブ・たどる・話す）
import { simpleTabsContainer } from "../core/dom.js";
import { isTalkScreen } from "../core/app-state.js";
import { createSimpleButton } from "../panels/panel-button.js";
import { isConfirmInProgress, speakSimpleSentence } from "../panels/confirm.js";
import { playConfirmSound } from "../panels/sound.js";
import { getSimpleRowKey, lockSimpleKeyAfterConfirm, markPanelsReplaced } from "../panels/selection.js";
import {
    DEFAULT_TALK_SET, TALK_AIZUCHI, TALK_HISTORY_KEY, TALK_HISTORY_SENTENCE_LIMIT, TALK_SAY_ID,
    TALK_TAB_AIZUCHI, TALK_TAB_FAVORITE, TALK_TAB_PARTNER, TALK_TAB_PREFIX, TALK_TAB_TREE,
    getActiveTalkSet, getFavoriteTalkSentences, getFavoriteTalkTemplates, getTalkChildren,
    getTalkCurrentNode, getTalkPartner, getTalkPartners, resolveTalkSentence, talkState
} from "./model.js";
import { handleSimpleControl, panelScreen, rerenderSimpleMode } from "../panels/screen.js";

export function getTalkPanels() {
    if (talkState.talkTab === TALK_TAB_AIZUCHI) return TALK_AIZUCHI.map(item => ({ ...item, type: "aizuchi" }));
    if (talkState.talkTab === TALK_TAB_FAVORITE) return getFavoriteTalkSentences();
    if (talkState.talkTab === TALK_TAB_PARTNER) {
        // 相手のアイコンはパターンごと（同じ id でも別の人、たとえば妹のことがある）。標準だけ接頭辞なし
        // 「決めない」はどのセットでも同じ意味なので共通の id のまま
        const idPrefix = getActiveTalkSet().id === DEFAULT_TALK_SET.id ? "talk-partner" : `talk-partner-${getActiveTalkSet().id}`;
        return getTalkPartners().map(p => ({
            id: p.id ? `${idPrefix}-${p.id}` : "talk-partner-none",
            type: "partner",
            selected: p.id === talkState.talkPartnerId,
            name: p.name,
            emoji: p.emoji,
            partnerId: p.id
        }));
    }
    const node = getTalkCurrentNode();
    // 発話文がなく、続きも全部隠れた言葉は出さない（選んでも話せないため）
    const children = getTalkChildren(node).filter(child => child.say || getTalkChildren(child).length > 0);
    const panels = children.map(child => ({
        id: child.id,
        type: getTalkChildren(child).length > 0 ? "branch" : "leaf",
        name: child.label,
        emoji: child.emoji,
        node: child
    }));
    // 途中で確定できるよう、先頭（いつも同じ位置）に「これで話す」を置く
    if (node?.say) panels.unshift({ id: TALK_SAY_ID, type: "say", name: "🔊 これで話す" });
    return panels;
}

function getTalkTabs() {
    const partner = getTalkPartner();
    return [
        { key: TALK_TAB_TREE, label: "お話", icon: "💬" },
        { key: TALK_TAB_AIZUCHI, label: "相づち", icon: "😄" },
        { key: TALK_TAB_FAVORITE, label: "よく話す", icon: "⭐" },
        { key: TALK_TAB_PARTNER, label: partner ? partner.name : "相手", icon: partner ? partner.emoji : "👤" }
    ];
}

// 中身が入れ替わるので、最初のページから出し直し、ポインタの下の新しいパネルを続けて選ばないようにする
export function refreshTalkScreen({ fullLock = false } = {}) {
    panelScreen.simplePage = 0;
    markPanelsReplaced({ fullLock });
}

// お話タブ中にもう一度お話を選んだら最初の話題へ。相づちなどから戻ったときは、たどっていた場所を保つ
export function goToTalkTab(tab) {
    if (tab === TALK_TAB_TREE && talkState.talkTab === TALK_TAB_TREE) {
        if (talkState.talkPath.length === 0 && panelScreen.simplePage === 0) return;
        talkState.talkPath = [];
    } else if (talkState.talkTab === tab && panelScreen.simplePage === 0) {
        return;
    }
    talkState.talkTab = tab;
    talkState.talkFavoriteOrder = tab === TALK_TAB_FAVORITE ? getFavoriteTalkTemplates() : null;
    refreshTalkScreen();
}

function recordTalkHistory(template) {
    if (!talkState.talkConfig.learn || !template) return;
    const entry = talkState.talkHistory.sentences[template] || { count: 0, at: 0 };
    talkState.talkHistory.sentences[template] = { count: entry.count + 1, at: Date.now() };
    // よく話す文は上位だけ残す
    const kept = Object.entries(talkState.talkHistory.sentences)
        .sort((a, b) => (b[1].count - a[1].count) || (b[1].at - a[1].at))
        .slice(0, TALK_HISTORY_SENTENCE_LIMIT);
    talkState.talkHistory.sentences = Object.fromEntries(kept);
    try {
        localStorage.setItem(TALK_HISTORY_KEY, JSON.stringify(talkState.talkHistory));
    } catch (error) {
        console.warn("talk history save failed:", error);
    }
}

export function clearTalkHistory() {
    talkState.talkHistory = { sentences: {} };
    talkState.talkFavoriteOrder = null;
    localStorage.removeItem(TALK_HISTORY_KEY);
}

// 話したら、お話は最初の話題選びへ戻る（相づち・よく話すは続けて選べるようそのまま）
// template は「{呼}、」を含む元の文。相づちは「よく話す」を埋めてしまうので記録しない
function speakTalkSentence(template, { record = true } = {}) {
    const sentence = template ? resolveTalkSentence(template) : "";
    if (!sentence) return;
    if (record) recordTalkHistory(template);
    if (talkState.talkTab === TALK_TAB_TREE) {
        talkState.talkPath = [];
        refreshTalkScreen({ fullLock: true });
    }
    rerenderSimpleMode();
    void speakSimpleSentence(sentence);
}

export function handleTalkPanel(item) {
    if (isConfirmInProgress || panelScreen.isSimplePaused) return;
    lockSimpleKeyAfterConfirm(getSimpleRowKey(item.id));

    if (item.type === "aizuchi") {
        speakTalkSentence(item.sentence, { record: false });
        return;
    }
    if (item.type === "phrase") {
        speakTalkSentence(item.template);
        return;
    }
    if (item.partnerId !== undefined) {
        talkState.talkPartnerId = item.partnerId;
        // 相手が変わると出る話題も変わるので、最初の話題選びから
        talkState.talkPath = [];
        talkState.talkTab = TALK_TAB_TREE;
        playConfirmSound();
        refreshTalkScreen();
        rerenderSimpleMode();
        return;
    }
    if (item.id === TALK_SAY_ID) {
        speakTalkSentence(getTalkCurrentNode()?.say);
        return;
    }
    // 続きのない言葉はそのまま話す。続きがあれば1段進む
    if (item.type === "leaf") {
        speakTalkSentence(item.node.say);
        return;
    }
    talkState.talkPath.push(item.node);
    playConfirmSound();
    refreshTalkScreen();
    rerenderSimpleMode();
}

// 「これで話す」は複数ページになっても各ページの先頭に置く（どのページからでも確定できる）
export function repeatTalkSayPanel(panels, pageSize) {
    if (panels[0]?.id !== TALK_SAY_ID || panels.length <= pageSize || pageSize < 2) return panels;
    const [say, ...rest] = panels;
    const paged = [];
    for (let i = 0; i < rest.length; i += pageSize - 1) paged.push(say, ...rest.slice(i, i + pageSize - 1));
    return paged;
}

export function renderTalkTabs() {
    if (!simpleTabsContainer) return;
    simpleTabsContainer.innerHTML = "";
    if (!isTalkScreen()) {
        simpleTabsContainer.style.display = "none";
        return;
    }
    simpleTabsContainer.style.display = "";
    getTalkTabs().forEach((tab) => {
        const control = `${TALK_TAB_PREFIX}${tab.key}`;
        const btn = createSimpleButton(control, `${tab.icon} ${tab.label}`, {
            className: `simple-ctrl simple-tab simple-tab--${tab.key}${tab.key === talkState.talkTab ? " active" : ""}`,
            onClick: () => handleSimpleControl(control)
        });
        simpleTabsContainer.appendChild(btn);
    });
}
