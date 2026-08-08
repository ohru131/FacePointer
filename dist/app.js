import vision from "./mediapipe/vision_bundle.mjs";
const { FaceLandmarker, FilesetResolver, DrawingUtils } = vision;

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
// 鏡像表示ポリシー: 見た目右向き -> controlX増加 に固定変換する符号
const YAW_MIRROR_SIGN = 1;
const FOLLOW_LERP = 0.35;
const NOSE_GAIN_KEY = "nose_gain";
const YAW_GAIN_KEY = "yaw_gain";
const NOSE_GAIN_MAX = 20;
const YAW_GAIN_MAX = 20;
const NOSE_GAIN_DEFAULT = 10;
const YAW_GAIN_DEFAULT = 10;
const NOSE_FILTER_ALPHA = 0.35;
const YAW_FILTER_ALPHA = 0.22;
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

const JAW_OPEN_THRESHOLD_KEY = "jaw_open_threshold";
const ICON_STYLE_KEY = "icon_style";
const PARAM_PANEL_VISIBLE_KEY = "param_panel_visible";
const ICON_STYLE_DEFAULT = "simple";
const ICON_STYLE_COMIC = "comic";
const ICON_STYLE_COMIC2 = "comic2";

const JAW_OPEN_THRESHOLD_DEFAULT = 0.10;

const SYMPTOM_STAGE_SYMPTOM = "symptom";
const SYMPTOM_STAGE_BODY_PART = "body-part";
const SYMPTOM_IDLE_RESET_MS = 30000;

const SYMPTOM_FLOW_DIRECT = "direct";

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
    const raw = localStorage.getItem(key);
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
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
let isCalibrating = true;
let isVerticalMoveEnabled = localStorage.getItem(VERTICAL_MOVE_KEY) !== "0";
let lastVerticalStageSwitchAt = 0;
let jawOpenThreshold = readStoredNumber(JAW_OPEN_THRESHOLD_KEY, JAW_OPEN_THRESHOLD_DEFAULT, 0.0, 0.2);
let noseGain = readStoredNumber(NOSE_GAIN_KEY, NOSE_GAIN_DEFAULT, 0, NOSE_GAIN_MAX);
let yawGain = readStoredNumber(YAW_GAIN_KEY, YAW_GAIN_DEFAULT, 0, YAW_GAIN_MAX);
let iconStyle = localStorage.getItem(ICON_STYLE_KEY) || ICON_STYLE_DEFAULT;

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
    lastNoseControlX = null;
    lastNoseControlY = null;
    lastYaw = null;
    lastPitch = null;
    filteredNoseControlX = null;
    filteredNoseControlY = null;
    filteredYaw = null;
    filteredPitch = null;
}

function getSymptomRowPointerBounds() {
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

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lowPassFilter(previous, next, alpha) {
    if (previous === null || Number.isNaN(previous)) return next;
    return (previous * (1 - alpha)) + (next * alpha);
}

// gain 0..MAX を 0..1 に正規化してべき乗カーブを適用する（gainが大きいほど敏感）
function gainCurve(gain, gainMax, exponent) {
    const norm = clamp(gain / gainMax, 0, 1);
    return Math.pow(norm, exponent);
}

function getNoseScale() {
    const curved = gainCurve(noseGain, NOSE_GAIN_MAX, NOSE_GAIN_EXPONENT);
    return NOSE_SCALE_MIN + ((NOSE_SCALE_MAX - NOSE_SCALE_MIN) * curved);
}

function getYawScale() {
    const curved = gainCurve(yawGain, YAW_GAIN_MAX, YAW_GAIN_EXPONENT);
    return YAW_SCALE_MIN + ((YAW_SCALE_MAX - YAW_SCALE_MIN) * curved);
}

function getNoseDeadzone() {
    const curved = gainCurve(noseGain, NOSE_GAIN_MAX, NOSE_GAIN_EXPONENT);
    return NOSE_DEADZONE_MAX - ((NOSE_DEADZONE_MAX - NOSE_DEADZONE_MIN) * curved);
}

function getYawDeadzone() {
    const curved = gainCurve(yawGain, YAW_GAIN_MAX, YAW_GAIN_EXPONENT);
    return YAW_DEADZONE_MAX - ((YAW_DEADZONE_MAX - YAW_DEADZONE_MIN) * curved);
}

function getAngleOffsetAcceleration(currentAngle, calibratedAngle) {
    const offsetAbs = Math.abs((currentAngle ?? calibratedAngle) - calibratedAngle);
    const norm = clamp((offsetAbs - YAW_ACCEL_START_RAD) / (YAW_ACCEL_FULL_RAD - YAW_ACCEL_START_RAD), 0, 1);
    const curved = Math.pow(norm, YAW_ACCEL_EXPONENT);
    return 1 + ((YAW_ACCEL_MAX_MULTIPLIER - 1) * curved);
}

function applyDeadzone(delta, deadzone) {
    const absDelta = Math.abs(delta);
    if (absDelta <= deadzone) return 0;
    return Math.sign(delta) * (absDelta - deadzone);
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
        `口(実/閾): ${f3(jawOpenFilteredScore)}/${f3(debugJawOpenThreshold)}`
    ];

    if (isVerticalMoveEnabled) {
        lines.push(`鼻縦Δ: ${f3(debugDeltaNoseY)}`);
        lines.push(`上下向きΔ: ${f3(debugDeltaPitch)}`);
        lines.push(`縦移動px: ${f2(debugDeltaYPx)}`);
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

function extractHeadYawRadians(detectResults, faceIndex = 0) {
    const matrices = detectResults?.facialTransformationMatrixes;
    if (!matrices || matrices.length <= faceIndex) return null;

    const m = toMatrixArray(matrices[faceIndex]);
    if (!m || m.length !== 16) return null;

    // row-major 想定: yaw ~= atan2(m02, m00)
    return Math.atan2(m[2], m[0]);
}

// 4x4 の並び順を平行移動成分の位置から判定する（row-major は末尾行が 0,0,0,1）
function isRowMajorMatrix(m) {
    const rowMajorTail = Math.abs(m[12]) + Math.abs(m[13]) + Math.abs(m[14]);
    const columnMajorTail = Math.abs(m[3]) + Math.abs(m[7]) + Math.abs(m[11]);
    return rowMajorTail <= columnMajorTail;
}

function extractHeadPitchRadians(detectResults, faceIndex = 0) {
    const matrices = detectResults?.facialTransformationMatrixes;
    if (!matrices || matrices.length <= faceIndex) return null;

    const m = toMatrixArray(matrices[faceIndex]);
    if (!m || m.length !== 16) return null;

    const rowMajor = isRowMajorMatrix(m);
    const at = (row, col) => (rowMajor ? m[(row * 4) + col] : m[(col * 4) + row]);
    // 顔が下を向くほど正になる pitch（R = Ry*Rx*Rz 前提、m12 = -sin(pitch)）
    return Math.atan2(-at(1, 2), Math.hypot(at(0, 2), at(2, 2)));
}

function getGazeEnhancedX(landmarks, noseX) {
    // 目線アシストは無効化し、鼻追従のみで制御する
    return noseX;
}

function updateRelativePointerTarget(noseX, landmarks, detectResults, faceIndex) {
    const bounds = getSymptomRowPointerBounds();
    if (!bounds) return;

    const verticalBounds = getVerticalPointerBounds();
    const mirroredNoseX = 1 - getGazeEnhancedX(landmarks, noseX);
    const noseControlY = landmarks?.[4]?.y ?? filteredNoseControlY ?? calibratedNoseY;
    const rawYaw = extractHeadYawRadians(detectResults, faceIndex);
    const yaw = Number.isFinite(rawYaw) ? rawYaw : calibratedYaw;
    const rawPitch = extractHeadPitchRadians(detectResults, faceIndex);
    const pitch = Number.isFinite(rawPitch) ? rawPitch : calibratedPitch;

    filteredNoseControlX = lowPassFilter(filteredNoseControlX, mirroredNoseX, NOSE_FILTER_ALPHA);
    filteredNoseControlY = lowPassFilter(filteredNoseControlY, noseControlY, NOSE_FILTER_ALPHA);
    filteredYaw = lowPassFilter(filteredYaw, yaw, YAW_FILTER_ALPHA);
    filteredPitch = lowPassFilter(filteredPitch, pitch, YAW_FILTER_ALPHA);

    if (isCalibrating) {
        calibratedNoseX = filteredNoseControlX;
        calibratedNoseY = filteredNoseControlY;
        calibratedYaw = filteredYaw;
        calibratedPitch = filteredPitch;
        lastNoseControlX = filteredNoseControlX;
        lastNoseControlY = filteredNoseControlY;
        lastYaw = filteredYaw;
        lastPitch = filteredPitch;
        targetX = clamp(targetX, bounds.minX, bounds.maxX);
        if (isVerticalMoveEnabled) {
            // 校正直後は必ず上段の高さから始める
            snapPointerToUpperRow();
        } else {
            targetY = bounds.centerY;
        }
        isCalibrating = false;
        speak("完了");
        return;
    }

    if (lastNoseControlX === null || lastYaw === null || lastNoseControlY === null || lastPitch === null) {
        lastNoseControlX = filteredNoseControlX;
        lastNoseControlY = filteredNoseControlY;
        lastYaw = filteredYaw;
        lastPitch = filteredPitch;
        if (verticalBounds) {
            targetY = clamp(targetY, verticalBounds.minY, verticalBounds.maxY);
        } else {
            targetY = bounds.centerY;
        }
        return;
    }

    const noseDeadzone = getNoseDeadzone();
    const yawDeadzone = getYawDeadzone();
    const dN = filteredNoseControlX - lastNoseControlX;
    const dY = filteredYaw - lastYaw;
    debugDeltaN = dN;
    debugDeltaY = dY;

    let pixN = 0;
    if (noseGain > 0) {
        pixN = applyDeadzone(dN, noseDeadzone) * getNoseScale();
    }

    let pixY = 0;
    if (yawGain > 0) {
        const yawDelta = applyDeadzone(dY, yawDeadzone);
        const yawAccel = getAngleOffsetAcceleration(filteredYaw, calibratedYaw);
        pixY = yawDelta * YAW_MIRROR_SIGN * getYawScale() * yawAccel;
    }
    debugPixN = pixN;
    debugPixY = pixY;

    const deltaX = clamp(pixN + pixY, -MAX_DELTA_PER_FRAME, MAX_DELTA_PER_FRAME);
    debugDeltaX = deltaX;
    targetX = clamp(targetX + deltaX, bounds.minX, bounds.maxX);

    // 上下移動: 鼻の縦位置 + 顔の上下向きを横移動と同じゲインで合成する
    const dNoseY = filteredNoseControlY - lastNoseControlY;
    const dPitch = filteredPitch - lastPitch;
    debugDeltaNoseY = dNoseY;
    debugDeltaPitch = dPitch;

    if (verticalBounds) {
        let pixNoseY = 0;
        if (noseGain > 0) {
            pixNoseY = applyDeadzone(dNoseY, noseDeadzone) * getNoseScale() * VERTICAL_NOSE_SCALE_RATIO;
        }

        let pixPitch = 0;
        if (yawGain > 0) {
            const pitchDelta = applyDeadzone(dPitch, yawDeadzone);
            const pitchAccel = getAngleOffsetAcceleration(filteredPitch, calibratedPitch);
            pixPitch = pitchDelta * PITCH_MIRROR_SIGN * getYawScale() * pitchAccel * VERTICAL_PITCH_SCALE_RATIO;
        }

        const deltaY = clamp(pixNoseY + pixPitch, -MAX_DELTA_PER_FRAME, MAX_DELTA_PER_FRAME);
        debugDeltaYPx = deltaY;
        targetY = clamp(targetY + deltaY, verticalBounds.minY, verticalBounds.maxY);
    } else {
        debugDeltaYPx = 0;
        targetY = bounds.centerY;
    }

    lastNoseControlX = filteredNoseControlX;
    lastNoseControlY = filteredNoseControlY;
    lastYaw = filteredYaw;
    lastPitch = filteredPitch;
}

// 上下移動で行を跨いだら階層を進める/戻す
function updateVerticalStageTransition() {
    if (!isVerticalMoveEnabled) return;
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

function showConfirm(sentence) {
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
    }, 3500);
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
        btn.classList.remove("hover");
    });

    if (hoveredBtn && currentHoveredBtn) {
        const hysteresisSq = HOVER_SWITCH_HYSTERESIS_PX * HOVER_SWITCH_HYSTERESIS_PX;
        if (currentDistance <= bestDistance + hysteresisSq) {
            hoveredBtn = currentHoveredBtn;
        }
    }

    // 上下移動で行間を通過中も、上段の選択対象とプレビューを保持する
    if (!hoveredBtn && isVerticalMoveEnabled && symptomStage === SYMPTOM_STAGE_SYMPTOM) {
        hoveredBtn = findRow1ButtonByPointerX();
    }

    if (hoveredBtn) {
        hoveredBtn.classList.add("hover");
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
    if (symptomStage !== SYMPTOM_STAGE_SYMPTOM || !row2Container) return;

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
    if (appRoot) {
        appRoot.dataset.mode = "symptom";
        appRoot.dataset.symptomStage = symptomStage;
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
// Speech (Google Gemini TTS support & System fallback)
// =========================================================
let voices = [];
let preferredVoice = null;

let GEMINI_API_KEY = localStorage.getItem("gemini_api_key") || "";
let geminiAuthBlocked = false;

const DEFAULT_MOUSE_CLICK_SPEECH = {
    left: "ありがとう。",
    middle: "こんにちは。",
    right: "お願いします。"
};

let mouseClickSpeech = { ...DEFAULT_MOUSE_CLICK_SPEECH };

function normalizedPhrase(value, fallback) {
    const trimmed = (value || "").trim();
    return trimmed || fallback;
}

function loadMouseClickSpeech() {
    mouseClickSpeech = {
        left: normalizedPhrase(localStorage.getItem("mouse_click_phrase_left"), DEFAULT_MOUSE_CLICK_SPEECH.left),
        middle: normalizedPhrase(localStorage.getItem("mouse_click_phrase_middle"), DEFAULT_MOUSE_CLICK_SPEECH.middle),
        right: normalizedPhrase(localStorage.getItem("mouse_click_phrase_right"), DEFAULT_MOUSE_CLICK_SPEECH.right)
    };
}

loadMouseClickSpeech();

function getGeminiUrl() {
    return `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${GEMINI_API_KEY}`;
}

let currentAudio = null;
let currentAudioResolve = null;
let currentSpeechController = null;
let isSpeechFetching = false;

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
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    });
}

async function setCachedAudio(text, blob) {
    if (!db) return;
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put(blob, text);
        tx.oncomplete = () => resolve();
    });
}

function clearAudioCache() {
    if (!db) return;
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
}

function initVoices() {
    voices = window.speechSynthesis.getVoices();
    preferredVoice = voices.find(v => v.name.includes("Nanami") || v.name.includes("Natural") || v.name.includes("Online")) ||
        voices.find(v => v.lang === "ja-JP") ||
        voices[0];
}
window.speechSynthesis.onvoiceschanged = initVoices;
initVoices();

async function speakGemini(text, silent = false) {
    if (isSpeechFetching) return true;

    const cacheKey = text.trim();
    const cachedBlob = await getCachedAudio(cacheKey);
    if (cachedBlob) {
        if (!silent) await playBlob(cachedBlob);
        return true;
    }

    if (!GEMINI_API_KEY) {
        return false;
    }
    if (geminiAuthBlocked) {
        return false;
    }

    if (currentSpeechController) {
        currentSpeechController.abort();
    }
    currentSpeechController = new AbortController();

    isSpeechFetching = true;
    try {
        const requestBody = {
            audioConfig: {
                audioEncoding: "LINEAR16",
                pitch: 0,
                speakingRate: 1.05
            },
            input: {
                text: cacheKey
            },
            voice: {
                languageCode: "ja-JP",
                name: "ja-JP-Neural2-B"
            }
        };

        const response = await fetch(getGeminiUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            signal: currentSpeechController.signal
        });

        if (!response.ok) {
            const errorBody = await response.text().catch(() => "");
            if (response.status === 401 || response.status === 403) {
                geminiAuthBlocked = true;
            }
            throw new Error(`API Error: ${response.status}${errorBody ? ` ${errorBody}` : ""}`);
        }

        const data = await response.json();
        const base64Audio = data.audioContent || data.audio;
        if (!base64Audio) {
            throw new Error("No audio content in response");
        }

        const binaryAudio = atob(base64Audio);
        const arrayBuffer = new ArrayBuffer(binaryAudio.length);
        const uint8Array = new Uint8Array(arrayBuffer);
        for (let i = 0; i < binaryAudio.length; i++) {
            uint8Array[i] = binaryAudio.charCodeAt(i);
        }

        const blob = new Blob([arrayBuffer], { type: "audio/wav" });
        await setCachedAudio(cacheKey, blob);

        if (!silent) {
            await playBlob(blob);
        }

        isSpeechFetching = false;
        return true;
    } catch (err) {
        isSpeechFetching = false;
        if (err.name === "AbortError") return true;
        console.error("Gemini TTS Error:", err);
        return false;
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
        const finish = () => {
            if (settled) return;
            settled = true;
            URL.revokeObjectURL(url);
            if (currentAudio === audio) currentAudio = null;
            if (currentAudioResolve === finish) currentAudioResolve = null;
            resolve();
        };

        currentAudio = audio;
        currentAudioResolve = finish;
        audio.onended = finish;
        audio.onerror = () => finish();
        audio.play().catch(() => finish());
    });
}

const audioStatus = document.getElementById("audio-status");
async function prefetchAllAudio() {
    const phrases = [];

    symptomChoices.forEach(category => {
        (category.options || []).forEach(option => {
            const sentence = (option.sentence || `${option.name}です。`).trim();
            if (sentence) phrases.push(sentence);
        });
    });

    Object.values(mouseClickSpeech).forEach(p => {
        if (p) phrases.push(p.trim());
    });

    const uniquePhrases = Array.from(new Set(phrases));

    audioStatus.style.display = "block";
    const statusLabel = audioStatus.querySelector(".status-label");
    const statusFill = audioStatus.querySelector(".status-progress-fill");
    let successCount = 0;

    for (let i = 0; i < uniquePhrases.length; i++) {
        const text = uniquePhrases[i];

        const cached = await getCachedAudio(text);
        if (cached) {
            successCount++;
            const pct = (successCount / uniquePhrases.length) * 100;
            if (statusLabel) statusLabel.textContent = `音声生成中: ${successCount}/${uniquePhrases.length}`;
            if (statusFill) statusFill.style.width = `${pct}%`;
            continue;
        }

        const pct = (i / uniquePhrases.length) * 100;
        if (statusLabel) statusLabel.textContent = `音声生成中: ${successCount}/${uniquePhrases.length}`;
        if (statusFill) statusFill.style.width = `${pct}%`;

        const success = await speakGemini(text, true);
        if (success) {
            successCount++;
            const nextPct = (successCount / uniquePhrases.length) * 100;
            if (statusLabel) statusLabel.textContent = `音声生成中: ${successCount}/${uniquePhrases.length}`;
            if (statusFill) statusFill.style.width = `${nextPct}%`;
        } else {
            if (statusLabel) statusLabel.textContent = "⚠ 通信エラーのため中断しました。設定を確認してください。";
            if (statusFill) statusFill.style.width = "0%";
            setTimeout(() => { audioStatus.style.display = "none"; }, 5000);
            return;
        }

        await new Promise(r => setTimeout(r, 600));
    }

    if (successCount === uniquePhrases.length) {
        if (statusLabel) statusLabel.textContent = "✓ 全ての音声が準備できました";
        if (statusFill) statusFill.style.width = "100%";
    } else {
        if (statusLabel) statusLabel.textContent = `⚠ 一部の生成に失敗しました (${successCount}/${uniquePhrases.length})`;
    }
    setTimeout(() => { audioStatus.style.display = "none"; }, 4000);
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
async function predictWebcam() {
    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;
    const startTimeMs = performance.now();
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        results = faceLandmarker.detectForVideo(video, startTimeMs);
    }

    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    const drawingUtils = new DrawingUtils(canvasCtx);
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
            updateRelativePointerTarget(nose.x, landmarks, results, faceIndex);
            trackSymptomActivityByMovement(nose.x, nose.y);
        }
    }

    pointerX += (targetX - pointerX) * FOLLOW_LERP;
    pointerY += (targetY - pointerY) * FOLLOW_LERP;
    pointerElement.style.left = `${pointerX}px`;
    pointerElement.style.top = `${pointerY}px`;

    if (!hasFace) {
        debugDeltaN = 0;
        debugDeltaY = 0;
        debugPixN = 0;
        debugPixY = 0;
        debugDeltaX = 0;
        debugDeltaNoseY = 0;
        debugDeltaPitch = 0;
        debugDeltaYPx = 0;
    }
    updateTelemetryPanel(hasFace);

    checkPointerCollision();
    if (hasFace) {
        updateVerticalStageTransition();
    }
    checkSymptomIdleReset();
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
    // 色はクリック実行タイミングに合わせる（クリック時=赤、それ以外=緑）
    const accent = (isClickFeedbackActive || isOpenDetected) ? "#ff5252" : "#00e676";
    const label = isClickFeedbackActive
        ? "CLICK!"
        : (isOpenDetected ? "口OPEN 判定" : "口CLOSE 判定");

    canvasCtx.save();
    canvasCtx.fillStyle = "rgba(0, 0, 0, 0.55)";
    canvasCtx.fillRect(12, 12, 265, 52);

    // 状態ラベルを色付きバッジ表示にして視認性を上げる
    canvasCtx.strokeStyle = accent;
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeRect(12, 12, 265, 52);
    canvasCtx.fillStyle = accent;
    canvasCtx.fillRect(18, 18, 132, 22);
    canvasCtx.fillStyle = "#111111";
    canvasCtx.font = "bold 15px sans-serif";
    canvasCtx.fillText(label, 24, 34);

    canvasCtx.fillStyle = "#ffffff";
    canvasCtx.font = "14px monospace";
    canvasCtx.fillText(`raw:${jawOpenRawScore.toFixed(3)} filt:${jawOpenFilteredScore.toFixed(3)}`, 22, 54);

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
    pointerElement.style.transform = "translate(-50%, -50%) scale(2)";
    pointerElement.style.backgroundColor = "#fff";
    gestureCooldown = true;
    setTimeout(() => {
        gestureIndicator.classList.remove("active");
        pointerElement.style.transform = "translate(-50%, -50%) scale(1)";
        pointerElement.style.backgroundColor = "var(--primary)";
        gestureCooldown = false;
    }, GESTURE_COOLDOWN_MS);
}

function triggerClick() {
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
// Controls & Settings UI
// =========================================================
calibrateBtn.addEventListener("click", () => {
    isCalibrating = true;
    resetPointerMotionHistory();
    jawClosedBaseline = null;
    debugJawOpenThreshold = jawOpenThreshold;
    debugJawCloseThreshold = Math.max(0, jawOpenThreshold - JAW_CLOSE_MIN_GAP);
    speak("リセット");
});

const audioCacheBtn = document.getElementById("audio-cache-btn");
audioCacheBtn.addEventListener("click", () => {
    if (!GEMINI_API_KEY) {
        alert("音声データを更新するには設定画面から Gemini API Key を入力してください。");
        settingsModal.classList.add("active");
        return;
    }
    if (confirm("音声データを全て再生成し、キャッシュを更新しますか？\n(少し時間がかかります)")) {
        clearAudioCache();
        prefetchAllAudio();
    }
});

const settingsBtn = document.getElementById("settings-btn");
const settingsModal = document.getElementById("settings-modal");
const apiKeyInput = document.getElementById("api-key-input");
const mouseLeftInput = document.getElementById("mouse-left-input");
const mouseMiddleInput = document.getElementById("mouse-middle-input");
const mouseRightInput = document.getElementById("mouse-right-input");
const jawOpenThresholdSlider = document.getElementById("jaw-open-threshold-slider");
const noseGainSlider = document.getElementById("nose-gain-slider");
const yawGainSlider = document.getElementById("yaw-gain-slider");
const iconStyleSelect = document.getElementById("icon-style-select");
const jawOpenThresholdValue = document.getElementById("jaw-open-threshold-value");
const noseGainValue = document.getElementById("nose-gain-value");
const yawGainValue = document.getElementById("yaw-gain-value");
const mouseClickFeedback = document.getElementById("mouse-click-feedback");
const saveSettingsBtn = document.getElementById("save-settings");
const closeSettingsBtn = document.getElementById("close-settings");
const controlsRoot = document.getElementById("controls");
const paramsToggleBtn = document.getElementById("params-toggle-btn");
const verticalMoveToggleBtn = document.getElementById("vertical-move-btn");

let isParamPanelVisible = localStorage.getItem(PARAM_PANEL_VISIBLE_KEY) !== "0";

function applyVerticalMoveToggleState() {
    if (!verticalMoveToggleBtn) return;

    verticalMoveToggleBtn.classList.toggle("is-off", !isVerticalMoveEnabled);
    verticalMoveToggleBtn.setAttribute("aria-pressed", isVerticalMoveEnabled ? "true" : "false");
    verticalMoveToggleBtn.textContent = isVerticalMoveEnabled ? "上下移動 ON" : "上下移動 OFF";
}

if (verticalMoveToggleBtn) {
    verticalMoveToggleBtn.addEventListener("click", () => {
        isVerticalMoveEnabled = !isVerticalMoveEnabled;
        localStorage.setItem(VERTICAL_MOVE_KEY, isVerticalMoveEnabled ? "1" : "0");
        applyVerticalMoveToggleState();
        // OFF→ON / ON→OFF いずれも上段基準へ戻して仕切り直す
        resetSymptomModeState();
    });
}

applyVerticalMoveToggleState();

function applyParamPanelVisibility() {
    if (!controlsRoot) return;
    controlsRoot.classList.toggle("params-hidden", !isParamPanelVisible);
    if (!paramsToggleBtn) return;

    paramsToggleBtn.classList.toggle("is-off", !isParamPanelVisible);
    paramsToggleBtn.setAttribute("aria-pressed", isParamPanelVisible ? "true" : "false");
    paramsToggleBtn.textContent = isParamPanelVisible ? "パラメータ ON" : "パラメータ OFF";
}

if (paramsToggleBtn) {
    paramsToggleBtn.addEventListener("click", () => {
        isParamPanelVisible = !isParamPanelVisible;
        localStorage.setItem(PARAM_PANEL_VISIBLE_KEY, isParamPanelVisible ? "1" : "0");
        applyParamPanelVisibility();
    });
}

applyParamPanelVisibility();

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

if (jawOpenThresholdSlider) jawOpenThresholdSlider.value = String(jawOpenThreshold);
if (noseGainSlider) noseGainSlider.value = String(noseGain);
if (yawGainSlider) yawGainSlider.value = String(yawGain);
refreshTuningSliderLabels();

function showMouseClickFeedback(button, text) {
    if (!mouseClickFeedback) return;

    const buttonLabel = button === "left" ? "左クリック" : (button === "middle" ? "真ん中クリック" : "右クリック");
    mouseClickFeedback.textContent = `${buttonLabel}: ${text}`;
    mouseClickFeedback.classList.remove("left", "middle", "right", "active");
    mouseClickFeedback.classList.add(button);

    void mouseClickFeedback.offsetWidth;
    mouseClickFeedback.classList.add("active");

    if (window.mouseClickFeedbackTimer) clearTimeout(window.mouseClickFeedbackTimer);
    window.mouseClickFeedbackTimer = setTimeout(() => {
        mouseClickFeedback.classList.remove("active");
    }, 1200);
}

function shouldIgnoreMouseSpeech(event) {
    const target = event.target;
    if (!target) return false;

    if (settingsModal && settingsModal.classList.contains("active")) return true;
    if (target.closest("input, textarea, [contenteditable='true']")) return true;

    const activeTag = document.activeElement ? document.activeElement.tagName : "";
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") return true;
    if (document.activeElement && document.activeElement.isContentEditable) return true;

    return false;
}

function speakByMouseButton(button) {
    const key = button === 0 ? "left" : (button === 1 ? "middle" : "right");
    const phrase = mouseClickSpeech[key];
    showMouseClickFeedback(key, phrase);
    speak(phrase);
}

document.addEventListener("contextmenu", (event) => {
    if (!shouldIgnoreMouseSpeech(event)) {
        event.preventDefault();
    }
});

document.addEventListener("auxclick", (event) => {
    if ((event.button === 1 || event.button === 2) && !shouldIgnoreMouseSpeech(event)) {
        event.preventDefault();
    }
});

document.addEventListener("mousedown", (event) => {
    if (![0, 1, 2].includes(event.button)) return;
    if (shouldIgnoreMouseSpeech(event)) return;

    if (event.button === 1 || event.button === 2) {
        event.preventDefault();
    }
    speakByMouseButton(event.button);
});

settingsBtn.addEventListener("click", () => {
    apiKeyInput.value = GEMINI_API_KEY;
    if (iconStyleSelect) iconStyleSelect.value = iconStyle;
    if (mouseLeftInput) mouseLeftInput.value = mouseClickSpeech.left;
    if (mouseMiddleInput) mouseMiddleInput.value = mouseClickSpeech.middle;
    if (mouseRightInput) mouseRightInput.value = mouseClickSpeech.right;
    refreshTuningSliderLabels();
    settingsModal.classList.add("active");
});

closeSettingsBtn.addEventListener("click", () => {
    settingsModal.classList.remove("active");
});

saveSettingsBtn.addEventListener("click", () => {
    const newKey = apiKeyInput.value.trim();
    GEMINI_API_KEY = newKey;
    geminiAuthBlocked = false;
    localStorage.setItem("gemini_api_key", newKey);

    const newLeft = normalizedPhrase(mouseLeftInput ? mouseLeftInput.value : "", DEFAULT_MOUSE_CLICK_SPEECH.left);
    const newMiddle = normalizedPhrase(mouseMiddleInput ? mouseMiddleInput.value : "", DEFAULT_MOUSE_CLICK_SPEECH.middle);
    const newRight = normalizedPhrase(mouseRightInput ? mouseRightInput.value : "", DEFAULT_MOUSE_CLICK_SPEECH.right);
    mouseClickSpeech = { left: newLeft, middle: newMiddle, right: newRight };
    localStorage.setItem("mouse_click_phrase_left", newLeft);
    localStorage.setItem("mouse_click_phrase_middle", newMiddle);
    localStorage.setItem("mouse_click_phrase_right", newRight);
    localStorage.setItem(JAW_OPEN_THRESHOLD_KEY, String(jawOpenThreshold));
    localStorage.setItem(NOSE_GAIN_KEY, String(noseGain));
    localStorage.setItem(YAW_GAIN_KEY, String(yawGain));
    if (iconStyleSelect) {
        iconStyle = iconStyleSelect.value;
        localStorage.setItem(ICON_STYLE_KEY, iconStyle);
    }

    renderAll();
    settingsModal.classList.remove("active");
});

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
    renderAll();
    await setupMediaPipe();
})();
