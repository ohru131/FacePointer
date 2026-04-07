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
let rawHierarchyText = "";

async function loadHierarchy() {
    let text;
    try {
        // Tauri環境（デスクトップアプリ）の場合は外部ファイルを優先して読み込む
        if (window.__TAURI__ && window.__TAURI__.path && window.__TAURI__.fs) {
            const tauriPath = window.__TAURI__.path;
            const tauriFs = window.__TAURI__.fs;
            const resourcePath = await tauriPath.resolveResource('hierarchy.txt');
            text = await tauriFs.readTextFile(resourcePath);
            console.log("Loaded hierarchy from external resource:", resourcePath);
        } else {
            // 開発中やブラウザ実行時はウェブアセットから読み込む
            const response = await fetch("hierarchy.txt");
            text = await response.text();
        }
    } catch (error) {
        console.warn("External hierarchy.txt not found or access denied, falling back to embedded one.", error);
        const response = await fetch("hierarchy.txt");
        text = await response.text();
    }
    
    rawHierarchyText = text;
    parseHierarchyAndRender(text);
}

function parseHierarchyAndRender(text) {
    const lines = text.split("\n").filter(l => l.trim() !== "");
    const tree = [];
    const stack = [{ level: -1, children: tree }];
    lines.forEach(line => {
        const indent = line.search(/\S/);
        const content = line.trim();
        // Support Name|Icon:Sentence format
        const [mainPart, sentence] = content.includes(":") ? content.split(":") : [content, null];
        const [name, icon] = mainPart.includes("|") ? mainPart.split("|") : [mainPart, null];

        const level = indent / 2;
        while (stack[stack.length - 1].level >= level) stack.pop();
        const newNode = { name, icon, sentence, children: [] };
        stack[stack.length - 1].children.push(newNode);
        stack.push({ level, children: newNode.children, node: newNode });
    });
    menuTree = tree;
    renderAll();
}



function renderRow(container, items, rowNum, activeItemName) {
    container.innerHTML = "";
    const slots = [...items];
    if (slots.length === 0) return;

    // 各階層の要素数に合わせて均等に幅を自動調整
    container.style.gridTemplateColumns = `repeat(${slots.length}, 1fr)`;
    
    slots.forEach((item, idx) => {
        const btn = document.createElement("div");
        btn.className = "h-btn";
        btn.dataset.row = rowNum;
        btn.dataset.idx = idx;

        if (!item) {
            btn.classList.add("h-btn--empty");
            btn.innerText = "－";
        } else {
            // Icon
            if (item.icon) {
                const img = document.createElement("img");
                img.src = item.icon;
                img.className = "h-btn-icon";
                btn.appendChild(img);
            }

            // Name
            const label = document.createElement("div");
            label.className = "h-btn-text";
            label.innerText = item.name;
            btn.appendChild(label);

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
// Speech (Google Gemini TTS support & System fallback)
// =========================================================
let voices = [];
let preferredVoice = null;

// --- API KEY (Browser storage) ---
let GEMINI_API_KEY = localStorage.getItem("gemini_api_key") || "";

function getGeminiUrl() {
    return `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${GEMINI_API_KEY}`;
}

// Track current speech to allow interruption
let currentAudio = null;
let currentSpeechController = null;
let isSpeechFetching = false;

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
        const request = store.put(blob, text);
        tx.oncomplete = () => resolve();
    });
}

function clearAudioCache() {
    if (!db) return;
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
}

// Initialize system voices (fallback)
function initVoices() {
    voices = window.speechSynthesis.getVoices();
    preferredVoice = voices.find(v => v.name.includes("Nanami") || v.name.includes("Natural") || v.name.includes("Online")) ||
        voices.find(v => v.lang === "ja-JP") ||
        voices[0];
}
window.speechSynthesis.onvoiceschanged = initVoices;
initVoices();

/**
 * Google Cloud TTS (Gemini Voice) を使用して発話
 */
async function speakGemini(text, silent = false) {
    if (isSpeechFetching) return true;

    // キーを正規化（空白などによる不一致防止）
    const cacheKey = text.trim();

    // 1. キャッシュを確認
    const cachedBlob = await getCachedAudio(cacheKey);
    if (cachedBlob) {
        console.log("Using cached audio for:", cacheKey);
        if (!silent) playBlob(cachedBlob);
        return true;
    }

    if (!GEMINI_API_KEY) {
        console.warn("Gemini API Key is not set.");
        return false;
    }

    // 2. キャッシュがなければ合成
    if (currentSpeechController) {
        currentSpeechController.abort();
    }
    currentSpeechController = new AbortController();

    isSpeechFetching = true;
    try {
        console.log("Generating audio with Google Cloud TTS for:", cacheKey);
        
        // ユーザー提供のペイロード（Cloud TTS の通常の高音質 Neural2 形式）
        const requestBody = {
            "audioConfig": {
                "audioEncoding": "LINEAR16",
                "pitch": 0,
                "speakingRate": 1.05  // 少しだけ早めに調整して自然にする場合
            },
            "input": {
                "text": cacheKey
            },
            "voice": {
                "languageCode": "ja-JP",
                "name": "ja-JP-Neural2-B" // または ja-JP-Neural2-C (男性) など
            }
        };

        const response = await fetch(getGeminiUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            signal: currentSpeechController.signal
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            console.error("Gemini API Error Response:", errData);
            throw new Error(`API Error: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Cloud TTS API のレスポンスから Base64 音声データを抽出
        const base64Audio = data.audioContent || data.audio;

        if (!base64Audio) {
            console.error("Unexpected API Response format:", data);
            throw new Error("No audio content in response");
        }

        console.log("Success! Audio data received.");
        const binaryAudio = atob(base64Audio);
        const arrayBuffer = new ArrayBuffer(binaryAudio.length);
        const uint8Array = new Uint8Array(arrayBuffer);
        for (let i = 0; i < binaryAudio.length; i++) {
            uint8Array[i] = binaryAudio.charCodeAt(i);
        }

        const blob = new Blob([arrayBuffer], { type: "audio/wav" });

        // キャッシュに保存完了を待機
        console.log("Saving to cache:", cacheKey);
        await setCachedAudio(cacheKey, blob);
        
        if (!silent) {
            playBlob(blob);
        }
        isSpeechFetching = false;
        return true;
    } catch (err) {
        isSpeechFetching = false;
        if (err.name === 'AbortError') return true;
        console.error("Gemini TTS Error:", err);
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
    audio.play().catch(e => console.error("Audio playback failed:", e));
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
                phrases.push(buildSentence(l1, l2, l3).trim());
            });
        });
    });

    // 重複カット
    const uniquePhrases = Array.from(new Set(phrases));

    audioStatus.style.display = "block";
    let successCount = 0;
    for (let i = 0; i < uniquePhrases.length; i++) {
        const text = uniquePhrases[i];
        
        // キャッシュを確認
        const cached = await getCachedAudio(text);
        if (cached) {
            successCount++;
            continue;
        }
        audioStatus.textContent = `音声生成中: ${successCount}/${uniquePhrases.length}...`;
        // silent = true で呼び出し、音声を鳴らさない
        const success = await speakGemini(text, true); 
        
        if (success) {
            successCount++;
        } else {
            console.error("Fatal error during prefetch. Stopping batch process.");
            audioStatus.textContent = "⚠ 通信エラーのため中断しました。設定を確認してください。";
            setTimeout(() => { audioStatus.style.display = "none"; }, 5000);
            return; // ループを抜けて中断
        }
        
        // API制限を考慮した待機
        await new Promise(r => setTimeout(r, 600));
    }
    
    if (successCount === uniquePhrases.length) {
        audioStatus.textContent = "✓ 全ての音声が準備できました";
    } else {
        audioStatus.textContent = `⚠ 一部の生成に失敗しました (${successCount}/${uniquePhrases.length})`;
    }
    setTimeout(() => { audioStatus.style.display = "none"; }, 4000);
}


async function speak(text) {
    window.speechSynthesis.cancel();
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    // Try Gemini TTS first
    const success = await speakGemini(text);
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
// Controls & Settings UI
// =========================================================
calibrateBtn.addEventListener("click", () => {
    isCalibrating = true;
    speak("リセット");
});
sensitivitySlider.addEventListener("input", e => {
    pointerSensitivity = parseFloat(e.target.value);
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
const hierarchyInput = document.getElementById("hierarchy-input");
const saveSettingsBtn = document.getElementById("save-settings");
const closeSettingsBtn = document.getElementById("close-settings");

settingsBtn.addEventListener("click", () => {
    apiKeyInput.value = GEMINI_API_KEY;
    if (hierarchyInput) hierarchyInput.value = rawHierarchyText;
    settingsModal.classList.add("active");
});

closeSettingsBtn.addEventListener("click", () => {
    settingsModal.classList.remove("active");
});

saveSettingsBtn.addEventListener("click", async () => {
    const newKey = apiKeyInput.value.trim();
    if (newKey) {
        GEMINI_API_KEY = newKey;
        localStorage.setItem("gemini_api_key", newKey);
    }

    if (hierarchyInput) {
        const newHierarchy = hierarchyInput.value;
        if (newHierarchy !== rawHierarchyText) {
            // Tauri環境の場合はファイルに書き込む
            if (window.__TAURI__ && window.__TAURI__.path && window.__TAURI__.fs) {
                try {
                    const resourcePath = await window.__TAURI__.path.resolveResource('hierarchy.txt');
                    await window.__TAURI__.fs.writeTextFile(resourcePath, newHierarchy);
                    console.log("Saved new hierarchy to", resourcePath);
                } catch (e) {
                    console.error("Failed to save hierarchy.txt", e);
                    alert("階層ファイルの保存に失敗しました: " + e.message);
                }
            }
            // メモリ上のツリーを更新して再描画
            rawHierarchyText = newHierarchy;
            parseHierarchyAndRender(newHierarchy);
        }
    }

    alert("設定を保存しました。");
    settingsModal.classList.remove("active");
});

// Close modal when clicking outside
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
    await setupMediaPipe();
    await loadHierarchy();
    // 安全のため、起動時の自動プリフェッチは無効化（ボタン押下時のみ実行）
})();

