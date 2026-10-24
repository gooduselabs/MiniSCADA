# Vector project của feature 017 (driver Mitsubishi MC: kênh `kind: "mc"`)

Sinh bởi `tests/project-vectors/generate.mjs` (mã ca ở `v11-mc.mjs`, hàm `mcCases`, gọi từ `cases11`); tên `v11-mc-*`, cùng cấu trúc và bộ chạy với `v11-*` ([README-012.md](README-012.md)): `packages/project-schema/src/vectors-11.test.ts` (TS), `core/project-manager/tests/vectors_11_test.cpp` (C++). Hợp đồng: [plan 017](../../specs/017-driver-mc/plan.md) mục "Hợp đồng định dạng"; địa chỉ: `tests/mc-vectors/address.json`.

## Nền

`base11()` cộng kênh `plc-mc` (chỉ số kênh 2) với hai thiết bị: `fx5u` (`xyNotation: octal`, `timeoutMs` 200) và `q03` (định tuyến mặc định viết rõ), và 22 Tag `MC.*` (chỉ số Tag 26 trở đi) phủ mọi thiết bị và kiểu của FR-003, FR-004 (`MC.FX_D0` nhóm `fast`, `byteOrder` ABCD, RW có `limits`).

## Luật bộ C++ phải cài giống hệt (rules-mc.ts, gọi từ rules-02.ts)

1. Mỗi kênh `kind: "mc"` của project không phải 1.1.x: `E_CHANNEL_VERSION` `connections.json` `/channels/<ci>/kind` (sau luật trùng id thiết bị của kênh đó).
2. Tag ngoài có thiết bị thuộc kênh `mc`: sau hai luật `stringLength` chung, thay toàn bộ phần địa chỉ Modbus bằng: địa chỉ MC (`xyNotation` của thiết bị) lỗi → mã `E_ADDR_*` `/tags/<i>/source/address`, dừng; số word > `maxBatchWords` (mặc định 960): `E_ADDR_READ_LIMIT` `/tags/<i>/source`; bit trong word và `access: RW`: `write.registerBit` vắng hoặc `none` → `E_BIT_WRITE` `/tags/<i>/source/address`, `rmw` → `W_BIT_RMW` `connections.json` `/channels/<ci>/devices/<di>` một lần mỗi thiết bị; `W_DETECT_SLOW` như Modbus với `retries` mặc định 0 (tập thiết bị đã báo dùng chung với Modbus). Không ước tính thời gian quét RTU.
3. Tag của thiết bị Modbus vẫn theo luật Modbus (`D100` trên thiết bị Modbus là `E_ADDR_SYNTAX`).
