# ADR-042: Đăng nhập bắt buộc, phân quyền theo người dùng và nhóm, quản trị trên web

- **Trạng thái:** Proposed (2026-10-19).
- **Ngày:** 2026-10-19
- **Liên quan:** [spec 013](../../specs/013-access-control/spec.md), [kế hoạch](../plans/screen-grid-layout.md) mục 10 (D16 đến D26), [mô hình quyền](../../specs/013-access-control/contracts/access-model.md), [API quản trị](../../specs/013-access-control/contracts/admin-api.md), [threat-model I-15](../architecture/threat-model.md); [ADR-011](011-auth-roles-audit.md), [ADR-021](021-web-login-certificates.md).

## Bối cảnh

Trước 013: xem mặc định không cần đăng nhập; quyền chỉ theo 4 vai trò; tài khoản ở `/etc/mat-runtime/users.json` (root, runtime chỉ đọc), chỉ tạo bằng CLI qua SSH; `security.minRole` của component chỉ khóa ở giao diện. Người dùng (2026-10-19) yêu cầu trang đăng nhập bắt buộc, phân quyền xem từng trang và xem hoặc thao tác từng component theo người dùng hoặc nhóm, và quản trị tất cả trên trang web.

## Quyết định

1. **Vai trò là trần.** 4 vai trò giữ nguyên; quy tắc theo tài nguyên chỉ thu hẹp. Hai mức `view`, `operate` (D19). administrator luôn thấy mọi thứ.
2. **Nhóm và quy tắc trên thiết bị, không trong project** (D17, D18). Project chỉ đặt mặc định vai trò tối thiểu (`security.view`, `security.operate` ở item, `security.view` ở màn hình; định dạng 1.1, cộng thêm). Quy tắc trỏ tài nguyên bằng định danh ổn định (`screen:<id>`, `item:<màn hình>/<item>`, `page:*`, `history:*`, `report:*`); tài nguyên biến mất thì quy tắc mồ côi, không có hiệu lực.
3. **Kho chuyển sang `/var/lib/mat-runtime/auth/`** (`users.json` 1.1.0 thêm `groups`, `lastLoginAt`; `access.json` 1.0.0), của `matscada`, 0600, runtime và CLI cùng ghi dưới `flock`, `rev` chống ghi đè, một bản `.bak`. `/etc/mat-runtime/users.json` chỉ còn là nguồn khởi tạo lần đầu. Đây là lệch so với ADR-011 (runtime không ghi tài khoản): chấp nhận vì yêu cầu D22, ghi RR-11.
4. **Thực thi ở máy chủ** cho mọi đường dữ liệu: quyền hiệu lực tính trước theo phiên bằng hàm thuần `computeAccess` (bản C++ thực thi, bản TS `@mat/access-model` cho kiểm và Studio, vector chung `tests/access-vectors`); tập Tag được phép lọc live, lịch sử, báo cáo, alarm; màn hình bị cấm 403, item ẩn bị cắt khỏi tệp trả về; lệnh ghi từ trang phải mang `context` và item phải `operate`. Phiên Bearer (công cụ kỹ thuật) từ engineer trở lên không bị lọc: họ đã tải được cả gói project; quy tắc áp cho trang web (phiên cookie) và cho Bearer dưới engineer (access-model §4, sửa 2026-10-20).
5. **Hiệu lực ngay** (D23): đổi vai trò, nhóm, trạng thái, mật khẩu hủy mọi phiên của người đó; đổi quy tắc làm mọi phiên tính lại và live gửi `access-changed`.
6. **Trang Quản trị trên web** (D22, D26): người dùng, nhóm, quyền theo trang (ma trận), quyền theo component (chọn trên xem trước màn hình), xem với tư cách, nhật ký; xác nhận lại mật khẩu cho thao tác nhạy cảm; device-api 1.6.0 dưới `/api/v1/admin/`.
7. **Đăng nhập bắt buộc mặc định cho bản cài mới** (`viewerLogin: required` trong `runtime.json` mẫu, D16); thiết bị đang chạy giữ cấu hình; trang chuyển về `/login?next=` với `next` chỉ là đường dẫn hash nội bộ.

## Hệ quả

- Thêm I/O ghi eMMC khi admin sửa (hiếm) và `lastLoginAt` (≤ 1 lần/giờ/người).
- Live hub và truy vấn lịch sử có thêm một lần tra bảng băm mỗi Tag; đo ở SC-006.
- Tài khoản tối đa 200, nhóm 50, quy tắc 5.000.
- Studio chưa quản lý người dùng (8.6 sau); CLI vẫn là đường phục hồi.

## Phương án đã loại

Quy tắc trong project (phải nạp lại project mỗi lần đổi quyền, lộ cấu trúc tài khoản trong gói); gán trực tiếp từng người không có nhóm (khó bảo trì); ẩn ở giao diện mà không lọc ở máy chủ (không phải bảo mật); dịch vụ quản trị riêng chạy root ghi `/etc` (thêm tiến trình, thêm bề mặt IPC, không giảm rủi ro đáng kể so với runtime đã giữ quyền ghi PLC).
