// パネルの位置から、ポインタの動ける範囲と正面の位置を決める
import { simplePanelContainer } from "../core/dom.js";
import { clamp } from "../core/math.js";
import { POINTER_MODE_ABSOLUTE, VERTICAL_MIN_TRAVEL_PX, pointerConfig } from "./config.js";
import { tracking } from "./tracking.js";

// グリッド全体の各パネル中央の範囲でポインタを動かす
export function getSimplePanelPointerBounds() {
    if (!simplePanelContainer) return null;

    const buttons = Array.from(simplePanelContainer.querySelectorAll(".h-btn:not(.h-btn--empty)"));
    const rects = buttons.map(btn => btn.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
    if (rects.length === 0) return null;

    const xs = rects.map(rect => rect.left + rect.width / 2);
    const ys = rects.map(rect => rect.top + rect.height / 2);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

// 上下移動の限界は上端/下端のパネル中央
export function getVerticalPointerBounds() {
    const bounds = getSimplePanelPointerBounds();
    if (!bounds || bounds.maxY - bounds.minY < VERTICAL_MIN_TRAVEL_PX) return null;
    return { minY: bounds.minY, maxY: bounds.maxY };
}

export function findNearestSimplePanel() {
    if (!simplePanelContainer) return null;

    let nearest = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const btn of simplePanelContainer.querySelectorAll(".h-btn:not(.h-btn--empty)")) {
        const rect = btn.getBoundingClientRect();
        const dx = Math.max(rect.left - tracking.pointerX, 0, tracking.pointerX - rect.right);
        const dy = Math.max(rect.top - tracking.pointerY, 0, tracking.pointerY - rect.bottom);
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
            bestDistance = distance;
            nearest = btn;
        }
    }
    return nearest;
}

export function findPanelAt(x, y) {
    if (!simplePanelContainer) return null;
    for (const btn of simplePanelContainer.querySelectorAll(".h-btn:not(.h-btn--empty)")) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return btn;
    }
    return null;
}

// 正面の位置（px）。絶対方式で○を向いて正面を登録していれば、その○の画面上の位置（範囲内に収める）。
// 感度は画面上の実際の距離で合わせているので、範囲の中央を正面にすると○の位置と中央の差だけ画面全体で向いた場所からずれる。
// 上下（左右）の範囲は不均等になってよい。それ以外は範囲の中央
export function getSimpleFrontPoint(bounds) {
    const front = pointerConfig.pointerMode === POINTER_MODE_ABSOLUTE ? pointerConfig.frontScreenPoint : null;
    if (!front) return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    return {
        x: clamp(front.x * window.innerWidth, bounds.minX, bounds.maxX),
        y: clamp(front.y * window.innerHeight, bounds.minY, bounds.maxY)
    };
}
