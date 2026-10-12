# Contract — khối `historian` trong `GET /api/v1/system/info`

Bổ sung một khóa vào phản hồi hiện có ([http-api.md Sprint 1](../../002-vertical-slice/contracts/http-api.md)); các khóa cũ giữ nguyên. Trang này **công khai** (chưa có đăng nhập), nên **không** có mật khẩu, token, tên người dùng, địa chỉ máy chủ, tên database hay URL.

## Không có cấu hình lưu trữ

```json
"historian": { "enabled": false }
```

## Có cấu hình lưu trữ

```json
"historian": {
  "enabled": true,
  "state": "running",
  "clock": "ok",
  "clockJumps": 0,
  "groups": 2,
  "rowsWritten": 15234,
  "rowsDropped": 0,
  "stringsTruncated": 0,
  "dbBytes": 12582912,
  "dbMaxBytes": 2147483648,
  "freeBytes": 5368709120,
  "commitMs": 5000,
  "lastCommitAt": 1791601205000,
  "lastRetention": { "at": 1791601200000, "rowsDeleted": 120 },
  "capPurges": 0,
  "capRowsDeleted": 0,
  "warnings": ["W_LOG_SIZE_CAP"],
  "lastError": null,
  "destinations": [
    {
      "id": "mysql-office",
      "type": "mysql",
      "state": "ok",
      "pendingRows": 0,
      "lagS": 0,
      "sentRows": 15100,
      "lostRows": 0,
      "outOfRangeValues": 0,
      "rejectedRows": 0,
      "lastOkAt": 1791601205100,
      "lastError": null
    },
    {
      "id": "influx",
      "type": "influxdb",
      "state": "error",
      "pendingRows": 1834,
      "lagS": 1830,
      "sentRows": 0,
      "lostRows": 0,
      "outOfRangeValues": 0,
      "rejectedRows": 0,
      "lastOkAt": null,
      "lastError": { "code": "connect", "dbCode": null, "message": "Không kết nối được máy chủ", "at": 1791601204000 }
    }
  ]
}
```

## Ý nghĩa

| Trường | Ý nghĩa |
|---|---|
| `state` | `running`, `clock_invalid` (đồng hồ trước mốc build: không ghi), `paused_low_disk`, `error` (lỗi I/O, đang thử lại) |
| `clock` | `ok` hoặc `invalid` |
| `clockJumps` | số lần đồng hồ nhảy quá 2 chu kỳ từ lúc khởi động |
| `rowsWritten` | số dòng đã commit vào SQLite, từ lúc khởi động |
| `rowsDropped` | số dòng bỏ vì đệm đầy khi SQLite lỗi kéo dài |
| `stringsTruncated` | số ô chuỗi bị cắt theo `maxLength` |
| `dbBytes` / `dbMaxBytes` | dung lượng đang dùng (trang có dữ liệu) / trần |
| `freeBytes` | dung lượng trống của phân vùng chứa `dataDir` |
| `lastRetention` | lần dọn theo thời hạn gần nhất; `null` nếu chưa chạy |
| `capPurges`, `capRowsDeleted` | số lần và số dòng phải xóa vì chạm trần |
| `warnings` | mã `W_LOG_*` của cấu hình hiện tại |
| `lastError` | lỗi lưu trữ gần nhất trên thiết bị, `{code, message, at}`: `disk_full`, `io`, `corrupt_recovered` |
| `destinations[].state` | `connecting`, `ok`, `error`, `no_client`, `no_secret` |
| `pendingRows` | số dòng trên thiết bị chưa gửi tới đích (mọi nhóm) |
| `lagS` | tuổi (giây) của dòng cũ nhất chưa gửi; 0 nếu không còn |
| `sentRows`, `lostRows` | từ lúc khởi động; `lostRows` là số dòng bị xóa trên thiết bị trước khi kịp gửi |
| `outOfRangeValues` | từ lúc khởi động: số giá trị mà cột ở DB ngoài không chứa được, đã gửi `NULL` (số ngoài miền của kiểu, ví dụ 40000 cho INT16; chữ trong cột số) hoặc cắt cho vừa cột (chuỗi dài hơn `NVARCHAR(n)` của SQL Server tính theo đơn vị UTF-16) |
| `rejectedRows` | từ lúc khởi động: số dòng InfluxDB bỏ khi chỉ nhận một phần lô ("partial write": dòng cũ hơn thời hạn của bucket, field khác kiểu). Phần còn lại của lô đã ghi; forwarder đi tiếp, không gửi lại |
| `destinations[].lastError` | lỗi làm đích rời trạng thái `ok`: `{code, dbCode, message, at}`; `dbCode` là chuỗi (`"1045"`, `"28P01"`, `"404"`) hoặc `null`. Về `null` khi đích về `ok` |

## Phân loại lỗi của đích (`lastError.code`)

| `code` | Câu hiển thị | Ví dụ mã DB |
|---|---|---|
| `no_client` | Chưa cài thư viện client cho loại DB này | — |
| `no_secret` | Chưa có mật khẩu/token trên thiết bị, hoặc file secrets sai quyền | — |
| `connect` | Không kết nối được máy chủ | MySQL 2002/2003/2005/2013; FreeTDS 20009; PostgreSQL `08xxx`; curl không kết nối được |
| `auth` | Sai tài khoản hoặc mật khẩu | MySQL 1045; SQL Server 18456; PostgreSQL `28P01`/`28000`; HTTP 401/403 |
| `tls` | Lỗi mã hóa đường truyền (TLS) | MySQL 2026; lỗi SSL của curl/libpq |
| `timeout` | Hết thời gian chờ máy chủ | FreeTDS 20003; curl timeout |
| `permission` | Tài khoản thiếu quyền tạo/sửa/ghi bảng | MySQL 1142/1044; SQL Server 229/262/1088; PostgreSQL `42501` |
| `schema_mismatch` | Bảng ở DB ngoài không khớp (thiếu cột, sai kiểu), hoặc bucket không có | MySQL 1054/1146/1366; SQL Server 207/208/245/8152; PostgreSQL `42703`/`42P01`/`22xxx`; HTTP 400/404 |
| `sql` | Lỗi SQL khác (xem `dbCode`) | các mã còn lại |
| `http` | InfluxDB trả lỗi HTTP (xem `dbCode` = mã HTTP) | 413, 429, 5xx |

Thông báo gốc của client chỉ ghi vào journal của systemd.

Studio (tab Thiết bị) hiển thị: `state`, `rowsWritten`, `dbBytes`/`dbMaxBytes`, và mỗi đích một dòng `id · state · pendingRows · lagS · lastError.message`.
