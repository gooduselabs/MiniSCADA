# Fuzz C++ duoi ASan + UBSan (feature 011 T058, T142; FR-029): logic-json, package (.matscada), project-json,
# expression, modbus (khung TCP/RTU), update-envelope (.matupdate).
# Dung: ./tools/fuzz/cpp/run.ps1 [-Seconds 3600] [-Seed 20261017] [-Targets logic-json,package] [-BuildDir <thu muc>]
# Chay tools/fuzz/cpp/run.sh trong Docker mat-armhf (build rieng, -j2 roi -j1 neu bi OOM), moi muc tieu -Seconds,
# lan luot. Ket qua: khoa "cpp" cua docs/reports/011-fuzz-x64.json (so dau vao, thoi gian, ma thoat tung muc tieu).
param(
    [int]$Seconds = 3600,
    [UInt64]$Seed = 20261017,
    [string[]]$Targets = @('logic-json', 'package', 'project-json', 'expression', 'modbus', 'update-envelope'),
    [string]$BuildDir = ''
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot/../../..").Path
. "$root/tools/lib/platform.ps1"
if (-not $BuildDir) { $BuildDir = Get-MatBuildDir 'mat-x64-asan-fuzz' }
New-Item -ItemType Directory -Force $BuildDir | Out-Null
$name = "fuzz-cpp-$PID"
$started = Get-Date
$out = docker run --rm --name $name -v "${root}:/src" -v "${BuildDir}:/build" mat-armhf `
    sh /src/tools/fuzz/cpp/run.sh /build/asan $Seconds $Seed ($Targets -join ',') 2>&1
$rc = $LASTEXITCODE
$out | ForEach-Object { Write-Host $_ }
$reportPath = Join-Path $root 'docs/reports/011-fuzz-x64.json'
$report = if (Test-Path $reportPath) { Get-Content -Raw $reportPath | ConvertFrom-Json -AsHashtable } else { @{} }
if (-not $report.ContainsKey('cpp')) { $report.cpp = [ordered]@{ targets = [ordered]@{} } }
foreach ($t in $Targets) {
    $line = @($out | Where-Object { "$_" -match "^fuzz ${t}: exit (\d+), (\d+) s" }) | Select-Object -Last 1
    if (-not $line) { continue }
    $null = "$line" -match "^fuzz ${t}: exit (\d+), (\d+) s"
    $code = [int]$Matches[1]; $elapsed = [int]$Matches[2]
    $summary = @($out | Where-Object { "$_" -match '^fuzz [\w-]+: \d+ (inputs|variants)' -and "$_" -notmatch 'exit' }) |
        Where-Object { "$_" -match "^fuzz ($t|$($t -replace '-json','')|$($t -replace '-', ' '))" } | Select-Object -Last 1
    $report.cpp.targets[$t] = [ordered]@{
        date = $started.ToString('s')
        seconds = $Seconds
        elapsedS = $elapsed
        seed = $Seed
        sanitizers = 'ASan + UBSan (RelWithDebInfo, halt_on_error)'
        summary = "$summary"
        crashes = $(if ($code -eq 0) { 0 } else { 1 })
        exitCode = $code
        runner = 'tools/fuzz/cpp/run.ps1 (tools/fuzz/cpp/run.sh)'
    }
}
$report | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $reportPath
Write-Host "fuzz cpp: exit $rc -> $reportPath"
exit $rc
