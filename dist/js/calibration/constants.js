// キャリブレーションの時間・しきい値

// Calibration wizard
// 画面上の○に顔の正面を向けてもらい、「○までの画面上の距離」と「そのときの顔の動き」から
// 感度(nose/yaw gain)・上下感度比を決める。これを近い位置と少し離れた位置の2回行い、
// 距離補正の指数も求める。最後に口の開きを計測して口の閾値を決める
export const CALIB_PREPARE_MS = 1500;
export const CALIB_RECORD_MS = 2000;
// ○の半径。予測カーソルがこの内側に入れば「一致」とみなす
export const CALIB_TARGET_RADIUS_PX = 46;
// 静止判定: 直近この時間の揺れ幅がしきい値以下なら止まっているとみなす
export const CALIB_STILL_WINDOW_MS = 450;
export const CALIB_STILL_ANGLE_RANGE = 0.035;
export const CALIB_STILL_NOSE_RANGE = 0.008;
// 震えなどで止まりきれない人のため、時間が経ったら静止判定を緩める
export const CALIB_STILL_RELAX_AFTER_MS = 8000;
export const CALIB_STILL_RELAX_FACTOR = 2;
export const CALIB_CENTER_HOLD_MS = 1500;
export const CALIB_TARGET_HOLD_MS = 1000;
export const CALIB_TARGET_HOLD_IN_CIRCLE_MS = 400;
// ○を出した直後は動き出しを待つ
export const CALIB_SETTLE_MS = 600;
// 正面から動いたとみなす量。動けない人のため、時間が経ったら動かなくても記録する
export const CALIB_MIN_MOVE_ANGLE = 0.05;
export const CALIB_MIN_MOVE_NOSE = 0.015;
export const CALIB_MOVE_GIVEUP_MS = 5000;
// 止まりきれなくても、この時間が経ったら直近の平均で記録して先へ進む（結果に警告を出す）
export const CALIB_CAPTURE_GIVEUP_MS = 15000;
// 正面の登録だけのときは、この時間止まれなければ元の正面のまま閉じる
export const CALIB_FRONT_TIMEOUT_MS = 10000;
export const CALIB_MATCH_SHOW_MS = 700;
// 記録する値は静止中の直近この時間の平均
export const CALIB_SAMPLE_AVERAGE_MS = 600;
export const CALIB_SAMPLE_BUFFER_MS = 2000;
// 離れた位置の計測は、近い位置よりこの比率以上離れて止まったら始める
export const CALIB_FAR_MIN_RATIO = 1.18;
export const CALIB_FAR_HOLD_MS = 1000;
// 2回の距離の差がこれ未満なら距離補正の指数は既定値のまま
export const CALIB_MIN_DISTANCE_SPREAD = 1.12;
export const CALIB_DISTANCE_EXPONENT_MIN = 0.3;
export const CALIB_DISTANCE_EXPONENT_MAX = 1.6;
// 口: 閉じ〜開きの差のこの割合を開き判定ラインにする
export const CALIB_JAW_OPEN_POINT = 0.45;
export const CALIB_MIN_JAW_RANGE = 0.12;

// ○の位置（画面に対する割合）。上の○は画面上部の指示メッセージと重ならない高さにする
export const CALIB_TARGETS = [
    { key: "center", x: 0.5, y: 0.55, label: "まんなか" },
    { key: "left", x: 0.12, y: 0.55, label: "左" },
    { key: "right", x: 0.88, y: 0.55, label: "右" },
    { key: "up", x: 0.5, y: 0.26, label: "上" },
    { key: "down", x: 0.5, y: 0.88, label: "下" }
];
export const CALIB_PASSES = [
    { key: "near", label: "近い位置", sub: "いつもの位置（画面の近く）で" },
    { key: "far", label: "離れた位置", sub: "少し離れた位置で" }
];
export const CALIB_HORIZONTAL_KEYS = ["left", "right"];
export const CALIB_VERTICAL_KEYS = ["up", "down"];
