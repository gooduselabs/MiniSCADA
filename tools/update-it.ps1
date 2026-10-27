# Kiem tich hop OTA tren x64 (feature 011 T120; SC-020, SC-021, SC-022; contracts/update-package.md §4, §6).
# Dung: ./tools/update-it.ps1 [-Scenario ok,bad,downgrade,busy,health,keyset,manual-rollback,auth,kill] [-BuildDir <dir>] [-NoBuild]
#   ok:              20 cap nhat hop le; dich vu ngung <= 30 s, toan bo <= 120 s moi lan (SC-020).
#   bad:             cac goi xau cua contract §6 qua HTTPS: dung ma, cay cai va du lieu khong doi.
#   kill:            5 diem x 8 buoc S1..S8 = 40: kill -9 / cat dien roi phuc hoi: ban cu hoac ban moi hoan chinh (SC-021).
#   health:          ban moi khong chay: tu quay ve .prev <= 90 s.
#   busy, keyset, downgrade, manual-rollback, auth (ma tran quyen, HTTP, mat khau xac nhan; SC-022).
#   settings:        (027) tat OTA bang thiet lap thiet bi (API cua Studio) -> UPDATE_DISABLED; bat lai can mat khau; 1 cap nhat.
# Chay trong Docker mat-armhf (runtime that cua kien truc container, mat-updater.sh that, systemctl gia khoi dong
# va dung runtime do; mot vong lap dong vai mat-updater.path). Goi tao bang make-update.mjs --it (Node tren may
# chay script). Phong lab: MAT_RATE_S=0 (bo gioi han 1 lan/5 phut). Ket qua: docs/reports/011-update-x64.json.
# Mat khau thu sinh ngau nhien trong tien trinh Python cua container, khong ghi file.
param(
    [string[]]$Scenario = @('ok', 'bad', 'downgrade', 'busy', 'manual-rollback', 'health', 'keyset', 'auth', 'kill'),
    [string]$BuildDir = '',
    [switch]$NoBuild
)
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path "$PSScriptRoot/..").Path
. "$PSScriptRoot/lib/platform.ps1"
if (-not $BuildDir) { $BuildDir = Get-MatBuildDir 'mat-x64-update-it' }
New-Item -ItemType Directory -Force "$BuildDir/it" | Out-Null
$name = "update-it-$PID"
if (-not $NoBuild) {
    docker run --rm --name "$name-build" -v "${root}:/src" -v "${BuildDir}:/build" mat-armhf `
        sh -c 'cmake -S /src -B /build/x64 -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null && cmake --build /build/x64 --target mat-runtime mat-update-verify -j2 && strip -o /build/it/mat-runtime /build/x64/bin/mat-runtime && uname -m > /build/it/arch'
    if ($LASTEXITCODE) { throw 'build failed' }
}
$machine = (Get-Content "$BuildDir/it/arch" -Raw).Trim()
$arch = switch ($machine) { 'aarch64' { 'arm64' } 'x86_64' { 'x64' } default { $machine } }
node "$root/tools/release/make-update.mjs" --it "$BuildDir/it/pkgs" --bin "$BuildDir/it/mat-runtime" --arch $arch --count 64 --test
if ($LASTEXITCODE) { throw 'make-update.mjs --it failed' }
docker run --rm --name $name -v "${root}:/src" -v "${BuildDir}:/build" mat-armhf `
    python3 /src/tools/update-it/run.py --bin /build/it/mat-runtime --pkgs /build/it/pkgs `
    --verify /build/x64/bin/mat-update-verify --report /build/it/report.json --work /build/it/work `
    --scenario ($Scenario -join ',')
$rc = $LASTEXITCODE
if (Test-Path "$BuildDir/it/report.json") {
    Copy-Item "$BuildDir/it/report.json" (Join-Path $root 'docs/reports/011-update-x64.json')
    Write-Host "update-it: rc=$rc -> docs/reports/011-update-x64.json"
}
exit $rc
