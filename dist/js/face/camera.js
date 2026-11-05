// 使うカメラを選んで映像を流す。自動なら USB などの外付けカメラを内蔵カメラより優先する
// （ノートPCの内蔵カメラは角度を変えられないため）。抜き差しにもついていく
import { video } from "../core/dom.js";

export const CAMERA_KEY = "camera_device_id"; // "" = 自動
const CAMERA_AUTO = "";
const VIDEO_SIZE = { width: { ideal: 1280 }, height: { ideal: 720 } };

// ラベルで見分ける（ブラウザは接続方式を教えてくれないので名前から推し量る）
const IR_RE = /\bIR\b|infrared|赤外線/i;
const BUILT_IN_RE = /integrated|built[- ]?in|内蔵|facetime|internal|front|user[- ]facing|usb2\.0 (?:f?hd|vga) ?uvc webcam/i;
const EXTERNAL_RE = /usb|logi|c[59]\d\d|brio|streamcam|elgato|razer|anker|lifecam|external|外付け/i;

let preferredId = localStorage.getItem(CAMERA_KEY) || CAMERA_AUTO;
let currentStream = null;
let currentDeviceId = "";
let currentLabel = "";
let cameraDevices = [];
let switchSeq = 0;
const listeners = new Set();

// 顔の検出に使えるカメラ（赤外線カメラは除く）
function usableCameras(devices) {
    return devices.filter(d => d.kind === "videoinput" && !IR_RE.test(d.label));
}

function scoreCamera(device, index) {
    let score = index * 0.01; // 同点なら後から見つかった（後から挿した）方
    if (BUILT_IN_RE.test(device.label)) score -= 2;
    else if (EXTERNAL_RE.test(device.label)) score += 2;
    return score;
}

// 自動で選ぶカメラ。内蔵と分かるものしか無ければその中の先頭
export function pickAutoCamera(devices) {
    const cameras = usableCameras(devices);
    if (cameras.length === 0) return null;
    return cameras.reduce((best, d, i) => (scoreCamera(d, i) > scoreCamera(best.d, best.i) ? { d, i } : best), { d: cameras[0], i: 0 }).d;
}

export function isBuiltInCameraLabel(label) {
    return BUILT_IN_RE.test(label);
}

async function refreshDevices() {
    try {
        cameraDevices = usableCameras(await navigator.mediaDevices.enumerateDevices());
    } catch (error) {
        console.warn("camera enumerate failed:", error);
        cameraDevices = [];
    }
    return cameraDevices;
}

function notify() {
    listeners.forEach(fn => fn());
}

// 設定画面の一覧と「使用中」の表示を更新するため
export function onCameraChange(fn) {
    listeners.add(fn);
}

export function getCameraState() {
    return { preferredId, currentDeviceId, currentLabel, devices: cameraDevices };
}

function targetDeviceId() {
    if (preferredId && cameraDevices.some(d => d.deviceId === preferredId)) return preferredId;
    return pickAutoCamera(cameraDevices)?.deviceId || "";
}

async function openStream(deviceId) {
    const constraints = { video: deviceId ? { ...VIDEO_SIZE, deviceId: { exact: deviceId } } : VIDEO_SIZE };
    try {
        return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
        if (!deviceId) throw error;
        // 選んだカメラが使えない（他のアプリが使用中など）ときは、どれかのカメラで続ける
        console.warn("camera open failed, falling back to default:", error);
        return navigator.mediaDevices.getUserMedia({ video: VIDEO_SIZE });
    }
}

async function switchTo(deviceId) {
    const seq = ++switchSeq;
    if (currentStream) currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
    const stream = await openStream(deviceId);
    if (seq !== switchSeq) {
        stream.getTracks().forEach(t => t.stop());
        return;
    }
    currentStream = stream;
    const track = stream.getVideoTracks()[0];
    currentDeviceId = track?.getSettings?.().deviceId || deviceId;
    currentLabel = track?.label || "";
    video.srcObject = stream;
    // 抜かれたら残りのカメラへ切り替える
    if (track) track.addEventListener("ended", () => { if (seq === switchSeq) void reconcileCamera(); });
    notify();
}

// 今のカメラが選ぶべきカメラと違えば切り替える
async function reconcileCamera() {
    await refreshDevices();
    const target = targetDeviceId();
    const isLive = currentStream?.getVideoTracks().some(t => t.readyState === "live");
    if (!isLive || (target && target !== currentDeviceId)) {
        await switchTo(target);
    } else {
        notify();
    }
}

export async function startCamera() {
    await refreshDevices();
    // 許可前はカメラの名前が分からない。保存したカメラか、とりあえず既定のカメラで開いてから選び直す
    const hasLabels = cameraDevices.some(d => d.label);
    await switchTo(hasLabels ? targetDeviceId() : (preferredId || ""));
    if (!hasLabels) await reconcileCamera();
    navigator.mediaDevices.addEventListener?.("devicechange", () => void reconcileCamera());
}

// 設定画面で選んだカメラ（"" = 自動）を保存して使う
export function setPreferredCamera(deviceId) {
    const next = deviceId || CAMERA_AUTO;
    if (next === preferredId) return;
    preferredId = next;
    if (next) localStorage.setItem(CAMERA_KEY, next);
    else localStorage.removeItem(CAMERA_KEY);
    void reconcileCamera();
}

export function refreshCameraList() {
    return refreshDevices().then(notify);
}
