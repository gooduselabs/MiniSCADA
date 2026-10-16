# Việc chờ người và khách hàng

Danh sách tập trung mọi việc của feature 011 cần người thật, thiết bị thật hoặc khách hàng (các mục ⚠️🔌 của [tasks.md](../../specs/011-pilot-hardening/tasks.md); FR-143). Mục "Việc chờ" của `docs/reports/011-acceptance.md` lấy từ đây. Cập nhật cột "Trạng thái" khi xong; không xóa dòng.

Không ghi địa chỉ, cổng, mật khẩu, tên người không đồng ý công khai vào tệp này (repo công khai).

## 1. Khách hàng và site pilot

| # | Ai | Làm gì | Cần gì | Chặn task | Trạng thái |
|---|---|---|---|---|---|
| K1 | Người liên hệ khách hàng | chọn 1 đến 2 site pilot; ký thỏa thuận pilot và xử lý dữ liệu ([data-handling.md](data-handling.md)) | quyết định của khách hàng | T192, T193 | chờ |
| K2 | Quản trị site | cấp BL335 hoặc chỗ lắp; nguồn điện ổn định, có UPS nếu có thể | tủ điện, nguồn | T194 | chờ |
| K3 | Kỹ sư PLC của khách | PLC thật qua Modbus TCP hoặc RTU; bảng địa chỉ thanh ghi; xác nhận **PLC tự nhả bit lệnh xung** sau tối đa N giây và khóa liên động nằm trong PLC | tài liệu PLC, quyền sửa chương trình PLC | T194, T195 | chờ |
| K4 | Quản trị mạng site | IP tĩnh cho BL335, NTP, VPN cho đội pilot; không chuyển cổng ra Internet | quyền cấu hình router/tường lửa | T194, E8 | chờ |
| K5 | Người liên hệ khách hàng | danh sách người vận hành (≥ 2) và kỹ sư (≥ 1) tham gia huấn luyện; lịch huấn luyện tuần đầu | lịch làm việc | T186, T197, X9 | chờ |
| K6 | Kỹ sư của khách (hoặc đội) | dựng project của site bằng Studio; sao lưu cấu hình hiện có của site trước khi chạy | Studio, tài liệu quy trình | T194, E8 | chờ |
| K7 | Khách hàng | chọn ≥ 10 tác vụ đại diện cho nghiệm thu | quy trình vận hành | T197, X8 | chờ |
| K8 | Khách hàng | quyết định phạm vi tính năng pilot (bảng E9): alarm, lịch sử, logic, logic ghi PLC, OTA | | T193, E9 | chờ |
| K9 | Khách hàng | ký biên bản nghiệm thu | | T197, X10 | chờ |

## 2. Thiết bị BL335 của đội (bàn thử và thiết bị hiện có)

| # | Ai | Làm gì | Cần gì | Chặn task | Trạng thái |
|---|---|---|---|---|---|
| B1 | Người dùng (chủ thiết bị) | cấp lại đường SSH tới BL335; kiểm nguồn và mạng (thiết bị mất liên lạc từ 2026-10-16) | người ở cạnh thiết bị | T013, T063, T079 đến T086, T122, T123, T148, T149 | chờ |
| B2 | Người dùng | đổi mật khẩu root yếu, đóng chuyển cổng SSH ra Internet (thiết bị bị dò mật khẩu) | quyết định, người ở cạnh | T064 | chờ |
| B3 | Người dùng, ở cạnh | đồng ý và có mặt khi gia cố SSH (khóa công khai, tắt mật khẩu root, đóng 9080, bộ luật `nft`) | phiên SSH dự phòng | T064 | chờ |
| B4 | Người dùng | lắp bộ điều khiển nguồn (ổ cắm Tasmota hoặc rơ-le USB), thử khô 5 lần có mặt | thiết bị phụ | T083, T084, T085, T123 | chờ |
| B5 | Người dùng | cung cấp datasheet chip eMMC của BL335 (TBW hoặc số chu kỳ P/E) | datasheet | T082, X5 | chờ |
| B6 | Người dùng | máy khác trong LAN chạy giả lập Modbus và `load-tester` cho soak 7 ngày | máy, 7 ngày liền | T081 | chờ |
| B7 | Người thao tác | cắt mạng 50 lần (cổng switch hoặc `ip link`) với 10 client | người | T086 | chờ |
| B8 | Người dùng | chọn PLC hoặc giả lập để thử logic ghi PLC với `logic.writes: on`; không thử trên thiết bị đang điều khiển máy thật | quyết định | T149 | chờ |
| B9 | Người dùng | đồng ý cài `mat-updater` và bật `update.enabled` trên bàn thử | quyết định | T122, T123 | chờ |

## 3. Phát hành và ký số

| # | Ai | Làm gì | Cần gì | Chặn task | Trạng thái |
|---|---|---|---|---|---|
| R1 | Công ty | quyết định và mua chứng chỉ ký mã (OV hoặc EV, khóa trên token hoặc dịch vụ ký đám mây); cung cấp máy ký, dấu vân tay, URL dấu thời gian | ngân sách, thủ tục với CA | T103, T104, T105, E4 | chờ |
| R2 | Người phát hành | sinh hai khóa ECDSA phát hành ngoại tuyến, đưa khóa công khai vào `deployment/keys/` | máy ngoại tuyến | T103, T122 | chờ |
| R3 | Người thử | cài thử Studio trên Windows 10 (1809+) và 11 sạch, ghi SmartScreen | máy hoặc máy ảo sạch | T105 | chờ |

## 4. Thử với người

| # | Ai | Làm gì | Cần gì | Chặn task | Trạng thái |
|---|---|---|---|---|---|
| H1 | Người chưa biết hệ thống | làm bảng tác vụ của ba hướng dẫn ([operator-guide.md](../user/operator-guide.md), [engineer-guide.md](../user/engineer-guide.md), [admin-guide.md](../user/admin-guide.md)), đo tỉ lệ làm được không hỏi (mục tiêu ≥ 90 %) | 3 người, bàn thử | T186, SC-038 | chờ |
| H2 | ≥ 2 người vận hành, ≥ 1 kỹ sư | buổi huấn luyện thử nội bộ theo [docs/training/](../training/README.md); ghi `docs/pilot/training-results.md` | người, bàn thử | T186, SC-039 | chờ |
| H3 | Kỹ sư chưa dùng editor logic | làm luật bơm, counter, totalizer, lịch trong ≤ 25 phút | bản có editor logic | T150 | chờ |
| H4 | Người dùng Windows 11 | thử bộ gõ Telex/Unikey và NVDA trong trình vẽ SVG; dựng ký hiệu "bơm" ≤ 20 phút | bản có trình vẽ | T167 | chờ |

## 5. Trong pilot

| # | Ai | Làm gì | Cần gì | Chặn task | Trạng thái |
|---|---|---|---|---|---|
| P1 | Kỹ sư pilot | cài bản rc lên site và bàn thử, bật thu dữ liệu, ghi ngày bắt đầu đồng hồ | K1 đến K6 xong | T194 | chờ |
| P2 | Kỹ sư pilot, khách hàng | chạy ≥ 30 ngày, báo cáo tuần, ghi sự cố | | T195 | chờ |
| P3 | Kỹ sư pilot | đo độ trễ đầu-cuối Chrome ≥ 3 lần mỗi site; `EXT_CSD` đầu và cuối kỳ | Chrome tại site | T196, X3, X4, X5 | chờ |
| P4 | Tech Lead | ký xác nhận tiêu chí vào và Go/No-Go | | T193, T198 | chờ |
