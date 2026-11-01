// パネルの絵の画風と、Gemini で作ったアイコンの引き当て
import { GENERATED_ICONS } from "../../icon-images.js";

export const ICON_STYLE_KEY = "icon_style";
const ICON_STYLE_DEFAULT = "simple";
const ICON_STYLE_COMIC = "comic";
const ICON_STYLE_COMIC2 = "comic2";

export function resolveIconPath(iconPath) {
    if (!iconPath || !iconPath.endsWith(".png")) return iconPath;
    // menu系は -cute 素材が未配置のため通常素材を使う
    if (iconSettings.iconStyle === "cute") {
        if (iconPath.startsWith("media/menu-")) return iconPath;
        return iconPath.replace(".png", "-cute.png");
    }
    if (iconSettings.iconStyle === ICON_STYLE_COMIC) return iconPath.replace(".png", "-comic.png");
    if (iconSettings.iconStyle === ICON_STYLE_COMIC2) return iconPath.replace(".png", "-comic2.png");
    return iconPath;
}

// 他のモジュールからも読み書きする状態
export const iconSettings = {
    iconStyle: localStorage.getItem(ICON_STYLE_KEY) || ICON_STYLE_DEFAULT
};

// 絵のない項目と、標準の画風でピクトグラムになる項目は、Gemini で作ったアイコン（scripts/gen_icon_sheets.mjs）があればそれを使う。
// ほかの画風には専用の素材があるので、icon のある項目はそちらを優先する
export function getGeneratedIcon(id, icon = "") {
    if (icon && iconSettings.iconStyle !== ICON_STYLE_DEFAULT) return "";
    return id && Object.hasOwn(GENERATED_ICONS, id) ? GENERATED_ICONS[id] : "";
}
