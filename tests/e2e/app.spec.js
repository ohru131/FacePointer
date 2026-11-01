// 画面の主な動きを確かめるスモークテスト（偽のカメラで起動するので、顔の動きは使わずマウスで操作する）
import { test, expect } from "@playwright/test";

const GRID_PANELS = "#simple-grid .h-btn:not(.h-btn--empty)";

// 起動前の localStorage を決めて開く。校正済みにしておき、初回の案内は出さない
async function openApp(page, storage = {}) {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    await page.addInitScript((initial) => {
        if (sessionStorage.getItem("__e2e_init")) return;
        sessionStorage.setItem("__e2e_init", "1");
        localStorage.clear();
        localStorage.setItem("calibration_version", "2");
        for (const [key, value] of Object.entries(initial)) localStorage.setItem(key, value);
    }, storage);
    await page.goto("/");
    await expect(page.locator(GRID_PANELS).first()).toBeVisible();
    return errors;
}

async function panelNames(page) {
    return page.locator(`${GRID_PANELS} .h-btn-text`).allInnerTexts();
}

async function openSettingsTab(page, tab) {
    await page.click("#settings-btn");
    await expect(page.locator("#settings-modal")).toHaveClass(/active/);
    await page.click(`.settings-tab-btn[data-tab="${tab}"]`);
}

async function saveSettings(page) {
    await page.click("#save-settings");
    await expect(page.locator("#settings-modal")).not.toHaveClass(/active/);
}

async function waitConfirmHidden(page) {
    await expect(page.locator("#confirm-overlay")).not.toHaveClass(/active/, { timeout: 15_000 });
}

test("起動すると質問モードで最初の質問を出す", async ({ page }) => {
    const errors = await openApp(page);
    await expect(page.locator("#app")).toHaveAttribute("data-question-mode", "1");
    await expect(page.locator(".simple-message-question")).toContainText("気分はどうですか？");
    expect(await panelNames(page)).toEqual(["いい", "ふつう", "悪い", "疲れた"]);
    await expect(page.locator("#question-mode-bar .question-mode-btn")).toHaveCount(16);
    // 質問のアイコンがすべて読み込める
    await expect.poll(() => page.locator("#question-mode-bar img.question-mode-icon").evaluateAll(
        imgs => imgs.filter(img => !img.complete || img.naturalWidth === 0).map(img => img.getAttribute("src"))
    )).toEqual([]);
    await expect(page.locator("#simple-bar")).toContainText("休憩");
    expect(errors.filter(e => !e.startsWith("INFO:"))).toEqual([]);
});

for (const legacy of ["symptom", "simple"]) {
    test(`廃止した ${legacy} モードを選んでいた人は質問モードで始まる`, async ({ page }) => {
        await openApp(page, { app_mode: legacy });
        await expect(page.locator("#app")).toHaveAttribute("data-question-mode", "1");
    });
}

test("質問バーで質問を切り替え、答えると質問文の横に出る", async ({ page }) => {
    await openApp(page);
    await page.locator("#question-mode-bar .question-mode-btn", { hasText: "暑い？寒い？" }).click();
    await expect(page.locator(".simple-message-question")).toContainText("暑いですか？寒いですか？");
    await expect(page.locator("#question-mode-bar .question-mode-btn.active")).toContainText("暑い？寒い？");

    await page.locator(GRID_PANELS, { hasText: "暑い" }).first().click();
    await expect(page.locator("#confirm-overlay")).toHaveClass(/active/);
    await expect(page.locator("#confirm-text")).toHaveText("暑いです。");
    await expect(page.locator(".simple-message-answer")).toContainText("暑いです。");
    await waitConfirmHidden(page);
    // 答えても同じ質問のまま
    await expect(page.locator(".simple-message-question")).toContainText("暑いですか？寒いですか？");
    // 最後に出した質問を次の起動でも出す
    await page.reload();
    await expect(page.locator(".simple-message-question")).toContainText("暑いですか？寒いですか？");
});

test("休憩中は答えを選べず、再開で戻る", async ({ page }) => {
    await openApp(page);
    await page.locator("#simple-bar .h-btn", { hasText: "休憩" }).click();
    await expect(page.locator("#app")).toHaveAttribute("data-simple-paused", "1");
    await page.locator(GRID_PANELS).first().click();
    await expect(page.locator("#confirm-overlay")).not.toHaveClass(/active/);
    await page.locator("#simple-bar .h-btn", { hasText: "再開" }).click();
    await expect(page.locator("#app")).toHaveAttribute("data-simple-paused", "0");
});

test("入りきらない答えは左右の前へ・次へでページ送りし、端で回り込む", async ({ page }) => {
    await openApp(page, { question_config_v1: JSON.stringify({ gridSize: "3x1" }) });
    await page.locator("#question-mode-bar .question-mode-btn", { hasText: "どこが痛い？" }).click();
    await expect(page.locator("#simple-grid")).toHaveAttribute("data-cols", "3");
    const first = await panelNames(page);
    expect(first).toHaveLength(3);
    const label = page.locator("#simple-side-next .simple-page-label");
    await expect(label).toHaveText(/^1\/\d+$/);
    const pageCount = Number((await label.innerText()).split("/")[1]);
    expect(pageCount).toBeGreaterThan(1);

    await page.locator("#simple-side-next .h-btn").click();
    await expect(label).toHaveText(`2/${pageCount}`);
    expect(await panelNames(page)).not.toEqual(first);

    await page.locator("#simple-side-prev .h-btn").click();
    await page.locator("#simple-side-prev .h-btn").click();
    await expect(label).toHaveText(`${pageCount}/${pageCount}`);
});

test("次へボタンは右端まで伸び、右上のボタン列と重ならない", async ({ page }) => {
    await openApp(page, { question_config_v1: JSON.stringify({ gridSize: "4x1" }) });
    await page.locator("#question-mode-bar .question-mode-btn", { hasText: "どこが痛い？" }).click();
    await expect(page.locator("#simple-grid")).toHaveAttribute("data-cols", "4");
    const next = await page.locator("#simple-side-next .h-btn").boundingBox();
    const actions = await page.locator("#quick-actions").boundingBox();
    const viewport = page.viewportSize();
    expect(next.x + next.width).toBeGreaterThan(viewport.width - 40);
    expect(next.y).toBeGreaterThanOrEqual(actions.y + actions.height);
});

test("設定で 1画面のパネルの数を 4×1 にすると保存して反映する", async ({ page }) => {
    await openApp(page);
    await openSettingsTab(page, "question-tab");
    await page.locator('input[name="question-grid-size"][value="4x1"] + span').click();
    await saveSettings(page);
    await page.locator("#question-mode-bar .question-mode-btn", { hasText: "どこが痛い？" }).click();
    await expect(page.locator("#simple-grid")).toHaveAttribute("data-cols", "4");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("question_config_v1")));
    expect(stored.gridSize).toBe("4x1");
});

test("設定をキャンセルすると変更を保存しない", async ({ page }) => {
    await openApp(page);
    await openSettingsTab(page, "question-tab");
    await page.locator('input[name="question-grid-size"][value="4x1"] + span').click();
    await page.click("#close-settings");
    await expect(page.locator("#settings-modal")).not.toHaveClass(/active/);
    const stored = await page.evaluate(() => localStorage.getItem("question_config_v1"));
    expect(stored === null || !stored.includes("4x1")).toBe(true);
});

test("任意パネルを作ると編集中の質問の答えに入り、保存すると画面に出る", async ({ page }) => {
    await openApp(page);
    await openSettingsTab(page, "question-tab");
    await page.fill("#simple-custom-name-input", "テレビ");
    await page.fill("#simple-custom-emoji-input", "📺");
    await page.click("#simple-custom-add-btn");
    // 最初の質問（気分は？ 4つ）の答えの最後に入る
    await expect(page.locator("#question-answer-summary")).toContainText("5 枚");
    await saveSettings(page);

    const custom = await page.evaluate(() => JSON.parse(localStorage.getItem("simple_custom_panels_v1")));
    expect(custom).toEqual([expect.objectContaining({ name: "テレビ", emoji: "📺" })]);
    expect(await panelNames(page)).toEqual(["いい", "ふつう", "悪い", "疲れた", "テレビ"]);
});

test("お話モード: 話題をたどって話し、戻る・最初からが使える", async ({ page }) => {
    await openApp(page);
    await openSettingsTab(page, "basic-tab");
    await page.locator('input[name="app-mode"][value="talk"] + *').click();
    await saveSettings(page);
    await expect(page.locator("#app")).toHaveAttribute("data-talk", "1");
    await expect(page.locator("#app")).toHaveAttribute("data-question-mode", "0");
    await expect(page.locator("#simple-tabs .simple-tab")).toHaveCount(4);

    await page.locator(GRID_PANELS, { hasText: "あいさつ" }).click();
    await expect(page.locator(".simple-message-chip")).toContainText(["あいさつ"]);
    await expect(page.locator("#simple-bar .h-btn", { hasText: "戻る" })).not.toHaveClass(/is-disabled/);

    await page.locator(GRID_PANELS, { hasText: "来てくれて" }).click();
    await page.locator(GRID_PANELS, { hasText: "これで話す" }).click();
    await expect(page.locator("#confirm-text")).toHaveText("来てくれてありがとう。");
    await waitConfirmHidden(page);

    await page.locator("#simple-bar .h-btn", { hasText: "最初から" }).click();
    await expect(page.locator(GRID_PANELS, { hasText: "あいさつ" })).toBeVisible();
    await expect(page.locator("#simple-bar .h-btn", { hasText: "戻る" })).toHaveClass(/is-disabled/);

    await page.locator("#simple-tabs .simple-tab", { hasText: "相づち" }).click();
    expect(await panelNames(page)).toContain("うんうん");
});

test("お話モード中に「今すぐ質問する」で回答パネルへ切り替え、やめるで戻る", async ({ page }) => {
    await openApp(page, { app_mode: "talk" });
    await expect(page.locator("#app")).toHaveAttribute("data-talk", "1");
    await openSettingsTab(page, "question-tab");
    await page.locator("#question-buttons .question-btn", { hasText: "わかった？" }).click();
    await expect(page.locator("#settings-modal")).not.toHaveClass(/active/);
    await expect(page.locator("#app")).toHaveAttribute("data-question", "1");
    await expect(page.locator(".simple-message-question")).toContainText("わかりましたか？");
    await page.locator("#simple-bar .h-btn", { hasText: "やめる" }).click();
    await expect(page.locator("#app")).toHaveAttribute("data-question", "0");
    await expect(page.locator("#app")).toHaveAttribute("data-talk", "1");
});

test("1366×768 でも設定の質問一覧のアイコンが出る", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openApp(page);
    await openSettingsTab(page, "question-tab");
    const icons = page.locator("#question-editor-list .question-editor-icon");
    await expect(icons.first()).toBeVisible();
    await expect.poll(() => icons.evaluateAll(imgs => imgs.filter(img => !img.complete || img.naturalWidth === 0).length)).toBe(0);
});
