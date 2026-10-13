---

description: "Task list — Nhập SVG, gắn Tag cho phần tử SVG, animation và sự kiện"
---

# Tasks: Nhập SVG, gắn Tag cho phần tử SVG, animation và sự kiện

**Input**: `specs/008-svg-import-binding/` (plan.md, spec.md, research.md R1–R24, data-model.md, contracts/, quickstart.md); ADR [023](../../docs/adr/023-svg-import-allowlist-uid.md), [024](../../docs/adr/024-binding-animation-0.4.md), [025](../../docs/adr/025-svg-element-events.md), [026](../../docs/adr/026-symbol-library-svg-editing.md); mockup [studio-svg.html](../../docs/architecture/mockups/studio-svg.html) (T004).

**Tests**: **Bắt buộc, viết trước** (Constitution VI; spec FR-059). Mỗi task "Test" phải chạy **đỏ** trước task cài đặt tương ứng; ghi kết quả đỏ/xanh vào "**Ghi chú khi làm:**" ngay dưới task, như 003 đến 007. Task gộp test và cài ghi cả hai pha.

- **C++:** GoogleTest + CTest x64 trong Docker (`deployment/toolchain/test-x64.ps1`; `-Target`, `-Filter` để chỉ build và chạy module đang làm); test armhf dưới qemu-user (`deployment/toolchain/test-armhf.sh`).
- **TS:** Vitest (jsdom; đồng hồ giả; `measure` và Web Animations giả); e2e Chrome headless + axe-core (`npm run e2e -w @mat/studio`, `npm run e2e -w @mat/runtime-web`, tự nhận mọi file `*.e2e.mjs`).
- **Rust:** `cargo test --lib` trong `apps/studio/src-tauri` phải xanh, `$env:CARGO_TARGET_DIR='C:\build\mat-studio'`.
- **Node:** `node --test tools/project-validator tools/svg-import tools/svg-demo`.
- **Vector chung:** C++ ↔ TS: `tests/project-vectors/` (ca `v04-*` mới); chỉ TS: `tests/migration-vectors/` (cặp 0.3 → 0.4).
- **Fixture và độc hại:** `tests/fixtures/svg-import/` (T033–T036); harness `tools/svg-import/malicious-harness.mjs`, so ảnh `tools/svg-import/compare-images.mjs` (T051).
- **Tích hợp x64:** `tools/web-it.ps1 -Scenario …` (kịch bản `svg`, `svg-events`, `open-svg`, `f5x10-svg`, `load-svg`; có sẵn từ 007), kết quả `docs/reports/008-<kịch bản>-x64.json`.
- **Kiểm tay (cần người, ký hiệu 👤):** bộ gõ (tên phần tử F2, nhãn sự kiện), trình đọc màn hình, Chrome và WebView2 thật, file SVG thật từ Illustrator và CorelDRAW.

**Quy ước**:

- **Phiên viết tài liệu này không sửa mã sản phẩm** (đang có lượt `ci-local` chạy trên cây mã). **Mọi task bên dưới chỉ bắt đầu khi lượt `ci-local` đó xong**; mỗi task chạm file chung phải chạy lại test của feature gốc.
- **Quyền quyết định:** người dùng giao toàn quyền cho phiên chính ngày 2026-10-11. Phiên chính tự duyệt mockup, tự nghiệm thu, commit mốc cục bộ (không push). Quyết định mới ghi "Quyết định (người dùng giao toàn quyền 2026-10-11)" vào task, plan hoặc ADR.
- **Câu hỏi của plan đã trả lời** (plan, mục "Câu hỏi cho phiên chính"), áp vào task:
  - **Câu 1 (0.4.0):** T012, T013, T029; **câu 2 (trần 64 item `svg`):** T015, T029; **câu 3 (API giữ 1.2.0, `context.widget` = `elementUid`):** T083;
  - **câu 4 (`data-mat-name`):** T046; **câu 5 (không thêm thư viện):** T009, T118; **câu 6 (mockup tự duyệt):** T005;
  - **câu 7 (BL335):** T010, T121–T126; **câu 9 (`svg_open`):** T055; **câu 10 (fixture mô phỏng):** T034, T120.
- **Constitution V, thứ tự bảo mật:**
  - không viết `importSvg` và không đổi `sanitizeSvg` trước khi bộ test của chúng (T020, T035, T037, T042) đỏ;
  - không dựng SVG chưa lọc ở bất kỳ nơi nào (Studio, trang, CLI);
  - không gắn trình xử lý sự kiện nào từ thuộc tính SVG; sự kiện chỉ từ dữ liệu binding đã kiểm;
  - bộ kiểm tra chạy ở cả Studio và runtime; runtime không kích hoạt project lỗi; runtime C++ không parse SVG (D30): mã phụ thuộc nội dung SVG chỉ ở bản TS.
- **Thiết bị BL335 ⚠️🔌:** **SSH không có trong phiên viết kế hoạch**; không tìm cách vòng qua. Task chờ người dùng cho phép, hoặc người dùng tự chạy lệnh quickstart §8 (chỉ đọc) và §9 (cài, đo, thử).
  - Ghi mọi thay đổi vào `docs/reports/device-changes.md` kèm cách hoàn tác.
  - Không đụng `atscada-*`, `piano-edtech-*`. Không ghi mật khẩu vào repo. Không tự khởi động lại thiết bị.
  - BL335 không có `sudo`: lệnh root chạy trực tiếp; lệnh chỉ đọc chạy bằng `runuser -u matscada --`.
- **Mockup trước code giao diện:** không viết `apps/studio/src/ui/**` của hộp thoại hay editor mới trước khi T004 (mockup) xong và T005 (duyệt) ghi ngày duyệt. Giao diện theo [studio-ux.md](../../docs/architecture/studio-ux.md) §5, §7, §9 (chuẩn IDE kiểu TIA Portal); không làm giao diện dạng form cơ bản.
- **Thư viện:** **không thêm thư viện ngoài** (npm, crate, C++). CSS, tiền xử lý, ghi SVG, so ảnh tự viết. Buộc phải thêm thì: bản phát hành ≥ 2 tuần, rà license, ghi `third_party/LICENSES.md`, không GPL/LGPL.
- **Chuỗi và an toàn DOM:** `packages/{svg-renderer,svg-import,binding-engine,ui-components,symbol-library}/src/**` không dùng `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `unsafeHTML`; **không regex** để quyết định giữ hay bỏ nút, thuộc tính, giá trị của allowlist (lint T009 và test cấu trúc T020).
- **Ổ D:** build Rust ở `C:\build\mat-studio`; build C++ ở `C:\build\mat-x64-<tên>` (`test-x64.ps1 -BuildDir`). Fixture lớn sinh lúc chạy vào `tests/fixtures/svg-import/out/`, không commit.
- **Mật khẩu thử:** sinh ngẫu nhiên mỗi lần chạy (`--user-add --password-stdin`), không ghi vào repo.
- **Glob lint:** mỗi task tạo file `.mjs` đầu tiên trong thư mục `tests/*` hoặc `tools/*` mới thì thêm mẫu glob vào `lint`, `format` của `package.json` gốc và `eslint.config.mjs`. Glob không khớp file nào làm prettier, eslint thoát mã 2.
- **Bẫy đã biết** (004–007):
  - axe: `nested-interactive`; `role=tree` rỗng; chữ mờ trên `--sel` cần ≥ 4,5:1;
  - light DOM làm CSS thành toàn cục: đặt CSS theo tên thẻ hoặc tiền tố; Shadow DOM thì dùng `adoptedStyleSheets`;
  - handler đọc trạng thái lúc chạy, không đọc bản chụp lúc render; `HTMLElement` đã có `title`, `hidden`;
  - e2e mỗi file một browser context; ctest `-Filter` lọc sai thì chạy 0 test mà vẫn thoát mã 0;
  - PowerShell 5.1: thông báo `Write-Host` không dấu;
  - `getBBox`, `getScreenCTM`, Web Animations không có trong jsdom: dùng hàm giả (`measure`, `Animation` giả) và kiểm thật ở e2e Chrome;
  - jsdom và Chrome khác nhau ở `XMLSerializer`, CSSOM, thứ tự thuộc tính: không dùng chúng trong importer (R4, R6).
- **File chung:** `CMakeLists.txt`, `package.json` gốc, `eslint.config.mjs`, `tools/ci-local.ps1`, `.github/workflows/ci.yml`, `third_party/LICENSES.md`, `docs/reports/device-changes.md`, `apps/studio/src/ui/editors/index.ts`, `packages/project-schema/src/index.ts`, `schemas/protocol-version.json`, `apps/studio/src-tauri/src/lib.rs`: chỉ thêm dòng hoặc khối mới.
- **Mỗi Checkpoint:** chạy `./tools/ci-local.ps1` đầy đủ và ghi kết quả vào `docs/reports/008-acceptance.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1…US6 theo spec.md
- **⚠️🔌**: cần BL335 thật; SSH không có trong phiên viết kế hoạch
- **👤**: cần người (thử tay, cung cấp file thật, duyệt)
- **Spec**: mỗi task nêu FR hoặc SC mà nó phục vụ

---

## Phase 1: Setup (thư mục, package, mockup, spike, kiểm BL335)

- [ ] T001 [P] Cấu trúc thư mục:
  - tạo `packages/{svg-import,symbol-library}/src/`, `schemas/0.3/`, `tests/fixtures/svg-import/{malicious,reimport,real}/`, `tools/{svg-import,svg-fixtures,svg-demo}/`, `apps/studio/src/{model,ui/dialogs,workers}/` (nếu chưa có), `tests/migration-vectors/` cặp `*-0.3to0.4`;
  - `.gitignore`: `tests/fixtures/svg-import/out/`, `out/import-reports/`;
  - thư mục rỗng chưa vào git: không thêm file giữ chỗ. Glob lint theo quy ước ở trên.
- [ ] T002 [P] Package workspace `packages/svg-import` (`@mat/svg-import`, FR-011, FR-063): `package.json` (`private`, `version` 0.1.0, `type: module`, `exports` `./src/index.ts`, script `typecheck`, `test`; phụ thuộc `@mat/svg-renderer` `*`; `devDependencies` cùng phiên bản với `@mat/svg-renderer`: `typescript`, `vitest`, `jsdom`, `@types/node`), `tsconfig.json`, `vitest.config.ts` (`environment: 'jsdom'`), `src/index.ts` rỗng; `npm install` chỉ thêm liên kết workspace vào `package-lock.json` (kiểm bằng diff: không gói ngoài); `npm run typecheck`, `npm test` xanh.
- [ ] T003 [P] Package workspace `packages/symbol-library` (`@mat/symbols` 0.1.0, FR-055): như T002; `devDependencies` `typescript`, `vitest`, `jsdom`; phụ thuộc `@mat/svg-renderer` (kiểm allowlist trong test).
- [ ] T004 [P] Mockup `docs/architecture/mockups/studio-svg.html` (D38; theo kiểu và token của `studio-screens.html`; theme sáng và tối; không CDN):
  - **cảnh 1:** hộp thoại Nhập SVG (trước/sau, báo cáo có bảng loại/chuyển/cảnh báo, tùy chọn Tối ưu, trạng thái lỗi từ chối);
  - **cảnh 2:** vào đồ họa, chọn phần tử, cây phần tử, inspector Gắn Tag 13 dòng (ví dụ: mức, màu theo khoảng, quay liên tục, nhấp nháy, dòng chảy), thanh Thử giá trị, nhóm Sự kiện, lỗi theo dòng;
  - **cảnh 3:** hộp thoại Đối chiếu lại (giữ/mới/cần chọn/mồ côi, hai phần tử cạnh nhau);
  - **cảnh 4:** Toolbox Ký hiệu SVG, điểm gắn và dính, Gắn nhanh;
  - **cảnh 5:** trang Chrome (phần tử nhấp được, viền focus, khóa kèm lý do, hộp xác nhận, kết quả).
  - Ghi hạn chế vào ghi chú (phần "chưa làm trong mockup").
- [ ] T005 [US1] Phiên chính xem và duyệt mockup T004 (người dùng giao toàn quyền; D38): ghi ngày duyệt và các điểm chỉnh vào ghi chú khi làm; chỉnh mockup nếu lệch `studio-ux.md` §5, §7. **Chặn** mọi task giao diện Studio mới (từ T058, T070 trở đi).
- [ ] T006 [P] **Spike** Chrome (research R9, R10; ADR-024 rủi ro 1, 2): trang thử trong scratchpad, Chrome headless; kiểm:
  - (a) chuỗi `translate(tx,ty) matrix(M0) translate(c) rotate() translate(-c) scale() translate(-c)` cho đúng vị trí với `M0` = dời, quay 90°, co giãn, lệch; so với kết quả tính tay;
  - (b) hoạt ảnh Web Animations hai khung hình cùng cấu trúc (`rotate(0)` → `rotate(360deg)`) với `matrix()` bên trong: có giật không; `setKeyframes` giữ thời gian; `updatePlaybackRate`;
  - (c) `clipPath` (`userSpaceOnUse`) tạo lúc chạy trong `<defs>` của Shadow DOM và `clip-path="url(#id)"` phân giải đúng trong cây của Shadow DOM, với phần tử có `transform`; thử `clip-path: inset()` làm dự phòng;
  - (d) `elementsFromPoint` trên Shadow DOM với SVG 20.000 phần tử (thời gian);
  - (e) `pointer-events: all` trên hình `fill="none"`.
  - Ghi kết quả vào mục "Số đo" của ADR-024 và ADR-026, `docs/reports/008-spike-chrome.md`; sửa R9, R10 nếu khác giả định (dự phòng ghi sẵn).
- [ ] T007 [P] **Spike** Tối ưu và kích thước UID (research R5, R6; ADR-023): trong scratchpad, đọc `tests/fixtures/svg/factory-isometric-stress.svg` (không sửa file gốc), tính: (a) số phần tử sau khi gộp `line/polyline/polygon/path` liền kề cùng thuộc tính đã giải (mô phỏng quy tắc R5); (b) kích thước sau khi thêm `data-mat-uid` cho mọi phần tử gắn được; (c) ảnh sau gộp so ảnh gốc trên Chrome (canvas). **Điều kiện:** ≤ 20.000 phần tử và ≤ 1 % điểm ảnh khác; không đạt thì ghi giới hạn vào ADR-023 (file stress cần sửa ngoài Studio) và sửa SC-010 phần stress, spec US1-6.
- [ ] T008 [P] **Spike** Inkscape CLI (research R18): `inkscape --version`; xuất thử một SVG viết tay ra Inkscape SVG (`--export-filename`) và PNG (`--export-type=png -w 1200`); ghi phiên bản, namespace thực tế sinh ra (`sodipodi`, `inkscape`, `namedview`), `flowRoot` có giữ không; viết 4 bản vẽ nguồn tối giản vào `tools/svg-fixtures/src/` (bồn + ống + gradient + clipPath; motor + bơm có nhóm lồng, `use`, marker; bảng chữ nhiều dòng + `flowRoot` + ảnh PNG nhúng; ống + `stroke-dasharray` + mũi tên + mask). **Dừng và báo** nếu Inkscape không chạy được (không giả file "thật").
- [ ] T009 [P] Quy tắc lint an toàn DOM cho package mới (SC-021): `eslint.config.mjs` thêm `packages/{svg-import,symbol-library}/src/**` và `packages/{svg-renderer,binding-engine}/src/**` vào khối cấm `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `unsafe-html`, `setTimeout` chuỗi; thêm mẫu vi phạm vào `tools/lint-fixtures-007/` (hoặc thư mục cùng loại) và ca vào `tools/lint-rules.test.mjs`. File chung: chỉ thêm khối.
- [ ] T010 ⚠️🔌 **(SSH không có; chờ người dùng cho phép hoặc tự chạy lệnh quickstart §8)** Kiểm chỉ đọc BL335: tốc độ cổng mạng, RAM, chỗ chứa project, `MemoryCurrent`; chốt: thông lượng thực (giả định 65 Mbps ở R20) và RSS nền; ghi `docs/reports/device-profile.md` (mục "Phục vụ file SVG") và `docs/reports/008-acceptance.md`; sửa ước tính R20 nếu khác.

---

## Phase 2: Foundational — nền chung cho mọi story

**Purpose**: định dạng 0.4.0, luật hai bản, nâng cấp, allowlist thay denylist, hàm thuần của binding, phía thiết bị nhận project 0.4. Mọi story cần phần này.

**Phối hợp:** 004–007 đã xong về mã; file chung chỉ thêm khối. Mọi task C++ dưới đây chạy lại ctest đầy đủ khi xong. Feature 009 (alarm) cũng đặt định dạng 0.4.0 và `@mat/ui-components` 0.2.0 trong plan của nó: theo thứ tự giai đoạn, **008 chiếm 0.4.0 và 0.2.0**, 009 đổi sang 0.5.0 và 0.3.0 (task T002 của 009); không sửa spec 009 ở đây.

### Định dạng và validator (TS)

- [ ] T011 [P] Bộ vector chung (**test trước**, FR-007, FR-059, SC-012):
  - `tests/project-vectors/generate.mjs` thêm ca `v04-*`: ≥ 100 ca (hợp lệ và không hợp lệ); mỗi mã chung (cột C của [contracts/project-format-0.4.md](contracts/project-format-0.4.md) §6) có ≥ 1 ca đúng và ≥ 1 ca sai; ca biên của §8 của contract (`period` 399/400/5000/5001, `speed`, `pivot`, `minOpacity`, 63/64/65 khoảng, 64/65 item `svg`, 64/65 và 256/257 hoạt ảnh, `label` 80/81, `durationMs`); ca phần tử chỉ có `events`; hai binding cùng nhóm đích; `E_MIN_RUNTIME` 0.6.0 với 0.4;
  - vector 0.1 (82 ca), 0.2 và 0.3 giữ nguyên.
- [ ] T012 Schema 0.4.0 và đóng băng 0.3 (FR-001, FR-002, FR-003; research R1; **test trước**):
  - test đỏ `packages/project-schema/src/schema-04.test.ts`: schema mới hợp lệ meta-schema; ví dụ trong contract §4 hợp lệ; đích, phép biến đổi, tham số mới được nhận; `bindings` hoặc `events` bắt buộc ít nhất một; khóa lạ bị từ chối; mọi file nhận `0.4.x`;
  - chép `schemas/*.schema.json` hiện hành (0.3.0) sang `schemas/0.3/`; sửa `schemas/{project,screen,binding,tag,logging,connections,value-table,watch-table}.schema.json` thành 0.4.0 (`$id`, `schemaVersion`), `binding` thêm đích, `rangeMap` (bỏ khỏi `unsupportedTransform`), tham số, `events`; `screen` không đổi cấu trúc;
  - `schemas/protocol-version.json`: `project` thêm `"0.4"`, `live` giữ `1.2.0`; `schemas/README.md` mô tả 0.4; cập nhật `meta-schema.test.ts`.
- [ ] T013 Kiểu và mã mới (FR-007; research R8): `packages/project-schema/src/types-04.ts` (`Binding04`, `Transform04`, `ElementEntry04`, `ElementAction`, `BindingSet04`, `LoadedProject04`), `codes.ts` thêm lỗi `E_BIND_TRANSFORM`, `E_BIND_PARAM`, `E_RANGE`, `E_EVENT_ACTION`, `E_EVENT_TAG`, `E_EVENT_TARGET`, `E_EVENT_CONFIRM`, `E_EVENT_MINROLE`, `E_SVG_UNSAFE`, `E_SVG_LIMIT` và cảnh báo `W_ANIM_MANY`, `W_BLINK_ONLY`, `W_EVENT_CONFIRM_NONE`, `W_EVENT_PULSE_READBACK`, `W_SVG_HEAVY`, `W_BIND_ELEMENT_KIND`, `W_BIND_CLIP_EXISTS`; hằng `SUPPORTED_SCHEMA_04`, `MIN_RUNTIME_04` = `0.7.0`; `RUNTIME_VERSION` = `0.7.0`; xuất ở `index.ts` (file chung: thêm dòng). Cập nhật bản sao danh sách mã ở C++ ở T029.
- [ ] T014 Test đỏ luật 0.4 (TS; FR-007, FR-059): `packages/project-schema/src/rules-04.test.ts` (từng luật của contract §6, nhiều ca nhỏ dựng bằng hàm trợ giúp) và `vectors-04.test.ts` (chạy mọi ca `v04-*`, so `{code, path}` từng ca). **Kiểm đỏ:** mọi ca invalid hiện không báo đúng mã.
- [ ] T015 Cài luật 0.4 (TS; FR-002…FR-004, FR-053): `packages/project-schema/src/rules-04.ts`:
  - bảng đích × phép biến đổi × tham số (`E_BIND_TRANSFORM`, `E_BIND_PARAM`, `E_TYPE_MISMATCH` theo kiểu Tag), nhóm đích (`E_DUP_BINDING`), `rangeMap` (`E_RANGE`: dùng lại hàm chồng khoảng của bảng giá trị);
  - sự kiện (`E_EVENT_*`, `E_REF_UID`, `W_EVENT_*`), giới hạn (`E_LIMIT`: 64 item `svg`, 256 hoạt ảnh; `W_ANIM_MANY`), `W_BLINK_ONLY`;
  - đổi `LIMITS_03.svgItems` thành giới hạn theo phiên bản (8 cho 0.3, 64 cho 0.4); dùng lại luật 0.3 cho phần còn lại; chọn theo `schemaVersion` ở `validate.ts`.
  - Kiểm xanh `rules-04.test.ts`, `vectors-04.test.ts`.
- [ ] T016 [P] Nâng cấp 0.3 → 0.4 (FR-005, FR-006; **test trước**, gộp test và cài): `packages/project-schema/src/migrate.ts` thêm `migrate03to04` (chỉ `schemaVersion` mọi file và `minRuntimeVersion`), chuỗi từ 0.1/0.2; `tests/migration-vectors/` cặp `tank-demo-0.3to0.4`, `modbus-demo-0.3to0.4`, `dashboard-demo-0.3to0.4` (giống từng byte khi chạy hai lần); test `migrate-03to04.test.ts`.
- [ ] T017 `validate.ts`, `project-files.ts`, `source.ts` (FR-001, FR-009; test trước): `validateProject` chọn schema và luật theo 0.4 (`E_MIN_RUNTIME` 0.7.0, `E_SCHEMA_VERSION`), `projectFiles()` cho item `svg` (đường dẫn `graphics/…`, `screens/<màn hình>.<item>.bindings.json`), đọc file binding với `events`; test mở rộng `project-files.test.ts`; không đổi tập file của 0.1–0.3.
- [ ] T018 [P] So sánh và đổi tên Tag (FR-010, FR-047; test trước): `compare.ts` (đối tượng mới: số binding và sự kiện theo item và phần tử, file SVG theo digest), `rename.ts` (duyệt `bindings[].source.tagId`, `events.click.tag`); test mở rộng `compare.test.ts`, `rename.test.ts` (đổi tên trong một bước, hai bản TS/C++ không có phần này nên chỉ TS).

### Allowlist thay denylist (`@mat/svg-renderer`)

- [ ] T019 [P] Test đỏ `rules-04-svg.test.ts` (FR-024; mã chỉ TS): `E_SVG_UNSAFE` (SVG còn `script`, `on*`, `href` ngoài, phần tử ngoài allowlist), `E_SVG_LIMIT` (5 MiB, 20.000, độ sâu 32), `W_SVG_HEAVY` (1 MiB, 10.000 phần tử), `W_UID_NOT_IN_SVG` cho sự kiện, `W_BIND_ELEMENT_KIND`, `W_BIND_CLIP_EXISTS`; dùng SVG dựng trong bộ nhớ và DOM của jsdom. (Cài ở T060.)
- [ ] T020 [P] [US1] Test đỏ allowlist (**test trước**, Constitution V; FR-013, FR-014, SC-021): `packages/svg-renderer/src/allowlist.test.ts`, `css-value.test.ts`, mở rộng `sanitize.test.ts`:
  - mỗi phần tử của [contracts/svg-import.md](contracts/svg-import.md) §2 giữ; mỗi phần tử ngoài danh sách bị bỏ cùng con (`a` mở vỏ); mỗi thuộc tính và kiểu giá trị §3 (chấp nhận và từ chối: `href` ngoài, `url()` ngoài, `javascript:`, `data:` sai, số `NaN`, `font-family` có `url`), `style` qua bộ tách từ vựng;
  - duyệt **không đệ quy**: cây sâu 100.000 cấp dựng bằng vòng lặp không làm tràn ngăn xếp;
  - **không regex**: test cấu trúc quét mã nguồn `allowlist.ts`, `css-value.ts` bằng cây cú pháp TypeScript (không có `RegExp` literal hay `new RegExp` trong hàm quyết định giữ/bỏ);
  - tương thích: `sanitizeSvg` giữ chữ ký và kiểu `SanitizeReport` (thêm trường).
- [ ] T021 [US1] Cài allowlist (FR-013, FR-014): `packages/svg-renderer/src/allowlist.ts` (bảng `ALLOW_ELEMENTS`, `ATTR_RULES`, `PRESENTATION`, `CSS_PROPS`), `css-value.ts` (hàm kiểm giá trị bằng bộ quét ký tự: `isNumber`, `isLength`, `isColor`, `isPaint`, `isLocalUrl`, `isHref`, `isDataImage` có kiểm chữ ký tệp, `isPathData`, `isPoints`, `isTransform`, `isFontFamily`, `isId`, `isUid`, `isName`), `transform-parse.ts` (bộ phân tích `transform` dùng chung cho `DomApplier` ở T027 và đối chiếu ở T097). Kiểm xanh T020.
- [ ] T022 [US1] Thay `sanitizeSvg` bằng allowlist (FR-023): `packages/svg-renderer/src/sanitize.ts` viết lại (duyệt vòng lặp, tra bảng; **xóa** `BLOCKED_ELEMENTS`, `SMIL_ELEMENTS`, `cssHasExternalRef`, `cssUnescape` cũ hoặc đổi thành hàm của bộ quét), `mount.ts` (không đổi giao diện), `index.ts` xuất bảng và hàm kiểm và **giữ xuất `SVG_NS`, `namespaceLabel`, `parseSvg`** (`inspect.ts` dùng); chạy lại `mount.test.ts`, `sanitize.test.ts`, `inspect.test.ts`, `svg-inspect`, `tools/measure/svg-load.mjs`. **Ghi nhật ký thay đổi có chủ ý** (phần tử nào của 19 fixture Sprint 0 nay bị loại) vào ghi chú; fixture an toàn `unsafe-elements.svg` vẫn không chạy mã.
- [ ] T023 [P] [US1] Hồi quy fixture Sprint 0 (FR-023, SC-016): `tools/svg-import/regress-sprint0.mjs` (Chrome headless): dựng 19 file `tests/fixtures/svg/*.svg` bằng bản `sanitizeSvg` cũ (từ git `HEAD`, đóng băng ở `tools/svg-import/legacy-sanitize.mjs` chỉ cho công cụ này, không vào gói) và bản mới, so ảnh; mong đợi khác ≤ 0,5 % trừ khai báo của `manifest` (fixture có phần bị loại có chủ ý); ghi kết quả vào `docs/reports/008-fixtures.json` (mục `sprint0`).

### Binding: hàm thuần

- [ ] T024 [P] Test đỏ chuyển đổi mở rộng (**test trước**; FR-032…FR-041; contract [binding-animation.md](contracts/binding-animation.md) §2, §7): `packages/binding-engine/src/transforms.test.ts` thêm: `rangeMap` ở biên (`from` bao gồm, `to` không bao gồm; −∞, +∞; `default`), `text.content` (`decimals`, `prefix`, `suffix`, `unitFromTag`, bảng giá trị, khoảng), `blink` (BOOL, số 0, số khác 0, `discreteMap`), `flow` (BOOL, số, âm với `byValueSign`, kẹp 300), `translate`, `scale` (kẹp), `onBadQuality` cho từng đích mới. Toàn bộ test 0.2 hiện có giữ xanh.
- [ ] T025 Cài chuyển đổi mở rộng: `packages/binding-engine/src/transforms.ts` (`evaluateBinding` nhận `Binding04`, đầu ra mở rộng cho boolean/tốc độ; `applyTransform` có `rangeMap`; `normalize` cho đích mới; `bad` cho đích mới). Kiểm xanh T024 và test 0.2.
- [ ] T026 [P] Test đỏ hợp biến đổi và mức (**test trước**; FR-034…FR-036, FR-040, SC-014): `packages/binding-engine/src/anim/transform-state.test.ts` (chuỗi `style.transform` đúng với `M0` đơn vị, dời, quay 90°, co giãn, lệch; tâm 9 điểm; quay + dời + co giãn; `axis`; một lần ghi mỗi lần flush), `clip-level.test.ts` (hình học `rect` cắt bốn hướng ở 0, 50, 100 %, làm tròn 2 chữ số).
- [ ] T027 Cài hàm thuần `packages/binding-engine/src/anim/transform-state.ts` (trạng thái hợp, dựng chuỗi, đọc `M0` bằng `transform-parse`), `anim/clip-level.ts` (tính `rect` cắt). Kiểm xanh T026. (Phần dựng DOM và hoạt ảnh ở T066.)

### Phía thiết bị nhận project 0.4 (C++)

- [ ] T028 [P] Test đỏ C++ luật 0.4 (FR-007, FR-059, SC-012): `core/project-manager/tests/rules_04_test.cpp` (từng luật chung của contract §6, cột C) và `vectors_04_test.cpp` (chạy mọi ca `v04-*` cùng thư mục với TS, so `{code, path}`); đăng ký `mat_test(...)` trong `CMakeLists.txt` (file chung: thêm dòng). **Kiểm đỏ.**
- [ ] T029 Cài luật 0.4 và nhận project 0.4 (FR-001, FR-007, FR-008): `core/project-manager/rules_04.{hpp,cpp}` (đích, phép biến đổi, tham số, `rangeMap`, sự kiện, nhóm đích, giới hạn 64/256, cảnh báo), `project_validator.cpp` (chọn schema 0.4, `kSupported` thêm 0.4, `E_MIN_RUNTIME` 0.7.0, tập file của item `svg`, summary `projects/active` như 0.3), bản sao danh sách mã, `RUNTIME_VERSION` 0.7.0, `system/info.schemaVersions` thêm `"0.4"`. `ctest` đầy đủ xanh; vector 0.1–0.3 giữ kết luận. Hai bản TS và C++ cho cùng kết luận 100 % trên `v04-*`.
- [ ] T030 [P] Đóng gói và nạp thử (FR-008): `deployment/package-runtime.ps1` chép `schemas/0.3/`; test khởi động `server/tests/startup_test.cpp` (project 0.4 nạp được, `projects/active` đúng, `valueTables` gồm bảng của binding SVG, `/project/graphics/…svg` phục vụ được, đường dẫn ngoài allowlist 404); project 0.3 vẫn chạy; runtime từ chối `schemaVersion` lạ.
- [ ] T031 [P] `tools/project-validator/validate.mjs` hỗ trợ 0.4 và `--migrate 0.3→0.4`; `package.json` `validate:project` thêm `projects/svg-demo` (T093); test `node --test tools/project-validator`.
- [ ] T032 **Checkpoint Phase 2:** `./tools/ci-local.ps1` đầy đủ; ghi kết quả vào `docs/reports/008-acceptance.md` (mục "Nền chung"): ca vector `v04-*` hai bản, allowlist qua 19 file Sprint 0, ctest, Vitest.

---

## Phase 3: User Story 1 — Nhập SVG từ Inkscape, Illustrator, CorelDRAW vào Studio an toàn (Priority: P1) 🎯 MVP (cùng US2, US3)

**Goal**: nhập SVG ngoài vào Studio qua allowlist, giới hạn, báo cáo, UID; hiển thị đúng ở Studio và Chrome; SVG độc hại bị loại.

**Independent Test**: `npm test -w @mat/svg-import`; `npm run svg:inspect -- --import tests/fixtures/svg-import`; harness độc hại; so ảnh; e2e `import.e2e.mjs`.

### Dữ liệu thử (song song)

- [ ] T033 [P] [US1] 4 fixture Inkscape thật (FR-060, research R18): `tools/svg-fixtures/make-inkscape.ps1` (chạy `inkscape --export-filename` trên `tools/svg-fixtures/src/*.svg` của T008, ghi phiên bản Inkscape), file `tests/fixtures/svg-import/inkscape-01-tank-process.svg`, `inkscape-02-motor-pump.svg`, `inkscape-03-panel-text.svg`, `inkscape-04-pipes-flow.svg`, PNG tham chiếu do Inkscape tự xuất (`*.ref.png`, cỡ 1200 × 800); mục trong `manifest.json` (`real: true`, nguồn, giấy phép CC0, đặc trưng, mã báo cáo mong đợi).
- [ ] T034 [P] [US1] 6 fixture mô phỏng Illustrator và CorelDRAW (FR-060, D23): `tools/svg-fixtures/make-simulated.mjs` + khuôn `tools/svg-fixtures/src/*.tmpl.svg` sinh tất định `illustrator-01-saveas-legacy.svg`, `illustrator-02-export-cls.svg`, `illustrator-03-export-screens.svg`, `corel-01-mm-css.svg`, `corel-02-curves-clip.svg`, `corel-03-blend-pattern.svg` theo bảng đặc trưng ở contract §9; `tests/fixtures/svg-import/README.md` (nguồn gốc từng file, giấy phép, **giới hạn mô phỏng** viết rõ: không phải file do phần mềm thật sinh, không chứng minh cách phần mềm thật sinh id, làm tròn số, thứ tự thuộc tính); `manifest.json` (`real: false`, `allowedDiff` cho vùng nhánh dự phòng).
- [ ] T035 [P] [US1] Bộ SVG độc hại (FR-062, SC-003): `tests/fixtures/svg-import/malicious/m01…m30` + các ca thêm theo bảng ở contract §8, mỗi ca `*.svg` và `*.expect.json` (`outcome`, `codes`, `forbid`); ≥ 24 ca (mục tiêu 30).
- [ ] T036 [P] [US1] Ca giới hạn (SC-010): `tests/fixtures/svg-import/limits.mjs` sinh vào `out/` lúc chạy (không commit): 5 MiB và 5 MiB + 1; 20.000 và 20.001 phần tử sau chuẩn hóa; độ sâu 32 và 33; 100.000 và 100.001 phần tử thô; `use` hiệu dụng 100.000 và 100.001; 8 và 9 `filter`; 16 và 17 ảnh; 2 MiB và 2 MiB + 1 ảnh; ≥ 12 ca.

### Tests (viết trước, phải ĐỎ; Constitution V, VI)

- [ ] T037 [P] [US1] Test đỏ tiền xử lý (FR-012; contract §1): `packages/svg-import/src/prescan.test.ts`: BOM, UTF-8 hỏng (`E_IMPORT_ENCODING`), UTF-16 và `encoding` khác, DOCTYPE với entity Adobe đã biết (thay URI rồi bỏ DTD, `C_ENTITY`), entity lạ, `SYSTEM`, tham số, "billion laughs" (`E_IMPORT_DTD`), PI bỏ, byte > 5 MiB (`E_IMPORT_LIMIT` trong ≤ 50 ms, không gọi parser), gốc không phải `<svg>` hoặc sai namespace (`E_IMPORT_ROOT`).
- [ ] T038 [P] [US1] Test đỏ CSS (FR-016; research R4): `packages/svg-import/src/css.test.ts`: bộ tách từ vựng (bình luận, chuỗi, `\` thoát), bộ chọn hỗ trợ và không hỗ trợ (`W_IMPORT_CSS_PARTIAL`), at-rule bỏ, độ đặc hiệu, thứ tự khối, `!important`, `style` nội tuyến thắng, thuộc tính gốc thua CSS, thuộc tính CSS ngoài allowlist bỏ, giá trị `url(javascript:)` bỏ, ca `.cls-N` trùng tên ở 8 khối (như file stress), CDATA của Corel.
- [ ] T039 [P] [US1] Test đỏ chuẩn hóa (FR-017): `packages/svg-import/src/normalize.test.ts`: đơn vị `mm/cm/in/pt/pc`, `viewBox` sinh từ `width/height`, thiếu cả hai (`E_IMPORT_SIZE`), `switch` mở nhánh dự phòng (`C_SWITCH`), `flowRoot` thành `text` (`W_IMPORT_FLOWTEXT_NOWRAP`), font PostScript theo bảng (`C_FONT_MAP`) và dự phòng `sans-serif`, `<font>` bỏ, `xlink:href` thành `href` (`C_XLINK`), `id` trùng (`C_DUP_ID`), tham chiếu treo bỏ, phần tử rỗng và định nghĩa không dùng bỏ, làm tròn số (`C_ROUND`), tên `title`.
- [ ] T040 [P] [US1] Test đỏ UID và tên (FR-019, D5): `packages/svg-import/src/uid.test.ts`, `name.test.ts`: phần tử gắn được (ngoài `defs`, `clipPath`, `mask`, `symbol`, `pattern`, `marker`, `filter`), định dạng UID, bộ sinh theo seed tất định, UID nguồn bị bỏ (kể cả trùng), tên theo ưu tiên `inkscape:label` → `data-name` → `id` có nghĩa → "<thẻ> <số>", `id` không nghĩa (`path1234`, `SVGID_1_`, `Layer_1`, `_x0020_`), giải `_x0020_`, cắt 80 ký tự.
- [ ] T041 [P] [US1] Test đỏ ghi và báo cáo (FR-020, FR-022): `packages/svg-import/src/write.test.ts` (tất định, thứ tự thuộc tính cố định, thoát `& < > "`, khóa nội dung dạng chữ), `report.test.ts` (cấu trúc theo contract §6, sắp xếp tất định, ví dụ ≤ 3 đường dẫn, không chứa nội dung gốc, `.md` sinh từ cùng dữ liệu, tên tệp của `file:///` cắt đường dẫn).
- [ ] T042 [US1] Test đỏ importer (FR-015, FR-018, FR-022, SC-001, SC-003, SC-010): `packages/svg-import/src/import.test.ts` (10 fixture nhập được và mã báo cáo khớp `manifest.json`; 30 ca độc hại đúng `expect.json` và `assertAllowlisted` không còn gì để loại; ca giới hạn đúng biên; nhập tất định hai lần giống từng byte; `use` bom và vòng), `optimize.test.ts` (điều kiện gộp, không gộp khi có `id`, độ mờ < 1, bị tham chiếu, `transform` khác nhau; giữ thứ tự vẽ; kết quả `path` hợp lệ; file stress xuống ≤ 20.000 nếu T007 đạt).

### Implementation

- [ ] T043 [US1] Tiền xử lý: `packages/svg-import/src/prescan.ts` (bộ quét ký tự, bảng entity Adobe), `dom.ts` (cấp `DOMParser`: trình duyệt hoặc jsdom), kiểm byte. Kiểm xanh T037.
- [ ] T044 [US1] CSS: `packages/svg-import/src/css.ts` (tách từ vựng, bộ chọn, cascade, chuyển thành thuộc tính). Kiểm xanh T038.
- [ ] T045 [US1] Chuẩn hóa: `packages/svg-import/src/normalize.ts`, dữ liệu `src/data/fonts.json` (bảng ánh xạ PostScript, D33), xử lý `switch`, `flowRoot`, đơn vị, `id` trùng, tham chiếu treo. Kiểm xanh T039.
- [ ] T046 [US1] UID và tên: `packages/svg-import/src/uid.ts` (bộ sinh mật mã và theo seed), `name.ts`. Kiểm xanh T040. (Quyết định `data-mat-name`: [ADR-023](../../docs/adr/023-svg-import-allowlist-uid.md); cập nhật ADR-003 mục 4 bằng liên kết.)
- [ ] T047 [US1] Tối ưu: `packages/svg-import/src/optimize.ts` (gộp theo R5). Kiểm xanh `optimize.test.ts`.
- [ ] T048 [US1] Ghi và báo cáo: `packages/svg-import/src/write.ts`, `report.ts`, `i18n/vi-import.ts` (câu tiếng Việt cho mọi mã `R_*`, `C_*`, `W_IMPORT_*`, `E_IMPORT_*`). Kiểm xanh T041.
- [ ] T049 [US1] Importer (FR-015, FR-021): `packages/svg-import/src/import.ts` (đường ống: tiền xử lý → parse → đếm thô → allowlist (dùng `@mat/svg-renderer`) → CSS → chuẩn hóa → mở `use` đếm hiệu dụng → Tối ưu (tùy chọn) → đếm sau → gán UID và tên → ghi → báo cáo; nhận diện phần mềm bằng `inspectSvg`), `index.ts`. Kiểm xanh T042. `npm run typecheck`, `lint` xanh.
- [ ] T050 [US1] CLI và CI (FR-025): `tools/svg-inspect/svg-inspect.mjs` thêm `--import`, `--optimize`, `--report-dir`, `--out`; test `tools/svg-inspect` hoặc `tools/svg-import/cli.test.mjs`; `package.json` script `svg:inspect` giữ; `tools/ci-local.ps1` thêm bước `svg:inspect --import tests/fixtures/svg-import` (10 fixture phải nhập được) và `npm test -w @mat/svg-import -w @mat/symbols`; `.github/workflows/ci.yml` thêm tương ứng; `README.md` của `packages/svg-import`. File chung: chỉ thêm khối.
- [ ] T051 [P] [US1] Công cụ so ảnh và harness (FR-061, FR-062): `tools/svg-import/compare-images.mjs` (trang Chrome headless, `canvas` 2D, ΔRGB > 64/255, cỡ 1200 × 800, đọc `manifest.json`, ghi `docs/reports/008-fixtures.json`), `tools/svg-import/malicious-harness.mjs` (bốn bước của research R19: `importSvg`, `assertAllowlisted`, dựng trong Chrome với canary `window.__pwned` và chặn mạng, bản gốc không lọc làm đối chứng); glob lint cho `tools/svg-import/*.mjs`.
- [ ] T052 [US1] Chạy 10 fixture (SC-001, SC-002): `compare-images`: mỗi fixture ≤ 0,5 % so bản gốc (trừ vùng khai), 4 fixture Inkscape ≤ 3 % giữa PNG của Inkscape và ảnh Chrome của bản đã nhập; chỉnh importer (bảng thuộc tính, cascade, làm tròn) cho tới khi đạt; ghi số vào `docs/reports/008-fixtures.json` và ADR-023 mục "Số đo". **Ghi rõ** kết quả cho Illustrator, CorelDRAW là "đạt trên mô phỏng".
- [ ] T053 [US1] Chạy bộ độc hại (SC-003): harness: 0 `__pwned`, 0 yêu cầu mạng ngoài, ≥ 1 ca bản gốc kích hoạt canary; ghi `docs/reports/008-malicious-x64.json`; ca nào lọt thì sửa allowlist (và thêm ca) rồi chạy lại.
- [ ] T054 [US1] Tối ưu file stress (SC-002, SC-010): theo kết quả T007, `--optimize` đưa `factory-isometric-stress.svg` xuống ≤ 20.000 phần tử và ≤ 1 % điểm ảnh khác; không đạt thì ghi giới hạn (spec US1-6, ADR-023) và báo trong `008-acceptance.md`.

### Studio: nhập SVG

- [ ] T055 [P] [US1] Lệnh Rust `svg_open` (FR-011, D27; research R24): `apps/studio/src-tauri/src/svg.rs` (`svg_open`, `SvgFile`, `SvgError::{TooLarge, BadExtension, Io}`, khuôn `csv_open`), đăng ký ở `lib.rs` (thêm một dòng); **test trước** `cargo test --lib`: đúng byte, từ chối > 5 MiB + 64 B, từ chối đuôi sai, hủy trả `None`; kiểm bộ lọc đuôi của `csv_save` và, nếu cố định `.csv`, thêm tham số bộ lọc (một dòng) để lưu báo cáo `.json`/`.md` (dùng ở T058).
- [ ] T056 [US1] Test đỏ luồng nhập (FR-011; **test trước**): `apps/studio/src/model/import-flow.test.ts` (máy trạng thái §3 của data-model: `idle → reading → importing → preview|error → committed|cancelled`; chạy `importSvg` trong Worker giả; đổi Tối ưu chạy lại; Hủy không đổi tài liệu; Nhập thêm item `svg` ở (0, 0) cỡ `viewBox` thu vừa màn hình (D29), file `graphics/<slug>.svg` và file binding rỗng vào tài liệu chưa ghi đĩa; Ctrl+Z gỡ cả hai trong một bước; slug không dấu và trùng tên `-2`), `svg-doc.test.ts` (cây phần tử từ `ElementInfo`, đổi tên phần tử ghi `data-mat-name` bằng bộ ghi tất định, một bước hoàn tác).
- [ ] T057 [US1] Cài mô hình nhập (sau T056 đỏ): `apps/studio/src/model/svg-doc.ts`, `import-flow.ts`, `apps/studio/src/workers/import.worker.ts` (Worker chạy `importSvg`, báo tiến độ), `src/i18n/vi-import.ts`; tích hợp `project-doc.ts` (thêm item và file vào tài liệu; chỉ ghi đĩa khi Lưu, nguyên tử như 004; `.mat-backup` khi nâng cấp). Kiểm xanh T056. (Không có `ui/` trong task này nên chưa chặn bởi T005.)
- [ ] T058 [US1] Hộp thoại Nhập SVG (sau T005; FR-011; mockup cảnh 1): `apps/studio/src/ui/dialogs/import-svg.ts`, `import-report.ts` (bảng loại/chuyển/cảnh báo, xem trước trước/sau bằng bản đã lọc allowlist, tùy chọn Tối ưu, Lưu báo cáo bằng `csv_save`, trạng thái từ chối), lệnh **Thêm › Đồ họa SVG…** (Ctrl+Shift+I) ở menu, bảng lệnh, `commands.ts`; khóa khi project chỉ đọc hoặc 0.3 chưa nâng cấp; trợ năng (`role="dialog"`, bẫy focus, Esc, Enter nhập). File chung: chỉ thêm khối.
- [ ] T059 [US1] e2e `apps/studio/tests/e2e/import.e2e.mjs` (lớp Tauri giả có `svg_open`, axe-core; SC-015): nhập từng loại fixture, báo cáo hiện đúng mục, Lưu báo cáo, Hủy không đổi project, Nhập rồi Ctrl+Z, file quá lớn và DTD bị từ chối đúng thông báo, nhập bằng bàn phím hoàn toàn, 0 lỗi axe critical/serious ở hai theme.
- [ ] T060 [US1] Luật phụ thuộc nội dung SVG ở Studio (FR-024; sau T019 đỏ): `packages/project-schema/src/rules-04-svg.ts` (`E_SVG_UNSAFE`, `E_SVG_LIMIT`, `W_SVG_HEAVY`, `W_UID_NOT_IN_SVG` cho sự kiện, `W_BIND_ELEMENT_KIND`, `W_BIND_CLIP_EXISTS`), nối vào `validate.ts` (khi có nguồn SVG) và `apps/studio/src/model/validate-client.ts` (luồng chính, như `W_UID_NOT_IN_SVG` hiện có); Nạp xuống bị khóa khi có `E_SVG_*`. Kiểm xanh T019.
- [ ] T061 [US1] Trang runtime lọc lại SVG (FR-023, US1-12): `apps/runtime-web/tests/e2e/svg-unsafe.e2e.mjs` (runtime giả phục vụ project có SVG chứa `script`, `onload`, `javascript:`): trang không chạy mã (`__pwned` null), 0 yêu cầu mạng ngoài; chỉ dùng đường `mountScreen` đã đổi ở T022; thêm vào `npm run e2e -w @mat/runtime-web`.
- [ ] T062 **Checkpoint US1:** `./tools/ci-local.ps1`; ghi vào `docs/reports/008-acceptance.md`: SC-001, SC-002, SC-003, SC-010, SC-018 (nhập 20.000 phần tử ≤ 5 s đo ở Worker), SC-021; mục chưa đo ghi rõ.

---

## Phase 4: User Story 2 — Gắn Tag cho phần tử SVG bằng inspector (Priority: P1)

**Goal**: chọn phần tử trên canvas Studio, gắn Tag bằng inspector cho 13 loại animation, Thử giá trị, không viết JSON.

**Independent Test**: `npm test -w @mat/binding-engine -w @mat/studio`; e2e `svg-bind.e2e.mjs`; so DOM Studio và trang ở `web-it -Scenario svg`.

### Tests (viết trước, phải ĐỎ)

- [ ] T063 [P] [US2] Test đỏ `DomApplier` (FR-032…FR-041, FR-048; contract binding-animation §7): `packages/binding-engine/src/applier.test.ts` thêm (jsdom, `measure` giả, Web Animations giả, đồng hồ giả): từng đích mới; hợp biến đổi (một lần ghi mỗi phần tử mỗi flush; `M0` giữ); `spin` với `setKeyframes` khi `tx` đổi, `updatePlaybackRate`; `clipLevel` tạo một `clipPath` một lần và gỡ ở `dispose`; blink chung pha, tắt trả về giá trị gốc; flow `updatePlaybackRate`, đứng yên khi 0; `visibility` hidden đặt `pointer-events: none`; `reducedMotion`; tab ẩn tạm dừng; `onBadQuality` mặc định từng đích; `animationCount()`; không gọi `measure` mỗi lần cập nhật. Toàn bộ test 0.2 hiện có giữ xanh. **Ca tương thích:** quay 0.2 trên phần tử không có `transform` gốc cho cùng chuỗi hiển thị; có `transform` gốc thì giữ `M0` (khác 0.2 có chủ ý).
- [ ] T064 [P] [US2] Test đỏ mô hình Studio (FR-031, FR-042, FR-044, FR-045, FR-046): `apps/studio/src/model/animation-catalog.test.ts` (13 mục: đích, phần tử hợp, kiểu Tag hợp, phép biến đổi hợp, tham số mặc định lấy từ Tag), `svg-binding-doc.test.ts` (`addBinding`, `updateBinding`, `removeBinding`, `copyBindings`, `applyToMany`, `renameTag`, mỗi thao tác một bước hoàn tác, tới 100 bước; từ chối Tag sai kiểu kèm lý do; hai binding cùng nhóm đích bị từ chối), `svg-suggest.test.ts` (bảng Gợi ý của contract §6, từ khóa không phân biệt hoa thường và dấu), `svg-issues.test.ts` (lỗi theo dòng/phần tử từ `rules-04`).
- [ ] T065 [P] [US2] Test đỏ chọn phần tử (FR-030): `apps/studio/src/model/svg-select.test.ts` (hit-test với `elementsFromPoint` giả: phần tử có UID đầu danh sách, Alt chọn cha, Shift thêm, bỏ qua phần tử không UID; khung chọn quy về đơn vị thiết kế theo zoom và vị trí; thoát bằng Esc), `screen-edit/gesture` thêm trạng thái "vào item" (nhấp đúp hoặc Enter vào, nhấp ngoài thoát) có test.

### Implementation

- [ ] T066 [US2] Cài `DomApplier` mở rộng (sau T063 đỏ; FR-032…FR-041, FR-048): `packages/binding-engine/src/applier.ts`, `anim/{blink,flow,spin}.ts` (Web Animations; chung pha theo `now()`; `playbackRate`), dùng `transform-state` và `clip-level` (T027), `tagUnits`, `measure`, `reducedMotion`, `animationCount()`; xóa mã quay 0.2 cũ; kiểm xanh T063 và test 0.2.
- [ ] T067 [US2] Nối vào trang và Studio (FR-048): `packages/ui-components/src/screen/svg-item.ts` truyền `tagUnits` (từ `TagInfo.unit`), dùng `ElementBindings04`; `<mat-screen>` đếm hoạt ảnh vô hạn; e2e Chrome `apps/runtime-web/tests/e2e/anim.e2e.mjs` (runtime giả): `clipLevel` đúng trên `path` cong và nhóm, quay quanh gốc kim, di chuyển, co giãn, nhấp nháy đổi `opacity`, dòng chảy `strokeDashoffset` đổi theo thời gian, tab ẩn dừng, `prefers-reduced-motion` (đặt bằng CDP), phần tử có `transform` gốc giữ `M0`; đối chiếu kết quả spike T006.
- [ ] T068 [US2] Mô hình Studio (sau T064 đỏ): `apps/studio/src/model/animation-catalog.ts`, `svg-binding-doc.ts`, `svg-suggest.ts` (+ `svg-suggest-keywords.ts`), `svg-issues.ts`; tích hợp `project-doc.ts` (tải file binding theo item, lưu, `dirty`), `history.ts` (một bước mỗi thao tác); `i18n/vi-svg.ts`. Kiểm xanh T064.
- [ ] T069 [US2] Chọn phần tử (sau T065 đỏ): `apps/studio/src/model/svg-select.ts`, trạng thái "vào item" trong `screen-edit/gesture.ts` và `screen-workspace.ts` (`enteredItemId`, `selectedUids`). Kiểm xanh T065.
- [ ] T070 [US2] Canvas vào item và khung chọn (sau T005; FR-030; mockup cảnh 2): `apps/studio/src/ui/screen/mat-svg-overlay.ts` (khung chọn bám phần tử ở mọi zoom, chấm điểm gắn dùng sau), sửa `mat-screen-canvas.ts` (nhấp đúp hoặc Enter vào item, con trỏ chữ thập, đường dẫn "Màn hình › Item › Phần tử" ở thanh trạng thái, Esc thoát); giữ hình học và e2e của 007.
- [ ] T071 [US2] Cây phần tử (FR-030; SC-018): `apps/studio/src/ui/editors/svg-element-tree.ts` trong Details (`mat-details`): dựng lười, ô lọc, biểu tượng có binding hoặc sự kiện, `role="tree"` đúng (có con đầu khi không rỗng), phím ↑↓←→ Enter F2; chọn đồng bộ với canvas.
- [ ] T072 [US2] Inspector Gắn Tag (FR-031…FR-043; mockup cảnh 2): `apps/studio/src/ui/props-svg-element.ts` (thay `props-element.ts`: nhóm Chung, Gắn Tag, Sự kiện, Bảo mật), `props-svg-bind.ts` (13 dòng sinh từ `animation-catalog`, ô Tag kéo thả, nút phép biến đổi, trình soạn Rời rạc/Tuyến tính/Bảng giá trị/Khoảng, tham số gập, giá trị hiện tại, lỗi theo dòng), kéo Tag lên phần tử trên canvas (HTML5 DnD như 007); giữ khả năng xem project còn lỗi (đọc từ outline như `props-element.ts`).
- [ ] T073 [US2] Thanh **Thử giá trị** (FR-043; D28): `apps/studio/src/ui/test-strip.ts` (công tắc, thanh trượt, danh sách chọn; đặt giá trị trong `SimEngine` cho item đang vào; Đặt lại; không ghi project, không tới thiết bị); test model `test-strip.test.ts` (đặt, khôi phục khi bỏ chọn, không đụng chế độ Online).
- [ ] T074 [US2] **Gợi ý**, sao chép/dán bộ binding, áp cho nhiều phần tử (FR-044, FR-045): nút Gợi ý ở nhóm Gắn Tag; Ctrl+C/Ctrl+V khi focus inspector; áp nhiều phần tử (Shift+nhấp) một bước hoàn tác.
- [ ] T075 [US2] Đổi tên Tag, "Dùng ở đâu", xóa màn hình (FR-047): `apps/studio/src/model/rename-flow.ts`, `xref.ts` (loại `svgElement`), liệt kê sự kiện SVG khi xóa màn hình; test mở rộng `rename-flow.test.ts`, `xref.test.ts`.
- [ ] T076 [US2] e2e `apps/studio/tests/e2e/svg-bind.e2e.mjs` (SC-006, SC-014, SC-015): gắn từng loại trong 13 loại qua giao diện (không JSON), kiểm DOM của `<mat-screen>` sau giá trị mô phỏng; Khoảng chồng báo lỗi tại ô; kéo Tag sai kiểu bị từ chối; nhấp nháy 300 ms bị từ chối; Thử giá trị ≤ 100 ms; hoàn tác; Gợi ý; áp nhiều phần tử; đổi tên Tag; 0 lỗi axe ở hai theme; chỉ bàn phím.
- [ ] T077 [US2] e2e hiệu năng `apps/studio/tests/e2e/svg-perf.e2e.mjs` (SC-018): SVG 20.000 phần tử (sinh lúc chạy từ `limits.mjs`): nhập ≤ 5 s, mở cây ≤ 300 ms, chọn bằng nhấp ≤ 50 ms, Thử giá trị ≤ 100 ms, hoàn tác ≤ 100 ms; ghi `docs/reports/008-studio-perf.json`; không đạt thì tối ưu (dựng lười, bỏ phần tử không UID khỏi hit-test).
- [ ] T078 **Checkpoint US2:** `./tools/ci-local.ps1`; ghi `docs/reports/008-acceptance.md`: SC-006 (phần Studio), SC-014, SC-018, SC-015 (phần inspector).

---

## Phase 5: User Story 3 — Sự kiện của phần tử SVG (Priority: P1)

**Goal**: nhấp phần tử SVG để chuyển màn hình, mở popup, ghi, đảo, xung Tag với xác nhận và kiểm quyền, cùng đường ghi của 007.

**Independent Test**: runtime x64 + giả lập Modbus; Chrome headless; `web-it -Scenario svg-events`.

- [ ] T079 [P] [US3] Test đỏ (**test trước**, Constitution V; FR-049…FR-053; contract [svg-events.md](contracts/svg-events.md) §8): `packages/ui-components/src/control/svg-action-controller.test.ts` (mọi 13 `LockCode`; xác nhận `always` và `none`; kết quả `ACCEPTED→CONFIRMED`, `REJECTED`, `TIMEOUT`, `FAILED`, `UNKNOWN`; `toggle` kèm `expect`; `pulse` kèm `pulseMs`; `context = { screen, widget: elementUid }`; không gửi lại), `screen/svg-events.test.ts` (thuộc tính đặt đúng; Enter, Space, nhấp; phần tử sâu nhất thắng; ẩn bỏ nhấp và `tabindex=-1`; `mode: 'edit'` không gắn; `dispose` gỡ sạch; lý do khóa ở `<title data-mat-runtime>` và vùng `status`).
- [ ] T080 [US3] Cài (sau T079 đỏ): `packages/ui-components/src/control/svg-action-controller.ts` (widget ảo → `ControlController`), `screen/svg-events.ts` (`bindSvgEvents`), vùng `role="status"` (`StatusSink`) và quy tắc CSS focus/khóa trong `<mat-screen>` / `svg-item.ts`, i18n tái dùng `control-vi.ts`; `@mat/ui-components` 0.2.0 (T118). Kiểm xanh T079 và test widget 007.
- [ ] T081 [US3] Studio nhóm Sự kiện (sau T005; FR-054; mockup cảnh 2): model `apps/studio/src/model/svg-binding-doc.ts` thêm `setEvent`/`clearEvent` (test mở rộng T064: hành động, đích chỉ đúng loại màn hình, Tag chỉ RW không `calculated`, `durationMs`, xác nhận, `minRole` đồng bộ nhóm Bảo mật, nhãn ≤ 80); UI `apps/studio/src/ui/props-svg-events.ts` (danh sách hành động, đích, Tag kéo thả, giá trị theo kiểu Tag, nhắc `W_EVENT_PULSE_READBACK`, lỗi `E_EVENT_*` đúng ô).
- [ ] T082 [US3] e2e trang `apps/runtime-web/tests/e2e/svg-events.e2e.mjs` (runtime giả, axe-core; SC-013, SC-015): nhấp mở popup; chuyển màn hình; ghi có xác nhận và kết quả; viewer khóa kèm lý do; Tab và Enter; phần tử `fill="none"` nhận nhấp; phần tử ẩn không nhấp; 0 lỗi axe; thêm vào `npm run e2e -w @mat/runtime-web`.
- [ ] T083 [P] [US3] Kiểm `context` cho phần tử SVG ở C++ (câu 3 của plan; chỉ thêm test): `core/tag-engine/tests/write_extensions_test.cpp` thêm ca `context.widget = "el_abcdefghij"` được giữ trong audit (`isContextId` hiện chấp nhận chữ thường đầu, `[a-z0-9_-]`, ≤ 64) và `context.widget` > 64 ký tự hoặc có chữ hoa bị bỏ; không đổi mã sản phẩm; chạy ctest.
- [ ] T084 [US3] Tích hợp x64 `-Scenario svg-events` (`tests/web-it/`, `tools/web-it.ps1`; FR-051, SC-013): project `svg-demo` (T093) hoặc `dashboard-demo` cộng đồ họa có sự kiện; nhấp phần tử → hộp xác nhận → ghi qua giả lập Modbus → `CONFIRMED`; audit `channel` `web`, `context.widget` = `elementUid`; khóa 13 mã; **30 ca tấn công của 007 chạy lại với lệnh từ phần tử SVG**: 100 % bị từ chối, 0 lệnh tới giả lập, audit đủ; xung đóng trình duyệt ngay (bit trả về); ghi `docs/reports/008-svg-events-x64.json`.
- [ ] T085 [US3] Xem trước Studio chạy sự kiện (FR-054; US3-10): `preview-hosts.ts` (không đổi giao diện; kiểm `SimActionHost`, `DeviceActionHost` với `context.widget` = `elementUid`), e2e trong `svg-bind.e2e.mjs` hoặc file riêng: nhấp ở Mô phỏng ghi vào mô phỏng; chế độ chỉnh sửa nhấp là chọn; Thiết bị đi qua API Studio (kênh `studio`).
- [ ] T086 **Checkpoint US3:** `./tools/ci-local.ps1`; ghi `docs/reports/008-acceptance.md`: SC-013.

---

## Phase 6: User Story 4 — Thư viện ký hiệu và dựng lại màn hình bồn nước + motor (Priority: P2)

**Goal**: 12 ký hiệu SVG sạch có bộ phận và điểm gắn; kéo thả tạo item `svg`; dựng lại `tank-demo` hoàn toàn trong Studio.

**Independent Test**: `npm test -w @mat/symbols`; e2e `symbols.e2e.mjs`, `rebuild-tank.e2e.mjs`.

- [ ] T087 [P] [US4] Vẽ ký hiệu (FR-055, FR-056; contract [symbol-library.md](contracts/symbol-library.md) §3, §4): 15 tệp `packages/symbol-library/svg/*.svg` (bồn đứng, bồn nằm, bơm ly tâm, bơm định lượng, van cổng, van điều khiển, van một chiều, motor AC, quạt, ống ngang, ống đứng, cút ×4 biến thể), `manifest.json` (bộ phận với UID `el_<ký hiệu>_<bộ phận>`, điểm gắn, `suggest`), `LICENSES.md` (CC0-1.0, do dự án vẽ, không logo/hình/font của hãng); thêm dòng vào `third_party/LICENSES.md` nêu "không thư viện mới; ký hiệu do dự án vẽ".
- [ ] T088 [P] [US4] Test đỏ ký hiệu (FR-055, FR-056, SC-017): `packages/symbol-library/tests/symbols.test.ts` (mỗi tệp qua `sanitizeSvg` không loại gì và `importSvg` không `converted`; không `<style>`, `class`, `id`; có `<title>`; ≤ 8 KB và ≤ 60 phần tử; `manifest` khớp schema; mỗi `parts[].uid` có đúng một phần tử `data-mat-uid`; điểm gắn trong hộp bao `viewBox`; `viewBox` khớp), `ports.test.ts` (`portSnap`: trùng khít, trong và ngoài ngưỡng 10 điểm ảnh, nhiều cặp chọn gần nhất, hướng không tương thích, zoom 25 % và 400 %, danh sách rỗng, Alt tắt).
- [ ] T089 [US4] Cài thư viện (sau T088 đỏ): `packages/symbol-library/src/{index,manifest,ports}.ts`; kiểm xanh T088; sửa tệp SVG nếu test bắt lỗi.
- [ ] T090 [US4] Mô hình thả ký hiệu (FR-057; **test trước** `symbol-flow.test.ts`, rồi cài): `apps/studio/src/model/symbol-flow.ts` (thả → sao `graphics/symbols/<tệp>` nếu chưa có; item `svg` với `id` ≤ 32 ký tự, cỡ `defaultSize`, dính lưới; file binding riêng; `elements` có bộ phận; một bước hoàn tác; nhiều thể hiện dùng chung một tệp), tích hợp `portSnap` vào `screen-edit/snap.ts` (dính điểm gắn thắng khi trùng dính lưới; Alt tắt).
- [ ] T091 [US4] Toolbox **Ký hiệu SVG** (sau T005; FR-057; mockup cảnh 4): `apps/studio/src/ui/mat-taskcards.ts` (nhóm Bồn, Bơm, Van, Motor, Ống, ô tìm, kéo thả HTML5 DnD), chấm điểm gắn trong `mat-svg-overlay.ts`, kéo gần điểm gắn hiện chấm xanh và dính.
- [ ] T092 [US4] **Gắn nhanh** (FR-058): trong `props-svg-element.ts`, khi item có `svgFile` khớp tệp của manifest: danh sách bộ phận kèm `suggest`; bấm → vào item, chọn phần tử, mở dòng gợi ý đầu tiên; test model `quick-bind.test.ts`.
- [ ] T093 [US4] Project mẫu `projects/svg-demo` 0.4.0 (sinh bằng `tools/svg-demo/generate.mjs`, **không viết tay**; tùy chọn `--standard` sinh màn hình chuẩn 3b ≈ 3.000 phần tử, 30 binding, 10 hoạt ảnh, 5 sự kiện, 100 Tag cho T108): 2 màn hình (Bồn nước, Tổng quan) + popup Bơm 1; đồ họa nhập từ fixture (qua `importSvg`), ký hiệu bơm/van/bồn/motor/ống, ≥ 30 binding đủ 13 loại động hóa, 5 sự kiện, dùng Tag của `modbus-demo` cộng Tag mô phỏng; test `node --test tools/svg-demo`; `validate:project` xanh; thêm `projects/svg-demo` vào `package.json` `validate:project` (T031).
- [ ] T094 [US4] e2e ký hiệu `apps/studio/tests/e2e/symbols.e2e.mjs` (SC-017): thả từng ký hiệu, dính hai ống, Alt tắt dính, Gắn nhanh mở đúng dòng, 40 item `svg` trên một màn hình mở được (đo thời gian dựng), 65 item bị `E_LIMIT`, 0 lỗi axe.
- [ ] T095 [US4] e2e **dựng lại màn hình bồn nước + motor** `apps/studio/tests/e2e/rebuild-tank.e2e.mjs` (SC-004; contract [studio-svg-editor.md](contracts/studio-svg-editor.md) §14): từ project rỗng có Tag của `tank-demo`, dựng bằng ký hiệu, nhập `inkscape-02`, gắn mức, chữ, đèn theo bảng, quay motor, dòng chảy, sự kiện xung; `validate` không lỗi; lưu; ghi số thao tác; **script đối chiếu** `tools/svg-demo/compare-tank.mjs`: nạp vào runtime x64 và so đích binding (chữ, màu, mức, quay) với `tank-demo` gốc trên cùng Tag mô phỏng; 100 % phần tử đích đổi đúng, nhấp "bơm" có xác nhận và audit.
- [ ] T096 **Checkpoint US4:** `./tools/ci-local.ps1`; ghi `docs/reports/008-acceptance.md`: SC-004, SC-017, phần SC-005 (40 item, x64).

---

## Phase 7: User Story 5 — Nhập lại SVG đã chỉnh sửa mà giữ UID và binding (Priority: P2)

**Goal**: thay SVG của item bằng bản sửa ngoài, giữ UID, binding, sự kiện của phần tử khớp; mơ hồ hỏi; mồ côi chặn Nạp xuống.

**Independent Test**: bộ cặp `tests/fixtures/svg-import/reimport/*`; `npm test -w @mat/svg-import`; e2e `reimport.e2e.mjs`.

- [ ] T097 [P] [US5] Bộ cặp nhập lại (FR-026, SC-009; research R18): `tests/fixtures/svg-import/reimport/<cặp>/{v1.svg, v2.svg, answer.json}` ≥ 6 cặp, ≥ 150 phần tử có đáp án: (1) Inkscape lưu lại giữ `data-*`; (2) Inkscape "Plain SVG" bỏ `data-*` giữ `id`; (3) xuất lại qua LibreOffice mất `id` và `data-*` (nếu `soffice` có; không thì kịch bản biến đổi tương đương, ghi rõ); (4) dời và nhóm lại phần tử; (5) đổi tên `id`, thêm 3 và xóa 2 phần tử; (6) lưới 12 hình chữ nhật giống hệt (phải ra "cần chọn", không tự gán). `answer.json`: phần tử bản mới → UID bản cũ hoặc `null`.
- [ ] T098 [P] [US5] Test đỏ đối chiếu (**test trước**; FR-026, FR-027, SC-009): `packages/svg-import/src/signature.test.ts` (hộp bao từ thuộc tính cho từng loại hình, áp `transform` đầy đủ, `D` đối xứng và bất biến khi dời toàn bộ), `match.test.ts` (bốn bước với từng cặp; UID ngoài tập bản cũ bị bỏ; UID trùng không dùng; `id` trùng một phía không dùng; mơ hồ → `ambiguous` ≤ 3 ứng viên; mồ côi; phần tử cũ khớp tối đa một; **0 gán sai tự động** trên toàn bộ cặp; ≥ 90 % phần tử có binding khớp đúng; 20.000 phần tử ≤ 3 s), `apply-match.test.ts` (UID cuối đúng theo lựa chọn).
- [ ] T099 [US5] Cài (sau T098 đỏ): `packages/svg-import/src/signature.ts`, `match.ts` (`matchSvg`, `applyMatch`), `import.ts` nhận `previous` và trả `match`; dùng `transform-parse` (T021). Kiểm xanh T098.
- [ ] T100 [US5] **Hiệu chỉnh ngưỡng** (SC-009; ADR-023 mục 7): chạy bộ cặp, vẽ phân bố `D` của khớp đúng và sai, chỉnh `0,25/0,05/0,005/0,002` nếu có ca sai hoặc ca mơ hồ đáng lẽ khớp; ghi số vào ADR-023 "Số đo", contract §7 và `docs/reports/008-fixtures.json`; bất biến: 0 gán sai tự động.
- [ ] T101 [US5] Test đỏ luồng nhập lại (FR-028, FR-029; **test trước**): `apps/studio/src/model/reimport-flow.test.ts` (trạng thái `idle → reading → importing → matching → resolve → applied|cancelled`; lựa chọn mặc định "Mới"; "Bỏ binding", "Giữ mồ côi"; Áp dụng thay SVG, `elements` và file binding trong một bước hoàn tác; Hủy không đổi; hai item chung một tệp SVG: hỏi "áp cho mọi thể hiện" hay "tách", mặc định tách; UID giữ qua lưu và mở lại).
- [ ] T102 [US5] Cài và giao diện (sau T005 và T101 đỏ): `apps/studio/src/model/reimport-flow.ts`, `apps/studio/src/ui/dialogs/reimport.ts` (mockup cảnh 3: tóm tắt giữ/mới/cần chọn/mồ côi, hai phần tử cạnh nhau, chọn ứng viên), lệnh **Nhập lại SVG…** (menu ngữ cảnh item, bảng lệnh), nhấp đúp lỗi `E_REF_UID` mở hộp thoại; `E_REF_UID` chặn Nạp xuống.
- [ ] T103 [US5] e2e `apps/studio/tests/e2e/reimport.e2e.mjs` (SC-009, SC-015) và kiểm UID qua Lưu, Đọc lên, So sánh (FR-029; `tools/svg-demo/uid-roundtrip.mjs` với runtime x64: Nạp xuống rồi Đọc lên, UID và binding giữ nguyên, So sánh "giống"): các cặp của T097; mồ côi chặn Nạp xuống; Hủy không đổi; chỉ bàn phím; 0 lỗi axe.
- [ ] T104 **Checkpoint US5:** `./tools/ci-local.ps1`; ghi `docs/reports/008-acceptance.md`: SC-009.

---

## Phase 8: User Story 6 — Hiển thị, hiệu năng và an toàn khi vận hành (Priority: P3)

**Goal**: nâng cấp 0.3 → 0.4, tương thích, đo thời gian mở, hoạt ảnh, tải trên x64.

- [ ] T105 [P] [US6] Test đỏ nâng cấp ở Studio (FR-005, FR-006; US6-1): `apps/studio/tests/e2e/upgrade04.e2e.mjs`: mở `dashboard-demo` 0.3 → hộp thoại Nâng cấp lên 0.4.0 (nội dung đổi, nơi sao lưu; Nâng cấp, Chỉ đọc, Hủy); 0.1 và 0.2 qua chuỗi một lần; chỉ đọc vẫn xem trước được; Nạp xuống project 0.4 lên runtime < 0.7.0 bị khóa ở dòng "Tương thích runtime".
- [ ] T106 [US6] Cài nâng cấp, so sánh, xem trước nạp xuống (FR-005, FR-010): `apps/studio/src/model/project-doc.ts` (gọi `migrate03to04`), `download-flow.ts` (dòng tương thích 0.7.0, tổng dung lượng SVG, `W_SVG_HEAVY`), `compare-view.ts` (binding và sự kiện SVG theo item/phần tử), hộp thoại nâng cấp (dùng lại của 007). Kiểm xanh T105; giữ e2e 004–007.
- [ ] T107 [US6] Tích hợp x64 hiển thị và tương thích (SC-006, SC-011): `tools/web-it.ps1 -Scenario svg` (mọi đích của `svg-demo` đổi đúng theo Tag mô phỏng tất định; **DOM và thuộc tính hiển thị giống Studio xem trước** ở 100 % phần tử của bộ ca), `-Scenario compat` (0.1–0.3: cùng phần tử đích, cùng giá trị binding, ảnh chụp ≤ 0,5 %; ca quay trên phần tử có `transform` gốc có test riêng), ghi `docs/reports/008-svg-x64.json`, `008-compat-x64.json`.
- [ ] T108 [US6] Đo thời gian mở và tải x64 (SC-005, SC-007): `-Scenario open-svg` (màn hình chuẩn 3b ≈ 3.000 phần tử, 30 binding, 10 hoạt ảnh, 5 sự kiện, 100 Tag ≤ 2 s; 40 item `svg` ≤ 2 s), `-Scenario f5x10-svg` (10 phiên ≤ 5 s), `-Scenario load-svg -Seconds 1800` (10 client + 500 Tag mô phỏng: CPU, RSS, mất sequence); sinh dự án chuẩn bằng `tools/svg-demo/generate.mjs --standard`; ghi `docs/reports/008-open-x64.json`, `008-f5x10-x64.json`, `008-load-x64.json`; số x64 qua loopback không thay cho số BL335 (T123, T124).
- [ ] T109 [P] [US6] Đo hoạt ảnh (SC-008, D39): `tools/measure/anim-bench.mjs` (Chrome headless, trang thử với 100 phần tử quay liên tục/nhấp nháy/dòng chảy, `performance.now` mỗi khung, 30 phút; tab ẩn: đếm callback `requestAnimationFrame`); p95 khung ≤ 8 ms, bộ nhớ +≤ 50 MB; ghi `docs/reports/008-anim-x64.json`; không đạt thì tối ưu (gộp hoạt ảnh) hoặc hạ giới hạn `W_ANIM_MANY`/`E_LIMIT` và sửa spec, ADR-024.
- [ ] T110 [P] [US6] Gói trang và lint (SC-021, SC-022): `-Scenario bundle` (JS+CSS khởi động ≤ 250 KB gzip; không `eval`, `innerHTML`; **`@mat/svg-import` không có trong gói của trang**: kiểm bằng `apps/runtime-web/scripts/package-web.mjs` hoặc grep trên bản build); `npm run lint` xanh.
- [ ] T111 **Checkpoint US6:** `./tools/ci-local.ps1`; ghi `docs/reports/008-acceptance.md`: SC-005 (x64), SC-006, SC-007 (x64), SC-008, SC-011, SC-016, SC-022; mục BL335 ghi "chưa đo" (T123, T124).

---

## Phase 9: Polish, rà soát bảo mật, CI, tài liệu, đóng gói, nghiệm thu trên BL335

- [ ] T112 Rà soát bảo mật (FR-064; Constitution V; research R21): `docs/reports/008-security-review.md`: allowlist (phần tử, thuộc tính, CSS, URL), DTD và entity, bom (`use`, filter, độ sâu, ảnh), mXSS và CDATA, Shadow DOM và `id`, UID giả mạo khi nhập lại, sự kiện SVG và đường ghi Tag (chạy lại 30 ca tấn công), lệnh Rust `svg_open`, lộ thông tin trong báo cáo, clickjacking (giữ); liệt kê giới hạn còn lại (D30: runtime không từ chối gói có SVG độc; XSS đã thực thi ghi dưới quyền operator đang đăng nhập). **Chạy trước T121 và trước mọi port-forward.**
- [ ] T113 [P] Fuzz importer (FR-059): `tools/svg-import/fuzz.mjs` (đột biến ngẫu nhiên tất định theo seed trên 10 fixture và bộ độc hại: cắt, lặp, đổi ký tự, lồng sâu, thuộc tính dài): importer không ném lỗi ngoài `ok: false`, không treo (mỗi ca ≤ 2 s), `assertAllowlisted` luôn đúng với `ok: true`; 10.000 ca trong ≤ 3 phút ở CI, bản dài 1 giờ chạy tay; ghi `docs/reports/008-fuzz-x64.json`.
- [ ] T114 [P] Trợ năng (FR-067, SC-015): chạy axe ở mọi hộp thoại và inspector mới, hai theme, trang runtime có đồ họa nhập và sự kiện; sửa lỗi critical/serious; 👤 kiểm tay với NVDA (phần tử nhấp được đọc là nút có nhãn; khóa và kết quả được thông báo); ghi vào báo cáo.
- [ ] T115 [P] Đối chiếu studio-ux (SC-019): `docs/reports/008-sc019.md` (bảng từng quy tắc §5 và §7 cho hộp thoại Nhập SVG, Đối chiếu lại, inspector Gắn Tag, Sự kiện, cây phần tử, Toolbox Ký hiệu; khác biệt so với mockup `studio-svg.html`); cập nhật `docs/architecture/studio-ux.md` (mục 3b "Đã làm") và `docs/architecture/svg-dialects.md` (mục importer: những gì đã làm, bảng loại/chuyển, giới hạn).
- [ ] T116 [P] Tài liệu (FR-065): README `packages/svg-import`, `packages/symbol-library`; mục "Nhập SVG và gắn Tag" trong `apps/studio/README.md`; `docs/guides/svg-export.md` (thư mục mới; cách xuất SVG từ Inkscape, Illustrator, CorelDRAW để nhập sạch: lưu dạng "Plain SVG"/"Presentation attributes", nhúng ảnh, chuyển chữ thành đường nét hoặc dùng font thường, tránh `flowRoot`, kích thước, ví dụ báo cáo); `schemas/README.md`; `docs/deployment/mat-runtime.md` (runtime 0.7, SVG không nén, `W_SVG_HEAVY`).
- [ ] T117 [P] Bảng phủ FR và SC: `docs/reports/008-fr-matrix.md` (mỗi FR/SC → task, test, báo cáo); kiểm bằng `/speckit-analyze`.
- [ ] T118 Phiên bản (FR-066): runtime 0.7.0 (CMake, `RUNTIME_VERSION`, `package-runtime.ps1`, `deploy.sh` nhắc), Studio 0.6.0 (`apps/studio/package.json`, `tauri.conf.json`, `Cargo.toml`), `@mat/ui-components` 0.2.0, `@mat/svg-import` 0.1.0, `@mat/symbols` 0.1.0, `schemas/protocol-version.json`; API 1.2.0 và live 1.2.0 giữ; dựng bộ cài Studio (`npm run studio:build`, `C:\build\mat-studio`) và gói runtime (`package-runtime.ps1`); kiểm `third_party/LICENSES.md` không thêm thư viện.
- [ ] T119 CI (FR-025): `tools/ci-local.ps1` và `.github/workflows/ci.yml` thêm: Vitest cho 3 package mới, `svg:inspect --import`, e2e Studio và trang mới, `cargo test --lib`, ctest `rules_04`/`vectors_04`; kiểm thời gian tổng không tăng quá mức chấp nhận; (bộ độc hại với Chrome và `anim-bench` chạy theo tùy chọn `-Full`).
- [ ] T120 👤 **File SVG thật từ Illustrator và CorelDRAW** (D23, FR-060): xin người dùng cung cấp ≥ 1 file xuất thật mỗi phần mềm (hoặc ≥ 3 như T036 của Sprint 0); đặt vào `tests/fixtures/svg-import/real/` (giấy phép rõ ràng, không dữ liệu nhạy cảm), chạy `svg:inspect --import` và so ảnh, thay mục mô phỏng tương ứng trong `manifest.json`, cập nhật `README.md`, `svg-dialects.md` và `docs/reports/008-fixtures.json`. Chưa có file: giữ "đạt trên mô phỏng" trong báo cáo, **không** tuyên bố SC-001 đầy đủ cho hai phần mềm này.
- [ ] T121 ⚠️🔌 **(SSH không có; chờ người dùng cho phép hoặc tự chạy lệnh quickstart §9)** Cài runtime 0.7.0 lên BL335: `deploy.sh` (gói T118), đọc lời nhắc; tài khoản operator có sẵn từ 007 hoặc `--user-add`; ghi `docs/reports/device-changes.md` kèm cách hoàn tác. Chỉ sau T112 xong.
- [ ] T122 ⚠️🔌 Nạp xuống `svg-demo` và `dashboard-demo` từ Studio; mở trên Chrome từ ≥ 2 máy; hoạt ảnh, sự kiện, đăng nhập đúng; dòng "Tương thích runtime" khóa nạp project 0.4 lên runtime cũ; ghi vào `008-acceptance.md`.
- [ ] T123 ⚠️🔌 Đo SC-005 trên BL335: màn hình chuẩn 3b mở ≤ 2 s (bộ nhớ đệm trống, từ ≥ 2 máy); 10 client F5 cùng lúc ≤ 5 s (`tools/load-tester` và Chrome thật); màn hình 40 item `svg` ≤ 2 s; **SVG ≥ 1 MiB đo riêng** (D31): không đạt thì ghi giới hạn và rủi ro nén tại runtime vào ADR-023, plan, báo cáo; ghi `docs/reports/008-bl335-open.json`.
- [ ] T124 ⚠️🔌 Đo SC-007 trên BL335: 30 phút, 10 client xem màn hình chuẩn 3b, 500 Tag mô phỏng/1 s: CPU trung bình ≤ 30 %, RSS ≤ 150 MB (`systemctl show mat-runtime`), 0 mất sequence, ghi eMMC do audit; ghi `docs/reports/008-bl335-load.json`.
- [ ] T125 ⚠️🔌 Điều khiển thật từ phần tử SVG: operator nhấp phần tử xung bit lệnh (đóng trình duyệt ngay sau xác nhận: bit trả về), đảo công tắc; có xác nhận và audit đủ; viewer bị khóa; rút cáp PLC (nếu có bàn thử): phần tử liên quan khóa; `kill -9 mat-runtime` giữa lúc chờ xung (cần người ở cạnh).
- [ ] T126 ⚠️🔌 Quay lại: `rollback.sh`; kiểm project 0.4 bị runtime cũ từ chối đúng cách; khôi phục project cũ bằng Studio; ghi `device-changes.md`.
- [ ] T127 👤 Thử tay (quickstart §7): bộ gõ Telex và Unikey khi đặt tên phần tử (F2) và nhãn sự kiện (20/20 lần đúng "Bơm nước số 1"); Chrome ≥ 120 thật và WebView2 thật (hộp thoại Nhập SVG, canvas, hoạt ảnh mượt, `svg_open`); danh sách phiên bản đã thử ghi vào báo cáo.
- [ ] T128 Báo cáo nghiệm thu `docs/reports/008-acceptance.md`: số đo từng SC, danh sách phiên bản Chrome đã thử, kết quả 10 fixture (ghi rõ 4 thật, 6 mô phỏng), bộ độc hại, nhập lại, dựng lại `tank-demo` (số thao tác), mục chưa đo (BL335, file thật, thử tay), thay đổi hành vi quay so với 0.2, giới hạn D30 và D31.
- [ ] T129 Cập nhật ADR 023–026: điền "Số đo / bằng chứng" thật, chuyển **Accepted** phần đã đo (giữ Proposed phần chờ BL335); `docs/adr/README.md` cập nhật trạng thái (chỉ sửa dòng của 023–026); `docs/plans/roadmap-v2.md` §4.4 cập nhật trạng thái; ghi ngày.
- [ ] T130 Commit mốc cục bộ (không push) khi người dùng cho phép hoặc theo quyết định toàn quyền: gộp theo giai đoạn (nền, importer, binding, sự kiện, ký hiệu, nhập lại, tài liệu).
- [ ] T131 👤 Đo SC-020: một kỹ sư chưa dùng tính năng làm trọn kịch bản (nhập SVG, gắn mức nước, màu đèn, quay motor, thêm sự kiện, xem trước Mô phỏng, Nạp xuống) ≤ 20 phút không cần tài liệu; không có người thì ghi "tự đo" kèm thời gian và các chỗ vấp, như 004.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → các user story → **Polish (Phase 9)**.
- **T005** (duyệt mockup) chặn mọi task giao diện Studio mới (T058, T070, T071, T072, T081, T091, T102). **T006** (spike Chrome) chặn T066 (hợp biến đổi, `clipLevel`) và T027. **T007** (spike Tối ưu) chặn T047, T054. **T008** (Inkscape) chặn T033. **T010** (BL335, ⚠️🔌) chỉ chặn nội dung R20, T123.
- **Phase 2:** T011 (vector) và T012 (schema) trước T014; T013 trước T014; T015 sau T014; T016, T017, T018 sau T015; T019–T023 (allowlist) độc lập với T011–T018 (làm song song được); T024–T027 (binding thuần) độc lập, T025 sau T024, T027 sau T026 và T021 (`transform-parse`); T028 (test C++) sau T011; T029 sau T028 và T013; T030, T031 sau T029.
- **US1** cần Phase 2 (T021, T022, T029 cho trang): T033–T036 (dữ liệu) song song và độc lập; T037–T042 (test) sau T021 (allowlist) và dữ liệu T033–T036; T043–T049 sau test tương ứng; T050 sau T049; T051 sau T049; T052, T053 sau T051; T055 (Rust) độc lập; T056–T057 (mô hình) sau T049; T058 sau T005 và T057; T059 sau T058; T060 sau T019, T021; T061 sau T022.
- **US2** cần US1 (item `svg` có UID để gắn; có thể dùng fixture project sinh thủ công cho test model) và T066 sau T063, T025, T027; T068 sau T064; T069 sau T065; T070–T075 sau T005, T068, T069; T076 sau T072–T074; T077 sau T049, T071.
- **US3** cần US1 (item `svg`) và 007 (ControlController); T079–T080 độc lập với US2 (làm song song được sau Phase 2); T081 sau T005, T068; T082 sau T080; T083 độc lập; T084 sau T080 và T093 (project mẫu) hoặc `dashboard-demo` cộng đồ họa; T085 sau T081, T080.
- **US4** cần US1 (importer cho tệp ký hiệu kiểm) và US2 (Gắn nhanh): T087–T089 độc lập với Studio (cần T021, T049 để test); T090 sau T089 và T057; T091 sau T005, T090; T092 sau T072, T089; T093 sau T049, T089, T068; T095 sau T091, T092, T072, T080.
- **US5** cần US1 (importer, UID) và T021 (`transform-parse`): T097–T100 độc lập với Studio; T101–T102 sau T057, T005; T103 sau T102, T093.
- **US6** cần US1–US4 (T106 sau T057, T105; T107, T108 sau T093; T109 sau T066).
- **Polish:** T112 chạy trước T121 và trước mọi port-forward; T113 sau T049; T118 sau các story; T121 cần T112, T118; T122–T126 cần T121; T128 cần T122–T127 (hoặc ghi "chưa đo"); T129 sau T128.

### Phối hợp với 004…007 và 009…011

- 004–007 đã xong về mã (commit gần nhất `634d528`); lượt `ci-local` đang chạy khi viết tài liệu này: **không có task nào bắt đầu trước khi lượt đó xong**. Vẫn giữ nguyên tắc "chỉ thêm khối" ở file chung. Điểm 008 đổi so với 004–007: `sanitizeSvg` (denylist → allowlist), quay của `DomApplier` (giữ `transform` gốc), trần item `svg` 8 → 64, ADR-003 mục 4 (`data-mat-name`), `props-element.ts` (thành inspector sửa được), `lib.rs` (một lệnh). Mỗi thay đổi kèm chạy lại test của feature gốc.
- Specs 009 (alarm), 010 (lịch sử, báo cáo), 011 (hoàn thiện) đang được viết song song: **008 chiếm định dạng 0.4.0, `@mat/ui-components` 0.2.0, runtime 0.7.0, Studio 0.6.0** theo thứ tự giai đoạn; 009 đã ghi dự phòng "nếu GĐ 3b chiếm 0.4.0 thì đổi cả bộ ở task T002 của nó" (định dạng 0.5.0, `ui-components` 0.3.0); không sửa spec của 009–011 ở đây. File chung dễ đụng nhau: `schemas/protocol-version.json`, `schemas/*.schema.json` (0.4.0 → 0.5.0), `packages/project-schema/src/{codes,index,validate}.ts`, `core/project-manager/project_validator.cpp`, `apps/studio/src/ui/mat-taskcards.ts`, `CMakeLists.txt`: chỉ thêm khối; kiểm `git status` trước khi sửa.

| Task 008 | File của 004–007 | Ghi chú |
|---|---|---|
| T012, T013, T015, T017, T018 | `schemas/*`, `packages/project-schema/src/{codes,index,validate,project-files,compare,rename,migrate}.ts` | file chung; vector 0.1–0.3 giữ kết luận |
| T022, T023 | `packages/svg-renderer/src/{sanitize,mount,index}.ts` | rủi ro cao; `svg-load`, e2e 007 |
| T025, T066, T067 | `packages/binding-engine/src/{applier,transforms}.ts`, `packages/ui-components/src/screen/svg-item.ts` | giữ test 0.2; `compat` |
| T029, T030 | `core/project-manager/*`, `server/` hằng phiên bản, `deployment/package-runtime.ps1` | chạy lại ctest đầy đủ |
| T058, T070–T072, T081 | `apps/studio/src/ui/{props-element,mat-screen-canvas,mat-details}.ts`, `screen-edit/gesture.ts`, `commands.ts` | giữ e2e 004–007 |
| T055 | `apps/studio/src-tauri/src/lib.rs` | thêm một dòng đăng ký lệnh |
| T075, T106 | `apps/studio/src/model/{rename-flow,xref,project-doc,download-flow,compare-view}.ts` | thêm đối tượng mới |
| T050, T119 | `tools/ci-local.ps1`, `.github/workflows/ci.yml`, `package.json` | thêm khối |

### Parallel Opportunities

- Phase 1: T001, T002, T003, T004, T006, T007, T008, T009 [P].
- Phase 2: T011, T019, T020, T024, T026, T028 [P]; nhánh allowlist (T020→T021→T022, T023) song song với nhánh định dạng (T012→T015) và nhánh C++ (T028→T029).
- US1: T033–T036 [P] (dữ liệu); T037–T041 [P] (5 test); T055 [P] (Rust).
- US2: T063–T065 [P] (3 test).
- US3: T079, T083 [P].
- US4: T087, T088 [P].
- US5: T097, T098 [P].
- US6: T105, T109, T110 [P].
- **Song song giữa các phase:** sau Phase 2, ba luồng độc lập: (a) importer (US1 T037–T054) + nhập lại phần thuần (US5 T097–T100); (b) binding và hoạt ảnh (US2 T063–T067) + sự kiện phần trang (US3 T079–T080, T082); (c) ký hiệu phần thuần (US4 T087–T089) + Rust (T055); giao diện Studio (T058, T070–T074, T081, T091, T102) bắt đầu sau T005.

### Parallel Example: Phase 2

```text
T011 vector v04      T019 rules-04-svg test    T020 allowlist test      T024 transforms test
T026 transform-state test   T028 C++ rules_04 test
→ T012 → T013 → T014 → T015 → T016/T017/T018
→ T021 → T022 → T023
→ T025, T027
→ T029 → T030, T031 → T032 (Checkpoint)
```

### Parallel Example: User Story 1

```text
T033 Inkscape   T034 mô phỏng   T035 độc hại   T036 giới hạn   (dữ liệu, song song)
T037 prescan   T038 css   T039 normalize   T040 uid/name   T041 write/report   → T042 import test
→ T043 → T044 → T045 → T046 → T047 → T048 → T049 → T050, T051 → T052, T053, T054
T055 Rust (song song)  → T056 → T057 → (sau T005) T058 → T059 → T060, T061 → T062
```

### Parallel Example: User Story 2

```text
T063 applier test   T064 model test   T065 select test   (cả ba song song)
→ T066 → T067;  T068 (sau T064);  T069 (sau T065)
→ (sau T005) T070 canvas → T071 cây → T072 inspector → T073 Thử giá trị, T074 Gợi ý, T075 rename
→ T076 e2e → T077 perf → T078
```

## Implementation Strategy

1. **MVP = US1 + US2 + US3** (cùng P1): nhập SVG an toàn, gắn Tag bằng inspector, sự kiện. Thứ tự giao: Phase 1 → Phase 2 → US1 (nhập; rà soát bảo mật T112 ngay sau) → US2 (gắn Tag) → US3 (sự kiện) → US4 (ký hiệu + dựng lại tank-demo) → US5 (nhập lại) → US6 → Polish.
2. **Lý do US1 trước (cả phần allowlist ở Phase 2):** nợ Constitution V và bề mặt tấn công mới (file không tin cậy); allowlist thay denylist làm sớm vì trang runtime đang chạy denylist.
3. **Chạy song song tối đa:** ba luồng độc lập sau Phase 2 (importer; binding và sự kiện phía trang; ký hiệu và Rust); giao diện Studio sau T005.
4. **Mốc kiểm tra:** sau Phase 2, US1, US2, US3, US4, US5, US6. Mỗi mốc chạy `./tools/ci-local.ps1` và ghi báo cáo.
5. **Không phát hành runtime 0.7 lên BL335 có port-forward** trước T112 (rà soát bảo mật) và T086 (SC-013).
6. **Dự phòng:** T006 cho thấy chuỗi `matrix()` giật: phần tử bọc `<g>` do runtime tạo cho phần tử có `spin` và `M0` khác đơn vị (R9); `clipPath` không phân giải trong Shadow DOM: `clip-path: inset()` (R10); T007 không đạt: ghi file stress cần sửa ngoài Studio (spec US1-6); T052 không đạt ngưỡng 0,5 %: điều tra từng khác biệt (cascade, làm tròn) trước khi nới ngưỡng, và ghi mọi nới vào báo cáo; T109 không đạt: hạ giới hạn hoạt ảnh; T123 không đạt với SVG lớn: ghi giới hạn, đề xuất nén tại runtime (ngoài phạm vi).
7. **Trung thực (Constitution VI):** fixture Illustrator và CorelDRAW là mô phỏng; mọi báo cáo ghi rõ "đạt trên mô phỏng" cho tới khi T120 có file thật.

## Notes

- Số task theo story: Setup 10 (T001–T010), Foundational 22 (T011–T032), US1 30 (T033–T062), US2 16 (T063–T078), US3 8 (T079–T086), US4 10 (T087–T096), US5 8 (T097–T104), US6 7 (T105–T111), Polish 20 (T112–T131). Tổng 131.
- Task ⚠️🔌 (cần BL335): T010, T121–T126 (7 task); task 👤 (cần người): T005 (duyệt, phiên chính), T114 (NVDA), T120 (file thật), T127, T131.
- Mọi task nêu FR hoặc SC mà nó phục vụ; bảng phủ nằm ở `docs/reports/008-fr-matrix.md` (T117) và được kiểm bằng `/speckit-analyze`.
- Mỗi task C++ chạy ctest đầy đủ khi xong; mỗi task TS chạy `npm run typecheck`, `npm test` và `npm run lint` của package liên quan.
- Không commit và không push cho tới khi người dùng cho phép hoặc theo T130.
