// カメラと MediaPipe の準備と、毎フレームの処理
import vision from "../../mediapipe/vision_bundle.mjs";
import { canvasCtx, canvasElement, loadingOverlay, pointerElement, video } from "../core/dom.js";
import { clamp } from "../core/math.js";
import { isSettingsOpen } from "../core/app-state.js";
import { FOLLOW_TIME_CONSTANT_MS, POINTER_MODE_ABSOLUTE, isCalibrationDone, pointerConfig } from "../pointer/config.js";
import { targetX, targetY, tracking, updateRelativePointerTarget } from "../pointer/tracking.js";
import { updateTelemetryPanel } from "../pointer/telemetry.js";
import { checkPointerCollision, updateDwellSelection } from "../panels/selection.js";
import { checkQuestionTimeout } from "../question/screen.js";
import { drawMouthDetectionOverlay, isJawOpenVisualActive, updateGestureDetection } from "./gesture.js";
import { calibrationWizard } from "../calibration/wizard.js";
import { startFrontRecapture } from "../calibration/front.js";
import { openWelcome } from "../settings/welcome.js";

const { FaceLandmarker, FilesetResolver, DrawingUtils } = vision;

let faceLandmarker;
let lastVideoTime = -1;
let results = undefined;

export async function setupMediaPipe() {
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
        // キャリブレーションがまだなら、起動時の正面登録の代わりに案内を出す（顔が映る前でも出す）
        if (!isCalibrationDone()) {
            tracking.needsStartupFrontRegistration = false;
            openWelcome();
        }
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

let drawingUtils = null;
let lastRenderTimeMs = null;

async function predictWebcam() {
    // canvas のサイズ代入は毎回バッファを作り直すので、変化したときだけ行う
    if (canvasElement.width !== video.videoWidth) canvasElement.width = video.videoWidth;
    if (canvasElement.height !== video.videoHeight) canvasElement.height = video.videoHeight;
    const startTimeMs = performance.now();
    // rAF(60Hz) はカメラ(30fps前後)より速い。同じ推論結果で移動計算を二重に回さない
    let isNewFrame = false;
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        results = faceLandmarker.detectForVideo(video, startTimeMs);
        isNewFrame = true;
    }

    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    if (!drawingUtils) drawingUtils = new DrawingUtils(canvasCtx);
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
            if (isNewFrame && faceIndex === 0 && tracking.needsStartupFrontRegistration) {
                // 絶対方式は正面がずれると全体がずれるので、起動時に正面を登録する（10秒止まれなければ今の姿勢で始める）。
                // 設定画面を開いている間は待つ
                if (pointerConfig.pointerMode !== POINTER_MODE_ABSOLUTE || calibrationWizard.isActive()) {
                    tracking.needsStartupFrontRegistration = false;
                } else if (!isSettingsOpen()) {
                    tracking.needsStartupFrontRegistration = false;
                    startFrontRecapture();
                }
            }
            if (isNewFrame && faceIndex === 0 && calibrationWizard.isActive()) {
                calibrationWizard.onFrame(landmarks, results, startTimeMs);
            } else if (isNewFrame && !calibrationWizard.isActive() && !isSettingsOpen()) {
                // 設定画面を開いている間はポインタを動かさない
                updateRelativePointerTarget(nose.x, landmarks, results, faceIndex, startTimeMs);
            }
        }
    }

    // 目標位置への追従はフレームレートに依存しない指数平滑で行う
    const frameDtMs = lastRenderTimeMs === null ? 16.7 : clamp(startTimeMs - lastRenderTimeMs, 1, 100);
    lastRenderTimeMs = startTimeMs;
    const followAlpha = 1 - Math.exp(-frameDtMs / FOLLOW_TIME_CONSTANT_MS);
    if (!isSettingsOpen()) {
        tracking.pointerX += (targetX - tracking.pointerX) * followAlpha;
        tracking.pointerY += (targetY - tracking.pointerY) * followAlpha;
    }
    // left/top はレイアウトを毎フレーム走らせるので transform で動かす
    pointerElement.style.setProperty("--pointer-x", `${tracking.pointerX}px`);
    pointerElement.style.setProperty("--pointer-y", `${tracking.pointerY}px`);

    if (!hasFace) {
        tracking.debugDeltaN = 0;
        tracking.debugDeltaY = 0;
        tracking.debugPixN = 0;
        tracking.debugPixY = 0;
        tracking.debugDeltaX = 0;
        tracking.debugDeltaNoseY = 0;
        tracking.debugDeltaPitch = 0;
        tracking.debugDeltaYPx = 0;
        tracking.speedXEma = 0;
        tracking.speedYEma = 0;
        tracking.axisLockDominant = null;
    }
    updateTelemetryPanel(hasFace);
    if (!hasFace && calibrationWizard.isActive()) calibrationWizard.onNoFace();

    checkPointerCollision();
    // 設定画面を開いている間は確定・自動復帰をすべて止める
    const isSuspended = isSettingsOpen();
    document.body.classList.toggle("settings-open", isSuspended);
    updateDwellSelection(hasFace && !isSuspended);
    if (!isSuspended) checkQuestionTimeout();
    window.requestAnimationFrame(predictWebcam);
}
