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

// 文字数での切り詰めで絵文字（サロゲートペア・ZWJ連結）を壊さない
const graphemeSegmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("ja", { granularity: "grapheme" }) : null;

function splitGraphemes(text) {
    return graphemeSegmenter ? Array.from(graphemeSegmenter.segment(text), part => part.segment) : Array.from(text);
}

function truncateText(text, max) {
    return splitGraphemes(text).slice(0, max).join("");
}

function firstEmoji(raw) {
    const text = typeof raw === "string" ? raw.trim() : "";
    return text ? splitGraphemes(text)[0] : "";
}

function asText(raw) {
    return typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
}

// 相手の key と、ノードの f（その相手のときだけ出す）を同じ規則でそろえる
function normalizePartnerKey(raw) {
    return asText(raw).toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

async function callGemini(apiKey, model, prompt, { temperature = 0.8, signal } = {}) {
    if (!apiKey) throw new Error("Gemini APIキーが設定されていません（設定 → 音声）。");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || TALK_AI_MODEL_DEFAULT)}:generateContent`;
        const response = await fetch(url, {
            method: "POST",
            // キーは URL に載せずヘッダーで送る
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
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
        const candidate = data.candidates?.[0];
        const text = (candidate?.content?.parts || []).map(p => p.text || "").join("");
        if (candidate?.finishReason === "MAX_TOKENS") {
            throw new Error("Gemini の出力が長すぎて途中で切れました。出力上限の大きいモデル（gemini-2.5-flash など）を使ってください。");
        }
        if (!text) {
            const reason = data.promptFeedback?.blockReason || candidate?.finishReason || "理由不明";
            throw new Error(`Gemini から応答がありません（${reason}）。回答の内容を見直してもう一度お試しください。`);
        }
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
        const start = text.search(/[[{]/);
        const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(text.slice(start, end + 1));
            } catch { /* 下で日本語のエラーにする */ }
        }
        throw new Error("Gemini の応答を読み取れませんでした。もう一度お試しください。");
    }
}

// ---------------------------------------------------------
// インタビュー質問
// ---------------------------------------------------------
export async function generateInterviewQuestions({ apiKey, model, profile, interview, signal }) {
    const unanswered = (interview || []).filter(item => item.q && !(item.a && item.a.trim())).map(item => `- ${item.q}`);
    const prompt = `あなたは意思伝達装置（AAC）の会話パターンを作る支援者です。
利用者は脳卒中などで発話や手の動きが難しく、頭の動きで画面のパネルを選んで、用意した文を音声で読み上げて会話します。
これから家族・介助者にインタビューし、その答えをもとに「利用者が家族や看護師と話したくなる会話」を数百文用意します。

利用者のプロフィール: ${describeProfile(profile)}

これまでのインタビュー:
${describeInterview(interview)}
${unanswered.length > 0 ? `\nすでに聞いたが未回答の質問（同じ内容をくり返さない）:\n${unanswered.join("\n")}\n` : ""}
会話パターンを本人らしくするために、家族・介助者に聞くべき質問を 8〜10 個作ってください。
- これまでの回答で分かっていることは聞かない。回答が短いものは、具体的に深掘りする質問にする
- まだ聞いていなければ優先: 家族構成と本人からの呼び方（例: お母さん/ママ）、よく面会に来る人、好きなこと（作品名・人物名など具体的に）、昔の仕事・地元・思い出、話し方（敬語/タメ口/方言）、口から食べられるかなど体の状態、避けたい話題
- 介助者が答えやすい、短く具体的な日本語の質問にする

JSON のみで出力: {"questions": ["質問1", "質問2", ...]}`;
    const result = await callGemini(apiKey, model, prompt, { temperature: 0.7, signal });
    const questions = Array.isArray(result) ? result : (Array.isArray(result?.questions) ? result.questions : []);
    return questions
        .map(q => asText(typeof q === "object" && q ? (q.question ?? q.text ?? q.q) : q))
        .filter(Boolean)
        .slice(0, 12);
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
    const rawTree = Array.isArray(result) ? result : (result?.tree ?? result?.topics);
    const tree = sanitizeTalkTree(rawTree, setId, new Set(partners.map(p => p.id)));
    if (tree.length === 0) throw new Error("会話パターンを作れませんでした（Gemini の応答が想定と違いました）。もう一度お試しください。");
    const name = truncateText(asText(result?.name), 24) || "AIで作った会話";
    return { name, partners, tree };
}

function sanitizePartners(raw) {
    // "none" はアプリ側の「決めない」と同じ id になるので使わない
    const used = new Set(["", "none"]);
    const partners = [];
    (Array.isArray(raw) ? raw : []).forEach((item, i) => {
        const name = truncateText(asText(item?.name), 10);
        if (!name || partners.length >= PARTNER_MAX) return;
        const key = normalizePartnerKey(item?.key ?? item?.id);
        // 重複した key は捨てる（f の参照先があいまいになるため）
        if (used.has(key) && key) return;
        const id = key || `p${i + 1}`;
        used.add(id);
        partners.push({ id, name, emoji: firstEmoji(item?.emoji) || "🙂" });
    });
    return partners;
}

// 「{呼}、」は文頭だけに残す（区切りの揺れも直す）
function normalizeSay(raw) {
    let say = asText(raw);
    if (!say) return "";
    const leading = say.startsWith(CALL);
    // 文中の {呼} は（後ろの読点ごと）取り除く。先に除いてから長さをそろえる
    say = say.replace(/\{呼\}[、,，]?/g, "").replace(/^[、,，\s]+/, "").trim();
    if (splitGraphemes(say).length > SAY_MAX) {
        const cut = truncateText(say, SAY_MAX);
        const lastStop = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("？"), cut.lastIndexOf("！"));
        say = lastStop > 0 ? cut.slice(0, lastStop + 1) : cut;
    }
    if (!say) return "";
    if (!/[。？！?!」）)]$/.test(say)) say += "。";
    return leading ? `${CALL}、${say}` : say;
}

// Gemini の出力をアプリの形（id / label / emoji / say / children / for / time）に整え、上限を守らせる
export function sanitizeTalkTree(raw, setId, partnerIds) {
    const convert = (node, depth, id) => {
        if (!node || typeof node !== "object") return null;
        const label = truncateText(asText(node.l ?? node.label), LABEL_MAX);
        if (!label) return null;
        const out = { id, label };
        const emoji = firstEmoji(node.e ?? node.emoji);
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
            .map(normalizePartnerKey).filter(key => partnerIds.has(key));
        if (forIds.length > 0) out.for = [...new Set(forIds)];
        // 時間帯は個々のあいさつだけ（話題ごと消えないよう、一番上には付けない）
        const time = node.t ?? node.time;
        if (depth > 1 && TIMES.includes(time)) out.time = time;
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
