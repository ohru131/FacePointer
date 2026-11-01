// 顔が映るテスト（tests/e2e/face.spec.js）用の偽カメラ映像を、まだ無ければ作っておく
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeFaceVideo } from "./support/face-video.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FACE_VIDEO = path.join(ROOT, "tests", ".cache", "face.mjpeg");

export default async function globalSetup() {
    await makeFaceVideo(path.join(ROOT, "dist", "media", "gen", "talk-partner-mother.webp"), FACE_VIDEO);
}
