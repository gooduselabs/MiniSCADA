# Khung kiem tich hop x64 cua driver MQTT (feature 022; specs/022-driver-mqtt).
# Dung: ./tools/driver-it-mqtt.ps1 -Scenario read,write,reconnect,stale,load [-Seconds 60] [-Clients 10] [-Rate 50]
#        [-BuildDir C:\build\<ten>] [-NoBuild] [-Keep]
#   read:      so tho, JSON (+, mang), BOOL, chuoi UTF-8, #, payload hong -> MQTT_PAYLOAD, filter bi tu choi ->
#              MQTT_SUBSCRIBE_REFUSED, TLS ghim dung -> GOOD, ghim sai -> MQTT_CERT_UNTRUSTED; chan doan.
#   write:     pub QoS 1 retain JSON, both QoS 1 (nhan lai tin cua chinh no), ngoai limits bi tu choi, nhom publish
#              mat/rt/state moi giay va khi doi; audit.
#   reconnect: KICK -> broker gui di chuc (retain); DOWN -> BAD DISCONNECTED, ghi -> NOT_SENT; UP -> GOOD <= 5 s.
#   stale:     khong co tin 3 s -> UNCERTAIN MQTT_STALE giu gia tri; tin moi -> GOOD.
#   load:      500 Tag (nua so tho, nua JSON), -Rate tin/s trong -Seconds giay, -Clients client xem; do CPU, RSS.
# Mang, container: tests/driver-it-mqtt/compose.yaml (ten du an mat-mqtt-it, mang 172.30.22.0/24). Broker la
# mat-mqtt-sim cua cung ban build (khong dung image broker ben thu ba). Project sinh luc chay vao thu muc build
# (ghim SHA-256 chung chi broker vua sinh): tests/driver-it-mqtt/make-projects.mjs. Mat khau thu sinh ngau nhien moi lan
# chay, chi o bien moi truong. Ket qua: docs/reports/022-mqtt-<scenario>-x64.json.
# (Thong bao in ra khong dau: Windows PowerShell 5.1 doc file .ps1 khong BOM theo codepage ANSI.)
param(
    [ValidateSet('read', 'write', 'reconnect', 'stale', 'load')][string[]]$Scenario = @('read', 'write', 'reconnect', 'stale', 'load'),
    [int]$Seconds = 60,
    [int]$Clients = 10,
    [int]$Rate = 50,
    [switch]$Keep,
    [string]$BuildDir = '',
    [switch]$NoBuild
)
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path "$PSScriptRoot/..").Path
. "$PSScriptRoot/lib/platform.ps1"
if (-not $BuildDir) { $BuildDir = Get-MatBuildDir 'mat-x64-mqttit' }
$compose = "$root/tests/driver-it-mqtt/compose.yaml"
$utf8 = New-Object Text.UTF8Encoding $false
$project = 'mat-mqtt-it'
$rt = "$project-rt-1"
$sim = "$project-sim-1"
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
    docker run --rm --name "mqttit-build-$PID" -v "${root}:/src" -v "${BuildDir}:/build" mat-armhf sh -c 'cmake -S . -B /build/x64 -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null && cmake --build /build/x64 --target mat-runtime mat-mqtt-sim -j 2'
    if ($LASTEXITCODE) { throw 'build failed' }
}

function Start-Rig([string]$ProjectName) {
    $env:MAT_IT_BUILD = $BuildDir
    $env:MAT_IT_PROJECT = "/build/mqtt-it/$ProjectName"
    $env:MAT_IT_MQTT_PW = New-Secret 24
    docker compose -f $compose -p $project down -v *> $null
    Write-Host "starting the broker..."
    docker compose -f $compose -p $project up -d sim 2>&1 | Out-Null
    if ($LASTEXITCODE) { throw 'compose up sim failed' }
    $line = Wait-Until { docker logs $sim 2>&1 | Select-String 'mat-mqtt-sim: port .* cert ([0-9a-f]{64})' } 30 'broker'
    $pin = $line.Matches[0].Groups[1].Value
    node "$root/tests/driver-it-mqtt/make-projects.mjs" "$BuildDir/mqtt-it" $pin | Out-Null
    if ($LASTEXITCODE) { throw 'make-projects failed' }
    Write-Host "starting rt ($ProjectName) and the Node client..."
    docker compose -f $compose -p $project up -d 2>&1 | Out-Null
    if ($LASTEXITCODE) { throw 'compose up failed' }
    Wait-Until {
        docker exec $rt grep -q 'https ok on :8443' /logs/runtime.log 2>$null
        $LASTEXITCODE -eq 0
    } 60 'rt HTTPS' | Out-Null
    # the broker password of the channels, in the secrets of the device (read again at each connection attempt)
    $out = docker exec -e MAT_IT_MQTT_PW $rt sh -c 'printf "%s\n" "$MAT_IT_MQTT_PW" | /build/x64/bin/mat-runtime --set-secret mqtt-mq' 2>&1
    if ($LASTEXITCODE) { throw "--set-secret failed: $out" }
}

function Stop-Rig {
    if (-not $Keep) { docker compose -f $compose -p $project down -v *> $null }
    Remove-Item Env:MAT_IT_PW_ADMIN, Env:MAT_IT_PW_KYSU1, Env:MAT_IT_PW_VH1, Env:MAT_IT_BUILD, Env:MAT_IT_PROJECT, Env:MAT_IT_MQTT_PW -ErrorAction SilentlyContinue
}

function New-Accounts {
    $env:MAT_IT_PW_ADMIN = New-Secret 24
    $env:MAT_IT_PW_KYSU1 = New-Secret 24
    $env:MAT_IT_PW_VH1 = New-Secret 24
    foreach ($a in @(@('admin', 'administrator', 'MAT_IT_PW_ADMIN'), @('kysu1', 'engineer', 'MAT_IT_PW_KYSU1'), @('vh1', 'operator', 'MAT_IT_PW_VH1'))) {
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
    $out = docker exec -e MAT_IT_PW_ADMIN -e MAT_IT_PW_KYSU1 -e MAT_IT_PW_VH1 `
        $client node --no-warnings /src/tests/driver-it-mqtt/mqtt-it.mjs @ClientArgs --fp $Fp
    $line = ($out | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1)
    if (-not $line) { throw "client $ClientArgs wrote no result: $out" }
    return $line | ConvertFrom-Json
}

function Write-Result([string]$Name, $Result) {
    $json = $Result | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText("$root/docs/reports/022-mqtt-$Name-x64.json", $json + "`n", $utf8)
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
        @{ project = 'mqtt-it'; list = @('read', 'write', 'reconnect', 'stale') },
        @{ project = 'bench-500-mqtt'; list = @('load') }
    )
    foreach ($g in $groups) {
        $todo = @($g.list | Where-Object { $Scenario -contains $_ })
        if (-not $todo.Count) { continue }
        Start-Rig $g.project
        New-Accounts
        $fp = Get-Fingerprint
        foreach ($s in $todo) {
            Write-Host "--- $s"
            $a = @($s)
            if ($s -eq 'load') { $a += @('--seconds', "$Seconds", '--clients', "$Clients", '--rate', "$Rate") }
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
Write-Host 'driver-it-mqtt: all scenarios passed' -ForegroundColor Green
exit 0
