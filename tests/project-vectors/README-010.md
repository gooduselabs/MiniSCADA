# Vector project của feature 010 (lưu trữ nâng cao, báo cáo)

Sinh bởi `tests/project-vectors/generate.mjs` (mã ca ở `v06.mjs`). Cấu trúc thư mục và `expected.json` như mọi vector khác (`valid`, `errors`, `warnings`, `issues`, và với ca hợp lệ `files`, `digest`). Spec: [contracts/logging-config-0.2.md](../../specs/010-history-reports/contracts/logging-config-0.2.md) §6, [contracts/templates-config.md](../../specs/010-history-reports/contracts/templates-config.md) §3.

## Quyết định về phiên bản (T008)

Bộ kiểm tra bắt **mọi file của project cùng một `schemaVersion`** (`E_SCHEMA_VERSION`), nên "logging 0.2.0" và "reports 0.1.0" của contract không đứng riêng được. Ở định dạng project **0.6.0**: `project.json`, `tags.json`, `logging.json`, `reports.json`, màn hình, binding, bảng... đều mang `schemaVersion` `0.6.x`; `minRuntimeVersion` tối thiểu `0.9.0` (`E_MIN_RUNTIME` nếu thấp hơn). Hai nhánh `0.1.x`/`0.2.x` của contract thành: định dạng project 0.1, 0.2, 0.3 giữ schema cũ (trường mới của 010 trong đó là `E_SCHEMA`); 0.6 có đủ trường mới.

## Tên ca

| Tiền tố | Định dạng | Nội dung |
|---|---|---|
| `v06-logging-010-*` | 0.6.0 | `logging.json`: trigger, kết hợp, tổng hợp, ước tính ghi, cảnh báo |
| `v06-report-*` | 0.6.0 | `reports.json`, `reportsFile`, `navigation[].report` |
| `v06-valid-full`, `v06-invalid-*` | 0.6.0 | khung 0.6: phiên bản, runtime, file lệch phiên bản |
| `logging-010-valid-v01-unchanged`, `logging-010-invalid-v01-new-field` | 0.1.0 | logging 0.1 giữ kết luận; `trigger` trong 0.1 bị `E_SCHEMA` |

(Khác contract: tiền tố `v06-` để bộ test 0.1 của TS và C++ không nhặt nhầm; hai ca 0.1 không có tiền tố.)

Project nền `base06()`: như `base03()` (màn hình, bảng giá trị, bảng theo dõi) với phiên bản 0.6.0. Tag dùng trong ca: `TANK01.LEVEL` (FLOAT32), `PUMP01.RUN_CMD` và `PUMP01.FAULT` (BOOL), `PUMP01.NAME` (STRING), `METER1.P` (FLOAT32), `TANK01.SP` (FLOAT32 RW).

## `estimate` (ca `…-estimate-*`)

`expected.estimate` có `writeBytesPerDay`, `rawWriteBytesPerDay`, `aggWriteBytesPerDay`, `storageBytes`, `dailyGrowthBytes`, `daysToFillCap` và `groups[]` (mỗi nhóm: `rowsPerDay`, `basis`, `rowBytes`, `rawWrite`, `aggWrite`, `rawStorage`, `aggStorage`, `aggTags`). Số **ghi thẳng** (không tính bằng công thức), so sai lệch tuyệt đối ≤ 1 byte. `v06-logging-010-warn-size-cap-agg` cũng có `estimate`. Nhóm 200 Tag có Tag `E.T0001…E.T0200` (FLOAT32 nội bộ).

## Vị trí lỗi (`issues`)

| Ca | Mã | `path` trong `logging.json` |
|---|---|---|
| `invalid-trigger-string` | `E_LOG_TRIGGER` | `/groups/0/trigger/tagId` |
| `invalid-trigger-missing` | `E_LOG_TRIGGER` | `/groups/0` |
| `invalid-trigger-on-cyclic`, `-on-onchange` | `E_LOG_TRIGGER` | `/groups/0/trigger` |
| `invalid-trigger-active-no-period` | `E_LOG_TRIGGER` | `/groups/0` |
| `invalid-trigger-period-with-rising` | `E_LOG_TRIGGER` | `/groups/0/periodMs` |
| `invalid-trigger-threshold-bool` | `E_LOG_TRIGGER` | `/groups/0/trigger/threshold` |
| `invalid-trigger-max-interval` | `E_LOG_TRIGGER` | `/groups/0/maxIntervalMs` |
| `invalid-expected-cyclic` | `E_LOG_TRIGGER` | `/groups/0/expectedRowsPerDay` |
| `invalid-trigger-ref-tag` | `E_LOG_REF_TAG` | `/groups/0/trigger/tagId` |
| `invalid-agg-no-numeric`, `-all-excluded`, `-retention` | `E_LOG_AGG` | `/groups/0/aggregates` |
| `invalid-agg-string-tag` | `E_LOG_AGG` | `/groups/0/tags/1/aggregate` |

Ca báo cáo: `E_RPT_*` ghi `file: reports.json` và `path` theo contract (`/reports/i/...`); `E_NAV_REPORT` ghi `file: project.json`, `/navigation/items/i/report`. Quy ước cũ giữ: `E_SCHEMA`, `E_JSON`, `E_FILE_MISSING` không ghi `path`.

## Luật cần biết (hai bản cùng làm)

- Chế độ `trigger` không dùng `E_LOG_MODE`: mọi sai trường của nhóm trigger là `E_LOG_TRIGGER`. `minIntervalMs` hợp lệ; `maxIntervalMs` và `expectedRowsPerDay` với `cyclic` là `E_LOG_TRIGGER`.
- Schema **không** ép `edge` ↔ `periodMs`, `count` ca, `start` ca, số cột (Tag × hàm) hay tổng số Tag của báo cáo: các luật đó có mã riêng (`E_LOG_TRIGGER`, `E_RPT_SHIFT`, `E_RPT_LIMIT`). Schema ép: `edge` ∈ {rising, falling, both, active}, `threshold` số, `expectedRowsPerDay` 1…864.000.000, `aggregates.*RetentionDays` (phút 1…365, giờ 1…3650), `aggregate` bool, `reports` 1…16, `id` mẫu, `period`, tên hàm, `decimals` 0…6, `paper`.
- `reports.json` có `schemaVersion` bằng `project.json` (0.6.x); mục `navigation` có đúng một trong `screen` / `report` / `items` (cả hai hoặc không có gì: `E_SCHEMA`).
- Tập file của project (`files`, `digest`) thêm `reportsFile` khi có.
- `E_RUNTIME_TOO_OLD` của ca 0.3 cũ đổi `minRuntimeVersion` từ 0.7.0 sang 0.10.0 vì runtime là 0.9.0.
