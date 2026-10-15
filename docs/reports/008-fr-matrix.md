# Bảng đối chiếu FR và SC của feature 008 (T117)

Ngày lập: 2026-10-15. Nguồn: `specs/008-svg-import-binding/{spec.md, plan.md, tasks.md, contracts/*}`, ghi chú "Ghi chú khi làm" của task, `docs/reports/008-*.{md,json}`, mã và test trong cây này. Tự phân tích chéo spec, plan, tasks theo quy trình `/speckit-analyze` (đọc thủ công, không có công cụ tự động): kết quả ở mục "Phát hiện lệch" cuối file.

**Trạng thái:**
- **Đạt:** có test hoặc kịch bản tự động xanh; ghi rõ cái nào **đã chạy lại 2026-10-15** (R) và cái chỉ theo ghi chú task (G, chưa chạy lại ở lượt này).
- **Một phần:** phần đã làm đạt, phần còn lại nêu cụ thể.
- **Chờ x64:** cần kịch bản `tools/web-it.ps1` trên runtime x64 (T084, T107, T108: chưa có kết quả trong cây này).
- **Chờ BL335:** cần SSH và thiết bị (T010, T121 đến T126).
- **Chờ người:** thử tay (NVDA, bộ gõ, Illustrator và CorelDRAW thật, người dùng thử).

**Chạy lại ở lượt này (R):** Vitest trong worktree phải dùng cấu hình tạm `server.fs.strict=false` (junction `node_modules` làm Vite báo "Denied ID …?raw" ở 3 file; cấu hình tạm đã xóa, không commit): `apps/studio` 142 file, **2.071 test xanh**; `@mat/ui-components` 30 file, **466 xanh**; `@mat/svg-import` 232 xanh; `@mat/svg-renderer` 507 xanh; `@mat/symbols` 183 xanh; `@mat/binding-engine` 98 xanh; `@mat/project-schema` 2.566 test (1 ca `vectors-02` hết giờ khi chạy song song với máy bận, xanh khi chạy lại riêng); `@mat/runtime-web` 187 xanh, 1 ca `main.test.ts` đỏ chỉ vì "Denied ID" của junction (không phải mã). e2e Chrome headless: Studio `import` 108, `reimport` 46, `svg-bind` 115, `symbols` 38, `upgrade04` 27; runtime-web `anim` 26, `svg-events` 31; **0 ca đỏ**. **Không chạy lại** (không có Docker, không SSH): ctest C++ (T028, T029, T083 ghi xanh trong task: `rules_04_test` 20/20, `vectors_04_test` 354/354), cargo test, `web-it` x64, `tools/ci-local.ps1`.

Viết tắt đường dẫn: `ps` = `packages/project-schema/src`; `sr` = `packages/svg-renderer/src`; `si` = `packages/svg-import/src`; `be` = `packages/binding-engine/src`; `uc` = `packages/ui-components/src`; `st` = `apps/studio/src`; `E-S` = `apps/studio/tests/e2e`; `E-R` = `apps/runtime-web/tests/e2e`; `sym` = `packages/symbol-library`; `fx` = `tests/fixtures/svg-import`; `cpp` = `core/project-manager/tests`; báo cáo `R:` = `docs/reports/`.

## Định dạng 0.4.0, nâng cấp, kiểm tra, tương thích (FR-001 đến FR-010)

| FR | Task | Test | Báo cáo, ghi chú | Trạng thái |
|---|---|---|---|---|
| FR-001, 002, 003 | T012, T015, T017, T029 | `ps/schema-04.test.ts`, `ps/rules-04.test.ts`; `schemas/0.4/`, `schemas/0.3/` đóng băng | `schemas/README.md` | Đạt (R) |
| FR-004 (giới hạn 64 item svg, 2.000 phần tử, 16 binding…) | T015, T029 | `ps/rules-04.test.ts`; `cpp/rules_04_test.cpp`; vector biên `v04-*`; `E-S/symbols.e2e.mjs` (40 và 65 item) | | Đạt (R cho TS và e2e; C++ G) |
| FR-005, 006 (nâng cấp 0.3 → 0.4, sao lưu, xác định, chỉ đọc) | T016, T105, T106 | `ps/migrate-03to04.test.ts`, `tests/migration-vectors` (cặp 0.3 → 0.4), `st/model/project-doc.test.ts`; `E-S/upgrade04.e2e.mjs` | | Đạt (R) |
| FR-007 (hai bộ kiểm tra cùng kết luận) | T011, T013, T014, T028, T029 | `ps/vectors-04.test.ts` (TS), `cpp/vectors_04_test.cpp` (354 ca) trên `tests/project-vectors/v04-*` (341 thư mục) | | Đạt (TS R; C++ G) |
| FR-008 (runtime 0.7 nhận 0.1 đến 0.4) | T029, T030, T107 | `cpp`, `server/tests/startup_test.cpp`; `E-R/compat.e2e.mjs` (0.1 trên trang) | T107 (web-it `svg`, so ảnh 0.1 đến 0.3) chưa có | **Một phần:** nhận và chạy 0.4 (G); "cùng DOM và giá trị như runtime 0.6" cho 0.1 đến 0.3 chờ x64 |
| FR-009 (tập file gồm file SVG) | T017 | `ps/project-files.test.ts`, `ps/rules-04-svg.test.ts` | | Đạt (R) |
| FR-010 (So sánh, Đọc lên, Xem trước nạp xuống) | T018, T106 | `ps/compare-04.test.ts`, `st/model/compare-view-04.test.ts`, `st/model/download-flow.test.ts`; `E-S/upgrade04.e2e.mjs` ("Nạp xuống lên runtime cũ") | | Đạt (R); Đọc lên và So sánh qua thiết bị thật: chờ x64 |

## Importer và allowlist (FR-011 đến FR-025)

| FR | Task | Test | Báo cáo, ghi chú | Trạng thái |
|---|---|---|---|---|
| FR-011 (lệnh Thêm › Đồ họa SVG…, Nhập lại SVG…, `svg_open`) | T002, T055, T056, T057, T058, T102 | `st/model/import-flow.test.ts`, `st/ui/dialogs/import-svg.test.ts`, `cargo test --lib` (T055, G), `E-S/import.e2e.mjs` | `R:008-sc019.md` | **Một phần:** lệnh chạy bằng Ctrl+Shift+I và bảng lệnh; **không có mục menu hay nút** như spec và mockup (phát hiện A1) |
| FR-012 (tiền xử lý: byte, BOM, UTF-8, DTD) | T037, T043 | `si/prescan.test.ts` | | Đạt (R) |
| FR-013, 014 (allowlist trên DOM, thuộc tính theo phần tử và giá trị) | T020, T021 | `sr/allowlist.test.ts`, `sr/css-value.test.ts`, `sr/sanitize.test.ts`, `sr/data-attributes.test.ts`, `sr/no-regex.test.ts` | | Đạt (R) |
| FR-015 (giới hạn nhập) | T042, T049, T036 | `si/import.test.ts`, `fx/limits.mjs`, `fx/limits.test.mjs` | `R:008-stress-x64.json` | Đạt (R) |
| FR-016 (CSS thành thuộc tính) | T038, T044 | `si/css.test.ts` | giới hạn tập con: `docs/architecture/svg-dialects.md` | Đạt (R) |
| FR-017 (chuẩn hóa) | T039, T045 | `si/normalize.test.ts` | | Đạt (R) |
| FR-018 (Tối ưu) | T042, T047, T054 | `si/optimize.test.ts`, `si/import.test.ts` | `R:008-stress-x64.json`: 27.029 → 10.307 phần tử, ảnh khác 0,463 % | Đạt (R) |
| FR-019 (UID, tên) | T040, T046 | `si/uid.test.ts`, `si/name.test.ts` | | Đạt (R) |
| FR-020 (báo cáo: loại, tên, số lượng, lý do, **tối đa 3 vị trí ví dụ**) | T041, T048 | `si/report.test.ts`, `si/write.test.ts`; `E-S/import.e2e.mjs` | | **Một phần:** mục từ allowlist không có vị trí ví dụ và tên thuộc tính bị loại chỉ là "thuộc tính" (phát hiện A2) |
| FR-021 (mã lỗi từ chối, câu hướng dẫn) | T049, T048 | `si/import.test.ts`, `E-S/import.e2e.mjs` (từ chối) | | Đạt (R) |
| FR-022 (tất định) | T041, T042 | `si/write.test.ts`, `si/import.test.ts` | | Đạt (R) |
| FR-023 (một bộ allowlist cho Studio và trang) | T022, T023, T061 | `sr/sanitize.test.ts`, `sr/mount.test.ts`, `E-R/svg-unsafe.e2e.mjs` | `tools/svg-import/regress-sprint0.mjs` (19 file Sprint 0) | Đạt (G cho hồi quy Sprint 0) |
| FR-024 (`E_SVG_UNSAFE`, `E_SVG_LIMIT`, `W_SVG_HEAVY`) | T019, T060 | `ps/rules-04-svg.test.ts` | | Đạt (R) |
| FR-025 (`svg:inspect --import`) | T050, T119 | `tools/svg-import/cli.test.mjs` | CI (T119) chưa thêm | **Một phần:** CLI đạt (G); nối vào `ci-local.ps1` và `ci.yml` chưa làm |

## Nhập lại SVG giữ UID (FR-026 đến FR-029)

| FR | Task | Test | Báo cáo, ghi chú | Trạng thái |
|---|---|---|---|---|
| FR-026, 027 (bốn bước đối chiếu, mơ hồ không gán tự động) | T097, T098, T099, T100 | `si/signature.test.ts`, `si/match.test.ts`, `si/apply-match.test.ts`; bộ cặp `fx/reimport/` | `R:008-fixtures.json` mục `reimport`: 210/215 khớp đúng, **0 gán sai**, 17 cần chọn, 4 mồ côi | Đạt (R); tập đo 7 cặp, 215 phần tử là nhỏ |
| FR-028 (hộp thoại Đối chiếu lại) | T101, T102 | `st/model/reimport-flow.test.ts`; `E-S/reimport.e2e.mjs` (bàn phím, axe, tệp dùng chung) | `R:008-sc019.md` | Đạt (R) |
| FR-029 (UID giữ qua Lưu, mở lại, đóng gói, Đọc lên, So sánh, hoàn tác, nhân bản) | T101, T103 | `E-S/reimport.e2e.mjs` ("mở lại project đã lưu: UID giữ nguyên", Ctrl+Z); `tools/svg-demo/uid-roundtrip.mjs` viết sẵn | roundtrip qua runtime x64 chưa chạy | **Một phần:** Lưu, mở lại, hoàn tác đạt (R); đóng gói, Đọc lên, So sánh chờ x64; nhân bản item chưa có ca riêng cho item `svg` |

## Binding, animation, chọn phần tử (FR-030 đến FR-048)

| FR | Task | Test | Báo cáo, ghi chú | Trạng thái |
|---|---|---|---|---|
| FR-030 (vào item, chọn phần tử, cây, F2) | T065, T069, T070, T071 | `st/model/svg-select.test.ts`; `E-S/svg-bind.e2e.mjs` (nhấp đúp, khung chọn, Alt+nhấp, Alt+↑, cây, F2) | `R:008-studio-perf.json` (cây 20.000 nút 8,1 ms). **F2 sửa lỗi focus ở T114** | Đạt (R) |
| FR-031 (13 dòng) | T064, T072 | `st/model/animation-catalog.test.ts`; `E-S/svg-bind.e2e.mjs` ("đủ 13 dòng") | | Đạt (R) |
| FR-032 đến 039 (chữ, màu, mức, quay, di chuyển, co giãn, nhấp nháy, dòng chảy, ẩn hiện, độ mờ) | T024, T025, T026, T027, T063, T066, T072 | `be/transforms.test.ts`, `be/applier-04.test.ts`, `be/anim/clip-level.test.ts`, `be/anim/transform-state.test.ts`; `E-S/svg-bind.e2e.mjs` (gắn từng loại qua giao diện), `E-R/anim.e2e.mjs` (Chrome thật) | | Đạt (R) |
| FR-040 (hợp biến đổi cố định) | T026, T027, T066 | `be/anim/transform-state.test.ts`, `E-R/anim.e2e.mjs` | | Đạt (R) |
| FR-041 (`onBadQuality`) | T024, T066 | `be/applier-04.test.ts`; `E-R/anim.e2e.mjs` ("chất lượng xấu") | | Đạt (R) |
| FR-042 (kéo Tag, từ chối sai kiểu) | T064, T072 | `st/model/animation-catalog.test.ts`; `E-S/svg-bind.e2e.mjs` (từ chối Tag chỉ đọc) | | Đạt (R) |
| FR-043 (Thử giá trị ≤ 100 ms, không ghi) | T072, T073 | `E-S/svg-bind.e2e.mjs` (đo 4 ms trong `R:008-studio-perf.json`; "không ghi ra đĩa"; **bàn phím thêm ở T114**) | | Đạt (R) |
| FR-044, 045 (Gợi ý, nhiều phần tử, sao chép dán) | T064, T074 | `st/model/svg-suggest.test.ts`, `svg-binding-doc.test.ts`; `E-S/svg-bind.e2e.mjs` | | Đạt (R) |
| FR-046 (lỗi theo dòng và tab Thông tin, Nạp xuống khóa) | T064, T068 | `st/model/svg-issues.test.ts`; `E-S/svg-bind.e2e.mjs` (E_RANGE, nhấp đúp) | | Đạt (R) |
| FR-047 (đổi tên Tag, Dùng ở đâu, xóa màn hình) | T018, T075 | `ps/rename-04.test.ts`, `st/model/xref.test.ts`; `E-S/svg-bind.e2e.mjs` ("đổi tên TANK01.LEVEL") | | Đạt (R) |
| FR-048 (`DomApplier` duy nhất, gom rAF, tab ẩn) | T063, T066, T067 | `be/applier*.test.ts`, `uc/screen/svg-item-rewire.test.ts`; `E-R/anim.e2e.mjs` (tab ẩn) | `R:008-anim-x64.json` | Đạt (R) |

## Sự kiện (FR-049 đến FR-054)

| FR | Task | Test | Báo cáo, ghi chú | Trạng thái |
|---|---|---|---|---|
| FR-049, 052 (gắn từ dữ liệu, khóa kèm lý do, bàn phím) | T079, T080, T082 | `uc/screen/svg-events.test.ts`; `E-R/svg-events.e2e.mjs` (nhấp, Tab, Enter, Space, fill="none", phần tử ẩn, `aria-disabled`) | | Đạt (R) |
| FR-050 (`ActionHost`, `ControlController`) | T079, T080 | `uc/control/svg-action-controller.test.ts`; `E-R/svg-events.e2e.mjs` (popup, xác nhận, kết quả) | | Đạt (R) |
| FR-051 (`context.widget` = UID, audit `web`) | T079, T083, T084 | `core/tag-engine/tests/write_extensions_test.cpp` (G); `E-S/svg-bind.e2e.mjs` ("Thiết bị: … đúng một lệnh ghi") | `-Scenario svg-events` (T084, audit và 30 ca tấn công) chưa có | **Một phần:** bằng chứng ở lớp giả (R) và C++ (G); audit thật trên runtime x64 chờ |
| FR-053 (`E_EVENT_*`, `W_EVENT_*`) | T015, T029 | `ps/rules-04.test.ts`; `cpp/rules_04_test.cpp`; `E-S/svg-bind.e2e.mjs` | | Đạt (TS R; C++ G) |
| FR-054 (nhóm Sự kiện của Studio) | T081, T085 | `st/model/svg-binding-doc.test.ts`, `preview-hosts-svg.test.ts`; `E-S/svg-bind.e2e.mjs` (6 hành động, lỗi ô, xem trước Mô phỏng và Thiết bị) | | Đạt (R) |

## Ký hiệu (FR-055 đến FR-058)

| FR | Task | Test | Báo cáo, ghi chú | Trạng thái |
|---|---|---|---|---|
| FR-055 (≥ 12 ký hiệu, 5 nhóm, CC0, không logo) | T003, T087, T088 | `sym/tests/symbols.test.ts` (183 test) | `sym/LICENSES.md`; thật: 12 ký hiệu, 15 tệp | **Một phần:** thư viện đạt (R); Toolbox **không hiện nguồn gốc và giấy phép** từng ký hiệu như US4-1 (phát hiện A6) |
| FR-056 (bộ phận UID cố định, điểm gắn) | T087, T088, T089 | `sym/tests/symbols.test.ts`, `ports.test.ts` | | Đạt (R) |
| FR-057 (Toolbox, thả, dính) | T090, T091 | `st/model/symbol-flow.test.ts`; `E-S/symbols.e2e.mjs` (15 tệp, tìm, thả, dính, Alt, 40 và 65 item) | | Đạt (R) |
| FR-058 (Gắn nhanh) | T092 | `st/model/quick-bind.test.ts`; `E-S/symbols.e2e.mjs` | | Đạt (R) |

## Test, fixture, bảo mật, tài liệu, phiên bản, trợ năng (FR-059 đến FR-067)

| FR | Task | Test | Báo cáo, ghi chú | Trạng thái |
|---|---|---|---|---|
| FR-059 (test trước, vector ≥ 100, importer, DomApplier, controller, e2e, fuzz) | T011, T014, T028, T113 và các task test đỏ | `ps/vectors-04.test.ts`; `cpp/vectors_04_test.cpp`; `tools/svg-import/fuzz.test.mjs` | `R:008-fuzz-x64.json` (10.000 ca, 55 s, tìm và sửa 2 lỗi thật); ghi chú task nêu đỏ rồi xanh | Đạt (G cho thứ tự đỏ, xanh; R cho test) |
| FR-060 (10 fixture: 4 Inkscape thật, 3 + 3 mô phỏng) | T033, T034, T120 | `fx/manifest.json`, `si/import.test.ts` | `R:008-fixtures.json`; `tests/fixtures/svg-import/README.md` | **Một phần:** 4 thật + 6 **mô phỏng**; file thật Illustrator và CorelDRAW: chờ người (T120) |
| FR-061 (so ảnh trong Chrome, không thư viện) | T051 | `tools/svg-import/diff-images.test.mjs` | `R:008-fixtures.json` | Đạt (R cho test; G cho lần chạy Chrome) |
| FR-062 (≥ 24 ca độc hại) | T035, T051, T053 | `fx/malicious/` (36 ca có tệp), harness `tools/svg-import/malicious-harness.mjs` | `R:008-malicious-x64.json`: 39 ca, 29 làm sạch, 10 từ chối, 0 `__pwned`, 0 yêu cầu mạng | Đạt (G) |
| FR-063 (không thêm thư viện) | T002, T009 | `package.json` của `@mat/svg-import` và `@mat/symbols` chỉ phụ thuộc `@mat/svg-renderer` và devDependencies đã có; lint `no-regex` | | Đạt (R: đọc `package.json`) |
| FR-064 (rà soát bảo mật) | T112 | | `R:008-security-review.md` chưa có | **Chờ:** đang làm ở lượt khác |
| FR-065 (tài liệu) | T116 | | `packages/*/README.md`, `docs/guides/svg-export.md`, `apps/studio/README.md`, `schemas/README.md`, `docs/deployment/mat-runtime.md` mục 5e; **T115:** `studio-ux.md` mục 3b, `svg-dialects.md` mục importer | Đạt (R: file có mặt) |
| FR-066 (phiên bản: runtime 0.7.0, Studio 0.6.0, ui-components 0.2.0…) | T118 | | `core/project-manager/project_validator.hpp` đã `0.7.0` (T029) | **Chưa:** Studio vẫn `0.5.0`, `@mat/ui-components` vẫn `0.1.0` (T118 chưa làm) |
| FR-067 (trợ năng) | T114 | axe 0 lỗi critical/serious hai theme ở mọi trạng thái; ca bàn phím; `prefers-reduced-motion` | `R:008-a11y.md`; sửa 2 lỗi (F2 focus, lời nhắc nhấp nháy) | **Một phần:** tự động đạt (R); NVDA chờ người; 2 ca bàn phím chưa có (xem SC-015) |

## Tiêu chí thành công (SC-001 đến SC-022)

| SC | Task | Bằng chứng | Trạng thái |
|---|---|---|---|
| SC-001 (10/10 fixture nhập và hiển thị) | T042, T052 | `R:008-fixtures.json`: 10/10 đạt ngay lần đầu; `si/import.test.ts` (R). Hiển thị ở Studio canvas và trang: `E-S/import.e2e.mjs` (xem trước từng fixture), trang qua `E-R` | **Một phần:** đạt trên 4 thật + 6 **mô phỏng**; thật Illustrator và CorelDRAW chờ người (T120) |
| SC-002 (≤ 0,5 % điểm ảnh khác) | T052, T054 | `R:008-fixtures.json`: 0 đến 0,496 % (inkscape-03 sát ngưỡng); PNG Inkscape ≤ 0,934 %; `R:008-stress-x64.json` 0,463 % | Đạt (G); mô phỏng cho 6 file |
| SC-003 (độc hại ≥ 24 ca) | T035, T053 | `R:008-malicious-x64.json` 39 ca, 0 mã chạy, 0 yêu cầu mạng | Đạt (G) |
| SC-004 (dựng lại bồn nước + motor, 0 dòng JSON) | T095, T096 | `E-S/rebuild-tank.e2e.mjs` (32 thao tác, 10/10 theo ghi chú); `tools/svg-demo/compare-tank.mjs` viết sẵn | **Một phần:** Studio đạt (G); so với `tank-demo` trên runtime x64 chưa chạy (T096) |
| SC-005 (mở màn hình chuẩn 3b ≤ 2 s) | T093, T108, T123 | `E-S/symbols.e2e.mjs`: 40 item dựng ≤ 5 s (đo thật, R); `projects/svg-demo --standard` sinh màn hình chuẩn | **Chờ x64** (T108) và **Chờ BL335** (T123) |
| SC-006 (DOM Studio = Chrome) | T067, T076, T107 | `E-S/svg-bind.e2e.mjs` (cùng `DomApplier`, R) | **Một phần:** phía Studio (R); so với trang x64 chờ |
| SC-007 (BL335 30 phút, CPU, RSS) | T108, T124 | | **Chờ x64** và **Chờ BL335** |
| SC-008 (100 phần tử hoạt ảnh, p95 ≤ 8 ms) | T109 | `R:008-anim-x64.json`: 30 phút, 180.016 khung, p95 **2,2 ms**, heap tăng 0,05 MB, tab ẩn 0 callback | Đạt (G) |
| SC-009 (nhập lại: 0 gán sai, ≥ 90 % đúng) | T097 đến T100, T103 | `R:008-fixtures.json`: 210/215 = 97,7 %, 0 gán sai | Đạt (G); tập đo nhỏ |
| SC-010 (ca biên giới hạn) | T007, T036, T042, T054 | `fx/limits.test.mjs`, `si/import.test.ts` (R) | Đạt (R) |
| SC-011 (không hồi quy 0.1 đến 0.3) | T107 | `E-R/compat.e2e.mjs` (0.1 trên trang), `ps/vectors-04.test.ts` (R) | **Một phần:** logic và vector (R); so ảnh `tank-demo`, `modbus-demo`, `dashboard-demo` trên runtime 0.7 chờ x64 |
| SC-012 (vector hai bản, ≥ 100 ca) | T011, T014, T028, T029 | TS `ps/vectors-04.test.ts` (R); C++ `vectors_04_test` 354/354 (G) | Đạt (C++ G) |
| SC-013 (ca khóa của 007, 30 ca tấn công) | T082, T084, T086 | `E-R/svg-events.e2e.mjs` (R: viewer, chưa đăng nhập, khóa, Cancel, `ACCEPTED`…) | **Một phần:** lớp giả (R); tấn công thật trên runtime x64 (T084) chưa có |
| SC-014 (ca hợp biến đổi và hình học) | T026, T076 | `be/anim/transform-state.test.ts`, `clip-level.test.ts`, `E-R/anim.e2e.mjs` (đọc điểm ảnh clipLevel, tâm quay) | Đạt (R) |
| SC-015 (trợ năng, bàn phím) | T059, T076, T082, T103, T114 | `R:008-a11y.md` | **Một phần:** 0 lỗi critical/serious hai theme (R); còn 2 ca bàn phím chưa có (Enter trên thẻ ký hiệu ở Toolbox, F2 khi chọn phần tử từ canvas); NVDA chờ người |
| SC-016 (không hồi quy 004 đến 007) | T023, T111 | `tools/svg-import/regress-sprint0.mjs` (19 file Sprint 0, G); test của 004 đến 007 trong các bộ Vitest nêu trên đều xanh (R) | **Một phần:** checkpoint T111 và `ci-local.ps1` chưa chạy; `svg-load` x64 chờ |
| SC-017 (ký hiệu: 12/12 qua allowlist, UID, điểm gắn) | T088, T094 | `sym/tests/symbols.test.ts`, `ports.test.ts`, `E-S/symbols.e2e.mjs` (R) | Đạt (R) |
| SC-018 (nhập 20.000 ≤ 5 s, cây ≤ 300 ms…) | T062, T077 | `R:008-studio-perf.json`: nhập 1.239 ms, cây 8,1 ms, chọn 11,1 ms, thử giá trị 4 ms, hoàn tác 33,5 ms; đối chiếu 20.000 phần tử ≤ 3 s: chưa có số riêng | **Một phần:** đạt trừ số đo "đối chiếu nhập lại 20.000 phần tử ≤ 3 s" của plan chưa có |
| SC-019 (đạt 100 % quy tắc §5 và §7, khớp mockup) | T115 | `R:008-sc019.md` | **Một phần:** 12 ô "một phần", 4 việc cần vá (xem báo cáo) |
| SC-020 (kỹ sư mới làm trọn ≤ 20 phút) | T131 | | **Chờ người** (không có người thử thì ghi "tự đo"; rủi ro: lệnh nhập chỉ có phím tắt, A1) |
| SC-021 (không `innerHTML`, `eval`, `new Function`) | T009, T020, T110 | `sr/no-regex.test.ts`, ESLint chặn (R trên các file giao diện 008), `R:008-bundle-x64.json` (không `eval`, `innerHTML` trong gói trang) | Đạt (G cho lint toàn repo; R cho file giao diện) |
| SC-022 (khởi động ≤ 250 KB gzip, không có `@mat/svg-import`) | T110 | `R:008-bundle-x64.json`: **82,4 KB**, 0 vết của importer | Đạt (G) |

## Phát hiện lệch (phân tích chéo spec, plan, tasks, mã)

Mức: **Cao** ảnh hưởng nghiệm thu hoặc hành vi người dùng; **Trung** lệch có cách xử lý rõ; **Thấp** tài liệu.

| # | Mức | Phát hiện | Nơi | Đề xuất |
|---|---|---|---|---|
| A1 | Cao | Spec FR-011 và contract §2 nói **"Thêm › Đồ họa SVG…"** nhưng không có menu "Thêm" (menu cố định theo contract 004) và mockup có nút "Nhập SVG…" trên thanh công cụ; bản cài chỉ có Ctrl+Shift+I và bảng lệnh (`apps/studio/src/app/commands.ts`: "không có menu"). SC-020 (người mới làm ≤ 20 phút không cần tài liệu) rủi ro | spec FR-011; contract `studio-svg-editor.md` §2; mockup; `commands.ts` | thêm nút hoặc mục menu; hoặc sửa spec và contract thành "Ctrl+Shift+I và bảng lệnh" |
| A2 | Cao | Spec FR-020 và US1-7 yêu cầu mỗi mục loại có **tên** (ví dụ `onclick`) và **tối đa 3 vị trí ví dụ**. Mục sinh từ allowlist chỉ có mã và số đếm: tên thuộc tính luôn là "thuộc tính", ví dụ luôn rỗng (ảnh e2e `import-1`). Test `si/report.test.ts` chỉ kiểm bộ dựng báo cáo, không kiểm mục từ allowlist, nên lệch lọt qua | `si/import.ts` `recordSanitize`; `sr/sanitize.ts` `SanitizeReport`; `fx/manifest.json` chỉ kiểm tập mã | thêm tên và đường dẫn vào `SanitizeReport`; thêm ca vào `import.test.ts`; sửa ở `packages/svg-renderer` (đang rà soát bảo mật: làm sau lượt đó) |
| A3 | Trung | US2-8 yêu cầu Studio nhắc nhấp nháy không được là tín hiệu duy nhất: **không có** trong inspector. Đã sửa ở T114 (đỏ rồi xanh) | `props-svg-bind.ts` | đã xong |
| A4 | Trung | F2 trong cây phần tử không đưa focus vào ô tên: người dùng bàn phím không đổi được tên (FR-030, SC-015). Đã sửa ở T114 | `svg-element-tree.ts` | đã xong |
| A5 | Trung | SC-015 yêu cầu **100 %** lệnh dùng được bằng bàn phím; bằng chứng tự động còn thiếu ca cho: Enter trên thẻ ký hiệu ở Toolbox, F2 khi chọn phần tử từ canvas, và không có kiểm tay NVDA | `R:008-a11y.md` | thêm 2 ca e2e; NVDA ở T127 |
| A6 | Trung | US4-1 yêu cầu mỗi ký hiệu hiển thị **nguồn gốc (do dự án vẽ, CC0)**: có ở `sym/manifest.json` và `LICENSES.md`, không hiện ở Toolbox | `apps/studio/src/ui/mat-taskcards.ts` | hiện ở chú giải ô hoặc dòng cuối nhóm |
| A7 | Trung | SC-019 viết "100 %" nhưng bảng đối chiếu thật còn 12 ô "một phần" và 3 khác biệt so mockup (nền ô ký hiệu mã màu cứng `#eceff1`, hai chữ phụ dưới 12 px, thanh tiến độ lặp 1,1 s) | `R:008-sc019.md` | vá hoặc nới SC-019 thành "100 % trừ ngoại lệ ghi ở báo cáo" |
| A8 | Trung | Plan có hàng "Đối chiếu nhập lại 20.000 phần tử ≤ 3 s" gắn SC-009, nhưng spec SC-009 không nêu số này và không có task đo nó | plan "Performance Goals"; SC-009; T100, T077 | thêm vào spec SC-018 hoặc thêm phép đo vào T077 |
| A9 | Trung | Trạng thái `[X]` của T114 che phần chờ người (NVDA), tương tự T120 và T116 (hướng dẫn Illustrator, CorelDRAW chưa kiểm trên phần mềm thật). Dễ bị đọc là "xong" | `tasks.md` T114, T116 | tách thành T114b (NVDA) hoặc ghi cờ 👤 vào dòng |
| A10 | Thấp | Các checkpoint T032, T062, T078, T086, T096, T104, T111 chưa làm và `docs/reports/008-acceptance.md` chưa có, trong khi số đo nằm rải ở ghi chú task và các `008-*.json`. Bảng này gom tạm; T128 phải gom vào báo cáo nghiệm thu | tasks, `docs/reports` | T128 |
| A11 | Thấp | `tasks.md` Quy ước ("phiên viết tài liệu này không sửa mã sản phẩm", "task chỉ bắt đầu khi `ci-local` xong") và plan "Constraints" cùng ý đã lỗi thời: mã đã sửa gần hết | `tasks.md` Quy ước; plan "Constraints" | xóa hoặc đánh dấu "đã qua" |
| A12 | Thấp | `spec.md` còn `Status: Draft`; ADR 023 đến 026 còn Proposed | spec đầu file; `docs/adr/` | cập nhật ở T128 và T129 |
| A13 | Thấp | Phiên bản: `apps/studio/package.json` 0.5.0 và `packages/ui-components/package.json` 0.1.0 trong khi FR-066 và plan nói 0.6.0 và 0.2.0 (runtime đã 0.7.0 ở `project_validator.hpp`) | T118 chưa làm | làm T118 |
| A14 | Thấp | Số liệu mâu thuẫn giữa task: T036 ghi 25 ca giới hạn, `fx/limits.test.mjs` 9 test; plan ghi "≥ 12 ca giới hạn". Nhất quán (≥ 12), chỉ ghi để khỏi nhầm | plan, T036 | không cần xử lý |
| A15 | Thấp | Ba ca "x64" (T084 sự kiện, T107 hiển thị và tương thích, T108 đo tải) chặn đóng SC-005, 006, 007, 011, 013 (phần thật), 016. Không có lỗi thiết kế, chỉ là việc chờ | tasks | chạy `web-it` khi có Docker |

**Kiểm chéo hoàn tất (không phát hiện lệch):** số task theo story ở Notes cộng đủ 131; FR-031 "13 dòng" khớp FR-032 đến FR-039 (1 + 2 + 1 + 2 + 3 + 1 + 1 + 2 = 13); mã lỗi trong spec (`E_DUP_BINDING`, `E_RANGE`, `E_EVENT_*`, `W_ANIM_MANY`, `E_LIMIT`, `E_REF_UID`, `E_SVG_UNSAFE`, `E_SVG_LIMIT`, `W_SVG_HEAVY`, `E_MIN_RUNTIME`) đều có trong `rules-04*.ts`; mã C++ có trong `core/project-manager` (trừ ba mã `*_SVG_*` chỉ ở TS theo D30: đúng thiết kế); 12 ký hiệu và 15 tệp nhất quán giữa plan, spec và Toolbox (e2e: 15).
