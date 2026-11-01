// 顔の動きからポインタの位置を決める（絶対方式・相対方式・吸着・中央補正）
import { OneEuroFilter, clamp, lowPassFilter } from "../core/math.js";
import {
    ABS_EDGE_RESET_RATIO, ANGLE_EURO_BETA, ANGLE_EURO_MIN_CUTOFF, AXIS_LOCK_ENGAGE_RATIO,
    AXIS_LOCK_MIN_SPEED_PX, AXIS_LOCK_RELEASE_RATIO, AXIS_LOCK_SPEED_ALPHA,
    DISTANCE_FILTER_TIME_CONSTANT_MS, DISTANCE_RATIO_MAX, DISTANCE_RATIO_MIN, MAX_DELTA_PER_FRAME,
    NOISE_DEADZONE_FACTOR, NOSE_DEADZONE_MAX, NOSE_DEADZONE_MIN, NOSE_EURO_BETA, NOSE_EURO_MIN_CUTOFF,
    NOSE_GAIN_EXPONENT, NOSE_GAIN_MAX, NOSE_SCALE_MAX, NOSE_SCALE_MIN, PANEL_SNAP_MAX_RATIO,
    PANEL_SNAP_MIN_RATIO, PANEL_SNAP_SPEED_PX_PER_S, PITCH_MIRROR_SIGN, POINTER_MODE_ABSOLUTE,
    POSTURE_HINT_CLEAR_MS, POSTURE_HINT_CLEAR_RATIO, POSTURE_HINT_PINNED_MS, POSTURE_HINT_PINNED_RATIO,
    RECENTER_RATE, RECENTER_ZONE_RATIO, VERTICAL_NOSE_SCALE_RATIO, VERTICAL_PITCH_SCALE_RATIO,
    YAW_ACCEL_EXPONENT, YAW_ACCEL_FULL_RAD, YAW_ACCEL_MAX_MULTIPLIER, YAW_ACCEL_START_RAD,
    YAW_DEADZONE_MAX, YAW_DEADZONE_MIN, YAW_GAIN_EXPONENT, YAW_GAIN_MAX, YAW_MIRROR_SIGN, YAW_SCALE_MAX,
    YAW_SCALE_MIN, applySideGainRatios, blendSideRatio, pointerConfig
} from "./config.js";
import {
    extractHeadDistance, extractHeadPitchRadians, extractHeadYawRadians, getGazeEnhancedX
} from "../face/head-pose.js";
import {
    findPanelAt, getSimpleFrontPoint, getSimplePanelPointerBounds, getVerticalPointerBounds
} from "./panel-geometry.js";
import { isConfirmInProgress } from "../panels/confirm.js";
import { speak } from "../speech/speak.js";
import { horizontalTravel, signedAcceleratedAngle, verticalTravel } from "../calibration/fit.js";

// Pointer state
export let pointerX = window.innerWidth / 2;
export let pointerY = window.innerHeight / 2;
let lastYaw = null;
let lastPitch = null;
let filteredYaw = null;
let filteredPitch = null;
export let debugDeltaN = 0;
export let debugDeltaY = 0;
export let debugPixN = 0;
export let debugPixY = 0;
export let debugDeltaX = 0;
export let debugDeltaNoseY = 0;
export let debugDeltaPitch = 0;
export let debugDeltaYPx = 0;
// 軸ロック: 横/縦それぞれの移動速度(EMA)と、現在どちらが優勢かの状態
let speedXEma = 0;
let speedYEma = 0;
export let axisLockDominant = null; // "x" | "y" | null
// 起動直後は、顔が見つかったら正面の登録から始める（最初のフレームの姿勢で正面が決まるのを防ぐ）
export let needsStartupFrontRegistration = true;
let sessionDistanceRef = 0;
let targetX = pointerX;
let targetY = pointerY;
let lastNoseControlX = null;
let lastNoseControlY = null;
let filteredNoseControlX = null;
let filteredNoseControlY = null;
let lastMotionUpdateMs = null;
// 絶対方式で振り切ったときの一時的な端（正面からの変位px。null = 振り切っていない）
export let absEdges = { left: null, right: null, up: null, down: null };
// warpX/Y: 縮尺の変更点 { side, mu, pu }（変位 mu → pu。範囲に対する割合）。gx/gy: 吸着中の補正量px
const panelSnap = { warpX: null, warpY: null, gx: 0, gy: 0, glideEl: null, doneEl: null, lastMs: null };
let postureHintPinnedSinceMs = null;
let postureHintCenteredSinceMs = null;
export let debugRecenterDrift = 0;
let filteredHeadDistance = null;
let lastHeadDistanceMs = null;
export let debugDistanceRatio = 1;

// 起動時の正面の登録をしない（キャリブレーションの案内を出したとき・登録を始めたとき）
export function cancelStartupFrontRegistration() {
    needsStartupFrontRegistration = false;
}

// 正面を登録したときの顔までの距離（距離補正の基準）
export function setSessionDistanceRef(distance) {
    sessionDistanceRef = distance;
}

// 顔の向きの履歴だけ捨てる（感度を変えたとき、前の感度で平滑化した値を引きずらない）
export function resetAngleHistory() {
    lastYaw = null;
    filteredYaw = null;
    lastPitch = null;
    filteredPitch = null;
}

// ポインタを目標位置へ alpha（0〜1）の割合だけ近づける
export function followPointerTarget(alpha) {
    pointerX += (targetX - pointerX) * alpha;
    pointerY += (targetY - pointerY) * alpha;
}

// 顔が映っていないフレーム: 計測値と軸ロックの速度を 0 に戻す
export function clearMotionMeasurements() {
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

export function resetPointerMotionHistory() {
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

export function resetPanelSnap() {
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

export function getDistanceRatioFor(distance, ref = pointerConfig.distanceRef, exponent = pointerConfig.distanceExponent) {
    if (!(distance > 0) || !(ref > 0)) return 1;
    return clamp(Math.pow(distance / ref, exponent), DISTANCE_RATIO_MIN, DISTANCE_RATIO_MAX);
}

function getDistanceRatio() {
    if (!pointerConfig.isDistanceCompEnabled || filteredHeadDistance === null) return 1;
    return getDistanceRatioFor(filteredHeadDistance, pointerConfig.distanceRef > 0 ? pointerConfig.distanceRef : sessionDistanceRef);
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

export function getNoseScale(gain = pointerConfig.noseGain) {
    const curved = gainCurve(gain, NOSE_GAIN_MAX, NOSE_GAIN_EXPONENT);
    return NOSE_SCALE_MIN + ((NOSE_SCALE_MAX - NOSE_SCALE_MIN) * curved);
}

export function getYawScale(gain = pointerConfig.yawGain) {
    const curved = gainCurve(gain, YAW_GAIN_MAX, YAW_GAIN_EXPONENT);
    return YAW_SCALE_MIN + ((YAW_SCALE_MAX - YAW_SCALE_MIN) * curved);
}

// デッドゾーン（バックラッシュ幅）。往復するたびにこの幅の2倍だけ取りこぼし、顔の向きとポインタがずれていく。
// キャリブレーションで静止時の揺れを計測済みなら、揺れに見合った幅だけにして取りこぼしを減らす。
// 未計測（揺れ=0）の間は、ゲインが低いほど広い従来の幅で揺れを抑える
export function getNoseDeadzone(gain = pointerConfig.noseGain, noise = pointerConfig.noseNoise, noiseOnly = pointerConfig.isNoiseDeadzone) {
    if (noiseOnly && noise > 0) return Math.max(NOSE_DEADZONE_MIN, noise * NOISE_DEADZONE_FACTOR);
    const curved = gainCurve(gain, NOSE_GAIN_MAX, NOSE_GAIN_EXPONENT);
    const byGain = NOSE_DEADZONE_MAX - ((NOSE_DEADZONE_MAX - NOSE_DEADZONE_MIN) * curved);
    return Math.max(byGain, noise * NOISE_DEADZONE_FACTOR);
}

export function getYawDeadzone(gain = pointerConfig.yawGain, noise = pointerConfig.angleNoise, noiseOnly = pointerConfig.isNoiseDeadzone) {
    if (noiseOnly && noise > 0) return Math.max(YAW_DEADZONE_MIN, noise * NOISE_DEADZONE_FACTOR);
    const curved = gainCurve(gain, YAW_GAIN_MAX, YAW_GAIN_EXPONENT);
    const byGain = YAW_DEADZONE_MAX - ((YAW_DEADZONE_MAX - YAW_DEADZONE_MIN) * curved);
    return Math.max(byGain, noise * NOISE_DEADZONE_FACTOR);
}

// 正面(校正位置)から今の顔の位置・向きまでを、ランタイムと同じ式で積算したときのポインタの変位(px)
function getExpectedPointerOffset(distanceRatio) {
    const sample = { noseX: filteredNoseControlX, noseY: filteredNoseControlY, yaw: filteredYaw, pitch: filteredPitch };
    const center = { noseX: pointerConfig.calibratedNoseX, noseY: pointerConfig.calibratedNoseY, yaw: pointerConfig.calibratedYaw, pitch: pointerConfig.calibratedPitch };
    const noise = { nose: pointerConfig.noseNoise, angle: pointerConfig.angleNoise, noiseOnly: pointerConfig.isNoiseDeadzone };
    return applySideGainRatios({
        x: horizontalTravel(sample, center, pointerConfig.noseGain, distanceRatio, noise, pointerConfig.yawGain),
        y: verticalTravel(sample, center, pointerConfig.noseGain, distanceRatio, noise, pointerConfig.yawGain)
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
    const noseX = pointerConfig.noseGain > 0 ? (anchor.noseX - pointerConfig.calibratedNoseX) * getNoseScale() : 0;
    const yaw = pointerConfig.yawGain > 0
        ? signedAcceleratedAngle(pointerConfig.calibratedYaw, anchor.yaw, pointerConfig.calibratedYaw) * YAW_MIRROR_SIGN * getYawScale()
        : 0;
    const noseY = pointerConfig.noseGain > 0 ? (anchor.noseY - pointerConfig.calibratedNoseY) * getNoseScale() * VERTICAL_NOSE_SCALE_RATIO : 0;
    const pitch = pointerConfig.yawGain > 0
        ? signedAcceleratedAngle(pointerConfig.calibratedPitch, anchor.pitch, pointerConfig.calibratedPitch) * PITCH_MIRROR_SIGN * getYawScale() * VERTICAL_PITCH_SCALE_RATIO
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

function updateAbsolutePointerTarget(bounds, verticalBounds, anchor, timeMs) {
    const distanceRatio = getDistanceRatio();
    debugDistanceRatio = distanceRatio;
    const offset = getAbsoluteFaceOffset(anchor);
    const rawX = offset.x * distanceRatio;
    const rawY = offset.y * distanceRatio;

    const front = getSimpleFrontPoint(bounds);
    const centerX = front.x;
    const leftRange = centerX - bounds.minX;
    const rightRange = bounds.maxX - centerX;
    const mapX = mapAbsoluteAxis(rawX, leftRange, rightRange, "left", "right");
    let nextX = clamp(centerX + applyPanelWarp(mapX, panelSnap.warpX, leftRange, rightRange), bounds.minX, bounds.maxX);
    let nextY = bounds.centerY;
    let snapAxisY = null;
    let upRange = 0;
    let downRange = 0;
    if (verticalBounds) {
        const centerY = front.y;
        upRange = centerY - verticalBounds.minY;
        downRange = verticalBounds.maxY - centerY;
        const mapY = mapAbsoluteAxis(rawY, upRange, downRange, "up", "down");
        nextY = clamp(centerY + applyPanelWarp(mapY, panelSnap.warpY, upRange, downRange), verticalBounds.minY, verticalBounds.maxY);
        snapAxisY = { m: mapY, center: centerY, neg: upRange, pos: downRange };
    }
    if (pointerConfig.isPanelSnapEnabled && !isConfirmInProgress) {
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

export function clearPostureHint() {
    postureHintPinnedSinceMs = null;
    postureHintCenteredSinceMs = null;
    setPostureHint(false);
}

// 姿勢がずれると、正面のつもりでも片側の端に張り付いたままになる。長く続いたら取り直しを促す
function updatePostureHint(rawX, rawY, leftRange, rightRange, upRange, downRange, timeMs) {
    // 範囲 0 の側（正面がパネルの端）は設計上いつも端なので数えない
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

export function getAngleOffsetAcceleration(currentAngle, calibratedAngle) {
    const offsetAbs = Math.abs((currentAngle ?? calibratedAngle) - calibratedAngle);
    const norm = clamp((offsetAbs - YAW_ACCEL_START_RAD) / (YAW_ACCEL_FULL_RAD - YAW_ACCEL_START_RAD), 0, 1);
    const curved = Math.pow(norm, YAW_ACCEL_EXPONENT);
    return 1 + ((YAW_ACCEL_MAX_MULTIPLIER - 1) * curved);
}

// 横/縦の移動速度(EMA)を比較し、片方が優勢なら axisLockDominant にその軸をセットして
// もう片方をブロックする。ヒステリシス(ENGAGE > RELEASE)で判定のチャタリングを防ぐ
function updateAxisLockDominant(speedX, speedY) {
    if (!pointerConfig.isAxisLockEnabled) {
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

export function updateRelativePointerTarget(noseX, landmarks, detectResults, faceIndex, timeMs) {
    const bounds = getSimplePanelPointerBounds();
    if (!bounds) return;

    const verticalBounds = getVerticalPointerBounds();
    const mirroredNoseX = 1 - getGazeEnhancedX(landmarks, noseX);
    const noseControlY = landmarks?.[4]?.y ?? filteredNoseControlY ?? pointerConfig.calibratedNoseY;
    const rawYaw = extractHeadYawRadians(detectResults, faceIndex);
    const yaw = Number.isFinite(rawYaw) ? rawYaw : pointerConfig.calibratedYaw;
    const rawPitch = extractHeadPitchRadians(detectResults, faceIndex);
    const pitch = Number.isFinite(rawPitch) ? rawPitch : pointerConfig.calibratedPitch;

    filteredNoseControlX = noseXFilter.filter(mirroredNoseX, timeMs);
    filteredNoseControlY = noseYFilter.filter(noseControlY, timeMs);
    filteredYaw = yawFilter.filter(yaw, timeMs);
    filteredPitch = pitchFilter.filter(pitch, timeMs);
    updateHeadDistance(detectResults, faceIndex, timeMs);

    if (pointerConfig.isCalibrating) {
        // ○を使わない登録は、どこを向いていたか分からないので範囲の中央を正面にする
        pointerConfig.frontScreenPoint = null;
        sessionDistanceRef = filteredHeadDistance ?? 0;
        pointerConfig.calibratedNoseX = filteredNoseControlX;
        pointerConfig.calibratedNoseY = filteredNoseControlY;
        pointerConfig.calibratedYaw = filteredYaw;
        pointerConfig.calibratedPitch = filteredPitch;
        lastNoseControlX = filteredNoseControlX;
        lastNoseControlY = filteredNoseControlY;
        lastYaw = filteredYaw;
        lastPitch = filteredPitch;
        targetX = clamp(targetX, bounds.minX, bounds.maxX);
        targetY = clamp(targetY, bounds.minY, bounds.maxY);
        pointerConfig.isCalibrating = false;
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
    const isAbsolute = pointerConfig.pointerMode === POINTER_MODE_ABSOLUTE;
    const noseDeadzone = isAbsolute ? Math.max(NOSE_DEADZONE_MIN, pointerConfig.noseNoise * NOISE_DEADZONE_FACTOR) : getNoseDeadzone();
    const yawDeadzone = isAbsolute ? Math.max(YAW_DEADZONE_MIN, pointerConfig.angleNoise * NOISE_DEADZONE_FACTOR) : getYawDeadzone();
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
    if (pointerConfig.noseGain > 0) {
        pixN = dN * getNoseScale();
    }

    let pixY = 0;
    if (pointerConfig.yawGain > 0) {
        const yawAccel = getAngleOffsetAcceleration(filteredYaw, pointerConfig.calibratedYaw);
        pixY = dY * YAW_MIRROR_SIGN * getYawScale() * yawAccel;
    }
    debugPixN = pixN;
    debugPixY = pixY;

    const distanceRatio = getDistanceRatio();
    debugDistanceRatio = distanceRatio;
    // 向きごとの倍率は、顔が正面からどちら側にあるかで選ぶ（絶対方式と同じ倍率）
    const fromSide = getRawFaceOffset({ noseX: lastNoseControlX, noseY: lastNoseControlY, yaw: lastYaw, pitch: lastPitch });
    const toSide = getRawFaceOffset({ noseX: nextNoseX, noseY: nextNoseY, yaw: nextYaw, pitch: nextPitch });
    const sideRatioX = blendSideRatio(fromSide.x, toSide.x, pointerConfig.sideGainRatios.left, pointerConfig.sideGainRatios.right);
    const sideRatioY = blendSideRatio(fromSide.y, toSide.y, pointerConfig.sideGainRatios.up, pointerConfig.sideGainRatios.down);
    const rawDeltaX = (pixN + pixY) * distanceRatio * sideRatioX;

    // 上下移動: 鼻の縦位置 + 顔の上下向きを横移動と同じゲインで合成する
    const dNoseY = nextNoseY - lastNoseControlY;
    const dPitch = nextPitch - lastPitch;
    debugDeltaNoseY = dNoseY;
    debugDeltaPitch = dPitch;

    let rawDeltaY = 0;
    if (verticalBounds) {
        let pixNoseY = 0;
        if (pointerConfig.noseGain > 0) {
            pixNoseY = dNoseY * getNoseScale() * VERTICAL_NOSE_SCALE_RATIO;
        }

        let pixPitch = 0;
        if (pointerConfig.yawGain > 0) {
            const pitchAccel = getAngleOffsetAcceleration(filteredPitch, pointerConfig.calibratedPitch);
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

    const expected = pointerConfig.isRecenterEnabled ? getExpectedPointerOffset(distanceRatio) : null;
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
        const halfHeight = (verticalBounds.maxY - verticalBounds.minY) / 2;
        if (expected && halfHeight > 0 && Math.abs(expected.y) <= halfHeight * RECENTER_ZONE_RATIO) {
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

// 正面の位置（絶対方式で○を向いて登録していれば○の位置）へ置く。絶対方式は次のフレームで正面の位置へ動くので、
// グリッド中央に置くと途中のパネルで滞留ロックが外れ、正面で休んでいるだけで確定してしまう
export function centerPointerOnSimpleGrid() {
    const bounds = getSimplePanelPointerBounds();
    if (!bounds) return;
    const front = getSimpleFrontPoint(bounds);
    targetX = pointerX = front.x;
    targetY = pointerY = front.y;
}
