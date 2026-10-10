# Build the armhf toolchain image (once) and compile inside it.
# Usage: ./deployment/toolchain/build.ps1
$root = Resolve-Path "$PSScriptRoot/../.."
docker build -q -t mat-armhf "$PSScriptRoot"
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker run --rm -v "${root}:/src" mat-armhf sh -c "cmake -S . -B build/armhf -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE=deployment/toolchain/armhf.cmake && cmake --build build/armhf"
exit $LASTEXITCODE
