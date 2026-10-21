// talk studio の画面。データはサーバー（scripts/talk-studio/server.mjs）に保存し、Gemini もサーバー経由で呼ぶ
const $ = (id) => document.getElementById(id);
const CALL = "{呼}";
const TIME_LABELS = { "": "いつでも", morning: "🌅 朝", day: "☀️ 昼", evening: "🌙 夜" };
const LABEL_MAX = 12;
const SAY_MAX = 80;

let appState = null;      // /api/state
let draft = null;         // 編集中のパターン
let issues = [];
let icons = {};           // key → { state, url }
let selectedId = "";
let expanded = new Set();
let tab = "edit";
let iconFilter = "all";
let saveTimer = null;
let jobTimer = null;

// ---------------------------------------------------------
// 通信
// ---------------------------------------------------------
async function api(method, url, body) {
    // サーバーは GET 以外を JSON でしか受け付けない（ほかのサイトからの書き込み対策）
    const hasBody = method !== "GET";
    const response = await fetch(url, {
        method,
        headers: hasBody ? { "Content-Type": "application/json" } : {},
        body: hasBody ? JSON.stringify(body ?? {}) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `エラー ${response.status}`);
    return data;
}

function applyDraftResponse(data) {
    draft = data.draft;
    issues = data.issues;
    icons = data.icons;
    if (data.job) watchJob(data.job);
}

async function loadState() {
    appState = await api("GET", "/api/state");
}

async function openDraft(id) {
    clearTimeout(saveTimer);
    if (!id) {
        draft = null;
        renderAll();
        return;
    }
    applyDraftResponse(await api("GET", `/api/drafts/${id}`));
    selectedId = "";
    expanded = new Set(draft.tree.map(t => t.id));
    location.hash = `id=${draft.id}&tab=${tab}`;
    renderAll();
}

// 入力のたびに少し待ってから保存する。保存後はチェック結果と絵の状態だけ描き直す（入力中の欄は触らない）
function scheduleSave() {
    setSaveStatus("保存待ち…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 600);
}

async function saveNow() {
    clearTimeout(saveTimer);
    if (!draft) return;
    try {
        const data = await api("PUT", `/api/drafts/${draft.id}`, {
            name: draft.name, profile: draft.profile, interview: draft.interview,
            partners: draft.partners, tree: draft.tree, regenerate: draft.regenerate || [], protagonist: draft.protagonist || ""
        });
        issues = data.issues;
        icons = data.icons;
        setSaveStatus(`保存しました ${new Date().toLocaleTimeString("ja-JP")}`);
        renderTree();
        renderIssues();
        renderNodeIconOnly();
        if (tab === "icons") renderIcons();
        if (tab === "publish") renderPublish();
        await loadState();
        renderDraftSelect();
    } catch (error) {
        setSaveStatus(`保存できませんでした: ${error.message}`);
    }
}

function setSaveStatus(text) {
    $("save-status").textContent = text;
}

// ---------------------------------------------------------
// 木の操作
// ---------------------------------------------------------
function newNodeId() {
    return `${draft.id}-n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

// id のノードと、その親の配列・位置・深さ・たどり
function findNode(id, nodes = draft.tree, depth = 1, trail = []) {
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.id === id) return { node, list: nodes, index: i, depth, trail };
        const found = findNode(id, node.children || [], depth + 1, [...trail, node]);
        if (found) return found;
    }
    return null;
}

function walkNodes(nodes, fn, depth = 1, trail = []) {
    for (const node of nodes) {
        fn(node, depth, trail);
        walkNodes(node.children || [], fn, depth + 1, [...trail, node]);
    }
}

function countNodes(nodes) {
    let n = 0;
    walkNodes(nodes, () => n++);
    return n;
}

function select(id) {
    selectedId = id;
    const found = findNode(id);
    if (found) found.trail.forEach(t => expanded.add(t.id));
    renderTree();
    renderNodeForm();
}

function addTopic() {
    const topic = { id: newNodeId(), label: "新しい話題", emoji: "💬", children: [] };
    draft.tree.push(topic);
    expanded.add(topic.id);
    changed();
    select(topic.id);
}

function addChild(parentId) {
    const found = findNode(parentId);
    if (!found) return;
    if (found.depth >= 4) {
        alert("4段より深くはできません。");
        return;
    }
    const child = { id: newNodeId(), label: "新しい言葉", say: "" };
    (found.node.children ||= []).push(child);
    expanded.add(parentId);
    changed();
    select(child.id);
}

function addSibling(id) {
    const found = findNode(id);
    if (!found) return;
    const node = found.depth === 1 ? { id: newNodeId(), label: "新しい話題", emoji: "💬", children: [] } : { id: newNodeId(), label: "新しい言葉", say: "" };
    found.list.splice(found.index + 1, 0, node);
    changed();
    select(node.id);
}

function removeNode(id) {
    const found = findNode(id);
    if (!found) return;
    const n = countNodes([found.node]);
    if (!confirm(n > 1 ? `「${found.node.label}」と、その下の ${n - 1} 個の言葉を削除しますか？` : `「${found.node.label}」を削除しますか？`)) return;
    found.list.splice(found.index, 1);
    if (found.depth > 1 && found.list.length === 0) {
        // 続きがなくなった親は、親自体の言葉があれば葉になる
        delete found.trail[found.trail.length - 1].children;
    }
    selectedId = found.list[Math.min(found.index, found.list.length - 1)]?.id || found.trail[found.trail.length - 1]?.id || "";
    changed();
    renderTree();
    renderNodeForm();
}

function moveNode(id, step) {
    const found = findNode(id);
    if (!found) return;
    const to = found.index + step;
    if (to < 0 || to >= found.list.length) return;
    const [node] = found.list.splice(found.index, 1);
    found.list.splice(to, 0, node);
    changed();
    renderTree();
    renderNodeForm();
}

function changed() {
    scheduleSave();
}

// ---------------------------------------------------------
// 描画: 全体
// ---------------------------------------------------------
function renderAll() {
    renderDraftSelect();
    const has = Boolean(draft);
    $("workspace").hidden = !has;
    $("no-draft").hidden = has;
    $("delete-draft-btn").disabled = !has;
    if (!has) return;
    $("name-input").value = draft.name || "";
    $("protagonist-input").value = draft.protagonist || "";
    $("published-badge").hidden = !draft.publishedAt;
    renderTabs();
    renderInterview();
    renderPartners();
    renderTree();
    renderNodeForm();
    renderIssues();
    if (tab === "icons") renderIcons();
    if (tab === "publish") renderPublish();
}

function renderDraftSelect() {
    const sel = $("draft-select");
    sel.innerHTML = "";
    const blank = new Option("（選んでください）", "");
    sel.add(blank);
    for (const d of appState?.drafts || []) {
        const label = `${d.name || "（名前なし）"} ／ ${d.nodes} 項目${d.publishedAt ? " ／ 登録済み" : ""}`;
        sel.add(new Option(label, d.id, false, d.id === draft?.id));
    }
}

function renderTabs() {
    document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.dataset.panel === tab));
}

function setTab(next) {
    tab = next;
    if (draft) location.hash = `id=${draft.id}&tab=${tab}`;
    renderTabs();
    if (tab === "icons") renderIcons();
    if (tab === "publish") renderPublish();
}

// ---------------------------------------------------------
// ① インタビュー
// ---------------------------------------------------------
function renderInterview() {
    $("profile-gender").value = draft.profile?.gender || "";
    $("profile-age").value = draft.profile?.age ?? "";
    const list = $("interview-list");
    list.innerHTML = "";
    draft.interview.forEach((item, index) => {
        const box = document.createElement("div");
        box.className = "interview-item";
        const row = document.createElement("div");
        row.className = "q-row";
        const q = document.createElement("input");
        q.type = "text";
        q.value = item.q;
        q.addEventListener("input", () => { item.q = q.value; changed(); });
        const del = document.createElement("button");
        del.type = "button";
        del.textContent = "削除";
        del.addEventListener("click", () => {
            draft.interview.splice(index, 1);
            changed();
            renderInterview();
        });
        row.append(document.createTextNode(`Q${index + 1}.`), q, del);
        const a = document.createElement("textarea");
        a.rows = 2;
        a.placeholder = "答え（分からなければ空のまま）";
        a.value = item.a || "";
        a.addEventListener("input", () => { item.a = a.value; changed(); });
        box.append(row, a);
        list.appendChild(box);
    });
}

function setInterviewStatus(text, isError = false) {
    const el = $("interview-status");
    el.textContent = text;
    el.classList.toggle("error", isError);
}

async function aiQuestions() {
    await saveNow();
    setInterviewStatus("質問を作っています…");
    toggleBusy(true);
    try {
        const { questions } = await api("POST", "/api/questions", { profile: draft.profile, interview: draft.interview });
        const known = new Set(draft.interview.map(i => i.q));
        questions.filter(q => !known.has(q)).forEach(q => draft.interview.push({ q, a: "" }));
        changed();
        renderInterview();
        setInterviewStatus(`${questions.length} 個の質問を追加しました。答えてから「この回答でパターンを作る」を押してください。`);
    } catch (error) {
        setInterviewStatus(error.message, true);
    } finally {
        toggleBusy(false);
    }
}

async function generatePattern() {
    if (!draft.interview.some(i => i.a && i.a.trim())) {
        setInterviewStatus("質問に1つ以上答えてください。", true);
        return;
    }
    if (draft.tree.length > 0 && !confirm("今の会話の木を、新しく作ったもので置き換えます。よろしいですか？（直した内容は消えます）")) return;
    await saveNow();
    setInterviewStatus("会話パターンを作っています…（1〜3分かかります）");
    toggleBusy(true);
    try {
        applyDraftResponse(await api("POST", `/api/drafts/${draft.id}/generate`));
        expanded = new Set(draft.tree.map(t => t.id));
        selectedId = "";
        await loadState();
        renderAll();
        setInterviewStatus(`${countNodes(draft.tree)} 項目のパターンを作りました。「② 確認・修正」で見直してください。`);
    } catch (error) {
        setInterviewStatus(error.message, true);
    } finally {
        toggleBusy(false);
    }
}

function toggleBusy(busy) {
    for (const id of ["ai-questions-btn", "generate-btn", "make-icons-btn", "publish-btn"]) $(id).disabled = busy;
}

// ---------------------------------------------------------
// ② 確認・修正: 相手
// ---------------------------------------------------------
function renderPartners() {
    const list = $("partner-list");
    list.innerHTML = "";
    draft.partners.forEach((p, index) => {
        const row = document.createElement("div");
        row.className = "partner-row";
        const emoji = Object.assign(document.createElement("input"), { type: "text", className: "emoji", value: p.emoji || "", title: "絵文字" });
        emoji.addEventListener("input", () => { p.emoji = emoji.value.trim(); changed(); });
        const name = Object.assign(document.createElement("input"), { type: "text", className: "pname", value: p.name, placeholder: "呼び名（お母さん 等）" });
        name.addEventListener("input", () => { p.name = name.value; changed(); });
        const pid = Object.assign(document.createElement("input"), { type: "text", className: "pid", value: p.id, placeholder: "id（mother 等）", title: "英小文字の識別子。絵のファイル名にも使う" });
        pid.addEventListener("change", () => {
            const next = pid.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
            const prev = p.id;
            p.id = next;
            pid.value = next;
            // 「この相手のときだけ」の指定も付け替える
            walkNodes(draft.tree, (node) => {
                if (node.for) node.for = node.for.map(id => (id === prev ? next : id));
            });
            changed();
            renderNodeForm();
        });
        const del = Object.assign(document.createElement("button"), { type: "button", textContent: "削除" });
        del.addEventListener("click", () => {
            if (!confirm(`「${p.name}」を削除しますか？（この相手だけの言葉は、全員に出るようになります）`)) return;
            draft.partners.splice(index, 1);
            walkNodes(draft.tree, (node) => {
                if (!node.for) return;
                node.for = node.for.filter(id => id !== p.id);
                if (node.for.length === 0) delete node.for;
            });
            changed();
            renderPartners();
            renderNodeForm();
        });
        row.append(emoji, name, pid, del);
        list.appendChild(row);
    });
}

function addPartner() {
    draft.partners.push({ id: `p${draft.partners.length + 1}`, name: "", emoji: "🙂" });
    changed();
    renderPartners();
}

// ---------------------------------------------------------
// ② 確認・修正: 木
// ---------------------------------------------------------
function issueLevels() {
    const map = new Map();
    for (const issue of issues) {
        if (!issue.nodeId) continue;
        if (map.get(issue.nodeId) !== "error") map.set(issue.nodeId, issue.level);
    }
    return map;
}

function renderTree() {
    if (!draft) return;
    const levels = issueLevels();
    const build = (nodes) => {
        const ul = document.createElement("ul");
        for (const node of nodes) {
            const li = document.createElement("li");
            const item = document.createElement("div");
            item.className = "tree-item" + (node.id === selectedId ? " selected" : "");
            const hasChildren = (node.children || []).length > 0;
            const toggle = document.createElement("span");
            toggle.className = "tree-toggle";
            toggle.textContent = hasChildren ? (expanded.has(node.id) ? "▼" : "▶") : "";
            toggle.addEventListener("click", (e) => {
                e.stopPropagation();
                if (expanded.has(node.id)) expanded.delete(node.id);
                else expanded.add(node.id);
                renderTree();
            });
            const dot = document.createElement("span");
            dot.className = `dot ${icons[node.id]?.state || "missing"}`;
            dot.title = { ok: "絵あり", stale: "内容を直したので絵が古い", missing: "絵なし" }[icons[node.id]?.state || "missing"];
            const label = document.createElement("span");
            label.className = "tree-label";
            label.textContent = `${node.emoji || ""} ${node.label || "（ラベルなし）"}`.trim();
            item.append(toggle, dot, label);
            const level = levels.get(node.id);
            if (level) {
                const mark = document.createElement("span");
                mark.className = level === "error" ? "mark-err" : "mark-warn";
                mark.textContent = level === "error" ? "⛔" : "⚠";
                item.appendChild(mark);
            }
            if (node.say) {
                const say = document.createElement("span");
                say.className = "tree-say";
                say.textContent = node.say.replace(`${CALL}、`, "（呼び名）、");
                item.appendChild(say);
            }
            item.addEventListener("click", () => select(node.id));
            li.appendChild(item);
            if (hasChildren && expanded.has(node.id)) li.appendChild(build(node.children));
            ul.appendChild(li);
        }
        return ul;
    };
    const tree = $("tree");
    tree.innerHTML = "";
    tree.append(...build(draft.tree).childNodes);
    $("tree-count").textContent = `${countNodes(draft.tree)} 項目`;
}

// ---------------------------------------------------------
// ② 確認・修正: 選んだ言葉
// ---------------------------------------------------------
function field(labelText, input, extra) {
    const label = document.createElement("label");
    label.append(labelText, input);
    if (extra) label.appendChild(extra);
    return label;
}

function counter(text, max) {
    const el = document.createElement("span");
    const update = (value) => {
        const n = [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(value || "")].length;
        el.textContent = `${n} / ${max} 文字`;
        el.className = "counter" + (n > max ? " over" : "");
    };
    update(text);
    return { el, update };
}

function iconBox(key, fallbackEmoji, size) {
    const info = icons[key];
    if (info?.url) {
        const img = document.createElement("img");
        img.src = info.url;
        img.alt = "";
        if (size) img.style.width = img.style.height = size;
        return img;
    }
    const ph = document.createElement("div");
    ph.className = "placeholder";
    ph.textContent = fallbackEmoji || "・";
    return ph;
}

function renderNodeForm() {
    const pane = $("node-pane");
    pane.innerHTML = "";
    const found = selectedId ? findNode(selectedId) : null;
    if (!found) {
        pane.appendChild(Object.assign(document.createElement("p"), { className: "muted", textContent: "左の一覧から言葉を選んでください。" }));
        return;
    }
    const { node, depth, trail } = found;
    const form = document.createElement("div");
    form.className = "node-form";

    const trailEl = document.createElement("div");
    trailEl.className = "node-trail";
    trailEl.textContent = [...trail.map(t => t.label), node.label].join(" > ") + `（${depth}段目${depth === 1 ? "・話題" : ""}）`;
    form.appendChild(trailEl);

    // パネルの文字と絵文字
    const labelInput = Object.assign(document.createElement("input"), { type: "text", value: node.label || "" });
    const labelCount = counter(node.label, LABEL_MAX);
    labelInput.addEventListener("input", () => { node.label = labelInput.value; labelCount.update(node.label); changed(); renderTree(); });
    const emojiInput = Object.assign(document.createElement("input"), { type: "text", className: "emoji-input", value: node.emoji || "" });
    emojiInput.addEventListener("input", () => {
        const v = emojiInput.value.trim();
        if (v) node.emoji = v; else delete node.emoji;
        changed();
        renderTree();
    });
    const row = document.createElement("div");
    row.className = "row";
    row.append(field("パネルの文字", labelInput, labelCount.el), field("絵文字", emojiInput));
    form.appendChild(row);

    // 読み上げる言葉（話題には使わない）
    if (depth > 1) {
        const sayInput = document.createElement("textarea");
        sayInput.rows = 3;
        sayInput.value = node.say || "";
        sayInput.placeholder = (node.children || []).length > 0 ? "（空なら、選ぶと次の段へ進むだけ）" : "読み上げる言葉";
        const sayCount = counter(node.say, SAY_MAX);
        sayInput.addEventListener("input", () => {
            const v = sayInput.value.trim();
            if (v) node.say = v; else delete node.say;
            sayCount.update(v);
            changed();
            renderTree();
        });
        const callBtn = Object.assign(document.createElement("button"), { type: "button", textContent: "先頭の「{呼}、」を付ける／外す" });
        callBtn.addEventListener("click", () => {
            const v = node.say || "";
            node.say = v.startsWith(`${CALL}、`) ? v.slice(CALL.length + 1) : `${CALL}、${v}`;
            if (!node.say) delete node.say;
            sayInput.value = node.say || "";
            sayCount.update(sayInput.value);
            changed();
            renderTree();
        });
        const hint = document.createElement("small");
        hint.className = "muted";
        hint.textContent = "「{呼}、」は相手の呼び名（お母さん 等）に置き換わり、相手を決めていなければ消えます。";
        form.append(field("読み上げる言葉", sayInput, sayCount.el), callBtn, hint);

        // 時間帯と相手
        const timeSel = document.createElement("select");
        for (const [value, text] of Object.entries(TIME_LABELS)) timeSel.add(new Option(text, value, false, (node.time || "") === value));
        timeSel.addEventListener("change", () => {
            if (timeSel.value) node.time = timeSel.value; else delete node.time;
            changed();
        });
        form.appendChild(field("出す時間帯（あいさつ用）", timeSel));
    }

    if (draft.partners.length > 0) {
        const forBox = document.createElement("div");
        forBox.className = "for-list";
        for (const p of draft.partners) {
            const check = Object.assign(document.createElement("input"), { type: "checkbox", checked: (node.for || []).includes(p.id) });
            check.addEventListener("change", () => {
                const set = new Set(node.for || []);
                if (check.checked) set.add(p.id); else set.delete(p.id);
                if (set.size > 0) node.for = [...set]; else delete node.for;
                changed();
            });
            const label = document.createElement("label");
            label.append(check, `${p.emoji || ""} ${p.name || p.id}`);
            forBox.appendChild(label);
        }
        form.appendChild(field("この相手のときだけ出す（どれも付けなければ全員）", forBox));
    }

    // 絵
    const iconRow = document.createElement("div");
    iconRow.className = "node-icon";
    iconRow.id = "node-icon";
    form.appendChild(iconRow);

    // 操作
    const buttons = document.createElement("div");
    buttons.className = "node-buttons";
    const button = (text, fn, disabled = false) => {
        const b = Object.assign(document.createElement("button"), { type: "button", textContent: text, disabled });
        b.addEventListener("click", fn);
        buttons.appendChild(b);
    };
    button("＋ 続きを追加", () => addChild(node.id), depth >= 4);
    button(depth === 1 ? "＋ 次に話題を追加" : "＋ 次に言葉を追加", () => addSibling(node.id));
    button("↑ 上へ", () => moveNode(node.id, -1), found.index === 0);
    button("↓ 下へ", () => moveNode(node.id, 1), found.index === found.list.length - 1);
    button("削除", () => removeNode(node.id));
    form.appendChild(buttons);

    // アプリでこの言葉を選んだあとに並ぶパネル
    const children = node.children || [];
    if (children.length > 0) {
        const preview = document.createElement("div");
        preview.className = "preview";
        preview.appendChild(Object.assign(document.createElement("div"), { className: "muted", textContent: "選んだあとに並ぶパネル（クリックでその言葉へ）" }));
        const grid = document.createElement("div");
        grid.className = "preview-grid";
        for (const child of children) {
            const card = document.createElement("div");
            card.className = "preview-card";
            card.append(iconBox(child.id, child.emoji), document.createTextNode(child.label));
            card.addEventListener("click", () => select(child.id));
            grid.appendChild(card);
        }
        preview.appendChild(grid);
        form.appendChild(preview);
    }

    pane.appendChild(form);
    renderNodeIconOnly();
}

// 保存のたびに絵の状態が変わるので、その部分だけ描き直す
function renderNodeIconOnly() {
    const row = $("node-icon");
    if (!row || !selectedId) return;
    const found = findNode(selectedId);
    if (!found) return;
    const { node } = found;
    row.innerHTML = "";
    const state = icons[node.id]?.state || "missing";
    const text = document.createElement("div");
    text.className = "muted";
    text.textContent = { ok: "絵あり", stale: "内容を直したので、絵を作り直します", missing: "まだ絵がありません（③ 絵 で作ります）" }[state];
    const marked = (draft.regenerate || []).includes(node.id);
    const box = document.createElement("div");
    box.append(text);
    if (state === "ok") {
        const check = Object.assign(document.createElement("input"), { type: "checkbox", checked: marked });
        check.addEventListener("change", () => toggleRegenerate(node.id, check.checked));
        const label = document.createElement("label");
        label.style.flexDirection = "row";
        label.append(check, "この絵を作り直す");
        box.appendChild(label);
    }
    row.append(iconBox(node.id, node.emoji), box);
}

function toggleRegenerate(key, on) {
    const set = new Set(draft.regenerate || []);
    if (on) set.add(key); else set.delete(key);
    draft.regenerate = [...set];
    changed();
}

// ---------------------------------------------------------
// チェック
// ---------------------------------------------------------
function renderIssues() {
    const list = $("issue-list");
    list.innerHTML = "";
    const errors = issues.filter(i => i.level === "error").length;
    const warnings = issues.length - errors;
    $("issue-summary").textContent = issues.length === 0 ? "問題なし" : `エラー ${errors} 件・注意 ${warnings} 件`;
    for (const issue of issues) {
        const li = document.createElement("li");
        li.className = issue.level;
        li.textContent = `${issue.level === "error" ? "⛔" : "⚠"} ${issue.message}`;
        if (issue.nodeId) li.addEventListener("click", () => select(issue.nodeId));
        list.appendChild(li);
    }
}

// ---------------------------------------------------------
// ③ 絵
// ---------------------------------------------------------
function iconItems() {
    const items = [];
    walkNodes(draft.tree, (node, depth, trail) => items.push({ key: node.id, label: node.label, emoji: node.emoji, sub: trail.map(t => t.label).join(" > ") }));
    for (const p of draft.partners) items.push({ key: `talk-partner-${draft.id}-${p.id}`, label: p.name, emoji: p.emoji, sub: "話し相手" });
    return items;
}

function renderIcons() {
    const marked = new Set(draft.regenerate || []);
    const items = iconItems();
    const isTodo = (item) => marked.has(item.key) || (icons[item.key]?.state || "missing") !== "ok";
    document.querySelectorAll("#icon-filters button").forEach(b => b.classList.toggle("active", b.dataset.filter === iconFilter));
    const grid = $("icon-grid");
    grid.innerHTML = "";
    for (const item of items) {
        if (iconFilter === "todo" && !isTodo(item)) continue;
        if (iconFilter === "ok" && isTodo(item)) continue;
        const card = document.createElement("div");
        card.className = "icon-card";
        const state = icons[item.key]?.state || "missing";
        const stateEl = document.createElement("div");
        stateEl.className = `state ${state}`;
        stateEl.textContent = marked.has(item.key) ? "作り直す予定" : { ok: "作成済み", stale: "内容変更 → 作り直す予定", missing: "未作成 → 作る予定" }[state];
        const title = document.createElement("strong");
        title.textContent = `${item.emoji || ""} ${item.label}`.trim();
        const sub = Object.assign(document.createElement("div"), { className: "muted", textContent: item.sub });
        card.append(iconBox(item.key, item.emoji), title, sub, stateEl);
        if (state === "ok") {
            const check = Object.assign(document.createElement("input"), { type: "checkbox", checked: marked.has(item.key) });
            check.addEventListener("change", () => {
                toggleRegenerate(item.key, check.checked);
                renderIcons();
            });
            const label = document.createElement("label");
            label.append(check, "作り直す");
            card.appendChild(label);
        }
        if (draft.tree.length > 0 && findNode(item.key)) card.addEventListener("dblclick", () => { setTab("edit"); select(item.key); });
        grid.appendChild(card);
    }

    // 件数は手元で数える（実際に作るときはサーバーで数え直して確認する）
    const count = items.filter(isTodo).length;
    const sheets = Math.ceil(count / 20);
    const errors = issues.filter(i => i.level === "error").length;
    const notes = [];
    if (errors > 0) notes.push("先に ② のエラーを直してください");
    if (!appState?.hasKey) notes.push(".env に GEMINI_API_KEY がないため作れません");
    $("icon-plan").textContent = (count === 0
        ? "すべての絵がそろっています。作り直したい絵は「作り直す」に印を付けてください。"
        : `作る・作り直す絵: ${count} 件 → ${sheets} 枚のシート（1枚に20個ずつ描いて分割。モデル: ${appState?.imageModel || ""}）`)
        + (notes.length > 0 ? ` ／ ${notes.join(" ／ ")}` : "");
    $("make-icons-btn").disabled = count === 0 || errors > 0 || Boolean(appState?.job?.running) || !appState?.hasKey;
}

async function makeIcons() {
    await saveNow();
    const plan = await api("GET", `/api/drafts/${draft.id}/icon-plan`);
    if (!confirm(`${plan.count} 件の絵を、${plan.sheets} 枚のシートで作ります（Gemini の画像生成を ${plan.sheets} 回以上使います）。よろしいですか？`)) return;
    try {
        applyDraftResponse(await api("POST", `/api/drafts/${draft.id}/icons`));
        renderIcons();
    } catch (error) {
        alert(error.message);
    }
}

function watchJob(job) {
    if (appState) appState.job = job;
    const log = $("job-log");
    if (!job || job.draftId !== draft?.id) {
        log.hidden = true;
        return;
    }
    log.hidden = false;
    log.textContent = job.log.join("\n");
    log.scrollTop = log.scrollHeight;
    clearTimeout(jobTimer);
    if (job.running) {
        $("make-icons-btn").disabled = true;
        jobTimer = setTimeout(pollJob, 2500);
    }
}

async function pollJob() {
    if (!draft) return;
    const data = await api("GET", `/api/drafts/${draft.id}`).catch(() => null);
    if (!data) return;
    const wasRunning = appState?.job?.running;
    icons = data.icons;
    draft.regenerate = data.draft.regenerate;
    watchJob(data.job);
    if (tab === "icons") renderIcons();
    renderTree();
    if (wasRunning && !data.job?.running) renderNodeForm();
}

// ---------------------------------------------------------
// ④ 登録
// ---------------------------------------------------------
function renderPublish() {
    const box = $("publish-summary");
    box.innerHTML = "";
    const errors = issues.filter(i => i.level === "error").length;
    const items = iconItems();
    const done = items.filter(i => icons[i.key]?.state === "ok").length;
    const lines = [
        `会話の項目: ${countNodes(draft.tree)} 件、話し相手: ${draft.partners.length} 人`,
        errors > 0 ? `⛔ エラーが ${errors} 件あります（② で直してください）` : "✅ チェックのエラーはありません",
        done === items.length ? `✅ 絵: ${done} / ${items.length} 件そろっています` : `⚠ 絵: ${done} / ${items.length} 件（ない分はアプリで絵文字になります）`,
        draft.publishedAt ? `登録済み（${new Date(draft.publishedAt).toLocaleString("ja-JP")}）。直した内容は、もう一度登録するとアプリに反映されます。` : "まだ登録していません。",
        "登録すると dist/talk-sets/ に書き出し、アプリの 設定 → お話 → 会話パターン に出ます（アプリを再読み込み）。",
        "ほかの端末や公開版で使うには git にコミット・push してください。公開リポジトリでは内容を誰でも見られる点に注意（インタビューの答えは書き出しません）。"
    ];
    for (const line of lines) box.appendChild(Object.assign(document.createElement("p"), { textContent: line }));
    $("publish-btn").disabled = errors > 0;
    $("publish-btn").textContent = draft.publishedAt ? "もう一度登録（上書き）" : "アプリに登録";

    const list = $("published-list");
    list.innerHTML = "";
    for (const set of appState?.published || []) {
        const li = document.createElement("li");
        li.textContent = `${set.name}（${set.nodes} 項目・id: ${set.id}）`;
        const del = Object.assign(document.createElement("button"), { type: "button", textContent: "登録を外す" });
        del.addEventListener("click", async () => {
            const hasDraft = (appState?.drafts || []).some(d => d.id === set.id);
            if (!confirm(hasDraft
                ? `「${set.name}」をアプリから外しますか？（作りかけと絵は残るので、もう一度登録できます）`
                : `「${set.name}」をアプリから外しますか？（作りかけがないので、作った絵も削除します。元に戻せません）`)) return;
            await api("DELETE", `/api/published/${set.id}`, {});
            await loadState();
            if (draft.id === set.id) draft.publishedAt = null;
            renderAll();
        });
        li.appendChild(del);
        list.appendChild(li);
    }
    if (list.children.length === 0) list.appendChild(Object.assign(document.createElement("li"), { className: "muted", textContent: "まだありません" }));
}

async function publish() {
    await saveNow();
    const status = $("publish-status");
    try {
        const data = await api("POST", `/api/drafts/${draft.id}/publish`, {});
        applyDraftResponse(data);
        await loadState();
        renderAll();
        status.classList.remove("error");
        status.textContent = `登録しました（dist/talk-sets/${draft.id}.js）。アプリを再読み込みすると選べます。`;
    } catch (error) {
        status.classList.add("error");
        status.textContent = error.message;
    }
}

// ---------------------------------------------------------
// 作成・読み込み・削除
// ---------------------------------------------------------
async function createDraft(source, data) {
    try {
        const res = await api("POST", "/api/drafts", { source, data });
        await loadState();
        tab = source === "empty" ? "interview" : "edit";
        await openDraft(res.draft.id);
        if (res.draft.copiedIcons) setSaveStatus(`標準の絵 ${res.draft.copiedIcons} 件を引き継ぎました`);
    } catch (error) {
        alert(error.message);
    }
}

async function importFile(file) {
    try {
        const data = JSON.parse(await file.text());
        await createDraft("import", data);
    } catch (error) {
        alert(`読み込めませんでした: ${error.message}`);
    }
}

async function deleteDraft() {
    if (!draft) return;
    const iconCount = Object.values(icons).filter(i => i.url).length;
    if (!confirm(`「${draft.name || "（名前なし）"}」を削除しますか？
作った絵（${iconCount} 枚）も削除し${draft.publishedAt ? "、アプリへの登録も外し" : ""}ます。元に戻せません。`)) return;
    await api("DELETE", `/api/drafts/${draft.id}`, {});
    draft = null;
    await loadState();
    location.hash = "";
    renderAll();
}

// ---------------------------------------------------------
// 起動
// ---------------------------------------------------------
function bind() {
    $("draft-select").addEventListener("change", async (e) => {
        await saveNow();
        openDraft(e.target.value);
    });
    $("new-empty-btn").addEventListener("click", () => createDraft("empty"));
    $("new-default-btn").addEventListener("click", () => createDraft("default"));
    $("import-input").addEventListener("change", (e) => {
        if (e.target.files[0]) importFile(e.target.files[0]);
        e.target.value = "";
    });
    $("delete-draft-btn").addEventListener("click", deleteDraft);
    $("name-input").addEventListener("input", (e) => { draft.name = e.target.value; changed(); });
    $("protagonist-input").addEventListener("input", (e) => { draft.protagonist = e.target.value.trim(); changed(); });
    document.querySelectorAll("#tabs button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
    $("profile-gender").addEventListener("change", (e) => { draft.profile = { ...draft.profile, gender: e.target.value }; changed(); });
    $("profile-age").addEventListener("input", (e) => {
        const age = Number.parseInt(e.target.value, 10);
        draft.profile = { ...draft.profile, age: Number.isFinite(age) && age > 0 ? age : null };
        changed();
    });
    $("add-question-btn").addEventListener("click", () => {
        draft.interview.push({ q: "", a: "" });
        changed();
        renderInterview();
    });
    $("ai-questions-btn").addEventListener("click", aiQuestions);
    $("generate-btn").addEventListener("click", generatePattern);
    $("add-partner-btn").addEventListener("click", addPartner);
    $("add-topic-btn").addEventListener("click", addTopic);
    $("expand-all-btn").addEventListener("click", () => {
        walkNodes(draft.tree, node => { if (node.children) expanded.add(node.id); });
        renderTree();
    });
    $("collapse-all-btn").addEventListener("click", () => {
        expanded = new Set();
        renderTree();
    });
    document.querySelectorAll("#icon-filters button").forEach(b => b.addEventListener("click", () => {
        iconFilter = b.dataset.filter;
        renderIcons();
    }));
    $("make-icons-btn").addEventListener("click", makeIcons);
    $("publish-btn").addEventListener("click", publish);
    window.addEventListener("beforeunload", () => { if (saveTimer) saveNow(); });
}

async function start() {
    bind();
    await loadState();
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.get("tab")) tab = params.get("tab");
    const id = params.get("id") || appState.drafts[0]?.id || "";
    if (!appState.hasKey) setSaveStatus(".env に GEMINI_API_KEY がないため、AI での作成と絵の作成は使えません");
    await openDraft(id).catch(() => openDraft(""));
    if (params.get("select")) select(params.get("select"));
}

start();
