# Contract: API truy vấn lịch sử (API 1.4.0)

**Feature**: [spec.md](../spec.md) FR-018…FR-031 · **Dữ liệu**: [history-db.md](history-db.md) · **ADR**: [032](../../../docs/adr/032-history-query-api.md)

Bổ sung cho [device-api-1.2.md của 007](../../007-screens-widgets/contracts/device-api-1.2.md) và các contract trước. Mọi endpoint, header, thứ tự kiểm `AuthGate` và mã lỗi của 1.0.0–1.3.0 giữ nguyên. Runtime `0.9.0`, `apiVersion` `1.4.0` (MINOR: thêm endpoint). Giao thức live không đổi. Chuỗi API: 1.2.0 (007, 3b giữ nguyên), 1.3.0 (alarm, 009), 1.4.0 (feature này); căn lại nếu thứ tự phát hành đổi (spec D23).

## 1. Chung

### 1.1 Quyền và xác thực

Tất cả là `GET`, đọc, role tối thiểu `viewer`, **chỉ HTTPS** (8443). Thêm vào bảng duy nhất `core/auth/roles.*`:

| Thao tác | Endpoint | Cần | Cookie |
|---|---|---|---|
| Danh mục lịch sử | `GET /api/v1/history/catalog` | viewer | **có** |
| Chuỗi thời gian | `GET /api/v1/history/series` | viewer | **có** |
| Số tổng hợp theo cửa sổ | `GET /api/v1/history/aggregate` | viewer | **có** |
| Dòng thô theo trang | `GET /api/v1/history/rows` | viewer | **có** |
| Xuất CSV | `GET /api/v1/history/export.csv` | viewer | **có** |

- Bearer (`mats_…`) cho Studio và công cụ; cookie `__Host-mat_sid` (`matw_…`) cho trang Chrome. Qua cookie, `GET` kiểm `Sec-Fetch-Site` (vắng hoặc `same-origin`, 403 `FETCH_SITE`) như `tags/write/{id}` của 007; không cần CSRF vì không đổi trạng thái.
- Qua HTTP: 403 `HTTPS_REQUIRED`, không phụ thuộc `viewerLogin` hay `viewerAccess` (D10). Chưa đăng nhập: 401 `AUTH_REQUIRED`; phiên hết hạn: 401 `SESSION_EXPIRED`.
- Thứ tự kiểm: như §1.3 của device-api-1.2 (bước 0–8), rồi bước 9 riêng của lịch sử: tham số, giới hạn tải, quyền dữ liệu. Từ chối ở bước 1–8 ghi `access.denied` (gộp 60 s).
- Mọi phản hồi `Cache-Control: no-store`, `Content-Type: application/json; charset=utf-8` (CSV: `text/csv; charset=utf-8`).
- Thời gian: **epoch mili giây UTC** (số nguyên) ở mọi tham số và trường. `timeZone` (`±HH:MM`) của nhóm chỉ để hiển thị.

### 1.2 Giới hạn (có trong `catalog.limits`)

| Giới hạn | Giá trị | Cấu hình |
|---|---|---|
| Số Tag mỗi yêu cầu `series`, `aggregate` | 16 | cố định |
| Số Tag mỗi yêu cầu `rows` | 32 | cố định |
| `maxPoints` | 10 … 5.000, mặc định 1.000 | cố định |
| Số cửa sổ `aggregate` | 5.000; hàng tổng hợp đọc ≤ 300.000 | cố định |
| Dòng mỗi trang `rows` | 1 … 500, mặc định 100 | cố định |
| Dòng xuất CSV | 500.000 | cố định |
| Khoảng thời gian | `0 < to − from ≤ 3650 ngày` | cố định |
| Truy vấn đồng thời (`series`, `aggregate`, `rows`) | 2 | `runtime.json` `historyMaxConcurrent` 1…4 |
| Xuất CSV đồng thời | 1 | cố định |
| Yêu cầu đang chạy mỗi phiên | 1 | cố định |
| Hạn mỗi truy vấn | 10.000 ms (CSV: 120.000 ms) | `historyQueryTimeoutMs` 1000…30000 |
| Quét thô ước tính tối đa | 64 MiB | `historyMaxScanMiB` 8…256 |

Ước tính quét thô: `rowsInRange × (rowBytes(nhóm) + 16)`, với `rowsInRange` = `seqMax − seqMin + 1` của khoảng (hai lần tìm trong chỉ mục `ts`, không quét) và `rowBytes` của contracts/logging-config-0.2.md §5. Chỉ áp cho nguồn thô.

### 1.3 Bảng mã lỗi

| HTTP | `error` | Khi |
|---|---|---|
| 400 | `BAD_REQUEST` | thiếu hoặc sai tham số (số không hợp lệ, ngoài khoảng, `from ≥ to`, tham số lạ, giá trị lặp, `tags` quá 16/32, `res`/`reduce`/`order` ngoài tập) |
| 401 | `AUTH_REQUIRED`, `SESSION_EXPIRED`, `SESSION_INVALID` | như 005, 007 |
| 403 | `HTTPS_REQUIRED`, `FORBIDDEN`, `SESSION_SCOPE`, `FETCH_SITE` | như 005, 007 |
| 404 | `NO_HISTORY` | project không có lưu trữ, hoặc historian tắt |
| 404 | `UNKNOWN_GROUP`, `UNKNOWN_TAG` | nhóm không có trong `catalog`; Tag không thuộc nhóm |
| 405 | `METHOD_NOT_ALLOWED` | phương thức khác `GET` (kèm `Allow`) |
| 422 | `RANGE_TOO_LARGE` | quá 5.000 cửa sổ hoặc 300.000 hàng tổng hợp |
| 422 | `SCAN_LIMIT` | `res=raw` mà ước tính quét vượt giới hạn; thân có `suggest` (`{"res":"auto"}` hoặc khoảng tối đa) |
| 422 | `NO_AGGREGATES` | `res=1m/1h` hay `aggregate` cho nhóm không bật tổng hợp |
| 422 | `EXPORT_TOO_LARGE` | quá 500.000 dòng; gửi trước khi phát byte nào |
| 429 | `BUSY` | vượt số truy vấn đồng thời hoặc đã có yêu cầu của phiên; `Retry-After: 2` |
| 503 | `HISTORY_UNAVAILABLE` | DB chưa mở, đang thay file hỏng, lỗi I/O |
| 503 | `QUERY_TIMEOUT` | quá hạn (truy vấn bị hủy) |

Thân lỗi như các endpoint khác: `{ "error": "BUSY", "message": "…" }` (câu tiếng Việt cố định; không chứa đường dẫn, tên bảng, câu SQL).

## 2. `GET /api/v1/history/catalog`

Không tham số. **200:**

```json
{
  "apiVersion": "1.4.0",
  "enabled": true,
  "state": "running",
  "limits": { "maxTags": 16, "maxRowsTags": 32, "maxPoints": 5000, "defaultMaxPoints": 1000,
              "maxBuckets": 5000, "maxRows": 500, "maxExportRows": 500000, "maxRangeDays": 3650,
              "maxConcurrent": 2, "timeoutMs": 10000, "maxScanMiB": 64 },
  "groups": [
    {
      "id": "ap-suat", "name": "Áp suất", "mode": "onChange", "timeZone": "+07:00",
      "periodMs": null, "minIntervalMs": 1000, "maxIntervalMs": 60000,
      "raw": { "from": 1790985600000, "to": 1791590399000 },
      "aggregates": { "minute": { "from": 1788998400000, "to": 1791590340000 },
                      "hour": { "from": 1788998400000, "to": 1791586800000 } },
      "tags": [
        { "tagId": "LINE1.PRESS", "column": "LINE1_PRESS", "type": "FLOAT32", "unit": "bar",
          "aggregated": true, "orphan": false }
      ]
    }
  ]
}
```

`aggregates` là `null` khi nhóm không bật tổng hợp; `raw`, `aggregates.*` là `null` khi chưa có dữ liệu. `enabled: false` khi không có lưu trữ (kèm 200, nhóm rỗng; các endpoint khác trả 404 `NO_HISTORY`). `orphan: true` cho Tag đã bỏ khỏi project nhưng còn dữ liệu. Không có `table`, đích chuyển tiếp hay thông tin kết nối.

## 3. `GET /api/v1/history/series`

| Tham số | Kiểu | Bắt buộc | Mặc định | Ý nghĩa |
|---|---|---|---|---|
| `group` | id nhóm | có | | |
| `tags` | danh sách `tagId` ngăn bằng dấu phẩy | có | | 1–16, không lặp, thuộc nhóm |
| `from`, `to` | epoch ms | có | | `[from, to)` |
| `maxPoints` | int | không | 1000 | 10 … 5000 |
| `res` | `auto` \| `raw` \| `1m` \| `1h` | không | `auto` | |
| `reduce` | `minmax` \| `lttb` \| `decimate` | không | `minmax` | chỉ cho nguồn thô; nguồn tổng hợp luôn ghép cửa sổ (`merge`) |

### 3.1 Chọn nguồn (`res=auto`)

```text
w = (to − from) / (maxPoints / 2)              cửa sổ giảm điểm, ms
nếu nhóm có tổng hợp:
    w ≥ 3 600 000 và bảng giờ phủ [from, to) (≥ 50 % theo cửa sổ)  → 1h
    w ≥    60 000 và bảng phút phủ [from, to) (≥ 50 %)             → 1m
nếu không chọn được tổng hợp:
    ước tính quét ≤ giới hạn                                       → raw (reduce theo tham số)
    quá giới hạn và có tổng hợp                                    → 1m (hoặc 1h nếu phút không phủ)
    quá giới hạn và không có tổng hợp                              → raw với reduce = decimate, approximate = true
```

`res=1m` hoặc `1h` rõ ràng với nhóm không bật tổng hợp: 422 `NO_AGGREGATES`. `res=raw` rõ ràng quá giới hạn: 422 `SCAN_LIMIT`. Phản hồi luôn nêu nguồn thực dùng (`res`) và `reduce` thực dùng.

### 3.2 Giảm điểm

- **`minmax` (thô)**: chia `[from, to)` thành `floor((maxPoints − 2) / 2)` cửa sổ bằng nhau theo thời gian; mỗi cửa sổ giữ dòng có giá trị nhỏ nhất và lớn nhất (nếu trùng ts chỉ một điểm) theo thứ tự thời gian; thêm dòng đầu và dòng cuối của khoảng. Ô NULL: mỗi cửa sổ có NULL chèn một điểm `null` tại ts của NULL đầu tiên của cửa sổ (tính vào `maxPoints`, cắt bớt điểm không phải cực trị nếu vượt). Một lượt đọc, bộ nhớ O(số đường × cửa sổ).
- **`lttb` (thô)**: Largest-Triangle-Three-Buckets (Steinarsson 2013) trên điểm khác NULL của mỗi đường, giữ điểm đầu, cuối; chuỗi chia theo đoạn liên tục giữa các NULL, mỗi đoạn nhận số điểm tỉ lệ độ dài (tối thiểu 2); điểm `null` ở ranh giới đoạn được giữ. Cần cả dòng của khoảng trong bộ nhớ (đã bị chặn bởi `SCAN_LIMIT`).
- **`decimate` (thô, xấp xỉ)**: chia khoảng thành `maxPoints` cửa sổ; mỗi cửa sổ tra một lần chỉ mục `ts` lấy dòng đầu tiên có `ts ≥` đầu cửa sổ (nếu `ts <` cuối cửa sổ). Không quét; `approximate: true`; có thể bỏ gai.
- **Ghép (tổng hợp)**: nếu số bucket > `maxPoints`, ghép các bucket liền kề thành `maxPoints` cửa sổ bằng `merge` (history-db.md §6); điểm `t` = đầu cửa sổ, `v` = `avg`, `min`, `max` của cửa sổ ghép.
- Mọi cách: không vượt `maxPoints`; tất định; thứ tự `t` tăng.

### 3.3 Phản hồi 200

```json
{
  "apiVersion": "1.4.0",
  "group": "ap-suat", "timeZone": "+07:00",
  "from": 1791504000000, "to": 1791590400000,
  "res": "1m", "reduce": "merge", "approximate": false, "maxPoints": 1000,
  "coverage": { "from": 1791504000000, "to": 1791590340000 },
  "gaps": [ [1791540000000, 1791547200000] ],
  "series": [
    { "tagId": "LINE1.PRESS", "column": "LINE1_PRESS", "type": "FLOAT32", "unit": "bar",
      "t": [1791504000000, 1791504120000],
      "v": [4.21, 4.25], "min": [4.1, 4.2], "max": [4.3, 4.31] }
  ],
  "stats": { "source": "mat_agg", "rowsRead": 11520, "elapsedMs": 41 }
}
```

- Nguồn thô: mỗi đường chỉ có `t`, `v` (không `min`, `max`); `v[i]` là số hoặc `null`.
- Nguồn tổng hợp: `v` = `avg`; `min`, `max` luôn có.
- `gaps`: các `[a, b]` giao với `[from, to)` mà runtime không chạy (suy từ `mat_runs`: từ `alive_ms` của lần chạy trước tới `start_ms` của lần sau). Trình duyệt vẽ ngắt nét trong khoảng đó.
- `coverage`: khoảng thời gian thật sự có dữ liệu của nguồn dùng (giao với khoảng hỏi); rỗng nếu không có (`null`).
- `stats` để chẩn đoán; không dùng để quyết định (có thể đổi).

## 4. `GET /api/v1/history/aggregate`

| Tham số | Kiểu | Bắt buộc | Ý nghĩa |
|---|---|---|---|
| `group`, `tags`, `from`, `to` | như §3 | có | |
| `bucketMs` | int | có | bội số của 60.000, 60.000 … 2.678.400.000 |
| `offsetMs` | int | không (0) | `0 ≤ offsetMs < bucketMs`, bội số của 60.000; cửa sổ `k` bắt đầu ở `A + k × bucketMs` với `A = floor((from − offsetMs) / bucketMs) × bucketMs + offsetMs` |

Số cửa sổ = `ceil((to − A) / bucketMs)` ≤ 5.000. Nguồn: bảng giờ khi `bucketMs` và `offsetMs` đều là bội số của 3.600.000 và bảng giờ có dữ liệu; ngược lại bảng phút. Máy chủ ghép các bucket của nguồn vào cửa sổ bằng `merge` (đọc theo `(cid, res, bucket)`, một lượt).

**200:**

```json
{
  "apiVersion": "1.4.0", "group": "dien", "timeZone": "+07:00",
  "from": 1791504000000, "to": 1791590400000, "bucketMs": 28800000, "offsetMs": 21600000,
  "start": 1791482400000, "count": 4, "source": "hour",
  "series": [
    { "tagId": "METER1.KWH", "type": "FLOAT64", "unit": "kWh",
      "n": [28800, 28800, 28800, 0], "min": [100.2, 160.1, 220.0, null],
      "max": [160.1, 220.0, 280.4, null], "first": [100.2, 160.1, 220.0, null],
      "last": [160.1, 220.0, 280.4, null], "sumw": [4.6e9, 5.5e9, 6.6e9, null],
      "wms": [28800000, 28800000, 28800000, 0],
      "avg": [160.0, 190.8, 250.1, null], "sum": [1277.7, 1527.4, 1800.0, null] }
  ],
  "stats": { "source": "mat_agg", "rowsRead": 72, "elapsedMs": 6 }
}
```

- Mảng cùng độ dài `count`, chỉ số `k` ứng với cửa sổ bắt đầu `start + k × bucketMs`. Cửa sổ không có dữ liệu: `null` ở mọi mảng (riêng `n`, `wms` bằng 0).
- `avg`, `sum` suy ra bằng đúng hàm của `agg_math` (history-db.md §6); trình duyệt cũng có thể tự tính từ `sumw`, `wms` (và phải ghép nhiều cửa sổ bằng `merge`).
- `coverage` của cửa sổ k = `wms[k] / bucketMs` (trình duyệt tính; dùng cho cảnh báo "thiếu dữ liệu").

## 5. `GET /api/v1/history/rows`

| Tham số | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `group`, `from`, `to` | | có | |
| `tags` | danh sách | không | 32 Tag đầu của nhóm |
| `limit` | 1 … 500 | không | 100 |
| `order` | `asc` \| `desc` | không | `desc` |
| `after` | `seq` | không | đầu khoảng theo `order` |

**200:**

```json
{
  "group": "ap-suat", "timeZone": "+07:00", "order": "desc",
  "columns": [ { "tagId": "LINE1.PRESS", "column": "LINE1_PRESS", "type": "FLOAT32" } ],
  "rows": [ [48213, 1791590399000, 4.21], [48212, 1791590338000, null] ],
  "next": 48212
}
```

Hàng: `[seq, ts, v1, v2, …]`. `next` = `seq` của hàng cuối (dùng làm `after` cho trang kế) hoặc `null` khi hết khoảng. Khóa là `seq` (khóa chính, không trùng, không sót kể cả khi nhiều dòng cùng `ts`); lọc theo `ts` trong `[from, to)`. Ước tính quét theo `limit` (≤ 500 dòng), không áp `SCAN_LIMIT`.

## 6. `GET /api/v1/history/export.csv`

| Tham số | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `group`, `from`, `to` | | có | |
| `tags` | danh sách | không | mọi Tag của nhóm |
| `res` | `raw` \| `1m` \| `1h` | không | `raw` |
| `fields` | tập con của `min,max,avg,first,last,sum,count` ngăn bằng phẩy | không | `avg,min,max,last` (chỉ khi `res` ≠ `raw`) |
| `bom` | `0` \| `1` | không | `1` |

- Tiêu đề (UTF-8): `Content-Disposition: attachment; filename="<nhóm>_<từ>_<đến>.csv"` (ký tự cấm trên Windows thành `-`).
- Dòng đầu: `time` rồi tên cột Tag (`raw`) hoặc `<cột>.<trường>` (tổng hợp). Phân tách dấu phẩy, xuống dòng `\r\n`, chuỗi bọc `"` khi có `,`, `"`, xuống dòng (nháy kép gấp đôi), số dạng `%.15g` (chấm thập phân), ô rỗng cho NULL; ô chuỗi bắt đầu bằng `=`, `+`, `-`, `@` được thêm `'` đứng đầu (chống chèn công thức khi mở bằng bảng tính; ô số không đổi).
- `time`: giờ địa phương của nhóm, `yyyy-MM-dd HH:mm:ss.SSS` (raw) hoặc `yyyy-MM-dd HH:mm` (phút) hoặc `yyyy-MM-dd HH:00` (giờ); BOM `EF BB BF` ở đầu khi `bom=1`.
- Phát từng khối (`Transfer-Encoding: chunked`, mỗi khối ≤ 64 KiB, đọc theo `seq` hay theo `(cid, bucket)`), không dựng cả file; nhường CPU (luồng ưu tiên thấp, nghỉ ngắn giữa các khối khi có truy vấn khác).
- Trước khi phát: ước tính số dòng; > 500.000 → 422 `EXPORT_TOO_LARGE`. Hỏng giữa chừng (DB lỗi, hủy): đóng kết nối, không có dấu hiệu "hết file hợp lệ" nên tải về không đầy đủ (HTTP chunk không kết thúc đúng).
- **Audit** `history.export` (một dòng mỗi yêu cầu, sau khi kết thúc): tài khoản, IP, nhóm, khoảng, `res`, số dòng, kết quả (`ok`, `aborted`, `timeout`).

## 7. Tính chất bắt buộc

- Tham số kiểm chặt trước khi chạm DB (regex số nguyên `^-?[0-9]{1,15}$`; id theo regex của 003; `tags` tra trong `catalog`); tên bảng và cột lấy từ cấu hình đã kiểm, luôn trích dẫn; **không** chuỗi nào của client vào câu lệnh SQL, mọi giá trị là tham số `?`.
- Kết nối chỉ đọc riêng (`PRAGMA query_only=1`, `cache_size=-4096`, `mmap_size=0`), tối đa 3, tạo lười; `sqlite3_progress_handler` kiểm hạn và cờ hủy (ngắt kết nối của trình duyệt); luồng `nice +10`; không giữ giao dịch đọc qua nhiều lần chờ mạng (đọc xong một khối thì ghi mạng, mở giao dịch đọc ngắn cho khối kế, để WAL checkpoint không bị chặn).
- Từ chối trước khi quét: tham số sai, giới hạn tải, `SCAN_LIMIT`, `EXPORT_TOO_LARGE` đều trả lời không chạm bảng dữ liệu (chỉ tra chỉ mục để ước tính).
- Không có thông tin đích chuyển tiếp, `table`, đường dẫn file, phiên bản SQLite trong phản hồi.
