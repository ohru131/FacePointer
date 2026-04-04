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
const confirmZoneBar = document.getElementById("confirm-zone-bar");

let faceLandmarker;
let lastVideoTime = -1;
let results = undefined;

// Hierarchy data
let menuTree = [];      // 4 top items
let selectedL1 = null; // selected layer 1 item (node)
let selectedL2 = null; // selected layer 2 item (node)
let hoverL1 = null;    // currently hovered L1
let hoverL2 = null;    // currently hovered L2
let pendingL3 = null;  // last hovered L3 item (for confirm zone)

// Confirm zone dwell
const CONFIRM_ZONE_DWELL_MS = 700;
let confirmZoneDwellStart = 0;
let confirmZoneActive = false;

// Track "visited" buttons to keep them colored
const visitedL1 = new Set();
const visitedL2 = new Set();

// Pointer state
let pointerX = window.innerWidth / 2;
let pointerY = window.innerHeight / 2;
let targetX = pointerX;
let targetY = pointerY;
const LERP_FACTOR = 0.18;

// Calibration
let calibratedNoseX = 0.5;
let calibratedNoseY = 0.5;
let isCalibrating = true;
let pointerSensitivity = 4;

// Gesture state
let isMouthOpen = false;
let lastNoseY = 0;
let isNodding = false;
const JAW_OPEN_THRESHOLD = 0.45;
const NOD_THRESHOLD = 0.012;

// Gesture cooldown
let gestureCooldown = false;
const GESTURE_COOLDOWN_MS = 800;

// =========================================================
// Sentence builder – convert 3-level selection to natural Japanese
// =========================================================
function buildSentence(l1, l2, l3) {
    // If the 3rd layer item (l3) has a custom sentence defined in hierarchy.txt, use it.
    if (l3 && l3.sentence) {
        return l3.sentence;
    }
    // Fallback for cases without explicit sentences
    return l3 ? l3.name : "";
}

// =========================================================
// MediaPipe
// =========================================================
async function setupMediaPipe() {
    try {
        const filesetResolver = await FilesetResolver.forVisionTasks("./mediapipe/wasm");
        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: `./mediapipe/model/face_landmarker.task`,
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

// =========================================================
// Hierarchy loading
// =========================================================
async function loadHierarchy() {
    const response = await fetch("hierarchy.txt");
    const text = await response.text();
    const lines = text.split("\n").filter(l => l.trim() !== "");
    const tree = [];
    const stack = [{ level: -1, children: tree }];
    lines.forEach(line => {
        const indent = line.search(/\S/);
        const content = line.trim();
        // Support Name:Sentence format
        const parts = content.split(":");
        const name = parts[0];
        const sentence = parts.length > 1 ? parts[1] : null;

        const level = indent / 2;
        while (stack[stack.length - 1].level >= level) stack.pop();
        const newNode = { name, sentence, children: [] };
        stack[stack.length - 1].children.push(newNode);
        stack.push({ level, children: newNode.children, node: newNode });
    });
    menuTree = tree;
    renderAll();
}



function renderRow(container, items, rowNum, activeItemName) {
    container.innerHTML = "";
    // Ensure exactly 4 slots
    const slots = [...items];
    while (slots.length < 4) slots.push(null);
    slots.slice(0, 4).forEach((item, idx) => {
        const btn = document.createElement("div");
        btn.className = "h-btn";
        btn.dataset.row = rowNum;
        btn.dataset.idx = idx;

        if (!item) {
            btn.classList.add("h-btn--empty");
            btn.innerText = "－";
        } else {
            btn.innerText = item.name;
            btn.dataset.name = item.name;

            // Visited color
            if (rowNum === 1 && visitedL1.has(item.name)) btn.classList.add("visited");
            if (rowNum === 2 && visitedL2.has(item.name)) btn.classList.add("visited");

            // Active (selected) highlight — dim all others when one is selected
            if (activeItemName) {
                if (item.name === activeItemName) {
                    btn.classList.add("selected");
                } else {
                    btn.classList.add("dimmed");
                }
            }

            btn.addEventListener("click", () => handleClick(rowNum, item));
        }

        container.appendChild(btn);
    });
}

// =========================================================
// Click handler
// =========================================================
function handleClick(rowNum, item) {
    if (rowNum === 1) {
        selectedL1 = item;
        selectedL2 = null;
        visitedL1.add(item.name);
        renderAll();
    } else if (rowNum === 2) {
        selectedL2 = item;
        visitedL2.add(item.name);
        renderAll();
    } else if (rowNum === 3) {
        // Confirm selection
        if (!selectedL1 || !selectedL2) return;
        const sentence = buildSentence(selectedL1.name, selectedL2.name, item.name);
        showConfirm(sentence);
        speak(sentence);
    }
}

// =========================================================
// Confirm overlay
// =========================================================
function showConfirm(sentence) {
    // すでに同じ内容を表示中の場合は無視（フラッシュの重複防止）
    if (confirmOverlay.classList.contains("active") && confirmText.textContent === sentence) {
        return;
    }

    confirmText.textContent = sentence;
    confirmOverlay.classList.add("active");
    flashScreen();

    // 以前のタイマーがあればクリア（表示時間をリセット）
    if (window.confirmTimer) clearTimeout(window.confirmTimer);
    window.confirmTimer = setTimeout(() => {
        confirmOverlay.classList.remove("active");
    }, 3500);
}

// =========================================================
// Hover detection – L1 hover changes L2, L2 hover changes L3
// Also handles confirm zone dwell
// =========================================================
function checkPointerCollision() {
    const allBtns = document.querySelectorAll(".h-btn:not(.h-btn--empty)");
    let hoveredBtn = null;

    allBtns.forEach(btn => {
        const rect = btn.getBoundingClientRect();
        const inside = pointerX >= rect.left && pointerX <= rect.right && pointerY >= rect.top && pointerY <= rect.bottom;
        if (inside) {
            btn.classList.add("hover");
            hoveredBtn = btn;
        } else {
            btn.classList.remove("hover");
        }
    });

    if (hoveredBtn) {
        const rowNum = parseInt(hoveredBtn.dataset.row);
        const itemName = hoveredBtn.dataset.name;

        // 1階層目: ホバーしたら即座に選択肢を固定し、2段目を表示
        if (rowNum === 1) {
            const l1Node = menuTree.find(n => n.name === itemName);
            if (l1Node && (!selectedL1 || selectedL1.name !== itemName)) {
                selectedL1 = l1Node;
                selectedL2 = null;
                pendingL3 = null;
                visitedL1.add(itemName);
                renderAll();
                updateConfirmZone();
            }
        }

        // 2階層目: 1段目が決まっている状態でホバーしたら2段目を固定
        if (rowNum === 2 && selectedL1) {
            const l2Node = selectedL1.children.find(n => n.name === itemName);
            if (l2Node && (!selectedL2 || selectedL2.name !== itemName)) {
                selectedL2 = l2Node;
                pendingL3 = null;
                visitedL2.add(itemName);
                renderAll();
                updateConfirmZone();
            }
        }

        // 3階層目: 2段目が決まっている状態でホバー
        if (rowNum === 3 && selectedL2) {
            const l3Node = selectedL2.children.find(n => n.name === itemName);
            if (l3Node && (!pendingL3 || pendingL3.name !== itemName)) {
                pendingL3 = l3Node;
                renderAll(); // 全体を再描画して3段目も強調/減光を適用
                updateConfirmZone();
            }
        }
    }

    // ── 確定ゾーン判定 (画面下部) ──
    const czRect = confirmZone.getBoundingClientRect();
    // ポインタが確定ゾーンの領域内かつ、3段階すべて選ばれている場合
    const inZone = pointerX >= czRect.left && pointerX <= czRect.right && pointerY >= czRect.top;

    if (inZone && pendingL3 && selectedL1 && selectedL2) {
        confirmZone.classList.add("active");
        if (confirmZoneDwellStart === 0) {
            confirmZoneDwellStart = Date.now();
        }
        const elapsed = Date.now() - confirmZoneDwellStart;
        const pct = Math.min(100, (elapsed / CONFIRM_ZONE_DWELL_MS) * 100);
        confirmZoneBar.style.width = pct + "%";

        if (elapsed >= CONFIRM_ZONE_DWELL_MS && !confirmZoneActive) {
            confirmZoneActive = true;
            const sentence = buildSentence(selectedL1, selectedL2, pendingL3);
            showConfirm(sentence);
            speak(sentence);

            confirmZoneDwellStart = 0;
            confirmZoneBar.style.width = "0%";
            confirmZone.classList.remove("active");
            // NOTE: confirmZoneActive はエリアを出るまで true のままにして、連呼を防ぐ
        }
    } else {
        confirmZone.classList.remove("active");
        confirmZoneDwellStart = 0;
        confirmZoneBar.style.width = "0%";
        // エリアから外れたら、再度発火可能にする
        confirmZoneActive = false;
    }
}

function renderAll() {
    renderRow(row1Container, menuTree, 1, selectedL1 ? selectedL1.name : null);
    const l2Items = selectedL1 ? selectedL1.children : Array(4).fill(null);
    renderRow(row2Container, l2Items, 2, selectedL2 ? selectedL2.name : null);
    const l3Items = selectedL2 ? selectedL2.children : Array(4).fill(null);
    renderRow(row3Container, l3Items, 3, pendingL3 ? pendingL3.name : null);
}

function updateConfirmZone() {
    if (pendingL3 && selectedL1 && selectedL2) {
        const preview = buildSentence(selectedL1, selectedL2, pendingL3);
        confirmZonePreview.textContent = `「${preview}」`;
    } else {
        confirmZonePreview.textContent = "";
    }
}

// =========================================================
// Speech (VOICEVOX support & System fallback)
// =========================================================
let voices = [];
let preferredVoice = null;
const VOICEVOX_URL = "http://localhost:50021";
const VOICEVOX_SPEAKER_ID = 8; // 2: 四国めたん (Normal), 3: ずんだもん ...

// Track current speech to allow interruption
let currentAudio = null;
let currentSpeechController = null;
let isSpeechFetching = false; // 通信中の二重リクエスト防止

// --- IndexedDB for Audio Caching ---
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
        request = store.put(blob, text);
        tx.oncomplete = () => resolve();
    });
}

function clearAudioCache() {
    if (!db) return;
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
}

// Initialize system voices
function initVoices() {
    voices = window.speechSynthesis.getVoices();
    // Try to find natural sounding Japanese voices
    preferredVoice = voices.find(v => v.name.includes("Nanami") || v.name.includes("Natural") || v.name.includes("Online")) ||
        voices.find(v => v.lang === "ja-JP") ||
        voices[0];
}
window.speechSynthesis.onvoiceschanged = initVoices;
initVoices();

/**
 * VOICEVOX Engine (localhost:50021) を使用して発話
 */
async function speakVOICEVOX(text) {
    if (isSpeechFetching) return true;

    // 1. まずキャッシュを確認
    const cachedBlob = await getCachedAudio(text);
    if (cachedBlob) {
        playBlob(cachedBlob);
        return true;
    }

    // 2. キャッシュがなければ合成（従来のフロー）
    if (currentSpeechController) {
        currentSpeechController.abort();
    }
    currentSpeechController = new AbortController();
    const signal = currentSpeechController.signal;

    isSpeechFetching = true;
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("VOICEVOX Timeout")), 2000)
    );

    try {
        const fetchQuery = fetch(`${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${VOICEVOX_SPEAKER_ID}`, {
            method: "POST",
            signal: signal
        });
        const qResp = await Promise.race([fetchQuery, timeoutPromise]);
        if (!qResp.ok) throw new Error("Query failed");
        const queryJson = await qResp.json();

        const fetchSynthesis = fetch(`${VOICEVOX_URL}/synthesis?speaker=${VOICEVOX_SPEAKER_ID}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(queryJson),
            signal: signal
        });
        const sResp = await Promise.race([fetchSynthesis, timeoutPromise]);
        if (!sResp.ok) throw new Error("Synthesis failed");

        const arrayBuffer = await sResp.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: "audio/wav" });

        // キャッシュに保存
        await setCachedAudio(text, blob);
        playBlob(blob);

        isSpeechFetching = false;
        return true;
    } catch (err) {
        isSpeechFetching = false;
        if (err.name === 'AbortError') return true;
        return false;
    }
}

function playBlob(blob) {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    audio.play();
    audio.onended = () => {
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
    };
}

/**
 * 全ての音声パターンを事前合成してキャッシュする
 */
const audioStatus = document.getElementById("audio-status");
async function prefetchAllAudio() {
    if (!menuTree || menuTree.length === 0) return;
    const phrases = [];
    menuTree.forEach(l1 => {
        l1.children.forEach(l2 => {
            l2.children.forEach(l3 => {
                phrases.push(buildSentence(l1, l2, l3));
            });
        });
    });

    audioStatus.style.display = "block";
    let count = 0;
    for (const text of phrases) {
        // すでにキャッシュにあるかチェック
        const cached = await getCachedAudio(text);
        if (cached) {
            count++;
            continue;
        }

        audioStatus.textContent = `音声生成中: ${count}/${phrases.length}...`;
        try {
            // 個別のフェッチを行う（speakVOICEVOX内部の仕組みを流用するが、再生はしない）
            const qResp = await fetch(`${VOICEVOX_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${VOICEVOX_SPEAKER_ID}`, { method: "POST" });
            const queryJson = await qResp.json();
            const sResp = await fetch(`${VOICEVOX_URL}/synthesis?speaker=${VOICEVOX_SPEAKER_ID}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(queryJson)
            });
            const buffer = await sResp.arrayBuffer();
            await setCachedAudio(text, new Blob([buffer], { type: "audio/wav" }));
        } catch (e) {
            console.error("Cache failed for:", text, e);
        }
        count++;
    }
    audioStatus.textContent = "✓ 全ての音声が準備できました";
    setTimeout(() => { audioStatus.style.display = "none"; }, 3000);
}

async function speak(text) {
    // 常に以前の音声を停止（Fallback用も含めて）
    window.speechSynthesis.cancel();
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    // Try VOICEVOX first
    const success = await speakVOICEVOX(text);
    if (success) return;

    // Fallback to Web Speech API
    const uttr = new SpeechSynthesisUtterance(text);
    if (preferredVoice) uttr.voice = preferredVoice;
    uttr.lang = "ja-JP";
    uttr.rate = 0.95;
    window.speechSynthesis.speak(uttr);
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
    if (results.faceLandmarks) {
        for (const landmarks of results.faceLandmarks) {
            drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: "#C0C0C070", lineWidth: 1 });
            const nose = landmarks[4];
            if (isCalibrating) {
                calibratedNoseX = nose.x;
                calibratedNoseY = nose.y;
                isCalibrating = false;
                speak("完了");
            }
            const deltaX = (calibratedNoseX - nose.x) * pointerSensitivity;
            const deltaY = (nose.y - calibratedNoseY) * pointerSensitivity;
            targetX = (0.5 + deltaX) * window.innerWidth;
            targetY = (0.5 + deltaY) * window.innerHeight;
            targetX = Math.max(0, Math.min(window.innerWidth, targetX));
            targetY = Math.max(0, Math.min(window.innerHeight, targetY));
            updateGestureDetection(results, landmarks);
        }
    }
    pointerX += (targetX - pointerX) * LERP_FACTOR;
    pointerY += (targetY - pointerY) * LERP_FACTOR;
    pointerElement.style.left = `${pointerX}px`;
    pointerElement.style.top = `${pointerY}px`;
    checkPointerCollision();
    window.requestAnimationFrame(predictWebcam);
}

function updateGestureDetection(results, landmarks) {
    if (gestureCooldown) return;
    if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
        const cats = results.faceBlendshapes[0].categories;
        const jawOpen = cats.find(c => c.categoryName === "jawOpen")?.score || 0;
        if (jawOpen > JAW_OPEN_THRESHOLD && !isMouthOpen) {
            isMouthOpen = true;
            showGestureFeedback();
            triggerClick();
        } else if (jawOpen <= JAW_OPEN_THRESHOLD) {
            isMouthOpen = false;
        }
    }
    const nose = landmarks[4];
    const forehead = landmarks[10];
    const relativePos = nose.y - forehead.y;
    if (lastNoseY !== 0) {
        const delta = relativePos - lastNoseY;
        if (delta > NOD_THRESHOLD && !isNodding) {
            isNodding = true;
            showGestureFeedback();
            triggerClick();
        } else if (delta < -NOD_THRESHOLD / 2) {
            isNodding = false;
        }
    }
    lastNoseY = relativePos;
}

function showGestureFeedback() {
    gestureIndicator.classList.add("active");
    pointerElement.style.transform = "translate(-50%, -50%) scale(2)";
    pointerElement.style.backgroundColor = "#fff";
    gestureCooldown = true;
    setTimeout(() => {
        gestureIndicator.classList.remove("active");
        pointerElement.style.transform = "translate(-50%, -50%) scale(1)";
        pointerElement.style.backgroundColor = "var(--primary-color)";
        gestureCooldown = false;
    }, GESTURE_COOLDOWN_MS);
}

function triggerClick() {
    const activeBtn = document.querySelector(".h-btn.hover");
    if (activeBtn && !activeBtn.classList.contains("h-btn--empty")) {
        activeBtn.classList.add("clicked-anim");
        setTimeout(() => {
            activeBtn.classList.remove("clicked-anim");
            activeBtn.click();
        }, 180);
    }
}

// =========================================================
// Controls
// =========================================================
calibrateBtn.addEventListener("click", () => {
    isCalibrating = true;
    speak("リセット");
});
sensitivitySlider.addEventListener("input", e => {
    pointerSensitivity = parseFloat(e.target.value);
});

// =========================================================
// Boot
// =========================================================
(async () => {
    await initDB();
    await setupMediaPipe();
    await loadHierarchy();
    // 起動時に軽くプリフェッチ（既存キャッシュがあれば一瞬）
    prefetchAllAudio();
})();

const audioCacheBtn = document.getElementById("audio-cache-btn");
audioCacheBtn.addEventListener("click", () => {
    if (confirm("音声データを全て再生成し、キャッシュを更新しますか？\n(少し時間がかかります)")) {
        clearAudioCache();
        prefetchAllAudio();
    }
});
