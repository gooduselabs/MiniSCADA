# Values that differ between the Windows dev machine (Windows PowerShell 5.1) and macOS/Linux (PowerShell 7).
# Dot-source after the param block:  . "$PSScriptRoot/lib/platform.ps1"  (or ../../tools/lib/platform.ps1).
# $IsWindows does not exist in Windows PowerShell 5.1, so the test also reads $env:OS.
$MatIsWindows = ($env:OS -eq 'Windows_NT') -or ($IsWindows -eq $true)

# Root of the build folders outside the repo: MAT_BUILD_ROOT if set, else C:\build on Windows and ~/build elsewhere.
$MatBuildRoot = if ($env:MAT_BUILD_ROOT) { $env:MAT_BUILD_ROOT } elseif ($MatIsWindows) { 'C:\build' } else { Join-Path $HOME 'build' }

# Temporary folder ($env:TEMP is unset on macOS/Linux).
$MatTemp = [IO.Path]::GetTempPath()

# The null device for curl -o, and the curl binary (curl is an alias of Invoke-WebRequest in Windows PowerShell 5.1).
$MatNull = if ($MatIsWindows) { 'NUL' } else { '/dev/null' }
$MatCurl = if ($MatIsWindows) { 'curl.exe' } else { 'curl' }

# Suffix of native executables built on the host (tools/load-tester: go build -o build/load-tester$MatExe).
$MatExe = if ($MatIsWindows) { '.exe' } else { '' }

function Get-MatBuildDir([string]$Name) { Join-Path $MatBuildRoot $Name }
