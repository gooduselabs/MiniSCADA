# Local equivalent of .github/workflows/ci.yml:
# clang-format, armhf build + smoke under qemu, deploy/rollback scripts, x64 build + ctest,
# Go (gofmt, vet, test), web (lint, typecheck, test, build), Studio e2e (Chrome headless + axe-core).
# Not here (and not on GitHub): the Studio Rust tests, which need Windows; run them by hand in
# apps/studio/src-tauri with $env:CARGO_TARGET_DIR='C:\build\mat-studio'; cargo test --lib.
# Stops at the first failing step and returns its exit code.
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot/.."

function Invoke-Step([string]$Name, [scriptblock]$Body) {
    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    # stderr của npm/go/docker không phải lỗi; chỉ mã thoát quyết định (tránh "đỏ giả" khi chạy với 2>&1).
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Body } finally { $ErrorActionPreference = $saved }
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
# deploy.sh + rollback.sh với systemctl/runuser giả, trong container dùng một lần (review R-16).
Invoke-Step 'deploy/rollback (sh)' {
    docker run --rm -v "${root}:/src" mat-armhf sh -c "tr -d '\r' < deployment/device/tests/deploy_rollback_test.sh > /tmp/t.sh && sh /tmp/t.sh"
}
Invoke-Step 'build x64 + ctest' { & "$root/deployment/toolchain/test-x64.ps1" }

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

# Giao diện Studio trên Chrome headless với lớp Tauri giả, kèm axe-core (feature 004, T079).
Invoke-Step 'Studio e2e' { Push-Location $root; try { npm run e2e -w @mat/studio } finally { Pop-Location } }

Write-Host "`nci-local: ALL STEPS PASSED" -ForegroundColor Green
