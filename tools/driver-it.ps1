# Khung kiem tich hop x64 cua feature 006 (specs/006-tags-modbus T074, T110, T148; quickstart §3).
# Dung: ./tools/driver-it.ps1 -Scenario read,merge,split,probe,write [-Rounds 6] [-Seconds 60] [-Keep] [-NoBuild]
#        [-BuildDir C:\build\mat-x64-<ten>] [-Net]
#   read:       100 % Tag khop gia lap (moi kieu, 4 thu tu byte, bit trong thanh ghi, STRING, scaling).
#   merge:      so yeu cau va khoi cua gia lap bang so khoi tinh truoc, moi yeu cau <= 125 thanh ghi.
#   split:      dia chi khong co o giua khoi: chi Tag do BAD EXCEPTION_02, Tag khac GOOD tu luot sau.
#   probe:      Thu ket noi: REFUSED, DNS, EXCEPTION, TIMEOUT, OK; kenh dang chay khong mat luot nao.
#   unplug:     -Rounds vong: im lang (rut cap) va dung PLC (refuse) luan phien; BAD <= 2 chu ky, GOOD <= 12 s,
#               khong khoi dong lai runtime. Voi -Net, them mot vong ngat mang that (docker network disconnect).
#   write:      moi ket qua va moi ly do cua FR-037, FR-038; viewer, chua dang nhap, HTTP, live bi tu choi; audit.
#   write-race: hai nguoi ghi cung Tag gan nhu cung luc.
#   write-kill: -Rounds vong kill -9 giua luc ghi: 0 lenh toi gia lap ma khong co ban ghi started; moi lenh do co interrupted.
#   load:       500 Tag nhom 1 s, 10 client xem du 500 Tag trong -Seconds giay; do CPU, RSS, chu ky, tre.
#   calc:       500 Tag + 200 Tag tinh toan + 100 Tag noi bo (project calc-200): moi lan doi dau vao, Tag tinh
#               toan nam trong cung delta va dung tong (US4-4; SC-004 x64); do CPU, RSS trong -Seconds giay.
#   retain:     -Rounds vong (mac dinh 20): ghi mot Tag noi bo giu qua mat dien, kill -9 (sau cua so gom; vong chan
#               giua cua so), khoi dong lai: gia tri con, kho khong hong (US4-9, SC-010 x64, FR-059). Cuoi cung
#               chay --retain-dump trong container (trang thai ok).
#   write-io:   moi lenh ghi mot Tag noi bo giu qua mat dien (moi lan sau cua so gom) ton bao nhieu byte ghi dia
#               (/proc/<pid>/io write_bytes tru phan nen); quy ra MB/ngay o toc do ghi toi da (SC-011, so x64).
#   faults:     tiem 10 timeout, exception tung ma, sai tid, sai unit, sai do dai, byte rac, tra loi cham, dong ket noi;
#               so dem o GET /api/v1/drivers/diagnostics khop trong <= 5 s; loi gan nhat co thoi diem (US5-2, SC-016).
#   gateway-multiunit: (011, T054, SC-005) project gateway-3: unit 2 cam trong -Cycles chu ky (mac dinh 1.000, 500 ms):
#               Tag unit 1, 3 GOOD 100 % mau, khong dong ket noi; unit 3 tra loi muon bi bo; ket qua 011-gateway-x64.json.
#   pulse-recovery: (011, T054, SC-004) -Rounds (mac dinh 20) vong kill -9 giua xung: bit nha <= 10 s sau khi chay lai,
#               audit pulse-recovery; roi nhat ky xung khong ghi duoc: PULSE_JOURNAL_FAILED, 0 bit; ket qua 011-pulse-x64.json.
#   source:     loc nguon (SC-022): tu mang 203.0.113.0/24 va 172.30.6.0/24, o ba che do viewerAccess
#               (private, any, off; script khoi dong lai runtime theo che do): trang, system/info,
#               projects/active, live; phien hop le qua HTTPS khong bi loc; any co VIEWER_PUBLIC.
# Mang, container: tests/driver-it/compose.yaml (runtime x64 trong image mat-armhf duoi supervise.sh cua device-it,
# gia lap Node, client Node). Mat khau thu sinh ngau nhien moi lan chay, chi nam trong bien moi truong cua tien trinh
# nay va stdin cua lenh --user-add; khong ghi file. Ket qua: docs/reports/006-<scenario>-x64.json.
# Don khi dung -Keep: docker compose -f tests/driver-it/compose.yaml -p mat-drv-it down -v
# (Thong bao in ra khong dau: Windows PowerShell 5.1 doc file .ps1 khong BOM theo codepage ANSI.)
param(
    [ValidateSet('read', 'merge', 'split', 'probe', 'unplug', 'write', 'write-race', 'write-kill', 'load', 'calc', 'retain', 'write-io', 'faults', 'source', 'gateway-multiunit', 'pulse-recovery')][string[]]$Scenario = @('read'),
    [int]$Rounds = 6,
    [int]$Seconds = 60,
    [int]$Clients = 10,
    [int]$Cycles = 1000,
    [switch]$Keep,
    [switch]$Net,
    [string]$BuildDir = '',
    [switch]$NoBuild
)
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path "$PSScriptRoot/..").Path
. "$PSScriptRoot/lib/platform.ps1"
if (-not $BuildDir) { $BuildDir = Get-MatBuildDir 'mat-x64-e2' }
$compose = "$root/tests/driver-it/compose.yaml"
$utf8 = New-Object Text.UTF8Encoding $false
$project = 'mat-drv-it'
$rt = "$project-rt-1"
$client = "$project-client-1"
$sim = "$project-sim-1"
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
    $env:MAT_IT_MAP = "/src/tools/modbus-sim/maps/$Map.json"
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
    Remove-Item Env:MAT_IT_PW_ADMIN, Env:MAT_IT_PW_KYSU1, Env:MAT_IT_PW_VH1, Env:MAT_IT_PW_VH2, Env:MAT_IT_PW_XEM1, Env:MAT_IT_BUILD, Env:MAT_IT_PROJECT, Env:MAT_IT_MAP -ErrorAction SilentlyContinue
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

function Invoke-Client([string[]]$ClientArgs, [string]$Fp) {
    $out = docker exec -e MAT_IT_PW_ADMIN -e MAT_IT_PW_KYSU1 -e MAT_IT_PW_VH1 -e MAT_IT_PW_VH2 -e MAT_IT_PW_XEM1 `
        $client node --no-warnings /src/tests/driver-it/driver-it.mjs @ClientArgs --fp $Fp
    $line = ($out | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1)
    if (-not $line) { throw "client $ClientArgs wrote no result: $out" }
    return $line | ConvertFrom-Json
}

function Write-Result([string]$Name, $Result) {
    $json = $Result | ConvertTo-Json -Depth 10
    $file = @{ 'gateway-multiunit' = '011-gateway'; 'pulse-recovery' = '011-pulse' }[$Name]
    if (-not $file) { $file = "006-$Name" }
    [IO.File]::WriteAllText("$root/docs/reports/$file-x64.json", $json + "`n", $utf8)
    $bad = @($Result.checks | Where-Object { -not $_.pass })
    Write-Host ("{0}: {1} checks, {2} failed" -f $Name, $Result.checks.Count, $bad.Count)
    foreach ($b in $bad) { Write-Host ("  FAIL {0}: {1}" -f $b.name, $b.detail) -ForegroundColor Red }
    if ($Result.measures) { Write-Host ("  measures: " + ($Result.measures | ConvertTo-Json -Depth 5 -Compress)) }
    if ($Result.pass) { Write-Host "$Name scenario PASS" -ForegroundColor Green }
    else { Write-Host "$Name scenario FAILED" -ForegroundColor Red }
}

# A real network cut: the simulator leaves the network, the Tags turn BAD, it comes back, they turn GOOD.
function Invoke-NetCut([string]$Fp) {
    $since = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    docker network disconnect "${project}_lan" $sim | Out-Null
    $bad = Invoke-Client @('wait-bad', '--since', "$since", '--max', '8000') $Fp
    docker network connect --ip 172.30.6.20 --alias sim "${project}_lan" $sim | Out-Null
    $since2 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $good = Invoke-Client @('wait-good', '--since', "$since2", '--max', '20000') $Fp
    $res = [ordered]@{
        scenario = 'unplug-net'
        checks = @(
            @{ name = 'network cut: every Tag BAD with a reason within 2 cycles + timeout'; pass = ($bad.pass -and $bad.measures.ms -le 2500); detail = "$($bad.measures.ms) ms, reasons $($bad.measures.reasons -join ',')" },
            @{ name = 'network back: every Tag GOOD within 12 s'; pass = ($good.pass -and $good.measures.ms -le 12000); detail = "$($good.measures.ms) ms" }
        )
        measures = @{ badMs = $bad.measures.ms; goodMs = $good.measures.ms }
    }
    $res.pass = -not (@($res.checks | Where-Object { -not $_.pass }).Count)
    return [pscustomobject]$res
}

# Restarts the runtime with --viewer-access <mode> (the supervision loop reads /data/extra-args at each start).
function Set-ViewerAccess([string]$Mode) {
    $before = [int](docker exec $rt sh -c "grep -c 'https ok on :8443' /logs/runtime.log")
    docker exec $rt sh -c "printf -- '--viewer-access\n$Mode\n' > /data/extra-args; kill -TERM `$(cat /run/mat-runtime.pid)" | Out-Null
    Wait-Until { [int](docker exec $rt sh -c "grep -c 'https ok on :8443' /logs/runtime.log") -gt $before } 60 "rt restart ($Mode)" | Out-Null
    Start-Sleep -Milliseconds 800
}

$failed = @()
try {
    if (-not $NoBuild) { Build-Runtime }
    $groups = @(
        @{ project = 'read-all-types'; map = 'all-types'; list = @('source', 'read', 'merge', 'split', 'probe', 'write', 'write-race', 'unplug', 'write-kill', 'faults') },
        @{ project = 'bench-500-modbus'; map = 'bench-500'; list = @('load') },
        @{ project = 'calc-200'; map = 'bench-500'; list = @('calc', 'retain', 'write-io') },
        # feature 011 (T054): gateway nhieu unit, nha xung sau kill -9; ket qua docs/reports/011-{gateway,pulse}-x64.json
        @{ project = 'gateway-3'; map = 'all-types'; list = @('gateway-multiunit', 'pulse-recovery') }
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
            if ($s -in @('unplug', 'write-kill')) { $a += @('--rounds', "$Rounds") }
            if ($s -eq 'pulse-recovery') { $a += @('--rounds', "$(if ($PSBoundParameters.ContainsKey('Rounds')) { $Rounds } else { 20 })") }
            if ($s -eq 'gateway-multiunit') { $a += @('--cycles', "$Cycles") }
            if ($s -eq 'load') { $a += @('--seconds', "$Seconds", '--clients', "$Clients") }
            if ($s -eq 'calc') { $a += @('--seconds', "$Seconds", '--clients', "$Clients") }
            if ($s -eq 'retain') { $a += @('--rounds', "$(if ($PSBoundParameters.ContainsKey('Rounds')) { $Rounds } else { 20 })") }
            if ($s -eq 'source') {
                $modes = @()
                foreach ($mode in 'private', 'any', 'off') {
                    Set-ViewerAccess $mode
                    $modes += Invoke-Client @('source', '--mode', $mode) $fp
                }
                $res = [pscustomobject]@{ scenario = 'source'; checks = @($modes | ForEach-Object { $_.checks }); measures = @{ modes = @($modes | ForEach-Object { $_.measures.mode }) }; pass = -not (@($modes | Where-Object { -not $_.pass }).Count) }
                Write-Result $s $res
                if (-not $res.pass) { $failed += $s }
                Set-ViewerAccess 'private'
                continue
            }
            $res = Invoke-Client $a $fp
            Write-Result $s $res
            if (-not $res.pass) { $failed += $s }
            if ($s -eq 'retain') {
                # --retain-dump runs as the service user on the device; here as the user of the container
                $dump = docker exec $rt $bin --retain-dump --data-dir /data 2>&1 | Out-String
                $ok = $dump -match '"state"\s*:\s*"ok"'
                Write-Host ("  --retain-dump: " + $(if ($ok) { 'ok' } else { "NOT ok: $dump" }))
                if (-not $ok) { $failed += 'retain-dump' }
            }
            if ($s -eq 'unplug' -and $Net) {
                $n = Invoke-NetCut $fp
                Write-Result 'unplug-net' $n
                if (-not $n.pass) { $failed += 'unplug-net' }
            }
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
Write-Host 'driver-it: all scenarios passed' -ForegroundColor Green
exit 0
