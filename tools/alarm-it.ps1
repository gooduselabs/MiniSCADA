# Kiem tich hop x64 cua feature 009 (specs/009-alarms T039, T040, T065, T099, T111-T116; quickstart §3).
# Dung: ./tools/alarm-it.ps1 -Scenario state,quality,restart,killloop,auth,attack,storm,compat,latency,history,budget
#        [-Rounds 100] [-Keep] [-NoBuild] [-BuildDir C:\build\w4-x64-i]
#   state:     digital, limit (H/HH, deadband, tre bat 3 s), ack, ack hang loat, shelve, disable qua API that; live nhat quan.
#   quality:   mat ket noi thiet bi (giả lap Modbus tu choi ket noi): alarm quality theo thiet bi va theo Tag, limit giu nguyen (inputBad).
#   restart:   SIGTERM va kill -9 (dieu kien het khi runtime chet): trang thai dung lai, --alarm-db-check.
#   killloop:  -Rounds vong kill -9 ngau nhien, integrity_check = ok, 0 ack khong audit (SC-008).
#   auth:      khach, viewer, operator, engineer (cookie va Bearer): ack, shelve, disable; audit du truong, audit truoc.
#   attack:    bo ca tan cong tools/alarm-it/attack-cases.mjs (SC-007).
#   storm:     200 alarm cung bat, 10 client live (3 cham): hang doi, 4409, tre tick (tools/alarm-it/storm.mjs).
#   compat:    client live 1.2.0 dong bang voi server 1.3.0; client 1.3.0 voi server gia 1.2.0; project 0.3/0.4.
#   latency:   Chrome headless, 100 lan doi Tag qua nguong, do Tag doi -> DOM banner doi (SC-003).
#   history:   100.000 lan xay ra (tools/alarm-history-seed): truy van <= 1 s, xuat 50.000 dong <= 10 s (SC-013).
#   budget:    alarm-200 + 500 Tag mo phong + 10 client Chrome, CPU/RSS bat va tat alarm (SC-011, tham khao).
# Rig: tests/alarm-it/compose.yaml (cong 28080/28443/28503). Mat khau thu sinh ngau nhien moi lan chay, khong ghi file.
# Ket qua: docs/reports/009-<scenario>-x64.json. Don khi dung -Keep: docker compose -f tests/alarm-it/compose.yaml -p mat-alarm-it down -v
# (Thong bao in ra khong dau: Windows PowerShell 5.1 doc file .ps1 khong BOM theo codepage ANSI.)
param(
    [ValidateSet('state', 'quality', 'restart', 'killloop', 'auth', 'attack', 'storm', 'compat', 'latency', 'history', 'budget')][string[]]$Scenario = @('state'),
    [int]$Rounds = 100,
    [int]$Seconds = 600,
    [switch]$Keep,
    [string]$BuildDir = '',
    [switch]$NoBuild
)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding
$root = (Resolve-Path "$PSScriptRoot/..").Path
. "$PSScriptRoot/lib/platform.ps1"
if (-not $BuildDir) { $BuildDir = Get-MatBuildDir 'w4-x64-i' }
$compose = "$root/tests/alarm-it/compose.yaml"
$utf8 = New-Object Text.UTF8Encoding $false
$project = 'mat-alarm-it'
$rt = "$project-rt-1"
$bin = '/build/x64/bin/mat-runtime'
$env:MAT_IT_RT = $rt

function New-Secret([int]$Length) {
    $chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    $bytes = New-Object byte[] $Length
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Wait-Until([scriptblock]$Cond, [int]$TimeoutS, [string]$What) {
    $deadline = (Get-Date).AddSeconds($TimeoutS)
    while ((Get-Date) -lt $deadline) {
        $v = & $Cond
        if ($v) { return $v }
        Start-Sleep -Milliseconds 500
    }
    throw "timeout waiting for $What"
}

function Build-Runtime {
    docker build -q -t mat-armhf "$root/deployment/toolchain" | Out-Null
    if ($LASTEXITCODE) { throw 'docker build failed' }
    New-Item -ItemType Directory -Force $BuildDir | Out-Null
    docker run --rm --name ("w4-i-" + (Get-Random)) -v "${root}:/src" -v "${BuildDir}:/build" mat-armhf sh -c 'cmake -S . -B /build/x64 -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null && cmake --build /build/x64 --target mat-runtime -j 2'
    if ($LASTEXITCODE) { throw 'build failed' }
}

function Start-Rig([string]$ProjectPath, [string]$Map = '/src/tests/alarm-it/map.json', [string[]]$ExtraArgs = @()) {
    $env:MAT_IT_BUILD = $BuildDir
    $env:MAT_IT_PROJECT = $ProjectPath
    $env:MAT_IT_MAP = $Map
    docker compose -f $compose -p $project down -v *> $null
    Write-Host "starting rt ($ProjectPath) and the Modbus simulator..."
    docker compose -f $compose -p $project up -d 2>&1 | Out-Null
    if ($LASTEXITCODE) { throw 'compose up failed' }
    Wait-Until {
        docker exec $rt grep -q 'https ok on :8443' /logs/runtime.log 2>$null
        $LASTEXITCODE -eq 0
    } 90 'rt HTTPS' | Out-Null
    New-Accounts
    $env:MAT_IT_FP = Get-Fingerprint
}

function Stop-Rig {
    if (-not $Keep) { docker compose -f $compose -p $project down -v *> $null }
    Remove-Item Env:MAT_IT_PW_ADMIN, Env:MAT_IT_PW_KYSU1, Env:MAT_IT_PW_VH1, Env:MAT_IT_PW_VH2, Env:MAT_IT_PW_XEM1, Env:MAT_IT_BUILD, Env:MAT_IT_PROJECT, Env:MAT_IT_MAP, Env:MAT_IT_FP -ErrorAction SilentlyContinue
}

function New-Accounts {
    $env:MAT_IT_PW_ADMIN = New-Secret 24
    $env:MAT_IT_PW_KYSU1 = New-Secret 24
    $env:MAT_IT_PW_VH1 = New-Secret 24
    $env:MAT_IT_PW_VH2 = New-Secret 24
    $env:MAT_IT_PW_XEM1 = New-Secret 24
    foreach ($a in @(@('admin', 'administrator', 'MAT_IT_PW_ADMIN'), @('kysu1', 'engineer', 'MAT_IT_PW_KYSU1'), @('vh1', 'operator', 'MAT_IT_PW_VH1'), @('vh2', 'operator', 'MAT_IT_PW_VH2'), @('xem1', 'viewer', 'MAT_IT_PW_XEM1'))) {
        $out = docker exec -e $a[2] $rt sh /src/tests/device-it/add-user.sh $a[0] $a[1] $a[2] 2>&1
        if ($LASTEXITCODE) { throw "--user-add $($a[0]) failed: $out" }
    }
}

function Get-Fingerprint {
    $line = docker exec $rt $bin --cert-fingerprint --data-dir /data | Select-String 'Fingerprint='
    if (-not $line) { throw '--cert-fingerprint failed' }
    return ($line.ToString() -replace '^.*=', '' -replace ':', '').ToLower()
}

# Chay mot script Node (tools/alarm-it/*.mjs), doc dong JSON cuoi cung va ghi docs/reports/009-<ten>-x64.json.
function Invoke-Node([string]$Name, [string]$Script, [string[]]$NodeArgs = @()) {
    Write-Host "--- $Name"
    $out = node "$root/tools/alarm-it/$Script" @NodeArgs 2>&1
    $line = ($out | Where-Object { "$_".Trim().StartsWith('{') } | Select-Object -Last 1)
    if (-not $line) { Write-Host ($out -join "`n"); throw "$Name wrote no result" }
    $res = $line | ConvertFrom-Json
    $json = $res | ConvertTo-Json -Depth 12
    [IO.File]::WriteAllText("$root/docs/reports/009-$Name-x64.json", $json + "`n", $utf8)
    $bad = @($res.checks | Where-Object { -not $_.pass })
    Write-Host ("{0}: {1} checks, {2} failed" -f $Name, @($res.checks).Count, $bad.Count)
    foreach ($b in $bad) { Write-Host ("  FAIL {0}: {1}" -f $b.name, $b.detail) -ForegroundColor Red }
    if ($res.measures) { Write-Host ("  measures: " + ($res.measures | ConvertTo-Json -Depth 4 -Compress)) }
    if ($res.pass) { Write-Host "$Name scenario PASS" -ForegroundColor Green } else { Write-Host "$Name scenario FAILED" -ForegroundColor Red }
    return $res
}

$failed = @()
try {
    if (-not $NoBuild) { Build-Runtime }
    $needWeb = $Scenario | Where-Object { $_ -in @('latency', 'history', 'budget') }
    if ($needWeb -and -not (Test-Path "$root/apps/runtime-web/dist-device/index.html")) {
        Push-Location $root
        npm run build -w '@mat/runtime-web' 2>&1 | Out-Host
        Pop-Location
    }
    $basic = @('state', 'quality', 'restart', 'killloop', 'auth', 'attack', 'latency')
    $todo = @($basic | Where-Object { $Scenario -contains $_ })
    if ($todo.Count) {
        Start-Rig '/src/tests/alarm-it/projects/it-basic'
        foreach ($s in $todo) {
            $res = switch ($s) {
                'killloop' { Invoke-Node $s 'scenarios.mjs' @($s, '--rounds', "$Rounds") }
                'attack' { Invoke-Node $s 'attack-cases.mjs' }
                'latency' { Invoke-Node $s 'browser.mjs' @('latency', '--root', $root, '--n', "$([int]$Rounds / 2)") }
                default { Invoke-Node $s 'scenarios.mjs' @($s) }
            }
            if (-not $res.pass) { $failed += $s }
        }
        Stop-Rig
    }
    if ($Scenario -contains 'storm') {
        Start-Rig '/src/tests/alarm-it/projects/storm-200'
        $res = Invoke-Node 'storm' 'storm.mjs'
        if (-not $res.pass) { $failed += 'storm' }
        Stop-Rig
    }
    if ($Scenario -contains 'compat') {
        Start-Rig '/src/tests/alarm-it/projects/it-basic'
        $res = Invoke-Node 'compat' 'compat.mjs' @('--root', $root)
        if (-not $res.pass) { $failed += 'compat' }
        Stop-Rig
    }
    if ($Scenario -contains 'history') {
        # browser.mjs dung rig rieng: nap alarm.db 100.000 dong vao volume truoc khi runtime chay
        $env:MAT_IT_BUILD = $BuildDir
        $res = Invoke-Node 'history' 'browser.mjs' @('history', '--root', $root)
        if (-not $res.pass) { $failed += 'history' }
        docker compose -f $compose -p $project down -v *> $null
    }
    if ($Scenario -contains 'budget') {
        $env:MAT_IT_BUILD = $BuildDir
        $res = Invoke-Node 'budget' 'browser.mjs' @('budget', '--seconds', "$Seconds", '--root', $root)
        if (-not $res.pass) { $failed += 'budget' }
    }
}
finally {
    Stop-Rig
}
if ($failed.Count) {
    Write-Host ("FAILED: " + ($failed -join ', ')) -ForegroundColor Red
    exit 1
}
Write-Host 'alarm-it: all scenarios passed' -ForegroundColor Green
exit 0
