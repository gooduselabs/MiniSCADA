# Kiem tich hop logic v2 tren x64 (feature 011 T146, T147; SC-025 den SC-028).
# Dung: ./tools/logic-it.ps1 [-Scenario rules,writes-off,throttle,stop,retain-kill,retain-lost,deploy-keep,load]
#        [-Rounds 100] [-Seconds 600] [-Clients 10] [-BuildDir <thu muc>] [-NoBuild] [-Keep]
# Chay node tools/logic-it/run.mjs: runtime x64 trong Docker (rig tests/driver-it/compose.yaml, project mat-logic-it),
# gia lap Modbus (tools/modbus-sim/maps/logic-it.json), client Node (tests/logic-it/logic-it.mjs). Mo ta tung kich ban
# o dau tools/logic-it/run.mjs. Ket qua: docs/reports/011-logic-x64.json; load: docs/reports/011-logic-load-x64.json.
param(
    [ValidateSet('rules', 'writes-off', 'throttle', 'stop', 'retain-kill', 'retain-lost', 'deploy-keep', 'load')]
    [string[]]$Scenario = @('rules', 'writes-off', 'throttle', 'stop', 'retain-kill', 'retain-lost', 'deploy-keep'),
    [int]$Rounds = 100,
    [int]$Seconds = 600,
    [int]$Clients = 10,
    [string]$BuildDir = '',
    [switch]$NoBuild,
    [switch]$Keep
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot/..").Path
. "$PSScriptRoot/lib/platform.ps1"
if (-not $BuildDir) { $BuildDir = Get-MatBuildDir 'mat-x64-e2' }
$a = @("$root/tools/logic-it/run.mjs", '--scenario', ($Scenario -join ','), '--rounds', "$Rounds", '--seconds', "$Seconds",
    '--clients', "$Clients", '--build-dir', $BuildDir)
if ($NoBuild) { $a += '--no-build' }
if ($Keep) { $a += '--keep' }
node @a
exit $LASTEXITCODE
