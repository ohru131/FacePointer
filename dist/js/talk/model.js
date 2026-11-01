// お話モードの会話データ・相手・履歴（保存するもの）
import { TALK_TREE } from "../../talk-data.js";

// talk studio で登録したパターン。ファイルが欠けたり壊れたりしていても、標準のパターンだけで起動できるようにする
let PUBLISHED_TALK_SETS = [];
try {
    ({ PUBLISHED_TALK_SETS } = await import("../../talk-sets/index.js"));
} catch (error) {
    console.error("talk sets load failed:", error);
}

// お話モード
// 事前に用意した会話の木（talk-data.js）を「話題 → 内容 → …」と最大4段たどって1文を選ぶ。
// どの段でも「これで話す」で確定でき、続きのない言葉まで進んだらそのまま話す。
// 相手（来ている人）を選んでおくと、文頭の「{呼}、」に呼び名が入り、その人向けの話題も出る。
// 「相づち」は相手の話に1回で反応する短い言葉、「よく話す」は話した文の履歴。
export const TALK_CONFIG_KEY = "talk_config_v1";
export const TALK_CUSTOM_KEY = "talk_custom_v1";
export const TALK_HISTORY_KEY = "talk_history_v1";
export const TALK_TAB_PREFIX = "ctrl-tab-";
export const TALK_TAB_TREE = "tree";
export const TALK_TAB_AIZUCHI = "aizuchi";
export const TALK_TAB_FAVORITE = "favorite";
export const TALK_TAB_PARTNER = "partner";
export const TALK_SAY_ID = "talk-say";
export const TALK_CUSTOM_TOPIC_ID = "custom";
const TALK_FAVORITE_LIMIT = 12;
export const TALK_HISTORY_SENTENCE_LIMIT = 40;
export const TALK_CALL_PLACEHOLDER = /^\{呼\}、/;

const DEFAULT_TALK_PARTNERS = [
    { id: "father", name: "お父さん", emoji: "👨" },
    { id: "mother", name: "お母さん", emoji: "👩" },
    { id: "sister", name: "お姉ちゃん", emoji: "👱‍♀️" },
    { id: "brother", name: "お兄ちゃん", emoji: "🧑" },
    { id: "nurse", name: "看護師さん", emoji: "👩‍⚕️" }
];
const TALK_PARTNER_NONE = { id: "", name: "決めない", emoji: "👥" };

// 会話パターン: 初期データ（talk-data.js）と、インタビューから AI で作ったもの。作ったものは消すまで残す
const TALK_SETS_KEY = "talk_sets_v1";
export const TALK_ACTIVE_SET_KEY = "talk_active_set";
export const TALK_PROFILE_KEY = "talk_profile_v1";
export const TALK_AI_MODEL_KEY = "talk_ai_model";
export const DEFAULT_TALK_SET = { id: "default", name: "標準（初期データ）", builtin: true, partners: DEFAULT_TALK_PARTNERS, tree: TALK_TREE };

function loadTalkSets() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TALK_SETS_KEY) || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(set => set && typeof set.id === "string" && typeof set.name === "string"
            && Array.isArray(set.tree) && Array.isArray(set.partners));
    } catch {
        return [];
    }
}

function loadTalkProfile() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TALK_PROFILE_KEY) || "null");
        const age = Number.parseInt(parsed?.age, 10);
        return {
            gender: ["female", "male", "other"].includes(parsed?.gender) ? parsed.gender : "",
            age: Number.isFinite(age) && age > 0 ? age : null
        };
    } catch {
        return { gender: "", age: null };
    }
}

export let talkSets = loadTalkSets();

// talk studio で作って登録したパターンは、標準と同じく組み込み（名前変更・削除なし、どの端末でも使える）
const PUBLISHED_SETS = PUBLISHED_TALK_SETS.map(set => ({ ...set, builtin: true }));

export function getTalkSets() {
    return [DEFAULT_TALK_SET, ...PUBLISHED_SETS, ...talkSets];
}

export function getActiveTalkSet() {
    return getTalkSets().find(set => set.id === talkState.talkActiveSetId) || DEFAULT_TALK_SET;
}

export function getTalkPartners() {
    return [...getActiveTalkSet().partners, TALK_PARTNER_NONE];
}

export function saveTalkSets(nextSets) {
    try {
        localStorage.setItem(TALK_SETS_KEY, JSON.stringify(nextSets));
    } catch (error) {
        console.error("talk sets save failed:", error);
        alert("会話パターンを保存できませんでした（保存容量の不足）。使わないパターンを削除してください。");
        return false;
    }
    talkSets = nextSets;
    return true;
}

export const TALK_AIZUCHI = [
    { id: "a-uun", name: "うんうん", emoji: "😌", sentence: "うんうん。" },
    { id: "a-hee", name: "へえ！", emoji: "😮", sentence: "へえ！" },
    { id: "a-sorede", name: "それで？", emoji: "👂", sentence: "それで？" },
    { id: "a-wakaru", name: "わかる！", emoji: "🙆‍♀️", sentence: "わかる！" },
    { id: "a-ee", name: "えー！", emoji: "😲", sentence: "えー！" },
    { id: "a-laugh", name: "あはは", emoji: "😆", sentence: "あはは！" },
    { id: "a-sugoi", name: "すごい！", emoji: "👏", sentence: "すごい！" },
    { id: "a-honto", name: "ほんとに？", emoji: "🤔", sentence: "ほんとに？" },
    { id: "a-naruhodo", name: "なるほど", emoji: "💡", sentence: "なるほどね。" },
    { id: "a-iine", name: "いいね！", emoji: "👍", sentence: "いいね！" },
    { id: "a-yokatta", name: "よかったね", emoji: "😊", sentence: "よかったね。" },
    { id: "a-taihen", name: "大変だったね", emoji: "🥲", sentence: "大変だったね。" },
    { id: "a-motto", name: "もっと聞かせて", emoji: "✨", sentence: "もっと聞かせて。" },
    { id: "a-matte", name: "ちょっと待って", emoji: "✋", sentence: "ちょっと待って。" },
    { id: "a-again", name: "もう一回", emoji: "🔁", sentence: "もう一回言って。" },
    { id: "a-wakaranai", name: "わからない", emoji: "❓", sentence: "ちょっとわからない。" }
];

function loadTalkConfig() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TALK_CONFIG_KEY) || "null");
        return {
            hiddenIds: Array.isArray(parsed?.hiddenIds) ? parsed.hiddenIds.filter(id => typeof id === "string") : [],
            learn: parsed?.learn !== false
        };
    } catch {
        return { hiddenIds: [], learn: true };
    }
}

// 介助者が追加した文。「自分の言葉」の話題に並ぶ
function loadTalkCustom() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TALK_CUSTOM_KEY) || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(n => n && typeof n.id === "string" && typeof n.label === "string" && typeof n.say === "string");
    } catch {
        return [];
    }
}

function loadTalkHistory() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TALK_HISTORY_KEY) || "null");
        return { sentences: parsed?.sentences && typeof parsed.sentences === "object" ? parsed.sentences : {} };
    } catch {
        return { sentences: {} };
    }
}

// 他のモジュールからも読み書きする状態
export const talkState = {
    talkActiveSetId: localStorage.getItem(TALK_ACTIVE_SET_KEY) || DEFAULT_TALK_SET.id,
    talkProfile: loadTalkProfile(),
    talkConfig: loadTalkConfig(),
    talkCustom: loadTalkCustom(),
    talkHistory: loadTalkHistory(),
    talkTab: TALK_TAB_TREE,
    talkPath: [],          // たどった木のノード（話題 → 内容 → …）
    talkPartnerId: "",     // 来ている人。呼び名と話題の絞り込みに使う
    talkFavoriteOrder: null // 「よく話す」タブを開いている間の並び
};

export function getTalkTree(custom = talkState.talkCustom) {
    const tree = getActiveTalkSet().tree;
    if (custom.length === 0) return tree;
    return [...tree, { id: TALK_CUSTOM_TOPIC_ID, label: "自分の言葉", emoji: "✏️", children: custom }];
}

export function getTalkPartner() {
    return getTalkPartners().find(p => p.id && p.id === talkState.talkPartnerId) || null;
}

function getTalkTimeOfDay(date = new Date()) {
    const hour = date.getHours();
    if (hour >= 4 && hour < 11) return "morning";
    if (hour >= 11 && hour < 17) return "day";
    return "evening";
}

// 非表示にした言葉・相手や時間帯に合わない言葉は出さない
function isTalkNodeVisible(node) {
    if (talkState.talkConfig.hiddenIds.includes(node.id)) return false;
    if (Array.isArray(node.for) && talkState.talkPartnerId && !node.for.includes(talkState.talkPartnerId)) return false;
    if (node.time && node.time !== getTalkTimeOfDay()) return false;
    return true;
}

export function getTalkChildren(node) {
    const children = node ? (node.children || []) : getTalkTree();
    return children.filter(isTalkNodeVisible);
}

// 文頭の「{呼}、」を相手の呼び名にする（相手を決めていなければ省く）
export function resolveTalkSentence(say, partner = getTalkPartner()) {
    return say.replace(TALK_CALL_PLACEHOLDER, partner ? `${partner.name}、` : "").replaceAll("{呼}", partner ? partner.name : "");
}

export function getTalkCurrentNode() {
    return talkState.talkPath[talkState.talkPath.length - 1] || null;
}

export function getTalkCurrentSentence() {
    const node = getTalkCurrentNode();
    return node?.say ? resolveTalkSentence(node.say) : "";
}

// 文ごとに変わらないid（並び順が変わっても、ポインタの下のパネルが別の文にすり替わらない）
function getTalkSentenceId(sentence) {
    let hash = 0;
    for (const ch of sentence) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    return `talk-fav-${hash.toString(36)}`;
}

// 履歴は「{呼}、」を残した形で覚え、出すときに今の相手の呼び名を入れる
export function getFavoriteTalkTemplates() {
    return Object.entries(talkState.talkHistory.sentences)
        .sort((a, b) => (b[1].count - a[1].count) || (b[1].at - a[1].at))
        .slice(0, TALK_FAVORITE_LIMIT)
        .map(([template]) => template);
}

export function getFavoriteTalkSentences() {
    // タブを開いている間は並びを固定する（話すたびに入れ替わると選び直しになる）
    const templates = talkState.talkFavoriteOrder || getFavoriteTalkTemplates();
    return templates.map((template) => {
        const sentence = resolveTalkSentence(template);
        return { id: getTalkSentenceId(template), type: "phrase", name: sentence, template };
    });
}
