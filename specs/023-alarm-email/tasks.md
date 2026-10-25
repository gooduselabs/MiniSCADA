# Tasks 023: Alarm email

Ký hiệu: test viết trước phần cài đặt.

## Phase 1: Đặc tả

- [x] T001 spec.md, plan.md, tasks.md; ADR-051

## Phase 2: Lõi `core/notify` (test trước)

- [x] T010 test → `email_message` (MIME, RFC 2047, escape HTML)
- [x] T011 test → `email_config` (kiểm chặt, ghi 0600, `rev`)
- [x] T012 test → `email_rules` (khớp, gom, nhắc lại, giờ yên lặng, giới hạn/giờ, startup)
- [x] T013 test → `email_outbox` (bền, giới hạn, hết hạn)
- [x] T014 test với SMTP giả C++ → `smtp_client` (STARTTLS, SMTPS, ghim, AUTH, lỗi, timeout); Mbed TLS bật TLS client
- [x] T015 test → `email_service` (gửi bù, backoff, audit)

## Phase 3: Runtime và API

- [x] T020 `users.json` trường `email` (test account_store)
- [x] T021 admin API `/admin/email`, `/admin/email/test`, `email` trong API người dùng (test admin_api)
- [x] T022 nối `AlarmGlue` → `EmailService` trong `main.cpp`; audit actions mới

## Phase 4: Trang Quản trị

- [x] T030 tab "Thông báo email" + ô email ở Người dùng (Vitest model/api)
- [x] T031 e2e admin-email (axe)

## Phase 5: Kiểm và tài liệu

- [x] T040 tích hợp x64 Docker `tools/email-it.ps1` (gửi, gom, nhắc lại, mất mạng → gửi bù, giới hạn)
- [x] T041 đo RAM/CPU x64; armhf qemu
- [x] T042 admin-guide, operator-guide, ADR-051 + README, threat-model

## Còn lại (cần thiết bị hoặc tài khoản thật)

- [ ] T050 Gửi thật qua Gmail (mật khẩu ứng dụng) và Office 365 từ BL335; đo RAM/CPU trên BL335.
- [ ] T051 Mặc định quy tắc email trong project (Studio) nếu người dùng cần.
