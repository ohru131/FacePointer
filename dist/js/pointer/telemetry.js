// 設定画面に出すポインタの計測値
import { telemetryValues } from "../core/dom.js";
import { POINTER_MODE_ABSOLUTE, pointerConfig } from "./config.js";
import {
    absEdges, axisLockDominant, debugDeltaN, debugDeltaNoseY, debugDeltaPitch, debugDeltaX, debugDeltaY,
    debugDeltaYPx, debugDistanceRatio, debugPixN, debugPixY, debugRecenterDrift
} from "./tracking.js";
import { debugJawOpenThreshold, jawOpenFilteredScore } from "../face/gesture.js";

export function formatMetric(value, digits = 3) {
    if (!Number.isFinite(value)) return "-";
    return Number(value).toFixed(digits);
}

export function updateTelemetryPanel(hasFace) {
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
        `口(実/閾): ${f3(jawOpenFilteredScore)}/${f3(debugJawOpenThreshold)}`,
        `距離比: ${pointerConfig.isDistanceCompEnabled ? f2(debugDistanceRatio) : "補正OFF"}`,
        `方式: ${pointerConfig.pointerMode === POINTER_MODE_ABSOLUTE ? "絶対（正面固定）" : "相対"}`,
        pointerConfig.pointerMode === POINTER_MODE_ABSOLUTE
            ? `一時的な端px(左/右/上/下): ${["left", "right", "up", "down"].map(k => (absEdges[k] === null ? "-" : absEdges[k].toFixed(0))).join("/")}`
            : `中央補正ずれpx: ${pointerConfig.isRecenterEnabled ? f2(debugRecenterDrift) : "OFF"}`
    ];

    lines.push(`鼻縦Δ: ${f3(debugDeltaNoseY)}`);
    lines.push(`上下向きΔ: ${f3(debugDeltaPitch)}`);
    lines.push(`縦移動px: ${f2(debugDeltaYPx)}`);
    lines.push(`軸ロック: ${axisLockDominant === "x" ? "横優先" : axisLockDominant === "y" ? "縦優先" : "なし"}`);

    telemetryValues.textContent = lines.join("\n");
}
