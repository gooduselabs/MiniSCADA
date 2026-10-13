# Implementation Plan: Nhập SVG, gắn Tag cho phần tử SVG, animation và sự kiện

**Branch**: `008-svg-import-binding` | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/008-svg-import-binding/spec.md`

## Summary

GĐ 3b của [lộ trình v2](../../docs/plans/roadmap-v2.md) (§4.4), một feature (D1). Kỹ sư nhập SVG vẽ ngoài (Inkscape, Illustrator, CorelDRAW) vào Studio một cách an toàn, gắn Tag và sự kiện cho từng phần tử bằng inspector (không viết JSON), dùng thư viện ký hiệu cơ bản, và người vận hành thấy đồ họa chuyển động, nhấp được trên Chrome.

Cách làm ([research.md](research.md) R1–R24):

- **Định dạng 0.4.0** (ADR-024, 025): giữ cấu trúc màn hình của 0.3; file binding thêm đích (`transform.translateX/Y`, `transform.scale`, `geometry.clipLevel`, `effect.blink`, `effect.flow`), phép biến đổi `rangeMap`, tham số (`pivot`, `axis`, `period`, `dash`, `speed`…) và `events.click`; trần item `svg` 8 → 64. Nâng cấp 0.3 → 0.4 chỉ đổi số phiên bản. Runtime 0.7 nhận 0.1–0.4. **API thiết bị giữ 1.2.0, giao thức live giữ 1.2.0**.
- **Importer và allowlist** (ADR-023): `sanitizeSvg` của `@mat/svg-renderer` thành allowlist trên DOM đã parse (duyệt bằng vòng lặp, tra bảng, không regex), dùng cho cả trang runtime (lớp phòng thủ thứ hai) và Studio; package mới `@mat/svg-import` (chỉ Studio, CLI, test) thêm bộ quét tiền xử lý (DTD, entity, mã hóa), bộ phân tích CSS tự viết (cascade → thuộc tính), chuẩn hóa (đơn vị, `switch`, `flowRoot`, font), Tối ưu (gộp hình, tùy chọn), gán UID (`data-mat-uid`, `data-mat-name`), bộ ghi SVG tất định và **báo cáo**. Giới hạn 5 MiB / 20.000 phần tử / độ sâu 32 (thô 100.000, `use` hiệu dụng 100.000).
- **Nhập lại giữ UID** (ADR-023): chữ ký tính từ thuộc tính (không layout), bốn bước UID → `id` → cấu trúc → hình học, ngưỡng hiệu chỉnh bằng bộ cặp, mơ hồ thì hỏi, mồ côi chặn Nạp xuống.
- **Binding và animation** (ADR-024): `DomApplier` mở rộng; hợp biến đổi bằng ma trận tường minh `translate · M0 · quay · co giãn` (giữ `transform` gốc, sửa lỗi im lặng của 0.2); `clipLevel` bằng `clipPath` sinh lúc chạy; nhấp nháy, dòng chảy, quay liên tục bằng Web Animations (một hoạt ảnh mỗi phần tử, tạm dừng khi tab ẩn, tôn trọng `prefers-reduced-motion`).
- **Sự kiện SVG** (ADR-025): dữ liệu trong file binding; `svgActionController` dựng widget ảo cho `ControlController` của 007 (khóa, xác nhận, kết quả dùng chung); `context.widget` = `elementUid`; không thêm đường ghi.
- **Studio** (ADR-026): vào item bằng nhấp đúp, chọn phần tử bằng `elementsFromPoint` và cây phần tử dựng lười; inspector Gắn Tag sinh từ danh sách 13 mục động hóa; Gợi ý; Thử giá trị bằng `SimEngine`; hộp thoại Nhập SVG và Đối chiếu lại; Toolbox Ký hiệu SVG với dính điểm gắn; một lệnh Rust mới `svg_open`.
- **Thư viện ký hiệu** (ADR-026): `@mat/symbols`, 12 ký hiệu (15 tệp) do dự án vẽ (CC0), bộ phận có UID cố định và điểm gắn; thể hiện = item `svg`.
- **Nghiệm thu:** 10 fixture (4 Inkscape xuất thật bằng CLI, 3 Illustrator và 3 CorelDRAW **mô phỏng**, ghi rõ giới hạn), ≥ 24 ca độc hại, so ảnh trong Chrome, dựng lại màn hình bồn nước + motor trong Studio, đo RSS, CPU, thời gian mở.

Quyết định ghi trong ADR [023](../../docs/adr/023-svg-import-allowlist-uid.md), [024](../../docs/adr/024-binding-animation-0.4.md), [025](../../docs/adr/025-svg-element-events.md), [026](../../docs/adr/026-symbol-library-svg-editing.md) (Proposed). Bố cục giao diện: mockup [studio-svg.html](../../docs/architecture/mockups/studio-svg.html) (task tạo trước code giao diện, phiên làm việc tự duyệt).

**Phiên bản:** runtime 0.7.0; Studio 0.6.0; định dạng project 0.4.0; API thiết bị 1.2.0 (không đổi); giao thức live 1.2.0 (không đổi; alarm GĐ 4 vẫn là 1.3.0); gói `.matscada` 1.0.0 (không đổi); `@mat/ui-components` 0.2.0; `@mat/svg-import` 0.1.0; `@mat/symbols` 0.1.0.

## Technical Context

**Language/Version**:

- TypeScript 7 (Vite 8, Lit 3.3.3), Node ≥ 22 cho công cụ;
- C++17 (GCC 9 trong Docker Ubuntu 20.04; cross `arm-linux-gnueabihf`): chỉ validator 0.4 và hằng số phiên bản;
- Rust 1.99, edition 2024 (Tauri 2.12): một lệnh `svg_open`;
- PowerShell, sh.

**Primary Dependencies**: **không thêm thư viện ngoài** (R22). Dùng: Lit, `@fluentui/svg-icons` (thêm icon), jsdom, puppeteer-core, axe-core (đều đã có). Package mới trong workspace: `@mat/svg-import`, `@mat/symbols`. Công cụ: Inkscape CLI trên máy dev (không vào repo) để tạo 4 fixture thật.

**Storage**:

- **BL335:** không đổi (không bảng, không file bền mới). Phục vụ thêm file `graphics/**/*.svg` và binding qua `/project/` (allowlist có sẵn).
- **Project:** `graphics/*.svg`, `graphics/symbols/*.svg`, `screens/<màn hình>.<item>.bindings.json`; `.mat-backup/` khi nâng cấp 0.3 → 0.4.
- **Trình duyệt:** trạng thái hoạt ảnh trong RAM; không dùng `localStorage` cho dữ liệu nghiệp vụ.

**Testing**:

- Vitest (jsdom, đồng hồ giả, Web Animations giả): allowlist, tiền xử lý, CSS, chuẩn hóa, Tối ưu, UID, đối chiếu, importer trên fixture, `DomApplier`, `svgActionController`, `bindSvgEvents`, `rules-04`, vector chung;
- GoogleTest + CTest x64 (Docker): luật C++ 0.4 và vector chung; armhf dưới qemu-user (thêm test module nếu có target mới);
- e2e Chrome headless (lớp Tauri giả, axe-core): Studio (nhập, chọn, gắn, sự kiện, nhập lại, ký hiệu, dựng lại `tank-demo`) và trang runtime (hoạt ảnh, sự kiện);
- harness SVG độc hại (Chrome headless, canary, chặn mạng); so ảnh trong trang Chrome (canvas);
- tích hợp x64 `tools/web-it.ps1 -Scenario svg` (runtime x64, giả lập Modbus, Chrome headless, 30 ca tấn công của 007 với nguồn phần tử SVG);
- đo hoạt ảnh `tools/measure/anim-bench.mjs`;
- thử tay: bộ gõ (tên phần tử, nhãn), trình đọc màn hình, Chrome và WebView2 thật, file thật từ Illustrator/CorelDRAW;
- đo trên BL335 ở task ⚠️🔌 (SSH và người).

**Target Platform**: BL335 (armv7l, 2 × Cortex-A7, 993 MB RAM, Ubuntu 20.04.5, systemd 245, eMMC ext4); Chrome/Chromium ≥ 120; Studio trên Windows 10/11 (WebView2).

**Project Type**: dịch vụ nhúng C++ (mở rộng validator của `mat-runtime`), ứng dụng web TS (`apps/runtime-web`: thay đổi nhỏ), package TS dùng chung (`@mat/svg-renderer`, `@mat/binding-engine`, `@mat/ui-components`, `@mat/project-schema`, `@mat/svg-import`, `@mat/symbols`), ứng dụng desktop Tauri (Studio).

**Performance Goals**:

| Mục tiêu | Ngưỡng | Nguồn |
|---|---|---|
| Mở màn hình chuẩn 3b (≈ 3.000 phần tử SVG, 30 binding, 10 hoạt ảnh, 100 Tag) | ≤ 2 s tới giá trị sống; 10 client F5 ≤ 5 s; 40 item `svg` ≤ 2 s | SC-005 |
| BL335, 10 client, 500 Tag, 30 phút | CPU ≤ 30 %, RSS ≤ 150 MB, 0 mất sequence | SC-007 |
| 100 phần tử hoạt ảnh, 30 phút (Chrome, máy dev) | p95 khung ≤ 8 ms, bộ nhớ +≤ 50 MB; tab ẩn: 0 callback | SC-008 |
| Nhập SVG 20.000 phần tử | ≤ 5 s (báo cáo ≤ 3 s, ghi tài liệu ≤ 2 s) | SC-018 |
| Mở cây phần tử; chọn bằng nhấp; Thử giá trị; hoàn tác | ≤ 300 ms; ≤ 50 ms; ≤ 100 ms; ≤ 100 ms | SC-018 |
| Đối chiếu nhập lại 20.000 phần tử | ≤ 3 s | SC-009 |
| Từ chối file 5 MiB + 1 | ≤ 50 ms (không parse) | SC-010 |
| Tải khởi động của trang | ≤ 250 KB nén gzip | SC-022 |

**Constraints**:

- Ngân sách Constitution III: phía BL335 chỉ thêm luật kiểm tra lúc nạp (vài trăm dòng C++) và danh sách đường dẫn; ước tính RSS tăng < 0,5 MB (R20).
- Mỗi file JSON ≤ 1 MiB (gói 005); file binding của item ≤ 2.000 phần tử × ≤ 16 binding: thực tế vài KB đến vài chục KB.
- File SVG của item ≤ 5 MiB (`E_SVG_LIMIT`); cảnh báo từ 1 MiB (`W_SVG_HEAVY`).
- `core/` không parse SVG (Constitution II): mã phụ thuộc nội dung SVG chỉ ở bản TS.
- Không thêm GPL/LGPL; không thêm thư viện.
- Không sửa `specs/004`…`007`; điểm 008 đổi so với 007: trần item `svg` (D26 của 007: 8 → 64, ghi ở ADR-026), hành vi `transform.rotate` (ADR-024), mở rộng ADR-003 mục 4 (`data-mat-name`).
- SSH tới BL335 không có trong phiên viết kế hoạch: bước trên BL335 chờ quyền hoặc người dùng tự chạy lệnh ([quickstart.md](quickstart.md) §8).
- Ổ D: máy dev còn ít chỗ (build Rust và C++ trên C:).
- **Phiên viết tài liệu này không sửa mã sản phẩm** (đang có lượt `ci-local` chạy trên cây mã): mọi mô tả "đã có" dựa trên đọc mã ngày 2026-10-13.

**Scale/Scope**:

- ≤ 64 item `svg` và ≤ 250 item mỗi màn hình; ≤ 2.000 phần tử khai báo mỗi item; 13 loại động hóa; 12 ký hiệu (15 tệp); 10 fixture + ≥ 24 ca độc hại + ≥ 12 ca giới hạn + ≥ 6 cặp nhập lại.
- Khoảng 3 module C++ sửa nhỏ (`core/project-manager`, `server/startup` hằng phiên bản, `server/http` `system/info`); 2 package TS mới; 5 package/ứng dụng TS sửa; 1 lệnh Rust; 0 endpoint mới; 4 ADR; 3 hộp thoại và 2 editor/nhóm inspector Studio mới.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution 2.0.1.

| Nguyên tắc | Đánh giá | Ghi chú |
|---|---|---|
| I. Vertical slice trên thiết bị thật | ✅ (cần đo) | Mọi chức năng chạy và kiểm trên x64 và Chrome headless trước; nghiệm thu trên BL335 ở task ⚠️🔌 (SC-005, SC-007). Chưa có file Illustrator/CorelDRAW thật: nêu rõ ở D23 |
| II. Ranh giới kiến trúc | ✅ | `core/` không parse SVG (mã phụ thuộc SVG chỉ TS); allowlist, importer, `DomApplier`, widget ảo dùng chung Studio và Chrome; render và animation trên Chrome, không trên BL335; `apps/runtime-web` chỉ hiển thị, tương tác và gọi API; `@mat/svg-import` chỉ ở Studio và công cụ (Studio chứa logic soạn thảo, không phải logic runtime) |
| III. Ngân sách tài nguyên | ✅ (cần đo) | Phía BL335 gần như không đổi (R20); phía máy khách có số đo riêng (SC-008); đo SC-007 trên x64 và BL335; không nén file project: rủi ro ghi rõ, cảnh báo `W_SVG_HEAVY` |
| IV. Chrome ≥ 120, 10 client | ✅ | Chỉ dùng API có từ Chrome 84–104 (Web Animations, `getBBox`, `elementsFromPoint`, `ResizeObserver`, `prefers-reduced-motion`); không thêm phiên live; live 1.2.0 không đổi |
| V. An toàn, bảo mật (NON-NEGOTIABLE) | ✅ (cần rà soát) | **Allowlist trên DOM đã parse, không regex, có giới hạn kích thước/node/độ sâu** (đúng điều khoản của nguyên tắc V); không `eval`, không script; sự kiện SVG qua cùng đường ghi có HTTPS, đăng nhập, role, audit (007); trang lọc lại SVG khi dựng. **Giới hạn còn lại ghi rõ:** runtime C++ không từ chối được gói có SVG độc (D30); lớp phòng thủ là allowlist của trang, CSP của `/project/` và chặn của Studio khi đóng gói; rà soát bảo mật là task bắt buộc (FR-064) |
| VI. Test trước | ✅ | Test viết trước theo FR-059: vector chung, bộ độc hại, fixture, applier, controller, e2e; mỗi task cài đặt đi sau task test đỏ |
| VII. Đơn giản, có phiên bản | ✅ | Đúng phạm vi GĐ 3b (không trình vẽ, faceplate, alarm, lịch sử). YAGNI: chỉ sự kiện `click`; không biểu thức; không sửa SVG trong Studio; không nối ống tự động. SemVer: 0.3 → 0.4 có migration; runtime 0.7.0; API và live giữ nguyên. Không thêm thư viện |
| Ràng buộc công nghệ | ✅ | C++17/CMake; Studio Tauri 2 + TS + Vite + Lit; Rust thêm một lệnh theo khuôn `csv_open`; SVG.js và interact.js (Master Plan §4) **không dùng**: canvas là DOM thật (ADR-022 của 007) |
| Quy trình | ✅ | Spec Kit; ADR 023–026; mockup trước code giao diện; thao tác BL335 chỉ khi người dùng cho phép |

**Kết quả trước Phase 0:** đạt. Không có `NEEDS CLARIFICATION`: mọi điểm spec để ngỏ đã chọn ở research, ghi "Quyết định (người dùng giao toàn quyền 2026-10-11)".

**Kiểm lại sau Phase 1** (data-model, contracts):

- Không phát sinh vi phạm mới.
- **Bề mặt mới:** (1) nhập file SVG không tin cậy ở Studio (bộ quét, parser, allowlist, CSS); (2) sự kiện nhấp phần tử SVG ghi Tag (cùng đường ghi); (3) lệnh Rust `svg_open` (đọc file qua hộp thoại hệ thống). Không endpoint mới, không cookie mới.
- **Điểm thay đổi so với tài liệu cũ:** ADR-003 mục 4 (thêm `data-mat-name`) và mục 6 (đặt ngưỡng đối chiếu), ADR-007 (denylist → allowlist), ADR-004 (0.4), D26 của 007 (trần 8 → 64): cả bốn ghi ở ADR 023–026; bảng ADR cập nhật khi chuyển Accepted.
- **Điểm cần phiên chính duyệt:** câu hỏi 1–5, 9 ở mục "Câu hỏi cho phiên chính" (đã trả lời).

## Project Structure

### Documentation (this feature)

```text
specs/008-svg-import-binding/
├── spec.md
├── plan.md                         # file này
├── research.md                     # R1–R24
├── data-model.md                   # binding 0.4, importer, ký hiệu, trang, Studio
├── quickstart.md                   # test, nhập SVG, Studio, web-it, lệnh chỉ đọc BL335, BL335 ⚠️🔌
├── contracts/
│   ├── project-format-0.4.md       # schema 0.4.0, mã lỗi, migration, vector
│   ├── svg-import.md               # allowlist, importer, báo cáo, nhập lại, độc hại, fixture
│   ├── binding-animation.md        # đích, miền, hợp biến đổi, hoạt ảnh, API DomApplier
│   ├── svg-events.md               # sự kiện, gắn lúc chạy, khóa, audit
│   ├── symbol-library.md           # manifest, 12 ký hiệu, điểm gắn
│   └── studio-svg-editor.md        # lệnh, hộp thoại, inspector, chọn phần tử, svg_open, e2e dựng lại
├── checklists/requirements.md
└── tasks.md                        # /speckit-tasks
docs/adr/023, 024, 025, 026; docs/architecture/mockups/studio-svg.html; docs/guides/svg-export.md
```

### Source Code (repository root)

```text
schemas/
├── 0.3/                                      # (mới) đóng băng 0.3
├── project.schema.json, screen.schema.json, binding.schema.json, tag.schema.json, …  # → 0.4.0
└── protocol-version.json                     # project ["0.1","0.2","0.3","0.4"]; live 1.2.0

core/project-manager/
├── rules_04.{hpp,cpp}                        # (mới) đích, tham số, rangeMap, sự kiện, giới hạn hoạt ảnh; dùng lại rules_03
└── project_validator.cpp                     # (sửa) chọn schema 0.4; tập file không đổi; summary 0.4 như 0.3
server/                                       # (sửa nhẹ) RUNTIME_VERSION 0.7.0, system/info.schemaVersions
deployment/package-runtime.ps1                # (sửa) chép schemas/0.3/

packages/
├── svg-renderer/src/                         # (sửa) allowlist.ts, css-value.ts, sanitize.ts (viết lại), transform-parse.ts, mount.ts, index.ts; inspect.ts dùng lại
├── svg-import/                               # (mới) prescan.ts, css.ts, normalize.ts, optimize.ts, uid.ts, name.ts, signature.ts, match.ts, write.ts, report.ts, import.ts, i18n/vi-import.ts
├── symbol-library/                           # (mới) manifest.json, svg/*.svg, src/, tests
├── binding-engine/src/                       # (sửa) applier.ts, transforms.ts, anim/{transform-state,clip-level,blink,flow,spin}.ts
├── ui-components/src/                        # (sửa) screen/{svg-item,svg-events,mat-screen}.ts, control/svg-action-controller.ts, i18n
└── project-schema/src/                       # (sửa) types-04.ts, rules-04.ts, migrate.ts (migrate03to04), codes.ts, project-files.ts, compare.ts, rename.ts

apps/runtime-web/                             # (không đổi mã; thêm e2e svg-unsafe, anim, svg-events; sửa CSS nếu vùng trạng thái cần) — route, menu, đăng nhập giữ nguyên
apps/studio/
├── src/model/                                # svg-doc, svg-binding-doc, animation-catalog, svg-suggest, svg-issues, import-flow, reimport-flow, symbol-flow, svg-select
├── src/ui/                                   # dialogs/{import-svg,import-report,reimport}, screen/mat-svg-overlay, editors/svg-element-tree, props-svg-{element,bind,events}, test-strip, mat-taskcards (Ký hiệu SVG)
├── src/workers/import.worker.ts              # (mới) importSvg ngoài luồng chính
├── src/i18n/{vi-svg,vi-import}.ts
└── src-tauri/src/svg.rs                      # lệnh svg_open

tests/
├── fixtures/svg-import/                      # 10 fixture, malicious/ (≥ 24), reimport/ (≥ 6 cặp), limits.mjs, manifest.json, README.md
├── project-vectors/                          # v04-* (≥ 100)
├── migration-vectors/                        # cặp 0.3 → 0.4
└── web-it/                                   # kịch bản svg
tools/
├── svg-inspect/svg-inspect.mjs               # (sửa) --import
├── svg-import/malicious-harness.mjs, compare-images.mjs   # (mới)
├── svg-fixtures/                             # make-inkscape.ps1, make-simulated.mjs, src/*.svg
├── measure/anim-bench.mjs                    # (mới)
├── project-validator/validate.mjs            # (sửa) 0.4, --migrate 0.3→0.4
└── svg-demo/generate.mjs                     # (mới) sinh projects/svg-demo
projects/svg-demo/                            # project mẫu 0.4.0 (sinh bằng script)
docs/
├── architecture/mockups/studio-svg.html, svg-dialects.md (mục importer), studio-ux.md (mục 3b)
├── guides/svg-export.md
└── reports/008-acceptance.md, 008-fixtures.json, 008-sc019.md, 008-security-review.md, 008-fr-matrix.md, device-changes.md
```

**Structure Decision:**

- **BL335:** chỉ `core/project-manager` thêm luật 0.4 (thư viện độc lập CivetWeb, unit test không cần mạng); `server/` chỉ đổi hằng số.
- **Hàm thuần có test trước:** `prescan`, `css` (cascade), `normalize`, `optimize`, `uid`, `signature`, `match`, `write`, `allowlist`, các hàm kiểm giá trị, `evaluateBinding` mở rộng, `transform-state`, `portSnap`, `svg-suggest`, `rules-04` (hai bản), `migrate03to04`.
- **Dùng chung (Constitution II):** allowlist ở `@mat/svg-renderer`; `DomApplier` ở `@mat/binding-engine`; `svgActionController`, `bindSvgEvents` ở `@mat/ui-components`; trang runtime và Studio chỉ cấp `TagSource`, `ActionHost`, `StatusSink`.
- **`@mat/svg-import` tách khỏi `@mat/svg-renderer`:** giữ gói của trang nhỏ (SC-022); importer chỉ chạy ở Studio, CLI và test.
- **Studio:** quyết định ở TS thuần (`model/`), giao diện chỉ hiển thị; mạng và file qua Rust (một lệnh mới).

### Ảnh hưởng tới mã của 004…007

Cả bốn feature đã xong về mã (commit gần nhất `634d528`); lượt `ci-local` đang chạy trên cây mã khi viết tài liệu này, nên **mọi sửa mã chờ lượt đó xong** (nêu ở tasks, "Quy ước"). File chung vẫn chỉ nên thêm dòng hoặc khối mới.

| File | Thay đổi | Rủi ro hồi quy |
|---|---|---|
| `packages/svg-renderer/src/sanitize.ts`, `mount.ts` | denylist → allowlist | cao: `svg-load` (19 file), `mount.test.ts`, `sanitize.test.ts`, `inspect.test.ts`, e2e 007; fixture Sprint 0 phải hiển thị như cũ trừ phần loại có chủ ý |
| `packages/binding-engine/src/{applier,transforms}.ts` | đích mới, hợp biến đổi, hoạt ảnh | cao: test 0.2 hiện có xanh; `compat` (SC-011); sửa lỗi `transform` gốc có test riêng |
| `packages/project-schema/src/{rules-03,validate,codes,compare,rename,project-files,migrate}.ts` | luật 0.4, mã mới, migration | cao: 82 ca 0.1, ca 0.2 và 0.3 giữ kết luận (SC-012) |
| `core/project-manager/*` | `rules_04`, chọn schema 0.4 | cao: ctest đầy đủ, vector chung hai bản |
| `schemas/*` | 0.4.0, `schemas/0.3/` | trung bình: `meta-schema.test.ts`, `schema-0x.test.ts` |
| `packages/ui-components/src/screen/{mat-screen,svg-item}.ts` | gắn sự kiện SVG, `StatusSink`, `tagUnits` | trung bình: e2e `screens`, `control` của 007 |
| `apps/studio/src/ui/props-element.ts` | thay bằng `props-svg-element.ts` (chỉnh sửa được) | trung bình: giữ e2e 004–007 |
| `apps/studio/src/ui/screen/mat-screen-canvas.ts`, `model/screen-edit/gesture.ts` | chế độ "vào item", chọn phần tử | trung bình: hình học của 007 (SC-014 của 007) giữ xanh |
| `apps/studio/src/ui/mat-taskcards.ts`, `model/{project-doc,tree,rename-flow,xref,compare-view}.ts` | Toolbox Ký hiệu, tài liệu SVG, đổi tên Tag, "Dùng ở đâu", so sánh | thấp |
| `apps/studio/src-tauri/src/lib.rs` | đăng ký `svg_open` | thấp: `cargo test --lib` |
| `CMakeLists.txt`, `package.json`, `eslint.config.mjs`, `tools/ci-local.ps1`, `schemas/protocol-version.json`, `deployment/package-runtime.ps1` | target, workspace, glob lint, bước CI, phiên bản | thấp |

## Thứ tự làm (gợi ý cho `/speckit-tasks`)

0. **Làm ngay, không phụ thuộc gì** (chỉ tài liệu, công cụ, spike; không chạm mã sản phẩm):
   - mockup (T004) và duyệt (T005);
   - **spike** T006 (Chrome: chuỗi `transform` hợp với `M0`, `clipPath` trong Shadow DOM, nội suy `matrix()`), T007 (Tối ưu trên file stress, kích thước UID), T008 (Inkscape CLI chạy được, bản vẽ nguồn).
1. **Nền dùng chung** (file mới hoặc thêm khối):
   - schema 0.4.0 và `schemas/0.3/`; `types-04.ts`, `rules-04.ts`, `migrate03to04`, mã mới, vector `v04-*`, cặp migration;
   - **allowlist** thay denylist trong `@mat/svg-renderer` (nợ bảo mật, làm sớm), `transform-parse`, hàm kiểm giá trị;
   - `@mat/binding-engine`: chuyển đổi (`rangeMap`, định dạng chữ) và `transform-state` (hàm thuần);
   - `@mat/symbols` (SVG và manifest, độc lập), thư mục fixture, bộ độc hại.

   **Mốc:** vector chung xanh ở bản TS; allowlist qua 19 file Sprint 0 (`svg-load`); các hàm thuần xanh.
2. **Validator C++ 0.4 và runtime 0.7.0:** `rules_04`, chọn schema, `RUNTIME_VERSION`, `system/info`, `package-runtime.ps1`; **mốc:** vector chung xanh ở hai bản (SC-012); project 0.1–0.3 qua mọi kiểm tra của 004–007 (SC-011, SC-016).
3. **US1: importer** (`@mat/svg-import`, báo cáo, CLI, fixture, harness độc hại), rồi Studio: `svg_open`, hộp thoại Nhập SVG; **mốc:** 10 fixture nhập và so ảnh đạt, bộ độc hại đạt (SC-001…SC-003, SC-010).
4. **US2: binding bằng inspector:** `DomApplier` (các đích, hoạt ảnh), chọn phần tử, cây phần tử, inspector Gắn Tag, Gợi ý, Thử giá trị, đổi tên Tag, "Dùng ở đâu"; **mốc:** e2e gắn từng loại animation xanh (SC-006, SC-014).
5. **US3: sự kiện SVG:** `svgActionController`, `bindSvgEvents`, nhóm Sự kiện, web-it `svg` (kể cả 30 ca tấn công của 007); **mốc:** SC-013 xanh trên x64.
6. **US4: ký hiệu:** Toolbox, thể hiện, điểm gắn, Gắn nhanh, dựng lại `tank-demo`; **mốc:** SC-004, SC-017.
7. **US5: nhập lại:** chữ ký, đối chiếu, hiệu chỉnh ngưỡng, hộp thoại Đối chiếu lại; **mốc:** SC-009.
8. **US6:** nâng cấp 0.3 → 0.4 ở Studio, `compat`, `web-it svg`, đo hoạt ảnh, đo x64.
9. **Hoàn thiện:** rà soát bảo mật (FR-064), trợ năng, đối chiếu studio-ux, tài liệu, báo cáo, ADR chuyển Accepted (phần đã đo), đóng gói Studio 0.6.0 và runtime 0.7.0.
10. **BL335 ⚠️🔌**, khi người dùng cho phép: [quickstart.md](quickstart.md) §8.

**Theo user story:**

| Story | Gồm |
|---|---|
| US1 (P1) Nhập SVG an toàn | bước 1 (allowlist), 3 |
| US2 (P1) Gắn Tag bằng inspector | bước 1 (binding), 4 |
| US3 (P1) Sự kiện | bước 5 |
| US4 (P2) Ký hiệu và dựng lại màn hình | bước 1 (symbols), 6 |
| US5 (P2) Nhập lại giữ UID | bước 7 |
| US6 (P3) Hiển thị, hiệu năng, an toàn | bước 2, 8 |

Bước 1 (allowlist) và bước 3 phải xong, kể cả rà soát bảo mật, trước khi phát hành runtime 0.7 lên BL335 có port-forward: trang là lớp phòng thủ thứ hai duy nhất chống SVG độc trên đĩa (D30).

## Rủi ro

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Illustrator và CorelDRAW chỉ có mô phỏng: file thật xuất khác | Cao | Ghi rõ giới hạn (D23); đặc trưng theo `svg-dialects.md`; allowlist và chuẩn hóa không dựa vào tên phần mềm; task chờ file thật của người dùng; hướng dẫn xuất ở `docs/guides/svg-export.md` |
| Nhập lại gán nhầm UID, binding gắn sai phần tử, hiển thị sai trạng thái thiết bị | Cao | 0 gán sai tự động (SC-009); mơ hồ thì hỏi; mồ côi chặn Nạp xuống; bộ cặp có đáp án; ngưỡng hiệu chỉnh bằng số đo |
| Allowlist chặt làm mất hình của file thật (loại nhầm) | Trung bình | 10 fixture, 19 file Sprint 0, báo cáo nói rõ loại gì; bảng cho phép mở rộng bằng dữ liệu; so ảnh trước/sau |
| CSS cascade lệch làm sai màu | Trung bình | Bộ ca cascade theo đặc tả; so ảnh với bản gốc ≤ 0,5 %; bộ chọn lạ cảnh báo `W_IMPORT_CSS_PARTIAL` |
| Hợp biến đổi sai với `transform` gốc; `clipPath` trong Shadow DOM không phân giải `url(#id)` | Trung bình | Spike T006 trên Chrome trước khi viết mã; dự phòng ghi ở R9, R10 |
| Chọn phần tử, cây phần tử chậm với SVG 20.000 phần tử | Trung bình | Dựng lười; `elementsFromPoint`; đo SC-018 sớm |
| Hiệu năng hoạt ảnh trên Chrome ở máy yếu | Trung bình | Giới hạn 64 (cảnh báo) và 256 (lỗi); một hoạt ảnh mỗi phần tử; tạm dừng khi tab ẩn; đo SC-008; điều chỉnh sau khi có số đo máy yếu |
| 10 client F5 cùng lúc với SVG lớn không nén vượt 5 s trên BL335 | Trung bình | `W_SVG_HEAVY` từ 1 MiB; chuẩn hóa gọn; đo SC-005 trên BL335 (⚠️🔌); điều kiện xem xét lại: nén tại runtime |
| Runtime C++ không từ chối được gói có SVG độc (không parse SVG) | Trung bình | Allowlist ở trang; CSP của `/project/`; Studio chặn khi đóng gói; ghi giới hạn trong rà soát bảo mật |
| Thay đổi hành vi quay (giữ `transform` gốc) làm hiển thị 0.2 đổi | Thấp | Chỉ đổi khi phần tử có `transform` gốc (trước đó sai); test riêng; ghi ADR-024 và báo cáo |
| Phạm vi lớn (6 story, importer, applier, inspector, ký hiệu, nhập lại) | Cao | Thứ tự P1 trước; mốc sau mỗi bước; mọi hiệu ứng thêm bằng dữ liệu (`animation-catalog`) |
| Không có SSH tới BL335 | Cao | Đo x64 trước; task ⚠️🔌; lệnh chỉ đọc cho người dùng |
| Inkscape CLI không có hoặc khác phiên bản | Thấp | T008 kiểm trước; ghi phiên bản vào `manifest.json`; không có thì dừng, không giả file "thật" |
| Thiếu người thử bộ gõ, trợ năng, WebView2 thật | Trung bình | Tự đo, ghi rõ; kiểm tay ở §7 quickstart |

## Câu hỏi cho phiên chính

**Đã trả lời 2026-10-13** (phiên làm việc; người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11; mọi điểm dưới đây có thể xem lại khi người dùng quay lại):

1. **Định dạng 0.4.0 thay vì mở rộng 0.3:** **đồng ý** (R1; runtime 0.6 sẽ hiển thị sai im lặng nếu để 0.3).
2. **Nâng trần item `svg` từ 8 lên 64** (thể hiện ký hiệu là item): **đồng ý** (R17; đo SC-005 với 40 item).
3. **Không đổi API 1.2.0:** `context.widget` nhận `elementUid`: **đồng ý** (R13). Đã đọc `isContextId` ở `core/tag-engine/write_coordinator.cpp` (chữ thường đầu, `[a-z0-9_-]`, ≤ 64: chấp nhận `el_…`); thêm ca thử ở T083 (chỉ test, không đổi mã sản phẩm).
4. **Thêm `data-mat-name` (mở rộng ADR-003 mục 4):** **đồng ý** (R6).
5. **Không thêm thư viện; CSS, tiền xử lý, so ảnh tự viết:** **đồng ý** (R2, R4, R22).
6. **Mockup:** tự duyệt (phiên chính).
7. **BL335:** chuyển danh sách lệnh chỉ đọc ([quickstart.md](quickstart.md) §8) cho người dùng cùng lời xin quyền SSH; task cần thiết bị đánh dấu ⚠️🔌.
8. **Phiên bản:** runtime 0.7.0, Studio 0.6.0, định dạng 0.4.0; API và live giữ 1.2.0 (D36).
9. **Lệnh Rust `svg_open`:** **đồng ý**, ngoại lệ có chủ ý của quy ước "không lệnh Tauri mới" của 007 (R24).
10. **Fixture Illustrator và CorelDRAW là mô phỏng** và SC-001 cho hai phần mềm này ghi "đạt trên mô phỏng": **đồng ý** (D23).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Package mới `@mat/svg-import` (importer tách khỏi `svg-renderer`) | Giữ gói trang nhỏ (SC-022); importer chỉ Studio/CLI/test | Gộp vào `svg-renderer`: trang tải mã CSS, chuẩn hóa, đối chiếu không dùng |
| Bộ phân tích CSS và bộ quét tiền xử lý tự viết | Cùng kết quả ở Chrome, jsdom, Node; không thư viện; tất định (SC-002) | CSSOM/`getComputedStyle`: chỉ chạy ở Chrome; thư viện CSS: thêm phụ thuộc và bề mặt tấn công |
| Hợp biến đổi bằng ma trận tường minh (đổi hành vi quay 0.2) | CSS `transform` che `transform` gốc; cần `pivot` riêng | Thuộc tính CSS `rotate/translate/scale`: lệch tâm khi có `M0`, một `pivot` chung |
| Trần item `svg` 8 → 64 | Thể hiện ký hiệu là item | Gộp SVG: cần trình sửa SVG (GĐ 6) |
| Sự kiện SVG dùng widget ảo của `ControlController` | Một bộ khóa, xác nhận, kết quả (Constitution V) | Bộ điều khiển riêng: hai nơi giữ quy tắc an toàn |
| Lệnh Rust mới `svg_open` | Đọc file SVG người dùng chọn, giới hạn kích thước trước khi vào bộ nhớ giao diện | Đọc bằng `<input type=file>`: quyền khác biệt giữa WebView và test; kéo thả: cho giao diện đường dẫn tuyệt đối |
| Đo hộp bao bằng `getBBox` ở trang | `pivot` tương đối và `clipLevel` cần hộp bao thật | Tính từ thuộc tính: sai với `path` cong, `text`, `use`, nhóm |
| Mô phỏng thay fixture thật (Illustrator, CorelDRAW) | Không có phần mềm trên máy dev | Bỏ hai phần mềm: trái yêu cầu nghiệm thu; giả là "thật": không trung thực (Constitution VI) |
