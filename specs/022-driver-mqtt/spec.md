# Spec: Driver MQTT client (feature 022)

Trạng thái: duyệt tự chốt 2026-10-25 (người dùng giao toàn quyền). Lộ trình: `docs/plans/roadmap-v2.md` §4.8 (MQTT: TLS; Sparkplug B để sau). ADR: [050](../../docs/adr/050-driver-mqtt.md).

## Mục tiêu

Runtime nối tới một broker MQTT (3.1.1) để (1) nhận giá trị Tag từ topic và (2) đẩy giá trị ra topic khi ghi Tag hoặc theo nhóm định kỳ/khi đổi, để hệ thống khác (IIoT, cloud) lấy dữ liệu. Chạy trên BL335 (armhf, RAM nhỏ), không cần Internet.

## User story

- **US1 Subscribe (P1).** Kỹ sư thêm kênh MQTT (host, port, client id, keepalive, clean session, LWT, TLS, tài khoản), khai Tag với topic (có thể có wildcard `+`/`#`) và tùy chọn đường dẫn JSON `$.data.temp`. Khi có tin, Tag nhận giá trị, quality GOOD. Quá `staleAfterMs` không có tin: UNCERTAIN `MQTT_STALE`. Mất broker: BAD `DISCONNECTED`, tự kết nối lại với backoff (1 s → `reconnectMaxS`).
- **US2 Publish khi ghi (P1).** Tag `pub:` hoặc `both:` với quyền RW: ghi Tag (qua write coordinator, audit sẵn có) = PUBLISH lên topic (QoS 0/1, retain tùy chọn). Giới hạn `maxPublishPerS` (token bucket) cho mọi PUBLISH của kênh.
- **US3 Nhóm publish (P2).** `publishGroups`: một nhóm Tag (bất kỳ loại) đẩy ra một topic dạng JSON theo chu kỳ `intervalMs` và/hoặc khi đổi.
- **US4 Studio (P2).** "Thêm kênh MQTT", form kênh, cột địa chỉ Tag nhận topic/đường dẫn JSON, chẩn đoán kênh.

## Địa chỉ Tag (`source.address`, ≤ 256 ký tự)

`[sub:|pub:|both:]<topic>[|<jsonPath>][;qos=0|1][;retain]`

- Hướng mặc định `sub`. `pub`/`both`: topic không có wildcard, không bắt đầu bằng `$`. `retain` chỉ cho `pub`/`both`.
- Topic: 1–256 byte UTF-8, không có NUL, `|`, `;`; `+` chiếm trọn một cấp, `#` chỉ ở cấp cuối.
- `jsonPath`: `$` rồi `.tên` (`[A-Za-z0-9_-]+`) hoặc `[n]` (0–9999), tối đa 16 bước.
- Lỗi: `E_ADDR_SYNTAX`; `qos` khác 0/1: `E_ADDR_RANGE`. Vector chung TS/C++: `tests/mqtt-vectors/address.json`.

## Giá trị

- Thô: chuỗi UTF-8 bỏ khoảng trắng hai đầu. BOOL: `1/0/true/false/on/off` (không phân biệt hoa thường); số nguyên: thập phân (nhận cả `12.0`), ngoài miền → BAD `MQTT_PAYLOAD`; số thực; STRING: nguyên chuỗi, cắt theo `stringLength` ở biên UTF-8.
- JSON: lấy nút theo đường dẫn; số/bool/chuỗi đổi như trên; thiếu nút, `null`, mảng, đối tượng, JSON hỏng → BAD `MQTT_PAYLOAD`. Tin > 64 KiB bị bỏ (đếm ở chẩn đoán).
- Publish: thô → số thập phân (`1`/`0` cho BOOL), có đường dẫn JSON → đối tượng dựng theo đường dẫn (`{"data":{"temp":21.5}}`). Nhóm: `{"ts":<ms>,"values":{"<tagId>":<v>|null},"quality":{"<tagId>":"GOOD|UNCERTAIN|BAD"}}`.

## Yêu cầu

- FR-001 Client MQTT 3.1.1 tự viết (CONNECT/CONNACK, SUBSCRIBE/SUBACK, PUBLISH QoS 0/1, PUBACK, PINGREQ/PINGRESP, DISCONNECT); gói vào tối đa 256 KiB; độ dài thừa bị coi là lỗi giao thức.
- FR-002 TLS 1.2/1.3 bằng Mbed TLS có sẵn: ghim `serverCertSha256` (SHA-256 của DER chứng chỉ lá) hoặc CA PEM (`caCertPem`); không có cả hai → không kết nối (`MQTT_CERT_UNTRUSTED`) và cảnh báo `W_MQTT_TLS_NOT_PINNED` khi kiểm project.
- FR-003 Mật khẩu: `auth.secretId` đọc từ tệp bí mật thiết bị (`mat-runtime --set-secret <id>`), không nằm trong project. Thiếu → `MQTT_SECRET_MISSING`. Tài khoản trên kết nối không TLS: cảnh báo `W_MQTT_PLAIN_PASSWORD`.
- FR-004 CONNACK từ chối: 4/5 → `MQTT_AUTH_FAILED`, khác → `MQTT_CONNECT_REFUSED`; SUBACK 0x80 → Tag của filter đó BAD `MQTT_SUBSCRIBE_REFUSED`.
- FR-005 Ghi khi mất kết nối: `NOT_SENT_DISCONNECTED`; quá `writeDeadlineMs` trong hàng đợi (kể cả do giới hạn tốc độ): `NOT_SENT_DEADLINE`; QoS 1 không có PUBACK trong `timeoutMs`: `WRITE_TIMEOUT`; gửi xong: `NO_READBACK`. Tag `pub:` nhận chính giá trị đã ghi (GOOD) sau khi gửi.
- FR-006 Luật project (TS và C++ cùng vector `tests/project-vectors/v11-mqtt-*`): kênh `mqtt` chỉ ở định dạng 1.1 (`E_DRIVER_VERSION`); hướng không khớp quyền (`sub` + RW, `pub` + R) → `E_MQTT_DIRECTION`; Tag trong `publishGroups` không tồn tại → `E_MQTT_GROUP_TAG`; trường TLS khi `tls.enabled` false → `E_MQTT_TLS`; `byteOrder`/`stringByteOrder` → `E_SCHEMA`.

## Tiêu chí thành công

- SC-001 driver-it MQTT xanh: subscribe số/JSON/wildcard, publish, nhóm, broker tắt rồi bật (Tag BAD rồi GOOD lại ≤ `reconnectMaxS` + 2 s), staleness, TLS ghim đúng/sai.
- SC-002 x64, 500 Tag, 50 tin/s: RAM tăng ≤ 4 MiB so với project không có kênh MQTT, CPU luồng kênh ≤ 2 %.
- SC-003 Test armhf qemu của MQTT xanh.

## Giả định

- Một broker mỗi kênh (thiết bị 0 của kênh là "broker", giữ `timeoutMs`, `writeDeadlineMs`, `staleAfterMs`); dự phòng nhiều broker để sau.
- Wildcard nằm ở topic của từng Tag (một filter có thể cấp cho nhiều Tag); không có "topic gốc" của kênh.
- Không QoS 2, không MQTT 5, không Sparkplug B (để sau); không lưu phiên khi `cleanSession` false ngoài những gì broker giữ.
- Topic của Tag không chứa `|` và `;` (hiếm trong thực tế; ghi vào hướng dẫn).
