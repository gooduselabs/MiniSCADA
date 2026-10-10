# Thư viện bên thứ ba (vendored)

Rà soát license theo Constitution ("Ràng buộc công nghệ"): không thư viện nào dưới đây là GPL/LGPL; mọi license đều cho phép liên kết tĩnh trong sản phẩm thương mại khi giữ thông báo bản quyền.

| Thư viện | Phiên bản | License | Thư mục | Dùng ở | Nguồn |
|---|---|---|---|---|---|
| CivetWeb | 1.16 | MIT | `civetweb/` (`LICENSE.md`) | `mat-runtime`, `mat-poc` (máy chủ HTTP/WebSocket) | https://github.com/civetweb/civetweb |
| nlohmann/json | 3.11.3 | MIT | `nlohmann/` (`LICENSE.MIT`) | `mat-runtime` (config, project, bản tin client) | https://github.com/nlohmann/json/releases/tag/v3.11.3 (chỉ `json.hpp`) |
| valijson | 1.0.3 | BSD-2-Clause | `valijson/` (`LICENSE`) | `mat-runtime` (validator JSON Schema draft-07) | https://github.com/tristanpenman/valijson/releases/tag/v1.0.3 (chỉ `include/`) |
| GoogleTest | 1.15.2 | BSD-3-Clause | `googletest/` (`LICENSE`) | **chỉ test** trên x64, không có trong binary thiết bị | https://github.com/google/googletest/releases/tag/v1.15.2 (bỏ docs/ci/bazel) |

## Bản vá cục bộ

- **CivetWeb 1.16** (`civetweb/civetweb.c`, đánh dấu "mAT patch"), sau review Sprint 1:
  1. `MG_MAT_MAX_WS_FRAME` (mặc định 96 KiB): frame WebSocket lớn hơn bị đóng 1009 **trước** khi cấp phát. Upstream cấp phát theo độ dài client khai báo, tới khoảng 2 GB.
  2. `mg_mat_force_close(conn)`: cắt kết nối từ thread khác (hạn chót sau close frame, writer bị lỗi).
- `mat-runtime` link bản `civetweb_runtime` build với `NO_FILES`, không chứa mã phục vụ file/redirect thư mục (CVE-2025-55763). `mat-poc` (Sprint 0, không triển khai) vẫn dùng bản đầy đủ.
- Khi nâng cấp CivetWeb: áp lại hai bản vá, chạy lại `server/websocket/tests` và `tools/measure/http-check.mjs`.

Thư viện npm (`@cfworker/json-schema` MIT, Tauri plugin MIT/Apache-2.0) quản lý qua `package-lock.json` / `Cargo.lock`.

Khi đóng gói sản phẩm: kèm nội dung các file LICENSE trên trong tài liệu phát hành.
