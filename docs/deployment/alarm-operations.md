# Vận hành alarm trên BL335 (feature 009, runtime 0.8.0)

Dành cho kỹ sư triển khai và người vận hành. Nguồn: [spec.md](../../specs/009-alarms/spec.md), [alarm-store.md](../../specs/009-alarms/contracts/alarm-store.md), [device-api-1.3.md](../../specs/009-alarms/contracts/device-api-1.3.md), [data-model.md](../../specs/009-alarms/data-model.md) §11. Cài runtime nói chung: [mat-runtime.md](mat-runtime.md) mục 5f. Trạng thái nghiệm thu trên thiết bị thật (đo ghi, mất điện): xem `docs/reports/009-acceptance.md` khi có; các con số dưới đây là thiết kế, chưa đo trên BL335.

## 1. Cấu hình (`/etc/mat-runtime/runtime.json`)

Chỉ có tác dụng khi project có alarm. Giá trị ngoài khoảng bị kẹp và ghi cảnh báo lúc khởi động.

| Khóa | Mặc định | Khoảng | Ý nghĩa |
|---|---|---|---|
| `alarmRetentionDays` | 180 | 1 đến 3.650 | thời hạn lưu lịch sử (chỉ xóa lần xảy ra đã đóng, chỉ khi đồng hồ đúng) |
| `alarmMaxBytes` | 67.108.864 (64 MiB) | 4 MiB đến 1 GiB | trần dung lượng dùng của `alarm.db` |
| `alarmCommitMs` | 2.000 | 200 đến 60.000 | chu kỳ gom thay đổi rồi ghi một lần |
| `alarmCommitRows` | 200 | 10 đến 5.000 | hoặc ghi ngay khi đủ số thay đổi này |
| `alarmCommitMaxMs` | 60.000 | 1.000 đến 300.000 | trần cửa sổ ghi thích ứng khi tốc độ thay đổi > 5/s kéo dài 10 s (FR-039; mặc định 60 s theo số đo tải bão, ADR-028) |
| `alarmBufferMax` | 5.000 | 500 đến 100.000 | bộ đệm thay đổi chờ ghi |
| `alarmChatterWindowS` | 60 | 10 đến 600 | cửa sổ đếm số lần bật để phát hiện chập chờn |
| `alarmChatterShelveS` | 1.800 | 60 đến 86.400 | thời gian tự cách ly |
| `alarmMaxShelved` | 50 | 1 đến 200 | số alarm tạm ẩn do người vận hành cùng lúc |
| `alarmPurgeIntervalS` | 3.600 | 60 đến 86.400 | chu kỳ dọn theo thời hạn và trần |

`minFreeBytes` dùng chung với `history.db`. Ngưỡng chập chờn từng lớp (`chatterLimit`, mặc định 5 lần trong cửa sổ) đặt trong project (editor Lớp alarm), không đặt ở đây.

## 2. Xác nhận, tạm ẩn, vô hiệu

| Thao tác | Role tối thiểu | Qua đâu | Ghi audit |
|---|---|---|---|
| Xác nhận (một hoặc "tất cả") | `operator` | REST, cookie kèm CSRF hoặc Bearer; **không** qua WebSocket | `alarm.ack` (một dòng cho cả lô) |
| Tạm ẩn | `operator` | REST; cần lý do 1 đến 120 ký tự; 1 phút đến 8 giờ | `alarm.shelve`, `alarm.unshelve` |
| Vô hiệu, bật lại | `engineer` | **chỉ Bearer** (không cookie) | `alarm.disable`, `alarm.enable` |

- Xác nhận ghi audit **trước**, rồi mới áp dụng; audit không ghi được thì trả 503 `AUDIT_UNAVAILABLE` và alarm giữ nguyên trạng thái.
- Alarm tạm ẩn vẫn được đánh giá và ghi lịch sử, nhưng không hiện ở banner, không có tiếng, không tính vào huy hiệu menu. Hết hạn mà điều kiện còn đúng thì quay lại "chưa xác nhận".
- Tối đa `alarmMaxShelved` alarm tạm ẩn do người vận hành cùng lúc (vượt: `SHELVE_RANGE`). Tự cách ly do chập chờn không tính vào giới hạn này.
- Vô hiệu bền qua khởi động lại và qua nạp project mới (khớp `id`) cho tới khi bật lại.
- Viewer và khách xem được bảng, banner, số đếm, lịch sử; nút xác nhận và tạm ẩn bị khóa kèm lý do.

## 3. Chập chờn

Alarm bật quá `chatterLimit` lần trong `alarmChatterWindowS` giây bị tự cách ly `alarmChatterShelveS` giây (lý do "chập chờn", audit `alarm.shelve` do `system`). Lần bật thứ `chatterLimit` là dòng tổng kết có số lần bật gộp; các lần bật sau trong đợt cách ly không có dòng riêng. Nếu thấy nhiều alarm bị cách ly: kiểm deadband và trễ bật của alarm (editor Danh sách alarm), hoặc nhiễu tín hiệu ở nguồn.

## 4. Mất điện và hành vi sau khởi động

- `alarm.db` dùng WAL, `synchronous=NORMAL`: mất điện không làm hỏng file (kiểm ở nghiệm thu, T133 chờ người ở cạnh thiết bị).
- Hai hướng mất mát được chấp nhận (D14): (a) bản ghi bật hoặc hết trong khoảng `alarmCommitMs` cuối có thể mất khỏi lịch sử; trạng thái được dựng lại từ điều kiện Tag lúc khởi động, lần xảy ra mới mang cờ `startup`; (b) xác nhận cuối có thể quay về "chưa xác nhận". Không hướng nào tạo trạng thái sai nguy hiểm.
- Khởi động lại: tạm ẩn còn lại giữ theo giờ treo tường nếu đồng hồ đúng (ngược lại hết hạn ngay); vô hiệu giữ nguyên. Runtime đối chiếu với các dòng audit mới nhất trước khi áp dụng.
- Giờ chưa đồng bộ (`clockOk` = false): lần xảy ra vẫn ghi, thứ tự theo mã tăng dần; không bị dọn theo thời hạn; không nằm trong truy vấn lịch sử theo khoảng trừ khi bật `unsynced=1`.

## 5. Theo dõi: `GET /api/v1/system/info`, khối `alarms`

Chỉ có ở bản đầy đủ (không có khi `viewerLogin: required` và chưa đăng nhập).

| Trường | Ý nghĩa |
|---|---|
| `instances` | số instance đang chạy (đếm từng ngưỡng); 0 nếu project không có alarm |
| `active`, `unacked`, `shelved`, `disabled` | số đếm hiện tại |
| `logState` | `running`; `paused` (đĩa dưới `minFreeBytes`, ngừng ghi lịch sử, alarm vẫn chạy); `error` (không mở hoặc ghi được `alarm.db`, engine vẫn chạy) |
| `droppedChanges` | thay đổi lịch sử bị bỏ do bộ đệm đầy, từ lúc khởi động; > 0 là có vấn đề |
| `dbBytes` | kích thước `alarm.db` cộng `-wal` |
| `evalMaxMs`, `evalWindowS` | thời gian đánh giá một tick lớn nhất trong cửa sổ 60 s |
| `recoveredAt` | có khi vừa phục hồi từ file hỏng (mục 6) |

`warnings` có thêm `ALARM_LOG_PAUSED`, `ALARM_LOG_ERROR`, `ALARM_DROPPED` tương ứng.

## 6. `alarm.db` hỏng

Tự xử lý khi mở không được, `integrity_check` lỗi, hoặc SQLite báo hỏng lúc ghi: runtime đổi tên `-wal`, `-shm` rồi file chính thành `alarm.db.corrupt-<epoch>`, tạo file mới, đẩy lại toàn bộ lần xảy ra đang mở (trạng thái đang có không mất), ghi audit `alarm.purged` (`reason: corrupt`), chạy tiếp. Lịch sử đã đóng nằm ở file đổi tên. Giữ tối đa 3 file `alarm.db.corrupt-*` (cũ nhất bị xóa khi tạo mới); xóa tay sau khi điều tra.

Kiểm chỉ đọc khi nghi ngờ (BL335 có thể không có `sqlite3`):

```sh
runuser -u matscada -- /opt/mat-runtime/bin/mat-runtime --alarm-db-check
```

In kết quả `integrity_check` và số dòng. Không dùng `.recover` hay sửa tại chỗ. Lệnh `--alarm-db-check` (FR-041, D46) là phần cài đặt của feature 009: chỉ có sau khi task tương ứng xong.

## 7. Dung lượng ghi

Thiết kế: tải chuẩn (200 alarm, 20 lần xảy ra mỗi giờ) ≤ 25 MB/ngày; tải bão (200 alarm chập chờn liên tục) ≤ 0,1 GB/ngày nhờ tự cách ly và cửa sổ ghi thích ứng. Đo byte ghi thật trên BL335 là nghiệm thu T130 (cần SSH); điền số vào `docs/reports/009-acceptance.md` khi có.
