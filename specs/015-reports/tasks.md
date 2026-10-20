# Tasks: Báo cáo đẹp, trình thiết kế báo cáo, báo cáo alarm/thiết bị/logic (015)

Đầu vào: [spec.md](spec.md), [plan.md](plan.md). Test viết trước (Constitution VI): task cài đặt đi sau task test của nó.

## Phase 1: Định dạng và luật (nền)

- [ ] T001 Schema `schemas/reports.schema.json` 1.1: `org`, `kind`, `week`/`range`, `tiles`, `chart`, `onTime`/`starts`, `anyOf` group+columns; mã `E_RPT_KIND` (`schemas/error-codes.json`, `codes.ts`, `docs/user/error-codes.md`)
- [ ] T002 [P] Vector `tests/project-vectors/v11-reports.mjs` (`v11-report-*`, ≥ 16 ca, kết quả viết tay) + `README-015.md`
- [ ] T003 TS `packages/project-schema/src/{reports,rules-010,rules-03}.ts`: luật `E_RPT_KIND`, `E_RPT_FN` cho `onTime`; vector TS xanh
- [ ] T004 C++ `core/project-manager/rules_010.{hpp,cpp}`, `rules_03.cpp`: cùng luật, không đọc `group`/`columns` vắng (cần ctest: điều phối)
- [ ] T005 [P] `packages/access-model/src/catalog.ts`: mẫu không có `columns` (test)

## Phase 2: Phép tính chung (US1, US3, US4, US5)

- [ ] T010 Test `history-math/report.test.ts`: kỳ `week`, `range`, hàm `onTime`, `tiles`/`chart` theo mẫu
- [ ] T011 `history-math/report.ts` cho xanh; `ReportTable` mở rộng (`types`)
- [ ] T012 Test `history-math/events.test.ts`: `alarmReport` (đếm, top 10, trung bình tới xác nhận, sự kiện), `equipmentReport` (giờ chạy, số lần bật, trần dòng thô), `logicReport`
- [ ] T013 `history-math/events.ts` cho xanh

## Phase 3: Dựng và xuất (US1)

- [ ] T020 Test `ui-components/report/report-view.test.ts` (thẻ, khung biểu đồ, bảng sọc, hàng tổng, bảng phụ, chữ an toàn)
- [ ] T021 `<mat-report-view>` cho xanh
- [ ] T022 Test `report-export` (PDF thẻ đặc, bảng phụ, cột chữ; XLSX sọc, tổng đậm, bảng phụ; CSV bảng phụ)
- [ ] T023 `report-export` cho xanh
- [ ] T024 Trang `apps/runtime-web/src/report-page.ts`: dùng `<mat-report-view>`, kỳ tuần/khoảng, loại alarm/thiết bị/logic (`report-sources.ts`), test Vitest
- [ ] T025 e2e `apps/runtime-web/tests/e2e/reports.e2e.mjs` mở rộng (thẻ, biểu đồ, alarm, thiết bị, logic, axe sáng/tối); runtime giả có `logic/events`

## Phase 4: Studio (US2)

- [ ] T030 Test `reports-doc.test.ts`: `setKind`, `setTiles`, `setChart`, `addReportFromPreset`, phiên bản `reports.json` theo project, hàm theo loại
- [ ] T031 `reports-doc.ts`, `report-presets.ts` cho xanh
- [ ] T032 Editor ba vùng `templates-editor.ts` (+css): Cấu trúc, Xem trước trực tiếp (`<mat-report-view>` + nguồn mô phỏng, alarm/logic mô phỏng), Thuộc tính; kéo Tag; test Vitest
- [ ] T033 Lệnh "Thêm báo cáo" (từ mẫu) ở cây project; e2e Studio + axe

## Phase 5: Runtime C++ (US5)

- [ ] T040 gtest `server/tests/logic_events_api_test.cpp`, `roles_test.cpp` (dòng mới) (đỏ)
- [ ] T041 `GET /api/v1/logic/events` (`core/auth/roles.cpp`, `server/http/logic_api.cpp`, `engineering_api.*`) cho xanh — cần ctest: điều phối

## Phase 6: Mẫu, tài liệu, kiểm cuối

- [ ] T050 Project mẫu `projects/report-demo` (1.1: ca, ngày, tháng, năng lượng, alarm, thiết bị, logic); `validate:project`
- [ ] T051 Tài liệu `engineer-guide.md`, `operator-guide.md`; ảnh `tools/docs-screenshots.mjs` (web, PDF trang đầu, Studio)
- [ ] T052 Kiểm cuối: lint, typecheck, test, build runtime-web (ngân sách), e2e liên quan

## Mở (ngoài 015)

- [ ] T090 Logo ảnh trên báo cáo (tệp `graphics/*.svg` của project: danh sách tệp, allowlist, kiểm SVG ở TS và C++)
- [ ] T091 Thử tay XLSX/PDF trên Excel và Acrobat (cần người)
