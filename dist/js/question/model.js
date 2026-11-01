// 質問と答えのデータ（既定の質問・自作の質問・答えの並び）
import { appState } from "../core/app-state.js";
import { getGeneratedIcon } from "../ui/icons.js";
import { SIMPLE_GRID_SIZES, buildSimpleSentence, getSimpleCatalog, panelStore } from "../panels/catalog.js";
import { TALK_AIZUCHI } from "../talk/model.js";
import { getSimplePanelGroup } from "../panels/custom-panel-editor.js";

// 質問への返事テンプレート
// 介助者が質問を選ぶと、回答パネルだけの画面に切り替わる。回答すると発話して元の画面へ戻る
export const QUESTION_CONFIG_KEY = "question_config_v1";
export const QUESTION_CUSTOM_KEY = "question_custom_v1";
// 質問モードで最後に出していた質問
export const QUESTION_MODE_LAST_KEY = "question_mode_last_id";
// 既定で出さない質問。保存済みの設定には、まだ知らない質問にだけ当てる（設定 → 質問でチェックすれば出せる）
// はい・いいえ は わかった？ と、ほかには？ は上の質問と重なるので出さない
// （重なっていた 体調は？・過ごし方は？・誰に会いたい？ は、体がつらい？・何がしたい？・家族のこと？ にまとめた）
export const QUESTION_DEFAULT_HIDDEN_IDS = ["q-yes-no", "q-other"];
// knownIds を持たない古い設定が、すでに知っている質問（このあとに足した質問だけ既定の非表示を当てる）
const QUESTION_LEGACY_PRESET_IDS = ["q-yes-no", "q-pain-where", "q-pain-level", "q-itch-where", "q-feeling", "q-temperature", "q-position", "q-want", "q-who"];
// お話モードの相づちも答えの候補にする（このグループ名で並ぶ）
const QUESTION_PANEL_GROUP_AIZUCHI = "相づち";
// 回答がないまま放置されたら元の画面へ戻す
export const QUESTION_TIMEOUT_MS = 90000;

// 8つずつ2段。同じ答えは1つの質問にだけ置く（暑い・寒いは「暑い？寒い？」、吸引・体の向きはそれぞれの質問、もう一度は「わかった？」）
// 1段目は体のこと: 気分 → 体がつらい？（体の不調。痛い・かゆいは次の質問で詳しく）→ 痛み・かゆみ → 暑さ寒さ → 体の向き → 吸引
// 2段目は暮らしと会話: 暮らし（お世話 → 部屋 → したいこと → 知りたいこと）→ 会話と心（わかった？ → 相づち → 気持ち → 家族）
// 設定 → 質問で並べ替えられる
// emoji: 質問モードの上のボタン・設定の「今すぐ質問する」に出すアイコン
// panelSource: 答えを既存のパネルのグループから出す（グループ名: 基本・体調・ケア… 任意）
// panelIds: 答えにする既存パネル（グループの一部だけ・グループをまたいで選ぶとき）
// answersFirst: 質問に書いた答えを既存パネルより前に並べる
// answers[].index: 答えを外したあとも元の並びの番号を保つ（生成アイコン・保存した答えの並びはこの番号で引く）
// silent: 切り替えても質問文を読み上げない
export const QUESTION_PRESETS = [
    {
        id: "q-feeling", emoji: "😊", label: "気分は？", question: "気分はどうですか？",
        answers: [
            { name: "いい", emoji: "😊", sentence: "気分はいいです。" },
            { name: "ふつう", emoji: "😐", sentence: "ふつうです。" },
            { name: "悪い", emoji: "😣", sentence: "気分が悪いです。" },
            { name: "疲れた", emoji: "😩", sentence: "疲れました。" }
        ]
    },
    // 体の不調だけ（お世話・気分転換・会話は別の質問へ）。気分が悪いは「気分は？」に置く
    {
        id: "q-what", emoji: "🤒", label: "体がつらい？", question: "体でつらいところはありますか？",
        panelIds: ["base-0-1", "base-0-0", "p-breath", "base-0-2", "p-dry-mouth", "p-cant-sleep", "p-period"]
    },
    {
        id: "q-pain-where", emoji: "🤕", label: "どこが痛い？", question: "どこが痛いですか？",
        answers: [
            { name: "頭", icon: "media/body-head.png", sentence: "頭が痛いです。" },
            { name: "首", sentence: "首が痛いです。" },
            { name: "肩", sentence: "肩が痛いです。" },
            { name: "胸", sentence: "胸が痛いです。" },
            { name: "お腹", sentence: "お腹が痛いです。" },
            { name: "背中", sentence: "背中が痛いです。" },
            { name: "腰", sentence: "腰が痛いです。" },
            { name: "手・腕", icon: "media/body-hand.png", sentence: "手か腕が痛いです。" },
            { name: "足", icon: "media/body-leg.png", sentence: "足が痛いです。" },
            { name: "のど・気切", sentence: "のどか、気切のところが痛いです。" },
            { name: "おしり", sentence: "おしりが痛いです。" },
            { name: "わからない", emoji: "❓", sentence: "どこが痛いかわかりません。" }
        ]
    },
    {
        id: "q-pain-level", emoji: "😣", label: "痛さは？", question: "どのくらい痛いですか？",
        answers: [
            { name: "少し", emoji: "🙂", sentence: "少し痛いです。" },
            { name: "まあまあ", emoji: "😐", sentence: "まあまあ痛いです。" },
            { name: "とても", emoji: "😣", sentence: "とても痛いです。" },
            { name: "がまんできない", emoji: "😭", sentence: "がまんできないほど痛いです。" }
        ]
    },
    {
        id: "q-itch-where", emoji: "🖐️", label: "かゆい所は？", question: "どこがかゆいですか？",
        answers: [
            { name: "頭", icon: "media/body-head.png", sentence: "頭がかゆいです。" },
            { name: "顔", sentence: "顔がかゆいです。" },
            { name: "背中", sentence: "背中がかゆいです。" },
            { name: "お腹", sentence: "お腹がかゆいです。" },
            { name: "手・腕", icon: "media/body-hand.png", sentence: "手か腕がかゆいです。" },
            { name: "足", icon: "media/body-leg.png", sentence: "足がかゆいです。" },
            { name: "おしり", sentence: "おしりがかゆいです。" },
            { name: "わからない", emoji: "❓", sentence: "どこがかゆいかわかりません。" }
        ]
    },
    {
        id: "q-temperature", emoji: "🌡️", label: "暑い？寒い？", question: "暑いですか？寒いですか？",
        answers: [
            { name: "暑い", icon: "media/symptom-hot.png", sentence: "暑いです。" },
            { name: "寒い", icon: "media/symptom-cold.png", sentence: "寒いです。" },
            { name: "ちょうどいい", emoji: "👌", sentence: "ちょうどいいです。" }
        ]
    },
    {
        id: "q-position", emoji: "🛏️", label: "体の向きは？", question: "体の向きはどうしますか？",
        answers: [
            { name: "右向き", emoji: "➡️", sentence: "右向きにしてください。" },
            { name: "左向き", emoji: "⬅️", sentence: "左向きにしてください。" },
            { name: "上向き", emoji: "⬆️", sentence: "上向きにしてください。" },
            { name: "頭を上げて", emoji: "🔼", sentence: "ベッドの頭を上げてください。" },
            { name: "頭を下げて", emoji: "🔽", sentence: "ベッドの頭を下げてください。" },
            { name: "このまま", emoji: "👌", sentence: "このままでいいです。" }
        ]
    },
    // 気管切開のため吸引の確認は多い
    {
        id: "q-suction", emoji: "💨", label: "吸引は？", question: "吸引しますか？",
        answers: [
            { name: "してほしい", emoji: "🙆‍♀️", sentence: "吸引してください。" },
            { name: "すぐに", emoji: "🆘", sentence: "すぐに吸引してください。" },
            { name: "あとで", emoji: "⏱️", sentence: "あとでお願いします。" },
            { name: "今はいい", emoji: "👌", sentence: "今は大丈夫です。" }
        ]
    },
    // 体のお世話・身だしなみ（吸引・体の向きはそれぞれの質問、部屋のことは「部屋は？」に置く）
    {
        id: "q-care", emoji: "🧴", label: "お世話は？", question: "お世話してほしいことはありますか？",
        panelIds: ["p-call", "base-1-3", "base-1-2", "p-face", "p-hair", "p-cream", "p-nails", "p-female-staff"]
    },
    // 明るさ・カーテン・音（暑さ寒さは「暑い？寒い？」に置く）
    {
        id: "q-room", emoji: "💡", label: "部屋は？", question: "部屋のことで何かありますか？",
        panelIds: ["p-curtain", "p-light", "p-dark"],
        answers: [
            { name: "静かにして", emoji: "🤫", sentence: "静かにしてください。" }
        ]
    },
    // 楽しみと休むこと（体を起こすは「体の向きは？」の頭を上げて、教えてほしいことは「知りたい？」）
    {
        id: "q-want", emoji: "✨", label: "何がしたい？", question: "何がしたいですか？", answersFirst: true,
        answers: [
            { name: "寝たい", emoji: "😴", sentence: "寝たいです。" },
            { index: 2, name: "動画・テレビ", emoji: "📺", sentence: "動画かテレビを見たいです。" },
            { index: 3, name: "音楽", emoji: "🎵", sentence: "音楽を聴きたいです。" },
            { index: 4, name: "スマホ", emoji: "📱", sentence: "スマホを見たいです。" },
            { index: 5, name: "お話したい", emoji: "💬", sentence: "お話ししたいです。" }
        ],
        panelIds: ["base-2-1", "p-mirror", "base-3-3"]
    },
    // 教えてほしいこと
    {
        id: "q-know", emoji: "🗞️", label: "知りたい？", question: "何か知りたいことはありますか？",
        panelIds: ["p-time", "p-news", "p-weather"],
        answers: [
            { name: "今日の予定", emoji: "📅", sentence: "今日の予定を教えてください。" }
        ]
    },
    // 失語症のため、介助者の話が伝わったかを確かめる
    {
        id: "q-understand", emoji: "👂", label: "わかった？", question: "わかりましたか？",
        answers: [
            { name: "わかった", emoji: "🙆‍♀️", sentence: "わかりました。" },
            { name: "少しわかった", emoji: "🤏", sentence: "少しわかりました。" },
            { name: "わからない", emoji: "🙅‍♀️", sentence: "わかりません。" },
            { name: "もう一度", emoji: "🔁", sentence: "もう一度言ってください。" },
            { name: "ゆっくり", emoji: "🐢", sentence: "ゆっくり話してください。" },
            { name: "書いて", emoji: "✍️", sentence: "紙に書いてください。" }
        ]
    },
    // 介助者が話している間に使うので、切り替えても読み上げない（silent）。もう一回・わからないは「わかった？」に置く。
    // 続きを話して・話題を変えても、話している最中に使う
    {
        id: "q-aizuchi", emoji: "😄", label: "相づち", question: "お話に、ひとことで返します", silent: true,
        panelIds: ["a-uun", "a-hee", "a-sorede", "a-wakaru", "a-ee", "a-laugh", "a-sugoi", "a-honto",
            "a-naruhodo", "a-iine", "a-yokatta", "a-taihen", "a-motto", "a-matte", "base-3-1", "base-3-2"]
    },
    // 気持ちと、相手に伝えるあいさつ（ねむいは「何がしたい？」の寝たいと重なるので入れない）
    {
        id: "q-heart", emoji: "💗", label: "気持ちは？", question: "今の気持ちや、伝えたいことはありますか？",
        panelIds: ["p-happy", "base-3-0", "p-anxious", "p-stay", "p-hold-hand", "p-alone",
            "p-good-morning", "p-good-night", "p-see-you"]
    },
    { id: "q-family", emoji: "👨‍👩‍👧", label: "家族のこと？", question: "家族のことで何かありますか？", panelSource: "家族" },
    // ここから既定で出さない質問（QUESTION_DEFAULT_HIDDEN_IDS）
    {
        id: "q-yes-no", emoji: "⭕", label: "はい・いいえ", question: "はい・いいえで答えてください",
        answers: [
            { name: "はい", emoji: "⭕", sentence: "はい。" },
            { name: "いいえ", emoji: "❌", sentence: "いいえ。" },
            { name: "わからない", emoji: "❓", sentence: "わからないです。" }
        ]
    },
    // 設定 → 質問モードで作った任意パネル（"任意" は SIMPLE_GROUP_CUSTOM）。ほかの表現はすべて上の質問にある
    { id: "q-other", emoji: "💬", label: "ほかには？", question: "ほかに何かありますか？", panelSource: "任意" }
];

function loadQuestionCustom() {
    try {
        const parsed = JSON.parse(localStorage.getItem(QUESTION_CUSTOM_KEY) || "[]");
        if (!Array.isArray(parsed)) return [];
        // 答えは文字で書いた answers と、既存パネルの panelIds のどちらか（両方でもよい）
        return parsed.filter(q => q && typeof q.id === "string" && typeof q.question === "string")
            .map(q => ({
                ...q,
                answers: Array.isArray(q.answers) ? q.answers : [],
                panelIds: Array.isArray(q.panelIds) ? q.panelIds.filter(id => typeof id === "string") : []
            }))
            .filter(q => q.answers.length + q.panelIds.length > 0);
    } catch {
        return [];
    }
}

// 質問 id → 答えの key の並び（答えを編集した質問だけ）
function sanitizeQuestionAnswerLayouts(raw) {
    const result = {};
    if (!raw || typeof raw !== "object") return result;
    Object.entries(raw).forEach(([id, keys]) => {
        if (Array.isArray(keys)) result[id] = keys.filter(key => typeof key === "string");
    });
    return result;
}

function loadQuestionConfig() {
    const presetIds = QUESTION_PRESETS.map(q => q.id);
    try {
        const parsed = JSON.parse(localStorage.getItem(QUESTION_CONFIG_KEY) || "null");
        const hiddenIds = Array.isArray(parsed?.hiddenIds) ? parsed.hiddenIds.filter(id => typeof id === "string") : [];
        const knownIds = Array.isArray(parsed?.knownIds) ? parsed.knownIds
            : parsed?.defaultHiddenApplied === true ? QUESTION_LEGACY_PRESET_IDS : [];
        QUESTION_DEFAULT_HIDDEN_IDS.forEach((id) => {
            if (!knownIds.includes(id) && !hiddenIds.includes(id)) hiddenIds.push(id);
        });
        return {
            hiddenIds,
            speakQuestion: parsed?.speakQuestion !== false,
            order: Array.isArray(parsed?.order) ? parsed.order.filter(id => typeof id === "string") : [],
            answerLayouts: sanitizeQuestionAnswerLayouts(parsed?.answerLayouts),
            // 回答パネルの数: 自動のときの最大。以前の質問ごとの固定（gridSizes）は使わない。
            // 未設定（廃止したシンプルモードと同じ数）は、その数（今のお話モードの数）を引き継ぐ
            gridSize: SIMPLE_GRID_SIZES[parsed?.gridSize] ? parsed.gridSize : panelStore.simpleConfig.gridSize,
            knownIds: presetIds
        };
    } catch {
        return { hiddenIds: [...QUESTION_DEFAULT_HIDDEN_IDS], speakQuestion: true, order: [], answerLayouts: {}, gridSize: panelStore.simpleConfig.gridSize, knownIds: presetIds };
    }
}

// 並べ替えた順。order に無いプリセット（後から増えた質問）は、プリセットの並びで直前にある、出している質問の後ろに入る
// （出していない質問は並びの端に置かれていることがあるので目印にしない）。order に無い任意の質問は最後
export function getQuestionCatalog(custom = questionStore.questionCustom, order = questionStore.questionConfig.order) {
    const catalog = [...QUESTION_PRESETS, ...custom.map(q => ({ ...q, custom: true }))];
    const rank = new Map(order.map((id, i) => [id, i]));
    const hidden = new Set(questionStore.questionConfig?.hiddenIds || []);
    let previous = -1;
    QUESTION_PRESETS.forEach((q, i) => {
        if (!rank.has(q.id)) rank.set(q.id, previous + (i + 1) / 1000);
        else if (!hidden.has(q.id)) previous = rank.get(q.id);
    });
    return catalog
        .map((q, i) => ({ q, i, r: rank.has(q.id) ? rank.get(q.id) : order.length + i }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map(x => x.q);
}

export function getQuestionLabel(q) {
    return q.label || q.question;
}

// 質問の答えに使えるパネル: 用意したパネル・任意パネル ＋ お話モードの相づち
export function getAnswerPanelCatalog(customPanels = panelStore.simpleCustomPanels) {
    return [...getSimpleCatalog(customPanels), ...TALK_AIZUCHI.map(a => ({ ...a, group: QUESTION_PANEL_GROUP_AIZUCHI }))];
}

// 質問に書いた答えの番号（index があればそれ。答えを外したプリセットで番号をずらさない）
function getQuestionAnswerNumber(answer, i) {
    return Number.isInteger(answer?.index) ? answer.index : i;
}

// 質問の答えの候補。key は、既存パネルならパネルの id、質問に書いた答えなら「質問id#番号」。
// panelId は元のパネル（アイコンを引く）
export function getQuestionAnswerCandidates(q, customPanels = panelStore.simpleCustomPanels) {
    const map = new Map();
    (Array.isArray(q.answers) ? q.answers : []).forEach((answer, i) => {
        const n = getQuestionAnswerNumber(answer, i);
        const key = `${q.id}#${n}`;
        // 生成アイコンは元の並びの番号で作ってある（scripts/gen_icon_sheets.mjs）ので、並べ替えても元の番号で引く
        map.set(key, { ...answer, key, iconId: `${q.id}-a${n}` });
    });
    getAnswerPanelCatalog(customPanels).forEach(p => map.set(p.id, { ...p, key: p.id, panelId: p.id, iconId: p.id }));
    return map;
}

// 答えを編集していない質問の並び: 選んだパネル（panelIds）→ グループのパネル（panelSource）→ 質問に書いた答え（answersFirst なら答えが先）
// （選んだパネルを先にして、数が変わる任意パネルのグループは後ろに並べる）
export function getDefaultQuestionAnswerKeys(q, customPanels = panelStore.simpleCustomPanels) {
    let keys = Array.isArray(q.panelIds) ? [...q.panelIds] : [];
    if (q.panelSource) {
        keys = keys.concat(getAnswerPanelCatalog(customPanels).filter(p => getSimplePanelGroup(p) === q.panelSource).map(p => p.id));
    }
    const answerKeys = (Array.isArray(q.answers) ? q.answers : []).map((answer, i) => `${q.id}#${getQuestionAnswerNumber(answer, i)}`);
    return [...new Set(q.answersFirst ? [...answerKeys, ...keys] : [...keys, ...answerKeys])];
}

// 質問の答え（設定 → 質問 の「答えのパネル」で並べ替えた質問は、その並び）
export function getQuestionAnswers(q, { customPanels = panelStore.simpleCustomPanels, answerLayouts = questionStore.questionConfig.answerLayouts } = {}) {
    const candidates = getQuestionAnswerCandidates(q, customPanels);
    const keys = answerLayouts?.[q.id] || getDefaultQuestionAnswerKeys(q, customPanels);
    return [...new Set(keys)].map(key => candidates.get(key)).filter(Boolean);
}

// 出す質問（設定 → 質問でチェックしたもの）。質問モードの上のボタンと設定の「今すぐ質問する」で共通
export function getVisibleQuestions() {
    const hidden = new Set(questionStore.questionConfig.hiddenIds);
    return getQuestionCatalog().filter(q => !hidden.has(q.id));
}

// 他のモジュールからも読み書きする状態
export const questionStore = {
    questionCustom: loadQuestionCustom(),
    questionConfig: loadQuestionConfig(),
    // 質問モードで直前に答えた文（質問文の右に出す）。別の質問の横に「前の答え」として出すのは数分だけ
    lastQuestionAnswer: null // { questionId, sentence, silent, at }
};
const QUESTION_LAST_ANSWER_KEEP_MS = 180000;

export function recordQuestionAnswer(item) {
    if (!appState.activeQuestion) return;
    questionStore.lastQuestionAnswer = { questionId: appState.activeQuestion.id, sentence: buildSimpleSentence(item), silent: Boolean(appState.activeQuestion.silent), at: Date.now() };
}

// 今の質問の横に出す答え（null なら出さない）。相づちは次の質問に持ち越さない
export function getShownQuestionAnswer() {
    if (!appState.activeQuestion || !questionStore.lastQuestionAnswer) return null;
    const isCurrent = questionStore.lastQuestionAnswer.questionId === appState.activeQuestion.id;
    if (!isCurrent && (questionStore.lastQuestionAnswer.silent || Date.now() - questionStore.lastQuestionAnswer.at > QUESTION_LAST_ANSWER_KEEP_MS)) return null;
    return { ...questionStore.lastQuestionAnswer, isCurrent };
}

// 質問のアイコン（自作の質問で未設定なら ❓）
const QUESTION_PRESET_IDS = new Set(QUESTION_PRESETS.map(q => q.id));

export function getQuestionEmoji(q) {
    return q.emoji || "❓";
}

export function getQuestionIcon(q) {
    if (!q) return "";
    if (q.icon) return q.icon;
    if (QUESTION_PRESET_IDS.has(q.id)) return `media/${q.id}.svg`;
    return getGeneratedIcon(q.id, "");
}
