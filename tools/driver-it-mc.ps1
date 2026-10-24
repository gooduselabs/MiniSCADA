# Khung kiem tich hop x64 cua driver Mitsubishi MC (feature 017, specs/017-driver-mc T032, T050).
# Dung: ./tools/driver-it-mc.ps1 -Scenario read,merge,write,faults,unplug,load [-Rounds 6] [-Seconds 60]
#        [-Clients 10] [-Keep] [-NoBuild] [-BuildDir C:\build\mc-x64]
#   read:   100 % Tag khop ban do gia lap tren ca ba kenh (3E binary TCP, 4E ASCII TCP, 3E binary UDP).
#   merge:  so lenh moi vong quet bang so tinh truoc (Batch Read 0401 <= 960 diem, Random Read 0403 <= 192 diem).
#   write:  ghi moi kieu RW, CONFIRMED va bo nho gia lap giu gia tri; end code C05B cho 1401 -> DEVICE_EXCEPTION;
#           audit tag.write.
#   faults: end code C056 o mot dia chi (chi Tag do BAD MC_END_RANGE), chan doan dem end code, kenh kind mc;
#           im lang -> TIMEOUT roi GOOD; dong ket noi -> reconnects; byte rac -> BAD_FRAME roi GOOD.
#   unplug: -Rounds vong refuse/silent luan phien: moi Tag BAD <= 2 chu ky + timeout, GOOD <= 12 s, khong
#           khoi dong lai runtime.
#   load:   project bench-500-mc (500 Tag nhom 1 s), -Clients client xem du 500 Tag trong -Seconds giay:
#           CPU (mot nhan) trung binh va max 5 s, RSS max, mat sequence, chu ky.
# Mang, container: tests/driver-it/compose-mc.yaml (project compose mat-mc-it, mang 172.30.17.0/24): runtime
# x64 trong image mat-armhf duoi supervise.sh cua device-it, gia lap tools/mc-sim, client Node. Mat khau thu
# sinh ngau nhien moi lan chay, chi nam trong bien moi truong cua tien trinh nay va stdin cua --user-add.
# Ket qua: docs/reports/017-mc-<scenario>-x64.json.
# Don khi dung -Keep: $env:MAT_IT_BUILD = "<BuildDir>"; docker compose -f tests/driver-it/compose-mc.yaml -p mat-mc-it down -v
# (Thong bao in ra khong dau: Windows PowerShell 5.1 doc file .ps1 khong BOM theo codepage ANSI.)
param(
    [ValidateSet('read', 'merge', 'write', 'faults', 'unplug', 'load')][string[]]$Scenario = @('read', 'merge', 'write', 'faults', 'unplug', 'load'),
    [int]$Rounds = 6,
    [int]$Seconds = 60,
    [int]$Clients = 10,
    [switch]$Keep,
    [string]$BuildDir = '',
    [switch]$NoBuild
)
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path "$PSScriptRoot/..").Path
. "$PSScriptRoot/lib/platform.ps1"
if (-not $BuildDir) { $BuildDir = Get-MatBuildDir 'mc-it-x64' }
$compose = "$root/tests/driver-it/compose-mc.yaml"
$utf8 = New-Object Text.UTF8Encoding $false
$project = 'mat-mc-it'
$rt = "$project-rt-1"
$client = "$project-client-1"
$bin = '/build/x64/bin/mat-runtime'

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
    docker run --rm -v "${root}:/src" -v "${BuildDir}:/build" mat-armhf sh -c 'cmake -S . -B /build/x64 -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null && cmake --build /build/x64 --target mat-runtime -j 2'
    if ($LASTEXITCODE) { throw 'build failed' }
}

function Start-Rig([string]$ProjectName, [string]$Map) {
    $env:MAT_IT_BUILD = $BuildDir
    $env:MAT_IT_PROJECT = "/src/tests/driver-it/projects/$ProjectName"
    $env:MAT_IT_MAP = "/src/tools/mc-sim/maps/$Map.json"
    docker compose -f $compose -p $project down -v *> $null
    Write-Host "starting sim ($Map), rt ($ProjectName) and the Node client..."
    docker compose -f $compose -p $project up -d 2>&1 | Out-Null
    if ($LASTEXITCODE) { throw 'compose up failed' }
    Wait-Until {
        docker exec $rt grep -q 'https ok on :8443' /logs/runtime.log 2>$null
        $LASTEXITCODE -eq 0
    } 60 'rt HTTPS' | Out-Null
}

function Stop-Rig {
    if (-not $Keep) { docker compose -f $compose -p $project down -v *> $null }
    Remove-Item Env:MAT_IT_PW_ADMIN, Env:MAT_IT_PW_KYSU1, Env:MAT_IT_PW_VH1, Env:MAT_IT_PW_XEM1, Env:MAT_IT_BUILD, Env:MAT_IT_PROJECT, Env:MAT_IT_MAP -ErrorAction SilentlyContinue
}

function New-Accounts {
    $env:MAT_IT_PW_ADMIN = New-Secret 24
    $env:MAT_IT_PW_KYSU1 = New-Secret 24
    $env:MAT_IT_PW_VH1 = New-Secret 24
    $env:MAT_IT_PW_XEM1 = New-Secret 24
    foreach ($a in @(@('admin', 'administrator', 'MAT_IT_PW_ADMIN'), @('kysu1', 'engineer', 'MAT_IT_PW_KYSU1'), @('vh1', 'operator', 'MAT_IT_PW_VH1'), @('xem1', 'viewer', 'MAT_IT_PW_XEM1'))) {
        $out = docker exec -e $a[2] $rt sh /src/tests/device-it/add-user.sh $a[0] $a[1] $a[2] 2>&1
        if ($LASTEXITCODE) { throw "--user-add $($a[0]) failed: $out" }
    }
}

function Get-Fingerprint {
    $line = docker exec $rt $bin --cert-fingerprint --data-dir /data | Select-String 'Fingerprint='
    if (-not $line) { throw '--cert-fingerprint failed' }
    return ($line.ToString() -replace '^.*=', '' -replace ':', '').ToLower()
}

function Invoke-Client([string[]]$ClientArgs, [string]$Fp) {
    $out = docker exec -e MAT_IT_PW_ADMIN -e MAT_IT_PW_KYSU1 -e MAT_IT_PW_VH1 -e MAT_IT_PW_XEM1 `
        $client node --no-warnings /src/tests/driver-it/mc-it.mjs @ClientArgs --fp $Fp
    $line = ($out | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1)
    if (-not $line) { throw "client $ClientArgs wrote no result: $out" }
    return $line | ConvertFrom-Json
}

function Write-Result([string]$Name, $Result) {
    $json = $Result | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText("$root/docs/reports/017-mc-$Name-x64.json", $json + "`n", $utf8)
    $bad = @($Result.checks | Where-Object { -not $_.pass })
    Write-Host ("{0}: {1} checks, {2} failed" -f $Name, $Result.checks.Count, $bad.Count)
    foreach ($b in $bad) { Write-Host ("  FAIL {0}: {1}" -f $b.name, $b.detail) -ForegroundColor Red }
    if ($Result.measures) { Write-Host ("  measures: " + ($Result.measures | ConvertTo-Json -Depth 5 -Compress)) }
    if ($Result.pass) { Write-Host "$Name scenario PASS" -ForegroundColor Green }
    else { Write-Host "$Name scenario FAILED" -ForegroundColor Red }
}

$failed = @()
try {
    if (-not $NoBuild) { Build-Runtime }
    $groups = @(
        @{ project = 'mc-all-types'; map = 'it-all-types'; list = @('read', 'merge', 'write', 'faults', 'unplug') },
        @{ project = 'bench-500-mc'; map = 'bench-500'; list = @('load') }
    )
    foreach ($g in $groups) {
        $todo = @($g.list | Where-Object { $Scenario -contains $_ })
        if (-not $todo.Count) { continue }
        Start-Rig $g.project $g.map
        New-Accounts
        $fp = Get-Fingerprint
        foreach ($s in $todo) {
            Write-Host "--- $s"
            $a = @($s)
            if ($s -eq 'unplug') { $a += @('--rounds', "$Rounds") }
            if ($s -eq 'load') { $a += @('--seconds', "$Seconds", '--clients', "$Clients") }
            $res = Invoke-Client $a $fp
            Write-Result $s $res
            if (-not $res.pass) { $failed += $s }
        }
        if (-not $Keep) { docker compose -f $compose -p $project down -v *> $null }
    }
}
finally {
    Stop-Rig
}
if ($failed.Count) {
    Write-Host ("FAILED: " + ($failed -join ', ')) -ForegroundColor Red
    exit 1
}
Write-Host 'driver-it-mc: all scenarios passed' -ForegroundColor Green
exit 0
