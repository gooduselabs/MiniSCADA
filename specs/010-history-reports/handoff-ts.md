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

## Vector khác (đã có)

| Thư mục | Ghi chú |
|---|---|
| `tests/downsample-vectors/` | 34 ca minmax, lttb, decimate, merge; README chốt các chỗ contract chưa rõ |
| `tests/widget-catalog-vectors/` | 128 ca `history-*`, `valid-history-*`: thư mục ca có `project.json` (0.6.0) và `logging.json`; harness dùng `project.json` có sẵn (README) |
| `tests/report-vectors/` | chủ yếu TS (`report-*`, `period-*`, `bar-*`, `pie-*`) |
| `tests/migration-vectors/*-0.3to0.6/` | chỉ TS (`migrate03to06`) |

## Luật TS đã chốt mà C++ cần khớp

- `checkProps` (rules-03): không báo thêm "nhiều nhãn hơn Tag" khi `labels` đã sai ở kiểm giá trị (tránh hai lỗi cùng mã và đường dẫn).
- `historyWidgetRules` (`rules-010.ts`): thiếu `group` là `E_WIDGET_HISTORY_GROUP` ở `/items/i/props`; nhóm không tra được thì bỏ qua kiểm Tag; Tag không có trong `tags.json` chỉ `E_REF_TAG`; Tag sai lớp kiểu chỉ `E_WIDGET_TAG_TYPE`; Tag ngoài nhóm chỉ `E_WIDGET_HISTORY_TAG` (không thêm `_AGG`); `_AGG` chỉ ở `history-bar`, `history-pie` (nhóm không có `aggregates` hoặc `aggregate:false`). Tổ hợp `bucket`/`period` sai và `shiftCount` ngoài {2,3,4,6,8,12} là `E_WIDGET_PROP` (`/props/period`, `/props/shiftCount`).
- Widget lịch sử không vào tập Tag của màn hình (`screenTagIds`).
- `W_LOG_WRITE_EXTREME` chỉ ở định dạng 0.6 (0.1-0.3 giữ tập cảnh báo cũ).
- `reportRules` (`rules-010.ts`): thứ tự và vị trí ở `tests/project-vectors/README-010.md`; `reports.json` cùng `schemaVersion` với project; mục `navigation` có `report` không có trong `reports.json` (hoặc không có `reportsFile`) là `E_NAV_REPORT`, bỏ qua khi `reports.json` lỗi.
