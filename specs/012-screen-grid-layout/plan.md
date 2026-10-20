# Implementation Plan: Bố cục màn hình theo hàng và cột, giao diện sáng đa sắc

**Branch**: `012-screen-grid-layout` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/012-screen-grid-layout/spec.md`; kế hoạch gốc [docs/plans/screen-grid-layout.md](../../docs/plans/screen-grid-layout.md) mục 3, 5, 9, 11.

## Summary

Thêm bố cục **Lưới 12 cột** cho màn hình và popup (định dạng project **1.1.0**, cộng thêm): màn hình có `layout` gồm hàng → ô, ô **tham chiếu** item theo `id`, `items[]` phẳng giữ nguyên nên binding, đổi tên, so sánh, Đọc lên không phải viết lại. Hai bộ kiểm (TypeScript `packages/project-schema`, C++ `core/project-manager`) cài cùng luật `E_LAYOUT_*` trên vector chung. Trang vận hành và xem trước Studio hiển thị bằng phần tử mới `mat-grid-screen` (CSS Grid, cuộn dọc, xếp chồng dưới 768 px). Studio có trình soạn lưới riêng `mat-grid-editor` (không sửa canvas tự do). Song song: bộ token màu **Sáng đa sắc** (nguồn Radix Colors, ghi giá trị vào CSS, không phụ thuộc lúc chạy), chủ đề chọn được, phông Inter tự chứa, biểu đồ cột/tròn/đồng hồ vẽ bằng **Apache ECharts** nạp lười (chốt sau spike R2), xu hướng giữ **uPlot** với giao diện mới, báo cáo PDF mẫu mới có biểu đồ SVG.

## Technical Context

**Language/Version**: TypeScript 7 (ESM, Lit 3.3.3) cho Studio, trang vận hành, packages; C++20 cho validator runtime; Rust (Tauri 2) không đổi.

**Primary Dependencies**: hiện có: `lit` 3.3.3, `uplot` 1.6.32, `pdfmake` 0.3.11, `fflate` 0.8.3, `@fluentui/svg-icons`. Mới (chốt ở [research.md](research.md)): `echarts` 6.1.0 (Apache-2.0, nhập theo mô-đun, nạp lười), `@fontsource-variable/inter` 5.3.0 (OFL-1.1, tệp woff2 trong gói), `@radix-ui/colors` 3.0.0 (MIT, **chỉ lúc thiết kế**: sinh giá trị token, không vào bundle).

**Storage**: tệp project JSON (`screens/*.screen.json` thêm `layout`; `project.json` thêm `theme`); không đổi DB.

**Testing**: Vitest 5 (jsdom) cho TS; GoogleTest cho validator C++ (`core/project-manager/tests/vectors_11_test.cpp`); vector chung `tests/project-vectors/v11-*` sinh bằng `generate.mjs`; axe-core; ảnh chụp `tools/docs-screenshots.mjs`; đo bundle bằng Vite.

**Target Platform**: Studio trên Windows 10/11 (WebView2); trang vận hành trên Chrome/Edge hiện hành, tải từ BL335 (armhf) qua LAN.

**Project Type**: monorepo (desktop app + web app + thư viện TS + runtime C++).

**Performance Goals**: màn hình lưới 12 widget, 500 Tag, 10 client, 1 Hz: CPU runtime không tăng so với màn hình tự do; CPU trình duyệt ≤ 30 %; xu hướng 50.000 điểm mượt.

**Constraints**: offline (không CDN); JS tải lần đầu trang vận hành tăng ≤ 400 KB gzip (SC-006); biểu đồ nạp lười; tương phản ≥ 4,5:1; `prefers-reduced-motion`; CSP `script-src 'self'`; giấy phép qua `tools/release/license-report.mjs`.

**Scale/Scope**: tối đa 100 hàng × 12 ô mỗi màn hình; 64 màn hình mỗi project (giới hạn hiện có); 21 loại widget.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc (Constitution 2.0.2) | Đánh giá |
|---|---|
| I. Phạm vi theo lộ trình | Đạt: tính năng do người dùng yêu cầu và duyệt (kế hoạch 2026-10-19). |
| II. Một nguồn sự thật, chia sẻ package | Đạt: schema, luật, token, widget ở `packages/*`; Studio và trang vận hành dùng chung `mat-grid-screen`; luật TS và C++ đối chiếu bằng vector chung. |
| III. Ngân sách BL335 | Đạt có đo: bố cục chạy ở trình duyệt; runtime chỉ thêm kiểm schema; gói `web/` lớn hơn (ECharts, phông) đo ở spike và lúc đóng gói; live hub không đổi. |
| IV. Giao thức và định dạng theo SemVer | Đạt: 1.1.0 cộng thêm, có bước nâng cấp, runtime cũ bị cổng phiên bản chặn. |
| V. An toàn mặc định | Đạt: không API mới; quyền ghi, xác nhận, audit không đổi; thư viện offline, qua cổng giấy phép. |
| VI. Test trước | Đạt: mỗi task có test đỏ trước (vector, đơn vị, DOM). |
| VII. Đơn giản | Đạt: không lưới lồng, một item mỗi ô, 12 cột cố định; giữ Lit thay vì đổi bộ thành phần. |

Không có vi phạm.

## Project Structure

### Documentation (this feature)

```text
specs/012-screen-grid-layout/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── project-format-1.1.md      # layout, theme, luật E_LAYOUT_*, nâng cấp lên 1.1
│   └── ui-theme.md                # token, chủ đề, bảng màu biểu đồ, API widget không đổi
└── tasks.md                       # /speckit-tasks
```

### Source Code (repository root)

```text
schemas/screen.schema.json, project.schema.json  # dòng 1.x ở thư mục gốc: thêm layout, theme (MINOR)
schemas/screen.schema.json         # bản hiện hành = 1.1
schemas/error-codes.json           # E_LAYOUT_*, W_LAYOUT_ITEM_ORPHAN
packages/project-schema/src/
├── types-11.ts                    # Layout, Row, Cell, Theme
├── rules-11.ts                    # luật bố cục (cùng nội dung với C++)
├── layout.ts                      # hàm thuần: duyệt ô, item mồ côi, chèn/xóa/đổi span
├── migrate.ts                     # migrateTo11 (bumpFormat), SUPPORTED_SCHEMA_11
└── codes.ts
core/project-manager/
├── rules_11.cpp/.hpp              # luật bố cục C++
├── project_validator.cpp          # set 11
└── tests/vectors_11_test.cpp
tests/project-vectors/v11.mjs      # ca vector 1.1
packages/ui-components/src/
├── screen/mat-grid-screen.ts      # hiển thị lưới (trang vận hành + xem trước Studio)
├── styles/themes/*.css            # vivid, industrial, dark
├── chart/echarts-lite.ts          # nhập mô-đun ECharts, nạp lười
└── widgets/{bar,pie,gauge,card}.ts# vẽ lại
packages/report-export/src/pdf/    # mẫu PDF mới, phông Inter, biểu đồ SVG
apps/runtime-web/src/main.ts       # chọn mat-screen hay mat-grid-screen theo layout
apps/studio/src/
├── ui/screen/mat-grid-editor.ts   # trình soạn lưới
├── ui/editors/screen-editor.ts    # chọn canvas tự do hay mat-grid-editor
├── model/grid-ops.ts              # thao tác thuần → ProjectEdit (một bước hoàn tác)
├── model/screen-ops.ts            # newScreen nhận bố cục, mặc định lưới
├── model/grid-convert.ts          # chuyển tự do → lưới (US5)
└── app/store.ts                   # nâng cấp lên 1.1
```

**Structure Decision**: giữ cấu trúc monorepo hiện có; mỗi lớp thêm tệp mới cạnh tệp cùng loại (`types-11`, `rules-11`, `rules_11.cpp`, `v11.mjs`), không viết lại `mat-screen` hay `mat-screen-canvas`.

## Thứ tự làm (ánh xạ GĐ của kế hoạch)

1. **Nền định dạng 1.1** (chặn US1, US2): schema, kiểu, `layout.ts`, luật TS và C++, vector, nâng cấp, cổng phiên bản.
2. **Hiển thị** `mat-grid-screen` và trang vận hành (US2).
3. **Trình soạn lưới** Studio (US1).
4. **Các luồng cũ** biết lưới (FR-014): đổi tên, so sánh, nhân bản, template, điều hướng.
5. **Giao diện** (US3, song song từ bước 1): spike R2, token và chủ đề, biểu đồ, card.
6. **Báo cáo** (US4).
7. **Chuyển đổi** tự do → lưới (US5).
8. Tài liệu, ảnh chụp, đo hiệu năng, `ci-local`.

## Complexity Tracking

Không có vi phạm cần biện minh.

## Constitution Check sau Phase 1

Thiết kế ở [data-model.md](data-model.md) và [contracts/](contracts/) giữ nguyên đánh giá trên: một package chung cho schema và hiển thị, không API mạng mới, định dạng cộng thêm có nâng cấp, thư viện mới nạp lười và đo trong ngân sách.
