cmake_minimum_required(VERSION 3.16)
project(mat_scada LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
find_package(Threads REQUIRED)
enable_testing()

# 64-bit file offsets and inode numbers on the 32-bit build (feature 006 debt of batch 1): without
# this, readdir() of a 32-bit process fails with EOVERFLOW whenever the directory entries carry a
# 64-bit d_off or d_ino, as under qemu-user on an x86-64 host (3 cases of local_store_test and the
# tests that walk the source tree failed that way), and a file above 2 GiB cannot be seen by
# stat(). No effect on x64. Every target gets it, so struct layouts agree.
add_compile_definitions(_FILE_OFFSET_BITS=64)

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
  SQLITE_DEFAULT_FILE_PERMISSIONS=0600
  # specs/006 T007, research R15: sync with fdatasync (file size is journalled by the kernel when it
  # changes); durability unchanged, bytes written per FULL commit about halved. Not a patch.
  HAVE_FDATASYNC=1)
target_link_libraries(mat_sqlite PUBLIC Threads::Threads m)
target_compile_options(mat_sqlite PRIVATE -w -O2)
# VFS shim that counts the bytes written per database file (ADR-039).
add_library(mat_sqlite_count STATIC core/historian/write_counter_vfs.cpp)
target_include_directories(mat_sqlite_count PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_sqlite_count PUBLIC mat_sqlite)
target_compile_options(mat_sqlite_count PRIVATE ${MAT_WARN} -O2)

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
target_compile_options(mat_mbedtls PRIVATE -w -O2 -ffunction-sections -fdata-sections)

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
target_compile_options(mat_miniz PRIVATE -w -O2 -ffunction-sections -fdata-sections)

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
# samples; no dependency but the C library. Feature 011 (FR-009): the eMMC wear from sysfs, the bytes
# written today per component (reset at the local midnight of tzOffsetMin) and the record of the
# restarts (run-record.json, JSON through mat_json). Linked into mat_core: engineering_api.cpp,
# compiled into many test targets, formats ioWriteBytesToday with it.
add_library(mat_diagnostics STATIC
  core/diagnostics/proc_stats.cpp
  core/diagnostics/emmc_life.cpp
  core/diagnostics/daily_writes.cpp
  core/diagnostics/run_record.cpp)
target_include_directories(mat_diagnostics PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_diagnostics PUBLIC mat_json)
target_compile_options(mat_diagnostics PRIVATE ${MAT_WARN} -O2)
target_link_libraries(mat_device INTERFACE mat_diagnostics)

# core/update (feature 011 T096; contracts/update-package.md, ADR-035): the reader of the .matupdate
# envelope, ECDSA P-256 signatures and trusted keys, the manifest and files[] rules, the listing of
# payload.tar.gz (miniz tinfl), the whole check in the order of FR-061, SHA256SUMS. Shared by the
# runtime (update service), mat-update-verify (root side of mat-updater, deploy.sh, release.ps1) and
# the fuzz target. Built small (-Os, one section per function: --gc-sections of mat-update-verify
# drops the TLS part of Mbed TLS, T008).
add_library(mat_update STATIC
  core/update/envelope.cpp
  core/update/signature.cpp
  core/update/manifest.cpp
  core/update/paths.cpp
  core/update/payload.cpp
  core/update/verify.cpp)
target_include_directories(mat_update PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_update PUBLIC mat_json PRIVATE mat_mbedtls mat_miniz)
target_compile_options(mat_update PRIVATE ${MAT_WARN} -Os -ffunction-sections -fdata-sections)
target_link_libraries(mat_device INTERFACE mat_update)

# mat-update-verify (FR-069, device-api-011 §7): the small stand-alone checker. libstdc++, libgcc and
# Mbed TLS static, glibc dynamic (T008 decision: <= 400 KB, only libc.so.6), stripped.
add_executable(mat-update-verify server/updater/verify_main.cpp)
target_link_libraries(mat-update-verify PRIVATE mat_update)
target_compile_options(mat-update-verify PRIVATE ${MAT_WARN} -Os -ffunction-sections -fdata-sections)
target_link_options(mat-update-verify PRIVATE -static-libstdc++ -static-libgcc -Wl,--gc-sections
                    $<$<CONFIG:Release>:-s>)

# Clock floor for the historian: the device clock is invalid before this build (research R5).
string(TIMESTAMP MAT_BUILD_EPOCH_S "%s" UTC)

# Header-only JSON + JSON Schema (MIT / BSD-2), see third_party/LICENSES.md
add_library(mat_json INTERFACE)
target_include_directories(mat_json SYSTEM INTERFACE third_party/nlohmann third_party/valijson/include)

# Expression language of calculated Tags and value tables (feature 006 T018, ADR-015): pure code,
# the same vectors as packages/expression. -ffp-contract=off: no fused multiply-add (bit equal to TS).
# Only the type declarations of core/tag-engine/tag_store.hpp are used; mat_core links this library.
add_library(mat_expression STATIC
  core/expression/lexer.cpp
  core/expression/parser.cpp
  core/expression/checker.cpp
  core/expression/compiler.cpp
  core/expression/vm.cpp
  core/expression/number.cpp
  core/expression/value_table.cpp
  core/expression/value_table_json.cpp
  core/expression/expression.cpp)
target_include_directories(mat_expression PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_expression PUBLIC mat_json)
target_compile_options(mat_expression PRIVATE ${MAT_WARN} -O2 -ffp-contract=off)

# Modbus address and register codec (T022): pure, no I/O, shared vectors with packages/tag-codec.
add_library(mat_modbus_codec STATIC
  drivers/modbus/address.cpp
  drivers/modbus/codec.cpp)
target_include_directories(mat_modbus_codec PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_modbus_codec PUBLIC mat_json)
target_compile_options(mat_modbus_codec PRIVATE ${MAT_WARN} -O2 -ffp-contract=off)

# Simulation generators (T026): bit-for-bit with packages/tag-sim.
add_library(mat_sim STATIC
  drivers/simulation/sim_generators.cpp)
target_include_directories(mat_sim PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_sim PUBLIC mat_expression mat_json)
target_compile_options(mat_sim PRIVATE ${MAT_WARN} -O2 -ffp-contract=off)

# Pure libraries under mat_core (the project validator uses them): request planner of the drivers
# (also the RTU scan time estimate) and the dependency graph of calculated Tags.
add_library(mat_merge_planner STATIC drivers/sdk/merge_planner.cpp)
target_include_directories(mat_merge_planner PUBLIC ${CMAKE_SOURCE_DIR})
target_compile_options(mat_merge_planner PRIVATE ${MAT_WARN} -O2)
add_library(mat_calc_graph STATIC core/tag-engine/calc_graph.cpp)
target_include_directories(mat_calc_graph PUBLIC ${CMAKE_SOURCE_DIR})
target_compile_options(mat_calc_graph PRIVATE ${MAT_WARN} -O2)

# Logic independent of the web server (unit-tested without network).
add_library(mat_core STATIC
  core/common/utf8.cpp
  core/tag-engine/tag_store.cpp
  server/websocket/live_hub.cpp
  server/config.cpp
  core/project-manager/project_validator.cpp
  core/project-manager/alarm_rules.cpp
  core/project-manager/rules_02.cpp
  core/project-manager/rules_03.cpp
  core/project-manager/rules_04.cpp
  core/project-manager/rules_010.cpp
  core/project-manager/rules_10.cpp
  core/project-manager/widget_catalog.cpp
  core/project-manager/logging_estimate.cpp
  core/project-manager/rules_logic.cpp
  core/logic/order.cpp
  drivers/simulation/mock_tag_provider.cpp
  server/websocket/origin.cpp
  server/host_policy.cpp
  server/http/conn_limit.cpp
  server/ssh_audit.cpp
  server/time_sync.cpp)
target_include_directories(mat_core PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_core PUBLIC mat_json mat_diagnostics Threads::Threads mat_expression mat_modbus_codec
                      mat_merge_planner mat_calc_graph)
target_compile_definitions(mat_core PUBLIC VALIJSON_USE_EXCEPTIONS=1)
target_compile_options(mat_core PRIVATE ${MAT_WARN} -O2)

# Alarms (feature 009, ADR-027, ADR-028): the engine (pure), the text, the compiled definitions, alarm.db
# and its service. No page, HTTP or audit library: audit is injected as a function (Constitution II).
# -ffp-contract=off: the same bits of the thresholds on x64 and armhf (the vectors are shared).
add_library(mat_alarm STATIC
  core/alarm/alarm_text.cpp
  core/alarm/alarm_defs.cpp
  core/alarm/alarm_engine.cpp
  core/alarm/alarm_store.cpp
  core/alarm/alarm_history.cpp
  core/alarm/alarm_service.cpp)
target_include_directories(mat_alarm PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_alarm PUBLIC mat_json mat_sqlite mat_sqlite_count Threads::Threads)
target_compile_options(mat_alarm PRIVATE ${MAT_WARN} -O2 -ffp-contract=off)

# Tag Engine v1 (feature 006, ADR-017): scaling now, tag model, engine and retained values below.
add_library(mat_tag_engine STATIC
  core/tag-engine/scaling.cpp
  core/tag-engine/tag_model.cpp
  core/tag-engine/engine.cpp
  core/tag-engine/sim_factory.cpp
  core/tag-engine/modbus_factory.cpp
  core/tag-engine/token_bucket.cpp
  core/tag-engine/write_coordinator.cpp
  core/tag-engine/pulse_journal.cpp
  core/tag-engine/retain_store.cpp)
target_include_directories(mat_tag_engine PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_tag_engine PUBLIC mat_core mat_expression mat_modbus_codec mat_sim mat_calc_graph
                      mat_drivers mat_modbus)
target_compile_options(mat_tag_engine PRIVATE ${MAT_WARN} -O2 -ffp-contract=off)

# Logic v2 (feature 011 T134, ADR-037): the engine of rules, timers, counters, totalizers, run hours
# and schedules, the C++ twin of packages/logic-engine on tests/logic-vectors. Pure (no I/O, no
# thread); order.cpp (outputs, scan order, shared with the validator) is in mat_core.
# -ffp-contract=off: the totalizer's sums are the same bits as the TypeScript engine's.
add_library(mat_logic STATIC
  core/logic/block.cpp
  core/logic/rules.cpp
  core/logic/timers.cpp
  core/logic/counters.cpp
  core/logic/totalizer.cpp
  core/logic/runhours.cpp
  core/logic/schedule.cpp
  core/logic/engine.cpp
  core/logic/harness.cpp)
target_include_directories(mat_logic PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_logic PUBLIC mat_core mat_expression mat_json)
target_compile_options(mat_logic PRIVATE ${MAT_WARN} -O2 -ffp-contract=off)

# Driver SDK (feature 006 T052-T054, ADR-014): scheduler, backoff, diagnostics counters and the
# simulation driver (the Sprint 1 mock is its `legacy` generator, in mat_core).
add_library(mat_drivers STATIC
  drivers/sdk/scheduler.cpp
  drivers/sdk/backoff.cpp
  drivers/sdk/diag.cpp
  drivers/sdk/transport.cpp
  drivers/sdk/tcp_socket.cpp
  drivers/sdk/serial_port.cpp
  drivers/sdk/serial_ports.cpp
  drivers/simulation/simulation_driver.cpp)
target_include_directories(mat_drivers PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_drivers PUBLIC mat_merge_planner mat_sim mat_modbus_codec mat_core)
target_compile_options(mat_drivers PRIVATE ${MAT_WARN} -O2 -ffp-contract=off)
target_link_libraries(mat_device INTERFACE mat_drivers)

# Modbus TCP driver (feature 006 T094, T100, T104): frames, exceptions, the driver and the test
# probe, over the codec, the planner and the SDK. The transport is in mat_drivers (tcp_socket).
add_library(mat_modbus STATIC
  drivers/modbus/pdu.cpp
  drivers/modbus/mbap.cpp
  drivers/modbus/exceptions.cpp
  drivers/modbus/modbus_tcp_driver.cpp
  drivers/modbus/rtu_frame.cpp
  drivers/modbus/modbus_rtu_driver.cpp
  drivers/modbus/test_probe.cpp)
target_include_directories(mat_modbus PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_modbus PUBLIC mat_drivers mat_modbus_codec mat_merge_planner)
target_compile_options(mat_modbus PRIVATE ${MAT_WARN} -O2)
target_link_libraries(mat_device INTERFACE mat_modbus)

# Project activation (adds the Tags of the model to the store) and the runtime's Tag Engine, apart
# from main.cpp and CivetWeb so that they can be tested (feature 006 T059, T060).
add_library(mat_startup STATIC server/startup.cpp)
target_include_directories(mat_startup PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_startup PUBLIC mat_tag_engine mat_core)
target_compile_options(mat_startup PRIVATE ${MAT_WARN} -O2)
# The source filter (feature 006 FR-055a): pure decisions and their use by the page handlers and the live upgrade.
add_library(mat_viewer_gate STATIC server/http/source_filter.cpp server/http/viewer_gate.cpp server/http/cookie.cpp)
target_include_directories(mat_viewer_gate PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_viewer_gate PUBLIC civetweb_runtime mat_json)
target_compile_options(mat_viewer_gate PRIVATE ${MAT_WARN} -O2)
# The routes of device API 1.1.0 (feature 006 T106, T145): the connection test and the tag writes are
# member functions of EngineeringApi, in files of their own.
add_library(mat_api_ext STATIC server/http/history_api.cpp server/http/drivers_api.cpp server/serial_probe.cpp server/http/tags_api.cpp server/http/web_api.cpp server/http/logic_api.cpp server/write_glue.cpp
            server/write_subsystem.cpp server/http/update_api.cpp server/update_service.cpp)
target_include_directories(mat_api_ext PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_api_ext PUBLIC mat_historian_query civetweb_runtime mat_viewer_gate mat_modbus mat_tag_engine mat_audit mat_auth mat_crypto
                      mat_runtime_engine mat_update mat_project_store)
target_compile_options(mat_api_ext PRIVATE ${MAT_WARN} -O2)
# The alarm engine in the runtime and its routes (feature 009 T038, T055, T095): the glue owns the
# engine and alarm.db, alarms_api reads the requests. Linked by whoever builds http_api.cpp, which
# serves the two GET routes (through mat_viewer_gate) and by the API with the POST routes.
add_library(mat_alarm_glue STATIC server/alarm_glue.cpp server/http/alarms_api.cpp)
target_include_directories(mat_alarm_glue PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_alarm_glue PUBLIC mat_alarm mat_core mat_json civetweb_runtime mat_crypto)
target_compile_options(mat_alarm_glue PRIVATE ${MAT_WARN} -O2)
target_link_libraries(mat_viewer_gate PUBLIC mat_alarm_glue)
target_link_libraries(mat_api_ext PUBLIC mat_alarm_glue)
# Feature 011: the logic subsystem (server/logic_glue) runs inside the engine's round.
add_library(mat_runtime_engine STATIC server/runtime_engine.cpp server/logic_glue.cpp)
target_include_directories(mat_runtime_engine PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_runtime_engine PUBLIC mat_tag_engine mat_core mat_logic Threads::Threads)
target_compile_options(mat_runtime_engine PRIVATE ${MAT_WARN} -O2)

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
  core/historian/agg_math.cpp
  core/historian/aggregator.cpp
  core/historian/io_meter.cpp
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
target_link_libraries(mat_historian PUBLIC mat_core mat_sqlite mat_sqlite_count ${CMAKE_DL_LIBS})
target_compile_definitions(mat_historian PUBLIC MAT_BUILD_EPOCH_S=${MAT_BUILD_EPOCH_S}LL)
target_compile_options(mat_historian PRIVATE ${MAT_WARN} -O2)

# History queries (feature 010): point reduction, source choice, reader connections, CSV. No HTTP
# here: server/http/history_api.* only parses parameters and calls this.
add_library(mat_historian_query STATIC
  core/historian/query/downsample.cpp
  core/historian/query/source_select.cpp
  core/historian/query/query_limiter.cpp
  core/historian/query/reader_pool.cpp
  core/historian/query/csv_writer.cpp
  core/historian/query/history_query.cpp
  core/historian/query/agg_verify.cpp)
target_include_directories(mat_historian_query PUBLIC ${CMAKE_SOURCE_DIR})
target_link_libraries(mat_historian_query PUBLIC mat_historian mat_sqlite)
target_compile_options(mat_historian_query PRIVATE ${MAT_WARN} -O2)

# Device-side commands (--export-history, --set-secret; feature 005 T047: --user-*,
# --cert-fingerprint, --regen-cert, --auth-bench): kept out of core/.
add_library(mat_cli STATIC
  server/cli/csv.cpp
  server/cli/export_history.cpp
  server/cli/verify_aggregates.cpp
  server/cli/export_audit.cpp
  server/cli/set_secret.cpp
  server/cli/package.cpp
  server/cli/project.cpp
  server/cli/serial.cpp
  server/cli/retain.cpp
  server/cli/alarm_db_check.cpp
  server/cli/check_data.cpp
  server/cli/device_cli.cpp
  server/cli/users.cpp
  server/cli/cert.cpp
  server/cli/auth_bench.cpp
  server/cli/self_check.cpp
  server/cli/trust_key.cpp
  server/cli/update_status.cpp)
target_link_libraries(mat_cli PUBLIC mat_update mat_historian mat_historian_query mat_auth mat_audit mat_server_tls mat_discovery mat_package
                      mat_project_store mat_drivers mat_tag_engine mat_alarm)
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
target_link_libraries(mat-runtime PRIVATE mat_cli mat_historian mat_core civetweb_runtime mat_startup
                      mat_runtime_engine mat_viewer_gate mat_api_ext)
# Feature 005: every device module (T044): crypto, package digest, audit, auth, certificate,
# discovery, and later the project store and diagnostics, through the INTERFACE target.
target_link_libraries(mat-runtime PRIVATE mat_device)

# Sprint 0 PoC, kept to reproduce the published measurements (not deployed).
add_executable(mat-poc server/poc/main.cpp)
target_include_directories(mat-poc PRIVATE ${CMAKE_SOURCE_DIR})
target_compile_options(mat-poc PRIVATE ${MAT_WARN} -O2)
target_link_libraries(mat-poc PRIVATE civetweb)

# Feature 011 T148: the scan of the maximum logic configuration in the runtime's round (engine,
# publish, actions, warnings), for x64 and the BL335 (armhf). Built only on request, not deployed.
add_executable(logic_bench EXCLUDE_FROM_ALL server/bench/logic_bench.cpp)
target_compile_options(logic_bench PRIVATE ${MAT_WARN} -O2)
target_link_libraries(logic_bench PRIVATE mat_runtime_engine mat_startup mat_cli mat_historian
                      mat_core)

# Unit tests (host build only)
# Cross build with the unit tests configured (feature 006 T003): the tests are EXCLUDE_FROM_ALL and
# built one by one by deployment/toolchain/test-armhf.sh, which runs them under qemu-user: a fault
# of the 32-bit build (alignment, time_t, 64-bit integers, floating point) never shows on x64.
option(MAT_ARMHF_TESTS "Cross build: configure the unit tests (EXCLUDE_FROM_ALL)" OFF)

if(NOT CMAKE_CROSSCOMPILING OR MAT_ARMHF_TESTS)
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
    if(CMAKE_CROSSCOMPILING)
      set_target_properties(${name} PROPERTIES EXCLUDE_FROM_ALL TRUE)
    else()
      gtest_discover_tests(${name} DISCOVERY_TIMEOUT 30)
    endif()
  endfunction()

  mat_test(session_manager_test core/session-manager/tests/session_manager_test.cpp)
  mat_test(send_queue_test core/session-manager/tests/send_queue_test.cpp)
  mat_test(tag_store_test core/tag-engine/tests/tag_store_test.cpp)
  mat_test(utf8_test core/common/tests/utf8_test.cpp)
  mat_test(live_hub_test server/websocket/tests/live_hub_test.cpp)
  # The alarm part of the live hub (feature 009 T043).
  mat_test(live_hub_alarm_test server/websocket/tests/live_hub_alarm_test.cpp)
  mat_test(config_test server/tests/config_test.cpp)
  mat_test(project_validator_test core/project-manager/tests/project_validator_test.cpp)
  # Alarm rules of format 0.5 (feature 009 T017): the v05-* vectors run in project_validator_test.
  mat_test(alarm_rules_test core/project-manager/tests/alarm_rules_test.cpp)
  # Rules of format 0.4 and the shared v04-* vectors (feature 008 T028).
  mat_test(rules_04_test core/project-manager/tests/rules_04_test.cpp)
  mat_test(vectors_04_test core/project-manager/tests/vectors_04_test.cpp)
  # Format 1.0 (feature 011 T018, T020): the shared vectors v10-* and the substitution of params.
  mat_test(vectors_10_test core/project-manager/tests/vectors_10_test.cpp)
  # Extra files of a project (feature 011 T022, T023): project-stage package vectors.
  mat_test(package_files_test core/project-manager/tests/package_files_test.cpp)
  target_link_libraries(package_files_test PRIVATE mat_package mat_crypto)
  # Widget catalog and the 0.3 rules on the shared vectors (feature 007 T028).
  mat_test(widget_catalog_test core/project-manager/tests/widget_catalog_test.cpp)
  mat_test(logging_estimate_test core/project-manager/tests/logging_estimate_test.cpp)
  mat_test(mock_tag_provider_test drivers/simulation/tests/mock_tag_provider_test.cpp)
  mat_test(origin_test server/tests/origin_test.cpp)
  # The warning SSH_ROOT_PASSWORD (feature 011 T040): sshd_config read as sshd reads it, fixtures.
  mat_test(ssh_warning_test server/tests/ssh_warning_test.cpp)
  # The clock check (feature 011 T140): timesyncd flag, timedatectl, chronyc, RTC flag, year; injected.
  mat_test(time_sync_test server/tests/time_sync_test.cpp)
  # In-process CivetWeb (NO_FILES build with the mAT patches) on 127.0.0.1: T063, T044.
  mat_test(startup_test server/tests/startup_test.cpp server/http/http_api.cpp)
  target_link_libraries(startup_test PRIVATE civetweb_runtime mat_package mat_startup mat_viewer_gate)
  mat_test(civet_transport_test server/websocket/tests/civet_transport_test.cpp
           server/websocket/civet_transport.cpp)
  target_link_libraries(civet_transport_test PRIVATE civetweb_runtime mat_viewer_gate)
  mat_test(clock_test core/historian/tests/clock_test.cpp)
  mat_test(logging_config_test core/historian/tests/logging_config_test.cpp)
  mat_test(sampler_test core/historian/tests/sampler_test.cpp)
  mat_test(local_store_test core/historian/tests/local_store_test.cpp)
  mat_test(io_meter_test core/historian/tests/io_meter_test.cpp)
  mat_test(write_counter_vfs_test core/historian/tests/write_counter_vfs_test.cpp)
  target_link_libraries(write_counter_vfs_test PRIVATE mat_sqlite_count)
  mat_test(agg_math_test core/historian/tests/agg_math_test.cpp)
  mat_test(aggregator_test core/historian/tests/aggregator_test.cpp)
  mat_test(downsample_test core/historian/tests/downsample_test.cpp)
  mat_test(source_select_test core/historian/tests/source_select_test.cpp)
  mat_test(query_limiter_test core/historian/tests/query_limiter_test.cpp)
  mat_test(csv_writer_test core/historian/tests/csv_writer_test.cpp)
  mat_test(agg_verify_test core/historian/tests/agg_verify_test.cpp)
  # Expression language (T016): shared vectors with TypeScript, parser, value tables.
  foreach(t expression_vectors_test parser_test value_table_test)
    mat_test(${t} core/expression/tests/${t}.cpp)
    target_link_libraries(${t} PRIVATE mat_expression)
  endforeach()
  # Update packages (feature 011 T090): envelope, signatures, keys, paths, the shared vectors of
  # tests/update-vectors; the exit codes of mat-update-verify (x64: the armhf tool runs under qemu
  # from test-armhf.sh).
  foreach(t envelope signature)
    mat_test(update_${t}_test core/update/tests/${t}_test.cpp)
    target_link_libraries(update_${t}_test PRIVATE mat_update)
  endforeach()
  # The fuzz of the reader (T118): links only mat_update, so the ASan + UBSan build of
  # tools/fuzz/update-envelope.ps1 stays small. MAT_FUZZ_SECONDS (20 s under ctest).
  add_executable(update_fuzz_test core/update/tests/update_fuzz_test.cpp)
  target_link_libraries(update_fuzz_test PRIVATE mat_update GTest::gtest_main)
  target_compile_options(update_fuzz_test PRIVATE ${MAT_WARN})
  target_compile_definitions(update_fuzz_test PRIVATE MAT_SOURCE_DIR="${CMAKE_SOURCE_DIR}")
  if(CMAKE_CROSSCOMPILING)
    set_target_properties(update_fuzz_test PROPERTIES EXCLUDE_FROM_ALL TRUE)
  else()
    gtest_discover_tests(update_fuzz_test DISCOVERY_TIMEOUT 30)
  endif()
  if(NOT CMAKE_CROSSCOMPILING)
    mat_test(update_verify_cli_test core/update/tests/update_verify_cli_test.cpp)
    target_link_libraries(update_verify_cli_test PRIVATE mat_json)
    target_compile_definitions(update_verify_cli_test PRIVATE
      MAT_UPDATE_VERIFY_BIN="$<TARGET_FILE:mat-update-verify>")
    add_dependencies(update_verify_cli_test mat-update-verify)
  endif()
  # Logic v2 (feature 011 T125, T126, T127, T128, T134): the shared vectors and the unit tests of
  # each kind of block, on the engine and the validator (the armhf list is in test-armhf.sh).
  set(MAT_LOGIC_TEST_NAMES logic_vectors_test logic_timers_test logic_counters_test
      logic_totalizer_test logic_runhours_test logic_schedule_test logic_rules_test rules_logic_test)
  mat_test(logic_vectors_test core/logic/tests/vectors_test.cpp core/logic/tests/vector_runner.cpp)
  target_link_libraries(logic_vectors_test PRIVATE mat_logic)
  foreach(t timers counters totalizer runhours schedule rules)
    mat_test(logic_${t}_test core/logic/tests/${t}_test.cpp core/logic/tests/vector_runner.cpp)
    target_link_libraries(logic_${t}_test PRIVATE mat_logic)
  endforeach()
  mat_test(rules_logic_test core/project-manager/tests/rules_logic_test.cpp
           core/logic/tests/vector_runner.cpp)
  target_link_libraries(rules_logic_test PRIVATE mat_logic)
  # Timed fuzz targets of feature 011 (T058, T142; FR-029): logic.json, project loader, expression
  # language (core/common/tests/fuzz_util.hpp). MAT_FUZZ_SECONDS (5 s by default, 20 s in the
  # sanitizer run of ctest); tools/fuzz/cpp/run.sh runs them for an hour each under ASan + UBSan.
  mat_test(logic_fuzz_test core/logic/tests/logic_fuzz_test.cpp)
  target_link_libraries(logic_fuzz_test PRIVATE mat_logic)
  mat_test(project_fuzz_test core/project-manager/tests/project_fuzz_test.cpp)
  mat_test(expression_fuzz_test core/expression/tests/expression_fuzz_test.cpp)
  target_link_libraries(expression_fuzz_test PRIVATE mat_expression)
  # The scan of the maximum configuration (label perf, FR-095; T147 engine part).
  add_executable(logic_perf_test core/logic/tests/logic_perf_test.cpp)
  target_link_libraries(logic_perf_test PRIVATE mat_logic GTest::gtest_main)
  target_compile_options(logic_perf_test PRIVATE ${MAT_WARN})
  if(CMAKE_CROSSCOMPILING)
    set_target_properties(logic_perf_test PROPERTIES EXCLUDE_FROM_ALL TRUE)
  else()
    gtest_discover_tests(logic_perf_test PROPERTIES LABELS perf DISCOVERY_TIMEOUT 30)
  endif()
  add_custom_target(mat_logic_tests DEPENDS ${MAT_LOGIC_TEST_NAMES} logic_perf_test)
  # Driver SDK (T049-T051, T055) and the graph of calculated Tags (T030).
  mat_test(merge_planner_test drivers/sdk/tests/merge_planner_test.cpp)
  target_link_libraries(merge_planner_test PRIVATE mat_merge_planner)
  mat_test(scheduler_test drivers/sdk/tests/scheduler_test.cpp)
  target_link_libraries(scheduler_test PRIVATE mat_drivers)
  mat_test(backoff_test drivers/sdk/tests/backoff_test.cpp)
  target_link_libraries(backoff_test PRIVATE mat_drivers)
  mat_test(diag_counters_test drivers/sdk/tests/diag_counters_test.cpp)
  target_link_libraries(diag_counters_test PRIVATE mat_drivers)
  mat_test(simulation_driver_test drivers/simulation/tests/simulation_driver_test.cpp)
  target_link_libraries(simulation_driver_test PRIVATE mat_drivers)
  mat_test(calc_graph_test core/tag-engine/tests/calc_graph_test.cpp)
  target_link_libraries(calc_graph_test PRIVATE mat_calc_graph)
  # Tag Engine v1 (T044, T046).
  mat_test(tag_model_test core/tag-engine/tests/tag_model_test.cpp)
  target_link_libraries(tag_model_test PRIVATE mat_tag_engine)
  mat_test(engine_test core/tag-engine/tests/engine_test.cpp)
  target_link_libraries(engine_test PRIVATE mat_tag_engine)
  mat_test(retain_store_test core/tag-engine/tests/retain_store_test.cpp)
  target_link_libraries(retain_store_test PRIVATE mat_tag_engine)
  # Tag writes (T137, T138): the rate limit and the coordinator.
  mat_test(token_bucket_test core/tag-engine/tests/token_bucket_test.cpp)
  target_link_libraries(token_bucket_test PRIVATE mat_tag_engine)
  mat_test(write_coordinator_test core/tag-engine/tests/write_coordinator_test.cpp)
  target_link_libraries(write_coordinator_test PRIVATE mat_tag_engine)
  # Context, expectation and pulse of a tag write (feature 007 T054).
  mat_test(write_extensions_test core/tag-engine/tests/write_extensions_test.cpp)
  target_link_libraries(write_extensions_test PRIVATE mat_tag_engine)
  # The journal of pulses and their release at start (feature 011 T036).
  mat_test(pulse_journal_test core/tag-engine/tests/pulse_journal_test.cpp)
  target_link_libraries(pulse_journal_test PRIVATE mat_tag_engine)
  mat_test(runtime_engine_test server/tests/runtime_engine_test.cpp)
  target_link_libraries(runtime_engine_test PRIVATE mat_runtime_engine mat_startup)
  # The write coordinator in the runtime (T146, T147): recovery, audit down, the stop before execv.
  mat_test(write_subsystem_test server/tests/write_subsystem_test.cpp)
  target_link_libraries(write_subsystem_test PRIVATE mat_api_ext mat_runtime_engine mat_startup mat_audit)
  # Writes from logic (feature 011 T129): the logic subsystem over the real coordinator, fakes of
  # the driver, the audit and the pulse journal; the audit row on a real audit.db.
  mat_test(logic_write_test server/tests/logic_write_test.cpp)
  target_link_libraries(logic_write_test PRIVATE mat_api_ext mat_logic mat_audit mat_tag_engine)
  # Logic in the runtime's engine and its retained state (feature 011 T130, T131): a real project.
  mat_test(logic_runtime_test server/tests/logic_runtime_test.cpp)
  target_link_libraries(logic_runtime_test PRIVATE mat_runtime_engine mat_startup)
  mat_test(legacy_vectors_test drivers/simulation/tests/legacy_vectors_test.cpp)
  # The wake-ups of the tick loop: logic on its own period (feature 011 T148).
  mat_test(tick_schedule_test server/tests/tick_schedule_test.cpp)
  mat_test(source_filter_test server/tests/source_filter_test.cpp)
  target_link_libraries(source_filter_test PRIVATE mat_viewer_gate)
  mat_test(codec_test drivers/modbus/tests/codec_test.cpp)
  target_link_libraries(codec_test PRIVATE mat_modbus_codec)
  # Modbus TCP frames (T093) on tests/modbus-vectors.
  mat_test(frames_test drivers/modbus/tests/frames_test.cpp)
  target_link_libraries(frames_test PRIVATE mat_modbus)
  # The TCP transport (T097), the driver on a fake PLC (T099, T140), the fuzz (T101), the probe (T103).
  mat_test(tcp_socket_test drivers/sdk/tests/tcp_socket_test.cpp)
  target_link_libraries(tcp_socket_test PRIVATE mat_drivers)
  # Feature 011 (T037): several field devices behind one gateway.
  foreach(t modbus_tcp_driver_test modbus_tcp_write_test modbus_fuzz_test test_probe_test
          modbus_tcp_multiunit_test)
    mat_test(${t} drivers/modbus/tests/${t}.cpp)
    target_link_libraries(${t} PRIVATE mat_modbus)
  endforeach()
  # Modbus RTU (T157, T159, T161, T163): frames, the serial port on a pty, the list of ports, the driver.
  foreach(t rtu_frame_test modbus_rtu_driver_test)
    mat_test(${t} drivers/modbus/tests/${t}.cpp)
    target_link_libraries(${t} PRIVATE mat_modbus)
  endforeach()
  foreach(t serial_port_test serial_ports_test)
    mat_test(${t} drivers/sdk/tests/${t}.cpp)
    target_link_libraries(${t} PRIVATE mat_drivers)
  endforeach()
  mat_test(scaling_test core/tag-engine/tests/scaling_test.cpp)
  target_link_libraries(scaling_test PRIVATE mat_tag_engine)
  mat_test(sim_generators_test drivers/simulation/tests/sim_generators_test.cpp)
  target_link_libraries(sim_generators_test PRIVATE mat_sim)
  # T007: fsync/fdatasync counted through the linker's --wrap.
  mat_test(sqlite_sync_test core/historian/tests/sqlite_sync_test.cpp)
  target_link_libraries(sqlite_sync_test PRIVATE mat_sqlite)
  target_link_options(sqlite_sync_test PRIVATE -Wl,--wrap=fsync,--wrap=fdatasync)
  mat_test(export_history_test server/tests/export_history_test.cpp)
  mat_test(cache_budget_test server/tests/cache_budget_test.cpp)
  mat_test(export_audit_test server/tests/export_audit_test.cpp)
  mat_test(historian_test core/historian/tests/historian_test.cpp)
  mat_test(historian_agg_test core/historian/tests/historian_agg_test.cpp)
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
  # Feature 009 T019: the six alarm actions (27 -> 33).
  mat_test(audit_alarm_actions_test core/audit/tests/audit_alarm_actions_test.cpp)
  target_link_libraries(audit_alarm_actions_test PRIVATE mat_audit)
  # audit.db version 2: the audit of tag writes (feature 006 T142).
  mat_test(tag_write_audit_test core/audit/tests/tag_write_audit_test.cpp)
  target_link_libraries(tag_write_audit_test PRIVATE mat_audit)
  mat_test(proc_stats_test core/diagnostics/tests/proc_stats_test.cpp)
  target_link_libraries(proc_stats_test PRIVATE mat_diagnostics)
  # Feature 011 T028: eMMC wear, bytes written today, restarts, live lag p95 (no HTTP).
  mat_test(diagnostics_011_test core/diagnostics/tests/diagnostics_011_test.cpp)
  target_link_libraries(diagnostics_011_test PRIVATE mat_diagnostics)
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
  # The seven alarm rows of the table, column by column (feature 009 T045).
  mat_test(roles_alarm_test core/auth/tests/roles_alarm_test.cpp)
  target_link_libraries(roles_alarm_test PRIVATE mat_auth)
  mat_test(auth_service_test core/auth/tests/auth_service_test.cpp)
  target_link_libraries(auth_service_test PRIVATE mat_auth)
  # Web sessions (feature 007 T052): the cookie session of the page, kinds, quota, execv.
  mat_test(web_session_test core/auth/tests/web_session_test.cpp)
  target_link_libraries(web_session_test PRIVATE mat_auth)
  # The gate of the engineering API (T040): a function of the request, no CivetWeb.
  mat_test(auth_gate_test server/tests/auth_gate_test.cpp server/http/auth_gate.cpp)
  target_link_libraries(auth_gate_test PRIVATE mat_auth mat_audit mat_viewer_gate)
  # The cookie branch of the gate (feature 007 T053).
  mat_test(web_gate_test server/tests/web_gate_test.cpp server/http/auth_gate.cpp)
  target_link_libraries(web_gate_test PRIVATE mat_auth mat_audit mat_viewer_gate)
  # In-process HTTPS for tests (T036, T041): CivetWeb HTTPS context, certificate generated at run
  # time, client on the image's libcurl + OpenSSL (Mbed TLS is configured server-only).
  find_package(CURL)
  if(CURL_FOUND)
    add_library(mat_tls_test_support STATIC server/tests/tls_test_support.cpp)
    target_include_directories(mat_tls_test_support PUBLIC ${CMAKE_SOURCE_DIR})
    target_link_libraries(mat_tls_test_support PUBLIC civetweb_runtime mat_mbedtls CURL::libcurl)
    target_compile_options(mat_tls_test_support PRIVATE ${MAT_WARN})
    # The source filter on the page handlers over HTTP and HTTPS (feature 006 T064).
    mat_test(viewer_access_test server/tests/viewer_access_test.cpp server/http/http_api.cpp)
    target_link_libraries(viewer_access_test PRIVATE mat_tls_test_support mat_viewer_gate civetweb_runtime)
    # system/info of feature 011: warningDetails, update, logic (T030).
    mat_test(system_info_011_test server/tests/system_info_011_test.cpp server/http/http_api.cpp)
    target_link_libraries(system_info_011_test PRIVATE mat_tls_test_support mat_viewer_gate civetweb_runtime)
    # mAT patches 3 and 4 of CivetWeb, TLS policy. --wrap=calloc: allocation failure injection.
    mat_test(https_handshake_test server/tests/https_handshake_test.cpp)
    target_link_libraries(https_handshake_test PRIVATE mat_tls_test_support)
    target_link_options(https_handshake_test PRIVATE -Wl,--wrap=calloc)
    # The two listeners of mat-runtime with the engineering API (T041), as main opens them.
    mat_test(https_api_test server/tests/https_api_test.cpp server/http/http_api.cpp
             server/http/auth_gate.cpp server/http/engineering_api.cpp
             server/http/engineering_api_project.cpp
             server/http/web_contexts.cpp server/websocket/civet_transport.cpp)
    target_link_libraries(https_api_test PRIVATE mat_viewer_gate mat_startup mat_tls_test_support mat_auth mat_audit
                          mat_server_tls mat_package mat_project_store mat_api_ext)
    # The check of Host against DNS rebinding (feature 011 T032): the decision table, then the two
    # listeners as main opens them, with HttpApi, the engineering API and a WebSocket route.
    mat_test(host_policy_test server/tests/host_policy_test.cpp server/http/http_api.cpp
             server/http/auth_gate.cpp server/http/engineering_api.cpp
             server/http/engineering_api_project.cpp server/http/web_contexts.cpp)
    target_link_libraries(host_policy_test PRIVATE mat_viewer_gate mat_tls_test_support mat_auth mat_audit
                          mat_server_tls mat_package mat_project_store mat_api_ext)
    # Connections at once per source IP (feature 011 T039): the two listeners as main opens them.
    mat_test(conn_limit_test server/tests/conn_limit_test.cpp server/http/web_contexts.cpp)
    target_link_libraries(conn_limit_test PRIVATE mat_tls_test_support mat_server_tls)
    # The sign-in of the runtime page (feature 007 T055): the real sign-in service, HttpApi and the gate.
    mat_test(web_api_test server/tests/web_api_test.cpp server/http/http_api.cpp
             server/http/auth_gate.cpp server/http/engineering_api.cpp
             server/http/engineering_api_project.cpp server/http/web_contexts.cpp
             server/project_glue.cpp)
    target_link_libraries(web_api_test PRIVATE mat_tls_test_support mat_auth mat_audit mat_server_tls
                          mat_package mat_project_store mat_diagnostics mat_discovery mat_api_ext
                          mat_viewer_gate)
    # The live WebSocket with the cookie of a web session (feature 007 T056).
    mat_test(civet_cookie_upgrade_test server/websocket/tests/civet_cookie_upgrade_test.cpp
             server/http/auth_gate.cpp server/http/engineering_api.cpp
             server/http/engineering_api_project.cpp server/http/web_contexts.cpp
             server/project_glue.cpp server/websocket/civet_transport.cpp
             server/websocket/live_hub.cpp)
    target_link_libraries(civet_cookie_upgrade_test PRIVATE mat_tls_test_support mat_auth mat_audit
                          mat_server_tls mat_package mat_project_store mat_diagnostics mat_discovery
                          mat_api_ext mat_viewer_gate)
    # The project routes (T109): the same two listeners over a real store and pipeline.
    mat_test(project_api_test server/tests/project_api_test.cpp server/http/auth_gate.cpp
             server/http/engineering_api.cpp server/http/engineering_api_project.cpp
             server/http/web_contexts.cpp server/project_glue.cpp)
    target_link_libraries(project_api_test PRIVATE mat_tls_test_support mat_auth mat_audit
                          mat_server_tls mat_package mat_project_store mat_api_ext)
    # GET /diagnostics and GET /audit (T143): the same listeners, the numbers injected.
    mat_test(diagnostics_audit_api_test server/tests/diagnostics_audit_api_test.cpp
             server/http/auth_gate.cpp server/http/engineering_api.cpp
             server/http/engineering_api_project.cpp server/http/web_contexts.cpp
             server/project_glue.cpp)
    target_link_libraries(diagnostics_audit_api_test PRIVATE mat_tls_test_support mat_auth mat_audit
                          mat_server_tls mat_package mat_project_store mat_diagnostics mat_discovery mat_api_ext)
    # The connection test route (T105): the same listeners, the test injected.
    mat_test(drivers_api_test server/tests/drivers_api_test.cpp server/http/auth_gate.cpp
             server/http/engineering_api.cpp server/http/engineering_api_project.cpp
             server/http/web_contexts.cpp server/project_glue.cpp)
    target_link_libraries(drivers_api_test PRIVATE mat_tls_test_support mat_auth mat_audit mat_server_tls
                          mat_package mat_project_store mat_diagnostics mat_discovery mat_api_ext)
    # The list of serial ports and the connection test of an RTU channel (T167), the diagnostics of the
    # drivers (T194): the same listeners.
    foreach(t serial_api_test drivers_diag_api_test)
      mat_test(${t} server/tests/${t}.cpp server/http/auth_gate.cpp
               server/http/engineering_api.cpp server/http/engineering_api_project.cpp
               server/http/web_contexts.cpp server/project_glue.cpp)
      target_link_libraries(${t} PRIVATE mat_tls_test_support mat_auth mat_audit mat_server_tls
                            mat_package mat_project_store mat_diagnostics mat_discovery mat_api_ext)
    endforeach()
    # The tag write routes (T144): the same listeners, the real coordinator over a fake of the drivers.
    mat_test(tags_api_test server/tests/tags_api_test.cpp server/http/auth_gate.cpp
             server/http/engineering_api.cpp server/http/engineering_api_project.cpp
             server/http/web_contexts.cpp server/project_glue.cpp server/websocket/live_hub.cpp)
    target_link_libraries(tags_api_test PRIVATE mat_tls_test_support mat_auth mat_audit mat_server_tls
                          mat_package mat_project_store mat_diagnostics mat_discovery mat_api_ext mat_runtime_engine)
    # The routes of logic (feature 011 T130): the same listeners, a logic subsystem over a fake round.
    mat_test(logic_api_test server/tests/logic_api_test.cpp server/http/auth_gate.cpp
             server/http/engineering_api.cpp server/http/engineering_api_project.cpp
             server/http/web_contexts.cpp server/project_glue.cpp)
    target_link_libraries(logic_api_test PRIVATE mat_tls_test_support mat_auth mat_audit mat_server_tls
                          mat_package mat_project_store mat_diagnostics mat_discovery mat_api_ext
                          mat_runtime_engine)
    # The update routes (feature 011 T107): the same listeners, the update service on a temporary
    # data directory and installed tree, the packages of tests/update-vectors.
    mat_test(update_api_test server/tests/update_api_test.cpp server/http/auth_gate.cpp
             server/http/engineering_api.cpp server/http/engineering_api_project.cpp
             server/http/web_contexts.cpp server/project_glue.cpp)
    target_link_libraries(update_api_test PRIVATE mat_tls_test_support mat_auth mat_audit mat_server_tls
                          mat_package mat_project_store mat_diagnostics mat_discovery mat_api_ext
                          mat_runtime_engine mat_update)
    # The alarm routes on the two listeners, over the real engine and alarm.db (feature 009 T044,
    # T090, T114): the page's handlers (source filter) and the POST routes of the engineering API.
    foreach(t alarms_api_test alarms_history_api_test alarm_recovery_test)
      if(${t} STREQUAL alarm_recovery_test)
        set(src server/tests/${t}.cpp)
      else()
        set(src server/http/tests/${t}.cpp)
      endif()
      mat_test(${t} ${src} server/http/auth_gate.cpp server/http/engineering_api.cpp
               server/http/engineering_api_project.cpp server/http/web_contexts.cpp
               server/project_glue.cpp server/http/http_api.cpp)
      target_link_libraries(${t} PRIVATE mat_tls_test_support mat_auth mat_audit mat_server_tls
                            mat_package mat_project_store mat_diagnostics mat_discovery mat_api_ext
                            mat_runtime_engine mat_viewer_gate mat_alarm_glue mat_alarm)
    endforeach()
    # The history API (feature 010): the real listeners over a real history.db.
    mat_test(history_api_test server/tests/history_api_test.cpp server/http/auth_gate.cpp
             server/http/engineering_api.cpp server/http/engineering_api_project.cpp
             server/http/web_contexts.cpp server/project_glue.cpp server/websocket/live_hub.cpp)
    target_link_libraries(history_api_test PRIVATE mat_tls_test_support mat_auth mat_audit mat_server_tls
                          mat_package mat_project_store mat_diagnostics mat_discovery mat_api_ext mat_runtime_engine)
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
  mat_test(serial_cli_test server/tests/serial_cli_test.cpp)
  mat_test(retain_cli_test server/tests/retain_cli_test.cpp)
  target_link_libraries(retain_cli_test PRIVATE mat_tag_engine)
  # mat-runtime --check-data (feature 011 T066): real SQLite files, store, retain, pulse journal.
  mat_test(check_data_test server/tests/check_data_test.cpp)
  target_link_libraries(check_data_test PRIVATE mat_tag_engine mat_project_store mat_package mat_sqlite)
  # mat-runtime --self-check, --trust-key, --update-status (feature 011 T109): the commands of
  # mat-updater and of root; the runtime's audit of a changed key set at start.
  mat_test(self_check_test server/tests/self_check_test.cpp)
  target_link_libraries(self_check_test PRIVATE mat_project_store mat_package mat_sqlite)
  mat_test(trust_key_cli_test server/tests/trust_key_cli_test.cpp)
  target_link_libraries(trust_key_cli_test PRIVATE mat_update mat_api_ext)
  # mat-runtime --alarm-db-check (feature 009 T038)
  mat_test(alarm_db_check_test server/tests/alarm_db_check_test.cpp)
  target_link_libraries(alarm_db_check_test PRIVATE mat_alarm mat_audit)
  # The refusals, the port opened for a test, the channel that holds it (T164, T168): a pty and the fake line.
  mat_test(serial_probe_test server/tests/serial_probe_test.cpp)
  target_link_libraries(serial_probe_test PRIVATE mat_api_ext mat_modbus)
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

  # Alarms (feature 009 T023-T029, T037, T041): engine, text, definitions, vectors, alarm.db, service.
  # mat_alarm_tests builds them all (the target of the sanitizer run); the armhf build lists them
  # in deployment/toolchain/test-armhf.sh.
  set(MAT_ALARM_TEST_NAMES alarm_text_test alarm_defs_test alarm_engine_test alarm_state_table_test
      alarm_engine_vectors_test alarm_store_test alarm_service_test)
  foreach(t ${MAT_ALARM_TEST_NAMES})
    mat_test(${t} core/alarm/tests/${t}.cpp)
    target_link_libraries(${t} PRIVATE mat_alarm)
  endforeach()
  # The tick budget (label perf, T041): 500 instances; writes docs/reports/009-tick-x64.json.
  add_executable(alarm_perf_test core/alarm/tests/alarm_perf_test.cpp)
  target_link_libraries(alarm_perf_test PRIVATE mat_alarm GTest::gtest_main)
  target_compile_options(alarm_perf_test PRIVATE ${MAT_WARN})
  target_compile_definitions(alarm_perf_test PRIVATE MAT_SOURCE_DIR="${CMAKE_SOURCE_DIR}")
  if(CMAKE_CROSSCOMPILING)
    set_target_properties(alarm_perf_test PROPERTIES EXCLUDE_FROM_ALL TRUE)
  else()
    gtest_discover_tests(alarm_perf_test PROPERTIES LABELS perf DISCOVERY_TIMEOUT 30)
  endif()
  add_custom_target(mat_alarm_tests DEPENDS ${MAT_ALARM_TEST_NAMES} alarm_perf_test)
  # The history query and the storm (feature 009 T089, T112): own names, built by the same target of
  # the sanitizer run.
  foreach(t alarm_history_test alarm_storm_test)
    mat_test(${t} core/alarm/tests/${t}.cpp)
    target_link_libraries(${t} PRIVATE mat_alarm_glue mat_alarm mat_audit)
  endforeach()
  add_dependencies(mat_alarm_tests alarm_history_test alarm_storm_test)

  # Dev tool for tools/historian-it.ps1 scenarios (not a test, never packaged).
  add_executable(historian_tool core/historian/tests/historian_tool.cpp
                 core/historian/tests/it_support.cpp)
  if(CMAKE_CROSSCOMPILING)
    set_target_properties(historian_tool PROPERTIES EXCLUDE_FROM_ALL TRUE)
  endif()
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
