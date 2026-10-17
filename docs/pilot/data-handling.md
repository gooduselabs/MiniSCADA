# Xử lý dữ liệu trong pilot

Theo spec 011 FR-132, FR-137 và quyết định D38: pilot chỉ thu **dữ liệu kỹ thuật** của thiết bị, không thu dữ liệu quy trình hay dữ liệu cá nhân. Gửi tài liệu này cho khách hàng trước khi bắt đầu.

## 1. Dữ liệu thu

| Nguồn | Nội dung | Tần suất |
|---|---|---|
| `GET /api/v1/system/diagnostics` | thời gian chạy, số lần khởi động lại và nguyên nhân, RAM, CPU, số tệp mở, số luồng, byte ghi đĩa theo thành phần, chỉ số tuổi thọ eMMC, độ trễ dữ liệu sống, số client, đồng bộ giờ | 15 phút |
| `GET /api/v1/system/info` | phiên bản, trạng thái project (mã băm, không nội dung), cảnh báo, trạng thái lưu trữ | 15 phút |
| Audit tóm tắt | **số dòng** theo loại sự kiện (ví dụ bao nhiêu lần đăng nhập, bao nhiêu lệnh ghi) | 1 giờ |
| Nhật ký sự cố | mô tả kỹ thuật do người ghi | khi có |

Công cụ thu: `tools/pilot/collect.ps1`, chạy từ máy trong cùng VPN hoặc LAN, bằng một tài khoản `viewer` riêng (chỉ đọc), qua HTTPS ghim fingerprint chứng chỉ của thiết bị (`-Fingerprint`, kiểm ở mọi kết nối; thiếu thì script từ chối chạy).

## 2. Dữ liệu không thu

- Giá trị Tag, tên Tag, tên màn hình, nội dung alarm, nội dung báo cáo, project của khách hàng.
- Tên tài khoản, địa chỉ IP của máy người dùng, nội dung audit chi tiết.
- Mật khẩu, khóa, chứng chỉ.

Khi cần project hoặc log chi tiết để điều tra một sự cố, đội pilot **hỏi khách hàng từng lần**, ghi vào mục phân tích của sự cố, và xóa sau khi đóng sự cố.

## 3. Lưu ở đâu, bao lâu

| Dữ liệu | Nơi lưu | Thời hạn |
|---|---|---|
| Dữ liệu thu (JSON dòng) | máy của kỹ sư pilot, thư mục `docs/pilot/data/<site>/` (bị `.gitignore` loại, **không** lên repo công khai) và bản sao trong kho nội bộ có kiểm soát truy cập | đến hết pilot + 12 tháng, rồi xóa |
| KPI tổng hợp, báo cáo tuần, biên bản | repo (đã bỏ thông tin nhận dạng site nếu khách hàng yêu cầu) | lâu dài |
| Project, log chi tiết khách hàng cung cấp cho điều tra | kho nội bộ | đến khi đóng sự cố, rồi xóa |
| Mật khẩu tài khoản thu dữ liệu | biến môi trường hoặc kho thông tin xác thực Windows của máy thu | đến hết pilot; tắt tài khoản sau pilot |

## 4. Trách nhiệm

- Kỹ sư pilot: chạy công cụ thu, không sửa công cụ để thu thêm trường khi chưa cập nhật tài liệu này và báo khách hàng.
- Tech Lead: duyệt mọi thay đổi phạm vi thu.
- Khách hàng: có quyền xem toàn bộ dữ liệu đã thu của site mình và yêu cầu xóa.

Sau pilot: tắt tài khoản `viewer` dùng để thu (`mat-runtime --user-disable <tên>`), xóa dữ liệu thu theo thời hạn ở mục 3.
