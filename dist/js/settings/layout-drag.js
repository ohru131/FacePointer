// 設定画面のパネルのドラッグ（並べ替え・追加・外す）
import { getGeneratedIcon } from "../ui/icons.js";

let layoutDragId = null;
const LAYOUT_DRAG_TYPE = "text/plain";

export function createLayoutThumb(item, className = "layout-thumb") {
    const thumb = document.createElement("div");
    thumb.className = className;
    const src = item.image || getGeneratedIcon(item.iconId || item.id, item.icon) || item.icon;
    if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "";
        img.draggable = false;
        thumb.appendChild(img);
    } else if (item.emoji) {
        thumb.textContent = item.emoji;
    } else {
        thumb.classList.add("is-text");
    }
    return thumb;
}

export function bindLayoutDrag(el, id) {
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
        layoutDragId = id;
        e.dataTransfer.setData(LAYOUT_DRAG_TYPE, id);
        e.dataTransfer.effectAllowed = "move";
        el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => {
        layoutDragId = null;
        el.classList.remove("dragging");
        document.querySelectorAll(".drop-target, .drop-before, .drop-after").forEach(t => t.classList.remove("drop-target", "drop-before", "drop-after"));
    });
}

// sided: タイルの左半分なら前、右半分なら後ろへ入れる（onDrop の2番目の引数が true = 後ろ）
export function bindLayoutDrop(el, onDrop, { sided = false } = {}) {
    const isAfter = e => sided && e.clientX > el.getBoundingClientRect().left + (el.getBoundingClientRect().width / 2);
    const clearMarks = () => el.classList.remove("drop-target", "drop-before", "drop-after");
    el.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        el.classList.add("drop-target");
        if (sided) {
            const after = isAfter(e);
            el.classList.toggle("drop-after", after);
            el.classList.toggle("drop-before", !after);
        }
    });
    el.addEventListener("dragleave", clearMarks);
    el.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const after = isAfter(e);
        clearMarks();
        const id = e.dataTransfer.getData(LAYOUT_DRAG_TYPE) || layoutDragId;
        // 再描画でドラッグ元が消えると dragend が来ないことがあるので、ここで片付ける
        layoutDragId = null;
        if (id) onDrop(id, after);
    });
}
