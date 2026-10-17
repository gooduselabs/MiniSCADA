# Tải và ngân sách tài nguyên, feature 011 (T087, T201: khung)

**Trạng thái: khung, chưa kết luận.** Lập 2026-10-17 trên nhánh `gd6` (commit `c86ebe85`). Cập nhật 2026-10-18 (nhánh `gd6-bl335`): số BL335 1.0.0 của T079 (L1 4 giờ, L3, L4, L5, L8) và T148 (L7), dữ liệu thô `011-load-bl335.json`, `011-logic-bl335.json`. Các lượt x64 (T075, T077, T078) và BL335 (T079, T080, T148) chưa chạy; số dưới đây là số **đã đo trước đó**, ghi rõ phiên bản. Khi có số mới thì thay ô "Chưa đo" và cập nhật cột Trạng thái; không xóa số tham khảo.

Quy trình và ngưỡng: [contracts/test-protocols.md](../../specs/011-pilot-hardening/contracts/test-protocols.md) §1; ngân sách: `mAT_SCADA_Master_Plan.md` §6; FR-005, FR-044, FR-046; SC-011, SC-012, SC-028.

Trạng thái: **Đạt**, **Không đạt** (kèm giới hạn và phương án), **Chưa đo** (kèm task). "Đạt (tham khảo 0.9.0)" là số của runtime 0.9.0 trên BL335 (2026-10-16), không thay cho lượt đo của 1.0.0.

## 0. Phiên bản và điều kiện

| Mục | Giá trị |
|---|---|
| Runtime | 1.0.0 (API thiết bị 1.5.0, giao thức live 1.3.0, định dạng project 1.0.0); bản trước để so: 0.9.0 |
| Thiết bị | BL335: 2 × Cortex-A7 1,2 GHz, RAM 993 MB, eMMC 8 GB, kernel 5.4.61, systemd 245 |
| `runtime.json` trên BL335 | giữ của 0.9.0: `viewerAccess: any`, `simLoad: true`, 24 luồng HTTP; `httpsThreads` mặc định 64 |
| Project trên BL335 | `tank-demo` 0.1.0 (số rảnh); `std-3b` 509 Tag mô phỏng (số tải 0.9.0) |
| Lưu ý đo tải mới | `maxLiveClientsPerSource` mặc định 5 (rà soát M1): `load-tester` 10 client từ một máy phải đặt `10` trong `runtime.json` của bàn đo |
| Máy "x64" | Docker `mat-armhf`; nhiều lượt 011 chạy trên Linux arm64 (Apple Silicon), JSON ghi rõ |

## 1. Ngân sách Master Plan §6

### 6.1 RAM

| Chỉ tiêu | Ngưỡng | Số đo đã có | Trạng thái |
|---|---|---|---|
| Kernel + OS + systemd + sshd (rảnh) | ≤ 200 MB | Toàn máy dùng 79 MB (khảo sát 2026-10-16, runtime 0.5.0 chạy, gồm dịch vụ khác) | Đạt (rảnh); đo lại cùng L1 |
| `mat-runtime` RSS, 10 client | ≤ 150 MB | **1.0.0 L1 4 giờ (T079): tối đa 19,5 MB**, đi ngang từ giờ thứ 2 (19,4 → 19,5), 109 luồng, 26–27 FD. 1.0.0 rảnh: **9,5 MB**, 99 luồng (0.9.0: 8,1 MB, 73 luồng; tăng do `httpsThreads` 64). 0.9.0 tải 30 phút 10 Chrome 509 Tag: 11,6 MB (tối đa 12,1); 0.9.0 10 client + alarm + lịch sử 15 phút: 9,1 MB (tối đa 9,5); VmHWM lúc khởi động 27 MB; mỗi lần đăng nhập cấp tạm ≈ 19 MiB (Argon2id m=19456 KiB) nên RSS có đỉnh ngắn 26–32 MB lúc đăng nhập | **Đạt** (BL335 1.0.0, T079) |
| SQLite page cache | ≤ 32 MB | Cấu hình: `history.db` 8 MiB (`cache_size=-8192`), `audit.db` 256 KiB; kết nối truy vấn lịch sử dùng chung giới hạn của Historian | Đạt theo cấu hình; chưa đo thực tế |
| tmpfs (log, staging, `/run/mat-sample`) | ≤ 64 MB | — | Chưa đo — T081 (`mat-sample` ghi `tmpfsKb`) |
| RAM còn dự phòng | ≥ 400 MB | 1.0.0 L1 4 giờ: MemAvailable thấp nhất 859 MB (0.9.0: 875 MB) | **Đạt** (BL335 1.0.0) |
| Hàng đợi gửi mỗi client WebSocket | ≤ 256 KB | `sendQueueBytes` mặc định 262144, trần cấu hình 262144 (`server/config.cpp`) | Đạt theo cấu hình |

### 6.2 CPU

| Chỉ tiêu | Ngưỡng | Số đo đã có | Trạng thái |
|---|---|---|---|
| 500 Tag, polling 1 s, 10 client (L1) | trung bình ≤ 30 %, đỉnh ≤ 60 % | **1.0.0 L1 4 giờ (T079): trung bình 28,9 % một lõi = 14,5 % cả máy (2 lõi), đỉnh cửa sổ 10 s 50,4 % một lõi**; mỗi giờ 28,9–29,0 %. Cách đọc chặt (một lõi) còn cách ngưỡng 1,1 điểm. 1.0.0 rảnh: 0,7 % một lõi (60 s). 0.9.0, 509 Tag, 10 Chrome, 30 phút: 12,8 % một lõi (chưa có đỉnh, chưa đủ 4 giờ) | **Đạt** BL335 (T079, cả hai cách đọc) · x64 chưa đo (T075) |
| 1.000 Tag, 10 client (L2) | trung bình ≤ 50 % (mục tiêu) | — | Chưa đo — T080 |
| Logic tối đa trên L1 (L7) | ≤ +3 điểm CPU, ≤ +5 MB RSS, vòng quét ≤ 5 ms | Engine x64 (550 khối, 3.000 quét): trung bình 0,16 ms, p99 0,62 ms, tối đa 0,90 ms (`011-logic-load-x64.json`). **BL335 1.0.0 (T148, A/B/A/B 15 phút, L1 + 550 khối của `logic-load`): thêm CPU +4,9 điểm một lõi = +2,4 điểm cả máy; thêm RSS +4,5 MB; vòng quét trung vị 15,6–16,4 ms, lastMs tối đa 21,8 ms, p99 tới 30,8 ms** | **Không đạt** vòng quét (≈ 3–6 lần ngân sách 5 ms) · CPU Đạt theo cả máy, Không đạt theo một lõi · RSS Đạt sát ngưỡng; xem §3.2 · x64 CPU/RSS chưa đo (T147) · Sau tối ưu (nhánh `gd6-logic-perf`, `logic_bench` trên BL335 rảnh): quét 8,5 → 2,3 ms trung bình, logic chạy đúng chu kỳ 100 ms; chờ đo lại dưới L1 |
| 10 client tải lại cùng lúc (L4) | ≤ 5 s, không timeout WebSocket | 0.9.0 BL335: 10 F5 cùng lúc màn 3b tệ nhất 1,13 s; SVG 1 MiB 2,0 s. **1.0.0 BL335 (T079): 10 trang × 50 vòng màn 250 item, cache trống: trung vị 647 ms, p95 795 ms, tối đa 935 ms, 0 lần vượt, 0 trang 4429** | **Đạt** BL335 · x64 chưa đo (T075) |

### 6.4 Chỉ tiêu benchmark tổng hợp

| Chỉ tiêu | Ngưỡng | Số đo đã có | Trạng thái |
|---|---|---|---|
| 500 Tag (MVP), thử 1.000 | chạy được | 0.9.0: 509 Tag mô phỏng 30 phút, 0 mất sequence trên 72.207 delta. 1.0.0 BL335: 500 Tag 4 giờ 10 client, 0 mất sequence (T079) | **Đạt** 500 Tag (BL335) · 1.000 Tag chưa đo (T080) |
| Client đồng thời 10, client 11 bị từ chối (L3) | 4429 ở 100 % của 50 lần; client mới vào ≤ 35 s sau khi client 1 ngắt | `load-tester --extra-attempts` có; phần "vào lại ≤ 35 s" chưa có trong công cụ (`notMeasured`, T071). **BL335 1.0.0 (T079): 50/50 lần 4429; vào lại 10 vòng: client 1 đóng sạch 28–83 ms, client 1 im lặng (như đứt cáp) 15,19–15,20 s (hết hạn heartbeat 15 s)** | **Đạt** BL335 · x64 chưa đo (T075) |
| SVG 300–500 phần tử/màn (L5) | ≥ 30 FPS với 50 animation | Máy dev (Chrome 155, 008): 100 animation, 100 FPS, 30 phút (`008-anim-x64.json`). **BL335 1.0.0 runtime thật (T079): màn 400 phần tử, 50 hoạt ảnh, 10 tiến trình Chrome headless riêng: thấp nhất 53,4 FPS**; 1 trang + 9 client 500 Tag: 60 FPS; 10 trang trong một tiến trình Chrome: 10,7 FPS (giới hạn máy đo, runtime chỉ 2,8 % một lõi) | **Đạt** BL335 · RSS tab chưa đo |
| Mở màn hình trên Chrome | ≤ 2 s (LAN 100 Mbps) | 1.0.0 BL335: F5 màn 250 item tới dữ liệu sống tối đa 935 ms (L4). 0.9.0 BL335, cache trống: màn 3b trung vị 615 ms (tối đa 846); 40 item SVG 1.216 ms; SVG 1 MiB trung vị 1.362 ms (tối đa 1.675) | Đạt (tham khảo 0.9.0); đo lại 1.0.0 ở T079 |
| Trễ Tag → hiển thị | ≤ chu kỳ polling + 500 ms | 0.9.0: live p95 297 ms (10 client, 15 phút); Tag đổi → banner alarm p50 297, p95 358 ms | Đạt (tham khảo 0.9.0); X3 đo trong pilot (T196) |
| Giới hạn nguồn: 40 TLS im lặng (L8) | đăng nhập máy khác ≤ 2 s; RAM ≤ +1 MB | x64 `conn_limit_test`: 60 TLS im lặng, nguồn khác 25 ms; `011-lockout-x64.json` IP B ≤ 19 ms | Đạt (x64) · **BL335 1.0.0 (T079): giữ 40 TLS im lặng từ IP A 120 s (máy chủ đóng mỗi kết nối sau ≈ 10,4 s, kẻ tấn công mở lại: 486 lần bắt tay), 43/43 đăng nhập từ IP B thành công, tệ nhất 1.198 ms (thường ≈ 680 ms, phần lớn là Argon2id); RSS ổn định +0,3–0,7 MB** · **Đạt** BL335 |
| Cắt mạng 50 lần (L6) | 100 % nối lại ≤ 35 s, 0 slot rò | — | Chưa đo x64 (T078) · BL335 cần người (T086, B7) |
| Soak | 7 ngày (MVP), 30 ngày (thương mại) | xem [011-soak.md](011-soak.md) | Chưa đo |

eMMC (§6.3) ở [011-soak.md](011-soak.md) §4.

## 2. Kịch bản L1–L8 trên x64 (tiền kiểm)

Chưa đo — chờ T075 (L1 1 giờ, L3, L4, L5, L8), T077, T078 (L6). Kết quả sẽ ghi vào `docs/reports/011-load-x64.json`.

| Mã | Lệnh dự kiến | Kết quả |
|---|---|---|
| L1 | `load-tester --tags 500 --clients 10` 1 giờ trên `projects/soak-standard` (L2 dùng `projects/bench-1000`; cả hai sinh bằng `tools/gen-bench-projects.mjs`) | Chưa đo |
| L3 | `load-tester --clients 10 --extra-attempts 50` | Chưa đo |
| L4 | `tests/web-it/f5-storm.mjs` 50 vòng | Chưa đo |
| L5 | `tests/web-it/svg-load.mjs` 300–500 phần tử | Chưa đo |
| L6 | 50 lần ngắt/nối mạng Docker | Chưa đo (T078) |
| L7 | L1 + `projects/logic-load` | Chưa đo (T147); engine đã đo ở §1 |
| L8 | 40 TLS im lặng | Đạt bằng ctest `conn_limit_test`; lượt `load-tester` riêng chưa chạy |

Số x64 của 010 (runtime 0.9.0, tham khảo, không thay số 011): 10 client live + 2 truy vấn lịch sử 10 phút, 200 Tag: VmHWM 106 MB, 0 mất sequence (`010-load-200tags-x64.json`).

## 3. BL335

Runtime 1.0.0, đo 2026-10-17 20:12 đến 2026-10-18 01:40 (+07) từ máy dev macOS cùng LAN (T079, T148). Cách đo CPU: script chỉ đọc trên thiết bị lấy `/proc/<pid>/stat` và `/proc/stat` mỗi 5 s (L4, L5, L8: 2 s); "một lõi" là % của một lõi, "cả máy" là % của 2 lõi; đỉnh là cửa sổ 10 s. Ngưỡng CPU của Master Plan §6.2 ghi cho "2 × Cortex-A7" nên đọc theo cả máy; bảng ghi cả cách đọc chặt (một lõi). `runtime.json` của thiết bị giữ nguyên, chỉ thêm tạm `"maxLiveClientsPerSource": 10` trong lúc đo (load-tester chạy từ một máy) rồi khôi phục. `mat-sample` chưa cài (dùng script lấy mẫu riêng, đã xóa); L2 ở T080; L6 cần người (T086).

**Phát hiện khi cài:** gói runtime 1.0.0 (`deployment/package-runtime.ps1`) không chép `schemas/0.6/` (chỉ 0.1–0.5 và bộ gốc 1.0), nên trên thiết bị mọi project định dạng 0.6 (gồm `soak-standard`, `bench-1000` của `tools/gen-bench-projects.mjs` và project của 010) bị từ chối ở bước validate: `E_SCHEMA` "Không nạp được schema project". Đo bằng `soak-standard` chuyển sang 1.0.0 (nội dung giữ nguyên). Cần sửa gói trước rc.

### 3.1 T079: L1, L3, L4, L5, L8

| Mã | Điều kiện | Kết quả | Trạng thái |
|---|---|---|---|
| L1 | `load-tester -tags 500 -clients 10 -extra 1 -latency`, 4 giờ (14.401 s), project `soak-std10` (500 Tag, lưu trữ 200 Tag, 3 màn hình) | CPU trung bình 28,9 % một lõi (14,5 % cả máy), đỉnh 50,4 % một lõi; RSS 12,4 → 19,5 MB, đi ngang từ giờ thứ 2; luồng 109, FD 26–27; MemAvailable ≥ 859 MB; 0 mất sequence; trễ tương đối p50 23, p95 43, tối đa 115 ms (576.002 mẫu); `liveLagP95Ms` phía máy chủ ≤ 53 ms; client 11 bị 4429 | **Đạt** (một lõi sát ngưỡng: 28,9/30) |
| L1 phụ | 8080 và 8443 xen kẽ | load-tester chỉ mở `ws://` 8080; HTTPS 8443 có ở L4, L5, L8 | Chưa đo |
| L3 | 10 client giữ, 50 lần client 11; rồi 10 vòng client 1 rời | 50/50 đóng 4429; vào lại sau khi client 1 đóng sạch 28–83 ms, sau khi client 1 im lặng 15,2 s | **Đạt** |
| L4 | 10 trang Chrome headless (ngữ cảnh riêng, cache tắt), màn `tong-quan` 250 item qua HTTPS, F5 cùng lúc 50 vòng | 500 lần tải: trung vị 647, p95 795, tối đa 935 ms; 0 vượt 5 s; 0 trang 4429. Runtime trong cơn F5: CPU 61 % một lõi (đỉnh 69,6), RSS ≤ 16,9 MB | **Đạt** |
| L5 | Màn `anim` 400 phần tử SVG, 50 hoạt ảnh trên runtime thật (project `svg-l5`) | 10 tiến trình Chrome riêng: 53,4–54,3 FPS; 1 trang + 9 client 500 Tag: 60 FPS; 10 trang trong một tiến trình: 10,7 FPS (giới hạn của máy đo, CPU runtime 2,8 % một lõi) | **Đạt** (RSS tab chưa đo) |
| L8 | 40 TLS im lặng từ IP A giữ liên tục 120 s, đăng nhập thật từ IP B (giao diện mạng thứ hai) mỗi ≈ 2,7 s | 43/43 đăng nhập 200, tệ nhất 1.198 ms; đăng nhập từ chính IP A 616 ms; máy chủ đóng TLS im lặng sau ≈ 10,4 s; RSS ổn định +0,3–0,7 MB; CPU 36,5 % một lõi do bắt tay lặp lại | **Đạt** |

### 3.2 T148: L7 logic tối đa

A/B/A/B, mỗi pha 15 phút, cùng tải L1 (10 client 500 Tag): `soak-std10` và `soak-logic` (= `soak-std10` + `logic.json` của `projects/logic-load`: 550 khối + 200 Tag nội bộ). Vòng quét đọc từ `GET /api/v1/logic` mỗi 30 s.

| Pha | CPU trung bình (một lõi) | RSS trung bình / cuối | Vòng quét lastMs (min / trung vị / max), p99 |
|---|---|---|---|
| 1 không logic | 28,6 % | 12,8 / 14,0 MB | — |
| 2 logic | 33,1 % | 16,9 / 18,2 MB | 8,0 / 15,6 / 21,8 ms, p99 ≤ 30,8 ms |
| 3 không logic | 28,4 % | 12,8 / 14,1 MB | — |
| 4 logic | 33,6 % | 17,7 / 19,0 MB | 10,4 / 16,4 / 21,1 ms, p99 ≤ 25,1 ms |

Chênh: **CPU +4,9 điểm một lõi = +2,4 điểm cả máy** (ngưỡng +3: Đạt theo cả máy, Không đạt theo một lõi); **RSS +4,5 MB** (ngưỡng +5: Đạt sát); **vòng quét ≈ 16 ms trung vị, p99 tới 31 ms (ngưỡng 5 ms): Không đạt**. Cả 550 khối `OK`, 0 mất sequence ở mọi pha.

Giới hạn và phương án:

- Số engine x64 (0,16 ms trung bình, `011-logic-load-x64.json`) không chuyển sang Cortex-A7: một lần quét 550 khối cộng publish ≈ 650 đầu ra mất 8–22 ms. Phương án: đo `logic_perf_test` bản armhf trên thiết bị để tách phần engine và phần publish; tối ưu đường nóng (đọc Tag theo chỉ số thay vì theo tên, chỉ publish đầu ra đổi giá trị); hoặc hạ cấu hình tối đa được hứa trên BL335 (FR-095) và ghi vào tài liệu.
- Logic quét trong vòng Tag Engine (`server/main.cpp`, chu kỳ `deltaPeriodMs` = 250 ms trong `runtime.json` của thiết bị và của `deployment/config/runtime.json`), nên `logic.scanMs` 100 thực tế thành 250 ms và bộ đếm `overrun` tăng ≈ 4 lần/s dù không lần quét nào quá 100 ms. Cần quyết định: tách nhịp quét logic khỏi vòng delta, hoặc ghi rõ chu kỳ quét thực = max(`logic.scanMs`, `deltaPeriodMs`) và không đếm overrun trong trường hợp đó.

**Tối ưu và tách chu kỳ (2026-10-18, nhánh `gd6-logic-perf`).** Đo bằng `logic_bench` (`server/bench/logic_bench.cpp`, chỉ build khi gọi đích, không đóng gói) trên project `logic-l1` (`tools/gen-bench-projects.mjs --only logic-l1`: đúng `logic.json` của `logic-load` trên 500 Tag mô phỏng + 200 Tag nội bộ, `--sim-load` như thiết bị). Nạp project như `mat-runtime` (validate, activate, `RuntimeEngine`), 3.000 vòng, chạy đứng riêng trong `/tmp` của BL335 bên cạnh runtime đã cài (không tải L1; một phép thử OTA của agent khác khởi động lại `mat-runtime` trong vài lần đo, số chỉ là cận dưới). Số đầy đủ: `011-logic-bl335.json` mục `benchT148`.

| Đo (ms, trung bình / p99) | BL335 trước | BL335 sau | x64 trước | x64 sau |
|---|---|---|---|---|
| `scan.lastMs` (đúng số `GET /logic` báo) | 8,48 / 18,5 | 2,32 / 2,9–4,7 | 0,246 / 0,32 | 0,033 / 0,047 |
| trong đó `logic::Engine::step` | 5,56 | 2,00 | 0,149 | 0,030 |
| publish Tag logic | 1,55 | 0,24 | 0,047 | 0,003 |
| cảnh báo (`LOGIC_THROTTLED`, …) | 1,36 | 0,08 | 0,049 | 0,001 |
| một vòng Tag Engine có logic / không logic | 10,9 / 1,77 | 4,74 / 1,76 | 0,29 / 0,04 | 0,077 / 0,040 |
| CPU của logic trong vòng tick (ms mỗi giây) | 36,6 (4 quét/s) | 20,5 (10 quét/s) | — | 0,29 |

(x64 = Docker arm64 trên máy Mac. "Trước" của dòng CPU tính từ 4 × (vòng có logic − vòng không logic); "sau" đo trực tiếp vòng tick 300 s mô phỏng. 10 ms/s = 1 điểm CPU một lõi.)

Đã sửa:

- Engine (`core/logic`): mỗi tên Tag thành một "slot" khi dựng engine; quét không tra tên nào, ảnh chụp đọc một lần mỗi quét theo chỉ số; một biểu thức không chạy VM khi không đầu vào nào đổi (ngôn ngữ biểu thức không trạng thái, không đồng hồ); VM dùng ngăn xếp của luồng và đọc đầu vào không sao chép; lịch đọc JSON một lần, giữ kết quả theo phút; timer theo enum. Kết quả giống hệt: vector chung `tests/logic-vectors` xanh ở C++ (287) và TS (396).
- Glue (`server/logic_glue`): đọc Tag theo chỉ số model, chỉ publish đầu ra đổi giá trị (Tag Engine vốn bỏ qua đầu ra không đổi), tìm luật THROTTLED không dựng trạng thái 550 khối.
- Chu kỳ: vòng tick (`server/tick_schedule.hpp`) chạy thêm một vòng Tag Engine ở mỗi bội của `logic.scanMs` khi project có logic (vòng chỉ cho logic không bước driver mô phỏng; `hub.tick`, cảnh báo, bảo trì vẫn theo `deltaPeriodMs`). Logic chấp nhận vòng đến sớm tối đa 5 ms (đồng hồ của vòng tick khác đồng hồ của logic); `overrun` chỉ đếm quét lâu hơn `scanMs` hoặc trễ trọn một chu kỳ; `GET /logic` thêm `scan.intervalMs` (chu kỳ thực, trung bình 100 khoảng gần nhất) và `scan.scans`.

Còn lại: một biểu thức tốn ≈ 1 µs VM trên Cortex-A7, một khối không chạy VM ≈ 1–1,5 µs (không do cache); quét 550 khối ≈ 2,3 ms khi rảnh. Dưới L1 lần đo trước thời gian quét gấp ≈ 1,9 lần lúc rảnh, nên dự kiến ≈ 4–4,5 ms (sát ngưỡng 5 ms) và CPU ≈ +2,7 điểm một lõi; **phải đo lại A/B/A/B L1 với runtime build từ nhánh này** trước khi kết luận T148.

### 3.3 T122: OTA thật (SC-023)

2026-10-18 01:56–02:48, runtime 1.0.0, project `tank-demo` 0.1.0 (rảnh). 10 gói `.matupdate` armhf 5,8 MB (releaseSeq 2 đến 11, khóa thử) gửi qua API của Studio (tải lên, `apply` có mật khẩu, `GET /system/update`), quay về bằng tay sau lần thứ 5. Chi tiết: `011-ota-bl335.json`; số đo và quyết định ở ADR-035 mục "Số đo".

| Đo | Kết quả | Ngưỡng | Trạng thái |
|---|---|---|---|
| Cập nhật thành công | 10/10 `committed`, kiểm sức khỏe đạt; quay về 6 → 5 `committed` | 10/10 | **Đạt** |
| Ngừng (apply tới khi `system/info` trả releaseSeq mới, project active, HTTPS trả lời) | 13,2–15,9 s, trung bình 14,5 s; dịch vụ thật sự không trả lời 1,0–1,3 s | ≤ 30 s | **Đạt** |
| Toàn bộ (tải lên tới commit) | 21,1–24,0 s, trung bình 22,4 s | ≤ 120 s | **Đạt** |
| Audit | mỗi lần `accepted`, `applying`, `committed`; quay về `manual-rollback`; `auth.reauth` | đủ | **Đạt** |

## 4. Kết luận

Chưa kết luận toàn bộ. BL335 1.0.0 (2026-10-18): L1 4 giờ, L3, L4, L5, L8 Đạt; L7 (T148) Không đạt ở vòng quét logic (≈ 16 ms/5 ms) và ở CPU nếu đọc theo một lõi (§3.2). Trước đó: không chỉ tiêu nào có số đo vượt ngưỡng; các số tham khảo của 0.9.0 cách ngưỡng xa (RSS ~12 MB/150, CPU ~13 %/30). Kết luận Đạt/Không đạt cho từng dòng §1 sau T075, T079, T080, T147, T148; tổng hợp ngân sách và dòng "Cập nhật 011" ở ADR-005 làm ở T201.
