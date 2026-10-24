# Tasks 021: OPC DA Bridge

Ký hiệu: test viết trước phần cài đặt.

## Phase 1: Đặc tả

- [x] T001 spec.md, plan.md, tasks.md; ADR-049

## Phase 2: Lõi thuần (test trước)

- [x] T010 test `config` (kiểm chặt) → `config.rs`
- [x] T011 test `map` (địa chỉ, CSV) → `map.rs`
- [x] T012 test `quality` → `quality.rs`
- [x] T013 test codec Modbus (vector PDU, ngoại lệ, khung lỗi) → `modbus.rs`
- [x] T014 test allowlist IP/CIDR → `allow.rs`

## Phase 3: Engine và OPC

- [x] T020 test engine với `MockClient`: group/item, quality, ghi, item lỗi, mất server → kết nối lại
- [x] T021 `com.rs` client COM (cfg windows): ProgID, group, item, subscription + dự phòng cache, ghi, browse
- [x] T022 test tích hợp TCP: client Modbus ↔ cầu nối backend giả (`tests/bridge_it.rs`)

## Phase 4: Vận hành

- [x] T030 CLI `run`, `browse`, `export-csv`, `check`, `service install|uninstall`; dịch vụ Windows; log file
- [x] T031 Đóng gói ZIP `package.ps1` (ký thử tùy chọn)

## Phase 5: Studio và tài liệu

- [x] T040 vitest `opcda-map.test.ts` → `opcda-map.ts`; lệnh "Nhập ánh xạ OPC DA…" và hướng dẫn trong editor Kết nối
- [x] T041 engineer-guide, admin-guide, threat-model, ADR README

## Mở

- [ ] T090 Thử với OPC DA server thật (Kepware/Matrikon) trên Windows: browse, subscription, ghi, khởi động lại server
- [ ] T091 Test tích hợp runtime x64 trong Docker đọc cầu nối (rig driver-it)
- [ ] T092 Mặt OPC UA server (sau khi gộp 019)
