import { defineConfig } from "@playwright/test";

const PORT = 5199;

export default defineConfig({
    testDir: "tests/e2e",
    timeout: 60_000,
    fullyParallel: true,
    // Chrome と MediaPipe を同時にたくさん起動すると起動が詰まるので絞る
    workers: 4,
    reporter: "list",
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        // ブラウザは別途ダウンロードせず、インストール済みの Chrome を使う
        channel: "chrome",
        viewport: { width: 1600, height: 900 },
        permissions: ["camera"],
        launchOptions: {
            args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
        }
    },
    webServer: {
        command: `node tests/static-server.mjs`,
        env: { PORT: String(PORT) },
        url: `http://127.0.0.1:${PORT}/index.html`,
        reuseExistingServer: !process.env.CI
    }
});
