# Tải và ngân sách tài nguyên, feature 011 (T087, T201: khung)

**Trạng thái: x64 đã đo (T075, T078, T147; 2026-10-17/18, nhánh `gd6-docker-runs`), BL335 chưa đo.** Khung lập 2026-10-17 trên `gd6` (commit `c86ebe85`). Lượt x64 chạy trong Docker `mat-armhf` **Linux arm64 trên Mac Apple Silicon (không phải x64 thật)**, runtime Release của nhánh này; số x64 không thay số BL335 (T079, T080, T148 chưa chạy). Khi có số mới thì thay ô "Chưa đo" và cập nhật cột Trạng thái; không xóa số tham khảo.

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
| `mat-runtime` RSS, 10 client | ≤ 150 MB | 1.0.0 rảnh: **9,5 MB**, 99 luồng (0.9.0: 8,1 MB, 73 luồng; tăng do `httpsThreads` 64). 0.9.0 tải 30 phút 10 Chrome 509 Tag: 11,6 MB (tối đa 12,1); 0.9.0 10 client + alarm + lịch sử 15 phút: 9,1 MB (tối đa 9,5); VmHWM lúc khởi động 27 MB. **x64 1.0.0, L1 1 giờ: tối đa 25 MB** (Linux arm64 64 bit trong Docker) | Đạt x64 · Chưa đo BL335 — L1 4 giờ (T079) |
| SQLite page cache | ≤ 32 MB | Cấu hình: `history.db` 8 MiB (`cache_size=-8192`), `audit.db` 256 KiB; kết nối truy vấn lịch sử dùng chung giới hạn của Historian | Đạt theo cấu hình; chưa đo thực tế |
| tmpfs (log, staging, `/run/mat-sample`) | ≤ 64 MB | — | Chưa đo — T081 (`mat-sample` ghi `tmpfsKb`) |
| RAM còn dự phòng | ≥ 400 MB | 0.9.0 dưới tải: MemAvailable thấp nhất 875 MB | Đạt (tham khảo 0.9.0); đo lại ở L1 |
| Hàng đợi gửi mỗi client WebSocket | ≤ 256 KB | `sendQueueBytes` mặc định 262144, trần cấu hình 262144 (`server/config.cpp`) | Đạt theo cấu hình |

### 6.2 CPU

| Chỉ tiêu | Ngưỡng | Số đo đã có | Trạng thái |
|---|---|---|---|
| 500 Tag, polling 1 s, 10 client (L1) | trung bình ≤ 30 %, đỉnh ≤ 60 % | **x64 1.0.0, L1 1 giờ** (soak-standard 500 Tag, 10 client load-tester): `mat-runtime` 4,3 % một lõi trung bình, đỉnh cửa sổ 5 s 5,8 %; RSS 12,2 → 25 MB (tối đa 25), 107 luồng. 1.0.0 rảnh BL335: 0,7 %. 0.9.0 BL335, 509 Tag, 10 Chrome, 30 phút: 12,8 % | Đạt x64 · Chưa đo BL335 4 giờ (T079) |
| 1.000 Tag, 10 client (L2) | trung bình ≤ 50 % (mục tiêu) | — | Chưa đo — T080 |
| Logic tối đa trên L1 (L7) | ≤ +3 điểm CPU, ≤ +5 MB RSS, vòng quét ≤ 5 ms | **Runtime x64 (logic-load so với không logic, 10 client, 600 s): +1,22 điểm CPU, +30 MB RSS (11,7 → 41,7 MB), vòng quét p99 3,3 ms** (`011-logic-load-x64.json` khóa `runtime`). Engine riêng: p99 0,62 ms | **Không đạt x64 (RSS)** · Chưa đo BL335 (T148) |
| 10 client tải lại cùng lúc (L4) | ≤ 5 s, không timeout WebSocket | **x64: 10 trang × 50 vòng màn 250 item: 500/500 có dữ liệu sống, p50 368 ms, p95 449 ms, tối đa 494 ms, 0 lần 4429**. 0.9.0 BL335: 10 F5 màn 3b tệ nhất 1,13 s | Đạt x64 · Chưa đo BL335 (T079) |

### 6.4 Chỉ tiêu benchmark tổng hợp

| Chỉ tiêu | Ngưỡng | Số đo đã có | Trạng thái |
|---|---|---|---|
| 500 Tag (MVP), thử 1.000 | chạy được | 0.9.0: 509 Tag mô phỏng 30 phút, 0 mất sequence trên 72.207 delta | Chưa đo trên 1.0.0 (T079, T080) |
| Client đồng thời 10, client 11 bị từ chối (L3) | 4429 ở 100 % của 50 lần; client mới vào ≤ 35 s sau khi client 1 ngắt | **x64: 50/50 lần client 11 nhận 4429**, 10 client giữ 0 mất sequence; phần "vào lại ≤ 35 s" chưa có trong công cụ (`notMeasured`) | Đạt một phần x64 · Chưa đo BL335 (T079) |
| SVG 300–500 phần tử/màn (L5) | ≥ 30 FPS với 50 animation | **Máy dev, runtime giả: 400 phần tử, 50 hoạt ảnh, 1 trang 60 FPS (60 s)**; 10 trang Chrome headless trên cùng một máy Mac: 11,7–11,9 FPS mỗi trang (giới hạn của máy chạy 10 trình duyệt, không GPU). 008: 100 animation 100 FPS 30 phút | Đạt (một trang/máy trạm) · 10 trang/một máy không đạt — xem §2 |
| Mở màn hình trên Chrome | ≤ 2 s (LAN 100 Mbps) | 0.9.0 BL335, cache trống: màn 3b trung vị 615 ms (tối đa 846); 40 item SVG 1.216 ms; SVG 1 MiB trung vị 1.362 ms (tối đa 1.675) | Đạt (tham khảo 0.9.0); đo lại 1.0.0 ở T079 |
| Trễ Tag → hiển thị | ≤ chu kỳ polling + 500 ms | 0.9.0: live p95 297 ms (10 client, 15 phút); Tag đổi → banner alarm p50 297, p95 358 ms | Đạt (tham khảo 0.9.0); X3 đo trong pilot (T196) |
| Giới hạn nguồn: 40 TLS im lặng (L8) | đăng nhập máy khác ≤ 2 s; RAM ≤ +1 MB | **x64 runtime thật: 40 TLS im lặng từ IP lan, đăng nhập từ IP pub 82 ms; RSS +708 kB khi 40 kết nối còn mở**; runtime đóng cả 40 trong ≤ 20 s. `conn_limit_test`: 60 TLS, nguồn khác 25 ms | Đạt (x64) · Chưa đo BL335 (T063) |
| Cắt mạng 50 lần (L6) | 100 % nối lại ≤ 35 s, 0 slot rò | **Đạt (x64)**: 500/500 nối lại, 0 lần > 35 s (p50 5390 ms, p95 8449 ms, tối đa 8707 ms), slot rò 0; `docker network disconnect` 10 s × 50 với 10 client (`011-flap-x64.json`). Lượt đầu (máy đang build ASan -j2, 25 lần OOM-kill) 16/500 lần > 35 s, tối đa 58 s, 0 slot rò | Đạt x64 · BL335 cần người (T086, B7) |
| Soak | 7 ngày (MVP), 30 ngày (thương mại) | xem [011-soak.md](011-soak.md) | Chưa đo |

eMMC (§6.3) ở [011-soak.md](011-soak.md) §4.

## 2. Kịch bản L1–L8 trên x64 (tiền kiểm)

Đo 2026-10-17/18 (T075, T078, T147; nhánh `gd6-docker-runs`), `node tools/load/x64.mjs` (rig `tests/web-it/compose.yaml`, slot riêng `mat-load-x64`) và `node tools/logic-it/run.mjs --scenario load`; runtime Release 1.0.0 của nhánh này; Docker `mat-armhf` **Linux arm64 trên Mac Apple Silicon, 4 CPU, 2,8 GB RAM, không phải x64 thật**; máy rảnh trong lúc đo (trừ ghi chú). CPU là % **một lõi** của riêng `mat-runtime` (`/proc/<pid>/stat`), không phải CPU toàn máy. Kết quả: `docs/reports/011-load-x64.json`, `011-flap-x64.json`, `011-logic-load-x64.json`.

| Mã | Lệnh | Kết quả x64 |
|---|---|---|
| L1 | `load-tester -tags 500 -clients 10 -extra 1 -duration 3600 -latency` trên soak-standard, `proc-sample.mjs` 5 s | **Đạt**: 1 giờ, 10 client nhận, client 11 bị 4429, 0 mất sequence (143.999 delta đo trễ: p50 3 ms, p95 7 ms, tối đa 48 ms, tương đối); CPU 4,3 % (đỉnh cửa sổ 5 s 5,8 %); RSS 12,2 → 25 MB (tối đa 25 MB), 107 luồng; `liveLagP95Ms` 10. Chưa đo: xen kẽ 8080/8443 (load-tester chỉ mở ws:// 8080), CPU toàn máy |
| L3 | `load-tester -clients 10 -extra 1 -extra-attempts 50` | **Đạt một phần**: 50/50 client thừa nhận 4429; "client mới vào ≤ 35 s sau khi client 1 ngắt" chưa có trong công cụ |
| L4 | `tests/web-it/f5-storm.mjs --pages 10 --rounds 50` (màn 250 item, Chrome headless 155) | **Đạt**: 500/500 lần F5 có dữ liệu sống, p50 368 ms, p95 449 ms, tối đa 494 ms, 0 lần 4429. Chưa đo: CPU/RSS runtime trong lúc F5 |
| L5 | `tests/web-it/svg-load.mjs --elements 400 --animations 50` (trang thật trên runtime GIẢ của e2e) | 1 trang: **60 FPS**. 10 trang trên cùng một máy Mac (không GPU): 11,7–11,9 FPS mỗi trang (~118 khung/s tổng) — giới hạn của máy chạy 10 trình duyệt; ngưỡng 30 FPS là của từng máy trạm. Chưa đo: RSS tab, 10 client vào runtime thật |
| L6 | `load-tester -clients 10 -flap 50 -flap-mode external`, container bị `docker network disconnect` 10 s rồi nối lại, 50 lần (T078) | **Đạt** (máy rảnh): 500/500 nối lại, 0 lần > 35 s (p50 5,4 s, p95 8,4 s, tối đa 8,7 s, tính cả thời gian cắt), 0 slot rò sau 25 s. Lượt đầu khi máy quá tải (build ASan, 25 lần OOM-kill): 500/500 nối lại nhưng 16 lần > 35 s (tối đa 58 s), 0 slot rò — ghi trong `previousRuns` |
| L7 | `logic-it load`: projects/logic-load (550 khối: 200 luật, 100 timer, 100 counter, 50 totalizer, 50 giờ chạy, 50 lịch trên 100 Tag mô phỏng) so với cùng project không có `logic.json`, 10 client, 600 s mỗi bên (T147) | CPU **+1,22 điểm** (1,67 → 2,89 %, đạt ≤ +3); vòng quét p99 lớn nhất 3,3 ms (lượt trước 5,48 ms), lần quét lâu nhất 4,2 ms; **RSS +30 MB** (11,7 → 41,7 MB trung bình, tối đa 48 MB) — **không đạt** ≤ +5 MB của SC-028 ở x64. `scan.overrun` 2.430 trong 600 s (chu kỳ 100 ms): vòng logic theo nhịp vòng của Tag Engine, chưa phân tích. Số BL335 là T148 |
| L8 | `tests/load-x64/l8.mjs`: 40 TLS im lặng từ IP lan, đăng nhập từ IP pub | **Đạt**: đăng nhập 82 ms; RSS +708 kB khi 40 kết nối còn mở; runtime tự đóng cả 40 trong ≤ 20 s |

**Phát hiện cần xử lý (chưa sửa ở lượt này):** RSS của cấu hình logic tối đa tăng ~30 MB trên Linux arm64 64 bit (trần SC-028 là +5 MB). Cần đo trên armhf/BL335 (T148) và tìm nguồn (dự đoán: chương trình biểu thức và bảng trạng thái của 550 khối, bản sao `RetainMap` mỗi lần flush) trước khi kết luận SC-028.

Số x64 của 010 (runtime 0.9.0, tham khảo, không thay số 011): 10 client live + 2 truy vấn lịch sử 10 phút, 200 Tag: VmHWM 106 MB, 0 mất sequence (`010-load-200tags-x64.json`).

## 3. BL335

Chưa đo — T079 (L1 4 giờ, L3, L4, L5, L8), T080 (L2), T148 (L7). Đã có trên 1.0.0 (2026-10-17, `device-changes.md`): cài bằng `deploy.sh` 13 s, health sau 1 s, số rảnh ở §1, `mat-update-verify` ≈ 16 ms/lần kiểm, kiểm Host 421/200 đúng.

## 4. Kết luận

Chưa kết luận cho BL335. Tiền kiểm x64 (Linux arm64 trong Docker trên Apple Silicon) đạt L1, L4, L6, L8, L3 phần 4429, L5 một trang; **một chỉ tiêu vượt ngưỡng ở x64: RSS thêm của logic tối đa (+30 MB so với +5 MB, L7)** — cần đo armhf (T148) và tìm nguồn trước T201. Các số tham khảo của 0.9.0 trên BL335 cách ngưỡng xa (RSS ~12 MB/150, CPU ~13 %/30). Kết luận Đạt/Không đạt cho từng dòng §1 sau T075, T079, T080, T147, T148; tổng hợp ngân sách và dòng "Cập nhật 011" ở ADR-005 làm ở T201.
