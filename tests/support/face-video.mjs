// 顔のイラストを左右・上下にゆっくり動かす偽カメラ映像（MJPEG）を作る。
// Chrome の --use-file-for-fake-video-capture に渡すと、カメラにこの映像が映る
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const SECONDS = 12;
// 最初は正面で止まり（起動時の正面の登録）、そのあと左右・上下に動かす
const STILL_SECONDS = 3;

export async function makeFaceVideo(faceImage, outFile) {
    if (fs.existsSync(outFile)) return outFile;
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const face = await sharp(faceImage).resize({ height: 560 }).png().toBuffer();
    const { width: faceWidth, height: faceHeight } = await sharp(face).metadata();
    const frames = [];
    for (let i = 0; i < FPS * SECONDS; i++) {
        const t = Math.max(0, i / FPS - STILL_SECONDS);
        const left = Math.round((WIDTH - faceWidth) / 2 + 220 * Math.sin(t * 0.9));
        const top = Math.round((HEIGHT - faceHeight) / 2 + 60 * Math.sin(t * 0.5));
        frames.push(await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: { r: 200, g: 205, b: 210 } } })
            .composite([{ input: face, left, top }])
            .jpeg({ quality: 80 })
            .toBuffer());
    }
    fs.writeFileSync(outFile, Buffer.concat(frames));
    return outFile;
}
