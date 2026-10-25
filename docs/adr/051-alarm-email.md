# ADR-051: Gửi cảnh báo alarm qua email (SMTP tự viết trên Mbed TLS, cấu hình trên thiết bị)

- **Trạng thái:** Proposed (2026-10-25). Có mã và test: gtest (máy chủ SMTP giả C++ có STARTTLS/SMTPS), tích hợp x64 trong Docker (`tools/email-it.ps1`), e2e trang Quản trị (axe), armhf qemu. Chưa thử với Gmail/Office 365 thật, chưa chạy trên BL335.
- **Ngày:** 2026-10-25
- **Liên quan:** spec [023](../../specs/023-alarm-email/spec.md), [threat-model I-17, RR-17](../architecture/threat-model.md), alarm (ADR-027 đến ADR-030), phân quyền và trang Quản trị (ADR-042), Mbed TLS (feature 005, research R4), bí mật thiết bị (feature 003).

## Bối cảnh

Người dùng (2026-10-25) cần cảnh báo alarm ra ngoài màn hình, **chỉ qua email**. Thiết bị BL335 (armhf, 512 MB) chạy runtime C++17; đã có Mbed TLS 3.6.7 vendored (chỉ phía server), file bí mật thiết bị (`--set-secret`), audit, kho tài khoản và nhóm (013), API quản trị theo khuôn HTTPS + CSRF + `rev`.

## Quyết định

1. **SMTP client tự viết** (`core/notify/smtp_client`, ~500 dòng): RFC 5321 tối thiểu (EHLO, STARTTLS RFC 3207, AUTH PLAIN/LOGIN RFC 4954, MAIL/RCPT/DATA, dot-stuffing), implicit TLS (465) và STARTTLS (587) trên Mbed TLS; hạn mỗi bước bằng `poll`; chặn "STARTTLS injection" (dữ liệu thừa sau 220 → hủy). Không dùng libcurl/libesmtp: thêm phụ thuộc lớn (curl kéo theo cả HTTP/FTP…), cổng giấy phép và ngân sách RAM; phần SMTP cần dùng rất nhỏ.
2. **Bật phía client của Mbed TLS** (`MBEDTLS_SSL_CLI_C`, SNI, `KEY_EXCHANGE_ECDHE_RSA`, bộ ECDHE-RSA AEAD, đường cong P-384): Gmail/Office 365 dùng chứng chỉ RSA và chuỗi CA có gốc ECDSA P-384. Trao đổi khóa RSA tĩnh, CBC trong TLS vẫn tắt; máy chủ HTTPS của thiết bị chỉ có chứng chỉ ECDSA nên không bao giờ chọn bộ ECDHE-RSA, và vẫn chỉ nhận nhóm X25519, P-256 (mAT patch trong `third_party/civetweb/mod_mbedtls.inl` gọi `mbedtls_ssl_conf_groups`; `HttpsTlsPolicy.KeyExchangeGroupsAreX25519AndP256` giữ nguyên). `mbedtls_config_test` cập nhật theo.
3. **Kiểm chứng chỉ:** CA hệ thống (`/etc/ssl/certs/ca-certificates.crt` hoặc `caFile`) + tên máy, **hoặc** ghim SHA-256 chứng chỉ lá (máy chủ nội bộ tự ký). Không có "bỏ qua kiểm". Không kiểm ngày (cấu hình không có `MBEDTLS_HAVE_TIME_DATE`, đồng hồ thiết bị có thể sai).
4. **Cấu hình trên thiết bị**, không trong project: `<dataDir>/notify/email.json` (0600, runtime ghi qua API quản trị mới `GET|POST /api/v1/admin/email`, `POST /api/v1/admin/email/test`, device-api 1.6.0 mở rộng, apiVersion không đổi, administrator, `rev`, audit trước khi ghi). Lý do: người nhận là dữ liệu cá nhân thay đổi theo ca trực; đổi không cần nạp lại project; không thêm khóa project (không cần vector luật mới). Mặc định quy tắc trong project/Studio để sau.
5. **Mật khẩu SMTP** là mục `smtp` của file bí mật thiết bị (`sudo mat-runtime --set-secret smtp`), runtime đọc mỗi lần gửi; không qua web, không trong project, log, audit. Không bao giờ AUTH khi không có TLS.
6. **Người nhận:** địa chỉ trong quy tắc và/hoặc nhóm 013; `users.json` thêm khóa tùy chọn `email` (vẫn 1.1.0: bản đọc 1.x cũ bỏ qua khóa lạ). Đổi email không đổi `rev` của tài khoản (không đăng xuất).
7. **Quy tắc thuần** (`email_rules`): khớp mức/lớp/khu/sự kiện; gom theo cửa sổ (mặc định 30 s, ≤ 50 dòng/email); `maxPerHour` giữ lại chứ không bỏ; nhắc lại khi chưa xác nhận (mỗi `reminderMin`, tối đa `reminderMax`); giờ yên lặng theo mức; trạng thái khôi phục lúc khởi động (cờ `startup`) và lần hết của nó không gửi.
8. **Hàng đợi bền** `notify/outbox/`: mỗi email một file (tạm + fsync + rename), ≤ 100 email/4 MiB, xóa sau khi gửi, hết hạn 24 h; thử lại 30 s → 15 phút; lỗi 5xx ở MAIL/RCPT/DATA là vĩnh viễn. Trạng thái thử lại chỉ trong RAM (khởi động lại thì thử ngay).
9. **Một luồng `email`** nhận thông báo từ luồng tick (khóa ngắn, ≤ 2000 thông báo chờ), không bao giờ chặn tick.
10. **Nội dung:** tiếng Việt, UTF-8, tiêu đề RFC 2047 base64, `multipart/alternative` text + HTML đơn giản (escape mọi giá trị), base64, `Auto-Submitted: auto-generated`, liên kết `<baseUrl>/alarms`.

## Hệ quả

- Runtime có giao diện mạng **ra** mới (threat-model I-17); bề mặt TLS client của Mbed TLS vào ảnh build.
- Số đo x64 (Docker, `docs/reports/023-email-x64.json`): RSS tăng ~0,7 MiB khi bật và đã gửi email; CPU lúc rảnh 0,05–0,15 % (không khác biệt đo được); alarm → email ~5–6 s với `batchSeconds` 5.
- eMMC: ≤ `maxPerHour` lần ghi file mỗi giờ (+ xóa), không SQLite.
- Việc sau: mặc định quy tắc trong project (Studio), thử Gmail/Office 365 thật trên BL335, đo RAM/CPU trên BL335, DSN/bounce, OAuth2 (XOAUTH2) cho Office 365 khi Microsoft tắt hẳn Basic Auth cho SMTP.

## Phương án đã cân nhắc

- **libcurl (SMTP)**: đầy đủ, nhưng thêm ~400 KB và phụ thuộc lớn chỉ để dùng một giao thức; vẫn phải tự làm hàng đợi, gom, quy tắc.
- **Gửi qua dịch vụ HTTP (SendGrid…)**: cần khóa API bên thứ ba và Internet; không chạy được với relay nội bộ; trái offline-first.
- **Lưu quy tắc trong project**: phải nạp lại project mỗi lần đổi người trực; địa chỉ cá nhân đi theo gói project.
