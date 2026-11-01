// 1画面に並べるパネルの数（グリッドの大きさ）
import { appState, isQuestionMode } from "../core/app-state.js";
import { SIMPLE_GRID_SIZES, SIMPLE_GRID_SIZE_DEFAULT, panelStore } from "./catalog.js";
import { getTalkPanels, repeatTalkSayPanel } from "../talk/screen.js";
import { questionStore } from "../question/model.js";

// 表示するパネルとグリッド。質問中は回答数に合わせて大きく並べる（設定のグリッドより細かくはしない）
export function getSimpleLayout() {
    const userSize = SIMPLE_GRID_SIZES[panelStore.simpleConfig.gridSize] || SIMPLE_GRID_SIZES[SIMPLE_GRID_SIZE_DEFAULT];
    let panels;
    if (appState.activeQuestion) {
        const { cols, rows } = getQuestionGridSize(appState.activeQuestion.answers.length);
        return { cols, rows, panels: appState.activeQuestion.answers };
    } else if (isQuestionMode()) {
        return { ...userSize, panels: [] };
    } else {
        panels = getTalkPanels();
    }

    const { cols, rows } = getAutoGridSize(panels.length, userSize);
    return { cols, rows, panels: repeatTalkSayPanel(panels, cols * rows) };
}

// 質問の回答パネルのグリッド。枚数に合わせて自動（質問タブの「1画面のパネルの数」まで）
export function getQuestionGridSize(n, gridSize = questionStore.questionConfig.gridSize) {
    const max = SIMPLE_GRID_SIZES[gridSize] || SIMPLE_GRID_SIZES[SIMPLE_GRID_SIZE_DEFAULT];
    return getAutoGridSize(n, max);
}

// 枚数に合わせたグリッド（少ないほど大きく並べる。設定のグリッドより細かくはしない）
function getAutoGridSize(n, userSize) {
    const auto = n <= 3 ? { cols: Math.max(1, n), rows: 1 }
        : n <= 4 ? { cols: 2, rows: 2 }
        : n <= 6 ? { cols: 3, rows: 2 }
        : n <= 9 ? { cols: 3, rows: 3 }
        : n <= 12 ? { cols: 4, rows: 3 }
        : { cols: 4, rows: 4 };
    // 入りきらなければ設定のグリッドのまま（3×1 で答え4つなら 2×1 ではなく 3×1 にしてページ送り）
    if (auto.cols <= userSize.cols && auto.rows <= userSize.rows) return auto;
    return { cols: userSize.cols, rows: userSize.rows };
}
