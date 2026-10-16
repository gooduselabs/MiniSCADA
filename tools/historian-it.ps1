# Kịch bản kiểm chứng lưu trữ dữ liệu (specs/003-data-logging/quickstart.md §3–§5) trên x64 Docker.
# Dùng: ./tools/historian-it.ps1 -Scenario retention|forward [-Keep]
#   retention: dữ liệu giả lập 10 ngày (mỗi 500 ms, ~104 MB), thời hạn 7 ngày.
#              Pha A: trần 256 MB, đợt dọn theo thời hạn phải xóa hết dòng cũ hơn 7 ngày.
#              Pha B: khởi động lại với trần 64 MB, runtime phải xóa dòng cũ nhất tới dưới trần.
#              Cả hai pha đo khoảng trống lớn nhất giữa hai delta của client live trong lúc dọn.
#   forward:   MySQL 8.4, SQL Server 2022, PostgreSQL 17, InfluxDB 2.7 (tests/historian-it/
#              compose.yaml), chạy binary historian_it trong container toolchain trên mạng compose.
#              Mật khẩu và token sinh ngẫu nhiên mỗi lần chạy, chỉ nằm trong biến môi trường.
#   reliability: cùng 4 máy chủ, với từng loại DB (US4, SC-005, SC-008):
#              outage  mất mạng tới máy chủ, ghi 1800 dòng, có mạng lại → gửi bù đủ, 0 trùng;
#              crash   kill -9 tiến trình gửi 3 lần giữa lúc gửi 20 000 dòng → 0 trùng, 0 thiếu;
#              lost    đích nhận ngày đầu, đợt dọn xóa 3 ngày đầu → lostRows đúng số dòng đã xóa
#                      mà chưa kịp gửi (2 ngày), phần còn lại tới đủ, không trùng;
#              thêm 10 lần kill -9 tiến trình đang ghi SQLite → integrity_check luôn "ok".
# Kết quả: docs/reports/003-<scenario>-x64.json. Dọn khi dùng -Keep: docker compose -p mat-hist-it down -v
# (Thông báo in ra không dấu: Windows PowerShell 5.1 đọc file .ps1 không BOM theo codepage ANSI.)
param(
    [ValidateSet('retention', 'forward', 'reliability')][string]$Scenario = 'retention',
    [switch]$Keep
)
# PowerShell 5.1 biến mọi dòng stderr của lệnh ngoài (docker) thành lỗi khi 'Stop': dùng
# 'Continue' và kiểm $LASTEXITCODE tường minh.
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path "$PSScriptRoot/..").Path
. "$PSScriptRoot/lib/platform.ps1"
$work = Join-Path $root 'build/historian-it'
New-Item -ItemType Directory -Force $work | Out-Null
$utf8 = New-Object Text.UTF8Encoding $false

function Build-X64([string[]]$Targets) {
    docker build -q -t mat-armhf "$root/deployment/toolchain" | Out-Null
    if ($LASTEXITCODE) { throw 'docker build failed' }
    $t = $Targets -join ' '
    docker run --rm -v "${root}:/src" mat-armhf sh -c "cmake -S . -B build/x64 -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null && cmake --build build/x64 --target $t"
    if ($LASTEXITCODE) { throw 'build failed' }
}

function Remove-Container([string]$Name) {
    docker rm -f $Name *> $null
}

function Get-Info([int]$Port) {
    try { return Invoke-RestMethod -TimeoutSec 3 "http://localhost:$Port/api/v1/system/info" } catch { return $null }
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

function Start-Live([string]$Out) {
    if (Test-Path $Out) { Remove-Item $Out }
    return Start-Job { param($exe, $out) & $exe -host localhost -port 8091 -clients 1 -extra 0 -tags sim -duration 60 -out $out | Out-Null } -ArgumentList "$root/build/load-tester$MatExe", $Out
}

function Stop-Live($Job, [string]$Out) {
    Wait-Job $Job -Timeout 120 | Out-Null
    Receive-Job $Job | Out-Null
    if (Test-Path $Out) { return (Get-Content $Out -Raw | ConvertFrom-Json).summary }
    return $null
}

function Invoke-Retention {
    Build-X64 @('mat-runtime', 'historian_tool')
    if (-not (Test-Path "$root/build/load-tester$MatExe")) { throw "build/load-tester$MatExe missing: cd tools/load-tester; go build -o ../../build/load-tester$MatExe ." }
    # Project mau voi thoi han luu 7 ngay cho moi nhom.
    $proj = Join-Path $work 'retention'
    if (Test-Path $proj) { Remove-Item -Recurse -Force $proj }
    Copy-Item -Recurse "$root/projects/tank-demo" $proj
    $logPath = Join-Path $proj 'logging.json'
    $log = [IO.File]::ReadAllText($logPath) | ConvertFrom-Json
    foreach ($g in $log.groups) { $g.retentionDays = 7 }
    [IO.File]::WriteAllText($logPath, ($log | ConvertTo-Json -Depth 10), $utf8)
    # Pha A: tran 256 MB (lon hon du lieu) de chinh dot don theo thoi han xoa dong cu.
    $cfg = "$work/retention-runtime.json"
    [IO.File]::WriteAllText($cfg, '{"historianMaxDbMB": 256}', $utf8)

    $name = 'mat-hist-retention'
    Remove-Container $name
    $bin = '/src/build/x64/bin'
    $fill = "$bin/historian_tool fill --data-dir /data --group van-hanh --table van_hanh " +
        "--columns TANK01_LEVEL:REAL,MOTOR01_RUN:INTEGER,MOTOR01_SPEED:REAL,TANK01_TEMP:REAL " +
        "--retention 7 --days 10 --period 500"
    $before = "$bin/historian_tool count --data-dir /data --table van_hanh --older-than-days 7 > /data/before.txt"
    $run = "exec $bin/mat-runtime --config /src/build/historian-it/retention-runtime.json " +
        "--docroot /src/apps/runtime-web/dist-device --project-dir /src/build/historian-it/retention " +
        "--schemas-dir /src/schemas --data-dir /data"
    # Chi fill lan dau: pha B khoi dong lai container voi cung du lieu.
    $cmd = "if [ ! -f /data/history.db ]; then $fill && $before || exit 1; fi; $run"
    docker run -d --name $name -p 8091:8080 -v "${root}:/src:ro" mat-armhf sh -c $cmd | Out-Null
    if ($LASTEXITCODE) { throw 'docker run failed' }
    try {
        Write-Host 'phase A (retention): filling 10 days of rows, then starting mat-runtime...'
        Wait-Until { Get-Info 8091 } 300 'mat-runtime' | Out-Null
        $older = (docker exec $name cat /data/before.txt).Trim()
        Write-Host "rows older than 7 days before cleanup: $older"
        $ltA = Join-Path $work 'retention-load-a.json'
        $job = Start-Live $ltA
        $infoA = Wait-Until {
            $i = Get-Info 8091
            if ($i -and $i.historian.lastRetention) { $i }
        } 600 'first retention run'
        # SC-006: sau đợt dọn không còn dòng cũ hơn thời hạn + 1 giờ (7 × 24 + 1 = 169 giờ).
        # Đếm thêm mốc 7 ngày đúng để tham khảo: dòng vừa qua mốc sau đợt dọn chờ đợt kế tiếp.
        $after = (docker exec $name /src/build/x64/bin/historian_tool count --data-dir /data --table van_hanh --older-than-hours 169).Trim()
        $afterStrict = (docker exec $name /src/build/x64/bin/historian_tool count --data-dir /data --table van_hanh --older-than-days 7).Trim()
        $liveA = Stop-Live $job $ltA
        $hA = (Get-Info 8091).historian

        Write-Host 'phase B (size cap): restart with historianMaxDbMB 64...'
        [IO.File]::WriteAllText($cfg, '{"historianMaxDbMB": 64}', $utf8)
        docker restart $name | Out-Null
        if ($LASTEXITCODE) { throw 'docker restart failed' }
        Wait-Until { Get-Info 8091 } 120 'mat-runtime after restart' | Out-Null
        $ltB = Join-Path $work 'retention-load-b.json'
        $job = Start-Live $ltB
        $hB = Wait-Until {
            $i = Get-Info 8091
            if ($i -and $i.historian.capPurges -ge 1 -and $i.historian.dbBytes -lt $i.historian.dbMaxBytes) { $i.historian }
        } 600 'size cap purge'
        $liveB = Stop-Live $job $ltB
        $hB = (Get-Info 8091).historian

        $result = [ordered]@{
            scenario = 'retention-x64'
            at = (Get-Date).ToUniversalTime().ToString('s') + 'Z'
            retention = [ordered]@{
                rowsOlderThan7DaysBefore = [int64]$older
                rowsOlderThan7Days1hAfter = [int64]$after
                rowsOlderThan7DaysAfter = [int64]$afterStrict
                lastRetention = $hA.lastRetention
                capPurges = $hA.capPurges
                dbBytes = $hA.dbBytes
                liveMaxDeltaGapMs = if ($liveA) { $liveA.maxDeltaGapMs } else { $null }
                liveSeqGaps = if ($liveA) { $liveA.totalSeqGaps } else { $null }
            }
            sizeCap = [ordered]@{
                dbBytes = $hB.dbBytes
                dbMaxBytes = $hB.dbMaxBytes
                capPurges = $hB.capPurges
                capRowsDeleted = $hB.capRowsDeleted
                liveMaxDeltaGapMs = if ($liveB) { $liveB.maxDeltaGapMs } else { $null }
                liveSeqGaps = if ($liveB) { $liveB.totalSeqGaps } else { $null }
            }
        }
        $passA = ([int64]$after -eq 0) -and ($hA.lastRetention.rowsDeleted -gt 0) -and ($hA.capPurges -eq 0) -and
            $liveA -and ($liveA.maxDeltaGapMs -lt 1000) -and ($liveA.totalSeqGaps -eq 0)
        $passB = ($hB.capPurges -ge 1) -and ($hB.dbBytes -le [int64]($hB.dbMaxBytes * 1.05)) -and
            $liveB -and ($liveB.maxDeltaGapMs -lt 1000) -and ($liveB.totalSeqGaps -eq 0)
        $result.pass = [bool]($passA -and $passB)
        $json = $result | ConvertTo-Json -Depth 6
        [IO.File]::WriteAllText("$root/docs/reports/003-retention-x64.json", $json + "`n", $utf8)
        Write-Host $json
        if (-not $result.pass) { throw 'retention scenario FAILED' }
        Write-Host 'retention scenario PASS' -ForegroundColor Green
    } finally {
        if (-not $Keep) { Remove-Container $name }
    }
}

# Chuỗi ngẫu nhiên chữ và số (không ký tự đặc biệt: không cần escape ở shell hay SQL).
function New-Secret([int]$Length) {
    $chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    $bytes = New-Object byte[] $Length
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

$compose = "$root/tests/historian-it/compose.yaml"
$net = 'mat-hist-it_default'

# Mật khẩu/token ngẫu nhiên mỗi lần chạy (SQL Server đòi chữ hoa, chữ thường và số), rồi 4 máy chủ.
function Start-Dbs {
    $env:MAT_IT_ROOT_PW = 'Aa1' + (New-Secret 24)
    $env:MAT_IT_USER_PW = 'Bb2' + (New-Secret 24)
    $env:MAT_IT_INFLUX_TOKEN = New-Secret 40
    Write-Host 'starting MySQL, SQL Server, PostgreSQL, InfluxDB...'
    docker compose -f $compose up -d --wait --wait-timeout 300
    if ($LASTEXITCODE) { throw 'compose up failed' }
}

function Stop-Dbs {
    if (-not $Keep) { docker compose -f $compose down -v *> $null }
    Remove-Item Env:MAT_IT_ROOT_PW, Env:MAT_IT_USER_PW, Env:MAT_IT_INFLUX_TOKEN, Env:MAT_IT_SECRET -ErrorAction SilentlyContinue
}

# historian_it trên mạng compose; -e NAME (không giá trị): docker lấy từ môi trường, bí mật không
# nằm trên dòng lệnh. Lần chạy nào cũng tạo DB scada (SQL Server) và tài khoản mat_writer/mat_limited.
function Invoke-HistorianIt([string[]]$GtestArgs) {
    docker run --rm --network $net `
        -e MAT_IT_ROOT_PW -e MAT_IT_USER_PW -e MAT_IT_INFLUX_TOKEN `
        -e MAT_IT_MYSQL_HOST=mysql -e MAT_IT_MSSQL_HOST=mssql -e MAT_IT_PG_HOST=postgres `
        -e MAT_IT_INFLUX_URL=http://influxdb:8086 `
        -v "${root}:/src" mat-armhf /src/build/x64/bin/historian_it @GtestArgs
}

function Invoke-Forward {
    try {
        Build-X64 @('historian_it')
        Start-Dbs
        $out = "$work/forward.json"
        if (Test-Path $out) { Remove-Item $out }
        Invoke-HistorianIt @('--gtest_output=json:/src/build/historian-it/forward.json')
        $rc = $LASTEXITCODE
        if (-not (Test-Path $out)) { throw 'historian_it wrote no result' }
        $g = Get-Content $out -Raw | ConvertFrom-Json
        $cases = @()
        foreach ($suite in $g.testsuites) {
            foreach ($t in $suite.testsuite) {
                $cases += [ordered]@{
                    test = "$($suite.name).$($t.name)"
                    result = if ($t.failures) { 'FAILED' } else { $t.result }
                    seconds = $t.seconds
                }
            }
        }
        $result = [ordered]@{
            scenario = 'forward-x64'
            at = (Get-Date).ToUniversalTime().ToString('s') + 'Z'
            servers = @('mysql:8.4', 'mcr.microsoft.com/mssql/server:2022-latest', 'pgvector/pgvector:pg17', 'influxdb:2.7')
            tests = $g.tests
            failures = $g.failures
            skipped = @($cases | Where-Object { $_.result -eq 'SKIPPED' }).Count
            cases = $cases
            pass = ($rc -eq 0) -and ($g.failures -eq 0) -and ($g.tests -gt 0) -and
                (@($cases | Where-Object { $_.result -eq 'SKIPPED' }).Count -eq 0)
        }
        $json = $result | ConvertTo-Json -Depth 6
        [IO.File]::WriteAllText("$root/docs/reports/003-forward-x64.json", $json + "`n", $utf8)
        Write-Host $json
        if (-not $result.pass) { throw 'forward scenario FAILED' }
        Write-Host 'forward scenario PASS' -ForegroundColor Green
    } finally {
        Stop-Dbs
    }
}

# ---------------------------------------------------------------- US4: outage, crash, lost

$relVolume = 'mat-hist-rel'  # history.db của các kịch bản: volume Docker (SQLite không chạy an toàn trên bind mount Windows)
$service = @{ mysql = 'mysql'; mssql = 'mssql'; postgresql = 'postgres'; influxdb = 'influxdb' }
$cols = 'V:FLOAT64,N:INT32,S:STRING'

function Write-Dest([string]$Db) {
    $d = switch ($Db) {
        'mysql' { [ordered]@{ id = 'rel-mysql'; type = 'mysql'; host = 'mysql'; user = 'mat_writer' } }
        'mssql' { [ordered]@{ id = 'rel-mssql'; type = 'mssql'; host = 'mssql'; user = 'mat_writer' } }
        'postgresql' { [ordered]@{ id = 'rel-pg'; type = 'postgresql'; host = 'postgres'; user = 'mat_writer' } }
        'influxdb' { [ordered]@{ id = 'rel-influx'; type = 'influxdb'; url = 'http://influxdb:8086'; org = 'mat'; bucket = 'scada'; tls = 'disable' } }
    }
    [IO.File]::WriteAllText("$work/dest-$Db.json", ($d | ConvertTo-Json), $utf8)
    return "/src/build/historian-it/dest-$Db.json"
}

# historian_tool trên mạng compose, dữ liệu trong volume; bí mật qua MAT_IT_SECRET.
function Invoke-Tool([string]$Db, [string[]]$ToolArgs, [string]$Detach = '') {
    $env:MAT_IT_SECRET = if ($Db -eq 'influxdb') { $env:MAT_IT_INFLUX_TOKEN } else { $env:MAT_IT_USER_PW }
    $head = if ($Detach) { @('run', '-d', '--name', $Detach) } else { @('run', '--rm') }
    $docker = $head + @('--network', $net, '-e', 'MAT_IT_SECRET', '-v', "${root}:/src:ro", '-v', "${relVolume}:/rel",
        'mat-armhf', '/src/build/x64/bin/historian_tool') + $ToolArgs
    $out = docker @docker
    return ($out | Out-String).Trim()
}

function ConvertFrom-ToolJson([string]$Text) {
    $line = ($Text -split "`n" | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1)
    if (-not $line) { return $null }
    return $line | ConvertFrom-Json
}

function Invoke-Outage([string]$Db) {
    $dir = "/rel/outage-$Db"; $dest = Write-Dest $Db; $t = 'rel_outage'
    $start = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - 7200000
    Invoke-Tool $Db @('fill', '--data-dir', $dir, '--table', $t, '--columns', $cols, '--rows', '60', '--period', '1000', '--start-ms', "$start") | Out-Null
    $first = ConvertFrom-ToolJson (Invoke-Tool $Db @('forward', '--data-dir', $dir, '--table', $t, '--columns', $cols, '--dest', $dest))
    # Mất mạng tới máy chủ (container vẫn chạy, dữ liệu tmpfs còn nguyên), 30 phút dữ liệu 1 s.
    $container = "mat-hist-it-$($service[$Db])-1"
    docker network disconnect $net $container | Out-Null
    Invoke-Tool $Db @('fill', '--data-dir', $dir, '--table', $t, '--columns', $cols, '--rows', '1800', '--period', '1000', '--start-ms', "$($start + 60000)") | Out-Null
    $down = ConvertFrom-ToolJson (Invoke-Tool $Db @('forward', '--data-dir', $dir, '--table', $t, '--columns', $cols, '--dest', $dest, '--timeout-ms', '3000'))
    docker network connect --alias $service[$Db] $net $container | Out-Null
    $back = ConvertFrom-ToolJson (Invoke-Tool $Db @('forward', '--data-dir', $dir, '--table', $t, '--columns', $cols, '--dest', $dest, '--timeout-ms', '120000'))
    $check = ConvertFrom-ToolJson (Invoke-Tool $Db @('verify', '--data-dir', $dir, '--table', $t, '--columns', $cols, '--dest', $dest))
    return [ordered]@{
        db = $Db
        beforeOutage = $first.sentRows
        duringOutage = [ordered]@{ state = $down.state; lastError = $down.lastError; pendingRows = $down.pendingRows }
        catchUpRows = $back.sentRows
        catchUpSeconds = $back.seconds
        verify = $check
        pass = ($first.sentRows -eq 60) -and ($down.state -ne 'ok') -and ($back.sentRows -eq 1800) -and $check.same
    }
}

function Invoke-Crash([string]$Db) {
    $dir = "/rel/crash-$Db"; $dest = Write-Dest $Db; $t = 'rel_crash'
    $start = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - 86400000
    Invoke-Tool $Db @('fill', '--data-dir', $dir, '--table', $t, '--columns', $cols, '--rows', '20000', '--period', '1000', '--start-ms', "$start") | Out-Null
    for ($i = 1; $i -le 3; $i++) {
        $name = "mat-rel-fwd-$Db"
        docker rm -f $name *> $null
        Invoke-Tool $Db @('forward', '--data-dir', $dir, '--table', $t, '--columns', $cols, '--dest', $dest) $name | Out-Null
        Start-Sleep -Milliseconds (Get-Random -Minimum 400 -Maximum 1200)
        docker kill $name *> $null  # SIGKILL giữa lúc gửi
        docker rm -f $name *> $null
    }
    $done = ConvertFrom-ToolJson (Invoke-Tool $Db @('forward', '--data-dir', $dir, '--table', $t, '--columns', $cols, '--dest', $dest, '--timeout-ms', '180000'))
    $check = ConvertFrom-ToolJson (Invoke-Tool $Db @('verify', '--data-dir', $dir, '--table', $t, '--columns', $cols, '--dest', $dest))
    # lastRunSentRows > 0: the kills really landed while rows were still being sent
    return [ordered]@{
        db = $Db; rows = 20000; kills = 3
        lastRunSentRows = $done.sentRows
        verify = $check
        pass = ($done.state -eq 'ok') -and ($done.sentRows -gt 0) -and $check.same
    }
}

function Invoke-Lost([string]$Db) {
    $dir = "/rel/lost-$Db"; $dest = Write-Dest $Db; $t = 'rel_lost'
    # 10 ngày mỗi 60 s, thời hạn 7 ngày. Đích nhận ngày đầu (1440 dòng) rồi vắng mặt; đợt dọn xóa
    # 3 ngày đầu: 1440 dòng đã gửi và 2880 dòng chưa kịp gửi. Đích mới (chưa nhận gì) thì không có
    # dòng nào là mất (review S1), nên kịch bản cần con trỏ > 0.
    $start = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - 10 * 86400000
    Invoke-Tool $Db @('fill', '--data-dir', $dir, '--table', $t, '--columns', $cols, '--retention', '7', '--rows', '1440', '--period', '60000', '--start-ms', "$start") | Out-Null
    $first = ConvertFrom-ToolJson (Invoke-Tool $Db @('forward', '--data-dir', $dir, '--table', $t, '--columns', $cols, '--dest', $dest, '--timeout-ms', '180000'))
    Invoke-Tool $Db @('fill', '--data-dir', $dir, '--table', $t, '--columns', $cols, '--retention', '7', '--rows', '12960', '--period', '60000', '--start-ms', "$($start + 1440 * 60000)") | Out-Null
    $deleted = [int64](Invoke-Tool $Db @('purge', '--data-dir', $dir, '--table', $t, '--older-than-days', '7'))
    $sent = ConvertFrom-ToolJson (Invoke-Tool $Db @('forward', '--data-dir', $dir, '--table', $t, '--columns', $cols, '--dest', $dest, '--timeout-ms', '180000'))
    # đích vẫn giữ ngày đầu đã nhận: so từ ngày thứ ba trở đi
    $check = ConvertFrom-ToolJson (Invoke-Tool $Db @('verify', '--data-dir', $dir, '--table', $t, '--columns', $cols, '--dest', $dest, '--from-ms', "$($start + 2 * 86400000)"))
    return [ordered]@{
        db = $Db; sentFirstDay = $first.sentRows; deletedOnDevice = $deleted
        deletedBeforeSending = $deleted - $first.sentRows
        lostRows = $sent.lostRows; sentRows = $sent.sentRows
        verify = $check
        pass = ($first.sentRows -eq 1440) -and ($deleted -gt 1440) -and
            ($sent.lostRows -eq ($deleted - 1440)) -and $check.same
    }
}

# SQLite trên thiết bị: 10 lần kill -9 giữa lúc ghi, lần nào integrity_check cũng "ok" (SC-008 tự động).
function Invoke-KillWriter {
    $runs = @()
    for ($i = 1; $i -le 10; $i++) {
        $name = 'mat-rel-writer'
        docker rm -f $name *> $null
        Invoke-Tool 'mysql' @('write-loop', '--data-dir', '/rel/writer', '--table', 'w', '--columns', $cols, '--rows', '100', '--every', '10') $name | Out-Null
        Start-Sleep -Milliseconds (Get-Random -Minimum 500 -Maximum 1500)
        docker kill $name *> $null
        docker rm -f $name *> $null
        $ok = Invoke-Tool 'mysql' @('integrity', '--data-dir', '/rel/writer')
        $rows = Invoke-Tool 'mysql' @('count', '--data-dir', '/rel/writer', '--table', 'w')
        $runs += [ordered]@{ run = $i; integrity = $ok; rows = [int64]$rows }
    }
    return [ordered]@{ runs = $runs; pass = @($runs | Where-Object { $_.integrity -ne 'ok' }).Count -eq 0 }
}

function Invoke-Reliability {
    try {
        Build-X64 @('historian_it', 'historian_tool')
        Start-Dbs
        Invoke-HistorianIt @('--gtest_filter=SqlTlsIt.*') | Out-Null  # DB scada (SQL Server) và tài khoản
        if ($LASTEXITCODE) { throw 'account setup failed' }
        docker volume rm -f $relVolume *> $null
        docker volume create $relVolume | Out-Null
        $dbs = @('mysql', 'mssql', 'postgresql', 'influxdb')
        $outage = @(); $crash = @(); $lost = @()
        foreach ($db in $dbs) { Write-Host "outage $db"; $outage += Invoke-Outage $db }
        foreach ($db in $dbs) { Write-Host "crash $db"; $crash += Invoke-Crash $db }
        foreach ($db in $dbs) { Write-Host "lost $db"; $lost += Invoke-Lost $db }
        Write-Host 'kill -9 writer x10'
        $writer = Invoke-KillWriter
        $all = @($outage + $crash + $lost)
        $result = [ordered]@{
            scenario = 'reliability-x64'
            at = (Get-Date).ToUniversalTime().ToString('s') + 'Z'
            outage = $outage; crash = $crash; lost = $lost; killWriter = $writer
            pass = (@($all | Where-Object { -not $_.pass }).Count -eq 0) -and $writer.pass
        }
        $json = $result | ConvertTo-Json -Depth 8
        [IO.File]::WriteAllText("$root/docs/reports/003-reliability-x64.json", $json + "`n", $utf8)
        Write-Host $json
        if (-not $result.pass) { throw 'reliability scenario FAILED' }
        Write-Host 'reliability scenario PASS' -ForegroundColor Green
    } finally {
        docker rm -f mat-rel-writer mat-rel-fwd-mysql mat-rel-fwd-mssql mat-rel-fwd-postgresql mat-rel-fwd-influxdb *> $null
        if (-not $Keep) { docker volume rm -f $relVolume *> $null }
        Stop-Dbs
    }
}

switch ($Scenario) {
    'retention' { Invoke-Retention }
    'forward' { Invoke-Forward }
    'reliability' { Invoke-Reliability }
}
