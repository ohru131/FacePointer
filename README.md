# FacePointer

FacePointerは、顔の動きだけで操作できるコミュニケーションボード（意思伝達装置）です。
発話や肢体に不自由がある方、失語症などの症状がある方が、視線やまばたき（または特定の顔のジェスチャー）で自分の意思を周囲に伝えることを目的としています。

![App Preview](media/FacePointer.png) <!-- アイコンなどがあればここに配置 -->

## 🌟 主な機能

- **顔トラッキング:** MediaPipe FaceLandmarkerを使用した、高精度かつ低遅延な顔認識。
- **ポインタ操作:** 鼻の向きでマウスカーソル（赤いポインタ）を操作し、ボタンを選択。
- **3段階の階層メニュー:** 「したい事」→「具体的な動作」→「最終決定」の流れで、直感的に文章を構築。
- **確定ゾーン方式:** 画面下部の特定のエリアにポインタを置く（滞留させる）ことで決定。誤操作を防止。
- **高品質な音声合成:** VOICEVOXとの連携に対応。高品質な日本語音声で発話が可能（Fallbackとして標準OS音声もサポート）。
- **音声キャッシュ (IndexedDB):** 生成した音声は保存され、2回目以降は瞬時に再生されます。
- **デスクトップアプリ化:** Tauri (Rust) を使用した軽量なWindowsデスクトップアプリとして動作。

## 🚀 インストール & 実行

### 一般ユーザー (実行・インストール)
1. [Releases](https://github.com/ohru131/FacePointer/releases) から最新の `FacePointer_x.x.x_x64_en-US.msi` をダウンロードしてインストールします。
2. または、`FacePointer.exe` を直接実行してください。

### 開発者 (ビルド方法)

このプロジェクトを自分でビルドするには、以下の環境が必要です：
- [Node.js](https://nodejs.org/) (v16以上)
- [Rust](https://rust-lang.org/) (Tauriのビルドに必要)

```bash
# 依存関係のインストール
npm install

# 開発用モデルのダウンロード
./download_models.ps1

# 開発モードで実行
npm run tauri dev

# リリースビルド (インストーラーの作成)
npm run tauri build
```

## 🎙 音声合成 (VOICEVOX) について
本アプリは [VOICEVOX](https://voicevox.hiroshiba.jp/) との連携を推奨しています。
VOICEVOXデスクトップ版を起動した状態で本アプリを使用すると、自動的に高品質な合成音声（デフォルトでは四国めたん）で発話が行われます。

※ VOICEVOXが起動していない場合は、OS標準の日本語音声（Microsoft Nanami等）が自動的に選択されます。

## 📁 階層データのカスタマイズ
`hierarchy.txt` を編集することで、表示されるボタンの名前や階層構造を自由に変更できます。

```text
食事|media/food.png
  ごはん
    ごはんを食べたい
  パン
    パンが食べたい
```

## 🛠 技術スタック
- **Frontend:** HTML, JavaScript, CSS (Vanilla)
- **AI/ML:** [MediaPipe Vision](https://developers.google.com/mediapipe/solutions/vision/face_landmarker)
- **Backend/Desktop:** [Tauri](https://tauri.app/) (Rust)
- **Audio:** Web Audio API & VOICEVOX Engine

## 📄 ライセンス
MIT License

---
Developed by [ohru131](https://github.com/ohru131)
