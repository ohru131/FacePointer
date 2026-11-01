# 音声の品質を上げる方法 (VOICEVOX の導入)

現在、このアプリは以下の2つの方法でしゃべることができます。

### 1. ブラウザ標準音声 (現状)
OSやブラウザが持っている音声（Nanamiなど）を使用します。手軽ですが、イントネーションが不自然な場合があります。
※ コードを改善し、可能な限りマシな声（Microsoft Nanami Online など）を自動選択するようにしました。

### 2. VOICEVOX (推奨・最高品質)
AI技術による非常に自然な日本語音声です。以下の手順で導入できます。

1. [VOICEVOX 公式サイト](https://voicevox.hiroshiba.jp/) からエディターをダウンロードします。
2. VOICEVOX を起動します。
3. このアプリを使う際、VOICEVOX が起動していれば、自動的に高品質な音声（四国めたん）でしゃべるようになります。

---

## 音声の変更方法
設定 → 音声 の「VOICEVOX」欄で「話者を取得」を押すと、VOICEVOX の話者（スタイル）が「声の種類（TTSモデル）」の一覧に入ります。使いたい話者を選んで保存してください。

---

## Windows の声（デスクトップ版・Edge と同じ Nanami を使う）
デスクトップ版（Tauri）は WebView2 で動くため、Edge で使える「Microsoft Nanami Online (Natural)」が出てきません。
Windows の Natural 音声を PC に入れ、Windows の読み上げ（SAPI）から使うと、同じ品質の声で話せます。通信なしで動き、作った音声は保存されます。

1. Windows の設定 → アクセシビリティ → ナレーター →「自然な音声を追加」で日本語の声（Nanami など）を入れます。
2. [NaturalVoiceSAPIAdapter](https://github.com/gexgd0419/NaturalVoiceSAPIAdapter) を入れ、Natural 音声を SAPI に登録します。
3. `C:\Windows\System32\Speech\SpeechUX\sapi.cpl` の「音声の選択」に「Microsoft Nanami (Natural)」が出ることを確かめます。
4. FacePointer の 設定 → 音声 →「Windows の声」で「声を取得し直す」を押し、TTSモデルで「Windows の声: Microsoft Nanami (Natural) …」を選んで保存します。
