# Vector project của feature 019 (driver OPC UA client)

Sinh bởi `tests/project-vectors/generate.mjs` (mã ca ở `v11-opcua.mjs`, hàm `opcuaCases`, gọi từ `v11.mjs`); tên `v11-opcua-*`, cùng bộ chạy với `v11-*` ([README-012.md](README-012.md)): `packages/project-schema/src/vectors-11.test.ts` (TS), `core/project-manager/tests/vectors_11_test.cpp` (C++). Hợp đồng: [contracts/opcua.md](../../specs/019-driver-opcua/contracts/opcua.md) §1.

## Schema (dòng 1.x, `schemas/connections.schema.json` ở thư mục gốc)

- Kênh `kind: "opcua"`: `opcua` bắt buộc (`endpointUrl` dạng `opc.tcp://host[:port][/path]`, `securityMode`, `securityPolicy` None/Basic256Sha256, `serverCertSha256` 64 chữ số hex thường, `auth`, `readMode`, `sessionTimeoutMs`, `connectTimeoutMs`, `reconnectMaxS`); `devices` tối đa 1 (`timeoutMs`, `writeDeadlineMs`). Khóa của Modbus (`tcp`, `unitId`, `retries`…) là `E_SCHEMA`.
- `tag.schema.json`: `source.address` tới 256 ký tự.

## Luật (TS `rules-opcua.ts` gọi từ `rules-02.ts`; C++ `rules_02.cpp`)

1. Mỗi kênh `opcua`, sau vòng thiết bị: project không phải 1.1 → `E_DRIVER_VERSION` `/channels/<i>/kind`; mode/policy hiệu lực không khớp → `E_OPCUA_SECURITY` `/channels/<i>/opcua/securityPolicy`; auth sai → `E_OPCUA_AUTH` `/channels/<i>/opcua/auth`; cảnh báo `W_OPCUA_PLAIN_PASSWORD` (`/channels/<i>/opcua/auth`), `W_OPCUA_CERT_NOT_PINNED` (`/channels/<i>/opcua`).
2. Tag ngoài trên thiết bị của kênh `opcua`, sau luật `stringLength` chung: `byteOrder`, `stringByteOrder` → `E_SCHEMA`; NodeId phân tích bằng `tests/opcua-vectors/nodeid.json`, lỗi → mã của bộ phân tích tại `.../source/address`.
3. `W_DETECT_SLOW` (một lần mỗi thiết bị, khi NodeId hợp lệ): `timeoutMs` (mặc định 2000, không retries) > chu kỳ nhóm quét của Tag, tại `/channels/<i>/devices/0`.
