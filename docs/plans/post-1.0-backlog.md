# Kế hoạch sau bản 1.0

Các mảng **không** làm trong feature 011 (spec 011 D28, FR-134). Mỗi mảng có mục tiêu, phụ thuộc, hướng thiết kế, rủi ro, ước lượng và điều kiện bắt đầu. Tài liệu này là kế hoạch, không có mã. Thứ tự ưu tiên chốt lại sau pilot, dựa trên phản hồi của khách hàng.

Ràng buộc chung cho mọi mảng (Constitution): ngân sách BL335 (RSS ≤ 150 MB, CPU ≤ 30 %, ghi eMMC ≤ 2 GB/ngày), mọi lệnh ghi xuống PLC có audit, không dữ liệu nhạy cảm trong project, test trước khi làm, giao diện Studio kiểu công cụ kỹ thuật.

Ước lượng tính theo "tuần kỹ sư" (một người, cả test và tài liệu), độ tin cậy thấp; chỉnh lại khi lập spec.

## 1. Thông báo alarm ra ngoài (email, Telegram, Zalo)

- **Mục tiêu:** người trực nhận alarm quan trọng khi không ở trước màn hình.
- **Phụ thuộc:** alarm của GĐ 4 (`alarm.db`); thiết bị có đường ra Internet hoặc máy chủ thư nội bộ; tài khoản của dịch vụ (SMTP, bot Telegram, Zalo OA); kho bí mật `secrets.json`.
- **Hướng thiết kế:** thành phần gửi riêng trong runtime, đọc thay đổi trạng thái alarm theo hàng đợi bền (không mất khi mất điện, không gửi trùng khi khởi động lại); luật chọn theo mức ưu tiên, khu vực, lịch trực; gộp nhiều alarm trong cửa sổ ngắn; giới hạn tốc độ; nội dung ngắn không lộ dữ liệu quy trình ngoài ý muốn. Bí mật chỉ trong `secrets.json`. Cấu hình trong project (người nhận theo nhóm), thông tin tài khoản trên thiết bị.
- **Rủi ro:** thông báo trễ hoặc mất khi mạng ra ngoài chập chờn (cần báo trạng thái gửi); bão alarm gây spam; Zalo OA cần thủ tục doanh nghiệp; lộ thông tin nhà máy qua dịch vụ bên ngoài.
- **Ước lượng:** 4 đến 6 tuần (email và Telegram trước, Zalo sau).
- **Điều kiện bắt đầu:** pilot xong; khách hàng xác nhận cần và chọn kênh; có quyết định về đường ra Internet của thiết bị.

## 2. Recipe (công thức sản xuất)

- **Mục tiêu:** lưu và nạp bộ thông số (setpoint) theo sản phẩm, có kiểm soát.
- **Phụ thuộc:** đường ghi Tag của 006 (giới hạn, audit, xác nhận); vai trò; logic v2 (nạp tuần tự nếu cần).
- **Hướng thiết kế:** bảng recipe trong project (cột là Tag ghi được, dòng là công thức), giá trị trong giới hạn của Tag; trên trang vận hành: chọn, so sánh với giá trị hiện tại, nạp có xác nhận, ghi từng Tag qua cùng đường ghi, kết quả từng dòng; phiên bản recipe và audit "ai nạp recipe nào lúc nào". Sửa recipe trên thiết bị (không qua Studio) là quyết định riêng vì liên quan quyền.
- **Rủi ro:** nạp dở dang khi mất kết nối giữa chừng (cần trạng thái rõ và không tự thử lại); ghi nhiều Tag cùng lúc vượt giới hạn tốc độ ghi; người dùng hiểu nhầm recipe là bảo đảm an toàn.
- **Ước lượng:** 4 tuần.
- **Điều kiện bắt đầu:** có ít nhất một khách hàng cần recipe kèm ví dụ thật; pilot xong.

## 3. API dữ liệu ra (REST, MQTT)

- **Mục tiêu:** hệ thống khác (MES, ERP, dashboard của khách) đọc dữ liệu từ thiết bị.
- **Phụ thuộc:** HTTPS, tài khoản và vai trò (005); API lịch sử (010); kiểm `Host` (011).
- **Hướng thiết kế:** REST chỉ đọc trước: giá trị hiện tại theo danh sách Tag, lịch sử qua API có sẵn; token riêng cho máy (không dùng mật khẩu người), phạm vi Tag theo token, giới hạn tốc độ. MQTT: runtime là client gửi tới broker của khách (không mở cổng mới trên thiết bị), TLS, gửi theo thay đổi có deadband, hàng đợi bền có giới hạn khi mất kết nối. Ghi từ ngoài vào (lệnh) là mảng riêng sau, bắt buộc qua đường ghi có audit.
- **Rủi ro:** tốn CPU và ghi eMMC (hàng đợi bền) trên BL335; mở rộng bề mặt tấn công; tương thích nhiều broker.
- **Ước lượng:** REST 3 tuần; MQTT 4 đến 5 tuần.
- **Điều kiện bắt đầu:** pilot xong; khách hàng nêu hệ thống cần nối và lượng dữ liệu; đo ngân sách CPU còn dư sau pilot.

## 4. Giao diện mobile

- **Mục tiêu:** xem trạng thái và alarm trên điện thoại.
- **Phụ thuộc:** trang vận hành (007), alarm (009), đăng nhập web; truy cập từ xa an toàn (VPN).
- **Hướng thiết kế:** bố cục đáp ứng cho trang alarm và một "màn hình tóm tắt" khai trong project (danh sách thẻ giá trị), không cố co giãn màn hình thiết kế cho máy tính; chỉ xem trước, điều khiển trên mobile là quyết định riêng; không làm ứng dụng gốc ở bước đầu.
- **Rủi ro:** người dùng mở cổng ra Internet để dùng mobile (phải hướng dẫn VPN); màn hình nhỏ dễ đọc nhầm.
- **Ước lượng:** 3 đến 4 tuần.
- **Điều kiện bắt đầu:** pilot xong; có yêu cầu thật; có giải pháp VPN cho điện thoại ở site.

## 5. Image Buildroot cho BL335

- **Mục tiêu:** hệ điều hành tối giản, đọc-ghi tách bạch, cập nhật cả hệ thống, thay Ubuntu 20.04 đã hết hỗ trợ chuẩn.
- **Phụ thuộc:** BSP của nhà sản xuất (kernel, device tree T113-i); bootloader hỗ trợ hai phân vùng A/B; OTA của 011 (định dạng gói, chữ ký).
- **Hướng thiết kế:** rootfs chỉ đọc, phân vùng dữ liệu riêng cho `/var/lib/mat-runtime` và `/etc/mat-runtime`; cập nhật A/B có quay về tự động; bật `CONFIG_TASK_IO_ACCOUNTING` để đo ghi đúng; chỉ các dịch vụ cần thiết; SSH bằng khóa.
- **Rủi ro:** phụ thuộc BSP và driver của nhà sản xuất; làm hỏng thiết bị khi thử bootloader (cần bàn thử và người ở cạnh); chi phí duy trì bản vá bảo mật hệ điều hành.
- **Ước lượng:** 8 đến 12 tuần.
- **Điều kiện bắt đầu:** có BSP và hỗ trợ của nhà sản xuất BL335; có ít nhất 2 thiết bị bàn thử được phép làm hỏng; OTA của 011 đã chạy ổn trong pilot.

## 6. Driver đợt 2 đến 4

- **Mục tiêu:** nối thêm loại PLC và giao thức ngoài Modbus.
- **Phụ thuộc:** Driver SDK và Tag Engine (006, ADR-014); bộ vector driver; thiết bị thật hoặc giả lập tin cậy cho từng giao thức.
- **Hướng thiết kế:** mỗi driver là một module theo Driver SDK, có giả lập để test, có chẩn đoán như Modbus. Đề xuất thứ tự (chốt theo khách hàng):
  - **Đợt 2:** Siemens S7 (S7-1200/1500, PUT/GET), Mitsubishi MC protocol.
  - **Đợt 3:** OPC UA client (bảo mật, chứng chỉ), Omron FINS.
  - **Đợt 4:** BACnet/IP, IEC 60870-5-104 hoặc DNP3 (theo ngành của khách).
- **Rủi ro:** license của thư viện giao thức (chỉ dùng license cho phép link tĩnh); hành vi khác nhau giữa các đời PLC; tốn RAM (OPC UA).
- **Ước lượng:** đợt 2: 6 tuần; đợt 3: 8 tuần; đợt 4: 6 đến 8 tuần.
- **Điều kiện bắt đầu:** khách hàng có thiết bị thật để thử; rà license thư viện xong.

## 7. Soak 30 ngày trên nhiều thiết bị

- **Mục tiêu:** bằng chứng độ ổn định lâu dài ngoài pilot (nhiều BL335, nhiều project), trước khi bán rộng.
- **Phụ thuộc:** bộ lấy mẫu và phân tích của 011 (`mat-sample`, `collect.ps1`, `kpi.mjs`); bộ điều khiển nguồn; bàn thử.
- **Hướng thiết kế:** 3 thiết bị chạy song song 30 ngày với 3 project chuẩn (nhỏ, vừa, tải tối đa), cắt điện ngẫu nhiên mỗi ngày, cập nhật OTA giữa kỳ; báo cáo tự động mỗi tuần; ngưỡng như tiêu chí ra của pilot.
- **Rủi ro:** chiếm thiết bị lâu; sự cố hạ tầng phòng lab làm gián đoạn và phải chạy lại.
- **Ước lượng:** 2 tuần chuẩn bị, 30 ngày chạy (theo dõi 0,5 tuần mỗi tuần), 1 tuần báo cáo.
- **Điều kiện bắt đầu:** pilot 1.0 xong; có 3 thiết bị và bộ điều khiển nguồn.

## 8. Trình vẽ SVG: Bézier và phép toán boolean

- **Mục tiêu:** vẽ đường cong và ghép hình ngay trong Studio, giảm phụ thuộc Inkscape.
- **Phụ thuộc:** trình vẽ SVG của 011 (FR-097 đến FR-118); allowlist SVG và giữ UID (008).
- **Hướng thiết kế:** bút Bézier (đoạn C/Q) với tay nắm, sửa nút đường cong; phép boolean (hợp, trừ, giao) bằng thư viện hình học có license phù hợp, kết quả là `path` thường; giữ UID và binding khi có thể, báo rõ khi phép toán làm mất phần tử có binding.
- **Rủi ro:** độ phức tạp hình học và lỗi biên (đường tự cắt); tăng kích thước bộ cài; người dùng mong đợi như Illustrator.
- **Ước lượng:** Bézier 3 tuần; boolean 3 đến 4 tuần.
- **Điều kiện bắt đầu:** phản hồi từ pilot cho thấy kỹ sư cần; trình vẽ 1.0 ổn định (không còn lỗi S1/S2).
