# Soak và ghi eMMC, feature 011 (T087, T201)

**Trạng thái: kết luận cho GĐ 6 (2026-10-19).** Soak gia tốc x64 S0 24 giờ (T076) **xong** (2026-10-17 20:38 → 2026-10-18 20:38 UTC), đạt mọi tiêu chí đo được trong container; rig đã dừng và dọn. Soak chuẩn S1 7 ngày trên BL335 (T081) **không chạy: hủy theo quyết định người dùng 2026-10-18**. Soak bàn thử S2 30 ngày (T196) và đo eMMC trên thiết bị thuộc kỳ pilot. Lập 2026-10-17 trên `gd6` (commit `c86ebe85`).

Quy trình và ngưỡng: [contracts/test-protocols.md](../../specs/011-pilot-hardening/contracts/test-protocols.md) §2, §3; Master Plan §6.3, §6.4; FR-039, FR-045, FR-046; SC-013, SC-016. Tải và ngân sách RAM/CPU: [011-load.md](011-load.md).

Trạng thái: **Đạt**; **Không đạt** (kèm giới hạn và phương án); **Chưa đo** (kèm task và lý do). Số x64 đo trong Docker `mat-armhf` **Linux arm64 trên Apple Silicon (không phải x64 thật)**, không thay số BL335.

## 1. Công cụ

| Công cụ | Tình trạng |
|---|---|
| `deployment/device/mat-sample.sh` (sh, chỉ đọc, `/run/mat-sample`, quay vòng 8 × 1 MiB; có trong gói runtime qua `package-runtime.ps1`) | test `tools/soak/mat-sample.test.mjs` với `/proc` giả (`MAT_PROC_ROOT`); **đã chạy** trong container của S0 (1.446 mẫu, 0 dòng hỏng); chưa chạy trên BL335 |
| `tools/soak/analyze.mjs` (độ dốc RSS bỏ 24 giờ đầu, FD/luồng, ghi/ngày, `dmesg`, `EXT_CSD`) | `node --test` soak + powercut 55/55; **đã chạy** trên dữ liệu S0 |
| `tools/soak/collect.ps1` | parse sạch bằng pwsh; chưa chạy với thiết bị (dùng ở S2) |
| `tools/soak/x64-soak.mjs` (start, status, collect, stop) + `tests/soak/x64-driver.mjs` | **đã chạy** S0 (§2a) |
| `projects/soak-standard/` (500 Tag, lưu 200 Tag theo thay đổi, 3 màn hình) | sinh bằng `tools/gen-bench-projects.mjs`; lưu 7 ngày (30 ngày bị `W_LOG_SIZE_CAP`); chưa có logic mẫu, chưa có kênh Modbus (bàn thử S2 dùng project của kỹ sư, `docs/pilot/plan.md`) |
| `mat-runtime --check-data` | ctest 13/13; `history.db` 500 MiB 0,79 s (x64); chạy cuối S0 |

## 2. Tiêu chí soak (Master Plan §6.4, test-protocols §2)

| Tiêu chí | Ngưỡng | S0 x64 24 giờ (T076) | S1 BL335 7 ngày (T081) | Trạng thái |
|---|---|---|---|---|
| Khởi động lại ngoài kế hoạch | 0 | boot id không đổi (1 boot); bộ điều khiển ghi đủ 47 `kill -9` + 9 nạp xuống có kế hoạch; `NRestarts` của systemd không có trong container | Không chạy | x64 **Đạt** theo boot id và nhật ký bộ điều khiển (NRestarts **Chưa đo**) · BL335 **Chưa đo** — S1 hủy (quyết định người dùng), đo ở S2 (T196) |
| Độ dốc RSS | ≤ 0,5 MB/ngày | cần ≥ 24 giờ sau giờ đầu: 24,1 giờ mẫu chưa đủ | Không chạy | **Chưa đo** — x64 cần lượt > 25 giờ; BL335 ở S2 (T196). L1 4 giờ BL335: RSS đi ngang từ giờ thứ 2 (19,4 → 19,5 MB), chỉ là dấu hiệu, không thay độ dốc nhiều ngày |
| RSS lớn nhất | ≤ 150 MB | **34,1 MB** (cuối 33,6) | Không chạy (L1 4 giờ: 19,5 MB) | **Đạt** (x64; BL335 qua L1) |
| FD, luồng | thay đổi ≤ 5 % so với trung vị ngày 2 | cần dữ liệu ngày 2 | Không chạy | **Chưa đo** — cần soak ≥ 3 ngày (S2, T196). L1 4 giờ BL335: 109 luồng, FD 26–27 |
| Ghi đĩa mỗi ngày (tổng khối) | ≤ 2 GB mọi ngày | không có `/sys/block/mmcblk*` trong container | Không chạy; nền thiết bị khi mat tắt đã 2,6–4,7 GB/ngày (§4) | **Chưa đo trên thiết bị** — chờ soak bàn thử T196; kết luận theo phần ghi của mat (quyết định T201, §4) |
| tmpfs | ≤ 64 MB | **0 KiB** (`/dev/shm` của container) | Không chạy | x64 **Đạt** · BL335 **Chưa đo** (`mat-sample` chưa chạy trên thiết bị; S2) |
| `dmesg` | 0 lỗi `mmc`, `ext4`, `I/O error` | container không đọc được `dmesg` | Không chạy | **Chưa đo** — S2 (T196) |
| WAL | `history.db-wal` ≤ 64 MB, về nhỏ sau checkpoint | **4,3 MB** tối đa | Không chạy | **Đạt** (x64) |
| Dữ liệu | `--check-data` cuối kỳ mã 0; số dòng `history` ±1 % | `quick_check ok` cho `history.db`, `audit.db`, digest project khớp; mã 1 (`warning`) chỉ vì WAL chưa checkpoint khi kiểm lúc runtime đang ghi (hợp lệ theo test-protocols §4); số dòng ±1 % chưa đối chiếu | Không chạy | x64 **Đạt** phần toàn vẹn · đếm dòng ±1 % **Chưa đo** (cần bộ đếm tải đã biết; S2) |
| Soak 7 ngày (S1) | 7 ngày liên tục | — | — | **Chưa đo** — hủy theo quyết định người dùng 2026-10-18 (T081); thay bằng S0 x64 24 giờ, L1 4 giờ BL335, S2 khi pilot |
| Soak 30 ngày (S2) | như trên | — | — | **Chưa đo** — cần bàn thử và pilot (T196, P2) |

### 2a. S0 x64 24 giờ (T076): xong 2026-10-19

- **Rig** (tách rời, không phụ thuộc phiên đã khởi động nó): compose project `mat-soak-x64` (`tests/web-it/compose.yaml`, mạng nội bộ của Docker, cổng chỉ mở trên loopback), container `mat-soak-x64-rt-1` (runtime Release 1.0.0 của nhánh `gd6-docker-runs`, chạy dưới `supervise.sh`, project soak-standard: 500 Tag, lưu 200 Tag theo thay đổi) và `mat-soak-x64-client-1` (bộ điều khiển `tests/soak/x64-driver.mjs`). Docker `mat-armhf` Linux arm64 trên Apple Silicon, không phải x64 thật.
- **Tải**: L1 rút gọn — `load-tester` 10 client × 500 Tag (ws 8080) theo từng đoạn ~29 phút kết thúc trước mỗi lần kill; **`kill -9` runtime mỗi 30 phút** (`supervise.sh` chạy lại sau 2 s); **nạp xuống một projectVersion mới mỗi 2 giờ** (tài khoản kỹ sư, ngay sau một lần khởi động lại); `deployment/device/mat-sample.sh` mỗi 60 s trong rt (`MAT_SAMPLE_DIR=/data/mat-sample`, `MAT_TMP_DIR=/dev/shm`). Mật khẩu thử sinh ngẫu nhiên, chỉ nằm trong biến môi trường của các tiến trình trong container.
- Mẫu đầu tiên (20:38:45) đo tmpfs ở `/run` (không phải tmpfs trong container) và đã bị xóa khỏi tệp mẫu; sampler chạy lại với `MAT_TMP_DIR=/dev/shm` từ 20:39:18.
- **Thu và phân tích** (2026-10-18 20:46 UTC): `node tools/soak/x64-soak.mjs collect --out docs/reports/011-soak-x64.json` — chép mẫu và nhật ký bộ điều khiển ra ngoài repo, chạy `mat-runtime --check-data --json`, rồi `analyze.mjs --skip-hours 1 --planned-restarts 56 --check-data …`; tóm tắt bộ điều khiển ở khóa `driver`. Sau đó `x64-soak.mjs stop`: **rig đã dừng và dọn** (container, mạng, dữ liệu).
- Hạn chế: trong container không có `/sys/block/mmcblk*`, `/proc/<pid>/io` không đọc được và `dmesg` bị chặn, nên ghi đĩa/ngày, ghi của tiến trình, `dmesg`, eMMC là `not-measured`; độ dốc RSS cần ≥ 24 giờ sau giờ đầu; FD/luồng cần dữ liệu ngày 2. Bộ phân tích tính `warning` của `--check-data` là `fail` nên `overall` của JSON ghi `fail`; theo test-protocols §4, mã 1 do `-wal` cần phục hồi là hợp lệ (dòng "Dữ liệu" ở trên).

**Kết quả** (2026-10-17 20:38 → 2026-10-18 20:38 UTC, `docs/reports/011-soak-x64.json`):

| Mục | Kết quả | Ngưỡng / ghi chú | Trạng thái |
|---|---|---|---|
| Đoạn tải L1 rút gọn (10 client × 500 Tag) | 48/48 đạt, 0 mất sequence, p95 trễ tương đối tối đa 195 ms | 0 mất sequence | **Đạt** |
| `kill -9` mỗi 30 phút | 47 lần; phục vụ lại trung vị 1,04 s, 46/47 ≤ 1,2 s; một lần 25,7 s (05:08 UTC ngày 18, trùng lúc Docker build ASan và bản tối ưu VM cùng lúc trên cùng VM 2,8 GB) | — | **Đạt** (ghi chú lần chậm do máy đo) |
| Nạp xuống projectVersion mới mỗi 2 giờ | 9/9 `committed` (≈ 4,2 s) | — | **Đạt** |
| RSS tối đa | 34,1 MB (cuối 33,6 MB) | ≤ 150 MB | **Đạt** |
| WAL `history.db` | 4,3 MB | ≤ 64 MiB | **Đạt** |
| tmpfs | 0 KiB | ≤ 64 MiB | **Đạt** |
| `--check-data` cuối kỳ | `quick_check ok` cho `history.db` và `audit.db`; `warning` chỉ vì WAL chưa checkpoint (lần mở sau tự phục hồi); project digest khớp | không hỏng dữ liệu | **Đạt** |
| Độ dốc RSS, FD/luồng, ghi đĩa/ngày, ghi tiến trình, `dmesg`, eMMC, NRestarts | không đo được trong container | — | **Chưa đo** (lý do ở trên) |

Kết luận T076: đạt mọi tiêu chí đo được trên x64. Các tiêu chí phụ thuộc thiết bị (eMMC, ghi đĩa, `dmesg`, độ dốc nhiều ngày) thuộc soak trên BL335: S1 7 ngày hủy theo quyết định người dùng (T081), chuyển sang soak 30 ngày ở bàn thử pilot (T196).

Số tham khảo không thay soak: x64 soak 7 ngày giả của 010 (runtime 0.9.0, 200 Tag lưu trữ, có tổng hợp): ghi ~795 MB/ngày, DB 602 MB (`010-soak-x64.json`).

## 3. Điều kiện cho soak trên BL335 (S2 bàn thử, T196)

- Bàn thử chạy song song với site, cùng bản `1.0.0-rc.N`, PLC giả lập Modbus, tải chuẩn ([docs/pilot/plan.md](../pilot/plan.md) mục "Bàn thử"); cài `mat-sample` (có trong gói runtime) và `collect.ps1` mỗi giờ; đặt `maxLiveClientsPerSource: 10` nếu 10 client từ một máy.
- Thiết bị đo ở 011 đã có lần khởi động lại không rõ nguyên nhân (2026-10-16 khoảng 08:13; journal trước đó không còn, `last -x` không có `shutdown`) và một lần tắt nguồn (bật lại 2026-10-17 13:09), đều không do mat. Theo test-protocols §2, đồng hồ soak chạy lại từ đầu khi thiết bị khởi động lại ngoài kế hoạch; nên ghi nhận nguồn điện và watchdog (`atscada-watchdog.conf`, 16 s) trước khi chạy.
- Ưu tiên bàn thử không có dịch vụ `atscada-*` để ghi khối toàn máy phản ánh mat (xem §4).

## 4. Ghi eMMC và tuổi thọ

| Mục | Số đo | Trạng thái |
|---|---|---|
| Ghi toàn máy (`/sys/block/mmcblk0/stat`) | 0.9.0 (2026-10-16, cửa sổ 3 phút quy đổi): **mat tắt 2,6–4,7 GB/ngày** (trung bình ~3,8), mat chạy 3,5–3,8 GB/ngày; phần của mat không tách được khỏi nhiễu, ước **< ~1 GB/ngày** ở tải tank-demo/history-demo | **Không tách được trên thiết bị này** — nền không thuộc mat đã vượt 2 GB/ngày; không dùng số toàn máy để kết luận ngân sách của mat (quyết định dưới) |
| Ghi của runtime theo thành phần | kernel 5.4.61 không có `/proc/<pid>/io`; runtime 1.0 báo `historian.io.source: sqlite-vfs` (đếm byte SQLite ghi ở tầng VFS, [ADR-039](../adr/039-sqlite-write-meter.md)) và bộ đếm ghi theo thành phần (T029); chưa thu số qua một ngày tải chuẩn trên thiết bị | **Chưa đo trên thiết bị** — chờ soak bàn thử T196 |
| Chỉ số tuổi thọ (`life_time`, `pre_eol_info`) | T013 (2026-10-18): không có `mmc-utils`; sysfs `life_time` `0x01 0x01` (0–10 % đã dùng), `pre_eol_info` `0x01` (bình thường); chip `S0311D`, manfid `0xea`; runtime đọc đúng đường này | **Đạt** (đọc được) · bậc đầu/cuối kỳ: **Chưa đo** — S2 (T196, X4, X5) |
| Tuổi thọ ước tính (≥ 5 năm) | cần datasheet chip eMMC (TBW hoặc chu kỳ P/E); cách theo bậc `EXT_CSD` cần kỳ đủ dài | **Chưa đo** — chưa tính được tuổi thọ tuyệt đối: cần datasheet (T082, B5) |

**Quyết định (T201, 2026-10-19, người dùng giao toàn quyền):** ngưỡng "≤ 2 GB/ngày" của Master Plan §6.3 và SC-013 được **kết luận theo phần ghi của chính mat**, đo bằng bộ đếm `sqlite-vfs` và bộ đếm theo thành phần của runtime (`system/diagnostics`); ghi khối toàn máy (`blkSectorsWritten`) vẫn thu và báo cáo như **điều kiện môi trường**, dùng cho tuổi thọ chip (công thức test-protocols §3 lấy `W_day_max` toàn máy, bi quan). Lý do: trên thiết bị này dịch vụ không thuộc mat đã ghi 2,6–4,7 GB/ngày khi mat tắt, nên ngưỡng toàn máy không phản ánh sản phẩm. Số đo theo cách này chờ soak bàn thử T196. Ghi vào ADR-005 ("Cập nhật 011").

## 5. Kết luận

- **Đạt (x64, S0 24 giờ):** 0 mất sequence trên 48 đoạn tải, 47 `kill -9` và 9 nạp xuống đều phục hồi, RSS ≤ 34,1 MB, WAL ≤ 4,3 MB, tmpfs 0, dữ liệu toàn vẹn sau kỳ.
- **Chưa đo, có lý do:** S1 7 ngày trên BL335 (hủy theo quyết định người dùng 2026-10-18, T081; SC-013 ghi "Chưa đo — hoãn theo quyết định người dùng"); độ dốc RSS nhiều ngày, FD/luồng, `dmesg`, ghi đĩa/ngày, eMMC trên thiết bị (soak bàn thử T196); tuổi thọ tuyệt đối (datasheet, T082).
- **Không đạt:** không có số đo nào vượt ngưỡng. Ghi khối toàn máy của BL335 vượt 2 GB/ngày do dịch vụ khác là điều kiện môi trường, xử lý bằng quyết định ở §4.
