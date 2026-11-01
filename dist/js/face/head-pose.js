// 顔の変換行列・ランドマークから、頭の向き・距離を取り出す

function toMatrixArray(matrixLike) {
    if (!matrixLike) return null;

    if (Array.isArray(matrixLike) && matrixLike.length === 16) {
        return matrixLike;
    }

    if (matrixLike.data && matrixLike.data.length === 16) {
        return Array.from(matrixLike.data);
    }

    if (typeof matrixLike.getDataList === "function") {
        const data = matrixLike.getDataList();
        if (data && data.length === 16) return Array.from(data);
    }

    if (matrixLike.matrix && matrixLike.matrix.length === 16) {
        return Array.from(matrixLike.matrix);
    }

    return null;
}

// 4x4 の並び順を平行移動成分の位置から判定する（row-major は末尾行が 0,0,0,1）
function isRowMajorMatrix(m) {
    const rowMajorTail = Math.abs(m[12]) + Math.abs(m[13]) + Math.abs(m[14]);
    const columnMajorTail = Math.abs(m[3]) + Math.abs(m[7]) + Math.abs(m[11]);
    return rowMajorTail <= columnMajorTail;
}

// 顔の正面方向（顔モデルの +z 軸 = 回転行列の第3列）のカメラ座標。カメラを向いているとき z > 0
function extractHeadForward(detectResults, faceIndex = 0) {
    const matrices = detectResults?.facialTransformationMatrixes;
    if (!matrices || matrices.length <= faceIndex) return null;

    const m = toMatrixArray(matrices[faceIndex]);
    if (!m || m.length !== 16) return null;

    const rowMajor = isRowMajorMatrix(m);
    const at = (row, col) => (rowMajor ? m[(row * 4) + col] : m[(col * 4) + row]);
    const forward = { x: at(0, 2), y: at(1, 2), z: at(2, 2), rowMajor };
    if (![forward.x, forward.y, forward.z].every(Number.isFinite) || forward.z <= 1e-3) return null;
    return forward;
}

// yaw / pitch は「顔の正面方向の直線が画面（カメラ正面の平面）に当たる点」の横・縦の角度（x/z, y/z の atan）。
// Euler 角は上を向いたまま左右に回すと pitch が cos(yaw) 倍に縮み、ポインタが端で下がる円弧になる。
// 画面との交点なら、顔自身の縦軸・横軸まわりの回転（上を向いたまま首の軸で左右に回すなど）は画面上の直線のまま、
// 首のかしげ（roll）にも影響されない。
// 正面付近（片方の角度が 0）では従来の Euler 角と同じ値になる
export function extractHeadYawRadians(detectResults, faceIndex = 0) {
    const f = extractHeadForward(detectResults, faceIndex);
    if (!f) return null;
    // 従来の atan2(m[2], m[0]) と同じ向き（column-major のときは符号が反転していた）に揃え、YAW_MIRROR_SIGN をそのまま使う
    return (f.rowMajor ? 1 : -1) * Math.atan2(f.x, f.z);
}

export function extractHeadPitchRadians(detectResults, faceIndex = 0) {
    const f = extractHeadForward(detectResults, faceIndex);
    if (!f) return null;
    // 顔が下を向くほど正
    return Math.atan2(-f.y, f.z);
}

// 顔の並進成分 z（カメラからの距離。単位は概ね cm）。比率しか使わないので絶対値の精度は問わない
export function extractHeadDistance(detectResults, faceIndex = 0) {
    const matrices = detectResults?.facialTransformationMatrixes;
    if (!matrices || matrices.length <= faceIndex) return null;

    const m = toMatrixArray(matrices[faceIndex]);
    if (!m || m.length !== 16) return null;

    const rowMajor = isRowMajorMatrix(m);
    const distance = Math.abs(rowMajor ? m[11] : m[14]);
    return Number.isFinite(distance) && distance > 1 ? distance : null;
}

export function getGazeEnhancedX(landmarks, noseX) {
    // 目線アシストは無効化し、鼻追従のみで制御する
    return noseX;
}
