# Local equivalent of .github/workflows/ci.yml:
# clang-format, armhf build, x64 build + ctest, Go (gofmt, vet, test), web (lint, typecheck, test, build).
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

Write-Host "`nci-local: ALL STEPS PASSED" -ForegroundColor Green
