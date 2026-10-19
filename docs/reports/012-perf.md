# Hiệu năng màn hình Lưới so Tự do, feature 012 (T055, SC-005)

**Trạng thái: Đạt (x64).** Đo 2026-10-20 trên nhánh `013-access-control` (commit `5ddd41f0`, đã gồm 012). Số liệu thô: [012-perf-x64.json](012-perf-x64.json).

> Đây là runtime **Linux x86_64 trong Docker trên máy dev**, không phải BL335. Số ở đây không thay số BL335. Bố cục Lưới chỉ khác ở phía trang (cách đặt card). Runtime gửi cùng Tag, cùng tần suất, nên phép đo này kiểm rằng phía thiết bị không có chi phí thêm.

## 1. Cấu hình

| Mục     | Giá trị                                                                                                                                                                                                                                                                                                                                       |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Máy     | Intel Core 5 210H (12 luồng logic), RAM 16 GiB, Windows 11; Docker Desktop 6.6.87.2 WSL2, 12 CPU, 7,6 GiB cho máy ảo                                                                                                                                                                                                                          |
| Runtime | `mat-runtime` Release x64 build trong image `mat-armhf` (`cmake --build /build/x64`), thư mục build `C:\build\perf013-x64`                                                                                                                                                                                                                    |
| Rig     | `tests/web-it/compose.yaml`, compose project `perf013` (rt + giả lập Modbus + client), `--no-discovery --max-live-clients-per-source 10 --no-sim-load`                                                                                                                                                                                        |
| Project | `perf-free` = `projects/dashboard-demo` + 500 Tag mô phỏng `SIM.T0001..0500` (sin, như `soak-standard`) + 10 màn hình `perf-01..10`, mỗi màn 50 card ở toạ độ x/y. `perf-grid` = `projects/grid-demo` + cùng 500 Tag + cùng 10 màn hình, nhưng dùng bố cục lưới 12 cột (4 card một hàng, span 3). Sinh bởi `tools/load/gen-perf-projects.mjs` |
| Tải     | `load-tester -tags 500 -clients 10 -extra 0 -duration 75 -latency -shared-clock`, ws:// 8080, phiên ẩn danh (viewerLogin off). Mỗi client đăng ký đủ 500 Tag                                                                                                                                                                                  |
| Lấy mẫu | `tools/load/perf-client.mjs sample` trong container client (chung PID namespace với rt): CPU `/proc/<pid>/stat` theo **% một lõi**, VmRSS, byte gửi của rt (`/proc/<pid>/net/dev`, mọi card trừ lo). Mẫu 1 s, từ giây 10 đến giây 70 của mỗi lượt (60 s)                                                                                      |
| Lặp     | 5 lượt mỗi project, khởi động lại runtime trước mỗi lượt. Điều phối: `node tools/load/perf012-013.mjs --part 012 --reps 5 --hold 75`                                                                                                                                                                                                          |

Tag mô phỏng đổi giá trị ở mỗi chu kỳ Tag Engine (250 ms, `deltaPeriodMs` 250). Tải này nặng hơn polling 1 s, giống bàn đo 011.

## 2. Kết quả (trung vị của 5 lượt, [min–max])

| Chỉ số                                                  | Tự do (`perf-free`)                             | Lưới (`perf-grid`)               | Chênh                                      |
| ------------------------------------------------------- | ----------------------------------------------- | -------------------------------- | ------------------------------------------ |
| CPU trung bình, % một lõi                               | 1,0 [0,9–1,0] (giây CPU/60 s: 0,61 [0,57–0,62]) | 1,0 [0,9–1,0] (0,61 [0,55–0,62]) | **0 %**                                    |
| CPU p95 cửa sổ 1 s                                      | 2 [2–2]                                         | 2 [1–2]                          | 0                                          |
| RSS trung bình                                          | 16,7 MB [16,3–17,3]                             | 16,9 MB [16,4–17,0]              | +0,2 MB (nằm trong dao động giữa các lượt) |
| RSS tối đa                                              | 16,9 MB [16,5–17,5]                             | 17,1 MB [16,5–17,3]              | +0,2 MB                                    |
| Trễ live p95 (ts của delta → client nhận, cùng đồng hồ) | 2 ms [2–2]                                      | 2 ms [2–2]                       | 0                                          |
| Byte gửi/giây của rt (mạng, gồm khung TCP/IP)           | 482.270 [480.249–482.360]                       | 480.386 [480.310–482.324]        | −0,4 %                                     |
| Payload WebSocket nhận/giây (10 client)                 | 485.556                                         | 485.564                          | 0 %                                        |
| Client được nhận, mất sequence                          | 10/10, 0                                        | 10/10, 0                         | —                                          |

Phân giải: CPU đọc theo tick 10 ms, nên p95 của cửa sổ 1 s chỉ có các mức nguyên (1 tick = 1 %). Vì vậy so sánh dùng số giây CPU của cả 60 s.

## 3. Kết luận

- SC-005 (phía thiết bị): **Đạt.** CPU runtime với màn hình Lưới không tăng so với màn hình Tự do tương đương (0,61 so với 0,61 giây CPU trên 60 s). RSS, byte gửi và trễ khác nhau không quá dao động giữa các lượt. Đúng như dự kiến, vì bố cục chỉ đọc ở phía trang.
- Ngân sách Constitution III (tham khảo x64): RSS ≤ 17,5 MB so với 150 MB, CPU ≈ 1 % một lõi. Số BL335 lấy từ [011-load.md](011-load.md) (L1 28,9 % một lõi). Phép đo này không đo lại trên BL335.
- Chưa đo ở đây: CPU trình duyệt ≤ 30 % (vế thứ hai của SC-005), vì cần Chrome trên máy văn phòng. Không có hồi quy nghi ngờ.
