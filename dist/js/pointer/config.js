// ポインタの感度・方式・キャリブレーション結果（設定として保存するもの）
import { readStoredNumber } from "../core/storage.js";

// 鏡像表示ポリシー: 見た目右向き -> controlX増加 に固定変換する符号
export const YAW_MIRROR_SIGN = 1;
// 描画追従の時定数。旧 FOLLOW_LERP=0.35/60fps 相当をフレームレート非依存にしたもの
export const FOLLOW_TIME_CONSTANT_MS = 40;
// One Euro Filter: 静止時は強く平滑化し、動いている間は遅延を減らす
export const NOSE_EURO_MIN_CUTOFF = 1.0;
export const NOSE_EURO_BETA = 20;
export const ANGLE_EURO_MIN_CUTOFF = 0.8;
export const ANGLE_EURO_BETA = 4;
export const EURO_DERIVATIVE_CUTOFF = 1.0;
// キャリブレーションで計測した静止時の揺れ(標準偏差)からデッドゾーンを決める係数
export const NOISE_DEADZONE_FACTOR = 1.5;
// 中央補正: 顔が正面付近にあるとき、顔を動かしている間だけ「正面ならここ」という位置へ少しずつ寄せる。
// 止まっている間は動かさないので滞留選択の邪魔をせず、端では効かないので端で入力に逆らわない
export const RECENTER_KEY = "recenter_enabled";
// 揺れからデッドゾーンを決める新しいキャリブレーションで保存したかどうか。
// 旧キャリブレーションの感度は広いデッドゾーン前提で決めたので、やり直すまでは従来の幅を使う
export const CALIB_VERSION_KEY = "calibration_version";
// ポインタ方式: 絶対（正面を固定し、顔の向き＝画面位置）/ 相対（動いた分だけ動く）
export const POINTER_MODE_KEY = "pointer_mode";
export const POINTER_MODE_ABSOLUTE = "absolute";
export const POINTER_MODE_RELATIVE = "relative";
// 絶対方式で端を越えて振り切ったあと、中央のこの範囲まで戻ったら元の係数に戻す（移動範囲の半幅に対する割合）
export const ABS_EDGE_RESET_RATIO = 0.05;
// 姿勢ずれのお知らせ: 絶対方式で端に張り付いた状態がこの時間続いたら、正面取り直しボタンを光らせる（自動では取り直さない）
export const POSTURE_HINT_PINNED_MS = 15000;
// 端に張り付いているとみなす変位（その側の移動範囲に対する割合）
export const POSTURE_HINT_PINNED_RATIO = 0.9;
// 中央付近（範囲のこの割合以内）にこの時間いたら、お知らせを消す
export const POSTURE_HINT_CLEAR_RATIO = 0.3;
export const POSTURE_HINT_CLEAR_MS = 3000;
export const CALIB_VERSION_NOISE_DEADZONE = "2";
// 正面付近とみなす範囲（移動範囲の半幅に対する割合）
export const RECENTER_ZONE_RATIO = 0.35;
// 1フレームの補正量の上限（そのフレームの移動量に対する割合）。顔の動きより十分ゆっくり戻す
export const RECENTER_RATE = 0.3;
export const NOSE_NOISE_KEY = "nose_noise";
export const ANGLE_NOISE_KEY = "angle_noise";
// 旧形式（上下共通の倍率）。上下別の倍率が未保存のときの初期値にだけ使う
export const VERTICAL_GAIN_RATIO_KEY = "vertical_gain_ratio";
// 正面から見た向き（左右上下）ごとの感度倍率。目で見下ろす癖・目の高さ・カメラ位置で向きごとの効きが違うのを打ち消す
export const SIDE_GAIN_RATIO_KEYS = { left: "side_gain_left", right: "side_gain_right", up: "side_gain_up", down: "side_gain_down" };
export const SIDE_GAIN_RATIO_LIMITS = { left: [0.5, 2], right: [0.5, 2], up: [0.3, 4], down: [0.3, 4] };
export const CALIB_SIDE_KEYS = { left: "dx", right: "dx", up: "dy", down: "dy" };
// 向きごとの倍率は、同じ軸の両側を合算した倍率のこの倍まで（その逆数倍から）に収める
export const SIDE_GAIN_ASYMMETRY_MAX = 1.6;
export const NOSE_GAIN_KEY = "nose_gain";
export const YAW_GAIN_KEY = "yaw_gain";
export const NOSE_GAIN_MAX = 20;
export const YAW_GAIN_MAX = 20;
export const NOSE_GAIN_DEFAULT = 10;
const YAW_GAIN_DEFAULT = 10;
// gain=0(無効)〜gain=MAX(最も敏感)で scale/deadzone を線形+べき乗補間する
export const NOSE_SCALE_MIN = 2000;
export const NOSE_SCALE_MAX = 38000;
export const YAW_SCALE_MIN = 120;
export const YAW_SCALE_MAX = 5200;
export const NOSE_GAIN_EXPONENT = 1.4;
export const YAW_GAIN_EXPONENT = 1.8;
export const NOSE_DEADZONE_MIN = 0.0006;
export const NOSE_DEADZONE_MAX = 0.0062;
export const YAW_DEADZONE_MIN = 0.002;
export const YAW_DEADZONE_MAX = 0.025;
export const MAX_DELTA_PER_FRAME = 60;
export const YAW_ACCEL_START_RAD = 0.03;
export const YAW_ACCEL_FULL_RAD = 0.24;
export const YAW_ACCEL_MAX_MULTIPLIER = 3.6;
export const YAW_ACCEL_EXPONENT = 1.7;

// 上下移動（鼻の縦位置 + 顔の上下向き）。横移動と同じゲインスライダーを共有する
// 縦の可動域は横より狭いので、必要ならこの比率で感度を落とす
export const VERTICAL_NOSE_SCALE_RATIO = 1.0;
export const VERTICAL_PITCH_SCALE_RATIO = 1.0;
// 顔を下へ向けた時にポインタが下がる向き。逆に感じる場合は -1 にする
export const PITCH_MIRROR_SIGN = 1;
export const VERTICAL_MIN_TRAVEL_PX = 40;

// 軸ロック: 横/縦どちらかが明らかに優勢な速度のとき、もう片方の移動を止めてふらつきを防ぐ
export const AXIS_LOCK_SPEED_ALPHA = 0.35;
export const AXIS_LOCK_ENGAGE_RATIO = 1.8;
export const AXIS_LOCK_RELEASE_RATIO = 1.2;
export const AXIS_LOCK_MIN_SPEED_PX = 3;

// 距離補正: 画面に近いほど、画像上の鼻の動きは大きく、同じ画面位置を向くのに必要な顔の角度も大きくなる。
// どちらも「距離に反比例」なので、移動量に (今の距離 / 基準距離)^指数 を掛けて距離の影響を打ち消す
export const DISTANCE_COMP_KEY = "distance_comp_enabled";
export const DISTANCE_REF_KEY = "distance_ref";
export const DISTANCE_EXPONENT_KEY = "distance_exponent";
export const DISTANCE_EXPONENT_DEFAULT = 1;
export const DISTANCE_RATIO_MIN = 0.4;
export const DISTANCE_RATIO_MAX = 2.5;
// 距離は姿勢を変えたときにしか変わらないので、強めに平滑化して口の開閉などの揺れを拾わない
export const DISTANCE_FILTER_TIME_CONSTANT_MS = 300;

function loadSideGainRatios() {
    // 上下別の倍率が無ければ、旧形式の上下共通の倍率を上下両方に使う
    const legacyVertical = readStoredNumber(VERTICAL_GAIN_RATIO_KEY, 1, ...SIDE_GAIN_RATIO_LIMITS.up);
    const ratios = {};
    Object.entries(SIDE_GAIN_RATIO_KEYS).forEach(([side, key]) => {
        const fallback = side === "up" || side === "down" ? legacyVertical : 1;
        ratios[side] = readStoredNumber(key, fallback, ...SIDE_GAIN_RATIO_LIMITS[side]);
    });
    return ratios;
}

export function saveSideGainRatios() {
    Object.entries(SIDE_GAIN_RATIO_KEYS).forEach(([side, key]) => localStorage.setItem(key, String(pointerConfig.sideGainRatios[side])));
    localStorage.removeItem(VERTICAL_GAIN_RATIO_KEY);
}

export function formatSideRatios(ratios) {
    return ["left", "right", "up", "down"].map(side => ratios[side].toFixed(2)).join(" / ");
}

// 正面からの変位（右・下が正）に、変位の向きの倍率を掛ける。正面では変位 0 なので倍率が切り替わっても跳ねない
export function applySideGainRatios(offset, ratios = pointerConfig.sideGainRatios) {
    return {
        x: offset.x * (offset.x < 0 ? ratios.left : ratios.right),
        y: offset.y * (offset.y < 0 ? ratios.up : ratios.down)
    };
}

// 相対方式: 変位 from→to の差分に掛ける倍率。正面をまたいだら、またぐ前後の変位の比で両側の倍率を按分する。
// 移動先の側の倍率だけを掛けると、またぐたびに倍率の大きい側へずれていく
export function blendSideRatio(from, to, negRatio, posRatio) {
    const ratioOf = value => (value < 0 ? negRatio : posRatio);
    if ((from < 0) === (to < 0)) return ratioOf(to);
    const t = Math.abs(from) / (Math.abs(from) + Math.abs(to));
    return (t * ratioOf(from)) + ((1 - t) * ratioOf(to));
}
// パネル中央吸着（絶対方式）: パネルに入るとラベル中央へゆっくり寄せ、
// 着いたら「その顔の向き＝そのパネル中央」になるよう、正面の位置を固定したまま上下左右の縮尺を変える
export const PANEL_SNAP_KEY = "panel_snap_enabled";
export const PANEL_SNAP_SPEED_PX_PER_S = 260;
// 縮尺を変える点が正面に近すぎる（変位が範囲のこの割合未満）・端に近すぎる（この割合超）と縮尺が極端になるので使わない
export const PANEL_SNAP_MIN_RATIO = 0.08;
export const PANEL_SNAP_MAX_RATIO = 0.98;
// 軸ロック（相対方式）: 横/縦どちらかが優勢なとき、もう片方を止めて上下左右だけに動かす
export const AXIS_LOCK_KEY = "axis_lock_enabled";

// 他のモジュールからも読み書きする状態
export const pointerConfig = {
    // Calibration
    calibratedNoseX: 0.5,
    calibratedNoseY: 0.5,
    calibratedYaw: 0,
    calibratedPitch: 0,
    // 正面を登録したときに向いていた画面上の位置（画面に対する割合 {x, y}）。○で登録していなければ null
    frontScreenPoint: null,
    isCalibrating: true,
    noseNoise: readStoredNumber(NOSE_NOISE_KEY, 0, 0, 0.01),
    angleNoise: readStoredNumber(ANGLE_NOISE_KEY, 0, 0, 0.05),
    sideGainRatios: loadSideGainRatios(),
    isDistanceCompEnabled: localStorage.getItem(DISTANCE_COMP_KEY) !== "0",
    isRecenterEnabled: localStorage.getItem(RECENTER_KEY) !== "0",
    pointerMode: localStorage.getItem(POINTER_MODE_KEY) === POINTER_MODE_RELATIVE ? POINTER_MODE_RELATIVE : POINTER_MODE_ABSOLUTE,
    isAxisLockEnabled: localStorage.getItem(AXIS_LOCK_KEY) !== "0",
    isPanelSnapEnabled: localStorage.getItem(PANEL_SNAP_KEY) === "1",
    isNoiseDeadzone: localStorage.getItem(CALIB_VERSION_KEY) === CALIB_VERSION_NOISE_DEADZONE,
    // キャリブレーションで決めた基準距離（0 = 未計測。その間は正面を取り直した時点の距離を基準にする）
    distanceRef: readStoredNumber(DISTANCE_REF_KEY, 0, 0, 1000),
    distanceExponent: readStoredNumber(DISTANCE_EXPONENT_KEY, DISTANCE_EXPONENT_DEFAULT, 0, 2),
    noseGain: readStoredNumber(NOSE_GAIN_KEY, NOSE_GAIN_DEFAULT, 0, NOSE_GAIN_MAX),
    yawGain: readStoredNumber(YAW_GAIN_KEY, YAW_GAIN_DEFAULT, 0, YAW_GAIN_MAX)
};

// キャリブレーションを一度でも保存したか（保存すると版の印を残す）
export function isCalibrationDone() {
    return localStorage.getItem(CALIB_VERSION_KEY) !== null;
}
