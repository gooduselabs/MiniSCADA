# Báo cáo nghiệm thu — 003 Lưu trữ dữ liệu Tag

Spec: [specs/003-data-logging/spec.md](../../specs/003-data-logging/spec.md). Trạng thái: **xong trên x64 và đã chạy trên BL335** (mục 8), cập nhật 2026-10-11, sau ba vòng sửa theo review (mục 6). Còn lại: cắt điện thật (cần người ở cạnh thiết bị) và gửi tới DB thật của người dùng (cần thông tin kết nối). Mục nào chưa đo ghi "chưa đo" kèm lý do. Số đo trên BL335 cần người dùng cho phép deploy.

## Tóm tắt theo tiêu chí

| SC | Nội dung | Kết quả | Bằng chứng |
|---|---|---|---|
| SC-001 | BL335: 500 Tag/1 s + nhóm theo thay đổi + 10 client, ≥ 99,9 % dòng, RSS ≤ 150 MB, CPU ≤ 30 % | **Đạt trên BL335** (30 phút: 100 % dòng, RSS tối đa 13,7 MB, CPU trung bình 11,7 %, 10 client 0 mất sequence) | mục 8 |
| SC-002 | Dòng chu kỳ lệch ≤ ± 250 ms | **Đạt** (x64 6–86 ms; BL335 tối đa 71 ms trên 3 × 1740 dòng) | mục 1, 8 |
| SC-003 | Thay đổi vượt deadband thành dòng ≤ khoảng tối thiểu + 1 s | **Đạt** (unit test, đồng hồ giả) | `core/historian/tests/sampler_test.cpp` |
| SC-004 | 4 loại DB: tạo bảng, ≤ 10 s, khớp 100 % | **Đạt trên x64** (600 dòng khớp 100 % ở cả 4 DB, 0,02–0,24 s; 39/39 test tích hợp); **từ BL335** (T078, DB thử qua đường hầm SSH): cả 4 đích khớp số dòng của thiết bị sau 10 phút, gửi bù 2250 dòng trong 14 s | mục 3, 8 |
| SC-005 | Mất kết nối 30 phút, 3 lần khởi động lại: 0 trùng, 0 thiếu | **Đạt trên x64** với cả 4 DB (gửi bù 1.800 dòng trong 0,21–0,71 s; 3 lần kill -9 giữa lúc gửi 20.000 dòng: 0 trùng, 0 thiếu) | mục 4 |
| SC-006 | Sau dọn không còn dòng quá hạn; màn hình không gián đoạn > 1 s | **Đạt trên x64** (0 dòng quá hạn; khoảng trống live lớn nhất 253 ms); BL335 chưa đo | mục 2 |
| SC-007 | Không vượt trần quá 5 % | **Đạt trên x64** (60,36 MB / trần 64 MiB); BL335 chưa đo | mục 2 |
| SC-008 | Dừng đột ngột/cắt điện không hỏng dữ liệu | phần tự động **đạt trên x64** (10 lần kill -9 lúc đang ghi: `integrity_check` = ok; dòng mất trên thiết bị khi mất điện không làm đích bỏ qua dòng mới, kể cả khi runtime khởi động lại trước lúc tới được đích: review C1 và vòng hai I1); trên BL335: 10 lần `kill -9`, `integrity_check` = ok cả 10 lần; cắt điện thật chưa đo (cần người ở cạnh thiết bị) | mục 4, 6, 8 |
| SC-009 | Vector cấu hình hai bản cùng kết luận | **Đạt** (69 vector, cùng mã lỗi và cảnh báo ở TS và C++) | mục 5 |
| SC-010 | Không lộ secret | **Đạt trên x64** (`status_test` đầu-cuối; `system/info` thật chỉ có mã phân loại; mật khẩu không vào project, log hay trạng thái) | mục 3, 5 |
| SC-011 | `ci-local.ps1` xanh, tích hợp 4 DB | **Đạt trên máy dev** (ci-local xanh: clang-format, armhf, smoke armhf dưới qemu, x64 350 test, Go, lint, typecheck, 211 test TS, build web; tích hợp 4 DB: forward 39/39, reliability và retention đạt, chạy lại sau vòng ba) | mục 3, 4, 7 |

## 1. US1 — lưu trên thiết bị (x64, 2026-10-10)

Cách chạy: `./deployment/toolchain/run-x64.ps1 -DataDir /tmp/mat-data` với `projects/tank-demo` (2 nhóm), chờ khoảng 3,8 phút, rồi `mat-runtime --export-history <nhóm> --data-dir /tmp/mat-data` trong container.

- **`system/info`** ngay sau khởi động: `"historian":{"clock":"ok","enabled":true,"groups":2,"rowsWritten":0,"state":"running"}`. Sau khoảng 3,8 phút: `rowsWritten` 230.
- **Nhóm `bao-cao-ca`** (chu kỳ 60 s): bốn dòng ở `19:15:00.086`, `19:16:00.041`, `19:17:00.006`, `19:18:00.052` (giờ +07:00), tức lệch 6–86 ms so với giây 0 (SC-002 trên x64).

  ```text
  time,TANK01_LEVEL,TANK01_INFLOW,MOTOR01_RUN
  2026-10-10 19:15:00.086,73.27,0,0
  2026-10-10 19:16:00.041,75.42,0,0
  2026-10-10 19:17:00.006,76.79,0,0
  2026-10-10 19:18:00.052,78.13,0,0
  ```

- **Nhóm `van-hanh`** (theo thay đổi, khoảng tối thiểu 1 s, deadband mức bồn 0,5): 226 dòng trong khoảng 3,8 phút, mỗi giây một dòng vì mức bồn đổi khoảng 2,7 %/s.
  - Dòng đầu (dòng gốc lúc khởi động) **toàn ô rỗng**: lượt lấy mẫu đầu chạy trước lần cập nhật đầu tiên của Mock Tag, nên mọi Tag còn chất lượng BAD. Đây là hành vi đúng với quy tắc "chất lượng xấu → rỗng", không phải lỗi. Driver thật cũng cho dòng như vậy trước lần quét đầu.

  ```text
  time,TANK01_LEVEL,MOTOR01_RUN,MOTOR01_SPEED,TANK01_TEMP
  2026-10-10 19:14:38.462,,,,
  2026-10-10 19:14:39.462,51.33,1,1453.5,25.1
  2026-10-10 19:14:40.462,54,1,1457.8,25.3
  ```

- **Unit test** (GoogleTest, x64): dựng model cấu hình, sampler (chu kỳ, theo thay đổi, deadband, khoảng tối thiểu/tối đa, nhảy giờ, ô rỗng, cắt chuỗi UTF-8), store SQLite (WAL, bảng rộng, thêm cột, bảng mồ côi, `seq` không quay về, file hỏng), lệnh xuất CSV, `Historian` (nhịp commit, lỗi ghi và thử lại, đồng hồ chưa hợp lệ). Toàn bộ 142 test x64 xanh tại thời điểm này.
- **Lỗi do test bắt được trước khi tới thiết bị:**
  - `GroupSampler` giữ tham chiếu tới đối tượng tạm (tham chiếu treo);
  - cột UINT64 khai báo `INTEGER` làm SQLite đổi số > 2^63−1 thành `REAL` (mất chính xác).

## 2. US2 — dọn dữ liệu và bảo vệ bộ nhớ (x64, 2026-10-10)

Cách chạy: `./tools/historian-it.ps1 -Scenario retention`. Kết quả thô: [003-retention-x64.json](003-retention-x64.json).

- **Dữ liệu:** `historian_tool fill` tạo 10 ngày cho bảng `van_hanh`, mỗi 500 ms một dòng: 1.728.000 dòng, khoảng 104 MB. Thời hạn lưu mọi nhóm 7 ngày.
- **Pha A, thời hạn lưu** (trần 256 MB để trần không can thiệp):
  - trước khi dọn: 518.406 dòng cũ hơn 7 ngày;
  - đợt dọn lúc khởi động xóa 518.458 dòng (gồm cả dòng vừa qua mốc trong lúc chạy);
  - sau đợt dọn: **0** dòng cũ hơn 7 ngày + 1 giờ (tiêu chí SC-006); 1 dòng cũ hơn 7 ngày đúng, là dòng vừa qua mốc giữa lúc dọn và lúc đếm (xem ghi chú);
  - không có lần xóa nào vì trần (`capPurges` 0);
  - client live 60 s trong lúc dọn: khoảng trống lớn nhất giữa hai delta **253 ms**, 0 lần hụt `seq`.
- **Pha B, trần dung lượng** (khởi động lại cùng dữ liệu, trần 64 MiB):
  - trước: khoảng 73 MB dữ liệu;
  - runtime xóa 266.000 dòng cũ nhất trong 1 đợt, còn **60.358.656 byte** (< 90 % trần, tức dưới mức dừng xóa 60,4 MB);
  - client live: khoảng trống lớn nhất **252 ms**, 0 lần hụt `seq`.
- Số trên là lần chạy lại sau vòng ba của mục 6 (2026-10-11 00:46); lần chạy sau vòng hai cho cùng số, trừ khoảng trống pha A 252 ms. Lần chạy sau vòng đầu (xóa theo `seq`, con trỏ lưu cùng giao dịch với dòng) cho kết quả tương đương: xóa 518.459 dòng, còn 60.350.464 byte, khoảng trống lớn nhất 253 ms.
- **Ghi chú khi đo:**
  - Lần chạy đầu thất bại vì `historian_tool fill` không tạo thư mục dữ liệu; đã sửa (tạo thư mục như runtime).
  - Bản đầu của kịch bản dùng trần 64 MB ngay từ đầu, nên trần xóa hết dòng cũ trước đợt dọn theo thời hạn (đợt dọn xóa 0 dòng). Kịch bản tách thành hai pha để đo riêng từng cơ chế.
  - Đếm "cũ hơn 7 ngày đúng" sau khi client live chạy xong cho 69 dòng: đó là dòng vừa qua mốc 7 ngày sau đợt dọn (500 ms/dòng × khoảng 35 s), sẽ bị xóa ở đợt kế tiếp (mỗi giờ). Tiêu chí SC-006 tính theo thời hạn + 1 giờ; kịch bản đếm cả hai mốc ngay sau đợt dọn.

## 3. US3 — gửi sang DB ngoài (x64, 2026-10-10)

Cách chạy: `./tools/historian-it.ps1 -Scenario forward`. Máy chủ: `mysql:8.4`, `mcr.microsoft.com/mssql/server:2022-latest`, `pgvector/pgvector:pg17`, `influxdb:2.7` (compose riêng `mat-hist-it`, không mở cổng ra máy, dữ liệu trong tmpfs). Mật khẩu và token sinh ngẫu nhiên mỗi lần chạy. Kết quả thô: [003-forward-x64.json](003-forward-x64.json).

**39/39 test đạt** (lần chạy lại sau vòng ba của mục 6, máy chủ mới tinh, 2026-10-11 00:41; thời gian 600 dòng: MySQL 0,024 s, SQL Server 0,243 s, PostgreSQL 0,027 s, InfluxDB 0,109 s).

| Kịch bản | MySQL 8.4 | SQL Server 2022 | PostgreSQL 17 | InfluxDB 2.7 |
|---|---|---|---|---|
| 600 dòng, 10 kiểu Tag (gồm INT64 min/max, UINT64 max, FLOAT64 1,79e308, chuỗi tiếng Việt có dấu nháy, dấu \\, xuống dòng, chuỗi rỗng); so từng ô và giờ +07:00 | đạt, 0,03 s | đạt, 0,26 s | đạt, 0,03 s | đạt, 0,13 s |
| Con trỏ `mat_forward_state` = 600 (InfluxDB: con trỏ trên thiết bị = 600) | đạt | đạt | đạt | đạt |
| Thêm Tag → thêm cột, 600 dòng cũ `NULL` | đạt | đạt | đạt | — |
| Sai mật khẩu/token → `auth` (1045 / 18456 / thông báo libpq / HTTP 401), sau đó mật khẩu đúng gửi được | đạt | đạt | đạt | đạt |
| Tài khoản chỉ có `INSERT/SELECT/UPDATE`, bảng do quản trị tạo sẵn → gửi được; thiếu cột → `permission` (1142 / 1088 / 42501) | đạt | đạt | đạt | — |
| Cột có sẵn sai kiểu → `schema_mismatch` (1366 / 245 / 22P02) | đạt | đạt | đạt | — |
| Bucket không có → `schema_mismatch` (HTTP 404) | — | — | — | đạt |
| 64 Tag chuỗi 255 ký tự | đạt | đạt | đạt | đạt |
| `tls=require` thật sự mã hóa (`Ssl_cipher`, `pg_stat_ssl`, `encrypt_option`) | đạt | đạt | đạt | — |
| `tls=verify-full` từ chối chứng chỉ tự ký của máy chủ thử (review bảo mật M2; SQL Server qua `ca file` của freetds.conf) | đạt, `tls` 2026 | đạt, `tls` 20002 (trước đây hiện `connect`, xem mục 6 "Quyết định của người dùng") | đạt, `tls` | — |
| Giá trị cột không chứa được (40000 cho INT16, -1 cho UINT16, 1e39 cho FLOAT32) thành `NULL`; 3 emoji vào `NVARCHAR(4)`/`VARCHAR(4)`/`TEXT`; `outOfRangeValues` đúng (review I2) | đạt, 3 | đạt, 4 (2 emoji còn lại) | đạt, 3 | — |
| Một nhóm bị từ chối (cột sai kiểu), nhóm kia của cùng kết nối vẫn gửi đủ 20 dòng trên **cùng phiên** (giao dịch bị từ chối đã rollback; review I1) | đạt | đạt | đạt | — |
| Bucket giữ 1 giờ, lô có 3 điểm cũ 2 ngày và 3 điểm mới: máy chủ trả **HTTP 422** "partial write: dropped 3 points … dropped=3"; forwarder coi là đã gửi, `rejectedRows` = 3, 3 điểm mới có trong bucket; đích vẫn `ok` vì điểm bị bỏ chỉ do thời hạn bucket (review I3, vòng hai I4) | — | — | — | đạt |
| Trần câu trả lời hạ xuống 10 dòng, câu lệnh trả 100 dòng → đóng phiên với `connect`, đọc không quá 11 dòng (vòng hai, bảo mật M) | đạt | đạt | đạt | — |
| `pg_sleep(8)` với hạn của client hạ xuống 2 s → dừng sau khoảng 2 s với `timeout` (vòng hai I2) | — | — | đạt | — |
| Database mã hóa `WIN1252` → từ chối ngay lúc kết nối, `schema_mismatch` / `22P05` (vòng hai, bảo mật M) | — | — | đạt | — |
| Máy chủ đặt `init_connect = 'SET NAMES latin1'` → phiên vẫn `utf8mb4`, chuỗi tiếng Việt có dấu nháy và dấu \\ đi về nguyên vẹn (vòng hai, bảo mật L) | đạt | — | — | — |
| Phiên trước commit muộn dòng 1–5 (cả khi chưa có dòng con trỏ, và khi con trỏ đã có giá trị khác): lô gửi lại từ con trỏ cũ bị từ chối, không lưu gì, đọc lại con trỏ rồi gửi tiếp; bảng có đúng 10 dòng (vòng ba, Important 2) | đạt, `sql` | đạt, `sql` 51000 | đạt, `sql` 40001 | — |
| Giao dịch của phiên trước còn giữ khóa con trỏ 1,5 s rồi mới commit: lô mới chờ khóa, rồi bị từ chối; bảng giữ 5 dòng (vòng ba, Important 2) | đạt | đạt | đạt | — |

**Lỗi do test tích hợp bắt được và đã sửa:**

- **SQL Server không mã hóa khi `tls=require`:** FreeTDS 1.1.6 ghi "UNIMPLEMENTED dbsetlbool()" cho `DBSETENCRYPT`, nên phiên vẫn không mã hóa (`encrypt_option = FALSE`). Đổi sang cách dự phòng của research R7: mỗi kết nối SQL Server có một mục trong file `freetds.conf` do runtime sinh (biến `FREETDSCONF`, trong `/tmp` riêng của dịch vụ), gồm `host`, `port`, `encryption = off/request/require`; `dbopen()` mở theo tên mục.
- **Đọc kết quả SQL Server:** cột không phải chuỗi (ví dụ `COUNT(*)`) trả về dạng nhị phân; nay đổi sang chữ bằng `dbconvert`.
- Hai lỗi trong chính test: đếm `NULL` của cột mới lẫn cả ô rỗng của dòng mới; PostgreSQL cần `GRANT` cho bảng do quản trị tạo (đúng hướng dẫn quyền tối thiểu).

**Thông báo gốc chỉ ở journal**, ví dụ `Access denied for user 'mat_writer'@'172.18.0.6'`; `system/info` chỉ có `code`, `dbCode` và câu cố định. Ký tự điều khiển trong thông báo của máy chủ thành `\x0a` (một bản ghi journal cho mỗi lỗi); NOTICE của PostgreSQL không còn in thẳng ra stderr.

**Lỗi do lần chạy này bắt được:** chạy lại kịch bản với `-Keep` của lần trước làm 4 test InfluxDB lỗi 401: InfluxDB giữ token quản trị của lần khởi tạo đầu trong volume, còn mỗi lần chạy sinh token mới. Không phải lỗi runtime; kết quả trên là lần chạy với máy chủ mới tinh (`docker compose -p mat-hist-it down -v` trước khi chạy lại).

## 4. US4 — mất kết nối, kill, dòng bị xóa trước khi gửi (x64, 2026-10-10)

Cách chạy: `./tools/historian-it.ps1 -Scenario reliability` (cùng 4 máy chủ của mục 3). Công cụ `historian_tool forward` chạy forwarder bằng thread của chính nó (cùng nhịp gửi bù với runtime: nghỉ ≥ 20 ms giữa các lô, ≤ 5.000 dòng/s) và lưu con trỏ thiết bị như historian. `historian_tool verify` so DB ngoài với `history.db`: số dòng, trùng theo `time`, thiếu, thừa, giá trị từng ô. Kết quả thô: [003-reliability-x64.json](003-reliability-x64.json). Số dưới đây là lần chạy lại sau vòng ba của mục 6, gồm cả bước so-rồi-ghi con trỏ (2026-10-11 00:44, máy chủ mới tinh): mọi phần đạt.

**Mất kết nối** (ngắt mạng tới máy chủ, ghi 1.800 dòng = 30 phút dữ liệu 1 s, có mạng lại):

| DB | Trong lúc mất mạng | Gửi bù | So với SQLite |
| --- | --- | --- | --- |
| MySQL 8.4 | `error` / `connect`, chờ 1800 dòng | 1800 dòng, 0,529 s | 1860/1860 dòng, 0 trùng, 0 thiếu, 0 ô sai |
| SQL Server 2022 | `error` / `connect`, chờ 1800 dòng | 1800 dòng, 0,709 s | 1860/1860 dòng, 0 trùng, 0 thiếu, 0 ô sai |
| PostgreSQL 17 | `error` / `connect`, chờ 1800 dòng | 1800 dòng, 0,529 s | 1860/1860 dòng, 0 trùng, 0 thiếu, 0 ô sai |
| InfluxDB 2.7 | `error` / `connect`, chờ 1800 dòng | 1800 dòng, 0,208 s | 1860/1860 dòng, 0 trùng, 0 thiếu, 0 ô sai |

**Kill -9 giữa lúc gửi** (20.000 dòng, 3 lần `docker kill` sau 0,4–1,2 s, rồi chạy tới hết):

| DB | Lần chạy cuối còn gửi | So với SQLite |
| --- | --- | --- |
| MySQL 8.4 | 5500 dòng (các lần kill đã cắt ngang lúc đang gửi) | 20000/20000 dòng, 0 trùng, 0 thiếu |
| SQL Server 2022 | 12000 dòng (các lần kill đã cắt ngang lúc đang gửi) | 20000/20000 dòng, 0 trùng, 0 thiếu |
| PostgreSQL 17 | 9500 dòng (các lần kill đã cắt ngang lúc đang gửi) | 20000/20000 dòng, 0 trùng, 0 thiếu |
| InfluxDB 2.7 | 1345 dòng (các lần kill đã cắt ngang lúc đang gửi) | 20000/20000 dòng, 0 trùng, 0 thiếu |

SQL: con trỏ nằm cùng giao dịch với dòng và chỉ dời từ giá trị đã đọc, nên không trùng. InfluxDB: gửi lại cùng điểm thì ghi đè, nên cũng 0 trùng.

**Dòng bị xóa trước khi gửi** (10 ngày dữ liệu mỗi 60 s, thời hạn 7 ngày): đích nhận ngày đầu (1440 dòng) rồi vắng mặt; đợt dọn xóa 4321 dòng của 3 ngày đầu, trong đó 2881 dòng chưa kịp gửi. Cả 4 DB có `lostRows` = **2881**, đúng bằng số dòng bị xóa mà chưa gửi; 10.079 dòng còn lại gửi đủ, khớp SQLite từ ngày thứ ba (`verify --from-ms`). Kịch bản đổi theo review S1: đích mới chưa nhận dòng nào thì dòng đã xóa trước đó không tính là mất (bản trước của kịch bản đếm 4321 cho một đích chưa nhận gì).

**SQLite khi bị kill -9 lúc đang ghi** (`historian_tool write-loop`, 100 dòng mỗi 10 ms, kill sau 0,5–1,5 s, 10 lần): `integrity_check` = `ok`, `ok`, `ok`, `ok`, `ok`, `ok`, `ok`, `ok`, `ok`, `ok`.

**Lỗi do kịch bản bắt được và đã sửa:**

- Lần chạy đầu kịch bản kill cho "đạt" nhưng vô nghĩa: `historian_tool forward` gọi `runOnce()` liên tục không có nhịp gửi bù, gửi hết 20.000 dòng trước lần kill đầu. Nay công cụ dùng thread của forwarder như runtime, và kịch bản đòi lần chạy cuối còn dòng để gửi.
- SQL Server khi mất mạng báo `sql` thay vì `connect`: lỗi db-lib 20013 (không phân giải được tên máy) chưa nằm trong nhóm `connect`. Đã thêm các mã mạng của db-lib (20002, 20004, 20006, 20008, 20009, 20012, 20013, 20017, 20022, 20047).

## 5. US5, US6 — kiểm cấu hình, trạng thái, Studio (x64, 2026-10-10)

- **Validator hai bản (SC-009):** 69 vector `tests/project-vectors` (31 vector `logging-*`, đủ 13 mã `E_LOG_*` và 3 mã `W_LOG_*`; `valid-tank-demo` đòi không có cảnh báo): bản TS (Vitest) và bản C++ (GoogleTest) cho cùng tập mã lỗi và cùng tập cảnh báo ở mọi vector.
- **Ước tính:** 500 FLOAT32 mỗi 1 s → 994.083.840 byte ghi/ngày, không cảnh báo; mỗi 100 ms → 8.029.808.640 byte/ngày → `W_LOG_WRITE_BUDGET` và `W_LOG_SIZE_CAP` (một ngày dữ liệu đã 3,9 GB). Hai bản cho cùng số (`logging.test.ts`, `logging_estimate_test.cpp`).
- **Studio cho lưu khi chỉ còn `W_LOG_*`** (FR-024): `canSave`, câu "Hợp lệ với N cảnh báo lưu trữ (vẫn lưu được)" (`save-policy.test.ts`; `W_LOG_TLS_UNVERIFIED` cũng không chặn).
- **`system/info` không lộ thông tin kết nối (SC-010):** `status_test` chạy Historian với đích bị từ chối, chuỗi lỗi gốc chứa host, user, database, URL và mật khẩu; không chuỗi nào lọt vào JSON.
- **Tab Thiết bị (T069, phần tự động):** runtime x64 với project có 2 kết nối (một tới địa chỉ không tới được, một chưa có bí mật). `system/info` thật qua `historianSummary` của Studio:

  ```text
  running · 11 dòng · 48 KB / 2.0 GB
  office · connecting · chờ 0 dòng · trễ 0 s · Không kết nối được máy chủ
  cloud · no_secret · chờ 0 dòng · trễ 0 s · Chưa có mật khẩu/token trên thiết bị, hoặc file secrets sai quyền
  ```

  JSON chỉ có `code`/`dbCode`/câu cố định (`connect`, `2002`); câu gốc "Can't connect to MySQL server on '10.255.255.1'" chỉ có trong log của tiến trình. Phần nhìn bằng mắt trong ứng dụng Studio (bấm nút Lưu với vector `logging-warn-budget`) cần người kiểm.

## 6. Review code và review bảo mật (T073, 2026-10-10)

Hai review chỉ đọc code (review code và review bảo mật), chạy hai vòng: vòng đầu trên bản hoàn chỉnh, vòng hai kiểm lại chính các bản sửa. Thêm một vòng ba: review code độc lập cho các bản sửa của vòng hai. Mọi mục được sửa theo kiểu test trước, trừ các mục ghi "chưa làm". Sau mỗi vòng đều kiểm lại: unit test x64, 69 vector hai validator, test tích hợp 4 DB (mục 3) và các kịch bản ở mục 2, 4.

### Vòng đầu

Review code: 2 Critical, 9 Important, 14 gợi ý. Review bảo mật: 0 Critical/High, 4 Medium, 4 Low, 9 hardening.

| Mục | Vấn đề | Đã làm | Test / bằng chứng |
|---|---|---|---|
| C1 | Mất điện làm `seq` bị cấp lại, đích SQL bỏ qua dòng mới mà không báo | historian trao `seq` lớn nhất lúc mở file; lần chuẩn bị đầu tiên, con trỏ của đích lớn hơn mốc đó thì hạ về mốc (dòng ghi trong lúc đích vắng mặt vẫn được gửi); con trỏ lưu cùng giao dịch với dòng. Giữ `synchronous=NORMAL` theo Constitution (`FULL` cần sửa Constitution). Vòng hai: mốc giữ trong `history.db` qua lần khởi động lại (Code I1 ở bảng dưới) | `ForwarderTest.DestinationCursorAheadOfTheDeviceIsRewound`, `RowsWrittenSinceTheFileWasOpenedAreNotSkippedByTheRewind`, `AReconnectionNeverRewindsTheCursor`, `LocalStore.LastSeqEverOfTheWriter`; cắt điện thật: T077 |
| C2 | Cột Tag tên `rowid` làm dọn/trần xóa sai dòng | `DELETE` theo `seq`; tên dành riêng ở hai validator | `LocalStore.ColumnNamedRowidDoesNotChangeWhatIsDeleted`, vector `logging-invalid-column-rowid` |
| I1 | Backoff về 1 s khi kết nối được; một nhóm lỗi chặn mọi nhóm | lỗi câu lệnh chỉ dừng nhóm đó (backoff riêng, giữ kết nối, rollback); backoff chung chỉ về 1 s sau lô gửi được hoặc khi rảnh | `ForwarderTest.StatementErrorsOfOneGroupDoNotBlockTheOthers`, `RepeatedConnectionErrorsAfterConnectStillBackOff`, IT `ARefusedGroupDoesNotBlockTheOtherOnTheSameSession` ×3 |
| I2 | Giá trị cột không chứa được thành "dòng độc" | `NULL` + đếm `outOfRangeValues`; chuỗi cắt theo cột (SQL Server: UTF-16) | `SqlDialect.ValuesTheColumnCannotHoldAreSentAsNullAndCounted`, `StringsFitTheColumnAndAreValidUtf8`, IT `ValuesTheColumnCannotHoldGoAsNull` ×3 |
| I3 | InfluxDB ghi một phần làm đích kẹt mãi | 400/422 có "partial write" là đã gửi, đếm `rejectedRows` | `InfluxLine.PartialWriteIsRecognized`, IT `PointsOlderThanTheBucketKeepsAreCountedAndTheRestGoes` (HTTP 422 thật) |
| I4 | Con trỏ của file cũ ghi vào file mới | con trỏ mang instance id; file mới bỏ qua con trỏ của file khác; `reopen()` xóa con trỏ chờ lưu | `LocalStore.CursorsOfAnotherFileAreIgnored`, `ForwarderTest.ReopenDropsTheCursorsOfTheOldFile` |
| I5 | Tên cột trùng cột hệ thống PostgreSQL | tên dành riêng | vector `logging-invalid-column-pg-system` |
| I6 | File hỏng phát hiện lúc commit không bao giờ được thay | `replaceCorrupt()`: đổi tên file hỏng, tạo file mới (instance id mới), forwarder mở lại | `Historian.ADamagedPageFoundByACommitStartsANewFile` (hỏng trang thật), `LocalStore.ReplaceCorruptKeepsTheOldFileAndStartsANewOne` |
| I7 | Dừng dịch vụ quá TimeoutStopSec; DDL chờ từng câu; PostgreSQL khóa bảng khi `CREATE INDEX IF NOT EXISTS` | dừng hai pha; đồng bộ lược đồ dừng ngay khi mất kết nối/hết giờ; tìm chỉ mục trước khi tạo | `ForwarderTest.RequestStopLetsSeveralForwardersEndTogether`, `SqlDestination.ALostConnectionStopsTheSyncAtOnce`, `SyncCreatesWhatIsMissingAndLooksForTheIndexFirst` |
| I8 | Nhịp gửi bù không giới hạn CPU khi nhóm rộng | nghỉ ít nhất bằng thời gian CPU của lô; thread gửi nice +10 | `ForwarderPacing.PauseBetweenBatchesRowRateAndDutyCycle`; CPU trên BL335: T076 |
| I9 | Validator không thêm `t_` cho id nhóm bắt đầu bằng chữ số | thêm ở hai validator | vector `logging-valid-digit-group` |
| S1, S2 | `lostRows` của đích mới; dòng bị xóa giữa hai lần đọc | chỉ đếm khi con trỏ > 0, đếm từ khoảng trống trước dòng đầu của lô, mỗi khoảng một lần | `RowsDeletedBeforeANewDestinationGotAnyAreNotLost`, `RowsDeletedBeforeSendingAreCountedOnceAndSkipped`, kịch bản lost (mục 4) |
| S3 | Con trỏ InfluxDB chỉ theo id kết nối | khóa gồm id, URL, org, bucket | `ForwarderTest.InfluxCursorIsKeyedByTheServer` |
| S7, S8 | Chi phí khi rảnh; ghi eMMC thêm vì lưu con trỏ riêng mỗi 5 s | thức sau mỗi commit hoặc 5 s; con trỏ đi cùng commit dữ liệu, riêng lẻ tối đa mỗi phút | `HistorianForwarding.CursorsWithoutRowsAreSavedAtMostOnceAMinute` |
| S9 | `SIGPIPE` bỏ qua sau khi thread đã chạy | chuyển lên đầu `main` | đọc code |
| S10, L1 | `freetds.conf` ở đường dẫn đoán được, fail-open | thư mục riêng `mkdtemp` (0700), `O_EXCL`, không ghi được thì không kết nối | IT SQL Server (mục 3) |
| S11, L2 | `--set-secret`: bí mật không phải UTF-8 làm crash; thiếu nhóm `matscada` vẫn báo thành công | từ chối kèm thông báo (không in bí mật); cảnh báo khi dịch vụ chưa đọc được file | `SetSecretCli.ASecretThatIsNotUtf8IsRefused`, `SaysWhenTheServiceCannotReadTheFileYet` |
| S12, hardening 8 | instance id rỗng hoặc sai dạng | forwarder không gửi khi instance id không phải UUID; xóa `POSTFIELDS` sau mỗi lần gửi InfluxDB | `ForwarderTest.AFileWithoutAValidInstanceIdIsNotSentFrom` |
| S13 | Hạ chữ Unicode ở TS (ký tự Kelvin) | hạ chữ ASCII như bản C++ | vector `logging-invalid-key-kelvin` |
| S14 | `valid-tank-demo` không kiểm "không cảnh báo"; thiếu test reopen/corrupt, lỗi lặp, nhóm chặn nhóm | thêm `"warnings": []` và các test ở các dòng trên | vector `valid-tank-demo` |
| M1 | Chuỗi Tag không phải UTF-8 chặn cả kết nối, vượt `maxLength` | sửa UTF-8 ngay ở `TagStore::set` (cũng chữa frame WebSocket hỏng), ở sampler (cắt sau khi sửa), ở literal SQL và line protocol | `utf8_test`, `TagStore.StringsAreStoredAsValidUtf8`, `Sampler.StringsAreValidUtf8AndBounded`, `InfluxLine.StringsAreValidUtf8` |
| M2 | TLS mặc định không xác thực máy chủ | SQL Server nhận `verify-full` (`ca file`); cảnh báo `W_LOG_TLS_UNVERIFIED` ở hai validator; hướng dẫn CA nhà máy. Mặc định đổi sang `verify-full` sau khi người dùng giao quyết định (cuối mục). **Chưa làm:** file CA riêng mỗi kết nối, trạng thái TLS trong `system/info` | IT `VerifyFullRefusesAnUntrustedCertificate`, vector `logging-valid`/`logging-valid-verified` |
| M3 | Chèn công thức Excel khi xuất CSV | ô chuỗi bắt đầu bằng `= + - @`, tab, CR thêm `'` | `ExportHistory.TextASpreadsheetWouldRunIsNotAFormula` |
| M4 | SQLSTATE nguyên văn vào `system/info`, byte không phải UTF-8 làm sập runtime | chỉ nhận SQLSTATE đúng dạng; JSON cho client thay byte hỏng bằng U+FFFD, `system/info` bắt ngoại lệ (503) | `ErrorClass.SqlStateShape`, `JsonText.BytesThatAreNotUtf8BecomeReplacementCharacters` |
| L3 | Giả dòng journal bằng văn bản của máy chủ | `journalSafe()` cho mọi văn bản của máy chủ; bỏ NOTICE của PostgreSQL | `ForwarderJournal.ControlCharactersAreEscapedAndLengthBounded`, log IT |
| L4 | Tài khoản/mật khẩu trong URL | `E_LOG_SECRET`; URL không có `@ ? #` | vector `logging-invalid-url-credentials`, `logging-invalid-url-query` |
| hardening 1–5, 7 | `LOCAL INFILE`; con trỏ từ máy chủ; thư mục thư viện client; quyền file SQLite; backoff khi sai mật khẩu; `read -rs` trong tài liệu | `MYSQL_OPT_LOCAL_INFILE=0`; con trỏ phải là số không âm vừa BIGINT; chỉ nạp thư viện đi kèm từ thư mục thuộc root, không ai khác ghi được; `0600`; 1, 2, 4, 5 phút; sửa tài liệu | `client_api_check_test`, `SqlDestination.CursorMustBeANumberTheDeviceCanUse`, `DynLib.AShippedLibraryIsTriedOnlyFromATrustedPlace`, `ForwarderTest.AuthErrorsWaitLongerNotToLockTheAccount` |
| ngoài 003 | `deploy.sh` ghi `/tmp/mat-check-project.json` bằng root | `mktemp` | đọc code |

**Chưa làm, ghi lại:**

- **M2 (phần còn lại):** file CA riêng cho từng kết nối và trạng thái TLS trong `system/info`. Mặc định đã đổi sang `verify-full` (xem "Quyết định của người dùng" cuối mục).
- **S4:** hai id kết nối trỏ cùng một database dùng chung hàng `mat_forward_state`, có thể ghi một dòng hai lần. Validator không biết hai địa chỉ khác nhau có phải cùng máy chủ hay không; ghi vào contract `external-schema.md`: mỗi database chỉ khai một kết nối.
- **S5, S6:** thời gian biên dịch của SQL Server với lô 500 × 200 ô, và RAM khi gửi bù 8 đích: đo trên BL335 (T076).
- **S13 (phần cũ từ Sprint 1):** số nguyên viết `60000.0`: C++ báo `E_SCHEMA`, TS cho qua.
- **M1 (cách ly dòng độc bằng chia đôi lô):** không làm. Giá trị không vừa cột đã thành `NULL`, chuỗi hỏng đã được sửa; lỗi còn lại (bảng sai kiểu do người quản trị) chỉ dừng nhóm đó và cần người quản trị sửa.
- **Hardening 6:** Ubuntu 20.04 hết hỗ trợ chuẩn; ghi vào tài liệu triển khai (gói client chỉ còn vá qua Ubuntu Pro/ESM).
- **Hardening 9:** Flux trong test tích hợp ghép chuỗi không escape: chỉ dùng trong test, đầu vào là hằng của test.

### Vòng hai (kiểm lại các bản sửa)

Review code: 0 Critical, 4 Important, 6 gợi ý. Review bảo mật: 0 Critical/High, 3 Medium, 4 Low, 7 hardening; xác nhận M4, L1, L2, L4 và hardening 1, 2 của vòng đầu đã đạt. Các mục dưới đây đã sửa, test viết trước.

| Mục | Vấn đề | Đã làm | Test / bằng chứng |
|---|---|---|---|
| Code I1 | Mốc C1 chỉ nằm trong RAM. Mất điện rồi khởi động lại trước khi tới được đích (đích còn tắt, hoặc vừa deploy) thì dòng của lần chạy trước bị bỏ qua | Mốc của đích SQL giữ trong bảng `mat_forward_mark` tới khi forwarder đã so con trỏ của đích với nó; mốc cũ (nhỏ hơn) được giữ. Giao dịch xóa mốc chạy `synchronous=FULL` (ngoại lệ được người dùng chấp thuận, xem cuối mục), và nhóm chỉ gửi sau khi việc xóa đã nằm trên eMMC | `HistorianForwarding.AMarkSurvivesARestartBeforeTheDestinationWasReached`, `TheMarkStaysUntilTheForwarderCheckedItsDestination`, `LocalStore.ForwardMarksStayUntilCleared`, `ForwarderTest.AGroupSendsOnlyOnceItsMarkIsOffTheDevice` |
| Code I2 | PostgreSQL không có hạn chờ phía client: `PQexec` có thể chờ tới TCP keepalive (khoảng 2 giờ) | Kết nối và câu lệnh bất đồng bộ, hạn 10 s (kết nối, gồm TLS và đăng nhập) và 35 s (mỗi câu), keepalive 10/5/3 s | IT `SqlLimitsIt.AStatementWithoutAnswerEndsOnTheClientDeadline` (hạn hạ xuống 2 s: dừng sau khoảng 2 s với `timeout`) |
| Code I3 | Đọc `history.db` gặp trang hỏng: lỗi bị bỏ qua, trạng thái vẫn `ok`; dọn dữ liệu gặp trang hỏng không dẫn tới thay file | Nhóm báo `sql` / `sqlite:11` và chờ. Forwarder báo historian; historian thay file nếu đó vẫn là file hiện tại. Dọn theo thời hạn hay theo trần gặp trang hỏng cũng thay file | `ForwarderTest.ADamagedPageOfTheFileIsAnErrorAndIsReported`, `Historian.ADamagedPageFoundByAForwarderStartsANewFile`, `HistorianMaintenance.ADamagedPageFoundByRetentionStartsANewFile` |
| Code I4 | InfluxDB: field khác kiểu bị che, đích vẫn `ok` trong khi dữ liệu mất liên tục | Lô bị nhận một phần vẫn tính là đã gửi. Nếu không chỉ do thời hạn bucket, đích báo `schema_mismatch` tới khi có một lô đi trọn | `ForwarderTest.APartlyRefusedBatchIsSentAndTheErrorShows`, `InfluxLine.PartialWriteIsRecognized`, IT `InfluxIt.PointsOlderThanTheBucketKeepsAreCountedAndTheRestGoes` |
| Code S5 | Lỗi phía client MySQL (CR_* 2000–2999, 4031, 1927) và phiên SQL Server đã chết bị coi là lỗi câu lệnh | Xếp vào `connect`; SQL Server kiểm `dbdead()` | `ErrorClass.MySqlLostSessionsCloseTheConnection` |
| Code S6 | UINT64 từ số thực ≥ 2^63 sai ở line protocol | Dùng `%.0f` như phía SQL | `InfluxLine.LargeUnsignedFromADouble` |
| Code S7 | SQL Server từ chối số dưới chuẩn (subnormal) | Gửi 0, đếm vào `outOfRangeValues` | `SqlDialect.SubnormalNumbersGoAsZero` |
| Code S8 | Khóa con trỏ InfluxDB có thể trùng khi org/bucket chứa `\|` | Ghi kèm độ dài | `ForwardCursorKey.DifferentBucketsNeverShareAKey` |
| Code S9 | Mở lại đúng file cũ vẫn bắt forwarder mở lại; đổi tên file hỏng không kiểm kết quả; hai lần thay trong một giây ghi đè nhau | Forwarder chỉ mở lại khi instance id đổi. Đổi tên `-wal`, `-shm` trước rồi mới tới file chính, lỗi ở bước nào cũng dừng. Tên file hỏng có thêm số thứ tự | `LocalStore.DamagedFilesReplacedInTheSameSecondAreAllKept` |
| Code S10 | Thiếu test forwarder theo file mới; vector chỉ so mã cảnh báo; test dừng dựa vào sleep | Thêm test; vector `logging-valid` so cả đường dẫn cảnh báo (`warningPaths`) ở hai validator; test dừng chờ tới khi cả hai lô đang chạy | `ForwarderTest.AfterTheFileIsReplacedTheNewRowsGoWithTheNewInstanceId`, `RequestStopLetsSeveralForwardersEndTogether` |
| Bảo mật M | Database PostgreSQL không phải UTF8: dòng có ký tự ngoài bảng mã bị từ chối mãi | Từ chối ngay lúc kết nối (`schema_mismatch`, `22P05`) | IT `PgEncodingIt.ADatabaseThatIsNotUtf8IsRefused` |
| Bảo mật M | CSV: công thức sau `;` (dấu phân cách khi Excel đặt vi-VN) lọt qua | Mọi vị trí có thể bắt đầu ô (đầu chuỗi, sau `,` `;` tab hoặc xuống dòng) đều được thêm `'` | `ExportHistory.AFormulaAfterASeparatorInsideTheTextIsNotRunEither` |
| Bảo mật M | Máy chủ bị chiếm, hoặc kẻ đứng giữa, gửi câu trả lời cực lớn: hết RAM, runtime khởi động lại liên tục | Mỗi câu tối đa 100.000 dòng và 16 MiB, đọc từng dòng, vượt thì đóng phiên. MySQL đặt gói tối đa 16 MiB | IT `SqlIt.AHugeAnswerIsRefused` ×3 (trần hạ xuống 10 dòng trong test) |
| Bảo mật L | NOTICE của PostgreSQL trước khi đăng nhập xong vẫn in ra stderr | Kết nối bất đồng bộ, đặt notice processor ngay sau `PQconnectStartParams` | đọc code; log IT không còn dòng NOTICE |
| Bảo mật L | Quy trình deploy dùng thư mục cố định `/tmp/mat-deploy` | Một phiên SSH, `mktemp -d` | `docs/deployment/mat-runtime.md` |
| Bảo mật L | `--export-history` in ký tự điều khiển thẳng ra terminal | Khi stdout là terminal: ký tự điều khiển hiện dạng `\xNN`; ghi ra file thì giữ nguyên | `ExportHistory.ControlCharactersAreShownOnATerminal` |
| Bảo mật L | MySQL: escape giả định phiên `utf8mb4`, máy chủ có thể đặt bảng mã khác qua `init_connect` | `mysql_set_character_set` sau khi kết nối, rồi kiểm `@@character_set_client` | IT `MysqlCharsetIt.TheSessionIsUtf8mb4WhateverTheServerSets` |
| Hardening 1 | Nạp thư viện: chỉ kiểm thư mục gần nhất, nhận cả file của euid | Chỉ nhận khi file thật (sau khi theo symlink) và **mọi thư mục cha** thuộc root, nhóm và người khác không ghi được | `DynLib.AShippedLibraryIsTriedOnlyFromATrustedPlace`, `AParentOthersCanWriteToIsNotTrusted` |
| Hardening 2 | `freetds.conf` có thể bị đổi sau khi ghi | Kiểm file trước mỗi lần kết nối (thuộc runtime, quyền 0600), không đạt thì không kết nối | đọc code; IT SQL Server |
| Hardening 3 | Partial write: đọc `dropped=` trên cả phản hồi | Chỉ đọc trường `message` của JSON, tối đa bằng số dòng đã gửi | `InfluxLine.PartialWriteIsRecognized` |
| Hardening 4 | Bí mật có thể nằm trong core dump | `prctl(PR_SET_DUMPABLE, 0)` đầu `main`, `LimitCORE=0` trong unit systemd | đọc code |
| Hardening 5 | `prefer` cho phép kẻ đứng giữa hạ cấp xuống kết nối không mã hóa | Sau một phiên TLS thành công, MySQL và PostgreSQL không hạ cấp nữa (tới lần khởi động lại) | đọc code |
| Hardening 6, 7 | NUL trong line protocol; `journalSafe` để lọt U+2028/2029 và ký tự điều khiển chiều chữ (bidi) | Bỏ NUL; hai loại ký tự trên hiện dạng `\uXXXX` | `InfluxLine.StringsHaveNoNul`, `ErrorClass.JournalTextShowsInvisibleControls` |

**Còn lại sau vòng hai:**

- **SQL Server, chế độ `request` (`prefer`):** FreeTDS tự quyết việc hạ cấp, runtime không chặn được. Dùng `require` hoặc `verify-full`.
- **PostgreSQL, một dòng dữ liệu cực lớn:** libpq vẫn đệm trọn một dòng trước khi trả về, vì libpq không giới hạn từng thông điệp DataRow. Cách xử lý gốc là `verify-full`.
- **Thư viện client:** không `dlopen` qua `/proc/self/fd`. Cả chuỗi thư mục đã phải thuộc root và không ai khác ghi được, nên khe giữa lúc kiểm và lúc nạp chỉ root khai thác được.

### Vòng ba (review độc lập các bản sửa vòng hai, 2026-10-11)

Review code (agent `code-reviewer`, chỉ đọc code) cho riêng các bản sửa vòng hai: 0 Critical, 4 Important, 4 Minor, không mục nào có test bắt được. Từng mục được kiểm lại trong code, và với máy chủ thật khi cần, rồi sửa theo kiểu test trước. Ở mọi mục, test mới đều đỏ trước khi sửa.

| Mục | Vấn đề | Đã làm | Test / bằng chứng |
|---|---|---|---|
| Important 1 | PostgreSQL: máy chủ (hoặc kẻ đứng giữa) trả lời bằng COPY. libpq trả kết quả COPY ở mọi lần gọi mà không chờ socket, nên vòng đọc quay 100 % CPU và `Historian::stop()` treo | Trạng thái lạ (COPY…) đóng phiên ngay (`connect`); hạn chờ được kiểm ở mỗi kết quả | `PgSession.ACopyAnswerEndsTheCall` (máy chủ PostgreSQL giả trong unit test; trước khi sửa: treo, `timeout` cắt sau 60 s) |
| Important 2 | Client bỏ cuộc ở hạn chờ trong khi máy chủ vẫn chạy giao dịch rồi commit muộn. Lần gửi lại đọc con trỏ cũ, nên lô bị lưu hai lần (bảng dữ liệu chỉ có khóa `id`) | Mỗi lô dời con trỏ **chỉ từ giá trị forwarder đã đọc** (so rồi mới ghi, làm trước khi chèn dòng). Giá trị khác thì không lưu gì và báo lỗi câu lệnh (`sql`; SQL Server `51000`, PostgreSQL `40001`); nhóm đọc lại con trỏ rồi gửi tiếp. Dòng con trỏ đầu tiên chỉ chèn được một lần (khóa chính; SQL Server thêm khóa phạm vi). Không dùng `PQcancel`: với libpq 12 của Ubuntu 20.04, lệnh này chặn tới hết thời gian kết nối TCP của hệ thống, còn so-rồi-ghi đã đủ để không trùng | IT `SqlIt.ABatchFromACursorThatMovedStoresNothing` ×3 (trước khi sửa: 20 dòng thay vì 10); `SqlIt.ABatchWaitingOnALateCommitIsRefusedOnceItCommits` ×3 (giao dịch muộn giữ khóa 1,5 s; trước khi sửa: lô vẫn được lưu); `ForwarderTest.ACursorMovedByALateCommitIsReadAgainAndNothingIsStoredTwice`, `SqlDialect.MsSqlDdlAndOneBatch`, `PostgreSqlLowercaseAndOneBatch`, `PostgreSqlDollarQuoteIsNotInTheBody` |
| Important 3 | `keepForwardMarks` lỗi lúc khởi động (đĩa đầy, lỗi I/O, khóa) thì mọi nhóm bỏ qua bước kiểm mốc. Mốc cũ còn trong file bị bỏ qua (mất dòng như C1); lần chạy sau lại hạ con trỏ về mốc đó (gửi trùng) | Historian đọc `seq` lúc mở file một lần. Ghi mốc lỗi thì nhóm của đích SQL chờ (`kMarkPending`, trạng thái `error`/`sql`); historian thử lại với thời gian chờ tăng dần, ghi được thì giao mốc cho forwarder (mốc cũ hơn trong file được giữ) | `HistorianForwarding.AMarkThatCannotBeStoredKeepsTheGroupsWaiting` (lỗi SQLite thật qua trigger; trước khi sửa: con trỏ bị hạ về 6, dòng 1–3 mất) |
| Important 4 | InfluxDB 3: review cho rằng ghi một phần trả `{"error":"partial write…"}` không có `message`, nên lô bị gửi lại mãi | Kiểm với InfluxDB 3 Core 3.12 thật: dạng đó chỉ có ở API v3. Qua API v2 mà runtime dùng, một dòng sai kiểu làm **cả lô** bị từ chối (`400 {"code":"invalid",…}`, không lưu gì, `accept_partial` không có tác dụng): đích báo `schema_mismatch`, dữ liệu giữ trên thiết bị tới khi sửa, không mất. Runtime vẫn nhận dạng v3 phòng phiên bản khác, kể cả khi câu trả lời bị cắt ở 4096 byte (khi đó chỉ đọc đầu chuỗi). Dạng v2 chỉ được nhận khi `message` bắt đầu bằng "partial write", để chữ trong Tag không giả được. Ghi bình thường qua API v2 lên InfluxDB 3: 204, đủ điểm | `InfluxLine.InfluxDb3Replies` (câu trả lời thật), `PartialWriteIsRecognized`; thử tay với container `influxdb:3-core` |
| Minor 5 | `--export-history … \| head` vẫn đọc hết mọi dòng rồi thoát 0; đĩa đầy cũng thoát 0 với file CSV cụt | Lệnh CLI giữ SIGPIPE mặc định (`\| head` dừng gọn). Đầu ra lỗi thì ngừng đọc ngay, thoát mã 5 kèm thông báo | `ExportHistory.AFailedOutputStopsWithAnError`, `LocalStore.ReadRangeStopsWhenTheCallbackSaysSo` |
| Minor 6 | libpq ở chế độ chặn: gửi một câu lệnh lớn nằm ngoài hạn chờ | Phiên không chặn; `PQflush` chạy dưới cùng hạn chờ. Phân giải tên trong `PQconnectStartParams` vẫn theo thời gian chờ của resolver | `PgSession.AStatementTheServerDoesNotReadEndsOnTheDeadline` (máy chủ ngừng đọc, câu lệnh 32 MB: dừng sau 1,03 s) |
| Minor 7 | Xóa mốc lỗi thì thử lại mỗi 100 ms, mỗi lần một dòng journal (khoảng 860.000 dòng/ngày) | Thời gian chờ tăng dần, từ `retryMs` tới tối đa 60 s | `HistorianForwarding.AMarkThatCannotBeClearedIsTriedLessAndLessOften` (30 s: tối đa 6 lần thay vì 300) |
| Minor 8 | CSV ra terminal không thoát ký tự điều khiển chiều chữ và U+2028/2029; `journalSafe` sót U+061C | Một hàm dùng chung `layoutControlAt` cho journal và terminal, thêm U+061C | `Utf8.LayoutControlsAreFound`, `ExportHistory.TextThatReordersTheLineIsShownOnATerminal`, `ErrorClass.JournalTextShowsInvisibleControls` |

### Quyết định của người dùng (2026-10-10, sau vòng hai)

Người dùng giao xử lý cả ba việc đang chờ: cho phép làm T075–T078 trên BL335 (mục 8), và hai quyết định dưới đây.

| Quyết định | Đã làm | Test / bằng chứng |
|---|---|---|
| **Chấp thuận ngoại lệ `synchronous=FULL`** cho giao dịch xóa mốc gửi (Code I1). Không có `FULL`, mất điện ngay sau khi xóa có thể làm mốc cũ quay lại sau khi dòng đã gửi vượt qua nó, và lần chạy sau gửi trùng. Giao dịch chỉ chạy mỗi đích và bảng một lần sau mỗi lần khởi động | Constitution 1.1.0 → 1.1.1 ghi ngoại lệ ở mục "Ràng buộc công nghệ"; mọi giao dịch khác giữ `NORMAL` | `.specify/memory/constitution.md`; test của Code I1 |
| **Mặc định `tls` của kết nối SQL là `verify-full`** (người dùng giao chọn; Constitution V: an toàn mặc định). Feature chưa triển khai ở đâu, nên không có project nào phải sửa | Model C++ và hai validator: thiếu `tls` là `verify-full`, không cảnh báo. Máy chủ chứng chỉ tự ký: đưa CA vào kho của thiết bị, hoặc ghi rõ `require`/`prefer` (có cảnh báo); hướng dẫn trong `docs/deployment/mat-runtime.md` | `LoggingConfig.BuildsModelWithDefaults`, `LoggingNames.ConnectionsAGroupSendsToWithoutCheckingTheServer` (C++ và TS), vector `logging-valid` (kết nối không có `tls` thôi cảnh báo) |
| Chứng chỉ bị từ chối phải hiện là lỗi TLS ở mọi loại DB: SQL Server qua FreeTDS trước đây báo `connect` (db-lib 20002), dễ hiểu nhầm là lỗi mạng | Khi đã đòi TLS (`require`, `verify-full`) mà máy chủ không gửi thông báo nào, 20002 thành `tls`; lỗi TCP (20009) và tên máy (20013) vẫn là `connect` | `ErrorClass.SqlServerLoginEndedAfterTheConnectionWithTlsDemandedIsTls`; IT `SqlTlsIt.VerifyFullRefusesAnUntrustedCertificate` nay đòi `tls` cho cả ba (MySQL 2026, SQL Server 20002, PostgreSQL), 33/33 đạt |

## 7. CI (T074, 2026-10-10)

`./tools/ci-local.ps1`: clang-format, build armhf, **armhf smoke (qemu)** (thêm ngày 2026-10-11, mục 8), build x64 + ctest, `gofmt`, `go vet`, `go test`, `npm run lint`, `typecheck`, `validate:project`, `test`, `build:web`: **xanh**.

- **Sau vòng ba, quyết định TLS và bản vá SQLite** (2026-10-11 01:17): ctest **350** test, Vitest **211** test, smoke armhf đạt (runtime armhf dưới qemu-user ghi 11 dòng rồi `--check-history` báo `integrity: ok`). Trước bản vá SQLite, bước smoke dừng với `free(): invalid pointer` y như trên thiết bị.
- **Sau vòng sửa thứ hai** (2026-10-10 23:27): ctest **329** test (test tích hợp bị bỏ qua khi không có biến `MAT_IT_*`; chúng chạy riêng ở mục 3, 4); Vitest **211** test ở 6 gói (`project-schema` 86, `svg-renderer` 38, `live-client` 27, `binding-engine` 23, `studio` 22, `runtime-web` 15). Xanh ngay lần chạy đầu.
- **Sau vòng đầu:** ctest 301 test. Lần chạy đầu dừng ở `lint` vì Prettier chưa định dạng 2 file TS mới sửa; đã định dạng rồi chạy lại.
- **Bộ cài Studio** build lại lúc 2026-10-11 02:02 (`npm run studio:build`, `C:\build\mat-studio\release\bundle\nsis\mAT Studio_0.1.0_x64-setup.exe`), sau khi validator TS đổi mặc định TLS (kết nối SQL không có `tls` thôi cảnh báo). Bản trước build lúc 2026-10-10 22:33.

## 8. Trên BL335 (T075–T078, 2026-10-11)

Người dùng cho phép ngày 2026-10-10. Mọi thay đổi trên thiết bị được ghi trong [device-changes.md](device-changes.md).

### Lần deploy đầu: dừng ngay khi khởi động, tự rollback

- `deploy.sh` gói 0.3.0 (`tank-demo` có lưu trữ): bản mới dừng sau 0,4 s với `free(): invalid pointer` và systemd khởi động lại liên tục. Health check thất bại, nên **`deploy.sh` tự rollback** về 0.2.0 trong vòng khoảng 20 s. Dịch vụ không bị bỏ lại ở trạng thái hỏng.
- **Chẩn đoán trên thiết bị** (chạy tay, cổng 18080, thư mục tạm):
  - Cùng binary với project không có lưu trữ thì chạy bình thường.
  - Bản armhf có AddressSanitizer báo `heap-buffer-overflow` trong SQLite (`sqlite3VdbeMakeReady`), ngay ở câu lệnh đầu tiên khi mở `history.db`.
- **Nguyên nhân:** lỗi của SQLite 3.54.0 trên máy 32-bit. Phần trống cuối mảng opcode bị tính thừa khi `sizeof(Op)` = 20. Máy 64-bit không bao giờ gặp, nên mọi test x64 (ctest, test tích hợp 4 DB, các kịch bản) đều không thấy. Đây đúng là trường hợp Constitution I đòi xác nhận trên thiết bị thật.
- **Sửa:** vá một dòng trong `third_party/sqlite/sqlite3.c`, ghi lý do và cách kiểm trong [PATCHES.md](../../third_party/sqlite/PATCHES.md).
- **Chặn tái diễn:** CI có thêm bước `armhf smoke (qemu)`. Bước này chạy runtime armhf dưới qemu-user với project có lưu trữ: khởi động, ghi dòng, dừng, rồi `--check-history`. Trước khi vá, bước này dừng y như trên thiết bị; sau khi vá thì đạt.
- **Thêm lệnh `--check-history`** (contract `device.md`): `PRAGMA integrity_check` và số dòng từng bảng, chạy được khi dịch vụ đang chạy. Dùng cho T077 và cho kỹ sư sau một lần mất điện.

### T075: deploy (đạt)

- `deploy.sh` gói 0.3.0 đã vá: health check OK sau 1 s, `historian.state=running`, `clock=ok`, trần 2 GiB, còn trống 6,3 GB. Unit mới có `StateDirectory`.
- `/var/lib/mat-runtime` thuộc `matscada:matscada`, quyền 700. Sau 19 s đã ghi 17 dòng; `NRestarts=0`; RSS 4,3 MB lúc mới chạy.
- `runuser -u matscada -- mat-runtime --check-history`: `integrity: ok` (`van_hanh` 26 dòng, `bao_cao_ca` 1 dòng). `--export-history van-hanh` cho CSV giờ +07:00.
- BL335 không cài `sudo`: tài liệu đổi sang `runuser -u matscada --` cho lệnh đọc, và chạy bằng root cho `--set-secret`.

### T077: dừng đột ngột (phần tự động đạt; cắt điện thật chờ người tại chỗ)

`kill -9` tiến trình `mat-runtime` 10 lần, mỗi lần sau 1–6 s ngẫu nhiên (lưu trữ commit mỗi 5 s). Kết quả thô: [003-bl335-kill.csv](003-bl335-kill.csv).

| Lần | Khởi động lại | `integrity_check` | Dòng `van_hanh` | Dòng trước năm 2000 |
|---|---|---|---|---|
| 1–10 | 3–4 s mỗi lần (`NRestarts` 1 → 10) | `ok` cả 10 lần | 62 → 140, tăng sau mỗi lần | 0 |

- `--export-history` đọc đủ sau mỗi lần (số dòng CSV = số dòng của bảng + tiêu đề). `historian.clock` = `ok`.
- Mất tối đa phần dòng chưa commit (dưới 5 s), đúng thiết kế (research R3).
- **Cắt điện thật ≥ 3 lần chưa làm:** cần người ở cạnh thiết bị.

### T076: tải 500 Tag/1 s + 10 client (SC-001, SC-002: đạt)

Project `tests/historian-it/bench-500` gồm `sim-a` 200 Tag, `sim-b` 200, `sim-c` 100 (chu kỳ 1 s) và `van-hanh` theo thay đổi. 10 client live (`load-tester -clients 10 -tags sim -duration 1800`) chạy từ máy dev qua cổng công cộng 9080; `tools/measure/sample.sh` lấy mẫu mỗi giây qua `ssh … sh -s`. Đo từ 2026-10-10 18:23:49Z, 30 phút. Kết quả thô: [003-bench-bl335-sample.csv](003-bench-bl335-sample.csv), [003-bench-bl335-load.json](003-bench-bl335-load.json), [003-bench-bl335-rows.csv](003-bench-bl335-rows.csv).

| Tiêu chí | Ngưỡng | Đo được |
|---|---|---|
| Dòng của 3 nhóm chu kỳ (cửa sổ 1740 s ở giữa) | ≥ 99,9 % | **1740/1740 (100 %)** mỗi nhóm; 0 khoảng trống > 1,5 s |
| Lệch thời điểm của dòng chu kỳ so với mốc giây (SC-002) | ≤ ± 250 ms | **tối đa 71 ms**, trung bình 67 ms (độ lệch gần như cố định, do pha của vòng lấy mẫu 100 ms) |
| RSS của `mat-runtime` | ≤ 150 MB | **tối đa 13,7 MB** (trung bình 9,9 MB; tăng dần khi cache SQLite 8 MB đầy lên) |
| CPU toàn hệ thống (mọi tiến trình) | trung bình ≤ 30 % | **trung bình 11,7 %**, p95 20,9 %, cao nhất 36,9 % |
| 10 client live | 0 mất sequence | 10/10 được nhận, mỗi client 7200 lần cập nhật, **0** mất sequence, khoảng cách p95 ≤ 261 ms, độ trễ p95 ≤ 23 ms |
| Lưu trữ | không mất dòng | `rowsDropped` 0, `integrity: ok`, `clockJumps` 0, `NRestarts` 0; file 9,5 MB sau 30 phút |

- RAM trống thấp nhất 867 MB. Cảnh báo `W_LOG_SIZE_CAP` có mặt như dự kiến: 7 ngày dữ liệu ước tính 2,8 GB, trên trần mặc định 2 GiB.
- Lỗi heartbeat `use of closed network connection` ở 4 client là lúc công cụ tự đóng kết nối khi kết thúc, không phải trong lúc đo.

### T078: gửi tới 4 loại DB từ BL335 (đạt, với DB thử thay cho DB thật)

- **Cách làm:** máy dev không còn ở LAN của thiết bị, và chưa có thông tin DB thật của người dùng. Thay vào đó, 4 máy chủ của test tích hợp (MySQL 8.4, SQL Server 2022, PostgreSQL 17, InfluxDB 2.7) chạy trên máy dev, cổng chỉ mở ở 127.0.0.1, và nối tới loopback của BL335 qua đường hầm SSH ngược đi qua Internet. Phía thiết bị chạy y như với DB thật:
  - thư viện client của Ubuntu 20.04 armhf, nạp động;
  - TLS `require`, mật khẩu và token nhập bằng `--set-secret`;
  - runtime và unit đúng bản sẽ dùng.
- **Cài trên thiết bị:** `libmariadb3` 10.3.39, `libsybdb5` (FreeTDS) 1.1.6, `libpq5` 12.22, `libcurl4` 7.68 (24 gói kể cả phụ thuộc, khoảng 25 MB). Giữ lại để dùng với DB thật.
- **Project:** `tank-demo` cộng 4 kết nối; hai nhóm gửi tới cả 4. Validator báo 3 cảnh báo `W_LOG_TLS_UNVERIFIED` như dự kiến, vì máy chủ thử dùng chứng chỉ tự ký.
- **Kết quả** (10 phút 26 giây, 2026-10-10 18:58:50–19:09:16Z):
  - 14 s sau khi khởi động, cả 4 đích `ok` và đã gửi bù khoảng 2250 dòng có sẵn trong `history.db`.
  - Cuối đợt, cả 4 đích đều 0 dòng chờ, 0 trễ, `lostRows` 0, `outOfRangeValues` 0, không lỗi; mỗi đích gửi 2866 dòng.
  - MySQL, SQL Server, PostgreSQL: `van_hanh` 2852 dòng = 2852 thời điểm phân biệt = con trỏ 2852; `bao_cao_ca` 14 = 14 = 14. Khớp đúng số dòng trên thiết bị: không trùng, không thiếu.
  - InfluxDB: `van_hanh` 2839 thời điểm = 2852 − 13 dòng toàn ô rỗng. Mỗi lần runtime khởi động (13 lần trong các đợt trên) sinh một dòng trước khi Tag có chất lượng tốt; InfluxDB không ghi được dòng không có field, đúng contract. `bao_cao_ca` đủ 14.
- **Dọn sau đợt:** xóa `secrets.json`, đóng đường hầm, thiết bị trở lại `tank-demo` không có kết nối DB ngoài, gỡ máy chủ thử trên máy dev.
- **Còn lại:** gửi 10 phút tới DB thật của người dùng. Cần host, database, user, loại DB và cách TLS; mật khẩu do người dùng nhập bằng `--set-secret`. Quy trình: cắt điện lúc dịch vụ đang ghi, bật lại, rồi chạy `--check-history` và `--export-history`, xem `historian.clock` trong `system/info`, và kiểm không có dòng năm 1970.
