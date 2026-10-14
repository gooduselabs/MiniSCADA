# Kịch bản tích hợp x64 của feature 010 (lưu trữ nâng cao, tổng hợp): chạy trong container toolchain.
# Dùng: ./tools/historian-it-010.ps1 -Scenario agg [-Days 3] [-Tags 24] [-BuildDir C:\build\w5-x64] [-DataDir C:\build\w5-data]
#   agg: fill-agg (Days ngày x Tags Tag, 3 lần chạy, khoảng thiếu) ghi dòng thô và bucket cùng bộ cộng dồn;
#        so từng bucket phút và giờ với bản tham chiếu độc lập tools/history-ref (SC-003) và với
#        `mat-runtime --verify-aggregates` (0 thiếu, 0 thừa, 0 lệch); rồi dựng bù: fill-agg --agg 0 (chỉ dòng thô),
#        Historian thật dựng bù nền, so lại với tham chiếu (SC-002 phần x64).
# Kết quả: docs/reports/010-agg-x64.json. Dữ liệu ở -DataDir (ngoài ổ D:), xóa khi xong trừ khi có -Keep.
# (Thông báo in ra không dấu: Windows PowerShell 5.1 đọc file .ps1 không BOM theo codepage ANSI.)
param(
    [ValidateSet('agg')][string]$Scenario = 'agg',
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

switch ($Scenario) {
    'agg' { Invoke-Agg }
}
