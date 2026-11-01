// E2E テスト用の静的サーバー（dist をそのまま配る）
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const PORT = Number(process.env.PORT || 5199);
const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".task": "application/octet-stream"
};

http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403).end();
        return;
    }
    fs.readFile(filePath, (error, data) => {
        if (error) {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(filePath)] || "application/octet-stream" });
        res.end(data);
    });
}).listen(PORT, () => console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}`));
