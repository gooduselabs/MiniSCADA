# Vector project của feature 015 (`reports.json` định dạng 1.1, `E_RPT_KIND`)

Sinh bởi `tests/project-vectors/generate.mjs` (mã ca ở `v11-reports.mjs`, hàm `reportCases`, gọi trong `cases11`); tên `v11-report-*`, cùng bộ chạy với `v11-*`: `packages/project-schema/src/vectors-11.test.ts` (TS), `core/project-manager/tests/vectors_11_test.cpp` (C++). Hợp đồng và thứ tự luật: [specs/015-reports/plan.md](../../specs/015-reports/plan.md) mục Hợp đồng.

- Schema (gốc `schemas/reports.schema.json`): `org`, `kind`, `period` `week`/`range`, `tiles`, `chart`, hàm `onTime`/`starts`; mẫu cần `group` + `columns` trừ khi `kind` là `alarm`/`logic` (`anyOf`, thiếu là `E_SCHEMA`).
- Luật (`rules-010.ts`, `rules_010.cpp`): khóa 1.1 ở project 1.0 (`/org`, `p/kind`, `p/period`, `p/tiles`, `p/chart`, `p/columns/j/functions/k`); `alarm`/`logic` có `group`/`columns`; `equipment` với Tag biết kiểu khác BOOL (`p/columns/j/tagId`) hoặc hàm khác `onTime`/`starts`; `starts` ở mẫu bảng: `E_RPT_KIND`. `onTime` trên Tag số ở mẫu bảng: `E_RPT_FN`. Mẫu `alarm`/`logic` bỏ qua luật nhóm, Tag, giới hạn; luật kỳ của 010 vẫn chạy.
