# Contract — file trên thiết bị, cấu hình và lệnh

Bổ sung cho [contracts runtime-config Sprint 1](../../002-vertical-slice/contracts/runtime-config.md). Các khóa cũ giữ nguyên.

## Khóa mới trong `runtime.json`

| Khóa | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `dataDir` | string | `/var/lib/mat-runtime` | thư mục ghi được; chứa `history.db` |
| `secretsFile` | string | `/etc/mat-runtime/secrets.json` | |
| `clientLibDir` | string | `/opt/mat-runtime/lib` | thư mục tìm thư viện client trước bộ nạp hệ thống; không có cũng được |
| `historianMaxDbMB` | int | 2048 | 64 … 65536 (trần dung lượng lưu trữ) |
| `historianMinFreeMB` | int | 500 | 50 … 65536 (dưới mức này thì tạm dừng ghi) |
| `historianCommitMs` | int | 5000 | 1000 … 60000 (khoảng gom ghi; mất điện mất tối đa chừng này) |

Tham số dòng lệnh tương ứng: `--data-dir`, `--secrets-file`.

## File và thư mục

| Đường dẫn | Chủ sở hữu, quyền | Ai tạo | Qua deploy/rollback |
|---|---|---|---|
| `/var/lib/mat-runtime/` | `matscada`, `0700` | systemd (`StateDirectory=mat-runtime`) | giữ nguyên |
| `/var/lib/mat-runtime/history.db` (+ `-wal`, `-shm`) | `matscada`, `0600` | runtime | giữ nguyên |
| `/var/lib/mat-runtime/history.db.corrupt-<epoch>` | `matscada` | runtime, khi file hỏng | giữ để điều tra, xóa tay |
| `/etc/mat-runtime/secrets.json` | `root:matscada`, `0640` | `--set-secret` hoặc người quản trị | giữ nguyên |
| `/opt/mat-runtime/lib/` | `root`, `0755` | gói runtime (tùy chọn, để dành) | đi theo bản runtime |

## `secrets.json`

```json
{ "schemaVersion": "0.1.0", "connections": { "mysql-office": "<mật khẩu>", "influx": "<token>" } }
```

- Mỗi kết nối một chuỗi: mật khẩu (SQL) hoặc token (InfluxDB). Tối đa 64 KB.
- File cho người khác đọc hoặc ghi (`mode & 0007 ≠ 0`) thì runtime **không dùng**; các đích báo `no_secret` (lý do `permissions`).
- Runtime đọc lại file ở mỗi lần kết nối, nên đổi mật khẩu không cần khởi động lại dịch vụ.

## Unit systemd

Thêm vào `[Service]` của `mat-runtime.service` (phần sandbox giữ nguyên):

```ini
StateDirectory=mat-runtime
StateDirectoryMode=0700
```

## Lệnh

### Nhập bí mật

```sh
/opt/mat-runtime/bin/mat-runtime --set-secret <connectionId> [--secrets-file <path>]   # bằng root
```

- Chạy bằng root (BL335 không có `sudo`; máy có `sudo` thì `sudo …`). Lệnh đọc dữ liệu (xuất, kiểm) chạy bằng user `matscada` qua `runuser -u matscada --`.
- Đọc dòng đầu của stdin; khi stdin là TTY thì tắt echo.
- Ghi file tạm, `fsync`, `chown root:matscada`, `chmod 0640`, rồi `rename`.
- Mã thoát: `0` thành công; `4` không chạy bằng root, id không hợp lệ hoặc không ghi được.
- Không in bí mật ra màn hình hay log.

### Xuất dữ liệu ra CSV

```sh
runuser -u matscada -- /opt/mat-runtime/bin/mat-runtime --export-history <groupId> \
     [--from "YYYY-MM-DD[ HH:MM[:SS]]"] [--to "…"] [--tz +07:00] [--data-dir <dir>]
```

- Mở `history.db` chỉ đọc. Tìm bảng theo `group_id` trong `mat_tables`, kể cả nhóm đã bỏ khỏi project.
- Mặc định: 24 giờ gần nhất. `--tz` mặc định `+07:00`.
- **Đầu ra** (stdout): UTF-8, phân cách dấu phẩy, quote theo RFC 4180.
  - Dòng tiêu đề: `time,<cột 1>,<cột 2>,…`.
  - `time` theo giờ địa phương, dạng `YYYY-MM-DD HH:MM:SS.mmm`.
  - Ô rỗng để trống.
  - Ô chuỗi bắt đầu bằng `=`, `+`, `-`, `@`, tab hoặc CR được thêm dấu `'` ở đầu: Excel/LibreOffice không chạy nó như công thức (review bảo mật M3). Excel có thể tách theo dấu phân cách khác dấu phẩy (`;` với thiết lập vi-VN) và khi đó bỏ qua dấu nháy, nên cùng quy tắc áp cho mọi vị trí sau `,` `;` tab hoặc xuống dòng trong ô chuỗi. Ô số, kể cả số âm, giữ nguyên.
  - Khi stdout là terminal: ký tự điều khiển trong ô chuỗi (chuỗi ESC, CR, C1) hiện dạng `\xNN`, ký tự đổi chiều chữ và ngắt dòng vô hình (U+061C, U+200E/200F, U+2028/2029, U+202A…202E, U+2066…2069) hiện dạng `\uXXXX`, thay vì tác động lên terminal. Ghi ra file (`> file.csv`) thì giữ nguyên.
  - Đầu ra đóng giữa chừng (`… | head`): lệnh dừng ngay theo SIGPIPE như các lệnh Unix khác.
- Mã thoát: `0`; `2` tham số sai; `4` không có DB hoặc không có nhóm; `5` không ghi được kết quả (ví dụ đĩa đầy): file CSV không đủ.

### Kiểm file lưu trữ

```sh
runuser -u matscada -- /opt/mat-runtime/bin/mat-runtime --check-history [--data-dir <dir>]
```

Dùng sau một lần kill, cắt điện hoặc khi nghi file hỏng (T077, SC-008). Thêm vào trong lúc làm T077.

- Mở `history.db` chỉ đọc (không cần dừng dịch vụ) và chạy `PRAGMA integrity_check`.
- In `integrity: ok` hoặc tối đa 20 dòng mô tả lỗi, rồi số dòng của từng bảng (`<bảng>: <n> rows`; bảng không đọc được: `unreadable`).
- Mã thoát: `0` file lành; `2` tham số sai; `4` không có file; `6` file hỏng hoặc không đọc được.

### Thứ tự khởi động liên quan

1. Validate project; project lỗi thì không chạy lưu trữ, như Sprint 1.
2. Mở hoặc tạo `history.db`; tạo bảng, thêm cột theo cấu hình; cập nhật `mat_tables`.
3. Chạy đợt dọn theo thời hạn lưu, rồi bắt đầu lấy mẫu.
4. Bật thread gửi cho từng kết nối có nhóm trỏ tới.

## Thư viện client trên BL335 (Ubuntu 20.04)

Chỉ cài loại DB thật sự dùng. Cài lên thiết bị cần người dùng cho phép, và ghi vào `docs/reports/device-changes.md`.

| Loại | Gói | Gỡ |
|---|---|---|
| MySQL/MariaDB | `libmariadb3` | `apt remove libmariadb3` |
| SQL Server | `libsybdb5` | `apt remove libsybdb5` |
| PostgreSQL | `libpq5` | `apt remove libpq5` |
| InfluxDB | `libcurl4` | `apt remove libcurl4` |

Runtime không cần các gói này để chạy. Thiếu gói thì đích tương ứng báo `no_client`.
