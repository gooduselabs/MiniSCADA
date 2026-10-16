<#
.SYNOPSIS
  Pulls the soak samples of mat-sample (/run/mat-sample/*.jsonl) from the device and merges them into one file
  (feature 011, T070; FR-037, contract test-protocols.md §2).

.DESCRIPTION
  Run every hour (Task Scheduler) or by hand. Read-only on the device: only `scp` from /run/mat-sample and,
  with -Diagnostics, a GET of /api/v1/diagnostics. The tmpfs ring on the device holds >= 8 hours, so a missed
  pull is caught up by the next one; lines already in the merged file are skipped (dedupe on the exact line).

  Output in -Out:
    samples.jsonl              every distinct sample line, in order of time (input of tools/soak/analyze.mjs)
    pull/<stamp>/*.jsonl       the raw files of each pull (kept for audit of the collection)
    diagnostics-<stamp>.json   with -Diagnostics

.EXAMPLE
  pwsh tools/soak/collect.ps1 -Device <bl335-ip> -User root -Out docs/reports/soak-bl335-raw
  pwsh tools/soak/collect.ps1 -Device <bl335-ip> -Out raw -Diagnostics -Token $env:MAT_TOKEN
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Device,
    [string]$User = 'root',
    [Parameter(Mandatory = $true)][string]$Out,
    [int]$Port = 22,
    [string]$RemoteDir = '/run/mat-sample',
    [string]$IdentityFile = '',
    [switch]$Diagnostics,
    [string]$ApiBase = '',
    [string]$Token = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Get-Command scp -ErrorAction SilentlyContinue)) { throw 'scp (OpenSSH client) is required' }

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$null = New-Item -ItemType Directory -Force -Path $Out
$pullDir = Join-Path $Out (Join-Path 'pull' $stamp)
$null = New-Item -ItemType Directory -Force -Path $pullDir

$sshOpts = @('-P', "$Port", '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15')
if ($IdentityFile) { $sshOpts += @('-i', $IdentityFile) }
$remote = "${User}@${Device}:${RemoteDir}/samples-*.jsonl"
Write-Host "scp $remote -> $pullDir"
& scp @sshOpts $remote $pullDir
if ($LASTEXITCODE -ne 0) {
    Write-Warning "scp failed (exit $LASTEXITCODE): network down or no sample yet; the device ring keeps >= 8 h, pull again later"
    exit 1
}

# Merge: dedupe on the exact line, sort on the "t" field (ISO UTC, so a string sort is a time sort).
$merged = Join-Path $Out 'samples.jsonl'
$seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
$rows = [System.Collections.Generic.List[object]]::new()
$addLine = {
    param([string]$line)
    $l = $line.Trim()
    if (-not $l) { return 0 }
    if (-not $seen.Add($l)) { return 0 }
    $t = ''
    if ($l -match '^\{"t":"([^"]+)"') { $t = $Matches[1] }
    $rows.Add([pscustomobject]@{ t = $t; line = $l })
    return 1
}
$before = 0
if (Test-Path $merged) {
    foreach ($l in [System.IO.File]::ReadLines((Resolve-Path $merged))) { $before += & $addLine $l }
}
$new = 0
foreach ($f in Get-ChildItem -Path $pullDir -Filter '*.jsonl' -File) {
    foreach ($l in [System.IO.File]::ReadLines($f.FullName)) { $new += & $addLine $l }
}
$sorted = $rows | Sort-Object -Property t -Stable | ForEach-Object { $_.line }
$tmp = "$merged.tmp"
[System.IO.File]::WriteAllLines($tmp, [string[]]@($sorted), [System.Text.UTF8Encoding]::new($false))
Move-Item -Force -Path $tmp -Destination $merged
Write-Host "samples.jsonl: $before kept, $new new, $($rows.Count) total"

if ($Diagnostics) {
    $base = if ($ApiBase) { $ApiBase.TrimEnd('/') } else { "https://${Device}:8443" }
    $headers = @{}
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }
    $diagFile = Join-Path $Out "diagnostics-$stamp.json"
    try {
        # The device certificate is self-signed (feature 005): skip the check for this read-only GET.
        Invoke-WebRequest -Uri "$base/api/v1/diagnostics" -Headers $headers -SkipCertificateCheck `
            -TimeoutSec 30 -OutFile $diagFile
        Write-Host "diagnostics -> $diagFile"
    } catch {
        Write-Warning "GET /api/v1/diagnostics failed: $($_.Exception.Message)"
    }
}
exit 0
