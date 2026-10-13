# Fuzz cua khung Modbus TCP va RTU (specs/006-tags-modbus T101, T158, T209; SC-020; research R11).
# Dung: ./tools/fuzz-modbus.ps1 [-Seconds 3600] [-Seed 0] [-BuildDir C:\build\mat-x64-asan] [-NoSanitize]
# Chay modbus_fuzz_test (4 muc tieu, moi muc 1/4 thoi gian): bo giai ma TCP va RTU so voi mot tham chieu viet
# rieng tu hop dong; may trang thai nhan cua driver TCP va driver RTU tren duong truyen gia bi lam hong (cat,
# chia manh, tre, mat). Khong dung, khong treo (cho canh 10 s), khong gia tri sai vao Tag.
# Mac dinh dung build ASan + UBSan trong -BuildDir (tao neu chua co, mot thu muc rieng). -NoSanitize dung ban
# Release da co trong -BuildDir (vi du C:\build\mat-x64-e2) de chay ban ngan khi khong co thu muc ASan.
# -Seed: hat giong goc (MAT_FUZZ_SEED); loi in hat giong cua lan chay de chay lai. Ket qua: so dau vao, hat giong
# va thoi gian ghi ra man hinh va docs/reports/006-fuzz-x64.json (ghi tay vao 006-acceptance.md).
param(
    [int]$Seconds = 3600,
    [UInt64]$Seed = 0,
    [string]$BuildDir = 'C:\build\mat-x64-asan',
    [switch]$NoSanitize
)
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path "$PSScriptRoot/..").Path
New-Item -ItemType Directory -Force $BuildDir | Out-Null
docker build -q -t mat-armhf "$root/deployment/toolchain" | Out-Null
if ($LASTEXITCODE) { throw 'docker build failed' }
$flags = if ($NoSanitize) { '' } else { '-DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined -fno-sanitize-recover=undefined -fno-omit-frame-pointer" -DCMAKE_C_FLAGS="-fsanitize=address,undefined" -DCMAKE_EXE_LINKER_FLAGS="-fsanitize=address,undefined"' }
if ($NoSanitize) { $flags = '-DCMAKE_BUILD_TYPE=Release' }
$seedEnv = if ($Seed -ne 0) { "MAT_FUZZ_SEED=$Seed" } else { '' }
$started = Get-Date
$cmd = "ulimit -f 2000000; rm -f /build/fuzz.out /build/asan.log*; (cmake -S . -B /build/x64 -G Ninja $flags >/dev/null && cmake --build /build/x64 --target modbus_fuzz_test && cd /src && MAT_FUZZ_SECONDS=$Seconds $seedEnv ASAN_OPTIONS=detect_leaks=0:halt_on_error=1:log_path=/build/asan.log UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 /build/x64/bin/modbus_fuzz_test --gtest_filter='ModbusFuzz*') > /build/fuzz.out 2>&1; rc=`$?; tail -n 60 /build/fuzz.out; ls /build/asan.log* 2>/dev/null | head -3; exit `$rc"
Write-Host ("fuzz: {0} s, {1}" -f $Seconds, $(if ($NoSanitize) { 'no sanitizer (Release)' } else { 'ASan + UBSan' }))
# the command goes in a script file: PowerShell 5.1 strips the quotes of an argument of a native command
[IO.File]::WriteAllText("$BuildDir/fuzz-run.sh", ($cmd -replace "`r", "") + "`n", (New-Object Text.UTF8Encoding $false))
$out = docker run --rm --log-driver none -v "${root}:/src" -v "${BuildDir}:/build" mat-armhf sh /build/fuzz-run.sh 2>&1
$rc = $LASTEXITCODE
$out | ForEach-Object { Write-Host $_ }
$elapsed = [int]((Get-Date) - $started).TotalSeconds
$lines = @($out | Where-Object { $_ -match '^\[fuzz\]' })
$passed = ($rc -eq 0) -and (@($out | Where-Object { $_ -match '\[  PASSED  \] 4 tests' }).Count -gt 0)
$report = [ordered]@{
    scenario = 'fuzz-modbus'
    sanitizer = -not $NoSanitize
    secondsAsked = $Seconds
    secondsElapsed = $elapsed
    seed = if ($Seed -ne 0) { "$Seed" } else { 'default 0x6d41545f46555a5a' }
    targets = $lines
    pass = $passed
}
[IO.File]::WriteAllText("$root/docs/reports/006-fuzz-x64.json", ($report | ConvertTo-Json -Depth 4) + "`n", (New-Object Text.UTF8Encoding $false))
if ($passed) { Write-Host "fuzz PASS ($elapsed s)" -ForegroundColor Green; exit 0 }
Write-Host "fuzz FAILED (exit $rc)" -ForegroundColor Red
exit 1
