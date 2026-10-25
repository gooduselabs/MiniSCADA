# Tasks: Driver MQTT client

Ký hiệu: [P] làm song song được; test viết trước phần cài đặt.

## Phase 1: Đặc tả và vector

- [x] T001 spec.md, plan.md (đánh giá libmosquitto/Paho/tự viết), tasks.md
- [x] T002 Vector địa chỉ và khớp topic `tests/mqtt-vectors/address.json` (mọi hướng, wildcard, đường dẫn JSON, QoS, retain, mọi mã lỗi)

## Phase 2: Codec C++ và TS (test trước)

- [x] T010 [P] gtest `mqtt_address_test` → `drivers/mqtt/address.cpp` (`mat_mqtt_codec`, validator dùng)
- [x] T011 [P] vitest `mqtt-address.test.ts` → `packages/tag-codec/src/mqtt-address.ts`
- [x] T012 [P] gtest `mqtt_packet_test` (bố cục chuẩn, khứ hồi, Framer cắt/ghép, lỗi độ dài, fuzz `MAT_FUZZ_SECONDS`) → `packet.cpp`
- [x] T013 [P] gtest `mqtt_payload_test` (số/chuỗi/BOOL thô, JSON theo đường dẫn, miền kiểu, mã hóa, nhóm) → `payload.cpp`

## Phase 3: Driver (US1, US2, US3)

- [x] T020 Broker giả lập `tools/mqtt-sim` (QoS 0/1, retain, will, ACL tiền tố, TLS tự ký, không PUBACK, đá client; cổng điều khiển)
- [x] T021 gtest `mqtt_driver_test`: subscribe thô/JSON/wildcard/retained, ghi QoS 0/1 và hết hạn PUBACK, giới hạn tốc độ và hạn chót, nhóm theo chu kỳ và khi đổi, mất broker rồi kết nối lại, staleness, bí mật thiếu/sai, di chúc, SUBACK từ chối, TLS ghim đúng/sai, CA, không ghim
- [x] T022 `link.cpp` (TCP/TLS trên `mat_mbedtls`; bật `MBEDTLS_SSL_CLI_C`, SNI, ECDHE-RSA), `mqtt_driver.cpp`

## Phase 4: Định dạng 1.1 và hai bộ kiểm

- [x] T030 Schema `mqttChannel`, `mqttDevice`; README schemas
- [x] T031 Vector `tests/project-vectors/v11-mqtt.mjs` + sinh 30 thư mục, README-022.md
- [x] T032 TS `rules-mqtt.ts`, mã trong `codes.ts`, móc rules-02
- [x] T033 C++ `rules_mqtt.cpp`, móc rules_02; `vectors_11_test` qua

## Phase 5: Runtime

- [x] T040 `tag_model` (kênh/thiết bị/địa chỉ MQTT), `mqtt_factory` + gtest; `RuntimeEngine` adopt + snapshot TagStore cho nhóm; bí mật trong `main.cpp`
- [x] T041 `POST /api/v1/drivers/test` kênh `mqtt` → `NOT_SUPPORTED`
- [x] T042 Mã lỗi `MQTT_*`, `E_MQTT_*`, `W_MQTT_*`; sinh lại `docs/user/error-codes.md`

## Phase 6: Studio (US4)

- [x] T050 Mô hình kênh/broker MQTT, cảnh báo tại ô, nút Thêm kênh MQTT, ghi chú nhóm/CA, ghi chú Chẩn đoán thay Thử kết nối
- [x] T051 Bảng Tag: topic/đường dẫn JSON, gợi ý hướng/topic/trường/QoS, lỗi tiếng Việt; chẩn đoán `dd.mqtt.*`; câu lỗi bộ kiểm
- [x] T052 vitest `connections-mqtt.test.ts`; e2e `connections-mqtt.e2e.mjs`

## Phase 7: Tích hợp, đo, tài liệu

- [x] T060 `tests/driver-it-mqtt` (compose 172.30.22.0/24, project sinh lúc chạy, kịch bản read/write/reconnect/stale/load), `tools/driver-it-mqtt.ps1`
- [x] T061 Đo x64 500 Tag (driver-it load, 50 tin/s, 10 client): CPU 0,9 % một lõi, RSS tối đa 17 MB → `docs/reports/022-mqtt-load-x64.json`; phần RAM tăng so với project không có kênh MQTT (SC-002) chưa đo riêng
- [x] T062 Test MQTT trên armhf qemu
- [x] T063 engineer-guide §4.7, ADR-050 + README ADR
- [ ] T064 BL335: RAM/CPU 500 Tag, broker thật (Mosquitto/EMQX) với TLS — chờ thiết bị và người dùng
