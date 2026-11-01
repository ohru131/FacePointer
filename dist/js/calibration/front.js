// 正面の取り直し
import { pointerConfig } from "../pointer/config.js";
import {
    centerPointerOnSimpleGrid, clearPostureHint, resetPointerMotionHistory, setSessionDistanceRef
} from "../pointer/tracking.js";
import { speak } from "../speech/speak.js";
import { calibrationWizard } from "./wizard.js";

// 姿勢が変わったときに、キャリブレーション結果（感度・揺れ・距離補正）は残したまま正面だけ取り直す。
// キャリブレーション画面の正面登録と同じく、中央の○を向いて静止したら登録する
export function startFrontRecapture() {
    if (calibrationWizard.isActive()) return;
    calibrationWizard.start({ frontOnly: true });
}

// sample があれば（キャリブレーション画面の静止中の平均）それを正面にし、無ければ次のフレームの姿勢を正面にする。
// screenPoint は sample のときに向いていた画面上の位置（画面に対する割合）
export function recaptureFrontPose(sample = null, screenPoint = null) {
    clearPostureHint();
    resetPointerMotionHistory();
    if (sample && [sample.noseX, sample.noseY, sample.yaw, sample.pitch].every(Number.isFinite)) {
        // sample.noseX はランタイムと同じ鏡像座標（1 - nose.x）
        pointerConfig.calibratedNoseX = sample.noseX;
        pointerConfig.calibratedNoseY = sample.noseY;
        pointerConfig.calibratedYaw = sample.yaw;
        pointerConfig.calibratedPitch = sample.pitch;
        if (Number.isFinite(sample.distance)) setSessionDistanceRef(sample.distance);
        pointerConfig.frontScreenPoint = screenPoint;
        // 起動時の校正待ち（isCalibrating）が残っていると、次のフレームの姿勢で上書きされるので解除する
        pointerConfig.isCalibrating = false;
        speak("完了");
    } else {
        pointerConfig.frontScreenPoint = null;
        pointerConfig.isCalibrating = true;
    }
    // 取り直した正面の位置へポインタを置き直す
    centerPointerOnSimpleGrid();
}
