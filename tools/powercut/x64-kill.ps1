<#
.SYNOPSIS
  x64 pre-check of the power-cut protocol with `docker kill -s KILL` (feature 011, T074; FR-043, D14,
  contract test-protocols.md §4).

.DESCRIPTION
  -Rounds random rounds (default 100: cut at a uniform time in [0, -MaxDelayS] s after the runtime is READY and
  stable) and -PointRounds rounds at each point D1, D3, D4, D5 (default 10). Each round:
    1. wait READY (GET <BaseUrl>/api/v1/system/info, self-signed certificate accepted) and stable -StableS s;
    2. choose the kill time (random, or the event of the point read from inside the container);
    3. docker kill -s KILL <Container>; wait 5 s; docker start <Container> (when the restart policy did not);
    4. wait READY at most -ReadyTimeoutS s (time recorded);
    5. docker exec <Container> mat-runtime --check-data --json (exit 0, or 1 only for pulse.journal entries or a
       WAL needing recovery), then the audit cross-check: every requestId of the -CommandLog logged ACCEPTED
       before the kill must be in `mat-runtime --export-audit --format jsonl` (--json is not an option of it);
    6. append the round to <Out>.rounds.jsonl; stop at the first failure and keep the container as it is.
  Writes the summary to -Out (default docs/reports/011-powercut-x64.json).

  LIMITATION (written into the report): docker kill only kills the processes; the host kernel still writes the page
  cache to disk, so data not yet fsynced is NOT lost as on a real power cut. This does not replace the BL335 power
  cut (T084, T085).

  Events of the points (inside the container, data dir -DataDir):
    D1  ops/*.json names the step activate, restart, health (rotating); a deploy must be running (started outside
        this script, e.g. a deploy loop from Studio CLI or tools/device-it.ps1)
    D3  history.db-wal larger than 4 MiB (needs the load of 500 tags by change)
    D4  pulse.journal not empty
    D5  retain/ just written: kill at RetainPeriodS - U(0, 5) s after the write (5 s before the next one)

  Never run against a container you do not own: -Container is required and has no default.

.EXAMPLE
  pwsh tools/powercut/x64-kill.ps1 -Container mat-soak-x64 -CommandLog out/cmdgen.jsonl
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$Container,
    [int]$Rounds = 100,
    [int]$PointRounds = 10,
    [string[]]$Points = @('D1', 'D3', 'D4', 'D5'),
    [string]$BaseUrl = 'https://127.0.0.1:8443',
    [string]$Runtime = '/opt/mat-runtime/bin/mat-runtime',
    [string]$DataDir = '/var/lib/mat-runtime',
    [string]$CommandLog = '',
    [string]$Out = 'docs/reports/011-powercut-x64.json',
    [int]$StableS = 60,
    [int]$MaxDelayS = 300,
    [int]$ReadyTimeoutS = 90,
    [int]$EventTimeoutS = 1800,
    [int]$RetainPeriodS = 60,
    [int]$OffS = 5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$limitation = 'docker kill -s KILL chỉ giết tiến trình; nhân Linux của máy chủ vẫn ghi page cache xuống đĩa, nên không mô phỏng mất dữ liệu chưa fsync ở tầng đĩa; không thay thế cắt điện thật trên BL335 (FR-043)'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'docker is required' }
$null = & docker inspect -f '{{.State.Status}}' $Container 2>$null
if ($LASTEXITCODE -ne 0) { throw "container not found: $Container" }

$outDir = Split-Path -Parent $Out
if ($outDir) { $null = New-Item -ItemType Directory -Force -Path $outDir }
$roundsLog = ($Out -replace '\.json$', '') + '.rounds.jsonl'

function Now-Ms { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

function Test-Ready {
    try {
        $r = Invoke-WebRequest -Uri "$($BaseUrl.TrimEnd('/'))/api/v1/system/info" -SkipCertificateCheck `
            -TimeoutSec 5 -SkipHttpErrorCheck
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300)
    } catch { return $false }
}

function Wait-Ready([int]$TimeoutS) {
    $t0 = Now-Ms
    while ($true) {
        if (Test-Ready) { return @{ ok = $true; ms = (Now-Ms) - $t0 } }
        if (((Now-Ms) - $t0) -ge $TimeoutS * 1000) { return @{ ok = $false; ms = (Now-Ms) - $t0 } }
        Start-Sleep -Seconds 2
    }
}

function Wait-Stable {
    $t0 = Now-Ms
    $since = $null
    while ($true) {
        if (Test-Ready) {
            if ($null -eq $since) { $since = Now-Ms }
            if (((Now-Ms) - $since) -ge $StableS * 1000) { return $true }
        } else { $since = $null }
        if (((Now-Ms) - $t0) -ge 900000) { return $false }
        Start-Sleep -Seconds 2
    }
}

function Exec-In([string]$Cmd) {
    $o = & docker exec $Container sh -c $Cmd 2>$null
    return @{ code = $LASTEXITCODE; out = ($o -join "`n") }
}

# Waits for the event of a point inside the container; returns a description or $null on timeout.
function Wait-Event([string]$Point, [int]$Round) {
    $t0 = Now-Ms
    $steps = @('activate', 'health', 'validate')
    $retainMark = (Exec-In "find '$DataDir/retain' -type f -exec stat -c %Y {} + 2>/dev/null | sort -n | tail -n 1").out
    while (((Now-Ms) - $t0) -lt $EventTimeoutS * 1000) {
        switch ($Point) {
            'D1' {
                $step = $steps[($Round - 1) % 3]
                $r = Exec-In "grep -l '`"result`": `"running`"' '$DataDir'/projects/ops/*.json 2>/dev/null | xargs -r grep -l '\b$step\b' | head -n 1"
                if ($r.out) { return "ops step $step in $($r.out)" }
            }
            'D3' {
                $r = Exec-In "stat -c %s '$DataDir/history.db-wal' 2>/dev/null"
                if ($r.out -match '^\d+$' -and [int64]$r.out -gt 4MB) { return "history.db-wal $($r.out) bytes" }
            }
            'D4' {
                $r = Exec-In "test -s '$DataDir/pulse.journal' && echo yes"
                if ($r.out -eq 'yes') { return 'pulse.journal not empty' }
            }
            'D5' {
                $m = (Exec-In "find '$DataDir/retain' -type f -exec stat -c %Y {} + 2>/dev/null | sort -n | tail -n 1").out
                if ($m -and $m -ne $retainMark) { return "retain written at $m" }
            }
            default { throw "unknown point: $Point" }
        }
        Start-Sleep -Milliseconds 500
    }
    return $null
}

function Get-RequestIds([string]$Text) {
    $ids = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($m in [regex]::Matches($Text, 'requestId"?\s*[=:]\s*"?([A-Za-z0-9._-]+)')) { [void]$ids.Add($m.Groups[1].Value) }
    return , $ids
}

function Get-Accepted {
    if (-not $CommandLog -or -not (Test-Path $CommandLog)) { return $null }
    $ids = [System.Collections.Generic.List[string]]::new()
    foreach ($l in Get-Content -Path $CommandLog) {
        if ($l -notmatch '\bACCEPTED\b') { continue }
        if ($l -match 'requestId"?\s*[=:]\s*"?([A-Za-z0-9._-]+)') {
            if (-not $ids.Contains($Matches[1])) { $ids.Add($Matches[1]) }
        }
    }
    return , $ids
}

# exit 0 + ok passes; exit 1 only when every warning is pulse.journal or a .db whose detail names the WAL.
function Test-CheckData([string]$Json, [int]$Code) {
    try { $j = $Json | ConvertFrom-Json } catch { return @{ ok = $false; reason = "check-data: not JSON (exit $Code)" } }
    if ($j.schema -ne 'mat-check-data/1') { return @{ ok = $false; reason = 'check-data: wrong schema' } }
    if ($j.exitCode -ne $Code) { return @{ ok = $false; reason = "check-data: exit $Code differs from exitCode $($j.exitCode)" } }
    if ($Code -eq 0 -and $j.result -eq 'ok') { return @{ ok = $true; acceptedWarnings = @() } }
    $problems = @($j.checks | Where-Object { $_.status -in @('warning', 'damaged') })
    if ($Code -eq 1 -and $j.result -eq 'warning') {
        $bad = @($problems | Where-Object {
                -not ($_.status -eq 'warning' -and ($_.name -eq 'pulse.journal' -or ($_.name -like '*.db' -and "$($_.detail)" -match '\bwal\b')))
            })
        if ($bad.Count -eq 0) { return @{ ok = $true; acceptedWarnings = @($problems | ForEach-Object { $_.name }) } }
        return @{ ok = $false; reason = "check-data: warnings not accepted: $(($bad | ForEach-Object { $_.name }) -join ', ')" }
    }
    return @{ ok = $false; reason = "check-data: exit $Code, $($j.result): $(($problems | ForEach-Object { "$($_.name) $($_.status)" }) -join ', ')" }
}

$plan = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $Rounds; $i++) { $plan.Add('random') }
foreach ($p in $Points) { for ($i = 0; $i -lt $PointRounds; $i++) { $plan.Add($p) } }

$rounds = [System.Collections.Generic.List[object]]::new()
$failure = $null
$startedAt = (Get-Date).ToUniversalTime().ToString('o')
$n = 0
$perPointIndex = @{}
foreach ($point in $plan) {
    $n++
    if (-not $perPointIndex.ContainsKey($point)) { $perPointIndex[$point] = 0 }
    $perPointIndex[$point]++
    $r = [ordered]@{ round = $n; point = $point; startedAt = (Get-Date).ToUniversalTime().ToString('o') }
    $fail = $null
    if (-not (Wait-Stable)) { $fail = "not READY and stable $StableS s before the kill" }
    if (-not $fail) {
        if ($point -eq 'random') {
            $r.cutDelayMs = [int](Get-Random -Minimum 0 -Maximum ($MaxDelayS * 1000 + 1))
        } else {
            $ev = Wait-Event $point $perPointIndex[$point]
            if (-not $ev) { $fail = "event $point not seen in $EventTimeoutS s" }
            else {
                $r.event = $ev
                $r.cutDelayMs = if ($point -eq 'D5') { [int]($RetainPeriodS * 1000 - (Get-Random -Minimum 0 -Maximum 5001)) } else { 0 }
            }
        }
    }
    if (-not $fail) {
        Start-Sleep -Milliseconds $r.cutDelayMs
        $r.cutAt = (Get-Date).ToUniversalTime().ToString('o')
        & docker kill -s KILL $Container | Out-Null
        $accepted = Get-Accepted
        Start-Sleep -Seconds $OffS
        $st = & docker inspect -f '{{.State.Status}}' $Container
        if ($st -ne 'running') { & docker start $Container | Out-Null }
        $ready = Wait-Ready $ReadyTimeoutS
        $r.readyAfter = $ready
        if (-not $ready.ok) { $fail = "not READY within $ReadyTimeoutS s after the restart" }
        if (-not $fail) {
            $c = Exec-In "$Runtime --check-data --json --data-dir $DataDir"
            $r.check = Test-CheckData $c.out $c.code
            $r.check.exitCode = $c.code
            if (-not $r.check.ok) { $fail = $r.check.reason }
        }
        if (-not $fail) {
            if ($null -ne $accepted) {
                $exported = Get-RequestIds (Exec-In "$Runtime --export-audit --format jsonl --data-dir $DataDir").out
                $missing = @($accepted | Where-Object { -not $exported.Contains($_) })
                $r.audit = [ordered]@{ status = $(if ($missing.Count) { 'fail' } else { 'pass' }); accepted = $accepted.Count; exported = $exported.Count; missing = $missing }
                if ($missing.Count) { $fail = "audit: $($missing.Count) ACCEPTED requestId missing from audit.db" }
            } else {
                $r.audit = [ordered]@{ status = 'not-measured'; detail = 'no -CommandLog' }
            }
        }
    }
    $r.ok = -not $fail
    if ($fail) { $r.failure = $fail }
    $rounds.Add([pscustomobject]$r)
    Add-Content -Path $roundsLog -Value ([pscustomobject]$r | ConvertTo-Json -Depth 8 -Compress)
    Write-Host ("round {0}/{1} {2}: {3}" -f $n, $plan.Count, $point, $(if ($fail) { "FAILED: $fail" } else { 'ok' }))
    if ($fail) { $failure = [ordered]@{ round = $n; point = $point; reason = $fail }; break }
}

$auditNm = @($rounds | Where-Object { $_.audit -and $_.audit.status -eq 'not-measured' }).Count
$result = if ($failure) { 'fail' } elseif ($auditNm -gt 0 -or $rounds.Count -lt $plan.Count) { 'incomplete' } else { 'pass' }
$perPoint = [ordered]@{}
foreach ($rr in $rounds) {
    if (-not $perPoint.Contains($rr.point)) { $perPoint[$rr.point] = [ordered]@{ run = 0; ok = 0 } }
    $perPoint[$rr.point].run++
    if ($rr.ok) { $perPoint[$rr.point].ok++ }
}
$readyMs = @($rounds | Where-Object { $_.readyAfter -and $_.readyAfter.ok } | ForEach-Object { $_.readyAfter.ms } | Sort-Object)
$summary = [ordered]@{
    schema         = 'mat-powercut/1'
    target         = 'x64'
    driver         = 'docker-kill'
    container      = $Container
    startedAt      = $startedAt
    finishedAt     = (Get-Date).ToUniversalTime().ToString('o')
    roundsPlanned  = $plan.Count
    roundsRun      = $rounds.Count
    roundsOk       = @($rounds | Where-Object { $_.ok }).Count
    stoppedOnFailure = [bool]$failure
    failure        = $failure
    result         = $result
    readyAfterMs   = [ordered]@{ max = $(if ($readyMs.Count) { $readyMs[-1] } else { $null }); median = $(if ($readyMs.Count) { $readyMs[[int][math]::Floor($readyMs.Count / 2)] } else { $null }); limit = $ReadyTimeoutS * 1000 }
    perPoint       = $perPoint
    auditNotMeasuredRounds = $auditNm
    limitations    = @($limitation)
    rounds         = $rounds
}
$summary | ConvertTo-Json -Depth 10 | Set-Content -Path $Out -Encoding utf8
Write-Host "result: $result -> $Out"
if ($failure) {
    Write-Host 'STOPPED: the container is kept as it is for the investigation (no fix, no further kill).'
    Write-Host "  docker logs $Container ; docker exec $Container $Runtime --check-data --json ; copy $DataDir out before touching it"
    exit 1
}
if ($result -eq 'incomplete') { exit 3 }
exit 0
