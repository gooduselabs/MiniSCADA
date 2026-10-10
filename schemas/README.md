# schemas/

JSON Schema (draft-07) của định dạng project **v0** (`schemaVersion` `0.1.x`). Nguồn chuẩn cho cả bộ kiểm tra TypeScript (`packages/project-schema`) và C++ (`core/project-manager`). Ý nghĩa trường: [specs/002-vertical-slice/data-model.md](../specs/002-vertical-slice/data-model.md); mã lỗi và luật liên file: [contracts/project-format.md](../specs/002-vertical-slice/contracts/project-format.md).

`protocol-version.json`: phiên bản giao thức live và định dạng project mà runtime hiện tại hỗ trợ.

Đổi schema: tăng phiên bản theo ADR-004, cập nhật cả hai bộ kiểm tra và `tests/project-vectors/`.
