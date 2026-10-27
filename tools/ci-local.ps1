# Local equivalent of .github/workflows/ci.yml:
# clang-format, armhf build + smoke under qemu, deploy/rollback scripts, x64 build + ctest,
# Go (gofmt, vet, test), web (lint, typecheck, test, build), Studio e2e (Chrome headless + axe-core).
# Then (feature 005, T151): the Studio Rust tests (cargo test --lib, Windows only: junctions, read-only
# rename; CARGO_TARGET_DIR=C:\build\mat-studio) and tools/device-it.ps1 (auth, discovery, packages, deploy,
# busy, health on x64 runtimes in Docker; health needs the MAT_TEST_HOOKS build in C:\build\mat-x64-e2).
# Slow device-it scenarios are run by hand: kill (-Rounds 24, several minutes), reload (Chrome tabs).
# GitHub has no Windows Rust job (see ci.yml). Stops at the first failing step and returns its exit code.
# Feature 006 (T207): armhf tests under qemu-user (deployment/toolchain/test-armhf.sh, the RTU tests on a pty
# too), the x64 tests again with ASan + UBSan (C:\build\mat-x64-asan; only with -Sanitize), the fast
# driver-it scenarios (source, read, merge, split, probe, write, write-race, unplug, write-kill, load, calc, faults) and
# the time of every step at the end. By hand, not here (long or they need a person): driver-it retain (20 rounds
# of kill -9 and waiting out the window of the store), the fuzz of one hour (tools/fuzz-modbus.ps1 -Seconds 3600),
# the SSH scenarios on the BL335.
# Feature 009 (T122): explicit steps for the alarm vectors v05 and alarm-vectors (Vitest), npm test of @mat/alarm-engine,
# the lint of hard-coded strings of the alarm UI, the alarm_*_tests of x64 and armhf, the alarm-it subset that runs in CI
# (state, quality, restart, auth, attack, compat, history; the rest is by hand: killloop, storm, latency, budget).
# Feature 007 (T142): runtime-web e2e and tools/web-it.ps1 (web login, attack cases, control, pulse, certificates, page on Chrome).
# Feature 008 (T119): svg:inspect --import, Vitest of svg-import/svg-renderer (npm test covers every
# workspace), the Studio and runtime-web e2e (all *.e2e.mjs: import, svg-bind, svg-perf, rebuild-tank,
# reimport, upgrade04; svg-events, svg-unsafe, anim), cargo test --lib, ctest (rules_04, vectors_04). -Full adds the
# malicious set + page-path + page fuzz on Chrome, a long importer fuzz and anim-bench (about 20 minutes more).
# Feature 009: the ASan step runs only with -Sanitize (a DEADLYSIGNAL loop filled the disk).
# -BuildName <n>: all builds go to <build root>/<n>-armhf, <n>-x64 and <n>-x64-e2 (outside the repo) instead of the in-repo
# build/ folders and <build root>/mat-x64-e2. <build root>: MAT_BUILD_ROOT, else C:\build on Windows and ~/build on macOS/Linux
# (tools/lib/platform.ps1). -Parallel / -BuildJobs go to test-x64.ps1 (ctest -j, build jobs).
# -StartAt <name>: skip the steps before the first one whose name contains <name> (resume after a fix; the last full run must have passed them).
# Feature 011 (T059; FR-030, SC-042): steps sast (cppcheck; clang-tidy only with -Full, 1-2 h), audit (npm audit, cargo audit;
# needs the network), update-it (OTA subset), logic-it (when tools/logic-it.ps1 exists), the C++ fuzz targets for 20 s each
# (tools/fuzz/cpp/run.sh, only with -Sanitize). A step that cannot run prints "BO QUA (SKIPPED): <reason>" and is listed at the
# end; with a skipped step the run never ends with "ALL STEPS PASSED" (it ends "PASSED WITH SKIPPED STEPS", exit 0).
param([switch]$Sanitize, [switch]$Full, [string]$BuildName = '', [int]$Parallel = 1, [int]$BuildJobs = 2, [string]$StartAt = '')
$ErrorActionPreference = 'Stop'
$stepTimes = New-Object System.Collections.Generic.List[object]
$skipped = New-Object System.Collections.Generic.List[object]
$root = Resolve-Path "$PSScriptRoot/.."
. "$PSScriptRoot/lib/platform.ps1"
$armMount = @(); $armB = 'build/armhf'; $armDir = @{}; $x64Dir = @{}; $itDir = Get-MatBuildDir 'mat-x64-e2'
if ($BuildName) { $armOut = Get-MatBuildDir "$BuildName-armhf"; $armMount = @('-v', "${armOut}:/build"); $armB = '/build/armhf'; $armDir = @{ BuildDir = $armOut }; $x64Dir = @{ BuildDir = (Get-MatBuildDir "$BuildName-x64") }; $itDir = Get-MatBuildDir "$BuildName-x64-e2" }

function Invoke-Step([string]$Name, [scriptblock]$Body) {
    if ($StartAt -and -not $script:reached) { if ($Name -like "*$StartAt*") { $script:reached = $true } else { Write-Host "skip: $Name" -ForegroundColor DarkGray; return } }
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

# A step that cannot run here: printed and listed at the end, never counted as passed (T059).
function Skip-Step([string]$Name, [string]$Reason) {
    if ($StartAt -and -not $script:reached) { return }
    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    Write-Host "BO QUA (SKIPPED): $Reason" -ForegroundColor Yellow
    $skipped.Add([pscustomobject]@{ Step = $Name; Reason = $Reason })
}

Invoke-Step 'clang-format' {
    docker build -q -t mat-armhf "$root/deployment/toolchain" | Out-Null
    if ($LASTEXITCODE) { return }
    docker run --rm -v "${root}:/src" mat-armhf sh -c "clang-format --dry-run -Werror `$(find core server drivers tools/hello-armhf -name '*.cpp' -o -name '*.hpp')"
}
Invoke-Step 'build armhf' { & "$root/deployment/toolchain/build.ps1" @armDir }
# The armhf runtime under qemu-user: a project that logs to SQLite starts, writes, stops and passes
# --check-history. A fault of the 32-bit build never shows in the x64 tests (2026-10-11: SQLite).
Invoke-Step 'armhf smoke (qemu)' {
    docker run --rm -v "${root}:/src" @armMount mat-armhf sh -c "tr -d '\r' < deployment/toolchain/smoke-armhf.sh > /tmp/smoke.sh && sh /tmp/smoke.sh $armB"
}
# Unit tests of the 32-bit build under qemu-user (alignment, time_t, 64-bit integers; the RTU tests open a pty).
Invoke-Step 'armhf tests (qemu)' {
    docker run --rm -v "${root}:/src" @armMount -e "MAT_BUILD_JOBS=$BuildJobs" mat-armhf sh -c "tr -d '\r' < deployment/toolchain/test-armhf.sh > /tmp/t.sh && sh /tmp/t.sh $armB"
}
# deploy.sh + rollback.sh với systemctl/runuser giả, trong container dùng một lần (review R-16).
Invoke-Step 'deploy/rollback (sh)' {
    docker run --rm -v "${root}:/src" mat-armhf sh -c "tr -d '\r' < deployment/device/tests/deploy_rollback_test.sh > /tmp/t.sh && sh /tmp/t.sh"
}
# The large package vectors (tests/package-vectors/out/) are not committed: a fresh clone needs them before ctest.
Invoke-Step 'package vectors (generate --out)' {
    Push-Location $root
    try {
        node tests/package-vectors/generate.mjs --out
        # the large update packages of feature 011 (tests/update-vectors/out/, not committed)
        if ($LASTEXITCODE -eq 0) { node tools/release/make-update.mjs --vectors --out --test }
    } finally { Pop-Location }
}
# AlarmStorm asserts a tick latency that ctest -j misses on a loaded machine: it runs in the serial alarm step below.
Invoke-Step 'build x64 + ctest' { & "$root/deployment/toolchain/test-x64.ps1" @x64Dir -Parallel $Parallel -BuildJobs $BuildJobs -Exclude '^AlarmStorm\.' }
# Feature 009: the alarm_*_tests of x64 by name (mat_alarm_tests builds them all); the armhf ones are in the DEFAULT list of
# deployment/toolchain/test-armhf.sh (step 'armhf tests (qemu)' above).
# Serial on purpose: AlarmStorm asserts a tick latency (worst - median <= 5 ms) that a loaded ctest -j misses.
Invoke-Step 'alarm_*_tests x64' { & "$root/deployment/toolchain/test-x64.ps1" @x64Dir -Parallel 1 -BuildJobs $BuildJobs -Target mat_alarm_tests -Filter 'Alarm' }
if ($Sanitize) {
    # The same tests with AddressSanitizer and UndefinedBehaviorSanitizer (feature 006: parsers of the wire, the
    # driver threads, the serial port). A separate build folder: the flags change every object.
    # RAM of the Docker VM of a Mac (about 3 GB): an ASan build at -j2 gets cc1plus OOM-killed; -BuildJobs 1 there.
    Invoke-Step 'x64 ASan/UBSan (ctest)' { & "$root/deployment/toolchain/test-x64.ps1" -Sanitize -BuildDir (Get-MatBuildDir 'mat-x64-asan') -Parallel $Parallel -BuildJobs $BuildJobs }
    # Feature 011 (T058, T142): the timed C++ fuzz targets, 20 s each (the one-hour runs: tools/fuzz/cpp/run.ps1 -Seconds 3600).
    Invoke-Step 'C++ fuzz ASan/UBSan (20 s each)' {
        docker run --rm --name "ci-fuzz-$PID" -v "${root}:/src" -v "$(Get-MatBuildDir 'mat-x64-asan'):/build" mat-armhf sh /src/tools/fuzz/cpp/run.sh /build/x64 20
    }
} else {
    Skip-Step 'x64 ASan/UBSan (ctest) + C++ fuzz' 'only with -Sanitize (an ASan build takes hours on 2 jobs)'
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

# Feature 009: vectors v05-* (TS validator, same cases as C++ project_validator_test) and the alarm vectors; alarm-engine package.
Invoke-Step 'alarm vectors v05 + alarm-engine (Vitest)' {
    Push-Location $root
    try {
        npx vitest run packages/project-schema/src/vectors-05.test.ts packages/project-schema/src/alarm-widget-rules.test.ts
        if ($LASTEXITCODE) { return }
        npm test -w @mat/alarm-engine
    } finally { Pop-Location }
}
# Feature 009: lint of hard-coded strings and DOM safety of the alarm UI (tools/lint-fixtures-009).
Invoke-Step 'alarm lint rules (node --test)' {
    Push-Location $root; try { node --test tools/lint-rules-alarm.test.mjs } finally { Pop-Location }
}

# Feature 011 (T177, FR-130): links, file references, CLI flags and error codes of the Markdown docs; HTML build of docs/user.
Invoke-Step 'docs-check' {
    Push-Location $root
    try {
        node --test tools/docs-check.test.mjs tools/build-docs.test.mjs
        if ($LASTEXITCODE) { return }
        node tools/docs-check.mjs
    } finally { Pop-Location }
}

# Feature 011 (T055, T059): SAST. cppcheck here (about 10 s); clang-tidy (1-2 h, the static analyzer on every file) with -Full.
Invoke-Step 'sast' {
    $tool = if ($Full) { 'all' } else { 'cppcheck' }
    & "$root/tools/sast/run.ps1" -Tool $tool -NoImageBuild -BuildDir (Get-MatBuildDir $(if ($BuildName) { "$BuildName-sast" } else { 'mat-sast' }))
}
if (-not $Full) { Skip-Step 'sast clang-tidy' 'only with -Full (1-2 h)' }

# Feature 011 (T056, T059): dependency audit. Needs the network (the advisory databases): without it the step is skipped.
function Test-Online {
    try {
        $c = New-Object Net.Sockets.TcpClient
        $ok = $c.ConnectAsync('registry.npmjs.org', 443).Wait(5000) -and $c.Connected
        $c.Dispose()
        return $ok
    } catch { return $false }
}
if (Test-Online) {
    Invoke-Step 'audit (npm, cargo)' {
        Push-Location $root
        try {
            npm audit --omit=dev --audit-level=high
            if ($LASTEXITCODE) { return }
            npm audit --audit-level=high
            if ($LASTEXITCODE) { return }
            $ca = Get-Command cargo-audit -ErrorAction SilentlyContinue
            if (-not $ca) { $p = Join-Path (Get-MatBuildDir 'cargo-tools') "bin/cargo-audit$MatExe"; if (Test-Path $p) { $ca = $p } }
            if ($ca) {
                Push-Location "$root/apps/studio/src-tauri"
                # the advisories accepted in docs/reports/011-audit-cargo.json ("decisions") are ignored; any other one fails
                $accepted = @((Get-Content -Raw "$root/docs/reports/011-audit-cargo.json" | ConvertFrom-Json).decisions.PSObject.Properties.Name)
                $ignore = @($accepted | ForEach-Object { '--ignore'; $_ })
                try { & $ca audit @ignore } finally { Pop-Location }
            } else {
                Write-Host 'BO QUA (SKIPPED): cargo-audit not installed (cargo install cargo-audit --root <build root>/cargo-tools)' -ForegroundColor Yellow
                $skipped.Add([pscustomobject]@{ Step = 'audit cargo'; Reason = 'cargo-audit not installed' })
            }
        } finally { Pop-Location }
    }
} else {
    Skip-Step 'audit (npm, cargo)' 'no network (registry.npmjs.org:443 unreachable)'
}

# Modbus TCP simulator of feature 006 (tools/modbus-sim): its own tests, independent of the C++ code.
Invoke-Step 'modbus-sim (node --test)' {
    Push-Location $root; try { node --test "tools/modbus-sim/*.test.mjs" "tools/s7-sim/*.test.mjs" "tools/fins-sim/*.test.mjs" "tools/mc-sim/*.test.mjs" "tools/bacnet-sim/*.test.mjs" "tools/project-validator/*.test.mjs" "tools/dashboard-demo/*.test.mjs" "tools/gen-widget-docs.test.mjs" "tools/gen-error-codes.test.mjs" "tools/measure/tab-rss.test.mjs" } finally { Pop-Location }
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

# Bộ độc hại, fuzz dài và đo hoạt ảnh trên Chrome thật (feature 008, T119): chỉ khi -Full (thêm khoảng 20 phút).
if ($Full) {
    $rep = Join-Path $MatTemp 'mat-008-full'
    New-Item -ItemType Directory -Force $rep | Out-Null
    Invoke-Step 'svg malicious (Chrome)' { Push-Location $root; try { node tools/svg-import/malicious-harness.mjs --out "$rep/malicious.json" } finally { Pop-Location } }
    Invoke-Step 'svg page-path (Chrome)' { Push-Location $root; try { node tools/svg-import/page-path-harness.mjs --out "$rep/page-path.json" } finally { Pop-Location } }
    Invoke-Step 'svg page-fuzz (Chrome)' { Push-Location $root; try { node tools/svg-import/page-fuzz.mjs --out "$rep/page-fuzz.json" } finally { Pop-Location } }
    Invoke-Step 'svg import fuzz (10 min)' { Push-Location $root; try { node tools/svg-import/fuzz.mjs --minutes 10 --out "$rep/fuzz.json" } finally { Pop-Location } }
    Invoke-Step 'anim-bench (10 min)' {
        Push-Location "$root/apps/runtime-web"
        try { npx vite build --mode e2e; if ($LASTEXITCODE -eq 0) { Set-Location $root; node tools/measure/anim-bench.mjs --minutes 10 --out "$rep/anim.json" } } finally { Pop-Location }
    }
}

# Giao diện Studio trên Chrome headless với lớp Tauri giả, kèm axe-core (feature 004, T079).
Invoke-Step 'Studio e2e' { Push-Location $root; try { npm run e2e -w @mat/studio } finally { Pop-Location } }

# Operator page on Chrome headless with a fake runtime (feature 007, T040, T074).
Invoke-Step 'runtime-web e2e' { Push-Location $root; try { npm run e2e -w @mat/runtime-web } finally { Pop-Location } }

# Rust side of the Studio: package vectors, discovery packet, pinned TLS (feature 005).
Invoke-Step 'Studio cargo test --lib' {
    Push-Location "$root/apps/studio/src-tauri"
    $env:CARGO_TARGET_DIR = Get-MatBuildDir 'mat-studio'
    try { cargo test --lib } finally { Pop-Location }
}

# Device scenarios on x64 runtimes in Docker (tools/device-it.ps1; the viewer must be built: build:web).
Invoke-Step 'device-it' {
    try {
        & "$root/tools/device-it.ps1" -Scenario auth,discovery,packages,deploy,busy,health -BuildDir $itDir
    } catch {
        Write-Host $_ -ForegroundColor Red
        $global:LASTEXITCODE = 1
    }
}

# Feature 006 scenarios on x64 runtimes with the Node simulator (tools/driver-it.ps1).
Invoke-Step 'driver-it' {
    try {
        & "$root/tools/driver-it.ps1" -Scenario source,read,merge,split,probe,write,write-race,unplug,write-kill,load,calc,faults -Net -NoBuild -BuildDir $itDir
    } catch {
        Write-Host $_ -ForegroundColor Red
        $global:LASTEXITCODE = 1
    }
}

# Feature 007 scenarios on x64 runtimes: web login, sessions, 30 attack cases, control, certificates, the page on Chrome
# (tools/web-it.ps1). By hand, not here: pulse-kill (kill -9, minutes) and the 30 minute runs of SC-004 and SC-017.
Invoke-Step 'web-it' {
    try {
        & "$root/tools/web-it.ps1" -Scenario bundle,control,locks,expect,pulse,session,attack,gate,attack-accounts,session28,cert,compat,screens,widgets,chrome-control,f5x10,open -Rounds 20 -NoBuild -BuildDir $itDir
    } catch {
        Write-Host $_ -ForegroundColor Red
        $global:LASTEXITCODE = 1
    }
}

# Feature 009 scenarios on x64 runtimes (tools/alarm-it.ps1): the subset that runs in CI. By hand: killloop, storm, latency,
# budget (long or a measurement).
Invoke-Step 'alarm-it' {
    try {
        & "$root/tools/alarm-it.ps1" -Scenario state,quality,restart,auth,attack,compat,history -BuildDir $itDir
    } catch {
        Write-Host $_ -ForegroundColor Red
        $global:LASTEXITCODE = 1
    }
}

# Feature 011 (T120, T059): OTA on x64 (tools/update-it.ps1), the fast subset. By hand: ok (20 updates), kill (40 kill -9 points).
Invoke-Step 'update-it' {
    try {
        & "$root/tools/update-it.ps1" -Scenario bad,downgrade,busy,keyset,auth,health -BuildDir (Get-MatBuildDir $(if ($BuildName) { "$BuildName-update-it" } else { 'mat-x64-update-it' }))
    } catch {
        Write-Host $_ -ForegroundColor Red
        $global:LASTEXITCODE = 1
    }
}

# Feature 011 (T146, T059): logic v2 on x64 with the Modbus simulator (tools/logic-it.ps1), the fast scenarios.
# By hand: retain-kill (100 rounds of kill -9), load (a measurement).
if (Test-Path "$root/tools/logic-it.ps1") {
    Invoke-Step 'logic-it' {
        try {
            & "$root/tools/logic-it.ps1" -Scenario rules,writes-off,throttle,stop,retain-lost,deploy-keep -NoBuild -BuildDir $itDir
        } catch {
            Write-Host $_ -ForegroundColor Red
            $global:LASTEXITCODE = 1
        }
    }
} else {
    Skip-Step 'logic-it' 'tools/logic-it.ps1 does not exist yet (T146)'
}

Write-Host "`nTime of the steps:" -ForegroundColor Cyan
$stepTimes | ForEach-Object { Write-Host ("  {0,6} s  {1}" -f $_.Seconds, $_.Step) }
if ($skipped.Count) {
    Write-Host "`nSkipped steps (not passed):" -ForegroundColor Yellow
    $skipped | ForEach-Object { Write-Host ("  BO QUA  {0}: {1}" -f $_.Step, $_.Reason) -ForegroundColor Yellow }
    Write-Host "`nci-local: PASSED WITH SKIPPED STEPS ($($skipped.Count)), not all green" -ForegroundColor Yellow
    exit 0
}
Write-Host "`nci-local: ALL STEPS PASSED" -ForegroundColor Green
