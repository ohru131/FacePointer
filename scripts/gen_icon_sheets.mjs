#!/usr/bin/env node
// 図のない項目（お話モードの会話の木・相手・あいづち、かんたんモードの追加パネル、質問の答え）の
// アイコンを Gemini で 5列×4行のシートにまとめて作り、1枚ずつに分割して dist/media/gen/ に置く。
// APIキーはリポジトリ直下の .env（gitignore 済み）の GEMINI_API_KEY から読む。
//
//   node scripts/gen_icon_sheets.mjs --dry-run        対象とシート割りだけ表示（APIを呼ばない）
//   node scripts/gen_icon_sheets.mjs --limit 1        1シートだけ作って仕上がりを確認
//   node scripts/gen_icon_sheets.mjs                  画像のない項目をすべて作る
//   node scripts/gen_icon_sheets.mjs --split-only     保存済みシートを分割し直す（APIを呼ばない）
//   node scripts/gen_icon_sheets.mjs --only greet-    id の前方一致で絞る（--force で作り直し）
//   node scripts/gen_icon_sheets.mjs --list-models    画像を作れるモデルの一覧

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const { applyEdgeConnectedTransparency, trimTopSparseRows, detectGridBands } = require("./split_menu_sheet.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = path.join(ROOT, "dist");
const GEN_DIR = path.join(DIST_DIR, "media", "gen");
const SHEET_DIR = path.join(ROOT, "scripts", "generated-sheets");
const SHEET_LOG = path.join(SHEET_DIR, "sheets.json");
const ICON_MANIFEST = path.join(DIST_DIR, "icon-images.js");
// talk studio で登録した組み込みの会話パターン（1パターン1ファイル + index.js）
export const PUBLISHED_DIR = path.join(DIST_DIR, "talk-sets");
// 各アイコンを作ったときの内容（desc）のハッシュ。内容が変わった項目（答えの並び替えなど）は古い絵を使わず作り直す
const ICON_SOURCES = path.join(ROOT, "scripts", "icon-sources.json");
// 標準（simple）テイストの見本。メニューアイコンの元シート
const STYLE_REFERENCE = path.join(ROOT, "scripts", "Gemini_Generated_Image_j0qvdaj0qvdaj0qv.png");

const COLS = 5;
const ROWS = 4;
const PER_SHEET = COLS * ROWS;
const ICON_MAX_PX = 360;
// 透過付きでも PNG の約1/4 の大きさで済む（アプリのアイコン表示では画質の差は見えない）
const ICON_EXT = ".webp";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 300000;

export function loadEnv() {
    if (typeof process.loadEnvFile !== "function") throw new Error("Node.js 20.12 以降で実行してください");
    try {
        process.loadEnvFile(path.join(ROOT, ".env"));
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    return {
        apiKey: process.env.GEMINI_API_KEY || "",
        model: process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image",
        // 空にすると imageSize を送らない（imageSize 非対応のモデル向け）
        imageSize: process.env.GEMINI_IMAGE_SIZE ?? "2K"
    };
}

function parseArgs(argv) {
    const args = { dryRun: false, splitOnly: false, force: false, listModels: false, limit: Infinity, only: "" };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--dry-run") args.dryRun = true;
        else if (a === "--split-only") args.splitOnly = true;
        else if (a === "--force") args.force = true;
        else if (a === "--list-models") args.listModels = true;
        else if (a === "--limit") args.limit = Number.parseInt(argv[++i], 10);
        else if (a === "--only") args.only = argv[++i] || "";
        else throw new Error(`Unknown option: ${a}`);
        // 値なしの --only は全件に一致し、--force と組み合わせると全シートを作り直してしまう
        if (a === "--only" && (!args.only || args.only.startsWith("--"))) throw new Error("--only には id の先頭部分を指定してください");
    }
    if (!(args.limit > 0)) throw new Error("--limit には 1 以上の数を指定してください");
    if (args.splitOnly && args.dryRun) throw new Error("--split-only と --dry-run は同時に指定できません");
    return args;
}

// app.js はブラウザ用でそのまま読み込めないため、定数の配列リテラルだけ取り出して評価する
export function extractArrayLiteral(source, name) {
    const head = `const ${name} = [`;
    const start = source.indexOf(head);
    if (start < 0) throw new Error(`${name} not found in app.js`);
    let depth = 0;
    let quote = "";
    for (let i = start + head.length - 1; i < source.length; i++) {
        const ch = source[i];
        if (quote) {
            if (ch === "\\") i++;
            else if (ch === quote) quote = "";
            continue;
        }
        if (ch === "\"" || ch === "'" || ch === "`") quote = ch;
        else if (ch === "[") depth++;
        else if (ch === "]" && --depth === 0) {
            return vm.runInNewContext(`(${source.slice(start + head.length - 1, i + 1)})`);
        }
    }
    throw new Error(`${name} is not terminated`);
}

// 標準の画風では body-/symptom- の白黒ピクトグラムになるため、これらは絵を作って置き換える
function isPictogram(icon) {
    return /^media\/(body|symptom)-/.test(icon || "");
}

function stripCall(say) {
    return (say || "").replace(/^\{呼\}、/, "").trim();
}

// dist は "type": "module" 指定がなく、ファイルのまま import すると警告が出るため中身を渡す（相対 import のないファイル用）
async function importSource(file) {
    const source = fs.readFileSync(file, "utf8");
    return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

// 会話の木の各ノード。説明には上の話題のたどりも入れて、同じラベルでも場面を描き分けさせる
export function talkTreeTargets(tree) {
    const targets = [];
    const walk = (nodes, trail) => {
        for (const node of nodes) {
            const context = trail.length > 0 ? `（話題: ${trail.join(" > ")}）` : "（話題の大分類）";
            const say = stripCall(node.say);
            targets.push({
                key: node.id,
                desc: `「${node.label}」${context}${say ? ` 主人公の言葉: ${say}` : ""} 絵文字のイメージ: ${node.emoji || "なし"}`
            });
            if (node.children) walk(node.children, [...trail, node.label]);
        }
    };
    walk(tree, []);
    return targets;
}

// 相手のパネル。id は app.js の getTalkPanels と同じ形（標準は talk-partner-<id>、ほかのパターンは talk-partner-<setId>-<id>）
export function partnerTargets(partners, prefix) {
    return partners.map(p => ({
        key: p.id ? `${prefix}-${p.id}` : "talk-partner-none",
        desc: p.id
            ? `会話の相手「${p.name}」の人物（主人公は描かない）。絵文字のイメージ: ${p.emoji}`
            : `会話の相手を決めない（いろいろな人のシルエット）。絵文字のイメージ: ${p.emoji}`
    }));
}

// 会話パターン1つ分（標準以外）のアイコン対象。主人公を指定したパターンは、説明にも入れて主人公を変えたら作り直させる
export function talkSetTargets(set) {
    const targets = [...talkTreeTargets(set.tree), ...partnerTargets(set.partners, `talk-partner-${set.id}`)];
    const protagonist = (set.protagonist || "").trim();
    if (!protagonist) return targets;
    return targets.map(t => ({ ...t, desc: `${t.desc} （主人公: ${protagonist}）`, protagonist }));
}

export async function loadPublishedSets() {
    if (!fs.existsSync(PUBLISHED_DIR)) return [];
    const files = fs.readdirSync(PUBLISHED_DIR).filter(f => f.endsWith(".js") && f !== "index.js").sort();
    const sets = [];
    for (const f of files) sets.push((await importSource(path.join(PUBLISHED_DIR, f))).default);
    return sets;
}

// 標準データとアプリの各パネル、登録済みの会話パターン（と、talk studio の作りかけ extraSets）
export async function collectTargets({ extraSets = [] } = {}) {
    const { TALK_TREE } = await importSource(path.join(DIST_DIR, "talk-data.js"));
    const appSource = fs.readFileSync(path.join(DIST_DIR, "app.js"), "utf8");
    const targets = talkTreeTargets(TALK_TREE);
    targets.push(
        { key: "custom", desc: "「自分の言葉」（話題の大分類。自分で登録した言葉の置き場所） 絵文字のイメージ: ✏️" },
        { key: "talk-say", desc: "「これで話す」（選んだ言葉を声に出して読み上げる） 主人公が話しかけ、口元から声が出ている。絵文字のイメージ: 🔊" }
    );
    targets.push(...partnerTargets([...extractArrayLiteral(appSource, "DEFAULT_TALK_PARTNERS"), { id: "", name: "決めない", emoji: "👥" }], "talk-partner"));

    for (const a of extractArrayLiteral(appSource, "TALK_AIZUCHI")) {
        targets.push({ key: a.id, desc: `あいづち「${a.name}」を主人公が表情としぐさで表す。絵文字のイメージ: ${a.emoji}` });
    }

    for (const p of extractArrayLiteral(appSource, "SIMPLE_EXTRA_PRESETS")) {
        if (p.icon && !isPictogram(p.icon)) continue;
        targets.push({ key: p.id, desc: `「${p.name}」（${p.group}） 主人公の言葉: ${p.sentence} 絵文字のイメージ: ${p.emoji || "なし"}` });
    }

    for (const q of extractArrayLiteral(appSource, "QUESTION_PRESETS")) {
        q.answers.forEach((a, i) => {
            if (a.icon && !isPictogram(a.icon)) return;
            targets.push({
                key: `${q.id}-a${i}`,
                // 質問の場面（聞いている相手）を描くと答えの違いが見えなくなるため、答えの状態だけを主人公ひとりで描かせる
                desc: `「${a.name}」 主人公の言葉: ${a.sentence} 主人公ひとりだけを描き、この答えの状態だけがひと目でわかるようにする（質問している相手や、ほかの選択肢は描かない）${a.emoji ? ` 絵文字のイメージ: ${a.emoji}` : ""}`
            });
        });
    }

    const published = await loadPublishedSets();
    // 作りかけと登録済みが同じ id なら、作りかけ（編集中の内容）を使う
    const extraIds = new Set(extraSets.map(set => set.id));
    for (const set of [...published.filter(set => !extraIds.has(set.id)), ...extraSets]) targets.push(...talkSetTargets(set));

    const seen = new Set();
    for (const t of targets) {
        if (seen.has(t.key)) throw new Error(`Duplicate icon key: ${t.key}`);
        if (!/^[A-Za-z0-9_-]+$/.test(t.key)) throw new Error(`Icon key must be file-name safe: ${t.key}`);
        seen.add(t.key);
    }
    return targets;
}

// 最後のシートが20枠に満たないときは前の項目で埋める（グリッドの検出を安定させるため。埋めた分は保存しない）
// 主人公はシート単位でしか指定できないので、主人公ごとに分けてからシートに割る
export function planSheets(targets) {
    const groups = new Map();
    for (const t of targets) {
        const key = t.protagonist || "";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
    }
    return [...groups.values()].flatMap(planGroupSheets);
}

function planGroupSheets(targets) {
    const sheets = [];
    for (let i = 0; i < targets.length; i += PER_SHEET) {
        const slots = targets.slice(i, i + PER_SHEET).map(t => ({ ...t, pad: false }));
        let fill = 0;
        const pool = i > 0 ? targets.slice(0, i) : targets;
        while (slots.length < PER_SHEET) slots.push({ ...pool[fill++ % pool.length], pad: true });
        sheets.push(slots);
    }
    return sheets;
}

function buildPrompt(slots) {
    const lines = slots.map((s, i) => `${i + 1}. (${Math.floor(i / COLS) + 1}行${(i % COLS) + 1}列) ${s.desc}`);
    return [
        "添付画像は、意思伝達アプリで使っているアイコンの見本シートです。これと同じ画風・同じレイアウトで、新しいアイコンシートを1枚描いてください。",
        "",
        "【レイアウト（厳守）】",
        `- 横${COLS}列 × 縦${ROWS}行、合計${PER_SHEET}枚のアイコンを見本と同じ並びで配置する`,
        "- 各アイコンは角丸の白いカードに薄いグレーの細い枠線。カード同士の間は見本と同じくらい広く空け、背景は真っ白",
        "- 全カードを同じ大きさにそろえ、カードの外にはみ出す絵や影、区切り線は描かない",
        "- 文字・数字・記号ラベルは一切描かない（ふきだしの中も絵だけ）",
        "",
        "【画風】",
        "- 見本と同じ、やわらかい線画＋淡い色の塗りのやさしいイラスト",
        // 会話パターンごとに主人公（本人）を変えられる。指定がなければ見本の女性
        slots[0].protagonist
            ? `- 主人公は${slots[0].protagonist}。見本の女性ではなくこの人物を、見本と同じ画風で描く。全カードで同じ顔・髪型・服装にそろえる。病気で話せないため、車いすやベッドで過ごしていることもある`
            : "- 主人公は見本の女性（茶色のボブヘア、ピンクのセーター）。病気で話せないため、車いすやベッドで過ごしていることもある",
        "- 相手は家族（お父さん・お母さん・お姉ちゃん・お兄ちゃん）や看護師さん（水色の制服）",
        "- ひと目で意味が伝わるよう、表情・しぐさ・小物を大きくはっきり描く",
        "",
        "【各カードの内容（左上から右へ、行ごとに）】",
        ...lines,
        "",
        // 「」付きのラベルを見出しとして書き込んでしまうことがあるため、最後にもう一度念を押す
        "【最重要】画像の中に文字を一切描かないこと。上の「」の言葉は内容の説明であり、カードに書く見出しではない。日本語・英語・数字のラベル、タイトル、看板、ポスターの題字もすべて禁止。",
        "NO TEXT: do not draw any letters, words, captions or titles anywhere in the image."
    ].join("\n");
}

async function loadStyleReference() {
    const buffer = await sharp(STYLE_REFERENCE).resize({ width: 1376 }).jpeg({ quality: 85 }).toBuffer();
    return { mimeType: "image/jpeg", data: buffer.toString("base64") };
}

async function callImageModel(env, prompt, reference) {
    const imageConfig = { aspectRatio: "16:9" };
    if (env.imageSize) imageConfig.imageSize = env.imageSize;
    const body = {
        contents: [{ role: "user", parts: [{ inlineData: reference }, { text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig }
    };

    for (let attempt = 1; ; attempt++) {
        const response = await fetch(`${API_BASE}/models/${encodeURIComponent(env.model)}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": env.apiKey },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        if ((response.status === 429 || response.status >= 500) && attempt < 3) {
            console.warn(`  Gemini ${response.status}、${attempt * 20}秒後に再試行`);
            await new Promise(resolve => setTimeout(resolve, attempt * 20000));
            continue;
        }
        const json = await response.json().catch(() => null);
        if (!response.ok) throw new Error(`Gemini API エラー ${response.status}: ${JSON.stringify(json?.error?.message ?? json).slice(0, 400)}`);

        const parts = json?.candidates?.[0]?.content?.parts || [];
        const image = parts.find(p => p.inlineData?.data || p.inline_data?.data);
        if (image) return Buffer.from((image.inlineData || image.inline_data).data, "base64");

        // 画像を返さないことがときどきあるため、理由を出して作り直させる
        const text = parts.map(p => p.text).filter(Boolean).join(" ").slice(0, 200);
        const reason = [json?.candidates?.[0]?.finishReason, json?.promptFeedback?.blockReason, text].filter(Boolean).join(" / ") || "画像なし";
        if (attempt >= 3) throw new Error(`Gemini が画像を返しませんでした（${reason}）`);
        console.warn(`  画像が返りませんでした（${reason}）。再試行します`);
    }
}

async function listModels(env) {
    const response = await fetch(`${API_BASE}/models?pageSize=1000`, { headers: { "x-goog-api-key": env.apiKey } });
    const json = await response.json();
    if (!response.ok) throw new Error(`Gemini API エラー ${response.status}: ${json?.error?.message}`);
    for (const m of json.models || []) {
        if (/image/i.test(m.name) && m.supportedGenerationMethods?.includes("generateContent")) console.log(m.name.replace(/^models\//, ""));
    }
}

// 指定と違う列数・行数で描かれることがあるため、分割できるかを先に確かめる。問題なければ null
async function checkGrid(image) {
    const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    try {
        detectGridBands(data, info.width, info.height, ROWS, COLS);
        return null;
    } catch (error) {
        return error.message;
    }
}

// 見本と同じボーダー付きカードなので、split_menu_sheet.js と同じ「列・行のバンド検出」で切る。
// 検出できないときは等分割にして警告する（--split-only で保存済みシートを切り直すとき用）
async function splitSheet(sheetPath, slots) {
    const src = sharp(sheetPath);
    const { width, height } = await src.metadata();
    const raw = await src.clone().ensureAlpha().raw().toBuffer();

    let rowBands;
    let colBands;
    try {
        ({ rowBands, colBands } = detectGridBands(raw, width, height, ROWS, COLS));
    } catch (error) {
        console.warn(`  ${path.basename(sheetPath)}: グリッド検出に失敗（${error.message}）。等分割で切ります。仕上がりを確認してください`);
        const even = (n, size) => Array.from({ length: n }, (_, i) => ({
            start: Math.round(i * size / n),
            end: Math.round((i + 1) * size / n) - 1
        }));
        rowBands = even(ROWS, height);
        colBands = even(COLS, width);
    }

    const extend = 2;
    const written = [];
    for (let i = 0; i < slots.length; i++) {
        if (slots[i].pad) continue;
        const rb = rowBands[Math.floor(i / COLS)];
        const cb = colBands[i % COLS];
        const left = Math.max(0, cb.start - extend);
        const top = Math.max(0, rb.start - extend);
        const w = Math.min(width, cb.end + 1 + extend) - left;
        const h = Math.min(height, rb.end + 1 + extend) - top;

        const tileRaw = await src.clone().extract({ left, top, width: w, height: h }).ensureAlpha().raw().toBuffer();
        const trimmed = trimTopSparseRows(applyEdgeConnectedTransparency(tileRaw, w, h, true), w, h);
        const outPath = path.join(GEN_DIR, `${slots[i].key}${ICON_EXT}`);
        await sharp(trimmed.data, { raw: { width: trimmed.width, height: trimmed.height, channels: 4 } })
            .resize({ width: ICON_MAX_PX, height: ICON_MAX_PX, fit: "inside", withoutEnlargement: true })
            .webp({ quality: 85, alphaQuality: 100 })
            .toFile(outPath);
        written.push(slots[i].key);
    }
    return written;
}

export function descHash(desc) {
    return crypto.createHash("sha1").update(desc).digest("hex").slice(0, 12);
}

export function readSources() {
    return fs.existsSync(ICON_SOURCES) ? JSON.parse(fs.readFileSync(ICON_SOURCES, "utf8")) : {};
}

export function writeSources(sources) {
    const sorted = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(ICON_SOURCES, `${JSON.stringify(sorted, null, 2)}
`);
}

export function iconPath(key) {
    return path.join(GEN_DIR, `${key}${ICON_EXT}`);
}

// 今の内容で作った絵があるか
export function isUpToDate(target, sources) {
    return sources[target.key] === descHash(target.desc) && fs.existsSync(iconPath(target.key));
}

// アプリはこの一覧にある id だけ画像を使い、それ以外は絵文字のまま表示する。
// 対象から外れた項目や内容が変わった項目の古いファイルは載せない
export function writeManifest(targets, sources) {
    const keys = targets.filter(t => isUpToDate(t, sources)).map(t => t.key).sort();
    const body = keys.map(k => `    ${JSON.stringify(k)}: ${JSON.stringify(`media/gen/${k}${ICON_EXT}`)}`).join(",\n");
    fs.writeFileSync(ICON_MANIFEST, [
        "// scripts/gen_icon_sheets.mjs が自動生成する。手で編集しない",
        "// パネルの id → Gemini で作ったアイコン画像（ない id は絵文字のまま表示）",
        `export const GENERATED_ICONS = {${keys.length > 0 ? `\n${body}\n` : ""}};`,
        ""
    ].join("\n"));
    return keys.length;
}

function readSheetLog() {
    return fs.existsSync(SHEET_LOG) ? JSON.parse(fs.readFileSync(SHEET_LOG, "utf8")) : [];
}

// 使わなくなった絵を消す（ファイル・作ったときの記録・元のシート）。一覧は呼び出し側で書き直す
export function removeIcons(matchKey) {
    let removed = 0;
    if (fs.existsSync(GEN_DIR)) {
        for (const f of fs.readdirSync(GEN_DIR)) {
            if (!f.endsWith(ICON_EXT) || !matchKey(f.slice(0, -ICON_EXT.length))) continue;
            fs.unlinkSync(path.join(GEN_DIR, f));
            removed++;
        }
    }
    const sources = readSources();
    for (const key of Object.keys(sources)) if (matchKey(key)) delete sources[key];
    writeSources(sources);
    // 元のシートは、ほかの絵が残っていなければ消す。残っていれば --split-only で切り直さないよう埋め草扱いにする
    const log = readSheetLog();
    const kept = [];
    for (const entry of log) {
        const slots = entry.slots.map(s => (matchKey(s.key) ? { ...s, pad: true } : s));
        if (slots.every(s => s.pad)) {
            const file = path.join(SHEET_DIR, entry.file);
            if (fs.existsSync(file)) fs.unlinkSync(file);
        } else {
            kept.push({ ...entry, slots });
        }
    }
    if (log.length > 0) fs.writeFileSync(SHEET_LOG, JSON.stringify(kept, null, 2));
    return removed;
}

// シートを作って分割し、記録と一覧を更新する。getAll は一覧に載せる対象（作りかけの会話パターンは含めない）。
// 作っている間に登録や削除があっても古い内容で上書きしないよう、記録と対象はシートごとに読み直す
export async function generateIcons({ env, sheets, getAll, onLog = console.log }) {
    if (!env.apiKey) throw new Error(".env に GEMINI_API_KEY を設定してください（.env.example 参照）");
    fs.mkdirSync(SHEET_DIR, { recursive: true });
    const reference = await loadStyleReference();
    const log = readSheetLog();
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
    const failed = [];

    for (let i = 0; i < sheets.length; i++) {
        const slots = sheets[i];
        const file = `sheet-${stamp}-${String(i + 1).padStart(2, "0")}.png`;
        onLog(`[${i + 1}/${sheets.length}] ${slots.filter(s => !s.pad).map(s => s.key).join(", ")}`);
        let image;
        try {
            for (let attempt = 1; ; attempt++) {
                image = await callImageModel(env, buildPrompt(slots), reference);
                const gridError = await checkGrid(image);
                if (!gridError) break;
                if (attempt >= 3) throw new Error(`グリッドが${COLS}列×${ROWS}行になりませんでした（${gridError}）`);
                onLog(`  グリッドが指定と違います（${gridError}）。作り直します`);
            }
        } catch (error) {
            // 1シートの失敗で全体を止めない。未作成のまま残るので、もう一度実行すれば作り直す
            onLog(`  失敗: ${error.message}`);
            failed.push(i + 1);
            continue;
        }
        await sharp(image).png().toFile(path.join(SHEET_DIR, file));
        log.push({ file, model: env.model, slots: slots.map(({ key, pad, desc }) => ({ key, pad, hash: descHash(desc) })) });
        fs.writeFileSync(SHEET_LOG, JSON.stringify(log, null, 2));
        let written;
        try {
            written = await splitSheet(path.join(SHEET_DIR, file), slots);
        } catch (error) {
            // シートは保存済みなので --split-only で切り直せる。残りのシートは続けて作る
            onLog(`  分割に失敗: ${error.message}（${file}）`);
            failed.push(i + 1);
            continue;
        }
        const sources = readSources();
        for (const slot of slots) if (!slot.pad) sources[slot.key] = descHash(slot.desc);
        // 途中で止まっても作れた分は使えるよう、シートごとに一覧を更新する
        writeSources(sources);
        writeManifest(await getAll(), sources);
        onLog(`  → ${written.length} icons (${file})`);
    }
    return { failed };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const env = loadEnv();
    fs.mkdirSync(GEN_DIR, { recursive: true });

    if (args.listModels) {
        if (!env.apiKey) throw new Error(".env に GEMINI_API_KEY を設定してください（.env.example 参照）");
        await listModels(env);
        return;
    }

    const all = await collectTargets();
    const sources = readSources();
    if (!fs.existsSync(ICON_SOURCES)) {
        // 記録を始める前に作った絵は、今の内容のものとみなす
        for (const t of all) if (fs.existsSync(iconPath(t.key))) sources[t.key] = descHash(t.desc);
        if (!args.dryRun) writeSources(sources);
    }

    if (args.splitOnly) {
        let total = 0;
        for (const entry of readSheetLog()) {
            const sheetPath = path.join(SHEET_DIR, entry.file);
            if (!fs.existsSync(sheetPath)) continue;
            const slots = args.only ? entry.slots.map(s => ({ ...s, pad: s.pad || !s.key.startsWith(args.only) })) : entry.slots;
            total += (await splitSheet(sheetPath, slots)).length;
            // 切り直した絵は、そのシートを作ったときの内容のもの（古いログには記録がないので据え置き）
            for (const slot of slots) if (!slot.pad && slot.hash) sources[slot.key] = slot.hash;
        }
        writeSources(sources);
        console.log(`Split ${total} icons. Manifest: ${writeManifest(all, sources)} icons`);
        return;
    }

    const targets = all.filter(t => t.key.startsWith(args.only))
        .filter(t => args.force || !isUpToDate(t, sources));
    const sheets = planSheets(targets).slice(0, args.limit);
    console.log(`対象 ${all.length} 件中、未作成 ${targets.length} 件 → ${sheets.length} シート（モデル: ${env.model}）`);

    if (args.dryRun) {
        sheets.forEach((slots, i) => console.log(`\n=== sheet ${i + 1} ===\n${buildPrompt(slots)}`));
        return;
    }
    if (sheets.length === 0) {
        console.log(`Manifest: ${writeManifest(all, sources)} icons`);
        return;
    }
    if (!env.apiKey) throw new Error(".env に GEMINI_API_KEY を設定してください（.env.example 参照）");

    const { failed } = await generateIcons({ env, sheets, getAll: () => collectTargets() });
    console.log(`Manifest: ${writeManifest(await collectTargets(), readSources())} icons → ${path.relative(ROOT, ICON_MANIFEST)}`);
    if (failed.length > 0) {
        console.warn(`失敗したシート: ${failed.join(", ")}。もう一度実行すると未作成の分だけ作り直します`);
        process.exitCode = 1;
    }
}

// talk studio から読み込んだときは実行しない
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main().catch(error => {
        console.error(error.message || error);
        process.exit(1);
    });
}
