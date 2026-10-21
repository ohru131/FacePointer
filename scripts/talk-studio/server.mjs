#!/usr/bin/env node
// talk studio: 会話パターンをローカルで作る・直す・絵を作る・アプリに登録する
//   npm run talk:studio   → http://127.0.0.1:5180 を開く
// Gemini の APIキーは .env からこのサーバーだけが使い、ブラウザには渡さない。
// 作りかけ（インタビューの回答を含む）は scripts/talk-studio/drafts/ に置き、git には載せない。
// 「アプリに登録」で dist/talk-sets/ に書き出し、アプリの会話パターン一覧に組み込みとして出る。

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
    PUBLISHED_DIR, collectTargets, descHash, extractArrayLiteral, generateIcons, iconPath, isUpToDate,
    loadEnv, loadPublishedSets, partnerTargets, planSheets, readSources, removeIcons, talkSetTargets, talkTreeTargets,
    writeManifest, writeSources
} from "../gen_icon_sheets.mjs";
import { validateTalkSet } from "./validate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const DIST_DIR = path.join(ROOT, "dist");
const MEDIA_DIR = path.join(DIST_DIR, "media");
const PUBLIC_DIR = path.join(HERE, "public");
const DRAFT_DIR = path.join(HERE, "drafts");
const PORT = Number.parseInt(process.env.TALK_STUDIO_PORT || "5180", 10);
const HOST = "127.0.0.1";
const BODY_MAX = 5 * 1024 * 1024;
const KEY_SAFE = /^[A-Za-z0-9_-]+$/;

const env = loadEnv();
const textModel = process.env.GEMINI_TEXT_MODEL || "";

async function importSource(file) {
    const source = fs.readFileSync(file, "utf8");
    return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const talkGenerator = await importSource(path.join(DIST_DIR, "talk-generator.js"));

// ---------------------------------------------------------
// 作りかけ（draft）
// ---------------------------------------------------------
function draftPath(id) {
    if (!KEY_SAFE.test(id || "")) throw httpError(400, "id が正しくありません");
    return path.join(DRAFT_DIR, `${id}.json`);
}

function readDraft(id) {
    const file = draftPath(id);
    if (!fs.existsSync(file)) throw httpError(404, "見つかりません");
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeDraft(draft) {
    fs.mkdirSync(DRAFT_DIR, { recursive: true });
    draft.updatedAt = Date.now();
    fs.writeFileSync(draftPath(draft.id), `${JSON.stringify(draft, null, 2)}\n`);
    return draft;
}

function listDrafts() {
    if (!fs.existsSync(DRAFT_DIR)) return [];
    return fs.readdirSync(DRAFT_DIR).filter(f => f.endsWith(".json")).map((f) => {
        const d = JSON.parse(fs.readFileSync(path.join(DRAFT_DIR, f), "utf8"));
        return { id: d.id, name: d.name, updatedAt: d.updatedAt, publishedAt: d.publishedAt || null, nodes: countNodes(d.tree) };
    }).sort((a, b) => b.updatedAt - a.updatedAt);
}

function countNodes(nodes) {
    return (nodes || []).reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

// 絵の主人公（本人）。プロフィールから決め、画面で書き足せる（例: 白髪の短髪、紺のカーディガン）
function describeProtagonist(profile) {
    const gender = { female: "女性", male: "男性" }[profile?.gender] || "";
    const age = Number.isFinite(profile?.age) && profile.age > 0 ? `${profile.age}歳の` : "";
    return gender ? `${age}${gender}` : "";
}

function newSetId() {
    return `st${Date.now().toString(36)}`;
}

// アイコンのファイル名になるので、パターンをまたいで重ならないよう id を振り直す（位置で決まる id）
function reId(tree, setId) {
    const map = new Map();
    const convert = (node, id) => {
        map.set(node.id, id);
        const out = { ...node, id };
        if (node.children) out.children = node.children.map((child, i) => convert(child, `${id}-${i + 1}`));
        return out;
    };
    return { tree: (tree || []).map((topic, i) => convert(topic, `${setId}-${i + 1}`)), map };
}

function sanitizeImportedPartners(partners) {
    return (Array.isArray(partners) ? partners : [])
        .filter(p => p && typeof p.name === "string")
        .map(p => ({ id: String(p.id || "").toLowerCase().replace(/[^a-z0-9_-]/g, ""), name: p.name, emoji: p.emoji || "🙂" }));
}

// 同じ内容の絵がすでにあれば、新しい id へ写して作り直しを省く
function copyMatchingIcons(pairs) {
    const sources = readSources();
    let copied = 0;
    for (const { from, to } of pairs) {
        if (from.desc !== to.desc || !isUpToDate(from, sources)) continue;
        fs.copyFileSync(iconPath(from.key), iconPath(to.key));
        sources[to.key] = descHash(to.desc);
        copied++;
    }
    if (copied > 0) writeSources(sources);
    return copied;
}

async function createDraft({ source, data }) {
    const id = newSetId();
    const draft = {
        id, name: "", createdAt: Date.now(), updatedAt: Date.now(),
        profile: { gender: "", age: null }, interview: [], partners: [], tree: [], regenerate: []
    };
    if (source === "default") {
        const { TALK_TREE } = await importSource(path.join(DIST_DIR, "talk-data.js"));
        const appSource = fs.readFileSync(path.join(DIST_DIR, "app.js"), "utf8");
        const partners = extractArrayLiteral(appSource, "DEFAULT_TALK_PARTNERS");
        const { tree } = reId(TALK_TREE, id);
        Object.assign(draft, { name: "標準をもとにしたパターン", partners, tree });
        // 標準の絵（talk-partner-<id> と元のノード id）を引き継ぐ
        const before = [...talkTreeTargets(TALK_TREE), ...partnerTargets(partners, "talk-partner")];
        const after = talkSetTargets(draft);
        draft.copiedIcons = copyMatchingIcons(before.map((from, i) => ({ from, to: after[i] })));
    } else if (source === "import") {
        if (!data || !Array.isArray(data.tree)) throw httpError(400, "会話パターンのファイルではありません（tree がありません）");
        const { tree } = reId(data.tree, id);
        Object.assign(draft, {
            name: typeof data.name === "string" ? data.name.replace(/（\d+\/\d+）$/, "") : "",
            profile: data.profile && typeof data.profile === "object" ? data.profile : draft.profile,
            interview: Array.isArray(data.interview) ? data.interview.filter(x => x && x.q) : [],
            partners: sanitizeImportedPartners(data.partners),
            tree
        });
    } else if (source !== "empty") {
        throw httpError(400, "source が正しくありません");
    }
    return writeDraft(draft);
}

// 絵の状態: ok（今の内容の絵がある）/ stale（内容を直したので古い）/ missing（まだない）
function iconStatus(draft) {
    const sources = readSources();
    const status = {};
    for (const t of talkSetTargets(draft)) {
        const exists = fs.existsSync(iconPath(t.key));
        status[t.key] = {
            state: !exists ? "missing" : (sources[t.key] === descHash(t.desc) ? "ok" : "stale"),
            url: exists ? `/media/gen/${t.key}.webp?v=${Math.round(fs.statSync(iconPath(t.key)).mtimeMs)}` : ""
        };
    }
    return status;
}

function draftResponse(draft) {
    return { draft, issues: validateTalkSet(draft), icons: iconStatus(draft), job: publicJob() };
}

// ---------------------------------------------------------
// 絵を作るジョブ（同時に1つだけ）
// ---------------------------------------------------------
let job = null;

function publicJob() {
    return job ? { draftId: job.draftId, running: job.running, log: job.log.slice(-200), failed: job.failed, error: job.error } : null;
}

function iconPlan(draft) {
    const sources = readSources();
    const marked = new Set(draft.regenerate || []);
    const targets = talkSetTargets(draft).filter(t => marked.has(t.key) || !isUpToDate(t, sources));
    return { targets, sheets: planSheets(targets) };
}

async function startIconJob(draft) {
    if (job?.running) throw httpError(409, "ほかの絵を作っている途中です");
    const issues = validateTalkSet(draft).filter(i => i.level === "error");
    if (issues.length > 0) throw httpError(400, "エラーを直してから絵を作ってください");
    const { targets, sheets } = iconPlan(draft);
    if (sheets.length === 0) throw httpError(400, "作る絵がありません");
    job = { draftId: draft.id, running: true, log: [`${targets.length} 件 → ${sheets.length} シート（モデル: ${env.model}）`], failed: [], error: "" };
    const current = job;
    (async () => {
        try {
            // 一覧（アプリが読む）には、標準と登録済みのパターンだけを載せる
            const all = await collectTargets();
            const { failed } = await generateIcons({ env, sheets, all, sources: readSources(), onLog: line => current.log.push(line) });
            current.failed = failed;
            const failedKeys = new Set(failed.flatMap(n => sheets[n - 1].filter(s => !s.pad).map(s => s.key)));
            // 作り直しの印は、作れた分だけ外す（作りかけを読み直して、その間の編集を消さない）
            const latest = readDraft(draft.id);
            latest.regenerate = (latest.regenerate || []).filter(k => failedKeys.has(k) || !targets.some(t => t.key === k));
            writeDraft(latest);
            current.log.push(failed.length > 0 ? `失敗したシート: ${failed.join(", ")}。もう一度「絵を作る」で作り直せます` : "完了しました");
        } catch (error) {
            current.error = error.message;
            current.log.push(`エラー: ${error.message}`);
        } finally {
            current.running = false;
        }
    })();
}

// ---------------------------------------------------------
// アプリへの登録
// ---------------------------------------------------------
function writePublishedIndex() {
    fs.mkdirSync(PUBLISHED_DIR, { recursive: true });
    const files = fs.readdirSync(PUBLISHED_DIR).filter(f => f.endsWith(".js") && f !== "index.js").sort();
    const names = files.map((f, i) => ({ file: f, name: `set${i}` }));
    fs.writeFileSync(path.join(PUBLISHED_DIR, "index.js"), [
        "// npm run talk:studio で「アプリに登録」すると自動で書き換わる。手で編集しない",
        ...names.map(n => `import ${n.name} from "./${n.file}";`),
        "",
        `export const PUBLISHED_TALK_SETS = [${names.map(n => n.name).join(", ")}];`,
        ""
    ].join("\n"));
}

async function publishDraft(draft) {
    const errors = validateTalkSet(draft).filter(i => i.level === "error");
    if (errors.length > 0) throw httpError(400, `エラーが ${errors.length} 件あります。直してから登録してください`);
    fs.mkdirSync(PUBLISHED_DIR, { recursive: true });
    const set = { id: draft.id, name: draft.name.trim(), partners: draft.partners, tree: draft.tree };
    // 絵の作り直しを判断するために残す（アプリは使わない）
    if (draft.protagonist) set.protagonist = draft.protagonist;
    fs.writeFileSync(path.join(PUBLISHED_DIR, `${draft.id}.js`), [
        `// talk studio で作った会話パターン「${set.name}」。手で編集せず npm run talk:studio で直して登録し直す`,
        `export default ${JSON.stringify(set, null, 2)};`,
        ""
    ].join("\n"));
    writePublishedIndex();
    const icons = writeManifest(await collectTargets(), readSources());
    draft.publishedAt = Date.now();
    writeDraft(draft);
    return { icons };
}

// そのパターンの絵の id（ノードは <id>-…、相手は talk-partner-<id>-…）
function isSetKey(id) {
    return key => key.startsWith(`${id}-`) || key.startsWith(`talk-partner-${id}-`);
}

// 登録を外す。作りかけが残っていれば絵も残す（もう一度登録できるように）。なければ絵も消す
async function unpublish(id) {
    const file = path.join(PUBLISHED_DIR, `${id}.js`);
    if (!KEY_SAFE.test(id) || !fs.existsSync(file)) throw httpError(404, "登録されていません");
    fs.unlinkSync(file);
    writePublishedIndex();
    let removedIcons = 0;
    if (fs.existsSync(draftPath(id))) {
        const draft = readDraft(id);
        draft.publishedAt = null;
        writeDraft(draft);
    } else {
        removedIcons = removeIcons(isSetKey(id));
    }
    writeManifest(await collectTargets(), readSources());
    return { removedIcons };
}

// 作りかけを消す。登録していれば外し、作った絵もすべて消す
async function deleteDraft(id) {
    if (job?.running && job.draftId === id) throw httpError(409, "絵を作っている途中です");
    fs.unlinkSync(draftPath(id));
    if (fs.existsSync(path.join(PUBLISHED_DIR, `${id}.js`))) {
        fs.unlinkSync(path.join(PUBLISHED_DIR, `${id}.js`));
        writePublishedIndex();
    }
    const removedIcons = removeIcons(isSetKey(id));
    writeManifest(await collectTargets(), readSources());
    return { removedIcons };
}

// ---------------------------------------------------------
// HTTP
// ---------------------------------------------------------
function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

function sendJson(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml" };

function sendFile(res, baseDir, relPath) {
    const file = path.resolve(baseDir, `.${path.posix.normalize(`/${relPath}`)}`);
    if (!file.startsWith(baseDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404).end();
        return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > BODY_MAX) reject(httpError(413, "データが大きすぎます"));
            else chunks.push(chunk);
        });
        req.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            try {
                resolve(text ? JSON.parse(text) : {});
            } catch {
                reject(httpError(400, "JSON を読めません"));
            }
        });
        req.on("error", reject);
    });
}

function requireKey() {
    if (!env.apiKey) throw httpError(400, ".env に GEMINI_API_KEY を設定してください");
}

async function handleApi(req, res, url) {
    const parts = url.pathname.split("/").filter(Boolean).slice(1); // api/...
    const method = req.method;
    // ほかのサイトからの書き込みを防ぐ（JSON 以外の送信は受け付けない）
    if (method !== "GET" && !(req.headers["content-type"] || "").startsWith("application/json")) throw httpError(415, "application/json で送ってください");
    const body = method === "GET" ? {} : await readBody(req);

    if (method === "GET" && parts[0] === "state") {
        const published = (await loadPublishedSets()).map(s => ({ id: s.id, name: s.name, nodes: countNodes(s.tree) }));
        return sendJson(res, 200, {
            drafts: listDrafts(), published, hasKey: Boolean(env.apiKey),
            imageModel: env.model, textModel: textModel || talkGenerator.TALK_AI_MODEL_DEFAULT, job: publicJob()
        });
    }
    if (method === "POST" && parts[0] === "questions") {
        requireKey();
        const questions = await talkGenerator.generateInterviewQuestions({
            apiKey: env.apiKey, model: textModel || undefined, profile: body.profile, interview: body.interview
        });
        return sendJson(res, 200, { questions });
    }
    if (parts[0] === "published" && parts[1] && method === "DELETE") {
        return sendJson(res, 200, { ok: true, ...(await unpublish(parts[1])) });
    }
    if (parts[0] !== "drafts") throw httpError(404, "見つかりません");

    if (!parts[1]) {
        if (method === "POST") return sendJson(res, 200, draftResponse(await createDraft(body)));
        throw httpError(405, "使えない操作です");
    }
    const draft = readDraft(parts[1]);
    const action = parts[2] || "";

    if (!action && method === "GET") return sendJson(res, 200, draftResponse(draft));
    if (!action && method === "PUT") {
        // 画面から直せる項目だけ受け取る
        for (const key of ["name", "profile", "interview", "partners", "tree", "regenerate", "protagonist"]) {
            if (body[key] !== undefined) draft[key] = body[key];
        }
        return sendJson(res, 200, draftResponse(writeDraft(draft)));
    }
    if (!action && method === "DELETE") {
        return sendJson(res, 200, { ok: true, ...(await deleteDraft(draft.id)) });
    }
    if (action === "generate" && method === "POST") {
        requireKey();
        if (job?.running && job.draftId === draft.id) throw httpError(409, "絵を作っている途中です");
        const result = await talkGenerator.generateTalkSet({
            apiKey: env.apiKey, model: textModel || undefined, profile: draft.profile, interview: draft.interview, setId: draft.id
        });
        // 作り直すと同じ id で別の内容になるので、作り直しの印は消す（内容が変われば古い絵は stale になる）
        Object.assign(draft, { partners: result.partners, tree: result.tree, regenerate: [] });
        if (!draft.name) draft.name = result.name;
        if (!draft.protagonist) draft.protagonist = describeProtagonist(draft.profile);
        return sendJson(res, 200, draftResponse(writeDraft(draft)));
    }
    if (action === "icon-plan" && method === "GET") {
        const { targets, sheets } = iconPlan(draft);
        return sendJson(res, 200, { count: targets.length, sheets: sheets.length, model: env.model });
    }
    if (action === "icons" && method === "POST") {
        requireKey();
        await startIconJob(draft);
        return sendJson(res, 200, draftResponse(draft));
    }
    if (action === "publish" && method === "POST") {
        const result = await publishDraft(draft);
        return sendJson(res, 200, { ...draftResponse(readDraft(draft.id)), ...result });
    }
    throw httpError(404, "見つかりません");
}

const server = http.createServer(async (req, res) => {
    try {
        // DNS リバインディング対策: このサーバー自身の名前で来たものだけ受ける
        const host = req.headers.host || "";
        if (host !== `${HOST}:${PORT}` && host !== `localhost:${PORT}`) {
            res.writeHead(403).end();
            return;
        }
        const url = new URL(req.url, `http://${host}`);
        if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
        if (req.method !== "GET") throw httpError(405, "使えない操作です");
        if (url.pathname.startsWith("/media/")) return sendFile(res, MEDIA_DIR, url.pathname.slice("/media/".length));
        return sendFile(res, PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    } catch (error) {
        if (!error.status) console.error(error);
        if (!res.headersSent) sendJson(res, error.status || 500, { error: error.message });
    }
});

server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}/`;
    console.log(`talk studio: ${url}（終了は Ctrl+C）`);
    if (!env.apiKey) console.log("注意: .env に GEMINI_API_KEY がないため、AI での作成と絵の作成は使えません");
    if (!process.argv.includes("--no-open")) {
        const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
            : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
        spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
    }
});
