// 確定音
import { panelStore } from "./catalog.js";

let confirmSoundContext = null;

export function playConfirmSound() {
    if (!panelStore.simpleConfig.confirmSound) return;
    playChime();
}

export function playChime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!confirmSoundContext) confirmSoundContext = new AudioCtx();
        const ctx = confirmSoundContext;
        if (ctx.state === "suspended") void ctx.resume();

        // 短い2音の「ピポッ」
        const start = ctx.currentTime;
        [[880, 0], [1320, 0.09]].forEach(([freq, offset]) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, start + offset);
            gain.gain.exponentialRampToValueAtTime(0.25, start + offset + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.12);
            osc.connect(gain).connect(ctx.destination);
            osc.start(start + offset);
            osc.stop(start + offset + 0.13);
        });
    } catch (error) {
        console.warn("confirm sound failed:", error);
    }
}
