# Tasks: Driver Omron FINS

Ký hiệu: [P] làm song song được; test viết trước phần cài đặt.

## Phase 1: Đặc tả và vector

- [x] T001 spec.md, plan.md, tasks.md
- [x] T002 Vector địa chỉ `tests/fins-vectors/address.json` (hợp lệ, lỗi cú pháp, vùng, tầm, kiểu)
- [x] T003 Vector khung `tests/fins-vectors/frames.json` (0101, 0102, 0104, 0501, bắt tay TCP, trả lời, mã kết thúc) theo W342

## Phase 2: Codec C++ và TS (test trước)

- [x] T010 [P] gtest `fins_frame_test` (FinsAddress) trên vector → `drivers/fins/address.cpp`
- [x] T011 [P] vitest `fins-address.test.ts` trên vector → `packages/tag-codec/src/fins-address.ts`
- [x] T012 gtest `fins_frame_test` (vector byte) → `frame.cpp`, `end_codes.cpp`, `bcd.cpp`
- [x] T013 gtest `fins_udp_link_test` (loopback) → `udp_link.cpp`

## Phase 3: Driver (US1, US2)

- [x] T020 gtest `fins_driver_test` trên PLC giả trong bộ nhớ (UDP và TCP): đọc mọi vùng/kiểu, gom 0101/0104, tách khối khi 1103, SID mới khi gửi lại, trả lời muộn bị bỏ, timeout → backoff thiết bị, đóng/mở lại kết nối, bắt tay TCP lỗi
- [x] T021 gtest ghi (trong `fins_driver_test`): word, bit, BCD, STRING, đọc lại, end code, timeout, hàng đợi
- [x] T022 `fins_driver.cpp`
- [x] T023 gtest `fins_fuzz_test` (bộ giải mã khung và đầu TCP, MAT_FUZZ_SECONDS)

## Phase 4: Định dạng 1.1 và hai bộ kiểm

- [x] T030 Schema `connections.schema.json` (kênh `fins`), `tag.schema.json` (`source.bcd`), README schemas
- [x] T031 Vector `tests/project-vectors/v11-fins.mjs` + sinh thư mục
- [x] T032 TS `rules-fins.ts` (+ `E_CHANNEL_VERSION` ở codes.ts), móc vào rules-02
- [x] T033 C++ `rules_fins.cpp`, móc vào rules_02; test vector C++
- [x] T034 `schemas/error-codes.json` + `docs/user/error-codes.md`

## Phase 5: Runtime

- [x] T040 `tag_model` (kind, fins), `fins_factory`; test
- [x] T041 `RuntimeEngine` giữ driver chung; write_glue; chẩn đoán; thử kết nối kind `fins`; test

## Phase 6: Giả lập và driver-it

- [x] T050 `tools/fins-sim` + test node
- [x] T051 Kịch bản driver-it `fins-*`, project test, compose

## Phase 7: Studio (US3)

- [x] T060 model `connections.ts` (kênh FINS), editor Kết nối "Thêm kênh Omron FINS"
- [x] T061 bảng Tag: gợi ý/kiểm địa chỉ FINS
- [x] T062 chẩn đoán kênh FINS (mã kết thúc)
- [x] T063 e2e Studio

## Phase 8: Đo, tài liệu

- [x] T070 Đo x64 500 Tag 1 s → `docs/reports/018-fins-x64.md`; armhf build + test FINS dưới qemu
- [x] T071 `docs/user/engineer-guide.md` (FINS, CX-Programmer), ADR-046 + README ADR
- [x] T072 Kiểm cuối: ctest x64, npm lint/typecheck/test, e2e, clang-format

## Còn mở (ngoài phiên)

- [ ] Đo RSS/CPU trên BL335 với PLC thật hoặc giả lập ở máy khác (Constitution VII: điều kiện phát hành driver)
- [ ] Thử với PLC thật: CJ2M (UDP và TCP), CP1L-E, CJ1 + CJ1W-ETN21; ghi bảng model/firmware đã thử
