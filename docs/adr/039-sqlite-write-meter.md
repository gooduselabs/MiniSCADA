# ADR-039: Đo ghi eMMC bằng bộ đếm byte ở lớp VFS của SQLite

- **Trạng thái:** Proposed (2026-10-16). Đã chạy test x64 và armhf; số đo trên BL335 (SC-022, T143) vẫn **cần thiết bị**: chưa đo.
- **Ngày:** 2026-10-16
- **Liên quan:** [ADR-034](034-trigger-mode-write-estimate.md) (quyết định 4: đo bằng `/proc/self/io`, nay bổ sung), [ADR-031](031-history-aggregates.md), [ADR-005](005-resource-budget.md); [specs/010-history-reports](../../specs/010-history-reports/spec.md) (SC-022, SC-025, T130, T143); Constitution III (ngân sách ghi eMMC ≤ 2 GB/ngày).

## Bối cảnh

Đo trên BL335 (kernel 5.4.61): `historian.io.source` luôn là `"unavailable"` vì kernel không bật `CONFIG_TASK_IO_ACCOUNTING` (không có `/proc/<pid>/io`) và không có blkio throttling. Hệ quả: SC-022 (ghi ≤ 2 GiB/ngày), SC-025 (ước tính so với số đo) và khung "Ước tính" của Studio không có số đo trên chính thiết bị đích. Số toàn hệ thống của `/sys/block/mmcblk0/stat` đọc được nhưng gồm cả dịch vụ khác (atscada…), dao động 2,6 đến 4,7 GB/ngày, không quy được cho `mat-runtime`.

## Các phương án

| Phương án | Nhận xét |
|---|---|
| `/sys/block/mmcblk0/stat` | gồm mọi tiến trình; không dùng làm số của runtime |
| `sqlite3_db_status` | không có bộ đếm byte ghi; chỉ đếm trang cache |
| Cộng kích thước WAL đã commit | bỏ sót checkpoint, journal, file khác |
| **VFS bọc (shim) đếm `xWrite`** | đếm đúng byte mà SQLite yêu cầu ghi, theo từng DB; không cần quyền, không cần kernel hỗ trợ |
| Tự dịch bản vá SQLite | bản vá vendored phải giữ nguyên (SQLite 32-bit patch) |

## Quyết định

1. `core/historian/write_counter_vfs.{hpp,cpp}`: VFS tên `mat-count` bọc VFS mặc định (không đặt làm mặc định). Mỗi `xWrite` thành công cộng `iAmt` vào bộ đếm nguyên tử của DB. Khóa đếm là tên file không có thư mục và không có hậu tố `-wal`, `-journal`, `-shm`; nên `history.db` gồm cả WAL và checkpoint. Tối đa 16 DB (cái thừa vào mục `other`). Chỉ đăng ký một lần (`std::call_once`); lỗi đăng ký thì `countingVfsName()` trả `nullptr` và mọi `sqlite3_open_v2` rơi về VFS mặc định (chỉ mất số đo).
2. Mở bằng VFS này: `history.db` (`LocalStore`), `alarm.db` (`AlarmStore`), `audit.db` (`AuditLog`). Kết nối đọc (`ReaderPool`, `alarm_history`) không ghi nên không đổi. Project store và `RetainStore` ghi file thường, không qua SQLite, **không được đếm** (nhỏ, ghi hiếm: lưu project, giữ giá trị mỗi vài giây là việc của `RetainStore`; ghi nhận ở "Hệ quả").
3. `Historian` giữ hai `IoMeter` (vòng 1.440 ô theo phút, như cũ): một cho `/proc/self/io`, một cho `totalDbWriteBytes()`. Khối `historian.io` của `system/info`:
   - các khóa cũ (`source`, `writeBytes1h`, `writeBytes24h`, `coverageS`, `bytesPerDay`, `estimateBytesPerDay`, `budgetBytesPerDay`) giữ nghĩa: lấy từ **kernel** nếu có (`source:"proc-self-io"`), nếu không thì từ bộ đếm VFS (`source:"sqlite-vfs"`), nếu không có cả hai thì `"unavailable"` và các số `null`;
   - thêm `procSelfIo {available, writeBytes1h, writeBytes24h, coverageS, bytesPerDay}` và `sqliteVfs {available, …cùng các khóa…, sinceStart {history, alarm, audit…}, sinceStartTotal}` để đối chiếu; `sinceStart` là tổng byte từ lúc runtime khởi động, theo từng DB (khóa là tên không có đuôi `.db`, không lộ đường dẫn).
4. Studio: `measureOf` mang theo `source`; khung "Đo thực" ghi chú "đếm byte SQLite runtime ghi, không gồm dịch vụ khác" khi nguồn là `sqlite-vfs`; dòng tab Thiết bị đổi lời tương ứng.
5. Công cụ: `historian_tool soak` in cả `writeSource`, `sqliteVfsBytesPerDay` bên cạnh `writeBytesPerDay`; `tools/historian-it-010.ps1` in nguồn.

## Hệ quả

- **Tốt:** có số đo ghi của riêng `mat-runtime` trên BL335 mà không cần kernel; chia theo DB nên thấy ngay history/alarm/audit chiếm bao nhiêu; SC-022 và SC-025 đo được.
- **Xấu:** (a) số này là **cận trên** của ghi flash: đếm byte đi vào page cache; kernel có thể gộp hai lần ghi cùng trang trước khi ghi xuống (ví dụ WAL ghi lại trang) và eMMC còn khuếch đại ghi (write amplification) mà ta không thấy; (b) không gồm `-shm` (mmap), project store, `RetainStore`, log của systemd; (c) mỗi `xWrite` thêm một lần cộng nguyên tử (không đáng kể so với `write()`); (d) `audit.db` có thể được ghi cả từ tiến trình lệnh thiết bị (CLI), tiến trình đó có bộ đếm riêng, không cộng vào runtime.
- **Rủi ro:** SQLite đổi giao diện VFS: shim dùng phiên bản 2 của VFS và của io_methods (SQLite 3.54.0); test `write_counter_vfs_test` chạy với cả WAL và journal, phát hiện sớm.

## Cách đọc số trên thiết bị

`curl .../api/v1/system/info`, mục `historian.io`. So `sqliteVfs.bytesPerDay` với ngân sách 2 GiB/ngày và với `estimateBytesPerDay`: nếu số đếm nằm trong ngân sách thì ghi flash thực chỉ thấp hơn hoặc bằng. `/sys/block/mmcblk0/stat` (toàn hệ thống) chỉ dùng để thấy phần của dịch vụ khác, không dùng để nghiệm thu SC-022.

## Điều kiện xem xét lại

- Kernel bật `CONFIG_TASK_IO_ACCOUNTING`: `source` tự về `proc-self-io`, hai số hiện cạnh nhau, đối chiếu để hiệu chỉnh hệ số của bộ đếm.
- Cần đếm project store hoặc `RetainStore`: thêm bộ đếm vào các lớp ghi file (nhỏ, không qua VFS).
