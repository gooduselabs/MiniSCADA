# Spec 023: Gửi cảnh báo alarm qua email

Trạng thái: Draft (2026-10-25). ADR: [051](../../docs/adr/051-alarm-email.md). Yêu cầu người dùng 2026-10-25: **chỉ email**
(không Telegram/Zalo/SMS).

## Bối cảnh

Alarm (feature 009) chỉ hiện trên trang Alarm và Studio; khi không ai nhìn màn hình, alarm khẩn cấp có thể bị bỏ sót. Thiết bị
BL335 thường có Internet hoặc một máy chủ SMTP nội bộ. Cần gửi email khi alarm xuất hiện/hết/chưa được xác nhận, cho đúng người,
không gây bão email, không mất email khi mạng chập chờn hay runtime khởi động lại, không làm lộ mật khẩu SMTP.

## Câu chuyện người dùng

- **US1 (P1)** Administrator mở trang Quản trị → **Thông báo email**: nhập máy chủ SMTP (host, cổng, bảo mật STARTTLS/SMTPS,
  tài khoản, địa chỉ gửi), tên trạm, địa chỉ trang web của thiết bị, quy tắc gửi; bấm **Lưu** và **Gửi thử** tới một địa chỉ.
  Mật khẩu SMTP đặt bằng `sudo mat-runtime --set-secret smtp` trên thiết bị; trang chỉ hiện "đã đặt/chưa đặt".
- **US2 (P1)** Alarm xuất hiện thỏa một quy tắc (mức, lớp, khu, sự kiện) → người nhận (danh sách địa chỉ và/hoặc nhóm người dùng
  013) nhận email tiếng Việt: tên trạm, thời gian, mức, Tag, giá trị, thông điệp, trạng thái, liên kết tới trang Alarm.
- **US3 (P1)** Nhiều alarm trong cửa sổ gom (mặc định 30 s) → **một** email liệt kê tất cả; vượt giới hạn email/giờ thì gom tiếp,
  không bỏ alarm nào (email sau ghi đủ).
- **US4 (P2)** Alarm chưa được xác nhận sau N phút → email nhắc lại, lặp mỗi N phút, tối đa `reminderMax` lần; xác nhận thì dừng.
- **US5 (P2)** Giờ yên lặng: trong khoảng giờ đặt, chỉ gửi alarm có mức từ ngưỡng trở lên (mặc định chỉ Khẩn cấp).
- **US6 (P1)** Mất mạng ngắn hoặc runtime khởi động lại: email nằm trong hàng đợi trên đĩa, gửi bù khi có mạng (backoff), hết hạn
  sau 24 giờ.
- **US7 (P2)** Administrator xem trạng thái: số email chờ, lần gửi thành công cuối, lỗi cuối; nhật ký audit có từng email gửi/thất
  bại/bị bỏ.
- **US8 (P2)** Người dùng có trường **email** trong tài khoản (trang Quản trị → Người dùng); quy tắc gửi cho nhóm dùng email của
  các tài khoản đang bật trong nhóm.

## Yêu cầu chức năng

- FR-001 SMTP client tự viết (RFC 5321) trên Mbed TLS có sẵn: `starttls` (587), `smtps` (465), `none` (chỉ relay nội bộ, **không
  bao giờ** gửi mật khẩu qua kênh không mã hóa). AUTH PLAIN/LOGIN theo khả năng máy chủ; EHLO; dot-stuffing; timeout mỗi bước.
- FR-002 Kiểm chứng chỉ máy chủ: chuỗi tới CA hệ thống (`caFile`, mặc định `/etc/ssl/certs/ca-certificates.crt`) và tên máy
  (SNI + kiểm hostname), **hoặc** ghim SHA-256 của chứng chỉ lá (`pinSha256`). Không có tùy chọn "bỏ qua kiểm".
- FR-003 Hàng đợi bền `<dataDir>/notify/outbox/`: mỗi email một file (ghi tạm + fsync + rename), tối đa 100 email và 4 MiB; đầy thì bỏ
  email cũ nhất (audit `email.dropped`). Gửi xong thì xóa file. Hết hạn 24 h → bỏ (audit). Lỗi tạm (mạng, TLS, 4xx, xác thực) →
  thử lại sau 30 s, 1, 2, 5, 10, 15 phút (trần 15 phút). Lỗi vĩnh viễn 5xx ở MAIL/RCPT/DATA → bỏ, audit `email.failed`.
- FR-004 Quy tắc (tối đa 20): `priorities` (1..4, rỗng = mọi mức), `classes`, `areas` (rỗng = tất cả; khu chung là `-`),
  `events` ⊆ {`active`, `return`, `reminder`}, `reminderMin` (5..1440), `to` (≤ 20 địa chỉ), `groups` (nhóm 013). Alarm khớp
  nhiều quy tắc: người nhận là hợp các quy tắc, mỗi sự kiện xuất hiện một lần trong mỗi email.
- FR-005 Sự kiện: `active` = chuyển từ NORMAL/RTN_UNACK sang ACTIVE_*; `return` = từ ACTIVE_* sang NORMAL/RTN_UNACK; nhắc lại khi
  occurrence còn chưa xác nhận sau `reminderMin` (lặp, tối đa `reminderMax`, mặc định 3). Sự kiện có cờ `startup` (trạng thái khôi
  phục khi khởi động) không gửi lại.
- FR-006 Gom: sự kiện đầu mở cửa sổ `batchSeconds` (5..600, mặc định 30); hết cửa sổ, mỗi nhóm người nhận có cùng danh sách sự kiện
  nhận một email; một email liệt kê tối đa 50 sự kiện và ghi "và N sự kiện khác". `maxPerHour` (1..120, mặc định 20, cửa sổ trượt):
  hết suất thì giữ lại gom tiếp (tối đa 1000 sự kiện chờ; quá thì bỏ cũ nhất và đếm).
- FR-007 Giờ yên lặng (`quietHours`: `from`, `to` HH:MM giờ thiết bị, `minPriority`): sự kiện có mức thấp hơn ngưỡng bị bỏ (đếm).
- FR-008 Nội dung: UTF-8, tiêu đề mã hóa RFC 2047 (base64), `multipart/alternative` text + HTML (mọi giá trị escape), `Date`,
  `Message-ID`, liên kết `<baseUrl>/alarms` (chỉ http/https).
- FR-009 Cấu hình trên thiết bị `<dataDir>/notify/email.json` (0600, runtime ghi), `rev` chống ghi chồng. API (device-api 1.6.0 mở rộng, apiVersion không đổi):
  `GET|POST /api/v1/admin/email`, `POST /api/v1/admin/email/test`; administrator, HTTPS, CSRF cookie, 30 thay đổi/phút, audit
  `email.config` trước khi ghi. Mật khẩu chỉ trong file bí mật thiết bị (`--set-secret smtp`), không bao giờ trong project, API, log.
- FR-010 `users.json`: trường tùy chọn `email` (≤ 254 ký tự, một `@`, không khoảng trắng/ký tự điều khiển). API người dùng 013 nhận
  và trả `email`. Đổi email không đổi `rev` của tài khoản (không đăng xuất).
- FR-011 Audit: `email.sent` (ok), `email.failed` (failed, mã lỗi), `email.dropped`, `email.config`, `email.test`. Không ghi nội dung
  email hay mật khẩu; ghi số người nhận và mã lỗi.

## Tiêu chí thành công

- SC-001 Alarm → email tới SMTP giả trong ≤ `batchSeconds` + 10 s (x64, Docker).
- SC-002 50 alarm trong 5 s → 1 email (gom); `maxPerHour` = 2 không bị vượt.
- SC-003 SMTP giả tắt 60 s rồi bật lại, runtime khởi động lại trong lúc đó → email vẫn tới (gửi bù), không trùng lặp quá 1 lần.
- SC-004 Runtime x64: RSS tăng ≤ 1 MiB khi bật email; CPU không đổi đo được lúc rảnh.
- SC-005 Trang Quản trị mục email qua axe không có vi phạm.

## Quyết định tự chốt và giả định

- D1 Quy tắc lưu **trên thiết bị** (không trong project) ở v1: địa chỉ email là dữ liệu cá nhân, thay đổi theo ca trực, không nên
  phải triển khai lại project. Mặc định quy tắc trong project/Studio để sau (không thêm khóa project nên không có vector luật mới).
- D2 Mật khẩu SMTP đặt qua SSH (`--set-secret smtp`), không qua web: file bí mật thuộc root (0640), runtime chỉ đọc.
- D3 Bật TLS client trong cấu hình Mbed TLS (`MBEDTLS_SSL_CLI_C`, SNI, ECDHE-RSA AEAD, P-384) — cần cho Gmail/Office 365 (chứng chỉ
  RSA). Máy chủ HTTPS của thiết bị vẫn chỉ có chứng chỉ ECDSA nên không thương lượng bộ RSA.
- D4 Không kiểm hạn chứng chỉ theo ngày (cấu hình Mbed TLS không có `HAVE_TIME_DATE`; đồng hồ thiết bị có thể sai) — ghi rõ trong
  threat-model.
- D5 Một email gửi cho nhiều người dùng chung trường `To` (nhân viên cùng trạm); không gửi BCC.
- D6 Không có DSN/bounce; lỗi người nhận được audit.
- D7 Giờ yên lặng theo múi giờ thiết bị (localtime).
