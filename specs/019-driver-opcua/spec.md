# Feature Specification: Driver OPC UA client (019)

**Feature Branch**: `019-driver-opcua`

**Created**: 2026-10-24

**Status**: Draft (quyết định tự chốt theo giao việc; người dùng đã giao toàn quyền quyết định, xem memory "User full authority")

**Input**: Giao việc 2026-10-24: driver OPC UA client trên open62541 (MPL-2.0, vendored, chỉ client, mã hóa bằng Mbed TLS có sẵn); endpoint `opc.tcp://`, security None và Basic256Sha256 Sign/SignAndEncrypt, xác thực Anonymous và Username/Password (mật khẩu không nằm trong project), chứng chỉ client tự sinh, tin chứng chỉ server kiểu TOFU có xác nhận; đọc bằng subscription theo nhóm quét, dự phòng đọc định kỳ; ghi qua write coordinator; NodeId `ns=2;s=Tag1`, `ns=3;i=1001`; schema 1.1; giả lập; Studio; đo RAM/CPU; ADR-047.

## Bối cảnh

Runtime có Modbus TCP/RTU (006, ADR-014); S7 (016) và FINS (018) đang ở nhánh riêng. Roadmap v2 §4.8 xếp OPC UA client vào đợt 3 với open62541 (MPL-2.0) và lưu ý "đo RAM kỹ". OPC UA là đường chuẩn để đọc PLC S7-1500 theo tên (symbolic), Omron NJ/NX, Beckhoff, Kepware, các gateway và SCADA khác.

Ràng buộc (Constitution 2.0.x): II (driver chỉ phát `TagUpdate`/`WriteResult`; luật TS và C++ cùng vector), III (500 Tag/1 s: RSS ≤ 150 MB, CPU ≤ 30 % trên BL335), V (mọi lệnh ghi qua write coordinator; bí mật không nằm trong project), VI (test trước), VII (định dạng có phiên bản, chỉ thêm trong dòng 1.1; thư viện bên thứ ba qua cổng giấy phép; driver mới có giả lập trong CI và số đo).

## Quyết định đã chốt

- **D1. Thư viện.** open62541 **1.4.21** (nhánh 1.4 còn được vá; phát hành 2026-10-04, đủ hai tuần theo ADR-009), MPL-2.0, vendored nguyên vẹn ở `third_party/open62541/` dưới dạng bản một tệp (`open62541.c/.h`) sinh bằng chính công cụ amalgamation của upstream (`amalgamate.sh`, tùy chọn tối giản: không method, history, discovery, PubSub, JSON/XML, nodeset loader; namespace 0 MINIMAL; một luồng). Bản một tệp vẫn chứa mã server (open62541 1.4 không có tùy chọn bỏ server): runtime link với `--gc-sections` nên chỉ giữ phần client; phần server dùng cho giả lập và test. MPL-2.0 là "conditional" ở cổng giấy phép: dùng được vì không sửa mã, bản phân phối nêu nơi lấy mã nguồn.
- **D2. Mã hóa bằng Mbed TLS 3.6.7 đã vendored.** Không thể có hai bản Mbed TLS trong cùng binary (trùng ký hiệu), nên cấu hình chung `mat_mbedtls_config.h` bật thêm các primitive Basic256Sha256 cần: RSA (PKCS#1 v1.5, OAEP), sinh số nguyên tố (khóa client), AES-CBC, SHA-1, đọc CRL. Bộ mã TLS của máy chủ HTTPS không đổi (danh sách cố định AEAD/ECDHE-ECDSA; `mbedtls_config_test` kiểm lúc chạy). Chỉ hỗ trợ policy **None** và **Basic256Sha256**; Aes128_Sha256_RsaOaep, Aes256_Sha256_RsaPss có sẵn trong thư viện nhưng chưa mở ra project (giữ phạm vi thử).
- **D3. Kênh `kind: "opcua"`** (định dạng 1.1, MINOR): `opcua.endpointUrl` (`opc.tcp://host[:port][/path]`, bắt buộc), `securityMode` `None|Sign|SignAndEncrypt` (mặc định None), `securityPolicy` `None|Basic256Sha256` (mặc định None), `serverCertSha256` (64 chữ số hex: chứng chỉ server đã xác nhận), `auth` `{mode: "anonymous"}` hoặc `{mode: "username", username, secretId}`, `readMode` `subscription|poll` (mặc định subscription), `sessionTimeoutMs`, `connectTimeoutMs`, `reconnectMaxS`; tối đa **một thiết bị trường** (server) với `timeoutMs` (thời hạn một yêu cầu), `writeDeadlineMs`. Kênh `opcua` trong project 1.0 là `E_DRIVER_VERSION` (mã chung với 016). Luật: mode và policy không khớp (None với Basic256Sha256, Sign/SignAndEncrypt với None) → `E_OPCUA_SECURITY`; `auth` username thiếu `username`/`secretId`, anonymous có `username`/`secretId` → `E_OPCUA_AUTH`; username trên kênh không mã hóa → `W_OPCUA_PLAIN_PASSWORD`; kênh có mã hóa mà chưa có `serverCertSha256` → `W_OPCUA_CERT_NOT_PINNED`.
- **D4. Địa chỉ Tag = NodeId** dạng chuỗi của OPC UA Part 6: `[ns=<0–65535>;](i=<0–4294967295>|s=<chuỗi>|g=<GUID>|b=<base64>)`. Không có `ns=` là namespace 0. `nsu=` (URI namespace) chưa hỗ trợ (`E_ADDR_SYNTAX`). Ký tự điều khiển, chuỗi rỗng, GUID/base64 sai → `E_ADDR_SYNTAX`; ns, i ngoài khoảng → `E_ADDR_RANGE`. `tag.schema.json` nới `source.address` tới 256 ký tự (bộ phân tích Modbus/S7 vẫn tự giới hạn). `byteOrder`/`stringByteOrder` trên Tag OPC UA là `E_SCHEMA`. Bộ phân tích TS (`@mat/tag-codec`) và C++ (`drivers/opcua/node_id`) chạy cùng vector `tests/opcua-vectors/nodeid.json`.
- **D5. Kiểu.** Boolean, SByte/Byte, (U)Int16/32/64, Float, Double, String, DateTime của server ánh xạ vào kiểu thô của Tag: số được đổi khi giá trị nằm trong khoảng của kiểu Tag (ngoài khoảng → BAD `OPCUA_TYPE_MISMATCH`); DateTime vào Tag INT64 (ms Unix UTC) hoặc STRING (ISO 8601 UTC); kiểu khác (mảng, cấu trúc, LocalizedText…) → BAD `OPCUA_TYPE_MISMATCH`. Ghi: mã hóa theo kiểu dữ liệu của node trên server (biết từ giá trị đã đọc, chưa có thì đọc trước một lần).
- **D6. Đọc.** Mỗi nhóm quét một subscription (publishing interval = chu kỳ nhóm), mỗi Tag một monitored item (sampling = chu kỳ nhóm, queue 1); tạo theo lô 200. Server từ chối subscription (BadTooManySubscriptions, BadServiceUnsupported…) → nhóm đó chuyển sang **đọc định kỳ** (Read theo lô 200 node mỗi chu kỳ) và chẩn đoán có cảnh báo `OPCUA_SUBSCRIPTION_FALLBACK`; `readMode: "poll"` ép đọc định kỳ. StatusCode → quality: Good → GOOD; Uncertain → UNCERTAIN `OPCUA_UNCERTAIN`; Bad: BadNodeIdUnknown/Invalid → `OPCUA_NODE_UNKNOWN`, BadUserAccessDenied/BadNotReadable → `OPCUA_ACCESS_DENIED`, BadTypeMismatch → `OPCUA_TYPE_MISMATCH`, còn lại → `OPCUA_BAD_STATUS`; tên StatusCode ghi ở chẩn đoán.
- **D7. Ghi** qua write coordinator như mọi driver: hàng đợi kênh, `writeDeadlineMs`, một Write cho một Tag, gửi một lần; Bad → `DEVICE_EXCEPTION` (tên StatusCode trong chẩn đoán); không trả lời trong `timeoutMs` → `WRITE_TIMEOUT` và đóng kết nối; `readback` (mặc định có) đọc lại → CONFIRMED / READBACK_MISMATCH, không readback → NO_READBACK.
- **D8. Kết nối lại.** Mỗi lần kết nối là một `UA_Client` mới (`noReconnect`, `noNewSession`: driver tự quản), backoff của SDK (`reconnectMaxS`), tạo lại subscription và monitored item. Mất kết nối, session hết hạn, subscription im quá hạn → mọi Tag BAD `DISCONNECTED`, kết nối lại; không khởi động lại runtime.
- **D9. Chứng chỉ client** tự sinh ở lần dùng mã hóa đầu tiên: RSA 2048, SHA-256, hạn 10 năm, ApplicationUri `urn:atpro:mat-scada:<hostname>` (SAN URI và DNS), lưu `<dataDir>/opcua/client-cert.der`, `client-key.der` (0600), dùng chung cho mọi kênh. Kỹ sư phải cho server tin chứng chỉ này (thao tác ở server; chẩn đoán hiện SHA-256 của nó).
- **D10. Tin chứng chỉ server: TOFU có xác nhận.** Runtime chỉ chấp nhận chứng chỉ server có SHA-256 (của DER) đúng `opcua.serverCertSha256`. Chưa ghim hoặc khác → không kết nối, mọi Tag BAD `OPCUA_CERT_UNTRUSTED`, chẩn đoán ghi SHA-256 đã thấy. Studio lấy chứng chỉ server qua thiết bị ("Lấy chứng chỉ"), hiện SHA-256, chủ thể, hạn; kỹ sư bấm **Tin chứng chỉ này** thì SHA-256 vào project (giống ghim fingerprint thiết bị của 005). Hạn chứng chỉ không chặn khi đã ghim (ghim là quyết định của người); hết hạn hiện cảnh báo trong chẩn đoán.
- **D11. Mật khẩu** không nằm trong project: `auth.secretId` trỏ vào tệp bí mật của thiết bị (`/etc/mat-runtime/secrets.json`, cơ chế của 003), đặt bằng `mat-runtime --set-secret <secretId>`. Thiếu bí mật → mọi Tag BAD `OPCUA_SECRET_MISSING`, thử lại theo backoff (đọc lại tệp mỗi lần). Server từ chối → `OPCUA_AUTH_FAILED`.
- **D12. Duyệt cây địa chỉ qua thiết bị.** Thêm `POST /api/v1/drivers/opcua/browse` (engineer, audit `driver.test`, ≤ 60 lần/phút): `action: "endpoints"` (kết nối thử, trả endpoint, chứng chỉ server, kết quả session) hoặc `"browse"` (con của một node, mặc định Objects `i=85`: NodeId, tên, lớp node, kiểu dữ liệu). Studio dùng nó cho hộp **Duyệt node** và **Lấy chứng chỉ** khi đang nối thiết bị. Duyệt **trực tiếp từ Studio (Tauri) tới server chưa làm**: cần một stack OPC UA thứ hai trong Rust (crate `opcua`, MPL-2.0, async, kích thước bộ cài) phải qua cổng giấy phép riêng; ghi vào việc còn mở. `POST /api/v1/drivers/test` với kênh opcua trả `NOT_SUPPORTED` (Thử kết nối nằm ở `action: "endpoints"`).
- **D13. Giả lập** `tools/opcua-sim` (C, chính open62541 server, binary `mat-opcua-sim` chỉ build x64, không vào gói thiết bị): namespace `urn:mat:opcua-sim` (ns=2), node mọi kiểu theo tên (`ns=2;s=…`) và số (`ns=2;i=1001…`), node chỉ đọc, node đếm, 500 node bench, policy None + Basic256Sha256, user `operator`. Không dùng node-opcua. Test đơn vị chạy server trong cùng tiến trình; rig tích hợp riêng `tests/driver-it-opcua` + `tools/driver-it-opcua.ps1` (compose `mat-dit-opcua`, mạng 172.30.19.0/24).
- **D14. Chưa thử server thật** (Siemens S7-1500, Kepware, Prosys…): mọi kết quả trên giả lập open62541. Báo cáo và tài liệu ghi rõ.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Đọc server OPC UA (Priority: P1)

Kỹ sư thêm kênh OPC UA (`opc.tcp://10.0.0.5:4840`, None, Anonymous), khai Tag `ns=2;s=Tank.Level` FLOAT64, nạp xuống: Tag GOOD, đổi theo server qua subscription.

1. **Given** giả lập có node mọi kiểu, **When** runtime chạy project read-all-types, **Then** 100 % Tag GOOD, đúng giá trị (Boolean, Int16…UInt64, Float, Double, String, DateTime vào INT64 và STRING).
2. **Given** node không tồn tại, **Then** chỉ Tag đó BAD `OPCUA_NODE_UNKNOWN`.
3. **Given** server không cho subscription, **Then** Tag vẫn GOOD bằng đọc định kỳ, chẩn đoán có `OPCUA_SUBSCRIPTION_FALLBACK`.

### User Story 2 - Ghi (Priority: P1)

1. **Given** Tag RW mọi kiểu, **When** ghi qua write coordinator, **Then** server có giá trị mới, CONFIRMED, audit có dòng.
2. **Given** node chỉ đọc, **When** ghi, **Then** `DEVICE_EXCEPTION`, chẩn đoán ghi `BadNotWritable`/`BadUserAccessDenied`.

### User Story 3 - Bảo mật (Priority: P1)

1. **Given** Basic256Sha256 SignAndEncrypt, username, mật khẩu đặt bằng `--set-secret`, chứng chỉ server đã ghim, **Then** kết nối, Tag GOOD.
2. **Given** chưa ghim hoặc ghim sai, **Then** không kết nối, `OPCUA_CERT_UNTRUSTED`, chẩn đoán có SHA-256 đã thấy; Studio hiện để xác nhận.
3. **Given** sai mật khẩu hoặc thiếu bí mật, **Then** `OPCUA_AUTH_FAILED` / `OPCUA_SECRET_MISSING`.

### User Story 4 - Mất kết nối (Priority: P1)

1. **Given** server dừng, **Then** Tag BAD `DISCONNECTED` trong ≤ 2 chu kỳ + timeout; server về thì kết nối lại có backoff, subscription tạo lại, Tag GOOD.

### User Story 5 - Studio (Priority: P1)

Editor Kết nối có "Thêm kênh OPC UA" (endpoint, security, xác thực, chứng chỉ server); Bảng Tag nhận NodeId và báo lỗi tại ô; hộp Duyệt node (qua thiết bị) chèn NodeId và kiểu; Chẩn đoán driver hiện kênh OPC UA (endpoint, policy, chế độ đọc, SHA-256 chứng chỉ).

### Edge Cases

- NodeId chuỗi chứa `;`, `=`, dấu cách, Unicode: phần sau `s=` là nguyên chuỗi.
- Giá trị Int64 vào Tag INT16 ngoài khoảng: BAD `OPCUA_TYPE_MISMATCH`, không cắt.
- Server đổi chứng chỉ: mất kết nối, `OPCUA_CERT_UNTRUSTED` tới khi kỹ sư ghim lại.
- 500 Tag trên một kênh: 1 subscription/nhóm, tạo theo lô 200.

## Requirements

- **FR-001** Driver `drivers/opcua` theo SDK (`drv::Driver`), một luồng mỗi kênh.
- **FR-002** Subscription theo nhóm quét, dự phòng và chế độ đọc định kỳ (D6).
- **FR-003** Ghi qua write coordinator, readback (D7).
- **FR-004** Security None, Basic256Sha256 Sign/SignAndEncrypt; Anonymous, Username (D2, D9–D11).
- **FR-005** Kết nối lại có backoff, tạo lại subscription (D8).
- **FR-006** Schema 1.1, luật TS + C++ cùng vector `tests/project-vectors/v11-opcua-*` (D3, D4).
- **FR-007** Mã lỗi đăng ký trong `schemas/error-codes.json`, sinh lại `docs/user/error-codes.md`.
- **FR-008** API duyệt (D12), Studio (US5), e2e.
- **FR-009** Đo 500 node x64 và armhf (qemu) so ngân sách; báo cáo `docs/reports/019-opcua-x64.md`.
- **FR-010** Tài liệu kỹ sư, ADR-047.

## Success Criteria

- **SC-001** ctest nhóm OPC UA xanh x64 và armhf (qemu); vector TS = C++.
- **SC-002** 500 node/1 s: RSS runtime tăng thêm ≤ 20 MB so với không có kênh OPC UA, tổng ≤ 150 MB; CPU trên BL335 ước tính ≤ 30 %.
- **SC-003** Rig tích hợp: đọc mọi kiểu, ghi, mất kết nối/kết nối lại, Basic256Sha256 + username, 500 node.
