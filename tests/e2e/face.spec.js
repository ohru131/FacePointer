// 顔が映ったカメラ映像でポインタが動き、パネルに乗ることを確かめる（偽カメラに顔のイラストを動かす映像を流す）
import path from "node:path";
import { test, expect } from "@playwright/test";

// tests/global-setup.mjs が作る映像
const FACE_VIDEO = path.join(__dirname, "..", ".cache", "face.mjpeg");

test.use({
    launchOptions: {
        args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            `--use-file-for-fake-video-capture=${FACE_VIDEO}`
        ]
    }
});

for (const pointerMode of ["absolute", "relative"]) {
    test(`顔を動かすとポインタが動いてパネルに乗る（${pointerMode === "absolute" ? "絶対" : "相対"}方式）`, async ({ page }) => {
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.addInitScript((mode) => {
            if (sessionStorage.getItem("__e2e_init")) return;
            sessionStorage.setItem("__e2e_init", "1");
            localStorage.clear();
            localStorage.setItem("calibration_version", "2");
            localStorage.setItem("pointer_mode", mode);
            localStorage.setItem("question_config_v1", JSON.stringify({ gridSize: "3x3" }));
        }, pointerMode);
        await page.goto("/");
        await page.locator("#question-mode-bar .question-mode-btn", { hasText: "どこが痛い？" }).click();

        // 乗ったパネルを集める（映像は 12 秒で一周する）
        const hovered = new Set();
        const positions = new Set();
        const deadline = Date.now() + 25_000;
        while (Date.now() < deadline && hovered.size < 3) {
            const state = await page.evaluate(() => {
                const rect = document.getElementById("pointer").getBoundingClientRect();
                return {
                    position: `${Math.round(rect.left)},${Math.round(rect.top)}`,
                    hover: document.querySelector(".h-btn.hover")?.innerText.trim() || ""
                };
            });
            if (state.hover) hovered.add(state.hover);
            positions.add(state.position);
            await page.waitForTimeout(200);
        }
        expect(positions.size).toBeGreaterThan(3);
        expect(hovered.size).toBeGreaterThanOrEqual(3);
        expect(errors).toEqual([]);
    });
}
