// お話モードの会話パターンを Gemini で作る
// 1. プロフィール（性別・年齢）と前回の回答から、介助者へのインタビュー質問を作る
// 2. 回答から会話の木（talk-data.js と同じ形）と相手の一覧を作り、アプリで使える形に整える

export const TALK_AI_MODEL_DEFAULT = "gemini-2.5-flash";
const REQUEST_TIMEOUT_MS = 240000;

const TOPIC_MAX = 6;
const CHILDREN_MAX = 5;
const DEPTH_MAX = 4;
const LABEL_MAX = 12;
const SAY_MAX = 80;
const PARTNER_MAX = 6;
const TIMES = ["morning", "day", "evening"];
const CALL = "{呼}";

const GENDER_LABELS = { female: "女性", male: "男性", other: "その他・答えない" };

function describeProfile(profile) {
    const parts = [];
    if (profile?.gender && GENDER_LABELS[profile.gender]) parts.push(`性別: ${GENDER_LABELS[profile.gender]}`);
    if (Number.isFinite(profile?.age) && profile.age > 0) parts.push(`年齢: ${profile.age}歳`);
    return parts.length > 0 ? parts.join(" / ") : "（未入力）";
}

function describeInterview(interview) {
    const answered = (interview || []).filter(item => item.q && item.a && item.a.trim());
    if (answered.length === 0) return "（まだ回答なし）";
    return answered.map((item, i) => `Q${i + 1}. ${item.q}\nA. ${item.a.trim()}`).join("\n\n");
}

async function callGemini(apiKey, model, prompt, { temperature = 0.8, signal } = {}) {
    if (!apiKey) throw new Error("Gemini APIキーが設定されていません（設定 → 音声）。");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || TALK_AI_MODEL_DEFAULT)}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { temperature, responseMimeType: "application/json" }
            })
        });
        if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(`Gemini API エラー ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
        }
        const data = await response.json();
        const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
        if (!text) throw new Error(`Gemini から応答がありません（${data.candidates?.[0]?.finishReason || "理由不明"}）`);
        return parseJsonLoose(text);
    } catch (error) {
        if (error.name === "AbortError") throw new Error("Gemini の応答が時間切れになりました。もう一度お試しください。");
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

// コードブロックや前後の説明文が付いていても JSON 部分を取り出す
function parseJsonLoose(text) {
    try {
        return JSON.parse(text);
    } catch {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
        throw new Error("Gemini の応答を読み取れませんでした。");
    }
}

// ---------------------------------------------------------
// インタビュー質問
// ---------------------------------------------------------
export async function generateInterviewQuestions({ apiKey, model, profile, interview, signal }) {
    const prompt = `あなたは意思伝達装置（AAC）の会話パターンを作る支援者です。
利用者は脳卒中などで発話や手の動きが難しく、頭の動きで画面のパネルを選んで、用意した文を音声で読み上げて会話します。
これから家族・介助者にインタビューし、その答えをもとに「利用者が家族や看護師と話したくなる会話」を数百文用意します。

利用者のプロフィール: ${describeProfile(profile)}

これまでのインタビュー:
${describeInterview(interview)}

会話パターンを本人らしくするために、家族・介助者に聞くべき質問を 8〜10 個作ってください。
- これまでの回答で分かっていることは聞かない。回答が短いものは、具体的に深掘りする質問にする
- まだ聞いていなければ優先: 家族構成と本人からの呼び方（例: お母さん/ママ）、よく面会に来る人、好きなこと（作品名・人物名など具体的に）、昔の仕事・地元・思い出、話し方（敬語/タメ口/方言）、口から食べられるかなど体の状態、避けたい話題
- 介助者が答えやすい、短く具体的な日本語の質問にする

JSON のみで出力: {"questions": ["質問1", "質問2", ...]}`;
    const result = await callGemini(apiKey, model, prompt, { temperature: 0.7, signal });
    const questions = Array.isArray(result?.questions) ? result.questions : [];
    return questions.map(q => String(q).trim()).filter(Boolean).slice(0, 12);
}

// ---------------------------------------------------------
// 会話パターン
// ---------------------------------------------------------
export async function generateTalkSet({ apiKey, model, profile, interview, setId, signal }) {
    const prompt = `あなたは意思伝達装置（AAC）の会話パターンを作る支援者です。
利用者は発話や手の動きが難しく、頭の動きでパネルを選んで、用意した文を音声で読み上げて会話します。
画面には1段に最大5つの選択肢が出て、「話題 → 内容 → …」と2〜4回選ぶと1文になります。どの段でも確定でき、続きのない言葉は選んだらそのまま話します。

利用者のプロフィール: ${describeProfile(profile)}

家族・介助者へのインタビュー:
${describeInterview(interview)}

この人のための会話パターンを作ってください。

## 出力（JSON のみ）
{
  "name": "このパターンの短い名前（例: 40代女性・刀剣乱舞とジブリ好き）。20文字以内",
  "partners": [ { "key": "mother", "name": "お母さん", "emoji": "👩" }, ... ],
  "tree": [ 話題ノード × 6 ]
}
ノード: { "l": "パネルの文字", "e": "絵文字1つ", "s": "読み上げる文", "c": [子ノード], "f": ["partner key"], "t": "morning" }

## partners（話し相手）
- インタビューから分かる、よく話す相手を最大${PARTNER_MAX}人。本人からの呼び方を name にする（例: お母さん、パパ、〇〇ちゃん）。看護師・ヘルパーなどもいれば入れる
- key は英小文字の短い識別子（mother, father, sister1, nurse など）

## tree のルール
- 一番上は話題ちょうど${TOPIC_MAX}個（"s" なし）。あいさつ・気持ち・相手に聞きたいこと・好きなこと（作品名など具体的に）・思い出・お願い などを、この人に合わせて
- "c" は1ノードにつき最大${CHILDREN_MAX}個。深さは最大${DEPTH_MAX}段（話題が1段目）。2段で終わる会話、3段、4段を混ぜる
- "l" は短く（8文字程度、最大${LABEL_MAX}文字）。大きな文字でパネルに表示する
- "s" は自然な話し言葉の1〜2文（${SAY_MAX}文字以内）、。？！で終える。子のないノードには必ず "s"。子のあるノードの "s" は省略可（あるとその段で確定できる）
- 相手への呼びかけは、文頭に "{呼}、" とだけ書く（相手の呼び名に置き換わる。相手を選んでいなければ消える）。それ以外の場所に {呼} を書かない。{呼} がなくても自然に読める文にする
- "f" はその相手と話すときだけ出すノード（例: 父にだけ聞く話題、家族向けの思い出を看護師には出さない）。多用しない
- "t" はあいさつだけに使う（morning / day / evening のときだけ出る）
- インタビューの答え（話し方・呼び方・好きなもの・体の状態・避けたい話題）を必ず反映する。分からない事実（職業名・地名など）は作らない
- 暗い気持ちを表す文は、してほしいこと（そばにいて、話を聞いて 等）と組にする
- 同じ親の中で似た文を重ねない。全体で 180〜260 ノード程度`;
    const result = await callGemini(apiKey, model, prompt, { temperature: 0.8, signal });
    const partners = sanitizePartners(result?.partners);
    const tree = sanitizeTalkTree(result?.tree, setId, new Set(partners.map(p => p.id)));
    if (tree.length === 0) throw new Error("会話パターンを作れませんでした（Gemini の応答が空でした）。");
    const name = String(result?.name || "").trim().slice(0, 24) || "AIで作った会話";
    return { name, partners, tree };
}

function sanitizePartners(raw) {
    const used = new Set();
    const partners = [];
    (Array.isArray(raw) ? raw : []).forEach((item, i) => {
        const name = String(item?.name || "").trim().slice(0, 10);
        if (!name || partners.length >= PARTNER_MAX) return;
        let id = String(item?.key || "").toLowerCase().replace(/[^a-z0-9_-]/g, "") || `p${i + 1}`;
        while (used.has(id)) id += "x";
        used.add(id);
        partners.push({ id, name, emoji: String(item?.emoji || "🙂").slice(0, 8) });
    });
    return partners;
}

// 「{呼}、」は文頭だけに残す（区切りの揺れも直す）
function normalizeSay(raw) {
    let say = String(raw || "").trim().slice(0, SAY_MAX);
    if (!say) return "";
    const leading = say.startsWith(CALL);
    say = say.split(CALL).join("").replace(/^[、,，\s]+/, "").trim();
    if (!say) return "";
    if (!/[。？！?!」）)]$/.test(say)) say += "。";
    return leading ? `${CALL}、${say}` : say;
}

// Gemini の出力をアプリの形（id / label / emoji / say / children / for / time）に整え、上限を守らせる
export function sanitizeTalkTree(raw, setId, partnerIds) {
    const convert = (node, depth, id) => {
        if (!node || typeof node !== "object") return null;
        const label = String(node.l ?? node.label ?? "").trim().slice(0, LABEL_MAX);
        if (!label) return null;
        const out = { id, label };
        const emoji = String(node.e ?? node.emoji ?? "").trim().slice(0, 8);
        if (emoji) out.emoji = emoji;
        const say = depth > 1 ? normalizeSay(node.s ?? node.say) : "";
        if (say) out.say = say;
        if (depth < DEPTH_MAX) {
            const children = (Array.isArray(node.c ?? node.children) ? (node.c ?? node.children) : [])
                .slice(0, CHILDREN_MAX)
                .map((child, i) => convert(child, depth + 1, `${id}-${i + 1}`))
                .filter(Boolean);
            if (children.length > 0) out.children = children;
        }
        const forIds = (Array.isArray(node.f ?? node.for) ? (node.f ?? node.for) : [])
            .map(key => String(key).toLowerCase()).filter(key => partnerIds.has(key));
        if (forIds.length > 0) out.for = forIds;
        const time = node.t ?? node.time;
        if (TIMES.includes(time)) out.time = time;
        // 話せない（文も続きもない）言葉は捨てる
        if (!out.say && !out.children) return null;
        return out;
    };
    return (Array.isArray(raw) ? raw : [])
        .slice(0, TOPIC_MAX)
        .map((topic, i) => convert(topic, 1, `${setId}-${i + 1}`))
        .filter(topic => topic && topic.children);
}

export function countTalkTreeNodes(nodes) {
    return (nodes || []).reduce((sum, node) => sum + 1 + countTalkTreeNodes(node.children), 0);
}
