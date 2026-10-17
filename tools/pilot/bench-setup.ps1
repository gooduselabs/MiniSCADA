<#
.SYNOPSIS
  Sets up the internal pilot bench (feature 011, T190; FR-136; contract test-protocols.md sections 2 (S2) and 5):
  project soak-standard, Modbus simulator, 10 live clients (load-tester) and the pilot collector (collect.ps1).

.DESCRIPTION
  Runs on the bench PC (same LAN as the bench BL335). Steps, each one skippable and each one shown by -WhatIf:
    1. project   node tools/gen-bench-projects.mjs --only soak-standard --out <WorkDir>/projects
                 (the project is then loaded with Studio, Device > Deploy: the deploy chain of the device is not
                 bypassed; this script prints the step and waits for nothing)
    2. modbus    node tools/modbus-sim/sim.mjs --map tools/modbus-sim/maps/bench-500.json --tcp <ModbusPort>
                 --host 0.0.0.0 (the "PLC on another machine" of soak S1/S2), in the background
    3. load      build/load-tester -host <Device> -clients 10 -extra 0 -tags 500 -duration <Days * 86400>, in the
                 background (built with go when missing)
    4. collect   pwsh tools/pilot/collect.ps1 -Site <Site> -Device <Device> -User <User> -Fingerprint <sha256>,
                 in the background (password from the environment variable MAT_PILOT_PASSWORD or the Windows
                 Credential Manager). -Fingerprint is required for this step (pinned on every connection); -Insecure
                 passes -Insecure instead (certificate not checked, lab only).
  The PIDs and log files go to <WorkDir>/bench-state.json; -Stop ends the processes listed there.
  Nothing is changed on the device by this script.

.EXAMPLE
  pwsh tools/pilot/bench-setup.ps1 -Device <bench-bl335-ip> -User viewer1 -Fingerprint <sha256-hex> -WhatIf
  pwsh tools/pilot/bench-setup.ps1 -Device <bench-bl335-ip> -User viewer1 -Fingerprint <sha256-hex>
  pwsh tools/pilot/bench-setup.ps1 -Stop
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Device = '',
    [string]$User = '',
    [ValidatePattern('^[A-Za-z0-9._-]{1,64}$')][string]$Site = 'bench',
    [int]$HttpPort = 8080,
    [int]$ModbusPort = 5020,
    [ValidateRange(1, 50)][int]$Clients = 10,
    [ValidateRange(1, 120)][int]$Days = 30,
    [string]$Fingerprint = '',
    [switch]$Insecure,
    [string]$WorkDir = '',
    [switch]$DryRun,
    [switch]$SkipProject,
    [switch]$SkipModbus,
    [switch]$SkipLoad,
    [switch]$SkipCollect,
    [switch]$Stop
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../lib/platform.ps1"

if ($DryRun) { $WhatIfPreference = $true }
$root = (Resolve-Path "$PSScriptRoot/../..").Path
if (-not $WorkDir) { $WorkDir = Join-Path $root 'out/pilot-bench' }
$stateFile = Join-Path $WorkDir 'bench-state.json'
$pwshExe = (Get-Process -Id $PID).Path

function Read-State {
    if (Test-Path $stateFile) { return @(Get-Content -Raw $stateFile | ConvertFrom-Json) }
    return @()
}

if ($Stop) {
    foreach ($p in (Read-State)) {
        if ($null -eq $p) { continue }
        $proc = Get-Process -Id $p.pid -ErrorAction SilentlyContinue
        if ($proc -and $PSCmdlet.ShouldProcess("$($p.name) (pid $($p.pid))", 'Stop-Process')) {
            Stop-Process -Id $p.pid
            Write-Host "stopped $($p.name) (pid $($p.pid))"
        }
    }
    if ((Test-Path $stateFile) -and $PSCmdlet.ShouldProcess($stateFile, 'Remove')) { Remove-Item $stateFile }
    exit 0
}

if (-not $Device) { throw '-Device <bench BL335 address> is required' }
if (-not $SkipCollect -and -not $User) { throw '-User <read-only account> is required for collect.ps1 (or -SkipCollect)' }
if (-not $SkipCollect -and -not $Fingerprint -and -not $Insecure) {
    throw '-Fingerprint <sha256 of the device certificate> is required for collect.ps1 (or -Insecure, or -SkipCollect)'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node (>= 22) is required' }

if ($PSCmdlet.ShouldProcess($WorkDir, 'Create work folder')) { $null = New-Item -ItemType Directory -Force -Path $WorkDir }
$state = [System.Collections.Generic.List[object]]::new()
foreach ($p in (Read-State)) { if ($null -ne $p) { $state.Add($p) } }

function Start-BenchProcess([string]$Name, [string]$Exe, [string[]]$Arguments) {
    $log = Join-Path $WorkDir "$Name.log"
    $err = Join-Path $WorkDir "$Name.err.log"
    if (-not $PSCmdlet.ShouldProcess("$Exe $($Arguments -join ' ')", "Start $Name in the background (log $log)")) { return }
    $existing = $state | Where-Object { $_.name -eq $Name -and (Get-Process -Id $_.pid -ErrorAction SilentlyContinue) }
    if ($existing) { Write-Host "$Name already running (pid $($existing.pid))"; return }
    $proc = Start-Process -FilePath $Exe -ArgumentList $Arguments -PassThru -WorkingDirectory $root `
        -RedirectStandardOutput $log -RedirectStandardError $err
    $state.Add([pscustomobject]@{ name = $Name; pid = $proc.Id; log = $log; started = (Get-Date).ToString('o') })
    Write-Host "$Name started (pid $($proc.Id)), log $log"
}

# 1. Project soak-standard (500 Tag, history 200 Tag on change, 3 screens)
if (-not $SkipProject) {
    $projects = Join-Path $WorkDir 'projects'
    if ($PSCmdlet.ShouldProcess($projects, 'Generate project soak-standard')) {
        & node "$root/tools/gen-bench-projects.mjs" --out $projects --only soak-standard
        if ($LASTEXITCODE -ne 0) { throw "gen-bench-projects.mjs failed (exit $LASTEXITCODE)" }
    }
    Write-Host "Next (by hand): open $projects/soak-standard in Studio and deploy it to $Device (Device > Deploy)."
}

# 2. Modbus simulator (bench-500 map: holding 0..999 change every second)
if (-not $SkipModbus) {
    Start-BenchProcess 'modbus-sim' 'node' @(
        "$root/tools/modbus-sim/sim.mjs", '--map', "$root/tools/modbus-sim/maps/bench-500.json",
        '--tcp', "$ModbusPort", '--control', "$($ModbusPort + 1)", '--host', '0.0.0.0'
    )
}

# 3. Live clients
if (-not $SkipLoad) {
    $lt = Join-Path $root "build/load-tester$MatExe"
    if (-not (Test-Path $lt) -and $PSCmdlet.ShouldProcess($lt, 'go build tools/load-tester')) {
        if (-not (Get-Command go -ErrorAction SilentlyContinue)) { throw "go is required to build $lt" }
        Push-Location "$root/tools/load-tester"
        try { & go build -o $lt . } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw "go build failed (exit $LASTEXITCODE)" }
    }
    Start-BenchProcess 'load-tester' $lt @(
        '-host', $Device, '-port', "$HttpPort", '-clients', "$Clients", '-extra', '0', '-tags', '500',
        '-duration', "$($Days * 86400)", '-out', (Join-Path $WorkDir 'load-tester.json')
    )
}

# 4. Pilot collector (every 15 min; data in docs/pilot/data/<Site>/, not committed)
if (-not $SkipCollect) {
    $pw = [Environment]::GetEnvironmentVariable('MAT_PILOT_PASSWORD')
    if (-not $pw -and -not $MatIsWindows) {
        Write-Warning 'MAT_PILOT_PASSWORD is not set: collect.ps1 will stop at once (set it before running this script)'
    }
    $collectArgs = @('-NoProfile', '-File', "$root/tools/pilot/collect.ps1", '-Site', $Site, '-Device', $Device, '-User', $User)
    if ($Fingerprint) { $collectArgs += @('-Fingerprint', $Fingerprint) } elseif ($Insecure) { $collectArgs += '-Insecure' }
    Start-BenchProcess 'collect' $pwshExe $collectArgs
}

if ($state.Count -and $PSCmdlet.ShouldProcess($stateFile, 'Write bench state')) {
    $state | ConvertTo-Json -Depth 3 | Set-Content -Encoding utf8 $stateFile
}
Write-Host "KPI: node tools/pilot/kpi.mjs --site $Site --from <start date> --to <end date>"
exit 0
