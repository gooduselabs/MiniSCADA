# Contract — `logging.json` và luật kiểm tra

Trường, kiểu, mặc định: [data-model.md](../data-model.md) §1. Schema máy đọc: `schemas/logging.schema.json` (draft-07, `schemaVersion` `0.1.x`). Contract là **tập mã lỗi và mã cảnh báo**; câu chữ `message` có thể khác giữa bản TS và C++.

## Ví dụ

```json
{
  "schemaVersion": "0.1.0",
  "timeZone": "+07:00",
  "groups": [
    {
      "id": "van-hanh",
      "name": "Vận hành",
      "mode": "onChange",
      "minIntervalMs": 1000,
      "maxIntervalMs": 60000,
      "retentionDays": 30,
      "destinations": ["mysql-office"],
      "tags": [
        { "tagId": "TANK01.LEVEL", "deadband": 0.5 },
        { "tagId": "MOTOR01.RUN" }
      ]
    },
    {
      "id": "bao-cao-ca",
      "name": "Báo cáo ca",
      "mode": "cyclic",
      "periodMs": 60000,
      "retentionDays": 365,
      "destinations": ["mysql-office", "influx"],
      "tags": [
        { "tagId": "TANK01.LEVEL", "column": "MUC_BON" },
        { "tagId": "TANK01.INFLOW" }
      ]
    }
  ],
  "connections": [
    { "id": "mysql-office", "type": "mysql", "host": "192.168.1.50", "port": 3306,
      "database": "scada", "user": "scada_writer" },
    { "id": "influx", "type": "influxdb", "url": "http://192.168.1.60:8086",
      "org": "atpro", "bucket": "scada" }
  ]
}
```

Kết quả với ví dụ trên:

- Nhóm `van-hanh` ghi vào bảng `van_hanh`, cột `TANK01_LEVEL` và `MOTOR01_RUN`.
- Nhóm `bao-cao-ca` ghi vào bảng `bao_cao_ca`, cột `MUC_BON` và `TANK01_INFLOW`.

## Thứ tự kiểm (hai bản giống nhau)

1. `project.json` hợp lệ và có `loggingFile`:
   - đường dẫn không an toàn → `E_PATH`;
   - file không có → `E_FILE_MISSING`.
2. Đọc file và kiểm như các file khác:
   - > 1 MB, lồng > 64 mức, JSON hỏng → `E_JSON`;
   - chuỗi > 1024 byte → `E_SCHEMA`.
3. **Quét bí mật trước schema:** có khóa (ở bất kỳ mức nào) khớp, không phân biệt hoa/thường (so theo ASCII), `password`, `passwd`, `pwd`, `secret`, `token`, `apikey`, `api_key`; hoặc `url` của một kết nối có tài khoản/mật khẩu (`https://user:pass@host`) → `E_LOG_SECRET`, và dừng kiểm file này.
4. JSON Schema → `E_SCHEMA` (dừng kiểm file này nếu lỗi).
5. `schemaVersion` khác `0.1.x` → `E_SCHEMA_VERSION` (cùng luật với các file khác).
6. Luật liên file (mục dưới). Luật cần `tags.json` bị bỏ qua khi `tags.json` lỗi.
7. Chỉ khi không còn lỗi `E_LOG_*` của file này: kết nối không xác thực máy chủ → `W_LOG_TLS_UNVERIFIED`; ước tính dung lượng → `W_LOG_WRITE_BUDGET`, `W_LOG_SIZE_CAP`.

## Mã lỗi mới

| Mã | Khi nào | Vị trí (JSON Pointer) |
|---|---|---|
| `E_LOG_SECRET` | có khóa giống bí mật, hoặc `url` có tài khoản/mật khẩu | đường dẫn tới khóa / `/connections/i/url` |
| `E_LOG_DUP_ID` | trùng `id` nhóm, hoặc trùng `id` kết nối | `/groups/i/id`, `/connections/i/id` |
| `E_LOG_REF_TAG` | `tagId` không có trong `tags.json` | `/groups/i/tags/j/tagId` |
| `E_LOG_DUP_TAG` | một Tag xuất hiện hai lần trong cùng nhóm. Mục lặp **không** bị kiểm thêm `E_LOG_COLUMN` | `/groups/i/tags/j/tagId` |
| `E_LOG_REF_DEST` | `destinations` trỏ tới kết nối không có | `/groups/i/destinations/k` |
| `E_LOG_COLUMN` | tên cột (đặt hoặc suy ra) không hợp lệ (`^[A-Za-z_][A-Za-z0-9_]{0,62}$`), là tên dành riêng (so chữ thường: `id`, `time`, `seq`, `ts` của runtime; `rowid`, `oid`, `_rowid_` của SQLite; `xmin`, `xmax`, `cmin`, `cmax`, `ctid`, `tableoid` của PostgreSQL; `source` và mọi tên bắt đầu bằng `_` của InfluxDB), hoặc trùng tên khác trong nhóm khi bỏ qua hoa/thường | `/groups/i/tags/j` |
| `E_LOG_TABLE` | tên bảng (đặt, hoặc suy ra từ `id`: `-` thành `_`, `id` bắt đầu bằng chữ số thêm `t_`) không hợp lệ (`^[a-z][a-z0-9_]{0,47}$`), bắt đầu bằng `mat_`, hoặc trùng bảng của nhóm khác | `/groups/i` |
| `E_LOG_DEADBAND` | `deadband` cho Tag không phải số | `/groups/i/tags/j/deadband` |
| `E_LOG_MAXLEN` | `maxLength` cho Tag không phải `STRING` | `/groups/i/tags/j/maxLength` |
| `E_LOG_MODE` | `cyclic` thiếu `periodMs`, hoặc có `minIntervalMs`/`maxIntervalMs`; `onChange` có `periodMs`; `maxIntervalMs < minIntervalMs` | `/groups/i` |
| `E_LOG_LIMIT` | nhóm có > 64 Tag `STRING` | `/groups/i/tags` |
| `E_LOG_CONN` | thiếu trường bắt buộc theo `type` (SQL: `host`, `database`, `user`; `influxdb`: `url`, `org`, `bucket`) hoặc có trường của loại khác | `/connections/i` |
| `E_LOG_TLS` | `tls` không hợp với URL: `influxdb` với `http://` mà `tls` khác `disable`; `influxdb` với `https://` mà `tls` là `disable`/`prefer` | `/connections/i/tls` |

Các giới hạn số lượng (số nhóm, số Tag, `retentionDays`, chu kỳ, `maxItems`, `uniqueItems` của `destinations`) do JSON Schema chặn → `E_SCHEMA`.

## Mã cảnh báo mới (không chặn)

| Mã | Khi nào |
|---|---|
| `W_LOG_WRITE_BUDGET` | ước tính ghi eMMC > 2 GiB/ngày |
| `W_LOG_SIZE_CAP` | ước tính dung lượng cần để giữ đủ thời hạn lưu > 2 GiB (trần mặc định) |
| `W_LOG_TLS_UNVERIFIED` | một nhóm gửi tới kết nối không xác thực máy chủ: SQL có `tls` khác `verify-full` (thiếu `tls` là `verify-full`, không cảnh báo); InfluxDB `https://` với `tls: require`, hoặc `http://` tới máy khác (`localhost`, `127.x.x.x`, `[::1]` thì không). Kẻ đứng giữa có thể lấy mật khẩu/token. Vị trí: `/connections/i` |

Studio cho lưu project khi chỉ còn cảnh báo `W_LOG_*`. Runtime vẫn kích hoạt project và đưa cảnh báo vào `historian.warnings`.

## Công thức ước tính (TS và C++ dùng cùng hằng số)

```text
cellBytes(BOOL) = 2
cellBytes(INT16 | UINT16) = 3
cellBytes(INT32 | UINT32) = 5
cellBytes(INT64 | UINT64 | FLOAT32 | FLOAT64) = 9
cellBytes(STRING) = 2 + min(maxLength, 64)

rowBytes(g)   = 24 + Σ cellBytes(tag)
rowsPerDay(g) = 86 400 000 / periodMs          (cyclic)
              = 86 400 000 / minIntervalMs     (onChange: cận trên)
commitsPerDay = 86 400 000 / 5 000             (khoảng gom mặc định 5 s)

writeBytesPerDay = Σ_g [ 2 × rowsPerDay(g) × rowBytes(g)
                         + min(commitsPerDay, rowsPerDay(g)) × 3 × 4 096 ]
storageBytes     = Σ_g [ rowsPerDay(g) × rowBytes(g) × retentionDays(g) ]

W_LOG_WRITE_BUDGET ⇔ writeBytesPerDay > 2 × 1024³
W_LOG_SIZE_CAP     ⇔ storageBytes     > 2 × 1024³
```

Ví dụ:

- 500 Tag FLOAT32 ghi mỗi 1 s, một nhóm: khoảng 0,99 GB/ngày, không cảnh báo.
- Cùng nhóm đó ghi mỗi 100 ms: khoảng 8,0 GB/ngày (8.029.808.640 byte) → `W_LOG_WRITE_BUDGET`; một ngày dữ liệu đã khoảng 3,9 GB nên có thêm `W_LOG_SIZE_CAP`.

## Bộ vector (`tests/project-vectors/logging-*`)

`expected.json` có thêm trường tùy chọn `warnings: [mã]`. Khi trường có mặt, test hai bản so cả **tập** mã cảnh báo.

| Vector | errors | warnings |
|---|---|---|
| `logging-valid` (2 nhóm, đủ 4 loại kết nối, mọi tổ hợp `tls` hợp lệ) | — | `W_LOG_TLS_UNVERIFIED` |
| `logging-valid-verified` (mọi kết nối xác thực máy chủ, có SQL Server `verify-full`, InfluxDB `http://localhost`) | — | — |
| `logging-valid-digit-group` (id `3pha`, bảng `t_3pha`) | — | — |
| `logging-valid-local-only` | — | — |
| `logging-warn-budget` (200 Tag, mỗi 100 ms) | — | `W_LOG_WRITE_BUDGET` |
| `logging-warn-size-cap` (3 Tag, mỗi 1 s, 3650 ngày) | — | `W_LOG_SIZE_CAP` |
| `logging-invalid-secret` | `E_LOG_SECRET` | |
| `logging-invalid-schema` | `E_SCHEMA` | |
| `logging-invalid-version` | `E_SCHEMA_VERSION` | |
| `logging-invalid-path` | `E_PATH` | |
| `logging-invalid-missing` | `E_FILE_MISSING` | |
| `logging-invalid-dup-id` | `E_LOG_DUP_ID` | |
| `logging-invalid-ref-tag` | `E_LOG_REF_TAG` | |
| `logging-invalid-dup-tag` | `E_LOG_DUP_TAG` | |
| `logging-invalid-ref-dest` | `E_LOG_REF_DEST` | |
| `logging-invalid-column-reserved` | `E_LOG_COLUMN` | |
| `logging-invalid-column-rowid` (`RowId`) | `E_LOG_COLUMN` | |
| `logging-invalid-column-pg-system` (`XMAX`) | `E_LOG_COLUMN` | |
| `logging-invalid-column-influx` (`_value`) | `E_LOG_COLUMN` | |
| `logging-invalid-column-source` (`Source`) | `E_LOG_COLUMN` | |
| `logging-invalid-column-dup` (hoa/thường) | `E_LOG_COLUMN` | |
| `logging-invalid-table-dup` | `E_LOG_TABLE` | |
| `logging-invalid-deadband` | `E_LOG_DEADBAND` | |
| `logging-invalid-maxlen` | `E_LOG_MAXLEN` | |
| `logging-invalid-mode` | `E_LOG_MODE` | |
| `logging-invalid-limit` (65 Tag chuỗi) | `E_LOG_LIMIT` | |
| `logging-invalid-conn` | `E_LOG_CONN` | |
| `logging-invalid-tls` (`http://` với `tls: require`) | `E_LOG_TLS` | |
| `logging-invalid-url-credentials` | `E_LOG_SECRET` | |
| `logging-invalid-url-query` (URL có `?`) | `E_SCHEMA` | |
| `logging-invalid-key-kelvin` (khóa `to\u212Aen`: không phải bí mật khi so ASCII) | `E_SCHEMA` | |

`valid-tank-demo` (chép từ `projects/tank-demo`) có `logging.json` thật và phải hợp lệ, không có cảnh báo.
