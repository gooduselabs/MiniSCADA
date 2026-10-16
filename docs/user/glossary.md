# Thuật ngữ

Các từ dùng trong Studio, trang vận hành và tài liệu mAT SCADA. Sắp theo bảng chữ cái. Tên tiếng Anh giữ nguyên khi phần mềm hiện đúng chữ đó.

| Thuật ngữ | Nghĩa |
|---|---|
| ACCEPTED | kết quả lệnh ghi: thiết bị đã nhận lệnh, đang chờ PLC xác nhận |
| Alarm | báo động khi một điều kiện bất thường xảy ra (theo ISA-18.2), có mức ưu tiên, cần xác nhận |
| Allowlist (SVG) | danh sách phần tử và thuộc tính SVG được giữ khi nhập; phần còn lại bị loại |
| `allowedHosts` | danh sách tên miền được dùng để mở thiết bị (ngoài địa chỉ IP) |
| Audit | nhật ký kiểm toán trên thiết bị: ai đăng nhập, ai ghi gì, ai nạp xuống; không chứa mật khẩu |
| BAD | quality lỗi: không đọc được giá trị từ PLC |
| Bảng giá trị | bảng đổi số thành chữ và màu, ví dụ 0 = "Dừng", 1 = "Chạy" |
| Bảng theo dõi | bảng trong Studio để xem và ghi thử giá trị Tag khi Online |
| Bản sao (template) | một lần dùng template trên màn hình, với tham số riêng (có từ bản 1.0) |
| BL335 | thiết bị chạy runtime (armhf, 1 GB RAM), đặt tại tủ điện |
| Chu kỳ quét | khoảng thời gian giữa hai lần đọc PLC của một nhóm quét, hoặc giữa hai lần chạy logic |
| CONFIRMED | kết quả lệnh ghi: PLC đã nhận và giá trị đọc lại khớp |
| Deadband (vùng chết) | thay đổi nhỏ hơn mức này không được tính là thay đổi |
| Đọc lên | lấy project đang chạy trên thiết bị về Studio |
| eMMC | bộ nhớ flash của BL335; ghi nhiều làm giảm tuổi thọ |
| Engineer | vai trò kỹ sư: nạp xuống, đọc lên, khôi phục project |
| Faceplate | màn hình popup có tham số, mở cho từng thiết bị (có từ bản 1.0) |
| FAILED | kết quả lệnh ghi: PLC hoặc đường truyền báo lỗi |
| Fingerprint | chuỗi SHA-256 nhận dạng chứng chỉ của thiết bị; so từng cặp ký tự trước khi ghim |
| Ghim (chứng chỉ) | Studio nhớ fingerprint của thiết bị và từ chối nếu nó đổi |
| GOOD | quality tốt |
| Kênh | một đường kết nối tới PLC (Modbus TCP hoặc RTU) |
| Khóa tạm | chặn đăng nhập trong vài phút sau nhiều lần sai, theo cặp (tên tài khoản, IP máy) |
| Logic | luật, timer, counter, cộng dồn, giờ chạy, lịch chạy trên runtime (có từ bản 1.0) |
| `logic.writes` | khóa trên thiết bị cho phép logic ghi xuống PLC; mặc định tắt (có từ bản 1.0) |
| Modbus RTU | Modbus qua cổng nối tiếp RS485 |
| Modbus TCP | Modbus qua mạng Ethernet |
| Mô phỏng | chạy Tag giả trong Studio để thử màn hình khi chưa có thiết bị |
| Nạp xuống | đưa project từ Studio lên thiết bị; có kiểm tra, sao lưu và tự quay về khi lỗi |
| Nhóm quét | nhóm Tag đọc cùng chu kỳ: Nhanh, Thường, Chậm |
| Online | Studio đã kết nối và đăng nhập vào thiết bị; cửa sổ có viền cam |
| Operator | vai trò người vận hành: điều khiển, xác nhận alarm |
| OTA | cập nhật runtime qua mạng từ Studio; mặc định tắt (có từ bản 1.0) |
| Phiên | thời gian đăng nhập còn hiệu lực; hết khi rảnh lâu hoặc quá hạn tối đa |
| Pilot | giai đoạn chạy thử ≥ 30 ngày tại site thật trước bản 1.0.0 |
| Project | toàn bộ cấu hình: Tag, kết nối, màn hình, alarm, lưu trữ, báo cáo |
| Quality | độ tin cậy của giá trị: GOOD, UNCERTAIN, BAD, STALE |
| REJECTED | kết quả lệnh ghi: lệnh bị từ chối, không gửi xuống PLC |
| Retain (giữ qua mất điện) | giá trị Tag nội bộ hoặc bộ đếm được lưu và khôi phục sau khi khởi động lại |
| Rollback | quay về bản trước (runtime hoặc project) |
| Runtime (`mat-runtime`) | chương trình chạy trên BL335: đọc PLC, phục vụ trang vận hành, ghi lịch sử |
| Site | nơi lắp đặt thật của khách hàng |
| STALE | quality mất dữ liệu: giá trị cũ, không còn cập nhật |
| Studio (mAT Studio) | phần mềm trên Windows để dựng project và nạp xuống thiết bị |
| SVG | định dạng đồ họa vector dùng cho bản vẽ quy trình |
| Tag | một điểm dữ liệu có tên, ví dụ `BON.MUC` |
| Tag ngoài | Tag đọc/ghi từ PLC |
| Tag nội bộ | Tag chỉ có trên runtime |
| Tag tính toán | Tag có giá trị từ biểu thức của Tag khác, chỉ đọc |
| Tạm ẩn (alarm) | ẩn một alarm trong thời gian giới hạn, có lý do; vẫn ghi lịch sử |
| Template | nhóm item có tham số, vẽ một lần dùng nhiều lần (có từ bản 1.0) |
| Thiết bị trường | một PLC hoặc thiết bị Modbus trên một kênh (Unit ID hoặc địa chỉ slave) |
| TIMEOUT | kết quả lệnh ghi: PLC không trả lời kịp, không chắc đã ghi |
| UNCERTAIN | quality không chắc: có giá trị nhưng chưa chắc đúng |
| Viewer | vai trò chỉ xem |
| Xác nhận (alarm) | người vận hành báo đã thấy alarm; tên được ghi lại |
| Xung | lệnh bật một bit trong thời gian ngắn rồi tự nhả |
