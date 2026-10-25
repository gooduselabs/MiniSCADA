# Kiem tich hop x64 cua feature 023 (email alarm; specs/023-alarm-email T040, T041): runtime x64 trong Docker phat alarm ->
# email toi may chu SMTP gia co STARTTLS (tools/email-it/fake-smtp.mjs), gui thu, gom, het alarm, mat mang + khoi dong lai
# -> gui bu, gioi han email/gio, audit, RAM/CPU. -Reminder them kich ban nhac lai (~6 phut).
# Dung: ./tools/email-it.ps1 [-BuildDir C:\build\email-x64] [-NoBuild] [-Keep] [-Reminder]
# Rig: tests/email-it/compose.yaml (cong 29080/29443/29503/29580). Chung chi thu va mat khau sinh moi lan chay, xoa khi xong.
# Ket qua: docs/reports/023-email-x64.json. Thong bao khong dau (PowerShell 5.1 doc file khong BOM theo codepage ANSI).
param([string]$BuildDir = '', [switch]$NoBuild, [switch]$Keep, [switch]$Reminder)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$root = (Resolve-Path "$PSScriptRoot/..").Path
. "$PSScriptRoot/lib/platform.ps1"
if (-not $BuildDir) { $BuildDir = Get-MatBuildDir 'email-x64' }
$compose = "$root/tests/email-it/compose.yaml"
$project = 'mat-email-it'
$rt = "$project-rt-1"
$certs = Get-MatBuildDir 'email-it-certs'
$utf8 = New-Object Text.UTF8Encoding $false

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
        if (& $Cond) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "timeout waiting for $What"
}

$pass = $false
try {
    docker build -q -t mat-armhf "$root/deployment/toolchain" | Out-Null
    if (-not $NoBuild) {
        New-Item -ItemType Directory -Force $BuildDir | Out-Null
        docker run --rm --name ("w4-email-" + (Get-Random)) -v "${root}:/src" -v "${BuildDir}:/build" mat-armhf sh -c 'cmake -S . -B /build/x64 -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null && cmake --build /build/x64 --target mat-runtime -j 2'
        if ($LASTEXITCODE) { throw 'build failed' }
    }
    # Chung chi thu EC P-256 cho may chu SMTP gia, ten "smtp" (rt kiem bang caFile /certs/cert.pem + ten may).
    Remove-Item -Recurse -Force $certs -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force $certs | Out-Null
    docker run --rm -v "${certs}:/c" mat-armhf sh -c "openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout /c/key.pem -out /c/cert.pem -days 2 -subj /CN=smtp -addext subjectAltName=DNS:smtp 2>/dev/null && chmod 644 /c/key.pem /c/cert.pem"
    if ($LASTEXITCODE -or -not (Test-Path "$certs/cert.pem")) { throw 'openssl failed' }

    $env:MAT_IT_BUILD = $BuildDir
    $env:MAT_IT_CERTS = $certs
    $env:MAT_IT_SMTP_PW = New-Secret 24
    $env:MAT_IT_PW_ADMIN = New-Secret 24
    docker compose -f $compose -p $project down -v *> $null
    docker compose -f $compose -p $project up -d 2>&1 | Out-Null
    if ($LASTEXITCODE) { throw 'compose up failed' }
    Wait-Until { docker exec $rt grep -q 'https ok on :8443' /logs/runtime.log 2>$null; $LASTEXITCODE -eq 0 } 90 'rt HTTPS'
    $out = docker exec -e MAT_IT_PW_ADMIN $rt sh /src/tests/device-it/add-user.sh admin administrator MAT_IT_PW_ADMIN 2>&1
    if ($LASTEXITCODE) { throw "--user-add admin failed: $out" }
    # Mat khau SMTP vao bi mat thiet bi (nhu tren BL335: sudo mat-runtime --set-secret smtp), qua stdin.
    $out = docker exec -e MAT_IT_SMTP_PW $rt sh -c 'printf "%s\n" "$MAT_IT_SMTP_PW" | /build/x64/bin/mat-runtime --set-secret smtp' 2>&1
    if ($LASTEXITCODE) { throw "--set-secret smtp failed: $out" }
    $line = docker exec $rt /build/x64/bin/mat-runtime --cert-fingerprint --data-dir /data | Select-String 'Fingerprint='
    if (-not $line) { throw '--cert-fingerprint failed' }
    $env:MAT_IT_FP = ($line.ToString() -replace '^.*=', '' -replace ':', '').ToLower()
    $env:MAT_IT_HTTPS = 'https://127.0.0.1:29443'
    $env:MAT_IT_HTTP = 'http://127.0.0.1:29080'
    $env:MAT_IT_SIM = 'http://127.0.0.1:29503'
    $env:MAT_IT_RT = $rt
    $env:MAT_IT_SMTP_CTL = 'http://127.0.0.1:29580'
    $nodeArgs = @()
    if ($Reminder) { $nodeArgs += '--reminder' }
    $res = node "$root/tools/email-it/scenarios.mjs" @nodeArgs 2>&1
    $json = ($res | Where-Object { "$_".Trim().StartsWith('{') } | Select-Object -Last 1)
    if (-not $json) { Write-Host ($res -join "`n"); throw 'scenarios wrote no result' }
    $r = $json | ConvertFrom-Json
    New-Item -ItemType Directory -Force "$root/docs/reports" | Out-Null
    [IO.File]::WriteAllText("$root/docs/reports/023-email-x64.json", ($r | ConvertTo-Json -Depth 12) + "`n", $utf8)
    $bad = @($r.checks | Where-Object { -not $_.pass })
    Write-Host ("email: {0} checks, {1} failed" -f @($r.checks).Count, $bad.Count)
    foreach ($b in $bad) { Write-Host ("  FAIL {0}: {1}" -f $b.name, $b.detail) -ForegroundColor Red }
    Write-Host ("  measures: " + ($r.measures | ConvertTo-Json -Compress))
    $pass = [bool]$r.pass
}
finally {
    if (-not $Keep) { docker compose -f $compose -p $project down -v *> $null }
    Remove-Item -Recurse -Force $certs -ErrorAction SilentlyContinue
    Remove-Item Env:MAT_IT_SMTP_PW, Env:MAT_IT_PW_ADMIN, Env:MAT_IT_BUILD, Env:MAT_IT_CERTS, Env:MAT_IT_FP, Env:MAT_IT_HTTPS, Env:MAT_IT_HTTP, Env:MAT_IT_SIM, Env:MAT_IT_RT, Env:MAT_IT_SMTP_CTL -ErrorAction SilentlyContinue
}
if ($pass) { Write-Host 'email-it: PASS' -ForegroundColor Green; exit 0 }
Write-Host 'email-it: FAILED' -ForegroundColor Red
exit 1
