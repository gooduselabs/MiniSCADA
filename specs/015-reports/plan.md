# Implementation Plan: Báo cáo đẹp, trình thiết kế báo cáo, báo cáo alarm/thiết bị/logic

**Branch**: `015-reports` | **Date**: 2026-10-20 | **Spec**: [spec.md](spec.md)

## Summary

Mở rộng `ReportTable` (history-math) thành mô hình báo cáo chung (thẻ, biểu đồ, bảng phụ, cột chữ); thêm bộ dựng `alarmReport`, `equipmentReport`, `logicReport` và kỳ `week`, `range`, hàm `onTime`. Một thành phần `<mat-report-view>` (ui-components) dựng trang web và xem trước Studio; PDF/XLSX/CSV đọc cùng mô hình. `reports.json` 1.1 thêm khóa tùy chọn, luật `E_RPT_KIND` ở TS và C++. Studio thay editor form bằng trình thiết kế ba vùng. Runtime thêm `GET /api/v1/logic/events` (đọc audit `logic.write*` cho trang).

## Technical Context

- **Ngôn ngữ:** TypeScript + Lit 3 (runtime-web, Studio, `packages/*`), C++17 (`core/project-manager`, `server/http`, `core/auth`), JSON Schema draft-07.
- **Thư viện:** không thêm. ECharts 6.1.0 (lite, nạp lười) cho biểu đồ web; ECharts SSR SVG + pdfmake 0.3.11 cho PDF; `fflate` cho XLSX.
- **Test:** Vitest, e2e Chrome (puppeteer-core + axe), gtest/ctest (điều phối chạy), vector `tests/project-vectors/v11-report-*`.
- **Ràng buộc:** gói khởi động ≤ 244 KB gzip; PDF ≤ 1.171,9 KB, XLSX ≤ 58,6 KB gzip (ADR-033); BL335 không tốn CPU cho dựng báo cáo (chỉ truy vấn có sẵn và một truy vấn audit có chỉ mục).

## Constitution Check

| Nguyên tắc | Đánh giá |
|---|---|
| II Dùng chung | Phép tính trong `history-math`, dựng trong `ui-components`, xuất trong `report-export`; luật `E_RPT_KIND` hai bản, vector chung |
| III Ngân sách | Dựng trên trình duyệt; endpoint logic đọc audit theo chỉ mục `ts` (≤ 200 dòng/trang); số lần bật đọc dòng thô có trần 10.000 |
| V An toàn | Chuỗi người dùng qua `textContent`/binding Lit; ECharts không nhận HTML; endpoint mới chỉ đọc, kiểm quyền 013 ở máy chủ |
| VI Test trước | Vitest/vector/gtest viết trước mỗi phần |
| VII Tương thích | Khóa mới tùy chọn ở dòng 1.x, 1.0 dùng khóa mới là lỗi; mẫu 010 hiển thị đẹp hơn mà không đổi tệp |

## Quyết định (tự chốt)

1. **Một mô hình**: mở rộng `ReportTable` thay vì mô hình mới, để giữ SC-016 (mọi định dạng từ một bảng) và test 010.
2. **Mẫu loại**: `kind` trong cùng `reports.json` (tài nguyên `report:<id>` của 013 dùng được ngay).
3. **Thời gian ON** = tích phân BOOL của tổng hợp (cùng `sum`, đơn vị giờ); **số lần bật** đếm cạnh lên trên dòng thô (tổng hợp không giữ số chuyển trạng thái). Không thêm aggregate C++.
4. **Nhật ký logic**: endpoint đọc riêng thay vì mở `/api/v1/audit` (chỉ administrator, Bearer) cho trang: chỉ `logic.write*`, cookie được phép, cần `page:reports`.
5. **Xem trước Studio** dùng `<mat-report-view>` và nguồn mô phỏng có sẵn; với alarm, logic dùng bộ sinh sự kiện mô phỏng tất định.
6. **Logo**: hoãn (spec Assumptions).

## Hợp đồng

### `reports.json` 1.1 (chỉ thêm; `schemas/reports.schema.json` gốc, `schemas/1.0/` đóng băng)

| Khóa | Ở đâu | Kiểu | Mặc định |
|---|---|---|---|
| `org` | gốc | string ≤ 80 | `projectName` |
| `kind` | mẫu | `table` \| `alarm` \| `equipment` \| `logic` | `table` |
| `period` | mẫu | thêm `week` (ISO, 7 hàng ngày), `range` (≤ 31 ngày, hàng ngày) | |
| `tiles` | mẫu | bool | `true` |
| `chart` | mẫu | `line` \| `bar` \| `none` | tự chọn |
| `functions[]` | cột | thêm `onTime`, `starts` | |

`required` của mẫu: `id`, `name`, `period`; `anyOf`: (`group` và `columns`) hoặc `kind` ∈ {`alarm`, `logic`}.

**Luật `E_RPT_KIND`** (cùng thứ tự ở TS `rules-010.ts`, C++ `rules_010.cpp`; mỗi mẫu `p = /reports/i`, trước luật 010):

1. Project không phải 1.1: `org` → `/org` (một lần); với mỗi mẫu: `kind` → `p/kind`; `period` `week`/`range` → `p/period`; `tiles` → `p/tiles`; `chart` → `p/chart`; hàm `onTime`/`starts` → `p/columns/j/functions/k`.
2. `kind` `alarm`/`logic`: có `group` → `p/group`; có `columns` → `p/columns`; bỏ qua luật nhóm, Tag, hàm, giới hạn cột (luật kỳ 010 vẫn chạy).
3. `kind` `equipment`: hàm khác `onTime`/`starts` → `p/columns/j/functions/k`; Tag biết kiểu, không phải BOOL → `p/columns/j/tagId`.
4. `kind` `table`: hàm `starts` → `p/columns/j/functions/k`; `onTime` trên Tag biết kiểu không phải BOOL → `E_RPT_FN` cùng đường dẫn.

### `ReportTable` mở rộng

`kind`, `org`, `rowHeader`, `tiles[] { label, value, text, unit, color }`, `chart { kind, title, unit, decimals, categories[], series[{ name, values[] }] } | null`, `sections[] { title, columns[{ label, numeric }], rows: string[][], values? }`, `notes[]`; cột `plain` (cột chữ). Không có `tiles`/`chart` thì bộ xuất dựng như 012.

### `GET /api/v1/logic/events?from&to[&before][&limit]`

Phiên (Bearer hoặc cookie), viewer, HTTPS; người dùng bị giới hạn cần `page:reports` (403 `ACCESS_DENIED`). `from < to` (UTC ms, ≤ 366 ngày), `limit` 1…200 (mặc định 100). Trả `{ enabled, events: [{ id, ts, rule, action, tag, result, code, detail }], next }`, mới nhất trước; `action` ∈ `logic.write` (bỏ `started`), `logic.write.suppressed`, `logic.throttled`; `rule` = phần sau `logic:` của `user`. Không có logic: `{ enabled: false, events: [], next: null }`. Không ghi `audit.read`.

## Project Structure (tệp chạm)

```text
schemas/reports.schema.json, schemas/error-codes.json
packages/project-schema/src/{reports,rules-010,rules-03,codes}.ts
packages/history-math/src/{report,events}.ts (+ test), tests/report-vectors
packages/report-export/src/{pdf/pdf,pdf/chart,xlsx/xlsx,csv/csv,types}.ts
packages/ui-components/src/report/report-view.ts (mới)
packages/access-model/src/catalog.ts (mẫu không có cột)
apps/runtime-web/src/report-page.ts, report-sources.ts (mới), i18n
apps/studio/src/ui/editors/templates-editor.ts (+css), model/reports-doc.ts, report-presets.ts (mới), report-preview.ts
core/project-manager/{rules_010.cpp,hpp, rules_03.cpp}, error codes
server/http/{logic_api.cpp, engineering_api.*}, core/auth/roles.cpp (+ tests)
tests/project-vectors/v11-reports.mjs (mới), projects/report-demo (mới)
```

## Việc C++ cần điều phối chạy ctest

`core/project-manager` (luật `E_RPT_KIND`, `rules_010` không còn giả định có `group`/`columns`), `core/auth/roles.cpp` (dòng bảng mới), `server/http/logic_api.cpp` (endpoint), gtest mới; vector `v11-report-*` chạy qua `vectors_11_test`.
