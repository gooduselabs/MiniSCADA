# Mẫu báo cáo tuần của pilot

Chép mẫu dưới đây cho mỗi tuần, đặt tên `weekly-<site>-<yyyy>-W<nn>.md` trong `docs/pilot/`. Số lấy từ `tools/pilot/kpi.mjs --site <site> --from <ngày> --to <ngày>`; số chưa đo ghi "chưa đo".

---

# Báo cáo tuần `<yyyy>-W<nn>`, site `<site>`

**Bản chạy:** `1.0.0-rc.<N>` · **Ngày đồng hồ pilot:** `<n>/30` · **Người viết:** `<tên>` · **Ngày viết:** `<ngày>`

## 1. Tóm tắt

Hai đến ba câu: tuần này chạy thế nào, có gì cần quyết định.

## 2. KPI

| KPI | Tuần này | Từ đầu kỳ | Ngưỡng | Đạt |
|---|---|---|---|---|
| Uptime tiến trình (X1) | | | ≥ 99,9 % | |
| Khởi động lại (số lần, nguyên nhân) | | | 0 ngoài kế hoạch | |
| `liveLagP95Ms` lớn nhất (X3) | | | ≤ 500 ms | |
| Ghi eMMC ngày lớn nhất (X4) | | | ≤ 2 GB | |
| `emmcLife` (typeA/typeB/preEol) | | đầu kỳ: | tăng ≤ 1 bậc | |
| RSS trung bình / p95 / lớn nhất (X11) | | | ≤ 150 MB | |
| CPU trung bình (X11) | | | ≤ 30 % | |
| Số client đồng thời lớn nhất | | | ≤ 10 | |

## 3. Sự cố

| Mức | Mới tuần này | Đang mở | Đã đóng |
|---|---|---|---|
| S1 | | | |
| S2 | | | |
| S3 | | | |
| S4 | | | |

Sự cố mới (mã, một dòng mô tả, trạng thái): xem [incident-log.md](incident-log.md).

## 4. Thay đổi trong tuần

- Bản vá, cập nhật, thay đổi cấu hình, nạp project (ai, khi nào, lý do):
- Mất điện, mất mạng của site:

## 5. Huấn luyện và người dùng

- Buổi huấn luyện đã làm, số người đạt:
- Phản hồi của người dùng:

## 6. Việc tuần tới và cần quyết định

- 
