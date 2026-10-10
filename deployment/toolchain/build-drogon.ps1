# Build PoC so sánh Drogon (T026) cho armhf: dựng image mat-armhf-drogon (Drogon v1.9.13 tĩnh, không TLS/ORM)
# rồi biên dịch server/poc-drogon. jsoncpp liên kết tĩnh vì BL335 không có libjsoncpp.
# Usage: ./deployment/toolchain/build-drogon.ps1   → build/armhf-drogon/mat-poc-drogon
$root = Resolve-Path "$PSScriptRoot/../.."
docker build -q -t mat-armhf "$PSScriptRoot"
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker build -q -t mat-armhf-drogon -f "$PSScriptRoot/Dockerfile.drogon" "$PSScriptRoot"
if ($LASTEXITCODE) { exit $LASTEXITCODE }
docker run --rm -v "${root}:/src" mat-armhf-drogon sh -c "cmake -S server/poc-drogon -B build/armhf-drogon -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE=/opt/armhf.cmake -DCMAKE_PREFIX_PATH=/opt/drogon-armhf -DJSONCPP_LIBRARIES=/usr/lib/arm-linux-gnueabihf/libjsoncpp.a && cmake --build build/armhf-drogon"
exit $LASTEXITCODE
