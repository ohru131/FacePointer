// 会話パターンの検査。error があると登録できない。warning は表示が詰まるなどの注意
// 上限は dist/talk-generator.js と同じ（アプリは1段に5つずつ、4段までを想定した画面）

export const LIMITS = { topicMax: 8, childrenMax: 5, depthMax: 4, labelMax: 12, sayMax: 80, partnerMax: 6 };
const TIMES = ["morning", "day", "evening"];
const KEY_SAFE = /^[A-Za-z0-9_-]+$/;
const PARTNER_ID = /^[a-z0-9_-]+$/;
const CALL = "{呼}";

const graphemes = new Intl.Segmenter("ja", { granularity: "grapheme" });
export function textLength(text) {
    return [...graphemes.segment(text || "")].length;
}

export function validateTalkSet(set) {
    const issues = [];
    const add = (level, message, nodeId = "") => issues.push({ level, message, nodeId });

    const name = typeof set.name === "string" ? set.name : "";
    if (!name.trim()) add("error", "パターンの名前がありません");
    else if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(name)) add("error", "パターンの名前に改行などの制御文字は使えません");
    else if (textLength(name) > 40) add("error", "パターンの名前は40文字までにしてください");
    if (!KEY_SAFE.test(set.id || "")) add("error", `パターンの id「${set.id}」に使えない文字があります`);

    const partnerIds = new Set();
    (set.partners || []).forEach((p, i) => {
        const where = `相手${i + 1}（${p.name || "名前なし"}）`;
        if (!p.name || !p.name.trim()) add("error", `${where}: 呼び名がありません`);
        if (!PARTNER_ID.test(p.id || "") || p.id === "none") add("error", `${where}: id は英小文字・数字・-_ だけ（none 以外）にしてください`);
        else if (partnerIds.has(p.id)) add("error", `${where}: id「${p.id}」が重複しています`);
        partnerIds.add(p.id);
    });
    if ((set.partners || []).length > LIMITS.partnerMax) add("warning", `相手が${LIMITS.partnerMax}人を超えています（1画面に並びきらないことがあります）`);

    const tree = set.tree || [];
    if (tree.length === 0) add("error", "話題がありません");
    if (tree.length > LIMITS.topicMax) add("warning", `話題が${LIMITS.topicMax}個を超えています`);

    const ids = new Set();
    const walk = (nodes, depth, trail) => {
        for (const node of nodes) {
            const name = [...trail, node.label || "（ラベルなし）"].join(" > ");
            const children = node.children || [];
            if (!KEY_SAFE.test(node.id || "")) add("error", `${name}: id に使えない文字があります`, node.id);
            else if (ids.has(node.id)) add("error", `${name}: id「${node.id}」が重複しています`, node.id);
            ids.add(node.id);

            if (!node.label || !node.label.trim()) add("error", `${name}: パネルの文字がありません`, node.id);
            else if (textLength(node.label) > LIMITS.labelMax) add("warning", `${name}: パネルの文字が${LIMITS.labelMax}文字を超えています`, node.id);

            const say = node.say || "";
            if (depth === 1) {
                if (say) add("warning", `${name}: 一番上の話題の言葉は使われません（話題を選ぶと次の段に進みます）`, node.id);
                if (children.length === 0) add("error", `${name}: 話題の下に言葉がありません`, node.id);
            } else if (!say && children.length === 0) {
                add("error", `${name}: 読み上げる言葉も続きもありません`, node.id);
            }
            if (say) {
                // アプリは文頭の「{呼}、」だけを呼び名に置き換える（相手を選んでいなければ消す）
                const calls = say.split(CALL).length - 1;
                if (calls > 1 || (calls === 1 && !say.startsWith(`${CALL}、`))) {
                    add("error", `${name}: {呼} は文頭に「{呼}、」の形で1回だけ書けます`, node.id);
                }
                if (textLength(say) > LIMITS.sayMax) add("warning", `${name}: 言葉が${LIMITS.sayMax}文字を超えています`, node.id);
            }
            if (children.length > LIMITS.childrenMax) add("warning", `${name}: 続きが${LIMITS.childrenMax}個を超えています（ページ送りが必要になります）`, node.id);
            if (depth >= LIMITS.depthMax && children.length > 0) add("error", `${name}: ${LIMITS.depthMax}段より深くできません`, node.id);
            for (const id of node.for || []) {
                if (!partnerIds.has(id)) add("error", `${name}: 相手「${id}」がいません`, node.id);
            }
            if (node.time !== undefined) {
                if (!TIMES.includes(node.time)) add("error", `${name}: 時間帯の値が正しくありません`, node.id);
                else if (depth === 1) add("error", `${name}: 時間帯は一番上の話題には付けられません（話題ごと消えるため）`, node.id);
            }
            walk(children, depth + 1, [...trail, node.label || "（ラベルなし）"]);
        }
    };
    walk(tree, 1, []);
    return issues;
}
