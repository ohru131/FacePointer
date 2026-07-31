#!/usr/bin/env node

const path = require("node:path");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const MEDIA_DIR = path.join(ROOT, "dist", "media");
const SCRIPTS_DIR = path.join(ROOT, "scripts");

const SOURCE_A = path.join(SCRIPTS_DIR, "Gemini_Generated_Image_ksardoksardoksar.png");
const SOURCE_B = path.join(SCRIPTS_DIR, "Gemini_Generated_Image_jhmca9jhmca9jhmc.png");

const BASE_NAMES = [
  "menu-body",
  "menu-itchy",
  "menu-hurt",
  "menu-bloated-stomach",
  "menu-toilet",
  "menu-request",
  "menu-suction",
  "menu-change-position",
  "menu-massage",
  "menu-hot-cold",
  "menu-refresh",
  "menu-talk",
  "menu-book",
  "menu-music",
  "menu-dvd",
  "menu-conversation",
  "menu-thank-you",
  "menu-continue-talking",
  "menu-change-topic",
  "menu-rest-little",
];

function isInk(r, g, b, a) {
  if (a < 8) return false;
  return !(r > 245 && g > 245 && b > 245);
}

function isBackgroundLike(r, g, b, a) {
  if (a < 8) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max - min;
  const bright = (r + g + b) / 3;
  return bright >= 212 && sat <= 42;
}

function findTileBoxes(raw, width, height) {
  const visited = new Uint8Array(width * height);
  const boxes = [];

  function idx(x, y) {
    return (y * width + x) * 4;
  }

  function vIdx(x, y) {
    return y * width + x;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const vi = vIdx(x, y);
      if (visited[vi]) continue;

      const i = idx(x, y);
      if (!isInk(raw[i], raw[i + 1], raw[i + 2], raw[i + 3])) {
        visited[vi] = 1;
        continue;
      }

      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let count = 0;

      const q = [[x, y]];
      visited[vi] = 1;

      while (q.length > 0) {
        const [cx, cy] = q.pop();
        count++;

        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx > maxX) maxX = cx;
        if (cy > maxY) maxY = cy;

        const neighbors = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];

        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nvi = vIdx(nx, ny);
          if (visited[nvi]) continue;
          visited[nvi] = 1;

          const ni = idx(nx, ny);
          if (isInk(raw[ni], raw[ni + 1], raw[ni + 2], raw[ni + 3])) {
            q.push([nx, ny]);
          }
        }
      }

      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const area = w * h;
      if (w >= 220 && h >= 220 && area >= 70000 && count >= 12000) {
        boxes.push({
          x: minX,
          y: minY,
          w,
          h,
          cx: minX + w / 2,
          cy: minY + h / 2,
        });
      }
    }
  }

  if (boxes.length !== 20) {
    throw new Error(`Expected 20 tile boxes, detected ${boxes.length}`);
  }

  boxes.sort((a, b) => a.cy - b.cy || a.cx - b.cx);

  const rows = [];
  for (const box of boxes) {
    let target = null;
    for (const row of rows) {
      if (Math.abs(row.cy - box.cy) <= 90) {
        target = row;
        break;
      }
    }
    if (!target) {
      target = { items: [], cy: box.cy };
      rows.push(target);
    }
    target.items.push(box);
    target.cy = target.items.reduce((s, b) => s + b.cy, 0) / target.items.length;
  }

  rows.sort((a, b) => a.cy - b.cy);
  if (rows.length !== 4) {
    throw new Error(`Expected 4 rows, detected ${rows.length}`);
  }

  const ordered = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.cx - b.cx);
    if (row.items.length !== 5) {
      throw new Error(`Expected 5 columns in a row, detected ${row.items.length}`);
    }
    ordered.push(...row.items);
  }

  return ordered;
}

function applyEdgeConnectedTransparency(raw, width, height) {
  const mask = new Uint8Array(width * height);
  const queue = [];

  function idx(x, y) {
    return (y * width + x) * 4;
  }

  function pushIfBackground(x, y) {
    const mi = y * width + x;
    if (mask[mi]) return;
    const i = idx(x, y);
    if (!isBackgroundLike(raw[i], raw[i + 1], raw[i + 2], raw[i + 3])) return;
    mask[mi] = 1;
    queue.push([x, y]);
  }

  for (let x = 0; x < width; x++) {
    pushIfBackground(x, 0);
    pushIfBackground(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    pushIfBackground(0, y);
    pushIfBackground(width - 1, y);
  }

  while (queue.length > 0) {
    const [x, y] = queue.pop();
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      pushIfBackground(nx, ny);
    }
  }

  const out = Buffer.from(raw);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mi = y * width + x;
      if (!mask[mi]) continue;

      let nearForeground = false;
      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nmi = ny * width + nx;
        if (!mask[nmi]) {
          nearForeground = true;
          break;
        }
      }

      const i = (y * width + x) * 4;
      out[i + 3] = nearForeground ? 28 : 0;
    }
  }

  return out;
}

function trimTopSparseRows(raw, width, height) {
  const maxTrim = Math.min(48, Math.floor(height * 0.18));
  const minInk = Math.max(12, Math.floor(width * 0.04));

  let top = 0;
  while (top < maxTrim) {
    let ink = 0;
    for (let x = 0; x < width; x++) {
      const i = (top * width + x) * 4;
      if (raw[i + 3] > 120) ink++;
    }
    if (ink >= minInk) break;
    top++;
  }

  if (top <= 0) {
    return { data: raw, width, height };
  }

  const newHeight = height - top;
  const out = Buffer.alloc(width * newHeight * 4);
  const rowBytes = width * 4;
  for (let y = 0; y < newHeight; y++) {
    const srcStart = (y + top) * rowBytes;
    const dstStart = y * rowBytes;
    raw.copy(out, dstStart, srcStart, srcStart + rowBytes);
  }

  return { data: out, width, height: newHeight };
}

async function cropAndSaveSet(sourcePath, suffix) {
  const src = sharp(sourcePath);
  const { width, height } = await src.metadata();
  if (!width || !height) {
    throw new Error(`Invalid image metadata: ${sourcePath}`);
  }

  const raw = await src.ensureAlpha().raw().toBuffer();
  const boxes = findTileBoxes(raw, width, height);

  const written = [];
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    const side = Math.min(box.w, box.h);

    // 文字成分（左の行ラベル・上の見出し）が混ざるケースを避けるため、
    // 正方形に正規化して右下寄せでタイル領域を確定する。
    const normX = box.x + Math.max(0, box.w - side);
    const normY = box.y + Math.max(0, box.h - side);
    const pad = 4;
    const left = Math.max(0, normX - pad);
    const top = Math.max(0, normY - pad);
    const right = Math.min(width, normX + side + pad);
    const bottom = Math.min(height, normY + side + pad);
    const w = right - left;
    const h = bottom - top;

    const tileRaw = await src
      .clone()
      .extract({ left, top, width: w, height: h })
      .ensureAlpha()
      .raw()
      .toBuffer();

    const alphaApplied = applyEdgeConnectedTransparency(tileRaw, w, h);
    const trimmed = trimTopSparseRows(alphaApplied, w, h);

    const base = BASE_NAMES[i];
    const fileName = suffix ? `${base}-${suffix}.png` : `${base}.png`;
    const outPath = path.join(MEDIA_DIR, fileName);

    await sharp(trimmed.data, { raw: { width: trimmed.width, height: trimmed.height, channels: 4 } })
      .png()
      .toFile(outPath);

    written.push(fileName);
  }

  return written;
}

async function main() {
  const created = [];

  const setSimple = await cropAndSaveSet(SOURCE_A, "");
  created.push(...setSimple);

  const setComic = await cropAndSaveSet(SOURCE_A, "comic");
  created.push(...setComic);

  const setComic2 = await cropAndSaveSet(SOURCE_B, "comic2");
  created.push(...setComic2);

  console.log(`Created ${created.length} files:`);
  for (const name of created) {
    console.log(`- ${name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
