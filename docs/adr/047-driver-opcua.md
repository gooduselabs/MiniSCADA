# ADR-047: Driver OPC UA client trên open62541 (vendored), mã hóa bằng Mbed TLS dùng chung

- **Trạng thái**: Proposed (feature 019, 2026-10-24; test x64, armhf qemu và server giả lập open62541; chưa thử server thật, chưa đo trên BL335)
- **Bối cảnh**: [spec 019](../../specs/019-driver-opcua/spec.md), [hợp đồng](../../specs/019-driver-opcua/contracts/opcua.md), roadmap-v2 §4.8 (OPC UA client: open62541, đo RAM kỹ), ADR-014 (SDK driver), ADR-010 (Mbed TLS), Constitution 2.0.x (III, V, VII).

## Bối cảnh

OPC UA là đường chuẩn tới PLC đời mới (S7-1500 theo tên, Omron NJ/NX, Beckhoff), Kepware và các SCADA khác. Giao thức lớn (mã hóa nhị phân, kênh bảo mật, session, subscription): tự viết như Modbus/S7 không hợp lý. Roadmap chọn open62541 (MPL-2.0). Thiết bị có 512 MB RAM, ngân sách RSS 150 MB, CPU 30 %.

## Quyết định

1. **open62541 1.4.21** vendored nguyên vẹn ở `third_party/open62541` dạng bản một tệp do chính công cụ amalgamation của upstream sinh (`amalgamate.sh`), tùy chọn tối giản (không method, history, discovery, PubSub, JSON/XML, nodeset loader; namespace 0 MINIMAL; một luồng). MPL-2.0 qua cổng giấy phép theo nhánh "conditional": không sửa mã, ghi nơi lấy mã nguồn. Bản 1.4 không bỏ được phần server: runtime link `--gc-sections`, phần server chỉ dùng cho giả lập và test.
2. **Một Mbed TLS cho cả runtime**: hai bản Mbed TLS trong một binary sẽ trùng ký hiệu, nên `mat_mbedtls_config.h` bật thêm RSA (PKCS#1 v1.5, OAEP, sinh khóa), AES-CBC, SHA-1, đọc CRL và self test cho Basic256Sha256. Bộ mã TLS của máy chủ HTTPS giữ nguyên danh sách AEAD/ECDHE-ECDSA (`mbedtls_config_test` kiểm lúc chạy). Chỉ mở policy None và Basic256Sha256.
3. **Driver theo SDK** (ADR-014): một luồng, một server, một `UA_Client` mới mỗi lần kết nối (driver tự backoff, không dùng tự kết nối lại của thư viện sau khi session đã có); kết nối bất đồng bộ để `stop()` không bị giữ. Đọc bằng một subscription mỗi nhóm quét (monitored item mỗi Tag, tạo theo lô 200); server từ chối subscription thì nhóm đó đọc định kỳ bằng Read; `readMode: poll` ép đọc định kỳ. Ghi qua write coordinator: một Write theo kiểu dữ liệu của node, rồi Read đọc lại.
4. **Tin cậy**: chứng chỉ client tự sinh (RSA 2048, 10 năm) ở `<dataDir>/opcua`; chứng chỉ server chỉ được nhận khi SHA-256 trùng `serverCertSha256` trong project (TOFU có xác nhận: Studio lấy chứng chỉ qua thiết bị, kỹ sư bấm "Tin chứng chỉ này"). Không dùng trust list/CA (máy công nghiệp thường dùng chứng chỉ tự ký).
5. **Bí mật**: mật khẩu ở `secrets.json` của thiết bị (cơ chế 003), project chỉ có `secretId`.
6. **Duyệt node qua thiết bị** (`POST /api/v1/drivers/opcua/browse`, engineer, audit, 60 lần/phút), không qua Studio trực tiếp: tránh một stack OPC UA thứ hai trong Rust (crate `opcua`, MPL-2.0, async) cần cổng giấy phép và tăng bộ cài; đổi lại cần thiết bị online và cùng mạng với server.
7. **Giả lập** là chính server open62541 (`tools/opcua-sim`, `mat-opcua-sim`, chỉ x64), không node-opcua: một stack cho cả hai đầu, test trong tiến trình không cần Docker.

## Hệ quả

- Binary runtime lớn thêm (mã client open62541 + RSA); RSS đo ở `docs/reports/019-opcua-x64.md`. Bắt tay RSA 2048 trên Cortex-A7 tốn CPU một lần mỗi kết nối.
- Cấu hình Mbed TLS rộng hơn: thêm bề mặt mã (RSA, CBC) dù TLS không dùng; nâng Mbed TLS phải chạy lại cả test OPC UA.
- Chưa có: policy Aes128/Aes256-RsaOaep/RsaPss, xác thực bằng chứng chỉ người dùng, `nsu=`, mảng và kiểu cấu trúc, sự kiện/alarm OPC UA, duyệt trực tiếp từ Studio.
- Chưa thử với Siemens S7-1500, Kepware, Prosys, Unified Automation: khác biệt (giới hạn MaxNodesPerRead, keep-alive, URL endpoint khác tên máy) mới thấy khi thử thật.
- Chỗ dùng chung giống nhánh 016: `RuntimeEngine::driversByChannel()` (`drv::Driver*`), `ChannelDiag.details`, `E_DRIVER_VERSION`; khi gộp hai nhánh giữ một bản.
