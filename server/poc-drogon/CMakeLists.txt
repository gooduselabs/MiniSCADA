# PoC so sánh Drogon (T026). Build TÁCH RIÊNG khỏi CMakeLists gốc để CI/bản mặc định không phụ thuộc Drogon.
# Build (image mat-armhf-drogon, xem deployment/toolchain/Dockerfile.drogon):
#   cmake -S server/poc-drogon -B build/armhf-drogon -G Ninja -DCMAKE_BUILD_TYPE=Release \
#         -DCMAKE_TOOLCHAIN_FILE=/opt/armhf.cmake -DCMAKE_PREFIX_PATH=/opt/drogon-armhf
#   cmake --build build/armhf-drogon
cmake_minimum_required(VERSION 3.16)
project(mat_poc_drogon LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Drogon CONFIG REQUIRED)

add_executable(mat-poc-drogon main.cpp)
target_include_directories(mat-poc-drogon PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../.. ${CMAKE_CURRENT_SOURCE_DIR}/..)
target_compile_options(mat-poc-drogon PRIVATE -Wall -Wextra -Wno-psabi -O2)
target_link_libraries(mat-poc-drogon PRIVATE Drogon::Drogon)
