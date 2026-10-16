# Khóa vận hành (2 giờ)

## Mục tiêu

Sau khóa, người học tự làm được, không cần hỏi:

1. đăng nhập, đăng xuất, nhận biết chế độ chỉ xem;
2. đọc giá trị và bốn trạng thái GOOD, UNCERTAIN, BAD, STALE;
3. ghi một giá trị qua hộp xác nhận và đọc kết quả lệnh;
4. xác nhận và tạm ẩn alarm đúng cách;
5. nhận biết mất kết nối và biết gọi ai.

## Chuẩn bị (người dạy)

- Bàn thử: BL335 hoặc runtime x64 chạy `training-demo`, PLC giả lập chạy trên máy người dạy (xem [instructor.md](instructor.md)).
- Mỗi học viên: một máy có Chrome, tài khoản `operator` riêng (`hv1`, `hv2`…), chứng chỉ thiết bị đã cài.
- In [operator-guide.md](../user/operator-guide.md) (6 trang) cho mỗi người.

## Lịch

| Thời gian | Nội dung | Hình thức |
|---|---|---|
| 0:00–0:15 | hệ thống gồm gì: PLC, BL335, trang vận hành; ai làm gì | giảng |
| 0:15–0:35 | mở trang, đăng nhập, chế độ chỉ xem (bài 1) | thực hành |
| 0:35–0:55 | đọc giá trị và trạng thái (bài 2) | thực hành |
| 0:55–1:15 | điều khiển có xác nhận (bài 3) | thực hành |
| 1:15–1:20 | nghỉ | |
| 1:20–1:40 | alarm (bài 4), mất kết nối (bài 5) | thực hành |
| 1:40–2:00 | bài kiểm thực hành, phiếu đánh giá | kiểm |

## Bài thực hành

| Bài | Làm | Kết quả mong đợi |
|---|---|---|
| 1 | mở `http://<thiết bị>:8080/`, đọc dải trên; mở `https://<thiết bị>:8443/`, **Đăng nhập** | nói được vì sao trang HTTP là "Chế độ chỉ xem"; thanh trên hiện "hv1 (operator)" |
| 2 | trên "Tổng quan" đọc Mức nước, Thể tích, Lưu lượng vào; người dạy dừng giả lập 30 s | thấy dấu "BAD" hoặc "STALE"; nói được "không dựa vào giá trị này" |
| 3 | nhập `55` vào "Mức đặt", đọc hộp xác nhận, **Xác nhận**; thử nhập `95` | lần 1: "✔ Đã ghi và xác nhận"; lần 2: bị chặn vì ngoài giới hạn 0–90 |
| 3b | bấm "Chạy bơm", đọc hộp xác nhận, **Hủy** | không có lệnh; công tắc giữ nguyên |
| 3c | thử chỉnh "Ngưỡng mức cao" | khóa "Cần quyền engineer" |
| 4 | chờ alarm "Mức bồn" (mức vượt 80 %), mở trang Alarm, **Xác nhận**; tạm ẩn một alarm 15 phút có lý do | cột "Người xác nhận" có tên mình; alarm sang tab "Tạm ẩn" |
| 5 | người dạy rút cáp mạng của máy học viên 1 phút rồi cắm lại | thấy "Mất kết nối — dữ liệu đang hiển thị là cũ"; trang tự về "Trực tuyến" không cần F5 |

## Bài kiểm thực hành

Người dạy giao lần lượt, học viên làm một mình, người dạy chỉ quan sát và đánh dấu.

| # | Yêu cầu | Đạt khi |
|---|---|---|
| 1 | Đăng nhập bằng tài khoản của mình | đăng nhập thành công lần đầu hoặc tự sửa được lỗi gõ |
| 2 | Cho biết trạng thái của 3 giá trị người dạy chỉ (có 1 BAD do người dạy tạo) | nói đúng cả 3 |
| 3 | Đặt mức đặt `45` | đọc hộp xác nhận trước khi bấm, kết quả CONFIRMED |
| 4 | Xử lý một alarm | xác nhận đúng alarm, không dùng "Xác nhận tất cả" khi không cần |
| 5 | Người dạy tạo TIMEOUT (dừng giả lập rồi cho ghi) | không bấm lại ngay; nói "kiểm tra giá trị thực trước" |
| 6 | Người dạy hỏi: "mất kết nối 10 phút thì làm gì, gọi ai?" | trả lời theo bảng mục 9 của hướng dẫn |

**Tiêu chí đạt:** đạt ít nhất 5/6, trong đó bắt buộc đạt mục 3 và mục 5 (an toàn khi điều khiển). Không đạt: học lại bài tương ứng, kiểm lại phần chưa đạt.

Ghi kết quả vào [evaluation-form.md](evaluation-form.md).
