# Tasks: Driver OPC UA client (019)

Đầu vào: [spec.md](spec.md), [plan.md](plan.md). Test viết trước (Constitution VI).

## Phase 1: Nền

- [x] T001 Spec, plan, tasks (tệp này)
- [x] T002 Vendored open62541 1.4.21 (amalgamation, `amalgamate.sh`, VERSION.txt, LICENSE), target `mat_open62541`; cấu hình Mbed TLS bật RSA/CBC/SHA-1, `mbedtls_config_test` sửa theo; `third_party/LICENSES.md` (bảng, CVE), SBOM/license-report nhận
- [x] T003 [P] Vector `tests/opcua-vectors/nodeid.json` + TS `packages/tag-codec/src/opcua-node-id.{ts,test.ts}`
- [x] T004 [P] C++ `drivers/opcua/node_id.{hpp,cpp}` + `opcua_node_id_test` cùng vector
- [x] T005 Schema `connections.schema.json` (`opcuaChannel`, `opcuaDevice`), `tag.schema.json` (`address` ≤ 256), kiểu TS
- [x] T006 Vector `tests/project-vectors/v11-opcua.mjs` + `README-019.md`; luật TS `rules-opcua.ts`; luật C++ `rules_02.cpp`
- [x] T007 Mã lỗi vào `schemas/error-codes.json`, sinh lại `docs/user/error-codes.md`

## Phase 2: Driver

- [x] T010 `status_map`, `value_codec` + test
- [x] T011 `client_cert` (sinh, đọc, SHA-256, ghim) + test
- [x] T012 Server test trong tiến trình (`drivers/opcua/tests/test_server.hpp`) dùng chung với `tools/opcua-sim`
- [x] T013 `opcua_driver_test` rồi `opcua_driver`: đọc subscription/poll/fallback, ghi, kết nối lại, bảo mật, bí mật
- [x] T014 `tag_model` + `opcua_factory` + `RuntimeEngine`/`write_glue`/chẩn đoán theo `drv::Driver*`; `runtime_engine_test`
- [x] T015 `browse` + `POST /api/v1/drivers/opcua/browse` (vai trò, audit, giới hạn) + test
- [x] T016 CMake, `--gc-sections`, test armhf (`test-armhf.sh`)

## Phase 3: Giả lập, tích hợp, đo

- [x] T020 `tools/opcua-sim` (`mat-opcua-sim`)
- [x] T021 Rig `tests/driver-it-opcua` + `tools/driver-it-opcua.ps1`: read, write, reconnect, security, load
- [x] T022 Đo 500 node x64 + armhf (qemu) → `docs/reports/019-opcua-x64.md`

## Phase 4: Studio

- [x] T030 Model kênh OPC UA (`connections.ts`), Bảng Tag NodeId (`tag-table.ts`), Chẩn đoán
- [x] T031 Editor Kết nối: Thêm kênh OPC UA, Lấy chứng chỉ / Tin chứng chỉ, hộp Duyệt node (qua thiết bị)
- [x] T032 Vitest + e2e `connections-opcua.e2e.mjs`

## Phase 5: Tài liệu, kiểm cuối

- [x] T040 `docs/user/engineer-guide.md` mục OPC UA; ADR-047 + README ADR; schemas/README
- [x] T041 Kiểm cuối: ctest nhóm + toàn bộ, armhf qemu, lint, typecheck, test, e2e, clang-format

## Ghi chú thực hiện

- Duyệt node trực tiếp từ Studio (Tauri) chưa làm (spec D12): đi qua thiết bị.
- Đo BL335 và thử server thật (S7-1500, Kepware) còn mở; armhf chỉ qemu (`docs/reports/019-opcua-x64.md`).
- Khi gộp với 016: `RuntimeEngine::driversByChannel`, `ChannelDiag.details`, `E_DRIVER_VERSION`, `NOT_SUPPORTED` giống nhánh 016, giữ một bản.
