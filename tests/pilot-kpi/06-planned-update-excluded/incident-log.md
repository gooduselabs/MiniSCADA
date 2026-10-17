# Nhật ký sự cố (kịch bản mẫu)

## Sự cố

| Mã | Phát hiện | Mức | Loại | Mô tả | Tác động | Nguyên nhân | Xử lý | Bản vá | Hồi quy | Trạng thái | Người đóng |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INC-mau-00 | 2026-01-01 08:00 | S3 | product | (dòng mẫu của site khác, không tính) | | | | | | mở | |
| INC-lab-01 | 2026-11-02 09:10 | S3 | product | Nhãn đơn vị lệch dòng |  |  |  |  |  | mở |  |
| INC-lab-02 | 2026-11-02 13:05 | - | planned | Cập nhật 1.0.0-rc.2 có kế hoạch qua OTA |  |  |  | 1.0.0-rc.2 | xanh | đóng | kỹ sư pilot |
| INC-lab-03 | 2026-11-02 16:00 | S2 | product | Xuất CSV lịch sử lỗi 500 | không xuất được báo cáo ca |  |  |  |  | mở |  |
