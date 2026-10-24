# Tasks: Driver BACnet/IP client

Ký hiệu: [P] làm song song được; test viết trước phần cài đặt.

## Phase 1: Đặc tả và vector

- [x] T001 spec.md, plan.md, tasks.md
- [x] T002 Vector địa chỉ `tests/bacnet-vectors/address.json` (mọi loại đối tượng, thuộc tính, priority, mọi mã lỗi)
- [x] T003 Vector byte `tests/bacnet-vectors/frames.json` (Annex F.3.5/F.3.7/F.3.9 bọc BVLC/NPDU, Who-Is, I-Am, Forwarded-NPDU, router, Error/Reject/Abort, khung hỏng, giá trị tag)

## Phase 2: Codec C++ và TS (test trước)

- [x] T010 [P] gtest `bacnet_codec_test` (địa chỉ, mã hóa, giải mã, giá trị) → `address.cpp`, `codec.cpp`
- [x] T011 [P] vitest `bacnet-address.test.ts` → `packages/tag-codec/src/bacnet-address.ts`
- [x] T012 gtest `bacnet_fuzz_test` (khung đột biến, địa chỉ đột biến; `MAT_FUZZ_SECONDS`)

## Phase 3: Driver (US1, US2)

- [x] T020 gtest `bacnet_driver_test` trên thiết bị giả (`fake_bacnet.hpp`): RPM một lần, status-flags → quality, lỗi theo thuộc tính, fallback RP khi Reject, gói theo maxApdu, chia đôi khi Abort, timeout gửi lại cùng invoke ID rồi backoff, khung sai bị đếm, router (DNET/SNET), BBMD, cổng bận, thiết bị tắt
- [x] T021 gtest ghi: priority theo Tag và thiết bị, Real/Enumerated/Unsigned, relinquish NULL + đọc priority-array, Error → DEVICE_EXCEPTION, không gửi lại lệnh ghi
- [x] T022 `udp_port.cpp`, `client.cpp`, `bacnet_driver.cpp`; `probeBacnet` (read, whois, objects) + gtest

## Phase 4: Định dạng 1.1 và hai bộ kiểm

- [x] T030 Schema `bacnetChannel`, `bacnetDevice`; địa chỉ Tag 32 ký tự; README schemas
- [x] T031 Vector `tests/project-vectors/v11-bacnet.mjs` + sinh 29 thư mục, README-020.md
- [x] T032 TS `rules-bacnet.ts` + `E_CHANNEL_VERSION`, móc rules-02 và validate
- [x] T033 C++ `rules_bacnet.cpp`, móc rules_02 và project_validator; `vectors_11_test` qua

## Phase 5: Runtime

- [x] T040 `tag_model` (kênh/thiết bị/địa chỉ BACnet), `bacnet_factory` + gtest; Modbus factory bỏ kênh bacnet
- [x] T041 `RuntimeEngine::allDrivers`, `driverOf` theo `drv::Driver*`; write_glue; pulse hash
- [x] T042 drivers API kind `bacnet` (read/whois/objects, trả lời, 501 khi thiếu backend), chẩn đoán `kind: bacnet` và khóa `error:/reject:/abort:`; gtest `drivers_bacnet_api_test`
- [x] T043 Mã lỗi `BACNET_*`, `BBMD_NAK`, `E_CHANNEL_VERSION`; sinh lại `docs/user/error-codes.md`

## Phase 6: Giả lập và driver-it

- [x] T050 `tools/bacnet-sim` (codec, thiết bị, priority array, Who-Is, router ảo, lỗi theo lệnh) + `sim.test.mjs` (đáp án = vector Annex F); vào CI (`ci.yml`, `ci-local.ps1`)
- [x] T051 `tests/driver-it-bacnet` (compose 172.30.20.0/24, projects, kịch bản read/write/errors/load), `tools/driver-it-bacnet.ps1`
- [x] T052 Đo x64 500 điểm 1 s, 10 client → `docs/reports/020-bacnet-x64.md`
- [x] T053 armhf: thêm test BACnet vào `test-armhf.sh`, chạy dưới qemu

## Phase 7: Studio (US3)

- [x] T060 Mô hình: trường kênh/thiết bị BACnet, kênh/thiết bị mới, thân thử, đọc kết quả, thiết bị và Tag từ kết quả; vitest
- [x] T061 Editor: Thêm kênh BACnet/IP (chỉ 1.1), Tìm thiết bị, Thử kết nối, Duyệt đối tượng → Thêm Tag; Bảng Tag gợi ý/kiểm địa chỉ; chẩn đoán; chuỗi tiếng Việt
- [x] T062 e2e `connections-bacnet.e2e.mjs` (axe sáng/tối)

## Phase 8: Tài liệu

- [x] T070 ADR-048 + README ADR; hướng dẫn kỹ sư §4.1
- [ ] T071 Đo trên BL335 và thử với thiết bị BACnet thật (chờ người dùng và thiết bị)
- [ ] T072 SubscribeCOV (bản sau, theo số đo thực tế)
