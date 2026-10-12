# Data model — 003 Lưu trữ dữ liệu Tag

Định dạng file và mã lỗi: [contracts/logging-config.md](contracts/logging-config.md). Bảng ở DB ngoài: [contracts/external-schema.md](contracts/external-schema.md). File trên thiết bị và lệnh: [contracts/device.md](contracts/device.md). Trạng thái: [contracts/system-info.md](contracts/system-info.md).

## 1. Cấu hình (trong project)

### LoggingConfig — `logging.json`

| Trường | Kiểu | Bắt buộc | Mặc định | Ràng buộc |
|---|---|---|---|---|
| `schemaVersion` | SemVer | có | | `0.1.x` |
| `timeZone` | `±HH:MM` | không | `+07:00` | −12:00 … +14:00; dùng để căn chu kỳ và xuất CSV |
| `groups` | LoggingGroup[] | có | | 1–32, `id` duy nhất |
| `connections` | Connection[] | không | `[]` | 0–8, `id` duy nhất |

Khai báo trong `project.json` bằng `"loggingFile": "logging.json"` (tùy chọn). Không có trường này thì không lưu trữ.

### LoggingGroup

| Trường | Kiểu | Bắt buộc | Mặc định | Ràng buộc |
|---|---|---|---|---|
| `id` | string | có | | `^[a-z0-9][a-z0-9-]{0,47}$` |
| `name` | string | có | | 1–80 ký tự |
| `table` | string | không | `id` đổi `-` thành `_`; bắt đầu bằng số thì thêm `t_` | `^[a-z][a-z0-9_]{0,47}$`; duy nhất; khác `mat_forward_state` |
| `mode` | `cyclic` \| `onChange` | có | | |
| `periodMs` | int | khi `cyclic` | | 100 … 86.400.000; chỉ dùng với `cyclic` |
| `minIntervalMs` | int | không | 1000 | 100 … 86.400.000; chỉ dùng với `onChange` |
| `maxIntervalMs` | int | không | không có | ≥ `minIntervalMs`, ≤ 86.400.000; chỉ dùng với `onChange` |
| `retentionDays` | int | có | | 1 … 3650 |
| `destinations` | string[] | không | `[]` | id của Connection, không trùng, ≤ 8 |
| `tags` | LoggedTag[] | có | | 1–200; tối đa 64 Tag chuỗi |

### LoggedTag

| Trường | Kiểu | Bắt buộc | Mặc định | Ràng buộc |
|---|---|---|---|---|
| `tagId` | string | có | | Tag có trong `tags.json`; không lặp trong nhóm |
| `column` | string | không | `tagId` đổi ký tự không phải `[A-Za-z0-9_]` thành `_` | `^[A-Za-z_][A-Za-z0-9_]{0,62}$`; duy nhất trong nhóm (không phân biệt hoa/thường); không là tên dành riêng: `id`, `time`, `seq`, `ts`, `rowid`, `oid`, `_rowid_`, `xmin`, `xmax`, `cmin`, `cmax`, `ctid`, `tableoid`, `source`, hay tên bắt đầu bằng `_` ([logging-config](contracts/logging-config.md)) |
| `deadband` | number ≥ 0 | không | 0 | chỉ Tag số; chỉ có tác dụng với `onChange` |
| `maxLength` | int | không | 255 | 1–4000; chỉ Tag `STRING` |

### Connection

| Trường | Kiểu | Dùng cho | Ràng buộc |
|---|---|---|---|
| `id` | string | mọi loại | `^[a-z0-9][a-z0-9-]{0,47}$` |
| `type` | `mysql` \| `mssql` \| `postgresql` \| `influxdb` | | `mysql` dùng cho cả MariaDB |
| `host` | string | SQL | tên máy hoặc IP, ≤ 253 |
| `port` | int | SQL | 1–65535; mặc định 3306 / 1433 / 5432 |
| `database` | string | SQL | 1–64 |
| `schema` | string | `postgresql`, `mssql` | `^[A-Za-z_][A-Za-z0-9_]{0,62}$`; mặc định `public` / `dbo` |
| `user` | string | SQL | 1–128 |
| `url` | string | `influxdb` | `http://` hoặc `https://` + máy (tên, IPv4 hoặc `[IPv6]`), cổng và đường dẫn tùy chọn; không có tài khoản/mật khẩu (`E_LOG_SECRET`), `?`, `#`; ≤ 256 |
| `org`, `bucket` | string | `influxdb` | 1–64 |
| `tls` | `disable` \| `prefer` \| `require` \| `verify-full` | mọi loại | mặc định `verify-full` (SQL, Constitution V); InfluxDB theo scheme của `url`. Khác `verify-full` (InfluxDB: `http://` tới máy khác, `https://` + `require`) → cảnh báo `W_LOG_TLS_UNVERIFIED` |
| `timeZone` | `±HH:MM` | SQL | mặc định lấy `timeZone` gốc; InfluxDB luôn UTC |

Không có trường mật khẩu hay token. Khóa giống bí mật bị từ chối ở bất kỳ đâu (`E_LOG_SECRET`).

## 2. Trên thiết bị

### DeviceSecret — `/etc/mat-runtime/secrets.json`

`connections.<id>`: một chuỗi, là mật khẩu (SQL) hoặc token (InfluxDB). Chủ sở hữu `root:matscada`, quyền `0640`. Chi tiết: [contracts/device.md](contracts/device.md).

### LocalDb — `${dataDir}/history.db`

| Bảng | Cột | Ghi chú |
|---|---|---|
| `mat_meta` | `key TEXT PK`, `value TEXT` | `instance_id` (UUID v4, tạo một lần), `schema` = `1` |
| `mat_tables` | `name TEXT PK`, `group_id TEXT`, `retention_days INT`, `created_ms INT`, `updated_ms INT` | mọi bảng đã tạo, kể cả của nhóm đã bỏ (thời hạn cuối cùng đã biết) |
| `mat_forward` | `dest TEXT`, `tbl TEXT`, `last_seq INT`, PK `(dest, tbl)` | con trỏ InfluxDB; bản sao con trỏ SQL để báo trạng thái |
| `mat_forward_mark` | `dest TEXT`, `tbl TEXT`, `mark INT`, PK `(dest, tbl)` | mốc C1 của đích SQL: `seq` lớn nhất khi mở file, giữ tới khi forwarder đã so con trỏ của đích với nó (mốc cũ, nhỏ hơn, được giữ); xóa trong giao dịch `synchronous=FULL` ([research R3](research.md)) |
| `log_<table>` | `seq INTEGER PK AUTOINCREMENT`, `ts INT NOT NULL`, mỗi Tag một cột | chỉ mục `log_<table>_ts` trên `ts` |

### LogRow (bộ nhớ, trước khi commit)

`table`, `ts` (UTC ms), `cells[]`: mỗi ô là một trong `null`, bool, int64, uint64, double, string. Thứ tự ô theo thứ tự Tag trong nhóm.

### ForwardState

- **Đích SQL:** `mat_forward_state(source_id, table_name, last_seq, updated_at)` nằm ở DB ngoài; `source_id` = `instance_id`.
- **InfluxDB:** `mat_forward(dest, tbl, last_seq)` trên thiết bị.

Bất biến: mọi dòng `seq ≤ last_seq` đã nằm ở đích (hoặc đã được tính là mất). Với đích SQL, một lô chỉ dời `last_seq` từ đúng giá trị forwarder đã đọc; giá trị khác (một giao dịch của phiên trước commit muộn) thì lô không lưu gì, và forwarder đọc lại con trỏ (research R8, review vòng ba).

## 3. Trạng thái và chuyển trạng thái

### Historian (`historian.state`)

```text
disabled ── project có loggingFile hợp lệ ──► running
running ── now < MAT_BUILD_EPOCH ──► clock_invalid ── đồng hồ hợp lệ ──► running
running ── dung lượng trống < minFree ──► paused_low_disk ── trống > minFree + 50 MB ──► running
running ── lỗi I/O SQLite ──► error ── thử lại sau 10 s thành công ──► running
error ── file hỏng (SQLITE_CORRUPT/NOTADB) ──► đổi tên file, tạo mới ──► running
```

Khi ở `clock_invalid` và `paused_low_disk`: không tạo dòng. Khi ở `error`: dòng đệm trong RAM tối đa 10.000 dòng; vượt thì bỏ dòng cũ nhất và tăng `rowsDropped`.

### Destination (`destinations[].state`)

```text
idle ──► no_client   (không nạp được thư viện; thử lại sau 5 phút)
idle ──► no_secret   (thiếu bí mật hoặc file sai quyền; thử lại mỗi lần backoff)
idle ──► connecting ── ok ──► syncing_schema ──► ok (đang gửi / chờ dòng mới)
connecting / ok ── lỗi ──► error (phân loại lỗi) ── backoff 1 … 60 s ──► connecting
```

`ok` kèm `pendingRows`, `lagS`. Lỗi `schema_mismatch` và `permission` dùng cùng vòng backoff, và báo cho tới khi quản trị DB sửa.

## 4. Luật quyết định ghi

| Chế độ | Ghi khi | Giá trị |
|---|---|---|
| `cyclic` | tới mốc `k × periodMs` (căn theo `timeZone` nếu chu kỳ chia hết một ngày); mỗi lượt tối đa 1 dòng | giá trị hiện hành |
| `onChange` | lúc bắt đầu (dòng gốc); hoặc có Tag đổi vượt deadband / đổi lớp chất lượng **và** đã qua `minIntervalMs` kể từ dòng trước; hoặc đã qua `maxIntervalMs` | giá trị hiện hành (mới nhất) |

Ô rỗng khi: chất lượng khác GOOD, NaN, vô cực. Chuỗi dài hơn `maxLength` bị cắt theo ranh giới ký tự.
