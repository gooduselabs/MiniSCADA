# Plan: Thiết lập thiết bị từ Studio (027)

## Quyết định (tự chốt, 2026-10-26)

- **D1 Tệp đè ở dataDir.** `/etc/mat-runtime` chỉ đọc với runtime (ProtectSystem=strict, ReadOnlyPaths). Không nới sandbox; `settings.json` nằm ở `/var/lib/mat-runtime` (StateDirectory). `runtime.json` vẫn là cấu hình hạ tầng do người cài viết.
- **D2 Khởi động lại thay vì áp nóng.** Dùng lại `deployHooks.restart` (execv, giữ phiên). Kích hoạt từ vòng tick ~1 s sau khi trả lời để câu trả lời kịp đi. Hai yêu cầu liên tiếp gộp một lần.
- **D3 Hạ bảo mật cần reauth** (như 013): mật khẩu nhập lại tính vào khóa tài khoản.
- **D4 Chứng chỉ:** dùng lại `regenerateServerCert`, `makeServerCsr`, `importServerCert` (đã nguyên tử, flock). Thêm `ImportOptions.rejectExpired` cho API. Không có API tải khóa riêng.
- **D5 API trong `AdminApi`** (khuôn 013: giới hạn 30 thay đổi/phút, audit trước tệp, `rev`) qua giao diện `DeviceAdmin` (server/device_admin.*) để test không cần socket.
- **D6 Studio:** lệnh Tauri dùng lại kênh HTTPS ghim (`device_request`), thêm lệnh ghim lại fingerprint sau khi người dùng xác nhận.

## Thành phần

| Phần | Tệp |
|---|---|
| Đè cấu hình | `server/config.{hpp,cpp}` (`applyDeviceSettings`, nạp `settings.json`) |
| Kho + chứng chỉ + hẹn khởi động lại | `server/device_admin.{hpp,cpp}` |
| API | `server/http/admin_api.*`, `core/auth/roles.cpp`, `main.cpp` |
| Audit | `core/audit/audit_actions.hpp` (`device.settings`) |
| Mã lỗi | `schemas/error-codes.json` (`CERT_EXPIRED` mới; `CERT_FILE_INVALID`, `CERT_KEY_MISMATCH` thêm HTTP 400 và server/http) |
| deploy | `deployment/device/deploy.sh` (bit thực thi của updater/) |
| Web | `apps/runtime-web/src/admin/tab-device.ts` |
| Studio | `apps/studio` (cây thiết bị, trình soạn Thiết lập thiết bị) |
| Tài liệu | ADR-054, admin-guide, engineer-guide, threat-model |

## Rủi ro

- Thiết lập sai khóa người dùng ra ngoài (vd. `allowedHosts` thiếu tên đang dùng): Studio cảnh báo khi tên đang kết nối không còn trong danh sách; phục hồi: xóa `settings.json` qua SSH.
- Regen làm Studio khác mất ghim: đã có luồng ghim lại của 005.
