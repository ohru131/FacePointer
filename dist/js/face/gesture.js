// 口を開けて確定する（口の開き具合の判定）
import { canvasCtx, canvasElement, gestureIndicator, pointerElement } from "../core/dom.js";
import { lowPassFilter, medianOfNumbers } from "../core/math.js";
import { readStoredNumber } from "../core/storage.js";
import { isSettingsOpen } from "../core/app-state.js";
import { pointerX, pointerY } from "../pointer/tracking.js";
import { isConfirmInProgress } from "../panels/confirm.js";
import { isSimpleClickBlocked } from "../panels/selection.js";
import { logClickDebug } from "./click-debug.js";
import { calibrationWizard } from "../calibration/wizard.js";

export const JAW_OPEN_THRESHOLD_KEY = "jaw_open_threshold";

const JAW_OPEN_THRESHOLD_DEFAULT = 0.10;

export let isMouthOpen = false;
let gestureCooldown = false;
const GESTURE_COOLDOWN_MS = 800;
const JAW_OPEN_REQUIRED_FRAMES = 5;
const JAW_OPEN_SMOOTHING_ALPHA = 0.35;
const CONFIRM_COOLDOWN_MS = 100;
const CLICK_DELAY_MS = 180;
const CLICK_FEEDBACK_MS = 320;
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
export let jawOpenConsecutiveFrames = 0;
export let jawOpenRawScore = 0;
export let jawOpenRawInstantScore = 0;
export let jawOpenFilteredScore = 0;
let mouthOpenedAt = 0;
export let mouthOpenRatio = 0;
export let mouthOpenRatioBaseline = null;

export let jawOpenThreshold = readStoredNumber(JAW_OPEN_THRESHOLD_KEY, JAW_OPEN_THRESHOLD_DEFAULT, 0.0, 0.2);
let lastConfirmedAt = 0;
export let pendingClickTimer = null;
export let pendingClickTargetKey = "";
let clickFeedbackUntil = 0;
export let jawClosedBaseline = null;
export let debugJawOpenThreshold = 0;
export let debugJawCloseThreshold = 0;
let jawRawRecent = [];
let wasFaceBlendshapeAvailable = false;
let faceJustReacquiredUntil = 0;
let loggedReacquireGuard = false;
const JAW_BASELINE_ALPHA = 0.08;
const JAW_CLOSE_RATIO = 0.45;
const JAW_CLOSE_MIN_GAP = 0.02;
export const JAW_OPEN_THRESHOLD_GAIN = 0.72;
const JAW_BASELINE_MAX = 0.11;
const JAW_OPEN_ABS_MIN = 0.115;
const JAW_CLOSE_ABS_MIN = 0.075;

// 口を開けた判定のしきい値を変えて保存する
export function saveJawOpenThreshold(value) {
    jawOpenThreshold = value;
    localStorage.setItem(JAW_OPEN_THRESHOLD_KEY, String(value));
}

// 口を閉じたときの基準を測り直す
export function resetJawBaseline() {
    jawClosedBaseline = null;
}

// 予約した口のクリックを取り消す。取り消したら true
export function cancelPendingClick() {
    if (!pendingClickTimer) return false;
    clearTimeout(pendingClickTimer);
    pendingClickTimer = null;
    pendingClickTargetKey = "";
    return true;
}

// 確定した時刻を残す（直後の口の確定を止める）
export function markConfirmed() {
    lastConfirmedAt = Date.now();
}

// 確定したことをポインタの見た目で少しの間知らせる
function markClickFeedback() {
    clickFeedbackUntil = Date.now() + CLICK_FEEDBACK_MS;
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

export function isJawOpenVisualActive() {
    return isMouthOpen;
}

export function updateGestureDetection(detectResults, primaryLandmarks = null) {
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

export function drawMouthDetectionOverlay(landmarks) {
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
            markConfirmed();
            pendingClickTimer = null;
            pendingClickTargetKey = "";
        }, CLICK_DELAY_MS);

        return true;
    }

    logClickDebug("click_blocked_no_hover");

    return false;
}
