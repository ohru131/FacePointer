// localStorage から値を読む道具

export function readStoredNumber(key, fallback, min, max) {
    return readStoredNumberFromValue(localStorage.getItem(key), fallback, min, max);
}

export function readStoredNumberFromValue(raw, fallback, min, max) {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

export function readStoredList(key) {
    try {
        const list = JSON.parse(localStorage.getItem(key) || "[]");
        return Array.isArray(list) ? list.filter(m => m && typeof m.value === "string") : [];
    } catch (_) {
        return []; // 破損時は空
    }
}
