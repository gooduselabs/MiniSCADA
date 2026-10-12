# Contract — cấu hình `mat-runtime`

File `/etc/mat-runtime/runtime.json` (đường dẫn đổi được bằng `--config`). Thứ tự ưu tiên: mặc định < file < tham số dòng lệnh.

- Chỉ dùng mặc định khi **không** truyền `--config` và file mặc định không có. Unit systemd luôn truyền `--config /etc/mat-runtime/runtime.json`, nên trên thiết bị thiếu file là dịch vụ không lên.
- Thoát mã **2** kèm thông báo (systemd khởi động lại và ghi log) khi: `--config` trỏ tới file không đọc được; file không phải JSON object; có khóa lạ; khóa sai kiểu; giá trị ngoài khoảng ở bảng dưới; tham số dòng lệnh lạ hoặc thiếu giá trị.

| Khóa | Kiểu | Mặc định | Ràng buộc / ghi chú |
|---|---|---|---|
| `port` | int | 8080 | 1024–65535 (user không đặc quyền) |
| `docroot` | string | `/opt/mat-runtime/web` | |
| `projectDir` | string | `/opt/mat-runtime/project` | |
| `schemasDir` | string | `<thư mục binary>/../schemas` | thư mục chứa `schemas/*.schema.json` cho bộ kiểm tra |
| `maxClients` | int | 10 | 1–10; giá trị > 10 bị kẹp về 10 và ghi cảnh báo; giới hạn thực = `min(config, project.maxClients)` |
| `allowedOrigins` | string[] | `["http://tauri.localhost", "tauri://localhost"]` | origin bổ sung ngoài cùng origin |
| `deltaPeriodMs` | int | 250 | 100–250 |
| `simLoad` | bool | true | bật 500 Tag `SIM.T0001…T0500` để đo tải |
| `sendQueueBytes` | int | 262144 | cố định theo Master Plan §6.1; chỉ cho đổi để test (16384–262144) |
| `heartbeatTimeoutMs` | int | 15000 | chỉ cho đổi để test (≥ 5000) |
| `threads` | int | 24 | số worker CivetWeb; nhỏ hơn maxClients + 4 thì được nâng lên kèm cảnh báo |

Khóa của lưu trữ dữ liệu Tag (`dataDir`, `secretsFile`, `clientLibDir`, `historianMaxDbMB`, `historianMinFreeMB`, `historianCommitMs`): xem [specs/003-data-logging/contracts/device.md](../../003-data-logging/contracts/device.md).

**Tham số dòng lệnh** (chỉ các tham số dưới đây; tham số khác → thoát mã 2):

| Tham số | Khóa tương ứng |
|---|---|
| `--config <file>` | đường dẫn file config |
| `--port <n>` | `port` |
| `--docroot <dir>` | `docroot` |
| `--project-dir <dir>` | `projectDir` |
| `--schemas-dir <dir>` | `schemasDir` |
| `--max-clients <n>` | `maxClients` |
| `--delta-period-ms <n>` | `deltaPeriodMs` |
| `--threads <n>` | `threads` |
| `--sim-load` / `--no-sim-load` (không kèm giá trị) | `simLoad` |
| `--data-dir <dir>`, `--secrets-file <file>` | `dataDir`, `secretsFile` (feature 003) |
| `--check-project` | chế độ kiểm tra, xem dưới |

`allowedOrigins`, `sendQueueBytes`, `heartbeatTimeoutMs` và các khóa `historian*`, `clientLibDir` chỉ đặt được qua file config. Các lệnh thiết bị của feature 003 (`--export-history`, `--check-history`, `--set-secret`) là chế độ riêng, xem device.md.

**Chế độ kiểm tra:** `mat-runtime --check-project [--project-dir <dir>] [--schemas-dir <dir>]` chỉ validate project, in kết quả JSON giống [project-format.md](project-format.md), không mở cổng. Mã thoát: 0 hợp lệ, 1 không hợp lệ. Script deploy dùng chế độ này ở bước validate. `schemasDir` mặc định là `<thư mục binary>/../schemas`.

Origin cho Studio chạy dev (`npm run studio:dev`, origin `http://localhost:1420`) **không** có trong mặc định. Khi cần, thêm tạm vào `allowedOrigins` trên máy thử, không thêm trên thiết bị vận hành.

Thoát mã: 0 bình thường (SIGTERM); 2 lỗi config; 3 không mở được cổng. Project không hợp lệ **không** làm tiến trình thoát: runtime vẫn phục vụ trang và báo lỗi qua `/api/v1/system/info` (FR-025).
