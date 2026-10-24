# Vector `v11-fins-*` (feature 018: driver Omron FINS)

Sinh bởi `v11-fins.mjs` (gọi từ `v11.mjs`, chạy `node tests/project-vectors/generate.mjs`). Mỗi ca thêm vào `base11` kênh `omron1` (`kind: "fins"`, FINS/UDP, thiết bị `cj2` nút 20) và 8 Tag FINS (D, CIO, W, E0, T, C có `bcd`, STRING), rồi sửa. Chạy ở `packages/project-schema/src/vectors-11.test.ts` (TS) và `core/project-manager/tests/vectors_11_test.cpp` (C++): cùng tập mã lỗi, cảnh báo và `issues`.

| Nhóm | Ca | Mã |
|---|---|---|
| Hợp lệ | `valid-udp`, `valid-tcp-routed` (mạng nguồn/đích, hai thiết bị), `valid-all-areas` (H, A đọc và A448 ghi, EM bank C, T PV, `D00000.15`, BCD 32 bit, scaling), `valid-disabled`, `tcp-default-no-retry` | — |
| Địa chỉ | `addr-syntax-*` (bit 16, địa chỉ Modbus, bank EM sai), `addr-area-*` (BOOL trên word, cờ T ghi, A100 ghi, T kiểu DINT), `addr-range-*` (FLOAT32 ở D32767, W512) | `E_ADDR_SYNTAX`, `E_ADDR_AREA`, `E_ADDR_RANGE` |
| Giới hạn | `read-limit` (`maxReadWords` 4), `read-limit-string` (STRING 250 ký tự) | `E_ADDR_READ_LIMIT` |
| BCD | `bcd-float`, `bcd-int64`, `bcd-on-modbus` | `E_SCHEMA` |
| Schema | transport lạ, nút 255, mạng 128, `maxReadWords` 1000, khóa Modbus `unitId`, thiếu `host`, `bcd` không phải boolean | `E_SCHEMA` |
| Luật chung | `ref-device`, `dup-device-id`, `detect-slow` (500 ms mặc định × 2 lần với UDP) | `E_REF_DEVICE`, `E_DUP_ID`, `W_DETECT_SLOW` |
| Phiên bản | `version-channel-in-1.0`, `version-bcd-in-1.0` | `E_CHANNEL_VERSION` |

Địa chỉ FINS có vector riêng, dùng chung `@mat/tag-codec` và `drivers/fins`: `tests/fins-vectors/address.json`; khung FINS: `tests/fins-vectors/frames.json`.
