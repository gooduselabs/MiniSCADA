# Feature 027: Quản lý người dùng và quyền từ mAT Studio

**Nhánh:** `027-studio-admin` · **Ngày:** 2026-10-26 · **Trạng thái:** đã làm

Yêu cầu người dùng (2026-10-26): "100% từ Studio chỉnh và cấu hình". Trước feature này người dùng, nhóm, phân quyền theo
người, email cảnh báo và API key chỉ sửa được ở trang Quản trị web của thiết bị (013, 023, 025); cây Studio có trang giữ chỗ
"Người dùng và quyền". Dữ liệu vẫn lưu trên thiết bị (ADR-042), không vào project.

## User story

1. **US1 (P1)** Kỹ sư quản trị Online với thiết bị bằng tài khoản administrator, mở **Người dùng và quyền** trên cây: thêm,
   sửa, khóa/mở khóa, đặt lại mật khẩu, xóa người dùng; thêm, đổi tên, xóa nhóm, gán thành viên.
2. **US2 (P1)** Đặt quyền theo trang (ma trận) và theo component (chọn trên xem trước màn hình **của project đang mở**),
   lưu theo lô; báo khi project đang mở khác project đang chạy (digest) hoặc còn thay đổi chưa lưu.
3. **US3 (P2)** Xem với tư cách một người dùng (chỉ đọc), email cảnh báo (SMTP, quy tắc, hàng đợi, gửi thử), API key
   (tạo, token một lần, sửa, thu hồi), nhật ký.
4. **US4 (P1)** Chưa Online hoặc không phải administrator: editor nói rõ "Kết nối thiết bị với tài khoản quản trị để quản
   lý người dùng" kèm nút Online (hoặc Đăng xuất để đổi tài khoản); không gọi API quản trị.

## Yêu cầu

- **FR-001** Studio gọi đúng các API `/api/v1/admin/*` đã có (013, 023, 025) qua kênh Bearer của Studio (lệnh Tauri
  `device_admin`, HTTPS ghim fingerprint như các lệnh Online khác), không qua trình duyệt, không cookie.
- **FR-002** Máy chủ nhận Bearer administrator ở mọi route quản trị (đã đúng từ 013; thêm test hành vi qua Bearer).
- **FR-003** `device_admin` chỉ nhận GET/POST tới `/api/v1/admin/...` (không `..`, `//`, ký tự lạ), thân ≤ 256 KiB; mọi mã
  HTTP trả `{ status, body }`; 401 `SESSION_*` bỏ token; không tự gửi lại khi lỗi mạng.
- **FR-004** Mô hình, đọc thân, lớp gọi API, câu báo lỗi, PreviewHost dùng chung với trang web qua gói `@mat/admin-model`
  (không chép).
- **FR-005** Giao diện theo studio-ux.md: mỗi mục là editor tab, đối tượng chọn sửa ở Inspector, lệnh trong bảng lệnh,
  hộp thoại cho thao tác tạo/xóa/xác nhận lại.
- **FR-006** Thao tác cần xác nhận lại (hạ vai trò, tắt, đặt lại mật khẩu, xóa, key ghi được) dùng hộp thoại của Studio;
  sai mật khẩu báo trong hộp thoại. 409 CONFLICT: tải lại, giữ bản nháp quy tắc, báo rõ.
- **FR-007** axe 0 vi phạm critical/serious ở mọi trang, theme sáng và tối.

## Tiêu chí thành công

- **SC-001** e2e Studio (DeviceLink giả): tạo người dùng, gán nhóm, quyền trang/component, reauth, 409, email gửi thử, tạo
  và thu hồi API key, xem với tư cách, axe: xanh.
- **SC-002** e2e trang Quản trị web không hồi quy (kể cả 5 kiểm hỏng sẵn: bộ lọc nhật ký, axe `scrollable-region-focusable`).
- **SC-003** Vitest gói dùng chung, Rust `device_admin`, ctest `AdminApi` (Bearer) xanh.
