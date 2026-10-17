# Fuzz bo doc goi cap nhat .matupdate (feature 011 T118; FR-029; contracts/update-package.md §7).
# Dung: ./tools/fuzz/update-envelope.ps1 [-Seconds 3600] [-Seed 20261017] [-BuildDir <thu muc build ASan>]
# Chay update_fuzz_test (ASan + UBSan) trong Docker mat-armhf qua tools/fuzz/update-envelope/run.sh: 3 muc tieu
# (phong bi + kiem toan bo, manifest, payload.tar.gz) tren kho mam tests/update-vectors (goi hop le, keyset, goi xau).
# Ket qua: docs/reports/011-fuzz-x64.json (muc "update-envelope").
param(
    [int]$Seconds = 3600,
    [UInt64]$Seed = 20261017,
    [string]$BuildDir = ''
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot/../..").Path
. "$root/tools/lib/platform.ps1"
if (-not $BuildDir) { $BuildDir = Get-MatBuildDir 'mat-x64-asan-update' }
New-Item -ItemType Directory -Force $BuildDir | Out-Null
$name = "fuzz-update-$PID"
$started = Get-Date
$out = docker run --rm --name $name -v "${root}:/src" -v "${BuildDir}:/build" mat-armhf `
    sh /src/tools/fuzz/update-envelope/run.sh /build/asan $Seconds $Seed 2>&1
$rc = $LASTEXITCODE
$out | Select-Object -Last 20 | ForEach-Object { Write-Host $_ }
$counts = @{}
foreach ($line in $out) {
    if ("$line" -match '^fuzz (\w+): (\d+) inputs') { $counts[$Matches[1]] = [int64]$Matches[2] }
}
$reportPath = Join-Path $root 'docs/reports/011-fuzz-x64.json'
$report = if (Test-Path $reportPath) { Get-Content -Raw $reportPath | ConvertFrom-Json -AsHashtable } else { @{ targets = @{} } }
if (-not $report.ContainsKey('targets')) { $report.targets = @{} }
$report.targets['update-envelope'] = [ordered]@{
    date = $started.ToString('s')
    seconds = $Seconds
    elapsedS = [int]((Get-Date) - $started).TotalSeconds
    seed = $Seed
    sanitizers = 'ASan + UBSan'
    inputs = $counts
    crashes = $(if ($rc -eq 0) { 0 } else { 1 })
    exitCode = $rc
    corpus = 'tests/update-vectors (valid, keyset, bad/*)'
}
$report | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $reportPath
Write-Host "fuzz update-envelope: exit $rc -> $reportPath"
exit $rc
