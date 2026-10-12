# Chạy mat-runtime bản x64 trong container toolchain để thử cục bộ (trước khi lên BL335).
# Dùng: ./deployment/toolchain/run-x64.ps1 [-Port 8080] [-HttpsPort 8443] [-Project projects/tank-demo]
#        [-DataDir /tmp/mat-data] [-UsersFile /tmp/mat-etc/users.json] [-NoDiscovery] [-NoBuild]
#        [-BuildDir C:\build\mat-x64-<tên>]
# - HTTP (trang xem) ở cổng -Port của máy; HTTPS (API kỹ thuật, feature 005) ở cổng -HttpsPort, cùng số
#   trong và ngoài container (device/identity báo đúng cổng Studio dùng). -HttpsPort 0: tắt HTTPS.
# - Chứng chỉ, device-id, audit.db, kho project và lưu trữ nằm trong -DataDir; tài khoản trong
#   -UsersFile. Cả hai nằm trong container: còn sau `docker restart mat-runtime-x64`, mất khi chạy lại
#   script (container bị tạo mới; Studio phải ghim lại fingerprint).
# - -NoDiscovery: không mở socket tìm thiết bị (Docker Desktop dùng NAT, broadcast không tới container).
# - -BuildDir: build ngoài repo (gắn vào /build), như test-x64.ps1; mặc định build/x64 trong repo.
# Dừng: docker stop mat-runtime-x64.
# (Thông báo in ra không dấu: Windows PowerShell 5.1 đọc file .ps1 không BOM theo codepage ANSI.)
param(
    [int]$Port = 8080,
    [int]$HttpsPort = 8443,
    [string]$Project = 'projects/tank-demo',
    [string]$DataDir = '/tmp/mat-data',
    [string]$UsersFile = '/tmp/mat-etc/users.json',
    [switch]$NoDiscovery,
    [switch]$NoBuild,
    [string]$BuildDir = ''
)
$root = Resolve-Path "$PSScriptRoot/../.."
docker build -q -t mat-armhf "$PSScriptRoot" | Out-Null
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$mount = @()
$dir = 'build/x64'
$bin = '/src/build/x64/bin/mat-runtime'
if ($BuildDir) {
    New-Item -ItemType Directory -Force $BuildDir | Out-Null
    $mount = @('-v', "${BuildDir}:/build")
    $dir = '/build/x64'
    $bin = '/build/x64/bin/mat-runtime'
}
if (-not $NoBuild) {
    docker run --rm -v "${root}:/src" @mount mat-armhf sh -c "cmake -S . -B $dir -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null && cmake --build $dir --target mat-runtime"
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
if (-not (Test-Path "$root/apps/runtime-web/dist-device/index.html")) {
    Write-Host 'Missing apps/runtime-web/dist-device: run `npm run build:web` first.' -ForegroundColor Yellow
    exit 1
}
docker rm -f mat-runtime-x64 2>$null | Out-Null
$Project = $Project.Replace('\', '/')
$publish = @('-p', "${Port}:8080")
if ($HttpsPort -ne 0) { $publish += @('-p', "${HttpsPort}:${HttpsPort}") }
$runtimeArgs = @('--docroot', '/src/apps/runtime-web/dist-device', '--project-dir', "/src/$Project",
    '--schemas-dir', '/src/schemas', '--data-dir', $DataDir, '--project-store-dir', "$DataDir/projects",
    '--https-port', "$HttpsPort", '--users-file', $UsersFile)
if ($NoDiscovery) { $runtimeArgs += '--no-discovery' }
docker run -d --name mat-runtime-x64 @publish -v "${root}:/src:ro" @mount mat-armhf `
    $bin @runtimeArgs | Out-Null
if ($LASTEXITCODE) { exit $LASTEXITCODE }
# The account commands write users.json through a temporary file next to it: the directory must
# exist. The runtime reads the file again when it appears (at most every 2 s).
$usersDir = $UsersFile.Substring(0, [Math]::Max($UsersFile.LastIndexOf('/'), 1))
docker exec mat-runtime-x64 mkdir -p $usersDir | Out-Null
Start-Sleep -Milliseconds 1500
docker logs mat-runtime-x64
$https = if ($HttpsPort -ne 0) { "  https://localhost:$HttpsPort/" } else { '  (HTTPS off)' }
Write-Host "mat-runtime x64: http://localhost:$Port/$https  (stop: docker stop mat-runtime-x64)" -ForegroundColor Green
Write-Host 'Tao tai khoan thu (quickstart 2; nhap mat khau 2 lan, 15-128 ky tu, khong hien tren man hinh):'
Write-Host "  docker exec -it mat-runtime-x64 $bin --user-add admin --role administrator --users-file $UsersFile --data-dir $DataDir"
Write-Host "  docker exec -it mat-runtime-x64 $bin --user-add kysu1 --role engineer --users-file $UsersFile --data-dir $DataDir"
Write-Host 'Fingerprint chung chi (so voi Studio khi ghim lan dau):'
Write-Host "  docker exec mat-runtime-x64 $bin --cert-fingerprint --data-dir $DataDir"
