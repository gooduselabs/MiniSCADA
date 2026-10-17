# SAST of the C++ code: cppcheck and clang-tidy in the toolchain container (specs/011-pilot-hardening
# T055, FR-028, SC-009; research R11).
# Use: ./tools/sast/run.ps1 [-Tool all|cppcheck|clang-tidy] [-Jobs 2] [-BuildDir <dir>] [-Paths core,server,drivers]
#      [-NoImageBuild]
# Scope: the production sources of -Paths (the .cpp files of compile_commands.json under those folders,
# without */tests/*) and the headers they include from the same folders. third_party/ is not analysed.
# Steps (all in the container mat-armhf, deployment/toolchain/Dockerfile: cppcheck 1.90, clang-tidy-10):
#   1. CMake x64 Debug configure with CMAKE_EXPORT_COMPILE_COMMANDS into <BuildDir>/x64 (no build).
#   2. compile_commands.json filtered to the scope -> <BuildDir>/sast/compile_commands.json.
#   3. cppcheck  --enable=warning,performance,portability, libraries std, posix, sqlite3 and
#      tools/sast/cppcheck.cfg, suppressions tools/sast/suppressions.txt -> <BuildDir>/sast/cppcheck.txt
#   4. run-clang-tidy-10 with tools/sast/clang-tidy.yaml -> <BuildDir>/sast/clang-tidy.txt
# Result: findings grouped by severity and check on screen, <BuildDir>/sast/findings.json (unique by
# file, line and check). Exit 0 when no cppcheck error/warning and no clang-tidy warning is left; 1 when
# some are (each must be fixed, kept with an in-code NOLINT / cppcheck-suppress and a reason, or
# recorded as a false positive: docs/reports/011-sast.md); 2 when a tool did not run.
# Time (macOS host, 4 CPU shared, -Jobs 2, 177 files): cppcheck about 10 s; clang-tidy about 1-2 h
# (the clang static analyzer on every file).
param(
    [ValidateSet('all', 'cppcheck', 'clang-tidy')]
    [string]$Tool = 'all',
    [int]$Jobs = 2,
    [string]$BuildDir = '',
    [string[]]$Paths = @('core', 'server', 'drivers'),
    [switch]$NoImageBuild
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot/../..").Path
. "$root/tools/lib/platform.ps1"
if (-not $BuildDir) { $BuildDir = Get-MatBuildDir 'mat-sast' }
New-Item -ItemType Directory -Force (Join-Path $BuildDir 'sast') | Out-Null
foreach ($p in $Paths) { if ($p -notmatch '^[A-Za-z0-9_-]+$') { throw "bad path '$p' (a top folder name)" } }

if (-not $NoImageBuild) {
    docker build -q -t mat-armhf "$root/deployment/toolchain" | Out-Null
    if ($LASTEXITCODE) { throw 'docker build failed' }
}

$pathRe = ($Paths -join '|')
$runCpp = if ($Tool -in 'all', 'cppcheck') { '1' } else { '0' }
$runTidy = if ($Tool -in 'all', 'clang-tidy') { '1' } else { '0' }
# The script runs in the container; PowerShell 5.1 strips the quotes of an argument of a native
# command, so it goes in a file (as tools/fuzz-modbus.ps1).
$sh = @'
set -u
cd /src
cmake -S /src -B /build/x64 -G Ninja -DCMAKE_BUILD_TYPE=Debug -DCMAKE_EXPORT_COMPILE_COMMANDS=ON > /build/sast/cmake.log 2>&1 || { echo "SAST: cmake configure failed (see sast/cmake.log)"; exit 2; }
python3 - <<'PY' || exit 2
import json, re
cc = json.load(open('/build/x64/compile_commands.json'))
# a source linked into several targets (the tests link server/*.cpp) is listed once per target
keep, seen = [], set()
for e in cc:
    f = e['file']
    if re.match(r'/src/(@PATHS@)/', f) and '/tests/' not in f and f not in seen:
        seen.add(f)
        keep.append(e)
json.dump(keep, open('/build/sast/compile_commands.json', 'w'), indent=1)
print('SAST: %d files in scope' % len(keep))
PY
rc=0
if [ "@CPP@" = 1 ]; then
  start=$(date +%s)
  cppcheck --version
  cppcheck --project=/build/sast/compile_commands.json --enable=warning,performance,portability \
    --std=c++17 --library=std --library=posix --library=sqlite3 --library=/src/tools/sast/cppcheck.cfg \
    --inline-suppr --suppressions-list=/src/tools/sast/suppressions.txt --config-exclude=/src/third_party \
    -j @JOBS@ -q --template='{file}:{line}:{severity}:{id}:{message}' 2> /build/sast/cppcheck.txt || rc=2
  echo "SAST: cppcheck $(( $(date +%s) - start )) s"
fi
if [ "@TIDY@" = 1 ]; then
  start=$(date +%s)
  clang-tidy-10 --version | grep -i version
  run-clang-tidy-10 -p /build/sast -j @JOBS@ -quiet -config="$(cat /src/tools/sast/clang-tidy.yaml)" \
    -header-filter='^/src/(@PATHS@)/' > /build/sast/clang-tidy.txt 2> /build/sast/clang-tidy.err
  echo "SAST: clang-tidy $(( $(date +%s) - start )) s"
  grep -q 'clang-tidy-10 ' /build/sast/clang-tidy.txt || { echo "SAST: clang-tidy did not run (see sast/clang-tidy.err)"; rc=2; }
fi
exit $rc
'@
$sh = $sh.Replace('@PATHS@', $pathRe).Replace('@CPP@', $runCpp).Replace('@TIDY@', $runTidy).Replace('@JOBS@', "$Jobs")
[IO.File]::WriteAllText((Join-Path $BuildDir 'sast/run.sh'), ($sh -replace "`r", '') + "`n", (New-Object Text.UTF8Encoding $false))

$name = "mat-sast-$PID"
Write-Host "SAST: $Tool, -Jobs $Jobs, scope $($Paths -join ', '), build dir $BuildDir"
docker run --rm --name $name --log-driver none -v "${root}:/src:ro" -v "${BuildDir}:/build" mat-armhf sh /build/sast/run.sh
$rc = $LASTEXITCODE
if ($rc -ge 2) { Write-Host "SAST: a tool did not run (exit $rc)" -ForegroundColor Red; exit 2 }

# Findings, unique by file, line and check; paths relative to the repository.
$findings = New-Object System.Collections.Generic.List[object]
$seen = @{}
function Add-Finding($tool, $file, $line, $severity, $check, $message) {
    $file = $file -replace '^/src/', ''
    $key = "$tool|$file|$line|$check"
    if ($seen.ContainsKey($key)) { return }
    $seen[$key] = $true
    $findings.Add([ordered]@{ tool = $tool; file = $file; line = [int]$line; severity = $severity; check = $check; message = $message.Trim() })
}
$cppFile = Join-Path $BuildDir 'sast/cppcheck.txt'
if ($runCpp -eq '1' -and (Test-Path $cppFile)) {
    foreach ($l in [IO.File]::ReadAllLines($cppFile)) {
        if ($l -match '^(.+?):(\d+):(\w+):(\w+):(.*)$') { Add-Finding 'cppcheck' $Matches[1] $Matches[2] $Matches[3] $Matches[4] $Matches[5] }
    }
}
$tidyFile = Join-Path $BuildDir 'sast/clang-tidy.txt'
if ($runTidy -eq '1' -and (Test-Path $tidyFile)) {
    foreach ($l in [IO.File]::ReadAllLines($tidyFile)) {
        if ($l -match '^(/src/[^:]+):(\d+):\d+: (warning|error): (.*) \[([^\]]+)\]$') { Add-Finding 'clang-tidy' $Matches[1] $Matches[2] $Matches[3] $Matches[5] $Matches[4] }
    }
}
$findings | Group-Object { "$($_.tool) $($_.severity) $($_.check)" } | Sort-Object Count -Descending |
    ForEach-Object { Write-Host ("{0,5}  {1}" -f $_.Count, $_.Name) }
$blocking = @($findings | Where-Object { $_.severity -in 'error', 'warning' })
$report = [ordered]@{
    scenario = 'sast'
    tools = $Tool
    scope = $Paths
    findings = $findings
    blocking = $blocking.Count
}
[IO.File]::WriteAllText((Join-Path $BuildDir 'sast/findings.json'), ($report | ConvertTo-Json -Depth 5) + "`n", (New-Object Text.UTF8Encoding $false))
foreach ($f in $blocking) { Write-Host ("{0}:{1}: {2} [{3}] {4}" -f $f.file, $f.line, $f.severity, $f.check, $f.message) }
if ($blocking.Count -eq 0) { Write-Host 'SAST PASS: 0 error/warning findings left' -ForegroundColor Green; exit 0 }
Write-Host "SAST: $($blocking.Count) error/warning findings to classify (docs/reports/011-sast.md)" -ForegroundColor Red
exit 1
