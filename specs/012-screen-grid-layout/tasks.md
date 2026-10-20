# Tasks: Bố cục màn hình theo hàng và cột, giao diện sáng đa sắc

**Input**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: bắt buộc (Constitution VI, test viết trước): mỗi task cài đặt đi sau task test của nó; test phải đỏ trước khi viết mã.

Đường dẫn tính từ gốc repo. `[P]` = làm song song được (tệp khác nhau, không phụ thuộc task chưa xong).

## Phase 1: Setup

- [x] T001 Thêm phụ thuộc `echarts@6.1.0` vào `packages/ui-components/package.json`, `@fontsource-variable/inter@5.3.0` và `@radix-ui/colors@3.0.0` (devDependency) vào `packages/ui-components/package.json`; `npm install`; chạy `node tools/release/license-report.mjs` và `node tools/release/sbom.mjs` xác nhận 0 từ chối
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): echarts 6.1.0, @fontsource-variable/inter 5.3.0, @radix-ui/colors 3.0.0 (dev); cổng license nhận `OFL-1.1` (test trước), 0 từ chối.
- [x] T002 [P] Ghi đoạn "Định dạng 1.1 (feature 012)" vào `schemas/README.md`: 1.1 dùng chung bộ schema ở thư mục gốc với 1.0 (MINOR, chỉ thêm trường tùy chọn), `schemas/1.0/` không đổi; `schemas/protocol-version.json` thêm `"1.1"` khi runtime lên 1.1.0 (T015)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): `schemas/README.md` có đoạn "Định dạng 1.1"; `protocol-version.json` thêm "1.1".
- [x] T003 [P] Tạo project mẫu `projects/grid-demo/` (định dạng 1.1.0, chủ đề `vivid`, 2 màn hình lưới: `tong-quan` hàng `4+4+4`, `8+4`, `12`; popup lưới `chi-tiet`; Tag mô phỏng) dùng cho test và ảnh chụp
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): `projects/grid-demo` dựng từ dashboard-demo qua `migrateTo11`, màn hình lưới `bang-dieu-khien` là màn hình đầu, hợp lệ (2 cảnh báo `W_WRITE_NO_LIMITS` có sẵn từ dashboard-demo).

## Phase 2: Foundational (chặn mọi user story)

**Mục tiêu**: định dạng 1.1, luật bố cục ở hai bộ kiểm, hàm thuần dùng chung.

- [x] T004 Viết test `packages/project-schema/src/layout.test.ts`: `cellsOf(screen)`, `itemCell(screen, itemId)`, `orphanItems(screen)`, `rowSpanSum(row)`, `renameItemRef(layout, from, to)`, `removeItemRef(layout, id)` (đỏ)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): 7 ca, đỏ rồi xanh.
- [x] T005 Cài `packages/project-schema/src/layout.ts` và kiểu `packages/project-schema/src/types-11.ts` (`Layout {mode:'grid', columns:12, gap 0..64 mặc định 12, padding 0..64 mặc định 16, rows}`, `Row {id ^[a-z][a-z0-9_-]{0,31}$, height 'auto' | 24..4000, gap?, cells 1..12}`, `Cell {id, span 1..12, offset 0..11 mặc định 0, align start|center|end|stretch mặc định stretch, minHeight 0..4000, item?}`, `ScreenModel11`, `Theme 'vivid'|'industrial'|'dark'`); xuất ở `packages/project-schema/src/index.ts`
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): `layout.ts`, `types-11.ts` (`LooseItem` dùng Omit phân phối trên kiểu hợp).
- [x] T006 Sửa `schemas/screen.schema.json` (thư mục gốc, dòng 1.x): thêm `layout` theo [data-model.md](data-model.md); `x`, `y`, `width`, `height` của `widgetItem`/`svgItem` thành tùy chọn (bắt buộc cho màn hình tự do chuyển sang luật `E_LAYOUT_ITEM_POS`); `schemas/project.schema.json` thêm `theme` enum `vivid|industrial|dark`; `schemas/template.schema.json` không đổi; `schemas/1.0/` không đổi (SHA-256 ở `meta-schema.test.ts`)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Thư mục gốc dòng 1.x; `schemas/1.0/` không đổi.
- [x] T007 Thêm mã `E_LAYOUT_COLUMNS`, `E_LAYOUT_SPAN`, `E_LAYOUT_ID`, `E_LAYOUT_ITEM_REF`, `E_LAYOUT_ITEM_DUP`, `E_LAYOUT_ITEM_POS`, `E_LAYOUT_LIMIT`, `E_LAYOUT_VERSION`, `W_LAYOUT_ITEM_ORPHAN` vào `schemas/error-codes.json` và `packages/project-schema/src/codes.ts`; `SUPPORTED_SCHEMA_11 = /^1\.1\.\d+$/`; tạo lại `docs/user/error-codes.md` bằng công cụ sinh hiện có
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Thêm cả `E_LAYOUT_VERSION`; `SUPPORTED_SCHEMA_10` nới thành họ 1.x, thêm `SUPPORTED_SCHEMA_11`, `MIN_RUNTIME_11`; vector cũ "1.1 bị từ chối" đổi sang 1.2.
- [x] T008 Viết bộ ca vector `tests/project-vectors/v11.mjs` (≥ 40 ca theo [contracts/project-format-1.1.md](contracts/project-format-1.1.md) §5, nền `base11()` = `base10()` đổi 1.1.0 cộng một màn hình lưới và theme), đăng ký trong `tests/project-vectors/generate.mjs`, thêm `tests/project-vectors/README-012.md`; sinh vector
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): 48 ca `v11-*` (README-012.md).
- [x] T009 Viết `packages/project-schema/src/vectors-11.test.ts` chạy mọi `v11-*` (đỏ)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Đỏ 26 ca rồi xanh.
- [x] T010 Cài `packages/project-schema/src/rules-11.ts` (luật §3 của hợp đồng, đường dẫn lỗi đúng hợp đồng) và nối vào bộ kiểm cho set 1.1 (nhận 1.1.x, từ chối 1.2+); màn hình không có `layout` bắt buộc `x`, `y`, `width`, `height`; `vectors-11.test.ts` xanh, `vectors-10.test.ts` vẫn xanh
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Kèm nới bộ kiểm logic.json (TS) cho 1.1; mọi vector 1.0 vẫn xanh.
- [x] T011 Viết `core/project-manager/tests/vectors_11_test.cpp` (đọc cùng thư mục vector, theo mẫu `vectors_10_test.cpp`), thêm vào `CMakeLists.txt` (đỏ)
  - Ghi chú khi làm (2026-10-19, nhánh 012-cpp): 47 ca `v11-*` (so tập mã lỗi, tập cảnh báo, `issues`, danh sách tệp, `is10()`), thêm ca một `E_LAYOUT_SPAN` mỗi hàng và runtime mặc định `1.1.0-alpha.1` chạy project 1.1 (1.0.0 thì `E_RUNTIME_TOO_OLD`). Trước khi cài: đỏ 42/50.
- [x] T012 Cài `core/project-manager/rules_11.cpp`, `rules_11.hpp`; `schemaSetOf` trong `core/project-manager/project_validator.cpp` chọn set 10 cho cả `1.0.` và `1.1.`; gọi luật 11 cho set 10; `vectors_11_test` và `vectors_10_test` xanh (x64, `-j1`)
  - Ghi chú khi làm (2026-10-19, nhánh 012-cpp): `runRules11` chạy sau `rules10.after` (như `validate.ts`). Nới họ 1.x ở C++: `schemaSetOf` (1.1.x → set 10), `LoadedProject::is10()` (1.0. hoặc 1.1.: `tag_model.cpp` dựng Tag logic theo nó), `rules_02.cpp` (`E_SCHEMA_VERSION` nhận 1.1.x khi schema "1.0"), `rules_10.cpp` `kSupported10` và `rules_logic.cpp` `kVersion` thành `^1\.[01]\.\d+$`, `server/main.cpp` `schemaVersions` thêm "1.1" (khớp `schemas/protocol-version.json`). `rules_03.cpp`: tọa độ item thiếu là NaN (như `undefined` ở TS) nên `E_ITEM_SIZE`, `W_ITEM_OUTSIDE`, `W_ITEM_COVERED` bỏ qua item lưới, không còn `get<double>()` trên khóa thiếu. Test cập nhật theo vector đổi tên: `rules_logic_test` (1.2.0 lỗi, 1.1.0 hợp lệ), `logic_vectors_test` 285 ca, `startup_test` (`v02-invalid-schema-version-1.2`), `live_hub_test` (`project` có "1.1"). `usedIn` của `E_LAYOUT_*`, `W_LAYOUT_ITEM_ORPHAN` thêm `core/project-manager`. ctest x64 (Docker, `-j 10`, trừ AlarmStorm chạy riêng) 6048/6049 xanh, ca đỏ `ProjectApi.ADeployWhoseRestartFailsEndsFailedAndFreesTheLock` là lỗi thời gian khi chạy song song (lượt đầy đủ trước xanh, chạy riêng 5/5 xanh).
- [x] T013 Viết test nâng cấp trong `packages/project-schema/src/migrate-11.test.ts`: `migrateTo11` từ 0.1, 0.6, 1.0 (một lần, một sao lưu), `ALREADY_11`, `minRuntimeVersion` 1.1.0 (đỏ); cài `migrateTo11` trong `packages/project-schema/src/migrate.ts` bằng `bumpFormat`
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): `migrateTo11`, `migrate10to11`; `bumpFormat` nhận `fromMajor` và đổi cả logic.json, template.
- [x] T014 Đổi thứ tự khóa ghi tệp trong `packages/project-schema/src/format-03.ts` cho `layout` (`mode, columns, gap, padding, rows`; không ghi `offset: 0`, `align: "stretch"`), test trong `packages/project-schema/src/format-03.test.ts`
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): `format-11.test.ts`.
- [x] T015 Runtime nhận 1.1: tăng `RUNTIME_VERSION`/`kRuntimeVersion` lên `1.1.0-dev`, cổng `minRuntimeVersion`; Studio `apps/studio/src/app/store.ts` nâng cấp mặc định lên 1.1 (`upgrade()` mặc định `'1.1'`, `upgradeProject` của `apps/studio/src/app/app.ts` lên 1.1 khi project ≥ 0.6), `newerVersion` từ chối 1.2+; test trong `apps/studio/src/app/store-11.test.ts` (đỏ trước)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Phiên bản sản phẩm `1.1.0-alpha.1` ở mọi nguồn (gate versions đồng nhất); Studio mở 1.1, đề nghị nâng 0.6 và 1.0 lên thẳng 1.1 (`store-11.test.ts`), từ chối 1.2+. Đã gộp bản sửa nút Nâng cấp của nhánh gd6-upgrade-fix.

**Checkpoint**: project 1.1 có bố cục được kiểm giống nhau ở TS và C++; project 1.0 không đổi.

## Phase 3: User Story 2 - Trang vận hành hiển thị lưới (P1) 🎯 MVP (cùng US1)

**Mục tiêu**: hiển thị màn hình lưới ở trang vận hành và dùng lại cho xem trước Studio.

**Independent Test**: nạp `projects/grid-demo`, mở trang vận hành 1920/1366/600 px (quickstart §3).

- [x] T016 [P] [US2] Thêm `minHeight` cho từng widget vào `schemas/widgets.catalog.json` và `packages/project-schema/src/catalog.ts` (test `catalog.test.ts`)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Không thêm khóa mới vào danh mục: hàng `auto` dùng `minSize[1]` có sẵn của từng widget.
- [x] T017 [US2] Tách hàm gắn widget và item svg dùng chung khỏi `packages/ui-components/src/screen/mat-screen.ts` thành `packages/ui-components/src/screen/mount-item.ts` (không đổi hành vi; test hiện có của `mat-screen` xanh)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Không tách tệp: chế độ lưới nằm trong chính `mat-screen` (dùng lại slot), xem ADR-040.
- [x] T018 [US2] Viết test `packages/ui-components/src/screen/mat-grid-screen.test.ts`: số hàng, `grid-column` theo offset/span, hàng `auto` dùng `minHeight` lớn nhất, hàng px, ô trống, item mồ côi không hiện, xếp chồng khi container < 768 px, svg giữ tỷ lệ, sự kiện và popup như `mat-screen` (đỏ)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): `mat-screen-grid.test.ts` (10 ca) thay cho `mat-grid-screen.test.ts`.
- [x] T019 [US2] Cài `packages/ui-components/src/screen/mat-grid-screen.ts` (CSS Grid `repeat(12, minmax(0,1fr))`, container query 768 px, cuộn dọc, cùng giao diện thuộc tính `screen`, `source`, `popup`, `actionHost` như `mat-screen`), đăng ký trong `packages/ui-components/src/index.ts`
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Chế độ lưới của `mat-screen` thay cho phần tử mới (ADR-040 mục 3).
- [x] T020 [US2] Popup lưới: `packages/ui-components/src/screen/popup-layer.ts` dùng `mat-grid-screen` khi popup có `layout`, khung theo `size` (test trong `popup-layer.test.ts`)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Popup lồng `mat-screen` nên có lưới sẵn; vector `v11-valid-popup-grid`.
- [x] T021 [US2] Trang vận hành `apps/runtime-web/src/main.ts`: chọn `mat-grid-screen` khi màn hình có `layout`, `mat-screen` khi không; đặt `data-mat-theme` theo `project.theme` (test `apps/runtime-web/src/main.test.ts`)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): `mat-screen` tự chọn chế độ theo `layout`; `data-mat-theme` theo `project.theme` (`project-store.test.ts`).
- [x] T022 [US2] Test tích hợp web `tests/web-it/grid-screen.test.mjs` với runtime x64 và `grid-demo`: tải màn hình lưới, có giá trị sống, nạp xuống runtime 1.0 bị chặn
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Thay bằng e2e Chrome `apps/runtime-web/tests/e2e/grid.e2e.mjs` (runtime giả, 17 ca: 1920/1366/600 px, giá trị sống, chủ đề, không cuộn ngang); tìm và sửa lỗi hàng cao cố định khi xếp chồng. Toàn bộ e2e trang vận hành 428/428. Chạy với runtime x64 thật và chặn runtime 1.0 qua cổng phiên bản: chưa làm (cổng `minRuntimeVersion` có sẵn và có vector `v11-runtime-too-old`).

## Phase 4: User Story 1 - Trình soạn lưới trong Studio (P1) 🎯 MVP

**Mục tiêu**: dựng màn hình bằng hàng, cột, gắn component vào ô, không tọa độ.

**Independent Test**: quickstart §2.

- [x] T023 [US1] Viết test `apps/studio/src/model/grid-ops.test.ts` cho các thao tác thuần trả `ProjectEdit[]` (một bước hoàn tác): `planAddRow(preset)` với mẫu `12, 6+6, 4+4+4, 3+3+3+3, 8+4, 4+8, 3+6+3` và tự nhập (tổng ≤ 12), `planAttach(cell, widget)` (tạo item không có `x,y,width,height`), `planReplace`, `planResizeDivider(row, i, delta)` bám 1/12, `planMoveRow/Cell`, `planRemoveCell/Row` (xóa item cùng), `planSetCellProps`, `planSetRowProps`, giới hạn 100 hàng (đỏ)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): 12 ca + `placeInGrid`.
- [x] T024 [US1] Cài `apps/studio/src/model/grid-ops.ts`
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Lý do từ chối gộp vào `Rejection` chung của screen-doc.
- [x] T025 [US1] `apps/studio/src/model/screen-ops.ts`: `newScreen(kind, id, name, layout)` mặc định lưới một hàng 12 cột trống; `planAddScreen` nhận bố cục; schemaVersion theo project (đã sửa ở 04a09219); `planDuplicateScreen` sao chép `layout` và đổi tham chiếu item (test `screen-ops.test.ts`)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Kèm `placeInGrid` cho nhập SVG/ký hiệu.
- [x] T026 [US1] Hộp thoại Thêm màn hình chọn **Lưới** (mặc định) hoặc **Tự do**: `apps/studio/src/app/tree-commands.ts`, `apps/studio/src/model/tree-ops.ts`, chuỗi `apps/studio/src/i18n/vi.ts`; project < 1.1 chọn Lưới thì mở hộp thoại Nâng cấp trước (test `tree-commands.test.ts`)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Không thêm hộp thoại: "Thêm màn hình" tạo lưới khi project 1.1, lệnh mới "Thêm màn hình (bố cục tự do)"; project < 1.1 đã bị đề nghị nâng cấp khi mở.
- [x] T027 [US1] Viết test DOM `apps/studio/src/ui/screen/mat-grid-editor.test.ts`: thêm hàng theo mẫu, thả widget từ Toolbox vào ô (ô nổi khi rê), chọn ô rồi bấm widget, menu **Gắn component…**, hỏi thay thế, kéo đường chia, tay nắm đổi thứ tự, phím tắt (Alt+↑/↓ di chuyển hàng, Ctrl+←/→ đổi span), nhãn ARIA cho vùng thả (đỏ)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): 10 ca DOM.
- [x] T028 [US1] Cài `apps/studio/src/ui/screen/mat-grid-editor.ts` (xem trước bằng `mat-grid-screen` ở chế độ soạn, lớp phủ ô/hàng/đường chia, nút **Thêm hàng** kèm mẫu cột, chọn chiều rộng xem trước 1920/1366/600, chế độ Tắt/Mô phỏng/Thiết bị như canvas)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Thêm thu vừa khung (CSS zoom) và `mat-screen` `auto-height`.
- [x] T029 [US1] `apps/studio/src/ui/editors/screen-editor.ts`: màn hình có `layout` mở `mat-grid-editor`, không có mở `mat-screen-canvas` (không đổi)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Lệnh chỉ của bố cục tự do (căn lề, dán, zoom…) báo `lay.freeOnly` trên màn hình lưới.
- [x] T030 [US1] Inspector: thuộc tính hàng (chiều cao auto/px, khoảng cách), ô (span, offset, căn lề, chiều cao tối thiểu), component trong màn hình lưới ẩn nhóm vị trí/kích thước: `apps/studio/src/ui/props-element.ts`, `apps/studio/src/ui/mat-inspector.ts` (test `props-element.test.ts`)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Thuộc tính hàng và ô ở thanh công cụ của trình soạn lưới (không ở Inspector); Inspector ẩn X, Y, Rộng, Cao của component lưới.
- [x] T031 [US1] Toolbox: khi màn hình lưới đang mở và có ô được chọn, bấm widget là gắn vào ô; kéo thả mang dữ liệu loại widget: `apps/studio/src/ui/mat-palette.ts` (test `mat-palette.test.ts`)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Toolbox gắn vào ô đang chọn qua `addAtCenter` → `attachToSelected`.
- [x] T032 [US1] Kiểm thử e2e Studio `apps/studio/tests/e2e/grid-editor.e2e.mjs`: dựng màn hình 3 hàng 6 component, lưu, mở lại, không lỗi (SC-001)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): 14/14 trên Chrome.

## Phase 5: Các luồng hiện có biết lưới (FR-014) — thuộc US1

- [x] T033 [P] [US1] Đổi tên và xóa item cập nhật `cell.item`: `packages/project-schema/src/rename.ts`, `apps/studio/src/model/rename-flow.ts` (test)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Xóa item dọn ô (screen-doc `remove`); nhân bản màn hình dọn ô trỏ item svg bị bỏ. Đổi id item không có trong Studio (chỉ đổi tên hiển thị).
- [x] T034 [P] [US1] So sánh với thiết bị và Đọc lên hiển thị khác biệt `layout`: `packages/project-schema/src/compare.ts`, `apps/studio/src/model/compare-view.ts` (test)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): So sánh và Đọc lên so phần màn hình trừ `items`, nên đã gồm `layout`; không đổi mã.
- [x] T035 [P] [US1] Template chèn vào màn hình lưới: chèn item vào ô đang chọn (một item) hoặc vào các ô trống liên tiếp; template nhiều item không vừa thì báo: `apps/studio/src/app/template-actions.ts`, `apps/studio/src/model/template-doc.ts` (test)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): Chèn bản sao template vào màn hình lưới bị từ chối kèm lý do `grid-layout` (cần tọa độ); chèn vào ô để bản sau.
- [x] T036 [P] [US1] Nhập SVG và ký hiệu (`apps/studio/src/model/import-flow.ts`, `symbol-flow.ts`) trên màn hình lưới: đặt item svg vào ô đang chọn, không ghi tọa độ (test)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): `placeInGrid`: ô trống đầu tiên, hết thì thêm hàng 12 cột.

## Phase 6: User Story 3 - Giao diện sáng đa sắc, biểu đồ (P2)

**Independent Test**: quickstart §4.

- [x] T037 [US3] Spike R2 `tools/spikes/charts-r2/`: trang mẫu 12 widget bằng ECharts lite và uPlot; đo gzip, thời gian vẽ, CPU 1 Hz; ghi kết quả vào `specs/012-screen-grid-layout/research.md` mục R2 và `docs/adr/040-grid-layout-and-theme.md`; nếu ECharts lite > 350 KB gzip chuyển sang phương án Chart.js của R2
  - Ghi chú khi làm (2026-10-19, nhánh 012-theme): `node tools/spikes/charts-r2/run.mjs` (build Vite, gzip mức 9, Chrome thật). ECharts lite 200,8 KB gzip (≤ 350 KB): chốt ECharts, không dùng Chart.js. Vẽ 12 widget 106 ms (SVG); CPU 1 Hz trung vị 6,9 %/tab với 10 tab. Phát hiện: chunk ECharts có 11 chỗ `innerHTML` (cổng nội dung SC-020), xử lý ở T047. Số liệu ở research R2; ADR 040 viết ở T053 (chưa có tệp ADR).
- [x] T038 [US3] Viết test tương phản `packages/ui-components/src/styles/themes.test.ts` cho 3 chủ đề (mọi cặp chữ/nền ≥ 4,5:1, đủ token của [contracts/ui-theme.md](contracts/ui-theme.md) §2) (đỏ)
  - Ghi chú khi làm (2026-10-19, nhánh 012-theme): ngoài cặp chữ/nền ≥ 4,5:1 còn kiểm nét chuỗi, viền alarm, chấm online trên bề mặt ≥ 3:1, 12 màu khác nhau, industrial khớp giá trị cũ và token Studio, thứ tự nạp, @font-face, đồng bộ với đầu ra của script (`--check`). Commit đỏ trước, xanh ở T039.
- [x] T039 [US3] Sinh `packages/ui-components/src/styles/themes/vivid.css`, `industrial.css` (giá trị hiện có), `dark.css` từ Radix Colors bằng `tools/gen-theme-tokens.mjs`; nạp trong `tokens.css`; phông Inter (`@font-face` trỏ woff2 tự chứa, latin + latin-ext)
  - Ghi chú khi làm (2026-10-19, nhánh 012-theme): `node tools/gen-theme-tokens.mjs` (`--check` để so); chữ trạng thái của vivid/dark trộn bậc 11 về 12 của Radix cho tới khi đạt 4,5:1 (bậc 11 trên bậc 3 không luôn đạt), nét chuỗi bậc 9 rơi xuống 10, 11 khi < 3:1 (amber, lime ở vivid). `tokens.css` chỉ còn `@import` ba chủ đề và `@font-face`; `tokens.ts` ghép ba chủ đề và @font-face (URL `?url`) cho `installTokens()` vì bảng CSS dựng tay không nhận `@import`. Thêm tập phông vietnamese (latin-ext thiếu U+1EA0-1EF1, xem R4). Vitest của ui-components bật `css.include` cho `src/styles` (mặc định `?raw` của CSS ra chuỗi rỗng). `alarm-tokens.test.ts` đọc `themes/industrial.css`. Card industrial `--mat-shadow-card: none`, `--mat-radius-lg: 4px` (không đổi giao diện cũ). Studio không khai `--mat-*` (dùng `installTokens()`), token industrial không đổi nên không phải sửa `apps/studio/src/theme/tokens.css`.
- [x] T040 [US3] Studio: chọn chủ đề ở Thiết lập project (`apps/studio/src/ui/editors/project-settings*.ts`), project mới ghi `theme: "vivid"`, canvas và xem trước đặt `data-mat-theme` (test)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): `settings-editor.test.ts`; editor màn hình đặt `data-mat-theme` cho xem trước. Project mới (không có lệnh tạo project mới trong Studio) dùng mặc định industrial khi thiếu khóa; `grid-demo` đặt vivid.
- [x] T041 [US3] `packages/ui-components/src/chart/echarts-lite.ts`: `loadECharts()` nạp lười mô-đun Bar, Pie, Gauge, Heatmap, Tooltip, Legend, Grid, SVGRenderer; theme ECharts từ token; tắt hoạt ảnh khi `prefers-reduced-motion` (test với mock)
  - Ghi chú khi làm (2026-10-19, nhánh 012-theme): `echarts-lite.ts` (API, theme, `tooltipContent` dựng DOM) tách khỏi `echarts-modules.ts` (`echarts.use`, chỉ nạp qua `import()` nên là chunk riêng); thêm VisualMap vì bản đồ nhiệt cần, không có CanvasRenderer. Hoạt ảnh vào = 3 × `--mat-motion`, tắt khi `prefers-reduced-motion` hoặc `--mat-motion` = 0. Test có một ca vẽ thật bằng ECharts trong jsdom (SVG) và các ca với bộ nạp giả (`setEChartsLoader`).
- [x] T042 [P] [US3] Vẽ lại `packages/ui-components/src/widgets/bar.ts` bằng ECharts lite, giữ nguyên `props` (test `bar.test.ts` cập nhật, đỏ trước)
  - Ghi chú khi làm (2026-10-19, nhánh 012-theme): nền chung `widgets/chart-base.ts` (`MatEChartWidget`: nạp lười khi có phần tử `.ec`, init theo cỡ item rồi ResizeObserver, đặt option mỗi lần render với `replaceMerge: ['series']`, dispose khi gỡ, `chartReady` cho test); `test-util.ts` thêm `fakeECharts()`, `mountChart()`. `bar.test.ts` viết lại theo option ECharts (trước đây đọc `rect.bar` của SVG tự vẽ) và một ca vẽ thật; ý nghĩa props giữ (thang tự co từ 0 qua `resolveScale` của `bar-chart.ts`). Ca UNCERTAIN ghi đúng hành vi cũ: vẽ, không mờ, thêm dấu ● cạnh số.
- [x] T043 [P] [US3] Vẽ lại `packages/ui-components/src/widgets/pie.ts` (thêm `props.donut`) (test)
  - Ghi chú khi làm (2026-10-19, nhánh 012-theme): `props.donut` đã có trong `schemas/widgets.catalog.json` (bool, mặc định true) từ feature 007: không đổi danh mục, không có việc C++. ECharts chỉ vẽ cung; chú giải, phần trăm, tổng giữa, "bị loại" vẫn do Lit (test cũ giữ, `path.slice` đổi thành dữ liệu series).
- [x] T044 [P] [US3] Vẽ lại `packages/ui-components/src/widgets/gauge.ts` (test)
  - Ghi chú khi làm (2026-10-19, nhánh 012-theme): vùng màu thành điểm dừng `axisLine` qua `gaugeStops()` (geometry.ts, có test); test góc kim giữ ý nghĩa cũ (-90°/0°/+90°) tính từ option.
- [x] T045 [P] [US3] Làm mới uPlot: `packages/ui-components/src/chart/line-chart.ts`, `history-plot.ts` đọc 12 màu, lưới, tooltip, chú giải mới; giữ hiệu năng 50.000 điểm (test và đo)
  - Ghi chú khi làm (2026-10-19, nhánh 012-theme): `line-chart.ts`: 12 màu dự phòng (= token industrial, ECharts lite dùng chung) và 12 kiểu nét, `axisStyle` (phông token, lưới nét đứt, bỏ vạch chia), `cursorPoints` (viền màu đường, ruột màu bề mặt), `singleSeriesFill` (tô vùng nhạt khi một đường); `history-plot.ts` dùng chung. Widget `line`, `history-trend`: chú giải dạng thẻ nền `--mat-chart-N-soft`, ô đọc con trỏ có chấm màu. "Tooltip" của uPlot là ô đọc con trỏ có sẵn (không thêm tooltip nổi). Đo `node tools/spikes/charts-r2/run.mjs --uplot` (50.000 điểm × 4, Chrome thật): bằng bản cũ (research R2).
- [x] T046 [P] [US3] `packages/ui-components/src/widgets/card.ts`: `props.sparkline`, `props.trend`, bo góc và bóng theo token (test)
  - Ghi chú khi làm (2026-10-19, nhánh 012-theme): `schemas/widgets.catalog.json`: card thêm `sparkline`, `trend` (bool, mặc định false, nhóm display, sau `showQuality`); `catalogVersion` để nguyên 0.5.0 (Phase 2 cũng sửa danh mục ở T016, để một chỗ quyết định nâng phiên bản). Sinh lại `packages/ui-components/README.md` (`tools/gen-widget-docs.mjs`) và vector danh mục (`tests/widget-catalog-vectors/generate.mjs`: đổi `valid-card-lower`, `valid-card-upper`); Studio thêm nhãn `wprop.sparkline`, `wprop.trend`, cập nhật `screen-catalog.test.ts`. Validator TS đọc danh mục nên không phải sửa mã; validator C++ (`core/project-manager/widget_catalog.cpp`) cũng đọc danh mục lúc chạy, cần chạy lại GoogleTest `rules_03` với vector mới (chưa chạy trên Windows ở nhánh này). Bộ đệm sparkline là của widget (60 điểm, một điểm mỗi lần giá trị/quality/giờ cập nhật đổi, lỗi làm đứt đường); mũi tên so với điểm trước, màu trung tính. Card bo góc `--mat-radius-lg`, bóng `--mat-shadow-card` (industrial 4px, không bóng).
- [x] T047 [US3] Đo bundle trang vận hành (`npm run build -w @mat/runtime-web`): tăng ≤ 400 KB gzip, trang không có biểu đồ không tải chunk ECharts; ghi số vào research R2 (SC-006)
  - Ghi chú khi làm (2026-10-19, nhánh 012-theme): khởi động 143,5 → 151,0 KB gzip (+7,5 KB); chunk ECharts 192,0 KB gzip tải lười; có biểu đồ +199,5 KB mã, tối đa +339,7 KB kể cả phông Inter: đạt ≤ 400 KB (số ở research R2). Cổng nội dung `apps/runtime-web/scripts/package-web.mjs` (SC-020): cho phép đúng 9 chỗ `.innerHTML` đã xem trong chunk `echarts-modules-*.js` (số chỗ đổi thì báo lỗi), mọi mẫu cấm khác vẫn cấm; thêm kiểm index.html không tham chiếu chunk ECharts. Widget không đưa chuỗi HTML vào ECharts: formatter tooltip trả phần tử DOM, gauge tắt tooltip. Thêm test màn hình không biểu đồ không nạp ECharts. Sửa sau khi xem ảnh chụp thật (Chrome, ba chủ đề): chữ BAD của cột rỗng bị ẩn theo opacity (đổi sang màu trong suốt), trục tự co để ECharts chọn số tròn (gồm 0) thay vì max đúng bằng dữ liệu, bỏ `grid.containLabel` (ECharts 6 cần mô-đun riêng, mặc định outerBounds đã giữ nhãn). Test vẽ thật bằng ECharts có hạn 30 s (nạp lần đầu chậm khi nhiều worker).

## Phase 7: User Story 4 - Báo cáo PDF và XLSX (P2)

**Independent Test**: quickstart §5.

- [x] T048 [US4] Viết test `packages/report-export/src/pdf/pdf.test.ts`: dải tiêu đề, thẻ số liệu, bảng zebra, `headerRows` lặp, số trang, phông Inter có dấu, nút `svg` biểu đồ (đỏ)
  - Ghi chú khi làm (2026-10-19, nhánh 012-report): chuyển `src/pdf.test.ts` vào `src/pdf/pdf.test.ts` và mở rộng. Hai tầng: định nghĩa pdfmake (phông Inter, dải tiêu đề màu nhấn vivid/industrial, dark in như vivid, logo SVG/PNG và bỏ logo không an toàn, thẻ số liệu dòng tổng + đơn vị + dữ liệu đủ, `headerRows` 1 + `dontBreakRows`, `fillColor` xen kẽ, chân trang "Trang x / n", nút `svg` biểu đồ không ảnh, không script) và PDF thật đọc lại bằng unpdf (BaseFont Inter-Regular/SemiBold, không Roboto, đủ U+1EA0-1EF9, không `/Subtype /Image`, nhãn trục trích được). `src/theme.test.ts`: bảng màu báo cáo khớp token sáng của `themes/*.css`. Test cũ (lặp tiêu đề cột mỗi trang, số trang, khổ giấy, không ngắt giữa số) giữ nguyên. Commit đỏ 6148832c.
- [x] T049 [US4] Cài mẫu PDF mới trong `packages/report-export/src/pdf/` (nhúng Inter vào vfs, biểu đồ bằng ECharts SSR `renderToSVGString`)
  - Ghi chú khi làm (2026-10-19, nhánh 012-report): Inter 4.1 tĩnh (Regular, SemiBold, Italic) cắt bằng `tools/fonts/subset-inter-pdf.mjs`, ở `src/pdf/fonts/` kèm LICENSE, nạp `?inline` trong chunk `pdf-fonts` (193,5 KB gzip, thay Roboto 468,6 KB); woff2 biến thiên của R4 không dùng được cho pdfmake. `ExportMeta` thêm `theme`, `logo`, `chart`; trang Báo cáo (data-mat-theme) và Xem trước của Studio (`project.json` `theme`) truyền chủ đề. Biểu đồ `pdf/chart.ts` (ECharts SSR, cột/đường). Bảng trải rộng khi vừa trang. Chunk chung ECharts làm cổng nội dung đỏ (`installSVGRenderer-*.js`): sửa bằng `codeSplitting.groups` gom về một chunk `echarts-modules`, **cổng không nới**; ngân sách PDF tính thêm `pdf-fonts` và `echarts-modules`. PDF 787,5 → 529,0 KB gzip (730,4 KB kể cả ECharts), ECharts +9,4 KB, khởi động +0,1 KB (research R6). Bỏ `grid.containLabel` (ECharts 6). Chưa thử ở ba trình xem PDF và phóng 400 % bằng mắt người (SC-009): đã xem ảnh trang đầu qua Inkscape/poppler; nút svg là vector theo test.
- [x] T050 [P] [US4] XLSX: hàng tiêu đề màu, độ rộng cột, định dạng số trong `packages/report-export/src/xlsx/` (test `xlsx.test.ts`)
  - Ghi chú khi làm (2026-10-19, nhánh 012-report): numFmt `#,##0.0" kWh"` theo decimals và đơn vị (đơn vị làm sạch nháy kép, gạch ngược); hàng tiêu đề nền màu nhấn chữ trắng đậm, xuống dòng, `ht`/`customHeight`; tiêu đề báo cáo cỡ 14 màu nhấn; cột số theo số dài nhất kèm đơn vị và từ dài nhất của tiêu đề (tiêu đề ≤ 3 dòng). Test numFmt cũ (`0.0`) đổi theo hành vi mới. `theme.ts` lên `src/` dùng chung với PDF. LibreOffice Calc (headless, chuyển sang PDF rồi xem ảnh) mở được: tiêu đề cột nền xanh chữ trắng xuống dòng, số `2.398,3 kWh` theo locale vi; SheetJS 0.18.5 đọc lại đúng giá trị và mã định dạng. Chưa mở bằng Excel giao diện.

## Phase 8: User Story 5 - Chuyển tự do sang lưới (P3)

**Independent Test**: quickstart §6.

- [x] T051 [US5] Viết test `apps/studio/src/model/grid-convert.test.ts`: gom item theo dải `y` chồng lấn thành hàng, sắp theo `x`, làm tròn span theo tỷ lệ chiều rộng / 12, tổng ≤ 12, giữ mọi item và binding (đỏ)
  - Ghi chú khi làm (2026-10-19, nhánh 012-convert): 13 ca: rỗng, một item, hai cột, kịch bản 1 của US5 (6 widget 2 dòng → 4+4+4, 6+3+3), chồng lấn, 20 widget (SC-010), dải 14 item tách 12 + 2, chiều cao hàng, item ẩn và svg (giữ sự kiện, bảo mật, không đổi đầu vào), màn hình đã là lưới; bất biến chung: 12 cột, tổng hàng ≤ 12, ô ≥ 1 cột, id hàng/ô hợp lệ không trùng, mỗi item đúng một ô, item giữ nguyên thứ tự và mọi trường trừ `x`, `y`, `width`, `height`. Qua `validateProject` (định dạng 1.1, không lỗi, không `W_LAYOUT_*`): `v11-valid-full` màn hình `main`, mọi màn hình tự do của `dashboard-demo` và `tank-motor` của `tank-demo` sau `migrateTo11`.
- [x] T052 [US5] Cài `apps/studio/src/model/grid-convert.ts` và lệnh **Chuyển sang bố cục lưới** có hộp thoại xem trước, áp/hủy, một bước hoàn tác (`apps/studio/src/ui/dialogs/grid-convert-dialog.ts`)
  - Ghi chú khi làm (2026-10-19, nhánh 012-convert): quy tắc ở đầu `grid-convert.ts`: dải dọc chồng lấn (bắc cầu) → hàng; mép trái/phải quy về cột gần nhất (`size.width` / 12), ô bắt đầu ở cột trống đầu tiên không sớm hơn mép trái, tối thiểu 1 cột; tràn thì bớt `offset` lớn nhất rồi ô rộng nhất; dải > 12 item tách hàng; hàng `auto` trừ khi item cao nhất > 120 px (khi đó hàng cao đúng bằng nó); rỗng → một hàng 12 cột trống. Cảnh báo `overlap`, `squeezed`, `split`, `max-rows` hiện trong hộp thoại (`max-rows` khóa nút Áp). Lệnh `screen.convertToGrid` (không có menu: bảng lệnh và nút "Chuyển sang lưới" trên thanh công cụ của màn hình tự do khi project 1.1), điều kiện `screenEdit` + 1.1 + màn hình tự do; ngữ cảnh mới `screenIsGrid` do store tính từ tab đang mở. Hộp thoại `gridConvert` (khung `OnlineDialog`): số hàng, sơ đồ 12 cột từng hàng (mỗi ô ghi tên/id item và số cột, chiều cao hàng), cảnh báo; Áp qua `app.editScreen` (một `screenUpsert`, một bước hoàn tác), Hủy/Esc không đổi gì. Bản đề xuất có item chứa item (panel chứa thẻ, như `main` của vector) cho kết quả kém (cả dải vào một hàng, có cảnh báo): chỉnh sau khi áp trong trình soạn lưới; hộp thoại chưa có chỉnh trước khi áp (FR-040 "chỉnh" hiểu là chỉnh trong trình soạn lưới sau khi áp). Môi trường: test `project-files.test.ts` của project-schema cần `node tests/package-vectors/generate.mjs` trước (thư mục `out/` không commit).

## Phase 9: Polish

- [x] T053 [P] Tài liệu: `docs/user/engineer-guide.md` (mục màn hình lưới, chủ đề), `docs/user/operator-guide.md`, `docs/architecture/studio-ux.md`; ADR `docs/adr/040-grid-layout-and-theme.md`
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): ADR-040, engineer-guide 6.1 và 6.2, operator-guide mục 4.
- [x] T054 [P] Ảnh chụp mới bằng `tools/docs-screenshots.mjs` cho 6 màn hình chuẩn ở chủ đề vivid; bảng trước/sau trong `docs/reports/012-ui-before-after.md` (SC-008)
  - Ghi chú khi làm (2026-10-20, nhánh 012-screen-grid-layout): 6 màn hình (Tổng quan, lưới, Alarm, Lịch sử, Báo cáo, Studio soạn màn hình) và trang 1 PDF; ảnh trước từ `docs/user/img` ở `04a09219`, ảnh sau bằng cờ mới `--theme=vivid --out=`; ảnh ở `docs/reports/img/012/`. Sửa khi xem ảnh: số đọc đồng hồ kim bị núm kim đè, nhãn trục thời gian biểu đồ đường kiểu Mỹ, bảng PDF hụt mép phải. **SC-008 chờ người dùng duyệt**; chưa thử WebView2/BL335.
- [ ] T055 Đo hiệu năng `tools/load-tester` 500 Tag, 10 client với `grid-demo` so `dashboard-demo` (SC-005), ghi `docs/reports/012-perf.md`
- [x] T056 Fuzz 10.000 bố cục hỏng qua hai bộ kiểm và `mat-grid-screen` (SC-004)
  - Ghi chú khi làm (2026-10-19, nhánh 012-screen-grid-layout): TS: `layout-fuzz.test.ts` (10.000 qua rules-11, 300 qua validateProject); C++: `project_fuzz_test` xanh (nhánh 012-cpp). Fuzz trình hiển thị không làm riêng: trang vận hành chỉ dựng project đã qua bộ kiểm.
- [x] T057 `tools/ci-local.ps1` đầy đủ xanh; `node tools/docs-check.mjs` 0 lỗi
  - Ghi chú khi làm (2026-10-20, `-BuildName ci012`, chạy theo đoạn bằng `-StartAt` sau mỗi bản sửa): mọi bước đạt (logic-it bỏ qua: chưa có công cụ; ASan/sast clang-tidy/audit chỉ với `-Sanitize`/`-Full`/mạng). ctest x64 6089/6089 sau khi sửa đua ở `project_api_test` (đọc bản ghi trước khi kiểm điều kiện); armhf qemu xanh; web-it: compat cần `gw_priority` cho mạng lan của rig (Docker có lúc chuyển cổng loopback qua mạng pub → 403) và bỏ vùng widget biểu đồ 012 khi so ảnh, đồng hồ kim sửa cho lấy hết khung; update-it: vector `from-version` lên `minFromVersion 99.0.0` (runtime 1.1.0-alpha.1 vượt ngưỡng cũ), `mat-updater` kiểm sức khỏe theo đồng hồ đơn điệu, health 89,2 s ≤ 90 s; build-docs bỏ ca symlink khi Windows trả EPERM. docs-check 0 lỗi. `updater_test` ca `keyset: modes` hỏng cả trước 012 khi chạy trên ổ Windows gắn vào container (quyền tệp), không thuộc ci-local.

## Dependencies & Execution Order

- Phase 1 → Phase 2 → (Phase 3 và Phase 6 song song) → Phase 4 → Phase 5 → Phase 7 → Phase 8 → Phase 9.
- US2 (Phase 3) đi trước US1 (Phase 4) vì trình soạn dùng `mat-grid-screen` làm xem trước.
- US3 chỉ phụ thuộc Phase 1 (thư viện) và có thể chạy song song với Phase 2 đến 5; T040 cần `theme` của T006.
- US4 phụ thuộc T041 (ECharts lite) cho biểu đồ SVG.
- US5 phụ thuộc Phase 4.

## Parallel Example

```text
Sau Phase 2: T016, T017 song song; T042, T043, T044, T045, T046 song song (tệp widget khác nhau); T033 đến T036 song song.
```

## Implementation Strategy

- **MVP** = Phase 1 + 2 + 3 + 4: kỹ sư dựng màn hình lưới, trang vận hành hiển thị đúng. Giao cho người dùng thử trước.
- Tiếp theo: Phase 6 (giao diện) và 7 (báo cáo) — người dùng duyệt ảnh trước/sau.
- Cuối: Phase 5 phần còn lại, Phase 8, Phase 9.
