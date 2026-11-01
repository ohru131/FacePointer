// 数値の小さな道具（範囲に収める・平滑化フィルタ・統計）
import { EURO_DERIVATIVE_CUTOFF } from "../pointer/config.js";

export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function lowPassFilter(previous, next, alpha) {
    if (previous === null || Number.isNaN(previous)) return next;
    return (previous * (1 - alpha)) + (next * alpha);
}

// One Euro Filter (Casiez et al. 2012): 速度に応じてカットオフ周波数を変える低域通過フィルタ
function smoothingAlpha(cutoffHz, dtSec) {
    const tau = 1 / (2 * Math.PI * cutoffHz);
    return 1 / (1 + (tau / dtSec));
}

export class OneEuroFilter {
    constructor(minCutoff, beta, dCutoff = EURO_DERIVATIVE_CUTOFF) {
        this.minCutoff = minCutoff;
        this.beta = beta;
        this.dCutoff = dCutoff;
        this.reset();
    }

    reset() {
        this.value = null;
        this.derivative = 0;
        this.lastTimeMs = null;
    }

    filter(next, timeMs) {
        if (this.value === null || this.lastTimeMs === null) {
            this.value = next;
            this.derivative = 0;
            this.lastTimeMs = timeMs;
            return next;
        }

        // カメラのフレーム間隔は 1/120〜1/5 秒の範囲に収める（タブ復帰時の長い空白対策）
        const dtSec = clamp((timeMs - this.lastTimeMs) / 1000, 1 / 120, 0.2);
        this.lastTimeMs = timeMs;

        const rawDerivative = (next - this.value) / dtSec;
        this.derivative = lowPassFilter(this.derivative, rawDerivative, smoothingAlpha(this.dCutoff, dtSec));
        const cutoff = this.minCutoff + (this.beta * Math.abs(this.derivative));
        this.value = lowPassFilter(this.value, next, smoothingAlpha(cutoff, dtSec));
        return this.value;
    }
}

export function medianOfNumbers(values) {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}
