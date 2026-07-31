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
let lastYaw = null;
let filteredNoseControlX = null;
let filteredYaw = null;
let debugDeltaN = 0;
let debugDeltaY = 0;
let debugPixN = 0;
let debugPixY = 0;
let debugDeltaX = 0;
// 鏡像表示ポリシー: 見た目右向き -> controlX増加 に固定変換する符号
const YAW_MIRROR_SIGN = -1;
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
const YAW_SCALE_MAX = 2200;
const NOSE_GAIN_EXPONENT = 1.4;
const YAW_GAIN_EXPONENT = 1.8;
const NOSE_DEADZONE_MIN = 0.0006;
const NOSE_DEADZONE_MAX = 0.0062;
const YAW_DEADZONE_MIN = 0.002;
const YAW_DEADZONE_MAX = 0.025;
const MAX_DELTA_PER_FRAME = 60;

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

const symptomChoices = [
    {
        name: "身体",
        icon: "media/menu-body.png",
        flow: SYMPTOM_FLOW_DIRECT,
        options: [
            { name: "かゆい", icon: "media/menu-itchy.png", sentence: "かゆいです。" },
            { name: "痛い", icon: "media/menu-hurt.png", sentence: "痛いです。" },
            { name: "おなかが張る", icon: "media/menu-bloated-stomach.png", sentence: "おなかが張っています。" },
            { name: "あつい・さむい", icon: "media/menu-hot-cold.png", sentence: "あつい、または、さむいです。" }
        ]
    },
    {
        name: "お願い",
        icon: "media/menu-request.png",
        flow: SYMPTOM_FLOW_DIRECT,
        options: [
            { name: "吸引", icon: "media/menu-suction.png", sentence: "吸引してください。" },
            { name: "体位かえて", icon: "media/menu-change-position.png", sentence: "体位をかえてください。" },
            { name: "マッサージして", icon: "media/menu-massage.png", sentence: "マッサージしてください。" },
            { name: "おむつ変えて", icon: "media/menu-toilet.png", sentence: "おむつを変えてください。" }
        ]
    },
    {
        name: "気分転換",
        icon: "media/menu-refresh.png",
        flow: SYMPTOM_FLOW_DIRECT,
        options: [
            { name: "お話して", icon: "media/menu-talk.png", sentence: "お話してください。" },
            { name: "本", icon: "media/menu-book.png", sentence: "本を読んでほしいです。" },
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
    if (iconStyle === "cute") return iconPath.replace(".png", "-cute.png");
    if (iconStyle === ICON_STYLE_COMIC) return iconPath.replace(".png", "-comic.png");
    if (iconStyle === ICON_STYLE_COMIC2) return iconPath.replace(".png", "-comic2.png");
    return iconPath;
}

// Calibration
let calibratedNoseX = 0.5;
let calibratedNoseY = 0.5;
let calibratedYaw = 0;
let isCalibrating = true;
let jawOpenThreshold = readStoredNumber(JAW_OPEN_THRESHOLD_KEY, JAW_OPEN_THRESHOLD_DEFAULT, 0.0, 0.2);
let noseGain = readStoredNumber(NOSE_GAIN_KEY, NOSE_GAIN_DEFAULT, 0, NOSE_GAIN_MAX);
let yawGain = readStoredNumber(YAW_GAIN_KEY, YAW_GAIN_DEFAULT, 0, YAW_GAIN_MAX);
let iconStyle = localStorage.getItem(ICON_STYLE_KEY) || ICON_STYLE_DEFAULT;

// Symptom state
let symptomStage = SYMPTOM_STAGE_SYMPTOM;
let selectedSymptom = null;
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
    symptomLastActivityAt = 0;
    lastSymptomNoseX = null;
    lastSymptomNoseY = null;
    lastNoseControlX = null;
    lastYaw = null;
    filteredNoseControlX = null;
    filteredYaw = null;
    isConfirmInProgress = false;
    window.clearTimeout(window.symptomResetTimer);
    window.symptomResetTimer = null;
    if (shouldRender) {
        renderAll();
    }
}

function getSymptomRowPointerBounds() {
    const buttons = Array.from(row1Container.querySelectorAll(".h-btn:not(.h-btn--empty)"));
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
        `移動量px: ${f2(debugDeltaX)}`,
        `口(実/閾): ${f3(jawOpenFilteredScore)}/${f3(debugJawOpenThreshold)}`
    ];

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

function getGazeEnhancedX(landmarks, noseX) {
    // 目線アシストは無効化し、鼻追従のみで制御する
    return noseX;
}

function updateRelativePointerTarget(noseX, landmarks, detectResults, faceIndex) {
    const bounds = getSymptomRowPointerBounds();
    if (!bounds) return;

    const mirroredNoseX = 1 - getGazeEnhancedX(landmarks, noseX);
    const rawYaw = extractHeadYawRadians(detectResults, faceIndex);
    const yaw = Number.isFinite(rawYaw) ? rawYaw : calibratedYaw;

    filteredNoseControlX = lowPassFilter(filteredNoseControlX, mirroredNoseX, NOSE_FILTER_ALPHA);
    filteredYaw = lowPassFilter(filteredYaw, yaw, YAW_FILTER_ALPHA);

    if (isCalibrating) {
        calibratedNoseX = filteredNoseControlX;
        calibratedNoseY = landmarks?.[4]?.y ?? calibratedNoseY;
        calibratedYaw = filteredYaw;
        lastNoseControlX = filteredNoseControlX;
        lastYaw = filteredYaw;
        targetX = clamp(targetX, bounds.minX, bounds.maxX);
        targetY = bounds.centerY;
        isCalibrating = false;
        speak("完了");
        return;
    }

    if (lastNoseControlX === null || lastYaw === null) {
        lastNoseControlX = filteredNoseControlX;
        lastYaw = filteredYaw;
        targetY = bounds.centerY;
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
        pixY = yawDelta * YAW_MIRROR_SIGN * getYawScale();
    }
    debugPixN = pixN;
    debugPixY = pixY;

    const deltaX = clamp(pixN + pixY, -MAX_DELTA_PER_FRAME, MAX_DELTA_PER_FRAME);
    debugDeltaX = deltaX;
    targetX = clamp(targetX + deltaX, bounds.minX, bounds.maxX);

    targetY = bounds.centerY;
    lastNoseControlX = filteredNoseControlX;
    lastYaw = filteredYaw;
}

async function handleSymptomClick(item) {
    if (isConfirmInProgress) return;

    if (symptomStage === SYMPTOM_STAGE_SYMPTOM) {
        selectedSymptom = item;
        symptomStage = SYMPTOM_STAGE_BODY_PART;
        symptomLastActivityAt = Date.now();
        renderAll();
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

function renderRow(container, items) {
    container.innerHTML = "";
    if (!items || items.length === 0) return;

    container.style.gridTemplateColumns = `repeat(${items.length}, 1fr)`;

    items.forEach((item, idx) => {
        const btn = document.createElement("div");
        btn.className = "h-btn";
        btn.dataset.row = "1";
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

        btn.addEventListener("click", () => handleSymptomClick(item));
        container.appendChild(btn);
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

    if (hoveredBtn) {
        hoveredBtn.classList.add("hover");
        lastHoveredButtonKey = `${hoveredBtn.dataset.row}|${hoveredBtn.dataset.name}`;
    } else {
        lastHoveredButtonKey = "";
    }

    // ペンディングクリック中にターゲットから外れた場合はキャンセル
    if (pendingClickTimer && pendingClickTargetKey) {
        const currentKey = lastHoveredButtonKey;
        if (currentKey !== pendingClickTargetKey) {
            clearTimeout(pendingClickTimer);
            pendingClickTimer = null;
            pendingClickTargetKey = "";
            const animBtn = document.querySelector(".h-btn.clicked-anim");
            if (animBtn) animBtn.classList.remove("clicked-anim");
        }
    }
}

function renderAll() {
    if (appRoot) {
        appRoot.dataset.mode = "symptom";
        appRoot.dataset.symptomStage = symptomStage;
    }

    const symptomItems = symptomStage === SYMPTOM_STAGE_SYMPTOM
        ? symptomChoices
        : (selectedSymptom?.options || []);

    const promptText = symptomStage === SYMPTOM_STAGE_SYMPTOM
        ? "項目を選んでください"
        : `${selectedSymptom?.name || "項目"}を選んでください`;

    if (modePrompt) {
        modePrompt.textContent = promptText;
    }

    if (row2Container) {
        row2Container.innerHTML = "";
        row2Container.style.display = "none";
    }
    if (row3Container) {
        row3Container.innerHTML = "";
        row3Container.style.display = "none";
    }
    if (confirmZone) {
        confirmZone.style.display = "none";
    }
    if (confirmZonePreview) {
        confirmZonePreview.textContent = "";
    }

    renderRow(row1Container, symptomItems);
}

// =========================================================
// Speech (Google Gemini TTS support & System fallback)
// =========================================================
let voices = [];
let preferredVoice = null;

let GEMINI_API_KEY = localStorage.getItem("gemini_api_key") || "";

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
            throw new Error(`API Error: ${response.status}`);
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
    updateGestureDetection(results);
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
    }
    updateTelemetryPanel(hasFace);

    checkPointerCollision();
    checkSymptomIdleReset();
    window.requestAnimationFrame(predictWebcam);
}

let isMouthOpen = false;
let gestureCooldown = false;
const GESTURE_COOLDOWN_MS = 800;
const JAW_OPEN_REQUIRED_FRAMES = 3;
const JAW_OPEN_HYSTERESIS = 0.08;
const JAW_OPEN_SMOOTHING_ALPHA = 0.35;
const CONFIRM_COOLDOWN_MS = 100;
const CLICK_DELAY_MS = 180;
const CLICK_FEEDBACK_MS = 320;
const CLOSE_CLICK_MIN_OPEN_MS = 140;
let jawOpenConsecutiveFrames = 0;
let jawOpenRawScore = 0;
let jawOpenFilteredScore = 0;
let lastConfirmedAt = 0;
let pendingClickTimer = null;
let pendingClickTargetKey = "";
let clickFeedbackUntil = 0;
let closeClickEligible = false;
let mouthOpenedAt = 0;
let jawClosedBaseline = null;
let debugJawOpenThreshold = 0;
let debugJawCloseThreshold = 0;
const JAW_BASELINE_ALPHA = 0.08;
const JAW_CLOSE_RATIO = 0.45;
const JAW_CLOSE_MIN_GAP = 0.02;
const JAW_OPEN_THRESHOLD_GAIN = 0.72;

function markClickFeedback() {
    clickFeedbackUntil = Date.now() + CLICK_FEEDBACK_MS;
}

function getEffectiveJawOpenThreshold() {
    return (jawClosedBaseline ?? 0) + (jawOpenThreshold * JAW_OPEN_THRESHOLD_GAIN);
}

function getEffectiveJawCloseThreshold() {
    const openThreshold = getEffectiveJawOpenThreshold();
    const adjustedGap = jawOpenThreshold * JAW_OPEN_THRESHOLD_GAIN;
    return openThreshold - Math.max(JAW_CLOSE_MIN_GAP, adjustedGap * JAW_CLOSE_RATIO);
}

function updateJawClosedBaseline() {
    if (!Number.isFinite(jawOpenFilteredScore)) return;

    if (jawClosedBaseline === null) {
        jawClosedBaseline = jawOpenFilteredScore;
        return;
    }

    const candidate = Math.min(jawOpenFilteredScore, jawClosedBaseline + 0.015);
    jawClosedBaseline = lowPassFilter(jawClosedBaseline, candidate, JAW_BASELINE_ALPHA);
}

function isJawOpenVisualActive() {
    return isMouthOpen || jawOpenConsecutiveFrames >= JAW_OPEN_REQUIRED_FRAMES;
}

function updateGestureDetection(detectResults) {
    if (isConfirmInProgress) return;
    if (!detectResults.faceBlendshapes || detectResults.faceBlendshapes.length === 0) {
        jawOpenRawScore = 0;
        jawOpenFilteredScore *= 0.8;
        jawOpenConsecutiveFrames = 0;
        isMouthOpen = false;
        closeClickEligible = false;
        mouthOpenedAt = 0;
        jawClosedBaseline = null;
        debugJawOpenThreshold = jawOpenThreshold * JAW_OPEN_THRESHOLD_GAIN;
        debugJawCloseThreshold = Math.max(0, (jawOpenThreshold * JAW_OPEN_THRESHOLD_GAIN) - JAW_CLOSE_MIN_GAP);
        return;
    }

    const cats = detectResults.faceBlendshapes[0].categories;
    const jawOpen = cats.find(c => c.categoryName === "jawOpen")?.score ?? 0;
    jawOpenRawScore = jawOpen;
    if (jawOpenFilteredScore === 0) {
        jawOpenFilteredScore = jawOpen;
    } else {
        jawOpenFilteredScore = (jawOpenFilteredScore * (1 - JAW_OPEN_SMOOTHING_ALPHA)) + (jawOpen * JAW_OPEN_SMOOTHING_ALPHA);
    }

    if (!isMouthOpen) {
        updateJawClosedBaseline();
    }

    const openThreshold = getEffectiveJawOpenThreshold();
    const closeThreshold = getEffectiveJawCloseThreshold();
    debugJawOpenThreshold = openThreshold;
    debugJawCloseThreshold = closeThreshold;

    if (isMouthOpen) {
        if (jawOpenFilteredScore <= closeThreshold) {
            const openHeldMs = mouthOpenedAt ? (Date.now() - mouthOpenedAt) : 0;
            const canCloseClick = closeClickEligible && openHeldMs >= CLOSE_CLICK_MIN_OPEN_MS && !pendingClickTimer;

            isMouthOpen = false;
            jawOpenConsecutiveFrames = 0;
            mouthOpenedAt = 0;

            if (canCloseClick) {
                const didSchedule = triggerClick();
                if (didSchedule && !gestureCooldown) {
                    showGestureFeedback();
                }
            }

            closeClickEligible = false;
        }
        return;
    }

    if (jawOpenFilteredScore >= openThreshold) {
        jawOpenConsecutiveFrames += 1;
        if (jawOpenConsecutiveFrames >= JAW_OPEN_REQUIRED_FRAMES) {
            isMouthOpen = true;
            mouthOpenedAt = Date.now();

            const didSchedule = triggerClick();
            closeClickEligible = !didSchedule;

            if (didSchedule && !gestureCooldown) {
                showGestureFeedback();
            }
        }
    } else {
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
    if (isConfirmInProgress) return;

    const now = Date.now();
    if (now - lastConfirmedAt < CONFIRM_COOLDOWN_MS) {
        return false;
    }

    const activeBtn = document.querySelector(".h-btn.hover");
    if (activeBtn && !activeBtn.classList.contains("h-btn--empty")) {
        const targetKey = `${activeBtn.dataset.row}|${activeBtn.dataset.name}`;

        if (pendingClickTimer) {
            clearTimeout(pendingClickTimer);
            pendingClickTimer = null;
            pendingClickTargetKey = "";
        }

        activeBtn.classList.add("clicked-anim");
        pendingClickTargetKey = targetKey;
        // ボタン参照を保持して、タイマー実行時にはこちらを使用
        const targetBtn = activeBtn;
        pendingClickTimer = setTimeout(() => {
            // 1. アニメーションクラスが削除されている（キャンセルされた）
            if (!targetBtn.classList.contains("clicked-anim")) {
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
                targetBtn.classList.remove("clicked-anim");
                pendingClickTimer = null;
                pendingClickTargetKey = "";
                return;
            }

            targetBtn.classList.remove("clicked-anim");
            markClickFeedback();
            targetBtn.click();
            lastConfirmedAt = Date.now();
            pendingClickTimer = null;
            pendingClickTargetKey = "";
        }, CLICK_DELAY_MS);

        return true;
    }

    return false;
}

// =========================================================
// Controls & Settings UI
// =========================================================
calibrateBtn.addEventListener("click", () => {
    isCalibrating = true;
    lastNoseControlX = null;
    lastYaw = null;
    filteredNoseControlX = null;
    filteredYaw = null;
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
    if (newKey) {
        GEMINI_API_KEY = newKey;
        localStorage.setItem("gemini_api_key", newKey);
    }

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

    alert("設定を保存しました。");
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
