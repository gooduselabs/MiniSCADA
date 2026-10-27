# Spec: Thiết lập thiết bị từ Studio (027)

Ngày: 2026-10-26. Nhánh `027-device-settings` (từ `026-svg-showcase`). Yêu cầu người dùng: "100% là từ Studio chỉnh và cấu hình".

## Vấn đề

Trước 027, các việc sau chỉ làm được qua SSH (sửa `/etc/mat-runtime/runtime.json` hoặc chạy lệnh trên thiết bị): bắt buộc đăng nhập (`viewerLogin`), phạm vi xem (`viewerAccess`), tên miền cho phép (`allowedHosts`), giới hạn kết nối live mỗi nguồn (`maxLiveClientsPerSource`), bật OTA (`update.enabled`), tên thiết bị, chứng chỉ HTTPS (`--regen-cert`, `--make-csr`, `--import-cert`). Runtime chạy user `matscada` dưới `ProtectSystem=strict`: `/etc/mat-runtime` chỉ đọc, `/var/lib/mat-runtime` ghi được.

## Câu chuyện người dùng

- **US1** Kỹ sư (administrator) Online với thiết bị trong Studio mở **Thiết bị → Thiết lập thiết bị**, đổi các khóa trên, lưu; runtime khởi động lại có kiểm soát và áp dụng.
- **US2** Kỹ sư xem chứng chỉ (fingerprint, hạn, SAN), sinh lại có IP/tên trong SAN, tạo CSR, nhập chứng chỉ CA ký; Studio tự ghim lại fingerprint mới sau khi người dùng xác nhận so khớp.
- **US3** Kỹ sư bật OTA và cập nhật runtime từ Studio ("Cập nhật runtime…"); gói runtime cài bằng `deploy.sh` luôn kèm mat-updater.
- **US4** Quản trị viên làm điều tương tự trên trang Quản trị web (tab "Thiết bị").

## Yêu cầu

- **FR-001** Tệp `<dataDir>/settings.json` (của `matscada`, 0600, ghi nguyên tử tmp+fsync+rename, bản trước giữ ở `settings.json.bak`), dạng `{"rev":N,"values":{...},"updatedAt","updatedBy"}`. Khóa cho phép (phẳng): `viewerLogin`, `viewerAccess`, `allowedHosts`, `maxLiveClientsPerSource`, `updateEnabled` (= `update.enabled`), `deviceName`. Kiểm giá trị đúng như `runtime.json`.
- **FR-002** Thứ tự: mặc định < `runtime.json` < dòng lệnh < `settings.json` (dòng lệnh chỉ dùng cho test; tệp thiết lập là ý chí mới nhất của quản trị viên). Tệp hỏng: dùng `.bak`; cả hai hỏng: bỏ qua có cảnh báo, **không bao giờ chặn khởi động** (đường phục hồi: xóa tệp qua SSH).
- **FR-003** **Mọi** thay đổi khóa có hiệu lực sau một lần **khởi động lại có kiểm soát** (execv như đổi project: phiên live đóng 1012, phiên đăng nhập giữ qua lần execv) khoảng 1 s sau khi trả lời. Không áp nóng: các khóa này đọc lúc dựng cổng/bộ lọc nguồn/discovery; một đường áp duy nhất dễ kiểm và đúng như đổi `runtime.json`. Lưu mà giá trị hiệu lực không đổi thì không khởi động lại.
- **FR-004** `GET /api/v1/admin/device-settings` (administrator, HTTPS, Bearer hoặc cookie+CSRF): `rev`, `settings` (giá trị đã lưu), `base` (runtime.json), `effective` (đang chạy), `keys` (khóa nào từ đâu), `restartPending`, `cert` (fingerprint, hạn, SAN, cảnh báo, IP các card), `update` (đã cài mat-updater chưa).
- **FR-005** `POST /api/v1/admin/device-settings` `{rev, settings, reauth?}`: thay toàn bộ phần đè (khóa vắng = theo `runtime.json`). 400 giá trị sai, 409 `CONFLICT` sai `rev`, 403 `REAUTH_REQUIRED` khi **hạ bảo mật** (`viewerLogin` required→off; `viewerAccess` rộng hơn: off<private<any; bật `updateEnabled`; thêm tên vào `allowedHosts`), audit `device.settings` before/after (ghi trước tệp; không ghi được: 503), 503 `STORE_IO`.
- **FR-006** `POST /api/v1/admin/cert/regen` `{reauth, san?:[IPv4|tên]}`: khóa+chứng chỉ mới, SAN = tên máy + mọi IP card + `san` (sửa `TLS_NO_IP_SAN`). `POST /api/v1/admin/cert/csr` `{san?}`: khóa chờ + CSR (không đụng chứng chỉ đang dùng; không cần reauth). `POST /api/v1/admin/cert/import` `{reauth, pem}`: từ chối tệp có khóa riêng/không đọc được (400 `CERT_FILE_INVALID`), không khớp khóa (400 `CERT_KEY_MISMATCH`), hết hạn hoặc chưa tới hạn (400 `CERT_EXPIRED`). Regen/import trả `fingerprint` mới và khởi động lại để áp (CivetWeb nạp chứng chỉ lúc dựng). Chứng chỉ đã ở `<dataDir>/tls` (ghi được): không cần dời.
- **FR-007** Studio: cây project → nút thiết bị (khi Online, vai trò administrator) → **Thiết lập thiết bị** (trình soạn tab trong vùng làm việc, kiểu IDE): tab *Chung* (các khóa, nguồn của giá trị, cảnh báo cần khởi động lại, hộp mật khẩu khi hạ bảo mật) và tab *Chứng chỉ*. Sau regen/import: so fingerprint trả về với fingerprint thiết bị đưa sau khởi động lại, hộp xác nhận, ghim lại.
- **FR-008** Trang Quản trị web: tab "Thiết bị" tương ứng (cùng API, cookie + CSRF).
- **FR-009** OTA: `deploy.sh` cài mat-updater cả khi gói mất bit thực thi (gói đóng trên Windows). Vòng "Cập nhật runtime…" thử trong rig Docker bằng khóa thử. Gói phát hành thật cần khóa ký thật (việc của công ty, ngoài 027).
- **FR-010** SSH chỉ còn là đường phục hồi khẩn cấp (tài liệu).

## Ngoài phạm vi

Cổng, luồng, `hostCheck`, dataDir và các khóa hạ tầng khác vẫn ở `runtime.json`. Khóa ký phát hành thật. Đổi mật khẩu root/sshd.

## Tiêu chí thành công

- SC-001 Đổi `viewerLogin` qua API trên runtime x64 thật → sau khởi động lại, trang không đăng nhập bị chuyển tới đăng nhập.
- SC-002 Regen qua API → fingerprint trên cổng 8443 đổi đúng giá trị trả về, có IP trong SAN.
- SC-003 Gói 0644 cài được mat-updater; vòng OTA thử trong rig Docker đạt.
