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

const RUNTIME_HIERARCHY_KEY = "hierarchy_runtime_text";
const modifiedPhraseSet = new Set();
const phraseEditorUiState = {
    query: "",
    openL1: new Set(),
    openL2: new Set(),
    toolbarSetup: false
};

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function buildSentence(l1, l2, l3) {
    if (l3 && l3.sentence && l3.sentence.trim()) return l3.sentence.trim();
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
    const runtimeText = localStorage.getItem(RUNTIME_HIERARCHY_KEY);
    if (runtimeText && runtimeText.trim()) {
        rawHierarchyText = runtimeText;
        parseHierarchyAndRender(runtimeText);
        console.log("Loaded hierarchy from browser storage");
        return;
    }

    let text;
    try {
        // Tauri環境（デスクトップアプリ）の場合は同梱リソースを初期値として読み込む
        if (window.__TAURI__ && window.__TAURI__.path && window.__TAURI__.fs) {
            const tauriPath = window.__TAURI__.path;
            const tauriFs = window.__TAURI__.fs;
            const resourcePath = await tauriPath.resolveResource("hierarchy.txt");
            text = await tauriFs.readTextFile(resourcePath);
            console.log("Loaded hierarchy from bundled resource:", resourcePath);
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
    applyDefaultSelections();
    renderAll();
}

function applyDefaultSelections() {
    selectedL1 = menuTree[0] || null;
    selectedL2 = selectedL1?.children?.[0] || null;
    pendingL3 = null;

    if (selectedL1?.name) visitedL1.add(selectedL1.name);
    if (selectedL2?.name) visitedL2.add(selectedL2.name);
}

function serializeHierarchy(tree) {
    const lines = [];
    const walk = (nodes, indent) => {
        nodes.forEach(node => {
            const space = " ".repeat(indent);
            const main = node.icon ? `${node.name}|${node.icon}` : node.name;
            const line = node.sentence && node.sentence.trim()
                ? `${space}${main}:${node.sentence.trim()}`
                : `${space}${main}`;
            lines.push(line);
            if (node.children && node.children.length) {
                walk(node.children, indent + 2);
            }
        });
    };
    walk(tree, 0);
    return lines.join("\n");
}

function persistHierarchyToBrowser() {
    rawHierarchyText = serializeHierarchy(menuTree);
    localStorage.setItem(RUNTIME_HIERARCHY_KEY, rawHierarchyText);
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

            if (rowNum === 2 && selectedL1) btn.classList.add("h-btn--parent-l1");
            if (rowNum === 3 && selectedL1) btn.classList.add("h-btn--parent-l1");
            if (rowNum === 3 && selectedL2) btn.classList.add("h-btn--parent-l2");

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
        selectedL2 = item?.children?.[0] || null;
        pendingL3 = null;
        visitedL1.add(item.name);
        if (selectedL2?.name) visitedL2.add(selectedL2.name);
        renderAll();
        updateConfirmZone();
    } else if (rowNum === 2) {
        selectedL2 = item;
        pendingL3 = null;
        visitedL2.add(item.name);
        renderAll();
        updateConfirmZone();
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
    const l2Items = selectedL1?.children || [];
    renderRow(row2Container, l2Items, 2, selectedL2 ? selectedL2.name : null);
    const l3Items = selectedL2?.children || [];
    renderRow(row3Container, l3Items, 3, pendingL3 ? pendingL3.name : null);
    updateHierarchyVisualState();
}

function updateHierarchyVisualState() {
    row2Container.classList.toggle("btn-row--parent-l1", !!selectedL1);
    row3Container.classList.toggle("btn-row--parent-l1", !!selectedL1);
    row3Container.classList.toggle("btn-row--parent-l2", !!selectedL2);
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

    // マウスクリックのセリフも含める
    Object.values(mouseClickSpeech).forEach(p => {
        if (p) phrases.push(p.trim());
    });

    // 重複カット
    const uniquePhrases = Array.from(new Set(phrases));

    audioStatus.style.display = "block";
    const statusLabel = audioStatus.querySelector(".status-label");
    const statusFill = audioStatus.querySelector(".status-progress-fill");
    let successCount = 0;
    for (let i = 0; i < uniquePhrases.length; i++) {
        const text = uniquePhrases[i];
        
        // キャッシュを確認
        const cached = await getCachedAudio(text);
        if (cached) {
            successCount++;
            const percentage = (successCount / uniquePhrases.length) * 100;
            if (statusLabel) statusLabel.textContent = `音声生成中: ${successCount}/${uniquePhrases.length}`;
            if (statusFill) statusFill.style.width = percentage + "%";
            continue;
        }
        const percentage = (i / uniquePhrases.length) * 100;
        if (statusLabel) statusLabel.textContent = `音声生成中: ${successCount}/${uniquePhrases.length}`;
        if (statusFill) statusFill.style.width = percentage + "%";
        // silent = true で呼び出し、音声を鳴らさない
        const success = await speakGemini(text, true); 
        
        if (success) {
            successCount++;
            const percentage = (successCount / uniquePhrases.length) * 100;
            if (statusLabel) statusLabel.textContent = `音声生成中: ${successCount}/${uniquePhrases.length}`;
            if (statusFill) statusFill.style.width = percentage + "%";
        } else {
            console.error("Fatal error during prefetch. Stopping batch process.");
            if (statusLabel) statusLabel.textContent = "⚠ 通信エラーのため中断しました。設定を確認してください。";
            if (statusFill) statusFill.style.width = "0%";
            setTimeout(() => { audioStatus.style.display = "none"; }, 5000);
            return; // ループを抜けて中断
        }
        
        // API制限を考慮した待機
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
            drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: "#808080CC", lineWidth: 1.5 });
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
const mouseLeftInput = document.getElementById("mouse-left-input");
const mouseMiddleInput = document.getElementById("mouse-middle-input");
const mouseRightInput = document.getElementById("mouse-right-input");
const mouseClickFeedback = document.getElementById("mouse-click-feedback");
const saveSettingsBtn = document.getElementById("save-settings");
const closeSettingsBtn = document.getElementById("close-settings");

function showMouseClickFeedback(button, text) {
    if (!mouseClickFeedback) return;

    const buttonLabel = button === "left" ? "左クリック" : (button === "middle" ? "真ん中クリック" : "右クリック");
    mouseClickFeedback.textContent = `${buttonLabel}: ${text}`;
    mouseClickFeedback.classList.remove("left", "middle", "right", "active");
    mouseClickFeedback.classList.add(button);

    // Reflow to restart transition when same class repeats
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

// =========================================================
// Settings UI - Tabs and Phrase Editor
// =========================================================
function renderPhraseEditor() {
    const container = document.getElementById("phrase-editor-container");
    const summary = document.getElementById("phrase-editor-summary");
    if (!container) return;
    container.innerHTML = "";

    if (!menuTree || menuTree.length === 0) return;

    setupPhraseEditorToolbar();
    const query = phraseEditorUiState.query.trim().toLowerCase();

    if (!query && phraseEditorUiState.openL1.size === 0 && menuTree.length > 0) {
        phraseEditorUiState.openL1.add("l1-0");
        if (menuTree[0].children.length > 0) {
            phraseEditorUiState.openL2.add("l1-0-l2-0");
        }
    }

    let visibleL1Count = 0;
    let visibleL3Count = 0;

    menuTree.forEach((l1, l1Index) => {
        const l1Key = `l1-${l1Index}`;
        const l2Entries = l1.children
            .map((l2, l2Index) => ({ l2, l2Index }))
            .map(({ l2, l2Index }) => {
                const l3Entries = l2.children
                    .map((l3, l3Index) => ({ l3, l3Index }))
                    .filter(({ l3 }) => {
                        if (!query) return true;
                        const target = `${l1.name} ${l2.name} ${l3.name} ${l3.sentence || ""}`.toLowerCase();
                        return target.includes(query);
                    });
                return { l2, l2Index, l3Entries };
            })
            .filter(entry => entry.l3Entries.length > 0 || !query);

        if (query && l2Entries.length === 0) return;

        visibleL1Count += 1;
        visibleL3Count += l2Entries.reduce((acc, entry) => acc + entry.l3Entries.length, 0);

        const l1Card = document.createElement("section");
        l1Card.className = "phrase-l1-card";

        const l1Header = document.createElement("button");
        const l1Open = query ? true : phraseEditorUiState.openL1.has(l1Key);
        l1Header.type = "button";
        l1Header.className = `phrase-collapsible-header${l1Open ? " open" : ""}`;
        l1Header.innerHTML = `
            <span class="phrase-collapsible-main">
                <span class="phrase-collapsible-arrow">▶</span>
                <span class="phrase-collapsible-title">${escapeHtml(l1.name)}</span>
            </span>
            <span class="phrase-collapsible-meta">中分類 ${l1.children.length} / セリフ ${l2Entries.reduce((acc, e) => acc + e.l3Entries.length, 0)}</span>
        `;
        l1Card.appendChild(l1Header);

        const l1Body = document.createElement("div");
        l1Body.className = `phrase-collapsible-body${l1Open ? " open" : ""}`;

        const l1Edit = document.createElement("div");
        l1Edit.className = "phrase-editor-input";
        const l1Label = document.createElement("label");
        l1Label.textContent = "大分類名";
        const l1Input = document.createElement("input");
        l1Input.type = "text";
        l1Input.value = l1.name;
        l1Input.addEventListener("change", (e) => {
            l1.name = e.target.value.trim() || l1.name;
            persistHierarchyToBrowser();
            renderAll();
            renderPhraseEditor();
        });
        l1Edit.appendChild(l1Label);
        l1Edit.appendChild(l1Input);
        l1Body.appendChild(l1Edit);

        l2Entries.forEach(({ l2, l2Index, l3Entries }) => {
            const l2Key = `${l1Key}-l2-${l2Index}`;
            const l2Card = document.createElement("section");
            l2Card.className = "phrase-l2-card";

            const l2Open = query ? true : phraseEditorUiState.openL2.has(l2Key);
            const l2Header = document.createElement("button");
            l2Header.type = "button";
            l2Header.className = `phrase-collapsible-header${l2Open ? " open" : ""}`;
            l2Header.innerHTML = `
                <span class="phrase-collapsible-main">
                    <span class="phrase-collapsible-arrow">▶</span>
                    <span class="phrase-collapsible-title">${escapeHtml(l2.name)}</span>
                </span>
                <span class="phrase-collapsible-meta">セリフ ${l3Entries.length}</span>
            `;
            l2Card.appendChild(l2Header);

            const l2Body = document.createElement("div");
            l2Body.className = `phrase-collapsible-body${l2Open ? " open" : ""}`;

            const l2Edit = document.createElement("div");
            l2Edit.className = "phrase-editor-input";
            const l2Label = document.createElement("label");
            l2Label.textContent = "中分類名";
            const l2Input = document.createElement("input");
            l2Input.type = "text";
            l2Input.value = l2.name;
            l2Input.addEventListener("change", (e) => {
                l2.name = e.target.value.trim() || l2.name;
                persistHierarchyToBrowser();
                renderAll();
                renderPhraseEditor();
            });
            l2Edit.appendChild(l2Label);
            l2Edit.appendChild(l2Input);
            l2Body.appendChild(l2Edit);

            const leafGrid = document.createElement("div");
            leafGrid.className = "phrase-leaf-grid";

            l3Entries.forEach(({ l3 }) => {
                const leafCard = document.createElement("div");
                leafCard.className = "phrase-leaf-card";

                const labelWrap = document.createElement("div");
                labelWrap.className = "phrase-editor-input";
                const label = document.createElement("label");
                label.textContent = "決定ボタン名";
                const labelInput = document.createElement("input");
                labelInput.type = "text";
                labelInput.value = l3.name;
                labelInput.addEventListener("change", (e) => {
                    const oldPhrase = buildSentence(l1, l2, l3);
                    l3.name = e.target.value.trim() || l3.name;
                    const newPhrase = buildSentence(l1, l2, l3);
                    if (oldPhrase) modifiedPhraseSet.add(oldPhrase);
                    if (newPhrase) modifiedPhraseSet.add(newPhrase);
                    persistHierarchyToBrowser();
                    renderAll();
                });
                labelWrap.appendChild(label);
                labelWrap.appendChild(labelInput);
                leafCard.appendChild(labelWrap);

                const sentenceWrap = document.createElement("div");
                sentenceWrap.className = "phrase-editor-input phrase-editor-sentence";
                const sentenceLabel = document.createElement("label");
                sentenceLabel.textContent = "発話文";
                const sentenceInput = document.createElement("input");
                sentenceInput.type = "text";
                sentenceInput.value = l3.sentence || "";
                sentenceInput.placeholder = "空欄なら決定ボタン名を読み上げ";
                sentenceInput.addEventListener("change", (e) => {
                    const oldPhrase = buildSentence(l1, l2, l3);
                    l3.sentence = e.target.value.trim();
                    const newPhrase = buildSentence(l1, l2, l3);
                    if (oldPhrase) modifiedPhraseSet.add(oldPhrase);
                    if (newPhrase) modifiedPhraseSet.add(newPhrase);
                    persistHierarchyToBrowser();
                });
                sentenceWrap.appendChild(sentenceLabel);
                sentenceWrap.appendChild(sentenceInput);
                leafCard.appendChild(sentenceWrap);

                leafGrid.appendChild(leafCard);
            });

            l2Body.appendChild(leafGrid);
            l2Card.appendChild(l2Body);
            l1Body.appendChild(l2Card);

            l2Header.addEventListener("click", () => {
                if (phraseEditorUiState.openL2.has(l2Key)) {
                    phraseEditorUiState.openL2.delete(l2Key);
                } else {
                    phraseEditorUiState.openL2.add(l2Key);
                }
                renderPhraseEditor();
            });
        });

        l1Card.appendChild(l1Body);
        container.appendChild(l1Card);

        l1Header.addEventListener("click", () => {
            if (phraseEditorUiState.openL1.has(l1Key)) {
                phraseEditorUiState.openL1.delete(l1Key);
            } else {
                phraseEditorUiState.openL1.add(l1Key);
            }
            renderPhraseEditor();
        });
    });

    if (summary) {
        if (!query) {
            summary.textContent = `大分類 ${visibleL1Count} 件 / セリフ ${visibleL3Count} 件`; 
        } else {
            summary.textContent = `検索「${phraseEditorUiState.query}」: 大分類 ${visibleL1Count} 件 / セリフ ${visibleL3Count} 件`; 
        }
    }

    if (visibleL1Count === 0) {
        container.innerHTML = '<div class="phrase-empty-note">一致するセリフが見つかりませんでした。</div>';
    }
}

function setupPhraseEditorToolbar() {
    if (phraseEditorUiState.toolbarSetup) return;

    const searchInput = document.getElementById("phrase-search-input");
    const expandBtn = document.getElementById("phrase-expand-all");
    const collapseBtn = document.getElementById("phrase-collapse-all");
    const clearSearchBtn = document.getElementById("phrase-clear-search");

    if (!searchInput || !expandBtn || !collapseBtn || !clearSearchBtn) return;

    searchInput.addEventListener("input", (e) => {
        phraseEditorUiState.query = (e.target.value || "").trim();
        renderPhraseEditor();
    });

    expandBtn.addEventListener("click", () => {
        phraseEditorUiState.openL1.clear();
        phraseEditorUiState.openL2.clear();
        menuTree.forEach((l1, l1Index) => {
            const l1Key = `l1-${l1Index}`;
            phraseEditorUiState.openL1.add(l1Key);
            l1.children.forEach((_, l2Index) => {
                phraseEditorUiState.openL2.add(`${l1Key}-l2-${l2Index}`);
            });
        });
        renderPhraseEditor();
    });

    collapseBtn.addEventListener("click", () => {
        phraseEditorUiState.openL1.clear();
        phraseEditorUiState.openL2.clear();
        renderPhraseEditor();
    });

    clearSearchBtn.addEventListener("click", () => {
        phraseEditorUiState.query = "";
        searchInput.value = "";
        renderPhraseEditor();
    });

    phraseEditorUiState.toolbarSetup = true;

    menuTree.forEach(l1 => {
        const l1Group = document.createElement("div");
        l1Group.className = "phrase-editor-group";

        const head = document.createElement("div");
        head.className = "phrase-editor-group-head";
        const l1InputWrap = document.createElement("div");
        l1InputWrap.className = "phrase-editor-input";
        const l1Label = document.createElement("label");
        l1Label.textContent = "大分類";
        const l1Input = document.createElement("input");
        l1Input.type = "text";
        l1Input.value = l1.name;
        l1Input.addEventListener("change", (e) => {
            l1.name = e.target.value.trim() || l1.name;
            persistHierarchyToBrowser();
            renderAll();
        });
        l1InputWrap.appendChild(l1Label);
        l1InputWrap.appendChild(l1Input);
        head.appendChild(l1InputWrap);
        l1Group.appendChild(head);

        l1.children.forEach(l2 => {
            const l2Wrap = document.createElement("div");
            l2Wrap.className = "phrase-editor-input";
            l2Wrap.style.marginTop = "0.8rem";
            const l2Label = document.createElement("label");
            l2Label.textContent = "中分類";
            const l2Input = document.createElement("input");
            l2Input.type = "text";
            l2Input.value = l2.name;
            l2Input.addEventListener("change", (e) => {
                l2.name = e.target.value.trim() || l2.name;
                persistHierarchyToBrowser();
                renderAll();
            });
            l2Wrap.appendChild(l2Label);
            l2Wrap.appendChild(l2Input);
            l1Group.appendChild(l2Wrap);

            l2.children.forEach((l3, idx) => {
                if (idx % 2 === 0) {
                    const row = document.createElement("div");
                    row.className = "phrase-editor-row";
                    l1Group.appendChild(row);
                }
                const row = l1Group.lastElementChild;

                const inputDiv = document.createElement("div");
                inputDiv.className = "phrase-editor-input";

                const label = document.createElement("label");
                label.textContent = "決定ボタン名";
                inputDiv.appendChild(label);

                const labelInput = document.createElement("input");
                labelInput.type = "text";
                labelInput.value = l3.name;
                labelInput.addEventListener("change", (e) => {
                    const oldPhrase = buildSentence(l1, l2, l3);
                    l3.name = e.target.value.trim() || l3.name;
                    const newPhrase = buildSentence(l1, l2, l3);
                    if (newPhrase !== oldPhrase) modifiedPhraseSet.add(newPhrase);
                    persistHierarchyToBrowser();
                    renderAll();
                });
                inputDiv.appendChild(labelInput);

                const sentenceDiv = document.createElement("div");
                sentenceDiv.className = "phrase-editor-input phrase-editor-sentence";
                const sentenceLabel = document.createElement("label");
                sentenceLabel.textContent = "発話文";
                const sentenceInput = document.createElement("input");
                sentenceInput.type = "text";
                sentenceInput.value = l3.sentence || "";
                sentenceInput.placeholder = "空欄なら決定ボタン名を読み上げ";
                sentenceInput.addEventListener("change", (e) => {
                    const oldPhrase = buildSentence(l1, l2, l3);
                    l3.sentence = e.target.value.trim();
                    const newPhrase = buildSentence(l1, l2, l3);
                    if (newPhrase && newPhrase !== oldPhrase) modifiedPhraseSet.add(newPhrase);
                    persistHierarchyToBrowser();
                });
                sentenceDiv.appendChild(sentenceLabel);
                sentenceDiv.appendChild(sentenceInput);

                row.appendChild(inputDiv);
                row.appendChild(sentenceDiv);
            });
        });

        container.appendChild(l1Group);
    });
}

function setupTabSystem() {
    const tabBtns = document.querySelectorAll(".settings-tab-btn");
    const tabContents = document.querySelectorAll(".settings-tab-content");

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const tabName = btn.dataset.tab;
            
            // Update buttons
            tabBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            // Update content
            tabContents.forEach(content => content.classList.remove("active"));
            document.getElementById(tabName)?.classList.add("active");

            // Generate phrase editor if switching to phrase tab
            if (tabName === "phrase-tab") {
                renderPhraseEditor();
            }
        });
    });
}

async function prefetchModifiedAudio() {
    if (!GEMINI_API_KEY) {
        alert("Gemini API Key が設定されていません");
        return;
    }

    const modifiedPhrases = Array.from(modifiedPhraseSet).filter(Boolean);
    if (modifiedPhrases.length === 0) {
        alert("修正されたセリフがありません");
        return;
    }

    if (!confirm(`${modifiedPhrases.length} 個の修正済みセリフの音声を再合成しますか？`)) {
        return;
    }

    const modalStatus = document.getElementById("phrase-synthesis-status");
    const statusRoot = modalStatus || audioStatus;
    statusRoot.style.display = "block";
    const statusLabel = statusRoot.querySelector(".status-label");
    const statusFill = statusRoot.querySelector(".status-progress-fill");

    let successCount = 0;
    for (let i = 0; i < modifiedPhrases.length; i++) {
        const text = modifiedPhrases[i];

        const percentage = (i / modifiedPhrases.length) * 100;
        if (statusLabel) statusLabel.textContent = `修正セリフ生成中: ${successCount}/${modifiedPhrases.length}`;
        if (statusFill) statusFill.style.width = percentage + "%";

        // キャッシュをクリア（修正済みは再生成）
        if (db && text) {
            await new Promise((resolve) => {
                const tx = db.transaction(STORE_NAME, "readwrite");
                const store = tx.objectStore(STORE_NAME);
                store.delete(text);
                tx.oncomplete = () => resolve();
            });
        }

        const success = await speakGemini(text, true);
        if (success) {
            successCount++;
            const newPercentage = (successCount / modifiedPhrases.length) * 100;
            if (statusLabel) statusLabel.textContent = `修正セリフ生成中: ${successCount}/${modifiedPhrases.length}`;
            if (statusFill) statusFill.style.width = newPercentage + "%";
        } else {
            if (statusLabel) statusLabel.textContent = "⚠ 通信エラーで中断しました";
            if (statusFill) statusFill.style.width = "0%";
            setTimeout(() => { statusRoot.style.display = "none"; }, 5000);
            return;
        }

        await new Promise(r => setTimeout(r, 600));
    }

    if (statusLabel) statusLabel.textContent = "✓ 修正セリフの音声生成完了";
    if (statusFill) statusFill.style.width = "100%";
    modifiedPhraseSet.clear();
    setTimeout(() => { statusRoot.style.display = "none"; }, 3000);
}

settingsBtn.addEventListener("click", () => {
    apiKeyInput.value = GEMINI_API_KEY;
    if (mouseLeftInput) mouseLeftInput.value = mouseClickSpeech.left;
    if (mouseMiddleInput) mouseMiddleInput.value = mouseClickSpeech.middle;
    if (mouseRightInput) mouseRightInput.value = mouseClickSpeech.right;
    
    settingsModal.classList.add("active");
    
    // Setup tabs if not already done
    if (!settingsModal.dataset.tabsSetup) {
        setupTabSystem();
        settingsModal.dataset.tabsSetup = "true";
    }
});

closeSettingsBtn.addEventListener("click", () => {
    settingsModal.classList.remove("active");
});

const prefetchModifiedBtn = document.getElementById("prefetch-modified-btn");
const resetPhrasesBtn = document.getElementById("reset-phrases-btn");

if (prefetchModifiedBtn) {
    prefetchModifiedBtn.addEventListener("click", prefetchModifiedAudio);
}

if (resetPhrasesBtn) {
    resetPhrasesBtn.addEventListener("click", async () => {
        if (!confirm("セリフ編集の内容を初期状態に戻しますか？")) return;

        localStorage.removeItem(RUNTIME_HIERARCHY_KEY);
        modifiedPhraseSet.clear();
        phraseEditorUiState.query = "";
        phraseEditorUiState.openL1.clear();
        phraseEditorUiState.openL2.clear();
        const searchInput = document.getElementById("phrase-search-input");
        if (searchInput) searchInput.value = "";
        await loadHierarchy();
        renderPhraseEditor();
        alert("初期状態に戻しました");
    });
}

saveSettingsBtn.addEventListener("click", async () => {
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

    persistHierarchyToBrowser();

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
