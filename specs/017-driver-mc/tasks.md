# Tasks: Driver Mitsubishi MC protocol (SLMP) (017)

Đầu vào: [spec.md](spec.md), [plan.md](plan.md), [contracts/mc-protocol.md](contracts/mc-protocol.md). Test viết trước (Constitution VI): task cài đặt đi sau task test của nó.

## Phase 1: Định dạng, địa chỉ, luật (nền)

- [x] T001 Schema `schemas/connections.schema.json`: `mcChannel`, `mcDevice` (dòng 1.x, chỉ thêm); mã `E_CHANNEL_VERSION`, `MC_END_*` ở `schemas/error-codes.json`, sinh lại `docs/user/error-codes.md`
- [x] T002 [P] Vector địa chỉ `tests/mc-vectors/address.json` (+ `generate.mjs`, kết quả viết tay)
- [x] T003 TS `packages/tag-codec/src/mc-address.ts` cho xanh vector
- [x] T004 C++ `drivers/mc/mc_address.{hpp,cpp}` + `mc_address_test.cpp` cho xanh vector
- [x] T005 Vector project `tests/project-vectors/v11-mc.mjs` (`v11-mc-*`) + `README-017.md`
- [x] T006 TS `packages/project-schema/src/rules-mc.ts` (gọi từ `rules-02.ts`), kiểu `types-02.ts`; vector TS xanh
- [x] T007 C++ `core/project-manager/rules_mc.cpp` (gọi từ `rules_02.cpp`); vector C++ xanh

## Phase 2: Codec và driver C++ (US1, US2, US3)

- [x] T010 Vector byte `tests/mc-vectors/frames.json` (3E/4E, binary/ASCII, 0401/1401/0403, end code)
- [x] T011 gtest `drivers/mc/tests/mc_frame_test.cpp` (đỏ) → `drivers/mc/mc_frame.{hpp,cpp}` (mã hóa, tách khung, kiểm trả lời, giải dữ liệu) cho xanh
- [x] T012 gtest driver trên PLC giả `drivers/mc/tests/{fake_mc_plc.hpp,mc_driver_test.cpp}`: đọc mọi kiểu/thiết bị, gom khối, Random Read, chia khối khi `MC_END_RANGE`, ghi word/bit/RMW + đọc lại, timeout 3E/4E, mất kết nối, backoff, chẩn đoán; bộ conformance SDK (đỏ)
- [x] T013 `drivers/mc/mc_driver.{hpp,cpp}`, `udp_socket.{hpp,cpp}` cho xanh
- [x] T014 Fuzz `drivers/mc/tests/mc_fuzz_test.cpp` (bộ tách và kiểm khung so với tham chiếu viết từ hợp đồng; driver trên đường truyền hỏng); mục `mc` ở `tools/fuzz/cpp/run.sh`

## Phase 3: Tích hợp runtime (FR-008)

- [x] T020 `core/tag-engine/tag_model`: `ChannelModel::kind`, thiết bị MC, `TagSourceModel::mc`; `mc_factory.{hpp,cpp}`; gtest
- [x] T021 `server/runtime_engine`: driver MC, định tuyến ghi `drv::Driver*`; `write_glue`, chẩn đoán `drivers_api` (kind `mc`); gtest runtime với project MC (khóa xung của write_coordinator dùng chuỗi địa chỉ, không cần đổi)

## Phase 4: Giả lập và tích hợp (US1–US3)

- [x] T030 `tools/mc-sim` (Node: TCP/UDP, 3E/4E, binary/ASCII, bản đồ JSON, điều khiển, log) + `sim.test.mjs`
- [x] T031 Project thử `tests/driver-it/projects/mc-*`, bản đồ `tools/mc-sim/maps/*.json`
- [x] T032 `tools/driver-it-mc.ps1`, `tests/driver-it/compose-mc.yaml`, `tests/driver-it/mc-it.mjs`: `read`, `write`, `random`, `unplug`, `faults`, `load`

## Phase 5: Studio (US4)

- [x] T040 Model `apps/studio/src/model/connections.ts` (kênh `mc`, trường, mặc định), cây, lệnh "Thêm kênh Mitsubishi MC"; Vitest
- [x] T041 Editor kênh/thiết bị MC, Bảng Tag nhận địa chỉ MC (gợi ý, lỗi tại ô), chẩn đoán (kind, end code hex), i18n lý do `MC_END_*`; Vitest
- [x] T042 e2e Studio: thêm kênh MC, Tag `D100`, lỗi địa chỉ

## Phase 6: Đo, tài liệu, kiểm cuối

- [x] T050 Đo 500 Tag/1 s x64 qua giả lập → `docs/reports/017-mc-x64.md`; armhf build + test MC dưới qemu
- [x] T051 `docs/user/engineer-guide.md` (kết nối MC, GX Works3), ADR `docs/adr/045-driver-mc.md` + dòng README ADR, `schemas/README.md`
- [x] T052 Kiểm cuối: ctest x64 toàn bộ, armhf qemu MC, `npm run lint`, `typecheck`, `test`, e2e liên quan, clang-format

## Mở (ngoài 017)

- [ ] T090 Thử PLC thật (iQ-R, FX5U, Q03UDE) và đo RAM/CPU trên BL335 (điều kiện phát hành driver, Constitution VII)
- [ ] T091 Thử kết nối (`POST /api/v1/drivers/test`) cho kênh `mc` và nút trong editor Studio
