# Build and run host (x64) unit tests inside the toolchain container.
# Usage: ./deployment/toolchain/test-x64.ps1 [-BuildDir C:\build\mat-x64-<name>] [-Filter <ctest -R regex>]
#        [-Target "<target> [<target>...]"]
# -BuildDir: build outside the repo (mounted at /build) so several builds can run side by side and the
# nearly full D: drive is spared; default is build/x64 inside the repo, as before.
# -Filter: GoogleTest names (Suite.Test), not executable names; a wrong regex runs nothing and exits 0.
# -Target: build only these targets (and what they link), so a module another person is still
# changing does not stop the build; combine with -Filter for the tests of those targets.
param([string]$BuildDir = '', [string]$Filter = '', [string]$Target = '')
$root = Resolve-Path "$PSScriptRoot/../.."
docker build -q -t mat-armhf "$PSScriptRoot"
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$mount = @()
$dir = 'build/x64'
if ($BuildDir) {
    New-Item -ItemType Directory -Force $BuildDir | Out-Null
    $mount = @('-v', "${BuildDir}:/build")
    $dir = '/build/x64'
}
$ctest = if ($Filter) { "ctest --output-on-failure -R '$Filter'" } else { 'ctest --output-on-failure' }
$build = if ($Target) { "cmake --build $dir --target $Target" } else { "cmake --build $dir" }
docker run --rm -v "${root}:/src" @mount mat-armhf sh -c "cmake -S . -B $dir -G Ninja -DCMAKE_BUILD_TYPE=Release && $build && cd $dir && $ctest"
exit $LASTEXITCODE
