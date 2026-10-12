# Build the armhf toolchain image (once) and compile inside it.
# Usage: ./deployment/toolchain/build.ps1 [-BuildDir C:\build\mat-armhf-<name>]
# -BuildDir: build outside the repo (mounted at /build); default build/armhf inside the repo, as before.
param([string]$BuildDir = '')
$root = Resolve-Path "$PSScriptRoot/../.."
docker build -q -t mat-armhf "$PSScriptRoot"
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$mount = @()
$dir = 'build/armhf'
if ($BuildDir) {
    New-Item -ItemType Directory -Force $BuildDir | Out-Null
    $mount = @('-v', "${BuildDir}:/build")
    $dir = '/build/armhf'
}
docker run --rm -v "${root}:/src" @mount mat-armhf sh -c "cmake -S . -B $dir -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE=deployment/toolchain/armhf.cmake && cmake --build $dir"
exit $LASTEXITCODE
