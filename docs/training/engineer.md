# Khóa kỹ sư (1 ngày)

## Mục tiêu

Sau khóa, kỹ sư tự làm được với project của nhà máy:

1. mở và kiểm tra project; dùng mô phỏng;
2. khai kết nối Modbus TCP/RTU, Tag ngoài, nội bộ, tính toán;
3. dựng màn hình với widget điều khiển có xác nhận và phân quyền;
4. nhập SVG và gắn hoạt ảnh;
5. ghim chứng chỉ, nạp xuống, khôi phục, đọc lên, so sánh;
6. khai alarm và lưu trữ;
7. chẩn đoán lỗi kết nối thường gặp;
8. (bản 1.0) dùng logic, template và trình vẽ SVG.

## Chuẩn bị (người dạy)

- Mỗi học viên: máy Windows có mAT Studio, Node.js (chạy PLC giả lập), bản sao `projects/training-demo/`, tài khoản `engineer` riêng trên bàn thử.
- Mỗi nhóm 2 người: một runtime (BL335 bàn thử hoặc x64). Không dùng thiết bị đang điều khiển máy thật.
- Một tệp SVG bồn đơn giản cho bài 5 (vẽ bằng Inkscape hoặc lấy ký hiệu có sẵn).

## Lịch

| Thời gian | Nội dung | Bài |
|---|---|---|
| 8:00–8:30 | kiến trúc: Studio, runtime, PLC; định dạng project; vai trò | giảng |
| 8:30–9:15 | giao diện Studio, mở project, kiểm tra, mô phỏng | 1 |
| 9:15–10:15 | kết nối Modbus, Tag, Tag tính toán | 2 |
| 10:15–10:30 | nghỉ | |
| 10:30–11:45 | màn hình, widget, sự kiện, phân quyền | 3, 4 |
| 11:45–13:00 | nghỉ trưa | |
| 13:00–13:45 | nhập SVG, gắn hoạt ảnh | 5 |
| 13:45–14:45 | Online: ghim chứng chỉ, nạp xuống, khôi phục, đọc lên, so sánh | 6 |
| 14:45–15:00 | nghỉ | |
| 15:00–15:45 | alarm, lưu trữ, chẩn đoán lỗi | 7, 8 |
| 15:45–16:15 | logic, template, trình vẽ SVG (bản 1.0; nếu bản cài chưa có thì giới thiệu qua tài liệu) | 9 |
| 16:15–17:00 | bài kiểm thực hành, phiếu đánh giá | kiểm |

## Bài thực hành

Mỗi bài tương ứng các tác vụ trong [engineer-guide.md](../user/engineer-guide.md) mục 14.

| Bài | Tác vụ | Kết quả mong đợi |
|---|---|---|
| 1 | K1, K2 | project mở, 0 lỗi; mô phỏng chạy |
| 2 | K3, K4, K5 | kênh, Tag mới không lỗi; Tag tính toán cho giá trị đúng ở Xem trước |
| 3 | K6 | màn hình "Bơm" có đèn và công tắc, có trong menu |
| 4 | K7 | operator thấy khóa "Cần quyền engineer" trên trang vận hành |
| 5 | K8 | bồn SVG nửa đầy khi thử giá trị 50 |
| 6 | K9, K10, K13, K14, K15 | nạp xuống thành công; so sánh hiện `≠` khi sửa; khôi phục và đọc lên được |
| 7 | K11, K17 | thử kết nối được; alarm "Mức bồn" hiện và xác nhận được |
| 8 | K16 | nêu đúng nguyên nhân Tag BAD khi giả lập dừng |
| 9 | K18, K19 (bản 1.0) | luật cho hành động sau 5 s trong Thử logic; 2 bản sao template gắn đúng Tag |

## Bài kiểm thực hành (45 phút)

Đề: "Thêm cho bồn nước một bơm thứ hai."

| # | Yêu cầu | Đạt khi |
|---|---|---|
| 1 | Thêm Tag `BOM2.LENH_CHAY` (BOOL, RW, `C11`) và `BOM2.LOI` (BOOL, `HR12.5`) | không lỗi kiểm tra |
| 2 | Thêm vào "Tổng quan" một công tắc và một đèn cho bơm 2 | gắn đúng Tag; công tắc có hộp xác nhận |
| 3 | Thêm alarm số "Bơm 2 lỗi" mức Khẩn cấp | **Thử alarm** cho thấy alarm bật |
| 4 | Thêm `BOM2.LENH_CHAY` vào nhóm lưu trữ "Bồn nước" | **Ước tính ghi** cập nhật, không vượt ngân sách |
| 5 | Nạp xuống bàn thử | thành công; trang vận hành có công tắc mới, ghi CONFIRMED |
| 6 | Người dạy đổi Unit ID của thiết bị trường thành 2 rồi nạp; học viên tìm lỗi | tìm ra trong ≤ 10 phút bằng Thử kết nối hoặc Chẩn đoán driver, sửa và nạp lại |

**Tiêu chí đạt:** đạt cả 6 mục trong 45 phút, được tra tài liệu, không được hỏi người dạy. Đạt 5/6 với mục 6 quá giờ: đạt có điều kiện, làm lại mục 6 vào buổi khác.

Ghi kết quả vào [evaluation-form.md](evaluation-form.md).
