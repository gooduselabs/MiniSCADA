# Contract: danh mục lệnh, phím tắt, điều kiện bật

**Feature**: [spec.md](../spec.md) (FR-009, FR-010, FR-011, FR-031)

Mọi lệnh có trong menu đều có trong bảng lệnh (Ctrl+Shift+P). Bảng lệnh tìm theo nhãn, bỏ dấu và không phân biệt hoa thường: "bang tag" khớp "Mở Bảng Tag mặc định". Lệnh bị khóa vẫn hiện, kèm lý do; Enter trên lệnh bị khóa chỉ hiện lý do.

Cột "Bật khi":

- **luôn**: luôn bật.
- **project**: đã mở project.
- **sửa được**: editor đang mở là editor sửa được.
- **theo dõi**: đang theo dõi thiết bị.
- **005, GĐ 2**: chức năng của feature hoặc giai đoạn sau. Lệnh bị khóa, lý do là "Có ở feature 005" hoặc "Có ở GĐ 2".
- **đã đăng nhập**: đang Online có đăng nhập tới thiết bị (feature 005), kể cả khi phiên vừa hết hạn và đang chờ đăng nhập lại.

## Project

| Lệnh | Nhãn | Phím | Bật khi |
|---|---|---|---|
| `project.open` | Mở project… | Ctrl+O | luôn |
| `project.openRecent` | Mở gần đây › (danh sách) | | luôn |
| `project.save` | Lưu | Ctrl+S | project, có thay đổi chưa lưu |
| `project.settings` | Thiết lập project | | project |
| `project.close` | Đóng project | | project |

## Sửa

| Lệnh | Nhãn | Phím | Bật khi |
|---|---|---|---|
| `edit.undo` | Hoàn tác | Ctrl+Z | còn bước hoàn tác |
| `edit.redo` | Làm lại | Ctrl+Y | còn bước làm lại |
| `edit.find` | Tìm | Ctrl+F | project |
| `edit.fillDown` | Điền xuống | Ctrl+D | lưới Tag đang focus, ô không ở dòng đầu |
| `tags.add` | Thêm Tag | | Bảng Tag mở |
| `tags.delete` | Xóa dòng | | Bảng Tag mở, có dòng chọn |
| `tags.bulkAdd` | Thêm hàng loạt… | | Bảng Tag mở, project 0.2 (feature 006) |
| `tags.importCsv` | Nhập CSV… | | như Thêm hàng loạt (feature 006) |
| `tags.exportCsv` | Xuất CSV… | | Bảng Tag mở, project 0.2 (feature 006) |
| `tree.add` | Thêm vào cây | Insert | nút trên cây là Kết nối, kênh, thiết bị trường, Bảng giá trị hoặc Bảng theo dõi; project 0.2, không chỉ đọc (feature 006, FR-043) |
| `tree.rename` | Đổi tên | F2 | nút là kênh, thiết bị trường, bảng giá trị hoặc bảng theo dõi (feature 006) |
| `tree.duplicate` | Nhân bản | Ctrl+Shift+D | như Đổi tên (feature 006) |
| `tree.remove` | Xóa khỏi cây | Delete | như Đổi tên (feature 006) |

Khi focus ở ô nhập, Ctrl+Z và Ctrl+Y là hoàn tác của ô nhập. Hoàn tác của project chạy sau khi xác nhận ô.

## Xem

| Lệnh | Nhãn | Phím | Bật khi |
|---|---|---|---|
| `view.palette` | Bảng lệnh | Ctrl+Shift+P | luôn |
| `view.themeSystem` | Giao diện theo hệ thống | | luôn |
| `view.themeLight` | Giao diện sáng | | luôn |
| `view.themeDark` | Giao diện tối | | luôn |
| `view.taskCards` | Ẩn/hiện task card | | luôn |
| `view.phases` | Ẩn/hiện nhãn giai đoạn | | luôn |
| `view.resetLayout` | Đặt lại bố cục | | luôn |
| `view.nextRegion` | Chuyển vùng | F6 | luôn |
| `view.prevRegion` | Chuyển vùng (ngược) | Shift+F6 | luôn |

## Online

| Lệnh | Nhãn | Phím | Bật khi |
|---|---|---|---|
| `online.connect` | Kết nối theo dõi | Ctrl+K | project, chưa theo dõi, đã nhập địa chỉ (chưa nhập thì mở trang Thiết bị). Từ feature 005 (T085a): project đã gắn thiết bị thì Online thiết bị đó (dò → ghim → đăng nhập → `wss`; runtime < 0.4.0 thì rơi về theo dõi chỉ đọc); chưa gắn thì mở Thiết bị trong mạng. Nhãn giữ nguyên tới khi đổi contract này |
| `online.disconnect` | Ngắt kết nối | Ctrl+M | theo dõi |
| `online.device` | Thiết bị… (địa chỉ, kiểm kết nối) | | luôn |
| `online.openWeb` | Mở web thiết bị | | đã nhập địa chỉ, hoặc project đã gắn thiết bị (feature 005) |
| `online.devices` | Thiết bị trong mạng… | | luôn (feature 005, US1) |
| `online.login` | Đăng nhập… | | chưa đăng nhập, hoặc phiên hết hạn (feature 005: phiên hết hạn thì mở lại hộp thoại đăng nhập; ưu tiên thiết bị gắn với project, rồi thiết bị Online gần nhất; không có thì mở Thiết bị trong mạng) |
| `online.logout` | Đăng xuất | | đã đăng nhập (feature 005) |
| `online.download` | Nạp xuống… | Ctrl+L | project, đang Online và đã đăng nhập (feature 005, US2: mở hộp thoại Nạp xuống); còn lỗi thì lý do là "Project còn lỗi" (FR-023) |
| `online.restore` | Khôi phục bản trước… | | đang Online và đã đăng nhập (feature 005, US2: mở hộp thoại Khôi phục, danh sách bản lưu của thiết bị) |
| `online.upload` | Đọc lên… | | đang Online và đăng nhập bằng tài khoản engineer trở lên, không cần project (feature 005, US3: mở hộp thoại Đọc lên: "Thành project mới" hoặc "So với project đang mở"); lý do khi khóa: "Cần Online và đăng nhập thiết bị", "Cần tài khoản engineer trở lên" |
| `online.compare` | So sánh với thiết bị | | project, đang Online và đã đăng nhập (feature 005, US3: mở editor So sánh; viewer chỉ thấy khớp/khác) |
| `online.audit` | Audit của thiết bị | | đang Online và đã đăng nhập (feature 005, US4: mở editor Audit; chỉ administrator xem được, tài khoản khác thấy "không đủ quyền") |
| `watch.write` | Ghi dòng đã chọn… | Ctrl+Shift+Enter | Bảng theo dõi mở, Online, tài khoản từ operator; luôn qua hộp xác nhận (feature 006, FR-050) |
| `watch.writeAll` | Ghi tất cả… | | như Ghi dòng đã chọn… (feature 006) |

## Công cụ, Trợ giúp

| Lệnh | Nhãn | Phím | Bật khi |
|---|---|---|---|
| `tools.validate` | Kiểm tra project | F7 | project |
| `tools.simulate` | Mô phỏng Tag | | GĐ 2 |
| `help.shortcuts` | Phím tắt | | luôn |
| `help.roadmap` | Lộ trình | | luôn (mở tab Bắt đầu) |
| `help.about` | Giới thiệu mAT Studio | | luôn |

## Phím trong từng vùng (ARIA)

| Vùng | Phím |
|---|---|
| Cây project (`tree`) | ↑ ↓ di chuyển; → mở hoặc vào con; ← đóng hoặc lên cha; Enter mở editor; Home/End; Insert thêm; F2 đổi tên; Ctrl+Shift+D nhân bản; Delete xóa; Shift+F10 hoặc phím Menu mở menu chuột phải (feature 006) |
| Tab editor (`tablist`) | ← → chuyển tab; Enter/Space chọn; Ctrl+W hoặc Delete đóng tab đang chọn (trừ Bắt đầu) |
| Lưới Tag (`grid`) | ↑ ↓ ← → và Tab/Shift+Tab di chuyển ô; Enter/F2 sửa; gõ ký tự thay nội dung; Enter xác nhận rồi xuống dòng; Esc hủy; Delete xóa ô (trừ tên); Ctrl+D điền xuống |
| Tab Thông tin (`list`) | ↑ ↓; Enter tới chỗ sai |
| Hộp thoại (`dialog`) | Tab giữ trong hộp thoại; Esc đóng (trừ khi đang chạy) |
| Bảng lệnh (`listbox`) | gõ để lọc; ↑ ↓; Enter chạy; Esc đóng |

Thứ tự vòng của F6: cây → Details → editor → inspector → task card → thanh trạng thái.

WebView2 không được chạy phím tắt trình duyệt trùng với Studio. Studio chặn Ctrl+P (in) và F5 (tải lại trang) để không mất thay đổi chưa lưu (research R15).
