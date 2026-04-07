$BaseDir = "dist\mediapipe"
$WasmDir = "$BaseDir\wasm"
$ModelDir = "$BaseDir\model"

# Create directories if they don't exist
if (!(Test-Path $WasmDir)) { New-Item -ItemType Directory -Force -Path $WasmDir }
if (!(Test-Path $ModelDir)) { New-Item -ItemType Directory -Force -Path $ModelDir }

$Files = @(
    @{
        Url = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
        Out = "$ModelDir\face_landmarker.task"
    },
    @{
        Url = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm/vision_wasm_internal.wasm"
        Out = "$WasmDir\vision_wasm_internal.wasm"
    },
    @{
        Url = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm/vision_wasm_internal.js"
        Out = "$WasmDir\vision_wasm_internal.js"
    },
    @{
        Url = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm/vision_wasm_nosimd_internal.wasm"
        Out = "$WasmDir\vision_wasm_nosimd_internal.wasm"
    },
    @{
        Url = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/vision_bundle.mjs"
        Out = "$BaseDir\vision_bundle.mjs"
    },
    @{
        Url = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm/vision_wasm_nosimd_internal.js"
        Out = "$WasmDir\vision_wasm_nosimd_internal.js"
    }
)

foreach ($File in $Files) {
    Write-Host "Downloading $($File.Url) to $($File.Out)..."
    try {
        Invoke-WebRequest -Uri $File.Url -OutFile $File.Out -ErrorAction Stop
        Write-Host "Done." -ForegroundColor Green
    }
    catch {
        Write-Host "Failed to download $($File.Url): $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`nAll downloads finished. Please check the mediapipe folder." -ForegroundColor Cyan
