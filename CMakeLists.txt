cmake_minimum_required(VERSION 3.16)
project(mat_scada LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
find_package(Threads REQUIRED)
enable_testing()

set(MAT_WARN -Wall -Wextra -Wno-psabi)

add_executable(hello-armhf tools/hello-armhf/main.cpp)

# CivetWeb (MIT) vendored in third_party/civetweb
add_library(civetweb STATIC third_party/civetweb/civetweb.c)
target_include_directories(civetweb PUBLIC third_party/civetweb)
target_compile_definitions(civetweb PUBLIC NO_SSL NO_CGI USE_WEBSOCKET)
target_link_libraries(civetweb PUBLIC Threads::Threads ${CMAKE_DL_LIBS} rt)
target_compile_options(civetweb PRIVATE -w)

# Same CivetWeb, built for mat-runtime WITHOUT automatic file serving (NO_FILES): the runtime
# serves its own allowlisted files, so CivetWeb's file/redirect code (CVE-2025-55763) is absent.
add_library(civetweb_runtime STATIC third_party/civetweb/civetweb.c)
target_include_directories(civetweb_runtime PUBLIC third_party/civetweb)
target_compile_definitions(civetweb_runtime PUBLIC NO_SSL NO_CGI USE_WEBSOCKET NO_FILES)
target_link_libraries(civetweb_runtime PUBLIC Threads::Threads ${CMAKE_DL_LIBS} rt)
target_compile_options(civetweb_runtime PRIVATE -w)

# Header-only JSON + JSON Schema (MIT / BSD-2), see third_party/LICENSES.md
add_library(mat_json INTERFACE)
target_include_directories(mat_json SYSTEM INTERFACE third_party/nlohmann third_party/valijson/include)

# Logic independent of the web server (unit-tested without network).
add_library(mat_core STATIC
  core/tag-engine/tag_store.cpp
  server/websocket/live_hub.cpp
  server/config.cpp
  core/project-manager/project_validator.cpp
  drivers/simulation/mock_tag_provider.cpp
  server/websocket/origin.cpp)
target_include_directories(mat_core PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_core PUBLIC mat_json Threads::Threads)
target_compile_definitions(mat_core PUBLIC VALIJSON_USE_EXCEPTIONS=1)
target_compile_options(mat_core PRIVATE ${MAT_WARN} -O2)

# mat-runtime: the device runtime (Sprint 1)
add_executable(mat-runtime
  server/main.cpp
  server/websocket/civet_transport.cpp
  server/http/http_api.cpp)
target_compile_options(mat-runtime PRIVATE ${MAT_WARN} -O2)
target_link_libraries(mat-runtime PRIVATE mat_core civetweb_runtime)

# Sprint 0 PoC, kept to reproduce the published measurements (not deployed).
add_executable(mat-poc server/poc/main.cpp)
target_include_directories(mat-poc PRIVATE ${CMAKE_SOURCE_DIR})
target_compile_options(mat-poc PRIVATE ${MAT_WARN} -O2)
target_link_libraries(mat-poc PRIVATE civetweb)

# Unit tests (host build only)
if(NOT CMAKE_CROSSCOMPILING)
  set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)
  set(BUILD_GMOCK OFF CACHE BOOL "" FORCE)
  add_subdirectory(third_party/googletest EXCLUDE_FROM_ALL)
  include(GoogleTest)

  function(mat_test name)
    add_executable(${name} ${ARGN})
    target_link_libraries(${name} PRIVATE mat_core GTest::gtest_main)
    target_compile_options(${name} PRIVATE ${MAT_WARN})
    target_compile_definitions(${name} PRIVATE
      MAT_SOURCE_DIR="${CMAKE_SOURCE_DIR}")
    gtest_discover_tests(${name} DISCOVERY_TIMEOUT 30)
  endfunction()

  mat_test(session_manager_test core/session-manager/tests/session_manager_test.cpp)
  mat_test(send_queue_test core/session-manager/tests/send_queue_test.cpp)
  mat_test(tag_store_test core/tag-engine/tests/tag_store_test.cpp)
  mat_test(live_hub_test server/websocket/tests/live_hub_test.cpp)
  mat_test(config_test server/tests/config_test.cpp)
  mat_test(project_validator_test core/project-manager/tests/project_validator_test.cpp)
  mat_test(mock_tag_provider_test drivers/simulation/tests/mock_tag_provider_test.cpp)
  mat_test(origin_test server/tests/origin_test.cpp)
endif()

# Web client (apps/runtime-web): Vite build + gzip.
# Không thuộc `all`: chạy bằng `cmake --build <dir> --target runtime-web` khi máy có npm.
find_program(NPM_EXECUTABLE NAMES npm.cmd npm)
if(NOT NPM_EXECUTABLE)
  message(STATUS "npm không có: bỏ qua target runtime-web")
endif()
if(NPM_EXECUTABLE)
  add_custom_target(runtime-web
    COMMAND ${NPM_EXECUTABLE} run build -w @mat/runtime-web
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    COMMENT "Build apps/runtime-web (Vite + gzip)"
    VERBATIM)
endif()
