# Tải và ngân sách tài nguyên, feature 011 (T087, T201: khung)

**Trạng thái: khung, chưa kết luận.** Lập 2026-10-17 trên nhánh `gd6` (commit `c86ebe85`). Cập nhật 2026-10-18 (nhánh `gd6-bl335`): số BL335 1.0.0 của T079 (L1 4 giờ, L3, L4, L5, L8) và T148 (L7), dữ liệu thô `011-load-bl335.json`, `011-logic-bl335.json`. Các lượt x64 (T075, T077, T078) và BL335 (T079, T080, T148) chưa chạy; số dưới đây là số **đã đo trước đó**, ghi rõ phiên bản. Khi có số mới thì thay ô "Chưa đo" và cập nhật cột Trạng thái; không xóa số tham khảo.

**x64 (nhánh `gd6-docker-runs`):** đã đo T075, T078, T147 (2026-10-17/18). Khung lập 2026-10-17 trên `gd6` (commit `c86ebe85`). Lượt x64 chạy trong Docker `mat-armhf` **Linux arm64 trên Mac Apple Silicon (không phải x64 thật)**, runtime Release của nhánh này; số x64 không thay số BL335 (T079, T080, T148 chưa chạy). Khi có số mới thì thay ô "Chưa đo" và cập nhật cột Trạng thái; không xóa số tham khảo.

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
| `mat-runtime` RSS, 10 client (x64) | ≤ 150 MB | 1.0.0 rảnh: **9,5 MB**, 99 luồng (0.9.0: 8,1 MB, 73 luồng; tăng do `httpsThreads` 64). 0.9.0 tải 30 phút 10 Chrome 509 Tag: 11,6 MB (tối đa 12,1); 0.9.0 10 client + alarm + lịch sử 15 phút: 9,1 MB (tối đa 9,5); VmHWM lúc khởi động 27 MB. **x64 1.0.0, L1 1 giờ: tối đa 25 MB** (Linux arm64 64 bit trong Docker) | Đạt x64 · Chưa đo BL335 — L1 4 giờ (T079) |
| SQLite page cache | ≤ 32 MB | Cấu hình: `history.db` 8 MiB (`cache_size=-8192`), `audit.db` 256 KiB; kết nối truy vấn lịch sử dùng chung giới hạn của Historian | Đạt theo cấu hình; chưa đo thực tế |
| tmpfs (log, staging, `/run/mat-sample`) | ≤ 64 MB | — | Chưa đo — T081 (`mat-sample` ghi `tmpfsKb`) |
| RAM còn dự phòng | ≥ 400 MB | 1.0.0 L1 4 giờ: MemAvailable thấp nhất 859 MB (0.9.0: 875 MB) | **Đạt** (BL335 1.0.0) |
| Hàng đợi gửi mỗi client WebSocket | ≤ 256 KB | `sendQueueBytes` mặc định 262144, trần cấu hình 262144 (`server/config.cpp`) | Đạt theo cấu hình |

### 6.2 CPU

| Chỉ tiêu | Ngưỡng | Số đo đã có | Trạng thái |
|---|---|---|---|
| 500 Tag, polling 1 s, 10 client (L1) | trung bình ≤ 30 %, đỉnh ≤ 60 % | **1.0.0 L1 4 giờ (T079): trung bình 28,9 % một lõi = 14,5 % cả máy (2 lõi), đỉnh cửa sổ 10 s 50,4 % một lõi**; mỗi giờ 28,9–29,0 %. Cách đọc chặt (một lõi) còn cách ngưỡng 1,1 điểm. 1.0.0 rảnh: 0,7 % một lõi (60 s). 0.9.0, 509 Tag, 10 Chrome, 30 phút: 12,8 % một lõi (chưa có đỉnh, chưa đủ 4 giờ) | **Đạt** BL335 (T079, cả hai cách đọc) · x64 chưa đo (T075) |
| 500 Tag, polling 1 s, 10 client (L1) (x64) | trung bình ≤ 30 %, đỉnh ≤ 60 % | **x64 1.0.0, L1 1 giờ** (soak-standard 500 Tag, 10 client load-tester): `mat-runtime` 4,3 % một lõi trung bình, đỉnh cửa sổ 5 s 5,8 %; RSS 12,2 → 25 MB (tối đa 25), 107 luồng. 1.0.0 rảnh BL335: 0,7 %. 0.9.0 BL335, 509 Tag, 10 Chrome, 30 phút: 12,8 % | Đạt x64 · Chưa đo BL335 4 giờ (T079) |
| 1.000 Tag, 10 client (L2) | trung bình ≤ 50 % (mục tiêu) | — | Chưa đo — T080 |
| Logic tối đa trên L1 (L7) | ≤ +3 điểm CPU, ≤ +5 MB RSS, vòng quét ≤ 5 ms | Engine x64 (550 khối, 3.000 quét): trung bình 0,16 ms, p99 0,62 ms, tối đa 0,90 ms (`011-logic-load-x64.json`). **BL335 1.0.0 (T148, A/B/A/B 15 phút, L1 + 550 khối của `logic-load`): thêm CPU +4,9 điểm một lõi = +2,4 điểm cả máy; thêm RSS +4,5 MB; vòng quét trung vị 15,6–16,4 ms, lastMs tối đa 21,8 ms, p99 tới 30,8 ms** | **Không đạt** vòng quét (≈ 3–6 lần ngân sách 5 ms) · CPU Đạt theo cả máy, Không đạt theo một lõi · RSS Đạt sát ngưỡng; xem §3.2 · x64 CPU/RSS: dòng dưới (T147) · Sau tối ưu (nhánh `gd6-logic-perf`, `logic_bench` trên BL335 rảnh): quét 8,5 → 2,3 ms trung bình, logic chạy đúng chu kỳ 100 ms; chờ đo lại dưới L1 |
| Logic tối đa trên L1 (L7) (x64) | ≤ +3 điểm CPU, ≤ +5 MB RSS, vòng quét ≤ 5 ms | **Runtime x64 sau sửa (nhánh `gd6-logic-rss`, logic-load so với không logic, 10 client, 600 s, hai bên cùng hỏi HTTPS mỗi 5 s): +1,43 điểm CPU (1,34 → 2,77 %), RSS +4,6 MB trung bình (13,6 → 18,2 MB; tối đa +5,3 MB), phần ẩn danh +4,3 MB; vòng quét p99 lớn nhất 1,38 ms, overrun 0** (`011-logic-load-x64.json` khóa `runtime`). Trước sửa: +30 MB (11,7 → 41,7 MB) do arena glibc mỗi luồng HTTPS, xem §2 L7. Engine riêng: p99 0,62 ms <br>**L1 đầy đủ 1 giờ (2026-10-18, nhánh `gd6-x64-final`, khóa `runtimeL1`): `soak-std10` so với `soak-logic` (500 Tag, 10 client, như T148): CPU +1,11 điểm (4,23 → 5,34 %), RSS +5,4 MiB trung bình (22,6 → 28,1 MB; tối đa +5,6 MiB; RssAnon +5,4 MiB), vòng quét p99 lớn nhất 2,92 ms, overrun 1/36.047, 0 mất sequence** | 600 s: Đạt x64 (4,6/5 MB) · **L1 1 giờ: Không đạt RSS x64** (5,4/5 MB; CPU, quét Đạt) · BL335 Đạt (T148, +3,8 MB) |
| 10 client tải lại cùng lúc (L4) | ≤ 5 s, không timeout WebSocket | 0.9.0 BL335: 10 F5 cùng lúc màn 3b tệ nhất 1,13 s; SVG 1 MiB 2,0 s. **1.0.0 BL335 (T079): 10 trang × 50 vòng màn 250 item, cache trống: trung vị 647 ms, p95 795 ms, tối đa 935 ms, 0 lần vượt, 0 trang 4429** | **Đạt** BL335 · x64 chưa đo (T075) |
| 10 client tải lại cùng lúc (L4) (x64) | ≤ 5 s, không timeout WebSocket | **x64: 10 trang × 50 vòng màn 250 item: 500/500 có dữ liệu sống, p50 368 ms, p95 449 ms, tối đa 494 ms, 0 lần 4429**. 0.9.0 BL335: 10 F5 màn 3b tệ nhất 1,13 s | Đạt x64 · Chưa đo BL335 (T079) |

### 6.4 Chỉ tiêu benchmark tổng hợp

| Chỉ tiêu | Ngưỡng | Số đo đã có | Trạng thái |
|---|---|---|---|
| 500 Tag (MVP), thử 1.000 | chạy được | 0.9.0: 509 Tag mô phỏng 30 phút, 0 mất sequence trên 72.207 delta. 1.0.0 BL335: 500 Tag 4 giờ 10 client, 0 mất sequence (T079) | **Đạt** 500 Tag (BL335) · 1.000 Tag chưa đo (T080) |
| 500 Tag (MVP), thử 1.000 (x64) | chạy được | 0.9.0: 509 Tag mô phỏng 30 phút, 0 mất sequence trên 72.207 delta | Chưa đo trên 1.0.0 (T079, T080) |
| Client đồng thời 10, client 11 bị từ chối (L3) | 4429 ở 100 % của 50 lần; client mới vào ≤ 35 s sau khi client 1 ngắt | `load-tester --extra-attempts` có; phần "vào lại ≤ 35 s" có từ 2026-10-18 (`-reentry N`, đóng sạch và im lặng), chưa chạy lại bằng công cụ, số dưới đây đo bằng script riêng cùng cách. **BL335 1.0.0 (T079): 50/50 lần 4429; vào lại 10 vòng: client 1 đóng sạch 28–83 ms, client 1 im lặng (như đứt cáp) 15,19–15,20 s (hết hạn heartbeat 15 s)** | **Đạt** BL335 · x64 chưa đo (T075) |
| Client đồng thời 10, client 11 bị từ chối (L3) (x64) | 4429 ở 100 % của 50 lần; client mới vào ≤ 35 s sau khi client 1 ngắt | **x64: 50/50 lần client 11 nhận 4429**, 10 client giữ 0 mất sequence; phần "vào lại ≤ 35 s" chưa đo ở x64 (công cụ có `-reentry` từ 2026-10-18; `tools/load/x64.mjs --scenario L3` chạy kèm `-reentry 3`) | Đạt một phần x64 · Chưa đo BL335 (T079) |
| SVG 300–500 phần tử/màn (L5) | ≥ 30 FPS với 50 animation | Máy dev (Chrome 155, 008): 100 animation, 100 FPS, 30 phút (`008-anim-x64.json`). **BL335 1.0.0 runtime thật (T079): màn 400 phần tử, 50 hoạt ảnh, 10 tiến trình Chrome headless riêng: thấp nhất 53,4 FPS**; 1 trang + 9 client 500 Tag: 60 FPS; 10 trang trong một tiến trình Chrome: 10,7 FPS (giới hạn máy đo, runtime chỉ 2,8 % một lõi) | **Đạt** BL335 · RSS tab chưa đo |
| SVG 300–500 phần tử/màn (L5) (x64) | ≥ 30 FPS với 50 animation | **Máy dev, runtime giả: 400 phần tử, 50 hoạt ảnh, 1 trang 60 FPS (60 s)**; 10 trang Chrome headless trên cùng một máy Mac: 11,7–11,9 FPS mỗi trang (giới hạn của máy chạy 10 trình duyệt, không GPU). 008: 100 animation 100 FPS 30 phút | Đạt (một trang/máy trạm) · 10 trang/một máy không đạt — xem §2 |
| Mở màn hình trên Chrome | ≤ 2 s (LAN 100 Mbps) | 1.0.0 BL335: F5 màn 250 item tới dữ liệu sống tối đa 935 ms (L4). 0.9.0 BL335, cache trống: màn 3b trung vị 615 ms (tối đa 846); 40 item SVG 1.216 ms; SVG 1 MiB trung vị 1.362 ms (tối đa 1.675) | Đạt (tham khảo 0.9.0); đo lại 1.0.0 ở T079 |
| Mở màn hình trên Chrome (x64) | ≤ 2 s (LAN 100 Mbps) | 0.9.0 BL335, cache trống: màn 3b trung vị 615 ms (tối đa 846); 40 item SVG 1.216 ms; SVG 1 MiB trung vị 1.362 ms (tối đa 1.675) | Đạt (tham khảo 0.9.0); đo lại 1.0.0 ở T079 |
| Trễ Tag → hiển thị | ≤ chu kỳ polling + 500 ms | 0.9.0: live p95 297 ms (10 client, 15 phút); Tag đổi → banner alarm p50 297, p95 358 ms | Đạt (tham khảo 0.9.0); X3 đo trong pilot (T196) |
| Giới hạn nguồn: 40 TLS im lặng (L8) | đăng nhập máy khác ≤ 2 s; RAM ≤ +1 MB | x64 `conn_limit_test`: 60 TLS im lặng, nguồn khác 25 ms; `011-lockout-x64.json` IP B ≤ 19 ms | Đạt (x64) · **BL335 1.0.0 (T079): giữ 40 TLS im lặng từ IP A 120 s (máy chủ đóng mỗi kết nối sau ≈ 10,4 s, kẻ tấn công mở lại: 486 lần bắt tay), 43/43 đăng nhập từ IP B thành công, tệ nhất 1.198 ms (thường ≈ 680 ms, phần lớn là Argon2id); RSS ổn định +0,3–0,7 MB** · **Đạt** BL335 |
| Giới hạn nguồn: 40 TLS im lặng (L8) (x64) | đăng nhập máy khác ≤ 2 s; RAM ≤ +1 MB | **x64 runtime thật: 40 TLS im lặng từ IP lan, đăng nhập từ IP pub 82 ms; RSS +708 kB khi 40 kết nối còn mở**; runtime đóng cả 40 trong ≤ 20 s. `conn_limit_test`: 60 TLS, nguồn khác 25 ms | Đạt (x64) · Chưa đo BL335 (T063) |
| Cắt mạng 50 lần (L6) | 100 % nối lại ≤ 35 s, 0 slot rò | — | Chưa đo x64 (T078) · BL335 cần người (T086, B7) |
| Cắt mạng 50 lần (L6) (x64) | 100 % nối lại ≤ 35 s, 0 slot rò | **Đạt (x64)**: 500/500 nối lại, 0 lần > 35 s (p50 5390 ms, p95 8449 ms, tối đa 8707 ms), slot rò 0; `docker network disconnect` 10 s × 50 với 10 client (`011-flap-x64.json`). Lượt đầu (máy đang build ASan -j2, 25 lần OOM-kill) 16/500 lần > 35 s, tối đa 58 s, 0 slot rò | Đạt x64 · BL335 cần người (T086, B7) |
| Soak | 7 ngày (MVP), 30 ngày (thương mại) | xem [011-soak.md](011-soak.md) | Chưa đo |

eMMC (§6.3) ở [011-soak.md](011-soak.md) §4.

## 2. Kịch bản L1–L8 trên x64 (tiền kiểm)

Đo 2026-10-17/18 (T075, T078, T147; nhánh `gd6-docker-runs`), `node tools/load/x64.mjs` (rig `tests/web-it/compose.yaml`, slot riêng `mat-load-x64`) và `node tools/logic-it/run.mjs --scenario load`; runtime Release 1.0.0 của nhánh này; Docker `mat-armhf` **Linux arm64 trên Mac Apple Silicon, 4 CPU, 2,8 GB RAM, không phải x64 thật**; máy rảnh trong lúc đo (trừ ghi chú). CPU là % **một lõi** của riêng `mat-runtime` (`/proc/<pid>/stat`), không phải CPU toàn máy. Kết quả: `docs/reports/011-load-x64.json`, `011-flap-x64.json`, `011-logic-load-x64.json`.

| Mã | Lệnh | Kết quả x64 |
|---|---|---|
| L1 | `load-tester -tags 500 -clients 10 -extra 1 -duration 3600 -latency` trên soak-standard, `proc-sample.mjs` 5 s | **Đạt**: 1 giờ, 10 client nhận, client 11 bị 4429, 0 mất sequence (143.999 delta đo trễ: p50 3 ms, p95 7 ms, tối đa 48 ms, tương đối); CPU 4,3 % (đỉnh cửa sổ 5 s 5,8 %); RSS 12,2 → 25 MB (tối đa 25 MB), 107 luồng; `liveLagP95Ms` 10. Chưa đo: xen kẽ 8080/8443 (load-tester chỉ mở ws:// 8080), CPU toàn máy |
| L3 | `load-tester -clients 10 -extra 1 -extra-attempts 50` | **Đạt một phần**: 50/50 client thừa nhận 4429; "client mới vào ≤ 35 s sau khi client 1 ngắt" chưa đo ở x64 (lượt này trước khi có `-reentry`; chạy lại `x64.mjs --scenario L3`) |
| L4 | `tests/web-it/f5-storm.mjs --pages 10 --rounds 50` (màn 250 item, Chrome headless 155) | **Đạt**: 500/500 lần F5 có dữ liệu sống, p50 368 ms, p95 449 ms, tối đa 494 ms, 0 lần 4429. Chưa đo: CPU/RSS runtime trong lúc F5 |
| L5 | `tests/web-it/svg-load.mjs --elements 400 --animations 50` (trang thật trên runtime GIẢ của e2e) | 1 trang: **60 FPS**. 10 trang trên cùng một máy Mac (không GPU): 11,7–11,9 FPS mỗi trang (~118 khung/s tổng) — giới hạn của máy chạy 10 trình duyệt; ngưỡng 30 FPS là của từng máy trạm. Chưa đo: RSS tab, 10 client vào runtime thật |
| L6 | `load-tester -clients 10 -flap 50 -flap-mode external`, container bị `docker network disconnect` 10 s rồi nối lại, 50 lần (T078) | **Đạt** (máy rảnh): 500/500 nối lại, 0 lần > 35 s (p50 5,4 s, p95 8,4 s, tối đa 8,7 s, tính cả thời gian cắt), 0 slot rò sau 25 s. Lượt đầu khi máy quá tải (build ASan, 25 lần OOM-kill): 500/500 nối lại nhưng 16 lần > 35 s (tối đa 58 s), 0 slot rò — ghi trong `previousRuns` |
| L7 | `logic-it load`: projects/logic-load (550 khối: 200 luật, 100 timer, 100 counter, 50 totalizer, 50 giờ chạy, 50 lịch trên 100 Tag mô phỏng) so với cùng project không có `logic.json`, 10 client, 600 s mỗi bên (T147) | **Sau sửa (2026-10-18, nhánh `gd6-logic-rss` trên gd6 có `gd6-logic-perf`): CPU +1,43 điểm (1,34 → 2,77 %); RSS +4,6 MB trung bình (13,6 → 18,2 MB, tối đa 14,5 → 19,7 MB), phần ẩn danh (RssAnon) +4,3 MB (6,5 → 10,7 MB); vòng quét p99 lớn nhất 1,38 ms, lần quét lâu nhất 1,3 ms; `scan.overrun` 0 (chu kỳ 100 ms); 0 mất sequence — Đạt cả ba ngưỡng ở x64**, RSS sát ngưỡng. Cách đo đổi: bên không logic cũng hỏi HTTPS mỗi 5 s (`GET /api/v1/system/info`, bên logic `GET /logic`), để phần TLS và phiên có ở cả hai bên.<br>**Nguồn +30 MB của lượt trước** (gd6 trước sửa: CPU +1,22, RSS 11,7 → 41,7 MB, tối đa 48 MB, overrun 2.430/600 s): `smaps` cho thấy 31 arena glibc × ≈ 0,9 MB = 24,6 MB. Glibc 64 bit cho mỗi luồng cấp phát một arena (tới 8 × số lõi); mỗi lần `GET /logic` (550 khối: 77 KB văn bản, ≈ 1 MB nút JSON) chạy trên một luồng HTTPS khác (64 luồng) và để lại trang của nó trong arena đó (thêm 80 lần hỏi liên tiếp: +6 MB). Không phải rò: số arena dừng ở 31. Sửa: `mallopt(M_ARENA_MAX, 2)` đầu `main` (`server/malloc_tuning.hpp`; lượt 180 s: +17,2 → +7,8 MB), `malloc_trim(0)` mỗi phút trong vòng chính và ngay sau khi dựng câu trả lời `GET /logic` (0,045 ms), `LogicSubsystem` thôi giữ bản sao `logic.json` và bản của project được giải phóng sau `firstRound` (mỗi bản 0,65 MB). Phần còn lại là dữ liệu sống: heap đang dùng sau khởi động và 3.000 quét (đo trong tiến trình, không HTTP) 0,72 MB không logic, 3,12 MB với 550 khối. Overrun 2.430 của lượt trước là đếm của vòng quét cũ (logic quét theo nhịp Tag Engine 250 ms); `gd6-logic-perf` đã sửa, lượt này 0. BL335 32 bit (tối đa 8 arena trên 2 lõi): +4,5 MB ở T148, trước sửa này. Số BL335 là T148.<br>**L1 đầy đủ (2026-10-18, nhánh `gd6-x64-final`, runtime `gd6` 9895c7c3 có quét theo sự kiện và sửa arena):** `node tools/logic-it/run.mjs --scenario load --load-base soak --seconds 3600 --clients 10 --report-key runtimeL1`; A `soak-std10` (soak-standard 500 Tag định dạng 1.0), B `soak-logic` (A + 550 khối + 200 Tag INT.R*), cùng 500 Tag cho client, 1 giờ mỗi bên, soak 24 giờ T076 chạy song song trong cùng máy ảo Docker. CPU 4,23 → 5,34 % (**+1,11 điểm, Đạt**); RSS 22,6 → 28,1 MB trung bình (**+5,4 MiB, Không đạt ≤ +5 MB**; tối đa 27,1 → 32,9 MB, +5,6 MiB; RssAnon 15,1 → 20,6 MB); vòng quét p99 lớn nhất 2,92 ms, trung vị 0,56 ms, lâu nhất 1,67 ms, 36.047 quét cách 99,99 ms (**Đạt**); overrun 1; 0 mất sequence. RSS cả hai bên tăng dần trong giờ (A: 15,8 MB lúc 30 s), nên số 1 giờ cao hơn lượt 600 s; nguồn của phần thêm chưa phân tích |
| L8 | `tests/load-x64/l8.mjs`: 40 TLS im lặng từ IP lan, đăng nhập từ IP pub | **Đạt**: đăng nhập 82 ms; RSS +708 kB khi 40 kết nối còn mở; runtime tự đóng cả 40 trong ≤ 20 s |

**Phát hiện cần xử lý (chưa sửa ở lượt này):** RSS của cấu hình logic tối đa tăng ~30 MB trên Linux arm64 64 bit (trần SC-028 là +5 MB). Cần đo trên armhf/BL335 (T148) và tìm nguồn (dự đoán: chương trình biểu thức và bảng trạng thái của 550 khối, bản sao `RetainMap` mỗi lần flush) trước khi kết luận SC-028.

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

### 3.1a L3 bằng `load-tester -reentry` (FR-038)

2026-10-18 14:04, BL335 `1.0.0-rc.1` releaseSeq 13, `tank-demo`, 10 client + 1 thừa, 5 vòng mỗi cách: client 1 **đóng sạch** → client mới vào sau 9 ms (5/5); client 1 **im lặng** (không trả ping) → 14,9–15,1 s (5/5, đúng hạn heartbeat 15 s); ngưỡng ≤ 35 s: **Đạt**. Client 11 bị từ chối 4429, 0 mất sequence. `011-load-bl335.json` khóa `L3reentryTool`.

### 3.1b T080: L2 1.000 Tag (SC-012)

2026-10-18 09:51–10:51, BL335, runtime `1.0.0-rc.1` releaseSeq 12, project `bench-1000` (1.000 Tag mô phỏng, định dạng 0.6 — kiểm luôn bản sửa gói thiếu `schemas/0.6`), `load-tester` 10 client + 1 thừa, 1 giờ, CPU tính theo một lõi:

| Đo | Kết quả | Ngưỡng | Trạng thái |
|---|---|---|---|
| CPU trung bình | 43,8 % một lõi (21,9 % cả máy); đỉnh 10 s 47,5 % | mục tiêu ≤ 50 % | **Đạt** |
| RSS | trung bình 12,8 MB, tối đa 13,0 MB | ≤ 150 MB | **Đạt** |
| Mất sequence | 0 trên 10 client; client 11 bị từ chối đúng | 0 | **Đạt** |
| Trễ client (tương đối) | p50 36 ms, p95 65 ms, tối đa 152 ms | — | — |

MemAvailable thấp nhất 879 MB; 100–108 luồng. Số chi tiết: `011-load-bl335.json` khóa `L2`.

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

**Đo lại trên BL335 với 1.0.0-rc.1 (2026-10-18 07:55–09:00, releaseSeq 12, gồm `gd6-logic-perf` và `gd6-logic-rss`).** Cùng cách đo A/B/A/B 4 × 15 phút, 10 client, 500 Tag; CPU tính theo **một lõi**:

| Tiêu chí | Không logic (pha 1, 3) | Có logic 550 khối (pha 2, 4) | Chênh | Ngưỡng | Trạng thái |
|---|---|---|---|---|---|
| CPU trung bình | 28,9 / 29,5 % | 32,7 / 32,3 % | **+3,3 điểm** một lõi (+1,65 cả máy) | ≤ +3 | **Không đạt** (vượt 0,3) |
| RSS trung bình | 16,6 / 17,2 MB | 20,6 / 21,0 MB | **+3,9 MB** | ≤ +5 MB | **Đạt** |
| Vòng quét | — | trung vị 2,5 ms, p99 3,8 ms (một lần p99 6,5 ms ở đầu pha 2) | — | ≤ 5 ms | **Đạt** |
| Chu kỳ quét thật | — | `intervalMs` 100, khoảng 9.370 quét mỗi pha | — | `scanMs` 100 | đúng |

0 mất sequence trong cả 4 pha, 550/550 khối OK, p95 trễ client 53–57 ms. So với lần đo trước tối ưu: vòng quét 16 → 2,5 ms, RSS +4,5 → +3,9 MB, CPU +4,9 → +3,3 điểm, trong khi logic nay quét đủ 10 lần/giây (trước đây bị kéo về 4 lần/giây theo vòng 250 ms).

Giới hạn và phương án cho CPU: (a) project ở mức tối đa 550 khối đặt `logic.scanMs` 200–250 ms (ước tính +1,3 đến +1,7 điểm); (b) tối ưu tiếp VM (≈ 1 µs mỗi biểu thức trên Cortex-A7); (c) đọc ngưỡng theo cả máy (2 lõi) như Master Plan §6.2 ghi "2 × Cortex-A7" (+1,65 điểm, đạt). Quyết định hiện hành: tính theo một lõi, T148 **chưa đạt** phần CPU; ghi vào ghi chú phát hành 1.0.0-rc.1.

**Đo lại lần 3 (2026-10-18 12:34–13:38, `1.0.0-rc.1` releaseSeq 13, gồm `gd6-vm-perf`: quét theo sự kiện, chỉ bước khối đến hạn).** Bench trên thiết bị: CPU logic ở chu kỳ riêng 27,4 → 17,8 ms/s, quét trung bình 2,16 → 1,37 ms. Dưới L1, cùng cách đo A/B/A/B:

| Tiêu chí | Không logic | Có logic | Chênh | Ngưỡng | Trạng thái |
|---|---|---|---|---|---|
| CPU trung bình (một lõi) | 29,3 / 29,4 % | 31,9 / 31,8 % | **+2,5 điểm** (+1,25 cả máy) | ≤ +3 | **Đạt** |
| RSS trung bình | 17,6 / 18,2 MB | 21,6 / 21,8 MB | **+3,8 MB** | ≤ +5 MB | **Đạt** |
| Vòng quét | — | trung vị 1,05 ms, p99 2,6 ms (một mẫu p99 6,3 ms ở pha 4) | — | ≤ 5 ms | **Đạt** |

0 mất sequence, 550/550 khối OK, `intervalMs` 100. **T148 đạt.** Mục "Giới hạn và phương án cho CPU" ở trên không còn cần.

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

Chưa kết luận cho BL335. Tiền kiểm x64 (Linux arm64 trong Docker trên Apple Silicon) đạt L1, L4, L6, L8, L3 phần 4429, L5 một trang, và L7 sau sửa arena glibc (RSS +4,6 MB so với +5 MB, sát ngưỡng; lượt trước +30 MB, nguồn và cách sửa ở §2 L7); đo lại BL335 với bản sửa ở T148. Các số tham khảo của 0.9.0 trên BL335 cách ngưỡng xa (RSS ~12 MB/150, CPU ~13 %/30). Kết luận Đạt/Không đạt cho từng dòng §1 sau T075, T079, T080, T147, T148; tổng hợp ngân sách và dòng "Cập nhật 011" ở ADR-005 làm ở T201.
