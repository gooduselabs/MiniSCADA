# Implementation Plan: Driver Siemens S7 (016)

**Branch**: `016-driver-s7` | **Spec**: [spec.md](spec.md) | **Hợp đồng**: [contracts/s7-driver.md](contracts/s7-driver.md)

## Tóm tắt

Thêm driver S7comm tự viết theo khuôn driver Modbus (ADR-014): codec thuần (`drivers/s7/{address,frames}`), driver một luồng mỗi kênh (`drivers/s7/s7_driver`) dùng SDK sẵn có (`Scheduler`, `Backoff`, `DiagCounters`, `planBlocks`/`splitBlock`, `Transport`/`TcpSocket`), factory `core/tag-engine/s7_factory`, và nối vào `RuntimeEngine` qua giao diện `drv::Driver` (đường ghi, chẩn đoán). Định dạng 1.1 thêm kênh `s7`; validator TS (`packages/project-schema`, `@mat/tag-codec`) và C++ (`core/project-manager`) cùng vector. Giả lập Node `tools/s7-sim`, rig `tests/driver-it-s7`. Studio thêm kênh S7.

## Technical Context

C++17 (gcc của image `mat-armhf`, armhf + x64), TypeScript 5 (Vitest, Playwright cho e2e Studio), Node 22 (giả lập, rig). Không thư viện mới. Đích: BL335 (armhf, 1 GB).

## Constitution Check (2.0.2)

| Nguyên tắc | Đánh giá |
|---|---|
| I thiết bị thật | Chưa có PLC S7 thật và chưa đo trên BL335: ghi rõ ở báo cáo, việc còn mở. Driver chỉ "phát hành" (nguyên tắc VII) khi có số đo BL335. |
| II ranh giới | Driver chỉ phát `TagUpdate`/`WriteResult` qua `EngineSink`; validator hai bản cùng vector (`tests/s7-vectors/address.json`, `tests/project-vectors/v11-s7-*`). |
| III ngân sách | Một luồng 256 KiB mỗi kênh, bộ đệm theo PDU (≤ 960 B); đo 500 Tag/1 s x64 (báo cáo 016). |
| V an toàn | Ghi qua write coordinator sẵn có (role, giới hạn, tốc độ, audit). Bộ giải mã kiểm độ dài mọi trường; fuzz. |
| VI test trước | Vector địa chỉ/khung, gtest codec + driver trên PLC giả, fuzz, vector project, rig tích hợp. |
| VII phiên bản | Chỉ thêm trong dòng 1.1 (MINOR), `E_DRIVER_VERSION` chặn ở 1.0; license: tự viết (ADR-044). |

## Cấu trúc

```
drivers/s7/address.{hpp,cpp}     địa chỉ S7 (C++), vector chung với TS
drivers/s7/frames.{hpp,cpp}      TPKT/COTP/S7: mã hóa, tách khung, giải mã trả lời
drivers/s7/plan.{hpp,cpp}        gộp item và xếp yêu cầu theo PDU
drivers/s7/s7_driver.{hpp,cpp}   driver (luồng, kết nối, đọc, ghi, chẩn đoán)
drivers/s7/tests/                gtest: address, frames, plan, driver (PLC giả), fuzz
core/tag-engine/s7_factory.*     cấu hình driver từ ProjectModel
packages/tag-codec/src/s7-address.ts
packages/project-schema/src/rules-s7.ts (gọi từ rules-02 / rules-11)
core/project-manager/rules_s7.*  bản C++
tests/s7-vectors/{address,frames}.json, tests/project-vectors/v11-s7.mjs (+ v11-s7-*)
tools/s7-sim/                    giả lập Node + test
tests/driver-it-s7/, tools/driver-it-s7.ps1   rig tích hợp
apps/studio/src/model/connections.ts, ui/editors/connections-editor.ts, model/tag-table.ts, ui/editors/driver-diagnostics.ts
```

Chỗ dùng chung (giữ gọn để gộp với driver MC/FINS): `schemas/connections.schema.json` (thêm một nhánh `oneOf`), `schemas/error-codes.json` (thêm mục), `CMakeLists.txt` (một khối `mat_s7` + test), `core/tag-engine/tag_model.*` (trường kênh/thiết bị/Tag S7), `server/runtime_engine.*` (danh sách driver theo kênh kiểu `drv::Driver*`), `server/write_glue.cpp`, `server/http/drivers_api.*`, `server/main.cpp`.

## Thay đổi chung có chủ ý

- `ChannelModel.kind` (chuỗi `modbus-tcp|modbus-rtu|s7`) cạnh `rtu`; `makeModbusTcpDrivers` bỏ qua kênh không phải Modbus.
- `RuntimeEngine::driverOf` trả `drv::Driver*`; thêm `channelDriver(ci)` theo chỉ số kênh của model (chẩn đoán); `channelDrivers()` giữ nghĩa cũ (chỉ Modbus, dùng cho Thử kết nối RTU).
- `DriversDiagInput.channels` thành `const drv::Driver*`; JSON chẩn đoán thêm `channel.details` (đối tượng chuỗi) khi driver có.
- `RuntimeWriteBackend::maxTimeoutMs` đọc `timeoutMs` của mọi thiết bị trong model (cùng kết quả với Modbus).

## Rủi ro

- Khác biệt PLC thật (S7-1500 firmware mới, CP 343/443): chưa thử; giảm bằng tài liệu công khai, mã lỗi rõ, TSAP nhập tay.
- Gộp nhánh với driver MC/FINS: xung đột ở các tệp chung liệt kê trên; giữ thay đổi theo khuôn.
