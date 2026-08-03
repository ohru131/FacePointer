"""
Qwen3-TTS でアプリの音声フレーズをファイル生成するスクリプト。
出力先: outputs/tts_samples/
"""

import os
import re
import shutil
import sys
import subprocess
import torch
import soundfile as sf
from pathlib import Path
import requests

# アプリ内で実際に発話するフレーズ
PHRASES = [
    # コア発話
    "完了",
    "リセット",
    # マウスクリックデフォルト
    "ありがとう。",
    "こんにちは。",
    "お願いします。",
]

APP_JS_PATH = Path(__file__).parent.parent / "dist" / "app.js"

MODEL_ID = os.environ.get("QWEN_TTS_MODEL_ID", "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice")
SPEAKER = "Ono_Anna"   # 日本語女声。変更可: Vivian / Serena / Uncle_Fu / Dylan / Eric
LANGUAGE = "Japanese"
SKIP_IF_EXISTS = True
TONE_SUFFIX = ""  # 例: "！" を付けると全体がやや元気寄りになる
STYLE_INSTRUCT = os.environ.get("QWEN_TTS_INSTRUCT", "")
STYLE_PRESET_NAME = os.environ.get("QWEN_TTS_STYLE_PRESET", "")
VOICE_PERSONA = os.environ.get("QWEN_TTS_PERSONA", "young_female")
JAPANESE_ONLY = True
JAPANESE_SPEAKERS = {"ono_anna", "uncle_fu"}
JAPANESE_DEFAULT_SPEAKER = "ono_anna"
JAPANESE_SPEAKER_HINTS = ["jpn", "jp", "ja", "japanese", "anna", "fu"]

PERSONA_PRESETS = {
    "young_female": "20代の日本人女性の声で、一貫して女性らしい声質で話す。男性の声質は使わない。",
    "female": "日本人女性の声で話す。男性の声質は使わない。",
    "none": "",
}

STYLE_PRESETS = {
    "genki": "明るく、はきはき、元気よく、日本語で話す。語尾を明瞭にする。",
    "clear": "聞き取りやすく、ゆっくりめで、子音を明瞭に、日本語で話す。",
    "calm": "落ち着いて、やさしく、自然な抑揚で、日本語で話す。",
    "nurse": "看護現場向けに、安心感があり、明瞭で、はきはき、日本語で話す。",
}

OUTPUT_DIR = Path(__file__).parent.parent / "outputs" / "tts_samples"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def load_user_proxy_env_on_windows() -> None:
    if os.name != "nt":
        return

    keys = [
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "https_proxy",
        "http_proxy",
        "all_proxy",
        "no_proxy",
        "HF_ENDPOINT",
        "HUGGINGFACE_HUB_ENDPOINT",
        "HUGGINGFACE_CO_URL",
    ]

    try:
        for key in keys:
            if os.environ.get(key):
                continue
            value = subprocess.check_output(
                ["reg", "query", r"HKCU\Environment", "/v", key],
                stderr=subprocess.DEVNULL,
                text=True,
            )
            parts = value.split()
            if parts:
                os.environ[key] = parts[-1]
    except Exception:
        # 読み出しに失敗しても既存の環境変数で継続。
        pass


def ensure_sox_in_path() -> None:
    if shutil.which("sox"):
        return

    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        return

    winget_root = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
    candidates = sorted(winget_root.glob("ChrisBagwell.SoX_*/*/sox.exe"))
    if not candidates:
        return

    sox_dir = str(candidates[-1].parent)
    os.environ["PATH"] = sox_dir + os.pathsep + os.environ.get("PATH", "")
    print(f"SoX を検出: {candidates[-1]}")


def can_reach(url: str) -> bool:
    try:
        res = requests.get(url, timeout=8)
        return res.ok
    except Exception:
        return False


def configure_hf_endpoint() -> None:
    if os.environ.get("HF_ENDPOINT"):
        return

    if can_reach("https://huggingface.co"):
        return

    mirror = "https://hf-mirror.com"
    if can_reach(mirror):
        os.environ["HF_ENDPOINT"] = mirror
        os.environ["HUGGINGFACE_HUB_ENDPOINT"] = mirror
        os.environ["HUGGINGFACE_CO_URL"] = mirror
        print("huggingface.co 接続不可。hf-mirror.com にフォールバックします。")


def resolve_model_source() -> str:
    env_path = os.environ.get("QWEN_TTS_MODEL_PATH")
    if not env_path:
        return MODEL_ID

    p = Path(env_path)
    if p.exists():
        print(f"ローカルモデルを使用: {p}")
        return str(p)

    print(f"QWEN_TTS_MODEL_PATH が存在しません: {p}")
    return MODEL_ID


def load_sentences_from_app_js() -> list[str]:
    if not APP_JS_PATH.exists():
        print(f"sentence 抽出スキップ: {APP_JS_PATH} が見つかりません。")
        return []

    text = APP_JS_PATH.read_text(encoding="utf-8")
    sentences = re.findall(r'sentence\s*:\s*"([^"]+)"', text)
    unique_sentences = []
    seen = set()
    for s in sentences:
        t = s.strip()
        if not t or t in seen:
            continue
        seen.add(t)
        unique_sentences.append(t)
    print(f"app.js sentence 抽出: {len(unique_sentences)} 件")
    return unique_sentences


def resolve_speaker(model: "Qwen3TTSModel") -> str:
    supported = model.get_supported_speakers()
    lower_to_original = {s.lower(): s for s in supported}

    requested = SPEAKER.lower()
    if JAPANESE_ONLY:
        if requested in JAPANESE_SPEAKERS and requested in lower_to_original:
            return lower_to_original[requested]
        if JAPANESE_DEFAULT_SPEAKER in lower_to_original:
            chosen = lower_to_original[JAPANESE_DEFAULT_SPEAKER]
            print(f"日本語限定モード: SPEAKER={SPEAKER} は不許可。{chosen} を使用します。")
            return chosen

        # VoiceDesign などで話者名が異なる場合は、日本語っぽいヒントで自動選択する。
        for name_lower, name_original in lower_to_original.items():
            if any(h in name_lower for h in JAPANESE_SPEAKER_HINTS):
                print(f"日本語限定モード: 推定日本語話者 {name_original} を使用します。")
                return name_original

        # 最後のフォールバック: 利用可能話者の先頭を使う（エラー停止を避ける）。
        if supported:
            print("日本語限定モード: 日本語話者を特定できないため、先頭話者を使用します。")
            return supported[0]

        raise RuntimeError("利用可能な話者が見つかりません。モデル内容を確認してください。")

    if requested in lower_to_original:
        return lower_to_original[requested]

    raise RuntimeError(f"未対応スピーカー: {SPEAKER}. 利用可能: {supported}")


def resolve_style_instruct() -> str:
    preset_name = STYLE_PRESET_NAME.strip().lower()
    preset_text = STYLE_PRESETS.get(preset_name, "")
    persona_text = PERSONA_PRESETS.get(VOICE_PERSONA.strip().lower(), "")
    manual_text = STYLE_INSTRUCT.strip()

    parts = [p for p in [persona_text, preset_text, manual_text] if p]
    return " ".join(parts)

print(f"モデル読み込み中: {MODEL_ID}")
load_user_proxy_env_on_windows()
ensure_sox_in_path()
configure_hf_endpoint()
model_source = resolve_model_source()

# qwen_tts は import 時に SoX / Hugging Face 設定を参照するため、前処理後に import する。
from qwen_tts import Qwen3TTSModel

try:
    model = Qwen3TTSModel.from_pretrained(
        model_source,
        device_map="cuda:0" if torch.cuda.is_available() else "cpu",
        dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
    )
except Exception as e:
    if model_source == MODEL_ID:
        print("オンライン取得に失敗。ローカルキャッシュで再試行します。")
        try:
            model = Qwen3TTSModel.from_pretrained(
                model_source,
                local_files_only=True,
                device_map="cuda:0" if torch.cuda.is_available() else "cpu",
                dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
            )
        except Exception as e2:
            print("モデル読み込みに失敗。ネットワーク/TLS/モデル取得設定を確認してください。")
            print("回避策: QWEN_TTS_MODEL_PATH に手動ダウンロード済みモデルフォルダを指定。")
            print(f"詳細(online): {e}")
            print(f"詳細(offline): {e2}")
            sys.exit(1)
    else:
        print("モデル読み込みに失敗。QWEN_TTS_MODEL_PATH の内容を確認してください。")
        print(f"詳細: {e}")
        sys.exit(1)
resolved_style_instruct = resolve_style_instruct()
tts_model_type = getattr(model.model, "tts_model_type", "")
selected_speaker = None

if tts_model_type == "custom_voice":
    selected_speaker = resolve_speaker(model)
    print(f"スピーカー: {selected_speaker} / 言語: {LANGUAGE}")
elif tts_model_type == "voice_design":
    print(f"モデル種別: voice_design / 言語: {LANGUAGE}")
    if not resolved_style_instruct:
        resolved_style_instruct = STYLE_PRESETS["genki"]
        print("口調指示未指定のため genki プリセットを自動適用します。")
else:
    raise RuntimeError(f"未対応モデル種別: {tts_model_type}")

if STYLE_PRESET_NAME.strip():
    print(f"口調プリセット: {STYLE_PRESET_NAME.strip()}")
if VOICE_PERSONA.strip():
    print(f"声質プリセット: {VOICE_PERSONA.strip()}")
if resolved_style_instruct:
    print(f"口調指示: {resolved_style_instruct}")
print()

all_phrases = []
seen_phrases = set()
for phrase in PHRASES + load_sentences_from_app_js():
    p = phrase.strip()
    if not p or p in seen_phrases:
        continue
    seen_phrases.add(p)
    all_phrases.append(p)

print(f"生成対象フレーズ: {len(all_phrases)} 件")

generated_count = 0
skipped_count = 0

for phrase in all_phrases:
    safe_name = phrase.replace("。", "").replace("、", "").replace(" ", "_")
    out_path = OUTPUT_DIR / f"{safe_name}.wav"

    if SKIP_IF_EXISTS and out_path.exists():
        print(f"スキップ: {out_path.name} (既存)")
        skipped_count += 1
        continue

    speak_text = f"{phrase}{TONE_SUFFIX}" if TONE_SUFFIX else phrase

    print(f"生成中: {speak_text!r} -> {out_path.name}")
    if tts_model_type == "custom_voice":
        kwargs = {
            "text": speak_text,
            "language": LANGUAGE,
            "speaker": selected_speaker,
        }
        if resolved_style_instruct:
            kwargs["instruct"] = resolved_style_instruct
        wavs, sr = model.generate_custom_voice(**kwargs)
    else:
        wavs, sr = model.generate_voice_design(
            text=speak_text,
            language=LANGUAGE,
            instruct=resolved_style_instruct,
        )
    sf.write(str(out_path), wavs[0], sr)
    generated_count += 1

print()
print(f"完了。ファイル保存先: {OUTPUT_DIR}")
print(f"生成: {generated_count} 件 / スキップ: {skipped_count} 件")
print("別のスピーカーを試すには SPEAKER 変数を変更してください。")
print(f"利用可能なスピーカー: {model.get_supported_speakers()}")
