# Tasks: Recipe và logo báo cáo (024)

Đầu vào: [spec.md](spec.md), [plan.md](plan.md). Test viết trước (Constitution VI).

## Phase 1: Định dạng và luật

- [x] T001 Schema `schemas/recipes.schema.json`, `project.schema.json` (`recipesFile`), `reports.schema.json` (`logo`); mã `E_RECIPE_*`, `E_RPT_LOGO` (`schemas/error-codes.json`, `codes.ts`, `docs/user/error-codes.md`)
- [x] T002 Vector `tests/project-vectors/v11-recipes.mjs` (`v11-recipe-*`, `v11-report-logo-*`) + `README-024.md`
- [x] T003 TS `recipes.ts`, `rules-recipes.ts`, nối `validate.ts`, `project-files.ts`, `rules-02.ts`; logo trong `rules-010.ts`; vector TS xanh
- [x] T004 C++ `rules_recipes.{hpp,cpp}`, `project_validator.cpp` (nạp `recipesFile`, logo); `vectors_11_test` xanh

## Phase 2: Runtime C++

- [x] T010 gtest `core/recipe/tests`: kiểm giá trị, ghi tuần tự, lỗi giữa chừng, hết giờ, store `rev`/nguyên tử
- [x] T011 `core/recipe` cho xanh
- [x] T012 gtest `server/tests/recipes_api_test.cpp` (quyền, CSRF qua cổng, `rev`, audit, busy) + `roles_test`
- [x] T013 `server/http/recipes_api.cpp`, `server/recipe_service.*`, `roles.cpp`, `audit_actions.hpp`, nối `main.cpp`

## Phase 3: Trang vận hành

- [x] T020 Vitest trang `#/recipes` (bảng, so sánh, xác nhận, kết quả, quyền)
- [x] T021 `apps/runtime-web/src/recipe/*`, mục menu, i18n
- [x] T022 e2e `apps/runtime-web/tests/e2e/recipes.e2e.mjs` + runtime giả (axe sáng/tối)

## Phase 4: Studio

- [x] T030 Vitest `recipes-doc.test.ts` (thêm/xóa loại, tham số, bản, CSV vào/ra, hoàn tác)
- [x] T031 `recipes-doc.ts`, editor bảng `recipes-editor.ts`, cây project, kéo Tag
- [x] T032 e2e Studio `recipes.e2e.mjs` (+ axe)

## Phase 5: Logo báo cáo (T090 của 015)

- [x] T040 Test `report-export` (PDF có ảnh, XLSX có drawing + media), trang báo cáo (ảnh trên dải tiêu đề)
- [x] T041 Cài `report-export`, `report-page.ts`; Studio Thuộc tính báo cáo chọn logo

## Phase 6: Tích hợp, tài liệu, kiểm cuối

- [ ] T050 Tích hợp với giả lập Modbus (ghi thật qua driver): `tests/web-it`
- [x] T051 Project mẫu có recipe; tài liệu engineer-guide, operator-guide, ảnh `tools/docs-screenshots.mjs`; ADR-052 + README ADR
- [x] T052 Kiểm cuối: lint, typecheck, `npm test`, ctest toàn bộ, armhf qemu, build runtime-web (ngân sách), e2e, clang-format, docs-check, `gen-error-codes.test.mjs`
  - Ghi chú (2026-10-25): Studio bỏ qua ca vector `v11-report-logo-png-too-large` (Studio chỉ đọc tệp văn bản, không biết kích thước PNG; CLI và C++ kiểm). Xem trước logo ở Studio chỉ với SVG. Tích hợp ghi thật qua giả lập Modbus (T050): gtest `recipes_api_test` dùng coordinator thật với driver giả; chưa thêm kịch bản web-it.
