# Quickstart — kiểm chứng 010 Lưu trữ nâng cao, truy vấn lịch sử, báo cáo

Các kịch bản chứng minh tính năng chạy đầu-cuối, từ máy dev tới BL335. Định dạng và giá trị mong đợi: [contracts/](contracts/). Mục nào chưa làm được thì ghi "chưa đo" vào báo cáo nghiệm thu (`docs/reports/010-acceptance.md`). §1–§8 chạy trên x64; §9–§12 cần BL335 hoặc người (⚠️🔌).

## 0. Chuẩn bị (máy dev Windows)

- **Docker Desktop đang chạy**; image toolchain build lại tự động. Image DB thử của 003 (MySQL, SQL Server, PostgreSQL, InfluxDB) chỉ cần cho `kill100` có gửi bù.
- **Node:** `npm install` ở thư mục gốc.
- **Ổ D: gần đầy:** dữ liệu thử đặt ở `C:\build\mat-data` (DB 7 ngày × 200 Tag khoảng 1,5 GB); xóa sau khi đo.
- **Tài khoản thử:** tạo viewer và operator bằng lệnh `--users` của 005 (mật khẩu ngẫu nhiên, không ghi file); các lệnh dưới dùng biến `$TOKEN` (Bearer) hoặc cookie.

## 1. Unit test và bộ vector

```powershell
./deployment/toolchain/test-x64.ps1        # GoogleTest (aggregator, agg_math, downsample, history_query, history_api, ...)
npm test                                   # Vitest (history-math, report-export, project-schema, widget, Studio)
npm run validate:project -- projects/history-demo
```

**Mong đợi:**

- `ctest` 100 % đạt, gồm `aggregator_test`, `agg_math_test`, `downsample_test`, `source_select_test`, `query_limiter_test`, `reader_pool_test`, `history_query_test`, `csv_writer_test`, `history_api_test`, `io_meter_test`, và các test mở rộng của `sampler_test`, `local_store_test`, `historian_test`.
- Mọi vector `logging-010-*`, `report-*`, `history-*` (danh mục), `agg-*`, `downsample-*`, `report-*` (math) cho cùng kết quả ở TS và C++ (SC-002, SC-021).
- `projects/history-demo` hợp lệ, không cảnh báo.

## 2. Runtime x64: trigger và Kết hợp (US1)

```powershell
npm run build:web
./deployment/toolchain/run-x64.ps1 -Project projects/history-demo -DataDir /tmp/mat-data
curl.exe -sk https://localhost:8443/api/v1/system/info -H "Authorization: Bearer $TOKEN"
```

**Mong đợi:** `historian.enabled = true`, `groups = 4`, `groupsInfo[].mode` có `trigger`, `rowsWritten` tăng. Tag mô phỏng `BATCH.DONE` tạo xung mỗi 20 s: sau 3 phút:

```powershell
docker exec mat-runtime-x64 /src/build/x64/bin/mat-runtime --export-history me-tron --data-dir /tmp/mat-data
```

nhóm `me-tron` có khoảng 9 dòng (mỗi cạnh lên một dòng, cách nhau ≥ 5 s), nhóm `ap-suat` (Kết hợp) có dòng mỗi 60 s khi áp suất không đổi và dòng ngay khi đổi vượt deadband (kịch bản 1–6 của US1). Ghi `docs/reports/010-trigger-x64.json`.

## 3. Tổng hợp (US2)

```powershell
./tools/historian-it.ps1 -Scenario agg                      # fill-agg 31 ngày, dựng bù, so với history-ref
docker exec mat-runtime-x64 /src/build/x64/bin/mat-runtime --verify-aggregates dien --data-dir /tmp/mat-data
docker exec mat-runtime-x64 /src/build/x64/bin/mat-runtime --history-stats --data-dir /tmp/mat-data
```

**Mong đợi:** `--verify-aggregates` thoát 0 ("0 thiếu, 0 thừa, 0 lệch"); `--history-stats` liệt kê `mat_agg` với hai độ phân giải, `mat_runs`, `schema 2`; `system/info` có `aggregates.rows`, `backfill.active = false` khi xong. Sau `docker kill mat-runtime-x64` giữa phút rồi chạy lại: `--verify-aggregates` vẫn 0 sai khác (US2 kịch bản 6).

## 4. API truy vấn (US3)

```powershell
$B = 'https://localhost:8443/api/v1/history'
$H = @{ Authorization = "Bearer $TOKEN" }
curl.exe -sk "$B/catalog" -H "Authorization: Bearer $TOKEN"
$to = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); $from = $to - 86400000
curl.exe -sk "$B/series?group=ap-suat&tags=LINE1.PRESS,LINE1.TEMP&from=$from&to=$to&maxPoints=1000" -H "Authorization: Bearer $TOKEN"
curl.exe -sk "$B/aggregate?group=dien&tags=METER1.KWH&from=$from&to=$to&bucketMs=3600000" -H "Authorization: Bearer $TOKEN"
curl.exe -sk "$B/rows?group=ap-suat&from=$from&to=$to&limit=5" -H "Authorization: Bearer $TOKEN"
curl.exe -sk -o ap-suat.csv "$B/export.csv?group=ap-suat&from=$from&to=$to" -H "Authorization: Bearer $TOKEN"
curl.exe -s  "http://localhost:8080/api/v1/history/catalog"      # HTTP: 403 HTTPS_REQUIRED
./tools/web-it.ps1 -Scenario history-api                          # luồng thường + tấn công + giới hạn tải
```

**Mong đợi:**

- `series` trả `res` và `stats.source` (với DB 7 ngày: `mat_agg`, p95 < 500 ms trên x64), ≤ `maxPoints` điểm mỗi đường; `gaps` khớp lần tắt runtime ở §3.
- `res=raw` cho khoảng quá lớn: 422 `SCAN_LIMIT` trong ≤ 200 ms. Ba truy vấn đồng thời: truy vấn thứ ba 429 `BUSY`, `Retry-After: 2`.
- Gọi qua HTTP: 403 `HTTPS_REQUIRED`; không token: 401.
- CSV mở được, cột `time` giờ +07:00, có BOM.
- `web-it -Scenario history-api` 100 % ca đạt (SC-010); ghi `docs/reports/010-api-x64.json`.

## 5. Biểu đồ lịch sử trên Chrome (US4)

```powershell
./tools/web-it.ps1 -Scenario history-10      # 10 phiên Chrome headless, 4 biểu đồ mỗi màn hình
npm run e2e -w @mat/runtime-web              # history.e2e.mjs: phóng/dịch, con trỏ, khoảng đứt, trạng thái
```

Mở tay `https://localhost:8443/` (chấp nhận chứng chỉ thử), đăng nhập viewer, mở màn hình "Áp suất" và trang "Lịch sử" (`#/history`).

**Mong đợi:** biểu đồ vẽ ≤ 2,5 s; chọn "24 giờ qua"; kéo chọn vùng phóng vào và vẽ lại ≤ 1,5 s; Shift+kéo dịch; cuộn chuột phóng/thu; bấm đúp về gốc; con trỏ hiện giờ +07:00 và giá trị từng đường; đường ngắt ở khoảng runtime tắt; chưa đăng nhập hiện "Đăng nhập để xem lịch sử"; bảng dữ liệu phân trang. Ghi `docs/reports/010-charts-x64.json`, `010-history-10-x64.json`.

## 6. Báo cáo (US5, US6)

Trong trình duyệt: menu "Báo cáo điện năng" → chọn ngày → Xem → CSV, XLSX, PDF. Tự động:

```powershell
./tools/web-it.ps1 -Scenario reports        # so từng ô với history-ref trên dữ liệu 31 ngày; đối chiếu 3 định dạng
```

**Mong đợi:**

- ba mẫu (ngày, ca 3 × 8 giờ bắt đầu 06:00, tháng) khớp `history-ref` ở 100 % ô (≤ 1e-6 tương đối);
- CSV/XLSX/PDF khớp bảng trên màn hình ở 100 % ô, chữ Việt đúng dấu;
- trong lúc dựng file, số yêu cầu tới runtime bằng 0 (BL335 chỉ phục vụ `aggregate`);
- màn hình "Điện năng" (bar theo ca, pie hôm nay) cùng số với báo cáo cùng kỳ.

Ghi `docs/reports/010-reports-x64.json`. Mở CSV bằng Excel, PDF bằng Acrobat: thử tay (§12).

## 7. Studio (US7, US8)

```powershell
npm run e2e -w @mat/studio
npm run dev -w @mat/studio     # mở tay: project history-demo (hoặc project rỗng có Tag)
```

**Mong đợi:**

- Cây project → `Lưu trữ`: lưới nhóm và Tag sửa được; đổi chu kỳ 1 s → 100 ms: khung "Ước tính ghi" chuyển cảnh báo trong ≤ 100 ms kèm số MB/ngày và gợi ý; chế độ "Kết hợp" và "Kích hoạt" có ô riêng.
- Nạp xuống cấu hình vượt ngân sách hiện hộp thoại xác nhận (Hủy mặc định); lưu và xem trước không bị chặn.
- `Báo cáo` → mẫu mới: chọn nhóm có tổng hợp, kỳ, ca, cột bằng kéo Tag, hàm; xem trước dữ liệu mô phỏng ≤ 300 ms; xuất thử bốn định dạng.
- Dựng đủ nhóm, ba mẫu, màn hình bốn widget lịch sử, mục menu báo cáo hoàn toàn bằng thao tác; Kiểm tra không lỗi; Nạp xuống runtime x64; mở trên Chrome (SC-020). Ghi `docs/reports/010-studio-smoke.json`.

## 8. Độ bền và tải trên x64 (US9)

```powershell
./tools/historian-it.ps1 -Scenario kill100          # 100 lần kill -9 ngẫu nhiên, integrity_check và verify-aggregates mỗi lần
./tools/historian-it.ps1 -Scenario soak7d-compressed   # 7 ngày giả, 200 Tag onChange + tổng hợp, so ước tính với số đo
# tải: 10 phiên live + 2 truy vấn + 1 truy vấn thứ ba (load-tester có chế độ truy vấn)
./build/load-tester.exe -host localhost -port 8443 -clients 10 -tags sim -duration 600 -query 2
```

**Mong đợi:**

- `kill100`: `integrity_check` = ok 100/100; `--verify-aggregates` 0 bucket trùng, 0 lệch; mất dòng mỗi lần ≤ khoảng gom ghi (SC-005, SC-023 phần x64).
- `soak7d-compressed`: DB nằm trong trần, ước tính lệch ≤ 30 % số đo `write_bytes` (SC-025).
- Tải: CPU ≤ 30 %, RSS ≤ 150 MB (x64 chỉ để so; số thật ở §10), 0 mất sequence, khoảng trống live ≤ 1 s, 429 ≤ 100 ms.

Ghi `docs/reports/010-kill100-x64.json`, `010-soak-x64.json`, `010-load-x64.json`.

## 9. BL335: nâng cấp và kiểm tra ⚠️🔌 (cần người dùng cho phép SSH)

Thông tin kết nối nằm trong memory, không ghi vào repo. Mọi thay đổi ghi `docs/reports/device-changes.md`.

1. Sao lưu: `cp -a /var/lib/mat-runtime/history.db* /var/lib/mat-runtime/backup-0.8/` nếu còn chỗ (kiểm `df -h /var/lib`).
2. Deploy runtime 0.9.0 bằng `deployment/device/deploy.sh` (giữ `history.db`, secrets).
3. Kiểm chỉ đọc: `runuser -u matscada -- /opt/mat-runtime/bin/mat-runtime --history-stats --data-dir /var/lib/mat-runtime`; `integrity_check`; `system/info` có `historian.aggregates.schema = 2`.
4. Nạp project `history-demo` mở rộng (200 Tag `onChange`, tổng hợp bật) bằng Studio hoặc `deploy`; đợi dựng bù xong.

**Mong đợi:** nâng schema không mất dữ liệu, runtime khởi động ≤ 5 s, RSS ban đầu và CPU nền trong ngân sách.

## 10. BL335: ghi eMMC, truy vấn, tải ⚠️🔌

- **Ghi (SC-022, SC-004):** chạy ≥ 24 giờ cùng 10 client live (`load-tester` từ máy dev); mỗi 10 phút:

  ```bash
  curl -sk https://127.0.0.1:8443/api/v1/system/info -H "Authorization: Bearer $TOKEN" | jq '.historian.io, .historian.dbBytes'
  ```

  so `io.bytesPerDay` với `estimateBytesPerDay` và ngân sách 2 GiB; chạy lại không bật tổng hợp để lấy hiệu.
- **Truy vấn (SC-006, SC-007):** dựng DB 7 ngày (chép từ x64 hoặc `historian_tool fill-agg` trên thiết bị), rồi, 20 lần mỗi loại:

  ```bash
  sync; echo 3 > /proc/sys/vm/drop_caches          # root: cache nguội
  curl -sk -o /dev/null -w '%{time_total}\n' "$B/series?group=ap-suat&tags=...&from=...&to=...&maxPoints=1000" -H "Authorization: Bearer $TOKEN"
  ```

  ghi p50/p95; yêu cầu p95 ≤ 2 s cho 24 giờ 8 đường.
- **Tải (SC-009, SC-011, SC-017):** 10 phiên live + 2 truy vấn liên tục + 1 truy vấn thứ ba 10 phút; xuất CSV 24 giờ nhóm 50 Tag; dựng báo cáo tháng từ trình duyệt và ghi CPU tăng thêm (`tools/measure`).

Ghi `docs/reports/010-bl335-write.json`, `010-bl335-query.json`, `010-bl335-load.json`.

## 11. BL335: mất điện 100 lần ⚠️🔌 (cần người, ổ cắm hẹn giờ hoặc relay)

Vòng lặp (script do người dùng chạy; mỗi lần khoảng 2 phút):

1. cắt điện lúc runtime đang ghi và tổng hợp (không báo trước);
2. cấp điện, chờ khởi động xong (`system/info` trả lời);
3. `integrity_check` bằng `--history-stats` và `--verify-aggregates <nhóm>`;
4. ghi một dòng vào `docs/reports/010-bl335-powercut.csv` (lần, ok/hỏng, bucket trùng/lệch, dòng mất).

**Mong đợi:** 100/100 lần mở được và `integrity_check` = ok; dòng mất mỗi lần ≤ khoảng gom ghi (5 s mặc định). Chưa làm được thì ghi "chưa đo" và giữ kết quả `kill -9` của §8.

## 12. Thử tay (cần người)

- Windows 11 + Chrome ≥ 120 với chứng chỉ thiết bị: biểu đồ lịch sử, báo cáo; ghi phiên bản Chrome.
- CSV mở bằng Excel (tiếng Việt, giờ +07:00; thử cả hai kiểu CSV), XLSX bằng Excel, PDF bằng Acrobat và Chrome.
- Bộ gõ tiếng Việt (Telex, Unikey) trong editor Lưu trữ và Mẫu báo cáo.

Ghi kết quả vào `docs/reports/010-manual.md`.
