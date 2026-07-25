import vision from "./mediapipe/vision_bundle.mjs";
const { FaceLandmarker, FilesetResolver, DrawingUtils } = vision;

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("canvas-overlay");
const canvasCtx = canvasElement.getContext("2d");
const pointerElement = document.getElementById("pointer");
const calibrateBtn = document.getElementById("calibrate-btn");
const sensitivitySlider = document.getElementById("sensitivity-slider");
const loadingOverlay = document.getElementById("loading");
const gestureIndicator = document.getElementById("gesture-indicator");

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
let lastNoseX = 0;
const POINTER_LERP_MIN = 0.10;
const POINTER_LERP_MAX = 0.78;
const MOVEMENT_DEADZONE_MIN = 0.0006;
const MOVEMENT_DEADZONE_MAX = 0.0062;
const ABSOLUTE_ASSIST_WEIGHT_MIN = 0.16;
const ABSOLUTE_ASSIST_WEIGHT_MAX = 0.42;
const ABSOLUTE_ASSIST_RANGE_MIN = 0.07;
const ABSOLUTE_ASSIST_RANGE_MAX = 0.22;
const EDGE_RELEASE_PX = 26;
const EDGE_RELEASE_ASSIST_SCALE = 0.14;
const EDGE_RELEASE_BOOST = 2.0;
const SENSITIVITY_EXP_K = 5.0;
const SENSITIVITY_STEP_GAIN_MIN = 900;
const SENSITIVITY_STEP_GAIN_MAX = 42000;

const POINTER_SENSITIVITY_KEY = "pointer_sensitivity";
const RELATIVE_POINTER_DEADZONE_KEY = "relative_pointer_deadzone";
const RELATIVE_POINTER_STEP_GAIN_KEY = "relative_pointer_step_gain";
const JAW_OPEN_THRESHOLD_KEY = "jaw_open_threshold";
const ICON_STYLE_KEY = "icon_style";
const ICON_STYLE_DEFAULT = "simple";
const ICON_STYLE_COMIC = "comic";
const ICON_STYLE_COMIC2 = "comic2";

const POINTER_SENSITIVITY_DEFAULT = 4;
const RELATIVE_POINTER_DEADZONE_DEFAULT = 4;
const RELATIVE_POINTER_STEP_GAIN_DEFAULT = 6;
const JAW_OPEN_THRESHOLD_DEFAULT = 0.45;

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
            { name: "トイレ", icon: "media/menu-toilet.png", sentence: "トイレに行きたいです。" }
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
            { name: "あつい・さむい", icon: "media/menu-hot-cold.png", sentence: "あつい、または、さむいです。" }
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
let isCalibrating = true;
let pointerSensitivity = readStoredNumber(POINTER_SENSITIVITY_KEY, POINTER_SENSITIVITY_DEFAULT, 1, 10);
let relativePointerDeadzone = readStoredNumber(RELATIVE_POINTER_DEADZONE_KEY, RELATIVE_POINTER_DEADZONE_DEFAULT, 0, 10);
let relativePointerStepGain = readStoredNumber(RELATIVE_POINTER_STEP_GAIN_KEY, RELATIVE_POINTER_STEP_GAIN_DEFAULT, 1, 10);
let jawOpenThreshold = readStoredNumber(JAW_OPEN_THRESHOLD_KEY, JAW_OPEN_THRESHOLD_DEFAULT, 0.1, 0.9);
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
    lastNoseX = 0;
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

function getFollowSpeedRatio() {
    return clamp((relativePointerStepGain - 1) / 9, 0, 1);
}

function getStabilityRatio() {
    return clamp(relativePointerDeadzone / 10, 0, 1);
}

function getMovementDeadzone() {
    const stabilityRatio = getStabilityRatio();
    return MOVEMENT_DEADZONE_MIN + ((MOVEMENT_DEADZONE_MAX - MOVEMENT_DEADZONE_MIN) * stabilityRatio);
}

function getFollowLerp() {
    const followSpeedRatio = getFollowSpeedRatio();
    const sensitivityRatio = clamp(pointerSensitivity / 10, 0, 1);
    const boostedRatio = Math.max(followSpeedRatio, sensitivityRatio);
    return POINTER_LERP_MIN + ((POINTER_LERP_MAX - POINTER_LERP_MIN) * boostedRatio);
}

function getSensitivityExpCurve() {
    const x = clamp(pointerSensitivity / 10, 0, 1);
    const expMax = Math.exp(SENSITIVITY_EXP_K);
    return (Math.exp(SENSITIVITY_EXP_K * x) - 1) / (expMax - 1);
}

function getGazeEnhancedX(landmarks, noseX) {
    // 目線アシストは無効化し、鼻追従のみで制御する
    return noseX;
}

function updateRelativePointerTarget(noseX, landmarks) {
    const bounds = getSymptomRowPointerBounds();
    if (!bounds) return;

    const controlX = 1 - getGazeEnhancedX(landmarks, noseX);
    const sensitivityRatio = clamp(pointerSensitivity / 10, 0, 1);

    if (lastNoseX === 0) {
        lastNoseX = controlX;
        targetX = bounds.centerX;
        targetY = bounds.centerY;
        return;
    }

    const movement = controlX - lastNoseX;
    const absMovement = Math.abs(movement);
    const deadzoneBySensitivity = 1 - (0.55 * sensitivityRatio);
    const effectiveDeadzone = getMovementDeadzone() * deadzoneBySensitivity;
    let relativeDelta = 0;
    if (absMovement > effectiveDeadzone) {
        const sensitivityCurve = getSensitivityExpCurve();
        const followSpeedRatio = getFollowSpeedRatio();
        const relativeMotionBoost = 0.95 + (followSpeedRatio * 0.85) + (sensitivityCurve * 0.55);
        const baseStepGain = SENSITIVITY_STEP_GAIN_MIN
            + ((SENSITIVITY_STEP_GAIN_MAX - SENSITIVITY_STEP_GAIN_MIN) * sensitivityCurve);
        const signed = Math.sign(movement);
        const scaled = (absMovement - effectiveDeadzone)
            * baseStepGain
            * relativeMotionBoost;
        relativeDelta = signed * scaled;

        // 左右端で張り付きやすいときの解除ブースト
        const atLeftEdge = targetX <= (bounds.minX + EDGE_RELEASE_PX);
        const atRightEdge = targetX >= (bounds.maxX - EDGE_RELEASE_PX);
        if ((atLeftEdge && relativeDelta > 0) || (atRightEdge && relativeDelta < 0)) {
            relativeDelta *= EDGE_RELEASE_BOOST;
        }

        targetX += relativeDelta;
    }

    // 端まで届きにくい問題を抑えるため、校正位置からの絶対オフセットでも補正する
    const halfRange = (bounds.maxX - bounds.minX) * 0.5;
    const followSpeedRatio = getFollowSpeedRatio();
    const absoluteAssistRange = ABSOLUTE_ASSIST_RANGE_MAX - ((ABSOLUTE_ASSIST_RANGE_MAX - ABSOLUTE_ASSIST_RANGE_MIN) * sensitivityRatio);
    const absoluteAssistWeight = ABSOLUTE_ASSIST_WEIGHT_MIN + ((ABSOLUTE_ASSIST_WEIGHT_MAX - ABSOLUTE_ASSIST_WEIGHT_MIN) * followSpeedRatio);
    const normalizedOffset = clamp((controlX - calibratedNoseX) / absoluteAssistRange, -1, 1);
    const absoluteTargetX = bounds.centerX + (normalizedOffset * halfRange);

    // エッジ付近では絶対アシストを弱め、中央方向へ戻しやすくする
    const atEdge = targetX <= (bounds.minX + EDGE_RELEASE_PX) || targetX >= (bounds.maxX - EDGE_RELEASE_PX);
    const effectiveAbsoluteAssistWeight = atEdge
        ? (absoluteAssistWeight * EDGE_RELEASE_ASSIST_SCALE)
        : absoluteAssistWeight;
    targetX = (targetX * (1 - effectiveAbsoluteAssistWeight)) + (absoluteTargetX * effectiveAbsoluteAssistWeight);

    targetX = Math.max(bounds.minX, Math.min(bounds.maxX, targetX));
    targetY = bounds.centerY;
    lastNoseX = controlX;
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
    const activityThreshold = getMovementDeadzone();
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

    if (results.faceLandmarks) {
        for (const landmarks of results.faceLandmarks) {
            drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: "#808080CC", lineWidth: 1.5 });
            if (FaceLandmarker.FACE_LANDMARKS_LIPS) {
                const lipsColor = jawOpenFilteredScore >= jawOpenThreshold ? "#ff5252" : "#00e676";
                drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, {
                    color: lipsColor,
                    lineWidth: jawOpenFilteredScore >= jawOpenThreshold ? 3.2 : 2.5
                });
            }

            drawMouthDetectionOverlay(landmarks);

            const nose = landmarks[4];
            if (isCalibrating) {
                calibratedNoseX = 1 - nose.x;
                calibratedNoseY = nose.y;
                isCalibrating = false;
                lastNoseX = 1 - nose.x;
                speak("完了");
            }

            updateRelativePointerTarget(nose.x, landmarks);
            trackSymptomActivityByMovement(nose.x, nose.y);
        }
    }

    const followLerp = getFollowLerp();
    pointerX += (targetX - pointerX) * followLerp;
    pointerY += (targetY - pointerY) * followLerp;
    pointerElement.style.left = `${pointerX}px`;
    pointerElement.style.top = `${pointerY}px`;

    checkPointerCollision();
    checkSymptomIdleReset();
    window.requestAnimationFrame(predictWebcam);
}

let isMouthOpen = false;
let gestureCooldown = false;
const GESTURE_COOLDOWN_MS = 800;
const JAW_OPEN_REQUIRED_FRAMES = 4;
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

function markClickFeedback() {
    clickFeedbackUntil = Date.now() + CLICK_FEEDBACK_MS;
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

    const openThreshold = jawOpenThreshold;
    const closeThreshold = Math.max(0.05, jawOpenThreshold - JAW_OPEN_HYSTERESIS);

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
    const isOpenDetected = jawOpenFilteredScore >= jawOpenThreshold;
    const isClickFeedbackActive = Date.now() < clickFeedbackUntil;
    // 色はクリック実行タイミングに合わせる（クリック時=赤、それ以外=緑）
    const accent = isClickFeedbackActive ? "#ff5252" : "#00e676";
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
    speak("リセット");
});

sensitivitySlider.addEventListener("input", e => {
    pointerSensitivity = parseFloat(e.target.value);
    localStorage.setItem(POINTER_SENSITIVITY_KEY, String(pointerSensitivity));
    refreshTuningSliderLabels();
});

if (sensitivitySlider) {
    sensitivitySlider.value = String(pointerSensitivity);
}

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
const relativeSpeedSlider = document.getElementById("relative-speed-slider");
const relativeDeadzoneSlider = document.getElementById("relative-deadzone-slider");
const jawOpenThresholdSlider = document.getElementById("jaw-open-threshold-slider");
const sensitivityValue = document.getElementById("sensitivity-value");
const iconStyleSelect = document.getElementById("icon-style-select");
const relativeSpeedValue = document.getElementById("relative-speed-value");
const relativeDeadzoneValue = document.getElementById("relative-deadzone-value");
const jawOpenThresholdValue = document.getElementById("jaw-open-threshold-value");
const mouseClickFeedback = document.getElementById("mouse-click-feedback");
const saveSettingsBtn = document.getElementById("save-settings");
const closeSettingsBtn = document.getElementById("close-settings");

function refreshTuningSliderLabels() {
    if (sensitivityValue) sensitivityValue.textContent = pointerSensitivity.toFixed(1);
    if (relativeSpeedValue) relativeSpeedValue.textContent = relativePointerStepGain.toFixed(1);
    if (relativeDeadzoneValue) relativeDeadzoneValue.textContent = relativePointerDeadzone.toFixed(1);
    if (jawOpenThresholdValue) jawOpenThresholdValue.textContent = jawOpenThreshold.toFixed(2);
}

if (relativeSpeedSlider) {
    relativeSpeedSlider.addEventListener("input", (e) => {
        relativePointerStepGain = Number.parseFloat(e.target.value);
        localStorage.setItem(RELATIVE_POINTER_STEP_GAIN_KEY, String(relativePointerStepGain));
        refreshTuningSliderLabels();
    });
}

if (relativeDeadzoneSlider) {
    relativeDeadzoneSlider.addEventListener("input", (e) => {
        relativePointerDeadzone = Number.parseFloat(e.target.value);
        localStorage.setItem(RELATIVE_POINTER_DEADZONE_KEY, String(relativePointerDeadzone));
        refreshTuningSliderLabels();
    });
}

if (jawOpenThresholdSlider) {
    jawOpenThresholdSlider.addEventListener("input", (e) => {
        jawOpenThreshold = Number.parseFloat(e.target.value);
        localStorage.setItem(JAW_OPEN_THRESHOLD_KEY, String(jawOpenThreshold));
        refreshTuningSliderLabels();
    });
}

if (relativeSpeedSlider) relativeSpeedSlider.value = String(relativePointerStepGain);
if (relativeDeadzoneSlider) relativeDeadzoneSlider.value = String(relativePointerDeadzone);
if (jawOpenThresholdSlider) jawOpenThresholdSlider.value = String(jawOpenThreshold);
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
    localStorage.setItem(POINTER_SENSITIVITY_KEY, String(pointerSensitivity));
    localStorage.setItem(RELATIVE_POINTER_STEP_GAIN_KEY, String(relativePointerStepGain));
    localStorage.setItem(RELATIVE_POINTER_DEADZONE_KEY, String(relativePointerDeadzone));
    localStorage.setItem(JAW_OPEN_THRESHOLD_KEY, String(jawOpenThreshold));
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
