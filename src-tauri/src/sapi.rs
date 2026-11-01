// Windows の読み上げの仕組み（SAPI5）で音声を作る。
// WebView2 の speechSynthesis には SAPI5 だけに登録した声（NaturalVoiceSAPIAdapter で入れた
// 「Microsoft Nanami (Natural)」など）が出てこないため、Rust 側から直接呼んで WAV にする。
use serde::Serialize;

#[derive(Serialize)]
pub struct SapiVoice {
  /// SAPI のトークン ID（声を選ぶときに使う）
  id: String,
  /// 表示名（例: "Microsoft Nanami (Natural) - Japanese (Japan)"）
  name: String,
  /// 言語の LCID（16進。日本語は "411"）。複数あるときは ";" 区切り
  language: String,
}

/// このPCの SAPI5 の声の一覧
#[tauri::command]
pub async fn sapi_voices() -> Result<Vec<SapiVoice>, String> {
  tauri::async_runtime::spawn_blocking(imp::list_voices)
    .await
    .map_err(|e| e.to_string())?
}

/// 文を WAV にする。返り値は WAV のバイト列（JS 側では ArrayBuffer で受け取る）
#[tauri::command]
pub async fn sapi_synthesize(voice_id: String, text: String) -> Result<tauri::ipc::Response, String> {
  let wav = tauri::async_runtime::spawn_blocking(move || imp::synthesize(&voice_id, &text))
    .await
    .map_err(|e| e.to_string())??;
  Ok(tauri::ipc::Response::new(wav))
}

#[cfg(not(windows))]
mod imp {
  use super::SapiVoice;

  pub fn list_voices() -> Result<Vec<SapiVoice>, String> {
    Err("SAPI の声は Windows でだけ使えます".into())
  }

  pub fn synthesize(_voice_id: &str, _text: &str) -> Result<Vec<u8>, String> {
    Err("SAPI の声は Windows でだけ使えます".into())
  }
}

#[cfg(windows)]
mod imp {
  use super::SapiVoice;
  use std::sync::atomic::{AtomicU64, Ordering};
  use windows::core::{GUID, HSTRING, PCWSTR, PWSTR};
  use windows::Win32::Media::Audio::{WAVEFORMATEX, WAVE_FORMAT_PCM};
  use windows::Win32::Media::Speech::{
    ISpDataKey, ISpObjectToken, ISpObjectTokenCategory, ISpStream, ISpVoice, SpObjectTokenCategory,
    SpStream, SpVoice, SPCAT_VOICES, SPFM_CREATE_ALWAYS, SPF_IS_NOT_XML,
  };
  use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
  };

  // sapi.h の SPDFID_WaveFormatEx（WAVEFORMATEX で形式を指定する、という印）
  const SPDFID_WAVE_FORMAT_EX: GUID = GUID::from_u128(0xc31adbae_527f_4ff5_a230_f62bb61ff70c);
  // Natural 音声の元の形式に合わせる（24kHz・16bit・モノラル）
  const SAMPLE_RATE: u32 = 24000;

  static FILE_SEQ: AtomicU64 = AtomicU64::new(0);

  /// この関数の間だけ COM を使えるようにする
  struct ComGuard(bool);
  impl ComGuard {
    fn new() -> Self {
      // S_FALSE（このスレッドで初期化済み）も成功なので、終わりに対で CoUninitialize する
      ComGuard(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
    }
  }
  impl Drop for ComGuard {
    fn drop(&mut self) {
      if self.0 {
        unsafe { CoUninitialize() };
      }
    }
  }

  /// SAPI が CoTaskMemAlloc で返した文字列を String にして解放する
  unsafe fn take_pwstr(p: PWSTR) -> String {
    if p.is_null() {
      return String::new();
    }
    let s = unsafe { p.to_string() }.unwrap_or_default();
    unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
    s
  }

  fn read_value(key: &ISpDataKey, name: PCWSTR) -> String {
    match unsafe { key.GetStringValue(name) } {
      Ok(p) => unsafe { take_pwstr(p) },
      Err(_) => String::new(),
    }
  }

  // NaturalVoiceSAPIAdapter の声は、レジストリに無く列挙のたびに作られる。
  // そのため ID から作り直さず、毎回列挙して ID が同じものを使う
  fn voice_tokens() -> Result<Vec<(String, ISpObjectToken)>, String> {
    unsafe {
      let category: ISpObjectTokenCategory =
        CoCreateInstance(&SpObjectTokenCategory, None, CLSCTX_ALL).map_err(|e| format!("SAPI を開けません: {e}"))?;
      category.SetId(SPCAT_VOICES, false).map_err(|e| format!("SAPI の声の一覧を開けません: {e}"))?;
      let tokens = category
        .EnumTokens(PCWSTR::null(), PCWSTR::null())
        .map_err(|e| format!("SAPI の声を列挙できません: {e}"))?;
      let mut count = 0u32;
      tokens.GetCount(&mut count).map_err(|e| e.to_string())?;
      let mut list = Vec::with_capacity(count as usize);
      for i in 0..count {
        let Ok(token) = tokens.Item(i) else { continue };
        let Ok(id) = token.GetId() else { continue };
        list.push((take_pwstr(id), token));
      }
      Ok(list)
    }
  }

  pub fn list_voices() -> Result<Vec<SapiVoice>, String> {
    let _com = ComGuard::new();
    Ok(voice_tokens()?
      .into_iter()
      .map(|(id, token)| {
        // 既定の値が表示名。言語は Attributes の Language
        let name = read_value(&token, PCWSTR::null());
        let language = unsafe { token.OpenKey(windows::core::w!("Attributes")) }
          .map(|attrs| read_value(&attrs, windows::core::w!("Language")))
          .unwrap_or_default();
        SapiVoice {
          name: if name.is_empty() { id.clone() } else { name },
          id,
          language,
        }
      })
      .collect())
  }

  pub fn synthesize(voice_id: &str, text: &str) -> Result<Vec<u8>, String> {
    let _com = ComGuard::new();
    let token = voice_tokens()?
      .into_iter()
      .find(|(id, _)| id == voice_id)
      .map(|(_, token)| token)
      .ok_or_else(|| "選んだ SAPI の声が見つかりません（設定 → 音声 で取得し直してください）".to_string())?;

    let path = std::env::temp_dir().join(format!(
      "facepointer-sapi-{}-{}.wav",
      std::process::id(),
      FILE_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    let result = speak_to_file(&token, text, &path).and_then(|_| std::fs::read(&path).map_err(|e| e.to_string()));
    let _ = std::fs::remove_file(&path);
    result
  }

  fn speak_to_file(token: &ISpObjectToken, text: &str, path: &std::path::Path) -> Result<(), String> {
    let format = WAVEFORMATEX {
      wFormatTag: WAVE_FORMAT_PCM as u16,
      nChannels: 1,
      nSamplesPerSec: SAMPLE_RATE,
      nAvgBytesPerSec: SAMPLE_RATE * 2,
      nBlockAlign: 2,
      wBitsPerSample: 16,
      cbSize: 0,
    };
    unsafe {
      let voice: ISpVoice = CoCreateInstance(&SpVoice, None, CLSCTX_ALL).map_err(|e| format!("SAPI を開けません: {e}"))?;
      voice.SetVoice(token).map_err(|e| format!("SAPI の声を選べません: {e}"))?;
      let stream: ISpStream = CoCreateInstance(&SpStream, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
      stream
        .BindToFile(
          &HSTRING::from(path.as_os_str()),
          SPFM_CREATE_ALWAYS,
          Some(&SPDFID_WAVE_FORMAT_EX),
          Some(&format),
          0,
        )
        .map_err(|e| format!("一時ファイルを作れません: {e}"))?;
      voice.SetOutput(&stream, true).map_err(|e| e.to_string())?;
      // 同期で話し終わるまで待つ。"<" などを SSML として読まないようにする
      let spoken = voice
        .Speak(&HSTRING::from(text), SPF_IS_NOT_XML.0 as u32, None)
        .map_err(|e| format!("SAPI で合成できません: {e}"));
      // Close で WAV のヘッダ（長さ）が書き込まれる
      let closed = stream.Close().map_err(|e| e.to_string());
      spoken.and(closed)
    }
  }
}
