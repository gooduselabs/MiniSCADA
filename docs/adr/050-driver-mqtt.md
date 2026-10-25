# ADR-050: Driver MQTT client tự viết (MQTT 3.1.1, QoS 0/1, TLS qua Mbed TLS dùng chung)

- **Trạng thái:** Proposed (2026-10-25). Có mã, gtest x64 (vector địa chỉ chung TS/C++, gói, payload, driver trên broker giả trong tiến trình, fuzz bộ giải mã), vector project chung TS/C++, driver-it x64 qua `mat-mqtt-sim`, e2e Studio. **Chưa thử broker thật (Mosquitto, EMQX, HiveMQ, AWS IoT); chưa đo trên BL335** (Constitution VII).
- **Ngày:** 2026-10-25
- **Liên quan:** [ADR-014](014-driver-sdk-modbus.md) (SDK driver), [ADR-017](017-tag-engine-v1.md) (Tag Engine), [ADR-047](047-driver-opcua.md) (bí mật trên thiết bị, ghim SHA-256), [lộ trình v2 §4.8](../plans/roadmap-v2.md), [spec 022](../../specs/022-driver-mqtt/spec.md), [plan](../../specs/022-driver-mqtt/plan.md).

## Bối cảnh

Lộ trình v2 §4.8: "MQTT (Paho C hoặc libmosquitto, TLS); Sparkplug B để sau". Khách hàng cần (1) đọc cảm biến IoT, gateway, hệ thống khác đẩy lên broker và (2) đưa dữ liệu của BL335 lên broker cho cloud/MES. Runtime đã có khuôn driver (một luồng mỗi kênh, `Backoff`, `DiagCounters`, `drv::Driver`, write coordinator có audit) và Mbed TLS 3.6 dùng chung.

## Quyết định

1. **Tự viết client MQTT 3.1.1** (`drivers/mqtt`, khoảng 1 KLOC: gói, payload, liên kết, driver). libmosquitto (EPL-2.0/EDL-1.0) và Paho C (EPL-2.0) qua được cổng giấy phép nhưng cả hai gắn OpenSSL (BL335 không có, phải vá sang Mbed TLS), lớn hơn nhiều so với phần cần (10 loại gói, QoS 0/1) và có luồng/callback riêng khác khuôn driver. Không thêm mục vào `third_party/LICENSES.md`.
2. **TLS bằng `mat_mbedtls`**: bật `MBEDTLS_SSL_CLI_C`, SNI, ECDHE-RSA cho TLS 1.2 (broker dùng chứng chỉ RSA); P-384 bật chung với feature 023 (ADR-051) nên broker có chứng chỉ/CA ECDSA P-384 dùng được, còn server HTTPS vẫn chỉ nhận X25519 + P-256 (bản vá mAT trong `third_party/civetweb/mod_mbedtls.inl`) và giữ khóa ECDSA nên không bao giờ chọn bộ mã RSA. Tin broker bằng **ghim SHA-256 chứng chỉ lá** (như OPC UA) hoặc **CA PEM** trong project (kiểm tên theo `serverName`/host). Không có cả hai thì không kết nối (`MQTT_CERT_UNTRUSTED`), bộ kiểm báo `W_MQTT_TLS_NOT_PINNED`. Không dùng kho CA hệ thống (thiết bị offline, Constitution).
3. **Mật khẩu trên thiết bị** (`auth.secretId`, `mat-runtime --set-secret`), đọc lại mỗi lần kết nối; project chỉ có tên đăng nhập. Không TLS mà có tài khoản: `W_MQTT_PLAIN_PASSWORD`.
4. **Một kênh = một broker** (thiết bị 0, `maxItems: 1`), một luồng 256 KiB. Mất kết nối, broker im quá 1,5 keepalive, gói hỏng hoặc > 256 KiB: mọi Tag BAD `DISCONNECTED`/mã nguyên nhân, kết nối lại theo `Backoff` (1 s → `reconnectMaxS`). Tin > 64 KiB bị bỏ và đếm.
5. **Địa chỉ Tag một chuỗi** (trường `source.address` sẵn có, không thêm khóa schema của Tag): `[sub:|pub:|both:]topic[|$.đường.dẫn][;qos=0|1][;retain]`. Wildcard `+`/`#` ở topic của Tag `sub`; một filter dùng chung cho nhiều Tag (subscribe một lần với QoS lớn nhất). Đường dẫn JSON tập con (`.tên`, `[n]`, ≤ 16 bước), không phải JSONPath đầy đủ. Hai bộ phân tích TS/C++ trên `tests/mqtt-vectors/address.json`.
6. **Quality**: có tin và giải mã được → GOOD; giải mã không được → BAD `MQTT_PAYLOAD`; SUBACK 0x80 → BAD `MQTT_SUBSCRIBE_REFUSED`; quá `staleAfterMs` (thiết bị) không có tin → UNCERTAIN `MQTT_STALE` với giá trị cuối.
7. **Ghi = PUBLISH** qua write coordinator (giới hạn, vai trò, audit như mọi driver), một lệnh mỗi lượt; QoS 1 chờ PUBACK trong `timeoutMs` (`WRITE_TIMEOUT`), QoS 0 xong khi gửi; kết quả `NO_READBACK`. Tag `pub` hiện chính giá trị đã ghi; Tag `both` nhận lại tin từ broker. **Token bucket `maxPublishPerS`** (mặc định 20/s) cho mọi PUBLISH của kênh; lệnh chờ quá `writeDeadlineMs` → `NOT_SENT_DEADLINE`.
8. **Nhóm publish** (`publishGroups`): giá trị và quality của một danh sách Tag bất kỳ thành một tin JSON `{"ts","values","quality"}` theo `intervalMs` và/hoặc khi đổi (so mỗi 250 ms). Driver đọc giá trị qua hàm `snapshot` mà engine đưa vào (TagStore), không biết TagStore (ranh giới ADR-014 giữ nguyên: driver chỉ đọc qua hàm được cấp).
9. **Định dạng 1.1, chỉ thêm**: kênh `kind: "mqtt"`, thiết bị `staleAfterMs`. Luật `E_DRIVER_VERSION`, `E_MQTT_TLS`, `E_MQTT_DIRECTION`, `E_MQTT_GROUP_TAG`, `W_MQTT_*`, vector `v11-mqtt-*` cho cả hai bộ kiểm.
10. **Broker giả lập tự viết** (`tools/mqtt-sim`, C++ trên cùng codec): dùng cho gtest trong tiến trình và rig driver-it (172.30.22.0/24, cổng điều khiển theo dòng lệnh). Không dùng image Mosquitto (khỏi rà giấy phép dev-only, khỏi tải Internet khi chạy CI).

## Hệ quả

- Thử kết nối (`POST /api/v1/drivers/test`) trả `NOT_SUPPORTED` cho kênh MQTT; Chẩn đoán driver hiện broker, TLS, client id, số subscription, số tin vào/ra/bỏ, SHA-256 chứng chỉ broker.
- Studio: Thêm kênh MQTT, form kênh/broker, Bảng Tag nhận topic và đường dẫn JSON. Nhóm publish và CA PEM (nhiều dòng) sửa trong `connections.json`.
- Số đo x64 (2026-10-25, `tools/driver-it-mqtt.ps1 -Scenario load`): 500 Tag (nửa số thô, nửa JSON), 50 tin/s, 10 client xem: CPU runtime 0,9 % một lõi, RSS tối đa 17 MB ([022-mqtt-load-x64.json](../reports/022-mqtt-load-x64.json)). Kịch bản read/write/reconnect/stale đạt (kết nối lại 1,4–1,7 s).
- Chưa có: QoS 2, MQTT 5, Sparkplug B, nhiều broker dự phòng, lưu phiên (`cleanSession` false chỉ nhờ broker), đệm tin khi mất kết nối (store-and-forward), topic gốc của kênh, WebSocket.

## Phương án đã loại

- **libmosquitto / Paho C:** xem quyết định 1.
- **Kho CA của hệ điều hành:** BL335 chạy offline, kho CA cũ dần; ghim hoặc CA riêng của nhà máy rõ ràng hơn.
- **Khóa riêng cho topic, đường dẫn, hướng trong `source`:** rõ hơn khi đọc tệp nhưng phải đổi schema Tag, Bảng Tag và mọi công cụ nhập/xuất; một chuỗi địa chỉ giữ khuôn của các driver khác và Bảng Tag sẵn có.
