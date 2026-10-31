import vision from "./mediapipe/vision_bundle.mjs";
import { TALK_TREE } from "./talk-data.js";
import { GENERATED_ICONS } from "./icon-images.js";
import { TALK_AI_MODEL_DEFAULT, generateInterviewQuestions, generateTalkSet, countTalkTreeNodes } from "./talk-generator.js";
const { FaceLandmarker, FilesetResolver, DrawingUtils } = vision;

// talk studio で登録したパターン。ファイルが欠けたり壊れたりしていても、標準のパターンだけで起動できるようにする
let PUBLISHED_TALK_SETS = [];
try {
    ({ PUBLISHED_TALK_SETS } = await import("./talk-sets/index.js"));
} catch (error) {
    console.error("talk sets load failed:", error);
}

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("canvas-overlay");
const canvasCtx = canvasElement.getContext("2d");
const pointerElement = document.getElementById("pointer");
const calibrateBtn = document.getElementById("calibrate-btn");
const loadingOverlay = document.getElementById("loading");
const gestureIndicator = document.getElementById("gesture-indicator");
const telemetryValues = document.getElementById("telemetry-values");

const row1Container = document.getElementById("row1");
const row2Container = document.getElementById("row2");
const row3Container = document.getElementById("row3");
const confirmOverlay = document.getElementById("confirm-overlay");
const confirmText = document.getElementById("confirm-text");
const confirmZone = document.getElementById("confirm-zone");
const confirmZonePreview = document.getElementById("confirm-zone-preview");
const appRoot = document.getElementById("app");
const modePrompt = document.getElementById("mode-prompt");
const simplePanelContainer = document.getElementById("simple-panel");
const simpleGridContainer = document.getElementById("simple-grid");
const simpleBarContainer = document.getElementById("simple-bar");
const simpleSidePrev = document.getElementById("simple-side-prev");
const simpleSideNext = document.getElementById("simple-side-next");
const simpleMessageContainer = document.getElementById("simple-message");
const dwellIndicator = document.getElementById("dwell-indicator");

let faceLandmarker;
let lastVideoTime = -1;
let results = undefined;

// Pointer state
let pointerX = window.innerWidth / 2;
let pointerY = window.innerHeight / 2;
let targetX = pointerX;
let targetY = pointerY;
const HOVER_SWITCH_HYSTERESIS_PX = 26;
let lastHoveredButtonKey = "";
let lastNoseControlX = null;
let lastNoseControlY = null;
let lastYaw = null;
let lastPitch = null;
let filteredNoseControlX = null;
let filteredNoseControlY = null;
let filteredYaw = null;
let filteredPitch = null;
let debugDeltaN = 0;
let debugDeltaY = 0;
let debugPixN = 0;
let debugPixY = 0;
let debugDeltaX = 0;
let debugDeltaNoseY = 0;
let debugDeltaPitch = 0;
let debugDeltaYPx = 0;
// 軸ロック: 横/縦それぞれの移動速度(EMA)と、現在どちらが優勢かの状態
let speedXEma = 0;
let speedYEma = 0;
let axisLockDominant = null; // "x" | "y" | null
let lastMotionUpdateMs = null;
// 鏡像表示ポリシー: 見た目右向き -> controlX増加 に固定変換する符号
const YAW_MIRROR_SIGN = 1;
// 描画追従の時定数。旧 FOLLOW_LERP=0.35/60fps 相当をフレームレート非依存にしたもの
const FOLLOW_TIME_CONSTANT_MS = 40;
// One Euro Filter: 静止時は強く平滑化し、動いている間は遅延を減らす
const NOSE_EURO_MIN_CUTOFF = 1.0;
const NOSE_EURO_BETA = 20;
const ANGLE_EURO_MIN_CUTOFF = 0.8;
const ANGLE_EURO_BETA = 4;
const EURO_DERIVATIVE_CUTOFF = 1.0;
// キャリブレーションで計測した静止時の揺れ(標準偏差)からデッドゾーンを決める係数
const NOISE_DEADZONE_FACTOR = 1.5;
// 中央補正: 顔が正面付近にあるとき、顔を動かしている間だけ「正面ならここ」という位置へ少しずつ寄せる。
// 止まっている間は動かさないので滞留選択の邪魔をせず、端では効かないので端で入力に逆らわない
const RECENTER_KEY = "recenter_enabled";
// 揺れからデッドゾーンを決める新しいキャリブレーションで保存したかどうか。
// 旧キャリブレーションの感度は広いデッドゾーン前提で決めたので、やり直すまでは従来の幅を使う
const CALIB_VERSION_KEY = "calibration_version";
// ポインタ方式: 絶対（正面を固定し、顔の向き＝画面位置）/ 相対（動いた分だけ動く）
const POINTER_MODE_KEY = "pointer_mode";
const POINTER_MODE_ABSOLUTE = "absolute";
const POINTER_MODE_RELATIVE = "relative";
// 絶対方式で端を越えて振り切ったあと、中央のこの範囲まで戻ったら元の係数に戻す（移動範囲の半幅に対する割合）
const ABS_EDGE_RESET_RATIO = 0.05;
// 姿勢ずれのお知らせ: 絶対方式で端に張り付いた状態がこの時間続いたら、正面取り直しボタンを光らせる（自動では取り直さない）
const POSTURE_HINT_PINNED_MS = 15000;
// 端に張り付いているとみなす変位（その側の移動範囲に対する割合）
const POSTURE_HINT_PINNED_RATIO = 0.9;
// 中央付近（範囲のこの割合以内）にこの時間いたら、お知らせを消す
const POSTURE_HINT_CLEAR_RATIO = 0.3;
const POSTURE_HINT_CLEAR_MS = 3000;
const CALIB_VERSION_NOISE_DEADZONE = "2";
// 正面付近とみなす範囲（移動範囲の半幅に対する割合）
const RECENTER_ZONE_RATIO = 0.35;
// 1フレームの補正量の上限（そのフレームの移動量に対する割合）。顔の動きより十分ゆっくり戻す
const RECENTER_RATE = 0.3;
const NOSE_NOISE_KEY = "nose_noise";
const ANGLE_NOISE_KEY = "angle_noise";
// 旧形式（上下共通の倍率）。上下別の倍率が未保存のときの初期値にだけ使う
const VERTICAL_GAIN_RATIO_KEY = "vertical_gain_ratio";
// 正面から見た向き（左右上下）ごとの感度倍率。目で見下ろす癖・目の高さ・カメラ位置で向きごとの効きが違うのを打ち消す
const SIDE_GAIN_RATIO_KEYS = { left: "side_gain_left", right: "side_gain_right", up: "side_gain_up", down: "side_gain_down" };
const SIDE_GAIN_RATIO_LIMITS = { left: [0.5, 2], right: [0.5, 2], up: [0.3, 4], down: [0.3, 4] };
const CALIB_SIDE_KEYS = { left: "dx", right: "dx", up: "dy", down: "dy" };
// 向きごとの倍率は、同じ軸の両側を合算した倍率のこの倍まで（その逆数倍から）に収める
const SIDE_GAIN_ASYMMETRY_MAX = 1.6;
const NOSE_GAIN_KEY = "nose_gain";
const YAW_GAIN_KEY = "yaw_gain";
const NOSE_GAIN_MAX = 20;
const YAW_GAIN_MAX = 20;
const NOSE_GAIN_DEFAULT = 10;
const YAW_GAIN_DEFAULT = 10;
// gain=0(無効)〜gain=MAX(最も敏感)で scale/deadzone を線形+べき乗補間する
const NOSE_SCALE_MIN = 2000;
const NOSE_SCALE_MAX = 38000;
const YAW_SCALE_MIN = 120;
const YAW_SCALE_MAX = 5200;
const NOSE_GAIN_EXPONENT = 1.4;
const YAW_GAIN_EXPONENT = 1.8;
const NOSE_DEADZONE_MIN = 0.0006;
const NOSE_DEADZONE_MAX = 0.0062;
const YAW_DEADZONE_MIN = 0.002;
const YAW_DEADZONE_MAX = 0.025;
const MAX_DELTA_PER_FRAME = 60;
const YAW_ACCEL_START_RAD = 0.03;
const YAW_ACCEL_FULL_RAD = 0.24;
const YAW_ACCEL_MAX_MULTIPLIER = 3.6;
const YAW_ACCEL_EXPONENT = 1.7;

// 上下移動（鼻の縦位置 + 顔の上下向き）。横移動と同じゲインスライダーを共有する
const VERTICAL_MOVE_KEY = "vertical_move_enabled";
// 縦の可動域は横より狭いので、必要ならこの比率で感度を落とす
const VERTICAL_NOSE_SCALE_RATIO = 1.0;
const VERTICAL_PITCH_SCALE_RATIO = 1.0;
// 顔を下へ向けた時にポインタが下がる向き。逆に感じる場合は -1 にする
const PITCH_MIRROR_SIGN = 1;
// 行を跨いだ直後の往復（チャタリング）を防ぐロックアウト
const VERTICAL_STAGE_SWITCH_LOCKOUT_MS = 420;
// 上下限（各行のボタン中央）と階層切替ラインの最小間隔
const VERTICAL_STAGE_TRIGGER_MARGIN_PX = 24;
const VERTICAL_MIN_TRAVEL_PX = 40;

// 軸ロック: 横/縦どちらかが明らかに優勢な速度のとき、もう片方の移動を止めてふらつきを防ぐ
const AXIS_LOCK_SPEED_ALPHA = 0.35;
const AXIS_LOCK_ENGAGE_RATIO = 1.8;
const AXIS_LOCK_RELEASE_RATIO = 1.2;
const AXIS_LOCK_MIN_SPEED_PX = 3;

// 距離補正: 画面に近いほど、画像上の鼻の動きは大きく、同じ画面位置を向くのに必要な顔の角度も大きくなる。
// どちらも「距離に反比例」なので、移動量に (今の距離 / 基準距離)^指数 を掛けて距離の影響を打ち消す
const DISTANCE_COMP_KEY = "distance_comp_enabled";
const DISTANCE_REF_KEY = "distance_ref";
const DISTANCE_EXPONENT_KEY = "distance_exponent";
const DISTANCE_EXPONENT_DEFAULT = 1;
const DISTANCE_RATIO_MIN = 0.4;
const DISTANCE_RATIO_MAX = 2.5;
// 距離は姿勢を変えたときにしか変わらないので、強めに平滑化して口の開閉などの揺れを拾わない
const DISTANCE_FILTER_TIME_CONSTANT_MS = 300;

const JAW_OPEN_THRESHOLD_KEY = "jaw_open_threshold";
const ICON_STYLE_KEY = "icon_style";
const ICON_STYLE_DEFAULT = "simple";
const ICON_STYLE_COMIC = "comic";
const ICON_STYLE_COMIC2 = "comic2";

const JAW_OPEN_THRESHOLD_DEFAULT = 0.10;

const SYMPTOM_STAGE_SYMPTOM = "symptom";
const SYMPTOM_STAGE_BODY_PART = "body-part";
const SYMPTOM_IDLE_RESET_MS = 30000;

const SYMPTOM_FLOW_DIRECT = "direct";

// 操作モード: 2段階の症状モード / パネルを選ぶだけのシンプルモード / 会話を選んでいくお話モード
const APP_MODE_KEY = "app_mode";
const APP_MODE_SYMPTOM = "symptom";
const APP_MODE_SIMPLE = "simple";
const APP_MODE_TALK = "talk";
// 質問モード: 上に並べた質問を介助者がマウスで切り替え、本人が回答パネルで答える。答えても質問モードのまま
const APP_MODE_QUESTION = "question";
const APP_MODES = [APP_MODE_SYMPTOM, APP_MODE_SIMPLE, APP_MODE_TALK, APP_MODE_QUESTION];
// 旧「文づくりモード」はお話モードに置き換えた
const APP_MODE_LEGACY = { compose: APP_MODE_TALK };
const SIMPLE_ROW_ID = "s";
const SIMPLE_CONFIRM_DISPLAY_MS = 2200;
// 滞留(dwell)選択: 同じパネル上でしばらく動かなければ確定する
const DWELL_TIME_KEY = "dwell_time_ms";
const DWELL_TIME_DEFAULT_MS = 1500;
const DWELL_TIME_MAX_MS = 5000;
// この距離以上ポインタが動いたら「動いた」とみなして滞留をやり直す
const DWELL_MOVE_TOLERANCE_PX = 48;
// ジッタでパネル境界を一瞬外れても進捗を保つ猶予
const DWELL_LEAVE_GRACE_MS = 200;
// 一瞬通過しただけでインジケータが出ないよう、少し溜まってから表示する
const DWELL_INDICATOR_SHOW_RATIO = 0.08;
// 起動・モード切替直後は、最初にホバーしたパネルから一度外れるまで滞留しない
const DWELL_LOCK_FIRST_HOVER = "*";
// お話の画面が入れ替わった直後にポインタの下にあるパネルは、外さなくても選べるが、意図せず選ばないよう長めに滞留させる
const DWELL_CARRYOVER_RATIO = 1.5;

const symptomChoices = [
    {
        name: "身体",
        icon: "media/menu-body.png",
        flow: SYMPTOM_FLOW_DIRECT,
        options: [
            { name: "かゆい", icon: "media/menu-itchy.png", sentence: "かゆいです。" },
            { name: "痛い", icon: "media/menu-hurt.png", sentence: "痛いです。" },
            { name: "おなかが張る", icon: "media/menu-bloated-stomach.png", sentence: "おなかが張っています。" },
            { name: "あつい・さむい", icon: "media/menu-hot-cold.png", sentence: "暑いか寒いです。" }
        ]
    },
    {
        name: "お願い",
        icon: "media/menu-request.png",
        flow: SYMPTOM_FLOW_DIRECT,
        options: [
            { name: "吸引", icon: "media/menu-suction.png", sentence: "吸引してください。" },
            { name: "体位かえて", icon: "media/menu-change-position.png", sentence: "体位をかえてください。" },
            { name: "マッサージ", icon: "media/menu-massage.png", sentence: "マッサージしてください。" },
            { name: "おむつ変えて", icon: "media/menu-toilet.png", sentence: "おむつを変えてください。" }
        ]
    },
    {
        name: "気分転換",
        icon: "media/menu-refresh.png",
        flow: SYMPTOM_FLOW_DIRECT,
        options: [
            { name: "お話して", icon: "media/menu-talk.png", sentence: "お話ししてください。" },
            { name: "本", icon: "media/menu-book.png", sentence: "本を読んでください。" },
            { name: "音楽", icon: "media/menu-music.png", sentence: "音楽を聴きたいです。" },
            { name: "DVD", icon: "media/menu-dvd.png", sentence: "DVDを見たいです。" }
        ]
    },
    {
        name: "会話",
        icon: "media/menu-conversation.png",
        flow: SYMPTOM_FLOW_DIRECT,
        options: [
            { name: "ありがとう", icon: "media/menu-thank-you.png", sentence: "ありがとう。" },
            { name: "続きを話して", icon: "media/menu-continue-talking.png", sentence: "続きを話してください。" },
            { name: "話題を変えて", icon: "media/menu-change-topic.png", sentence: "話題を変えてください。" },
            { name: "少し休みたい", icon: "media/menu-rest-little.png", sentence: "少し休みたいです。" }
        ]
    }
];

function readStoredNumber(key, fallback, min, max) {
    return readStoredNumberFromValue(localStorage.getItem(key), fallback, min, max);
}

function readStoredNumberFromValue(raw, fallback, min, max) {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

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

function saveSideGainRatios() {
    Object.entries(SIDE_GAIN_RATIO_KEYS).forEach(([side, key]) => localStorage.setItem(key, String(sideGainRatios[side])));
    localStorage.removeItem(VERTICAL_GAIN_RATIO_KEY);
}

function formatSideRatios(ratios) {
    return ["left", "right", "up", "down"].map(side => ratios[side].toFixed(2)).join(" / ");
}

// 正面からの変位（右・下が正）に、変位の向きの倍率を掛ける。正面では変位 0 なので倍率が切り替わっても跳ねない
function applySideGainRatios(offset, ratios = sideGainRatios) {
    return {
        x: offset.x * (offset.x < 0 ? ratios.left : ratios.right),
        y: offset.y * (offset.y < 0 ? ratios.up : ratios.down)
    };
}

// 相対方式: 変位 from→to の差分に掛ける倍率。正面をまたいだら、またぐ前後の変位の比で両側の倍率を按分する。
// 移動先の側の倍率だけを掛けると、またぐたびに倍率の大きい側へずれていく
function blendSideRatio(from, to, negRatio, posRatio) {
    const ratioOf = value => (value < 0 ? negRatio : posRatio);
    if ((from < 0) === (to < 0)) return ratioOf(to);
    const t = Math.abs(from) / (Math.abs(from) + Math.abs(to));
    return (t * ratioOf(from)) + ((1 - t) * ratioOf(to));
}

function resolveIconPath(iconPath) {
    if (!iconPath || !iconPath.endsWith(".png")) return iconPath;
    // menu系は -cute 素材が未配置のため通常素材を使う
    if (iconStyle === "cute") {
        if (iconPath.startsWith("media/menu-")) return iconPath;
        return iconPath.replace(".png", "-cute.png");
    }
    if (iconStyle === ICON_STYLE_COMIC) return iconPath.replace(".png", "-comic.png");
    if (iconStyle === ICON_STYLE_COMIC2) return iconPath.replace(".png", "-comic2.png");
    return iconPath;
}

// Calibration
let calibratedNoseX = 0.5;
let calibratedNoseY = 0.5;
let calibratedYaw = 0;
let calibratedPitch = 0;
// 正面を登録したときに向いていた画面上の位置（画面に対する割合 {x, y}）。○で登録していなければ null
let frontScreenPoint = null;
let isCalibrating = true;
let noseNoise = readStoredNumber(NOSE_NOISE_KEY, 0, 0, 0.01);
let angleNoise = readStoredNumber(ANGLE_NOISE_KEY, 0, 0, 0.05);
let sideGainRatios = loadSideGainRatios();
let isVerticalMoveEnabled = localStorage.getItem(VERTICAL_MOVE_KEY) !== "0";
let isDistanceCompEnabled = localStorage.getItem(DISTANCE_COMP_KEY) !== "0";
let isRecenterEnabled = localStorage.getItem(RECENTER_KEY) !== "0";
let pointerMode = localStorage.getItem(POINTER_MODE_KEY) === POINTER_MODE_RELATIVE ? POINTER_MODE_RELATIVE : POINTER_MODE_ABSOLUTE;
// 絶対方式で振り切ったときの一時的な端（正面からの変位px。null = 振り切っていない）
let absEdges = { left: null, right: null, up: null, down: null };
let absStageForY = null;
// パネル中央吸着（シンプルモード・絶対方式）: パネルに入るとラベル中央へゆっくり寄せ、
// 着いたら「その顔の向き＝そのパネル中央」になるよう、正面の位置を固定したまま上下左右の縮尺を変える
const PANEL_SNAP_KEY = "panel_snap_enabled";
const PANEL_SNAP_SPEED_PX_PER_S = 260;
// 縮尺を変える点が正面に近すぎる（変位が範囲のこの割合未満）・端に近すぎる（この割合超）と縮尺が極端になるので使わない
const PANEL_SNAP_MIN_RATIO = 0.08;
const PANEL_SNAP_MAX_RATIO = 0.98;
// 軸ロック（相対方式）: 横/縦どちらかが優勢なとき、もう片方を止めて上下左右だけに動かす
const AXIS_LOCK_KEY = "axis_lock_enabled";
let isAxisLockEnabled = localStorage.getItem(AXIS_LOCK_KEY) !== "0";
let isPanelSnapEnabled =localStorage.getItem(PANEL_SNAP_KEY) === "1";
// warpX/Y: 縮尺の変更点 { side, mu, pu }（変位 mu → pu。範囲に対する割合）。gx/gy: 吸着中の補正量px
const panelSnap = { warpX: null, warpY: null, gx: 0, gy: 0, glideEl: null, doneEl: null, lastMs: null };
let postureHintPinnedSinceMs = null;
let postureHintCenteredSinceMs = null;
// 起動直後は、顔が見つかったら正面の登録から始める（最初のフレームの姿勢で正面が決まるのを防ぐ）
let needsStartupFrontRegistration = true;
let isNoiseDeadzone = localStorage.getItem(CALIB_VERSION_KEY) === CALIB_VERSION_NOISE_DEADZONE;
let debugRecenterDrift = 0;
// キャリブレーションで決めた基準距離（0 = 未計測。その間は正面を取り直した時点の距離を基準にする）
let distanceRef = readStoredNumber(DISTANCE_REF_KEY, 0, 0, 1000);
let distanceExponent = readStoredNumber(DISTANCE_EXPONENT_KEY, DISTANCE_EXPONENT_DEFAULT, 0, 2);
let sessionDistanceRef = 0;
let filteredHeadDistance = null;
let lastHeadDistanceMs = null;
let debugDistanceRatio = 1;
let lastVerticalStageSwitchAt = 0;
let jawOpenThreshold = readStoredNumber(JAW_OPEN_THRESHOLD_KEY, JAW_OPEN_THRESHOLD_DEFAULT, 0.0, 0.2);
let noseGain = readStoredNumber(NOSE_GAIN_KEY, NOSE_GAIN_DEFAULT, 0, NOSE_GAIN_MAX);
let yawGain = readStoredNumber(YAW_GAIN_KEY, YAW_GAIN_DEFAULT, 0, YAW_GAIN_MAX);
let iconStyle = localStorage.getItem(ICON_STYLE_KEY) || ICON_STYLE_DEFAULT;
function loadAppMode() {
    const stored = localStorage.getItem(APP_MODE_KEY);
    const mode = APP_MODE_LEGACY[stored] || stored;
    return APP_MODES.includes(mode) ? mode : APP_MODE_SYMPTOM;
}
let appMode = loadAppMode();
let dwellTimeMs = readStoredNumber(DWELL_TIME_KEY, DWELL_TIME_DEFAULT_MS, 0, DWELL_TIME_MAX_MS); // 0 = 滞留確定OFF

// Dwell state
let dwellTargetKey = "";
let dwellStartAt = 0;
let dwellAnchorX = 0;
let dwellAnchorY = 0;
let dwellLeftAt = 0;
// 確定済みパネル。一度外れるまで再選択しない（TD Snap の Look away before reselecting 相当）
let dwellLockedKey = DWELL_LOCK_FIRST_HOVER;
// DWELL_CARRYOVER_RATIO を掛けるパネル。DWELL_LOCK_FIRST_HOVER なら次の判定でポインタの下のパネルを記録する
let dwellCarryoverKey = "";
let isDwellConfirmingCarryover = false;

// 介助者が出した質問への回答中（モードに関係なくパネル選択画面になる）
let activeQuestion = null;

// パネルを縦横に選ぶ画面（シンプル・お話・質問への回答）かどうか
function isSimpleMode() {
    return appMode !== APP_MODE_SYMPTOM || activeQuestion !== null;
}

function isTalkScreen() {
    return appMode === APP_MODE_TALK && activeQuestion === null;
}

function isQuestionMode() {
    return appMode === APP_MODE_QUESTION;
}

// 設定画面（と初回の案内）を開いている間は、確定・発話などの機能を止める
function isSettingsOpen() {
    return document.querySelector(".modal.active") !== null;
}

// キャリブレーションを一度でも保存したか（保存すると版の印を残す）
function isCalibrationDone() {
    return localStorage.getItem(CALIB_VERSION_KEY) !== null;
}

// Symptom state
let symptomStage = SYMPTOM_STAGE_SYMPTOM;
let selectedSymptom = null;
let previewSymptomName = null; // ホバー中に下段プレビュー表示している上位項目名
let symptomLastActivityAt = 0;
let lastSymptomNoseX = null;
let lastSymptomNoseY = null;
let isConfirmInProgress = false;
let confirmOverlayHideWaiters = [];

function waitForConfirmOverlayToHide() {
    if (!confirmOverlay || !confirmOverlay.classList.contains("active")) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        confirmOverlayHideWaiters.push(resolve);
    });
}

function resolveConfirmOverlayHideWaiters() {
    if (confirmOverlayHideWaiters.length === 0) return;

    const waiters = confirmOverlayHideWaiters;
    confirmOverlayHideWaiters = [];
    waiters.forEach((resolve) => resolve());
}

function buildSymptomSentence(detailItem) {
    if (!selectedSymptom || !detailItem) return "";

    if (detailItem.sentence && detailItem.sentence.trim()) return detailItem.sentence.trim();
    return `${detailItem.name}です。`;
}

function resetSymptomModeState(shouldRender = true) {
    symptomStage = SYMPTOM_STAGE_SYMPTOM;
    selectedSymptom = null;
    previewSymptomName = null;
    symptomLastActivityAt = 0;
    lastSymptomNoseX = null;
    lastSymptomNoseY = null;
    resetPointerMotionHistory();
    isConfirmInProgress = false;
    window.clearTimeout(window.symptomResetTimer);
    window.symptomResetTimer = null;
    if (shouldRender) {
        renderAll();
        // ホーム復帰時はポインタを上段の高さへ戻し、再降下できる状態にする
        refreshHoverAndPreview();
        snapPointerToUpperRow();
    }
}

// プレビュー行の有無で上段の高さが変わるため、位置合わせ前に描画を確定させる
function refreshHoverAndPreview() {
    if (!isVerticalMoveEnabled) return;
    checkPointerCollision();
}

function resetPointerMotionHistory() {
    lastMotionUpdateMs = null;
    noseXFilter.reset();
    noseYFilter.reset();
    yawFilter.reset();
    pitchFilter.reset();
    lastNoseControlX = null;
    lastNoseControlY = null;
    lastYaw = null;
    lastPitch = null;
    filteredNoseControlX = null;
    filteredNoseControlY = null;
    filteredYaw = null;
    filteredPitch = null;
    filteredHeadDistance = null;
    lastHeadDistanceMs = null;
    absEdges = { left: null, right: null, up: null, down: null };
    resetPanelSnap();
}

function resetPanelSnap() {
    panelSnap.warpX = null;
    panelSnap.warpY = null;
    panelSnap.gx = 0;
    panelSnap.gy = 0;
    panelSnap.glideEl = null;
    panelSnap.doneEl = null;
    panelSnap.lastMs = null;
}

function updateHeadDistance(detectResults, faceIndex, timeMs) {
    const distance = extractHeadDistance(detectResults, faceIndex);
    if (distance === null) return;
    if (filteredHeadDistance === null || lastHeadDistanceMs === null) {
        filteredHeadDistance = distance;
    } else {
        const dtMs = clamp(timeMs - lastHeadDistanceMs, 0, 200);
        const alpha = 1 - Math.exp(-dtMs / DISTANCE_FILTER_TIME_CONSTANT_MS);
        filteredHeadDistance = lowPassFilter(filteredHeadDistance, distance, alpha);
    }
    lastHeadDistanceMs = timeMs;
}

function getDistanceRatioFor(distance, ref = distanceRef, exponent = distanceExponent) {
    if (!(distance > 0) || !(ref > 0)) return 1;
    return clamp(Math.pow(distance / ref, exponent), DISTANCE_RATIO_MIN, DISTANCE_RATIO_MAX);
}

function getDistanceRatio() {
    if (!isDistanceCompEnabled || filteredHeadDistance === null) return 1;
    return getDistanceRatioFor(filteredHeadDistance, distanceRef > 0 ? distanceRef : sessionDistanceRef);
}

function getSymptomRowPointerBounds() {
    if (isSimpleMode()) return getSimplePanelPointerBounds();

    // 選択中の階層（未選択なら row1、選択後は row2）にポインタを追従させる
    const activeContainer = symptomStage === SYMPTOM_STAGE_BODY_PART ? row2Container : row1Container;
    const buttons = Array.from(activeContainer.querySelectorAll(".h-btn:not(.h-btn--empty):not(.h-btn--static)"));
    if (buttons.length === 0) return null;

    const centers = buttons.map(btn => {
        const rect = btn.getBoundingClientRect();
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
    });

    const minX = Math.min(...centers.map(c => c.x));
    const maxX = Math.max(...centers.map(c => c.x));
    const centerX = centers.reduce((sum, c) => sum + c.x, 0) / centers.length;
    const centerY = centers.reduce((sum, c) => sum + c.y, 0) / centers.length;
    return { minX, maxX, centerX, centerY };
}

// シンプルモード: グリッド全体の各パネル中央の範囲でポインタを動かす
function getSimplePanelPointerBounds() {
    if (!simplePanelContainer) return null;

    const buttons = Array.from(simplePanelContainer.querySelectorAll(".h-btn:not(.h-btn--empty)"));
    const rects = buttons.map(btn => btn.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
    if (rects.length === 0) return null;

    const xs = rects.map(rect => rect.left + rect.width / 2);
    const ys = rects.map(rect => rect.top + rect.height / 2);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

// 表示中の行の縦位置。パンくず表示・プレビュー表示（h-btn--static）も対象にする
function getRowGeometry(container) {
    if (!container || container.style.display === "none") return null;

    const buttons = Array.from(container.querySelectorAll(".h-btn:not(.h-btn--empty)"));
    if (buttons.length === 0) return null;

    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    let centerSum = 0;
    let count = 0;

    buttons.forEach((btn) => {
        const rect = btn.getBoundingClientRect();
        if (rect.height <= 0) return;
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.bottom);
        centerSum += rect.top + (rect.height / 2);
        count += 1;
    });

    if (count === 0) return null;
    return { top, bottom, centerY: centerSum / count };
}

// 上下移動の限界は上段/下段それぞれのボタン中央
function getVerticalPointerBounds() {
    if (isSimpleMode()) {
        // シンプルモードは上下移動ONに関係なく縦横に動かす
        const bounds = getSimplePanelPointerBounds();
        if (!bounds || bounds.maxY - bounds.minY < VERTICAL_MIN_TRAVEL_PX) return null;
        return { minY: bounds.minY, maxY: bounds.maxY };
    }
    if (!isVerticalMoveEnabled) return null;

    const upper = getRowGeometry(row1Container);
    const lower = getRowGeometry(row2Container);
    if (!upper || !lower) return null;

    const minY = Math.min(upper.centerY, lower.centerY);
    const maxY = Math.max(upper.centerY, lower.centerY);
    if (maxY - minY < VERTICAL_MIN_TRAVEL_PX) return null;

    // 切替ラインは必ず上下限の内側に置き、到達不能・即時往復を防ぐ
    const downTriggerY = clamp(lower.top, minY + VERTICAL_STAGE_TRIGGER_MARGIN_PX, maxY);
    const upTriggerY = clamp(upper.bottom, minY, maxY - VERTICAL_STAGE_TRIGGER_MARGIN_PX);
    return { minY, maxY, upper, lower, downTriggerY, upTriggerY };
}

// 行の切替直後は追従補間を挟まずに中央へ乗せ直す（切替ラインの再通過を防ぐ）
function snapPointerToRowCenter(container) {
    if (!isVerticalMoveEnabled) return;

    const geometry = getRowGeometry(container);
    if (!geometry) return;

    targetY = geometry.centerY;
    pointerY = geometry.centerY;
    lastVerticalStageSwitchAt = Date.now();
}

function snapPointerToUpperRow() {
    snapPointerToRowCenter(row1Container);
}

function snapPointerToLowerRow() {
    snapPointerToRowCenter(row2Container);
}

// 行間を通過中もプレビュー対象を保つため、ポインタXから上段ボタンを決める
function findRow1ButtonByPointerX() {
    if (!row1Container) return null;

    const buttons = Array.from(row1Container.querySelectorAll(".h-btn:not(.h-btn--empty)"));
    if (buttons.length === 0) return null;

    let nearest = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const btn of buttons) {
        const rect = btn.getBoundingClientRect();
        if (pointerX >= rect.left && pointerX <= rect.right) return btn;

        const distance = Math.abs(pointerX - (rect.left + (rect.width / 2)));
        if (distance < bestDistance) {
            bestDistance = distance;
            nearest = btn;
        }
    }
    return nearest;
}

function findNearestSimplePanel() {
    if (!simplePanelContainer) return null;

    let nearest = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const btn of simplePanelContainer.querySelectorAll(".h-btn:not(.h-btn--empty)")) {
        const rect = btn.getBoundingClientRect();
        const dx = Math.max(rect.left - pointerX, 0, pointerX - rect.right);
        const dy = Math.max(rect.top - pointerY, 0, pointerY - rect.bottom);
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
            bestDistance = distance;
            nearest = btn;
        }
    }
    return nearest;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lowPassFilter(previous, next, alpha) {
    if (previous === null || Number.isNaN(previous)) return next;
    return (previous * (1 - alpha)) + (next * alpha);
}

// One Euro Filter (Casiez et al. 2012): 速度に応じてカットオフ周波数を変える低域通過フィルタ
function smoothingAlpha(cutoffHz, dtSec) {
    const tau = 1 / (2 * Math.PI * cutoffHz);
    return 1 / (1 + (tau / dtSec));
}

class OneEuroFilter {
    constructor(minCutoff, beta, dCutoff = EURO_DERIVATIVE_CUTOFF) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
        this.reset();
    }

    reset() {
        this.value = null;
        this.derivative = 0;
        this.lastTimeMs = null;
    }

    filter(next, timeMs) {
        if (this.value === null || this.lastTimeMs === null) {
            this.value = next;
            this.derivative = 0;
            this.lastTimeMs = timeMs;
            return next;
        }

        // カメラのフレーム間隔は 1/120〜1/5 秒の範囲に収める（タブ復帰時の長い空白対策）
        const dtSec = clamp((timeMs - this.lastTimeMs) / 1000, 1 / 120, 0.2);
        this.lastTimeMs = timeMs;

        const rawDerivative = (next - this.value) / dtSec;
        this.derivative = lowPassFilter(this.derivative, rawDerivative, smoothingAlpha(this.dCutoff, dtSec));
        const cutoff = this.minCutoff + (this.beta * Math.abs(this.derivative));
        this.value = lowPassFilter(this.value, next, smoothingAlpha(cutoff, dtSec));
        return this.value;
    }
}

const noseXFilter = new OneEuroFilter(NOSE_EURO_MIN_CUTOFF, NOSE_EURO_BETA);
const noseYFilter = new OneEuroFilter(NOSE_EURO_MIN_CUTOFF, NOSE_EURO_BETA);
const yawFilter = new OneEuroFilter(ANGLE_EURO_MIN_CUTOFF, ANGLE_EURO_BETA);
const pitchFilter = new OneEuroFilter(ANGLE_EURO_MIN_CUTOFF, ANGLE_EURO_BETA);

// 位置ドメインのデッドゾーン（バックラッシュ）。
// 揺れ幅 deadzone 以内では anchor を動かさず、超えた分だけ anchor を追従させる。
// フレーム差分に掛けるデッドゾーンと違い、ゆっくりした動きも取りこぼさない
function applyBacklash(anchor, value, deadzone) {
    if (anchor === null) return value;
    if (value > anchor + deadzone) return value - deadzone;
    if (value < anchor - deadzone) return value + deadzone;
    return anchor;
}

// gain 0..MAX を 0..1 に正規化してべき乗カーブを適用する（gainが大きいほど敏感）
function gainCurve(gain, gainMax, exponent) {
    const norm = clamp(gain / gainMax, 0, 1);
    return Math.pow(norm, exponent);
}

function getNoseScale(gain = noseGain) {
    const curved = gainCurve(gain, NOSE_GAIN_MAX, NOSE_GAIN_EXPONENT);
    return NOSE_SCALE_MIN + ((NOSE_SCALE_MAX - NOSE_SCALE_MIN) * curved);
}

function getYawScale(gain = yawGain) {
    const curved = gainCurve(gain, YAW_GAIN_MAX, YAW_GAIN_EXPONENT);
    return YAW_SCALE_MIN + ((YAW_SCALE_MAX - YAW_SCALE_MIN) * curved);
}

// デッドゾーン（バックラッシュ幅）。往復するたびにこの幅の2倍だけ取りこぼし、顔の向きとポインタがずれていく。
// キャリブレーションで静止時の揺れを計測済みなら、揺れに見合った幅だけにして取りこぼしを減らす。
// 未計測（揺れ=0）の間は、ゲインが低いほど広い従来の幅で揺れを抑える
function getNoseDeadzone(gain = noseGain, noise = noseNoise, noiseOnly = isNoiseDeadzone) {
    if (noiseOnly && noise > 0) return Math.max(NOSE_DEADZONE_MIN, noise * NOISE_DEADZONE_FACTOR);
    const curved = gainCurve(gain, NOSE_GAIN_MAX, NOSE_GAIN_EXPONENT);
    const byGain = NOSE_DEADZONE_MAX - ((NOSE_DEADZONE_MAX - NOSE_DEADZONE_MIN) * curved);
    return Math.max(byGain, noise * NOISE_DEADZONE_FACTOR);
}

function getYawDeadzone(gain = yawGain, noise = angleNoise, noiseOnly = isNoiseDeadzone) {
    if (noiseOnly && noise > 0) return Math.max(YAW_DEADZONE_MIN, noise * NOISE_DEADZONE_FACTOR);
    const curved = gainCurve(gain, YAW_GAIN_MAX, YAW_GAIN_EXPONENT);
    const byGain = YAW_DEADZONE_MAX - ((YAW_DEADZONE_MAX - YAW_DEADZONE_MIN) * curved);
    return Math.max(byGain, noise * NOISE_DEADZONE_FACTOR);
}

// 正面(校正位置)から今の顔の位置・向きまでを、ランタイムと同じ式で積算したときのポインタの変位(px)
function getExpectedPointerOffset(distanceRatio) {
    const sample = { noseX: filteredNoseControlX, noseY: filteredNoseControlY, yaw: filteredYaw, pitch: filteredPitch };
    const center = { noseX: calibratedNoseX, noseY: calibratedNoseY, yaw: calibratedYaw, pitch: calibratedPitch };
    const noise = { nose: noseNoise, angle: angleNoise, noiseOnly: isNoiseDeadzone };
    return applySideGainRatios({
        x: horizontalTravel(sample, center, noseGain, distanceRatio, noise, yawGain),
        y: verticalTravel(sample, center, noseGain, distanceRatio, noise, yawGain)
    });
}

// position を expected の方向へ、このフレームの移動量 |delta| × RECENTER_RATE を上限に寄せる
function recenterToward(position, expected, delta) {
    const limit = Math.abs(delta) * RECENTER_RATE;
    return position + clamp(expected - position, -limit, limit);
}

// 絶対方式: 正面(校正位置)から anchor までの顔の変位を、ランタイムと同じゲイン・加速で画面上の変位(px)にする。
// anchor はバックラッシュ後の値なので、揺れはここに来る前に抑えられている
function getAbsoluteFaceOffset(anchor) {
    return applySideGainRatios(getRawFaceOffset(anchor));
}

// 向きごとの倍率を掛ける前の変位。相対方式では、この符号で今どちら側にいるか（どの倍率を使うか）を決める
function getRawFaceOffset(anchor) {
    const noseX = noseGain > 0 ? (anchor.noseX - calibratedNoseX) * getNoseScale() : 0;
    const yaw = yawGain > 0
        ? signedAcceleratedAngle(calibratedYaw, anchor.yaw, calibratedYaw) * YAW_MIRROR_SIGN * getYawScale()
        : 0;
    const noseY = noseGain > 0 ? (anchor.noseY - calibratedNoseY) * getNoseScale() * VERTICAL_NOSE_SCALE_RATIO : 0;
    const pitch = yawGain > 0
        ? signedAcceleratedAngle(calibratedPitch, anchor.pitch, calibratedPitch) * PITCH_MIRROR_SIGN * getYawScale() * VERTICAL_PITCH_SCALE_RATIO
        : 0;
    return { x: noseX + yaw, y: noseY + pitch };
}

// 端を越えて振り切った量を一時的な端として覚え、戻すときは「正面→一時的な端」を「正面の位置→画面の端」に縮めて動かす。
// 戻し始めた瞬間から動き、正面で必ず正面の位置に来る。正面付近まで戻ったら元の係数に戻す（正面付近ではどちらの係数でも
// ほぼ同じ位置なので跳ねない）
function mapAbsoluteAxis(raw, negRange, posRange, negKey, posKey) {
    const side = raw >= 0 ? posKey : negKey;
    const range = raw >= 0 ? posRange : negRange;
    const magnitude = Math.abs(raw);
    absEdges[raw >= 0 ? negKey : posKey] = null;
    if (range <= 0) return 0;
    if (absEdges[side] !== null && magnitude < range * ABS_EDGE_RESET_RATIO) absEdges[side] = null;
    if (magnitude > range) absEdges[side] = Math.max(absEdges[side] ?? range, magnitude);
    const edge = Math.max(range, absEdges[side] ?? range);
    return Math.sign(raw) * magnitude * (range / edge);
}

// 変位 m0（顔の向きから決まる位置）を変位 p0（パネル中央）へ置く縮尺の変更点。
// 正面(0)は動かさないので、m0 と p0 は同じ側・正面と端の間に無いと作れない
function makePanelWarp(m0, p0, negRange, posRange) {
    const side = Math.sign(m0);
    if (side === 0 || Math.sign(p0) !== side) return null;
    const range = side > 0 ? posRange : negRange;
    if (range <= 0) return null;
    const mu = Math.abs(m0) / range;
    const pu = Math.abs(p0) / range;
    if (mu < PANEL_SNAP_MIN_RATIO || mu > PANEL_SNAP_MAX_RATIO || pu < PANEL_SNAP_MIN_RATIO || pu > 1) return null;
    return { side, mu, pu };
}

// 正面→変更点→端の区間ごとに線形に伸縮する。変更点と反対側は変えない
function applyPanelWarp(m, warp, negRange, posRange) {
    if (!warp || Math.sign(m) !== warp.side) return m;
    const range = warp.side > 0 ? posRange : negRange;
    if (range <= 0) return m;
    const u = Math.abs(m);
    const u0 = warp.mu * range;
    const p = warp.pu * range;
    const out = u <= u0 ? (u * p / u0) : (p + ((u - u0) * (range - p) / (range - u0)));
    return warp.side * Math.min(out, range);
}

function findPanelAt(x, y) {
    if (!simplePanelContainer) return null;
    for (const btn of simplePanelContainer.querySelectorAll(".h-btn:not(.h-btn--empty)")) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return btn;
    }
    return null;
}

// パネルに入ったらラベル中央へ一定速度で寄せる。着いたらそのパネルでは吸着しない（次のパネルに入るまで）。
// 着いた時点の顔の向きがパネル中央になるよう、縮尺の変更点を作り直す。
// nat: 縮尺変更後の位置、ax/ay: { m(変更前の変位), center, neg, pos }。ay は縦に動けないとき null
function updatePanelSnap(nat, ax, ay, timeMs) {
    const s = panelSnap;
    const dt = s.lastMs === null ? 0 : clamp((timeMs - s.lastMs) / 1000, 0, 0.1);
    s.lastMs = timeMs;

    const panel = findPanelAt(nat.x + s.gx, nat.y + s.gy);
    if (panel !== s.doneEl) s.doneEl = null;
    if (panel !== s.glideEl) s.glideEl = panel && !s.doneEl ? panel : null;

    let wx = null;
    let wy = null;
    let center = null;
    let tx = 0;
    let ty = 0;
    if (s.glideEl) {
        const rect = s.glideEl.getBoundingClientRect();
        center = { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) };
        wx = makePanelWarp(ax.m, center.x - ax.center, ax.neg, ax.pos);
        wy = ay ? makePanelWarp(ay.m, center.y - ay.center, ay.neg, ay.pos) : null;
        if (!wx && !wy) {
            // 縮尺を変えられない位置（正面付近など）は寄せない
            s.doneEl = s.glideEl;
            s.glideEl = null;
        } else {
            tx = wx ? center.x - nat.x : 0;
            ty = wy ? center.y - nat.y : 0;
        }
    }

    const step = (s.glideEl ? PANEL_SNAP_SPEED_PX_PER_S : PANEL_SNAP_SPEED_PX_PER_S * 2) * dt;
    const dx = tx - s.gx;
    const dy = ty - s.gy;
    const dist = Math.hypot(dx, dy);
    if (dist <= step || dist < 0.5) {
        s.gx = tx;
        s.gy = ty;
    } else {
        s.gx += (dx / dist) * step;
        s.gy += (dy / dist) * step;
    }

    if (s.glideEl && s.gx === tx && s.gy === ty) {
        if (wx) s.warpX = wx;
        if (wy) s.warpY = wy;
        s.gx = 0;
        s.gy = 0;
        s.doneEl = s.glideEl;
        s.glideEl = null;
        return { x: wx ? center.x : nat.x, y: wy ? center.y : nat.y };
    }
    return { x: nat.x + s.gx, y: nat.y + s.gy };
}

// シンプルモードの正面の位置（px）。絶対方式で○を向いて正面を登録していれば、その○の画面上の位置（範囲内に収める）。
// 感度は画面上の実際の距離で合わせているので、範囲の中央を正面にすると○の位置と中央の差だけ画面全体で向いた場所からずれる。
// 上下（左右）の範囲は不均等になってよい。それ以外は範囲の中央
function getSimpleFrontPoint(bounds) {
    const front = pointerMode === POINTER_MODE_ABSOLUTE ? frontScreenPoint : null;
    if (!front) return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    return {
        x: clamp(front.x * window.innerWidth, bounds.minX, bounds.maxX),
        y: clamp(front.y * window.innerHeight, bounds.minY, bounds.maxY)
    };
}

function updateAbsolutePointerTarget(bounds, verticalBounds, anchor, timeMs) {
    const distanceRatio = getDistanceRatio();
    debugDistanceRatio = distanceRatio;
    const offset = getAbsoluteFaceOffset(anchor);
    const rawX = offset.x * distanceRatio;
    const rawY = offset.y * distanceRatio;

    const simpleFront = isSimpleMode() ? getSimpleFrontPoint(bounds) : null;
    const centerX = simpleFront ? simpleFront.x : (bounds.minX + bounds.maxX) / 2;
    const leftRange = centerX - bounds.minX;
    const rightRange = bounds.maxX - centerX;
    const mapX = mapAbsoluteAxis(rawX, leftRange, rightRange, "left", "right");
    let nextX = clamp(centerX + applyPanelWarp(mapX, panelSnap.warpX, leftRange, rightRange), bounds.minX, bounds.maxX);
    let nextY = bounds.centerY;
    let snapAxisY = null;
    let upRange = 0;
    let downRange = 0;
    if (verticalBounds) {
        const stage = isSimpleMode() ? "simple" : symptomStage;
        if (stage !== absStageForY) {
            absEdges.up = null;
            absEdges.down = null;
            absStageForY = stage;
        }
        // 症状モードは段ごとに正面の位置を変える（上段: 正面=上段、下段: 正面=下段）。下段で下を向き続けなくてよい
        let centerY = simpleFront ? simpleFront.y : (verticalBounds.minY + verticalBounds.maxY) / 2;
        if (!isSimpleMode()) centerY = symptomStage === SYMPTOM_STAGE_BODY_PART ? verticalBounds.maxY : verticalBounds.minY;
        upRange = centerY - verticalBounds.minY;
        downRange = verticalBounds.maxY - centerY;
        const mapY = mapAbsoluteAxis(rawY, upRange, downRange, "up", "down");
        nextY = clamp(centerY + applyPanelWarp(mapY, panelSnap.warpY, upRange, downRange), verticalBounds.minY, verticalBounds.maxY);
        snapAxisY = { m: mapY, center: centerY, neg: upRange, pos: downRange };
    }
    if (isPanelSnapEnabled && isSimpleMode() && !isConfirmInProgress) {
        const snapped = updatePanelSnap(
            { x: nextX, y: nextY },
            { m: mapX, center: centerX, neg: leftRange, pos: rightRange },
            snapAxisY,
            timeMs
        );
        nextX = clamp(snapped.x, bounds.minX, bounds.maxX);
        if (verticalBounds) nextY = clamp(snapped.y, verticalBounds.minY, verticalBounds.maxY);
    } else {
        resetPanelSnap();
    }
    debugDeltaX = nextX - targetX;
    debugDeltaYPx = nextY - targetY;
    debugRecenterDrift = 0;

    updatePostureHint(rawX, rawY, centerX - bounds.minX, bounds.maxX - centerX, upRange, downRange, timeMs);
    targetX = nextX;
    targetY = nextY;
}

// 姿勢ずれのお知らせは、右上の「◎ 正面取り直し」を光らせる
function setPostureHint(isOn) {
    document.getElementById("recapture-front-btn")?.classList.toggle("suggest", isOn);
}

function clearPostureHint() {
    postureHintPinnedSinceMs = null;
    postureHintCenteredSinceMs = null;
    setPostureHint(false);
}

// 姿勢がずれると、正面のつもりでも片側の端に張り付いたままになる。長く続いたら取り直しを促す
function updatePostureHint(rawX, rawY, leftRange, rightRange, upRange, downRange, timeMs) {
    // 範囲 0 の側（症状モードの段ごとの正面）は設計上いつも端なので数えない
    const pinnedOn = (raw, negRange, posRange) => (posRange > 0 && raw >= posRange * POSTURE_HINT_PINNED_RATIO)
        || (negRange > 0 && -raw >= negRange * POSTURE_HINT_PINNED_RATIO);
    // 範囲の無い軸（上下移動なし）は中央扱い
    const nearCenter = (raw, negRange, posRange) => (negRange <= 0 && posRange <= 0)
        || Math.abs(raw) <= Math.max(negRange, posRange) * POSTURE_HINT_CLEAR_RATIO;
    const isPinned = pinnedOn(rawX, leftRange, rightRange) || pinnedOn(rawY, upRange, downRange);
    const isCentered = nearCenter(rawX, leftRange, rightRange) && nearCenter(rawY, upRange, downRange);

    if (isPinned) {
        if (postureHintPinnedSinceMs === null) postureHintPinnedSinceMs = timeMs;
        if (timeMs - postureHintPinnedSinceMs >= POSTURE_HINT_PINNED_MS) setPostureHint(true);
    } else {
        postureHintPinnedSinceMs = null;
    }

    if (isCentered) {
        if (postureHintCenteredSinceMs === null) postureHintCenteredSinceMs = timeMs;
        if (timeMs - postureHintCenteredSinceMs >= POSTURE_HINT_CLEAR_MS) setPostureHint(false);
    } else {
        postureHintCenteredSinceMs = null;
    }
}

function getAngleOffsetAcceleration(currentAngle, calibratedAngle) {
    const offsetAbs = Math.abs((currentAngle ?? calibratedAngle) - calibratedAngle);
    const norm = clamp((offsetAbs - YAW_ACCEL_START_RAD) / (YAW_ACCEL_FULL_RAD - YAW_ACCEL_START_RAD), 0, 1);
    const curved = Math.pow(norm, YAW_ACCEL_EXPONENT);
    return 1 + ((YAW_ACCEL_MAX_MULTIPLIER - 1) * curved);
}

function formatMetric(value, digits = 3) {
    if (!Number.isFinite(value)) return "-";
    return Number(value).toFixed(digits);
}

function updateTelemetryPanel(hasFace) {
    if (!telemetryValues) return;

    const f2 = v => formatMetric(v, 2);
    const f3 = v => formatMetric(v, 3);
    const lines = [
        `顔: ${hasFace ? "検出中" : "なし"}`,
        `鼻Δ: ${f3(debugDeltaN)}`,
        `顔向きΔ: ${f3(debugDeltaY)}`,
        `鼻寄与px: ${f2(debugPixN)}`,
        `傾き寄与px: ${f2(debugPixY)}`,
        `横移動px: ${f2(debugDeltaX)}`,
        `口(実/閾): ${f3(jawOpenFilteredScore)}/${f3(debugJawOpenThreshold)}`,
        `距離比: ${isDistanceCompEnabled ? f2(debugDistanceRatio) : "補正OFF"}`,
        `方式: ${pointerMode === POINTER_MODE_ABSOLUTE ? "絶対（正面固定）" : "相対"}`,
        pointerMode === POINTER_MODE_ABSOLUTE
            ? `一時的な端px(左/右/上/下): ${["left", "right", "up", "down"].map(k => (absEdges[k] === null ? "-" : absEdges[k].toFixed(0))).join("/")}`
            : `中央補正ずれpx: ${isRecenterEnabled ? f2(debugRecenterDrift) : "OFF"}`
    ];

    if (isVerticalMoveEnabled) {
        lines.push(`鼻縦Δ: ${f3(debugDeltaNoseY)}`);
        lines.push(`上下向きΔ: ${f3(debugDeltaPitch)}`);
        lines.push(`縦移動px: ${f2(debugDeltaYPx)}`);
        lines.push(`軸ロック: ${axisLockDominant === "x" ? "横優先" : axisLockDominant === "y" ? "縦優先" : "なし"}`);
    }

    telemetryValues.textContent = lines.join("\n");
}

function toMatrixArray(matrixLike) {
    if (!matrixLike) return null;

    if (Array.isArray(matrixLike) && matrixLike.length === 16) {
        return matrixLike;
    }

    if (matrixLike.data && matrixLike.data.length === 16) {
        return Array.from(matrixLike.data);
    }

    if (typeof matrixLike.getDataList === "function") {
        const data = matrixLike.getDataList();
        if (data && data.length === 16) return Array.from(data);
    }

    if (matrixLike.matrix && matrixLike.matrix.length === 16) {
        return Array.from(matrixLike.matrix);
    }

    return null;
}

// 4x4 の並び順を平行移動成分の位置から判定する（row-major は末尾行が 0,0,0,1）
function isRowMajorMatrix(m) {
    const rowMajorTail = Math.abs(m[12]) + Math.abs(m[13]) + Math.abs(m[14]);
    const columnMajorTail = Math.abs(m[3]) + Math.abs(m[7]) + Math.abs(m[11]);
    return rowMajorTail <= columnMajorTail;
}

// 顔の正面方向（顔モデルの +z 軸 = 回転行列の第3列）のカメラ座標。カメラを向いているとき z > 0
function extractHeadForward(detectResults, faceIndex = 0) {
    const matrices = detectResults?.facialTransformationMatrixes;
    if (!matrices || matrices.length <= faceIndex) return null;

    const m = toMatrixArray(matrices[faceIndex]);
    if (!m || m.length !== 16) return null;

    const rowMajor = isRowMajorMatrix(m);
    const at = (row, col) => (rowMajor ? m[(row * 4) + col] : m[(col * 4) + row]);
    const forward = { x: at(0, 2), y: at(1, 2), z: at(2, 2), rowMajor };
    if (![forward.x, forward.y, forward.z].every(Number.isFinite) || forward.z <= 1e-3) return null;
    return forward;
}

// yaw / pitch は「顔の正面方向の直線が画面（カメラ正面の平面）に当たる点」の横・縦の角度（x/z, y/z の atan）。
// Euler 角は上を向いたまま左右に回すと pitch が cos(yaw) 倍に縮み、ポインタが端で下がる円弧になる。
// 画面との交点なら、顔自身の縦軸・横軸まわりの回転（上を向いたまま首の軸で左右に回すなど）は画面上の直線のまま、
// 首のかしげ（roll）にも影響されない。
// 正面付近（片方の角度が 0）では従来の Euler 角と同じ値になる
function extractHeadYawRadians(detectResults, faceIndex = 0) {
    const f = extractHeadForward(detectResults, faceIndex);
    if (!f) return null;
    // 従来の atan2(m[2], m[0]) と同じ向き（column-major のときは符号が反転していた）に揃え、YAW_MIRROR_SIGN をそのまま使う
    return (f.rowMajor ? 1 : -1) * Math.atan2(f.x, f.z);
}

function extractHeadPitchRadians(detectResults, faceIndex = 0) {
    const f = extractHeadForward(detectResults, faceIndex);
    if (!f) return null;
    // 顔が下を向くほど正
    return Math.atan2(-f.y, f.z);
}

// 顔の並進成分 z（カメラからの距離。単位は概ね cm）。比率しか使わないので絶対値の精度は問わない
function extractHeadDistance(detectResults, faceIndex = 0) {
    const matrices = detectResults?.facialTransformationMatrixes;
    if (!matrices || matrices.length <= faceIndex) return null;

    const m = toMatrixArray(matrices[faceIndex]);
    if (!m || m.length !== 16) return null;

    const rowMajor = isRowMajorMatrix(m);
    const distance = Math.abs(rowMajor ? m[11] : m[14]);
    return Number.isFinite(distance) && distance > 1 ? distance : null;
}

function getGazeEnhancedX(landmarks, noseX) {
    // 目線アシストは無効化し、鼻追従のみで制御する
    return noseX;
}

// 横/縦の移動速度(EMA)を比較し、片方が優勢なら axisLockDominant にその軸をセットして
// もう片方をブロックする。ヒステリシス(ENGAGE > RELEASE)で判定のチャタリングを防ぐ
function updateAxisLockDominant(speedX, speedY) {
    if (!isAxisLockEnabled) {
        axisLockDominant = null;
        return;
    }
    if (speedX < AXIS_LOCK_MIN_SPEED_PX && speedY < AXIS_LOCK_MIN_SPEED_PX) {
        axisLockDominant = null;
        return;
    }

    if (axisLockDominant === "x") {
        if (speedX < speedY * AXIS_LOCK_RELEASE_RATIO) axisLockDominant = null;
        return;
    }
    if (axisLockDominant === "y") {
        if (speedY < speedX * AXIS_LOCK_RELEASE_RATIO) axisLockDominant = null;
        return;
    }

    if (speedX > speedY * AXIS_LOCK_ENGAGE_RATIO) axisLockDominant = "x";
    else if (speedY > speedX * AXIS_LOCK_ENGAGE_RATIO) axisLockDominant = "y";
}

function updateRelativePointerTarget(noseX, landmarks, detectResults, faceIndex, timeMs) {
    const bounds = getSymptomRowPointerBounds();
    if (!bounds) return;

    const verticalBounds = getVerticalPointerBounds();
    const mirroredNoseX = 1 - getGazeEnhancedX(landmarks, noseX);
    const noseControlY = landmarks?.[4]?.y ?? filteredNoseControlY ?? calibratedNoseY;
    const rawYaw = extractHeadYawRadians(detectResults, faceIndex);
    const yaw = Number.isFinite(rawYaw) ? rawYaw : calibratedYaw;
    const rawPitch = extractHeadPitchRadians(detectResults, faceIndex);
    const pitch = Number.isFinite(rawPitch) ? rawPitch : calibratedPitch;

    filteredNoseControlX = noseXFilter.filter(mirroredNoseX, timeMs);
    filteredNoseControlY = noseYFilter.filter(noseControlY, timeMs);
    filteredYaw = yawFilter.filter(yaw, timeMs);
    filteredPitch = pitchFilter.filter(pitch, timeMs);
    updateHeadDistance(detectResults, faceIndex, timeMs);

    if (isCalibrating) {
        // ○を使わない登録は、どこを向いていたか分からないので範囲の中央を正面にする
        frontScreenPoint = null;
        sessionDistanceRef = filteredHeadDistance ?? 0;
        calibratedNoseX = filteredNoseControlX;
        calibratedNoseY = filteredNoseControlY;
        calibratedYaw = filteredYaw;
        calibratedPitch = filteredPitch;
        lastNoseControlX = filteredNoseControlX;
        lastNoseControlY = filteredNoseControlY;
        lastYaw = filteredYaw;
        lastPitch = filteredPitch;
        targetX = clamp(targetX, bounds.minX, bounds.maxX);
        if (isSimpleMode()) {
            targetY = clamp(targetY, bounds.minY, bounds.maxY);
        } else if (isVerticalMoveEnabled) {
            // 校正直後は正面の行から始める（相対方式は上段、絶対方式は今の段の行）
            snapPointerToFrontRow();
        } else {
            targetY = bounds.centerY;
        }
        isCalibrating = false;
        speedXEma = 0;
        speedYEma = 0;
        axisLockDominant = null;
        speak("完了");
        return;
    }

    if (lastNoseControlX === null || lastYaw === null || lastNoseControlY === null || lastPitch === null) {
        lastNoseControlX = filteredNoseControlX;
        lastNoseControlY = filteredNoseControlY;
        lastYaw = filteredYaw;
        lastPitch = filteredPitch;
        speedXEma = 0;
        speedYEma = 0;
        axisLockDominant = null;
        if (verticalBounds) {
            targetY = clamp(targetY, verticalBounds.minY, verticalBounds.maxY);
        } else {
            targetY = bounds.centerY;
        }
        return;
    }

    // 絶対方式では遊びが「戻したときの位置の差」として残るので、揺れを抑える最小限の幅にする
    const isAbsolute = pointerMode === POINTER_MODE_ABSOLUTE;
    const noseDeadzone = isAbsolute ? Math.max(NOSE_DEADZONE_MIN, noseNoise * NOISE_DEADZONE_FACTOR) : getNoseDeadzone();
    const yawDeadzone = isAbsolute ? Math.max(YAW_DEADZONE_MIN, angleNoise * NOISE_DEADZONE_FACTOR) : getYawDeadzone();
    // last* はバックラッシュ後の値（anchor）。差分は anchor の移動量
    const nextNoseX = applyBacklash(lastNoseControlX, filteredNoseControlX, noseDeadzone);
    const nextYaw = applyBacklash(lastYaw, filteredYaw, yawDeadzone);
    const nextNoseY = applyBacklash(lastNoseControlY, filteredNoseControlY, noseDeadzone);
    const nextPitch = applyBacklash(lastPitch, filteredPitch, yawDeadzone);
    if (isAbsolute) {
        updateAbsolutePointerTarget(bounds, verticalBounds, { noseX: nextNoseX, noseY: nextNoseY, yaw: nextYaw, pitch: nextPitch }, timeMs);
        lastNoseControlX = nextNoseX;
        lastNoseControlY = nextNoseY;
        lastYaw = nextYaw;
        lastPitch = nextPitch;
        return;
    }
    const dN = nextNoseX - lastNoseControlX;
    const dY = nextYaw - lastYaw;
    debugDeltaN = dN;
    debugDeltaY = dY;

    let pixN = 0;
    if (noseGain > 0) {
        pixN = dN * getNoseScale();
    }

    let pixY = 0;
    if (yawGain > 0) {
        const yawAccel = getAngleOffsetAcceleration(filteredYaw, calibratedYaw);
        pixY = dY * YAW_MIRROR_SIGN * getYawScale() * yawAccel;
    }
    debugPixN = pixN;
    debugPixY = pixY;

    const distanceRatio = getDistanceRatio();
    debugDistanceRatio = distanceRatio;
    // 向きごとの倍率は、顔が正面からどちら側にあるかで選ぶ（絶対方式と同じ倍率）
    const fromSide = getRawFaceOffset({ noseX: lastNoseControlX, noseY: lastNoseControlY, yaw: lastYaw, pitch: lastPitch });
    const toSide = getRawFaceOffset({ noseX: nextNoseX, noseY: nextNoseY, yaw: nextYaw, pitch: nextPitch });
    const sideRatioX = blendSideRatio(fromSide.x, toSide.x, sideGainRatios.left, sideGainRatios.right);
    const sideRatioY = blendSideRatio(fromSide.y, toSide.y, sideGainRatios.up, sideGainRatios.down);
    const rawDeltaX = (pixN + pixY) * distanceRatio * sideRatioX;

    // 上下移動: 鼻の縦位置 + 顔の上下向きを横移動と同じゲインで合成する
    const dNoseY = nextNoseY - lastNoseControlY;
    const dPitch = nextPitch - lastPitch;
    debugDeltaNoseY = dNoseY;
    debugDeltaPitch = dPitch;

    let rawDeltaY = 0;
    if (verticalBounds) {
        let pixNoseY = 0;
        if (noseGain > 0) {
            pixNoseY = dNoseY * getNoseScale() * VERTICAL_NOSE_SCALE_RATIO;
        }

        let pixPitch = 0;
        if (yawGain > 0) {
            const pitchAccel = getAngleOffsetAcceleration(filteredPitch, calibratedPitch);
            pixPitch = dPitch * PITCH_MIRROR_SIGN * getYawScale() * pitchAccel * VERTICAL_PITCH_SCALE_RATIO;
        }

        rawDeltaY = (pixNoseY + pixPitch) * distanceRatio * sideRatioY;
    }

    // 軸ロック: 横/縦の速度を比較し、片方が明らかに優勢ならもう片方の移動を止める
    // 移動計算はカメラフレーム毎（30fps前後）なので、60fps 基準の定数を経過時間で換算する
    const frameScale = lastMotionUpdateMs === null ? 1 : clamp((timeMs - lastMotionUpdateMs) / (1000 / 60), 1, 6);
    lastMotionUpdateMs = timeMs;
    const maxDelta = MAX_DELTA_PER_FRAME * frameScale;
    const speedAlpha = 1 - Math.pow(1 - AXIS_LOCK_SPEED_ALPHA, frameScale);
    speedXEma = lowPassFilter(speedXEma, Math.abs(rawDeltaX) / frameScale, speedAlpha);
    speedYEma = lowPassFilter(speedYEma, Math.abs(rawDeltaY) / frameScale, speedAlpha);
    updateAxisLockDominant(speedXEma, speedYEma);

    const deltaX = clamp(axisLockDominant === "y" ? 0 : rawDeltaX, -maxDelta, maxDelta);
    debugDeltaX = deltaX;
    targetX = clamp(targetX + deltaX, bounds.minX, bounds.maxX);

    const expected = isRecenterEnabled ? getExpectedPointerOffset(distanceRatio) : null;
    if (expected) {
        const halfWidth = (bounds.maxX - bounds.minX) / 2;
        const expectedX = ((bounds.minX + bounds.maxX) / 2) + expected.x;
        debugRecenterDrift = targetX - expectedX;
        if (halfWidth > 0 && Math.abs(expected.x) <= halfWidth * RECENTER_ZONE_RATIO) {
            targetX = clamp(recenterToward(targetX, expectedX, deltaX), bounds.minX, bounds.maxX);
        }
    }

    if (verticalBounds) {
        const deltaY = clamp(axisLockDominant === "x" ? 0 : rawDeltaY, -maxDelta, maxDelta);
        debugDeltaYPx = deltaY;
        targetY = clamp(targetY + deltaY, verticalBounds.minY, verticalBounds.maxY);
        // 症状モードの縦は行の切替でポインタを行中央へ乗せ直すため、中央補正はシンプルモードだけ
        const halfHeight = (verticalBounds.maxY - verticalBounds.minY) / 2;
        if (expected && isSimpleMode() && halfHeight > 0 && Math.abs(expected.y) <= halfHeight * RECENTER_ZONE_RATIO) {
            const expectedY = ((verticalBounds.minY + verticalBounds.maxY) / 2) + expected.y;
            targetY = clamp(recenterToward(targetY, expectedY, deltaY), verticalBounds.minY, verticalBounds.maxY);
        }
    } else {
        debugDeltaYPx = 0;
        targetY = bounds.centerY;
    }

    lastNoseControlX = nextNoseX;
    lastNoseControlY = nextNoseY;
    lastYaw = nextYaw;
    lastPitch = nextPitch;
}

// 上下移動で行を跨いだら階層を進める/戻す
function updateVerticalStageTransition() {
    if (isSimpleMode() || !isVerticalMoveEnabled) return;
    if (isCalibrating || isConfirmInProgress) return;
    if (pendingClickTimer) return;
    if (Date.now() - lastVerticalStageSwitchAt < VERTICAL_STAGE_SWITCH_LOCKOUT_MS) return;

    const verticalBounds = getVerticalPointerBounds();
    if (!verticalBounds) return;

    if (symptomStage === SYMPTOM_STAGE_SYMPTOM) {
        if (pointerY < verticalBounds.downTriggerY) return;

        const target = symptomChoices.find((choice) => choice.name === previewSymptomName)
            || symptomChoices.find((choice) => choice.name === findRow1ButtonByPointerX()?.dataset.name);
        if (!target) return;

        selectedSymptom = target;
        symptomStage = SYMPTOM_STAGE_BODY_PART;
        symptomLastActivityAt = Date.now();
        renderAll();
        // 下段が主役サイズへ切り替わるので、新しい下段中央へ乗せ直す
        snapPointerToLowerRow();
        return;
    }

    if (pointerY > verticalBounds.upTriggerY) return;

    // 下段から上へ抜けたら一番上の階層へ戻る
    symptomStage = SYMPTOM_STAGE_SYMPTOM;
    selectedSymptom = null;
    previewSymptomName = null;
    symptomLastActivityAt = 0;
    lastSymptomNoseX = null;
    lastSymptomNoseY = null;
    renderAll();
    refreshHoverAndPreview();
    snapPointerToUpperRow();
}

async function handleSymptomClick(item) {
    if (isConfirmInProgress) return;

    if (symptomStage === SYMPTOM_STAGE_SYMPTOM) {
        selectedSymptom = item;
        symptomStage = SYMPTOM_STAGE_BODY_PART;
        symptomLastActivityAt = Date.now();
        renderAll();
        // 口開けで進んだ場合もポインタを下段中央へ乗せ、直後の階層往復を防ぐ
        snapPointerToLowerRow();
        return;
    }

    const sentence = buildSymptomSentence(item);
    if (!sentence) return;

    showConfirm(sentence);
    isConfirmInProgress = true;

    // 発話は継続させ、ホーム復帰は確認ダイアログの非表示完了に同期
    void speak(sentence);

    try {
        await waitForConfirmOverlayToHide();
    } finally {
        resetSymptomModeState();
    }
}

function checkSymptomIdleReset() {
    if (symptomStage !== SYMPTOM_STAGE_BODY_PART || !symptomLastActivityAt) {
        return;
    }

    if (Date.now() - symptomLastActivityAt >= SYMPTOM_IDLE_RESET_MS) {
        resetSymptomModeState();
    }
}

function trackSymptomActivityByMovement(noseX, noseY) {
    if (symptomStage !== SYMPTOM_STAGE_BODY_PART) return;

    if (lastSymptomNoseX === null || lastSymptomNoseY === null) {
        lastSymptomNoseX = noseX;
        lastSymptomNoseY = noseY;
        return;
    }

    const dx = Math.abs(noseX - lastSymptomNoseX);
    const dy = Math.abs(noseY - lastSymptomNoseY);
    const activityThreshold = getNoseDeadzone();
    if (dx >= activityThreshold || dy >= activityThreshold) {
        symptomLastActivityAt = Date.now();
    }

    lastSymptomNoseX = noseX;
    lastSymptomNoseY = noseY;
}

// =========================================================
// MediaPipe
// =========================================================
async function setupMediaPipe() {
    try {
        const filesetResolver = await FilesetResolver.forVisionTasks("./mediapipe/wasm");
        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: "./mediapipe/model/face_landmarker.task",
                delegate: "GPU"
            },
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            runningMode: "VIDEO",
            numFaces: 1
        });
        loadingOverlay.style.display = "none";
        // キャリブレーションがまだなら、起動時の正面登録の代わりに案内を出す（顔が映る前でも出す）
        if (!isCalibrationDone()) {
            needsStartupFrontRegistration = false;
            openWelcome();
        }
        startCamera();
    } catch (error) {
        console.error("MediaPipe initialization failed:", error);
        loadingOverlay.querySelector("p").textContent = "カメラ初期化に失敗しました";
    }
}

async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    video.srcObject = stream;
    video.addEventListener("loadeddata", predictWebcam);
}

function fitButtonText(btn, label) {
    // よく話す文の候補は長いので折り返して表示する
    if (btn.classList.contains("talk-panel--phrase")) {
        label.style.whiteSpace = "normal";
        label.style.fontSize = "";
        return;
    }
    label.style.whiteSpace = "nowrap";
    label.style.fontSize = "";
    const maxWidth = btn.clientWidth - 16;
    if (maxWidth <= 0) return;
    let fontSize = parseFloat(getComputedStyle(label).fontSize);
    let guard = 0;
    // 元仕様: 横幅超過のみを条件に 1px ずつ縮小
    while (label.scrollWidth > maxWidth && fontSize > 8 && guard < 60) {
        fontSize -= 1;
        label.style.fontSize = `${fontSize}px`;
        guard += 1;
    }
}

function refitAllButtonText() {
    document.querySelectorAll(".h-btn").forEach((btn) => {
        const label = btn.querySelector(".h-btn-text");
        if (label) fitButtonText(btn, label);
    });
}

let refitResizeTimer = null;
window.addEventListener("resize", () => {
    clearTimeout(refitResizeTimer);
    refitResizeTimer = setTimeout(refitAllButtonText, 120);
});

function renderRow(container, items, rowNumber, onClick, options = {}) {
    const { isStatic = false, selectedName = null } = options;
    container.innerHTML = "";
    if (!items || items.length === 0) return;

    container.style.gridTemplateColumns = `repeat(${items.length}, 1fr)`;

    items.forEach((item, idx) => {
        const btn = document.createElement("div");
        btn.className = "h-btn";
        if (isStatic) btn.classList.add("h-btn--static");
        if (selectedName) {
            btn.classList.add(item.name === selectedName ? "selected" : "dimmed");
        }
        btn.dataset.row = String(rowNumber);
        btn.dataset.idx = String(idx);
        btn.dataset.name = item.name;

        if (item.icon) {
            const img = document.createElement("img");
            const styledIconPath = resolveIconPath(item.icon);
            img.src = styledIconPath;
            if (styledIconPath !== item.icon) {
                img.onerror = () => {
                    img.onerror = null;
                    img.src = item.icon;
                };
            }
            img.className = "h-btn-icon";
            btn.appendChild(img);
        }

        const label = document.createElement("div");
        label.className = "h-btn-text";
        label.innerText = item.name;
        btn.appendChild(label);

        container.appendChild(btn);
        fitButtonText(btn, label);

        if (onClick) {
            btn.addEventListener("click", () => onClick(item));
        }
    });
}

function showConfirm(sentence, displayMs = 3500) {
    if (confirmOverlay.classList.contains("active") && confirmText.textContent === sentence) {
        return;
    }

    confirmText.textContent = sentence;
    confirmOverlay.classList.add("active");
    flashScreen();

    if (window.confirmTimer) clearTimeout(window.confirmTimer);
    window.confirmTimer = setTimeout(() => {
        confirmOverlay.classList.remove("active");
        resolveConfirmOverlayHideWaiters();
    }, displayMs);
}

function checkPointerCollision() {
    const allBtns = document.querySelectorAll(".h-btn:not(.h-btn--empty)");
    let hoveredBtn = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let currentDistance = Number.POSITIVE_INFINITY;
    let currentHoveredBtn = null;

    allBtns.forEach(btn => {
        if (btn.classList.contains("h-btn--static")) return;
        const rect = btn.getBoundingClientRect();
        const inside = pointerX >= rect.left && pointerX <= rect.right && pointerY >= rect.top && pointerY <= rect.bottom;
        if (inside) {
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dx = pointerX - cx;
            const dy = pointerY - cy;
            const dist = dx * dx + dy * dy;
            if (dist < bestDistance) {
                bestDistance = dist;
                hoveredBtn = btn;
            }

            const btnKey = `${btn.dataset.row}|${btn.dataset.name}`;
            if (btnKey === lastHoveredButtonKey) {
                currentDistance = dist;
                currentHoveredBtn = btn;
            }
        }
    });

    if (hoveredBtn && currentHoveredBtn) {
        const hysteresisSq = HOVER_SWITCH_HYSTERESIS_PX * HOVER_SWITCH_HYSTERESIS_PX;
        if (currentDistance <= bestDistance + hysteresisSq) {
            hoveredBtn = currentHoveredBtn;
        }
    }

    // 上下移動で行間を通過中も、上段の選択対象とプレビューを保持する
    // （上端の正面取り直しボタンに乗っている間も同じ。滞留と口のクリックは updateDwellSelection / triggerClick で止める）
    if (!hoveredBtn && !isSimpleMode() && isVerticalMoveEnabled && symptomStage === SYMPTOM_STAGE_SYMPTOM) {
        hoveredBtn = findRow1ButtonByPointerX();
    }

    // シンプルモードはパネル間の隙間も最寄りパネル扱いにし、選択が途切れないようにする
    if (!hoveredBtn && isSimpleMode()) {
        hoveredBtn = findNearestSimplePanel();
    }

    // 付け外しを毎フレーム行うと CSS トランジションが始まり直して強調が見えないため、変化分だけ更新する
    allBtns.forEach(btn => {
        if (btn !== hoveredBtn && btn.classList.contains("hover")) btn.classList.remove("hover");
    });
    if (hoveredBtn) {
        if (!hoveredBtn.classList.contains("hover")) hoveredBtn.classList.add("hover");
        lastHoveredButtonKey = `${hoveredBtn.dataset.row}|${hoveredBtn.dataset.name}`;
    } else {
        lastHoveredButtonKey = "";
    }

    updateSymptomPreview(hoveredBtn);

    // ペンディングクリック中にターゲットから外れた場合はキャンセル
    if (pendingClickTimer && pendingClickTargetKey) {
        const currentKey = lastHoveredButtonKey;
        if (currentKey !== pendingClickTargetKey) {
            logClickDebug("click_canceled_pointer_leave", {
                currentKey,
                targetKey: pendingClickTargetKey
            });
            clearTimeout(pendingClickTimer);
            pendingClickTimer = null;
            pendingClickTargetKey = "";
            const animBtn = document.querySelector(".h-btn.clicked-anim");
            if (animBtn) animBtn.classList.remove("clicked-anim");
        }
    }
}

function updateSymptomPreview(hoveredBtn) {
    // 上位階層選択前（symptom段階）のみ、ホバー中の項目の次階層を下段にプレビュー表示する
    if (isSimpleMode() || symptomStage !== SYMPTOM_STAGE_SYMPTOM || !row2Container) return;

    const isRow1Hover = hoveredBtn && hoveredBtn.dataset.row === "1";
    const name = isRow1Hover ? hoveredBtn.dataset.name : null;

    if (name === previewSymptomName) return;
    previewSymptomName = name;

    const item = name ? symptomChoices.find((c) => c.name === name) : null;
    const options = item?.options || [];

    if (options.length === 0) {
        row2Container.innerHTML = "";
        row2Container.style.display = "none";
        row2Container.classList.remove("preview");
        return;
    }

    row2Container.classList.add("preview");
    row2Container.style.display = "";
    renderRow(row2Container, options, 2, null, { isStatic: true });
}

function renderAll() {
    if (isSimpleMode()) {
        renderSimpleMode();
        return;
    }
    if (simpleGridContainer) simpleGridContainer.innerHTML = "";
    if (simpleBarContainer) simpleBarContainer.innerHTML = "";

    if (appRoot) {
        appRoot.dataset.mode = "symptom";
        appRoot.dataset.symptomStage = symptomStage;
        appRoot.dataset.questionMode = "0";
    }

    const promptText = symptomStage === SYMPTOM_STAGE_SYMPTOM
        ? "項目を選んでください"
        : `${selectedSymptom?.name || "項目"}を選んでください`;

    if (modePrompt) {
        modePrompt.textContent = promptText;
    }

    if (confirmZone) {
        confirmZone.style.display = "none";
    }
    if (confirmZonePreview) {
        confirmZonePreview.textContent = "";
    }

    previewSymptomName = null;

    // シンプル・お話・質問の画面では3段とも隠しているので、症状モードに戻ったら大分類の段を出し直す
    if (row1Container) row1Container.style.display = "";

    if (symptomStage === SYMPTOM_STAGE_SYMPTOM) {
        renderRow(row1Container, symptomChoices, 1, handleSymptomClick);
        if (row2Container) {
            row2Container.innerHTML = "";
            row2Container.style.display = "none";
            row2Container.classList.remove("preview");
        }
    } else {
        // 上位階層は縮小したパンくずとして上部に表示し続ける
        renderRow(row1Container, symptomChoices, 1, null, { isStatic: true, selectedName: selectedSymptom?.name });
        if (row2Container) {
            row2Container.classList.remove("preview");
            row2Container.style.display = "";
            renderRow(row2Container, selectedSymptom?.options || [], 2, handleSymptomClick);
        }
    }

    if (row3Container) {
        row3Container.innerHTML = "";
        row3Container.style.display = "none";
    }
}

// =========================================================
// Simple mode (パネルを選ぶと即発話。滞留またはジェスチャーで確定)
// =========================================================
const SIMPLE_CONFIG_KEY = "simple_panel_config_v1";
const SIMPLE_CUSTOM_PANELS_KEY = "simple_custom_panels_v1";
const SIMPLE_GRID_SIZES = {
    // 3×1: 寝た姿勢などで縦に動かしにくい人向け（横1列）
    "3x1": { cols: 3, rows: 1 },
    "2x2": { cols: 2, rows: 2 },
    "3x2": { cols: 3, rows: 2 },
    "3x3": { cols: 3, rows: 3 },
    "4x3": { cols: 4, rows: 3 },
    "4x4": { cols: 4, rows: 4 }
};
const SIMPLE_GRID_SIZE_DEFAULT = "3x2";
const SIMPLE_CTRL_PREV = "ctrl-prev";
const SIMPLE_CTRL_NEXT = "ctrl-next";
const SIMPLE_CTRL_REST = "ctrl-rest";
const SIMPLE_CTRL_CANCEL = "ctrl-cancel";
const SIMPLE_CTRL_BACKSPACE = "ctrl-backspace";
const SIMPLE_CTRL_CLEAR = "ctrl-clear";
// 文をつなげる: ためられるパネルの上限（長すぎると聞き取りにくい）
// パネルごとの滞留時間の選択肢(ms)
const PANEL_DWELL_CHOICES = [800, 1000, 1500, 2000, 3000, 5000];
// 休憩中に再開するときは誤操作を避けるため長めに滞留させる
const SIMPLE_RESUME_DWELL_RATIO = 2;
const SIMPLE_RESUME_DWELL_MIN_MS = 2000;
const CUSTOM_IMAGE_MAX_PX = 256;

// 既存の症状モード16フレーズに加えて選べるプリセット
// 想定利用者: 40代女性・未婚、両親と姉・兄が1人ずつ。気管切開・胃ろう・カテーテル装着で入院/療養中
// group は設定画面の一覧で分類表示に使う
const SIMPLE_EXTRA_PRESETS = [
    // 返事（はい/いいえで答えられる質問への即答）
    { id: "p-yes", group: "返事", name: "はい", emoji: "⭕", sentence: "はい。" },
    { id: "p-no", group: "返事", name: "いいえ", emoji: "❌", sentence: "いいえ。" },
    { id: "p-not-that", group: "返事", name: "そうじゃない", emoji: "🙅‍♀️", sentence: "そうじゃないです。" },
    { id: "p-wait", group: "返事", name: "ちょっと待って", emoji: "✋", sentence: "ちょっと待ってください。" },
    { id: "p-dont-know", group: "返事", name: "わからない", emoji: "❓", sentence: "わからないです。" },
    { id: "p-again", group: "返事", name: "もう一度言って", emoji: "🔁", sentence: "もう一度言ってください。" },
    // 家族（両親・姉・兄）
    { id: "p-mother", group: "家族", name: "お母さん", emoji: "👩", sentence: "お母さんに会いたいです。" },
    { id: "p-father", group: "家族", name: "お父さん", emoji: "👨", sentence: "お父さんに会いたいです。" },
    { id: "p-sister", group: "家族", name: "お姉ちゃん", emoji: "👱‍♀️", sentence: "お姉ちゃんに会いたいです。" },
    { id: "p-brother", group: "家族", name: "お兄ちゃん", emoji: "🧑", sentence: "お兄ちゃんに会いたいです。" },
    { id: "p-call-family", group: "家族", name: "家族に電話", emoji: "📞", sentence: "家族に電話してください。" },
    { id: "p-family-ok", group: "家族", name: "家族は元気？", emoji: "🏠", sentence: "家族はみんな元気ですか？" },
    { id: "p-tell-thanks", group: "家族", name: "ありがとうと伝えて", emoji: "💐", sentence: "家族にありがとうと伝えてください。" },
    // 体調
    { id: "p-head-pain", group: "体調", name: "頭が痛い", icon: "media/body-head.png", sentence: "頭が痛いです。" },
    { id: "p-body-pain", group: "体調", name: "体が痛い", icon: "media/body-body.png", sentence: "体が痛いです。" },
    { id: "p-hand-pain", group: "体調", name: "手が痛い", icon: "media/body-hand.png", sentence: "手が痛いです。" },
    { id: "p-leg-pain", group: "体調", name: "足が痛い", icon: "media/body-leg.png", sentence: "足が痛いです。" },
    { id: "p-cold", group: "体調", name: "寒い", icon: "media/symptom-cold.png", sentence: "寒いです。" },
    { id: "p-hot", group: "体調", name: "暑い", icon: "media/symptom-hot.png", sentence: "暑いです。" },
    { id: "p-feel-bad", group: "体調", name: "気分が悪い", icon: "media/symptom-feel.png", sentence: "気分が悪いです。" },
    { id: "p-breath", group: "体調", name: "息が苦しい", emoji: "😮‍💨", sentence: "息が苦しいです。" },
    { id: "p-dry-mouth", group: "体調", name: "口が乾く", emoji: "💧", sentence: "口が乾いています。しめらせてください。" },
    { id: "p-period", group: "体調", name: "生理かも", emoji: "🩸", sentence: "生理が来たかもしれません。" },
    { id: "p-cant-sleep", group: "体調", name: "眠れない", emoji: "😣", sentence: "眠れません。" },
    // ケア・身だしなみ
    { id: "p-call", group: "ケア", name: "看護師さん呼んで", emoji: "🔔", sentence: "看護師さんを呼んでください。" },
    { id: "p-female-staff", group: "ケア", name: "女性の方に", emoji: "👩‍⚕️", sentence: "女性の方にお願いしたいです。" },
    { id: "p-curtain", group: "ケア", name: "カーテン閉めて", emoji: "🙈", sentence: "カーテンを閉めてください。" },
    { id: "p-hair", group: "ケア", name: "髪をとかして", emoji: "💇‍♀️", sentence: "髪をとかしてください。" },
    { id: "p-face", group: "ケア", name: "顔をふいて", emoji: "🧼", sentence: "顔をふいてください。" },
    { id: "p-cream", group: "ケア", name: "クリームぬって", emoji: "🧴", sentence: "クリームをぬってください。" },
    { id: "p-nails", group: "ケア", name: "爪を切って", emoji: "💅", sentence: "爪を切ってください。" },
    { id: "p-mirror", group: "ケア", name: "鏡を見たい", emoji: "🤳", sentence: "鏡を見たいです。" },
    // 過ごし方
    { id: "p-phone", group: "過ごし方", name: "スマホ見たい", emoji: "📱", sentence: "スマホを見たいです。" },
    { id: "p-video", group: "過ごし方", name: "動画が見たい", emoji: "📺", sentence: "動画を見たいです。" },
    { id: "p-news", group: "過ごし方", name: "今日のこと", emoji: "🗞️", sentence: "今日の出来事を教えてください。" },
    { id: "p-weather", group: "過ごし方", name: "外の様子", emoji: "🌤️", sentence: "外の様子を教えてください。" },
    { id: "p-time", group: "過ごし方", name: "いま何時？", emoji: "🕐", sentence: "いま何時ですか？" },
    { id: "p-light", group: "過ごし方", name: "電気つけて", emoji: "💡", sentence: "電気をつけてください。" },
    { id: "p-dark", group: "過ごし方", name: "暗くして", emoji: "🌙", sentence: "暗くしてください。" },
    { id: "p-alone", group: "過ごし方", name: "一人にして", emoji: "🚶‍♀️", sentence: "少し一人にしてください。" },
    // 気持ち（気持ち＋してほしいことをセットで伝える）
    { id: "p-anxious", group: "気持ち", name: "不安", emoji: "😟", sentence: "不安なので、そばにいてください。" },
    { id: "p-stay", group: "気持ち", name: "そばにいて", emoji: "🤝", sentence: "そばにいてください。" },
    { id: "p-hold-hand", group: "気持ち", name: "手をにぎって", emoji: "🤲", sentence: "手をにぎってください。" },
    { id: "p-happy", group: "気持ち", name: "うれしい", emoji: "😊", sentence: "うれしいです。" },
    { id: "p-sleepy", group: "気持ち", name: "ねむい", emoji: "😴", sentence: "ねむいです。" },
    // あいさつ
    { id: "p-good-morning", group: "あいさつ", name: "おはよう", emoji: "🌅", sentence: "おはようございます。" },
    { id: "p-good-night", group: "あいさつ", name: "おやすみ", emoji: "🛌", sentence: "おやすみなさい。" },
    { id: "p-see-you", group: "あいさつ", name: "また来てね", emoji: "👋", sentence: "また来てくださいね。" }
];

function loadSimpleCustomPanels() {
    try {
        const parsed = JSON.parse(localStorage.getItem(SIMPLE_CUSTOM_PANELS_KEY) || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(p => p && typeof p.id === "string" && typeof p.name === "string" && p.name.trim());
    } catch {
        return [];
    }
}

function getSimpleBasePanels() {
    return symptomChoices.flatMap((category, ci) => (category.options || []).map((option, oi) => ({
        id: `base-${ci}-${oi}`,
        name: option.name,
        icon: option.icon,
        sentence: option.sentence
    })));
}

function getSimpleCatalog(customPanels = simpleCustomPanels) {
    return [...getSimpleBasePanels(), ...SIMPLE_EXTRA_PRESETS, ...customPanels.map(p => ({ ...p, custom: true }))];
}

function defaultSimpleConfig() {
    return {
        gridSize: SIMPLE_GRID_SIZE_DEFAULT,
        panelIds: getSimpleBasePanels().map(p => p.id),
        showRest: true,
        confirmSound: true,
        dwellOverrides: {}
    };
}

function sanitizeDwellOverrides(raw) {
    const result = {};
    if (!raw || typeof raw !== "object") return result;
    Object.entries(raw).forEach(([id, ms]) => {
        const value = Number(ms);
        if (Number.isFinite(value) && value > 0) result[id] = clamp(value, 300, DWELL_TIME_MAX_MS);
    });
    return result;
}

function loadSimpleConfig() {
    const fallback = defaultSimpleConfig();
    try {
        const parsed = JSON.parse(localStorage.getItem(SIMPLE_CONFIG_KEY) || "null");
        if (!parsed || typeof parsed !== "object") return fallback;
        return {
            gridSize: SIMPLE_GRID_SIZES[parsed.gridSize] ? parsed.gridSize : fallback.gridSize,
            panelIds: Array.isArray(parsed.panelIds) ? parsed.panelIds.filter(id => typeof id === "string") : fallback.panelIds,
            showRest: parsed.showRest !== false,
            confirmSound: parsed.confirmSound !== false,
            dwellOverrides: sanitizeDwellOverrides(parsed.dwellOverrides)
        };
    } catch {
        return fallback;
    }
}

let simpleCustomPanels = loadSimpleCustomPanels();
let simpleConfig = loadSimpleConfig();
let simplePage = 0;
let isSimplePaused = false;
let activeQuestionStartedAt = 0;
let pageBeforeQuestion = 0;

function getSimpleRowKey(id) {
    return `${SIMPLE_ROW_ID}|${id}`;
}

function getEnabledSimplePanels() {
    const byId = new Map(getSimpleCatalog().map(p => [p.id, p]));
    return simpleConfig.panelIds.map(id => byId.get(id)).filter(Boolean);
}

function buildSimpleSentence(item) {
    if (item.sentence && item.sentence.trim()) return item.sentence.trim();
    return `${item.name}。`;
}

// 絵のない項目と、標準の画風でピクトグラムになる項目は、Gemini で作ったアイコン（scripts/gen_icon_sheets.mjs）があればそれを使う。
// ほかの画風には専用の素材があるので、icon のある項目はそちらを優先する
function getGeneratedIcon(id, icon = "") {
    if (icon && iconStyle !== ICON_STYLE_DEFAULT) return "";
    return id && Object.hasOwn(GENERATED_ICONS, id) ? GENERATED_ICONS[id] : "";
}

function createSimpleButton(id, label, options = {}) {
    const { icon = "", emoji = "", className = "", onClick = null } = options;
    const image = options.image || getGeneratedIcon(id, icon);
    const btn = document.createElement("div");
    btn.className = `h-btn ${className}`.trim();
    btn.dataset.row = SIMPLE_ROW_ID;
    btn.dataset.name = id;

    if (image || icon) {
        const img = document.createElement("img");
        img.className = "h-btn-icon";
        if (image) {
            img.src = image;
        } else {
            const styledIconPath = resolveIconPath(icon);
            img.src = styledIconPath;
            if (styledIconPath !== icon) {
                img.onerror = () => {
                    img.onerror = null;
                    img.src = icon;
                };
            }
        }
        btn.appendChild(img);
    } else if (emoji) {
        const emojiEl = document.createElement("div");
        emojiEl.className = "h-btn-emoji";
        emojiEl.textContent = emoji;
        btn.appendChild(emojiEl);
    }

    const text = document.createElement("div");
    text.className = "h-btn-text";
    text.innerText = label;
    btn.appendChild(text);

    if (onClick) btn.addEventListener("click", onClick);
    return btn;
}

// =========================================================
// お話モード
// 事前に用意した会話の木（talk-data.js）を「話題 → 内容 → …」と最大4段たどって1文を選ぶ。
// どの段でも「これで話す」で確定でき、続きのない言葉まで進んだらそのまま話す。
// 相手（来ている人）を選んでおくと、文頭の「{呼}、」に呼び名が入り、その人向けの話題も出る。
// 「相づち」は相手の話に1回で反応する短い言葉、「よく話す」は話した文の履歴。
// =========================================================
const TALK_CONFIG_KEY = "talk_config_v1";
const TALK_CUSTOM_KEY = "talk_custom_v1";
const TALK_HISTORY_KEY = "talk_history_v1";
const TALK_TAB_PREFIX = "ctrl-tab-";
const TALK_TAB_TREE = "tree";
const TALK_TAB_AIZUCHI = "aizuchi";
const TALK_TAB_FAVORITE = "favorite";
const TALK_TAB_PARTNER = "partner";
const TALK_SAY_ID = "talk-say";
const TALK_CUSTOM_TOPIC_ID = "custom";
const TALK_FAVORITE_LIMIT = 12;
const TALK_HISTORY_SENTENCE_LIMIT = 40;
const TALK_CALL_PLACEHOLDER = /^\{呼\}、/;

const DEFAULT_TALK_PARTNERS = [
    { id: "father", name: "お父さん", emoji: "👨" },
    { id: "mother", name: "お母さん", emoji: "👩" },
    { id: "sister", name: "お姉ちゃん", emoji: "👱‍♀️" },
    { id: "brother", name: "お兄ちゃん", emoji: "🧑" },
    { id: "nurse", name: "看護師さん", emoji: "👩‍⚕️" }
];
const TALK_PARTNER_NONE = { id: "", name: "決めない", emoji: "👥" };

// 会話パターン: 初期データ（talk-data.js）と、インタビューから AI で作ったもの。作ったものは消すまで残す
const TALK_SETS_KEY = "talk_sets_v1";
const TALK_ACTIVE_SET_KEY = "talk_active_set";
const TALK_PROFILE_KEY = "talk_profile_v1";
const TALK_AI_MODEL_KEY = "talk_ai_model";
const DEFAULT_TALK_SET = { id: "default", name: "標準（初期データ）", builtin: true, partners: DEFAULT_TALK_PARTNERS, tree: TALK_TREE };

function loadTalkSets() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TALK_SETS_KEY) || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(set => set && typeof set.id === "string" && typeof set.name === "string"
            && Array.isArray(set.tree) && Array.isArray(set.partners));
    } catch {
        return [];
    }
}

function loadTalkProfile() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TALK_PROFILE_KEY) || "null");
        const age = Number.parseInt(parsed?.age, 10);
        return {
            gender: ["female", "male", "other"].includes(parsed?.gender) ? parsed.gender : "",
            age: Number.isFinite(age) && age > 0 ? age : null
        };
    } catch {
        return { gender: "", age: null };
    }
}

let talkSets = loadTalkSets();
let talkActiveSetId = localStorage.getItem(TALK_ACTIVE_SET_KEY) || DEFAULT_TALK_SET.id;
let talkProfile = loadTalkProfile();

// talk studio で作って登録したパターンは、標準と同じく組み込み（名前変更・削除なし、どの端末でも使える）
const PUBLISHED_SETS = PUBLISHED_TALK_SETS.map(set => ({ ...set, builtin: true }));

function getTalkSets() {
    return [DEFAULT_TALK_SET, ...PUBLISHED_SETS, ...talkSets];
}

function getActiveTalkSet() {
    return getTalkSets().find(set => set.id === talkActiveSetId) || DEFAULT_TALK_SET;
}

function getTalkPartners() {
    return [...getActiveTalkSet().partners, TALK_PARTNER_NONE];
}

function saveTalkSets(nextSets) {
    try {
        localStorage.setItem(TALK_SETS_KEY, JSON.stringify(nextSets));
    } catch (error) {
        console.error("talk sets save failed:", error);
        alert("会話パターンを保存できませんでした（保存容量の不足）。使わないパターンを削除してください。");
        return false;
    }
    talkSets = nextSets;
    return true;
}

const TALK_AIZUCHI = [
    { id: "a-uun", name: "うんうん", emoji: "😌", sentence: "うんうん。" },
    { id: "a-hee", name: "へえ！", emoji: "😮", sentence: "へえ！" },
    { id: "a-sorede", name: "それで？", emoji: "👂", sentence: "それで？" },
    { id: "a-wakaru", name: "わかる！", emoji: "🙆‍♀️", sentence: "わかる！" },
    { id: "a-ee", name: "えー！", emoji: "😲", sentence: "えー！" },
    { id: "a-laugh", name: "あはは", emoji: "😆", sentence: "あはは！" },
    { id: "a-sugoi", name: "すごい！", emoji: "👏", sentence: "すごい！" },
    { id: "a-honto", name: "ほんとに？", emoji: "🤔", sentence: "ほんとに？" },
    { id: "a-naruhodo", name: "なるほど", emoji: "💡", sentence: "なるほどね。" },
    { id: "a-iine", name: "いいね！", emoji: "👍", sentence: "いいね！" },
    { id: "a-yokatta", name: "よかったね", emoji: "😊", sentence: "よかったね。" },
    { id: "a-taihen", name: "大変だったね", emoji: "🥲", sentence: "大変だったね。" },
    { id: "a-motto", name: "もっと聞かせて", emoji: "✨", sentence: "もっと聞かせて。" },
    { id: "a-matte", name: "ちょっと待って", emoji: "✋", sentence: "ちょっと待って。" },
    { id: "a-again", name: "もう一回", emoji: "🔁", sentence: "もう一回言って。" },
    { id: "a-wakaranai", name: "わからない", emoji: "❓", sentence: "ちょっとわからない。" }
];

function loadTalkConfig() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TALK_CONFIG_KEY) || "null");
        return {
            hiddenIds: Array.isArray(parsed?.hiddenIds) ? parsed.hiddenIds.filter(id => typeof id === "string") : [],
            learn: parsed?.learn !== false
        };
    } catch {
        return { hiddenIds: [], learn: true };
    }
}

// 介助者が追加した文。「自分の言葉」の話題に並ぶ
function loadTalkCustom() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TALK_CUSTOM_KEY) || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(n => n && typeof n.id === "string" && typeof n.label === "string" && typeof n.say === "string");
    } catch {
        return [];
    }
}

function loadTalkHistory() {
    try {
        const parsed = JSON.parse(localStorage.getItem(TALK_HISTORY_KEY) || "null");
        return { sentences: parsed?.sentences && typeof parsed.sentences === "object" ? parsed.sentences : {} };
    } catch {
        return { sentences: {} };
    }
}

let talkConfig = loadTalkConfig();
let talkCustom = loadTalkCustom();
let talkHistory = loadTalkHistory();
let talkTab = TALK_TAB_TREE;
let talkPath = [];          // たどった木のノード（話題 → 内容 → …）
let talkPartnerId = "";     // 来ている人。呼び名と話題の絞り込みに使う
let talkFavoriteOrder = null; // 「よく話す」タブを開いている間の並び

function getTalkTree(custom = talkCustom) {
    const tree = getActiveTalkSet().tree;
    if (custom.length === 0) return tree;
    return [...tree, { id: TALK_CUSTOM_TOPIC_ID, label: "自分の言葉", emoji: "✏️", children: custom }];
}

function getTalkPartner() {
    return getTalkPartners().find(p => p.id && p.id === talkPartnerId) || null;
}

function getTalkTimeOfDay(date = new Date()) {
    const hour = date.getHours();
    if (hour >= 4 && hour < 11) return "morning";
    if (hour >= 11 && hour < 17) return "day";
    return "evening";
}

// 非表示にした言葉・相手や時間帯に合わない言葉は出さない
function isTalkNodeVisible(node) {
    if (talkConfig.hiddenIds.includes(node.id)) return false;
    if (Array.isArray(node.for) && talkPartnerId && !node.for.includes(talkPartnerId)) return false;
    if (node.time && node.time !== getTalkTimeOfDay()) return false;
    return true;
}

function getTalkChildren(node) {
    const children = node ? (node.children || []) : getTalkTree();
    return children.filter(isTalkNodeVisible);
}

// 文頭の「{呼}、」を相手の呼び名にする（相手を決めていなければ省く）
function resolveTalkSentence(say, partner = getTalkPartner()) {
    return say.replace(TALK_CALL_PLACEHOLDER, partner ? `${partner.name}、` : "").replaceAll("{呼}", partner ? partner.name : "");
}

function getTalkCurrentNode() {
    return talkPath[talkPath.length - 1] || null;
}

function getTalkCurrentSentence() {
    const node = getTalkCurrentNode();
    return node?.say ? resolveTalkSentence(node.say) : "";
}

// 文ごとに変わらないid（並び順が変わっても、ポインタの下のパネルが別の文にすり替わらない）
function getTalkSentenceId(sentence) {
    let hash = 0;
    for (const ch of sentence) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    return `talk-fav-${hash.toString(36)}`;
}

// 履歴は「{呼}、」を残した形で覚え、出すときに今の相手の呼び名を入れる
function getFavoriteTalkTemplates() {
    return Object.entries(talkHistory.sentences)
        .sort((a, b) => (b[1].count - a[1].count) || (b[1].at - a[1].at))
        .slice(0, TALK_FAVORITE_LIMIT)
        .map(([template]) => template);
}

function getFavoriteTalkSentences() {
    // タブを開いている間は並びを固定する（話すたびに入れ替わると選び直しになる）
    const templates = talkFavoriteOrder || getFavoriteTalkTemplates();
    return templates.map((template) => {
        const sentence = resolveTalkSentence(template);
        return { id: getTalkSentenceId(template), type: "phrase", name: sentence, template };
    });
}

function getTalkPanels() {
    if (talkTab === TALK_TAB_AIZUCHI) return TALK_AIZUCHI.map(item => ({ ...item, type: "aizuchi" }));
    if (talkTab === TALK_TAB_FAVORITE) return getFavoriteTalkSentences();
    if (talkTab === TALK_TAB_PARTNER) {
        // 相手のアイコンはパターンごと（同じ id でも別の人、たとえば妹のことがある）。標準だけ接頭辞なし
        // 「決めない」はどのセットでも同じ意味なので共通の id のまま
        const idPrefix = getActiveTalkSet().id === DEFAULT_TALK_SET.id ? "talk-partner" : `talk-partner-${getActiveTalkSet().id}`;
        return getTalkPartners().map(p => ({
            id: p.id ? `${idPrefix}-${p.id}` : "talk-partner-none",
            type: "partner",
            selected: p.id === talkPartnerId,
            name: p.name,
            emoji: p.emoji,
            partnerId: p.id
        }));
    }
    const node = getTalkCurrentNode();
    // 発話文がなく、続きも全部隠れた言葉は出さない（選んでも話せないため）
    const children = getTalkChildren(node).filter(child => child.say || getTalkChildren(child).length > 0);
    const panels = children.map(child => ({
        id: child.id,
        type: getTalkChildren(child).length > 0 ? "branch" : "leaf",
        name: child.label,
        emoji: child.emoji,
        node: child
    }));
    // 途中で確定できるよう、先頭（いつも同じ位置）に「これで話す」を置く
    if (node?.say) panels.unshift({ id: TALK_SAY_ID, type: "say", name: "🔊 これで話す" });
    return panels;
}

function getTalkTabs() {
    const partner = getTalkPartner();
    return [
        { key: TALK_TAB_TREE, label: "お話", icon: "💬" },
        { key: TALK_TAB_AIZUCHI, label: "相づち", icon: "😄" },
        { key: TALK_TAB_FAVORITE, label: "よく話す", icon: "⭐" },
        { key: TALK_TAB_PARTNER, label: partner ? partner.name : "相手", icon: partner ? partner.emoji : "👤" }
    ];
}

// 中身が入れ替わるので、ポインタの下に来た新しいパネルは長めの滞留で確定する。
// 確定したばかりのボタン（タブ・戻るなど）は dwellLockedKey のまま、外れるまで再選択しない。
// 話した直後と、動かさずに続けて確定したあとは、じっとしているだけで次々に選ばれないよう一度外れるまで滞留しない
function refreshTalkScreen({ fullLock = false } = {}) {
    simplePage = 0;
    resetDwellProgress();
    if (fullLock || isDwellConfirmingCarryover) {
        dwellLockedKey = DWELL_LOCK_FIRST_HOVER;
        dwellCarryoverKey = "";
    } else {
        dwellCarryoverKey = DWELL_LOCK_FIRST_HOVER;
    }
}

// お話タブ中にもう一度お話を選んだら最初の話題へ。相づちなどから戻ったときは、たどっていた場所を保つ
function goToTalkTab(tab) {
    if (tab === TALK_TAB_TREE && talkTab === TALK_TAB_TREE) {
        if (talkPath.length === 0 && simplePage === 0) return;
        talkPath = [];
    } else if (talkTab === tab && simplePage === 0) {
        return;
    }
    talkTab = tab;
    talkFavoriteOrder = tab === TALK_TAB_FAVORITE ? getFavoriteTalkTemplates() : null;
    refreshTalkScreen();
}

function recordTalkHistory(template) {
    if (!talkConfig.learn || !template) return;
    const entry = talkHistory.sentences[template] || { count: 0, at: 0 };
    talkHistory.sentences[template] = { count: entry.count + 1, at: Date.now() };
    // よく話す文は上位だけ残す
    const kept = Object.entries(talkHistory.sentences)
        .sort((a, b) => (b[1].count - a[1].count) || (b[1].at - a[1].at))
        .slice(0, TALK_HISTORY_SENTENCE_LIMIT);
    talkHistory.sentences = Object.fromEntries(kept);
    try {
        localStorage.setItem(TALK_HISTORY_KEY, JSON.stringify(talkHistory));
    } catch (error) {
        console.warn("talk history save failed:", error);
    }
}

function clearTalkHistory() {
    talkHistory = { sentences: {} };
    talkFavoriteOrder = null;
    localStorage.removeItem(TALK_HISTORY_KEY);
}

// 話したら、お話は最初の話題選びへ戻る（相づち・よく話すは続けて選べるようそのまま）
// template は「{呼}、」を含む元の文。相づちは「よく話す」を埋めてしまうので記録しない
function speakTalkSentence(template, { record = true } = {}) {
    const sentence = template ? resolveTalkSentence(template) : "";
    if (!sentence) return;
    if (record) recordTalkHistory(template);
    if (talkTab === TALK_TAB_TREE) {
        talkPath = [];
        refreshTalkScreen({ fullLock: true });
    }
    rerenderSimpleMode();
    void speakSimpleSentence(sentence);
}

function handleTalkPanel(item) {
    if (isConfirmInProgress || isSimplePaused) return;
    lockSimpleKeyAfterConfirm(getSimpleRowKey(item.id));

    if (item.type === "aizuchi") {
        speakTalkSentence(item.sentence, { record: false });
        return;
    }
    if (item.type === "phrase") {
        speakTalkSentence(item.template);
        return;
    }
    if (item.partnerId !== undefined) {
        talkPartnerId = item.partnerId;
        // 相手が変わると出る話題も変わるので、最初の話題選びから
        talkPath = [];
        talkTab = TALK_TAB_TREE;
        playConfirmSound();
        refreshTalkScreen();
        rerenderSimpleMode();
        return;
    }
    if (item.id === TALK_SAY_ID) {
        speakTalkSentence(getTalkCurrentNode()?.say);
        return;
    }
    // 続きのない言葉はそのまま話す。続きがあれば1段進む
    if (item.type === "leaf") {
        speakTalkSentence(item.node.say);
        return;
    }
    talkPath.push(item.node);
    playConfirmSound();
    refreshTalkScreen();
    rerenderSimpleMode();
}

// 表示するパネルとグリッド。質問中は回答数に合わせて大きく並べる（設定のグリッドより細かくはしない）
function getSimpleLayout() {
    const userSize = SIMPLE_GRID_SIZES[simpleConfig.gridSize] || SIMPLE_GRID_SIZES[SIMPLE_GRID_SIZE_DEFAULT];
    let panels;
    if (activeQuestion) {
        const { cols, rows } = getQuestionGridSize(activeQuestion.answers.length);
        return { cols, rows, panels: activeQuestion.answers };
    } else if (isQuestionMode()) {
        return { ...userSize, panels: [] };
    } else if (appMode === APP_MODE_TALK) {
        panels = getTalkPanels();
    } else {
        return { ...userSize, panels: getEnabledSimplePanels() };
    }

    const { cols, rows } = getAutoGridSize(panels.length, userSize);
    return { cols, rows, panels: repeatTalkSayPanel(panels, cols * rows) };
}

// 質問の回答パネルのグリッド。枚数に合わせて自動（質問タブの「1画面のパネルの数」まで。未設定ならシンプルモードと同じ）
function getQuestionGridSize(n, { gridSize = questionConfig.gridSize, simpleGridSize = simpleConfig.gridSize } = {}) {
    const max = SIMPLE_GRID_SIZES[gridSize] || SIMPLE_GRID_SIZES[simpleGridSize] || SIMPLE_GRID_SIZES[SIMPLE_GRID_SIZE_DEFAULT];
    return getAutoGridSize(n, max);
}

// 枚数に合わせたグリッド（少ないほど大きく並べる。設定のグリッドより細かくはしない）
function getAutoGridSize(n, userSize) {
    const auto = n <= 3 ? { cols: Math.max(1, n), rows: 1 }
        : n <= 4 ? { cols: 2, rows: 2 }
        : n <= 6 ? { cols: 3, rows: 2 }
        : n <= 9 ? { cols: 3, rows: 3 }
        : n <= 12 ? { cols: 4, rows: 3 }
        : { cols: 4, rows: 4 };
    // 入りきらなければ設定のグリッドのまま（3×1 で答え4つなら 2×1 ではなく 3×1 にしてページ送り）
    if (auto.cols <= userSize.cols && auto.rows <= userSize.rows) return auto;
    return { cols: userSize.cols, rows: userSize.rows };
}

// 「これで話す」は複数ページになっても各ページの先頭に置く（どのページからでも確定できる）
function repeatTalkSayPanel(panels, pageSize) {
    if (panels[0]?.id !== TALK_SAY_ID || panels.length <= pageSize || pageSize < 2) return panels;
    const [say, ...rest] = panels;
    const paged = [];
    for (let i = 0; i < rest.length; i += pageSize - 1) paged.push(say, ...rest.slice(i, i + pageSize - 1));
    return paged;
}

function renderSimpleMessage() {
    if (!simpleMessageContainer) return;
    simpleMessageContainer.innerHTML = "";
    simpleMessageContainer.classList.remove("is-question", "is-talk");

    if (activeQuestion) {
        simpleMessageContainer.classList.add("is-question");
        simpleMessageContainer.style.display = "";
        const text = document.createElement("div");
        text.className = "simple-message-question";
        text.textContent = `${getQuestionEmoji(activeQuestion)} ${activeQuestion.question}`;
        simpleMessageContainer.appendChild(text);
        // 質問モード: 直前の答えを右に出す（この質問への答えは強調、前の質問への答えは控えめに）
        const shown = isQuestionMode() ? getShownQuestionAnswer() : null;
        if (shown) {
            const answer = document.createElement("div");
            answer.className = "simple-message-answer" + (shown.isCurrent ? " is-current" : "");
            answer.textContent = `${shown.isCurrent ? "💬" : "前の答え:"} ${shown.sentence}`;
            simpleMessageContainer.appendChild(answer);
        }
        return;
    }

    if (!isTalkScreen()) {
        simpleMessageContainer.style.display = "none";
        return;
    }

    simpleMessageContainer.classList.add("is-talk");
    simpleMessageContainer.style.display = "";
    const partner = getTalkPartner();
    const chips = document.createElement("div");
    chips.className = "simple-message-chips";
    const addChip = (label, extraClass = "") => {
        const chip = document.createElement("span");
        chip.className = `simple-message-chip ${extraClass}`.trim();
        chip.textContent = label;
        chips.appendChild(chip);
    };
    if (partner) addChip(`${partner.emoji} ${partner.name}と`, "simple-message-chip--partner");
    const preview = document.createElement("div");
    preview.className = "simple-message-preview";
    if (talkTab === TALK_TAB_TREE) {
        talkPath.forEach(node => addChip(`${node.emoji || ""} ${node.label}`.trim()));
        const sentence = getTalkCurrentSentence();
        preview.textContent = sentence ? `🔊 ${sentence}`
            : talkPath.length === 0 ? "話したいことを選んでください（どの段でも「これで話す」で話せます）"
            : "続きを選んでください";
    } else {
        preview.textContent = {
            [TALK_TAB_AIZUCHI]: "相手の話に、ひとことで返します",
            [TALK_TAB_FAVORITE]: "よく話す文を、そのまま話します",
            [TALK_TAB_PARTNER]: "だれと話していますか？（呼びかけに名前が入ります）"
        }[talkTab] || "";
    }
    if (!/^🔊/.test(preview.textContent)) preview.classList.add("is-placeholder");
    const body = document.createElement("div");
    body.className = "simple-message-body";
    if (chips.childElementCount > 0) body.appendChild(chips);
    body.appendChild(preview);
    simpleMessageContainer.appendChild(body);
}

function renderTalkTabs() {
    if (!simpleTabsContainer) return;
    simpleTabsContainer.innerHTML = "";
    if (!isTalkScreen()) {
        simpleTabsContainer.style.display = "none";
        return;
    }
    simpleTabsContainer.style.display = "";
    getTalkTabs().forEach((tab) => {
        const control = `${TALK_TAB_PREFIX}${tab.key}`;
        const btn = createSimpleButton(control, `${tab.icon} ${tab.label}`, {
            className: `simple-ctrl simple-tab simple-tab--${tab.key}${tab.key === talkTab ? " active" : ""}`,
            onClick: () => handleSimpleControl(control)
        });
        simpleTabsContainer.appendChild(btn);
    });
}

function appendSimpleControl(control, label, extraClass = "", disabled = false, container = simpleBarContainer) {
    const btn = createSimpleButton(control, label, {
        className: `simple-ctrl ${extraClass}${disabled ? " is-disabled" : ""}`.trim(),
        onClick: () => handleSimpleControl(control)
    });
    container.appendChild(btn);
}

function renderSimpleMode() {
    if (appRoot) {
        appRoot.dataset.mode = APP_MODE_SIMPLE;
        appRoot.dataset.simplePaused = isSimplePaused ? "1" : "0";
        appRoot.dataset.question = activeQuestion ? "1" : "0";
        appRoot.dataset.talk = isTalkScreen() ? "1" : "0";
        // 質問モード: 上の質問ボタンを右上の ⛶ ⚙ ◎ と同じ高さにそろえる
        appRoot.dataset.questionMode = isQuestionMode() ? "1" : "0";
        delete appRoot.dataset.symptomStage;
    }
    if (modePrompt) modePrompt.textContent = "";
    if (confirmZone) confirmZone.style.display = "none";
    [row1Container, row2Container, row3Container].forEach((container) => {
        if (!container) return;
        container.innerHTML = "";
        container.style.display = "none";
    });
    previewSymptomName = null;

    if (!simpleGridContainer || !simpleBarContainer) return;

    renderQuestionModeBar();
    renderSimpleMessage();
    renderTalkTabs();

    const { cols, rows, panels } = getSimpleLayout();
    const pageSize = cols * rows;
    const pageCount = Math.max(1, Math.ceil(panels.length / pageSize));
    simplePage = clamp(simplePage, 0, pageCount - 1);

    simpleGridContainer.innerHTML = "";
    simpleGridContainer.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    simpleGridContainer.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    simpleGridContainer.dataset.cols = String(cols);

    const pagePanels = panels.slice(simplePage * pageSize, (simplePage + 1) * pageSize);
    pagePanels.forEach((item) => {
        simpleGridContainer.appendChild(createSimpleButton(item.id, item.name, {
            icon: item.icon,
            emoji: item.emoji,
            // 質問の答えは id が振り直されているので、元のパネル・元の答えの生成アイコンを引く
            image: item.image || (item.iconId ? getGeneratedIcon(item.iconId, item.icon) : ""),
            className: item.type ? `talk-panel talk-panel--${item.type}${item.selected ? " is-selected" : ""}` : "",
            onClick: () => (isTalkScreen() ? handleTalkPanel(item) : handleSimpleClick(item))
        }));
    });
    // 最終ページの空きは枠だけ置いて、パネルの大きさと位置をページ間で揃える
    for (let i = pagePanels.length; i < pageSize; i++) {
        const empty = document.createElement("div");
        empty.className = "h-btn h-btn--empty";
        simpleGridContainer.appendChild(empty);
    }

    simpleBarContainer.innerHTML = "";
    // 前へ・次へは、パネルの左端・右端に縦長で置く（下のバーは休憩・戻るなど）
    const sidePaging = pageCount > 1 && simpleSidePrev && simpleSideNext;
    [simpleSidePrev, simpleSideNext].forEach((el) => {
        if (!el) return;
        el.innerHTML = "";
        el.style.display = sidePaging ? "" : "none";
    });
    if (sidePaging) {
        // 休憩中はページも送らない（押しても滞留しても動かない。見た目も無効にする）
        appendSimpleControl(SIMPLE_CTRL_PREV, "◀\n前へ", "simple-ctrl--side", isSimplePaused, simpleSidePrev);
        appendSimpleControl(SIMPLE_CTRL_NEXT, "次へ\n▶", "simple-ctrl--side", isSimplePaused, simpleSideNext);
        const pageLabel = document.createElement("div");
        pageLabel.className = "simple-page-label simple-page-label--side";
        pageLabel.textContent = `${simplePage + 1}/${pageCount}`;
        simpleSideNext.insertBefore(pageLabel, simpleSideNext.firstChild);
    }
    if (activeQuestion && !isQuestionMode()) {
        appendSimpleControl(SIMPLE_CTRL_CANCEL, "✕ やめる", "simple-ctrl--cancel");
    } else {
        if (isTalkScreen() && talkTab === TALK_TAB_TREE) {
            const isTop = talkPath.length === 0;
            appendSimpleControl(SIMPLE_CTRL_BACKSPACE, "◀ 戻る", "", isTop);
            appendSimpleControl(SIMPLE_CTRL_CLEAR, "🏠 最初から", "", isTop);
        }
        // 質問モードは続けて答えるので休憩も出す（出す質問が無ければ出さない）
        if (simpleConfig.showRest && (!isQuestionMode() || activeQuestion)) {
            appendSimpleControl(SIMPLE_CTRL_REST, isSimplePaused ? "▶️ 再開" : "⏸️ 休憩", "simple-ctrl--rest");
        }
    }
    simpleBarContainer.style.display = simpleBarContainer.childElementCount > 0 ? "" : "none";

    if (panels.length === 0) {
        const notice = document.createElement("div");
        notice.className = "simple-empty-notice";
        notice.textContent = isQuestionMode() && !activeQuestion
            ? "出す質問がありません（設定 → 質問モードで選択）"
            : activeQuestion
            ? "答えがありません（設定 → 質問モード →「答えのパネル」で追加）"
            : isTalkScreen()
            ? (talkTab === TALK_TAB_FAVORITE ? "まだ話した文がありません（話すとここに出ます）" : "表示する言葉がありません（設定 → お話モードで選択）")
            : "表示するパネルがありません（設定 → シンプルモードで選択）";
        simpleGridContainer.appendChild(notice);
    }

    refitAllButtonText();
}

// パネル・ボタンを描画し直したあと、ホバー表示を付け直す
function rerenderSimpleMode() {
    renderSimpleMode();
    checkPointerCollision();
}

function lockSimpleKeyAfterConfirm(key) {
    // 口ジェスチャー・滞留のどちらで確定しても、外れるまで同じパネルは再選択しない
    dwellLockedKey = key;
    resetDwellProgress();
}

async function handleSimpleClick(item) {
    if (isConfirmInProgress || isSimplePaused) return;

    const sentence = buildSimpleSentence(item);
    if (!sentence) return;

    lockSimpleKeyAfterConfirm(getSimpleRowKey(item.id));

    const answeredQuestionId = activeQuestion?.id ?? null;
    // 質問モード: 質問文の横に答えを出す（上のボタンは変えない）
    if (isQuestionMode() && activeQuestion) {
        recordQuestionAnswer(item);
        renderSimpleMessage();
    }
    await speakSimpleSentence(sentence);
    // 質問モードは答えても同じ質問のまま（次の質問は介助者が上のボタンで選ぶ）
    if (isQuestionMode()) return;
    // 発話中に別の質問へ切り替わっていたら、そちらは閉じない
    if (answeredQuestionId && activeQuestion?.id === answeredQuestionId) endQuestion();
}

async function speakSimpleSentence(sentence) {
    playConfirmSound();
    // 長い文は読み終える前に表示が消えないよう、文字数に応じて表示を延ばす
    showConfirm(sentence, Math.max(SIMPLE_CONFIRM_DISPLAY_MS, sentence.length * 160));
    isConfirmInProgress = true;
    void speak(sentence);

    try {
        await waitForConfirmOverlayToHide();
    } finally {
        isConfirmInProgress = false;
    }
}

function isSimpleControlDisabled(control) {
    const needsPath = [SIMPLE_CTRL_BACKSPACE, SIMPLE_CTRL_CLEAR].includes(control);
    return needsPath && talkPath.length === 0;
}

function handleSimpleControl(control) {
    if (isConfirmInProgress) return;
    if (isSimplePaused && control !== SIMPLE_CTRL_REST) return;
    if (isSimpleControlDisabled(control)) return;

    lockSimpleKeyAfterConfirm(getSimpleRowKey(control));

    if (control === SIMPLE_CTRL_CANCEL) {
        playConfirmSound();
        endQuestion();
        return;
    }
    if (control.startsWith(TALK_TAB_PREFIX)) {
        goToTalkTab(control.slice(TALK_TAB_PREFIX.length));
    } else if (control === SIMPLE_CTRL_REST) {
        isSimplePaused = !isSimplePaused;
    } else if (control === SIMPLE_CTRL_BACKSPACE) {
        talkPath.pop();
        refreshTalkScreen();
    } else if (control === SIMPLE_CTRL_CLEAR) {
        talkPath = [];
        refreshTalkScreen();
    } else {
        const { cols, rows, panels } = getSimpleLayout();
        const pageCount = Math.max(1, Math.ceil(panels.length / (cols * rows)));
        // 端から押したら反対側へ回り込む
        const step = control === SIMPLE_CTRL_NEXT ? 1 : -1;
        simplePage = (simplePage + step + pageCount) % pageCount;
    }

    playConfirmSound();
    rerenderSimpleMode();
}

let confirmSoundContext = null;

function playConfirmSound() {
    if (!simpleConfig.confirmSound) return;
    playChime();
}

function playChime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!confirmSoundContext) confirmSoundContext = new AudioCtx();
        const ctx = confirmSoundContext;
        if (ctx.state === "suspended") void ctx.resume();

        // 短い2音の「ピポッ」
        const start = ctx.currentTime;
        [[880, 0], [1320, 0.09]].forEach(([freq, offset]) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, start + offset);
            gain.gain.exponentialRampToValueAtTime(0.25, start + offset + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.12);
            osc.connect(gain).connect(ctx.destination);
            osc.start(start + offset);
            osc.stop(start + offset + 0.13);
        });
    } catch (error) {
        console.warn("confirm sound failed:", error);
    }
}

function resetDwellProgress() {
    if (dwellTargetKey) {
        const btn = document.querySelector(".h-btn.dwelling");
        if (btn) btn.classList.remove("dwelling");
    }
    dwellTargetKey = "";
    dwellStartAt = 0;
    dwellLeftAt = 0;
    if (dwellIndicator) {
        dwellIndicator.classList.remove("active");
        dwellIndicator.style.setProperty("--dwell-progress", "0");
    }
}

function updateDwellSelection(hasFace) {
    if (!isSimpleMode() || dwellTimeMs <= 0 || !hasFace || isCalibrating
        || calibrationWizard.isActive() || isConfirmInProgress || pendingClickTimer) {
        resetDwellProgress();
        return;
    }

    const now = performance.now();
    const restKey = getSimpleRowKey(SIMPLE_CTRL_REST);
    let hoveredKey = lastHoveredButtonKey;
    // 休憩中は再開パネル以外では滞留しない
    if (isSimplePaused && hoveredKey !== restKey) hoveredKey = "";
    // 押しても何も起きないボタン（ためた文が空の「話す」など）では滞留しない
    if (hoveredKey && document.querySelector(".h-btn.hover.is-disabled")) hoveredKey = "";

    if (dwellLockedKey === DWELL_LOCK_FIRST_HOVER && hoveredKey) dwellLockedKey = hoveredKey;
    if (dwellLockedKey && dwellLockedKey !== DWELL_LOCK_FIRST_HOVER && hoveredKey !== dwellLockedKey) {
        dwellLockedKey = "";
    }
    // 入れ替わり後に最初に判定したとき、ポインタの下にあったパネルだけを長めにする（外れたら通常に戻す）
    if (dwellCarryoverKey === DWELL_LOCK_FIRST_HOVER) dwellCarryoverKey = hoveredKey;
    if (dwellCarryoverKey && hoveredKey !== dwellCarryoverKey) dwellCarryoverKey = "";

    if (!hoveredKey || hoveredKey === dwellLockedKey) {
        // 境界のジッタで一瞬外れただけなら進捗を保持する
        if (dwellTargetKey && !hoveredKey && !isSimplePaused) {
            if (!dwellLeftAt) dwellLeftAt = now;
            if (now - dwellLeftAt < DWELL_LEAVE_GRACE_MS) return;
        }
        resetDwellProgress();
        return;
    }

    const movedFar = Math.hypot(pointerX - dwellAnchorX, pointerY - dwellAnchorY) > DWELL_MOVE_TOLERANCE_PX;
    if (hoveredKey !== dwellTargetKey || movedFar) {
        resetDwellProgress();
        dwellTargetKey = hoveredKey;
        dwellStartAt = now;
        dwellAnchorX = pointerX;
        dwellAnchorY = pointerY;
    }
    dwellLeftAt = 0;

    const targetBtn = document.querySelector(".h-btn.hover");
    if (!targetBtn) return;
    targetBtn.classList.add("dwelling");

    const baseMs = isSimplePaused
        ? Math.max(dwellTimeMs * SIMPLE_RESUME_DWELL_RATIO, SIMPLE_RESUME_DWELL_MIN_MS)
        : getPanelDwellMs(hoveredKey);
    const requiredMs = hoveredKey === dwellCarryoverKey ? baseMs * DWELL_CARRYOVER_RATIO : baseMs;
    const progress = clamp((now - dwellStartAt) / requiredMs, 0, 1);
    if (dwellIndicator) {
        dwellIndicator.style.setProperty("--dwell-x", `${pointerX}px`);
        dwellIndicator.style.setProperty("--dwell-y", `${pointerY}px`);
        dwellIndicator.style.setProperty("--dwell-progress", progress.toFixed(3));
        dwellIndicator.classList.toggle("active", progress >= DWELL_INDICATOR_SHOW_RATIO);
    }

    if (progress >= 1) {
        resetDwellProgress();
        dwellLockedKey = hoveredKey;
        lastConfirmedAt = Date.now();
        // 長めの滞留で確定したことを、クリック処理中の refreshTalkScreen に伝える
        isDwellConfirmingCarryover = hoveredKey === dwellCarryoverKey;
        try {
            targetBtn.click();
        } finally {
            isDwellConfirmingCarryover = false;
        }
    }
}

// パネルごとに設定した滞留時間（未設定なら全体の滞留時間）
function getPanelDwellMs(hoveredKey) {
    if (activeQuestion) return dwellTimeMs;
    const panelId = hoveredKey.slice(SIMPLE_ROW_ID.length + 1);
    const override = simpleConfig.dwellOverrides?.[panelId];
    return Number.isFinite(override) && override > 0 ? override : dwellTimeMs;
}

// 休憩中は口ジェスチャーでも再開パネル以外を確定しない
function isSimpleClickBlocked(targetKey) {
    return isSimpleMode() && isSimplePaused && targetKey !== getSimpleRowKey(SIMPLE_CTRL_REST);
}

// 正面の位置（絶対方式で○を向いて登録していれば○の位置）へ置く。絶対方式は次のフレームで正面の位置へ動くので、
// グリッド中央に置くと途中のパネルで滞留ロックが外れ、正面で休んでいるだけで確定してしまう
function centerPointerOnSimpleGrid() {
    const bounds = getSimplePanelPointerBounds();
    if (!bounds) return;
    const front = getSimpleFrontPoint(bounds);
    targetX = pointerX = front.x;
    targetY = pointerY = front.y;
}

function setAppMode(mode) {
    const nextMode = APP_MODES.includes(mode) ? mode : APP_MODE_SYMPTOM;
    if (nextMode === appMode) return;

    appMode = nextMode;
    localStorage.setItem(APP_MODE_KEY, appMode);
    resetDwellProgress();
    dwellLockedKey = DWELL_LOCK_FIRST_HOVER;
    isSimplePaused = false;
    simplePage = 0;
    talkTab = TALK_TAB_TREE;
    talkPath = [];
    talkFavoriteOrder = null;
    // 質問中に切り替えたら質問は終える（終了後に古いページへ戻らないようにする）
    activeQuestion = null;
    lastQuestionAnswer = null;
    pageBeforeQuestion = 0;
    resetSymptomModeState();
    if (isQuestionMode()) ensureQuestionModeQuestion({ speak: true });
    renderQuestionButtons();

    // グリッド中央へ乗せ直す
    if (isSimpleMode()) centerPointerOnSimpleGrid();
}

// =========================================================
// 質問への返事テンプレート
// 介助者が質問を選ぶと、回答パネルだけの画面に切り替わる。回答すると発話して元の画面へ戻る
// =========================================================
const QUESTION_CONFIG_KEY = "question_config_v1";
const QUESTION_CUSTOM_KEY = "question_custom_v1";
// 質問モードで最後に出していた質問
const QUESTION_MODE_LAST_KEY = "question_mode_last_id";
// 既定で出さない質問。保存済みの設定には、まだ知らない質問にだけ当てる（設定 → 質問でチェックすれば出せる）
// はい・いいえ は わかった？ と、ほかには？ は上の質問と重なるので出さない
// （重なっていた 体調は？・過ごし方は？・誰に会いたい？ は、体がつらい？・何がしたい？・家族のこと？ にまとめた）
const QUESTION_DEFAULT_HIDDEN_IDS = ["q-yes-no", "q-other"];
// knownIds を持たない古い設定が、すでに知っている質問（このあとに足した質問だけ既定の非表示を当てる）
const QUESTION_LEGACY_PRESET_IDS = ["q-yes-no", "q-pain-where", "q-pain-level", "q-itch-where", "q-feeling", "q-temperature", "q-position", "q-want", "q-who"];
// 答えを既存のパネルから出す質問の panelSource。それ以外はパネルのグループ名（基本・体調・ケア… 任意）
const QUESTION_PANEL_SOURCE_LAYOUT = "layout"; // シンプルモードの画面に並べたパネル
// お話モードの相づちも答えの候補にする（このグループ名で並ぶ）
const QUESTION_PANEL_GROUP_AIZUCHI = "相づち";
// 回答がないまま放置されたら元の画面へ戻す
const QUESTION_TIMEOUT_MS = 90000;

// 8つずつ2段。同じ答えは1つの質問にだけ置く（暑い・寒いは「暑い？寒い？」、吸引・体の向きはそれぞれの質問、もう一度は「わかった？」）
// 1段目は体のこと: 気分 → 体がつらい？（体の不調。痛い・かゆいは次の質問で詳しく）→ 痛み・かゆみ → 暑さ寒さ → 体の向き → 吸引
// 2段目は暮らしと会話: 暮らし（お世話 → 部屋 → したいこと → 知りたいこと）→ 会話と心（わかった？ → 相づち → 気持ち → 家族）
// 設定 → 質問で並べ替えられる
// emoji: 質問モードの上のボタン・設定の「今すぐ質問する」に出すアイコン
// panelSource: 答えを既存のパネルから出す（パネルのグループ名、または QUESTION_PANEL_SOURCE_LAYOUT）
// panelIds: 答えにする既存パネル（グループの一部だけ・グループをまたいで選ぶとき）
// answersFirst: 質問に書いた答えを既存パネルより前に並べる
// answers[].index: 答えを外したあとも元の並びの番号を保つ（生成アイコン・保存した答えの並びはこの番号で引く）
// silent: 切り替えても質問文を読み上げない
const QUESTION_PRESETS = [
    {
        id: "q-feeling", emoji: "😊", label: "気分は？", question: "気分はどうですか？",
        answers: [
            { name: "いい", emoji: "😊", sentence: "気分はいいです。" },
            { name: "ふつう", emoji: "😐", sentence: "ふつうです。" },
            { name: "悪い", emoji: "😣", sentence: "気分が悪いです。" },
            { name: "疲れた", emoji: "😩", sentence: "疲れました。" }
        ]
    },
    // 体の不調だけ（お世話・気分転換・会話は別の質問へ）。気分が悪いは「気分は？」に置く
    {
        id: "q-what", emoji: "🤒", label: "体がつらい？", question: "体でつらいところはありますか？",
        panelIds: ["base-0-1", "base-0-0", "p-breath", "base-0-2", "p-dry-mouth", "p-cant-sleep", "p-period"]
    },
    {
        id: "q-pain-where", emoji: "🤕", label: "どこが痛い？", question: "どこが痛いですか？",
        answers: [
            { name: "頭", icon: "media/body-head.png", sentence: "頭が痛いです。" },
            { name: "首", sentence: "首が痛いです。" },
            { name: "肩", sentence: "肩が痛いです。" },
            { name: "胸", sentence: "胸が痛いです。" },
            { name: "お腹", sentence: "お腹が痛いです。" },
            { name: "背中", sentence: "背中が痛いです。" },
            { name: "腰", sentence: "腰が痛いです。" },
            { name: "手・腕", icon: "media/body-hand.png", sentence: "手か腕が痛いです。" },
            { name: "足", icon: "media/body-leg.png", sentence: "足が痛いです。" },
            { name: "のど・気切", sentence: "のどか、気切のところが痛いです。" },
            { name: "おしり", sentence: "おしりが痛いです。" },
            { name: "わからない", emoji: "❓", sentence: "どこが痛いかわかりません。" }
        ]
    },
    {
        id: "q-pain-level", emoji: "😣", label: "痛さは？", question: "どのくらい痛いですか？",
        answers: [
            { name: "少し", emoji: "🙂", sentence: "少し痛いです。" },
            { name: "まあまあ", emoji: "😐", sentence: "まあまあ痛いです。" },
            { name: "とても", emoji: "😣", sentence: "とても痛いです。" },
            { name: "がまんできない", emoji: "😭", sentence: "がまんできないほど痛いです。" }
        ]
    },
    {
        id: "q-itch-where", emoji: "🖐️", label: "かゆい所は？", question: "どこがかゆいですか？",
        answers: [
            { name: "頭", icon: "media/body-head.png", sentence: "頭がかゆいです。" },
            { name: "顔", sentence: "顔がかゆいです。" },
            { name: "背中", sentence: "背中がかゆいです。" },
            { name: "お腹", sentence: "お腹がかゆいです。" },
            { name: "手・腕", icon: "media/body-hand.png", sentence: "手か腕がかゆいです。" },
            { name: "足", icon: "media/body-leg.png", sentence: "足がかゆいです。" },
            { name: "おしり", sentence: "おしりがかゆいです。" },
            { name: "わからない", emoji: "❓", sentence: "どこがかゆいかわかりません。" }
        ]
    },
    {
        id: "q-temperature", emoji: "🌡️", label: "暑い？寒い？", question: "暑いですか？寒いですか？",
        answers: [
            { name: "暑い", icon: "media/symptom-hot.png", sentence: "暑いです。" },
            { name: "寒い", icon: "media/symptom-cold.png", sentence: "寒いです。" },
            { name: "ちょうどいい", emoji: "👌", sentence: "ちょうどいいです。" }
        ]
    },
    {
        id: "q-position", emoji: "🛏️", label: "体の向きは？", question: "体の向きはどうしますか？",
        answers: [
            { name: "右向き", emoji: "➡️", sentence: "右向きにしてください。" },
            { name: "左向き", emoji: "⬅️", sentence: "左向きにしてください。" },
            { name: "上向き", emoji: "⬆️", sentence: "上向きにしてください。" },
            { name: "頭を上げて", emoji: "🔼", sentence: "ベッドの頭を上げてください。" },
            { name: "頭を下げて", emoji: "🔽", sentence: "ベッドの頭を下げてください。" },
            { name: "このまま", emoji: "👌", sentence: "このままでいいです。" }
        ]
    },
    // 気管切開のため吸引の確認は多い
    {
        id: "q-suction", emoji: "💨", label: "吸引は？", question: "吸引しますか？",
        answers: [
            { name: "してほしい", emoji: "🙆‍♀️", sentence: "吸引してください。" },
            { name: "すぐに", emoji: "🆘", sentence: "すぐに吸引してください。" },
            { name: "あとで", emoji: "⏱️", sentence: "あとでお願いします。" },
            { name: "今はいい", emoji: "👌", sentence: "今は大丈夫です。" }
        ]
    },
    // 体のお世話・身だしなみ（吸引・体の向きはそれぞれの質問、部屋のことは「部屋は？」に置く）
    {
        id: "q-care", emoji: "🧴", label: "お世話は？", question: "お世話してほしいことはありますか？",
        panelIds: ["p-call", "base-1-3", "base-1-2", "p-face", "p-hair", "p-cream", "p-nails", "p-female-staff"]
    },
    // 明るさ・カーテン・音（暑さ寒さは「暑い？寒い？」に置く）
    {
        id: "q-room", emoji: "💡", label: "部屋は？", question: "部屋のことで何かありますか？",
        panelIds: ["p-curtain", "p-light", "p-dark"],
        answers: [
            { name: "静かにして", emoji: "🤫", sentence: "静かにしてください。" }
        ]
    },
    // 楽しみと休むこと（体を起こすは「体の向きは？」の頭を上げて、教えてほしいことは「知りたい？」）
    {
        id: "q-want", emoji: "✨", label: "何がしたい？", question: "何がしたいですか？", answersFirst: true,
        answers: [
            { name: "寝たい", emoji: "😴", sentence: "寝たいです。" },
            { index: 2, name: "動画・テレビ", emoji: "📺", sentence: "動画かテレビを見たいです。" },
            { index: 3, name: "音楽", emoji: "🎵", sentence: "音楽を聴きたいです。" },
            { index: 4, name: "スマホ", emoji: "📱", sentence: "スマホを見たいです。" },
            { index: 5, name: "お話したい", emoji: "💬", sentence: "お話ししたいです。" }
        ],
        panelIds: ["base-2-1", "p-mirror", "base-3-3"]
    },
    // 教えてほしいこと
    {
        id: "q-know", emoji: "🗞️", label: "知りたい？", question: "何か知りたいことはありますか？",
        panelIds: ["p-time", "p-news", "p-weather"],
        answers: [
            { name: "今日の予定", emoji: "📅", sentence: "今日の予定を教えてください。" }
        ]
    },
    // 失語症のため、介助者の話が伝わったかを確かめる
    {
        id: "q-understand", emoji: "👂", label: "わかった？", question: "わかりましたか？",
        answers: [
            { name: "わかった", emoji: "🙆‍♀️", sentence: "わかりました。" },
            { name: "少しわかった", emoji: "🤏", sentence: "少しわかりました。" },
            { name: "わからない", emoji: "🙅‍♀️", sentence: "わかりません。" },
            { name: "もう一度", emoji: "🔁", sentence: "もう一度言ってください。" },
            { name: "ゆっくり", emoji: "🐢", sentence: "ゆっくり話してください。" },
            { name: "書いて", emoji: "✍️", sentence: "紙に書いてください。" }
        ]
    },
    // 介助者が話している間に使うので、切り替えても読み上げない（silent）。もう一回・わからないは「わかった？」に置く。
    // 続きを話して・話題を変えても、話している最中に使う
    {
        id: "q-aizuchi", emoji: "😄", label: "相づち", question: "お話に、ひとことで返します", silent: true,
        panelIds: ["a-uun", "a-hee", "a-sorede", "a-wakaru", "a-ee", "a-laugh", "a-sugoi", "a-honto",
            "a-naruhodo", "a-iine", "a-yokatta", "a-taihen", "a-motto", "a-matte", "base-3-1", "base-3-2"]
    },
    // 気持ちと、相手に伝えるあいさつ（ねむいは「何がしたい？」の寝たいと重なるので入れない）
    {
        id: "q-heart", emoji: "💗", label: "気持ちは？", question: "今の気持ちや、伝えたいことはありますか？",
        panelIds: ["p-happy", "base-3-0", "p-anxious", "p-stay", "p-hold-hand", "p-alone",
            "p-good-morning", "p-good-night", "p-see-you"]
    },
    { id: "q-family", emoji: "👨‍👩‍👧", label: "家族のこと？", question: "家族のことで何かありますか？", panelSource: "家族" },
    // ここから既定で出さない質問（QUESTION_DEFAULT_HIDDEN_IDS）
    {
        id: "q-yes-no", emoji: "⭕", label: "はい・いいえ", question: "はい・いいえで答えてください",
        answers: [
            { name: "はい", emoji: "⭕", sentence: "はい。" },
            { name: "いいえ", emoji: "❌", sentence: "いいえ。" },
            { name: "わからない", emoji: "❓", sentence: "わからないです。" }
        ]
    },
    // シンプルモードで作った任意パネル（"任意" は SIMPLE_GROUP_CUSTOM）。ほかの表現はすべて上の質問にある
    { id: "q-other", emoji: "💬", label: "ほかには？", question: "ほかに何かありますか？", panelSource: "任意" }
];

function loadQuestionCustom() {
    try {
        const parsed = JSON.parse(localStorage.getItem(QUESTION_CUSTOM_KEY) || "[]");
        if (!Array.isArray(parsed)) return [];
        // 答えは文字で書いた answers と、既存パネルの panelIds のどちらか（両方でもよい）
        return parsed.filter(q => q && typeof q.id === "string" && typeof q.question === "string")
            .map(q => ({
                ...q,
                answers: Array.isArray(q.answers) ? q.answers : [],
                panelIds: Array.isArray(q.panelIds) ? q.panelIds.filter(id => typeof id === "string") : []
            }))
            .filter(q => q.answers.length + q.panelIds.length > 0);
    } catch {
        return [];
    }
}

// 質問 id → 答えの key の並び（答えを編集した質問だけ）
function sanitizeQuestionAnswerLayouts(raw) {
    const result = {};
    if (!raw || typeof raw !== "object") return result;
    Object.entries(raw).forEach(([id, keys]) => {
        if (Array.isArray(keys)) result[id] = keys.filter(key => typeof key === "string");
    });
    return result;
}

function loadQuestionConfig() {
    const presetIds = QUESTION_PRESETS.map(q => q.id);
    try {
        const parsed = JSON.parse(localStorage.getItem(QUESTION_CONFIG_KEY) || "null");
        const hiddenIds = Array.isArray(parsed?.hiddenIds) ? parsed.hiddenIds.filter(id => typeof id === "string") : [];
        const knownIds = Array.isArray(parsed?.knownIds) ? parsed.knownIds
            : parsed?.defaultHiddenApplied === true ? QUESTION_LEGACY_PRESET_IDS : [];
        QUESTION_DEFAULT_HIDDEN_IDS.forEach((id) => {
            if (!knownIds.includes(id) && !hiddenIds.includes(id)) hiddenIds.push(id);
        });
        return {
            hiddenIds,
            speakQuestion: parsed?.speakQuestion !== false,
            order: Array.isArray(parsed?.order) ? parsed.order.filter(id => typeof id === "string") : [],
            answerLayouts: sanitizeQuestionAnswerLayouts(parsed?.answerLayouts),
            // 回答パネルの数: 自動のときの最大（"" ならシンプルモードと同じ）。以前の質問ごとの固定（gridSizes）は使わない
            gridSize: SIMPLE_GRID_SIZES[parsed?.gridSize] ? parsed.gridSize : "",
            knownIds: presetIds
        };
    } catch {
        return { hiddenIds: [...QUESTION_DEFAULT_HIDDEN_IDS], speakQuestion: true, order: [], answerLayouts: {}, gridSize: "", knownIds: presetIds };
    }
}

let questionCustom = loadQuestionCustom();
let questionConfig = loadQuestionConfig();

// 並べ替えた順。order に無いプリセット（後から増えた質問）は、プリセットの並びで直前にある、出している質問の後ろに入る
// （出していない質問は並びの端に置かれていることがあるので目印にしない）。order に無い任意の質問は最後
function getQuestionCatalog(custom = questionCustom, order = questionConfig.order) {
    const catalog = [...QUESTION_PRESETS, ...custom.map(q => ({ ...q, custom: true }))];
    const rank = new Map(order.map((id, i) => [id, i]));
    const hidden = new Set(questionConfig?.hiddenIds || []);
    let previous = -1;
    QUESTION_PRESETS.forEach((q, i) => {
        if (!rank.has(q.id)) rank.set(q.id, previous + (i + 1) / 1000);
        else if (!hidden.has(q.id)) previous = rank.get(q.id);
    });
    return catalog
        .map((q, i) => ({ q, i, r: rank.has(q.id) ? rank.get(q.id) : order.length + i }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map(x => x.q);
}

function getQuestionLabel(q) {
    return q.label || q.question;
}

// 質問の答えに使えるパネル: シンプルモードのパネル ＋ お話モードの相づち
function getAnswerPanelCatalog(customPanels = simpleCustomPanels) {
    return [...getSimpleCatalog(customPanels), ...TALK_AIZUCHI.map(a => ({ ...a, group: QUESTION_PANEL_GROUP_AIZUCHI }))];
}

// 質問に書いた答えの番号（index があればそれ。答えを外したプリセットで番号をずらさない）
function getQuestionAnswerNumber(answer, i) {
    return Number.isInteger(answer?.index) ? answer.index : i;
}

// 質問の答えの候補。key は、既存パネルならパネルの id、質問に書いた答えなら「質問id#番号」。
// panelId は元のパネル（アイコンを引く）
function getQuestionAnswerCandidates(q, customPanels = simpleCustomPanels) {
    const map = new Map();
    (Array.isArray(q.answers) ? q.answers : []).forEach((answer, i) => {
        const n = getQuestionAnswerNumber(answer, i);
        const key = `${q.id}#${n}`;
        // 生成アイコンは元の並びの番号で作ってある（scripts/gen_icon_sheets.mjs）ので、並べ替えても元の番号で引く
        map.set(key, { ...answer, key, iconId: `${q.id}-a${n}` });
    });
    getAnswerPanelCatalog(customPanels).forEach(p => map.set(p.id, { ...p, key: p.id, panelId: p.id, iconId: p.id }));
    return map;
}

// 答えを編集していない質問の並び: 選んだパネル（panelIds）→ グループのパネル（panelSource）→ 質問に書いた答え（answersFirst なら答えが先）
// （選んだパネルを先にして、数が変わる任意パネルのグループは後ろに並べる）
function getDefaultQuestionAnswerKeys(q, { customPanels = simpleCustomPanels, layoutIds = simpleConfig.panelIds } = {}) {
    let keys = Array.isArray(q.panelIds) ? [...q.panelIds] : [];
    if (q.panelSource === QUESTION_PANEL_SOURCE_LAYOUT) {
        keys = keys.concat(layoutIds);
    } else if (q.panelSource) {
        keys = keys.concat(getAnswerPanelCatalog(customPanels).filter(p => getSimplePanelGroup(p) === q.panelSource).map(p => p.id));
    }
    const answerKeys = (Array.isArray(q.answers) ? q.answers : []).map((answer, i) => `${q.id}#${getQuestionAnswerNumber(answer, i)}`);
    return [...new Set(q.answersFirst ? [...answerKeys, ...keys] : [...keys, ...answerKeys])];
}

// 質問の答え（設定 → 質問 の「答えのパネル」で並べ替えた質問は、その並び）
function getQuestionAnswers(q, { customPanels = simpleCustomPanels, layoutIds = simpleConfig.panelIds, answerLayouts = questionConfig.answerLayouts } = {}) {
    const candidates = getQuestionAnswerCandidates(q, customPanels);
    const keys = answerLayouts?.[q.id] || getDefaultQuestionAnswerKeys(q, { customPanels, layoutIds });
    return [...new Set(keys)].map(key => candidates.get(key)).filter(Boolean);
}

// 出す質問（設定 → 質問でチェックしたもの）。質問モードの上のボタンと設定の「今すぐ質問する」で共通
function getVisibleQuestions() {
    const hidden = new Set(questionConfig.hiddenIds);
    return getQuestionCatalog().filter(q => !hidden.has(q.id));
}

// 質問モードで直前に答えた文（質問文の右に出す）。別の質問の横に「前の答え」として出すのは数分だけ
let lastQuestionAnswer = null; // { questionId, sentence, silent, at }
const QUESTION_LAST_ANSWER_KEEP_MS = 180000;

function recordQuestionAnswer(item) {
    if (!activeQuestion) return;
    lastQuestionAnswer = { questionId: activeQuestion.id, sentence: buildSimpleSentence(item), silent: Boolean(activeQuestion.silent), at: Date.now() };
}

// 今の質問の横に出す答え（null なら出さない）。相づちは次の質問に持ち越さない
function getShownQuestionAnswer() {
    if (!activeQuestion || !lastQuestionAnswer) return null;
    const isCurrent = lastQuestionAnswer.questionId === activeQuestion.id;
    if (!isCurrent && (lastQuestionAnswer.silent || Date.now() - lastQuestionAnswer.at > QUESTION_LAST_ANSWER_KEEP_MS)) return null;
    return { ...lastQuestionAnswer, isCurrent };
}

// 質問のアイコン（自作の質問で未設定なら ❓）
function getQuestionEmoji(q) {
    return q.emoji || "❓";
}

// 質問モードで、出す質問の中から回答中の質問を決める（前回の質問 → 先頭の質問）。出す質問が無ければ空の画面
function ensureQuestionModeQuestion({ speak: shouldSpeak = false } = {}) {
    if (!isQuestionMode()) return;
    const visible = getVisibleQuestions();
    if (activeQuestion && visible.some(q => q.id === activeQuestion.id)) return;
    const lastId = localStorage.getItem(QUESTION_MODE_LAST_KEY);
    const next = visible.find(q => q.id === lastId) ?? visible[0];
    if (next) {
        startQuestion(next.id, { speak: shouldSpeak });
    } else if (activeQuestion) {
        activeQuestion = null;
        renderAll();
    }
}

function dismissConfirmOverlay() {
    if (window.confirmTimer) clearTimeout(window.confirmTimer);
    confirmOverlay.classList.remove("active");
    resolveConfirmOverlayHideWaiters();
}

// 質問モードの上のボタン。回答の確定表示中でも待たせず、表示を閉じてから切り替える
function selectQuestionFromBar(questionId) {
    if (!isConfirmInProgress) {
        startQuestion(questionId);
        return;
    }
    dismissConfirmOverlay();
    // 確定表示の後始末（isConfirmInProgress の解除）が済んでから切り替える
    setTimeout(() => startQuestion(questionId), 0);
}

// 質問のボタンは会話で並びも中身も変わらない（介助者が場所で覚えられるよう固定。押した質問だけ色が変わる）
function renderQuestionModeBar() {
    if (!questionModeBar) return;
    questionModeBar.innerHTML = "";
    if (!isQuestionMode()) {
        questionModeBar.style.display = "none";
        return;
    }
    questionModeBar.style.display = "";
    getVisibleQuestions().forEach((q) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "question-mode-btn" + (activeQuestion?.id === q.id ? " active" : "");
        const icon = document.createElement("span");
        icon.className = "question-mode-icon";
        icon.textContent = getQuestionEmoji(q);
        const label = document.createElement("span");
        label.className = "question-mode-label";
        label.textContent = getQuestionLabel(q);
        btn.append(icon, label);
        btn.title = activeQuestion?.id === q.id && !q.silent ? `${q.question}（押すともう一度読み上げ）` : q.question;
        btn.addEventListener("click", () => selectQuestionFromBar(q.id));
        questionModeBar.appendChild(btn);
    });
}

function startQuestion(questionId, { speak: shouldSpeak = true } = {}) {
    const question = getQuestionCatalog().find(q => q.id === questionId);
    if (!question || isConfirmInProgress) return;
    if (isQuestionMode()) {
        try {
            localStorage.setItem(QUESTION_MODE_LAST_KEY, question.id);
        } catch (error) {
            console.warn("question mode last id save failed:", error);
        }
    }
    // 切り替える前の画面で予約された口のクリックは実行しない（同じ質問を出し直すと回答 id が同じで、古いパネルが確定してしまう）
    if (pendingClickTimer) {
        clearTimeout(pendingClickTimer);
        pendingClickTimer = null;
        pendingClickTargetKey = "";
    }

    if (!activeQuestion) pageBeforeQuestion = simplePage;
    // 回答 id は質問ごとに振り直す（パネルの元の id は panelId に残る）
    activeQuestion = {
        ...question,
        // 画面の id は並び順の番号。生成アイコンの id（${質問}-a${元の番号}）と重ならないよう別の形にする
        answers: getQuestionAnswers(question).map((answer, i) => ({ ...answer, id: `${question.id}-ans${i}` }))
    };
    activeQuestionStartedAt = Date.now();
    isSimplePaused = false;
    simplePage = 0;
    resetDwellProgress();
    // 質問が出た瞬間にポインタの下の回答を選ばないよう、一度動くまで滞留しない
    dwellLockedKey = DWELL_LOCK_FIRST_HOVER;
    // 症状モードの途中状態（下段表示・30秒復帰タイマー）は持ち越さない
    resetSymptomModeState(false);
    renderAll();
    centerPointerOnSimpleGrid();
    renderQuestionButtons();

    if (shouldSpeak && questionConfig.speakQuestion && !question.silent) void speak(question.question);
}

function endQuestion() {
    // 回答の確認表示中は閉じない（表示が消えた後に handleSimpleClick が閉じる）
    if (!activeQuestion || isConfirmInProgress) return;
    // 質問モードは質問を閉じない（切り替えだけ）
    if (isQuestionMode()) return;

    activeQuestion = null;
    simplePage = pageBeforeQuestion;
    resetDwellProgress();
    dwellLockedKey = DWELL_LOCK_FIRST_HOVER;
    if (appMode !== APP_MODE_SYMPTOM) {
        renderAll();
        centerPointerOnSimpleGrid();
    } else {
        resetSymptomModeState();
    }
    renderQuestionButtons();
}

function checkQuestionTimeout() {
    if (!activeQuestion || isConfirmInProgress || isQuestionMode()) return;
    if (Date.now() - activeQuestionStartedAt >= QUESTION_TIMEOUT_MS) endQuestion();
}

// 設定 → 質問モード の「今すぐ質問する」ボタン
function renderQuestionButtons() {
    if (!questionButtonsContainer) return;

    questionButtonsContainer.innerHTML = "";
    const visible = getVisibleQuestions();
    visible.forEach((q) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "question-btn" + (activeQuestion?.id === q.id ? " active" : "");
        btn.textContent = `${getQuestionEmoji(q)} ${getQuestionLabel(q)}`;
        btn.title = q.question;
        btn.addEventListener("click", () => {
            // 設定で変えた内容も保存してから、利用者が回答画面を見られるよう閉じる
            if (!saveSettingsAndClose()) return;
            if (activeQuestion?.id === q.id && !isQuestionMode()) {
                endQuestion();
                return;
            }
            // 質問モードは上のボタンと同じ（回答中の質問なら読み上げ直す）
            if (isQuestionMode()) selectQuestionFromBar(q.id);
            else startQuestion(q.id);
        });
        questionButtonsContainer.appendChild(btn);
    });
    if (visible.length === 0) {
        const note = document.createElement("p");
        note.className = "settings-help";
        note.textContent = "表示する質問がありません（設定 → 質問モード）";
        questionButtonsContainer.appendChild(note);
    }
    if (questionEndBtn) questionEndBtn.style.display = activeQuestion && !isQuestionMode() ? "" : "none";
    // 質問モードは画面の上に同じ質問が並ぶので出さない
    const questionSection = document.getElementById("question-now-section");
    if (questionSection) questionSection.style.display = isQuestionMode() ? "none" : "";
}

// 「絵文字 表示名=発話文」を1行1つで受け取る（絵文字・発話文は省略可）
function parseQuestionAnswers(text) {
    return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line) => {
        let emoji = "";
        // 絵文字（異体字セレクタ・肌色・ZWJ連結）、国旗、キーキャップ(1️⃣)を先頭の絵文字として扱う
        const match = line.match(/^((?:\p{Extended_Pictographic}[\u{FE0F}\u{1F3FB}-\u{1F3FF}]*(?:\u{200D}\p{Extended_Pictographic}[\u{FE0F}\u{1F3FB}-\u{1F3FF}]*)*)|\p{Regional_Indicator}{2}|[0-9#*]\u{FE0F}?\u{20E3})\s*(.*)$/u);
        if (match) {
            emoji = match[1];
            line = match[2];
        }
        const [rawName, ...rest] = line.split("=");
        const name = rawName.trim();
        const sentence = rest.join("=").trim();
        if (!name) return null;
        const answer = { name, sentence: sentence || `${name}。` };
        if (emoji) answer.emoji = emoji;
        return answer;
    }).filter(Boolean);
}

// ---------------------------------------------------------
// 設定画面: シンプルモードの画面配置（ドラッグで並べ替え）・任意パネル追加
// ---------------------------------------------------------
let simpleLayoutDraft = [];   // 画面に並べるパネルID（並び順＝画面の並び）
let simpleDwellDraft = {};    // パネルごとの滞留時間 { id: ms }
let simpleCustomDraft = [];   // 保存前の任意パネル
let simplePaletteFilter = "all";
let simpleSelectedTileId = null;
// 「🔀 移動」中のパネル。次にクリックしたマスの前へ入れる（ドラッグできない環境でも並べ替えられる）
let simpleMovingTileId = null;
let layoutDragId = null;
const SIMPLE_FILTER_ALL = "all";
const SIMPLE_GROUP_BASE = "基本";
const SIMPLE_GROUP_CUSTOM = "任意";
const LAYOUT_DRAG_TYPE = "text/plain";

function getSimplePanelGroup(item) {
    if (item.custom) return SIMPLE_GROUP_CUSTOM;
    return item.group || SIMPLE_GROUP_BASE;
}

function getDraftGridSize() {
    return SIMPLE_GRID_SIZES[simpleGridSizeSelect?.value] || SIMPLE_GRID_SIZES[simpleConfig.gridSize] || SIMPLE_GRID_SIZES[SIMPLE_GRID_SIZE_DEFAULT];
}

function getDraftCatalogMap() {
    return new Map(getSimpleCatalog(simpleCustomDraft).map(p => [p.id, p]));
}

function openSimplePanelEditor() {
    simpleCustomDraft = simpleCustomPanels.map(p => ({ ...p }));
    const byId = getDraftCatalogMap();
    simpleLayoutDraft = simpleConfig.panelIds.filter(id => byId.has(id));

    if (simpleGridSizeSelect) simpleGridSizeSelect.value = simpleConfig.gridSize;
    if (simpleShowRestInput) simpleShowRestInput.checked = simpleConfig.showRest;
    if (simpleConfirmSoundInput) simpleConfirmSoundInput.checked = simpleConfig.confirmSound;
    simpleDwellDraft = { ...simpleConfig.dwellOverrides };
    simplePaletteFilter = SIMPLE_FILTER_ALL;
    simpleSelectedTileId = null;
    simpleMovingTileId = null;
    resetSimpleCustomForm();
    renderSimplePanelEditor();
}

// id を index の位置（そこにあったタイルの場所）へ移す。未配置なら追加する
// insertIndex は動かす前の並びでの位置（そのパネルの前に入る。末尾なら並びの長さ）
function moveLayoutPanel(id, insertIndex) {
    if (!id || !getDraftCatalogMap().has(id)) return;
    let target = clamp(insertIndex, 0, simpleLayoutDraft.length);
    const from = simpleLayoutDraft.indexOf(id);
    if (from !== -1) {
        simpleLayoutDraft.splice(from, 1);
        // 自分より後ろへ動かすときは、抜いた分だけ位置が前にずれる
        if (from < target) target -= 1;
    }
    simpleLayoutDraft.splice(target, 0, id);
    simpleSelectedTileId = id;
    simpleMovingTileId = null;
    renderSimplePanelEditor();
}

function removeLayoutPanel(id) {
    simpleLayoutDraft = simpleLayoutDraft.filter(x => x !== id);
    if (simpleSelectedTileId === id) simpleSelectedTileId = null;
    if (simpleMovingTileId === id) simpleMovingTileId = null;
    renderSimplePanelEditor();
}

function createLayoutThumb(item, className = "layout-thumb") {
    const thumb = document.createElement("div");
    thumb.className = className;
    const src = item.image || getGeneratedIcon(item.iconId || item.id, item.icon) || item.icon;
    if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "";
        img.draggable = false;
        thumb.appendChild(img);
    } else if (item.emoji) {
        thumb.textContent = item.emoji;
    } else {
        thumb.classList.add("is-text");
    }
    return thumb;
}

function bindLayoutDrag(el, id) {
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
        layoutDragId = id;
        e.dataTransfer.setData(LAYOUT_DRAG_TYPE, id);
        e.dataTransfer.effectAllowed = "move";
        el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => {
        layoutDragId = null;
        el.classList.remove("dragging");
        document.querySelectorAll(".drop-target, .drop-before, .drop-after").forEach(t => t.classList.remove("drop-target", "drop-before", "drop-after"));
    });
}

// sided: タイルの左半分なら前、右半分なら後ろへ入れる（onDrop の2番目の引数が true = 後ろ）
function bindLayoutDrop(el, onDrop, { sided = false } = {}) {
    const isAfter = e => sided && e.clientX > el.getBoundingClientRect().left + (el.getBoundingClientRect().width / 2);
    const clearMarks = () => el.classList.remove("drop-target", "drop-before", "drop-after");
    el.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        el.classList.add("drop-target");
        if (sided) {
            const after = isAfter(e);
            el.classList.toggle("drop-after", after);
            el.classList.toggle("drop-before", !after);
        }
    });
    el.addEventListener("dragleave", clearMarks);
    el.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const after = isAfter(e);
        clearMarks();
        const id = e.dataTransfer.getData(LAYOUT_DRAG_TYPE) || layoutDragId;
        // 再描画でドラッグ元が消えると dragend が来ないことがあるので、ここで片付ける
        layoutDragId = null;
        if (id) onDrop(id, after);
    });
}

function renderSimplePanelEditor() {
    if (!layoutPagesContainer) return;
    const byId = getDraftCatalogMap();
    simpleLayoutDraft = simpleLayoutDraft.filter(id => byId.has(id));

    const { cols, rows } = getDraftGridSize();
    const pageSize = cols * rows;
    const count = simpleLayoutDraft.length;
    const pageCount = Math.max(1, Math.ceil(count / pageSize));
    // 最終ページが埋まっていたら、ドロップで次のページを作れるよう空ページを1つ足す
    const hasSparePage = count > 0 && count % pageSize === 0;
    const showRest = simpleShowRestInput ? simpleShowRestInput.checked : simpleConfig.showRest;

    if (simplePanelSummary) simplePanelSummary.textContent = `表示中 ${count} 枚 ・ ${pageCount} ページ`;

    layoutPagesContainer.innerHTML = "";
    // 画面に並んでいるパネルだけ動かせる（外したら移動もやめる）
    const moving = simpleMovingTileId && simpleLayoutDraft.includes(simpleMovingTileId) ? byId.get(simpleMovingTileId) : null;
    if (!moving) simpleMovingTileId = null;
    layoutPagesContainer.classList.toggle("is-moving", Boolean(moving));
    if (moving) {
        const note = document.createElement("div");
        note.className = "layout-move-note";
        note.textContent = `「${moving.name}」の移動先をクリック（そのパネルの前に入ります。空きマスなら最後へ）`;
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "ctrl-btn secondary";
        cancel.textContent = "やめる";
        cancel.addEventListener("click", () => {
            simpleMovingTileId = null;
            renderSimplePanelEditor();
        });
        note.appendChild(cancel);
        layoutPagesContainer.appendChild(note);
    }
    // 実画面と同じ縦横比で見せる（下の操作バーぶんを除く）
    const aspect = `${window.innerWidth} / ${Math.round(window.innerHeight * 0.8)}`;

    for (let page = 0; page < pageCount + (hasSparePage ? 1 : 0); page++) {
        const isSpare = page >= pageCount;
        const pageEl = document.createElement("div");
        pageEl.className = "layout-page" + (isSpare ? " is-spare" : "");

        const label = document.createElement("div");
        label.className = "layout-page-label";
        label.textContent = isSpare ? `${page + 1}ページ目（ここへドロップで追加）` : `${page + 1}ページ目`;
        pageEl.appendChild(label);

        const grid = document.createElement("div");
        grid.className = "layout-grid";
        grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
        grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
        grid.style.aspectRatio = aspect;

        for (let slot = 0; slot < pageSize; slot++) {
            const index = page * pageSize + slot;
            const id = simpleLayoutDraft[index];
            const item = id ? byId.get(id) : null;
            if (!item) {
                const empty = document.createElement("div");
                empty.className = "layout-tile is-empty";
                bindLayoutDrop(empty, dragId => moveLayoutPanel(dragId, simpleLayoutDraft.length));
                empty.addEventListener("click", () => {
                    if (simpleMovingTileId) moveLayoutPanel(simpleMovingTileId, simpleLayoutDraft.length);
                });
                grid.appendChild(empty);
                continue;
            }

            const tile = document.createElement("div");
            tile.className = "layout-tile" + (id === simpleSelectedTileId ? " selected" : "") + (id === simpleMovingTileId ? " moving" : "");
            tile.title = moving
                ? (id === simpleMovingTileId ? "移動をやめる" : `「${moving.name}」をここ（${item.name}の前）へ移動`)
                : `${item.name}（ドラッグで移動・左半分なら前／右半分なら後ろ。クリックで詳細）`;
            tile.appendChild(createLayoutThumb(item));
            const name = document.createElement("div");
            name.className = "layout-tile-name";
            name.textContent = item.name;
            tile.appendChild(name);
            if (simpleDwellDraft[id]) {
                const badge = document.createElement("span");
                badge.className = "layout-tile-dwell";
                badge.textContent = `⏱${(simpleDwellDraft[id] / 1000).toFixed(1)}`;
                tile.appendChild(badge);
            }
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "layout-tile-remove";
            remove.title = "画面から外す";
            remove.textContent = "✕";
            remove.addEventListener("click", (e) => {
                e.stopPropagation();
                removeLayoutPanel(id);
            });
            tile.appendChild(remove);
            tile.addEventListener("click", () => {
                if (simpleMovingTileId) {
                    if (simpleMovingTileId === id) {
                        simpleMovingTileId = null;
                        renderSimplePanelEditor();
                    } else {
                        moveLayoutPanel(simpleMovingTileId, index);
                    }
                    return;
                }
                simpleSelectedTileId = simpleSelectedTileId === id ? null : id;
                renderSimplePanelEditor();
            });
            bindLayoutDrag(tile, id);
            bindLayoutDrop(tile, (dragId, after) => moveLayoutPanel(dragId, index + (after ? 1 : 0)), { sided: true });
            grid.appendChild(tile);
        }
        pageEl.appendChild(grid);

        // 実画面下部の操作バー（見た目の参考）
        const bar = document.createElement("div");
        bar.className = "layout-bar";
        const barItems = [];
        if (pageCount > 1) barItems.push("◀ 前へ", `${Math.min(page, pageCount - 1) + 1} / ${pageCount}`, "次へ ▶");
        if (showRest) barItems.push("⏸️ 休憩");
        barItems.forEach(text => {
            const span = document.createElement("span");
            span.textContent = text;
            bar.appendChild(span);
        });
        if (barItems.length > 0 && !isSpare) pageEl.appendChild(bar);

        layoutPagesContainer.appendChild(pageEl);
    }

    renderLayoutDetail(byId);
    renderSimplePalette(byId);
}

function renderLayoutDetail(byId) {
    if (!layoutDetailContainer) return;
    layoutDetailContainer.innerHTML = "";
    const id = simpleSelectedTileId;
    const item = id ? byId.get(id) : null;
    const index = id ? simpleLayoutDraft.indexOf(id) : -1;
    if (!item || index === -1) {
        layoutDetailContainer.classList.add("is-empty");
        layoutDetailContainer.textContent = "タイルをクリックすると、ここで滞留時間などを設定できます。";
        return;
    }
    layoutDetailContainer.classList.remove("is-empty");

    const { cols, rows } = getDraftGridSize();
    const pageSize = cols * rows;
    layoutDetailContainer.appendChild(createLayoutThumb(item, "simple-editor-thumb"));

    const text = document.createElement("div");
    text.className = "simple-editor-text";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const badge = document.createElement("span");
    badge.className = "simple-editor-group";
    badge.textContent = getSimplePanelGroup(item);
    name.appendChild(badge);
    const info = document.createElement("small");
    info.textContent = `${Math.floor(index / pageSize) + 1}ページ目・${(index % pageSize) + 1}番目 ／ 「${buildSimpleSentence(item)}」`;
    text.append(name, info);
    layoutDetailContainer.appendChild(text);

    const actions = document.createElement("div");
    actions.className = "simple-editor-actions";
    const dwellSelect = document.createElement("select");
    dwellSelect.className = "simple-editor-dwell";
    dwellSelect.title = "このパネルの滞留時間";
    dwellSelect.add(new Option("滞留 既定", ""));
    PANEL_DWELL_CHOICES.forEach(ms => dwellSelect.add(new Option(`滞留 ${(ms / 1000).toFixed(1)}秒`, String(ms))));
    dwellSelect.value = simpleDwellDraft[id] ? String(simpleDwellDraft[id]) : "";
    dwellSelect.classList.toggle("is-custom", dwellSelect.value !== "");
    dwellSelect.addEventListener("change", () => {
        const ms = Number(dwellSelect.value);
        if (ms > 0) simpleDwellDraft[id] = ms;
        else delete simpleDwellDraft[id];
        renderSimplePanelEditor();
    });
    actions.appendChild(dwellSelect);

    const addAction = (label, title, disabled, handler, extraClass = "secondary") => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `ctrl-btn ${extraClass}`;
        btn.textContent = label;
        btn.title = title;
        btn.disabled = disabled;
        btn.addEventListener("click", handler);
        actions.appendChild(btn);
    };
    const isMoving = simpleMovingTileId === id;
    addAction(isMoving ? "移動をやめる" : "🔀 移動", "次にクリックしたマスへ移動（そのパネルの前に入る）", false, () => {
        simpleMovingTileId = isMoving ? null : id;
        renderSimplePanelEditor();
    }, isMoving ? "secondary" : "primary");
    const last = simpleLayoutDraft.length - 1;
    addAction("⏮", "先頭へ", index === 0, () => moveLayoutPanel(id, 0));
    addAction("◀", "1つ前へ", index === 0, () => moveLayoutPanel(id, index - 1));
    addAction("▶", "1つ後ろへ", index === last, () => moveLayoutPanel(id, index + 2));
    addAction("⏭", "最後へ", index === last, () => moveLayoutPanel(id, simpleLayoutDraft.length));
    addAction("外す", "画面から外す", false, () => removeLayoutPanel(id));
    if (item.custom) {
        addAction("削除", "この任意パネルを削除", false, () => {
            simpleCustomDraft = simpleCustomDraft.filter(p => p.id !== id);
            delete simpleDwellDraft[id];
            removeLayoutPanel(id);
        });
    }
    layoutDetailContainer.appendChild(actions);
}

// 画面に出していないパネルの一覧。ドラッグかクリックで画面へ追加
function renderSimplePalette(byId) {
    if (!simplePanelList) return;
    const used = new Set(simpleLayoutDraft);
    const unused = Array.from(byId.values()).filter(item => !used.has(item.id));

    if (simplePanelFilter) {
        const groups = [];
        unused.forEach(item => {
            const group = getSimplePanelGroup(item);
            if (!groups.includes(group)) groups.push(group);
        });
        if (simplePaletteFilter !== SIMPLE_FILTER_ALL && !groups.includes(simplePaletteFilter)) simplePaletteFilter = SIMPLE_FILTER_ALL;
        simplePanelFilter.innerHTML = "";
        [{ key: SIMPLE_FILTER_ALL, label: "すべて" }, ...groups.map(g => ({ key: g, label: g }))].forEach(({ key, label }) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "filter-chip" + (key === simplePaletteFilter ? " active" : "");
            const count = key === SIMPLE_FILTER_ALL ? unused.length : unused.filter(i => getSimplePanelGroup(i) === key).length;
            chip.append(label, Object.assign(document.createElement("span"), { className: "filter-chip-count", textContent: String(count) }));
            chip.addEventListener("click", () => {
                simplePaletteFilter = key;
                renderSimplePanelEditor();
            });
            simplePanelFilter.appendChild(chip);
        });
    }

    simplePanelList.innerHTML = "";
    const visible = unused.filter(item => simplePaletteFilter === SIMPLE_FILTER_ALL || getSimplePanelGroup(item) === simplePaletteFilter);
    visible.forEach((item) => {
        const el = document.createElement("div");
        el.className = "palette-item";
        el.title = `「${buildSimpleSentence(item)}」（ドラッグで配置・クリックで追加）`;
        el.appendChild(createLayoutThumb(item));
        const name = document.createElement("div");
        name.className = "layout-tile-name";
        name.textContent = item.name;
        el.appendChild(name);
        // 画面のタイルを選んでいれば、その後ろへ割り込ませる（続けて押すと順に並ぶ）。選んでいなければ最後へ
        el.addEventListener("click", () => {
            const at = simpleSelectedTileId ? simpleLayoutDraft.indexOf(simpleSelectedTileId) : -1;
            moveLayoutPanel(item.id, at >= 0 ? at + 1 : simpleLayoutDraft.length);
        });
        if (item.custom) {
            const del = document.createElement("button");
            del.type = "button";
            del.className = "layout-tile-remove";
            del.title = "この任意パネルを削除";
            del.textContent = "🗑";
            del.addEventListener("click", (e) => {
                e.stopPropagation();
                if (!confirm(`「${item.name}」を削除しますか？`)) return;
                simpleCustomDraft = simpleCustomDraft.filter(p => p.id !== item.id);
                delete simpleDwellDraft[item.id];
                renderSimplePanelEditor();
            });
            el.appendChild(del);
        }
        bindLayoutDrag(el, item.id);
        simplePanelList.appendChild(el);
    });
    if (visible.length === 0) {
        const note = document.createElement("p");
        note.className = "settings-help";
        note.textContent = "すべて画面に配置済みです。";
        simplePanelList.appendChild(note);
    }
}

let simpleCustomImageData = "";

function resetSimpleCustomForm() {
    simpleCustomImageData = "";
    if (simpleCustomNameInput) simpleCustomNameInput.value = "";
    if (simpleCustomSentenceInput) simpleCustomSentenceInput.value = "";
    if (simpleCustomEmojiInput) simpleCustomEmojiInput.value = "";
    if (simpleCustomImageInput) simpleCustomImageInput.value = "";
    if (simpleCustomImagePreview) {
        simpleCustomImagePreview.removeAttribute("src");
        simpleCustomImagePreview.style.display = "none";
    }
}

// localStorage を圧迫しないよう、画像は縮小してから保存する
function readImageAsResizedDataUrl(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, CUSTOM_IMAGE_MAX_PX / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL("image/webp", 0.85));
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("画像を読み込めませんでした"));
        };
        img.src = url;
    });
}

function addSimpleCustomPanel() {
    const name = simpleCustomNameInput?.value.trim() || "";
    if (!name) {
        alert("表示名を入力してください。");
        return;
    }
    const sentence = simpleCustomSentenceInput?.value.trim() || "";
    const emoji = simpleCustomEmojiInput?.value.trim() || "";
    const panel = {
        id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        sentence: sentence || `${name}。`
    };
    if (simpleCustomImageData) panel.image = simpleCustomImageData;
    else if (emoji) panel.emoji = emoji;

    simpleCustomDraft.push(panel);
    resetSimpleCustomForm();
    // 追加したパネルは画面の末尾に置く
    moveLayoutPanel(panel.id, simpleLayoutDraft.length);
}

function clearSimpleLayout() {
    simpleLayoutDraft = [];
    simpleSelectedTileId = null;
    simpleMovingTileId = null;
    renderSimplePanelEditor();
}

function resetSimplePanelSelection() {
    simpleLayoutDraft = getSimpleBasePanels().map(p => p.id);
    simpleSelectedTileId = null;
    simpleMovingTileId = null;
    renderSimplePanelEditor();
}

// ---------------------------------------------------------
// 設定画面: お話の言葉
// ---------------------------------------------------------
let talkHiddenDraft = new Set();
let talkCustomDraft = [];
let talkEditorFilter = "";

function openTalkEditor() {
    talkHiddenDraft = new Set(talkConfig.hiddenIds);
    talkCustomDraft = talkCustom.map(n => ({ ...n }));
    talkEditorFilter = getTalkTree(talkCustomDraft)[0]?.id || "";
    openTalkSetEditor();
    if (talkLearnInput) talkLearnInput.checked = talkConfig.learn;
    updateTalkHistorySummary();
    resetTalkCustomForm();
    renderTalkEditor();
}

function countTalkNodes(nodes) {
    return nodes.reduce((sum, node) => sum + 1 + countTalkNodes(node.children || []), 0);
}

function renderTalkEditor() {
    if (!talkWordList) return;
    const tree = getTalkTree(talkCustomDraft);
    if (!tree.some(topic => topic.id === talkEditorFilter)) talkEditorFilter = tree[0]?.id || "";

    if (talkWordFilter) {
        talkWordFilter.innerHTML = "";
        tree.forEach((topic) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "filter-chip" + (topic.id === talkEditorFilter ? " active" : "")
                + (talkHiddenDraft.has(topic.id) ? " is-disabled" : "");
            chip.append(`${topic.emoji || ""} ${topic.label}`.trim(), Object.assign(document.createElement("span"), {
                className: "filter-chip-count", textContent: String(countTalkNodes(topic.children || []))
            }));
            chip.addEventListener("click", () => {
                talkEditorFilter = topic.id;
                renderTalkEditor();
            });
            talkWordFilter.appendChild(chip);
        });
    }

    talkWordList.innerHTML = "";
    const topic = tree.find(t => t.id === talkEditorFilter);
    if (!topic) return;
    // 話題そのものと、その下の言葉を段ごとに字下げして並べる。外した言葉の下はまとめて出なくなる
    const appendRow = (node, depth, parentHidden) => {
        const hidden = talkHiddenDraft.has(node.id);
        const row = document.createElement("label");
        row.className = "talk-editor-row" + (hidden || parentHidden ? " is-disabled" : "");
        row.style.setProperty("--depth", String(depth));
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = !hidden;
        check.addEventListener("change", () => {
            if (check.checked) talkHiddenDraft.delete(node.id);
            else talkHiddenDraft.add(node.id);
            renderTalkEditor();
        });
        const name = document.createElement("span");
        name.className = "talk-editor-name";
        name.textContent = `${node.emoji || ""} ${node.label}`.trim();
        row.append(check, name);
        const notes = [];
        if (node.for) notes.push(`👤${node.for.map(id => getTalkPartners().find(p => p.id === id)?.name || id).join("・")}のとき`);
        if (node.time) notes.push({ morning: "🌅朝", day: "☀️昼", evening: "🌙夜" }[node.time]);
        if (node.say || notes.length > 0) {
            const say = document.createElement("small");
            say.className = "talk-editor-say";
            say.textContent = [node.say ? `「${node.say.replace(TALK_CALL_PLACEHOLDER, "（呼び名）、")}」` : "", ...notes].filter(Boolean).join(" ");
            row.appendChild(say);
        }
        if (talkCustomDraft.some(n => n.id === node.id)) {
            const del = document.createElement("button");
            del.type = "button";
            del.className = "talk-editor-remove";
            del.title = "この文を削除";
            del.textContent = "✕";
            del.addEventListener("click", (e) => {
                e.preventDefault();
                talkCustomDraft = talkCustomDraft.filter(n => n.id !== node.id);
                talkHiddenDraft.delete(node.id);
                renderTalkEditor();
            });
            row.appendChild(del);
        }
        talkWordList.appendChild(row);
        (node.children || []).forEach(child => appendRow(child, depth + 1, parentHidden || hidden));
    };
    appendRow(topic, 0, false);
}

function resetTalkCustomForm() {
    if (talkCustomLabelInput) talkCustomLabelInput.value = "";
    if (talkCustomEmojiInput) talkCustomEmojiInput.value = "";
    if (talkCustomSayInput) talkCustomSayInput.value = "";
}

function addTalkCustomPhrase() {
    const label = talkCustomLabelInput?.value.trim() || "";
    if (!label) {
        alert("パネルの言葉を入力してください。");
        return;
    }
    const say = talkCustomSayInput?.value.trim() || `${label}。`;
    const node = { id: `tc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, label, say };
    const emoji = talkCustomEmojiInput?.value.trim() || "";
    if (emoji) node.emoji = emoji;
    talkCustomDraft.push(node);
    talkEditorFilter = TALK_CUSTOM_TOPIC_ID;
    resetTalkCustomForm();
    renderTalkEditor();
}

function updateTalkHistorySummary() {
    if (!talkHistorySummary) return;
    const sentences = Object.keys(talkHistory.sentences).length;
    talkHistorySummary.textContent = sentences === 0 ? "まだ記録していません" : `よく話す文 ${sentences} 件を記録中`;
}

// ---------------------------------------------------------
// 設定画面: 会話パターンの切り替えと、AI インタビューでの作成
// ---------------------------------------------------------
const TALK_INTERVIEW_FREE_QUESTION = "その他、本人について伝えたいこと（自由に）";
let talkInterviewDraft = [];   // [{ q, a }]
let isTalkAiBusy = false;

// 使うパターンを切り替える。相手や途中の位置は前のパターンのものなので最初に戻す
function setActiveTalkSet(id) {
    talkActiveSetId = getTalkSets().some(set => set.id === id) ? id : DEFAULT_TALK_SET.id;
    try {
        localStorage.setItem(TALK_ACTIVE_SET_KEY, talkActiveSetId);
    } catch (error) {
        // 保存容量が足りなくても、今の画面では切り替える
        console.warn("talk active set save failed:", error);
    }
    // 引き継ぐ回答は使うパターンごとに違うので、作りかけのインタビューは捨てる
    talkInterviewDraft = [];
    talkPartnerId = "";
    talkPath = [];
    talkTab = TALK_TAB_TREE;
    talkFavoriteOrder = null;
    simplePage = 0;
    if (isTalkScreen()) rerenderSimpleMode();
}

function openTalkSetEditor() {
    if (talkProfileGenderSelect) talkProfileGenderSelect.value = talkProfile.gender;
    if (talkProfileAgeInput) talkProfileAgeInput.value = talkProfile.age ?? "";
    if (talkAiModelInput) talkAiModelInput.value = localStorage.getItem(TALK_AI_MODEL_KEY) || "";
    renderTalkSetList();
    renderTalkInterview();
    updateTalkAiButtons();
}

function readTalkProfileForm() {
    const age = Number.parseInt(talkProfileAgeInput?.value || "", 10);
    return {
        gender: talkProfileGenderSelect?.value || "",
        age: Number.isFinite(age) && age > 0 && age < 130 ? age : null
    };
}

function saveTalkProfileForm() {
    talkProfile = readTalkProfileForm();
    localStorage.setItem(TALK_PROFILE_KEY, JSON.stringify(talkProfile));
    const model = talkAiModelInput?.value.trim() || "";
    if (model) localStorage.setItem(TALK_AI_MODEL_KEY, model);
    else localStorage.removeItem(TALK_AI_MODEL_KEY);
}

// 設定画面で入力したばかり（未保存）のキーも使う
function getTalkAiApiKey() {
    return apiKeyInput?.value.trim() || GEMINI_API_KEY;
}

function getTalkAiModel() {
    return localStorage.getItem(TALK_AI_MODEL_KEY) || TALK_AI_MODEL_DEFAULT;
}

function formatTalkSetDate(time) {
    const date = new Date(time);
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

function renderTalkSetList() {
    if (!talkSetList) return;
    talkSetList.innerHTML = "";
    getTalkSets().forEach((set) => {
        const row = document.createElement("label");
        row.className = "talk-set-row" + (set.id === talkActiveSetId ? " active" : "");
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "talk-set";
        radio.checked = set.id === talkActiveSetId;
        radio.addEventListener("change", () => {
            setActiveTalkSet(set.id);
            talkEditorFilter = "";
            renderTalkSetList();
            renderTalkInterview();
            renderTalkEditor();
            updateTalkAiButtons();
        });
        const body = document.createElement("span");
        body.className = "talk-set-body";
        const name = document.createElement("span");
        name.className = "talk-set-name";
        name.textContent = set.name;
        const meta = document.createElement("small");
        meta.className = "talk-set-meta";
        const partners = set.partners.map(p => p.name).join("・");
        meta.textContent = [
            set.createdAt ? `${new Date(set.createdAt).toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })} 作成` : "",
            `${countTalkTreeNodes(set.tree)} 項目`,
            partners ? `相手: ${partners}` : ""
        ].filter(Boolean).join(" ／ ");
        body.append(name, meta);
        row.append(radio, body);
        if (!set.builtin) {
            const rename = document.createElement("button");
            rename.type = "button";
            rename.className = "ctrl-btn secondary talk-set-btn";
            rename.textContent = "名前";
            rename.addEventListener("click", (e) => {
                e.preventDefault();
                const next = prompt("会話パターンの名前", set.name);
                if (!next || !next.trim()) return;
                saveTalkSets(talkSets.map(s => (s.id === set.id ? { ...s, name: next.trim().slice(0, 40) } : s)));
                renderTalkSetList();
            });
            const del = document.createElement("button");
            del.type = "button";
            del.className = "ctrl-btn secondary talk-set-btn";
            del.textContent = "削除";
            del.addEventListener("click", (e) => {
                e.preventDefault();
                if (!confirm(`「${set.name}」を削除しますか？（元に戻せません）`)) return;
                if (!saveTalkSets(talkSets.filter(s => s.id !== set.id))) return;
                if (set.id === talkActiveSetId) setActiveTalkSet(DEFAULT_TALK_SET.id);
                talkEditorFilter = "";
                renderTalkSetList();
                renderTalkInterview();
                renderTalkEditor();
                updateTalkAiButtons();
            });
            // talk studio（npm run talk:studio）に読み込んで、文の手直しや絵の作成をするためのファイル
            const exportBtn = document.createElement("button");
            exportBtn.type = "button";
            exportBtn.className = "ctrl-btn secondary talk-set-btn";
            exportBtn.textContent = "書き出し";
            exportBtn.addEventListener("click", (e) => {
                e.preventDefault();
                const blob = new Blob([JSON.stringify(set, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `talk-set-${set.id}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            });
            row.append(rename, exportBtn, del);
        }
        talkSetList.appendChild(row);
    });
}

function renderTalkInterview() {
    if (!talkInterviewList) return;
    talkInterviewList.innerHTML = "";
    talkInterviewDraft.forEach((item, index) => {
        const field = document.createElement("label");
        field.className = "field talk-interview-item";
        const q = document.createElement("span");
        q.textContent = `Q${index + 1}. ${item.q}`;
        const a = document.createElement("textarea");
        a.rows = 2;
        a.value = item.a;
        a.placeholder = "わかる範囲で（空欄でもよい）";
        a.addEventListener("input", () => {
            item.a = a.value;
            item.carried = false;
            updateTalkAiButtons();
        });
        field.append(q, a);
        talkInterviewList.appendChild(field);
    });
}

// 今のパターンを作ったときの回答（引き継ぐ設定のとき）
function getCarriedTalkInterview() {
    if (talkInterviewCarryInput && !talkInterviewCarryInput.checked) return [];
    return (getActiveTalkSet().interview || []).map(item => ({ q: item.q, a: item.a }));
}

// 引き継いだ回答と画面で答えた内容を合わせる（同じ質問は画面の答えを優先）。
// 引き継ぎOFFなら、引き継いだまま手を加えていない回答は使わない
function mergeTalkInterview({ includeUnanswered = false } = {}) {
    const carryOn = !talkInterviewCarryInput || talkInterviewCarryInput.checked;
    const merged = getCarriedTalkInterview();
    talkInterviewDraft.forEach((item) => {
        if (item.carried && !carryOn) return;
        const existing = merged.find(m => m.q === item.q);
        if (existing) existing.a = item.a;
        else merged.push({ q: item.q, a: item.a });
    });
    return merged
        .map(item => ({ q: item.q, a: (item.a || "").trim() }))
        .filter(item => includeUnanswered || item.a);
}

function updateTalkAiButtons() {
    if (talkInterviewStartBtn) talkInterviewStartBtn.disabled = isTalkAiBusy;
    if (talkGenerateBtn) talkGenerateBtn.disabled = isTalkAiBusy || mergeTalkInterview().length === 0;
}

function setTalkAiStatus(text, isError = false) {
    if (!talkAiStatus) return;
    talkAiStatus.textContent = text;
    talkAiStatus.classList.toggle("is-error", isError);
}

async function startTalkInterview() {
    if (isTalkAiBusy) return;
    saveTalkProfileForm();
    // 未回答の質問も渡して、同じ質問をくり返させない
    const base = mergeTalkInterview({ includeUnanswered: true });
    isTalkAiBusy = true;
    updateTalkAiButtons();
    setTalkAiStatus("質問を考えています…");
    try {
        const questions = await generateInterviewQuestions({
            apiKey: getTalkAiApiKey(), model: getTalkAiModel(), profile: talkProfile, interview: base
        });
        const asked = new Set(base.map(item => item.q));
        const fresh = questions.filter(q => !asked.has(q)).map(q => ({ q, a: "" }));
        const carriedQuestions = new Set(getCarriedTalkInterview().map(item => item.q));
        // 前回までの質問は下に続ける。引き継いだまま手を加えていない回答には印を付ける
        const previous = base
            .filter(item => item.q !== TALK_INTERVIEW_FREE_QUESTION)
            .map(item => ({ ...item, carried: carriedQuestions.has(item.q) && !talkInterviewDraft.some(d => d.q === item.q && !d.carried) }));
        const free = base.find(item => item.q === TALK_INTERVIEW_FREE_QUESTION) || { q: TALK_INTERVIEW_FREE_QUESTION, a: "" };
        talkInterviewDraft = [...fresh, ...previous, free];
        renderTalkInterview();
        setTalkAiStatus(`${fresh.length} 個の質問を作りました。答えてから「会話パターンを作る」を押してください。前回の回答は下に続いています。`);
    } catch (error) {
        console.error("talk interview failed:", error);
        setTalkAiStatus(error.message, true);
    } finally {
        isTalkAiBusy = false;
        updateTalkAiButtons();
    }
}

async function generateTalkSetFromInterview() {
    if (isTalkAiBusy) return;
    saveTalkProfileForm();
    // 画面で質問を出していなければ、今のパターンの回答（引き継ぎON時）から作り直す
    const source = mergeTalkInterview();
    if (source.length === 0) {
        setTalkAiStatus("質問に1つ以上答えてください。", true);
        return;
    }
    isTalkAiBusy = true;
    updateTalkAiButtons();
    setTalkAiStatus("会話パターンを作っています…（1〜3分かかります。設定は閉じずにお待ちください）");
    try {
        const id = `ai${Date.now().toString(36)}`;
        const createdAt = Date.now();
        const result = await generateTalkSet({
            apiKey: getTalkAiApiKey(), model: getTalkAiModel(), profile: talkProfile, interview: source, setId: id
        });
        const set = {
            id,
            name: `${result.name}（${formatTalkSetDate(createdAt)}）`,
            createdAt,
            profile: { ...talkProfile },
            interview: source,
            partners: result.partners,
            tree: result.tree
        };
        if (!saveTalkSets([...talkSets, set])) {
            setTalkAiStatus("保存できませんでした。使わないパターンを削除してから、もう一度お試しください。", true);
            return;
        }
        // 作っている間に設定を閉じて会話を始めていたら、途中で切り替えない（保存だけ）
        const isSettingsStillOpen = settingsModal.classList.contains("active");
        if (isSettingsStillOpen) setActiveTalkSet(id);
        else talkInterviewDraft = [];
        talkEditorFilter = "";
        renderTalkSetList();
        renderTalkInterview();
        renderTalkEditor();
        setTalkAiStatus(isSettingsStillOpen
            ? `「${set.name}」を作って保存し、使う設定にしました（${countTalkTreeNodes(set.tree)} 項目）。`
            : `「${set.name}」を作って保存しました（${countTalkTreeNodes(set.tree)} 項目）。上の一覧で選ぶと使えます。`);
    } catch (error) {
        console.error("talk set generation failed:", error);
        setTalkAiStatus(error.message, true);
    } finally {
        isTalkAiBusy = false;
        updateTalkAiButtons();
    }
}

function saveTalkEditor() {
    const nextConfig = {
        hiddenIds: Array.from(talkHiddenDraft),
        learn: talkLearnInput ? talkLearnInput.checked : talkConfig.learn
    };
    try {
        localStorage.setItem(TALK_CUSTOM_KEY, JSON.stringify(talkCustomDraft));
        localStorage.setItem(TALK_CONFIG_KEY, JSON.stringify(nextConfig));
    } catch (error) {
        console.error("talk save failed:", error);
        alert("お話の設定を保存できませんでした。");
        return false;
    }
    talkCustom = talkCustomDraft;
    talkConfig = nextConfig;
    saveTalkProfileForm();
    // たどっている途中の言葉が消えたかもしれないので、最初の話題選びへ戻す
    talkPath = [];
    simplePage = 0;
    return true;
}

// ---------------------------------------------------------
// 設定画面: 質問テンプレート
// ---------------------------------------------------------
let questionHiddenDraft = new Set();
let questionCustomDraft = [];
let questionOrderDraft = [];  // 並び順（質問 id。画面の上のボタン・「今すぐ質問する」の順）
let questionPanelPickDraft = []; // 追加する質問の答えにする既存パネル（選んだ順）
let questionAnswerLayoutsDraft = {}; // 答えを編集した質問の答えの並び（質問 id → key）
let questionAnswerEditId = null;     // 「答えのパネル」で編集中の質問
let questionAnswerSelectedKey = null;
let questionAnswerPaletteFilter = SIMPLE_FILTER_ALL;
const QUESTION_ANSWER_GROUP_OWN = "この質問";

function openQuestionEditor() {
    questionHiddenDraft = new Set(questionConfig.hiddenIds);
    questionCustomDraft = questionCustom.map(q => ({ ...q, answers: q.answers.map(a => ({ ...a })), panelIds: [...q.panelIds] }));
    questionOrderDraft = getQuestionCatalog(questionCustomDraft).map(q => q.id);
    questionPanelPickDraft = [];
    questionAnswerLayoutsDraft = Object.fromEntries(Object.entries(questionConfig.answerLayouts).map(([id, keys]) => [id, [...keys]]));
    if (questionGridSizeSelect) questionGridSizeSelect.value = questionConfig.gridSize;
    // 質問モードで出している質問の答えから編集を始める
    questionAnswerEditId = activeQuestion?.id ?? null;
    questionAnswerSelectedKey = null;
    questionAnswerPaletteFilter = SIMPLE_FILTER_ALL;
    if (questionSpeakInput) questionSpeakInput.checked = questionConfig.speakQuestion;
    if (questionCustomTextInput) questionCustomTextInput.value = "";
    if (questionCustomLabelInput) questionCustomLabelInput.value = "";
    if (questionCustomEmojiInput) questionCustomEmojiInput.value = "";
    if (questionCustomAnswersInput) questionCustomAnswersInput.value = "";
    renderQuestionEditor();
    renderQuestionPanelPicker();
}

// 一覧に出す答えの説明（パネルはシンプルモードの編集中の任意パネルも含める）
function describeQuestionAnswers(q) {
    const edited = Boolean(questionAnswerLayoutsDraft[q.id]);
    if (!edited && q.panelSource === QUESTION_PANEL_SOURCE_LAYOUT) return "🧩 シンプルモードの画面に並べたパネル";
    const names = getDraftQuestionAnswers(q).map(a => `${a.emoji ? a.emoji + " " : ""}${a.name}`).join(" ／ ");
    if (edited) return `✏️ ${names || "（答えなし）"}`;
    return q.panelSource ? `🧩 パネル「${q.panelSource}」${q.panelIds?.length ? "ほか" : ""}: ${names}` : names;
}

// 編集中の内容（シンプルモードの任意パネル・画面配置も編集中のもの）での答え
function getDraftQuestionAnswerOptions() {
    return { customPanels: simpleCustomDraft, layoutIds: simpleLayoutDraft, answerLayouts: questionAnswerLayoutsDraft };
}

function getDraftQuestionAnswers(q) {
    return getQuestionAnswers(q, getDraftQuestionAnswerOptions());
}

// 並び・出す質問を既定に戻す（作った質問は残して、おすすめの並びの後ろに置く）
function resetQuestionOrder() {
    questionOrderDraft = getQuestionCatalog(questionCustomDraft, []).map(q => q.id);
    const customIds = new Set(questionCustomDraft.map(q => q.id));
    questionHiddenDraft = new Set([...QUESTION_DEFAULT_HIDDEN_IDS, ...[...questionHiddenDraft].filter(id => customIds.has(id))]);
    // 旧バージョンで編集した答えの並び・パネル数もおすすめに戻す（作った質問の分は残す）
    questionAnswerLayoutsDraft = Object.fromEntries(Object.entries(questionAnswerLayoutsDraft).filter(([id]) => customIds.has(id)));
    renderQuestionEditor();
}

function moveQuestionInDraft(id, step) {
    const from = questionOrderDraft.indexOf(id);
    const to = from + step;
    if (from === -1 || to < 0 || to >= questionOrderDraft.length) return;
    questionOrderDraft.splice(from, 1);
    questionOrderDraft.splice(to, 0, id);
    renderQuestionEditor();
}

function renderQuestionEditor() {
    if (!questionEditorList) return;
    questionEditorList.innerHTML = "";

    const ordered = getQuestionCatalog(questionCustomDraft, questionOrderDraft);
    ordered.forEach((q, index) => {
        const row = document.createElement("div");
        const isShown = !questionHiddenDraft.has(q.id);
        row.className = "simple-editor-row question-editor-row" + (isShown ? "" : " is-disabled");

        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = isShown;
        check.title = "質問モードと「今すぐ質問する」に出す";
        check.addEventListener("change", () => {
            if (check.checked) questionHiddenDraft.delete(q.id);
            else questionHiddenDraft.add(q.id);
            renderQuestionEditor();
        });
        row.appendChild(check);

        const text = document.createElement("div");
        text.className = "simple-editor-text";
        const title = document.createElement("strong");
        title.textContent = `${getQuestionEmoji(q)} ${q.question}`;
        if (q.custom) {
            const badge = document.createElement("span");
            badge.className = "simple-editor-group";
            badge.textContent = "任意";
            title.appendChild(badge);
        }
        const answers = document.createElement("small");
        answers.textContent = describeQuestionAnswers(q);
        text.append(title, answers);
        row.appendChild(text);

        const actions = document.createElement("div");
        actions.className = "simple-editor-actions";
        const addAction = (label, title, disabled, onClick) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "ctrl-btn secondary";
            btn.textContent = label;
            btn.title = title;
            btn.disabled = disabled;
            btn.addEventListener("click", onClick);
            actions.appendChild(btn);
        };
        addAction("✏️ 答え", "答えのパネルをドラッグで編集", false, () => {
            questionAnswerEditId = q.id;
            questionAnswerSelectedKey = null;
            renderQuestionAnswerEditor();
            questionAnswerPagesContainer?.closest(".settings-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        addAction("▲", "前へ（先に聞く）", index === 0, () => moveQuestionInDraft(q.id, -1));
        addAction("▼", "後ろへ", index === ordered.length - 1, () => moveQuestionInDraft(q.id, 1));
        if (q.custom) {
            addAction("削除", "この質問を消す", false, () => {
                questionCustomDraft = questionCustomDraft.filter(c => c.id !== q.id);
                questionOrderDraft = questionOrderDraft.filter(id => id !== q.id);
                questionHiddenDraft.delete(q.id);
                delete questionAnswerLayoutsDraft[q.id];
                renderQuestionEditor();
            });
        }
        row.appendChild(actions);

        questionEditorList.appendChild(row);
    });
    renderQuestionAnswerEditor();
}

// ---------------------------------------------------------
// 設定画面: 質問の答えのパネル（シンプルモードの画面配置と同じく、ドラッグで並べ替え・追加・外す）
// ---------------------------------------------------------
function getAnswerEditQuestion() {
    const catalog = getQuestionCatalog(questionCustomDraft, questionOrderDraft);
    return catalog.find(q => q.id === questionAnswerEditId) ?? catalog[0] ?? null;
}

function getDraftAnswerKeys(q) {
    const candidates = getQuestionAnswerCandidates(q, simpleCustomDraft);
    const keys = questionAnswerLayoutsDraft[q.id]
        || getDefaultQuestionAnswerKeys(q, { customPanels: simpleCustomDraft, layoutIds: simpleLayoutDraft });
    return [...new Set(keys)].filter(key => candidates.has(key));
}

// key を insertIndex の位置へ移す（未配置なら追加）。insertIndex は動かす前の並びでの位置
function moveQuestionAnswer(key, insertIndex) {
    const q = getAnswerEditQuestion();
    if (!q || !getQuestionAnswerCandidates(q, simpleCustomDraft).has(key)) return;
    const keys = getDraftAnswerKeys(q);
    let target = clamp(insertIndex, 0, keys.length);
    const from = keys.indexOf(key);
    if (from !== -1) {
        // 同じ場所に落としただけなら何もしない（選択だけ移す）
        if (target === from || target === from + 1) {
            questionAnswerSelectedKey = key;
            renderQuestionAnswerEditor();
            return;
        }
        keys.splice(from, 1);
        if (from < target) target -= 1;
    }
    keys.splice(target, 0, key);
    questionAnswerLayoutsDraft[q.id] = keys;
    questionAnswerSelectedKey = key;
    renderQuestionEditor();
}

function removeQuestionAnswer(key) {
    const q = getAnswerEditQuestion();
    // 答えに入っていない候補を候補の一覧へ落としたときなどは何もしない
    if (!q || !getDraftAnswerKeys(q).includes(key)) return;
    questionAnswerLayoutsDraft[q.id] = getDraftAnswerKeys(q).filter(k => k !== key);
    if (questionAnswerSelectedKey === key) questionAnswerSelectedKey = null;
    renderQuestionEditor();
}

function resetQuestionAnswers() {
    const q = getAnswerEditQuestion();
    if (!q) return;
    delete questionAnswerLayoutsDraft[q.id];
    questionAnswerSelectedKey = null;
    renderQuestionEditor();
}

function clearQuestionAnswers() {
    const q = getAnswerEditQuestion();
    if (!q) return;
    questionAnswerLayoutsDraft[q.id] = [];
    questionAnswerSelectedKey = null;
    renderQuestionEditor();
}

function getQuestionAnswerGroup(item) {
    return item.panelId ? getSimplePanelGroup(item) : QUESTION_ANSWER_GROUP_OWN;
}

function renderQuestionAnswerEditor() {
    if (!questionAnswerPagesContainer) return;
    const q = getAnswerEditQuestion();
    questionAnswerEditId = q?.id ?? null;

    if (questionAnswerSelect) {
        questionAnswerSelect.innerHTML = "";
        getQuestionCatalog(questionCustomDraft, questionOrderDraft).forEach((item) => {
            const edited = questionAnswerLayoutsDraft[item.id] ? " ✏️" : "";
            questionAnswerSelect.add(new Option(`${getQuestionEmoji(item)} ${getQuestionLabel(item)}${edited}`, item.id));
        });
        if (q) questionAnswerSelect.value = q.id;
    }
    questionAnswerPagesContainer.innerHTML = "";
    if (!q) return;

    const candidates = getQuestionAnswerCandidates(q, simpleCustomDraft);
    const keys = getDraftAnswerKeys(q);
    if (!keys.includes(questionAnswerSelectedKey)) questionAnswerSelectedKey = null;
    const { cols, rows } = getQuestionGridSize(keys.length, {
        gridSize: questionGridSizeSelect?.value ?? questionConfig.gridSize,
        simpleGridSize: simpleGridSizeSelect?.value || simpleConfig.gridSize
    });
    const pageSize = cols * rows;
    const pageCount = Math.max(1, Math.ceil(keys.length / pageSize));
    if (questionAnswerSummary) {
        questionAnswerSummary.textContent = `${keys.length} 枚 ・ ${cols}×${rows} ・ ${pageCount} ページ${questionAnswerLayoutsDraft[q.id] ? " ・ 編集済み" : ""}`;
    }

    const aspect = `${window.innerWidth} / ${Math.round(window.innerHeight * 0.7)}`;
    for (let page = 0; page < pageCount; page++) {
        const pageEl = document.createElement("div");
        pageEl.className = "layout-page";
        const label = document.createElement("div");
        label.className = "layout-page-label";
        label.textContent = `${page + 1}ページ目`;
        pageEl.appendChild(label);

        const grid = document.createElement("div");
        grid.className = "layout-grid";
        grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
        grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
        grid.style.aspectRatio = aspect;
        for (let slot = 0; slot < pageSize; slot++) {
            const index = page * pageSize + slot;
            const key = keys[index];
            const item = key ? candidates.get(key) : null;
            if (!item) {
                const empty = document.createElement("div");
                empty.className = "layout-tile is-empty";
                bindLayoutDrop(empty, dragKey => moveQuestionAnswer(dragKey, keys.length));
                grid.appendChild(empty);
                continue;
            }
            const tile = document.createElement("div");
            tile.className = "layout-tile" + (key === questionAnswerSelectedKey ? " selected" : "");
            tile.title = `${item.name}（ドラッグで移動・左半分なら前／右半分なら後ろ。クリックで選択）`;
            tile.appendChild(createLayoutThumb(item));
            const name = document.createElement("div");
            name.className = "layout-tile-name";
            name.textContent = item.name;
            tile.appendChild(name);
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "layout-tile-remove";
            remove.title = "答えから外す";
            remove.textContent = "✕";
            remove.addEventListener("click", (e) => {
                e.stopPropagation();
                removeQuestionAnswer(key);
            });
            tile.appendChild(remove);
            tile.addEventListener("click", () => {
                questionAnswerSelectedKey = questionAnswerSelectedKey === key ? null : key;
                renderQuestionAnswerEditor();
            });
            bindLayoutDrag(tile, key);
            bindLayoutDrop(tile, (dragKey, after) => moveQuestionAnswer(dragKey, index + (after ? 1 : 0)), { sided: true });
            grid.appendChild(tile);
        }
        pageEl.appendChild(grid);
        questionAnswerPagesContainer.appendChild(pageEl);
    }

    // 枚数に合わせてマスが増えるので、空きマスが無くても最後へ足せる受け口を置く
    const dropzone = document.createElement("div");
    dropzone.className = "question-answer-dropzone";
    dropzone.textContent = "＋ ここへドロップすると最後に追加";
    bindLayoutDrop(dropzone, dragKey => moveQuestionAnswer(dragKey, keys.length));
    questionAnswerPagesContainer.appendChild(dropzone);

    renderQuestionAnswerDetail(candidates, keys);
    renderQuestionAnswerPalette(candidates, keys);
}

function renderQuestionAnswerDetail(candidates, keys) {
    if (!questionAnswerDetail) return;
    questionAnswerDetail.innerHTML = "";
    const key = questionAnswerSelectedKey;
    const item = key ? candidates.get(key) : null;
    const index = key ? keys.indexOf(key) : -1;
    if (!item || index === -1) {
        questionAnswerDetail.classList.add("is-empty");
        questionAnswerDetail.textContent = "タイルをクリックすると、ここで1つずつ動かせます。";
        return;
    }
    questionAnswerDetail.classList.remove("is-empty");
    questionAnswerDetail.appendChild(createLayoutThumb(item, "simple-editor-thumb"));

    const text = document.createElement("div");
    text.className = "simple-editor-text";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const badge = document.createElement("span");
    badge.className = "simple-editor-group";
    badge.textContent = getQuestionAnswerGroup(item);
    name.appendChild(badge);
    const info = document.createElement("small");
    info.textContent = `${index + 1}番目 ／ 「${buildSimpleSentence(item)}」`;
    text.append(name, info);
    questionAnswerDetail.appendChild(text);

    const actions = document.createElement("div");
    actions.className = "simple-editor-actions";
    const addAction = (label, title, disabled, handler) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ctrl-btn secondary";
        btn.textContent = label;
        btn.title = title;
        btn.disabled = disabled;
        btn.addEventListener("click", handler);
        actions.appendChild(btn);
    };
    const last = keys.length - 1;
    addAction("⏮", "先頭へ", index === 0, () => moveQuestionAnswer(key, 0));
    addAction("◀", "1つ前へ", index === 0, () => moveQuestionAnswer(key, index - 1));
    addAction("▶", "1つ後ろへ", index === last, () => moveQuestionAnswer(key, index + 2));
    addAction("⏭", "最後へ", index === last, () => moveQuestionAnswer(key, keys.length));
    addAction("外す", "答えから外す", false, () => removeQuestionAnswer(key));
    questionAnswerDetail.appendChild(actions);
}

// 答えにしていない候補（この質問の答え・シンプルモードのパネル）。ドラッグかクリックで追加
function renderQuestionAnswerPalette(candidates, keys) {
    if (!questionAnswerPalette) return;
    const used = new Set(keys);
    const unused = Array.from(candidates.values()).filter(item => !used.has(item.key));

    if (questionAnswerFilter) {
        const groups = [];
        unused.forEach((item) => {
            const group = getQuestionAnswerGroup(item);
            if (!groups.includes(group)) groups.push(group);
        });
        if (questionAnswerPaletteFilter !== SIMPLE_FILTER_ALL && !groups.includes(questionAnswerPaletteFilter)) questionAnswerPaletteFilter = SIMPLE_FILTER_ALL;
        questionAnswerFilter.innerHTML = "";
        [{ key: SIMPLE_FILTER_ALL, label: "すべて" }, ...groups.map(g => ({ key: g, label: g }))].forEach(({ key, label }) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "filter-chip" + (key === questionAnswerPaletteFilter ? " active" : "");
            const count = key === SIMPLE_FILTER_ALL ? unused.length : unused.filter(i => getQuestionAnswerGroup(i) === key).length;
            chip.append(label, Object.assign(document.createElement("span"), { className: "filter-chip-count", textContent: String(count) }));
            chip.addEventListener("click", () => {
                questionAnswerPaletteFilter = key;
                renderQuestionAnswerEditor();
            });
            questionAnswerFilter.appendChild(chip);
        });
    }

    questionAnswerPalette.innerHTML = "";
    const visible = unused.filter(item => questionAnswerPaletteFilter === SIMPLE_FILTER_ALL || getQuestionAnswerGroup(item) === questionAnswerPaletteFilter);
    visible.forEach((item) => {
        const el = document.createElement("div");
        el.className = "palette-item";
        el.title = `「${buildSimpleSentence(item)}」（ドラッグで配置・クリックで追加）`;
        el.appendChild(createLayoutThumb(item));
        const name = document.createElement("div");
        name.className = "layout-tile-name";
        name.textContent = item.name;
        el.appendChild(name);
        // 選んでいるタイルの後ろへ（選んでいなければ最後へ）
        el.addEventListener("click", () => {
            const at = questionAnswerSelectedKey ? keys.indexOf(questionAnswerSelectedKey) : -1;
            moveQuestionAnswer(item.key, at >= 0 ? at + 1 : keys.length);
        });
        bindLayoutDrag(el, item.key);
        questionAnswerPalette.appendChild(el);
    });
    if (visible.length === 0) {
        const note = document.createElement("p");
        note.className = "settings-help";
        note.textContent = "すべて答えに入っています。";
        questionAnswerPalette.appendChild(note);
    }
}

// 追加する質問の答えを既存のパネルから選ぶ（グループごと。見出しを押すとグループを丸ごと選ぶ／外す）
function renderQuestionPanelPicker() {
    if (!questionPanelPicker) return;
    questionPanelPicker.innerHTML = "";

    const groups = new Map();
    getAnswerPanelCatalog(simpleCustomDraft).forEach((p) => {
        const group = getSimplePanelGroup(p);
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(p);
    });

    groups.forEach((panels, group) => {
        const section = document.createElement("div");
        section.className = "question-picker-group";
        const allPicked = panels.every(p => questionPanelPickDraft.includes(p.id));
        const head = document.createElement("button");
        head.type = "button";
        head.className = "question-picker-head" + (allPicked ? " active" : "");
        head.textContent = `${group}${allPicked ? " ✓" : ""}`;
        head.title = allPicked ? "このグループを外す" : "このグループを丸ごと選ぶ";
        head.addEventListener("click", () => {
            if (allPicked) questionPanelPickDraft = questionPanelPickDraft.filter(id => !panels.some(p => p.id === id));
            else panels.forEach((p) => { if (!questionPanelPickDraft.includes(p.id)) questionPanelPickDraft.push(p.id); });
            renderQuestionPanelPicker();
        });
        section.appendChild(head);

        const chips = document.createElement("div");
        chips.className = "question-picker-chips";
        panels.forEach((p) => {
            const order = questionPanelPickDraft.indexOf(p.id);
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "question-picker-chip" + (order !== -1 ? " active" : "");
            chip.appendChild(createLayoutThumb(p, "question-picker-thumb"));
            const name = document.createElement("span");
            name.textContent = order !== -1 ? `${order + 1}. ${p.name}` : p.name;
            chip.appendChild(name);
            chip.title = buildSimpleSentence(p);
            chip.addEventListener("click", () => {
                if (order !== -1) questionPanelPickDraft.splice(order, 1);
                else questionPanelPickDraft.push(p.id);
                renderQuestionPanelPicker();
            });
            chips.appendChild(chip);
        });
        section.appendChild(chips);
        questionPanelPicker.appendChild(section);
    });

    if (questionPanelPickSummary) {
        questionPanelPickSummary.textContent = questionPanelPickDraft.length > 0
            ? `${questionPanelPickDraft.length} 枚を選択中（番号の順に並ぶ）`
            : "未選択";
    }
    if (questionPanelPickClearBtn) questionPanelPickClearBtn.disabled = questionPanelPickDraft.length === 0;
}

function clearQuestionPanelPick() {
    questionPanelPickDraft = [];
    renderQuestionPanelPicker();
}

function addCustomQuestion() {
    const question = questionCustomTextInput?.value.trim() || "";
    const answers = parseQuestionAnswers(questionCustomAnswersInput?.value || "");
    const panelIds = [...questionPanelPickDraft];
    if (!question) {
        alert("質問文を入力してください。");
        return;
    }
    if (answers.length + panelIds.length < 2) {
        alert("答えを2つ以上用意してください（パネルを選ぶか、1行に1つずつ入力）。");
        return;
    }
    const id = `qc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    questionCustomDraft.push({
        id,
        label: questionCustomLabelInput?.value.trim() || "",
        emoji: questionCustomEmojiInput?.value.trim() || "",
        question,
        answers,
        panelIds
    });
    questionOrderDraft.push(id);
    questionAnswerEditId = id;
    questionAnswerSelectedKey = null;
    questionCustomTextInput.value = "";
    if (questionCustomLabelInput) questionCustomLabelInput.value = "";
    if (questionCustomEmojiInput) questionCustomEmojiInput.value = "";
    questionCustomAnswersInput.value = "";
    questionPanelPickDraft = [];
    renderQuestionEditor();
    renderQuestionPanelPicker();
}

// 最初の答えと同じ並びに戻した質問は保存しない（パネルの増減や画面配置の変更に、元どおり追従させる）
function getQuestionAnswerLayoutsToSave() {
    const result = {};
    getQuestionCatalog(questionCustomDraft, questionOrderDraft).forEach((q) => {
        const keys = questionAnswerLayoutsDraft[q.id];
        if (!keys) return;
        const candidates = getQuestionAnswerCandidates(q, simpleCustomDraft);
        const defaults = getDefaultQuestionAnswerKeys(q, { customPanels: simpleCustomDraft, layoutIds: simpleLayoutDraft }).filter(key => candidates.has(key));
        if (keys.length === defaults.length && keys.every((key, i) => key === defaults[i])) return;
        result[q.id] = [...keys];
    });
    return result;
}

function saveQuestionEditor() {
    // 答えを全部外した質問は、出しても本人が答えられないので保存しない
    const empty = getQuestionCatalog(questionCustomDraft, questionOrderDraft).filter(q => questionAnswerLayoutsDraft[q.id]?.length === 0);
    if (empty.length > 0) {
        alert(`答えがない質問があります: ${empty.map(getQuestionLabel).join("、")}
設定 → 質問モード →「答えのパネル」で答えを追加するか、「最初の答えに戻す」を押してください。`);
        questionAnswerEditId = empty[0].id;
        activateSettingsTab("question-tab");
        return false;
    }
    const nextConfig = {
        hiddenIds: Array.from(questionHiddenDraft),
        speakQuestion: questionSpeakInput ? questionSpeakInput.checked : questionConfig.speakQuestion,
        order: [...questionOrderDraft],
        answerLayouts: getQuestionAnswerLayoutsToSave(),
        gridSize: questionGridSizeSelect ? questionGridSizeSelect.value : questionConfig.gridSize,
        knownIds: QUESTION_PRESETS.map(q => q.id)
    };
    try {
        localStorage.setItem(QUESTION_CUSTOM_KEY, JSON.stringify(questionCustomDraft));
        localStorage.setItem(QUESTION_CONFIG_KEY, JSON.stringify(nextConfig));
    } catch (error) {
        console.error("question save failed:", error);
        alert("質問の設定を保存できませんでした。");
        return false;
    }
    questionCustom = questionCustomDraft;
    questionConfig = nextConfig;
    // 回答中の質問が削除されたら終了する（質問モードは出す質問の先頭へ切り替える）
    if (isQuestionMode()) {
        // 答えのパネル（シンプルモードの画面配置・任意パネル）が変わったかもしれないので、読み上げずに出し直す
        if (activeQuestion && getVisibleQuestions().some(q => q.id === activeQuestion.id)) startQuestion(activeQuestion.id, { speak: false });
        else ensureQuestionModeQuestion();
    } else if (activeQuestion && !getQuestionCatalog().some(q => q.id === activeQuestion.id)) {
        endQuestion();
    }
    renderQuestionButtons();
    return true;
}

// 保存に失敗したら false（画像が多すぎて容量超過など）
function saveSimplePanelEditor() {
    const nextConfig = {
        gridSize: SIMPLE_GRID_SIZES[simpleGridSizeSelect?.value] ? simpleGridSizeSelect.value : simpleConfig.gridSize,
        panelIds: [...simpleLayoutDraft],
        showRest: simpleShowRestInput ? simpleShowRestInput.checked : simpleConfig.showRest,
        confirmSound: simpleConfirmSoundInput ? simpleConfirmSoundInput.checked : simpleConfig.confirmSound,
        dwellOverrides: sanitizeDwellOverrides(simpleDwellDraft)
    };
    try {
        localStorage.setItem(SIMPLE_CUSTOM_PANELS_KEY, JSON.stringify(simpleCustomDraft));
        localStorage.setItem(SIMPLE_CONFIG_KEY, JSON.stringify(nextConfig));
    } catch (error) {
        console.error("simple panel save failed:", error);
        alert("パネル設定を保存できませんでした。画像付きの任意パネルを減らしてください。");
        return false;
    }
    simpleCustomPanels = simpleCustomDraft.map(p => ({ ...p }));
    simpleConfig = nextConfig;
    // 休憩パネルを消したときに休憩中のまま戻れなくならないようにする
    if (!simpleConfig.showRest) isSimplePaused = false;
    return true;
}

// =========================================================
// Speech (Google Gemini TTS support & System fallback)
// =========================================================
let voices = [];
let preferredVoice = null;

let GEMINI_API_KEY = localStorage.getItem("gemini_api_key") || "";
let geminiAuthBlocked = false;

// TTSモデル: "cloud:<voice名>" (Google Cloud TTS) / "gemini:<モデル名>" (Gemini API TTS)
//   / "voicevox:<話者スタイルID>" (PCで起動した VOICEVOX) / "browser:" (ブラウザ内蔵の音声。通信なし)
const TTS_MODEL_KEY = "tts_model";
const TTS_BROWSER_MODEL = "browser:";
const VOICEVOX_URL_KEY = "voicevox_url";
const VOICEVOX_SPEAKERS_KEY = "voicevox_speakers";
const DEFAULT_VOICEVOX_URL = "http://127.0.0.1:50021";
const TTS_MODEL_LIST_KEY = "tts_model_list";
const DEFAULT_TTS_MODEL = "cloud:ja-JP-Neural2-B";
const GEMINI_VOICE_KEY = "gemini_tts_voice";
const GEMINI_STYLE_KEY = "gemini_tts_style";
const DEFAULT_GEMINI_VOICE = "Zephyr";
const DEFAULT_GEMINI_STYLE = "明るく、はきはきと、元気な若い日本人女性の声で、聞き取りやすく読み上げてください";
// Gemini TTS のプリセット話者 (日本語も発話可)。女性声を先頭に並べる
const GEMINI_VOICES = [
    { name: "Zephyr", label: "Zephyr (女性・明るい)" },
    { name: "Autonoe", label: "Autonoe (女性・明るい)" },
    { name: "Laomedeia", label: "Laomedeia (女性・アップビート)" },
    { name: "Leda", label: "Leda (女性・若々しい)" },
    { name: "Aoede", label: "Aoede (女性・軽やか)" },
    { name: "Erinome", label: "Erinome (女性・クリア)" },
    { name: "Kore", label: "Kore (女性・しっかり)" },
    { name: "Callirrhoe", label: "Callirrhoe (女性・おおらか)" },
    { name: "Despina", label: "Despina (女性・なめらか)" },
    { name: "Vindemiatrix", label: "Vindemiatrix (女性・やさしい)" },
    { name: "Sulafat", label: "Sulafat (女性・温かい)" },
    { name: "Achernar", label: "Achernar (女性・柔らかい)" },
    { name: "Puck", label: "Puck (男性・アップビート)" },
    { name: "Fenrir", label: "Fenrir (男性・興奮気味)" },
    { name: "Charon", label: "Charon (男性・情報的)" },
    { name: "Orus", label: "Orus (男性・しっかり)" }
];
const GEMINI_TTS_SAMPLE_RATE = 24000;

let ttsModel = localStorage.getItem(TTS_MODEL_KEY) || DEFAULT_TTS_MODEL;
let voicevoxUrl = localStorage.getItem(VOICEVOX_URL_KEY) || DEFAULT_VOICEVOX_URL;
let geminiVoice = localStorage.getItem(GEMINI_VOICE_KEY) || DEFAULT_GEMINI_VOICE;
let geminiStyle = localStorage.getItem(GEMINI_STYLE_KEY) ?? DEFAULT_GEMINI_STYLE;

function readStoredList(key) {
    try {
        const list = JSON.parse(localStorage.getItem(key) || "[]");
        return Array.isArray(list) ? list.filter(m => m && typeof m.value === "string") : [];
    } catch (_) {
        return []; // 破損時は空
    }
}

// 選べる音声: ブラウザ内蔵（常に）+ VOICEVOX の話者（取得済みなら）+ Google の一覧（取得済みなら既定のみ）
function loadTtsModelList() {
    const google = readStoredList(TTS_MODEL_LIST_KEY);
    return [
        { value: TTS_BROWSER_MODEL, label: "ブラウザ内蔵の音声（無料・通信なし・遅延なし）" },
        ...readStoredList(VOICEVOX_SPEAKERS_KEY),
        ...(google.length ? google : [{ value: DEFAULT_TTS_MODEL, label: "Cloud TTS: ja-JP-Neural2-B" }])
    ];
}

function getTtsProvider(model = ttsModel) {
    return model.split(":")[0];
}

function getVoicevoxBaseUrl(url = voicevoxUrl) {
    return (url || DEFAULT_VOICEVOX_URL).trim().replace(/\/+$/, "");
}

// VOICEVOX ENGINE: audio_query で読み方を作り、synthesis で WAV にする
async function requestVoicevoxTts(text, speaker, signal, opts = {}) {
    const base = getVoicevoxBaseUrl(opts.voicevoxUrl);
    const speakerId = encodeURIComponent(speaker);
    let queryResponse;
    try {
        queryResponse = await fetch(`${base}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`, { method: "POST", signal });
    } catch (error) {
        if (error.name === "AbortError") throw error;
        throw new Error(`VOICEVOX に接続できません（${base}）。VOICEVOX を起動し、CORS の許可を確認してください。`);
    }
    if (!queryResponse.ok) throw new Error(`VOICEVOX Error: ${queryResponse.status}`);
    const query = await queryResponse.json();
    let response;
    try {
        response = await fetch(`${base}/synthesis?speaker=${speakerId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(query),
            signal
        });
    } catch (error) {
        if (error.name === "AbortError") throw error;
        throw new Error(`VOICEVOX との通信が切れました（${base}）。VOICEVOX が起動しているか確認してください。`);
    }
    if (!response.ok) throw new Error(`VOICEVOX Error: ${response.status}`);
    return new Blob([await response.arrayBuffer()], { type: "audio/wav" });
}

async function fetchVoicevoxSpeakers(url) {
    const base = getVoicevoxBaseUrl(url);
    let response;
    try {
        response = await fetch(`${base}/speakers`);
    } catch {
        throw new Error(`VOICEVOX に接続できません（${base}）。VOICEVOX を起動し、CORS の許可を確認してください。`);
    }
    if (!response.ok) throw new Error(`VOICEVOX Error: ${response.status}`);
    const speakers = await response.json();
    // 歌唱用などの話せないスタイルは除く（type が無い古いエンジンは話す用とみなす）
    return (Array.isArray(speakers) ? speakers : []).flatMap(speaker => (speaker.styles || [])
        .filter(style => !style.type || style.type === "talk")
        .map(style => ({
        value: `voicevox:${style.id}`,
        label: `VOICEVOX: ${speaker.name}（${style.name}）`,
        credit: `VOICEVOX:${speaker.name}`
    })));
}

// 選んでいる音声で1文を合成する（キャッシュは見ない）。ブラウザ内蔵は合成しない
async function synthesizeSpeech(phrase, signal, opts = {}) {
    const model = opts.model ?? ttsModel;
    const provider = getTtsProvider(model);
    const name = model.slice(provider.length + 1);
    if (provider === "voicevox") return requestVoicevoxTts(phrase, name, signal, opts);
    if (provider === "gemini") return requestGeminiTts(phrase, name, signal, opts);
    return requestCloudTts(phrase, name || "ja-JP-Neural2-B", signal, opts);
}

// 今の音声設定で合成できるか（ブラウザ内蔵、キー未設定、認証エラー後は不可）
function canSynthesizeSpeech() {
    const provider = getTtsProvider();
    if (provider === "browser") return false;
    if (provider === "voicevox") return true;
    if (ttsDailyLimitModel === ttsModel) return false;
    return Boolean(GEMINI_API_KEY) && !geminiAuthBlocked;
}

function getCloudTtsUrl(apiKey) {
    return `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${apiKey}`;
}

function getGeminiTtsUrl(model, apiKey) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
}

// 音声は文ごとに1つだけ保存し、どのモデル・話者で作ったものも使う
// （無料枠を使い切ったら別のモデルで残りを作れるように。モデルを変えても作り直さない）
function audioCacheKey(text) {
    return text;
}

// 以前はモデル・話者ごとに別の名前で保存していた（"モデル|文"、Gemini は "モデル|話者|口調|文"、
// VOICEVOX は "voicevox:番号@接続先|文"）。文だけの名前にまとめる。同じ文が複数あれば、
// 文だけの名前のもの → 今のモデルで作ったもの → それ以外 の順に残す
const PREFIXED_AUDIO_KEY = /^(cloud|gemini|voicevox):[^|]*\|/;

function textFromPrefixedAudioKey(key) {
    const parts = key.split("|");
    return (key.startsWith("gemini:") ? parts.slice(3) : parts.slice(1)).join("|");
}

function mergeAudioCacheKeys() {
    if (!db) return Promise.resolve(0);
    return new Promise((resolve) => {
        let merged = 0;
        try {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAllKeys();
            request.onsuccess = () => {
                const keys = request.result.map(String);
                const prefixed = keys.filter(k => PREFIXED_AUDIO_KEY.test(k));
                if (prefixed.length === 0) return;
                const saved = new Set(keys.filter(k => !PREFIXED_AUDIO_KEY.test(k)));
                const isCurrent = (k) => k.startsWith(`${ttsModel}|`) || k.startsWith(`${ttsModel}@`);
                [...prefixed.filter(isCurrent), ...prefixed.filter(k => !isCurrent(k))].forEach((key) => {
                    const text = textFromPrefixedAudioKey(key);
                    if (!text || saved.has(text)) {
                        store.delete(key);
                        return;
                    }
                    saved.add(text);
                    merged++;
                    const get = store.get(key);
                    get.onsuccess = () => {
                        if (get.result) store.put(get.result, text);
                        store.delete(key);
                    };
                });
            };
            tx.oncomplete = () => resolve(merged);
            tx.onerror = () => resolve(0);
            tx.onabort = () => resolve(0);
        } catch (error) {
            console.warn("audio cache merge failed:", error);
            resolve(0);
        }
    });
}

async function fetchAvailableTtsModels(apiKey) {
    const models = [];
    const errors = [];

    try {
        const res = await fetch(`https://texttospeech.googleapis.com/v1/voices?languageCode=ja-JP&key=${apiKey}`);
        if (!res.ok) throw new Error(`Cloud TTS ${res.status}`);
        const data = await res.json();
        (data.voices || [])
            .map(v => v.name)
            .sort()
            .forEach(name => models.push({ value: `cloud:${name}`, label: `Cloud TTS: ${name}` }));
    } catch (err) {
        errors.push(err.message);
    }

    try {
        let pageToken = "";
        do {
            const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${apiKey}` +
                (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Gemini ${res.status}`);
            const data = await res.json();
            (data.models || [])
                .filter(m => /tts/i.test(m.name) && (m.supportedGenerationMethods || []).includes("generateContent"))
                .forEach(m => {
                    const id = m.name.replace(/^models\//, "");
                    models.push({ value: `gemini:${id}`, label: `Gemini: ${m.displayName || id} (${id})` });
                });
            pageToken = data.nextPageToken || "";
        } while (pageToken);
    } catch (err) {
        errors.push(err.message);
    }

    return { models, errors };
}

function pcm16ToWavBlob(pcmBytes, sampleRate) {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + pcmBytes.length, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, pcmBytes.length, true);
    return new Blob([header, pcmBytes], { type: "audio/wav" });
}

function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function throwIfTtsError(response, blockOnAuthError) {
    if (response.ok) return;
    const errorBody = await response.text().catch(() => "");
    if (blockOnAuthError && (response.status === 401 || response.status === 403)) {
        geminiAuthBlocked = true;
    }
    const error = new Error(`API Error: ${response.status}${errorBody ? ` ${errorBody}` : ""}`);
    error.status = response.status;
    error.body = errorBody;
    throw error;
}

// 429（回数制限）の中身。retryMs: 待てば再開できる時間（応答の RetryInfo）、daily: 1日の上限に達した
function parseTtsRateLimit(error) {
    if (error?.status !== 429) return null;
    let details = [];
    let message = "";
    try {
        const data = JSON.parse(error.body || "{}");
        details = data?.error?.details || [];
        message = data?.error?.message || "";
    } catch {
        message = error.body || "";
    }
    const retryDelay = details.find(d => String(d?.["@type"] || "").endsWith("RetryInfo"))?.retryDelay;
    const seconds = Number.parseFloat(String(retryDelay || ""));
    const quotaIds = details.flatMap(d => (d?.violations || []).map(v => String(v?.quotaId || v?.quotaMetric || "")));
    const daily = quotaIds.some(id => /per ?day/i.test(id)) || /per day|daily/i.test(message);
    return { retryMs: Number.isFinite(seconds) ? seconds * 1000 : null, daily };
}

// 画面に出す短い説明（API の生の応答は長く、読んでも分かりにくい）
function describeTtsError(error) {
    const limit = parseTtsRateLimit(error);
    if (limit?.daily) return "音声サービスの1日の上限（無料枠）に達しました。続きは明日、または音声を Cloud TTS か VOICEVOX に変えてください";
    if (limit) return "音声サービスの回数制限（429）に達しました。しばらく待つと続けられます";
    if (error?.status === 401 || error?.status === 403) return "API Key が使えません（設定 → 音声 で確認してください）";
    return String(error?.message || error).slice(0, 80);
}

// 1日の上限に達した音声設定。その日はそれ以上頼まず、保存済みの音声とブラウザの音声で話す（設定を保存すると解除）
let ttsDailyLimitModel = null;

// opts: { apiKey, voice, style, preview } — 省略時は保存済み設定を使う。preview は試聴用で認証エラー時も発話をブロックしない
async function requestCloudTts(text, voiceName, signal, opts = {}) {
    const requestBody = {
        audioConfig: {
            audioEncoding: "LINEAR16",
            pitch: 0,
            speakingRate: 1.05
        },
        input: {
            text
        },
        voice: {
            languageCode: "ja-JP",
            name: voiceName
        }
    };

    const response = await fetch(getCloudTtsUrl(opts.apiKey ?? GEMINI_API_KEY), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal
    });
    await throwIfTtsError(response, !opts.preview);

    const data = await response.json();
    const base64Audio = data.audioContent || data.audio;
    if (!base64Audio) {
        throw new Error("No audio content in response");
    }
    return new Blob([base64ToBytes(base64Audio)], { type: "audio/wav" });
}

async function requestGeminiTts(text, model, signal, opts = {}) {
    const style = opts.style ?? geminiStyle;
    const voice = opts.voice ?? geminiVoice;
    const requestBody = {
        // 口調は自然文で指示する (例: "明るく読み上げてください: こんにちは")
        contents: [{ parts: [{ text: style ? `${style}:\n${text}` : text }] }],
        generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }
            }
        }
    };

    const response = await fetch(getGeminiTtsUrl(model, opts.apiKey ?? GEMINI_API_KEY), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal
    });
    await throwIfTtsError(response, !opts.preview);

    const data = await response.json();
    const part = (data.candidates?.[0]?.content?.parts || []).find(p => p.inlineData?.data);
    if (!part) {
        throw new Error("No audio content in response");
    }
    // Gemini は audio/L16;codec=pcm;rate=24000 の生PCMを返すため WAV ヘッダを付与
    const mime = part.inlineData.mimeType || "";
    const bytes = base64ToBytes(part.inlineData.data);
    if (/wav/i.test(mime)) return new Blob([bytes], { type: "audio/wav" });
    const rate = Number.parseInt((mime.match(/rate=(\d+)/) || [])[1], 10) || GEMINI_TTS_SAMPLE_RATE;
    return pcm16ToWavBlob(bytes, rate);
}

let currentAudio = null;
let currentAudioResolve = null;
const SPEECH_SYNTH_TIMEOUT_MS = 30000;
// 話す文の音声を作っている数。裏の作成（prefetch）は、これが 0 になるまで待つ
let speechFetchCount = 0;
// 最後に頼まれた発話の番号。作り終えたとき別の文に変わっていたら、保存だけして流さない
let speechRequestSeq = 0;

const DB_NAME = "AudioCacheDB";
const STORE_NAME = "audioBlobs";
let db = null;

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const dbObj = e.target.result;
            if (!dbObj.objectStoreNames.contains(STORE_NAME)) {
                dbObj.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

async function getCachedAudio(text) {
    if (!db) return null;
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(text);
        request.onsuccess = () => resolve(request.result && request.result.size >= AUDIO_MIN_BYTES ? request.result : null);
        request.onerror = () => resolve(null);
    });
}

// 容量不足などで保存できなくても待ち続けない（待ち続けると以後の発話が止まる）
async function setCachedAudio(text, blob) {
    if (!db) return false;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_NAME, "readwrite");
            tx.objectStore(STORE_NAME).put(blob, text);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
            tx.onabort = () => resolve(false);
        } catch (error) {
            console.warn("audio cache save failed:", error);
            resolve(false);
        }
    });
}

function deleteCachedAudio(text) {
    if (!db) return;
    try {
        db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(text);
    } catch (error) {
        console.warn("audio cache delete failed:", error);
    }
}

// 壊れた・空の音声は使わない（再生できずに無音になるのを防ぐ）
const AUDIO_MIN_BYTES = 100;

function clearAudioCache() {
    if (!db) return;
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
}

function initVoices() {
    voices = window.speechSynthesis.getVoices();
    // 日本語の声の中から、自然な声（Edge の Nanami / Natural / Online）を優先する
    const japanese = voices.filter(v => (v.lang || "").toLowerCase().replace("_", "-").startsWith("ja"));
    preferredVoice = japanese.find(v => v.name.includes("Nanami"))
        || japanese.find(v => v.name.includes("Natural") || v.name.includes("Online"))
        || japanese[0]
        || null;
}
window.speechSynthesis.onvoiceschanged = initVoices;
initVoices();

async function speakGemini(text, silent = false) {
    // 前の文の音声を作っている途中でも、新しい文はすぐ話す。前の文は作り終えたら保存だけする
    const seq = ++speechRequestSeq;
    const isLatest = () => seq === speechRequestSeq;
    // ブラウザ内蔵の音声を選んでいれば、合成もキャッシュも使わない
    if (getTtsProvider() === "browser") return false;

    const phrase = text.trim();
    const cacheKey = audioCacheKey(phrase);
    const cachedBlob = await getCachedAudio(cacheKey);
    if (cachedBlob) {
        if (silent || !isLatest()) return true;
        // 読めない音声は消して、ブラウザ内蔵の音声で話す（次は作り直す）
        if (await playBlob(cachedBlob) !== "invalid") return true;
        deleteCachedAudio(cacheKey);
        return !isLatest();
    }

    // 別の文に切り替わっていれば、この文をブラウザの音声で話さない
    if (!canSynthesizeSpeech()) return !isLatest();

    speechFetchCount += 1;
    try {
        // 応答が返らないと裏の作成が待ち続けるので、時間で打ち切る
        const blob = await synthesizeSpeech(phrase, AbortSignal.timeout(SPEECH_SYNTH_TIMEOUT_MS));
        // 初めて話した文も、作れた音声は保存して次からすぐ話す
        if (blob.size >= AUDIO_MIN_BYTES) await setCachedAudio(cacheKey, blob);

        // 作っている間に次の文へ切り替わっていたら流さない（作った音声は保存済み）
        if (!silent && isLatest()) {
            await playBlob(blob);
        }
        return true;
    } catch (err) {
        console.error("Gemini TTS Error:", err);
        if (parseTtsRateLimit(err)?.daily) ttsDailyLimitModel = ttsModel;
        // 別の文に切り替わっていれば、この文をブラウザの音声で話し直さない
        return !isLatest();
    } finally {
        speechFetchCount -= 1;
    }
}

function playBlob(blob) {
    return new Promise((resolve) => {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            if (currentAudioResolve) {
                currentAudioResolve();
                currentAudioResolve = null;
            }
        }

        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        let settled = false;
        // 結果: "ended"（再生した・止められた）/ "invalid"（音声データとして読めない）/ "blocked"（再生を許可されなかった等）
        const finish = (result = "ended") => {
            if (settled) return;
            settled = true;
            URL.revokeObjectURL(url);
            if (currentAudio === audio) currentAudio = null;
            if (currentAudioResolve === finish) currentAudioResolve = null;
            resolve(result);
        };

        currentAudio = audio;
        currentAudioResolve = finish;
        audio.onended = () => finish("ended");
        audio.onerror = () => {
            const code = audio.error?.code;
            finish(code === 3 || code === 4 ? "invalid" : "blocked");
        };
        audio.play().catch((error) => finish(error?.name === "NotSupportedError" ? "invalid" : "blocked"));
    });
}

// 前もって音声にしておく文: パネルを選んですぐ話す文（症状・シンプルモード・質問と答え）だけ。
// お話モードの文は数が多く使わないものも多いので作らない（話したときに作った音声を保存して、次からすぐ話す）
function collectPrefetchPhrases() {
    const phrases = [];

    symptomChoices.forEach(category => {
        (category.options || []).forEach(option => {
            const sentence = (option.sentence || `${option.name}です。`).trim();
            if (sentence) phrases.push(sentence);
        });
    });

    getSimpleCatalog().forEach(panel => {
        phrases.push(buildSimpleSentence(panel));
    });

    getQuestionCatalog().forEach(q => {
        if (!q.silent) phrases.push(q.question);
        getQuestionAnswers(q).forEach(answer => phrases.push(buildSimpleSentence(answer)));
    });

    // お話モードの相づちタブもパネルを選んですぐ話すので作る
    TALK_AIZUCHI.forEach(item => phrases.push(item.sentence));

    return Array.from(new Set(phrases.map(p => (p || "").trim()).filter(Boolean)));
}

// 音声の作成は1つずつ。作成中に呼ばれたら、終わってからもう一度（増えた文だけ）作る
let isPrefetchRunning = false;
let prefetchQueued = null; // 次に作るときの { quiet }

// 合成の間隔: Gemini TTS は回数制限が厳しいので空ける。VOICEVOX は手元の PC で1つずつ合成するので、話す分の余裕を少し空ける
// 回数制限（429）で待つとき: 応答に待ち時間が無ければ 30 秒、長くても 5 分。続けて 6 回来たら止める
const PREFETCH_RATE_LIMIT_DEFAULT_WAIT_MS = 30000;
const PREFETCH_RATE_LIMIT_MAX_WAIT_MS = 300000;
const PREFETCH_RATE_LIMIT_MAX_WAITS = 6;

function getPrefetchIntervalMs() {
    const provider = getTtsProvider();
    if (provider === "gemini") return 600;
    return 150;
}

// 設定の音声タブ: 話す文のうち何件の音声が保存済みか（どのモデルで作ったものも数える）
function renderAudioCacheSummary(saved, total) {
    const el = document.getElementById("audio-cache-summary");
    if (!el) return;
    el.textContent = `保存済み ${saved} / ${total} 文${saved >= total ? " ✓ すべてそろっています" : ""}`;
}

let audioCacheSummarySeq = 0;
async function updateAudioCacheSummary() {
    const el = document.getElementById("audio-cache-summary");
    if (!el) return;
    const seq = ++audioCacheSummarySeq;
    if (getTtsProvider() === "browser") {
        el.textContent = "ブラウザ内蔵の音声を使用中（保存は不要）";
        return;
    }
    if (!db) {
        el.textContent = "音声を保存できません（このブラウザでは保存領域が使えません）";
        return;
    }
    const total = collectPrefetchPhrases().length;
    const missing = (await getMissingPrefetchPhrases()).length;
    if (seq !== audioCacheSummarySeq) return;
    renderAudioCacheSummary(total - missing, total);
}

// 保存済みのキーを一度に読む（1文ずつ読むと千件以上の読み出しになる）
function getCachedAudioKeys() {
    if (!db) return Promise.resolve(new Set());
    return new Promise((resolve) => {
        try {
            const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAllKeys();
            request.onsuccess = () => resolve(new Set(request.result));
            request.onerror = () => resolve(new Set());
        } catch {
            resolve(new Set());
        }
    });
}

// まだ音声にしていない文
async function getMissingPrefetchPhrases() {
    const saved = await getCachedAudioKeys();
    const missing = [];
    for (const text of collectPrefetchPhrases()) {
        if (!saved.has(audioCacheKey(text))) missing.push(text);
    }
    return missing;
}

// 話している・話す音声を作っている間は、裏の作成を待つ（VOICEVOX は1つずつしか合成できず、発話が遅れるため）
async function waitForSpeechIdle() {
    while (speechFetchCount > 0 || currentAudio) await new Promise(r => setTimeout(r, 200));
}

// まだ音声にしていない文だけ作る。話すときの合成（speakGemini）とは別に動くので、作成中も話せる
// quiet: 作るものが無ければ何も表示しない（自動で作るとき）
async function prefetchAllAudio({ quiet = false } = {}) {
    if (!canSynthesizeSpeech()) {
        // 手動で押したときは、作らない理由を表示する（何も出ないと押せていないように見える）
        if (!quiet) {
            [document.getElementById("audio-status-voice")].filter(Boolean).forEach((box) => {
                box.style.display = "block";
                const label = box.querySelector(".status-label");
                if (label) label.textContent = ttsDailyLimitModel === ttsModel
                    ? "⚠ 音声サービスの1日の上限（無料枠）に達しているため作れません"
                    : "⚠ 音声を作れません（API Key・TTSモデルを確認してください）";
            });
        }
        return;
    }
    if (isPrefetchRunning) {
        // 手動で押されたら、次の回は進み具合を表示する
        prefetchQueued = { quiet: (prefetchQueued?.quiet ?? true) && quiet };
        if (!quiet) {
            [document.getElementById("audio-status-voice")].filter(Boolean).forEach((box) => {
                box.style.display = "block";
                const label = box.querySelector(".status-label");
                if (label) label.textContent = "音声を作成中です（終わったら続けて残りを作ります）";
            });
        }
        return;
    }
    isPrefetchRunning = true;

    // 進み具合は設定の音声タブに出す
    const statusBoxes = [document.getElementById("audio-status-voice")].filter(Boolean);
    const showStatus = (text, pct) => {
        statusBoxes.forEach((box) => {
            box.style.display = "block";
            const label = box.querySelector(".status-label");
            const fill = box.querySelector(".status-progress-fill");
            if (label) label.textContent = text;
            if (fill && pct !== undefined) fill.style.width = `${pct}%`;
        });
    };
    const hideStatus = (ms) => setTimeout(() => {
        if (!isPrefetchRunning) statusBoxes.forEach((box) => { box.style.display = "none"; });
    }, ms);
    // 作り始めた音声の設定で作る（途中で設定が変わったら止める）
    const model = ttsModel;
    let missing = [];
    let createdCount = 0;
    let failed = null;
    let stopped = false;

    let total = 0;
    try {
        if (!db) throw new Error("このブラウザでは音声を保存できません");
        if (!quiet) showStatus("作る文を調べています…", 0);
        total = collectPrefetchPhrases().length;
        missing = await getMissingPrefetchPhrases();
        let rateLimitWaits = 0;
        for (let i = 0; i < missing.length; i++) {
            const text = missing[i];
            if (ttsModel !== model || !canSynthesizeSpeech()) {
                stopped = true;
                break;
            }
            showStatus(`音声を作成中: ${createdCount}/${missing.length}`, (createdCount / missing.length) * 100);
            await waitForSpeechIdle();
            try {
                const blob = await synthesizeSpeech(text, undefined, { model });
                if (blob.size >= AUDIO_MIN_BYTES) await setCachedAudio(audioCacheKey(text), blob);
                createdCount++;
                rateLimitWaits = 0;
                // 数え直さず、作った分だけ件数を進める
                if (ttsModel === model) renderAudioCacheSummary(total - (missing.length - createdCount), total);
            } catch (error) {
                const limit = parseTtsRateLimit(error);
                // 1分あたりの回数制限は、言われた時間だけ待って同じ文からやり直す（続けて何度も来たらあきらめる）
                if (limit && !limit.daily && rateLimitWaits < PREFETCH_RATE_LIMIT_MAX_WAITS) {
                    rateLimitWaits++;
                    const waitMs = clamp(limit.retryMs ?? PREFETCH_RATE_LIMIT_DEFAULT_WAIT_MS, 1000, PREFETCH_RATE_LIMIT_MAX_WAIT_MS) + 1000;
                    showStatus(`回数制限のため ${Math.ceil(waitMs / 1000)} 秒待ってから続けます（${createdCount}/${missing.length}）`, (createdCount / missing.length) * 100);
                    await new Promise(r => setTimeout(r, waitMs));
                    i--;
                    continue;
                }
                if (limit?.daily) ttsDailyLimitModel = model;
                console.error("audio prefetch failed:", error);
                failed = error;
                break;
            }
            const interval = getPrefetchIntervalMs();
            if (interval > 0) await new Promise(r => setTimeout(r, interval));
        }
    } catch (error) {
        // 作る文を調べる段階の失敗（保存領域が使えないなど）
        console.error("audio prefetch setup failed:", error);
        failed = error;
    } finally {
        isPrefetchRunning = false;
    }

    if (failed) {
        showStatus(`⚠ 音声の作成を中断しました（${createdCount}/${missing.length}）: ${describeTtsError(failed)}`, 0);
        hideStatus(20000);
    } else if (stopped) {
        showStatus("音声の設定が変わったため、作成を止めました", 0);
        hideStatus(3000);
    } else if (createdCount > 0 || !quiet) {
        showStatus(createdCount > 0 ? `✓ 音声を ${createdCount} 件作りました（すべてそろっています）` : "✓ すべての文の音声がそろっています", 100);
        hideStatus(4000);
    }

    void updateAudioCacheSummary();
    if (prefetchQueued) {
        const next = prefetchQueued;
        prefetchQueued = null;
        void prefetchAllAudio(next);
    }
}

async function speak(text) {
    window.speechSynthesis.cancel();
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
        if (currentAudioResolve) {
            currentAudioResolve();
            currentAudioResolve = null;
        }
    }

    const success = await speakGemini(text);
    if (success) return;

    await new Promise((resolve) => {
        const uttr = new SpeechSynthesisUtterance(text);
        if (preferredVoice) uttr.voice = preferredVoice;
        uttr.lang = "ja-JP";
        uttr.rate = 0.95;
        uttr.onend = () => resolve();
        uttr.onerror = () => resolve();
        window.speechSynthesis.speak(uttr);
    });
}

function flashScreen() {
    const flash = document.createElement("div");
    flash.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.4);z-index:3000;pointer-events:none;";
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 120);
}

// =========================================================
// Webcam / face detection loop
// =========================================================
let drawingUtils = null;
let lastRenderTimeMs = null;

async function predictWebcam() {
    // canvas のサイズ代入は毎回バッファを作り直すので、変化したときだけ行う
    if (canvasElement.width !== video.videoWidth) canvasElement.width = video.videoWidth;
    if (canvasElement.height !== video.videoHeight) canvasElement.height = video.videoHeight;
    const startTimeMs = performance.now();
    // rAF(60Hz) はカメラ(30fps前後)より速い。同じ推論結果で移動計算を二重に回さない
    let isNewFrame = false;
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        results = faceLandmarker.detectForVideo(video, startTimeMs);
        isNewFrame = true;
    }

    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    if (!drawingUtils) drawingUtils = new DrawingUtils(canvasCtx);
    const primaryLandmarks = results?.faceLandmarks?.[0] || null;
    updateGestureDetection(results, primaryLandmarks);
    let hasFace = false;

    if (results.faceLandmarks) {
        for (const [faceIndex, landmarks] of results.faceLandmarks.entries()) {
            hasFace = true;
            drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: "#808080CC", lineWidth: 1.5 });
            if (FaceLandmarker.FACE_LANDMARKS_LIPS) {
                const isJawVisualOpen = isJawOpenVisualActive();
                const lipsColor = isJawVisualOpen ? "#ff5252" : "#00e676";
                drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, {
                    color: lipsColor,
                    lineWidth: isJawVisualOpen ? 3.2 : 2.5
                });
            }

            drawMouthDetectionOverlay(landmarks);

            const nose = landmarks[4];
            if (isNewFrame && faceIndex === 0 && needsStartupFrontRegistration) {
                // 絶対方式は正面がずれると全体がずれるので、起動時に正面を登録する（10秒止まれなければ今の姿勢で始める）。
                // 設定画面を開いている間は待つ
                if (pointerMode !== POINTER_MODE_ABSOLUTE || calibrationWizard.isActive()) {
                    needsStartupFrontRegistration = false;
                } else if (!isSettingsOpen()) {
                    needsStartupFrontRegistration = false;
                    startFrontRecapture();
                }
            }
            if (isNewFrame && faceIndex === 0 && calibrationWizard.isActive()) {
                calibrationWizard.onFrame(landmarks, results, startTimeMs);
            } else if (isNewFrame && !calibrationWizard.isActive() && !isSettingsOpen()) {
                // 設定画面を開いている間はポインタを動かさない
                updateRelativePointerTarget(nose.x, landmarks, results, faceIndex, startTimeMs);
            }
            trackSymptomActivityByMovement(nose.x, nose.y);
        }
    }

    // 目標位置への追従はフレームレートに依存しない指数平滑で行う
    const frameDtMs = lastRenderTimeMs === null ? 16.7 : clamp(startTimeMs - lastRenderTimeMs, 1, 100);
    lastRenderTimeMs = startTimeMs;
    const followAlpha = 1 - Math.exp(-frameDtMs / FOLLOW_TIME_CONSTANT_MS);
    if (!isSettingsOpen()) {
        pointerX += (targetX - pointerX) * followAlpha;
        pointerY += (targetY - pointerY) * followAlpha;
    }
    // left/top はレイアウトを毎フレーム走らせるので transform で動かす
    pointerElement.style.setProperty("--pointer-x", `${pointerX}px`);
    pointerElement.style.setProperty("--pointer-y", `${pointerY}px`);

    if (!hasFace) {
        debugDeltaN = 0;
        debugDeltaY = 0;
        debugPixN = 0;
        debugPixY = 0;
        debugDeltaX = 0;
        debugDeltaNoseY = 0;
        debugDeltaPitch = 0;
        debugDeltaYPx = 0;
        speedXEma = 0;
        speedYEma = 0;
        axisLockDominant = null;
    }
    updateTelemetryPanel(hasFace);
    if (!hasFace && calibrationWizard.isActive()) calibrationWizard.onNoFace();

    checkPointerCollision();
    // 設定画面を開いている間は確定・段階移動・自動復帰をすべて止める
    const isSuspended = isSettingsOpen();
    document.body.classList.toggle("settings-open", isSuspended);
    updateDwellSelection(hasFace && !isSuspended);
    if (hasFace && !isSuspended) {
        updateVerticalStageTransition();
    }
    if (!isSuspended) {
        checkSymptomIdleReset();
        checkQuestionTimeout();
    }
    window.requestAnimationFrame(predictWebcam);
}

let isMouthOpen = false;
let gestureCooldown = false;
const GESTURE_COOLDOWN_MS = 800;
const JAW_OPEN_REQUIRED_FRAMES = 5;
const JAW_OPEN_HYSTERESIS = 0.08;
const JAW_OPEN_SMOOTHING_ALPHA = 0.35;
const CONFIRM_COOLDOWN_MS = 100;
const CLICK_DELAY_MS = 180;
const CLICK_FEEDBACK_MS = 320;
const CLOSE_CLICK_MIN_OPEN_MS = 140;
const JAW_OPEN_RAW_MIN = 0.12;
const JAW_OPEN_MIN_DELTA_FROM_BASELINE = 0.045;
const FACE_REACQUIRE_GUARD_MS = 650;
const JAW_RAW_MEDIAN_WINDOW = 5;
const MOUTH_RATIO_OPEN_MIN = 0.03;
const MOUTH_RATIO_DELTA_MIN = 0.011;
const MOUTH_RATIO_BASELINE_ALPHA = 0.08;
const MOUTH_RATIO_CLOSE_ABS_MAX = 0.02;
const MOUTH_RATIO_CLOSE_DELTA_MAX = 0.004;
const JAW_CLOSE_RAW_ABS_MAX = 0.1;
const MAX_MOUTH_OPEN_HOLD_MS = 1400;
let jawOpenConsecutiveFrames = 0;
let jawOpenRawScore = 0;
let jawOpenRawInstantScore = 0;
let jawOpenFilteredScore = 0;
let lastConfirmedAt = 0;
let pendingClickTimer = null;
let pendingClickTargetKey = "";
let clickFeedbackUntil = 0;
let closeClickEligible = false;
let mouthOpenedAt = 0;
let jawClosedBaseline = null;
let mouthOpenRatio = 0;
let mouthOpenRatioBaseline = null;
let debugJawOpenThreshold = 0;
let debugJawCloseThreshold = 0;
let jawRawRecent = [];
let wasFaceBlendshapeAvailable = false;
let faceJustReacquiredUntil = 0;
let loggedReacquireGuard = false;
const JAW_BASELINE_ALPHA = 0.08;
const JAW_CLOSE_RATIO = 0.45;
const JAW_CLOSE_MIN_GAP = 0.02;
const JAW_OPEN_THRESHOLD_GAIN = 0.72;
const JAW_BASELINE_MAX = 0.11;
const JAW_OPEN_ABS_MIN = 0.115;
const JAW_CLOSE_ABS_MIN = 0.075;
const CLICK_DEBUG_LOG = true;
const CLICK_DEBUG_CONSOLE = false;
const CLICK_DEBUG_MAX_ENTRIES = 6000;
const CLICK_DEBUG_STORAGE_KEY = "click_debug_log_entries_v1";
const CLICK_DEBUG_SEQ_STORAGE_KEY = "click_debug_log_seq_v1";
const CLICK_DEBUG_AUTO_PERSIST = true;
const CLICK_DEBUG_PERSIST_INTERVAL_MS = 1200;
let clickDebugSeq = 0;
let clickDebugEntries = [];
let clickDebugPersistTimer = null;

function persistClickDebugToLocalStorage() {
    if (!CLICK_DEBUG_AUTO_PERSIST) return;
    try {
        localStorage.setItem(CLICK_DEBUG_STORAGE_KEY, JSON.stringify(clickDebugEntries));
        localStorage.setItem(CLICK_DEBUG_SEQ_STORAGE_KEY, String(clickDebugSeq));
    } catch (err) {
        if (CLICK_DEBUG_CONSOLE) {
            console.warn("[CLICK_DEBUG] localStorage persist failed", err);
        }
    }
}

function scheduleClickDebugPersist() {
    if (!CLICK_DEBUG_AUTO_PERSIST) return;
    if (clickDebugPersistTimer) return;
    clickDebugPersistTimer = setTimeout(() => {
        clickDebugPersistTimer = null;
        persistClickDebugToLocalStorage();
    }, CLICK_DEBUG_PERSIST_INTERVAL_MS);
}

function loadClickDebugFromLocalStorage() {
    if (!CLICK_DEBUG_AUTO_PERSIST) return;
    try {
        const rawEntries = localStorage.getItem(CLICK_DEBUG_STORAGE_KEY);
        const rawSeq = localStorage.getItem(CLICK_DEBUG_SEQ_STORAGE_KEY);
        if (rawEntries) {
            const parsed = JSON.parse(rawEntries);
            if (Array.isArray(parsed)) {
                clickDebugEntries = parsed.slice(-CLICK_DEBUG_MAX_ENTRIES);
            }
        }
        if (rawSeq && Number.isFinite(Number(rawSeq))) {
            clickDebugSeq = Number(rawSeq);
        } else {
            clickDebugSeq = clickDebugEntries.length;
        }
    } catch (err) {
        clickDebugEntries = [];
        clickDebugSeq = 0;
        if (CLICK_DEBUG_CONSOLE) {
            console.warn("[CLICK_DEBUG] localStorage load failed", err);
        }
    }
}

function exportClickDebugLogFile() {
    if (clickDebugEntries.length === 0) return false;
    const jsonl = clickDebugEntries.map((entry) => JSON.stringify(entry)).join("\n");
    const blob = new Blob([jsonl], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[.:]/g, "-");
    const a = document.createElement("a");
    a.href = url;
    a.download = `click-debug-${stamp}.jsonl`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
}

function clearClickDebugLog() {
    clickDebugEntries = [];
    clickDebugSeq = 0;
    if (clickDebugPersistTimer) {
        clearTimeout(clickDebugPersistTimer);
        clickDebugPersistTimer = null;
    }
    try {
        localStorage.removeItem(CLICK_DEBUG_STORAGE_KEY);
        localStorage.removeItem(CLICK_DEBUG_SEQ_STORAGE_KEY);
    } catch {
        // no-op
    }
}

loadClickDebugFromLocalStorage();

window.exportClickDebugLogFile = exportClickDebugLogFile;
window.clearClickDebugLog = clearClickDebugLog;

window.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || !e.shiftKey || e.key.toLowerCase() !== "l") return;
    e.preventDefault();
    const exported = exportClickDebugLogFile();
    if (!exported) {
        alert("click-debugログがまだありません。");
    }
});

function logClickDebug(event, extra = {}) {
    if (!CLICK_DEBUG_LOG) return;
    const hoverBtn = document.querySelector(".h-btn.hover");
    const hoverKey = hoverBtn ? `${hoverBtn.dataset.row}|${hoverBtn.dataset.name}` : "";
    const payload = {
        seq: ++clickDebugSeq,
        t: new Date().toISOString(),
        event,
        stage: symptomStage,
        isMouthOpen,
        jawRaw: Number(jawOpenRawScore.toFixed(4)),
        jawRawInstant: Number(jawOpenRawInstantScore.toFixed(4)),
        jawFilt: Number(jawOpenFilteredScore.toFixed(4)),
        jawBaseline: Number((jawClosedBaseline ?? 0).toFixed(4)),
        mouthRatio: Number((mouthOpenRatio ?? 0).toFixed(4)),
        mouthRatioBaseline: Number((mouthOpenRatioBaseline ?? 0).toFixed(4)),
        jawOpenTh: Number(debugJawOpenThreshold.toFixed(4)),
        jawCloseTh: Number(debugJawCloseThreshold.toFixed(4)),
        openFrames: jawOpenConsecutiveFrames,
        hoverKey,
        pendingClickTargetKey,
        hasPendingClick: Boolean(pendingClickTimer),
        pointerX: Math.round(pointerX),
        pointerY: Math.round(pointerY),
        ...extra
    };
    clickDebugEntries.push(payload);
    if (clickDebugEntries.length > CLICK_DEBUG_MAX_ENTRIES) {
        clickDebugEntries.splice(0, clickDebugEntries.length - CLICK_DEBUG_MAX_ENTRIES);
    }
    scheduleClickDebugPersist();
    if (CLICK_DEBUG_CONSOLE) {
        console.log("[CLICK_DEBUG]", payload);
    }
}

function markClickFeedback() {
    clickFeedbackUntil = Date.now() + CLICK_FEEDBACK_MS;
}

function medianOfNumbers(values) {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

function pushJawRawSample(value) {
    jawRawRecent.push(value);
    if (jawRawRecent.length > JAW_RAW_MEDIAN_WINDOW) {
        jawRawRecent.shift();
    }
    return medianOfNumbers(jawRawRecent);
}

function computeMouthOpenRatio(landmarks) {
    if (!landmarks || !landmarks[13] || !landmarks[14]) return null;

    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const lm of landmarks) {
        if (lm.y < minY) minY = lm.y;
        if (lm.y > maxY) maxY = lm.y;
    }

    const faceHeight = Math.max(0.0001, maxY - minY);
    const mouthGap = Math.abs(landmarks[14].y - landmarks[13].y);
    return mouthGap / faceHeight;
}

function updateMouthRatioBaseline() {
    if (!Number.isFinite(mouthOpenRatio)) return;

    if (mouthOpenRatioBaseline === null) {
        mouthOpenRatioBaseline = mouthOpenRatio;
        return;
    }

    const candidate = Math.min(mouthOpenRatio, mouthOpenRatioBaseline + 0.0035);
    mouthOpenRatioBaseline = lowPassFilter(mouthOpenRatioBaseline, candidate, MOUTH_RATIO_BASELINE_ALPHA);
}

function getEffectiveJawOpenThreshold() {
    const relativeThreshold = (jawClosedBaseline ?? 0) + (jawOpenThreshold * JAW_OPEN_THRESHOLD_GAIN);
    return Math.max(JAW_OPEN_ABS_MIN, relativeThreshold);
}

function getEffectiveJawCloseThreshold() {
    const openThreshold = getEffectiveJawOpenThreshold();
    const adjustedGap = jawOpenThreshold * JAW_OPEN_THRESHOLD_GAIN;
    const closeThreshold = openThreshold - Math.max(JAW_CLOSE_MIN_GAP, adjustedGap * JAW_CLOSE_RATIO);
    return Math.max(JAW_CLOSE_ABS_MIN, closeThreshold);
}

function updateJawClosedBaseline() {
    if (!Number.isFinite(jawOpenFilteredScore)) return;
    const filtered = Math.min(jawOpenFilteredScore, JAW_BASELINE_MAX);

    if (jawClosedBaseline === null) {
        jawClosedBaseline = filtered;
        return;
    }

    const candidate = Math.min(filtered, jawClosedBaseline + 0.008);
    jawClosedBaseline = lowPassFilter(jawClosedBaseline, candidate, JAW_BASELINE_ALPHA);
}

function isJawOpenVisualActive() {
    return isMouthOpen;
}

function updateGestureDetection(detectResults, primaryLandmarks = null) {
    if (isConfirmInProgress) return;
    if (!detectResults.faceBlendshapes || detectResults.faceBlendshapes.length === 0) {
        const hadState = isMouthOpen || jawOpenConsecutiveFrames > 0 || jawOpenFilteredScore > 0.02;
        wasFaceBlendshapeAvailable = false;
        jawRawRecent = [];
        loggedReacquireGuard = false;
        jawOpenRawScore = 0;
        jawOpenRawInstantScore = 0;
        jawOpenFilteredScore *= 0.8;
        jawOpenConsecutiveFrames = 0;
        isMouthOpen = false;
        closeClickEligible = false;
        mouthOpenedAt = 0;
        jawClosedBaseline = null;
        mouthOpenRatio = 0;
        mouthOpenRatioBaseline = null;
        debugJawOpenThreshold = jawOpenThreshold * JAW_OPEN_THRESHOLD_GAIN;
        debugJawCloseThreshold = Math.max(0, (jawOpenThreshold * JAW_OPEN_THRESHOLD_GAIN) - JAW_CLOSE_MIN_GAP);
        if (hadState) {
            logClickDebug("no_face_reset");
        }
        return;
    }

    if (!wasFaceBlendshapeAvailable) {
        wasFaceBlendshapeAvailable = true;
        faceJustReacquiredUntil = Date.now() + FACE_REACQUIRE_GUARD_MS;
        jawRawRecent = [];
        jawOpenConsecutiveFrames = 0;
        isMouthOpen = false;
        closeClickEligible = false;
        mouthOpenedAt = 0;
        jawClosedBaseline = null;
        mouthOpenRatioBaseline = null;
        loggedReacquireGuard = false;
        logClickDebug("face_reacquired", { guardMs: FACE_REACQUIRE_GUARD_MS });
    }

    const cats = detectResults.faceBlendshapes[0].categories;
    const jawOpen = cats.find(c => c.categoryName === "jawOpen")?.score ?? 0;
    jawOpenRawInstantScore = jawOpen;
    jawOpenRawScore = pushJawRawSample(jawOpen);
    if (jawOpenFilteredScore === 0) {
        jawOpenFilteredScore = jawOpenRawScore;
    } else {
        jawOpenFilteredScore = (jawOpenFilteredScore * (1 - JAW_OPEN_SMOOTHING_ALPHA)) + (jawOpenRawScore * JAW_OPEN_SMOOTHING_ALPHA);
    }

    const ratio = computeMouthOpenRatio(primaryLandmarks);
    mouthOpenRatio = Number.isFinite(ratio) ? ratio : 0;

    if (!isMouthOpen) {
        updateJawClosedBaseline();
        updateMouthRatioBaseline();
    }

    const openThreshold = getEffectiveJawOpenThreshold();
    const closeThreshold = getEffectiveJawCloseThreshold();
    debugJawOpenThreshold = openThreshold;
    debugJawCloseThreshold = closeThreshold;

    if (Date.now() < faceJustReacquiredUntil) {
        if (!loggedReacquireGuard) {
            logClickDebug("face_reacquire_guard", {
                remainMs: faceJustReacquiredUntil - Date.now()
            });
            loggedReacquireGuard = true;
        }
        jawOpenConsecutiveFrames = 0;
        return;
    }
    loggedReacquireGuard = false;

    if (isMouthOpen) {
        const openHeldMs = mouthOpenedAt ? (Date.now() - mouthOpenedAt) : 0;
        const ratioBaseline = mouthOpenRatioBaseline ?? 0;
        const ratioCloseThreshold = Math.max(MOUTH_RATIO_CLOSE_ABS_MAX, ratioBaseline + MOUTH_RATIO_CLOSE_DELTA_MAX);
        const closeByFiltered = jawOpenFilteredScore <= closeThreshold;
        const closeByRawAndRatio = jawOpenRawInstantScore <= JAW_CLOSE_RAW_ABS_MAX && mouthOpenRatio <= ratioCloseThreshold;
        const closeByTimeout = openHeldMs >= MAX_MOUTH_OPEN_HOLD_MS;

        if (closeByFiltered || closeByRawAndRatio || closeByTimeout) {
            const openHeldMs = mouthOpenedAt ? (Date.now() - mouthOpenedAt) : 0;
            logClickDebug("mouth_close", {
                openHeldMs,
                closeByFiltered,
                closeByRawAndRatio,
                closeByTimeout,
                ratioCloseTh: Number(ratioCloseThreshold.toFixed(4))
            });
            isMouthOpen = false;
            jawOpenConsecutiveFrames = 0;
            mouthOpenedAt = 0;
            closeClickEligible = false;
        }
        return;
    }

    const baseline = jawClosedBaseline ?? 0;
    const openDelta = jawOpenFilteredScore - baseline;
    const ratioBaseline = mouthOpenRatioBaseline ?? 0;
    const ratioThreshold = Math.max(MOUTH_RATIO_OPEN_MIN, ratioBaseline + MOUTH_RATIO_DELTA_MIN);
    const passByRatio = Number.isFinite(mouthOpenRatio) && mouthOpenRatio >= ratioThreshold;
    const passesOpenGate =
        jawOpenFilteredScore >= openThreshold
        && jawOpenRawScore >= JAW_OPEN_RAW_MIN
        && openDelta >= JAW_OPEN_MIN_DELTA_FROM_BASELINE
        && passByRatio;

    if (passesOpenGate) {
        jawOpenConsecutiveFrames += 1;
        if (jawOpenConsecutiveFrames === 1) {
            logClickDebug("open_gate_start", {
                openDelta: Number(openDelta.toFixed(4)),
                ratio: Number(mouthOpenRatio.toFixed(4)),
                ratioTh: Number(ratioThreshold.toFixed(4))
            });
        }
        if (jawOpenConsecutiveFrames >= JAW_OPEN_REQUIRED_FRAMES) {
            isMouthOpen = true;
            mouthOpenedAt = Date.now();
            logClickDebug("mouth_open_confirmed", {
                openDelta: Number(openDelta.toFixed(4)),
                ratio: Number(mouthOpenRatio.toFixed(4)),
                ratioTh: Number(ratioThreshold.toFixed(4))
            });
            const didSchedule = triggerClick();
            closeClickEligible = !didSchedule;

            if (didSchedule && !gestureCooldown) {
                showGestureFeedback();
            }
        }
    } else {
        if (jawOpenConsecutiveFrames > 0) {
            logClickDebug("open_gate_break", {
                openDelta: Number(openDelta.toFixed(4)),
                passByFilt: jawOpenFilteredScore >= openThreshold,
                passByRaw: jawOpenRawScore >= JAW_OPEN_RAW_MIN,
                passByDelta: openDelta >= JAW_OPEN_MIN_DELTA_FROM_BASELINE,
                passByRatio,
                ratio: Number(mouthOpenRatio.toFixed(4)),
                ratioTh: Number(ratioThreshold.toFixed(4))
            });
        }
        jawOpenConsecutiveFrames = 0;
    }
}

function drawMouthDetectionOverlay(landmarks) {
    const isOpenDetected = isJawOpenVisualActive();
    const isClickFeedbackActive = Date.now() < clickFeedbackUntil;
    // 色はクリック実行タイミングに合わせる（クリック時=赤、それ以外=緑）。
    // 口の値の文字表示は、鏡像の映像に重ねると左右反転して読めないので出さない（計測値パネルに出る）
    const accent = (isClickFeedbackActive || isOpenDetected) ? "#ff5252" : "#00e676";

    canvasCtx.save();

    if (landmarks && landmarks[13]) {
        const mouthX = landmarks[13].x * canvasElement.width;
        const mouthY = landmarks[13].y * canvasElement.height;
        canvasCtx.beginPath();
        canvasCtx.arc(mouthX, mouthY, 9, 0, Math.PI * 2);
        canvasCtx.fillStyle = accent;
        canvasCtx.shadowColor = accent;
        canvasCtx.shadowBlur = 10;
        canvasCtx.fill();
        canvasCtx.shadowBlur = 0;
        canvasCtx.lineWidth = 2;
        canvasCtx.strokeStyle = "#ffffff";
        canvasCtx.stroke();
    }

    canvasCtx.restore();
}

function showGestureFeedback() {
    // 確定サインは現在のポインタ位置を中心に表示する
    gestureIndicator.style.left = `${pointerX}px`;
    gestureIndicator.style.top = `${pointerY}px`;
    gestureIndicator.classList.add("active");
    pointerElement.style.setProperty("--pointer-scale", "2");
    pointerElement.style.backgroundColor = "#fff";
    gestureCooldown = true;
    setTimeout(() => {
        gestureIndicator.classList.remove("active");
        pointerElement.style.setProperty("--pointer-scale", "1");
        pointerElement.style.backgroundColor = "var(--primary)";
        gestureCooldown = false;
    }, GESTURE_COOLDOWN_MS);
}

function triggerClick() {
    if (calibrationWizard.isActive() || isSettingsOpen()) return false;
    if (isConfirmInProgress) {
        logClickDebug("click_blocked_confirm_in_progress");
        return false;
    }

    const now = Date.now();
    if (now - lastConfirmedAt < CONFIRM_COOLDOWN_MS) {
        logClickDebug("click_blocked_cooldown", { sinceLastConfirmMs: now - lastConfirmedAt });
        return false;
    }

    const activeBtn = document.querySelector(".h-btn.hover");
    if (activeBtn && !activeBtn.classList.contains("h-btn--empty")) {
        const targetKey = `${activeBtn.dataset.row}|${activeBtn.dataset.name}`;
        if (isSimpleClickBlocked(targetKey) || activeBtn.classList.contains("is-disabled")) {
            logClickDebug("click_blocked_simple_paused", { targetKey });
            return false;
        }

        if (pendingClickTimer) {
            logClickDebug("click_pending_replaced", { replacedTargetKey: pendingClickTargetKey, newTargetKey: targetKey });
            clearTimeout(pendingClickTimer);
            pendingClickTimer = null;
            pendingClickTargetKey = "";
        }

        logClickDebug("click_scheduled", { targetKey, clickDelayMs: CLICK_DELAY_MS });
        activeBtn.classList.add("clicked-anim");
        pendingClickTargetKey = targetKey;
        // ボタン参照を保持して、タイマー実行時にはこちらを使用
        const targetBtn = activeBtn;
        pendingClickTimer = setTimeout(() => {
            // 1. アニメーションクラスが削除されている（キャンセルされた）
            if (!targetBtn.classList.contains("clicked-anim")) {
                logClickDebug("click_canceled_missing_anim", { targetKey });
                pendingClickTimer = null;
                pendingClickTargetKey = "";
                return;
            }

            // キャリブレーション開始前に予約されたクリックは実行しない
            if (calibrationWizard.isActive()) {
                logClickDebug("click_canceled_calibration", { targetKey });
                targetBtn.classList.remove("clicked-anim");
                pendingClickTimer = null;
                pendingClickTargetKey = "";
                return;
            }

            // 2. 最終的に同じボタンをホバーし続けている場合のみ確定
            const currentHover = document.querySelector(".h-btn.hover");
            const currentKey = currentHover
                ? `${currentHover.dataset.row}|${currentHover.dataset.name}`
                : "";
            if (currentKey !== pendingClickTargetKey) {
                logClickDebug("click_canceled_hover_changed", { targetKey, currentKey });
                targetBtn.classList.remove("clicked-anim");
                pendingClickTimer = null;
                pendingClickTargetKey = "";
                return;
            }

            targetBtn.classList.remove("clicked-anim");
            markClickFeedback();
            logClickDebug("click_executed", { targetKey });
            targetBtn.click();
            lastConfirmedAt = Date.now();
            pendingClickTimer = null;
            pendingClickTargetKey = "";
        }, CLICK_DELAY_MS);

        return true;
    }

    logClickDebug("click_blocked_no_hover");

    return false;
}

// =========================================================
// Calibration wizard
// 画面上の○に顔の正面を向けてもらい、「○までの画面上の距離」と「そのときの顔の動き」から
// 感度(nose/yaw gain)・上下感度比を決める。これを近い位置と少し離れた位置の2回行い、
// 距離補正の指数も求める。最後に口の開きを計測して口の閾値を決める
// =========================================================
const CALIB_PREPARE_MS = 1500;
const CALIB_RECORD_MS = 2000;
// ○の半径。予測カーソルがこの内側に入れば「一致」とみなす
const CALIB_TARGET_RADIUS_PX = 46;
// 静止判定: 直近この時間の揺れ幅がしきい値以下なら止まっているとみなす
const CALIB_STILL_WINDOW_MS = 450;
const CALIB_STILL_ANGLE_RANGE = 0.035;
const CALIB_STILL_NOSE_RANGE = 0.008;
// 震えなどで止まりきれない人のため、時間が経ったら静止判定を緩める
const CALIB_STILL_RELAX_AFTER_MS = 8000;
const CALIB_STILL_RELAX_FACTOR = 2;
const CALIB_CENTER_HOLD_MS = 1500;
const CALIB_TARGET_HOLD_MS = 1000;
const CALIB_TARGET_HOLD_IN_CIRCLE_MS = 400;
// ○を出した直後は動き出しを待つ
const CALIB_SETTLE_MS = 600;
// 正面から動いたとみなす量。動けない人のため、時間が経ったら動かなくても記録する
const CALIB_MIN_MOVE_ANGLE = 0.05;
const CALIB_MIN_MOVE_NOSE = 0.015;
const CALIB_MOVE_GIVEUP_MS = 5000;
// 止まりきれなくても、この時間が経ったら直近の平均で記録して先へ進む（結果に警告を出す）
const CALIB_CAPTURE_GIVEUP_MS = 15000;
// 正面の登録だけのときは、この時間止まれなければ元の正面のまま閉じる
const CALIB_FRONT_TIMEOUT_MS = 10000;
const CALIB_MATCH_SHOW_MS = 700;
// 記録する値は静止中の直近この時間の平均
const CALIB_SAMPLE_AVERAGE_MS = 600;
const CALIB_SAMPLE_BUFFER_MS = 2000;
// 離れた位置の計測は、近い位置よりこの比率以上離れて止まったら始める
const CALIB_FAR_MIN_RATIO = 1.18;
const CALIB_FAR_HOLD_MS = 1000;
// 2回の距離の差がこれ未満なら距離補正の指数は既定値のまま
const CALIB_MIN_DISTANCE_SPREAD = 1.12;
const CALIB_DISTANCE_EXPONENT_MIN = 0.3;
const CALIB_DISTANCE_EXPONENT_MAX = 1.6;
// 口: 閉じ〜開きの差のこの割合を開き判定ラインにする
const CALIB_JAW_OPEN_POINT = 0.45;
const CALIB_MIN_JAW_RANGE = 0.12;

// ○の位置（画面に対する割合）。上の○は画面上部の指示メッセージと重ならない高さにする
const CALIB_TARGETS = [
    { key: "center", x: 0.5, y: 0.55, label: "まんなか" },
    { key: "left", x: 0.12, y: 0.55, label: "左" },
    { key: "right", x: 0.88, y: 0.55, label: "右" },
    { key: "up", x: 0.5, y: 0.26, label: "上" },
    { key: "down", x: 0.5, y: 0.88, label: "下" }
];
const CALIB_PASSES = [
    { key: "near", label: "近い位置", sub: "いつもの位置（画面の近く）で" },
    { key: "far", label: "離れた位置", sub: "少し離れた位置で" }
];
// 「離れた位置」の計測を行うか（OFF ならいつもの位置だけで計測し、距離補正は標準の強さ）
const CALIB_FAR_PASS_KEY = "calib_far_pass_enabled";
let isCalibFarPassEnabled = localStorage.getItem(CALIB_FAR_PASS_KEY) !== "0";
const CALIB_HORIZONTAL_KEYS = ["left", "right"];
const CALIB_VERTICAL_KEYS = ["up", "down"];

function buildCalibrationSteps() {
    const steps = [];
    const passes = isCalibFarPassEnabled ? CALIB_PASSES : CALIB_PASSES.filter(pass => pass.key !== "far");
    passes.forEach((pass, passIndex) => {
        if (passIndex > 0) steps.push({ type: "distance", pass: pass.key });
        CALIB_TARGETS.forEach((target) => steps.push({ type: "target", pass: pass.key, target }));
    });
    steps.push({ type: "mouth" });
    return steps;
}

function meanOf(values) {
    if (values.length === 0) return NaN;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdOf(values) {
    if (values.length < 2) return 0;
    const mean = meanOf(values);
    return Math.sqrt(values.reduce((sum, v) => sum + ((v - mean) ** 2), 0) / (values.length - 1));
}

function percentileOf(values, ratio) {
    if (values.length === 0) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(ratio * (sorted.length - 1)))];
}

function rangeOf(values) {
    if (values.length === 0) return 0;
    return Math.max(...values) - Math.min(...values);
}

function roundTo(value, step) {
    return Math.round(value / step) * step;
}

// 角度 from→to を動かしたときの加速込みの累積量（ランタイムの加速と同じ式）
function integrateAcceleratedAngle(from, to, neutral) {
    const steps = 60;
    const step = (to - from) / steps;
    let total = 0;
    for (let i = 0; i < steps; i += 1) {
        const mid = from + (step * (i + 0.5));
        total += Math.abs(step) * getAngleOffsetAcceleration(mid, neutral);
    }
    return total;
}

function signedAcceleratedAngle(from, to, neutral) {
    return Math.sign(to - from) * integrateAcceleratedAngle(from, to, neutral);
}

// travel(g) が単調増加なので二分探索でゲインを求める
function solveGainForTravel(travelAt, requiredTravel) {
    let low = 0.5;
    let high = NOSE_GAIN_MAX;
    if (travelAt(high) < requiredTravel) return { gain: high, saturated: true };
    if (travelAt(low) >= requiredTravel) return { gain: low, saturated: false };
    for (let i = 0; i < 30; i += 1) {
        const mid = (low + high) / 2;
        if (travelAt(mid) < requiredTravel) low = mid;
        else high = mid;
    }
    return { gain: clamp(roundTo(high, 0.5), 0.5, NOSE_GAIN_MAX), saturated: false };
}

function readCalibrationSample(landmarks, detectResults) {
    const nose = landmarks?.[4];
    if (!nose) return null;
    const yaw = extractHeadYawRadians(detectResults, 0);
    const pitch = extractHeadPitchRadians(detectResults, 0);
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
    const cats = detectResults?.faceBlendshapes?.[0]?.categories;
    const jaw = cats?.find(c => c.categoryName === "jawOpen")?.score ?? 0;
    const distance = extractHeadDistance(detectResults, 0) ?? NaN;
    return { noseX: 1 - nose.x, noseY: nose.y, yaw, pitch, jaw, distance };
}

function averageSamples(samples) {
    const keys = ["noseX", "noseY", "yaw", "pitch", "jaw", "distance"];
    const summary = {};
    keys.forEach((key) => {
        summary[key] = meanOf(samples.map(sample => sample[key]).filter(Number.isFinite));
    });
    return summary;
}

function shrinkByDeadzone(delta, deadzone) {
    return Math.sign(delta) * Math.max(0, Math.abs(delta) - deadzone);
}

// ランタイムのバックラッシュは動き始めにデッドゾーン分を捨て、加速は anchor より deadzone 先の実際の角度で決まる
function backlashAcceleratedAngle(from, to, deadzone) {
    const delta = shrinkByDeadzone(to - from, deadzone);
    return signedAcceleratedAngle(from, from + delta, from - (Math.sign(delta) * deadzone));
}

// 正面(center)→sample の顔の動きが、ランタイムで何px の移動になるか（ランタイムの差分合成と同じ式）
// ゲイン 0 の経路はランタイム同様に無効
function horizontalTravel(sample, center, gain, ratio, noise, yawG = gain) {
    const nose = gain > 0
        ? shrinkByDeadzone(sample.noseX - center.noseX, getNoseDeadzone(gain, noise.nose, noise.noiseOnly)) * getNoseScale(gain)
        : 0;
    const yaw = yawG > 0
        ? backlashAcceleratedAngle(center.yaw, sample.yaw, getYawDeadzone(yawG, noise.angle, noise.noiseOnly)) * YAW_MIRROR_SIGN * getYawScale(yawG)
        : 0;
    return (nose + yaw) * ratio;
}

function verticalTravel(sample, center, gain, ratio, noise, yawG = gain) {
    const nose = gain > 0
        ? shrinkByDeadzone(sample.noseY - center.noseY, getNoseDeadzone(gain, noise.nose, noise.noiseOnly)) * getNoseScale(gain) * VERTICAL_NOSE_SCALE_RATIO
        : 0;
    const pitch = yawG > 0
        ? backlashAcceleratedAngle(center.pitch, sample.pitch, getYawDeadzone(yawG, noise.angle, noise.noiseOnly))
            * PITCH_MIRROR_SIGN * getYawScale(yawG) * VERTICAL_PITCH_SCALE_RATIO
        : 0;
    return (nose + pitch) * ratio;
}

function calibrationRatio(sample, model) {
    return model.ref > 0 ? getDistanceRatioFor(sample.distance, model.ref, model.exponent) : 1;
}

function measureNoise(samples) {
    return {
        nose: clamp(Math.max(stdOf(samples.map(s => s.noseX)), stdOf(samples.map(s => s.noseY))), 0, 0.01),
        angle: clamp(Math.max(stdOf(samples.map(s => s.yaw)), stdOf(samples.map(s => s.pitch))), 0, 0.03),
        noiseOnly: true
    };
}

// ○までの距離の合計と、顔の動きから出る移動量（○の方向成分）の合計が一致するゲインを求める
function fitCalibrationGain(entries, model) {
    const usable = entries.filter(e => CALIB_HORIZONTAL_KEYS.includes(e.key) && Math.abs(e.dx) > 1);
    if (usable.length === 0) return null;
    const required = usable.reduce((sum, e) => sum + Math.abs(e.dx), 0);
    const travelAt = g => usable.reduce((sum, e) => (
        sum + (Math.sign(e.dx) * horizontalTravel(e.sample, e.center, g, calibrationRatio(e.sample, model), model.noise))
    ), 0);
    // ○と逆向きに動いていた（または動いていない）場合は決められない
    if (travelAt(NOSE_GAIN_MAX) <= 0) return null;
    return solveGainForTravel(travelAt, required);
}

// sides（同じ軸の向き）の○で「○までの距離 / 顔の動きから出る移動量」を求める（丸め・制限なし）
function measureCalibrationRatio(entries, model, gain, sides) {
    const axis = CALIB_SIDE_KEYS[sides[0]];
    const usable = entries.filter(e => sides.includes(e.key) && Math.abs(e[axis]) > 1);
    if (usable.length === 0) return null;
    const travelOf = axis === "dx" ? horizontalTravel : verticalTravel;
    const required = usable.reduce((sum, e) => sum + Math.abs(e[axis]), 0);
    const travel = usable.reduce((sum, e) => (
        sum + (Math.sign(e[axis]) * travelOf(e.sample, e.center, gain, calibrationRatio(e.sample, model), model.noise))
    ), 0);
    return travel > 1 ? required / travel : null;
}

// 4方向の倍率を求める。各向きは○1〜2個で決まり、記録ミス1つで大きく外れるので、
// 同じ軸の両側を合算した倍率の 1/SIDE_GAIN_ASYMMETRY_MAX〜SIDE_GAIN_ASYMMETRY_MAX 倍に収める。
// 決められない向きは同じ軸の反対側の値、それも無ければ fallback を使う
function fitCalibrationSideRatios(entries, model, gain, fallback) {
    const fitted = {};
    const limited = [];
    [["left", "right"], ["up", "down"]].forEach((pair) => {
        const single = pair.map(side => measureCalibrationRatio(entries, model, gain, [side]));
        // 片側が決められない（動かなかった・逆に動いた）ときは、その記録が合算を歪めるので制限しない
        const combined = single.every(value => value !== null) ? measureCalibrationRatio(entries, model, gain, pair) : null;
        pair.forEach((side, index) => {
            let value = single[index];
            if (value !== null && combined !== null) {
                const bounded = clamp(value, combined / SIDE_GAIN_ASYMMETRY_MAX, combined * SIDE_GAIN_ASYMMETRY_MAX);
                if (bounded !== value && !limited.includes(pair[0])) limited.push(pair[0]);
                value = bounded;
            }
            fitted[side] = value === null ? null : clamp(roundTo(value, 0.05), ...SIDE_GAIN_RATIO_LIMITS[side]);
        });
    });
    const opposite = { left: "right", right: "left", up: "down", down: "up" };
    const ratios = {};
    Object.keys(SIDE_GAIN_RATIO_KEYS).forEach((side) => {
        ratios[side] = fitted[side] ?? fitted[opposite[side]] ?? fallback[side];
    });
    return { ratios, fitted, limited };
}

// 距離補正なしで「必要な移動量 / 顔の動きから出る移動量」を求める。距離ごとのこの倍率の違いが距離補正の強さになる
function requiredMultiplier(entries, keys, axis, gain, noise) {
    const usable = entries.filter(e => keys.includes(e.key) && Math.abs(e[axis]) > 1);
    if (usable.length === 0) return NaN;
    const travelOf = axis === "dx" ? horizontalTravel : verticalTravel;
    const required = usable.reduce((sum, e) => sum + Math.abs(e[axis]), 0);
    const travel = usable.reduce((sum, e) => sum + (Math.sign(e[axis]) * travelOf(e.sample, e.center, gain, 1, noise)), 0);
    return travel > 1 ? required / travel : NaN;
}

function estimateDistanceExponent(nearEntries, farEntries, nearDistance, farDistance, gain, noise) {
    const spread = farDistance / nearDistance;
    if (!Number.isFinite(spread) || spread < CALIB_MIN_DISTANCE_SPREAD) return null;
    const estimates = [
        [CALIB_HORIZONTAL_KEYS, "dx"],
        [CALIB_VERTICAL_KEYS, "dy"]
    ].map(([keys, axis]) => {
        const near = requiredMultiplier(nearEntries, keys, axis, gain, noise);
        const far = requiredMultiplier(farEntries, keys, axis, gain, noise);
        return Math.log(far / near) / Math.log(spread);
    }).filter(Number.isFinite);
    if (estimates.length === 0) return null;
    return clamp(roundTo(meanOf(estimates), 0.05), CALIB_DISTANCE_EXPONENT_MIN, CALIB_DISTANCE_EXPONENT_MAX);
}

function predictCalibrationOffset(sample, center, model) {
    const ratio = calibrationRatio(sample, model);
    return applySideGainRatios({
        x: horizontalTravel(sample, center, model.gain, ratio, model.noise),
        y: verticalTravel(sample, center, model.gain, ratio, model.noise)
    }, model.sideRatios);
}

function computeCalibrationResult(captures, neutralSamples, mouthSamples) {
    const warnings = [];
    if (captures.some(e => e.forced)) {
        warnings.push("静止できないまま時間切れで記録した○があります。結果が合わない場合はやり直してください");
    }
    const nearEntries = captures.filter(e => e.pass === "near" && e.key !== "center");
    const farEntries = captures.filter(e => e.pass === "far" && e.key !== "center");
    const allEntries = [...nearEntries, ...farEntries];
    const nearCenter = captures.find(e => e.pass === "near" && e.key === "center")?.sample;
    const farCenter = captures.find(e => e.pass === "far" && e.key === "center")?.sample;
    // 静止時の揺れ → デッドゾーン下限（感度の計算もこのデッドゾーン込みで行う）
    const noise = measureNoise(neutralSamples);

    // 距離補正: 2回の距離で必要な倍率がどれだけ変わるかから指数を決める
    let exponent = DISTANCE_EXPONENT_DEFAULT;
    let ref = nearCenter?.distance > 0 ? nearCenter.distance : 0;
    let exponentMeasured = false;
    if (farCenter && farEntries.length > 0 && ref > 0 && farCenter.distance > 0) {
        const nearOnly = fitCalibrationGain(nearEntries, { ref: 0, exponent: 0, noise });
        const estimated = estimateDistanceExponent(nearEntries, farEntries, ref, farCenter.distance, nearOnly?.gain ?? noseGain, noise);
        if (estimated === null) {
            warnings.push("2回の距離の差が小さいため、距離補正は標準の強さにしました");
        } else {
            exponent = estimated;
            exponentMeasured = true;
        }
        // 基準は2つの距離の中間（幾何平均）にして、どちらの距離でも補正量を小さく保つ
        ref = Math.sqrt(ref * farCenter.distance);
    } else if (!farCenter && isCalibFarPassEnabled) {
        warnings.push("離れた位置の計測を省略したため、距離補正は標準の強さにしました");
    }
    const model = { ref, exponent, noise, gain: noseGain, sideRatios: { ...sideGainRatios } };

    let gain = noseGain;
    const solved = fitCalibrationGain(allEntries, model);
    if (!solved) {
        warnings.push("左右の動きが○の方向と合わないため、感度は変更しません");
    } else {
        gain = solved.gain;
        if (solved.saturated) warnings.push("左右の動きが小さいため、感度は最大にしました");
    }
    model.gain = gain;

    // 左右はゲインを決め直したら倍率 1 を基準にする。上下は決められなければ今の倍率のまま
    const fallback = {
        left: solved ? 1 : sideGainRatios.left,
        right: solved ? 1 : sideGainRatios.right,
        up: sideGainRatios.up,
        down: sideGainRatios.down
    };
    const { ratios: sideRatios, fitted, limited } = fitCalibrationSideRatios(allEntries, model, gain, fallback);
    const sideLabel = { left: "左", right: "右", up: "上", down: "下" };
    [["left", "right"], ["up", "down"]].forEach(([a, b]) => {
        if (fitted[a] === null && fitted[b] === null) {
            // 左右はゲインを決め直したときだけ標準に戻す（fallback と同じ条件）
            const isReset = a === "left" && solved;
            warnings.push(`${sideLabel[a]}${sideLabel[b]}の動きが○の方向と合わないため、${sideLabel[a]}${sideLabel[b]}の倍率は${isReset ? "標準（1.00）にしました" : "変更しません"}`);
            return;
        }
        [[a, b], [b, a]].forEach(([missing, used]) => {
            if (fitted[missing] === null) {
                warnings.push(`${sideLabel[missing]}の動きが○の方向と合わないため、${sideLabel[missing]}は${sideLabel[used]}と同じ倍率にしました`);
            }
        });
    });
    Object.entries(fitted).forEach(([side, value]) => {
        if (value === null) return;
        const [min, max] = SIDE_GAIN_RATIO_LIMITS[side];
        if (value <= min || value >= max) {
            warnings.push(`${sideLabel[side]}の倍率が上限・下限に達しました。○を向けていなかった場合はやり直してください`);
        }
    });
    limited.forEach((first) => {
        const pair = first === "left" ? "左右" : "上下";
        warnings.push(`${pair}の効きの差が大きいため、差を抑えました（${SIDE_GAIN_ASYMMETRY_MAX.toFixed(1)}倍まで）。○を向けていなかった場合はやり直してください`);
    });
    model.sideRatios = sideRatios;

    // 決めた値で各○をどれだけ正確に指せるか（距離ごと・向きごとの平均のずれ）
    const errorOf = entries => meanOf(entries.map((e) => {
        const predicted = predictCalibrationOffset(e.sample, e.center, model);
        return Math.hypot(predicted.x - e.dx, predicted.y - e.dy);
    }));
    const sideErrors = {};
    Object.keys(SIDE_GAIN_RATIO_KEYS).forEach((side) => {
        sideErrors[side] = errorOf(allEntries.filter(e => e.key === side));
    });

    // 口: 閉じ〜開きの中間より少し下を判定ラインにする
    const jawClosed = percentileOf(neutralSamples.map(s => s.jaw), 0.5);
    const jawOpen = percentileOf(mouthSamples.map(s => s.jaw), 0.9);
    let jawThreshold = jawOpenThreshold;
    const jawRange = jawOpen - jawClosed;
    if (!Number.isFinite(jawRange) || jawRange <= 0.02) {
        warnings.push("口の開きを検出できなかったため、口の閾値は変更しません");
    } else {
        jawThreshold = clamp(roundTo((jawRange * CALIB_JAW_OPEN_POINT) / JAW_OPEN_THRESHOLD_GAIN, 0.01), 0.02, 0.2);
        if (jawRange < CALIB_MIN_JAW_RANGE) warnings.push("口の開きが小さめです。判定しにくい場合は大きめに開けてください");
    }

    return {
        gain,
        yawGain: gain,
        sideRatios,
        noseNoise: noise.nose,
        angleNoise: noise.angle,
        jawThreshold,
        distanceRef: ref,
        distanceExponent: exponent,
        measured: {
            exponentMeasured,
            nearDistance: nearCenter?.distance ?? NaN,
            farDistance: farCenter?.distance ?? NaN,
            nearError: errorOf(nearEntries),
            farError: errorOf(farEntries),
            sideErrors,
            jawClosed,
            jawOpen
        },
        warnings
    };
}

const calibrationWizard = (() => {
    const root = document.getElementById("calib-wizard");
    const stepCountEl = document.getElementById("calib-step-count");
    const arrowEl = document.getElementById("calib-arrow");
    const instructionEl = document.getElementById("calib-instruction-text");
    const subEl = document.getElementById("calib-sub");
    const progressBar = document.getElementById("calib-progress-bar");
    const resultEl = document.getElementById("calib-result");
    const targetEl = document.getElementById("calib-target");
    const cursorEl = document.getElementById("calib-cursor");
    const saveBtn = document.getElementById("calib-save-btn");
    const retryBtn = document.getElementById("calib-retry-btn");
    const closeBtn = document.getElementById("calib-close-btn");
    const cancelBtn = document.getElementById("calib-cancel-btn");
    const skipBtn = document.getElementById("calib-skip-btn");

    let active = false;
    let finished = false;
    let steps = [];
    let stepIndex = 0;
    let stepElapsedMs = 0;
    let holdMs = 0;
    let matchedElapsedMs = null;
    let lastFrameMs = null;
    let buffer = [];
    let captures = [];
    let neutralSamples = [];
    let mouthSamples = [];
    let model = null;
    let result = null;
    // 正面の登録だけを行うモード（正面取り直し）
    let frontOnly = false;

    const currentStep = () => steps[stepIndex];
    const topbarEl = document.getElementById("calib-topbar");
    // 低い画面でも上の○が指示バーに重ならないよう、バーの下端より下に置く
    const targetPx = target => ({
        x: target.x * window.innerWidth,
        y: Math.max(target.y * window.innerHeight, topbarEl.getBoundingClientRect().bottom + CALIB_TARGET_RADIUS_PX + 12)
    });
    const passOf = key => CALIB_PASSES.find(pass => pass.key === key);
    const passCenter = key => captures.find(e => e.pass === key && e.key === "center")?.sample ?? null;

    function setStep(index) {
        stepIndex = index;
        stepElapsedMs = 0;
        holdMs = 0;
        matchedElapsedMs = null;
        buffer = [];
        targetEl.classList.remove("matched");
        targetEl.style.setProperty("--calib-hold", "0");
        render(null);
    }

    function nextStep() {
        if (frontOnly) {
            // 正面は記録した時点で登録済み
            close();
            return;
        }
        if (stepIndex + 1 >= steps.length) {
            finish();
            return;
        }
        setStep(stepIndex + 1);
    }

    function skipFarPass() {
        const step = currentStep();
        if (!active || finished || !step || step.pass !== "far") return;
        captures = captures.filter(e => e.pass !== "far");
        setStep(steps.findIndex(s => s.type === "mouth"));
    }

    function isStill(nowMs, relax) {
        const recent = buffer.filter(entry => nowMs - entry.t <= CALIB_STILL_WINDOW_MS);
        if (recent.length < 3 || nowMs - buffer[0].t < CALIB_STILL_WINDOW_MS * 0.8) return false;
        const pick = key => recent.map(entry => entry.sample[key]);
        return Math.max(rangeOf(pick("yaw")), rangeOf(pick("pitch"))) <= CALIB_STILL_ANGLE_RANGE * relax
            && Math.max(rangeOf(pick("noseX")), rangeOf(pick("noseY"))) <= CALIB_STILL_NOSE_RANGE * relax;
    }

    function recentAverage(nowMs, windowMs) {
        return averageSamples(buffer.filter(entry => nowMs - entry.t <= windowMs).map(entry => entry.sample));
    }

    function hasMovedFrom(sample, center) {
        return Math.abs(sample.yaw - center.yaw) + Math.abs(sample.pitch - center.pitch) >= CALIB_MIN_MOVE_ANGLE
            || Math.abs(sample.noseX - center.noseX) + Math.abs(sample.noseY - center.noseY) >= CALIB_MIN_MOVE_NOSE;
    }

    // 記録済みの○から暫定の感度を決め直し、次の○で予測カーソルが合うようにする
    function refitModel() {
        const entries = captures.filter(e => e.key !== "center");
        const solved = fitCalibrationGain(entries, model);
        if (solved) model.gain = solved.gain;
        model.sideRatios = fitCalibrationSideRatios(entries, model, model.gain, model.sideRatios).ratios;
    }

    function predictCursor(sample) {
        const step = currentStep();
        const center = passCenter(step.pass) ?? passCenter("near");
        if (!center) return null;
        const origin = targetPx(CALIB_TARGETS[0]);
        const offset = predictCalibrationOffset(sample, center, model);
        return {
            x: clamp(origin.x + offset.x, 0, window.innerWidth),
            y: clamp(origin.y + offset.y, 0, window.innerHeight)
        };
    }

    function capture(nowMs, forced = false) {
        const step = currentStep();
        const sample = recentAverage(nowMs, step.target.key === "center" ? CALIB_CENTER_HOLD_MS : CALIB_SAMPLE_AVERAGE_MS);
        if (step.target.key === "center") {
            if (step.pass === "near") {
                neutralSamples = buffer.filter(entry => nowMs - entry.t <= CALIB_CENTER_HOLD_MS).map(entry => entry.sample);
                model.noise = measureNoise(neutralSamples);
                if (Number.isFinite(sample.distance)) model.ref = sample.distance;
            }
            captures.push({ pass: step.pass, key: "center", sample, center: sample, dx: 0, dy: 0, forced });
        } else {
            const center = passCenter(step.pass);
            const origin = targetPx(CALIB_TARGETS[0]);
            const target = targetPx(step.target);
            captures.push({
                pass: step.pass,
                key: step.target.key,
                sample,
                center,
                dx: target.x - origin.x,
                dy: target.y - origin.y,
                forced
            });
            refitModel();
        }
        // 正面の登録だけのときは、静止中の平均をそのまま正面にする（表示の待ち時間の間に動いた姿勢を拾わない）
        if (frontOnly) {
            const pos = targetPx(step.target);
            recaptureFrontPose(sample, { x: pos.x / window.innerWidth, y: pos.y / window.innerHeight });
        }
        matchedElapsedMs = 0;
        targetEl.classList.add("matched");
        playChime();
    }

    function render(sample) {
        const step = currentStep();
        if (!step) return;
        const pass = step.pass ? passOf(step.pass) : null;
        stepCountEl.textContent = frontOnly
            ? "正面の登録"
            : `キャリブレーション ${stepIndex + 1} / ${steps.length}${pass ? `（${pass.label}）` : ""}`;
        skipBtn.hidden = step.pass !== "far";
        root.classList.toggle("is-target", step.type === "target");

        if (step.type === "target") {
            const pos = targetPx(step.target);
            targetEl.style.setProperty("--calib-x", `${pos.x}px`);
            targetEl.style.setProperty("--calib-y", `${pos.y}px`);
            const holdTarget = step.target.key === "center" ? CALIB_CENTER_HOLD_MS : CALIB_TARGET_HOLD_MS;
            targetEl.style.setProperty("--calib-hold", String(matchedElapsedMs !== null ? 1 : clamp(holdMs / holdTarget, 0, 1)));
            arrowEl.textContent = matchedElapsedMs !== null ? "✓" : "◎";
            instructionEl.textContent = matchedElapsedMs !== null
                ? "一致しました"
                : `${step.target.label}の ○ に顔の正面を向けて 止めてください`;
            if (matchedElapsedMs === null) {
                subEl.textContent = frontOnly
                    ? "楽な姿勢で。この ○ を向いた向きが正面になります"
                    : step.target.key === "center"
                    ? `${pass.sub}、楽な姿勢で`
                    : "薄い点が ○ の中に入るように。合わなくても ○ を向いて止まれば記録します";
            }
            progressBar.classList.remove("is-prepare");
            progressBar.style.width = `${(stepIndex / steps.length) * 100}%`;

            const cursor = sample ? predictCursor(sample) : null;
            cursorEl.classList.toggle("visible", cursor !== null);
            if (cursor) {
                cursorEl.style.setProperty("--calib-x", `${cursor.x}px`);
                cursorEl.style.setProperty("--calib-y", `${cursor.y}px`);
            }
            return;
        }

        cursorEl.classList.remove("visible");
        if (step.type === "distance") {
            const near = passCenter("near");
            const ratio = sample && near ? sample.distance / near.distance : NaN;
            arrowEl.textContent = "↕";
            instructionEl.textContent = "画面から少し離れて 止めてください";
            subEl.textContent = Number.isFinite(ratio)
                ? `いまの距離: 近い位置の ${ratio.toFixed(2)} 倍（${CALIB_FAR_MIN_RATIO.toFixed(2)} 倍以上で開始）`
                : "離れられない場合は「省略」を押してください";
            progressBar.classList.add("is-prepare");
            progressBar.style.width = `${Number.isFinite(ratio) ? clamp((ratio - 1) / (CALIB_FAR_MIN_RATIO - 1), 0, 1) * 100 : 0}%`;
            return;
        }

        const isPreparing = stepElapsedMs < CALIB_PREPARE_MS;
        arrowEl.textContent = "😮";
        instructionEl.textContent = "口を大きく開けて 止めてください";
        subEl.textContent = isPreparing ? "準備… クリックと同じ開け方で" : "そのまま止めてください";
        const ratio = isPreparing
            ? stepElapsedMs / CALIB_PREPARE_MS
            : (stepElapsedMs - CALIB_PREPARE_MS) / CALIB_RECORD_MS;
        progressBar.classList.toggle("is-prepare", isPreparing);
        progressBar.style.width = `${clamp(ratio, 0, 1) * 100}%`;
    }

    function start(options = {}) {
        // 起動ボタンにフォーカスが残ると Space/Enter で計測中に再スタートしてしまう
        if (document.activeElement && typeof document.activeElement.blur === "function") {
            document.activeElement.blur();
        }
        active = true;
        finished = false;
        frontOnly = options.frontOnly === true;
        steps = frontOnly ? [{ type: "target", pass: "near", target: CALIB_TARGETS[0] }] : buildCalibrationSteps();
        lastFrameMs = null;
        captures = [];
        neutralSamples = [];
        mouthSamples = [];
        model = {
            ref: 0,
            exponent: distanceExponent,
            noise: { nose: noseNoise, angle: angleNoise, noiseOnly: true },
            gain: noseGain > 0 ? noseGain : NOSE_GAIN_DEFAULT,
            sideRatios: { ...sideGainRatios }
        };
        result = null;
        root.classList.remove("done");
        root.classList.add("active");
        document.body.classList.add("calib-active");
        setStep(0);
    }

    function close() {
        active = false;
        finished = false;
        // 計測中に見ていた位置のパネルが閉じた直後に滞留確定しないよう、一度外れるまで滞留しない
        dwellLockedKey = DWELL_LOCK_FIRST_HOVER;
        resetDwellProgress();
        root.classList.remove("active", "done", "is-target");
        cursorEl.classList.remove("visible");
        document.body.classList.remove("calib-active");
        // 計測中はポインタ計算を止めていたので、履歴を捨てて急な飛びを防ぐ
        resetPointerMotionHistory();
    }

    function finish() {
        finished = true;
        result = computeCalibrationResult(captures, neutralSamples, mouthSamples);
        root.classList.remove("is-target");
        cursorEl.classList.remove("visible");
        stepCountEl.textContent = "キャリブレーション結果";
        arrowEl.textContent = "✓";
        instructionEl.textContent = "計測が終わりました";
        subEl.textContent = "保存すると下の値に切り替わります";
        skipBtn.hidden = true;
        const m = result.measured;
        const px = value => (Number.isFinite(value) ? `${Math.round(value)}px` : "-");
        const lines = [
            `感度（鼻位置・顔の傾き）: ${noseGain.toFixed(1)} / ${yawGain.toFixed(1)} → ${result.gain.toFixed(1)} / ${result.yawGain.toFixed(1)}`,
            `向きごとの倍率（左/右/上/下）: ${formatSideRatios(sideGainRatios)} → ${formatSideRatios(result.sideRatios)}`,
            `距離補正の強さ: ${distanceExponent.toFixed(2)} → ${result.distanceExponent.toFixed(2)}${m.exponentMeasured ? "（2つの距離で計測）" : "（標準）"}`,
            `口の開き閾値: ${jawOpenThreshold.toFixed(2)} → ${result.jawThreshold.toFixed(2)}`,
            `静止時の揺れ（鼻/角度）: ${formatMetric(result.noseNoise, 4)} / ${formatMetric(result.angleNoise, 4)}`,
            `○とのずれ（平均）: 近い位置 ${px(m.nearError)} / 離れた位置 ${px(m.farError)}`,
            `○とのずれ（左/右/上/下）: ${["left", "right", "up", "down"].map(side => px(m.sideErrors[side])).join(" / ")}`,
            `計測: 距離 ${formatMetric(m.nearDistance, 1)} → ${formatMetric(m.farDistance, 1)} / 口 ${formatMetric(m.jawClosed, 2)}→${formatMetric(m.jawOpen, 2)}`
        ];
        if (result.warnings.length > 0) {
            lines.push("", ...result.warnings.map(w => `⚠ ${w}`));
        }
        resultEl.textContent = lines.join("\n");
        root.classList.add("done");
    }

    function apply() {
        if (!result) return;
        noseGain = result.gain;
        yawGain = result.yawGain;
        sideGainRatios = { ...result.sideRatios };
        noseNoise = result.noseNoise;
        angleNoise = result.angleNoise;
        jawOpenThreshold = result.jawThreshold;
        distanceExponent = result.distanceExponent;
        if (result.distanceRef > 0) distanceRef = result.distanceRef;
        localStorage.setItem(NOSE_GAIN_KEY, String(noseGain));
        localStorage.setItem(YAW_GAIN_KEY, String(yawGain));
        saveSideGainRatios();
        localStorage.setItem(NOSE_NOISE_KEY, String(noseNoise));
        localStorage.setItem(ANGLE_NOISE_KEY, String(angleNoise));
        localStorage.setItem(JAW_OPEN_THRESHOLD_KEY, String(jawOpenThreshold));
        localStorage.setItem(DISTANCE_EXPONENT_KEY, String(distanceExponent));
        if (distanceRef > 0) localStorage.setItem(DISTANCE_REF_KEY, String(distanceRef));
        isNoiseDeadzone = true;
        localStorage.setItem(CALIB_VERSION_KEY, CALIB_VERSION_NOISE_DEADZONE);
        syncTuningSliders();
        close();
        jawClosedBaseline = null;
        // 正面位置も今の姿勢で取り直す。絶対方式は正面がずれると全体がずれるので、○を向いて登録する
        // 登録できれば recaptureFrontPose が解除し、時間切れなら起動時と同じく次のフレームの姿勢を正面にする
        isCalibrating = true;
        if (pointerMode === POINTER_MODE_ABSOLUTE) start({ frontOnly: true });
    }

    function onTargetFrame(sample, timeMs, dt) {
        const step = currentStep();
        buffer.push({ t: timeMs, sample });
        buffer = buffer.filter(entry => timeMs - entry.t <= CALIB_SAMPLE_BUFFER_MS);

        if (matchedElapsedMs !== null) {
            matchedElapsedMs += dt;
            render(sample);
            if (matchedElapsedMs >= CALIB_MATCH_SHOW_MS) nextStep();
            return;
        }

        const isCenter = step.target.key === "center";
        const relax = stepElapsedMs > CALIB_STILL_RELAX_AFTER_MS ? CALIB_STILL_RELAX_FACTOR : 1;
        const center = passCenter(step.pass);
        const moved = isCenter || !center || hasMovedFrom(sample, center) || stepElapsedMs > CALIB_MOVE_GIVEUP_MS;
        const cursor = predictCursor(sample);
        const target = targetPx(step.target);
        const inCircle = cursor !== null && Math.hypot(cursor.x - target.x, cursor.y - target.y) <= CALIB_TARGET_RADIUS_PX;

        if (stepElapsedMs >= CALIB_SETTLE_MS && moved && isStill(timeMs, relax)) {
            holdMs += dt;
        } else {
            holdMs = 0;
        }

        // 上下の○は、予測カーソルが○に入っても短縮しない。予測には仮の倍率（上の○の倍率など）を使うので、
        // 向いている途中で○に入ると、動きの小さい記録から倍率が大きく出てしまう
        const allowQuickCapture = inCircle && CALIB_SIDE_KEYS[step.target.key] === "dx";
        const required = isCenter ? CALIB_CENTER_HOLD_MS : (allowQuickCapture ? CALIB_TARGET_HOLD_IN_CIRCLE_MS : CALIB_TARGET_HOLD_MS);
        cursorEl.classList.toggle("in-circle", inCircle);
        if (holdMs >= required) capture(timeMs);
        else if (frontOnly && stepElapsedMs >= CALIB_FRONT_TIMEOUT_MS) {
            // 止まれないまま時間が経ったら、元の正面のまま閉じる（誤って起動した場合もここで戻る）
            close();
            return;
        } else if (stepElapsedMs >= CALIB_CAPTURE_GIVEUP_MS) capture(timeMs, true);
        render(sample);
    }

    function onDistanceFrame(sample, dt) {
        const near = passCenter("near");
        if (!near || !Number.isFinite(near.distance) || !Number.isFinite(sample.distance)) {
            // 距離が取れない環境では離れた位置の計測を行わない
            skipFarPass();
            return;
        }
        buffer.push({ t: stepElapsedMs, sample });
        buffer = buffer.filter(entry => stepElapsedMs - entry.t <= CALIB_SAMPLE_BUFFER_MS);
        const farEnough = sample.distance / near.distance >= CALIB_FAR_MIN_RATIO;
        holdMs = farEnough && isStill(stepElapsedMs, CALIB_STILL_RELAX_FACTOR) ? holdMs + dt : 0;
        if (holdMs >= CALIB_FAR_HOLD_MS || (farEnough && stepElapsedMs >= CALIB_CAPTURE_GIVEUP_MS)) {
            nextStep();
            return;
        }
        render(sample);
    }

    function onMouthFrame(sample) {
        if (stepElapsedMs >= CALIB_PREPARE_MS) mouthSamples.push(sample);
        if (stepElapsedMs >= CALIB_PREPARE_MS + CALIB_RECORD_MS) {
            if (mouthSamples.length < 5) {
                // 顔が取れていなければこの手順をやり直す
                stepElapsedMs = 0;
                mouthSamples = [];
            } else {
                nextStep();
                return;
            }
        }
        render(sample);
    }

    function onFrame(landmarks, detectResults, timeMs) {
        if (!active || finished) return;

        const dt = lastFrameMs === null ? 0 : clamp(timeMs - lastFrameMs, 0, 100);
        lastFrameMs = timeMs;
        stepElapsedMs += dt;

        const sample = readCalibrationSample(landmarks, detectResults);
        if (!sample) return;
        const step = currentStep();
        if (step.type === "target") onTargetFrame(sample, timeMs, dt);
        else if (step.type === "distance") onDistanceFrame(sample, dt);
        else onMouthFrame(sample);
    }

    function onNoFace() {
        if (!active || finished) return;
        // 顔が見えない間は時間を進めず、静止判定もやり直す
        lastFrameMs = null;
        holdMs = 0;
        buffer = [];
        cursorEl.classList.remove("visible");
        subEl.textContent = "顔が見えません。カメラの方を向いてください";
    }

    saveBtn.addEventListener("click", apply);
    retryBtn.addEventListener("click", () => start());
    closeBtn.addEventListener("click", close);
    cancelBtn.addEventListener("click", close);
    skipBtn.addEventListener("click", skipFarPass);

    return {
        start,
        onFrame,
        onNoFace,
        isActive: () => active
    };
})();

// =========================================================
// Controls & Settings UI
// =========================================================
calibrateBtn.addEventListener("click", () => {
    if (!confirm("静止時の揺れ幅と向きごとの倍率を初期値に戻し、今の向きを正面にします。よろしいですか？")) return;
    isCalibrating = true;
    resetPointerMotionHistory();
    jawClosedBaseline = null;
    debugJawOpenThreshold = jawOpenThreshold;
    debugJawCloseThreshold = Math.max(0, jawOpenThreshold - JAW_CLOSE_MIN_GAP);
    // キャリブレーションで決めた揺れ幅・向きごとの倍率はスライダーが無いので、ここで初期値へ戻す
    noseNoise = 0;
    angleNoise = 0;
    sideGainRatios = { left: 1, right: 1, up: 1, down: 1 };
    localStorage.removeItem(NOSE_NOISE_KEY);
    localStorage.removeItem(ANGLE_NOISE_KEY);
    localStorage.removeItem(VERTICAL_GAIN_RATIO_KEY);
    Object.values(SIDE_GAIN_RATIO_KEYS).forEach(key => localStorage.removeItem(key));
    speak("リセット");
});

// 姿勢が変わったときに、キャリブレーション結果（感度・揺れ・距離補正）は残したまま正面だけ取り直す。
// キャリブレーション画面の正面登録と同じく、中央の○を向いて静止したら登録する
function startFrontRecapture() {
    if (calibrationWizard.isActive()) return;
    calibrationWizard.start({ frontOnly: true });
}

// sample があれば（キャリブレーション画面の静止中の平均）それを正面にし、無ければ次のフレームの姿勢を正面にする。
// screenPoint は sample のときに向いていた画面上の位置（画面に対する割合）
function recaptureFrontPose(sample = null, screenPoint = null) {
    clearPostureHint();
    resetPointerMotionHistory();
    if (sample && [sample.noseX, sample.noseY, sample.yaw, sample.pitch].every(Number.isFinite)) {
        // sample.noseX はランタイムと同じ鏡像座標（1 - nose.x）
        calibratedNoseX = sample.noseX;
        calibratedNoseY = sample.noseY;
        calibratedYaw = sample.yaw;
        calibratedPitch = sample.pitch;
        if (Number.isFinite(sample.distance)) sessionDistanceRef = sample.distance;
        frontScreenPoint = screenPoint;
        // 起動時の校正待ち（isCalibrating）が残っていると、次のフレームの姿勢で上書きされるので解除する
        isCalibrating = false;
        speak("完了");
    } else {
        frontScreenPoint = null;
        isCalibrating = true;
    }
    // 取り直した正面の位置へポインタを置き直す
    const bounds = getSymptomRowPointerBounds();
    if (bounds && isSimpleMode()) {
        const front = getSimpleFrontPoint(bounds);
        targetX = pointerX = front.x;
        targetY = pointerY = front.y;
    } else {
        if (bounds) targetX = pointerX = (bounds.minX + bounds.maxX) / 2;
        snapPointerToFrontRow();
    }
}

// 症状モードの縦: 絶対方式では今の段の行が正面、相対方式では上段から始める
function snapPointerToFrontRow() {
    if (isSimpleMode() || !isVerticalMoveEnabled) return;
    if (pointerMode === POINTER_MODE_ABSOLUTE && symptomStage === SYMPTOM_STAGE_BODY_PART) snapPointerToLowerRow();
    else snapPointerToUpperRow();
}

// ファイルを画像入力以外に落としたとき、画面がそのファイルに切り替わってアプリが消えないようにする
["dragover", "drop"].forEach((type) => {
    document.addEventListener(type, (event) => {
        if (!event.dataTransfer?.types?.includes("Files")) return;
        if (event.target?.closest?.('input[type="file"]')) return;
        event.preventDefault();
    });
});

const recaptureFrontBtn = document.getElementById("recapture-front-btn");
if (recaptureFrontBtn) {
    recaptureFrontBtn.addEventListener("click", startFrontRecapture);
}

const audioCacheBtn = document.getElementById("audio-cache-btn");
audioCacheBtn.addEventListener("click", () => {
    // 画面で入力した API Key・TTSモデルで作る（「保存して閉じる」を先に押さなくてよい）。
    // 押し直したときは、前の認証エラー・1日の上限の記録も解除してもう一度試す
    saveVoiceSettingsFromForm();
    const provider = getTtsProvider();
    if (provider === "browser") {
        alert("今はブラウザ内蔵の音声を使っています（前もって作る必要はありません）。\n上の TTSモデルで音声を変えると、ここで作れます。");
        return;
    }
    if (provider !== "voicevox" && !GEMINI_API_KEY) {
        alert("音声データを作るには、Gemini API Key を入力してください。");
        activateSettingsTab("voice-tab");
        apiKeyInput?.focus();
        return;
    }
    // すぐ始め、進み具合をこのタブに出す（作成済みの文はそのまま。作成中も話せる）。
    // Gemini TTS だけは1日の回数制限を使い切るおそれがあるので確かめる
    if (provider === "gemini" && !confirm("Gemini TTS は1文に数秒かかり、1日の回数制限で途中で止まることがあります（Cloud TTS・VOICEVOX がおすすめ）。作成しますか？")) return;
    const createStatus = document.getElementById("audio-cache-create-result");
    if (createStatus) createStatus.textContent = "";
    void prefetchAllAudio();
});

// 全画面表示の切り替え（ブラウザ版向け。Escでも解除される）
const fullscreenBtn = document.getElementById("fullscreen-btn");

function updateFullscreenButton() {
    const isFullscreen = Boolean(document.fullscreenElement);
    document.body.classList.toggle("is-fullscreen", isFullscreen);
    if (!fullscreenBtn) return;
    fullscreenBtn.textContent = isFullscreen ? "⤡" : "⛶";
    const title = isFullscreen ? "全画面を解除" : "全画面表示（Escでも解除）";
    fullscreenBtn.title = title;
    fullscreenBtn.setAttribute("aria-label", title);
}

if (fullscreenBtn) {
    if (!document.fullscreenEnabled) {
        fullscreenBtn.style.display = "none";
    } else {
        fullscreenBtn.addEventListener("click", async () => {
            try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else await document.documentElement.requestFullscreen();
            } catch (error) {
                console.warn("fullscreen toggle failed:", error);
            }
        });
        document.addEventListener("fullscreenchange", updateFullscreenButton);
        updateFullscreenButton();
    }
}

const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const apiKeyInput = document.getElementById("api-key-input");
const ttsModelSelect = document.getElementById("tts-model-select");
const ttsModelFetchBtn = document.getElementById("tts-model-fetch-btn");
const ttsModelStatus = document.getElementById("tts-model-status");
const geminiVoiceSelect = document.getElementById("gemini-voice-select");
const geminiStyleInput = document.getElementById("gemini-style-input");
const geminiStyleResetBtn = document.getElementById("gemini-style-reset-btn");

if (geminiVoiceSelect) {
    GEMINI_VOICES.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v.name;
        opt.textContent = v.label;
        geminiVoiceSelect.appendChild(opt);
    });
}

if (geminiStyleResetBtn && geminiStyleInput) {
    geminiStyleResetBtn.addEventListener("click", () => {
        geminiStyleInput.value = DEFAULT_GEMINI_STYLE;
    });
}
const jawOpenThresholdSlider = document.getElementById("jaw-open-threshold-slider");
const noseGainSlider = document.getElementById("nose-gain-slider");
const yawGainSlider = document.getElementById("yaw-gain-slider");
const iconStyleSelect = document.getElementById("icon-style-select");
// ラジオボタン群を <select> と同じ感覚(value / change)で扱う
function radioGroup(name) {
    const inputs = () => Array.from(document.querySelectorAll(`input[type="radio"][name="${name}"]`));
    if (inputs().length === 0) return null;
    return {
        get value() {
            return inputs().find(input => input.checked)?.value ?? "";
        },
        set value(next) {
            inputs().forEach(input => { input.checked = input.value === String(next); });
        },
        addEventListener(type, handler) {
            inputs().forEach(input => input.addEventListener(type, handler));
        }
    };
}

const modeSelect = radioGroup("app-mode");
const dwellTimeSelect = radioGroup("dwell-time");
const pointerModeSelect = radioGroup("pointer-mode");
const panelSnapInput = document.getElementById("panel-snap-input");
const axisLockInput = document.getElementById("axis-lock-input");
const distanceCompInput = document.getElementById("distance-comp-input");
const recenterInput = document.getElementById("recenter-input");
const verticalMoveInput = document.getElementById("vertical-move-input");
const calibFarPassInput = document.getElementById("calib-far-pass-input");
const pointerTab = document.getElementById("pointer-tab");
const simpleGridSizeSelect = radioGroup("simple-grid-size");
const simplePanelFilter = document.getElementById("simple-panel-filter");
const simpleTabsContainer = document.getElementById("simple-tabs");
const layoutPagesContainer = document.getElementById("layout-pages");
const layoutDetailContainer = document.getElementById("layout-detail");
const talkWordList = document.getElementById("talk-word-list");
const talkWordFilter = document.getElementById("talk-word-filter");
const talkLearnInput = document.getElementById("talk-learn-input");
const talkHistorySummary = document.getElementById("talk-history-summary");
const talkCustomLabelInput = document.getElementById("talk-custom-label-input");
const talkCustomEmojiInput = document.getElementById("talk-custom-emoji-input");
const talkCustomSayInput = document.getElementById("talk-custom-say-input");
const talkSetList = document.getElementById("talk-set-list");
const talkProfileGenderSelect = document.getElementById("talk-profile-gender");
const talkProfileAgeInput = document.getElementById("talk-profile-age");
const talkAiModelInput = document.getElementById("talk-ai-model-input");
const talkInterviewCarryInput = document.getElementById("talk-interview-carry");
const talkInterviewStartBtn = document.getElementById("talk-interview-start-btn");
const talkGenerateBtn = document.getElementById("talk-generate-btn");
const talkInterviewList = document.getElementById("talk-interview-list");
const talkAiStatus = document.getElementById("talk-ai-status");
const questionButtonsContainer = document.getElementById("question-buttons");
const questionModeBar = document.getElementById("question-mode-bar");
const questionEndBtn = document.getElementById("question-end-btn");
const questionEditorList = document.getElementById("question-editor-list");
const questionSpeakInput = document.getElementById("question-speak-input");
const questionCustomTextInput = document.getElementById("question-custom-text-input");
const questionCustomLabelInput = document.getElementById("question-custom-label-input");
const questionCustomEmojiInput = document.getElementById("question-custom-emoji-input");
const questionAnswerSelect = document.getElementById("question-answer-select");
const questionGridSizeSelect = radioGroup("question-grid-size");
const questionAnswerSummary = document.getElementById("question-answer-summary");
const questionAnswerPagesContainer = document.getElementById("question-answer-pages");
const questionAnswerDetail = document.getElementById("question-answer-detail");
const questionAnswerFilter = document.getElementById("question-answer-filter");
const questionAnswerPalette = document.getElementById("question-answer-palette");
const questionCustomAnswersInput = document.getElementById("question-custom-answers-input");
const questionPanelPicker = document.getElementById("question-panel-picker");
const questionPanelPickSummary = document.getElementById("question-panel-pick-summary");
const questionPanelPickClearBtn = document.getElementById("question-panel-pick-clear-btn");
const settingsCloseX = document.getElementById("settings-close-x");
const apiKeyRevealBtn = document.getElementById("api-key-reveal-btn");
const simpleShowRestInput = document.getElementById("simple-show-rest-input");
const simpleConfirmSoundInput = document.getElementById("simple-confirm-sound-input");
const simplePanelList = document.getElementById("simple-panel-list");
const simplePanelSummary = document.getElementById("simple-panel-summary");
const simpleCustomNameInput = document.getElementById("simple-custom-name-input");
const simpleCustomSentenceInput = document.getElementById("simple-custom-sentence-input");
const simpleCustomEmojiInput = document.getElementById("simple-custom-emoji-input");
const simpleCustomImageInput = document.getElementById("simple-custom-image-input");
const simpleCustomImagePreview = document.getElementById("simple-custom-image-preview");
const simpleCustomAddBtn = document.getElementById("simple-custom-add-btn");
const settingsTabButtons = document.querySelectorAll(".settings-tab-btn");
const settingsTabContents = document.querySelectorAll(".settings-tab-content");
const jawOpenThresholdValue = document.getElementById("jaw-open-threshold-value");
const noseGainValue = document.getElementById("nose-gain-value");
const yawGainValue = document.getElementById("yaw-gain-value");
const saveSettingsBtn = document.getElementById("save-settings");
const closeSettingsBtn = document.getElementById("close-settings");

// 設定の「キャリブレーションを始める」（基本タブの手順・ポインタと確定タブ）。設定を保存して閉じてから始める
document.querySelectorAll(".calib-start-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        if (calibrationWizard.isActive()) return;
        if (!saveSettingsAndClose()) return;
        calibrationWizard.start();
    });
});

// 初回の案内: キャリブレーションがまだなら起動時に出す
const welcomeModal = document.getElementById("welcome-modal");

function openWelcome() {
    welcomeModal?.classList.add("active");
}

document.getElementById("welcome-start-btn")?.addEventListener("click", () => {
    welcomeModal?.classList.remove("active");
    calibrationWizard.start();
});

// あとで: いつもの起動と同じく正面だけ登録する（正面固定のとき）
document.getElementById("welcome-later-btn")?.addEventListener("click", () => {
    welcomeModal?.classList.remove("active");
    if (pointerMode === POINTER_MODE_ABSOLUTE) startFrontRecapture();
});

function updateCalibStatusBadge() {
    const badge = document.getElementById("calib-status-badge");
    if (!badge) return;
    const done = isCalibrationDone();
    badge.textContent = done ? "✓ 済み" : "まだです";
    badge.classList.toggle("is-done", done);
}

function applyPointerModeState() {
    document.body.classList.toggle("pointer-absolute", pointerMode === POINTER_MODE_ABSOLUTE);
}

applyPointerModeState();

// 設定画面: 選んだ動かし方で働かない補助を薄くする
function refreshPointerOptionAvailability() {
    if (!pointerTab || !pointerModeSelect) return;
    const mode = pointerModeSelect.value;
    pointerTab.querySelectorAll("[data-pointer-mode]").forEach((row) => {
        row.classList.toggle("is-inactive", row.dataset.pointerMode !== mode);
    });
}

pointerModeSelect?.addEventListener("change", refreshPointerOptionAvailability);

function refreshTuningSliderLabels() {
    if (jawOpenThresholdValue) jawOpenThresholdValue.textContent = jawOpenThreshold.toFixed(2);
    if (noseGainValue) noseGainValue.textContent = noseGain.toFixed(1);
    if (yawGainValue) yawGainValue.textContent = yawGain.toFixed(1);
}

if (jawOpenThresholdSlider) {
    jawOpenThresholdSlider.addEventListener("input", (e) => {
        jawOpenThreshold = Number.parseFloat(e.target.value);
        localStorage.setItem(JAW_OPEN_THRESHOLD_KEY, String(jawOpenThreshold));
        refreshTuningSliderLabels();
    });
}

if (noseGainSlider) {
    noseGainSlider.addEventListener("input", (e) => {
        noseGain = Number.parseFloat(e.target.value);
        localStorage.setItem(NOSE_GAIN_KEY, String(noseGain));
        refreshTuningSliderLabels();
    });
}

if (yawGainSlider) {
    yawGainSlider.addEventListener("input", (e) => {
        yawGain = Number.parseFloat(e.target.value);
        localStorage.setItem(YAW_GAIN_KEY, String(yawGain));
        isCalibrating = true;
        lastYaw = null;
        filteredYaw = null;
        lastPitch = null;
        filteredPitch = null;
        refreshTuningSliderLabels();
    });
}

function syncTuningSliders() {
    if (jawOpenThresholdSlider) jawOpenThresholdSlider.value = String(jawOpenThreshold);
    if (noseGainSlider) noseGainSlider.value = String(noseGain);
    if (yawGainSlider) yawGainSlider.value = String(yawGain);
    refreshTuningSliderLabels();
}

syncTuningSliders();

function renderTtsModelOptions(list, selected) {
    if (!ttsModelSelect) return;
    const options = list.some(m => m.value === selected)
        ? list
        : [{ value: selected, label: `${selected} (一覧に無し)` }, ...list];
    ttsModelSelect.innerHTML = "";
    options.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.value;
        opt.textContent = m.label;
        ttsModelSelect.appendChild(opt);
    });
    ttsModelSelect.value = selected;
}

if (ttsModelFetchBtn) {
    ttsModelFetchBtn.addEventListener("click", async () => {
        const key = apiKeyInput.value.trim();
        if (!key) {
            if (ttsModelStatus) ttsModelStatus.textContent = "API Key を入力してください。";
            return;
        }
        ttsModelFetchBtn.disabled = true;
        if (ttsModelStatus) ttsModelStatus.textContent = "取得中...";
        const current = ttsModelSelect ? ttsModelSelect.value : ttsModel;
        const { models, errors } = await fetchAvailableTtsModels(key);
        ttsModelFetchBtn.disabled = false;

        if (!models.length) {
            if (ttsModelStatus) ttsModelStatus.textContent = `取得失敗: ${errors.join(" / ")}`;
            return;
        }
        localStorage.setItem(TTS_MODEL_LIST_KEY, JSON.stringify(models));
        renderTtsModelOptions(loadTtsModelList(), current);
        if (ttsModelStatus) {
            ttsModelStatus.textContent = `${models.length} 件取得` + (errors.length ? ` (一部失敗: ${errors.join(" / ")})` : "");
        }
    });
}

const voicevoxUrlInput = document.getElementById("voicevox-url-input");
const voicevoxFetchBtn = document.getElementById("voicevox-fetch-btn");
const voicevoxStatus = document.getElementById("voicevox-status");
const ttsCreditNote = document.getElementById("tts-credit-note");

// VOICEVOX の話者を選んでいるときは、利用規約に沿ってクレジットを表示する
function updateTtsCreditNote() {
    // 選んだ声で使わない設定（Gemini の話者・口調）は薄くする
    const provider = getTtsProvider(ttsModelSelect ? ttsModelSelect.value : ttsModel);
    document.querySelectorAll("#voice-tab [data-tts-provider]").forEach((section) => {
        section.classList.toggle("is-inactive", section.dataset.ttsProvider !== provider);
    });
    if (!ttsCreditNote) return;
    const model = ttsModelSelect ? ttsModelSelect.value : ttsModel;
    const speaker = readStoredList(VOICEVOX_SPEAKERS_KEY).find(m => m.value === model);
    ttsCreditNote.textContent = speaker ? `音声: ${speaker.credit}（VOICEVOX を使って作った音声を公開するときはこのクレジットを表記）` : "";
}

if (ttsModelSelect) ttsModelSelect.addEventListener("change", updateTtsCreditNote);

if (voicevoxFetchBtn) {
    voicevoxFetchBtn.addEventListener("click", async () => {
        voicevoxFetchBtn.disabled = true;
        if (voicevoxStatus) voicevoxStatus.textContent = "取得中...";
        const current = ttsModelSelect ? ttsModelSelect.value : ttsModel;
        try {
            const speakers = await fetchVoicevoxSpeakers(voicevoxUrlInput ? voicevoxUrlInput.value : voicevoxUrl);
            localStorage.setItem(VOICEVOX_SPEAKERS_KEY, JSON.stringify(speakers));
            renderTtsModelOptions(loadTtsModelList(), current);
            if (voicevoxStatus) voicevoxStatus.textContent = `${speakers.length} 件の話者を取得しました。上の「TTSモデル」から選んでください。`;
        } catch (error) {
            if (voicevoxStatus) voicevoxStatus.textContent = `取得失敗: ${error.message}`;
        } finally {
            voicevoxFetchBtn.disabled = false;
            updateTtsCreditNote();
        }
    });
}

document.getElementById("audio-cache-clear-btn")?.addEventListener("click", () => {
    if (!confirm("前もって作った音声をすべて消去しますか？（次に話すときに作り直します）")) return;
    clearAudioCache();
    const status = document.getElementById("audio-cache-clear-result");
    if (status) status.textContent = "消去しました。";
    setTimeout(() => void updateAudioCacheSummary(), 300);
});

// 保存した音声の書き出し・読み込み（ほかの端末へコピーする）。
// ファイルの中身: "FDAUDIO1" / 目次の長さ（4バイト）/ 目次 JSON { version, entries: [{ key, type, size }] } / 音声を目次の順に連結
const AUDIO_EXPORT_MAGIC = "FDAUDIO1";
const audioTransferResult = document.getElementById("audio-cache-transfer-result");
const setAudioTransferResult = (text) => { if (audioTransferResult) audioTransferResult.textContent = text; };

function getAllCachedAudioEntries() {
    if (!db) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
        const entries = [];
        const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).openCursor();
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) { resolve(entries); return; }
            const blob = cursor.value;
            if (blob instanceof Blob && blob.size >= AUDIO_MIN_BYTES) entries.push({ key: String(cursor.key), blob });
            cursor.continue();
        };
        request.onerror = () => reject(request.error);
    });
}

// 書き出したときの音声設定。読み込んだ端末で同じ設定を選び、読み込んだ音声がそのまま使われるようにする
function getVoiceSettingsForExport() {
    return {
        ttsModel,
        geminiVoice,
        geminiStyle,
        voicevoxUrl: getVoicevoxBaseUrl(),
        // VOICEVOX の話者は、読み込み先で「話者を取得」していなくても名前とクレジットを出せるように一緒に入れる
        voicevoxSpeaker: readStoredList(VOICEVOX_SPEAKERS_KEY).find(m => m.value === ttsModel) || null,
        label: loadTtsModelList().find(m => m.value === ttsModel)?.label || ttsModel
    };
}

// 読み込んだファイルの音声設定を選んで保存し、開いている設定画面の入力にも反映する（API Key は変えない）
function applyImportedVoiceSettings(settings) {
    if (!settings || typeof settings.ttsModel !== "string" || !settings.ttsModel.includes(":")) return null;
    ttsModel = settings.ttsModel;
    localStorage.setItem(TTS_MODEL_KEY, ttsModel);
    if (typeof settings.geminiVoice === "string" && settings.geminiVoice) {
        geminiVoice = settings.geminiVoice;
        localStorage.setItem(GEMINI_VOICE_KEY, geminiVoice);
    }
    if (typeof settings.geminiStyle === "string") {
        geminiStyle = settings.geminiStyle;
        localStorage.setItem(GEMINI_STYLE_KEY, geminiStyle);
    }
    if (typeof settings.voicevoxUrl === "string" && settings.voicevoxUrl) {
        voicevoxUrl = getVoicevoxBaseUrl(settings.voicevoxUrl);
        localStorage.setItem(VOICEVOX_URL_KEY, voicevoxUrl);
    }
    const speaker = settings.voicevoxSpeaker;
    if (speaker && speaker.value === ttsModel) {
        const speakers = readStoredList(VOICEVOX_SPEAKERS_KEY);
        if (!speakers.some(m => m.value === speaker.value)) {
            localStorage.setItem(VOICEVOX_SPEAKERS_KEY, JSON.stringify([...speakers, speaker]));
        }
    }
    ttsDailyLimitModel = null;

    renderTtsModelOptions(loadTtsModelList(), ttsModel);
    if (voicevoxUrlInput) voicevoxUrlInput.value = voicevoxUrl;
    if (geminiVoiceSelect) geminiVoiceSelect.value = geminiVoice;
    if (geminiStyleInput) geminiStyleInput.value = geminiStyle;
    updateTtsCreditNote();
    return loadTtsModelList().find(m => m.value === ttsModel)?.label || settings.label || ttsModel;
}

async function exportAudioCache() {
    if (!db) { setAudioTransferResult("このブラウザでは音声を保存できません。"); return; }
    setAudioTransferResult("書き出し中…");
    const entries = await getAllCachedAudioEntries();
    if (entries.length === 0) { setAudioTransferResult("保存した音声がありません。"); return; }
    const header = new TextEncoder().encode(JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        settings: getVoiceSettingsForExport(),
        entries: entries.map(({ key, blob }) => ({ key, type: blob.type, size: blob.size }))
    }));
    const headerLength = new Uint8Array(4);
    new DataView(headerLength.buffer).setUint32(0, header.length, true);
    const file = new Blob([AUDIO_EXPORT_MAGIC, headerLength, header, ...entries.map(e => e.blob)], { type: "application/octet-stream" });
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = `audio-cache-${stamp}.fdaudio`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    setAudioTransferResult(`${entries.length} 件を書き出しました（${(file.size / 1024 / 1024).toFixed(1)} MB）。`);
}

async function importAudioCache(file) {
    if (!db) { setAudioTransferResult("このブラウザでは音声を保存できません。"); return; }
    setAudioTransferResult("読み込み中…");
    const magic = await file.slice(0, AUDIO_EXPORT_MAGIC.length).text();
    if (magic !== AUDIO_EXPORT_MAGIC) { setAudioTransferResult("⚠ 音声の書き出しファイルではありません。"); return; }
    const lengthOffset = AUDIO_EXPORT_MAGIC.length;
    const headerLength = new DataView(await file.slice(lengthOffset, lengthOffset + 4).arrayBuffer()).getUint32(0, true);
    let header;
    try {
        header = JSON.parse(await file.slice(lengthOffset + 4, lengthOffset + 4 + headerLength).text());
    } catch {
        setAudioTransferResult("⚠ ファイルが壊れています。");
        return;
    }
    const entries = Array.isArray(header?.entries) ? header.entries : [];
    let offset = lengthOffset + 4 + headerLength;
    let saved = 0;
    for (const entry of entries) {
        const size = Number(entry?.size) || 0;
        const blob = file.slice(offset, offset + size, entry?.type || "");
        offset += size;
        if (typeof entry?.key !== "string" || size < AUDIO_MIN_BYTES || blob.size !== size) continue;
        // file.slice は元ファイルへの参照なので、中身を読み込んでから保存する
        const data = new Blob([await blob.arrayBuffer()], { type: blob.type });
        if (await setCachedAudio(entry.key, data)) saved++;
        if (saved % 20 === 0) setAudioTransferResult(`読み込み中… ${saved}/${entries.length}`);
    }
    // 以前の書き出しファイルは、モデル・話者ごとの名前で入っているので文だけの名前にまとめる
    await mergeAudioCacheKeys();
    const appliedLabel = saved > 0 ? applyImportedVoiceSettings(header.settings) : null;
    setAudioTransferResult((saved === entries.length
        ? `${saved} 件を読み込みました。`
        : `${saved}/${entries.length} 件を読み込みました（残りは壊れているか保存できませんでした）。`)
        + (appliedLabel ? ` 音声を「${appliedLabel}」に切り替えました。` : ""));
    void updateAudioCacheSummary();
}

document.getElementById("audio-cache-export-btn")?.addEventListener("click", () => {
    exportAudioCache().catch((error) => {
        console.error("audio export failed:", error);
        setAudioTransferResult(`⚠ 書き出せませんでした: ${String(error?.message || error).slice(0, 80)}`);
    });
});

const audioCacheImportInput = document.getElementById("audio-cache-import-input");
document.getElementById("audio-cache-import-btn")?.addEventListener("click", () => audioCacheImportInput?.click());
audioCacheImportInput?.addEventListener("change", () => {
    const file = audioCacheImportInput.files?.[0];
    audioCacheImportInput.value = "";
    if (!file) return;
    importAudioCache(file).catch((error) => {
        console.error("audio import failed:", error);
        setAudioTransferResult(`⚠ 読み込めませんでした: ${String(error?.message || error).slice(0, 80)}`);
    });
});

// 設定画面の未保存の値 (API Key / モデル / 話者 / 口調) でキャッシュを使わず即時発話する（音声タブの「試聴」）
const ttsPreviewStatus = document.getElementById("tts-preview-status");
let ttsPreviewController = null;

async function previewTts(text, button) {
    const phrase = (text || "").trim();
    const apiKey = apiKeyInput.value.trim();
    const setStatus = (msg) => { if (ttsPreviewStatus) ttsPreviewStatus.textContent = msg; };
    if (!phrase) { setStatus("文言が空です。"); return; }

    const model = (ttsModelSelect && ttsModelSelect.value) || ttsModel;
    const provider = getTtsProvider(model);
    const modelName = model.slice(provider.length + 1) || "ブラウザ内蔵";
    if (!apiKey && (provider === "cloud" || provider === "gemini")) { setStatus("API Key を入力してください。"); return; }

    if (ttsPreviewController) ttsPreviewController.abort();
    const controller = new AbortController();
    ttsPreviewController = controller;
    window.speechSynthesis.cancel();

    if (provider === "browser") {
        ttsPreviewController = null;
        const uttr = new SpeechSynthesisUtterance(phrase);
        if (preferredVoice) uttr.voice = preferredVoice;
        uttr.lang = "ja-JP";
        uttr.rate = 0.95;
        window.speechSynthesis.speak(uttr);
        setStatus(`再生中: ${preferredVoice ? preferredVoice.name : "ブラウザ内蔵の音声"}`);
        return;
    }

    document.querySelectorAll(".tts-preview-btn").forEach(b => b.classList.remove("is-loading"));
    button.classList.add("is-loading");
    setStatus(`合成中: ${modelName}`);
    try {
        const opts = {
            model,
            apiKey,
            voice: geminiVoiceSelect ? geminiVoiceSelect.value : geminiVoice,
            style: geminiStyleInput ? geminiStyleInput.value.trim() : geminiStyle,
            voicevoxUrl: voicevoxUrlInput ? voicevoxUrlInput.value : voicevoxUrl,
            preview: true
        };
        const blob = await synthesizeSpeech(phrase, controller.signal, opts);
        if (ttsPreviewController !== controller) return;
        button.classList.remove("is-loading");
        setStatus(`再生中: ${modelName}`);
        await playBlob(blob);
        if (ttsPreviewController === controller) setStatus("");
    } catch (err) {
        if (err.name === "AbortError") return;
        console.error("TTS preview error:", err);
        setStatus(`発話失敗: ${describeTtsError(err)}`);
    } finally {
        button.classList.remove("is-loading");
        if (ttsPreviewController === controller) ttsPreviewController = null;
    }
}

document.querySelectorAll(".tts-preview-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const input = document.getElementById(btn.dataset.target);
        previewTts(input ? input.value : "", btn);
    });
});

settingsBtn.addEventListener("click", () => {
    updateCalibStatusBadge();
    apiKeyInput.value = GEMINI_API_KEY;
    apiKeyInput.type = "password";
    if (apiKeyRevealBtn) apiKeyRevealBtn.textContent = "表示";
    renderTtsModelOptions(loadTtsModelList(), ttsModel);
    if (voicevoxUrlInput) voicevoxUrlInput.value = voicevoxUrl;
    if (voicevoxStatus) voicevoxStatus.textContent = "";
    const cacheClearStatus = document.getElementById("audio-cache-clear-result");
    if (cacheClearStatus) cacheClearStatus.textContent = "";
    const cacheCreateStatus = document.getElementById("audio-cache-create-result");
    if (cacheCreateStatus) cacheCreateStatus.textContent = "";
    void updateAudioCacheSummary();
    updateTtsCreditNote();
    if (ttsModelStatus) ttsModelStatus.textContent = "";
    if (geminiVoiceSelect) geminiVoiceSelect.value = geminiVoice;
    if (geminiStyleInput) geminiStyleInput.value = geminiStyle;
    if (ttsPreviewStatus) ttsPreviewStatus.textContent = "";
    if (iconStyleSelect) iconStyleSelect.value = iconStyle;
    if (modeSelect) modeSelect.value = appMode;
    if (dwellTimeSelect) dwellTimeSelect.value = String(dwellTimeMs);
    if (pointerModeSelect) pointerModeSelect.value = pointerMode;
    if (panelSnapInput) panelSnapInput.checked = isPanelSnapEnabled;
    if (axisLockInput) axisLockInput.checked = isAxisLockEnabled;
    if (distanceCompInput) distanceCompInput.checked = isDistanceCompEnabled;
    if (recenterInput) recenterInput.checked = isRecenterEnabled;
    if (verticalMoveInput) verticalMoveInput.checked = isVerticalMoveEnabled;
    if (calibFarPassInput) calibFarPassInput.checked = isCalibFarPassEnabled;
    refreshPointerOptionAvailability();
    openSimplePanelEditor();
    openQuestionEditor();
    openTalkEditor();
    refreshTuningSliderLabels();
    settingsModal.classList.add("active");
});

closeSettingsBtn.addEventListener("click", () => {
    settingsModal.classList.remove("active");
});

if (settingsCloseX) {
    settingsCloseX.addEventListener("click", () => settingsModal.classList.remove("active"));
}

if (apiKeyRevealBtn) {
    apiKeyRevealBtn.addEventListener("click", () => {
        const isHidden = apiKeyInput.type === "password";
        apiKeyInput.type = isHidden ? "text" : "password";
        apiKeyRevealBtn.textContent = isHidden ? "隠す" : "表示";
    });
}

// 音声タブの入力（API Key・TTSモデル・VOICEVOX・Gemini 話者・口調）を保存して使い始める。
// 「保存して閉じる」と「音声データを作成」の両方から呼ぶ（作成ボタンだけ押しても、画面の入力で作れるように）
function saveVoiceSettingsFromForm() {
    const newKey = apiKeyInput.value.trim();
    GEMINI_API_KEY = newKey;
    geminiAuthBlocked = false;
    ttsDailyLimitModel = null;
    localStorage.setItem("gemini_api_key", newKey);
    if (ttsModelSelect && ttsModelSelect.value) {
        ttsModel = ttsModelSelect.value;
        localStorage.setItem(TTS_MODEL_KEY, ttsModel);
    }
    if (voicevoxUrlInput) {
        voicevoxUrl = getVoicevoxBaseUrl(voicevoxUrlInput.value);
        localStorage.setItem(VOICEVOX_URL_KEY, voicevoxUrl);
    }
    if (geminiVoiceSelect && geminiVoiceSelect.value) {
        geminiVoice = geminiVoiceSelect.value;
        localStorage.setItem(GEMINI_VOICE_KEY, geminiVoice);
    }
    if (geminiStyleInput) {
        geminiStyle = geminiStyleInput.value.trim();
        localStorage.setItem(GEMINI_STYLE_KEY, geminiStyle);
    }
}

// 設定を保存して閉じる。保存できなかったら（容量超過など）開いたままで false
function saveSettingsAndClose() {
    // 画像を含み容量超過しやすいパネル設定を先に保存し、失敗したら他も保存しない
    if (!saveSimplePanelEditor()) return false;
    if (!saveQuestionEditor()) return false;
    if (!saveTalkEditor()) return false;

    const previousTtsModel = ttsModel;
    saveVoiceSettingsFromForm();

    localStorage.setItem(JAW_OPEN_THRESHOLD_KEY, String(jawOpenThreshold));
    localStorage.setItem(NOSE_GAIN_KEY, String(noseGain));
    localStorage.setItem(YAW_GAIN_KEY, String(yawGain));
    if (iconStyleSelect) {
        iconStyle = iconStyleSelect.value;
        localStorage.setItem(ICON_STYLE_KEY, iconStyle);
    }
    if (dwellTimeSelect) {
        dwellTimeMs = readStoredNumberFromValue(dwellTimeSelect.value, DWELL_TIME_DEFAULT_MS, 0, DWELL_TIME_MAX_MS);
        localStorage.setItem(DWELL_TIME_KEY, String(dwellTimeMs));
    }
    if (panelSnapInput) {
        isPanelSnapEnabled = panelSnapInput.checked;
        localStorage.setItem(PANEL_SNAP_KEY, isPanelSnapEnabled ? "1" : "0");
        resetPanelSnap();
    }
    if (axisLockInput) {
        isAxisLockEnabled = axisLockInput.checked;
        localStorage.setItem(AXIS_LOCK_KEY, isAxisLockEnabled ? "1" : "0");
    }
    if (distanceCompInput) {
        isDistanceCompEnabled = distanceCompInput.checked;
        localStorage.setItem(DISTANCE_COMP_KEY, isDistanceCompEnabled ? "1" : "0");
    }
    if (recenterInput) {
        isRecenterEnabled = recenterInput.checked;
        localStorage.setItem(RECENTER_KEY, isRecenterEnabled ? "1" : "0");
    }
    if (calibFarPassInput) {
        isCalibFarPassEnabled = calibFarPassInput.checked;
        localStorage.setItem(CALIB_FAR_PASS_KEY, isCalibFarPassEnabled ? "1" : "0");
    }
    const nextPointerMode = pointerModeSelect?.value === POINTER_MODE_RELATIVE ? POINTER_MODE_RELATIVE : POINTER_MODE_ABSOLUTE;
    if (pointerModeSelect && nextPointerMode !== pointerMode) {
        pointerMode = nextPointerMode;
        localStorage.setItem(POINTER_MODE_KEY, pointerMode);
        clearPostureHint();
        resetPointerMotionHistory();
        applyPointerModeState();
    }
    const isVerticalMoveChanged = verticalMoveInput && verticalMoveInput.checked !== isVerticalMoveEnabled;
    if (isVerticalMoveChanged) {
        isVerticalMoveEnabled = verticalMoveInput.checked;
        localStorage.setItem(VERTICAL_MOVE_KEY, isVerticalMoveEnabled ? "1" : "0");
    }

    renderAll();
    if (modeSelect) setAppMode(modeSelect.value);
    // ON→OFF / OFF→ON いずれも上段基準へ戻して仕切り直す
    if (isVerticalMoveChanged) resetSymptomModeState();
    settingsModal.classList.remove("active");
    // 音声を変えたら、新しい音声で前もって作り始める（Gemini TTS は遅く回数制限があるので手動）。
    // 保存した文言で作るよう最後に呼ぶ
    if (ttsModel !== previousTtsModel && ["cloud", "voicevox"].includes(getTtsProvider())) void prefetchAllAudio({ quiet: true });
    return true;
}

saveSettingsBtn.addEventListener("click", saveSettingsAndClose);

function activateSettingsTab(tabId) {
    settingsTabButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tabId));
    settingsTabContents.forEach(content => content.classList.toggle("active", content.id === tabId));
    // 前のタブのスクロール位置のまま開かないよう、先頭から見せる
    document.querySelector(".settings-panes")?.scrollTo({ top: 0 });
    // シンプルモードのタブで足した任意パネル・画面配置を、質問の答えの候補に反映する
    if (tabId === "question-tab") {
        renderQuestionEditor();
        renderQuestionPanelPicker();
    }
}

settingsTabButtons.forEach(btn => {
    btn.addEventListener("click", () => activateSettingsTab(btn.dataset.tab));
});

// 基本タブの「はじめて使うとき」から各タブへ移る
document.querySelectorAll("[data-goto-tab]").forEach(btn => {
    btn.addEventListener("click", () => activateSettingsTab(btn.dataset.gotoTab));
});

if (simpleGridSizeSelect) simpleGridSizeSelect.addEventListener("change", renderSimplePanelEditor);
if (simpleCustomAddBtn) simpleCustomAddBtn.addEventListener("click", addSimpleCustomPanel);
document.getElementById("question-custom-add-btn")?.addEventListener("click", addCustomQuestion);
questionPanelPickClearBtn?.addEventListener("click", clearQuestionPanelPick);
questionAnswerSelect?.addEventListener("change", () => {
    questionAnswerEditId = questionAnswerSelect.value;
    questionAnswerSelectedKey = null;
    renderQuestionAnswerEditor();
});
document.getElementById("question-answer-reset-btn")?.addEventListener("click", resetQuestionAnswers);
document.getElementById("question-reset-order-btn")?.addEventListener("click", resetQuestionOrder);
questionGridSizeSelect?.addEventListener("change", renderQuestionAnswerEditor);
document.getElementById("question-answer-clear-btn")?.addEventListener("click", clearQuestionAnswers);
// 候補の一覧へドラッグすると答えから外す
if (questionAnswerPalette) bindLayoutDrop(questionAnswerPalette, key => removeQuestionAnswer(key));
if (questionEndBtn) questionEndBtn.addEventListener("click", endQuestion);
renderQuestionButtons();
document.getElementById("simple-clear-layout-btn")?.addEventListener("click", clearSimpleLayout);
document.getElementById("simple-reset-panels-btn")?.addEventListener("click", resetSimplePanelSelection);
if (simpleShowRestInput) simpleShowRestInput.addEventListener("change", renderSimplePanelEditor);
// 画面から外すドロップ先: 「追加できるパネル」の一覧
if (simplePanelList) bindLayoutDrop(simplePanelList, id => removeLayoutPanel(id));
document.getElementById("talk-custom-add-btn")?.addEventListener("click", addTalkCustomPhrase);
talkInterviewStartBtn?.addEventListener("click", () => void startTalkInterview());
talkGenerateBtn?.addEventListener("click", () => void generateTalkSetFromInterview());
talkInterviewCarryInput?.addEventListener("change", updateTalkAiButtons);
document.getElementById("talk-history-clear-btn")?.addEventListener("click", () => {
    if (!confirm("お話の「よく話す」記録を消去しますか？")) return;
    clearTalkHistory();
    updateTalkHistorySummary();
    if (isTalkScreen()) rerenderSimpleMode();
});

if (simpleCustomImageInput) {
    simpleCustomImageInput.addEventListener("change", async () => {
        const file = simpleCustomImageInput.files?.[0];
        simpleCustomImageData = "";
        if (simpleCustomImagePreview) simpleCustomImagePreview.style.display = "none";
        if (!file) return;
        try {
            simpleCustomImageData = await readImageAsResizedDataUrl(file);
            if (simpleCustomImagePreview) {
                simpleCustomImagePreview.src = simpleCustomImageData;
                simpleCustomImagePreview.style.display = "";
            }
        } catch (error) {
            alert(error.message);
            simpleCustomImageInput.value = "";
        }
    });
}

settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) {
        settingsModal.classList.remove("active");
    }
});

// =========================================================
// Boot
// =========================================================
(async () => {
    await initDB();
    await mergeAudioCacheKeys();
    if (isQuestionMode()) ensureQuestionModeQuestion();
    renderAll();
    await setupMediaPipe();
})();
