# Khung kiem tich hop x64 cua driver OPC UA client (feature 019 T021, T022; specs/019-driver-opcua).
# Dung: ./tools/driver-it-opcua.ps1 -Scenario read,write,errors,reconnect,security,load [-Seconds 60] [-Clients 10]
#        [-BuildDir C:\build\<ten>] [-NoBuild] [-Keep]
#   read:      100 % Tag khop server (moi kieu, NodeId chuoi va so, DateTime), subscription 250/1000/5000.
#   write:     ghi moi kieu: CONFIRMED (readback), gia tri song; node chi doc DEVICE_EXCEPTION; gioi han; audit.
#   errors:    node khong co, mang, ngoai khoang: chi Tag do BAD; Tag khac GOOD.
#   reconnect: dung server (docker stop): BAD DISCONNECTED; chay lai: GOOD, subscription tao lai, runtime khong khoi dong lai.
#   security:  Basic256Sha256 SignAndEncrypt, user operator (mat khau dat bang --set-secret), chung chi server ghim;
#              duyet node qua POST /api/v1/drivers/opcua/browse; ghim sai -> OPCUA_CERT_UNTRUSTED.
#   load:      500 node doi moi 1 s, -Clients client xem du 500 Tag trong -Seconds giay; do CPU, RSS.
# Mang, container: tests/driver-it-opcua/compose.yaml (du an mat-opcua-it, mang 172.30.19.0/24). Mat khau thu sinh
# ngau nhien moi lan chay, chi o bien moi truong. Ket qua: docs/reports/019-opcua-<scenario>-x64.json.
# Don khi dung -Keep: docker compose -p mat-opcua-it down -v
# (Thong bao in ra khong dau: Windows PowerShell 5.1 doc file .ps1 khong BOM theo codepage ANSI.)
param(
    [ValidateSet('read', 'write', 'errors', 'reconnect', 'security', 'load')][string[]]$Scenario = @('read', 'write', 'errors', 'reconnect', 'security', 'load'),
    [int]$Seconds = 60,
    [int]$Clients = 10,
    [switch]$Keep,
    [string]$BuildDir = '',
    [switch]$NoBuild
)
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path "$PSScriptRoot/..").Path
. "$PSScriptRoot/lib/platform.ps1"
if (-not $BuildDir) { $BuildDir = Get-MatBuildDir 'mat-x64-opcuait' }
$compose = "$root/tests/driver-it-opcua/compose.yaml"
$utf8 = New-Object Text.UTF8Encoding $false
$project = 'mat-opcua-it'
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
    docker run --rm --name "uait-build-$PID" -v "${root}:/src" -v "${BuildDir}:/build" mat-armhf sh -c 'cmake -S . -B /build/x64 -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null && cmake --build /build/x64 --target mat-runtime mat-opcua-sim -j 2'
    if ($LASTEXITCODE) { throw 'build failed' }
}

# $SimArgs: extra arguments of mat-opcua-sim; $ProjectPath: path of the project inside rt.
function Start-Rig([string]$ProjectPath, [string]$SimArgs, [scriptblock]$BeforeRt) {
    $env:MAT_IT_BUILD = $BuildDir
    $env:MAT_IT_PROJECT = $ProjectPath
    $env:MAT_IT_SIM_ARGS = $SimArgs
    docker compose -f $compose -p $project down -v *> $null
    Write-Host "starting sim ($SimArgs)..."
    docker compose -f $compose -p $project up -d sim 2>&1 | Out-Null
    if ($LASTEXITCODE) { throw 'compose up sim failed' }
    Wait-Until { (docker logs $sim 2>&1 | Select-String 'ready 4840') } 60 'sim ready' | Out-Null
    if ($BeforeRt) { & $BeforeRt }
    Write-Host "starting rt ($ProjectPath) and the Node client..."
    docker compose -f $compose -p $project up -d 2>&1 | Out-Null
    if ($LASTEXITCODE) { throw 'compose up failed' }
    Wait-Until {
        docker exec $rt grep -q 'https ok on :8443' /logs/runtime.log 2>$null
        $LASTEXITCODE -eq 0
    } 60 'rt HTTPS' | Out-Null
}

function Stop-Rig {
    if (-not $Keep) { docker compose -f $compose -p $project down -v *> $null }
    Remove-Item Env:MAT_IT_PW_ADMIN, Env:MAT_IT_PW_KYSU1, Env:MAT_IT_PW_VH1, Env:MAT_IT_BUILD, Env:MAT_IT_PROJECT, Env:MAT_IT_SIM_ARGS, Env:MAT_IT_UA_PW -ErrorAction SilentlyContinue
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
        $client node --no-warnings /src/tests/driver-it-opcua/opcua-it.mjs @ClientArgs --fp $Fp
    $line = ($out | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1)
    if (-not $line) { throw "client $ClientArgs wrote no result: $out" }
    return $line | ConvertFrom-Json
}

function Write-Result([string]$Name, $Result) {
    $json = $Result | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText("$root/docs/reports/019-opcua-$Name-x64.json", $json + "`n", $utf8)
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
    $plain = @($Scenario | Where-Object { @('read', 'write', 'errors', 'reconnect') -contains $_ })
    if ($plain.Count) {
        Start-Rig '/src/tests/driver-it-opcua/projects/read-all-types-opcua' '' $null
        New-Accounts
        $fp = Get-Fingerprint
        foreach ($s in $plain) {
            Write-Host "--- $s"
            if ($s -eq 'reconnect') {
                $r1 = Invoke-Client @('reconnect-before') $fp
                docker compose -f $compose -p $project stop sim 2>&1 | Out-Null
                $r2 = Invoke-Client @('reconnect-down') $fp
                docker compose -f $compose -p $project start sim 2>&1 | Out-Null
                $r3 = Invoke-Client @('reconnect-up') $fp
                $res = [pscustomobject]@{
                    scenario = 'reconnect'
                    checks   = @($r1.checks) + @($r2.checks) + @($r3.checks)
                    measures = [pscustomobject]@{ badMs = $r2.measures.badMs; goodMs = $r3.measures.goodMs; reconnects = $r3.measures.reconnects }
                    pass     = ($r1.pass -and $r2.pass -and $r3.pass)
                }
            }
            else { $res = Invoke-Client @($s) $fp }
            Write-Result $s $res
            if (-not $res.pass) { $failed += $s }
        }
        if (-not $Keep) { docker compose -f $compose -p $project down -v *> $null }
    }
    if ($Scenario -contains 'security') {
        $simPw = New-Secret 20
        $env:MAT_IT_UA_PW = $simPw
        $projDir = Join-Path $BuildDir 'opcua-it'
        Start-Rig '/build/opcua-it/secure-opcua' "--secure --no-anonymous --user operator:$simPw" {
            $pin = (docker exec $sim cat /simcerts/server-cert.sha256).Trim()
            if ($pin -notmatch '^[0-9a-f]{64}$') { throw "no server certificate SHA-256: $pin" }
            node "$root/tests/driver-it-opcua/make-projects.mjs" --secure $pin --out $projDir
            if ($LASTEXITCODE) { throw 'make-projects --secure failed' }
        }
        New-Accounts
        # the password of the server on the device only (secrets.json), never in the project
        $out = docker exec -e MAT_IT_UA_PW $rt sh -c 'printf "%s\n" "$MAT_IT_UA_PW" | /build/x64/bin/mat-runtime --set-secret opcua-ua-1' 2>&1
        if ($LASTEXITCODE) { throw "--set-secret failed: $out" }
        $fp = Get-Fingerprint
        Write-Host '--- security'
        $res = Invoke-Client @('security', '--project', '/build/opcua-it/secure-opcua') $fp
        Write-Result 'security' $res
        if (-not $res.pass) { $failed += 'security' }
        if (-not $Keep) { docker compose -f $compose -p $project down -v *> $null }
        Remove-Item -Recurse -Force $projDir -ErrorAction SilentlyContinue
    }
    if ($Scenario -contains 'load') {
        Start-Rig '/src/tests/driver-it-opcua/projects/bench-500-opcua' '--bench 500' $null
        New-Accounts
        $fp = Get-Fingerprint
        Write-Host '--- load'
        $res = Invoke-Client @('load', '--seconds', "$Seconds", '--clients', "$Clients") $fp
        Write-Result 'load' $res
        if (-not $res.pass) { $failed += 'load' }
    }
}
finally {
    Stop-Rig
}
if ($failed.Count) {
    Write-Host ("FAILED: " + ($failed -join ', ')) -ForegroundColor Red
    exit 1
}
Write-Host 'driver-it-opcua: all scenarios passed' -ForegroundColor Green
exit 0
