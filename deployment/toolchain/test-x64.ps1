# Build and run host (x64) unit tests inside the toolchain container.
$root = Resolve-Path "$PSScriptRoot/../.."
docker build -q -t mat-armhf "$PSScriptRoot"
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker run --rm -v "${root}:/src" mat-armhf sh -c "cmake -S . -B build/x64 -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build/x64 && cd build/x64 && ctest --output-on-failure"
exit $LASTEXITCODE
