# ADR-054: Thiết lập thiết bị và chứng chỉ từ Studio (settings.json ghi được, khởi động lại có kiểm soát)

- **Trạng thái:** Proposed (2026-10-26). Có mã và test (gtest cấu hình, API quản trị, quyền; Vitest; e2e Studio và trang Quản trị; Rust; tích hợp x64); chưa thử trên BL335.
- **Ngày:** 2026-10-26
- **Liên quan:** spec [027](../../specs/027-device-settings/spec.md), phân quyền 013 ([ADR-042](042-access-control.md)), OTA ([ADR-035](035-release-trust-ota.md)), chứng chỉ của 005/007, [threat-model I-19](../architecture/threat-model.md).

## Bối cảnh

Người dùng yêu cầu "100% từ Studio chỉnh và cấu hình". Trước 027, bắt buộc đăng nhập, phạm vi xem, tên miền cho phép, giới hạn kết nối, bật OTA, tên thiết bị và mọi thao tác chứng chỉ (`--regen-cert`, `--make-csr`, `--import-cert`) cần SSH: sửa `/etc/mat-runtime/runtime.json` (root) hoặc chạy lệnh trên thiết bị. Runtime chạy user `matscada` dưới `ProtectSystem=strict` với `ReadOnlyPaths=/etc/mat-runtime`: runtime không ghi được `runtime.json`, và không nên (đó là cấu hình hạ tầng do người cài viết). `/var/lib/mat-runtime` (StateDirectory) ghi được; chứng chỉ đã ở `<dataDir>/tls` từ 005.

## Quyết định

1. **Lớp đè ghi được** `<dataDir>/settings.json` (`{rev, values, updatedAt, updatedBy}`, 0600, ghi nguyên tử tmp+fsync+rename, bản trước `settings.json.bak`). Chỉ sáu khóa: `viewerLogin`, `viewerAccess`, `allowedHosts`, `maxLiveClientsPerSource`, `updateEnabled` (= `update.enabled`), `deviceName`; kiểm bằng đúng bộ kiểm của `runtime.json`. Thứ tự: mặc định < `runtime.json` < dòng lệnh < `settings.json`. Tệp hỏng → `.bak` → bỏ qua kèm cảnh báo; **không bao giờ chặn khởi động** (phục hồi: xóa tệp qua SSH).
2. **Áp bằng khởi động lại có kiểm soát**, không áp nóng: dùng lại `deployHooks.restart` (execv của đổi project: phiên live đóng 1012, phiên đăng nhập giữ qua execv), kích hoạt từ vòng tick ~1 s sau câu trả lời. Các khóa này được đọc lúc dựng cổng, bộ lọc nguồn, discovery và dịch vụ OTA; một đường áp duy nhất giống hệt sửa `runtime.json` rồi restart, dễ kiểm. Lưu mà giá trị hiệu lực không đổi thì không khởi động lại.
3. **API quản trị theo khuôn 013**: `GET/POST /api/v1/admin/device-settings`, `POST /api/v1/admin/cert/{regen,csr,import}`: administrator, HTTPS, Bearer (Studio) hoặc cookie + CSRF + `Origin` (trang web), 30 thay đổi/phút, `rev` (409), audit trước khi ghi tệp (`device.settings` kèm trước/sau; `cert.regenerate`, `tls.csr`, `tls.import`). **Nhập lại mật khẩu** khi giảm bảo vệ (`viewerLogin` required→off, `viewerAccess` rộng hơn, bật OTA, thêm tên vào `allowedHosts`) và khi thay chứng chỉ (sinh lại, nhập). CSR không đụng chứng chỉ đang dùng: không cần.
4. **Chứng chỉ**: sinh lại luôn gồm IP các card (sửa `TLS_NO_IP_SAN`) và tên/IP thêm; nhập kiểm khớp khóa (khóa chờ của CSR hoặc khóa đang dùng), từ chối tệp có khóa riêng, chứng chỉ ngoài hạn theo đồng hồ thiết bị (`CERT_EXPIRED`, chỉ ở API; dòng lệnh vẫn chỉ cảnh báo). Câu trả lời mang fingerprint mới.
5. **Ghim lại có xác nhận** trong Studio: sau đổi chứng chỉ, Studio dò lại tới khi thấy chứng chỉ khác; chỉ khi fingerprint thấy **trùng** fingerprint thiết bị vừa trả qua kênh đã ghim cũ thì hiện nút ghim (người dùng so hai giá trị); khác thì không ghim và cảnh báo giả danh. Lệnh Rust dùng lại `device_get`/`device_post` (danh sách đường dẫn cho phép thêm 5 đường) và `device_pin`/`device_unpin`.
6. **OTA**: `deploy.sh` đặt lại bit thực thi của `updater/*` (tar của Windows làm mất, gây "gói không có mat-updater"); bật/tắt OTA là một thiết lập thiết bị. Gói phát hành thật vẫn cần khóa ký thật ngoại tuyến của công ty.

## Phương án đã cân nhắc

- **Cho runtime ghi `/etc/mat-runtime/runtime.json`** (bỏ ReadOnlyPaths): mở rộng bề mặt ghi của tiến trình mạng tới cấu hình hạ tầng (cổng, thư mục dữ liệu, khóa tin cậy OTA). Loại.
- **Helper root qua path unit** (như mat-updater) để sửa `runtime.json`: thêm một thành phần đặc quyền chỉ để đổi sáu khóa. Loại.
- **Áp nóng từng khóa:** mỗi khóa có đường áp riêng (bộ lọc nguồn, host policy, discovery, OTA), dễ lệch trạng thái; tiết kiệm vài giây không đáng. Loại.
- **Cho đổi mọi khóa từ Studio:** cổng, luồng, `hostCheck`, `trustedKeysDir` có thể làm mất truy cập hoặc hạ an ninh khó phục hồi từ xa. Để `runtime.json`.

## Hệ quả

- Không còn việc quản trị thường ngày nào cần SSH; SSH chỉ là đường phục hồi khẩn cấp (xóa `settings.json`, `--regen-cert`).
- Một thiết lập sai (vd. `allowedHosts` không có tên đang dùng, `viewerAccess` off) có thể khóa người dùng ngoài; Studio cảnh báo tên đang kết nối không có trong danh sách, IP luôn được nhận, và đường phục hồi được ghi trong admin-guide.
- Đổi chứng chỉ làm mọi Studio khác và máy vận hành đã cài chứng chỉ tự ký phải ghim/cài lại (như `--regen-cert`).
- Bảng quyền thêm 5 đường (`https_api_test`, `auth_gate_test`, `roles_test`); audit thêm hành động `device.settings`; mã lỗi mới `CERT_EXPIRED`.
