// ポインタの下のパネルを決め、滞留（止まって確定）を数える
import { dwellIndicator } from "../core/dom.js";
import { clamp } from "../core/math.js";
import { readStoredNumber } from "../core/storage.js";
import { pointerConfig } from "../pointer/config.js";
import { findNearestSimplePanel } from "../pointer/panel-geometry.js";
import { tracking } from "../pointer/tracking.js";
import { confirmState } from "./confirm.js";
import { SIMPLE_CTRL_REST, SIMPLE_ROW_ID, panelScreen } from "./screen.js";
import { logClickDebug } from "../face/click-debug.js";
import { gesture } from "../face/gesture.js";
import { calibrationWizard } from "../calibration/wizard.js";

const HOVER_SWITCH_HYSTERESIS_PX = 26;
let lastHoveredButtonKey = "";
// 滞留(dwell)選択: 同じパネル上でしばらく動かなければ確定する
export const DWELL_TIME_KEY = "dwell_time_ms";
export const DWELL_TIME_DEFAULT_MS = 1500;
export const DWELL_TIME_MAX_MS = 5000;
// この距離以上ポインタが動いたら「動いた」とみなして滞留をやり直す
const DWELL_MOVE_TOLERANCE_PX = 48;
// ジッタでパネル境界を一瞬外れても進捗を保つ猶予
const DWELL_LEAVE_GRACE_MS = 200;
// 一瞬通過しただけでインジケータが出ないよう、少し溜まってから表示する
const DWELL_INDICATOR_SHOW_RATIO = 0.08;
// 起動・モード切替直後は、最初にホバーしたパネルから一度外れるまで滞留しない
export const DWELL_LOCK_FIRST_HOVER = "*";
// お話の画面が入れ替わった直後にポインタの下にあるパネルは、外さなくても選べるが、意図せず選ばないよう長めに滞留させる
const DWELL_CARRYOVER_RATIO = 1.5;

// Dwell state
let dwellTargetKey = "";
let dwellStartAt = 0;
let dwellAnchorX = 0;
let dwellAnchorY = 0;
let dwellLeftAt = 0;

// 他のモジュールからも読み書きする状態
export const selection = {
    dwellTimeMs: readStoredNumber(DWELL_TIME_KEY, DWELL_TIME_DEFAULT_MS, 0, DWELL_TIME_MAX_MS), // 0 = 滞留確定OFF
    // 確定済みパネル。一度外れるまで再選択しない（TD Snap の Look away before reselecting 相当）
    dwellLockedKey: DWELL_LOCK_FIRST_HOVER,
    // DWELL_CARRYOVER_RATIO を掛けるパネル。DWELL_LOCK_FIRST_HOVER なら次の判定でポインタの下のパネルを記録する
    dwellCarryoverKey: ""
};
export let isDwellConfirmingCarryover = false;

export function checkPointerCollision() {
    const allBtns = document.querySelectorAll(".h-btn:not(.h-btn--empty)");
    let hoveredBtn = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let currentDistance = Number.POSITIVE_INFINITY;
    let currentHoveredBtn = null;

    allBtns.forEach(btn => {
        const rect = btn.getBoundingClientRect();
        const inside = tracking.pointerX >= rect.left && tracking.pointerX <= rect.right && tracking.pointerY >= rect.top && tracking.pointerY <= rect.bottom;
        if (inside) {
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dx = tracking.pointerX - cx;
            const dy = tracking.pointerY - cy;
            const dist = dx * dx + dy * dy;
            if (dist < bestDistance) {
                bestDistance = dist;
                hoveredBtn = btn;
            }

            const btnKey = `${btn.dataset.row}|${btn.dataset.name}`;
            if (btnKey === lastHoveredButtonKey) {
                currentDistance = dist;
                currentHoveredBtn = btn;
            }
        }
    });

    if (hoveredBtn && currentHoveredBtn) {
        const hysteresisSq = HOVER_SWITCH_HYSTERESIS_PX * HOVER_SWITCH_HYSTERESIS_PX;
        if (currentDistance <= bestDistance + hysteresisSq) {
            hoveredBtn = currentHoveredBtn;
        }
    }

    // パネル間の隙間も最寄りパネル扱いにし、選択が途切れないようにする
    if (!hoveredBtn) {
        hoveredBtn = findNearestSimplePanel();
    }

    // 付け外しを毎フレーム行うと CSS トランジションが始まり直して強調が見えないため、変化分だけ更新する
    allBtns.forEach(btn => {
        if (btn !== hoveredBtn && btn.classList.contains("hover")) btn.classList.remove("hover");
    });
    if (hoveredBtn) {
        if (!hoveredBtn.classList.contains("hover")) hoveredBtn.classList.add("hover");
        lastHoveredButtonKey = `${hoveredBtn.dataset.row}|${hoveredBtn.dataset.name}`;
    } else {
        lastHoveredButtonKey = "";
    }

    // ペンディングクリック中にターゲットから外れた場合はキャンセル
    if (gesture.pendingClickTimer && gesture.pendingClickTargetKey) {
        const currentKey = lastHoveredButtonKey;
        if (currentKey !== gesture.pendingClickTargetKey) {
            logClickDebug("click_canceled_pointer_leave", {
                currentKey,
                targetKey: gesture.pendingClickTargetKey
            });
            clearTimeout(gesture.pendingClickTimer);
            gesture.pendingClickTimer = null;
            gesture.pendingClickTargetKey = "";
            const animBtn = document.querySelector(".h-btn.clicked-anim");
            if (animBtn) animBtn.classList.remove("clicked-anim");
        }
    }
}
// 文をつなげる: ためられるパネルの上限（長すぎると聞き取りにくい）
// 休憩中に再開するときは誤操作を避けるため長めに滞留させる
const SIMPLE_RESUME_DWELL_RATIO = 2;
const SIMPLE_RESUME_DWELL_MIN_MS = 2000;

export function getSimpleRowKey(id) {
    return `${SIMPLE_ROW_ID}|${id}`;
}

export function lockSimpleKeyAfterConfirm(key) {
    // 口ジェスチャー・滞留のどちらで確定しても、外れるまで同じパネルは再選択しない
    selection.dwellLockedKey = key;
    resetDwellProgress();
}

export function resetDwellProgress() {
    if (dwellTargetKey) {
        const btn = document.querySelector(".h-btn.dwelling");
        if (btn) btn.classList.remove("dwelling");
    }
    dwellTargetKey = "";
    dwellStartAt = 0;
    dwellLeftAt = 0;
    if (dwellIndicator) {
        dwellIndicator.classList.remove("active");
        dwellIndicator.style.setProperty("--dwell-progress", "0");
    }
}

export function updateDwellSelection(hasFace) {
    if (selection.dwellTimeMs <= 0 || !hasFace || pointerConfig.isCalibrating
        || calibrationWizard.isActive() || confirmState.isConfirmInProgress || gesture.pendingClickTimer) {
        resetDwellProgress();
        return;
    }

    const now = performance.now();
    const restKey = getSimpleRowKey(SIMPLE_CTRL_REST);
    let hoveredKey = lastHoveredButtonKey;
    // 休憩中は再開パネル以外では滞留しない
    if (panelScreen.isSimplePaused && hoveredKey !== restKey) hoveredKey = "";
    // 押しても何も起きないボタン（ためた文が空の「話す」など）では滞留しない
    if (hoveredKey && document.querySelector(".h-btn.hover.is-disabled")) hoveredKey = "";

    if (selection.dwellLockedKey === DWELL_LOCK_FIRST_HOVER && hoveredKey) selection.dwellLockedKey = hoveredKey;
    if (selection.dwellLockedKey && selection.dwellLockedKey !== DWELL_LOCK_FIRST_HOVER && hoveredKey !== selection.dwellLockedKey) {
        selection.dwellLockedKey = "";
    }
    // 入れ替わり後に最初に判定したとき、ポインタの下にあったパネルだけを長めにする（外れたら通常に戻す）
    if (selection.dwellCarryoverKey === DWELL_LOCK_FIRST_HOVER) selection.dwellCarryoverKey = hoveredKey;
    if (selection.dwellCarryoverKey && hoveredKey !== selection.dwellCarryoverKey) selection.dwellCarryoverKey = "";

    if (!hoveredKey || hoveredKey === selection.dwellLockedKey) {
        // 境界のジッタで一瞬外れただけなら進捗を保持する
        if (dwellTargetKey && !hoveredKey && !panelScreen.isSimplePaused) {
            if (!dwellLeftAt) dwellLeftAt = now;
            if (now - dwellLeftAt < DWELL_LEAVE_GRACE_MS) return;
        }
        resetDwellProgress();
        return;
    }

    const movedFar = Math.hypot(tracking.pointerX - dwellAnchorX, tracking.pointerY - dwellAnchorY) > DWELL_MOVE_TOLERANCE_PX;
    if (hoveredKey !== dwellTargetKey || movedFar) {
        resetDwellProgress();
        dwellTargetKey = hoveredKey;
        dwellStartAt = now;
        dwellAnchorX = tracking.pointerX;
        dwellAnchorY = tracking.pointerY;
    }
    dwellLeftAt = 0;

    const targetBtn = document.querySelector(".h-btn.hover");
    if (!targetBtn) return;
    targetBtn.classList.add("dwelling");

    const baseMs = panelScreen.isSimplePaused
        ? Math.max(selection.dwellTimeMs * SIMPLE_RESUME_DWELL_RATIO, SIMPLE_RESUME_DWELL_MIN_MS)
        : selection.dwellTimeMs;
    const requiredMs = hoveredKey === selection.dwellCarryoverKey ? baseMs * DWELL_CARRYOVER_RATIO : baseMs;
    const progress = clamp((now - dwellStartAt) / requiredMs, 0, 1);
    if (dwellIndicator) {
        dwellIndicator.style.setProperty("--dwell-x", `${tracking.pointerX}px`);
        dwellIndicator.style.setProperty("--dwell-y", `${tracking.pointerY}px`);
        dwellIndicator.style.setProperty("--dwell-progress", progress.toFixed(3));
        dwellIndicator.classList.toggle("active", progress >= DWELL_INDICATOR_SHOW_RATIO);
    }

    if (progress >= 1) {
        resetDwellProgress();
        selection.dwellLockedKey = hoveredKey;
        gesture.lastConfirmedAt = Date.now();
        // 長めの滞留で確定したことを、クリック処理中の refreshTalkScreen に伝える
        isDwellConfirmingCarryover = hoveredKey === selection.dwellCarryoverKey;
        try {
            targetBtn.click();
        } finally {
            isDwellConfirmingCarryover = false;
        }
    }
}

// 休憩中は口ジェスチャーでも再開パネル以外を確定しない
export function isSimpleClickBlocked(targetKey) {
    return panelScreen.isSimplePaused && targetKey !== getSimpleRowKey(SIMPLE_CTRL_REST);
}
