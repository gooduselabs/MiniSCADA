# Khung kiểm tích hợp x64 của feature 005 (specs/005-device-online T051, T061; quickstart §3).
# Dùng: ./tools/device-it.ps1 -Scenario auth,tls-idle,secrets,discovery [-Keep] [-BuildDir C:\build\mat-x64-<tên>]
#        [-NoBuild] [-Rounds 24]  (kịch bản mới: deploy, packages, busy, health, kill, reload)
#   auth:      sai 5 lần thì khóa 5 phút (cả khi mật khẩu đúng); chưa đăng nhập 401, viewer 403, đều có
#              audit; endpoint kỹ thuật qua HTTP 403 HTTPS_REQUIRED; ghim sai dừng trước request.
#   tls-idle:  8 kết nối TCP im lặng vào 8443 (CPU tăng <= 2 điểm, bị đóng sau <= 11 s), rồi 8 kết nối
#              TLS gửi một request keep-alive rồi im (bị đóng sau 15 s, chốt 2026-10-12); client thứ 9.
#   secrets:   đăng nhập đúng, sai, gõ nhầm mật khẩu vào ô tên; tìm mọi chuỗi mật khẩu thử trong log,
#              audit.db, kho project, /run/mat-runtime, /etc/mat-runtime, docker logs: không thấy.
#   discovery: 2 runtime + 1 runtime tắt tìm thiết bị + client Node trên mạng Docker riêng (T061).
#   (auth còn kiểm /audit của engineer và administrator, lọc, phân trang, chẩn đoán, và --export-audit.)
#   deploy:    3 project (tank-demo, bench-500, tank-viet) x 10 lần nạp xuống rồi đọc lên: digest giống 30/30
#              (SC-002); đổi cột lưu trữ thì history.db giữ dữ liệu và thêm cột (FR-026).
#   packages:  mọi vector gói độc của tests/package-vectors bị từ chối đúng mã, state.json không đổi, có audit (SC-003).
#   busy:      lần nạp xuống thứ hai khi một lần đang nhận: 409 DEVICE_BUSY (US2-7).
#   health:    --test-health die|hang: tự quay về bản cũ, rolled-back (US2-5). Cần build -DMAT_TEST_HOOKS=ON.
#   kill:      -Rounds vòng (mặc định 24 = 6 bước x 4): SIGKILL ở từng bước nạp xuống; lần chạy sau luôn là bản
#              cũ hoặc bản mới hoàn chỉnh, --project-status hết pending <= 20 s (SC-004, FR-023). Cần hook.
#   deploy-extra-file: (011, T054, SC-006) 30 lan nap xuong tank-demo: 1/3 co tep khong tham chieu (validate:
#              E_PACKAGE_EXTRA_FILE), 1/3 co .mat-editor/ (verify-package), 1/3 sach (committed, digest phuc vu = digest goi);
#              0 HEALTH_TIMEOUT. Ket qua docs/reports/011-extra-file-x64.json.
#   persist-slow: (011, T054, SC-007) fsync cua kho cham 500 ms: GET projects/active p99 <= 50 ms trong luc nap xuong;
#              fsync loi ENOSPC: PERSIST_FAILED, ban cu chay. Can hook (-DMAT_TEST_HOOKS=ON). Ket qua 011-persist-x64.json.
#   reload:    10 tab Chrome headless xem trang của rt1; nạp xuống thì mọi tab tải lại <= 10 s (FR-025, SC-006).
#              Mở 127.0.0.1:18080 và 18443 của máy chạy (compose.ports.yaml); cần Chrome và puppeteer-core.
# health và kill build runtime với -DMAT_TEST_HOOKS=ON (thư mục build riêng, mặc định C:\build\mat-x64-e2) rồi
# đặt lại OFF khi xong (chỉ cấu hình lại, không build); các bản armhf không bao giờ có hook.
# Mạng, container: tests/device-it/compose.yaml. Mật khẩu thử sinh ngẫu nhiên mỗi lần chạy, chỉ nằm
# trong biến môi trường của tiến trình này và stdin của lệnh --user-add; không ghi file.
# Kết quả: docs/reports/005-<scenario>-x64.json. Dọn khi dùng -Keep: docker compose -p mat-dev-it down -v
# (Thông báo in ra không dấu: Windows PowerShell 5.1 đọc file .ps1 không BOM theo codepage ANSI.)
param(
    [ValidateSet('auth', 'tls-idle', 'secrets', 'discovery', 'deploy', 'packages', 'busy', 'health', 'kill', 'reload', 'deploy-extra-file', 'persist-slow')][string[]]$Scenario = @('auth'),
    [int]$Rounds = 24,
    [switch]$Keep,
    [string]$BuildDir = '',
    [switch]$NoBuild
)
# PowerShell 5.1 turns every stderr line of a native command (docker) into an error under 'Stop':
# use 'Continue' and check $LASTEXITCODE explicitly.
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path "$PSScriptRoot/..").Path
. "$PSScriptRoot/lib/platform.ps1"
$compose = "$root/tests/device-it/compose.yaml"
$composeFiles = @('-f', $compose)
if ($Scenario -contains 'reload') { $composeFiles += @('-f', "$root/tests/device-it/compose.ports.yaml") }
$utf8 = New-Object Text.UTF8Encoding $false
$project = 'mat-dev-it'
$rt1 = "$project-rt1-1"
$client = "$project-client-1"
$bin = '/build/x64/bin/mat-runtime'
$nodeImage = 'node:22.23.3-alpine'  # as in compose.yaml
$echo = "$project-echo"

# Random letters and digits (no special character: nothing to escape in sh or JSON).
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
    $mount = @()
    $dir = 'build/x64'
    if ($BuildDir) {
        New-Item -ItemType Directory -Force $BuildDir | Out-Null
        $mount = @('-v', "${BuildDir}:/build")
        $dir = '/build/x64'
    }
    $hookFlag = if ($hooks) { 'ON' } else { 'OFF' }
    docker run --rm -v "${root}:/src" @mount mat-armhf sh -c "cmake -S . -B $dir -G Ninja -DCMAKE_BUILD_TYPE=Release -DMAT_TEST_HOOKS=$hookFlag >/dev/null && cmake --build $dir --target mat-runtime -j 2"
    if ($LASTEXITCODE) { throw 'build failed' }
}

function Start-Rig {
    $env:MAT_IT_BUILD = if ($BuildDir) { $BuildDir } else { "$root/build" }
    docker compose @composeFiles -p $project down -v *> $null
    Write-Host 'starting rt1, rt2, rt3 (x64 runtime under supervise.sh) and the Node client...'
    docker compose @composeFiles -p $project up -d 2>&1 | Out-Null  # progress lines go to stderr
    if ($LASTEXITCODE) { throw 'compose up failed' }
    foreach ($rt in @('rt1', 'rt2', 'rt3')) {
        Wait-Until {
            docker exec "$project-$rt-1" grep -q 'https ok on :8443' /logs/runtime.log 2>$null
            $LASTEXITCODE -eq 0
        } 60 "$rt HTTPS" | Out-Null
    }
}

function Stop-Rig {
    docker rm -f $echo *> $null
    if (-not $Keep) { docker compose @composeFiles -p $project down -v *> $null }
    Remove-Item Env:MAT_IT_PW_ADMIN, Env:MAT_IT_PW_KYSU1, Env:MAT_IT_PW_KYSU2, Env:MAT_IT_PW_XEM1, Env:MAT_IT_PW_WRONG, Env:MAT_IT_PW_SLIP, Env:MAT_IT_BUILD -ErrorAction SilentlyContinue
}

# Test accounts on rt1 with --password-stdin. The password goes through `docker exec -e NAME` (the
# value comes from this process's environment) and add-user.sh pipes it into the command: never on a
# command line, and no PowerShell pipe, which prefixed it with a BOM (seen 2026-10-12: the BOM became
# the first character of the stored password).
function New-Accounts {
    $env:MAT_IT_PW_ADMIN = New-Secret 24
    $env:MAT_IT_PW_KYSU1 = New-Secret 24
    $env:MAT_IT_PW_KYSU2 = New-Secret 24  # the deploy scenarios (kysu1 is locked by auth for 5 minutes)
    $env:MAT_IT_PW_XEM1 = New-Secret 24
    $env:MAT_IT_PW_WRONG = New-Secret 24
    $env:MAT_IT_PW_SLIP = New-Secret 24
    foreach ($a in @(@('admin', 'administrator', 'MAT_IT_PW_ADMIN'), @('kysu1', 'engineer', 'MAT_IT_PW_KYSU1'), @('kysu2', 'engineer', 'MAT_IT_PW_KYSU2'), @('xem1', 'viewer', 'MAT_IT_PW_XEM1'))) {
        $out = docker exec -e $a[2] $rt1 sh /src/tests/device-it/add-user.sh $a[0] $a[1] $a[2] 2>&1
        if ($LASTEXITCODE) { throw "--user-add $($a[0]) failed: $out" }
    }
}

# Discovery (T061): rt1 and rt2 get a route to 10.99.0.0/24 on their lan card, so that a reply to
# the client's extra address would come back (otherwise silence proves nothing), and a UDP echo runs
# in rt1's network namespace as the control of that path. Helper containers share the runtime's
# network namespace: the runtime containers themselves keep no capability.
function Initialize-DiscoveryPath {
    foreach ($rt in @($rt1, "$project-rt2-1")) {
        docker run --rm --network "container:$rt" --cap-add NET_ADMIN $nodeImage ip route replace 10.99.0.0/24 dev eth0
        if ($LASTEXITCODE) { throw "route on $rt failed" }
    }
    docker rm -f $echo *> $null
    docker run -d --name $echo --network "container:$rt1" -v "${root}:/src:ro" $nodeImage `
        node /src/tests/device-it/client.mjs udp-echo | Out-Null
    if ($LASTEXITCODE) { throw 'udp echo failed' }
}

function Get-Fingerprint {
    $line = docker exec $rt1 $bin --cert-fingerprint --data-dir /data | Select-String 'Fingerprint='
    if (-not $line) { throw '--cert-fingerprint failed' }
    return ($line.ToString() -replace '^.*=', '' -replace ':', '').ToLower()
}

function Invoke-Client([string]$Name, [string]$Fp) {
    $out = docker exec -e MAT_IT_PW_ADMIN -e MAT_IT_PW_KYSU1 -e MAT_IT_PW_KYSU2 -e MAT_IT_PW_XEM1 -e MAT_IT_PW_WRONG -e MAT_IT_PW_SLIP `
        $client node --no-warnings /src/tests/device-it/client.mjs $Name --fp $Fp --rounds $Rounds
    $line = ($out | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1)
    if (-not $line) { throw "client $Name wrote no result: $out" }
    return $line | ConvertFrom-Json
}

# Every test password searched on rt1 (SC-005). Control: a planted canary must be found, so that the
# search is known to run.
function Search-Secrets {
    $canary = 'canary' + (New-Secret 20)
    docker exec $rt1 sh -c "echo $canary > /tmp/device-it-canary"
    $patterns = @($env:MAT_IT_PW_ADMIN, $env:MAT_IT_PW_KYSU1, $env:MAT_IT_PW_XEM1, $env:MAT_IT_PW_WRONG, $env:MAT_IT_PW_SLIP)
    $dirs = '/logs /data /run/mat-runtime /etc/mat-runtime'
    # The strings go through the environment of docker exec (search-secrets.sh reads MAT_IT_*).
    $search = '/src/tests/device-it/search-secrets.sh'
    $env:MAT_IT_CANARY = $canary
    $control = (docker exec -e MAT_IT_CANARY $rt1 sh $search /tmp/device-it-canary /logs /data) -join ' '
    Remove-Item Env:MAT_IT_CANARY
    $found = docker exec -e MAT_IT_PW_ADMIN -e MAT_IT_PW_KYSU1 -e MAT_IT_PW_XEM1 -e MAT_IT_PW_WRONG -e MAT_IT_PW_SLIP `
        $rt1 sh $search $dirs.Split(' ')
    $files = (docker exec $rt1 sh -c "find $dirs -type f | wc -l").Trim()
    $logs = (docker logs $rt1 2>&1 | Out-String) + (docker logs $client 2>&1 | Out-String)
    $inLogs = @($patterns | Where-Object { $logs.Contains($_) }).Count
    return [ordered]@{
        searched = @('/logs', '/data (audit.db*, projects/, tls/)', '/run/mat-runtime', '/etc/mat-runtime', 'docker logs rt1, client')
        filesSearched = [int]$files
        passwords = $patterns.Count
        controlFound = [bool]($control -match 'device-it-canary')
        filesWithPassword = @($found | Where-Object { $_ })
        dockerLogHits = $inLogs
    }
}

# reload: Chrome on this machine, the runtime published on 127.0.0.1:18080 and :18443.
function Invoke-Reload([string]$Fp) {
    $out = & node --no-warnings "$root/tests/device-it/reload-tabs.mjs" --fp $Fp
    $line = ($out | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1)
    if (-not $line) { throw "reload wrote no result: $out" }
    return $line | ConvertFrom-Json
}

function Write-Result([string]$Name, $Result) {
    $json = $Result | ConvertTo-Json -Depth 10
    # feature 011: deploy-extra-file -> docs/reports/011-extra-file-x64.json
    $file = @{ 'deploy-extra-file' = '011-extra-file'; 'persist-slow' = '011-persist' }[$Name]
    if (-not $file) { $file = "005-$Name" }
    [IO.File]::WriteAllText("$root/docs/reports/$file-x64.json", $json + "`n", $utf8)
    Write-Host $json
    if ($Result.pass) { Write-Host "$Name scenario PASS" -ForegroundColor Green }
    else { Write-Host "$Name scenario FAILED" -ForegroundColor Red }
}

$hooks = @($Scenario | Where-Object { $_ -in @('health', 'kill', 'persist-slow') }).Count -gt 0
if ($hooks -and -not $BuildDir) { $BuildDir = (Get-MatBuildDir 'mat-x64-e2') }
$withPorts = $Scenario -contains 'reload'
$failed = @()
try {
    if (-not $NoBuild) { Build-Runtime }
    Start-Rig
    New-Accounts
    $fp = Get-Fingerprint
    Write-Host "rt1 fingerprint: $fp"
    # The runtime reads users.json again when it changes (at most every 2 s).
    $ready = Invoke-Client 'ready' $fp
    if (-not $ready.pass) { throw 'rt1 did not load the test accounts' }
    foreach ($name in $Scenario) {
        Write-Host "scenario $name..."
        if ($name -eq 'discovery') { Initialize-DiscoveryPath }
        if ($name -eq 'reload') { $r = Invoke-Reload $fp } else { $r = Invoke-Client $name $fp }
        $result = [ordered]@{
            scenario = "$name-x64"
            at = (Get-Date).ToUniversalTime().ToString('s') + 'Z'
            runtime = 'x64 (image mat-armhf), supervise.sh, tests/device-it/compose.yaml'
            checks = $r.checks
            measures = $r.measures
        }
        $pass = [bool]$r.pass
        if ($r.error) { $result.error = $r.error }
        if ($name -eq 'auth') {
            # T150: --export-audit on the device holds the failed sign-ins and the refused calls.
            $export = (docker exec $rt1 $bin --export-audit --format jsonl --data-dir /data) -join "`n"
            $e1 = $export -match '"action":\s*"auth\.login"[^\n]*"result":\s*"failed"|"result":\s*"failed"[^\n]*"action":\s*"auth\.login"'
            $e2 = $export -match 'access\.denied'
            $e3 = $export -match 'auth\.lockout'
            $pw = @($env:MAT_IT_PW_ADMIN, $env:MAT_IT_PW_KYSU1, $env:MAT_IT_PW_XEM1) | Where-Object { $export.Contains($_) }
            $extra = @(
                [pscustomobject]@{ name = '--export-audit: failed sign-ins present'; pass = [bool]$e1 },
                [pscustomobject]@{ name = '--export-audit: access.denied present'; pass = [bool]$e2 },
                [pscustomobject]@{ name = '--export-audit: auth.lockout present'; pass = [bool]$e3 },
                [pscustomobject]@{ name = '--export-audit: no test password'; pass = (@($pw).Count -eq 0) }
            )
            $result.checks = @($r.checks) + $extra
            $pass = $pass -and (@($extra | Where-Object { -not $_.pass }).Count -eq 0)
        }
        if ($name -in @('deploy', 'kill', 'health', 'busy', 'deploy-extra-file', 'persist-slow')) {
            $result.projectStatus = (docker exec $rt1 $bin --project-status --data-dir /data --project-store-dir /data/projects) -join "`n"
        }
        if ($name -eq 'secrets') {
            $s = Search-Secrets
            $result.search = $s
            $pass = $pass -and $s.controlFound -and ($s.filesWithPassword.Count -eq 0) -and ($s.dockerLogHits -eq 0) -and ($s.filesSearched -gt 0)
        }
        $result.pass = $pass
        Write-Result $name $result
        if (-not $pass) { $failed += $name }
    }
} finally {
    Stop-Rig
    if ($hooks) {
        # Give the option back: OFF again in that build directory (configuration only, no build).
        $m = @('-v', "$($BuildDir):/build")
        docker run --rm -v "$($root):/src" @m mat-armhf sh -c "cmake -S . -B /build/x64 -DMAT_TEST_HOOKS=OFF >/dev/null" | Out-Null
    }
}
if ($failed.Count) { throw "device-it FAILED: $($failed -join ', ')" }
Write-Host "device-it: all scenarios PASS ($($Scenario -join ', '))" -ForegroundColor Green
