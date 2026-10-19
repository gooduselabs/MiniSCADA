# Hiệu năng phân quyền, feature 013 (T032, SC-006)

**Trạng thái: Đạt (x64).** Đo 2026-10-20 trên nhánh `013-access-control` (commit `5ddd41f0`). Số liệu thô: [013-perf-x64.json](013-perf-x64.json).

> Đây là runtime **Linux x86_64 trong Docker trên máy dev**, không phải BL335. Số ở đây không thay số BL335. Máy, image, rig và cách lấy mẫu giống [012-perf.md](012-perf.md) §1: Intel Core 5 210H, Docker WSL2 12 CPU, CPU tính theo **% một lõi** của riêng `mat-runtime`, mẫu 1 s trong 60 s ổn định của mỗi lượt, khởi động lại runtime trước mỗi lượt.

## 1. Kịch bản

- Project `perf-free` (`dashboard-demo` + 500 Tag `SIM.T*` + 10 màn hình × 50 card, `tools/load/gen-perf-projects.mjs`), chạy với `--viewer-login required --no-sim-load`.
- 10 tài khoản tạo bằng CLI `mat-runtime --user-add … --password-stdin` (`tests/device-it/add-user.sh`), cùng `admin`. Mật khẩu sinh ngẫu nhiên mỗi lần chạy và chỉ truyền qua biến môi trường. Nhóm được gán qua API quản trị: `u01–u03` operator ca-a, `u04–u06` operator ca-b, `u07–u08` viewer bảo trì, `u09` engineer quản đốc, `u10` viewer không nhóm (`tools/load/perf-users.mjs`).
- **52 quy tắc**: `perf-09` chỉ cho ca-a và quản đốc; `perf-10` chỉ cho bảo trì và quản đốc; 5 card đầu của `perf-01..08` chỉ cho ca-b, quản đốc và engineer; `perf-01` i10–i19 chỉ cho `u01` và bảo trì. Số Tag được phép của mỗi client lần lượt là 410, 400, 400, 390, 390, 390, 410, 410, 490, 350. Snapshot của runtime khớp đúng các số này ở cả 5 lượt.
- Mỗi lượt có 10 phiên web (đăng nhập, cookie `__Host-mat_sid`) và 10 client `load-tester -wss` qua wss:// 8443, mỗi client một cookie. Hai cờ mới của `load-tester`: `-cookies-file` và `-client-tags-file` (`tools/load-tester/perf013.go`).
- Bốn cấu hình, chạy xen kẽ, mỗi cấu hình 5 lượt:
  - `none-all`: không quy tắc (mọi người thấy hết), đăng ký 500 Tag.
  - `rules-all`: 52 quy tắc, đăng ký 500 Tag. Runtime trả `denied` cho phần bị cấm.
  - `none-subset`: không quy tắc, mỗi client đăng ký đúng tập được phép của mình.
  - `rules-subset`: có quy tắc, đăng ký tập được phép (giống một trang thật).

  Cặp `none-subset` / `rules-subset` gửi cùng lượng dữ liệu, nên chỉ khác ở chi phí của bộ kiểm quyền. Cặp `none-all` / `rules-all` là so sánh theo chữ của SC-006, nhưng bên có quy tắc gửi ít Tag hơn.

- Điều phối: `node tools/load/perf012-013.mjs --part 013 --reps 5 --hold 75`.

## 2. Tải live (trung vị của 5 lượt, [min–max])

| Chỉ số                          | none-all            | rules-all           | none-subset         | rules-subset        |
| ------------------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| CPU trung bình, % một lõi       | 1,2 [0,9–1,3]       | 1,2 [1,0–1,2]       | 1,2 [1,2–1,2]       | 1,2 [1,1–1,2]       |
| Giây CPU / 60 s                 | 0,75 [0,54–0,79]    | 0,72 [0,60–0,73]    | 0,73 [0,70–0,74]    | 0,73 [0,68–0,74]    |
| CPU p95 cửa sổ 1 s              | 2                   | 2                   | 2                   | 2                   |
| RSS trung bình                  | 19,7 MB             | 19,2 MB             | 19,9 MB             | 19,2 MB             |
| RSS tối đa                      | 19,8 MB [19,7–19,9] | 19,2 MB [18,9–19,4] | 19,9 MB [19,7–20,2] | 19,3 MB [19,2–19,6] |
| Trễ live p95 (cùng đồng hồ)     | 2 ms                | 2 ms                | 2 ms                | 2 ms                |
| Byte gửi/giây của rt            | 483.578             | 390.201             | 390.295             | 390.256             |
| Client được nhận / mất sequence | 10, 0               | 10, 0               | 10, 0               | 10, 0               |

**CPU tăng do phân quyền** (tiêu chí ≤ +10 %):

- Theo chữ của SC-006 (`rules-all` so `none-all`): **−4 %** (0,72 so 0,75 giây CPU). Bên có quy tắc gửi ít hơn 19 % byte.
- Cùng lượng dữ liệu (`rules-subset` so `none-subset`): **0 %** (0,73 so 0,73). Đây là chi phí riêng của bộ kiểm quyền khi tải ổn định. Hub kiểm quyền lúc đăng ký và khi grant đổi, không kiểm ở từng delta.

Lượt đầu của `none-all` thấp (0,54) vì là lượt đầu tiên sau khi tạo rig. Bỏ lượt này thì trung vị của `none-all` là 0,77, và mức chênh của `rules-all` thành −6 %. Kết luận không đổi.

## 3. Đổi quy tắc trong lúc tải

Trong cấu hình `rules-subset` có tải đầy đủ, admin đổi quy tắc `item:perf-01/i10` 10 lần, mỗi lần cách 5 s (lần lượt thêm và bỏ `group:ca-b`). Lệnh được gửi bằng `POST /api/v1/admin/access` từ container client, chung đồng hồ với `load-tester`.

| Chỉ số                                                                      | Giá trị                                                                     |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `POST /api/v1/admin/access` trả lời                                         | trung vị 9 ms [8–10]                                                        |
| Từ lúc gửi POST đến khi client bị ảnh hưởng (u04–u06) nhận `access-changed` | 30/30 lần nhận; trung vị 457 ms, p95 570 ms, tối đa **571 ms** (ngưỡng 2 s) |
| Client không bị ảnh hưởng nhận `access-changed`                             | 0 tin (7 client)                                                            |
| Mất sequence trong lượt                                                     | 0                                                                           |

Độ trễ trải đều trong khoảng 0–1 s vì hub hỏi lại grant khoảng mỗi giây (`server/websocket/live_hub.hpp`). Lượt thử ngắn trước đó có một lần 1.005 ms, vẫn dưới 2 s.

## 4. Chi phí `GET /api/v1/web/access`

500 lần gọi tuần tự trên một kết nối TLS giữ sống, xoay vòng 10 phiên, không có tải live. So với `GET /api/v1/web/session` làm mốc (cùng TLS, cùng xác thực phiên):

|                     | web/session (mốc) | web/access, không quy tắc | web/access, 52 quy tắc |
| ------------------- | ----------------- | ------------------------- | ---------------------- |
| CPU runtime mỗi lần | 0,36 ms           | 0,40 ms                   | 0,40 ms                |
| Thân trả lời tối đa | 251 B             | 995 B                     | 1.361 B                |
| Trễ p50 / p95       | 43,9 / 44,1 ms    | 43,9 / 44,2 ms            | 43,9 / 44,1 ms         |

Phần tính `EffectiveAccess` tốn khoảng 0,04 ms CPU mỗi lần (độ phân giải ±0,02 ms), có quy tắc hay không như nhau.

## 5. Kết luận và điểm cần xem

- SC-006: **Đạt.** CPU tăng −4 % theo chữ của SC-006 và 0 % khi cùng dữ liệu, ngưỡng là ≤ +10 %. RSS không tăng (−0,5 MB). `access-changed` ≤ 571 ms (ngưỡng 2 s). Chi phí `web/access` ≈ 0,04 ms CPU.
- "Vẫn trong ngân sách BL335": không đo lại trên BL335. Theo số x64, phân quyền không thêm CPU hay RAM đo được. Số BL335 L1 (28,9 % một lõi) ở [011-load.md](011-load.md) vẫn là tham chiếu, nhưng bàn đo đó dùng ws:// ẩn danh. Lượt L1 trên BL335 qua wss có đăng nhập (10 phiên TLS) chưa chạy, nên phần chi phí TLS so với ws:// trên Cortex-A7 chưa có số.
- **Nghi ngờ không thuộc 013 (có từ trước): mọi lời gọi HTTPS mất khoảng 44 ms.** Thời gian này không đổi theo endpoint, và cả `GET /api/v1/system/info` không phiên cũng vậy. Cùng lời gọi qua HTTP 8080 chỉ mất 0,8 ms. Thử lại trên kết nối giữ sống và kết nối mới đều cho kết quả này (44 / 48 ms). Dạng này khớp với Nagle cộng delayed ACK: phản hồi TLS được ghi thành nhiều bản ghi nhỏ trên socket không đặt `TCP_NODELAY`. Trong `server/` không có tùy chọn `tcp_nodelay` của civetweb. Ảnh hưởng: mỗi lời gọi API của trang (đổi màn hình, tải lại quyền sau `access-changed`, lịch sử) chậm thêm khoảng 40 ms, CPU không đổi. Không sửa ở đây. Đề xuất đo lại với `tcp_nodelay=1` trên x64 và BL335.
