# Vector project của feature 022 (driver MQTT client)

Sinh bởi `tests/project-vectors/generate.mjs` (mã ca ở `v11-mqtt.mjs`, hàm `mqttCases`, gọi từ `v11.mjs`); tên `v11-mqtt-*`, cùng bộ chạy với `v11-*` ([README-012.md](README-012.md)): `packages/project-schema/src/vectors-11.test.ts` (TS), `core/project-manager/tests/vectors_11_test.cpp` (C++). Spec: [022-driver-mqtt](../../specs/022-driver-mqtt/spec.md).

## Schema (dòng 1.x, `schemas/connections.schema.json` ở thư mục gốc)

- Kênh `kind: "mqtt"`: `mqtt` bắt buộc (`host` bắt buộc; `port`, `clientId` `[A-Za-z0-9_.-]{1,64}`, `keepAliveS`, `cleanSession`, `tls`, `auth` cần cả `username` và `secretId`, `will` QoS 0/1, `maxPublishPerS`, `publishGroups` topic không có `+`/`#` và cần `intervalMs` hoặc `onChange: true`, `connectTimeoutMs`, `reconnectMaxS`); `devices` tối đa 1 (`timeoutMs`, `writeDeadlineMs`, `staleAfterMs`). Khóa của Modbus (`tcp`, `retries`…) là `E_SCHEMA`.

## Luật (TS `rules-mqtt.ts` gọi từ `rules-02.ts`; C++ `rules_mqtt.cpp` gọi từ `rules_02.cpp`)

1. Mỗi kênh `mqtt`, sau vòng thiết bị: project không phải 1.1 → `E_DRIVER_VERSION` `/channels/<i>/kind`; `tls.enabled` false mà có `serverCertSha256`/`caCertPem`/`serverName` → `E_MQTT_TLS` `/channels/<i>/mqtt/tls`; TLS không ghim và không CA → `W_MQTT_TLS_NOT_PINNED` (cùng đường dẫn); `auth` không TLS → `W_MQTT_PLAIN_PASSWORD` `/channels/<i>/mqtt/auth`.
2. Sau vòng Tag: mỗi id trong `publishGroups[g].tags[k]` phải là Tag của project (mọi loại, mọi kênh) → `E_MQTT_GROUP_TAG` `/channels/<i>/mqtt/publishGroups/<g>/tags/<k>`.
3. Tag ngoài trên thiết bị của kênh `mqtt`, sau luật `stringLength` chung: `byteOrder`, `stringByteOrder` → `E_SCHEMA`; địa chỉ phân tích bằng `tests/mqtt-vectors/address.json`, lỗi → mã của bộ phân tích tại `.../source/address`; `sub` (mặc định) mà RW, hoặc `pub` mà không RW → `E_MQTT_DIRECTION` tại `.../source/address`. Không có `W_DETECT_SLOW` (không có chu kỳ đọc).
