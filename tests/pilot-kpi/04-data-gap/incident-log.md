# Nhật ký sự cố (kịch bản mẫu)

## Sự cố

| Mã | Phát hiện | Mức | Loại | Mô tả | Tác động | Nguyên nhân | Xử lý | Bản vá | Hồi quy | Trạng thái | Người đóng |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INC-mau-00 | 2026-01-01 08:00 | S3 | product | (dòng mẫu của site khác, không tính) | | | | | | mở | |
| INC-lab-01 | 2026-11-02 14:20 | S2 | product | Trang xem không cập nhật, runtime treo | ngừng phục vụ 2026-11-02 14:00 đến 2026-11-02 15:00 | khóa chết trong hàng đợi ghi | khởi động lại dịch vụ |  |  | có cách tránh |  |
| INC-lab-02 | 2026-11-02 18:00 | - | site | Mất VPN, không thu được 06:00 đến 10:00 |  | nhà mạng |  |  |  | đóng | kỹ sư pilot |
