# Chạy mat-runtime bản x64 trong container toolchain để thử cục bộ (trước khi lên BL335).
# Dùng: ./deployment/toolchain/run-x64.ps1 [-Port 8080] [-Project projects/tank-demo] [-NoBuild]
# Dừng: docker stop mat-runtime-x64
# (Thông báo in ra không dấu: Windows PowerShell 5.1 đọc file .ps1 không BOM theo codepage ANSI.)
param(
    [int]$Port = 8080,
    [string]$Project = 'projects/tank-demo',
    [switch]$NoBuild
)
$root = Resolve-Path "$PSScriptRoot/../.."
docker build -q -t mat-armhf "$PSScriptRoot" | Out-Null
if ($LASTEXITCODE) { exit $LASTEXITCODE }
if (-not $NoBuild) {
    docker run --rm -v "${root}:/src" mat-armhf sh -c "cmake -S . -B build/x64 -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null && cmake --build build/x64 --target mat-runtime"
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
if (-not (Test-Path "$root/apps/runtime-web/dist-device/index.html")) {
    Write-Host 'Missing apps/runtime-web/dist-device: run `npm run build:web` first.' -ForegroundColor Yellow
    exit 1
}
docker rm -f mat-runtime-x64 2>$null | Out-Null
$Project = $Project.Replace('\', '/')
docker run -d --name mat-runtime-x64 -p "${Port}:8080" -v "${root}:/src:ro" mat-armhf `
    /src/build/x64/bin/mat-runtime --docroot /src/apps/runtime-web/dist-device `
    --project-dir "/src/$Project" --schemas-dir /src/schemas | Out-Null
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Start-Sleep -Milliseconds 800
docker logs mat-runtime-x64
Write-Host "mat-runtime x64: http://localhost:$Port/  (stop: docker stop mat-runtime-x64)" -ForegroundColor Green
