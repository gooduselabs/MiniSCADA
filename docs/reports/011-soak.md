# Soak và ghi eMMC, feature 011 (T087, T201: khung)

**Trạng thái: khung, chưa đo.** Lập 2026-10-17 trên nhánh `gd6` (commit `c86ebe85`). Soak S0 x64 24 giờ (T076), S1 BL335 7 ngày (T081), S2 bàn thử 30 ngày (T196) đều chưa chạy.

Quy trình và ngưỡng: [contracts/test-protocols.md](../../specs/011-pilot-hardening/contracts/test-protocols.md) §2, §3; FR-039, FR-045, FR-046; SC-013, SC-016.

## 1. Công cụ (đã có)

| Công cụ | Tình trạng |
|---|---|
| `deployment/device/mat-sample.sh` (sh, chỉ đọc, `/run/mat-sample`, quay vòng 8 × 1 MiB; có trong gói runtime qua `package-runtime.ps1`) | test `tools/soak/mat-sample.test.mjs` với `/proc` giả (`MAT_PROC_ROOT`); chưa chạy trên BL335 |
| `tools/soak/analyze.mjs` (độ dốc RSS bỏ 24 giờ đầu, FD/luồng, ghi/ngày, `dmesg`, `EXT_CSD`) | `node --test` soak + powercut 55/55 |
| `tools/soak/collect.ps1` | parse sạch bằng pwsh; chưa chạy |
| `projects/soak-standard/` (500 Tag, lưu 200 Tag theo thay đổi, 3 màn hình) | sinh bằng `tools/gen-bench-projects.mjs`; lưu 7 ngày (30 ngày bị `W_LOG_SIZE_CAP`); chưa có logic mẫu, chưa có kênh Modbus |
| `mat-runtime --check-data` | ctest 13/13; `history.db` 500 MiB 0,79 s (x64) |

## 2. Tiêu chí soak (Master Plan §6.4, test-protocols §2)

| Tiêu chí | Ngưỡng | S0 x64 24 giờ | S1 BL335 7 ngày | Trạng thái |
|---|---|---|---|---|
| Khởi động lại ngoài kế hoạch | 0 | Chưa đo | Chưa đo | Chưa đo — T076, T081 |
| Độ dốc RSS | ≤ 0,5 MB/ngày; RSS lớn nhất ≤ 150 MB | Chưa đo | Chưa đo | Chưa đo |
| FD, luồng | thay đổi ≤ 5 % so với trung vị ngày 2 | Chưa đo | Chưa đo | Chưa đo |
| Ghi đĩa mỗi ngày (tổng khối) | ≤ 2 GB mọi ngày | Chưa đo | Chưa đo (xem §4: nền của thiết bị đã vượt) | Chưa đo |
| tmpfs | ≤ 64 MB | Chưa đo | Chưa đo | Chưa đo |
| `dmesg` | 0 lỗi `mmc`, `ext4`, `I/O error` | — | Chưa đo | Chưa đo |
| WAL | `history.db-wal` ≤ 64 MB, về nhỏ sau checkpoint | Chưa đo | Chưa đo | Chưa đo |
| Dữ liệu | `--check-data` cuối kỳ mã 0; số dòng `history` ±1 % | Chưa đo | Chưa đo | Chưa đo |
| Soak 30 ngày (S2) | như trên | — | — | Chờ người — pilot (T196, P2) |

Số tham khảo không thay soak: x64 soak 7 ngày giả của 010 (runtime 0.9.0, 200 Tag lưu trữ, có tổng hợp): ghi ~795 MB/ngày, DB 602 MB (`010-soak-x64.json`).

## 3. Điều kiện chạy S1 trên BL335

- Cần máy khác trong LAN chạy giả lập Modbus và `load-tester` 7 ngày liền (`customer-checklist.md` B6); đặt `maxLiveClientsPerSource: 10` nếu 10 client từ một máy.
- Thiết bị đã có lần khởi động lại không rõ nguyên nhân (2026-10-16 khoảng 08:13; journal trước đó không còn, `last -x` không có `shutdown`) và một lần tắt nguồn (bật lại 2026-10-17 13:09), đều không do mat. Theo test-protocols §2, đồng hồ soak chạy lại từ đầu khi thiết bị khởi động lại ngoài kế hoạch; nên ghi nhận nguồn điện và watchdog (`atscada-watchdog.conf`, 16 s) trước khi chạy.

## 4. Ghi eMMC và tuổi thọ

| Mục | Số đo đã có | Trạng thái |
|---|---|---|
| Ghi toàn máy (`/sys/block/mmcblk0/stat`) | 0.9.0 (2026-10-16, cửa sổ 3 phút quy đổi): **mat tắt 2,6–4,7 GB/ngày** (trung bình ~3,8), mat chạy 3,5–3,8 GB/ngày; phần của mat không tách được khỏi nhiễu, ước < ~1 GB/ngày ở tải tank-demo/history-demo | Chưa đo (soak) — **rủi ro**: ngưỡng "tổng khối ≤ 2 GB/ngày" của SC-013 không đạt được trên thiết bị này vì dịch vụ không thuộc mat đã ghi nhiều hơn |
| Ghi của runtime theo thành phần | kernel 5.4.61 không có `/proc/<pid>/io`; 1.0.0 báo `historian.io.source: sqlite-vfs` (đếm ở tầng VFS của SQLite) và bộ đếm `ioWriteBytesToday` theo thành phần (T029); chưa thu số | Chưa đo — T081 |
| `EXT_CSD` đầu/cuối kỳ | `mmc-utils` trên thiết bị chưa kiểm (T013); `emmcLife` của `diagnostics` chưa xem trên thiết bị | Chưa đo — T013, T081 |
| Tuổi thọ ước tính (≥ 5 năm) | cần datasheet chip eMMC (TBW hoặc chu kỳ P/E) | Chờ người — T082 (B5); thiếu datasheet thì ghi "chưa tính được tuổi thọ tuyệt đối" |

Đề xuất xử lý rủi ro ghi toàn máy (cần quyết định ở T201, ghi ADR-005): (a) kết luận ngân sách 2 GB/ngày theo phần ghi của mat (`sqlite-vfs` + `ioWriteBytesToday`) và ghi nền thiết bị là điều kiện môi trường; hoặc (b) đo S1 trên BL335 bàn thử không có dịch vụ `atscada-*` (không đụng thiết bị hiện có khi chưa có người đồng ý).

## 5. Kết luận

Chưa kết luận: chưa có lượt soak nào của 1.0.0. Cập nhật sau T076 (x64), T081, T082 (BL335).
