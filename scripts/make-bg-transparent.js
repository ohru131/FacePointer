#!/usr/bin/env node

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const mediaDir = path.join(__dirname, '../dist/media');

async function processImages() {
  // PNGファイルの一覧を取得
  const pngFiles = fs.readdirSync(mediaDir)
    .filter(file => file.endsWith('.png'))
    .map(file => path.join(mediaDir, file));

  console.log(`Found ${pngFiles.length} PNG files. Processing...`);

  for (const filePath of pngFiles) {
    const fileName = path.basename(filePath);
    try {
      // 画像を読み込み、ピクセル処理で白背景を透明化
      const { data, info } = await sharp(filePath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const pixelCount = data.length / 4;  // RGBA = 4 channels

      // ピクセル処理：白（255,255,255）または明るい色をアルファ0（透明）に
      for (let i = 0; i < pixelCount; i++) {
        const idx = i * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // 白または非常に明るい色（R,G,Bがすべて250以上）
        if (r >= 250 && g >= 250 && b >= 250) {
          data[idx + 3] = 0;  // アルファ値を0（完全透明）に
        }
      }

      // 処理済み画像を保存
      await sharp(data, {
        raw: {
          width: info.width,
          height: info.height,
          channels: 4
        }
      })
      .png()
      .toFile(filePath);

      console.log(`✓ ${fileName}`);
    } catch (error) {
      console.error(`✗ ${fileName}: ${error.message}`);
    }
  }

  console.log('Done');
}

processImages().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
