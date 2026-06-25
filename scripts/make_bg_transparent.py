#!/usr/bin/env python3

from PIL import Image
import os
from pathlib import Path

def make_white_transparent(image_path, brightness_threshold=220):
    """
    白または白っぽい色をアルファ値0（透明）に変換
    brightness_threshold: 明るさの閾値（0-255）
    """
    img = Image.open(image_path)
    
    # RGBAに変換（アルファチャネルを追加）
    img = img.convert('RGBA')
    
    # ピクセルデータを取得
    data = img.getdata()
    
    # 新しいピクセルデータを作成
    new_data = []
    for item in data:
        r, g, b = item[:3]
        a = item[3] if len(item) > 3 else 255
        
        # RGB値の平均（明るさ）を計算
        brightness = (int(r) + int(g) + int(b)) // 3
        
        # 白っぽい色（明るさがthreshold以上かつRGBがほぼ同じ値）
        # アンチエイリアス線を含める
        if brightness >= brightness_threshold:
            # さらに、彩度が低い（グレースケール的）かどうかで判定
            # R,G,Bの最大値と最小値の差が小さい = 彩度が低い
            max_val = max(r, g, b)
            min_val = min(r, g, b)
            saturation = max_val - min_val
            
            # 彩度が30以下で明るい = 白っぽい
            if saturation <= 30:
                a = 0  # 透明に
        
        new_data.append((r, g, b, a))
    
    # 新しいピクセルデータを設定
    img.putdata(new_data)
    
    # PNGで保存
    img.save(image_path, 'PNG')
    return True

def main():
    media_dir = Path(__file__).parent.parent / 'dist' / 'media'
    
    if not media_dir.exists():
        print(f"Error: {media_dir} directory not found")
        return
    
    # PNGファイルを検索
    png_files = sorted(media_dir.glob('*.png'))
    
    if not png_files:
        print(f"No PNG files found in {media_dir}")
        return
    
    print(f"Found {len(png_files)} PNG files. Processing...")
    
    for png_file in png_files:
        try:
            make_white_transparent(str(png_file))
            print(f"✓ {png_file.name}")
        except Exception as e:
            print(f"✗ {png_file.name}: {e}")
    
    print("Done")

if __name__ == '__main__':
    main()
