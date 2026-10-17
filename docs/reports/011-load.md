# Tải và ngân sách tài nguyên, feature 011 (T087, T201: khung)

**Trạng thái: khung, chưa kết luận.** Lập 2026-10-17 trên nhánh `gd6` (commit `c86ebe85`). Các lượt x64 (T075, T077, T078) và BL335 (T079, T080, T148) chưa chạy; số dưới đây là số **đã đo trước đó**, ghi rõ phiên bản. Khi có số mới thì thay ô "Chưa đo" và cập nhật cột Trạng thái; không xóa số tham khảo.

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
| `mat-runtime` RSS, 10 client | ≤ 150 MB | 1.0.0 rảnh: **9,5 MB**, 99 luồng (0.9.0: 8,1 MB, 73 luồng; tăng do `httpsThreads` 64). 0.9.0 tải 30 phút 10 Chrome 509 Tag: 11,6 MB (tối đa 12,1); 0.9.0 10 client + alarm + lịch sử 15 phút: 9,1 MB (tối đa 9,5); VmHWM lúc khởi động 27 MB | Chưa đo — L1 4 giờ trên 1.0.0 (T079); số tham khảo xa ngưỡng |
| SQLite page cache | ≤ 32 MB | Cấu hình: `history.db` 8 MiB (`cache_size=-8192`), `audit.db` 256 KiB; kết nối truy vấn lịch sử dùng chung giới hạn của Historian | Đạt theo cấu hình; chưa đo thực tế |
| tmpfs (log, staging, `/run/mat-sample`) | ≤ 64 MB | — | Chưa đo — T081 (`mat-sample` ghi `tmpfsKb`) |
| RAM còn dự phòng | ≥ 400 MB | 0.9.0 dưới tải: MemAvailable thấp nhất 875 MB | Đạt (tham khảo 0.9.0); đo lại ở L1 |
| Hàng đợi gửi mỗi client WebSocket | ≤ 256 KB | `sendQueueBytes` mặc định 262144, trần cấu hình 262144 (`server/config.cpp`) | Đạt theo cấu hình |

### 6.2 CPU

| Chỉ tiêu | Ngưỡng | Số đo đã có | Trạng thái |
|---|---|---|---|
| 500 Tag, polling 1 s, 10 client (L1) | trung bình ≤ 30 %, đỉnh ≤ 60 % | 1.0.0 rảnh: 0,7 % một lõi (60 s). 0.9.0, 509 Tag, 10 Chrome, 30 phút: 12,8 % một lõi (chưa có đỉnh, chưa đủ 4 giờ) | Chưa đo — L1 x64 1 giờ (T075), BL335 4 giờ (T079) |
| 1.000 Tag, 10 client (L2) | trung bình ≤ 50 % (mục tiêu) | — | Chưa đo — T080 |
| Logic tối đa trên L1 (L7) | ≤ +3 điểm CPU, ≤ +5 MB RSS, vòng quét ≤ 5 ms | Engine x64 (550 khối, 3.000 quét): trung bình 0,16 ms, p99 0,62 ms, tối đa 0,90 ms (`011-logic-load-x64.json`). CPU, RSS của runtime chưa đo | Chưa đo — T147 (x64), T148 (BL335) |
| 10 client tải lại cùng lúc (L4) | ≤ 5 s, không timeout WebSocket | 0.9.0 BL335: 10 F5 cùng lúc màn 3b tệ nhất 1,13 s; SVG 1 MiB 2,0 s. 50 vòng màn 250 item chưa chạy | Chưa đo — L4 50 vòng (T075, T079) |

### 6.4 Chỉ tiêu benchmark tổng hợp

| Chỉ tiêu | Ngưỡng | Số đo đã có | Trạng thái |
|---|---|---|---|
| 500 Tag (MVP), thử 1.000 | chạy được | 0.9.0: 509 Tag mô phỏng 30 phút, 0 mất sequence trên 72.207 delta | Chưa đo trên 1.0.0 (T079, T080) |
| Client đồng thời 10, client 11 bị từ chối (L3) | 4429 ở 100 % của 50 lần; client mới vào ≤ 35 s sau khi client 1 ngắt | `load-tester --extra-attempts` có; phần "vào lại ≤ 35 s" chưa có trong công cụ (`notMeasured`, T071) | Chưa đo — T075, T079 |
| SVG 300–500 phần tử/màn (L5) | ≥ 30 FPS với 50 animation | Máy dev (Chrome 155, 008): 100 animation, 100 FPS, 30 phút (`008-anim-x64.json`). `tests/web-it/svg-load.mjs` 10 client chưa chạy | Chưa đo — T075 (máy dev đã đạt) |
| Mở màn hình trên Chrome | ≤ 2 s (LAN 100 Mbps) | 0.9.0 BL335, cache trống: màn 3b trung vị 615 ms (tối đa 846); 40 item SVG 1.216 ms; SVG 1 MiB trung vị 1.362 ms (tối đa 1.675) | Đạt (tham khảo 0.9.0); đo lại 1.0.0 ở T079 |
| Trễ Tag → hiển thị | ≤ chu kỳ polling + 500 ms | 0.9.0: live p95 297 ms (10 client, 15 phút); Tag đổi → banner alarm p50 297, p95 358 ms | Đạt (tham khảo 0.9.0); X3 đo trong pilot (T196) |
| Giới hạn nguồn: 40 TLS im lặng (L8) | đăng nhập máy khác ≤ 2 s; RAM ≤ +1 MB | x64 `conn_limit_test`: 60 TLS im lặng, nguồn khác 25 ms; `011-lockout-x64.json` IP B ≤ 19 ms | Đạt (x64) · Chưa đo BL335 (T063) |
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

Chưa đo — T079 (L1 4 giờ, L3, L4, L5, L8), T080 (L2), T148 (L7). Đã có trên 1.0.0 (2026-10-17, `device-changes.md`): cài bằng `deploy.sh` 13 s, health sau 1 s, số rảnh ở §1, `mat-update-verify` ≈ 16 ms/lần kiểm, kiểm Host 421/200 đúng.

## 4. Kết luận

Chưa kết luận. Không chỉ tiêu nào có số đo vượt ngưỡng; các số tham khảo của 0.9.0 cách ngưỡng xa (RSS ~12 MB/150, CPU ~13 %/30). Kết luận Đạt/Không đạt cho từng dòng §1 sau T075, T079, T080, T147, T148; tổng hợp ngân sách và dòng "Cập nhật 011" ở ADR-005 làm ở T201.
