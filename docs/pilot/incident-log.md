# Nhật ký sự cố pilot

Ghi mọi sự cố trong **1 ngày làm việc** kể từ khi phát hiện (FR-141). `tools/pilot/kpi.mjs` đọc bảng "Sự cố" dưới đây để đếm theo mức: giữ nguyên tên và thứ tự cột, mỗi sự cố một dòng, không xuống dòng trong ô. Chi tiết dài viết ở mục "Phân tích" bên dưới bảng.

Không ghi dữ liệu quy trình của khách (giá trị, tên Tag), mật khẩu, địa chỉ IP công cộng.

## Mức sự cố

| Mức | Định nghĩa | Phản hồi | Xử lý | Phân tích nguyên nhân |
|---|---|---|---|---|
| S1 | mất dữ liệu, ghi sai xuống PLC, hỏng DB, thiết bị không khởi động hoặc không phục vụ được > 30 phút, lỗ hổng bảo mật bị khai thác | 4 giờ | vá và hồi quy trước khi tiếp tục; đồng hồ pilot dừng và tính lại | bắt buộc |
| S2 | mất một chức năng chính (xem, điều khiển, nạp xuống, lưu trữ) có cách tránh | 1 ngày làm việc | cách tránh trong 1 ngày, vá trong 10 ngày; ghi chú, không dừng đồng hồ | bắt buộc |
| S3 | lỗi chức năng phụ hoặc hiển thị sai không ảnh hưởng vận hành | 5 ngày làm việc | theo lịch | không bắt buộc |
| S4 | thẩm mỹ, đề nghị cải tiến | ghi nhận | đưa vào backlog | không |

Sự kiện không phải lỗi sản phẩm nhưng ảnh hưởng KPI (mất điện site, bảo trì có kế hoạch, mất VPN) cũng ghi một dòng với mức `-` và loại `site` hoặc `planned`, để loại trừ khỏi uptime.

## Sự cố

| Mã | Phát hiện | Mức | Loại | Mô tả | Tác động | Nguyên nhân | Xử lý | Bản vá | Hồi quy | Trạng thái | Người đóng |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INC-mau-00 | 2026-01-01 08:00 | S3 | product | (dòng mẫu, xóa khi có sự cố thật) | | | | | | mở | |

Giải thích cột:

- **Mã:** `INC-<site>-<nn>`, `nn` tăng dần theo site.
- **Phát hiện:** `YYYY-MM-DD HH:MM` giờ địa phương.
- **Mức:** `S1`, `S2`, `S3`, `S4`, hoặc `-` cho sự kiện không phải lỗi.
- **Loại:** `product` (lỗi phần mềm), `site` (mất điện, mạng của site), `planned` (bảo trì, cập nhật có kế hoạch), `user` (thao tác sai).
- **Trạng thái:** `mở`, `có cách tránh`, `đã vá`, `đóng`.

## Phân tích

Mỗi sự cố S1, S2 có một mục:

### INC-<site>-<nn>

- Dòng thời gian (phát hiện, phản hồi, cách tránh, vá, đóng):
- Nguyên nhân gốc:
- Vì sao kiểm tra trước đó không bắt được:
- Sửa và test thêm:
- Bằng chứng (log, tệp trong `docs/reports/`):
