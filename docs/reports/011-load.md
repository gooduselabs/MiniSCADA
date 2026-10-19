# Tải và ngân sách tài nguyên, feature 011 (T087, T201)

**Trạng thái: kết luận cho GĐ 6 (2026-10-19).** Mọi chỉ tiêu ngân sách của Master Plan §6 và mọi kịch bản L1–L8 của test-protocols §1 có trạng thái ở §1. Phần chưa đo được nêu rõ task và lý do: việc cần người (L6 trên BL335), việc hủy theo quyết định người dùng (soak 7 ngày), và việc chuyển sang soak 30 ngày ở bàn thử khi pilot (eMMC, T196). Lập 2026-10-17 trên nhánh `gd6` (commit `c86ebe85`); số đo lấy từ các lượt 2026-10-17/18 ghi ở §2, §3; tổng hợp và kết luận 2026-10-19.

Quy trình và ngưỡng: [contracts/test-protocols.md](../../specs/011-pilot-hardening/contracts/test-protocols.md) §1; ngân sách: `mAT_SCADA_Master_Plan.md` §6; FR-005, FR-044, FR-046; SC-011, SC-012, SC-028. Soak và eMMC: [011-soak.md](011-soak.md); mất điện: [011-powercut.md](011-powercut.md).

Trạng thái: **Đạt**; **Không đạt** (kèm giới hạn và phương án); **Chưa đo** (kèm task và lý do). Trạng thái của dòng ngân sách tính theo **BL335** (thiết bị đích); số "x64" là tiền kiểm trong Docker `mat-armhf` **Linux arm64 trên Mac Apple Silicon (không phải x64 thật)** và không thay số BL335. "Tham khảo 0.9.0" là số của runtime 0.9.0 trên BL335 (2026-10-16), không thay lượt đo của 1.0.

**Cách đọc CPU (quyết định T201):** % của **một lõi** (cách đọc chặt); "cả máy" = % của 2 lõi, ghi kèm. Master Plan §6.2 ghi ngưỡng cho "2 × Cortex-A7" nên đọc theo cả máy cũng hợp lệ, nhưng mọi số 011 đạt cả theo cách đọc một lõi nên không cần dựa vào cách đọc nới.

## 0. Phiên bản và điều kiện

| Mục | Giá trị |
|---|---|
| Runtime đo trên BL335 | 1.0.0 (T079 L1/L3/L4/L5/L8, T122, lần đo T148 đầu; 2026-10-17/18) và `1.0.0-rc.1` releaseSeq 12 (T063, T080, T148 lần 2) / releaseSeq 13 (T148 lần 3, L3 `-reentry`). API thiết bị 1.5.0, giao thức live 1.3.0, định dạng project 1.0.0. Thiết bị hiện chạy rc.1 releaseSeq 13 (`device-changes.md`) |
| Thiết bị | BL335: 2 × Cortex-A7 1,2 GHz, RAM 993 MB, eMMC 8 GB (chip `S0311D`), kernel 5.4.61, systemd 245 |
| `runtime.json` trên BL335 | giữ của thiết bị: `viewerAccess: any`, `simLoad: true`, 24 luồng HTTP, `deltaPeriodMs` 250; `httpsThreads` mặc định 64; trong lúc đo đặt tạm `maxLiveClientsPerSource: 10` (một máy chạy 10 client) rồi khôi phục (SHA-256 khớp bản gốc) |
| Project đo | `tank-demo` 0.1.0 (rảnh); `soak-std10` (= `soak-standard` 500 Tag chuyển định dạng 1.0: lưu 200 Tag theo thay đổi, 3 màn hình); `bench-1000` (1.000 Tag, định dạng 0.6); `soak-logic` (= `soak-std10` + 550 khối của `projects/logic-load` + 200 Tag `INT.R*`); `svg-l5` (400 phần tử, 50 hoạt ảnh) |
| Máy đo | máy dev macOS cùng LAN; client `load-tester` (ws:// 8080), Chrome headless qua HTTPS 8443 |
| Máy "x64" | Docker `mat-armhf`, Linux arm64 trên Apple Silicon, 4 CPU, 2,8 GB RAM; JSON ghi rõ máy |

## 1. Ngân sách Master Plan §6

### 1.1 RAM (§6.1)

| Chỉ tiêu | Ngưỡng | BL335 | x64 (tiền kiểm) | Trạng thái |
|---|---|---|---|---|
| Kernel + OS + systemd + sshd (rảnh) | ≤ 200 MB | Toàn máy dùng 79 MB (khảo sát 2026-10-16, gồm dịch vụ khác và runtime 0.5.0); ADR-005 baseline ~91 MB. Trong L1 4 giờ toàn máy (gồm `mat-runtime`) còn MemAvailable ≥ 859 MB | — | **Đạt** |
| `mat-runtime` RSS, 10 client | ≤ 150 MB | Rảnh **9,5 MB** (1.0.0 và rc.1), 99 luồng. L1 4 giờ: **tối đa 19,5 MB**, đi ngang từ giờ thứ 2. L2 1.000 Tag: 12,8 MB (tối đa 13,0). L4 F5: ≤ 16,9 MB. L7 logic tối đa: 21,6–21,8 MB trung bình. Đỉnh ngắn 26–32 MB lúc đăng nhập (Argon2id cấp tạm ≈ 19 MiB; T063 đỉnh 27,9 MB) | L1 1 giờ: 25 MB; soak 24 giờ (kill -9, nạp xuống): tối đa 34,1 MB | **Đạt** |
| Trần systemd `MemoryMax=300M` | cấu hình | `deployment/systemd/mat-runtime.service` có `MemoryMax=300M`; RSS đo được không tới 1/8 trần; không thử chạm trần | — | **Đạt** theo cấu hình |
| SQLite page cache | ≤ 32 MB | Cấu hình: `history.db` 8 MiB (`cache_size=-8192`), `audit.db` 256 KiB; truy vấn lịch sử dùng chung giới hạn Historian. Cận trên thực tế: cả tiến trình ≤ 21,8 MB trung bình dưới tải (≤ 32 MB kể cả đỉnh đăng nhập) | cả tiến trình ≤ 34,1 MB | **Đạt** (theo cấu hình và cận trên RSS) |
| tmpfs (log, staging, `/run/mat-sample`) | ≤ 64 MB | Chưa đo: `mat-sample` (ghi `tmpfsKb`) có trong gói runtime nhưng chưa chạy trên thiết bị | soak 24 giờ: 0 KiB | **Chưa đo** — BL335: phần còn lại của T079 (`mat-sample`), soak bàn thử T196 |
| RAM còn dự phòng | ≥ 400 MB | L1 4 giờ: MemAvailable thấp nhất 859 MB; L2: 879 MB | — | **Đạt** |
| Cảnh báo khi RAM khả dụng < 250 MB | có cảnh báo | `system/diagnostics` báo RAM khả dụng (`proc_stats`); `system/info.warnings` chưa có mã riêng cho ngưỡng này | — | **Chưa đo** — chưa có mã cảnh báo; theo dõi bằng collector trong pilot (T195), đề xuất thêm mã sau pilot |
| Hàng đợi gửi mỗi client WebSocket | ≤ 256 KB | `sendQueueBytes` mặc định 262144, trần cấu hình 262144 (`server/config.cpp`); 4409 quan sát được từ Sprint 1 (ADR-005) | — | **Đạt** theo cấu hình |

### 1.2 CPU (§6.2)

| Chỉ tiêu | Ngưỡng | BL335 | x64 (tiền kiểm) | Trạng thái |
|---|---|---|---|---|
| 500 Tag, 10 client (L1) | trung bình ≤ 30 %, đỉnh ≤ 60 % | 4 giờ: **28,9 % một lõi** (14,5 % cả máy), mỗi giờ 28,9–29,0 %; đỉnh cửa sổ 10 s **50,4 %** một lõi. Rảnh: 0,7 % một lõi | 1 giờ: 4,3 %, đỉnh 5,8 % | **Đạt** (một lõi sát: còn 1,1 điểm) |
| 1.000 Tag, 10 client (L2) | trung bình ≤ 50 % (mục tiêu) | 1 giờ: **43,8 % một lõi** (21,9 % cả máy), đỉnh 47,5 % | — | **Đạt** |
| 10 client tải lại cùng lúc (L4) | ≤ 5 s, không timeout WebSocket | 10 trang × 50 vòng màn 250 item, cache trống: trung vị 647 ms, p95 795, **tối đa 935 ms**, 0 trang 4429. CPU trong cơn F5 61 % một lõi (đỉnh 69,6 %; 34,8 % cả máy): ngưỡng đỉnh 60 % là của L1, không phải của L4 | 500/500, tối đa 494 ms | **Đạt** |

### 1.3 eMMC (§6.3)

| Chỉ tiêu | Ngưỡng | BL335 | Trạng thái |
|---|---|---|---|
| Ghi ≤ 2 GB/ngày ở cấu hình chuẩn | ≤ 2 GB/ngày | Không tách được trên thiết bị này: ghi khối toàn máy khi **mat tắt** đã 2,6–4,7 GB/ngày (dịch vụ không thuộc mat), mat chạy 3,5–3,8 GB/ngày; phần của mat ước **< ~1 GB/ngày** (0.9.0, tải nhẹ). Kernel 5.4.61 không có `/proc/<pid>/io` | **Chưa đo trên thiết bị** — chờ soak bàn thử T196 (S2). Quyết định T201: kết luận theo phần ghi của chính mat (`historian.io.source: sqlite-vfs` và bộ đếm theo thành phần), ghi nền thiết bị là điều kiện môi trường ([011-soak.md](011-soak.md) §4) |
| Theo dõi tuổi thọ eMMC | đọc `life_time`/`EXT_CSD` | Runtime đọc sysfs `life_time` `0x01 0x01` (0–10 %), `pre_eol_info` `0x01` (T013), báo ở `system/diagnostics` | **Đạt** (đọc chỉ số) |
| Cảnh báo khi tuổi thọ vượt 70 % | có cảnh báo | `system/info.warnings` chưa có mã riêng; `kpi.mjs` đọc `emmcLife` khi pilot | **Chưa đo** — chưa có mã cảnh báo; theo dõi trong pilot (T196), đề xuất thêm mã sau pilot |
| Tuổi thọ ≥ 5 năm (D30) | ≥ 5 năm | cần datasheet chip (TBW/chu kỳ P/E) | **Chưa đo** — cần người cung cấp datasheet (T082, B5); thiếu thì "chưa tính được tuổi thọ tuyệt đối" |
| Bố cục phân vùng (rootfs A/B chỉ đọc, data riêng) | thiết kế §6.3 | một rootfs ext4 `rw` 6,8 GB (`/dev/mmcblk0p5`, dùng 14 %), không phân vùng data riêng (T013) | **Không đạt** (chưa khớp thiết kế). Giới hạn: thiết bị chạy OS dev image. Phương án: phụ thuộc [ADR-002](../adr/002-commercial-os.md) (OS thương mại, Buildroot trong `post-1.0-backlog.md`); ở 1.0, OTA dùng `/opt/mat-runtime` + `.prev` đổi nguyên tử thay A/B (ADR-035) |

### 1.4 Chỉ tiêu benchmark tổng hợp (§6.4)

| Chỉ tiêu | Ngưỡng | BL335 | x64 (tiền kiểm) | Trạng thái |
|---|---|---|---|---|
| 500 Tag (MVP), thử 1.000 | chạy được | 500 Tag 4 giờ 10 client, 0 mất sequence (T079); 1.000 Tag 1 giờ, 0 mất sequence (T080) | 500 Tag 1 giờ, soak 24 giờ | **Đạt** |
| Chu kỳ polling 1–5 s | theo kênh | Bàn đo dùng Tag mô phỏng (`simLoad`) đổi giá trị liên tục, Tag Engine 250 ms: nặng hơn polling 1 s. Polling Modbus thật chỉ có ở `driver-it` (x64) | `driver-it`, `gateway-x64` | **Đạt** (mô phỏng) · PLC thật trên BL335: trong pilot (T195) |
| Client đồng thời 10, client 11 bị từ chối (L3) | 4429 ở 100 % của 50 lần; client mới vào ≤ 35 s sau khi client 1 ngắt | 50/50 lần 4429; vào lại: client 1 đóng sạch 9 ms (công cụ `-reentry`, rc.1) và 28–83 ms (script T079); client 1 im lặng 14,9–15,2 s (hết hạn heartbeat 15 s) | 50/50 lần 4429 | **Đạt** |
| SVG 300–500 phần tử/màn (L5) | ≥ 30 FPS với 50 animation | màn 400 phần tử, 50 hoạt ảnh, 10 tiến trình Chrome riêng trên runtime thật: **thấp nhất 53,4 FPS** | 1 trang 60 FPS | **Đạt** |
| Mở màn hình trên Chrome | ≤ 2 s (LAN 100 Mbps) | 1.0.0: F5 màn 250 item tới dữ liệu sống tối đa 935 ms (L4). SVG lớn, tham khảo 0.9.0: SVG 1 MiB trung vị 1.362 ms (tối đa 1.675) | — | **Đạt** |
| Trễ Tag → hiển thị | ≤ chu kỳ polling + 500 ms | L1: trễ tương đối tới client WebSocket p95 43 ms, tối đa 115 ms; `liveLagP95Ms` phía máy chủ ≤ 53 ms. Đầu-cuối trên Chrome với đồng hồ chung chưa đo | — | **Đạt** (tới client WebSocket) · đầu-cuối Chrome **Chưa đo** — X3 trong pilot (T196) |
| Soak | 7 ngày (MVP), 30 ngày (thương mại) | S1 7 ngày **không chạy**: hủy theo quyết định người dùng 2026-10-18 (T081); thay bằng L1 4 giờ BL335 và S0 x64 24 giờ | S0 24 giờ: đạt các tiêu chí đo được ([011-soak.md](011-soak.md) §2a) | **Chưa đo** — 7 ngày hủy (T081, quyết định người dùng); 30 ngày ở bàn thử khi pilot (T196) |

### 1.5 RS485 (§6.5)

Giới hạn băng thông RS485 là ràng buộc thiết kế (ước tính chu kỳ quét), không phải chỉ tiêu đo của 011: bàn đo 011 không có kênh RTU thật. **Chưa đo** ở 011; kiểm trong pilot nếu site dùng Modbus RTU (T192, T195).

### 1.6 Kịch bản test-protocols §1 (L1–L8)

| Mã | Ngưỡng | BL335 | x64 (tiền kiểm) | Trạng thái |
|---|---|---|---|---|
| L1 | CPU ≤ 30 %, đỉnh ≤ 60 %; RSS ≤ 150 MB; 0 mất sequence; 8080 và 8443 xen kẽ | 4 giờ: 28,9 %, đỉnh 50,4 %, RSS ≤ 19,5 MB, 0 mất sequence (§3.1). Điều kiện "8443 xen kẽ" chưa làm: `load-tester` chỉ mở `ws://`; HTTPS 8443 có tải ở L4, L5, L8 | 1 giờ Đạt | **Đạt** các ngưỡng · xen kẽ 8443 **Chưa đo** (T079 phần còn lại: công cụ đã có, `load-tester -alternate -fingerprint`, chưa chạy trên BL335) |
| L2 | CPU ≤ 50 % (mục tiêu); RSS ≤ 150 MB | 43,8 %, 12,8 MB, 0 mất sequence (§3.1b) | — | **Đạt** |
| L3 | 4429 50/50; vào lại ≤ 35 s | §1.4 | 4429 50/50 | **Đạt** |
| L4 | mọi trang ≤ 5 s | tối đa 935 ms | tối đa 494 ms | **Đạt** |
| L5 | ≥ 30 FPS với 50 animation; đo RSS tab | ≥ 53,4 FPS; RSS tab chưa đo | 60 FPS (1 trang) | **Đạt** FPS · RSS tab **Chưa đo** (T079 phần còn lại; không có ngưỡng; công cụ đã có, `tools/measure/tab-rss.mjs`, chưa chạy trên BL335) |
| L6 | 100 % nối lại ≤ 35 s; 0 slot rò | cần người cắt cổng switch hoặc `ip link` | 500/500, tối đa 8,7 s, 0 slot rò | x64 **Đạt** · BL335 **Chưa đo** — cần người (T086, B7) |
| L7 | ≤ +3 điểm CPU, ≤ +5 MB, quét ≤ 5 ms | **+2,5 điểm** một lõi, **+3,8 MB**, quét trung vị 1,05 ms, p99 2,6 ms (releaseSeq 13, §3.2) | L1 1 giờ (`runtimeL1b`, T147 2026-10-19): +0,58 điểm, quét p99 2,7 ms, **RSS +4,49 MiB** (trước sửa +5,4 MiB) | BL335 **Đạt** · x64 **Đạt** (xem dưới) |
| L8 | đăng nhập máy khác ≤ 2 s; RAM ≤ +1 MB | 43/43, tệ nhất 1.198 ms (T079) và 837 ms (T063, rc.1); RSS +0,3–0,7 MB | 82 ms; +708 kB | **Đạt** |

**Cập nhật 2026-10-19 (T147, nhánh `gd6-t147`): x64 nay Đạt.** `smaps` + `malloc_info` + `mallinfo` theo bước khởi động cho thấy phần thêm là dữ liệu sống, không phải phân mảnh arena: bản kiểm `projectDir` lúc nhận giữ suốt đời (0,79 MB), vector Tag của mô hình nhân đôi (0,6 MB), cây JSON của project không còn ai đọc, cây ~1 MB của `GET /logic` để lại lỗ trong heap (~0,8 MB). Sau sửa (ccf56cec, 839dc1e8), L1 1 giờ: CPU +0,58 điểm, RSS +4.596 kB (4,49 MiB; 19,5 → 24,1 MB), quét p99 lớn nhất 2,7 ms, overrun 0 (`011-logic-load-x64.json` `runtimeL1b`). Đoạn dưới là đánh giá trước sửa.

**L7 x64 Không đạt RSS — giới hạn và phương án (trước sửa).** Ngân sách §6 là của thiết bị đích; trên BL335 (armhf 32 bit) cùng cặp project đo +3,8 MB (Đạt). Trên Linux arm64 64 bit, con trỏ và khối malloc lớn hơn, và phần chênh gồm cả 200 Tag `INT.R*` mà project có logic thêm vào; RSS của **cả hai bên** tăng dần trong giờ đo (A 15,8 → 27,1 MB) nên phần thêm của logic gần bằng nhau ở trung bình và tối đa, không phải độ dốc riêng của logic; nguồn chưa phân tích (chưa lấy `smaps`). Phương án: không chặn rc (số thiết bị đích đạt); nếu cần giữ ngân sách trên máy 64 bit: lấy `smaps` của lượt 1 giờ, thôi giữ bản dựng JSON của `GET /logic` giữa các lần hỏi, hoặc đo cặp project có cùng 200 Tag nội bộ ở cả hai bên. T147 giữ chưa đánh dấu với ghi chú này.

### 1.7 Tổng hợp ngân sách (T201)

Số trên BL335, CPU tính theo một lõi (cả máy trong ngoặc):

| Kịch bản | RSS `mat-runtime` | CPU `mat-runtime` | Ghi eMMC | Nguồn |
|---|---|---|---|---|
| Rảnh (`tank-demo`) | 9,5 MB | 0,7 % | trong nền toàn máy (§1.3) | T063, T079 |
| US2 L1: 500 Tag × 10 client, 4 giờ | tối đa 19,5 MB | 28,9 % (14,5 %), đỉnh 50,4 % | không đo riêng (kernel không có `/proc/<pid>/io`; `mat-sample` chưa chạy) | T079, `011-load-bl335.json` `L1` |
| US2 L2: 1.000 Tag × 10 client, 1 giờ | 12,8 MB (tối đa 13,0) | 43,8 % (21,9 %), đỉnh 47,5 % | như trên | T080, `L2` |
| US2 L4: 10 F5 × 50 vòng | ≤ 16,9 MB | 61 % trong cơn F5 (đỉnh 69,6 %) | — | T079, `L4` |
| US2 L8: 40 TLS im lặng | +0,3–0,7 MB | 36,5 % (bắt tay lặp lại) | — | T079, T063 |
| Logic tối đa (550 khối) trên L1 | **+3,8 MB** (21,6–21,8 MB) | **+2,5 điểm** (+1,25), quét trung vị 1,05 ms | không đo riêng | T148 lần 3, `011-logic-bl335.json` `remeasureEventDriven` |
| Toàn máy (mọi tiến trình) | MemAvailable ≥ 859 MB | — | mat tắt 2,6–4,7 GB/ngày; mat chạy 3,5–3,8 GB/ngày; phần mat ước < ~1 GB/ngày | 2026-10-16 (0.9.0), [011-soak.md](011-soak.md) §4 |

So sánh: RSS dưới tải cao nhất 21,8 MB so với ngân sách 150 MB (≈ 15 %); CPU L1 sát ngưỡng theo một lõi (28,9/30), L2 43,8/50, logic +2,5/+3. So với 0.9.0 (tham khảo): RSS 11,6 → 19,5 MB dưới tải (thêm `httpsThreads` 64, logic, lịch sử), CPU 12,8 % (509 Tag, 10 Chrome, 30 phút) → 28,9 % (500 Tag, 10 client `load-tester`, 4 giờ; bàn đo khác nên không so trực tiếp).

**Kết luận T201:** không chỉ tiêu RSS/CPU nào trên BL335 vượt ngân sách (L7 đạt sau tối ưu quét theo sự kiện, releaseSeq 13), nên không cần ADR mới theo Constitution III; ADR-005 có dòng "Cập nhật 011" trỏ báo cáo này. eMMC: **Chưa đo trên thiết bị — chờ soak bàn thử T196**; ngưỡng 2 GB/ngày tính trên phần ghi của mat (quyết định ở trên). Biên CPU L1 theo một lõi chỉ còn 1,1 điểm: project lớn hơn `soak-standard` (thêm logic, nhiều lịch sử) cần đo lại trước khi hứa với khách hàng.

## 2. Kịch bản L1–L8 trên x64 (tiền kiểm)

Đo 2026-10-17/18 (T075, T078, T147; nhánh `gd6-docker-runs`), `node tools/load/x64.mjs` (rig `tests/web-it/compose.yaml`, slot riêng `mat-load-x64`) và `node tools/logic-it/run.mjs --scenario load`; runtime Release 1.0.0 của nhánh này; Docker `mat-armhf` **Linux arm64 trên Mac Apple Silicon, 4 CPU, 2,8 GB RAM, không phải x64 thật**; máy rảnh trong lúc đo (trừ ghi chú). CPU là % **một lõi** của riêng `mat-runtime` (`/proc/<pid>/stat`), không phải CPU toàn máy. Kết quả: `docs/reports/011-load-x64.json`, `011-flap-x64.json`, `011-logic-load-x64.json`.

| Mã | Lệnh | Kết quả x64 |
|---|---|---|
| L1 | `load-tester -tags 500 -clients 10 -extra 1 -duration 3600 -latency` trên soak-standard, `proc-sample.mjs` 5 s | **Đạt**: 1 giờ, 10 client nhận, client 11 bị 4429, 0 mất sequence (143.999 delta đo trễ: p50 3 ms, p95 7 ms, tối đa 48 ms, tương đối); CPU 4,3 % (đỉnh cửa sổ 5 s 5,8 %); RSS 12,2 → 25 MB (tối đa 25 MB), 107 luồng; `liveLagP95Ms` 10. Chưa đo: xen kẽ 8080/8443 (load-tester chỉ mở ws:// 8080), CPU toàn máy |
| L3 | `load-tester -clients 10 -extra 1 -extra-attempts 50` | **Đạt một phần**: 50/50 client thừa nhận 4429; "client mới vào ≤ 35 s sau khi client 1 ngắt" chưa đo ở x64 (lượt này trước khi có `-reentry`; không chạy lại vì đã đo bằng chính công cụ trên BL335, §3.1a) |
| L4 | `tests/web-it/f5-storm.mjs --pages 10 --rounds 50` (màn 250 item, Chrome headless 155) | **Đạt**: 500/500 lần F5 có dữ liệu sống, p50 368 ms, p95 449 ms, tối đa 494 ms, 0 lần 4429. Chưa đo: CPU/RSS runtime trong lúc F5 |
| L5 | `tests/web-it/svg-load.mjs --elements 400 --animations 50` (trang thật trên runtime GIẢ của e2e) | 1 trang: **60 FPS**. 10 trang trên cùng một máy Mac (không GPU): 11,7–11,9 FPS mỗi trang (~118 khung/s tổng) — giới hạn của máy chạy 10 trình duyệt; ngưỡng 30 FPS là của từng máy trạm. Chưa đo: RSS tab, 10 client vào runtime thật |
| L6 | `load-tester -clients 10 -flap 50 -flap-mode external`, container bị `docker network disconnect` 10 s rồi nối lại, 50 lần (T078) | **Đạt** (máy rảnh): 500/500 nối lại, 0 lần > 35 s (p50 5,4 s, p95 8,4 s, tối đa 8,7 s, tính cả thời gian cắt), 0 slot rò sau 25 s. Lượt đầu khi máy quá tải (build ASan, 25 lần OOM-kill): 500/500 nối lại nhưng 16 lần > 35 s (tối đa 58 s), 0 slot rò — ghi trong `previousRuns` |
| L7 | `logic-it load`: projects/logic-load (550 khối: 200 luật, 100 timer, 100 counter, 50 totalizer, 50 giờ chạy, 50 lịch trên 100 Tag mô phỏng) so với cùng project không có `logic.json`, 10 client, 600 s mỗi bên (T147) | **Sau sửa (2026-10-18, nhánh `gd6-logic-rss` trên gd6 có `gd6-logic-perf`): CPU +1,43 điểm (1,34 → 2,77 %); RSS +4,6 MB trung bình (13,6 → 18,2 MB, tối đa 14,5 → 19,7 MB), phần ẩn danh (RssAnon) +4,3 MB (6,5 → 10,7 MB); vòng quét p99 lớn nhất 1,38 ms, lần quét lâu nhất 1,3 ms; `scan.overrun` 0 (chu kỳ 100 ms); 0 mất sequence — Đạt cả ba ngưỡng ở x64**, RSS sát ngưỡng. Cách đo đổi: bên không logic cũng hỏi HTTPS mỗi 5 s (`GET /api/v1/system/info`, bên logic `GET /logic`), để phần TLS và phiên có ở cả hai bên.<br>**Nguồn +30 MB của lượt trước** (gd6 trước sửa: CPU +1,22, RSS 11,7 → 41,7 MB, tối đa 48 MB, overrun 2.430/600 s): `smaps` cho thấy 31 arena glibc × ≈ 0,9 MB = 24,6 MB. Glibc 64 bit cho mỗi luồng cấp phát một arena (tới 8 × số lõi); mỗi lần `GET /logic` (550 khối: 77 KB văn bản, ≈ 1 MB nút JSON) chạy trên một luồng HTTPS khác (64 luồng) và để lại trang của nó trong arena đó (thêm 80 lần hỏi liên tiếp: +6 MB). Không phải rò: số arena dừng ở 31. Sửa: `mallopt(M_ARENA_MAX, 2)` đầu `main` (`server/malloc_tuning.hpp`; lượt 180 s: +17,2 → +7,8 MB), `malloc_trim(0)` mỗi phút trong vòng chính và ngay sau khi dựng câu trả lời `GET /logic` (0,045 ms), `LogicSubsystem` thôi giữ bản sao `logic.json` và bản của project được giải phóng sau `firstRound` (mỗi bản 0,65 MB). Phần còn lại là dữ liệu sống: heap đang dùng sau khởi động và 3.000 quét (đo trong tiến trình, không HTTP) 0,72 MB không logic, 3,12 MB với 550 khối. Overrun 2.430 của lượt trước là đếm của vòng quét cũ (logic quét theo nhịp Tag Engine 250 ms); `gd6-logic-perf` đã sửa, lượt này 0. BL335 32 bit (tối đa 8 arena trên 2 lõi): +4,5 MB ở T148, trước sửa này. Số BL335 là T148.<br>**L1 đầy đủ (2026-10-18, nhánh `gd6-x64-final`, runtime `gd6` 9895c7c3 có quét theo sự kiện và sửa arena):** `node tools/logic-it/run.mjs --scenario load --load-base soak --seconds 3600 --clients 10 --report-key runtimeL1`; A `soak-std10` (soak-standard 500 Tag định dạng 1.0), B `soak-logic` (A + 550 khối + 200 Tag INT.R*), cùng 500 Tag cho client, 1 giờ mỗi bên, soak 24 giờ T076 chạy song song trong cùng máy ảo Docker. CPU 4,23 → 5,34 % (**+1,11 điểm, Đạt**); RSS 22,6 → 28,1 MB trung bình (**+5,4 MiB, Không đạt ≤ +5 MB**; tối đa 27,1 → 32,9 MB, +5,6 MiB; RssAnon 15,1 → 20,6 MB); vòng quét p99 lớn nhất 2,92 ms, trung vị 0,56 ms, lâu nhất 1,67 ms, 36.047 quét cách 99,99 ms (**Đạt**); overrun 1; 0 mất sequence. RSS cả hai bên tăng dần trong giờ (A: 15,8 MB lúc 30 s), nên số 1 giờ cao hơn lượt 600 s; nguồn của phần thêm chưa phân tích |
| L8 | `tests/load-x64/l8.mjs`: 40 TLS im lặng từ IP lan, đăng nhập từ IP pub | **Đạt**: đăng nhập 82 ms; RSS +708 kB khi 40 kết nối còn mở; runtime tự đóng cả 40 trong ≤ 20 s |

**Phát hiện lượt đầu (đã xử lý):** RSS của cấu hình logic tối đa tăng ~30 MB trên Linux arm64 64 bit (trần SC-028 là +5 MB). Nguồn là arena glibc, đã sửa ở `gd6-logic-rss` (dòng L7 ở trên); SC-028 kết luận bằng số BL335 (T148: +3,8 MB, Đạt). Lượt L1 1 giờ x64 còn +5,4 MiB: giới hạn và phương án ở §1.6.

Số x64 của 010 (runtime 0.9.0, tham khảo, không thay số 011): 10 client live + 2 truy vấn lịch sử 10 phút, 200 Tag: VmHWM 106 MB, 0 mất sequence (`010-load-200tags-x64.json`).

## 3. BL335

Đo từ máy dev macOS cùng LAN: runtime 1.0.0 từ 2026-10-17 20:12 đến 2026-10-18 01:40 (+07) (T079, lần đo T148 đầu), rồi `1.0.0-rc.1` releaseSeq 12 và 13 ngày 2026-10-18 (T063, T080, T148 lần 2 và 3, L3 `-reentry`). Cách đo CPU: script chỉ đọc trên thiết bị lấy `/proc/<pid>/stat` và `/proc/stat` mỗi 5 s (L4, L5, L8: 2 s); "một lõi" là % của một lõi, "cả máy" là % của 2 lõi; đỉnh là cửa sổ 10 s. Kết luận dùng cách đọc chặt (một lõi), ghi kèm cả máy (đầu báo cáo). `runtime.json` của thiết bị giữ nguyên, chỉ thêm tạm `"maxLiveClientsPerSource": 10` trong lúc đo (load-tester chạy từ một máy) rồi khôi phục. `mat-sample` chưa chạy trên thiết bị (dùng script lấy mẫu `/proc` riêng, đã xóa sau đo); L6 cần người (T086).

**Phát hiện khi cài:** gói runtime 1.0.0 (`deployment/package-runtime.ps1`) không chép `schemas/0.6/` (chỉ 0.1–0.5 và bộ gốc 1.0), nên trên thiết bị mọi project định dạng 0.6 (gồm `soak-standard`, `bench-1000` của `tools/gen-bench-projects.mjs` và project của 010) bị từ chối ở bước validate: `E_SCHEMA` "Không nạp được schema project". Đo bằng `soak-standard` chuyển sang 1.0.0 (nội dung giữ nguyên). **Đã sửa** (`95effeb5`: gói chép mọi bộ schema đóng băng, `deploy.sh` đòi `schemas/0.6`); kiểm trên thiết bị ở T080 với `bench-1000` định dạng 0.6.

### 3.1 T079: L1, L3, L4, L5, L8

| Mã | Điều kiện | Kết quả | Trạng thái |
|---|---|---|---|
| L1 | `load-tester -tags 500 -clients 10 -extra 1 -latency`, 4 giờ (14.401 s), project `soak-std10` (500 Tag, lưu trữ 200 Tag, 3 màn hình) | CPU trung bình 28,9 % một lõi (14,5 % cả máy), đỉnh 50,4 % một lõi; RSS 12,4 → 19,5 MB, đi ngang từ giờ thứ 2; luồng 109, FD 26–27; MemAvailable ≥ 859 MB; 0 mất sequence; trễ tương đối p50 23, p95 43, tối đa 115 ms (576.002 mẫu); `liveLagP95Ms` phía máy chủ ≤ 53 ms; client 11 bị 4429 | **Đạt** (một lõi sát ngưỡng: 28,9/30) |
| L1 phụ | 8080 và 8443 xen kẽ | load-tester chỉ mở `ws://` 8080; HTTPS 8443 có ở L4, L5, L8 | Chưa đo (T079 phần còn lại: công cụ đã có, `load-tester -alternate -tls-port 8443 -fingerprint <fp>`, chưa chạy) |
| L3 | 10 client giữ, 50 lần client 11; rồi 10 vòng client 1 rời | 50/50 đóng 4429; vào lại sau khi client 1 đóng sạch 28–83 ms, sau khi client 1 im lặng 15,2 s | **Đạt** |
| L4 | 10 trang Chrome headless (ngữ cảnh riêng, cache tắt), màn `tong-quan` 250 item qua HTTPS, F5 cùng lúc 50 vòng | 500 lần tải: trung vị 647, p95 795, tối đa 935 ms; 0 vượt 5 s; 0 trang 4429. Runtime trong cơn F5: CPU 61 % một lõi (đỉnh 69,6), RSS ≤ 16,9 MB | **Đạt** |
| L5 | Màn `anim` 400 phần tử SVG, 50 hoạt ảnh trên runtime thật (project `svg-l5`) | 10 tiến trình Chrome riêng: 53,4–54,3 FPS; 1 trang + 9 client 500 Tag: 60 FPS; 10 trang trong một tiến trình: 10,7 FPS (giới hạn của máy đo, CPU runtime 2,8 % một lõi) | **Đạt** (RSS tab chưa đo; công cụ `tools/measure/tab-rss.mjs` đã có, chưa chạy) |
| L8 | 40 TLS im lặng từ IP A giữ liên tục 120 s, đăng nhập thật từ IP B (giao diện mạng thứ hai) mỗi ≈ 2,7 s | 43/43 đăng nhập 200, tệ nhất 1.198 ms; đăng nhập từ chính IP A 616 ms; máy chủ đóng TLS im lặng sau ≈ 10,4 s; RSS ổn định +0,3–0,7 MB; CPU 36,5 % một lõi do bắt tay lặp lại | **Đạt** |

### 3.1a L3 bằng `load-tester -reentry` (FR-038)

2026-10-18 14:04, BL335 `1.0.0-rc.1` releaseSeq 13, `tank-demo`, 10 client + 1 thừa, 5 vòng mỗi cách: client 1 **đóng sạch** → client mới vào sau 9 ms (5/5); client 1 **im lặng** (không trả ping) → 14,9–15,1 s (5/5, đúng hạn heartbeat 15 s); ngưỡng ≤ 35 s: **Đạt**. Client 11 bị từ chối 4429, 0 mất sequence. `011-load-bl335.json` khóa `L3reentryTool`.

### 3.1c T079 phần còn lại: L1 xen kẽ 8080/8443 và RSS tab L5 (2026-10-19)

- **L1 xen kẽ** (`load-tester -alternate -tls-port 8443 -fingerprint …`, 1 giờ, `soak-std10` 500 Tag, 5 client `ws` + 5 client `wss`, rc.1 releaseSeq 13): 0 mất sequence cả hai đường, client 11 bị từ chối đúng; trễ p95 `ws` 61 ms, `wss` 43 ms; RSS tối đa 20,1 MB (**Đạt**); CPU trung bình **36,2 % một lõi** (18,1 % cả máy), đỉnh 47,8 % — **Không đạt** ngưỡng trung bình ≤ 30 % (L1 chỉ `ws`: 28,9 %). Nguyên nhân dự kiến: TLS cho một nửa client trên Cortex-A7 không có lệnh AES phần cứng. Đã làm: ưu tiên ChaCha20-Poly1305 (nhánh `gd6-tls-cpu`, mAT patch 1 của mbedTLS; trên BL335 ChaCha20 25,4 MB/s so với AES-128-GCM 6,7 MB/s). **Đo lại releaseSeq 14 (10:02–11:02): CPU trung bình 30,4 % một lõi (15,2 % cả máy)**, đỉnh 50,3 %, RSS 19,6 MB, 0 mất sequence; vẫn vượt 0,4 điểm theo cách đọc một lõi vì L1 chỉ `ws` đã 28,9–29,4 %. Đã làm thêm: live hub định dạng mỗi Tag thay đổi một lần mỗi tick và ghi mỗi khung WebSocket bằng một lần (nhánh `gd6-live-cpu`; bench trên BL335: dựng delta 500 Tag × 10 phiên 27,0 → 3,2 ms/tick). **Đo lại releaseSeq 15 (11:34–12:34): CPU trung bình 10,5 % một lõi (5,3 % cả máy), đỉnh 21,5 %, trễ p95 17 ms cả `ws` và `wss`, RSS 20 MB, 0 mất sequence — Đạt.** Các số L1/L2/L7 đo trước releaseSeq 15 ở trên là trước tối ưu này (cao hơn thực tế hiện tại).
- **L5 RSS tab** (`tools/measure/tab-rss.mjs`, 10 tab `svg-l5`, 10 phút, mỗi tab một renderer): RSS cuối mỗi tab 43–49 MB (đỉnh lúc mở 138 MB rồi giảm), JS heap ≤ 3,6 MB, độ dốc âm — không rò rỉ (**Đạt**).

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

Kết quả hiện hành: **lần đo 3** (cuối mục, releaseSeq 13): **Đạt**. Hai lần đo trước giữ lại làm lịch sử của tối ưu.

**Lần đo 1 (runtime 1.0.0, 2026-10-18 rạng sáng; lịch sử).** A/B/A/B, mỗi pha 15 phút, cùng tải L1 (10 client 500 Tag): `soak-std10` và `soak-logic` (= `soak-std10` + `logic.json` của `projects/logic-load`: 550 khối + 200 Tag nội bộ). Vòng quét đọc từ `GET /api/v1/logic` mỗi 30 s.

| Pha | CPU trung bình (một lõi) | RSS trung bình / cuối | Vòng quét lastMs (min / trung vị / max), p99 |
|---|---|---|---|
| 1 không logic | 28,6 % | 12,8 / 14,0 MB | — |
| 2 logic | 33,1 % | 16,9 / 18,2 MB | 8,0 / 15,6 / 21,8 ms, p99 ≤ 30,8 ms |
| 3 không logic | 28,4 % | 12,8 / 14,1 MB | — |
| 4 logic | 33,6 % | 17,7 / 19,0 MB | 10,4 / 16,4 / 21,1 ms, p99 ≤ 25,1 ms |

Chênh: **CPU +4,9 điểm một lõi = +2,4 điểm cả máy** (ngưỡng +3: Đạt theo cả máy, Không đạt theo một lõi); **RSS +4,5 MB** (ngưỡng +5: Đạt sát); **vòng quét ≈ 16 ms trung vị, p99 tới 31 ms (ngưỡng 5 ms): Không đạt**. Cả 550 khối `OK`, 0 mất sequence ở mọi pha.

Giới hạn và phương án lúc đó (đã thực hiện ở mục dưới):

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

Còn lại: một biểu thức tốn ≈ 1 µs VM trên Cortex-A7, một khối không chạy VM ≈ 1–1,5 µs (không do cache); quét 550 khối ≈ 2,3 ms khi rảnh. Dưới L1 lần đo trước thời gian quét gấp ≈ 1,9 lần lúc rảnh, nên dự kiến ≈ 4–4,5 ms (sát ngưỡng 5 ms) và CPU ≈ +2,7 điểm một lõi; đo lại A/B/A/B L1 với runtime build từ nhánh này: hai mục dưới.

**Lần đo 2 (lịch sử): BL335 với 1.0.0-rc.1 (2026-10-18 07:55–09:00, releaseSeq 12, gồm `gd6-logic-perf` và `gd6-logic-rss`).** Cùng cách đo A/B/A/B 4 × 15 phút, 10 client, 500 Tag; CPU tính theo **một lõi**:

| Tiêu chí | Không logic (pha 1, 3) | Có logic 550 khối (pha 2, 4) | Chênh | Ngưỡng | Trạng thái |
|---|---|---|---|---|---|
| CPU trung bình | 28,9 / 29,5 % | 32,7 / 32,3 % | **+3,3 điểm** một lõi (+1,65 cả máy) | ≤ +3 | **Không đạt** (vượt 0,3) |
| RSS trung bình | 16,6 / 17,2 MB | 20,6 / 21,0 MB | **+3,9 MB** | ≤ +5 MB | **Đạt** |
| Vòng quét | — | trung vị 2,5 ms, p99 3,8 ms (một lần p99 6,5 ms ở đầu pha 2) | — | ≤ 5 ms | **Đạt** |
| Chu kỳ quét thật | — | `intervalMs` 100, khoảng 9.370 quét mỗi pha | — | `scanMs` 100 | đúng |

0 mất sequence trong cả 4 pha, 550/550 khối OK, p95 trễ client 53–57 ms. So với lần đo trước tối ưu: vòng quét 16 → 2,5 ms, RSS +4,5 → +3,9 MB, CPU +4,9 → +3,3 điểm, trong khi logic nay quét đủ 10 lần/giây (trước đây bị kéo về 4 lần/giây theo vòng 250 ms).

Giới hạn và phương án cho CPU: (a) project ở mức tối đa 550 khối đặt `logic.scanMs` 200–250 ms (ước tính +1,3 đến +1,7 điểm); (b) tối ưu tiếp VM (≈ 1 µs mỗi biểu thức trên Cortex-A7); (c) đọc ngưỡng theo cả máy (2 lõi) như Master Plan §6.2 ghi "2 × Cortex-A7" (+1,65 điểm, đạt). Quyết định lúc đó: tính theo một lõi, T148 chưa đạt phần CPU; giải quyết bằng (b) ở lần đo 3.

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

**BL335 (thiết bị đích): mọi chỉ tiêu RAM và CPU đo được đều Đạt**, theo cách đọc chặt một lõi: L1 500 Tag × 10 client × 4 giờ (28,9 %, đỉnh 50,4 %, RSS ≤ 19,5 MB, 0 mất sequence; SC-011), L2 1.000 Tag (43,8 %; SC-012), L3, L4, L5, L8, logic tối đa L7 (+2,5 điểm, +3,8 MB, quét 1,05 ms; SC-028, sau tối ưu quét theo sự kiện ở releaseSeq 13), OTA thật (ngừng ≤ 15,9 s). RSS dưới tải cao nhất ≈ 15 % ngân sách 150 MB; CPU L1 theo một lõi còn biên 1,1 điểm (điểm cần theo dõi khi project lớn hơn).

**Không đạt:** bố cục phân vùng eMMC (§1.3; thiết bị chạy OS dev image, phụ thuộc ADR-002; OTA 1.0 dùng thư mục + `.prev` thay A/B). RSS L7 trên x64 64 bit đã Đạt sau T147 (+4,49 MiB ở L1 1 giờ, `runtimeL1b`; trước sửa +5,4 MiB).

**Chưa đo, có lý do:** eMMC theo phần ghi của mat và tmpfs trên thiết bị (chờ soak bàn thử T196; `mat-sample` chưa chạy trên BL335, phần còn lại của T079); tuổi thọ eMMC tuyệt đối (datasheet, T082); soak 7 ngày (hủy theo quyết định người dùng, T081); L6 trên BL335 (cần người, T086); L1 xen kẽ 8443 và RSS tab L5 (T079 phần còn lại); trễ đầu-cuối Chrome (X3, T196); cảnh báo RAM < 250 MB và tuổi thọ > 70 % (chưa có mã cảnh báo riêng); RS485 (pilot).

Không chỉ tiêu nào vượt ngân sách trên thiết bị đích nên không cần ADR mới (Constitution III); ADR-005 có dòng "Cập nhật 011" trỏ báo cáo này.
