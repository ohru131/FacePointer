// 設定画面: 使うカメラ（自動 = 外付けを優先 / 手動で選ぶ）
import { cameraSelect, cameraStatus, settingsModal } from "../core/dom.js";
import {
    getCameraState, isBuiltInCameraLabel, onCameraChange, pickAutoCamera, refreshCameraList, setPreferredCamera
} from "../face/camera.js";

function cameraName(device, index) {
    const name = device.label || `カメラ ${index + 1}`;
    return isBuiltInCameraLabel(device.label) ? `${name}（内蔵）` : name;
}

function renderCameraOptions(selected) {
    if (!cameraSelect) return;
    const { devices, currentDeviceId, currentLabel } = getCameraState();
    const auto = pickAutoCamera(devices);
    cameraSelect.innerHTML = "";
    const addOption = (value, label) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        cameraSelect.appendChild(opt);
    };
    addOption("", `自動（外付けカメラを優先）${auto ? `: ${cameraName(auto, devices.indexOf(auto))}` : ""}`);
    devices.forEach((d, i) => addOption(d.deviceId, cameraName(d, i)));
    if (selected && !devices.some(d => d.deviceId === selected)) addOption(selected, "選んだカメラ（今は接続されていません）");
    cameraSelect.value = selected;
    if (cameraStatus) {
        const current = devices.find(d => d.deviceId === currentDeviceId);
        const name = current ? cameraName(current, devices.indexOf(current)) : currentLabel;
        cameraStatus.textContent = name ? `使用中: ${name}` : "カメラが見つかりません";
    }
}

// 設定を開いたとき
export function openCameraSettings() {
    renderCameraOptions(getCameraState().preferredId);
    void refreshCameraList();
}

// 「保存して閉じる」
export function saveCameraSettings() {
    if (cameraSelect) setPreferredCamera(cameraSelect.value);
}

export function initCameraSettings() {
    // 抜き差しや切り替えのたびに一覧を作り直す（設定を開いている間は選びかけの値を保つ）
    onCameraChange(() => {
        const isOpen = settingsModal?.classList.contains("active");
        renderCameraOptions(isOpen && cameraSelect ? cameraSelect.value : getCameraState().preferredId);
    });
}
