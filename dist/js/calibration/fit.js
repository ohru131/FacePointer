// キャリブレーションの計測値から感度・揺れ・倍率を求める計算
import { clamp } from "../core/math.js";
import {
    CALIB_SIDE_KEYS, DISTANCE_EXPONENT_DEFAULT, NOSE_GAIN_MAX, PITCH_MIRROR_SIGN,
    SIDE_GAIN_ASYMMETRY_MAX, SIDE_GAIN_RATIO_KEYS, SIDE_GAIN_RATIO_LIMITS, VERTICAL_NOSE_SCALE_RATIO,
    VERTICAL_PITCH_SCALE_RATIO, YAW_MIRROR_SIGN, applySideGainRatios, pointerConfig
} from "../pointer/config.js";
import { extractHeadDistance, extractHeadPitchRadians, extractHeadYawRadians } from "../face/head-pose.js";
import {
    getAngleOffsetAcceleration, getDistanceRatioFor, getNoseDeadzone, getNoseScale, getYawDeadzone,
    getYawScale
} from "../pointer/tracking.js";
import { JAW_OPEN_THRESHOLD_GAIN, gesture } from "../face/gesture.js";
import {
    CALIB_DISTANCE_EXPONENT_MAX, CALIB_DISTANCE_EXPONENT_MIN, CALIB_HORIZONTAL_KEYS,
    CALIB_JAW_OPEN_POINT, CALIB_MIN_DISTANCE_SPREAD, CALIB_MIN_JAW_RANGE, CALIB_VERTICAL_KEYS
} from "./constants.js";
import { calibSettings } from "./wizard.js";

function meanOf(values) {
    if (values.length === 0) return NaN;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdOf(values) {
    if (values.length < 2) return 0;
    const mean = meanOf(values);
    return Math.sqrt(values.reduce((sum, v) => sum + ((v - mean) ** 2), 0) / (values.length - 1));
}

function percentileOf(values, ratio) {
    if (values.length === 0) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(ratio * (sorted.length - 1)))];
}

export function rangeOf(values) {
    if (values.length === 0) return 0;
    return Math.max(...values) - Math.min(...values);
}

function roundTo(value, step) {
    return Math.round(value / step) * step;
}

// 角度 from→to を動かしたときの加速込みの累積量（ランタイムの加速と同じ式）
function integrateAcceleratedAngle(from, to, neutral) {
    const steps = 60;
    const step = (to - from) / steps;
    let total = 0;
    for (let i = 0; i < steps; i += 1) {
        const mid = from + (step * (i + 0.5));
        total += Math.abs(step) * getAngleOffsetAcceleration(mid, neutral);
    }
    return total;
}

export function signedAcceleratedAngle(from, to, neutral) {
    return Math.sign(to - from) * integrateAcceleratedAngle(from, to, neutral);
}

// travel(g) が単調増加なので二分探索でゲインを求める
function solveGainForTravel(travelAt, requiredTravel) {
    let low = 0.5;
    let high = NOSE_GAIN_MAX;
    if (travelAt(high) < requiredTravel) return { gain: high, saturated: true };
    if (travelAt(low) >= requiredTravel) return { gain: low, saturated: false };
    for (let i = 0; i < 30; i += 1) {
        const mid = (low + high) / 2;
        if (travelAt(mid) < requiredTravel) low = mid;
        else high = mid;
    }
    return { gain: clamp(roundTo(high, 0.5), 0.5, NOSE_GAIN_MAX), saturated: false };
}

export function readCalibrationSample(landmarks, detectResults) {
    const nose = landmarks?.[4];
    if (!nose) return null;
    const yaw = extractHeadYawRadians(detectResults, 0);
    const pitch = extractHeadPitchRadians(detectResults, 0);
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
    const cats = detectResults?.faceBlendshapes?.[0]?.categories;
    const jaw = cats?.find(c => c.categoryName === "jawOpen")?.score ?? 0;
    const distance = extractHeadDistance(detectResults, 0) ?? NaN;
    return { noseX: 1 - nose.x, noseY: nose.y, yaw, pitch, jaw, distance };
}

export function averageSamples(samples) {
    const keys = ["noseX", "noseY", "yaw", "pitch", "jaw", "distance"];
    const summary = {};
    keys.forEach((key) => {
        summary[key] = meanOf(samples.map(sample => sample[key]).filter(Number.isFinite));
    });
    return summary;
}

function shrinkByDeadzone(delta, deadzone) {
    return Math.sign(delta) * Math.max(0, Math.abs(delta) - deadzone);
}

// ランタイムのバックラッシュは動き始めにデッドゾーン分を捨て、加速は anchor より deadzone 先の実際の角度で決まる
function backlashAcceleratedAngle(from, to, deadzone) {
    const delta = shrinkByDeadzone(to - from, deadzone);
    return signedAcceleratedAngle(from, from + delta, from - (Math.sign(delta) * deadzone));
}

// 正面(center)→sample の顔の動きが、ランタイムで何px の移動になるか（ランタイムの差分合成と同じ式）
// ゲイン 0 の経路はランタイム同様に無効
export function horizontalTravel(sample, center, gain, ratio, noise, yawG = gain) {
    const nose = gain > 0
        ? shrinkByDeadzone(sample.noseX - center.noseX, getNoseDeadzone(gain, noise.nose, noise.noiseOnly)) * getNoseScale(gain)
        : 0;
    const yaw = yawG > 0
        ? backlashAcceleratedAngle(center.yaw, sample.yaw, getYawDeadzone(yawG, noise.angle, noise.noiseOnly)) * YAW_MIRROR_SIGN * getYawScale(yawG)
        : 0;
    return (nose + yaw) * ratio;
}

export function verticalTravel(sample, center, gain, ratio, noise, yawG = gain) {
    const nose = gain > 0
        ? shrinkByDeadzone(sample.noseY - center.noseY, getNoseDeadzone(gain, noise.nose, noise.noiseOnly)) * getNoseScale(gain) * VERTICAL_NOSE_SCALE_RATIO
        : 0;
    const pitch = yawG > 0
        ? backlashAcceleratedAngle(center.pitch, sample.pitch, getYawDeadzone(yawG, noise.angle, noise.noiseOnly))
            * PITCH_MIRROR_SIGN * getYawScale(yawG) * VERTICAL_PITCH_SCALE_RATIO
        : 0;
    return (nose + pitch) * ratio;
}

function calibrationRatio(sample, model) {
    return model.ref > 0 ? getDistanceRatioFor(sample.distance, model.ref, model.exponent) : 1;
}

export function measureNoise(samples) {
    return {
        nose: clamp(Math.max(stdOf(samples.map(s => s.noseX)), stdOf(samples.map(s => s.noseY))), 0, 0.01),
        angle: clamp(Math.max(stdOf(samples.map(s => s.yaw)), stdOf(samples.map(s => s.pitch))), 0, 0.03),
        noiseOnly: true
    };
}

// ○までの距離の合計と、顔の動きから出る移動量（○の方向成分）の合計が一致するゲインを求める
export function fitCalibrationGain(entries, model) {
    const usable = entries.filter(e => CALIB_HORIZONTAL_KEYS.includes(e.key) && Math.abs(e.dx) > 1);
    if (usable.length === 0) return null;
    const required = usable.reduce((sum, e) => sum + Math.abs(e.dx), 0);
    const travelAt = g => usable.reduce((sum, e) => (
        sum + (Math.sign(e.dx) * horizontalTravel(e.sample, e.center, g, calibrationRatio(e.sample, model), model.noise))
    ), 0);
    // ○と逆向きに動いていた（または動いていない）場合は決められない
    if (travelAt(NOSE_GAIN_MAX) <= 0) return null;
    return solveGainForTravel(travelAt, required);
}

// sides（同じ軸の向き）の○で「○までの距離 / 顔の動きから出る移動量」を求める（丸め・制限なし）
function measureCalibrationRatio(entries, model, gain, sides) {
    const axis = CALIB_SIDE_KEYS[sides[0]];
    const usable = entries.filter(e => sides.includes(e.key) && Math.abs(e[axis]) > 1);
    if (usable.length === 0) return null;
    const travelOf = axis === "dx" ? horizontalTravel : verticalTravel;
    const required = usable.reduce((sum, e) => sum + Math.abs(e[axis]), 0);
    const travel = usable.reduce((sum, e) => (
        sum + (Math.sign(e[axis]) * travelOf(e.sample, e.center, gain, calibrationRatio(e.sample, model), model.noise))
    ), 0);
    return travel > 1 ? required / travel : null;
}

// 4方向の倍率を求める。各向きは○1〜2個で決まり、記録ミス1つで大きく外れるので、
// 同じ軸の両側を合算した倍率の 1/SIDE_GAIN_ASYMMETRY_MAX〜SIDE_GAIN_ASYMMETRY_MAX 倍に収める。
// 決められない向きは同じ軸の反対側の値、それも無ければ fallback を使う
export function fitCalibrationSideRatios(entries, model, gain, fallback) {
    const fitted = {};
    const limited = [];
    [["left", "right"], ["up", "down"]].forEach((pair) => {
        const single = pair.map(side => measureCalibrationRatio(entries, model, gain, [side]));
        // 片側が決められない（動かなかった・逆に動いた）ときは、その記録が合算を歪めるので制限しない
        const combined = single.every(value => value !== null) ? measureCalibrationRatio(entries, model, gain, pair) : null;
        pair.forEach((side, index) => {
            let value = single[index];
            if (value !== null && combined !== null) {
                const bounded = clamp(value, combined / SIDE_GAIN_ASYMMETRY_MAX, combined * SIDE_GAIN_ASYMMETRY_MAX);
                if (bounded !== value && !limited.includes(pair[0])) limited.push(pair[0]);
                value = bounded;
            }
            fitted[side] = value === null ? null : clamp(roundTo(value, 0.05), ...SIDE_GAIN_RATIO_LIMITS[side]);
        });
    });
    const opposite = { left: "right", right: "left", up: "down", down: "up" };
    const ratios = {};
    Object.keys(SIDE_GAIN_RATIO_KEYS).forEach((side) => {
        ratios[side] = fitted[side] ?? fitted[opposite[side]] ?? fallback[side];
    });
    return { ratios, fitted, limited };
}

// 距離補正なしで「必要な移動量 / 顔の動きから出る移動量」を求める。距離ごとのこの倍率の違いが距離補正の強さになる
function requiredMultiplier(entries, keys, axis, gain, noise) {
    const usable = entries.filter(e => keys.includes(e.key) && Math.abs(e[axis]) > 1);
    if (usable.length === 0) return NaN;
    const travelOf = axis === "dx" ? horizontalTravel : verticalTravel;
    const required = usable.reduce((sum, e) => sum + Math.abs(e[axis]), 0);
    const travel = usable.reduce((sum, e) => sum + (Math.sign(e[axis]) * travelOf(e.sample, e.center, gain, 1, noise)), 0);
    return travel > 1 ? required / travel : NaN;
}

function estimateDistanceExponent(nearEntries, farEntries, nearDistance, farDistance, gain, noise) {
    const spread = farDistance / nearDistance;
    if (!Number.isFinite(spread) || spread < CALIB_MIN_DISTANCE_SPREAD) return null;
    const estimates = [
        [CALIB_HORIZONTAL_KEYS, "dx"],
        [CALIB_VERTICAL_KEYS, "dy"]
    ].map(([keys, axis]) => {
        const near = requiredMultiplier(nearEntries, keys, axis, gain, noise);
        const far = requiredMultiplier(farEntries, keys, axis, gain, noise);
        return Math.log(far / near) / Math.log(spread);
    }).filter(Number.isFinite);
    if (estimates.length === 0) return null;
    return clamp(roundTo(meanOf(estimates), 0.05), CALIB_DISTANCE_EXPONENT_MIN, CALIB_DISTANCE_EXPONENT_MAX);
}

export function predictCalibrationOffset(sample, center, model) {
    const ratio = calibrationRatio(sample, model);
    return applySideGainRatios({
        x: horizontalTravel(sample, center, model.gain, ratio, model.noise),
        y: verticalTravel(sample, center, model.gain, ratio, model.noise)
    }, model.sideRatios);
}

export function computeCalibrationResult(captures, neutralSamples, mouthSamples) {
    const warnings = [];
    if (captures.some(e => e.forced)) {
        warnings.push("静止できないまま時間切れで記録した○があります。結果が合わない場合はやり直してください");
    }
    const nearEntries = captures.filter(e => e.pass === "near" && e.key !== "center");
    const farEntries = captures.filter(e => e.pass === "far" && e.key !== "center");
    const allEntries = [...nearEntries, ...farEntries];
    const nearCenter = captures.find(e => e.pass === "near" && e.key === "center")?.sample;
    const farCenter = captures.find(e => e.pass === "far" && e.key === "center")?.sample;
    // 静止時の揺れ → デッドゾーン下限（感度の計算もこのデッドゾーン込みで行う）
    const noise = measureNoise(neutralSamples);

    // 距離補正: 2回の距離で必要な倍率がどれだけ変わるかから指数を決める
    let exponent = DISTANCE_EXPONENT_DEFAULT;
    let ref = nearCenter?.distance > 0 ? nearCenter.distance : 0;
    let exponentMeasured = false;
    if (farCenter && farEntries.length > 0 && ref > 0 && farCenter.distance > 0) {
        const nearOnly = fitCalibrationGain(nearEntries, { ref: 0, exponent: 0, noise });
        const estimated = estimateDistanceExponent(nearEntries, farEntries, ref, farCenter.distance, nearOnly?.gain ?? pointerConfig.noseGain, noise);
        if (estimated === null) {
            warnings.push("2回の距離の差が小さいため、距離補正は標準の強さにしました");
        } else {
            exponent = estimated;
            exponentMeasured = true;
        }
        // 基準は2つの距離の中間（幾何平均）にして、どちらの距離でも補正量を小さく保つ
        ref = Math.sqrt(ref * farCenter.distance);
    } else if (!farCenter && calibSettings.isCalibFarPassEnabled) {
        warnings.push("離れた位置の計測を省略したため、距離補正は標準の強さにしました");
    }
    const model = { ref, exponent, noise, gain: pointerConfig.noseGain, sideRatios: { ...pointerConfig.sideGainRatios } };

    let gain = pointerConfig.noseGain;
    const solved = fitCalibrationGain(allEntries, model);
    if (!solved) {
        warnings.push("左右の動きが○の方向と合わないため、感度は変更しません");
    } else {
        gain = solved.gain;
        if (solved.saturated) warnings.push("左右の動きが小さいため、感度は最大にしました");
    }
    model.gain = gain;

    // 左右はゲインを決め直したら倍率 1 を基準にする。上下は決められなければ今の倍率のまま
    const fallback = {
        left: solved ? 1 : pointerConfig.sideGainRatios.left,
        right: solved ? 1 : pointerConfig.sideGainRatios.right,
        up: pointerConfig.sideGainRatios.up,
        down: pointerConfig.sideGainRatios.down
    };
    const { ratios: sideRatios, fitted, limited } = fitCalibrationSideRatios(allEntries, model, gain, fallback);
    const sideLabel = { left: "左", right: "右", up: "上", down: "下" };
    [["left", "right"], ["up", "down"]].forEach(([a, b]) => {
        if (fitted[a] === null && fitted[b] === null) {
            // 左右はゲインを決め直したときだけ標準に戻す（fallback と同じ条件）
            const isReset = a === "left" && solved;
            warnings.push(`${sideLabel[a]}${sideLabel[b]}の動きが○の方向と合わないため、${sideLabel[a]}${sideLabel[b]}の倍率は${isReset ? "標準（1.00）にしました" : "変更しません"}`);
            return;
        }
        [[a, b], [b, a]].forEach(([missing, used]) => {
            if (fitted[missing] === null) {
                warnings.push(`${sideLabel[missing]}の動きが○の方向と合わないため、${sideLabel[missing]}は${sideLabel[used]}と同じ倍率にしました`);
            }
        });
    });
    Object.entries(fitted).forEach(([side, value]) => {
        if (value === null) return;
        const [min, max] = SIDE_GAIN_RATIO_LIMITS[side];
        if (value <= min || value >= max) {
            warnings.push(`${sideLabel[side]}の倍率が上限・下限に達しました。○を向けていなかった場合はやり直してください`);
        }
    });
    limited.forEach((first) => {
        const pair = first === "left" ? "左右" : "上下";
        warnings.push(`${pair}の効きの差が大きいため、差を抑えました（${SIDE_GAIN_ASYMMETRY_MAX.toFixed(1)}倍まで）。○を向けていなかった場合はやり直してください`);
    });
    model.sideRatios = sideRatios;

    // 決めた値で各○をどれだけ正確に指せるか（距離ごと・向きごとの平均のずれ）
    const errorOf = entries => meanOf(entries.map((e) => {
        const predicted = predictCalibrationOffset(e.sample, e.center, model);
        return Math.hypot(predicted.x - e.dx, predicted.y - e.dy);
    }));
    const sideErrors = {};
    Object.keys(SIDE_GAIN_RATIO_KEYS).forEach((side) => {
        sideErrors[side] = errorOf(allEntries.filter(e => e.key === side));
    });

    // 口: 閉じ〜開きの中間より少し下を判定ラインにする
    const jawClosed = percentileOf(neutralSamples.map(s => s.jaw), 0.5);
    const jawOpen = percentileOf(mouthSamples.map(s => s.jaw), 0.9);
    let jawThreshold = gesture.jawOpenThreshold;
    const jawRange = jawOpen - jawClosed;
    if (!Number.isFinite(jawRange) || jawRange <= 0.02) {
        warnings.push("口の開きを検出できなかったため、口の閾値は変更しません");
    } else {
        jawThreshold = clamp(roundTo((jawRange * CALIB_JAW_OPEN_POINT) / JAW_OPEN_THRESHOLD_GAIN, 0.01), 0.02, 0.2);
        if (jawRange < CALIB_MIN_JAW_RANGE) warnings.push("口の開きが小さめです。判定しにくい場合は大きめに開けてください");
    }

    return {
        gain,
        yawGain: gain,
        sideRatios,
        noseNoise: noise.nose,
        angleNoise: noise.angle,
        jawThreshold,
        distanceRef: ref,
        distanceExponent: exponent,
        measured: {
            exponentMeasured,
            nearDistance: nearCenter?.distance ?? NaN,
            farDistance: farCenter?.distance ?? NaN,
            nearError: errorOf(nearEntries),
            farError: errorOf(farEntries),
            sideErrors,
            jawClosed,
            jawOpen
        },
        warnings
    };
}
