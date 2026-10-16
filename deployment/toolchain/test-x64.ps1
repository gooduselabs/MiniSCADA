# Build and run host (x64) unit tests inside the toolchain container.
# Usage: ./deployment/toolchain/test-x64.ps1 [-BuildDir C:\build\mat-x64-<name>] [-Filter <ctest -R regex>]
#        [-Target "<target> [<target>...]"]
# -BuildDir: build outside the repo (mounted at /build) so several builds can run side by side and the
# nearly full D: drive is spared; default is build/x64 inside the repo, as before.
# -Filter: GoogleTest names (Suite.Test), not executable names; a wrong regex runs nothing and exits 0.
# -Sanitize: build with AddressSanitizer + UndefinedBehaviorSanitizer (use a build folder of its own).
# -Target: build only these targets (and what they link), so a module another person is still
# changing does not stop the build; combine with -Filter for the tests of those targets.
param([string]$BuildDir = '', [string]$Filter = '', [string]$Target = '', [switch]$Sanitize, [string]$Name = '')
$root = Resolve-Path "$PSScriptRoot/../.."
# Container name: MAT_DOCKER_NAME if set (feature 008), else a w4-<build dir>-<random> name (feature 009); never reuse another
# branch's name.
$nameArg = if ($Name) { @("--name", $Name) } elseif ($env:MAT_DOCKER_NAME) { @("--name", $env:MAT_DOCKER_NAME) } else { @("--name", ("w4-" + $(if ($BuildDir) { Split-Path $BuildDir -Leaf } else { "x64" }) + "-" + (Get-Random))) }
docker build -q -t mat-armhf "$PSScriptRoot"
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$mount = @()
$dir = 'build/x64'
if ($BuildDir) {
    New-Item -ItemType Directory -Force $BuildDir | Out-Null
    $mount = @('-v', "${BuildDir}:/build")
    $dir = '/build/x64'
}
$flags = '-DCMAKE_BUILD_TYPE=Release'
# The sanitizer flags go in environment variables: PowerShell 5.1 strips the double quotes of an argument of a
# native command, so a quoted -DCMAKE_CXX_FLAGS="..." reached sh in pieces.
$envFlags = ""
if ($Sanitize) {
    $flags = '-DCMAKE_BUILD_TYPE=RelWithDebInfo'
    $envFlags = "CXXFLAGS='-fsanitize=address,undefined -fno-sanitize-recover=undefined -fno-omit-frame-pointer' CFLAGS='-fsanitize=address,undefined' LDFLAGS='-fsanitize=address,undefined' "
}
$asan = if ($Sanitize) { 'ASAN_OPTIONS=detect_leaks=0:halt_on_error=1 UBSAN_OPTIONS=halt_on_error=1 MAT_FUZZ_SECONDS=20 ' } else { '' }
$ctest = if ($Filter) { "ctest --output-on-failure -R '$Filter'" } else { 'ctest --output-on-failure' }
$jobs = " -j 2"  # w4: RAM is shared with other branches; always 2 build jobs
$build = if ($Target) { "cmake --build $dir --target $Target$jobs" } else { "cmake --build $dir$jobs" }
docker run --rm @nameArg -v "${root}:/src" @mount mat-armhf sh -c "${envFlags}cmake -S . -B $dir -G Ninja $flags && $build && cd $dir && $asan$ctest"
exit $LASTEXITCODE
