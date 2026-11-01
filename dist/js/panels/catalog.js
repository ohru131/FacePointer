// 答えに使うパネル（基本・追加プリセット・任意パネル）と、パネル画面の設定

// 基本のパネル（id は base-グループ番号-番号。質問の答えから id で引くので並びを変えない）
const BASE_PANEL_GROUPS = [
    {
        options: [
            { name: "かゆい", icon: "media/menu-itchy.png", sentence: "かゆいです。" },
            { name: "痛い", icon: "media/menu-hurt.png", sentence: "痛いです。" },
            { name: "おなかが張る", icon: "media/menu-bloated-stomach.png", sentence: "おなかが張っています。" },
            { name: "あつい・さむい", icon: "media/menu-hot-cold.png", sentence: "暑いか寒いです。" }
        ]
    },
    {
        options: [
            { name: "吸引", icon: "media/menu-suction.png", sentence: "吸引してください。" },
            { name: "体位かえて", icon: "media/menu-change-position.png", sentence: "体位をかえてください。" },
            { name: "マッサージ", icon: "media/menu-massage.png", sentence: "マッサージしてください。" },
            { name: "おむつ変えて", icon: "media/menu-toilet.png", sentence: "おむつを変えてください。" }
        ]
    },
    {
        options: [
            { name: "お話して", icon: "media/menu-talk.png", sentence: "お話ししてください。" },
            { name: "本", icon: "media/menu-book.png", sentence: "本を読んでください。" },
            { name: "音楽", icon: "media/menu-music.png", sentence: "音楽を聴きたいです。" },
            { name: "DVD", icon: "media/menu-dvd.png", sentence: "DVDを見たいです。" }
        ]
    },
    {
        options: [
            { name: "ありがとう", icon: "media/menu-thank-you.png", sentence: "ありがとう。" },
            { name: "続きを話して", icon: "media/menu-continue-talking.png", sentence: "続きを話してください。" },
            { name: "話題を変えて", icon: "media/menu-change-topic.png", sentence: "話題を変えてください。" },
            { name: "少し休みたい", icon: "media/menu-rest-little.png", sentence: "少し休みたいです。" }
        ]
    }
];

export const SIMPLE_CONFIG_KEY = "simple_panel_config_v1";
export const SIMPLE_CUSTOM_PANELS_KEY = "simple_custom_panels_v1";
export const SIMPLE_GRID_SIZES = {
    // 3×1・4×1: 寝た姿勢などで縦に動かしにくい人向け（横1列）
    "3x1": { cols: 3, rows: 1 },
    "4x1": { cols: 4, rows: 1 },
    "2x2": { cols: 2, rows: 2 },
    "3x2": { cols: 3, rows: 2 },
    "3x3": { cols: 3, rows: 3 },
    "4x3": { cols: 4, rows: 3 },
    "4x4": { cols: 4, rows: 4 }
};
export const SIMPLE_GRID_SIZE_DEFAULT = "3x2";

// 基本のパネル（BASE_PANEL_GROUPS）に加えて、質問の答えに使えるプリセット
// 想定利用者: 40代女性・未婚、両親と姉・兄が1人ずつ。気管切開・胃ろう・カテーテル装着で入院/療養中
// group は設定画面の一覧で分類表示に使う
const SIMPLE_EXTRA_PRESETS = [
    // 返事（はい/いいえで答えられる質問への即答）
    { id: "p-yes", group: "返事", name: "はい", emoji: "⭕", sentence: "はい。" },
    { id: "p-no", group: "返事", name: "いいえ", emoji: "❌", sentence: "いいえ。" },
    { id: "p-not-that", group: "返事", name: "そうじゃない", emoji: "🙅‍♀️", sentence: "そうじゃないです。" },
    { id: "p-wait", group: "返事", name: "ちょっと待って", emoji: "✋", sentence: "ちょっと待ってください。" },
    { id: "p-dont-know", group: "返事", name: "わからない", emoji: "❓", sentence: "わからないです。" },
    { id: "p-again", group: "返事", name: "もう一度言って", emoji: "🔁", sentence: "もう一度言ってください。" },
    // 家族（両親・姉・兄）
    { id: "p-mother", group: "家族", name: "お母さん", emoji: "👩", sentence: "お母さんに会いたいです。" },
    { id: "p-father", group: "家族", name: "お父さん", emoji: "👨", sentence: "お父さんに会いたいです。" },
    { id: "p-sister", group: "家族", name: "お姉ちゃん", emoji: "👱‍♀️", sentence: "お姉ちゃんに会いたいです。" },
    { id: "p-brother", group: "家族", name: "お兄ちゃん", emoji: "🧑", sentence: "お兄ちゃんに会いたいです。" },
    { id: "p-call-family", group: "家族", name: "家族に電話", emoji: "📞", sentence: "家族に電話してください。" },
    { id: "p-family-ok", group: "家族", name: "家族は元気？", emoji: "🏠", sentence: "家族はみんな元気ですか？" },
    { id: "p-tell-thanks", group: "家族", name: "ありがとうと伝えて", emoji: "💐", sentence: "家族にありがとうと伝えてください。" },
    // 体調
    { id: "p-head-pain", group: "体調", name: "頭が痛い", icon: "media/body-head.png", sentence: "頭が痛いです。" },
    { id: "p-body-pain", group: "体調", name: "体が痛い", icon: "media/body-body.png", sentence: "体が痛いです。" },
    { id: "p-hand-pain", group: "体調", name: "手が痛い", icon: "media/body-hand.png", sentence: "手が痛いです。" },
    { id: "p-leg-pain", group: "体調", name: "足が痛い", icon: "media/body-leg.png", sentence: "足が痛いです。" },
    { id: "p-cold", group: "体調", name: "寒い", icon: "media/symptom-cold.png", sentence: "寒いです。" },
    { id: "p-hot", group: "体調", name: "暑い", icon: "media/symptom-hot.png", sentence: "暑いです。" },
    { id: "p-feel-bad", group: "体調", name: "気分が悪い", icon: "media/symptom-feel.png", sentence: "気分が悪いです。" },
    { id: "p-breath", group: "体調", name: "息が苦しい", emoji: "😮‍💨", sentence: "息が苦しいです。" },
    { id: "p-dry-mouth", group: "体調", name: "口が乾く", emoji: "💧", sentence: "口が乾いています。しめらせてください。" },
    { id: "p-period", group: "体調", name: "生理かも", emoji: "🩸", sentence: "生理が来たかもしれません。" },
    { id: "p-cant-sleep", group: "体調", name: "眠れない", emoji: "😣", sentence: "眠れません。" },
    // ケア・身だしなみ
    { id: "p-call", group: "ケア", name: "看護師さん呼んで", emoji: "🔔", sentence: "看護師さんを呼んでください。" },
    { id: "p-female-staff", group: "ケア", name: "女性の方に", emoji: "👩‍⚕️", sentence: "女性の方にお願いしたいです。" },
    { id: "p-curtain", group: "ケア", name: "カーテン閉めて", emoji: "🙈", sentence: "カーテンを閉めてください。" },
    { id: "p-hair", group: "ケア", name: "髪をとかして", emoji: "💇‍♀️", sentence: "髪をとかしてください。" },
    { id: "p-face", group: "ケア", name: "顔をふいて", emoji: "🧼", sentence: "顔をふいてください。" },
    { id: "p-cream", group: "ケア", name: "クリームぬって", emoji: "🧴", sentence: "クリームをぬってください。" },
    { id: "p-nails", group: "ケア", name: "爪を切って", emoji: "💅", sentence: "爪を切ってください。" },
    { id: "p-mirror", group: "ケア", name: "鏡を見たい", emoji: "🤳", sentence: "鏡を見たいです。" },
    // 過ごし方
    { id: "p-phone", group: "過ごし方", name: "スマホ見たい", emoji: "📱", sentence: "スマホを見たいです。" },
    { id: "p-video", group: "過ごし方", name: "動画が見たい", emoji: "📺", sentence: "動画を見たいです。" },
    { id: "p-news", group: "過ごし方", name: "今日のこと", emoji: "🗞️", sentence: "今日の出来事を教えてください。" },
    { id: "p-weather", group: "過ごし方", name: "外の様子", emoji: "🌤️", sentence: "外の様子を教えてください。" },
    { id: "p-time", group: "過ごし方", name: "いま何時？", emoji: "🕐", sentence: "いま何時ですか？" },
    { id: "p-light", group: "過ごし方", name: "電気つけて", emoji: "💡", sentence: "電気をつけてください。" },
    { id: "p-dark", group: "過ごし方", name: "暗くして", emoji: "🌙", sentence: "暗くしてください。" },
    { id: "p-alone", group: "過ごし方", name: "一人にして", emoji: "🚶‍♀️", sentence: "少し一人にしてください。" },
    // 気持ち（気持ち＋してほしいことをセットで伝える）
    { id: "p-anxious", group: "気持ち", name: "不安", emoji: "😟", sentence: "不安なので、そばにいてください。" },
    { id: "p-stay", group: "気持ち", name: "そばにいて", emoji: "🤝", sentence: "そばにいてください。" },
    { id: "p-hold-hand", group: "気持ち", name: "手をにぎって", emoji: "🤲", sentence: "手をにぎってください。" },
    { id: "p-happy", group: "気持ち", name: "うれしい", emoji: "😊", sentence: "うれしいです。" },
    { id: "p-sleepy", group: "気持ち", name: "ねむい", emoji: "😴", sentence: "ねむいです。" },
    // あいさつ
    { id: "p-good-morning", group: "あいさつ", name: "おはよう", emoji: "🌅", sentence: "おはようございます。" },
    { id: "p-good-night", group: "あいさつ", name: "おやすみ", emoji: "🛌", sentence: "おやすみなさい。" },
    { id: "p-see-you", group: "あいさつ", name: "また来てね", emoji: "👋", sentence: "また来てくださいね。" }
];

function loadSimpleCustomPanels() {
    try {
        const parsed = JSON.parse(localStorage.getItem(SIMPLE_CUSTOM_PANELS_KEY) || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(p => p && typeof p.id === "string" && typeof p.name === "string" && p.name.trim());
    } catch {
        return [];
    }
}

function getSimpleBasePanels() {
    return BASE_PANEL_GROUPS.flatMap((category, ci) => (category.options || []).map((option, oi) => ({
        id: `base-${ci}-${oi}`,
        name: option.name,
        icon: option.icon,
        sentence: option.sentence
    })));
}

export function getSimpleCatalog(customPanels = panelStore.simpleCustomPanels) {
    return [...getSimpleBasePanels(), ...SIMPLE_EXTRA_PRESETS, ...customPanels.map(p => ({ ...p, custom: true }))];
}

function defaultSimpleConfig() {
    return {
        gridSize: SIMPLE_GRID_SIZE_DEFAULT,
        showRest: true,
        confirmSound: true
    };
}

function loadSimpleConfig() {
    const fallback = defaultSimpleConfig();
    try {
        const parsed = JSON.parse(localStorage.getItem(SIMPLE_CONFIG_KEY) || "null");
        if (!parsed || typeof parsed !== "object") return fallback;
        return {
            gridSize: SIMPLE_GRID_SIZES[parsed.gridSize] ? parsed.gridSize : fallback.gridSize,
            showRest: parsed.showRest !== false,
            confirmSound: parsed.confirmSound !== false
        };
    } catch {
        return fallback;
    }
}

// 他のモジュールからも読み書きする状態
export const panelStore = {
    simpleCustomPanels: loadSimpleCustomPanels(),
    simpleConfig: loadSimpleConfig()
};

export function buildSimpleSentence(item) {
    if (item.sentence && item.sentence.trim()) return item.sentence.trim();
    return `${item.name}。`;
}
export const SIMPLE_FILTER_ALL = "all";
export const SIMPLE_GROUP_BASE = "基本";
export const SIMPLE_GROUP_CUSTOM = "任意";
