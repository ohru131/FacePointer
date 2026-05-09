import os
from PIL import Image

# 画像読み込み
img_path = r'c:\work\pv\FaceDetect\dist\media\sub_topic_icon.png'
if not os.path.exists(img_path):
    print(f'IMAGE_NOT_FOUND: {img_path}')
    exit()

img = Image.open(img_path)
w, h = img.size

# 3行 x 4列 の分割
rows = 3
cols = 4
cell_w = w // cols
cell_h = h // rows

# 出力先
output_dir = r'c:\work\pv\FaceDetect\dist\media'
os.makedirs(output_dir, exist_ok=True)

# ファイル名マッピング
names = [
    ['1-1.png', '1-2.png', '1-3.png', '1-4.png'],
    ['2-1.png', '2-2.png', '2-3.png', '2-4.png'],
    ['3-1.png', '3-2.png', '3-3.png', '3-4.png']
]

for r in range(rows):
    for c in range(cols):
        left = c * cell_w
        top = r * cell_h
        right = left + cell_w
        bottom = top + cell_h
        
        # 切り抜き
        icon = img.crop((left, top, right, bottom))
        
        # 背景を透明にする処理（白地を透明に）
        icon = icon.convert('RGBA')
        datas = icon.getdata()
        newData = []
        for item in datas:
            # 白に近い色（240以上）を透明にする
            if item[0] > 240 and item[1] > 240 and item[2] > 240:
                newData.append((255, 255, 255, 0))
            else:
                newData.append(item)
        icon.putdata(newData)

        save_name = names[r][c]
        save_path = os.path.join(output_dir, save_name)
        icon.save(save_path)
        print(f'Saved: {save_name}')
