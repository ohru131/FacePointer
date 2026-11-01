// パネルのボタンを作り、文字を枠に収める
import { getGeneratedIcon, resolveIconPath } from "../ui/icons.js";
import { SIMPLE_ROW_ID, updateSideNextClearance } from "./screen.js";

function fitButtonText(btn, label) {
    // よく話す文の候補は長いので折り返して表示する
    if (btn.classList.contains("talk-panel--phrase")) {
        label.style.whiteSpace = "normal";
        label.style.fontSize = "";
        return;
    }
    label.style.whiteSpace = "nowrap";
    label.style.fontSize = "";
    const maxWidth = btn.clientWidth - 16;
    if (maxWidth <= 0) return;
    let fontSize = parseFloat(getComputedStyle(label).fontSize);
    let guard = 0;
    // 元仕様: 横幅超過のみを条件に 1px ずつ縮小
    while (label.scrollWidth > maxWidth && fontSize > 8 && guard < 60) {
        fontSize -= 1;
        label.style.fontSize = `${fontSize}px`;
        guard += 1;
    }
}

export function refitAllButtonText() {
    document.querySelectorAll(".h-btn").forEach((btn) => {
        const label = btn.querySelector(".h-btn-text");
        if (label) fitButtonText(btn, label);
    });
}

let refitResizeTimer = null;

export function createSimpleButton(id, label, options = {}) {
    const { icon = "", emoji = "", className = "", onClick = null } = options;
    const image = options.image || getGeneratedIcon(id, icon);
    const btn = document.createElement("div");
    btn.className = `h-btn ${className}`.trim();
    btn.dataset.row = SIMPLE_ROW_ID;
    btn.dataset.name = id;

    if (image || icon) {
        const img = document.createElement("img");
        img.className = "h-btn-icon";
        if (image) {
            img.src = image;
        } else {
            const styledIconPath = resolveIconPath(icon);
            img.src = styledIconPath;
            if (styledIconPath !== icon) {
                img.onerror = () => {
                    img.onerror = null;
                    img.src = icon;
                };
            }
        }
        btn.appendChild(img);
    } else if (emoji) {
        const emojiEl = document.createElement("div");
        emojiEl.className = "h-btn-emoji";
        emojiEl.textContent = emoji;
        btn.appendChild(emojiEl);
    }

    const text = document.createElement("div");
    text.className = "h-btn-text";
    text.innerText = label;
    btn.appendChild(text);

    if (onClick) btn.addEventListener("click", onClick);
    return btn;
}

export function initPanelButton() {
    window.addEventListener("resize", () => {
        clearTimeout(refitResizeTimer);
        refitResizeTimer = setTimeout(() => {
            refitAllButtonText();
            updateSideNextClearance();
        }, 120);
    });
}
