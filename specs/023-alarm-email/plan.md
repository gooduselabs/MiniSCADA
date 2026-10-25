# Plan 023: Alarm email

## Kiến trúc

```
tick thread ── AlarmGlue::afterEvents ──(AlarmNotice, khóa ngắn)──► EmailService::push
                                                                       │ thread "email"
                                        EmailRules (thuần: khớp, gom, nhắc lại, giờ yên lặng, giới hạn/giờ)
                                                                       │ EmailDigest
                                        email_message (MIME UTF-8, RFC 2047, text + HTML escape)
                                                                       │
                                        EmailOutbox <dataDir>/notify/outbox (file/email, giới hạn)
                                                                       │
                                        SmtpClient (socket + Mbed TLS: STARTTLS/SMTPS, AUTH, timeout)
```

- `core/notify/` (thư viện `mat_notify`, không phụ thuộc HTTP/audit; audit, đồng hồ, tra nhóm → email được tiêm):
  `email_config` (đọc/kiểm/ghi email.json), `email_rules`, `email_message`, `email_outbox`, `smtp_client`, `email_service`.
- `server/http/admin_api.cpp`: route `/api/v1/admin/email`, `/api/v1/admin/email/test`; bảng vai trò thêm 3 dòng.
- `core/auth/account_store`: trường `email` (users.json vẫn 1.1.0: khóa thêm, bản đọc cũ bỏ qua khóa lạ).
- `apps/runtime-web/src/admin/tab-email.ts`: tab "Thông báo email" (form, quy tắc, Gửi thử, trạng thái); `tab-users.ts`: cột/ô email.
- Bí mật: `secrets.json` id `smtp` (đã có `--set-secret`).

## Ngân sách BL335

- Một thread đợi trên condition variable (thức mỗi 1 s khi có việc chờ). Không SQLite. RAM: cấu hình + ≤ 1000 sự kiện chờ (~200 B)
  + một phiên TLS lúc gửi (~60 KiB, giải phóng sau mỗi lượt).
- eMMC: mỗi email 1 lần ghi (≤ 64 KiB) + 1 lần xóa; `maxPerHour` 20 → ≤ 20 lần ghi/giờ. Không ghi trạng thái thử lại.

## Test

- gtest: `email_message_test` (RFC 2047, escape, dot, base64 dòng 76), `email_rules_test` (khớp, gom, nhắc lại, giờ yên lặng,
  giới hạn, startup), `email_config_test`, `email_outbox_test` (giới hạn, khởi động lại, file hỏng), `smtp_client_test` (máy chủ SMTP
  giả C++ trong test: plain, STARTTLS và SMTPS với chứng chỉ thử ECDSA tự sinh, ghim đúng/sai, CA sai, AUTH PLAIN/LOGIN, 535, 550,
  timeout), `email_service_test` (end-to-end với SMTP giả: mất máy chủ rồi gửi bù, khởi động lại), `admin_api_test` (email).
- Tích hợp: `tools/email-it.ps1` + `tools/email-it/fake-smtp.mjs` (Node, STARTTLS), runtime x64 trong Docker.
- e2e: `apps/runtime-web/tests/e2e/admin-email.e2e.mjs` (axe).
- armhf qemu: các test `email_*`/`smtp_*` trong `test-armhf.sh`.
