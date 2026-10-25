# Plan: Driver MQTT client (022)

## Chọn thư viện (cổng giấy phép, Constitution)

| Phương án | Giấy phép | Kích thước | Ghi chú |
|---|---|---|---|
| libmosquitto | EPL-2.0 / EDL-1.0 | ~60 KLOC kèm broker, cần OpenSSL hoặc vá sang Mbed TLS | luồng riêng, callback; TLS gắn OpenSSL |
| Paho MQTT C | EPL-2.0 | ~25 KLOC, TLS qua OpenSSL | cùng vấn đề OpenSSL; EPL-2.0 copyleft yếu theo tệp |
| **Tự viết 3.1.1 tối giản** | của dự án | ~1 KLOC codec + driver | chỉ phần cần (QoS 0/1), TLS qua `mat_mbedtls` sẵn có, không thêm bên thứ ba |

**Chốt: tự viết.** Phạm vi giao thức nhỏ (10 loại gói), mã kiểm soát được (fuzz bộ giải mã), không kéo OpenSSL (BL335 không có), không thêm mục vào `third_party/LICENSES.md`. Broker giả lập cũng tự viết (`tools/mqtt-sim`, C++), nên không có phụ thuộc dev-only mới.

## Cấu trúc

- `drivers/mqtt/address.{hpp,cpp}` — phân tích địa chỉ, khớp topic với filter (`mat_mqtt_codec`, validator dùng).
- `drivers/mqtt/packet.{hpp,cpp}` — mã hóa/giải mã gói, bộ ghép luồng byte.
- `drivers/mqtt/payload.{hpp,cpp}` — payload ↔ giá trị theo `rawType`, đường dẫn JSON.
- `drivers/mqtt/link.{hpp,cpp}` — TCP hoặc TLS (Mbed TLS client, ghim SHA-256 hoặc CA).
- `drivers/mqtt/mqtt_driver.{hpp,cpp}` — một luồng mỗi kênh: kết nối, subscribe, nhận, ghi, nhóm, staleness, keepalive, backoff.
- `core/tag-engine/mqtt_factory.*`, `tag_model` (kênh/thiết bị), `server/runtime_engine` (`adopt`, `snapshot` cho nhóm), `server/main.cpp` (bí mật).
- Luật: `packages/project-schema/src/rules-mqtt.ts`, `core/project-manager/rules_mqtt.*`; schema `mqttChannel`/`mqttDevice`.
- Studio: `model/connections-mqtt.ts`, editor kênh, cột địa chỉ, i18n `vi-mqtt.ts`, e2e.
- Thử: gtest codec/payload/address/driver (broker giả trong tiến trình), vitest địa chỉ, vector project, `tools/mqtt-sim` + `tests/driver-it-mqtt` (mạng 172.30.22.0/24), `tools/driver-it-mqtt.ps1`.

## Ngân sách BL335

Một luồng (ngăn xếp 256 KiB), bộ đệm nhận tăng theo gói lớn nhất (≤ 256 KiB, thường < 1 KiB), bảng filter → Tag; TLS thêm ~40 KiB heap mỗi phiên. Bật `MBEDTLS_SSL_CLI_C` (thêm ~30 KiB mã).
