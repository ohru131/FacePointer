// キャリブレーション画面の進行
import { clamp } from "../core/math.js";
import {
    CALIB_SIDE_KEYS, NOSE_GAIN_DEFAULT, POINTER_MODE_ABSOLUTE, formatSideRatios, pointerConfig,
    saveCalibrationResult
} from "../pointer/config.js";
import { resetPointerMotionHistory } from "../pointer/tracking.js";
import { formatMetric } from "../pointer/telemetry.js";
import { playChime } from "../panels/sound.js";
import { lockUntilPointerLeaves } from "../panels/selection.js";
import { jawOpenThreshold, resetJawBaseline, saveJawOpenThreshold } from "../face/gesture.js";
import {
    CALIB_CAPTURE_GIVEUP_MS, CALIB_CENTER_HOLD_MS, CALIB_FAR_HOLD_MS, CALIB_FAR_MIN_RATIO,
    CALIB_FRONT_TIMEOUT_MS, CALIB_MATCH_SHOW_MS, CALIB_MIN_MOVE_ANGLE, CALIB_MIN_MOVE_NOSE,
    CALIB_MOVE_GIVEUP_MS, CALIB_PASSES, CALIB_PREPARE_MS, CALIB_RECORD_MS, CALIB_SAMPLE_AVERAGE_MS,
    CALIB_SAMPLE_BUFFER_MS, CALIB_SETTLE_MS, CALIB_STILL_ANGLE_RANGE, CALIB_STILL_NOSE_RANGE,
    CALIB_STILL_RELAX_AFTER_MS, CALIB_STILL_RELAX_FACTOR, CALIB_STILL_WINDOW_MS, CALIB_TARGETS,
    CALIB_TARGET_HOLD_IN_CIRCLE_MS, CALIB_TARGET_HOLD_MS, CALIB_TARGET_RADIUS_PX
} from "./constants.js";
import {
    averageSamples, computeCalibrationResult, fitCalibrationGain, fitCalibrationSideRatios, measureNoise,
    predictCalibrationOffset, rangeOf, readCalibrationSample
} from "./fit.js";
import { recaptureFrontPose } from "./front.js";
import { syncTuningSliders } from "../settings/pointer-settings.js";

// 「離れた位置」の計測を行うか（OFF ならいつもの位置だけで計測し、距離補正は標準の強さ）
const CALIB_FAR_PASS_KEY = "calib_far_pass_enabled";

export let isCalibFarPassEnabled = localStorage.getItem(CALIB_FAR_PASS_KEY) !== "0";

// 遠くでも測る段（距離補正の計測）を入れるか
export function saveCalibFarPass(enabled) {
    isCalibFarPassEnabled = enabled;
    localStorage.setItem(CALIB_FAR_PASS_KEY, enabled ? "1" : "0");
}

function buildCalibrationSteps() {
    const steps = [];
    const passes = isCalibFarPassEnabled ? CALIB_PASSES : CALIB_PASSES.filter(pass => pass.key !== "far");
    passes.forEach((pass, passIndex) => {
        if (passIndex > 0) steps.push({ type: "distance", pass: pass.key });
        CALIB_TARGETS.forEach((target) => steps.push({ type: "target", pass: pass.key, target }));
    });
    steps.push({ type: "mouth" });
    return steps;
}

export const calibrationWizard = (() => {
    const root = document.getElementById("calib-wizard");
    const stepCountEl = document.getElementById("calib-step-count");
    const arrowEl = document.getElementById("calib-arrow");
    const instructionEl = document.getElementById("calib-instruction-text");
    const subEl = document.getElementById("calib-sub");
    const progressBar = document.getElementById("calib-progress-bar");
    const resultEl = document.getElementById("calib-result");
    const targetEl = document.getElementById("calib-target");
    const cursorEl = document.getElementById("calib-cursor");
    const saveBtn = document.getElementById("calib-save-btn");
    const retryBtn = document.getElementById("calib-retry-btn");
    const closeBtn = document.getElementById("calib-close-btn");
    const cancelBtn = document.getElementById("calib-cancel-btn");
    const skipBtn = document.getElementById("calib-skip-btn");

    let active = false;
    let finished = false;
    let steps = [];
    let stepIndex = 0;
    let stepElapsedMs = 0;
    let holdMs = 0;
    let matchedElapsedMs = null;
    let lastFrameMs = null;
    let buffer = [];
    let captures = [];
    let neutralSamples = [];
    let mouthSamples = [];
    let model = null;
    let result = null;
    // 正面の登録だけを行うモード（正面取り直し）
    let frontOnly = false;

    const currentStep = () => steps[stepIndex];
    const topbarEl = document.getElementById("calib-topbar");
    // 低い画面でも上の○が指示バーに重ならないよう、バーの下端より下に置く
    const targetPx = target => ({
        x: target.x * window.innerWidth,
        y: Math.max(target.y * window.innerHeight, topbarEl.getBoundingClientRect().bottom + CALIB_TARGET_RADIUS_PX + 12)
    });
    const passOf = key => CALIB_PASSES.find(pass => pass.key === key);
    const passCenter = key => captures.find(e => e.pass === key && e.key === "center")?.sample ?? null;

    function setStep(index) {
        stepIndex = index;
        stepElapsedMs = 0;
        holdMs = 0;
        matchedElapsedMs = null;
        buffer = [];
        targetEl.classList.remove("matched");
        targetEl.style.setProperty("--calib-hold", "0");
        render(null);
    }

    function nextStep() {
        if (frontOnly) {
            // 正面は記録した時点で登録済み
            close();
            return;
        }
        if (stepIndex + 1 >= steps.length) {
            finish();
            return;
        }
        setStep(stepIndex + 1);
    }

    function skipFarPass() {
        const step = currentStep();
        if (!active || finished || !step || step.pass !== "far") return;
        captures = captures.filter(e => e.pass !== "far");
        setStep(steps.findIndex(s => s.type === "mouth"));
    }

    function isStill(nowMs, relax) {
        const recent = buffer.filter(entry => nowMs - entry.t <= CALIB_STILL_WINDOW_MS);
        if (recent.length < 3 || nowMs - buffer[0].t < CALIB_STILL_WINDOW_MS * 0.8) return false;
        const pick = key => recent.map(entry => entry.sample[key]);
        return Math.max(rangeOf(pick("yaw")), rangeOf(pick("pitch"))) <= CALIB_STILL_ANGLE_RANGE * relax
            && Math.max(rangeOf(pick("noseX")), rangeOf(pick("noseY"))) <= CALIB_STILL_NOSE_RANGE * relax;
    }

    function recentAverage(nowMs, windowMs) {
        return averageSamples(buffer.filter(entry => nowMs - entry.t <= windowMs).map(entry => entry.sample));
    }

    function hasMovedFrom(sample, center) {
        return Math.abs(sample.yaw - center.yaw) + Math.abs(sample.pitch - center.pitch) >= CALIB_MIN_MOVE_ANGLE
            || Math.abs(sample.noseX - center.noseX) + Math.abs(sample.noseY - center.noseY) >= CALIB_MIN_MOVE_NOSE;
    }

    // 記録済みの○から暫定の感度を決め直し、次の○で予測カーソルが合うようにする
    function refitModel() {
        const entries = captures.filter(e => e.key !== "center");
        const solved = fitCalibrationGain(entries, model);
        if (solved) model.gain = solved.gain;
        model.sideRatios = fitCalibrationSideRatios(entries, model, model.gain, model.sideRatios).ratios;
    }

    function predictCursor(sample) {
        const step = currentStep();
        const center = passCenter(step.pass) ?? passCenter("near");
        if (!center) return null;
        const origin = targetPx(CALIB_TARGETS[0]);
        const offset = predictCalibrationOffset(sample, center, model);
        return {
            x: clamp(origin.x + offset.x, 0, window.innerWidth),
            y: clamp(origin.y + offset.y, 0, window.innerHeight)
        };
    }

    function capture(nowMs, forced = false) {
        const step = currentStep();
        const sample = recentAverage(nowMs, step.target.key === "center" ? CALIB_CENTER_HOLD_MS : CALIB_SAMPLE_AVERAGE_MS);
        if (step.target.key === "center") {
            if (step.pass === "near") {
                neutralSamples = buffer.filter(entry => nowMs - entry.t <= CALIB_CENTER_HOLD_MS).map(entry => entry.sample);
                model.noise = measureNoise(neutralSamples);
                if (Number.isFinite(sample.distance)) model.ref = sample.distance;
            }
            captures.push({ pass: step.pass, key: "center", sample, center: sample, dx: 0, dy: 0, forced });
        } else {
            const center = passCenter(step.pass);
            const origin = targetPx(CALIB_TARGETS[0]);
            const target = targetPx(step.target);
            captures.push({
                pass: step.pass,
                key: step.target.key,
                sample,
                center,
                dx: target.x - origin.x,
                dy: target.y - origin.y,
                forced
            });
            refitModel();
        }
        // 正面の登録だけのときは、静止中の平均をそのまま正面にする（表示の待ち時間の間に動いた姿勢を拾わない）
        if (frontOnly) {
            const pos = targetPx(step.target);
            recaptureFrontPose(sample, { x: pos.x / window.innerWidth, y: pos.y / window.innerHeight });
        }
        matchedElapsedMs = 0;
        targetEl.classList.add("matched");
        playChime();
    }

    function render(sample) {
        const step = currentStep();
        if (!step) return;
        const pass = step.pass ? passOf(step.pass) : null;
        stepCountEl.textContent = frontOnly
            ? "正面の登録"
            : `キャリブレーション ${stepIndex + 1} / ${steps.length}${pass ? `（${pass.label}）` : ""}`;
        skipBtn.hidden = step.pass !== "far";
        root.classList.toggle("is-target", step.type === "target");

        if (step.type === "target") {
            const pos = targetPx(step.target);
            targetEl.style.setProperty("--calib-x", `${pos.x}px`);
            targetEl.style.setProperty("--calib-y", `${pos.y}px`);
            const holdTarget = step.target.key === "center" ? CALIB_CENTER_HOLD_MS : CALIB_TARGET_HOLD_MS;
            targetEl.style.setProperty("--calib-hold", String(matchedElapsedMs !== null ? 1 : clamp(holdMs / holdTarget, 0, 1)));
            arrowEl.textContent = matchedElapsedMs !== null ? "✓" : "◎";
            instructionEl.textContent = matchedElapsedMs !== null
                ? "一致しました"
                : `${step.target.label}の ○ に顔の正面を向けて 止めてください`;
            if (matchedElapsedMs === null) {
                subEl.textContent = frontOnly
                    ? "楽な姿勢で。この ○ を向いた向きが正面になります"
                    : step.target.key === "center"
                    ? `${pass.sub}、楽な姿勢で`
                    : "薄い点が ○ の中に入るように。合わなくても ○ を向いて止まれば記録します";
            }
            progressBar.classList.remove("is-prepare");
            progressBar.style.width = `${(stepIndex / steps.length) * 100}%`;

            const cursor = sample ? predictCursor(sample) : null;
            cursorEl.classList.toggle("visible", cursor !== null);
            if (cursor) {
                cursorEl.style.setProperty("--calib-x", `${cursor.x}px`);
                cursorEl.style.setProperty("--calib-y", `${cursor.y}px`);
            }
            return;
        }

        cursorEl.classList.remove("visible");
        if (step.type === "distance") {
            const near = passCenter("near");
            const ratio = sample && near ? sample.distance / near.distance : NaN;
            arrowEl.textContent = "↕";
            instructionEl.textContent = "画面から少し離れて 止めてください";
            subEl.textContent = Number.isFinite(ratio)
                ? `いまの距離: 近い位置の ${ratio.toFixed(2)} 倍（${CALIB_FAR_MIN_RATIO.toFixed(2)} 倍以上で開始）`
                : "離れられない場合は「省略」を押してください";
            progressBar.classList.add("is-prepare");
            progressBar.style.width = `${Number.isFinite(ratio) ? clamp((ratio - 1) / (CALIB_FAR_MIN_RATIO - 1), 0, 1) * 100 : 0}%`;
            return;
        }

        const isPreparing = stepElapsedMs < CALIB_PREPARE_MS;
        arrowEl.textContent = "😮";
        instructionEl.textContent = "口を大きく開けて 止めてください";
        subEl.textContent = isPreparing ? "準備… クリックと同じ開け方で" : "そのまま止めてください";
        const ratio = isPreparing
            ? stepElapsedMs / CALIB_PREPARE_MS
            : (stepElapsedMs - CALIB_PREPARE_MS) / CALIB_RECORD_MS;
        progressBar.classList.toggle("is-prepare", isPreparing);
        progressBar.style.width = `${clamp(ratio, 0, 1) * 100}%`;
    }

    function start(options = {}) {
        // 起動ボタンにフォーカスが残ると Space/Enter で計測中に再スタートしてしまう
        if (document.activeElement && typeof document.activeElement.blur === "function") {
            document.activeElement.blur();
        }
        active = true;
        finished = false;
        frontOnly = options.frontOnly === true;
        steps = frontOnly ? [{ type: "target", pass: "near", target: CALIB_TARGETS[0] }] : buildCalibrationSteps();
        lastFrameMs = null;
        captures = [];
        neutralSamples = [];
        mouthSamples = [];
        model = {
            ref: 0,
            exponent: pointerConfig.distanceExponent,
            noise: { nose: pointerConfig.noseNoise, angle: pointerConfig.angleNoise, noiseOnly: true },
            gain: pointerConfig.noseGain > 0 ? pointerConfig.noseGain : NOSE_GAIN_DEFAULT,
            sideRatios: { ...pointerConfig.sideGainRatios }
        };
        result = null;
        root.classList.remove("done");
        root.classList.add("active");
        document.body.classList.add("calib-active");
        setStep(0);
    }

    function close() {
        active = false;
        finished = false;
        // 計測中に見ていた位置のパネルが閉じた直後に滞留確定しないよう、一度外れるまで滞留しない
        lockUntilPointerLeaves();
        root.classList.remove("active", "done", "is-target");
        cursorEl.classList.remove("visible");
        document.body.classList.remove("calib-active");
        // 計測中はポインタ計算を止めていたので、履歴を捨てて急な飛びを防ぐ
        resetPointerMotionHistory();
    }

    function finish() {
        finished = true;
        result = computeCalibrationResult(captures, neutralSamples, mouthSamples);
        root.classList.remove("is-target");
        cursorEl.classList.remove("visible");
        stepCountEl.textContent = "キャリブレーション結果";
        arrowEl.textContent = "✓";
        instructionEl.textContent = "計測が終わりました";
        subEl.textContent = "保存すると下の値に切り替わります";
        skipBtn.hidden = true;
        const m = result.measured;
        const px = value => (Number.isFinite(value) ? `${Math.round(value)}px` : "-");
        const lines = [
            `感度（鼻位置・顔の傾き）: ${pointerConfig.noseGain.toFixed(1)} / ${pointerConfig.yawGain.toFixed(1)} → ${result.gain.toFixed(1)} / ${result.yawGain.toFixed(1)}`,
            `向きごとの倍率（左/右/上/下）: ${formatSideRatios(pointerConfig.sideGainRatios)} → ${formatSideRatios(result.sideRatios)}`,
            `距離補正の強さ: ${pointerConfig.distanceExponent.toFixed(2)} → ${result.distanceExponent.toFixed(2)}${m.exponentMeasured ? "（2つの距離で計測）" : "（標準）"}`,
            `口の開き閾値: ${jawOpenThreshold.toFixed(2)} → ${result.jawThreshold.toFixed(2)}`,
            `静止時の揺れ（鼻/角度）: ${formatMetric(result.noseNoise, 4)} / ${formatMetric(result.angleNoise, 4)}`,
            `○とのずれ（平均）: 近い位置 ${px(m.nearError)} / 離れた位置 ${px(m.farError)}`,
            `○とのずれ（左/右/上/下）: ${["left", "right", "up", "down"].map(side => px(m.sideErrors[side])).join(" / ")}`,
            `計測: 距離 ${formatMetric(m.nearDistance, 1)} → ${formatMetric(m.farDistance, 1)} / 口 ${formatMetric(m.jawClosed, 2)}→${formatMetric(m.jawOpen, 2)}`
        ];
        if (result.warnings.length > 0) {
            lines.push("", ...result.warnings.map(w => `⚠ ${w}`));
        }
        resultEl.textContent = lines.join("\n");
        root.classList.add("done");
    }

    function apply() {
        if (!result) return;
        saveCalibrationResult(result);
        saveJawOpenThreshold(result.jawThreshold);
        syncTuningSliders();
        close();
        resetJawBaseline();
        // 正面位置も今の姿勢で取り直す。絶対方式は正面がずれると全体がずれるので、○を向いて登録する
        // 登録できれば recaptureFrontPose が解除し、時間切れなら起動時と同じく次のフレームの姿勢を正面にする
        pointerConfig.isCalibrating = true;
        if (pointerConfig.pointerMode === POINTER_MODE_ABSOLUTE) start({ frontOnly: true });
    }

    function onTargetFrame(sample, timeMs, dt) {
        const step = currentStep();
        buffer.push({ t: timeMs, sample });
        buffer = buffer.filter(entry => timeMs - entry.t <= CALIB_SAMPLE_BUFFER_MS);

        if (matchedElapsedMs !== null) {
            matchedElapsedMs += dt;
            render(sample);
            if (matchedElapsedMs >= CALIB_MATCH_SHOW_MS) nextStep();
            return;
        }

        const isCenter = step.target.key === "center";
        const relax = stepElapsedMs > CALIB_STILL_RELAX_AFTER_MS ? CALIB_STILL_RELAX_FACTOR : 1;
        const center = passCenter(step.pass);
        const moved = isCenter || !center || hasMovedFrom(sample, center) || stepElapsedMs > CALIB_MOVE_GIVEUP_MS;
        const cursor = predictCursor(sample);
        const target = targetPx(step.target);
        const inCircle = cursor !== null && Math.hypot(cursor.x - target.x, cursor.y - target.y) <= CALIB_TARGET_RADIUS_PX;

        if (stepElapsedMs >= CALIB_SETTLE_MS && moved && isStill(timeMs, relax)) {
            holdMs += dt;
        } else {
            holdMs = 0;
        }

        // 上下の○は、予測カーソルが○に入っても短縮しない。予測には仮の倍率（上の○の倍率など）を使うので、
        // 向いている途中で○に入ると、動きの小さい記録から倍率が大きく出てしまう
        const allowQuickCapture = inCircle && CALIB_SIDE_KEYS[step.target.key] === "dx";
        const required = isCenter ? CALIB_CENTER_HOLD_MS : (allowQuickCapture ? CALIB_TARGET_HOLD_IN_CIRCLE_MS : CALIB_TARGET_HOLD_MS);
        cursorEl.classList.toggle("in-circle", inCircle);
        if (holdMs >= required) capture(timeMs);
        else if (frontOnly && stepElapsedMs >= CALIB_FRONT_TIMEOUT_MS) {
            // 止まれないまま時間が経ったら、元の正面のまま閉じる（誤って起動した場合もここで戻る）
            close();
            return;
        } else if (stepElapsedMs >= CALIB_CAPTURE_GIVEUP_MS) capture(timeMs, true);
        render(sample);
    }

    function onDistanceFrame(sample, dt) {
        const near = passCenter("near");
        if (!near || !Number.isFinite(near.distance) || !Number.isFinite(sample.distance)) {
            // 距離が取れない環境では離れた位置の計測を行わない
            skipFarPass();
            return;
        }
        buffer.push({ t: stepElapsedMs, sample });
        buffer = buffer.filter(entry => stepElapsedMs - entry.t <= CALIB_SAMPLE_BUFFER_MS);
        const farEnough = sample.distance / near.distance >= CALIB_FAR_MIN_RATIO;
        holdMs = farEnough && isStill(stepElapsedMs, CALIB_STILL_RELAX_FACTOR) ? holdMs + dt : 0;
        if (holdMs >= CALIB_FAR_HOLD_MS || (farEnough && stepElapsedMs >= CALIB_CAPTURE_GIVEUP_MS)) {
            nextStep();
            return;
        }
        render(sample);
    }

    function onMouthFrame(sample) {
        if (stepElapsedMs >= CALIB_PREPARE_MS) mouthSamples.push(sample);
        if (stepElapsedMs >= CALIB_PREPARE_MS + CALIB_RECORD_MS) {
            if (mouthSamples.length < 5) {
                // 顔が取れていなければこの手順をやり直す
                stepElapsedMs = 0;
                mouthSamples = [];
            } else {
                nextStep();
                return;
            }
        }
        render(sample);
    }

    function onFrame(landmarks, detectResults, timeMs) {
        if (!active || finished) return;

        const dt = lastFrameMs === null ? 0 : clamp(timeMs - lastFrameMs, 0, 100);
        lastFrameMs = timeMs;
        stepElapsedMs += dt;

        const sample = readCalibrationSample(landmarks, detectResults);
        if (!sample) return;
        const step = currentStep();
        if (step.type === "target") onTargetFrame(sample, timeMs, dt);
        else if (step.type === "distance") onDistanceFrame(sample, dt);
        else onMouthFrame(sample);
    }

    function onNoFace() {
        if (!active || finished) return;
        // 顔が見えない間は時間を進めず、静止判定もやり直す
        lastFrameMs = null;
        holdMs = 0;
        buffer = [];
        cursorEl.classList.remove("visible");
        subEl.textContent = "顔が見えません。カメラの方を向いてください";
    }

    saveBtn.addEventListener("click", apply);
    retryBtn.addEventListener("click", () => start());
    closeBtn.addEventListener("click", close);
    cancelBtn.addEventListener("click", close);
    skipBtn.addEventListener("click", skipFarPass);

    return {
        start,
        onFrame,
        onNoFace,
        isActive: () => active
    };
})();
