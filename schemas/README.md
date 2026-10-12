# schemas/

JSON Schema (draft-07) của định dạng project **v0** (`schemaVersion` `0.1.x`). Nguồn chuẩn cho cả bộ kiểm tra TypeScript (`packages/project-schema`) và C++ (`core/project-manager`). Ý nghĩa trường: [specs/002-vertical-slice/data-model.md](../specs/002-vertical-slice/data-model.md); mã lỗi và luật liên file: [contracts/project-format.md](../specs/002-vertical-slice/contracts/project-format.md).

`logging.schema.json` (feature 003): cấu hình lưu trữ dữ liệu Tag `logging.json`, trỏ tới bằng `loggingFile` của `project.json`. Nhóm lưu trữ (theo chu kỳ hoặc theo thay đổi, thời hạn lưu, Tag và cột), kết nối DB ngoài (MySQL/MariaDB, SQL Server, PostgreSQL, InfluxDB) **không có** mật khẩu/token. Luật liên file `E_LOG_*` và cảnh báo `W_LOG_*`: [specs/003-data-logging/contracts/logging-config.md](../specs/003-data-logging/contracts/logging-config.md).

`protocol-version.json`: phiên bản giao thức live và định dạng project mà runtime hiện tại hỗ trợ.

`package-manifest.schema.json` (feature 005): manifest `matscada.json` của gói project `.matscada`, định dạng 1.x. Khóa lạ ở cấp đầu, trong `project` và `generator` được bỏ qua (bản MINOR sau thêm khóa được); mỗi mục của `files` có đúng ba khóa `path`, `size`, `sha256`. Schema không đặt pattern cho `files[].path`: đường dẫn kiểm bằng luật §5 của [contracts/matscada-package.md](../specs/005-device-online/contracts/matscada-package.md) (`E_PKG_PATH`, `E_PKG_TYPE`). Bộ đọc C++ (`core/package`) kiểm bằng valijson; Studio (Rust) kiểm cùng luật bằng serde. Luật ngoài schema (`files` sắp tăng dần theo byte UTF-8, không trùng, không có `matscada.json`; MAJOR của `formatVersion` phải là 1): contract §3, §8a.

Gói và manifest dùng chung cho C++, Rust và TS: vector ở `tests/package-vectors/` (`node tests/package-vectors/generate.mjs` sinh lại; `--out` sinh các gói lớn không commit). Tập file của gói phải đúng bằng tập file mà project tham chiếu: file thừa không tham chiếu làm digest của gói khác digest runtime tính từ project, và lần nạp xuống bị quay về.

Đổi schema: tăng phiên bản theo ADR-004, cập nhật cả hai bộ kiểm tra và `tests/project-vectors/`.
