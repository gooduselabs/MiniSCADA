# history-10 (T091) en el runtime x64 real: history-demo + pantalla bon-bieu-do, usuario viewer xem1, datos de 5 minutos.
# Dung: ./tools/history-10-x64.ps1 [-WarmSeconds 300] [-BuildDir C:\build\w5-x64] [-DataDir C:\build\w5-data] [-Name w5-h10]
# Ket qua: docs/reports/010-history-10-x64.json (ghi boi tests/web-it/browser-010.mjs). Can build runtime x64 va dist-device.
param(
    [int]$WarmSeconds = 300,
    [string]$BuildDir = 'C:\build\w5-x64',
    [string]$DataDir = 'C:\build\w5-data',
    [int]$MaxWeb = 12,
    [string]$Name = 'w5-h10'
)
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path "$PSScriptRoot/..").Path
$dir = Join-Path $DataDir 'h10'
node "$root/tools/history-10-project.mjs" "$dir\project" | Out-Null
$bytes = New-Object byte[] 18
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$pw = [Convert]::ToBase64String($bytes).Replace('+', 'a').Replace('/', 'b')
$env:MAT_IT_PW = $pw
$env:MAT_IT_PW_XEM1 = $pw
$bin = '/build/x64/bin'
# 10 sessions at the same time need more than the 8 web sessions of the default (the idlest ones are dropped)
[IO.File]::WriteAllText("$dir\rt.json", ('{"webMaxSessions": ' + $MaxWeb + '}'))
docker rm -f $Name *> $null
$run = "exec $bin/mat-runtime --config /rt.json --project-dir /project --schemas-dir /src/schemas --data-dir /data --docroot /src/apps/runtime-web/dist-device --port 8080"
docker run -d --name $Name --tmpfs /data:rw,mode=1777 -p 18443:8443 -p 18080:8080 -e MAT_IT_PW -v "${root}:/src:ro" -v "${BuildDir}:/build" -v "$dir\project:/project:ro" -v "$dir\rt.json:/rt.json:ro" mat-armhf sh -c $run | Out-Null
try {
    $up = $false
    for ($i = 0; $i -lt 60 -and -not $up; $i++) {
        Start-Sleep -Seconds 2
        $up = ((curl.exe -sk -o NUL -w "%{http_code}" https://localhost:18443/api/v1/device/identity) -eq '200')
    }
    if (-not $up) { throw 'runtime HTTPS did not come up' }
    docker exec $Name mkdir -p /etc/mat-runtime | Out-Null
    1..10 | ForEach-Object { docker exec -e MAT_IT_PW $Name sh /src/tests/device-it/add-user.sh "xem$_" viewer MAT_IT_PW *> $null }
    Write-Host "warming up $WarmSeconds s so the history charts have data..."
    Start-Sleep -Seconds $WarmSeconds
    $env:MAT_IT_BASE = 'https://127.0.0.1:18443'
    & "$root/tools/web-it.ps1" -Scenario history-10 -NoBuild
    $rc = $LASTEXITCODE
    $mem = (docker exec $Name sh -c 'grep -e VmHWM -e VmRSS /proc/$(pidof mat-runtime)/status') -replace '\s+', ' '
    $stat = (docker exec $Name sh -c 'cat /proc/$(pidof mat-runtime)/stat') -split ' '
    $cpu = "utime=$($stat[13]) stime=$($stat[14]) ticks"
    Write-Host "webMaxSessions=${MaxWeb}:$($mem -join '; '); utime/stime/start ticks: $cpu"
    Write-Host "web-it history-10 exit $rc"
    exit $rc
} finally {
    docker rm -f $Name *> $null
    Remove-Item Env:MAT_IT_PW, Env:MAT_IT_PW_XEM1, Env:MAT_IT_BASE -ErrorAction SilentlyContinue
}
