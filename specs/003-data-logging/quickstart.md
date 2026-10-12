# Quickstart — kiểm chứng 003 Lưu trữ dữ liệu Tag

Các kịch bản chứng minh tính năng chạy đầu-cuối, theo thứ tự từ máy dev tới BL335. Định dạng và giá trị mong đợi: [contracts/](contracts/). Mục nào chưa làm được thì ghi "chưa đo" vào báo cáo nghiệm thu.

## 0. Chuẩn bị (máy dev Windows)

- **Docker Desktop đang chạy.** Image toolchain được build lại tự động; image mới có thêm gói `-dev` của 4 client DB, dùng để kiểm API.
- **Image test tích hợp:**
  - đã có sẵn: `mysql:8.4`, `pgvector/pgvector:pg17`;
  - tải lần đầu (khoảng 2 GB, nằm ở ổ C: của Docker): `mcr.microsoft.com/mssql/server:2022-latest`, `influxdb:2.7`.
- **Node:** `npm install` ở thư mục gốc.

## 1. Unit test và bộ vector

```powershell
./deployment/toolchain/test-x64.ps1        # GoogleTest
npm test -w @mat/project-schema           # vector TS
npm run validate:project                  # tank-demo có logging.json
```

**Mong đợi:**

- `ctest` 100 % đạt. Có thêm các test: `historian_sampler_test`, `local_store_test`, `sql_dialect_test`, `influx_line_test`, `forwarder_test`, `secrets_test`, `logging_config_test`, `client_api_check_test`.
- Mọi vector `logging-*` cho cùng tập mã lỗi và mã cảnh báo ở hai bản (SC-009).
- `tank-demo` hợp lệ, không có cảnh báo.

## 2. Runtime x64 với project mẫu

```powershell
npm run build:web
./deployment/toolchain/run-x64.ps1 -DataDir /tmp/mat-data
curl.exe -s http://localhost:8080/api/v1/system/info
```

**Mong đợi:** có `historian.enabled = true`, `state = "running"`, `groups = 2`, và `rowsWritten` tăng dần.

Sau khoảng 3 phút, xuất nhóm báo cáo:

```powershell
docker exec mat-runtime-x64 /src/build/x64/bin/mat-runtime --export-history bao-cao-ca --data-dir /tmp/mat-data
```

**Mong đợi:**

- Tiêu đề `time,TANK01_LEVEL,…`.
- Mỗi phút một dòng, ở giây `00.0xx`.
- Ô của `TANK01.TEMP` rỗng ở các dòng rơi vào khoảng Tag này BAD.

## 3. Tích hợp với 4 loại DB

```powershell
./tools/historian-it.ps1 -Scenario forward         # dựng 4 máy chủ DB, chạy historian_it, rồi dọn
./tools/historian-it.ps1 -Scenario forward -Keep   # giữ container để tự xem bảng
                                                   # dọn sau: docker compose -p mat-hist-it down -v
```

Mong đợi: mọi kịch bản `PASS`, với từng loại DB.

| Kịch bản | Mong đợi |
|---|---|
| Tạo bảng | bảng tự tạo đúng kiểu cột của [external-schema.md](contracts/external-schema.md), có chỉ mục `time` |
| Gửi | 600 dòng dựng sẵn khớp 100 % giá trị; `time` = giờ +07:00 của `ts` (SC-004) |
| Thêm Tag | cột mới xuất hiện; dòng cũ để `NULL` |
| Mất kết nối | dừng máy chủ, ghi 1.800 dòng, bật lại → đủ 1.800 dòng, 0 trùng (SC-005) |
| Kill giữa lúc gửi | 3 lần kill → 0 trùng, 0 thiếu (SQL); InfluxDB không có điểm trùng |
| Sai mật khẩu | `lastError.code = "auth"`; các đích khác vẫn `ok` |
| TLS `require` | kết nối có mã hóa tới MySQL 8.4, PostgreSQL và SQL Server (`dbopen("host:port")`) |
| Tài khoản chỉ có `INSERT/SELECT/UPDATE` | bảng do quản trị tạo sẵn đủ cột → gửi được; thiếu một cột → `permission` |
| Cột có sẵn sai kiểu | `schema_mismatch` |
| 64 Tag chuỗi 255 ký tự | tạo bảng và gửi được trên cả 4 DB |
| Dòng bị xóa trước khi gửi | `lostRows` đúng số dòng đã xóa |

## 4. Độ bền khi dừng đột ngột (x64)

```powershell
./tools/historian-it.ps1 -Scenario crash    # 10 lần kill -9 trong lúc ghi
```

Mong đợi: lần nào `PRAGMA integrity_check` cũng trả `ok`, và số dòng mất mỗi lần ≤ `historianCommitMs` (SC-008, phần tự động).

## 5. Thời hạn lưu và trần dung lượng (x64)

Unit test `local_store_test` dựng dữ liệu cũ bằng `ts` giả, nên không cần chờ nhiều ngày. Chạy thêm kịch bản tay:

```powershell
./tools/historian-it.ps1 -Scenario retention   # dữ liệu 10 ngày, thời hạn 7 ngày; pha trần 64 MB
```

**Mong đợi:**

- Không còn dòng nào cũ hơn 7 ngày + 1 giờ sau đợt dọn (pha A, trần 256 MB để chỉ đợt dọn theo thời hạn xóa).
- Pha B (khởi động lại với trần 64 MB): `dbBytes` ≤ trần + 5 % (SC-006, SC-007).
- Độ trễ cập nhật live trong lúc dọn ≤ 1 s, đo bằng `build/load-tester.exe -clients 1`.

## 6. Studio

- **Mở project có `logging.json` vượt ngân sách** (vector `logging-warn-budget`): tab Kiểm tra hiện cảnh báo `W_LOG_WRITE_BUDGET` kèm MB/ngày, và nút **Lưu** vẫn bật (FR-024).
- **Tab Thiết bị trỏ tới runtime x64:** thấy dòng trạng thái lưu trữ và từng đích (FR-027).

## 7. Trên BL335 (cần người dùng cho phép)

Thao tác trên thiết bị theo Constitution, quy trình 3. Mọi thay đổi ghi vào `docs/reports/device-changes.md`.

1. **Deploy** gói runtime mới bằng `deploy.sh`. Unit mới có `StateDirectory`; kiểm `/var/lib/mat-runtime` thuộc `matscada`.
2. Chỉ khi cần DB ngoài:
   - `apt install` gói client tương ứng ([device.md](contracts/device.md));
   - `sudo mat-runtime --set-secret <id>`.
3. **Đo SC-001:** project có nhóm 500 Tag `SIM.*` chu kỳ 1 s và nhóm theo thay đổi, cùng 10 client:

   ```powershell
   build/load-tester.exe -host <ip> -port <cổng> -clients 10 -tags sim -duration 1800
   ```

   Đồng thời trên thiết bị chạy `sh tools/measure/sample.sh historian-500 1800 <pid>`. Mong đợi: RSS ≤ 150 MB, CPU trung bình ≤ 30 %, 0 mất sequence, ≥ 99,9 % số dòng.
4. **Dừng đột ngột:** `kill -9` 10 lần. Cắt điện thật ≥ 3 lần (người dùng làm). Sau mỗi lần, `--export-history` chạy được (SC-008).
5. **Mất đồng hồ:** sau một lần cắt điện, xem `historian.clock` trước và sau khi NTP đồng bộ. Không có dòng nào mang năm 1970.
