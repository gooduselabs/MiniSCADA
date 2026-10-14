# Kịch bản tích hợp x64 của feature 010 (lưu trữ nâng cao, tổng hợp): chạy trong container toolchain.
# Dùng: ./tools/historian-it-010.ps1 -Scenario agg [-Days 3] [-Tags 24] [-BuildDir C:\build\w5-x64] [-DataDir C:\build\w5-data]
#   agg: fill-agg (Days ngày x Tags Tag, 3 lần chạy, khoảng thiếu) ghi dòng thô và bucket cùng bộ cộng dồn;
#        so từng bucket phút và giờ với bản tham chiếu độc lập tools/history-ref (SC-003) và với
#        `mat-runtime --verify-aggregates` (0 thiếu, 0 thừa, 0 lệch); rồi dựng bù: fill-agg --agg 0 (chỉ dòng thô),
#        Historian thật dựng bù nền, so lại với tham chiếu (SC-002 phần x64).
#   kill100: mat-runtime x64 chạy projects/history-demo (nhóm dien chu kỳ 1 s, ap-suat, van-hanh, me-tron; tổng hợp bật)
#        trong container; Iterations lần `kill -9` ở thời điểm ngẫu nhiên (chờ 1-12 s, hạt giống -Seed ghi lại);
#        sau mỗi lần: `--check-history` (integrity_check = ok) và `--verify-aggregates` cho từng nhóm tổng hợp
#        (0 thiếu/thừa/lệch). Kết quả docs/reports/010-kill100-x64.json (SC-005, SC-023 phần x64).
# Kết quả: docs/reports/010-agg-x64.json. Dữ liệu ở -DataDir (ngoài ổ D:), xóa khi xong trừ khi có -Keep.
# (Thông báo in ra không dấu: Windows PowerShell 5.1 đọc file .ps1 không BOM theo codepage ANSI.)
param(
    [ValidateSet('agg', 'kill100')][string]$Scenario = 'agg',
    [int]$Iterations = 100,
    [int]$Seed = 20261014,
    [double]$Days = 3,
    [int]$Tags = 24,
    [string]$BuildDir = 'C:\build\w5-x64',
    [string]$DataDir = 'C:\build\w5-data',
    [string]$Name = 'w5-it',
    [switch]$Keep
)
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path "$PSScriptRoot/..").Path
$utf8 = New-Object Text.UTF8Encoding $false

function Invoke-Box([string]$Cmd, [string]$Dir) {
    docker rm -f $Name *> $null
    $out = docker run --rm --name $Name -v "${root}:/src:ro" -v "${BuildDir}:/build" -v "${Dir}:/data" mat-armhf sh -c $Cmd
    if ($LASTEXITCODE) { throw "container command failed ($LASTEXITCODE): $Cmd" }
    return $out
}

function Build-Tools {
    docker build -q -t mat-armhf "$root/deployment/toolchain" | Out-Null
    docker rm -f $Name *> $null
    docker run --rm --name $Name -v "${root}:/src" -v "${BuildDir}:/build" mat-armhf sh -c "cmake -S . -B /build/x64 -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null && cmake --build /build/x64 --target mat-runtime historian_tool"
    if ($LASTEXITCODE) { throw 'build failed' }
}

function Compare-WithRef([string]$Dir, [string]$EndMs, [string]$Label) {
    $res = node "$root/tools/history-ref/verify-db.mjs" --db "$Dir\history.db" --dump "$Dir\dump.csv" --table bench --tags $Tags --end-ms $EndMs --gap-ms 300000
    $code = $LASTEXITCODE
    Write-Host "[$Label] history-ref: $res"
    return [ordered]@{ exit = $code; result = ($res | ConvertFrom-Json) }
}

function Invoke-Agg {
    Build-Tools
    New-Item -ItemType Directory -Force $DataDir | Out-Null
    $a = Join-Path $DataDir 'agg'
    $b = Join-Path $DataDir 'backfill'
    foreach ($d in @($a, $b)) { if (Test-Path $d) { Remove-Item -Recurse -Force $d }; New-Item -ItemType Directory -Force $d | Out-Null }
    $bin = '/build/x64/bin'
    $fill = "--days $Days --tags $Tags --period 30000 --run-hours 24"

    Write-Host 'phase 1: fill-agg with aggregates written like the runtime does'
    $t0 = Get-Date
    $j1 = (Invoke-Box "$bin/historian_tool fill-agg --data-dir /data $fill --agg 1 --dump /data/dump.csv" $a) | Select-Object -Last 1 | ConvertFrom-Json
    $fillS = ((Get-Date) - $t0).TotalSeconds
    $ref1 = Compare-WithRef $a $j1.endMs 'agg'
    $v1 = (Invoke-Box "$bin/mat-runtime --verify-aggregates bench --data-dir /data --json" $a) | Select-Object -Last 1 | ConvertFrom-Json
    Write-Host "verify-aggregates: missing=$($v1.missing) extra=$($v1.extra) mismatch=$($v1.mismatch) checked=$($v1.checked)"

    Write-Host 'phase 2: raw rows only, then the Historian builds the buckets in the background'
    $j2 = (Invoke-Box "$bin/historian_tool fill-agg --data-dir /data $fill --agg 0 --dump /data/dump.csv" $b) | Select-Object -Last 1 | ConvertFrom-Json
    $bf = (Invoke-Box "$bin/historian_tool backfill --data-dir /data --tags $Tags --timeout-s 3000" $b) | Select-Object -Last 1 | ConvertFrom-Json
    Write-Host "backfill: $($bf | ConvertTo-Json -Compress)"
    # the buckets of the file are those built from the raw rows before the Historian began to write
    $ref2 = Compare-WithRef $b $j2.endMs 'backfill'

    $result = [ordered]@{
        scenario = 'agg-x64'
        at = (Get-Date).ToUniversalTime().ToString('s') + 'Z'
        days = $Days
        tags = $Tags
        rows = $j1.rows
        fillSeconds = [math]::Round($fillS, 1)
        direct = [ordered]@{ refExit = $ref1.exit; ref = $ref1.result; verify = $v1 }
        backfill = [ordered]@{ runtime = $bf; refExit = $ref2.exit; ref = $ref2.result }
    }
    $result.pass = [bool](($ref1.exit -eq 0) -and ($v1.missing + $v1.extra + $v1.mismatch -eq 0) -and $bf.done -and ($ref2.exit -eq 0))
    $json = $result | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText("$root/docs/reports/010-agg-x64.json", $json + "`n", $utf8)
    Write-Host $json
    if (-not $Keep) { Remove-Item -Recurse -Force $a, $b -ErrorAction SilentlyContinue }
    if (-not $result.pass) { throw 'agg scenario FAILED' }
    Write-Host 'agg scenario PASS' -ForegroundColor Green
}

function Invoke-Kill100 {
    Build-Tools
    # the web build the runtime serves; not needed for the data checks
    $dir = Join-Path $DataDir 'kill'
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
    New-Item -ItemType Directory -Force "$dir\data", "$dir\project" | Out-Null
    Copy-Item -Recurse -Force "$root/projects/history-demo/*" "$dir\project"
    # fast groups: a row every second, so that a few seconds of run give rows and a minute gives buckets
    $logPath = "$dir\project\logging.json"
    $log = [IO.File]::ReadAllText($logPath) | ConvertFrom-Json
    foreach ($g in $log.groups) { if ($g.id -eq 'dien') { $g.periodMs = 1000 } }
    [IO.File]::WriteAllText($logPath, ($log | ConvertTo-Json -Depth 10), $utf8)
    $bin = '/build/x64/bin'
    $run = "exec $bin/mat-runtime --project-dir /project --schemas-dir /src/schemas --data-dir /data --docroot /src/apps/runtime-web/dist-device --port 8080"
    $rng = New-Object System.Random $Seed
    $groups = @('dien', 'ap-suat')
    $okCount = 0
    $iters = @()
    $totalRows = 0
    for ($i = 1; $i -le $Iterations; $i++) {
        $wait = $rng.Next(1000, 12001)
        docker rm -f $Name *> $null
        docker run -d --name $Name -v "${root}:/src:ro" -v "${BuildDir}:/build" -v "$dir\data:/data" -v "$dir\project:/project:ro" mat-armhf sh -c $run | Out-Null
        if ($LASTEXITCODE) { throw 'docker run failed' }
        Start-Sleep -Milliseconds (2000 + $wait)
        docker kill -s KILL $Name | Out-Null
        docker rm -f $Name *> $null
        $chk = Invoke-Box "$bin/mat-runtime --check-history --data-dir /data; echo EXIT=`$?" "$dir\data" | Out-String
        $integrity = $chk -match 'integrity: ok' -and $chk -match 'EXIT=0'
        $diffs = 0
        foreach ($g in $groups) {
            $v = (Invoke-Box "$bin/mat-runtime --verify-aggregates $g --data-dir /data --json; true" "$dir\data") | Select-Object -Last 1
            if ($v -and $v.StartsWith('{')) {
                $o = $v | ConvertFrom-Json
                $diffs += $o.missing + $o.extra + $o.mismatch
            } else { $diffs += 1000 }
        }
        if ($integrity -and $diffs -eq 0) { $okCount++ }
        $iters += [ordered]@{ n = $i; waitMs = $wait; integrity = [bool]$integrity; diffs = $diffs }
        Write-Host ("kill {0}/{1} wait={2} ms integrity={3} diffs={4}" -f $i, $Iterations, $wait, $integrity, $diffs)
    }
    $stats = (Invoke-Box "$bin/mat-runtime --history-stats --data-dir /data --json" "$dir\data") | Select-Object -Last 1
    $result = [ordered]@{
        scenario = 'kill100-x64'
        at = (Get-Date).ToUniversalTime().ToString('s') + 'Z'
        seed = $Seed
        iterations = $Iterations
        ok = $okCount
        stats = ($stats | ConvertFrom-Json)
        runs = $iters
    }
    $result.pass = ($okCount -eq $Iterations)
    $json = $result | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText("$root/docs/reports/010-kill100-x64.json", $json + "`n", $utf8)
    Write-Host "kill100: $okCount/$Iterations ok"
    if (-not $Keep) { Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue }
    if (-not $result.pass) { throw 'kill100 scenario FAILED' }
    Write-Host 'kill100 scenario PASS' -ForegroundColor Green
}

switch ($Scenario) {
    'agg' { Invoke-Agg }
    'kill100' { Invoke-Kill100 }
}
