# ポインター移動ロジック仕様書 (v1)

## 0. 目的
- 現行問題の解消: OFF時に端まで移動したあと、中央へ勝手に戻らない。
- ON/OFFスイッチを廃止し、2つの独立スライダーへ置き換える。
  - 鼻位置による移動量スライダー
  - 顔向きによる移動量スライダー
- どちらかのスライダーが 0 の場合、その入力経路は実質OFF。
- 顔向き経路の急すぎる挙動を抑える。

---

## 1. UX要件
1. ポインターは、鏡像表示された顔ワイヤーフレームと同じ見た目方向へ動く。
2. ユーザーが端方向入力を維持している間、端に留まる。自動的に中央へ戻らない。
3. 2つの制御ソースを合成できる。
   - 鼻位置変化（並進寄り制御）
   - 顔向き yaw 変化（回転寄り制御）
4. 各ソースに 0-10 のゲインスライダーを持つ。0は無効。
5. 可動域が小さい利用者でも、安定かつ反応性を確保する。

---

## 2. 入力
- ソースA: landmarks[4] の鼻X（表示座標系へ鏡像変換後）
- ソースB: facialTransformationMatrixes から抽出した head yaw

座標ポリシー:
- 先に必ず単一制御座標系へ変換する（表示基準の鏡像座標系）。
- 校正・差分・ゲイン計算は同一座標系で実行する。

---

## 3. 問題挙動の除去
現行問題の根本:
- 中央へ引き戻す絶対アシスト項が強く、端で入力に逆らってしまう。

新ルール:
- 実行時更新から「中央回帰型の絶対ブレンド」を除去する。
- 差分ベース寄与（鼻差分 + yaw差分）のみで targetX を更新する。
- クランプはボタン行の境界 minX..maxX のみに限定する。

これにより自律的な中央復帰を禁止する。

---

## 4. 新ランタイムモデル

### 4.1 状態
- pointerX, targetX
- lastNoseControlX
- lastYaw
- filteredNoseControlX
- filteredYaw
- isCalibrating

校正値:
- calibratedNoseControlX
- calibratedYaw

### 4.2 スライダー
- noseGain: 0..10
- yawGain: 0..10

意味:
- noseGain == 0: 鼻経路無効
- yawGain == 0: 顔向き経路無効

推奨マッピング:
- noseGainNorm = noseGain / 10
- yawGainNorm = yawGain / 10
- noseScale = lerp(NOSE_SCALE_MIN, NOSE_SCALE_MAX, noseGainNorm^pN)
- yawScale = lerp(YAW_SCALE_MIN, YAW_SCALE_MAX, yawGainNorm^pY)

指数は緩め推奨（pN ~ 1.4, pY ~ 1.8）。高域の調整余地を確保する。

### 4.3 フィルタ
- 鼻: 低域通過フィルタ alpha = noseAlpha（例 0.35）
- yaw: 低域通過フィルタ alpha = yawAlpha（例 0.22）

式:
- f = f*(1-a) + x*a

### 4.4 デッドゾーン（独立）
- noseDeadzone: 制御座標単位
- yawDeadzone: ラジアン

abs(delta) <= deadzone のとき寄与0。

### 4.5 差分寄与
毎フレーム:
1. 鏡像変換後の nose 制御X を取得する。
2. yaw を取得する。
3. それぞれ平滑化する。
4. 差分計算:
   - dN = filteredNoseControlX - lastNoseControlX
   - dY = filteredYaw - lastYaw
5. デッドゾーン適用（必要ならソフトニー）:
   - dEff = sign(d) * max(0, abs(d)-dz)
6. ピクセル寄与へ変換:
   - pixN = dEffN * noseScale
   - pixY = dEffY * yawScale
7. 合成:
   - deltaX = pixN + pixY
8. 目標更新:
   - targetX += deltaX
9. クランプ:
   - targetX = clamp(targetX, minX, maxX)
10. 描画追従のみ平滑化:
   - pointerX += (targetX - pointerX) * followLerp

重要:
- (center - targetX) * assistWeight のような中央回帰項を入れない。

### 4.6 方向整合
鏡像表示ポリシー時:
- 鼻経路・yaw経路の両方で「見た目右動作 -> controlX増加」を満たす。
- 方向確認ヘルパーで一度検証する。

---

## 5. 校正フロー
校正開始時:
1. 顔検出安定フレームを待つ（またはNフレーム中央値）。
2. 設定:
   - calibratedNoseControlX = filteredNoseControlX
   - calibratedYaw = filteredYaw
3. 履歴初期化:
   - lastNoseControlX = filteredNoseControlX
   - lastYaw = filteredYaw
4. ポインター位置は維持する。強制センタリングしない。

理由:
- 初期ジャンプ防止。
- 暗黙の中央引き戻し挙動防止。

---

## 6. スライダーUI仕様（ON/OFF置換）
クイックチューニングへ追加:
1. 鼻の位置移動量 (nose-gain-slider) 0..10 step 0.5
2. 顔の向き移動量 (yaw-gain-slider) 0..10 step 0.5

表示仕様:
- 0 = OFF
- 現在値をラベル右側に表示

削除対象:
- 行列モードON/OFFトグル

永続化キー:
- nose_gain
- yaw_gain

---

## 7. 安全・安定ガード
1. フレームごとの最大移動量制限:
   - deltaX = clamp(deltaX, -MAX_DELTA_PER_FRAME, MAX_DELTA_PER_FRAME)
2. トラッキング喪失時:
   - 短時間は最後の target を保持
   - 自動再センタリングしない
3. ジッター抑制:
   - 両ゲインが低く、入力が微小なら静止維持

---

## 8. 初期値（推奨）
- noseGain = 6.0
- yawGain = 2.5（急峻化防止のため低め開始）
- noseDeadzone = 小
- yawDeadzone = 中
- followLerp = 0.35

意図:
- 主操作を鼻経路で担う。
- yawは補助に留める。

---

## 9. 検証チェックリスト
1. noseGain=0, yawGain>0: 顔向きのみで移動
2. noseGain>0, yawGain=0: 鼻経路のみで移動
3. 両方0: 校正/初期化以外で静止
4. 左端まで移動し保持: 自動復帰しない
5. 端から逆方向へ少し動かす: 即座に端離脱
6. 方向試験: 見た目右動作でポインター右移動

---

## 10. 移行メモ
- 既存 relative_* 設定は後方互換として残してよい。
- ただし新UIでは nose_gain / yaw_gain を優先表示する。
- 行列モードトグルは移行完了後に不要。

---

## 11. 疑似コード

```
if no face:
  keep pointer as-is
  return

noseXc = mirror(nose.x)
yaw = extractYaw(matrix)

filteredNose = lpf(filteredNose, noseXc, noseAlpha)
filteredYaw  = lpf(filteredYaw,  yaw,  yawAlpha)

if calibrating:
  set calibration from filtered values
  set last values
  calibrating = false
  return

dN = filteredNose - lastNose
dY = filteredYaw - lastYaw

cN = toContribution(dN, noseDeadzone, noseGain)
cY = toContribution(dY, yawDeadzone, yawGain)

deltaX = clamp(cN + cY, -maxDelta, +maxDelta)

targetX = clamp(targetX + deltaX, minX, maxX)
pointerX += (targetX - pointerX) * followLerp

lastNose = filteredNose
lastYaw = filteredYaw
```

---

## 12. 非目標
- 自動センタリング挙動の導入
- システム側での暗黙モード切替
- 本版での視線ランドマーク依存

---

# 上下移動 (v2 追加分)

## 13. 目的
横移動と同等の操作感で、上段（大分類）から下段（詳細）へポインターを移動できるようにする。
口開けクリックは下段ボタンでの確定に使う。

## 14. 入力
- ソースC: landmarks[4] の鼻Y（鏡像は横のみなので変換不要）
- ソースD: facialTransformationMatrixes から抽出した head pitch（顔が下を向くほど正）

pitch 抽出:
- 4x4 の並び（row-major / column-major）は平行移動成分の位置から実行時に判定する。
- pitch = atan2(-m12, hypot(m02, m22))
- 逆向きに感じる場合は PITCH_MIRROR_SIGN を -1 にする。

ゲイン・デッドゾーン・加速は横移動と共用する（nose_gain / yaw_gain）。
縦だけ感度を変える場合は VERTICAL_NOSE_SCALE_RATIO / VERTICAL_PITCH_SCALE_RATIO を使う。

## 15. 可動範囲
- 上限: 上段ボタンの中央Y
- 下限: 下段ボタンの中央Y
- 横移動と同じく target を毎フレームクランプするだけなので、限界で入力を続けても留まり、逆方向入力では即座に離脱する。
- 両行の間隔が VERTICAL_MIN_TRAVEL_PX 未満なら上下移動を無効化する。

## 16. 階層遷移
- 上段段階: pointerY が下段ボタン上端（= downTriggerY）へ到達したら、その時点のプレビュー対象を選択して下段段階へ進む。
- 下段段階: pointerY が上段ボタン下端（= upTriggerY）へ到達したら、一番上の階層へ戻る。
- 切替ラインは必ず上下限の内側（VERTICAL_STAGE_TRIGGER_MARGIN_PX 以上内側）に置く。
- 遷移直後は行の高さが大きく変わるため、移動先の行中央へポインターをスナップし、
  VERTICAL_STAGE_SWITCH_LOCKOUT_MS の間は再遷移を禁止する（往復防止）。
- ペンディングクリック中・確定表示中・校正中は遷移しない。

## 17. プレビュー保持
行間を通過している最中は hover 対象が無くなるため、上下移動ONのときは
ポインターXから上段ボタンを解決して hover 扱いにする。これによりプレビュー行（下段の可動範囲）が消えない。

## 18. UI
- 「上下移動 ON/OFF」トグルをメイン画面右下に追加（永続化キー: vertical_move_enabled、既定ON）。
- OFF時は従来動作（targetY は選択中の行の中央に固定）に戻る。

## 19. 検証チェックリスト
1. 上段で左右移動 → 下へ移動して下段へ入る
2. 下段で口を開けて確定 → 発話後ホームへ戻り、ポインターは上段中央
3. 下段から上へ抜ける → 一番上の階層へ戻る
4. 上下限（各ボタン中央）で入力を続けても停止し、逆方向で即離脱
5. 行を跨いだ直後に往復しない
6. OFFにすると縦移動しない（横移動のみ）
