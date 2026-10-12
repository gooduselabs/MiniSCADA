cmake_minimum_required(VERSION 3.16)
project(mat_scada LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
find_package(Threads REQUIRED)
enable_testing()

set(MAT_WARN -Wall -Wextra -Wno-psabi)

# Test hooks of the project switch (specs/005-device-online T108): --test-kill-at, --test-health.
# OFF by default and never in the armhf build; tools/device-it.ps1 builds its x64 runtime with ON.
# Only the sources that read them see the definition (config_test checks both builds).
option(MAT_TEST_HOOKS "Build the runtime test hooks (x64 device-it only)" OFF)
if(MAT_TEST_HOOKS)
  set_source_files_properties(server/config.cpp server/main.cpp server/tests/config_test.cpp
                              PROPERTIES COMPILE_DEFINITIONS MAT_TEST_HOOKS)
endif()

add_executable(hello-armhf tools/hello-armhf/main.cpp)

# CivetWeb (MIT) vendored in third_party/civetweb
add_library(civetweb STATIC third_party/civetweb/civetweb.c)
target_include_directories(civetweb PUBLIC third_party/civetweb)
target_compile_definitions(civetweb PUBLIC NO_SSL NO_CGI USE_WEBSOCKET)
target_link_libraries(civetweb PUBLIC Threads::Threads ${CMAKE_DL_LIBS} rt)
target_compile_options(civetweb PRIVATE -w)

# Same CivetWeb, built for mat-runtime WITHOUT automatic file serving (NO_FILES): the runtime
# serves its own allowlisted files, so CivetWeb's file/redirect code (CVE-2025-55763) is absent.
# TLS through Mbed TLS (USE_MBEDTLS, feature 005 research R4, flags settled by the T007 spike):
# a context opens HTTPS only for a listening port ending in "s"; the plain HTTP context is unchanged.
add_library(civetweb_runtime STATIC third_party/civetweb/civetweb.c)
target_include_directories(civetweb_runtime PUBLIC third_party/civetweb)
target_compile_definitions(civetweb_runtime PUBLIC USE_MBEDTLS NO_CGI USE_WEBSOCKET NO_FILES)
target_link_libraries(civetweb_runtime PUBLIC mat_mbedtls Threads::Threads ${CMAKE_DL_LIBS} rt)
target_compile_options(civetweb_runtime PRIVATE -w)

# SQLite 3.54.0 (public domain) vendored in third_party/sqlite: tag history storage (feature 003).
# Options follow sqlite.org "recommended compile-time options"; no extension loading.
add_library(mat_sqlite STATIC third_party/sqlite/sqlite3.c)
target_include_directories(mat_sqlite SYSTEM PUBLIC third_party/sqlite)
target_compile_definitions(mat_sqlite PRIVATE
  SQLITE_DQS=0 SQLITE_DEFAULT_MEMSTATUS=0 SQLITE_LIKE_DOESNT_MATCH_BLOBS SQLITE_OMIT_DEPRECATED
  SQLITE_OMIT_SHARED_CACHE SQLITE_OMIT_LOAD_EXTENSION SQLITE_THREADSAFE=1
  SQLITE_DEFAULT_FILE_PERMISSIONS=0600)
target_link_libraries(mat_sqlite PUBLIC Threads::Threads m)
target_compile_options(mat_sqlite PRIVATE -w -O2)

# Mbed TLS 3.6.7 (Apache-2.0) vendored in third_party/mbedtls (feature 005, research R4): TLS server,
# certificates, SHA-256, random generator. The library and every user compile against the same
# configuration (third_party/mbedtls-config/mat_mbedtls_config.h): with another one the struct
# layouts would differ. Modules the configuration leaves out compile to nothing.
file(GLOB MAT_MBEDTLS_SOURCES CONFIGURE_DEPENDS ${CMAKE_SOURCE_DIR}/third_party/mbedtls/library/*.c)
add_library(mat_mbedtls STATIC ${MAT_MBEDTLS_SOURCES})
target_include_directories(mat_mbedtls SYSTEM PUBLIC
  third_party/mbedtls/include third_party/mbedtls-config)
target_include_directories(mat_mbedtls PRIVATE third_party/mbedtls/library)
target_compile_definitions(mat_mbedtls PUBLIC MBEDTLS_CONFIG_FILE="mat_mbedtls_config.h")
target_link_libraries(mat_mbedtls PUBLIC Threads::Threads)
target_compile_options(mat_mbedtls PRIVATE -w -O2)

# phc-winner-argon2 20190702 (Apache-2.0, chosen over CC0-1.0) vendored in third_party/argon2
# (feature 005, research R7): Argon2id password hashing, reference code (ref.c, no SSE), one thread.
add_library(mat_argon2 STATIC
  third_party/argon2/src/argon2.c
  third_party/argon2/src/core.c
  third_party/argon2/src/encoding.c
  third_party/argon2/src/ref.c
  third_party/argon2/src/blake2/blake2b.c)
target_include_directories(mat_argon2 SYSTEM PUBLIC third_party/argon2/include)
target_compile_definitions(mat_argon2 PRIVATE ARGON2_NO_THREADS)
target_compile_options(mat_argon2 PRIVATE -w -O2)

# miniz 3.1.2 (MIT) vendored in third_party/miniz (feature 005, research R12): only raw-deflate
# decompression (tinfl) and CRC-32 for the .matscada package reader. The rest is compiled out: no
# zip API (the package reader is our own), no compression, no zlib-style API, no stdio, and no
# malloc: callers own every buffer, and tinfl_decompress_mem_to_heap (which grows without bound)
# can never allocate.
add_library(mat_miniz STATIC third_party/miniz/miniz.c)
target_include_directories(mat_miniz SYSTEM PUBLIC third_party/miniz)
target_compile_definitions(mat_miniz PUBLIC
  MINIZ_NO_STDIO MINIZ_NO_TIME MINIZ_NO_ARCHIVE_APIS MINIZ_NO_DEFLATE_APIS MINIZ_NO_ZLIB_APIS
  MINIZ_NO_ZLIB_COMPATIBLE_NAMES MINIZ_NO_MALLOC)
target_compile_options(mat_miniz PRIVATE -w -O2)

# Feature 005 device modules (crypto, audit, auth, package, project store, discovery, diagnostics):
# one static library per module (mat_crypto, mat_audit, ...), so a test links only the modules it
# exercises. mat_device gathers them for mat-runtime and the device commands (T044, T047). Each
# module adds itself with target_link_libraries(mat_device INTERFACE mat_<module>).
add_library(mat_device INTERFACE)

# core/audit: the audit log (research R11, data-model §7), <dataDir>/audit.db with
# synchronous=FULL (Constitution 2.0.1). mat_historian gives the clock floor and, through mat_core,
# UTF-8 repair and JSON.
add_library(mat_audit STATIC
  core/audit/audit_log.cpp)
target_include_directories(mat_audit PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_audit PRIVATE mat_historian mat_sqlite)
target_compile_options(mat_audit PRIVATE ${MAT_WARN} -O2)
target_link_libraries(mat_device INTERFACE mat_audit)

# core/crypto: SHA-256, getrandom, constant-time comparison, base64url, hex. Mbed TLS stays
# behind the module's headers (PRIVATE).
add_library(mat_crypto STATIC
  core/crypto/sha256.cpp
  core/crypto/random.cpp
  core/crypto/ct_compare.cpp
  core/crypto/base64url.cpp
  core/crypto/hex.cpp)
target_include_directories(mat_crypto PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_crypto PRIVATE mat_mbedtls)
target_compile_options(mat_crypto PRIVATE ${MAT_WARN} -O2)
target_link_libraries(mat_device INTERFACE mat_crypto)

# core/package: the .matscada package format (contracts/matscada-package.md): content digest,
# reader of the ZIP subset with the manifest and content checks, extraction, stored writer
# (T087–T094). mat_core gives the UTF-8 check, JSON and valijson (the manifest schema); mat_miniz
# gives tinfl and CRC-32.
add_library(mat_package STATIC
  core/package/digest.cpp
  core/package/package_rules.cpp
  core/package/zip_reader.cpp
  core/package/manifest.cpp
  core/package/package_check.cpp
  core/package/extract.cpp
  core/package/zip_writer.cpp
  core/package/project_digest.cpp)
target_include_directories(mat_package PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_package PRIVATE mat_crypto mat_core mat_miniz)
target_compile_options(mat_package PRIVATE ${MAT_WARN} -O2)
target_link_libraries(mat_device INTERFACE mat_package)

# core/auth: accounts (users.json), Argon2id password hashes with mmap'd memory on a nice +10
# thread, sessions, lockout, the role table and the sign-in flow (research R7–R10, ADR-011). Audit
# through an injected callback (AuditLog::append in the runtime); public headers use mat_audit's
# event types. mat_core gives JSON and the UTF-8 check.
add_library(mat_auth STATIC
  core/auth/password_hash.cpp
  core/auth/account_store.cpp
  core/auth/session_store.cpp
  core/auth/login_guard.cpp
  core/auth/roles.cpp
  core/auth/auth_state.cpp
  core/auth/auth_service.cpp)
target_include_directories(mat_auth PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_auth PUBLIC mat_audit mat_crypto PRIVATE mat_argon2 mat_core
                      Threads::Threads)
target_compile_options(mat_auth PRIVATE ${MAT_WARN} -O2)
target_link_libraries(mat_device INTERFACE mat_auth)

# core/project-store: the project store (state.json, v/<seq>, adoption of the project installed the
# old way), the start decision, the deploy/restore state machine and the health check (data-model
# §9–10, research R13). Wired into mat-runtime at T108: steps, packing, audit and clocks are
# injected.
# mat_core gives JSON and ProjectIssue; mat_audit the audit event types and the clock-sync check.
add_library(mat_project_store STATIC
  core/project-store/store.cpp
  core/project-store/boot_decision.cpp
  core/project-store/deploy_pipeline.cpp
  core/project-store/health_check.cpp)
target_include_directories(mat_project_store PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_project_store PUBLIC mat_audit mat_core PRIVATE mat_crypto)
target_compile_options(mat_project_store PRIVATE ${MAT_WARN} -O2)
target_link_libraries(mat_device INTERFACE mat_project_store)

# server/tls: the device's HTTPS certificate (<dataDir>/tls/server.pem, made on first start with
# Mbed TLS, research R5), the device id, and psa_crypto_init at start (T044). Mbed TLS stays behind
# the module's headers (PRIVATE).
add_library(mat_server_tls STATIC
  server/tls/server_cert.cpp
  server/tls/tls_init.cpp)
target_include_directories(mat_server_tls PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_server_tls PRIVATE mat_crypto mat_mbedtls)
target_compile_options(mat_server_tls PRIVATE ${MAT_WARN} -O2)
target_link_libraries(mat_device INTERFACE mat_server_tls)

# core/discovery: the discovery packets (contracts/discovery.md, research R2): query checks, source
# and rate rules, the reply JSON, and the interface table read with ioctl (no netlink: the unit
# keeps RestrictAddressFamilies). Pure code over caller buffers, run on tests/discovery-vectors.
add_library(mat_discovery STATIC
  core/discovery/discovery_proto.cpp
  core/discovery/iface_table.cpp)
target_include_directories(mat_discovery PUBLIC ${CMAKE_SOURCE_DIR})
target_compile_options(mat_discovery PRIVATE ${MAT_WARN} -O2)
target_link_libraries(mat_device INTERFACE mat_discovery)

# server/discovery: the UDP socket of discovery (IP_PKTINFO, one poll() thread) over mat_discovery.
# A library of its own, so that mat-runtime and discovery_server_test link the same object and the
# test needs neither main.cpp nor CivetWeb.
add_library(mat_discovery_server STATIC
  server/discovery/discovery_server.cpp)
target_include_directories(mat_discovery_server PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_discovery_server PUBLIC mat_discovery PRIVATE Threads::Threads)
target_compile_options(mat_discovery_server PRIVATE ${MAT_WARN} -O2)
target_link_libraries(mat_device INTERFACE mat_discovery_server)

# core/diagnostics: CPU, memory, disk and uptime of the runtime and the system from /proc and statvfs,
# for GET /api/v1/diagnostics (device-api §6, research R16). Pure parsers plus a sampler of 13
# samples; no dependency but the C library.
add_library(mat_diagnostics STATIC
  core/diagnostics/proc_stats.cpp)
target_include_directories(mat_diagnostics PUBLIC ${CMAKE_SOURCE_DIR})
target_compile_options(mat_diagnostics PRIVATE ${MAT_WARN} -O2)
target_link_libraries(mat_device INTERFACE mat_diagnostics)

# Clock floor for the historian: the device clock is invalid before this build (research R5).
string(TIMESTAMP MAT_BUILD_EPOCH_S "%s" UTC)

# Header-only JSON + JSON Schema (MIT / BSD-2), see third_party/LICENSES.md
add_library(mat_json INTERFACE)
target_include_directories(mat_json SYSTEM INTERFACE third_party/nlohmann third_party/valijson/include)

# Logic independent of the web server (unit-tested without network).
add_library(mat_core STATIC
  core/common/utf8.cpp
  core/tag-engine/tag_store.cpp
  server/websocket/live_hub.cpp
  server/config.cpp
  server/startup.cpp
  core/project-manager/project_validator.cpp
  core/project-manager/logging_estimate.cpp
  drivers/simulation/mock_tag_provider.cpp
  server/websocket/origin.cpp)
target_include_directories(mat_core PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_core PUBLIC mat_json Threads::Threads)
target_compile_definitions(mat_core PUBLIC VALIJSON_USE_EXCEPTIONS=1)
target_compile_options(mat_core PRIVATE ${MAT_WARN} -O2)

# Tag history (feature 003): sampling, local SQLite store, forwarding to external databases.
# Client libraries of external databases are loaded with dlopen at run time, never linked.
add_library(mat_historian STATIC
  core/historian/clock.cpp
  core/historian/logging_config.cpp
  core/historian/sampler.cpp
  core/historian/local_store.cpp
  core/historian/historian.cpp
  core/historian/secrets.cpp
  core/historian/status.cpp
  core/historian/forward/sql_dialect.cpp
  core/historian/forward/influx_line.cpp
  core/historian/forward/error_class.cpp
  core/historian/forward/dyn_lib.cpp
  core/historian/forward/destination.cpp
  core/historian/forward/sql_destination.cpp
  core/historian/forward/mysql_destination.cpp
  core/historian/forward/mssql_destination.cpp
  core/historian/forward/pg_destination.cpp
  core/historian/forward/influx_destination.cpp
  core/historian/forward/forwarder.cpp)
target_include_directories(mat_historian PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_historian PUBLIC mat_core mat_sqlite ${CMAKE_DL_LIBS})
target_compile_definitions(mat_historian PUBLIC MAT_BUILD_EPOCH_S=${MAT_BUILD_EPOCH_S}LL)
target_compile_options(mat_historian PRIVATE ${MAT_WARN} -O2)

# Device-side commands (--export-history, --set-secret; feature 005 T047: --user-*,
# --cert-fingerprint, --regen-cert, --auth-bench): kept out of core/.
add_library(mat_cli STATIC
  server/cli/csv.cpp
  server/cli/export_history.cpp
  server/cli/export_audit.cpp
  server/cli/set_secret.cpp
  server/cli/package.cpp
  server/cli/project.cpp
  server/cli/device_cli.cpp
  server/cli/users.cpp
  server/cli/cert.cpp
  server/cli/auth_bench.cpp)
target_link_libraries(mat_cli PUBLIC mat_historian mat_auth mat_audit mat_server_tls mat_package
                      mat_project_store)
target_compile_options(mat_cli PRIVATE ${MAT_WARN} -O2)

# mat-runtime: the device runtime (Sprint 1)
add_executable(mat-runtime
  server/main.cpp
  server/websocket/civet_transport.cpp
  server/http/http_api.cpp
  server/http/auth_gate.cpp
  server/http/engineering_api.cpp
  server/http/engineering_api_project.cpp
  server/http/web_contexts.cpp
  server/project_glue.cpp)
target_compile_options(mat-runtime PRIVATE ${MAT_WARN} -O2)
target_link_libraries(mat-runtime PRIVATE mat_cli mat_historian mat_core civetweb_runtime)
# Feature 005: every device module (T044): crypto, package digest, audit, auth, certificate,
# discovery, and later the project store and diagnostics, through the INTERFACE target.
target_link_libraries(mat-runtime PRIVATE mat_device)

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
    target_link_libraries(${name} PRIVATE mat_cli mat_historian mat_core GTest::gtest_main)
    target_compile_options(${name} PRIVATE ${MAT_WARN})
    target_compile_definitions(${name} PRIVATE
      MAT_SOURCE_DIR="${CMAKE_SOURCE_DIR}")
    gtest_discover_tests(${name} DISCOVERY_TIMEOUT 30)
  endfunction()

  mat_test(session_manager_test core/session-manager/tests/session_manager_test.cpp)
  mat_test(send_queue_test core/session-manager/tests/send_queue_test.cpp)
  mat_test(tag_store_test core/tag-engine/tests/tag_store_test.cpp)
  mat_test(utf8_test core/common/tests/utf8_test.cpp)
  mat_test(live_hub_test server/websocket/tests/live_hub_test.cpp)
  mat_test(config_test server/tests/config_test.cpp)
  mat_test(project_validator_test core/project-manager/tests/project_validator_test.cpp)
  mat_test(logging_estimate_test core/project-manager/tests/logging_estimate_test.cpp)
  mat_test(mock_tag_provider_test drivers/simulation/tests/mock_tag_provider_test.cpp)
  mat_test(origin_test server/tests/origin_test.cpp)
  # In-process CivetWeb (NO_FILES build with the mAT patches) on 127.0.0.1: T063, T044.
  mat_test(startup_test server/tests/startup_test.cpp server/http/http_api.cpp)
  target_link_libraries(startup_test PRIVATE civetweb_runtime mat_package)
  mat_test(civet_transport_test server/websocket/tests/civet_transport_test.cpp
           server/websocket/civet_transport.cpp)
  target_link_libraries(civet_transport_test PRIVATE civetweb_runtime)
  mat_test(clock_test core/historian/tests/clock_test.cpp)
  mat_test(logging_config_test core/historian/tests/logging_config_test.cpp)
  mat_test(sampler_test core/historian/tests/sampler_test.cpp)
  mat_test(local_store_test core/historian/tests/local_store_test.cpp)
  mat_test(export_history_test server/tests/export_history_test.cpp)
  mat_test(export_audit_test server/tests/export_audit_test.cpp)
  mat_test(historian_test core/historian/tests/historian_test.cpp)
  mat_test(sql_dialect_test core/historian/tests/sql_dialect_test.cpp)
  mat_test(influx_line_test core/historian/tests/influx_line_test.cpp)
  mat_test(secrets_test core/historian/tests/secrets_test.cpp)
  mat_test(set_secret_test server/tests/set_secret_test.cpp)
  mat_test(error_class_test core/historian/tests/error_class_test.cpp)
  mat_test(forwarder_test core/historian/tests/forwarder_test.cpp)
  mat_test(sql_destination_test core/historian/tests/sql_destination_test.cpp)
  mat_test(pg_destination_test core/historian/tests/pg_destination_test.cpp)
  mat_test(dyn_lib_test core/historian/tests/dyn_lib_test.cpp)
  mat_test(status_test core/historian/tests/status_test.cpp)
  # Real databases (tools/historian-it.ps1 -Scenario forward); skipped without MAT_IT_*.
  mat_test(historian_it core/historian/tests/historian_it.cpp core/historian/tests/it_support.cpp)
  # Feature 005: the Mbed TLS configuration (research R4).
  mat_test(mbedtls_config_test core/crypto/tests/mbedtls_config_test.cpp)
  target_link_libraries(mbedtls_config_test PRIVATE mat_mbedtls)
  mat_test(audit_log_test core/audit/tests/audit_log_test.cpp)
  target_link_libraries(audit_log_test PRIVATE mat_audit)
  mat_test(proc_stats_test core/diagnostics/tests/proc_stats_test.cpp)
  target_link_libraries(proc_stats_test PRIVATE mat_diagnostics)
  mat_test(crypto_test core/crypto/tests/crypto_test.cpp)
  target_link_libraries(crypto_test PRIVATE mat_crypto)
  mat_test(digest_test core/package/tests/digest_test.cpp)
  target_link_libraries(digest_test PRIVATE mat_package)
  # .matscada reader, checks, extraction, writer, mutations (T088–T094), --check-package (T095).
  # The shared vectors need `node tests/package-vectors/generate.mjs --out` first.
  foreach(t zip_reader_test package_check_test extract_test zip_writer_test package_fuzz_test)
    mat_test(${t} core/package/tests/${t}.cpp)
    target_link_libraries(${t} PRIVATE mat_package mat_crypto)
  endforeach()
  mat_test(package_cli_test server/tests/package_cli_test.cpp)
  target_link_libraries(package_cli_test PRIVATE mat_package mat_crypto)
  # core/project-store (T096–T098): real store in a temporary directory, fake steps and clocks.
  foreach(t store_test boot_decision_test deploy_pipeline_test)
    mat_test(${t} core/project-store/tests/${t}.cpp)
    target_link_libraries(${t} PRIVATE mat_project_store)
  endforeach()
  # T107: health check of a started version, and the project commands of the device.
  mat_test(health_check_test server/tests/health_check_test.cpp)
  target_link_libraries(health_check_test PRIVATE mat_project_store)
  mat_test(project_cli_test server/tests/project_cli_test.cpp)
  target_link_libraries(project_cli_test PRIVATE mat_project_store mat_package)
  # core/auth (T026–T031): password_hash_test also calls the Argon2 library directly (RFC 9106).
  mat_test(password_hash_test core/auth/tests/password_hash_test.cpp)
  target_link_libraries(password_hash_test PRIVATE mat_auth mat_argon2)
  mat_test(account_store_test core/auth/tests/account_store_test.cpp)
  target_link_libraries(account_store_test PRIVATE mat_auth)
  mat_test(session_store_test core/auth/tests/session_store_test.cpp)
  target_link_libraries(session_store_test PRIVATE mat_auth)
  mat_test(login_guard_test core/auth/tests/login_guard_test.cpp)
  target_link_libraries(login_guard_test PRIVATE mat_auth)
  mat_test(roles_test core/auth/tests/roles_test.cpp)
  target_link_libraries(roles_test PRIVATE mat_auth)
  mat_test(auth_service_test core/auth/tests/auth_service_test.cpp)
  target_link_libraries(auth_service_test PRIVATE mat_auth)
  # The gate of the engineering API (T040): a function of the request, no CivetWeb.
  mat_test(auth_gate_test server/tests/auth_gate_test.cpp server/http/auth_gate.cpp)
  target_link_libraries(auth_gate_test PRIVATE mat_auth mat_audit)
  # In-process HTTPS for tests (T036, T041): CivetWeb HTTPS context, certificate generated at run
  # time, client on the image's libcurl + OpenSSL (Mbed TLS is configured server-only).
  find_package(CURL)
  if(CURL_FOUND)
    add_library(mat_tls_test_support STATIC server/tests/tls_test_support.cpp)
    target_include_directories(mat_tls_test_support PUBLIC ${CMAKE_SOURCE_DIR})
    target_link_libraries(mat_tls_test_support PUBLIC civetweb_runtime mat_mbedtls CURL::libcurl)
    target_compile_options(mat_tls_test_support PRIVATE ${MAT_WARN})
    # mAT patches 3 and 4 of CivetWeb, TLS policy. --wrap=calloc: allocation failure injection.
    mat_test(https_handshake_test server/tests/https_handshake_test.cpp)
    target_link_libraries(https_handshake_test PRIVATE mat_tls_test_support)
    target_link_options(https_handshake_test PRIVATE -Wl,--wrap=calloc)
    # The two listeners of mat-runtime with the engineering API (T041), as main opens them.
    mat_test(https_api_test server/tests/https_api_test.cpp server/http/http_api.cpp
             server/http/auth_gate.cpp server/http/engineering_api.cpp
             server/http/engineering_api_project.cpp
             server/http/web_contexts.cpp server/websocket/civet_transport.cpp)
    target_link_libraries(https_api_test PRIVATE mat_tls_test_support mat_auth mat_audit
                          mat_server_tls mat_package mat_project_store)
    # The project routes (T109): the same two listeners over a real store and pipeline.
    mat_test(project_api_test server/tests/project_api_test.cpp server/http/auth_gate.cpp
             server/http/engineering_api.cpp server/http/engineering_api_project.cpp
             server/http/web_contexts.cpp server/project_glue.cpp)
    target_link_libraries(project_api_test PRIVATE mat_tls_test_support mat_auth mat_audit
                          mat_server_tls mat_package mat_project_store)
    # GET /diagnostics and GET /audit (T143): the same listeners, the numbers injected.
    mat_test(diagnostics_audit_api_test server/tests/diagnostics_audit_api_test.cpp
             server/http/auth_gate.cpp server/http/engineering_api.cpp
             server/http/engineering_api_project.cpp server/http/web_contexts.cpp
             server/project_glue.cpp)
    target_link_libraries(diagnostics_audit_api_test PRIVATE mat_tls_test_support mat_auth mat_audit
                          mat_server_tls mat_package mat_project_store mat_diagnostics mat_discovery)
  else()
    message(STATUS "libcurl missing: https_handshake_test skipped")
  endif()
  # Device certificate and device id (T038). Its HTTPS part (CivetWeb serving the generated file)
  # needs mat_tls_test_support, so only with libcurl.
  mat_test(server_cert_test server/tests/server_cert_test.cpp)
  target_link_libraries(server_cert_test PRIVATE mat_server_tls mat_crypto mat_mbedtls)
  if(CURL_FOUND)
    target_link_libraries(server_cert_test PRIVATE mat_tls_test_support)
    target_compile_definitions(server_cert_test PRIVATE MAT_TLS_TEST_SUPPORT=1)
  endif()
  # Device commands of feature 005 (T045–T047): accounts, certificate, hash timing. Run as root in
  # the container; the image's `daemon` user stands for the service user `matscada`.
  mat_test(user_cli_test server/tests/user_cli_test.cpp)
  mat_test(cert_cli_test server/tests/cert_cli_test.cpp)
  mat_test(auth_bench_test server/tests/auth_bench_test.cpp)
  # Discovery (T056, T057, T059): the pure code on tests/discovery-vectors, then the UDP server on a
  # real socket (queries from the container's own eth0 address, contract §5a).
  mat_test(discovery_proto_test core/discovery/tests/discovery_proto_test.cpp)
  target_link_libraries(discovery_proto_test PRIVATE mat_discovery)
  mat_test(iface_table_test core/discovery/tests/iface_table_test.cpp)
  target_link_libraries(iface_table_test PRIVATE mat_discovery)
  mat_test(discovery_server_test server/tests/discovery_server_test.cpp)
  target_link_libraries(discovery_server_test PRIVATE mat_discovery_server)

  # The in-house client declarations against the real -dev headers of the toolchain image
  # (research R7). The armhf build never sees these headers.
  find_path(MAT_MARIADB_H mariadb/mysql.h)
  find_path(MAT_SYBDB_H sybdb.h)
  find_path(MAT_LIBPQ_H postgresql/libpq-fe.h)
  find_path(MAT_CURL_H curl/curl.h)
  if(MAT_MARIADB_H AND MAT_SYBDB_H AND MAT_LIBPQ_H AND MAT_CURL_H)
    mat_test(client_api_check_test core/historian/tests/client_api_check_test.cpp)
  else()
    message(STATUS "client -dev headers missing: client_api_check_test skipped")
  endif()

  # Dev tool for tools/historian-it.ps1 scenarios (not a test, never packaged).
  add_executable(historian_tool core/historian/tests/historian_tool.cpp
                 core/historian/tests/it_support.cpp)
  target_link_libraries(historian_tool PRIVATE mat_historian)
  target_compile_options(historian_tool PRIVATE ${MAT_WARN})
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
