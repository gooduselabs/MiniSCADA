# Contract — cấu hình `mat-runtime`

File `/etc/mat-runtime/runtime.json` (đường dẫn đổi được bằng `--config`). Tham số dòng lệnh cùng tên (`--port 8080`…) ghi đè file. Thiếu file thì dùng mặc định. File JSON sai thì thoát mã 2 kèm thông báo (systemd khởi động lại và log lỗi).

| Khóa | Kiểu | Mặc định | Ràng buộc / ghi chú |
|---|---|---|---|
| `port` | int | 8080 | 1024–65535 (user không đặc quyền) |
| `docroot` | string | `/opt/mat-runtime/web` | |
| `projectDir` | string | `/opt/mat-runtime/project` | |
| `maxClients` | int | 10 | 1–10; giá trị > 10 bị kẹp về 10 và ghi cảnh báo; giới hạn thực = `min(config, project.maxClients)` |
| `allowedOrigins` | string[] | `["http://tauri.localhost", "tauri://localhost"]` | origin bổ sung ngoài cùng origin |
| `deltaPeriodMs` | int | 250 | 100–250 |
| `simLoad` | bool | true | bật 500 Tag `SIM.T0001…T0500` để đo tải |
| `sendQueueBytes` | int | 262144 | cố định theo Master Plan §6.1; chỉ cho đổi để test (16384–262144) |
| `heartbeatTimeoutMs` | int | 15000 | chỉ cho đổi để test (≥ 5000) |
| `threads` | int | 24 | số worker CivetWeb (≥ maxClients + 4) |

**Chế độ kiểm tra:** `mat-runtime --check-project [--project-dir <dir>] [--schemas-dir <dir>]` chỉ validate project, in kết quả JSON giống [project-format.md](project-format.md), không mở cổng. Mã thoát: 0 hợp lệ, 1 không hợp lệ. Script deploy dùng chế độ này ở bước validate. `schemasDir` mặc định là `<thư mục binary>/../schemas`.

Origin cho Studio chạy dev (`npm run studio:dev`, origin `http://localhost:1420`) **không** có trong mặc định. Khi cần, thêm tạm vào `allowedOrigins` trên máy thử, không thêm trên thiết bị vận hành.

Thoát mã: 0 bình thường (SIGTERM); 2 lỗi config; 3 không mở được cổng. Project không hợp lệ **không** làm tiến trình thoát: runtime vẫn phục vụ trang và báo lỗi qua `/api/v1/system/info` (FR-025).
