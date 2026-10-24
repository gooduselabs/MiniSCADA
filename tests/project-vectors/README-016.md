# Vector project của feature 016 (driver Siemens S7)

Sinh bởi `tests/project-vectors/generate.mjs` (mã ca ở `v11-s7.mjs`, hàm `s7Cases`, gọi từ `v11.mjs`); tên `v11-s7-*`, cùng bộ chạy với `v11-*` ([README-012.md](README-012.md)): `packages/project-schema/src/vectors-11.test.ts` (TS), `core/project-manager/tests/vectors_11_test.cpp` (C++). Hợp đồng: [contracts/s7-driver.md](../../specs/016-driver-s7/contracts/s7-driver.md) §1, §2.

## Schema (dòng 1.x, `schemas/connections.schema.json` ở thư mục gốc)

- Kênh `kind: "s7"`: `tcp` (bắt buộc, như Modbus TCP), `s7` (`rack` 0–7, `slot` 0–31, `localTsap`/`remoteTsap` 4 chữ số hex, `pduSize` 240–960), `devices` tối đa 1 (`timeoutMs`, `retries`, `writeDeadlineMs`, `maxGapBytes`). Khóa của Modbus (`unitId`, `serial`…) là `E_SCHEMA`.
- `tag.schema.json`: `source.address` tới 24 ký tự.

## Luật (TS `rules-s7.ts` gọi từ `rules-02.ts`; C++ `rules_02.cpp`)

1. Mỗi kênh `s7` theo thứ tự: project không phải 1.1 → `E_DRIVER_VERSION` `/channels/<i>/kind` (connections); có `s7.remoteTsap` và `rack` hoặc `slot` → `E_S7_TSAP` `/channels/<i>/s7/remoteTsap`.
2. Tag ngoài trên thiết bị của kênh `s7`, sau luật `stringLength` chung: `byteOrder` → `E_SCHEMA` `.../source/byteOrder`; `stringByteOrder` → `E_SCHEMA` `.../source/stringByteOrder`; địa chỉ phân tích bằng bộ S7 (`tests/s7-vectors/address.json`), lỗi → mã của bộ phân tích tại `.../source/address` (dừng); cỡ > `pduSize − 18` (mặc định 480) → `E_ADDR_READ_LIMIT` `.../source`; Tag RW có cỡ ghi (STRING: n + 1) > `pduSize − 28` → `E_ADDR_WRITE_LIMIT` `.../source`.
3. `W_DETECT_SLOW` như Modbus TCP (`retries` mặc định 0), khi địa chỉ phân tích được (lỗi giới hạn PDU vẫn kiểm, như Modbus).
