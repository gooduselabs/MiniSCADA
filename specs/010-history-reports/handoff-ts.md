# Ghi chú bàn giao từ agent TS (w5-ts) cho agent C++ (w5)

Cập nhật liên tục; đọc cùng `tasks.md` (ghi chú từng task). Nếu vector sai hoặc khó hiểu: ghi vào `handoff-notes.md` (của bạn), tôi sửa phía TS/vector.

## Vector đã có (đọc bằng nlohmann/json)

| Thư mục | Nội dung | README |
|---|---|---|
| `tests/agg-vectors/` | `merge-*`, `derive-*` (tính tay), `agg-*` (44 ca, sinh bằng `tools/history-ref`) | `README.md` (định dạng sự kiện, quy ước `first`, ca ranh giới) |
| `tests/project-vectors/` | `v06-logging-010-*`, `v06-report-*`, `v06-valid-full`, `v06-invalid-*`, hai ca 0.1 `logging-010-*` | `README-010.md` |

## Phiên bản (T008) và hệ quả cho C++

- Định dạng project **0.6.0**: **mọi file cùng `schemaVersion`** (kể cả `logging.json` và `reports.json`: `0.6.x`), không có "logging 0.2.0" riêng. `minRuntimeVersion` tối thiểu **0.9.0** cho 0.6 (`E_MIN_RUNTIME`).
- `kRuntimeVersion` → `0.9.0` (TS `RUNTIME_VERSION` cũng lên 0.9.0). Vector `v03-invalid-runtime-too-old` đã đổi sang `0.10.0`.
- `schemas/0.3/` sẽ chứa bản đóng băng 0.3 (cả 8 `*.schema.json` và `widgets.catalog.json` 0.3.0); gốc `schemas/` thành 0.6.0 (`$id` `…/0.6.json`), thêm `reports.schema.json`. `protocol-version.json` thêm `"0.6"`.
- `projectFiles()`/`LoadedProject::files()` và digest gói thêm `reportsFile` (vector hợp lệ `v06-report-*` có `reports.json` trong `files`).
- Luật mới: `E_LOG_TRIGGER`, `E_LOG_AGG`, `W_LOG_WRITE_EXTREME`, `E_RPT_*`, `E_NAV_REPORT`, `E_WIDGET_HISTORY_*`. `trigger` không dùng `E_LOG_MODE`. Chi tiết và vị trí lỗi ở `tests/project-vectors/README-010.md`.

## Vector sắp có (cập nhật mục này khi xong)

`tests/downsample-vectors/`, `tests/widget-catalog-vectors/history-*`, `tests/report-vectors/` (chủ yếu TS), `tests/migration-vectors/logging-0.1-0.2/` (chỉ TS).
