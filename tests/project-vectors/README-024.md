# Vector project của feature 024 (recipe, logo báo cáo)

Sinh bởi `tests/project-vectors/generate.mjs` (mã ca ở `v11-recipes.mjs`, hàm `recipeCases`, gọi trong `cases11`); tên `v11-recipe-*` và `v11-report-logo-*`, cùng bộ chạy với `v11-*`: `packages/project-schema/src/vectors-11.test.ts` (TS), `core/project-manager/tests/vectors_11_test.cpp` (C++). Hợp đồng và thứ tự luật: [specs/024-recipes/plan.md](../../specs/024-recipes/plan.md) mục Hợp đồng.

- Schema `schemas/recipes.schema.json` (khai bởi `recipesFile` của `project.json`): thiếu tham số, khóa lạ, `security.operate` là `viewer`: `E_SCHEMA`. `reports.json` `logo` ngoài mẫu `graphics/*.svg|png`: `E_SCHEMA`.
- `E_RECIPE_VERSION` (`project.json` `/recipesFile` ở project 1.0; tệp không đọc), `E_SCHEMA_VERSION` (`recipes.json` khác phiên bản project).
- `E_RECIPE_DUP_ID` (loại, Tag tham số, bản), `E_RECIPE_TAG`, `E_RECIPE_TAG_RW` (Tag chỉ đọc, tính toán), `E_RECIPE_LIMIT` (min > max, min/max trên Tag BOOL/STRING, giá trị ngoài giới hạn tham số hoặc `limits` của Tag), `E_RECIPE_VALUE` (thiếu, thừa, sai kiểu, số lẻ cho Tag nguyên).
- `E_RPT_LOGO` (`reports.json` `/logo`): tệp không có, lớn hơn 256 KiB (SVG và PNG), logo ở project 1.0. Logo hợp lệ thuộc tập file (`files`) của project. Nội dung SVG (allowlist) chỉ bản TS kiểm, như widget `image`; vector chạy `checkSvg: false`.
