# Local equivalent of .github/workflows/ci.yml:
# clang-format, armhf build + smoke under qemu, deploy/rollback scripts, x64 build + ctest,
# Go (gofmt, vet, test), web (lint, typecheck, test, build), Studio e2e (Chrome headless + axe-core).
# Then (feature 005, T151): the Studio Rust tests (cargo test --lib, Windows only: junctions, read-only
# rename; CARGO_TARGET_DIR=C:\build\mat-studio) and tools/device-it.ps1 (auth, discovery, packages, deploy,
# busy, health on x64 runtimes in Docker; health needs the MAT_TEST_HOOKS build in C:\build\mat-x64-e2).
# Slow device-it scenarios are run by hand: kill (-Rounds 24, several minutes), reload (Chrome tabs).
# GitHub has no Windows Rust job (see ci.yml). Stops at the first failing step and returns its exit code.
# Feature 006 (T207): armhf tests under qemu-user (deployment/toolchain/test-armhf.sh, the RTU tests on a pty
# too), the x64 tests again with ASan + UBSan (C:\build\mat-x64-asan; -SkipSanitize leaves it out), the fast
# driver-it scenarios (source, read, merge, split, probe, write, write-race, unplug, write-kill, load, calc, faults) and
# the time of every step at the end. By hand, not here (long or they need a person): driver-it retain (20 rounds
# of kill -9 and waiting out the window of the store), the fuzz of one hour (tools/fuzz-modbus.ps1 -Seconds 3600),
# the SSH scenarios on the BL335.
# Feature 007 (T142): runtime-web e2e and tools/web-it.ps1 (web login, attack cases, control, pulse, certificates, page on Chrome).
param([switch]$SkipSanitize)
$ErrorActionPreference = 'Stop'
$stepTimes = New-Object System.Collections.Generic.List[object]
$root = Resolve-Path "$PSScriptRoot/.."

function Invoke-Step([string]$Name, [scriptblock]$Body) {
    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    # stderr của npm/go/docker không phải lỗi; chỉ mã thoát quyết định (tránh "đỏ giả" khi chạy với 2>&1).
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $clock = [Diagnostics.Stopwatch]::StartNew()
    try { & $Body } finally { $ErrorActionPreference = $saved }
    $stepTimes.Add([pscustomobject]@{ Step = $Name; Seconds = [int]$clock.Elapsed.TotalSeconds })
    Write-Host ("[{0} s] {1}" -f [int]$clock.Elapsed.TotalSeconds, $Name) -ForegroundColor DarkGray
    if ($LASTEXITCODE) {
        Write-Host "FAILED: $Name (exit $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

Invoke-Step 'clang-format' {
    docker build -q -t mat-armhf "$root/deployment/toolchain" | Out-Null
    if ($LASTEXITCODE) { return }
    docker run --rm -v "${root}:/src" mat-armhf sh -c "clang-format --dry-run -Werror `$(find core server drivers tools/hello-armhf -name '*.cpp' -o -name '*.hpp')"
}
Invoke-Step 'build armhf' { & "$root/deployment/toolchain/build.ps1" }
# The armhf runtime under qemu-user: a project that logs to SQLite starts, writes, stops and passes
# --check-history. A fault of the 32-bit build never shows in the x64 tests (2026-10-11: SQLite).
Invoke-Step 'armhf smoke (qemu)' {
    docker run --rm -v "${root}:/src" mat-armhf sh -c "tr -d '\r' < deployment/toolchain/smoke-armhf.sh > /tmp/smoke.sh && sh /tmp/smoke.sh"
}
# Unit tests of the 32-bit build under qemu-user (alignment, time_t, 64-bit integers; the RTU tests open a pty).
Invoke-Step 'armhf tests (qemu)' {
    docker run --rm -v "${root}:/src" mat-armhf sh -c "tr -d '\r' < deployment/toolchain/test-armhf.sh > /tmp/t.sh && sh /tmp/t.sh"
}
# deploy.sh + rollback.sh với systemctl/runuser giả, trong container dùng một lần (review R-16).
Invoke-Step 'deploy/rollback (sh)' {
    docker run --rm -v "${root}:/src" mat-armhf sh -c "tr -d '\r' < deployment/device/tests/deploy_rollback_test.sh > /tmp/t.sh && sh /tmp/t.sh"
}
Invoke-Step 'build x64 + ctest' { & "$root/deployment/toolchain/test-x64.ps1" }
if (-not $SkipSanitize) {
    # The same tests with AddressSanitizer and UndefinedBehaviorSanitizer (feature 006: parsers of the wire, the
    # driver threads, the serial port). A separate build folder: the flags change every object.
    Invoke-Step 'x64 ASan/UBSan (ctest)' { & "$root/deployment/toolchain/test-x64.ps1" -Sanitize -BuildDir 'C:\build\mat-x64-asan' }
}

if (Test-Path "$root/tools/load-tester/go.mod") {
    Invoke-Step 'gofmt' {
        $bad = gofmt -l "$root/tools/load-tester"
        if ($bad) { Write-Host "Chưa đúng định dạng: $bad"; $global:LASTEXITCODE = 1 }
    }
    Invoke-Step 'go vet' { Push-Location "$root/tools/load-tester"; try { go vet ./... } finally { Pop-Location } }
    Invoke-Step 'go test' { Push-Location "$root/tools/load-tester"; try { go test -count=1 ./... } finally { Pop-Location } }
}

foreach ($step in 'lint', 'typecheck', 'validate:project', 'test', 'build:web') {
    Invoke-Step "npm run $step" { Push-Location $root; try { npm run $step } finally { Pop-Location } }
}

# Modbus TCP simulator of feature 006 (tools/modbus-sim): its own tests, independent of the C++ code.
Invoke-Step 'modbus-sim (node --test)' {
    Push-Location $root; try { node --test "tools/modbus-sim/*.test.mjs" "tools/project-validator/*.test.mjs" "tools/dashboard-demo/*.test.mjs" "tools/gen-widget-docs.test.mjs" } finally { Pop-Location }
}

# Nhập SVG của feature 008 (T050): CLI nhập được 10 fixture; test gói nhập, thư viện ký hiệu, CLI.
Invoke-Step 'svg:inspect --import (10 fixture)' { Push-Location $root; try { npm run svg:inspect -- --import tests/fixtures/svg-import } finally { Pop-Location } }
Invoke-Step 'svg-import + symbols (npm test)' {
    Push-Location $root
    try {
        npm test -w @mat/svg-import
        if ($LASTEXITCODE -eq 0 -and (Test-Path "$root/packages/symbols/package.json")) { npm test -w @mat/symbols }
        if ($LASTEXITCODE -eq 0) { node --test "tools/svg-import/*.test.mjs" }
        # Fuzz importer 10.000 ca tất định (feature 008, T113): <= 3 phút; bản dài chạy tay với --minutes 60.
        if ($LASTEXITCODE -eq 0) { node tools/svg-import/fuzz.mjs --cases 10000 }
    } finally { Pop-Location }
}

# Giao diện Studio trên Chrome headless với lớp Tauri giả, kèm axe-core (feature 004, T079).
Invoke-Step 'Studio e2e' { Push-Location $root; try { npm run e2e -w @mat/studio } finally { Pop-Location } }

# Operator page on Chrome headless with a fake runtime (feature 007, T040, T074).
Invoke-Step 'runtime-web e2e' { Push-Location $root; try { npm run e2e -w @mat/runtime-web } finally { Pop-Location } }

# Rust side of the Studio: package vectors, discovery packet, pinned TLS (feature 005).
Invoke-Step 'Studio cargo test --lib' {
    Push-Location "$root/apps/studio/src-tauri"
    $env:CARGO_TARGET_DIR = 'C:\build\mat-studio'
    try { cargo test --lib } finally { Pop-Location }
}

# Device scenarios on x64 runtimes in Docker (tools/device-it.ps1; the viewer must be built: build:web).
Invoke-Step 'device-it' {
    try {
        & "$root/tools/device-it.ps1" -Scenario auth,discovery,packages,deploy,busy,health -BuildDir 'C:\build\mat-x64-e2'
    } catch {
        Write-Host $_ -ForegroundColor Red
        $global:LASTEXITCODE = 1
    }
}

# Feature 006 scenarios on x64 runtimes with the Node simulator (tools/driver-it.ps1).
Invoke-Step 'driver-it' {
    try {
        & "$root/tools/driver-it.ps1" -Scenario source,read,merge,split,probe,write,write-race,unplug,write-kill,load,calc,faults -Net -NoBuild -BuildDir 'C:\build\mat-x64-e2'
    } catch {
        Write-Host $_ -ForegroundColor Red
        $global:LASTEXITCODE = 1
    }
}

# Feature 007 scenarios on x64 runtimes: web login, sessions, 30 attack cases, control, certificates, the page on Chrome
# (tools/web-it.ps1). By hand, not here: pulse-kill (kill -9, minutes) and the 30 minute runs of SC-004 and SC-017.
Invoke-Step 'web-it' {
    try {
        & "$root/tools/web-it.ps1" -Scenario bundle,control,locks,expect,pulse,session,attack,gate,attack-accounts,session28,cert,compat,screens,widgets,chrome-control,f5x10,open -Rounds 20 -NoBuild -BuildDir 'C:\build\mat-x64-e2'
    } catch {
        Write-Host $_ -ForegroundColor Red
        $global:LASTEXITCODE = 1
    }
}

Write-Host "`nTime of the steps:" -ForegroundColor Cyan
$stepTimes | ForEach-Object { Write-Host ("  {0,6} s  {1}" -f $_.Seconds, $_.Step) }
Write-Host "`nci-local: ALL STEPS PASSED" -ForegroundColor Green
