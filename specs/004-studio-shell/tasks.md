---

description: "Task list — Khung giao diện mới của mAT Studio"
---

# Tasks: Khung giao diện mới của mAT Studio

**Input**: `specs/004-studio-shell/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Tests**: **Bắt buộc, viết trước** (Constitution VI; spec FR-037). Mỗi task "Test" phải chạy **đỏ** trước task cài đặt tương ứng.

- **Vitest** cho logic thuần và component Lit (jsdom).
- **E2E**: Chrome headless + puppeteer-core + axe-core 4.13.0, giao diện build chế độ `e2e` với lớp Tauri giả.
- **`cargo test`** cho lệnh Rust. Build Rust đặt ở `C:\build\mat-studio` vì ổ D: gần đầy.

**Quy ước**:

- **Trước khi duyệt mockup:** chỉ làm Phase 1 và Phase 2. Đây là logic thuần, lệnh Rust, token và i18n; không có giao diện mới. Phase 3 trở đi chờ T040: người dùng duyệt [mockup](../../docs/architecture/mockups/studio-shell.html).
- **Thứ tự với GĐ 0:**
  - T002 (chuyển file) chờ GĐ 0 xong phần sửa `apps/studio/src/project-form.ts` (audit FR-033).
  - T014 và T030 chờ GĐ 0 xong phần sửa `packages/live-client/src/state.ts` (audit FR-012).
- **Thiết bị:**
  - Task ⚠️🔌 chỉ đọc web của BL335, không SSH, không đổi gì trên thiết bị. Vẫn cần người dùng xác nhận thời điểm và địa chỉ.
  - Không làm thao tác ghi xuống thiết bị: thuộc feature 005.
- **Thư viện:**
  - Phiên bản cố định, phát hành ≥ 2 tuần trước ngày chọn (ADR-009).
  - Không `unsafeHTML`, không gán `innerHTML` với dữ liệu project.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1…US4 theo spec.md

---

## Phase 1: Setup

- [X] T001 Thêm phụ thuộc, phiên bản cố định (không `^`): — **ghi chú khi làm:** `sha2` dùng 0.10.9, bản đã có trong `Cargo.lock` qua Tauri, nên không tải crate mới (bản 0.11.0 mới nhất cũng đủ 2 tuần tuổi nhưng sẽ thành hai phiên bản song song). Các gói Lit kéo theo đều phát hành trước 2026-09-27; ngày cụ thể ghi ở `third_party/LICENSES.md`
  - `apps/studio/package.json`: `lit` `3.3.3`, `@fluentui/svg-icons` `1.1.343`;
  - `package.json` gốc (devDependencies): `axe-core` `4.13.0`;
  - `apps/studio/src-tauri/Cargo.toml`: `sha2` (bản ổn định ≥ 2 tuần, ghi phiên bản cụ thể);
  - ghi tên, phiên bản, license (BSD-3-Clause, MIT, MPL-2.0 chỉ dùng khi phát triển, MIT/Apache-2.0) vào `third_party/LICENSES.md`, mục "Phụ thuộc của Studio".

  Chạy `npm install` rồi `npm run typecheck`.
- [X] T002 Tạo cấu trúc thư mục theo plan.md: — **ghi chú khi làm:** `src/tauri-source.ts` (cùng test) chuyển sang `src/platform/tauri-source.ts`. Test tính đường dẫn tới `projects/tank-demo` thêm một cấp `../`. Chuyển bằng `mv` thường, không `git mv`, để không đụng index git
  - `apps/studio/src/{app,model,ui,ui/editors,theme,i18n,icons,platform}`, `apps/studio/tests/e2e`;
  - chuyển `src/save-policy.ts` → `src/app/save-policy.ts`, `src/device.ts` → `src/model/device.ts`, `src/project-form.ts` → `src/model/project-doc.ts`, kèm file test tương ứng;
  - sửa import trong `src/main.ts` cũ để Studio Sprint 1 vẫn chạy cho tới US1.

  Phụ thuộc: GĐ 0 đã xong phần `project-form.ts`.
- [X] T003 [P] Luật lint trong `eslint.config.mjs`, áp cho `apps/studio/src/**`: — **ghi chú khi làm:** mã Sprint 1 còn chuỗi viết thẳng (`STUDIO_LEGACY_TEXT`: main, preview, save-policy, device, project-doc, tauri-source) nên tạm không áp luật chuỗi; luật chặn chèn HTML thì áp cho mọi file. Test ở `src/lint-rules.test.ts` lint các mẫu bằng `lintText` với đường dẫn ảo trong `src/ui`. ESLint bỏ qua thư mục mẫu
  - (a) cấm import `unsafeHTML`, `unsafeSVG` từ `lit/directives/*`;
  - (b) cấm gán `innerHTML`, `outerHTML` và gọi `insertAdjacentHTML`, dùng `no-restricted-properties` / `no-restricted-syntax`;
  - (c) cấm chuỗi chứa chữ tiếng Việt có dấu ngoài `apps/studio/src/i18n/**` và file test, dùng `no-restricted-syntax` với regex trên `Literal` và `TemplateElement`.

  Mỗi luật có một file mẫu vi phạm trong `apps/studio/tests/lint-fixtures/` và test xác nhận ESLint báo lỗi.
- [X] T004 [P] Chế độ build e2e: — **ghi chú khi làm:** bản build e2e ra `dist-e2e/` (thêm vào `.gitignore`, `.prettierignore`, ESLint). `tests/e2e/run.mjs` làm cùng T042
  - `apps/studio/vite.config.ts`: `mode === 'e2e'` thay `src/platform/tauri.ts` bằng `src/platform/mock.ts` qua alias;
  - script `build:e2e`, `e2e` trong `apps/studio/package.json`. `e2e` build chế độ e2e, chạy `vite preview`, rồi `node tests/e2e/run.mjs`.

**Checkpoint**: `npm run lint`, `npm run typecheck`, `npm test` xanh; Studio Sprint 1 vẫn mở được (`npm run studio:dev`).

---

## Phase 2: Foundational (logic thuần, làm được trước khi duyệt mockup)

### Tests ⚠️ viết trước, chạy đỏ

- [X] T005 [P] Test `apps/studio/src/app/history.test.ts` (data-model §4): — **ghi chú khi làm:** 8 test, đỏ trước rồi xanh
  - đẩy, hoàn tác, làm lại theo thứ tự;
  - tối đa 100 bước, bỏ cũ nhất khi đầy;
  - gõ liên tục cùng `mergeKey` trong 1,2 s gộp một bước, quá 1,2 s thì tách;
  - sửa mới sau hoàn tác xóa `future`;
  - lưu không xóa lịch sử.
- [X] T006 [P] Test `apps/studio/src/model/project-doc.test.ts` (data-model §3.1, FR-022), dựa trên test của GĐ 0 cho `project-form`: — **ghi chú khi làm:** 30 test (16 mới đỏ, 14 cũ vẫn xanh) rồi xanh
  - `tags.json` có thứ tự khóa khác chuẩn, `description` rỗng và khoảng trắng: sửa `projectName` thì file Tag không chưa lưu;
  - sửa một Tag chỉ đổi trường đó;
  - Tag mới theo thứ tự `id, type, description, unit, min, max, source`;
  - chưa lưu khi `serialize(value) !== diskText`; hoàn tác về như cũ thì hết chưa lưu;
  - thứ tự ghi `tags.json` trước `project.json`.
- [X] T007 [P] Test `apps/studio/src/model/tree.test.ts` (data-model §7, FR-004). Dựng cây từ `projects/tank-demo`: — **ghi chú khi làm:** 17 test, đỏ trước rồi xanh
  - thứ tự mục theo studio-ux.md §4;
  - `count` của Bảng Tag (5) và Lưu trữ (2);
  - màn hình đầu có `sub` "màn hình đầu";
  - mục giai đoạn sau có `phase` (Kết nối và Tag tính toán `GĐ 2`, Alarm `GĐ 4`, Báo cáo `GĐ 5`, Thư viện `GĐ 3b`);
  - `id` ổn định giữa hai lần dựng;
  - thiếu `project.json` vẫn dựng được phần đọc được;
  - `deviceState` của nút thiết bị theo phiên.
- [X] T008 [P] Test `apps/studio/src/model/issue-map.test.ts`: mỗi dòng của bảng data-model §5, trong đó: — **ghi chú khi làm:** 13 test, đỏ trước rồi xanh
  - `/tags/3/max` → `{editor:'tags', row:3, column:'max'}`;
  - `/tags/5` (`E_TAG_RANGE`) → cột `max`, tô đỏ `min` và `max`;
  - `/maxClients` → `{editor:'settings', field:'maxClients'}`;
  - `logging.json /groups/1/tags/0` → `{editor:'logging', group:1}`;
  - `logging.json /connections/0/tls` → `{editor:'logging', connection:0}`;
  - binding → `{editor:'screen', screen, element}`;
  - không khớp → `{editor:null}`.
- [X] T009 [P] Test `apps/studio/src/app/palette.test.ts` (FR-009): — **ghi chú khi làm:** `commands.test.ts` (13, đọc thẳng contracts/commands.md) và `palette.test.ts` (9), đỏ trước rồi xanh
  - tìm bỏ dấu, không phân biệt hoa thường: "bang tag" → `Mở Bảng Tag mặc định`, "nap xuong" → `Nạp xuống…`;
  - lệnh khớp đầu nhãn xếp trước;
  - lệnh bị khóa vẫn có, kèm lý do;
  - mọi lệnh trong `contracts/commands.md` có mặt.
- [X] T010 [P] Test `apps/studio/src/model/tag-ids.test.ts`: — **ghi chú khi làm:** 8 test, đỏ trước rồi xanh
  - tăng nhóm số cuối và giữ số chữ số: `TANK02.LEVEL` → `TANK03.LEVEL`, `T_09` → `T_10`;
  - không có số → thêm `_1`;
  - trùng tên đã có thì tăng tiếp.
- [X] T011 [P] Test `apps/studio/src/model/grid-model.test.ts` (research R3, contracts/commands.md mục "Phím trong từng vùng"): — **ghi chú khi làm:** 35 test; lần đầu 34/35 (chưa chọn ô thì mũi tên phải chọn ô đầu), sửa rồi xanh. Thêm Home/End, IME, AltGr
  - chọn ô; di chuyển bằng mũi tên và Tab, chặn ở biên, bỏ qua dòng bị lọc;
  - bắt đầu sửa bằng Enter/F2 (chọn hết nội dung) hoặc gõ ký tự (nội dung là ký tự đó, con trỏ ở cuối);
  - Enter xác nhận rồi xuống dòng; Esc hủy;
  - cột chỉ đọc (`src`) không vào sửa;
  - Delete xóa ô trừ cột tên;
  - điền xuống chép ô trên, cột tên thì tăng số;
  - lọc theo tên và mô tả bỏ dấu;
  - dán dữ liệu tab nhiều dòng, nhiều cột (logic, chưa bật trong giao diện);
  - Min/Max nhận dấu phẩy thập phân (`1,5` → `1.5`).
- [X] T012 [P] Test `apps/studio/src/model/xref.test.ts` (FR-006): "Dùng ở đâu" của `TANK01.LEVEL` trên project mẫu gồm Tổng quan › Mức nước (Mức chất lỏng), Tổng quan › Chữ mức (Chữ), Lưu trữ › Vận hành, Lưu trữ › Báo cáo ca. Tag không dùng ở đâu trả danh sách rỗng. — **ghi chú khi làm:** 7 test, đỏ trước rồi xanh
- [X] T013 [P] Test `apps/studio/src/model/sim-source.test.ts` (research R11), đồng hồ giả: — **ghi chú khi làm:** 10 test, đỏ trước rồi xanh
  - Tag số nằm trong Min–Max; thiếu Min/Max thì 0–100;
  - BOOL đổi mỗi 5 s;
  - STRING cố định;
  - quality luôn `GOOD`;
  - phát đúng kiểu `TagUpdate` của `@mat/binding-engine`.
- [X] T014 [P] Test `packages/live-client/src/connection.test.ts` (research R10): — **ghi chú khi làm:** 12 test, đỏ 12/43. Ngoài ý của task, test thêm: NO_VALID_TAGS (mọi Tag là Tag lạ); cùng danh sách không gửi lại; bỏ Tag trùng; hai lần `setTags` liền nhau; `subscribed` sau mất kết nối. Một test bắt lỗi có thật: gọi `stop()` ngay trong `onState` (offline, full) vẫn để lại hẹn giờ kết nối lại, socket ma mở lại chiếm phiên của thiết bị
  - `setTags` gửi `subscribe` mới với `requestId` mới;
  - delta của đăng ký cũ bị bỏ;
  - `setTags` trước khi mở socket thì đăng ký khi mở;
  - `unknown` của snapshot đọc được qua API công khai;
  - danh sách rỗng không gửi `subscribe`.

  Phụ thuộc: GĐ 0 xong `state.ts`.
- [X] T015 [P] Test `apps/studio/src/app/store.test.ts` với lớp platform giả: — **ghi chú khi làm:** 15 test, dùng platform giả (project mẫu trong bộ nhớ) và đồng hồ giả; thêm: hủy hộp thoại, lưu khi còn lỗi (FR-023), lỗi ghi `io` kèm chi tiết, F7 đọc lại file chưa sửa, kết luận kiểm tra trùng với bộ kiểm tra chạy trên nội dung đã sửa
  - mở project; sửa Tag, sửa thiết lập; chọn đối tượng; mở/đóng tab (một `editorId` một tab, `start` không đóng được);
  - người nghe được báo khi đổi;
  - kiểm tra: kết quả của lần kiểm cũ về sau không đè kết quả mới (`checkSeq`);
  - lưu: ghi file chưa lưu kèm `diskHash`; `changed` → trạng thái xung đột; Ghi đè (force), Tải lại, Hủy theo data-model §6.
- [X] T016 [P] Test `apps/studio/src/model/device-session.test.ts` (data-model §9), socket và fetch giả, đồng hồ giả: — **ghi chú khi làm:** 24 test. Thêm ngoài task: system/info và dữ liệu sống tới theo thứ tự nào cũng được; NO_VALID_TAGS và project không có Tag vẫn vào `monitoring`; socket đóng trước lần `monitoring` đầu → `error` mã `live-closed`, không thử lại; im lặng 15 s → `lost`; ngắt khi system/info còn chờ. Dùng đồng hồ giả của Vitest vì `checkDevice` dùng `setTimeout` toàn cục
  - `idle → connecting → monitoring`;
  - không trả lời 3 s → `error` kèm lý do;
  - 4429 → `full`, sau 30 s tự `connecting`;
  - giao thức không tương thích → `incompatible`, không thử lại;
  - socket đóng → `lost`, mọi giá trị chuyển mất kết nối;
  - đổi danh sách Tag → `setTags`;
  - ngắt → đóng socket ngay;
  - hỏi `system/info` mỗi 5 s khi `monitoring`.
- [X] T017 [P] Test `apps/studio/src/app/workspace.test.ts` (data-model §1): — **ghi chú khi làm:** 8 test, đỏ trước rồi xanh
  - mặc định khi `localStorage` trống, hỏng hoặc ném lỗi;
  - kẹp kích thước: `leftWidth` 180–480, `detailsHeight` 70 tới (chiều cao cột trái − 120), `inspectorHeight` 90 tới (chiều cao vùng giữa − 150);
  - "Đặt lại bố cục" xóa kích thước và task card, giữ `theme` và `deviceAddress`;
  - khóa `mat-studio.device` của Sprint 1 vẫn đọc được.
- [X] T018 [P] Test Rust trong `apps/studio/src-tauri/src/project_fs.rs` (contracts/tauri-commands.md): — **ghi chú khi làm:** test ghi cũ chuyển sang `write_text_if_unchanged` (bỏ `write_text_atomic`), giữ ý kiểm; thêm ca file đã đọc mà bị xóa ngoài Studio → `Changed`. Đỏ 10/15 (5 test chỉ đọc vẫn xanh vì phân loại lỗi GĐ 0 không đổi), rồi xanh 15/15
  - `read` trả SHA-256 hex chữ thường đúng với nội dung;
  - `write` với `expectedHash` khớp → ghi, trả hash mới;
  - không khớp và `force=false` → `Changed`, file không đổi;
  - `force=true` → ghi;
  - `expectedHash=None` khi file đã có → `Changed`;
  - không ghi được file không phải `.json`.
- [X] T019 [P] Test Rust `apps/studio/src-tauri/src/recent.rs` (data-model §2): — **ghi chú khi làm:** `RecentStore::new(path)` nhận đường dẫn file nên test không cần Tauri. Thêm: file > 256 KB hoặc mục có đường dẫn tương đối coi như hỏng; `forget` với `index` ngoài danh sách trả `NoSuchEntry`. Đỏ 8/8, rồi xanh
  - thêm mới đưa lên đầu; mở lại đưa lên đầu; tối đa 10;
  - lưu và đọc lại JSON; file hỏng → danh sách rỗng;
  - `index` ngoài danh sách → `NoSuchEntry`; thư mục mất → `Missing` và `exists:false` trong danh sách;
  - `forget` bỏ đúng mục.
- [X] T020 [P] Test `apps/studio/src/i18n/i18n.test.ts`: — **ghi chú khi làm:** 11 test, đỏ trước rồi xanh
  - `t()` thay tham số;
  - khóa thiếu thì ném lỗi khi test;
  - mọi khóa gọi `t('…')` trong `apps/studio/src/**` có trong `vi.ts` (quét mã nguồn).

### Implementation

- [X] T021 [P] `apps/studio/src/app/history.ts` cho T005 (snapshot JSON của tài liệu sửa được, research R5). — **ghi chú khi làm:** hàm thuần trên trạng thái bất biến (`createHistory`, `recordEdit`, `undoEdit`, `redoEdit`, `breakMerge`); store giữ trạng thái. Gộp theo cửa sổ trượt 1,2 s từ lần sửa trước. Snapshot là `snapshotOf(docs)`
- [X] T022 [P] `apps/studio/src/model/project-doc.ts` cho T006: dùng lại hàm sửa giữ thứ tự khóa của GĐ 0; thêm `diskText`, `diskHash`, `isDirty`, `serialize`, `writeOrder`.

  **Ghi chú khi làm:**

  - `isDirty` so với `cleanText` (chuỗi chuẩn của nội dung trên đĩa), không so với `diskText` thô. Nhờ vậy file viết tay khác định dạng (thụt 4, CRLF, BOM) mở ra không thành chưa lưu, và không bị ghi lại khi không sửa;
  - thêm sửa đổi `tagField`, `applyDocEdits`, `snapshotOf`/`restoreSnapshot`, `outlineOf` (cấu trúc đọc được cả khi project còn lỗi);
  - không còn chuỗi tiếng Việt nên đã bỏ khỏi `STUDIO_LEGACY_TEXT`.
- [X] T023 [P] `apps/studio/src/model/tree.ts` cho T007.

  **Ghi chú khi làm:**

  - đầu vào `TreeInput {folderName, outline, device}`;
  - chưa có mục "Thiết lập thiết bị" (không có trong FR-004); nút thiết bị mở trang Thiết bị;
  - "Người dùng và quyền" mang nhãn feature 005;
  - nhãn thiết bị mặc định "BL335" vì `system/info` chưa có tên thiết bị; màn hình hiện theo tên trong project;
  - kiểu trạng thái phiên dùng chung `SessionState` của `device-session.ts`.
- [X] T024 [P] `apps/studio/src/model/issue-map.ts` cho T008.

  **Ghi chú khi làm:**

  - lỗi cả dòng không phải `E_TAG_RANGE` trỏ cột tên;
  - cảnh báo cả file `logging.json` mở editor Lưu trữ;
  - đường dẫn sâu trong `project.json` lấy trường cấp đầu;
  - `E_JSON`, `E_FILE_MISSING` không có chỗ nhảy;
  - thêm `issueCells` cho viền đỏ.
- [X] T025 [P] `apps/studio/src/app/commands.ts`, `apps/studio/src/app/palette.ts` cho T009:
  - danh mục đúng `contracts/commands.md` (`id`, khóa nhãn, phím, menu, `enabled(state)` trả `true` hoặc khóa lý do);
  - lệnh 005 và GĐ 2 bị khóa với lý do "Có ở feature 005", "Có ở GĐ 2".

  **Ghi chú khi làm:**

  - thêm 3 lệnh chỉ có trong bảng lệnh (`open.start`, `open.tags`, `open.logging`) và lệnh mở từng màn hình;
  - `online.connect` bật khi có project và chưa theo dõi; chưa có địa chỉ thì mở trang Thiết bị;
  - cùng mức khớp thì lệnh đang bật xếp trước.
- [X] T026 [P] `apps/studio/src/model/tag-ids.ts` cho T010. — **ghi chú khi làm:** tên trống ra `TAG_1`; số dài dùng BigInt
- [X] T027 [P] `apps/studio/src/model/grid-model.ts` cho T011.

  **Ghi chú khi làm:**

  - Tab ở cột đầu/cuối trả `handled=false` để focus rời được lưới (tránh bẫy bàn phím); mũi tên chặn ở biên;
  - thêm Home/End, Ctrl+Home/End, Ctrl+mũi tên; không bắt Enter khi đang gõ bằng bộ gõ (IME);
  - xác nhận không đổi thì không sinh sửa đổi;
  - Min/Max không phải số giữ nguyên chuỗi để bộ kiểm tra báo lỗi ngay tại ô;
  - Tag mới chép kiểu, đơn vị, nguồn của dòng cuối; lọc theo từng từ.
- [X] T028 [P] `apps/studio/src/model/xref.ts` cho T012. — **ghi chú khi làm:** đầu vào là `outline`, nên chạy được cả khi project còn lỗi
- [X] T029 [P] `apps/studio/src/model/sim-source.ts` cho T013.

  **Ghi chú khi làm:**

  - thiếu một đầu Min/Max thì lấy 100 đơn vị từ đầu còn lại; Min ≥ Max coi như thiếu (0–100);
  - STRING giữ giá trị là tên Tag; Tag số nguyên ra số nguyên;
  - lần đầu phát mọi Tag, sau đó chỉ phát Tag đổi.
- [X] T030 `packages/live-client/src/connection.ts` (và `state.ts` nếu cần) cho T014: `setTags(tags)`, đọc `unknown`. Runtime web không đổi hành vi; `npm test -w @mat/runtime-web` vẫn xanh. — **ghi chú khi làm:** `state.ts` không đổi. API mới: `setTags`, `tags`, `unknown`, `subscribed`, `onSubscribed`. Không bao giờ gửi `subscribe` rỗng, kể cả lúc mở socket (trước đây gửi `tags: []`, máy chủ trả BAD_MESSAGE). NO_VALID_TAGS của đăng ký hiện tại → `unknown` là mọi Tag. `onClosed` hẹn giờ thử lại trước khi báo trạng thái, để `stop()` gọi trong `onState` hủy được. Runtime web 16/16, live-client 43/43
- [X] T031 `apps/studio/src/app/store.ts` cho T015 (dùng T021–T024, T027). Kiểm tra gọi `validateProject` của `@mat/project-schema` qua nguồn đọc = đĩa + tài liệu đang sửa (`OverlaySource`), chờ 250 ms sau lần sửa cuối. — **ghi chú khi làm:** mở project đọc các file được tham chiếu (project.json, file Tag, lưu trữ, màn hình, binding, SVG); kiểm tra chạy nền, `idle()` chờ lần kiểm mới nhất. Bộ kiểm tra đọc tài liệu chưa lưu theo chuỗi sẽ ghi, file khác theo nội dung trên đĩa, chụp tập tài liệu lúc bắt đầu kiểm. Xung đột: Ghi đè thì ghi lại với force rồi lưu tiếp; Tải lại thì đọc lại file từ đĩa, lịch sử giữ để hoàn tác; Hủy thì giữ chưa lưu
- [X] T032 `apps/studio/src/model/device-session.ts` cho T016. Dùng `normalizeDevice`, `checkDevice` (timeout 3 s) của `model/device.ts` và `LiveConnection` (T030). — **ghi chú khi làm:** vào `monitoring` khi system/info thành công và đăng ký Tag hiện tại có kết quả. Giá trị chỉ cập nhật khi `monitoring`; rời `monitoring` thì mọi giá trị chuyển `STALE` (giữ giá trị và thời điểm cuối), về `idle` thì xóa. Lỗi trước lần `monitoring` đầu → `error` (mã `timeout | network | http | bad-response | invalid-address | live-closed`), không tự thử lại; sau đó socket đóng → `lost`. `checkDevice` (`model/device.ts`) thêm `code`, và coi thân phản hồi không phải JSON object là lỗi `bad-response`. Chưa xử lý quá 1.000 Tag: để GĐ 2
- [X] T033 [P] `apps/studio/src/app/workspace.ts` cho T017.
- [X] T034 Rust `apps/studio/src-tauri/src/project_fs.rs` cho T018: — **ghi chú khi làm:** lỗi ghi là chuỗi `changed | bad-path | no-project`, riêng `io` gửi kèm chi tiết `{ "io": "…" }` vì bản cài không có console (vẫn in thêm ra stderr). File không phải `.json` → `bad-path`; nội dung > 1 MB hoặc thư mục cha không còn → `io`. Hash đọc lại ngay trước khi ghi file tạm; file trên đĩa > 1 MB coi như đã đổi. `project_pick` trả `{ display }`; `pickProject()` của Studio cũ vẫn trả chuỗi. `TauriProjectSource` nhớ hash theo `rel`, `writeProjectFile` gửi hash đó với `force=false`, lỗi `io` hiện thành `io: <chi tiết>`
  - `read_text` trả nội dung và SHA-256 (crate `sha2`);
  - `write_text_if_unchanged(root, rel, content, expected, force)` đọc lại hash trước khi ghi atomic.

  Sửa `project_read`/`project_write` trong `lib.rs` theo contract (giữ phân loại lỗi đọc của GĐ 0). Phía TS, thêm trường `hash` tùy chọn vào `ReadResult` của `@mat/project-schema`; nguồn đọc `TauriProjectSource` điền trường này. Bộ kiểm tra bỏ qua trường này; `npm test -w @mat/project-schema` vẫn xanh.
- [X] T035 Rust `apps/studio/src-tauri/src/recent.rs` cho T019: — **ghi chú khi làm:** `project_recent` và `project_open_recent` là lệnh async (kiểm thư mục trên ổ mạng đã mất không chặn giao diện). Không ghi được `recent.json` thì vẫn mở project. Tên lấy từ `projectName` (bỏ khoảng trắng hai đầu, tối đa 80 ký tự), không có thì lấy tên thư mục. `openedAt` ISO 8601 UTC đến giây. So trùng theo đường dẫn y hệt. `project_forget_recent` lỗi `"no-such-entry"` hoặc `{ "io": "…" }`. `serde_json` chuyển sang dependencies (đã có trong `Cargo.lock`)
  - lệnh `project_recent`, `project_open_recent`, `project_forget_recent` trong `lib.rs`;
  - `project_pick` ghi vào danh sách gần đây;
  - file ở thư mục cấu hình của ứng dụng (`app.path().app_config_dir()`).
- [X] T036 `apps/studio/src/platform/tauri.ts`, `apps/studio/src/platform/mock.ts`: — **ghi chú khi làm:** giao diện chung `Platform` ở `platform/types.ts`. Bản giả tính SHA-256 bằng JS thuần (Web Crypto không có trong jsdom), có test đối chiếu vector chuẩn và `node:crypto`. Script e2e điều khiển qua `window.__matMock`. `tsconfig.json` thêm kiểu `vite/client` cho `import.meta.glob` và `?raw`. Test: `platform/platform.test.ts` (12)
  - hàm có kiểu cho mọi lệnh ở `contracts/tauri-commands.md`;
  - bản giả dùng `mockIPC` của `@tauri-apps/api/mocks`, project mẫu nạp từ `projects/tank-demo` lúc build e2e;
  - cờ giả lập `changed`, `missing`, lỗi ghi;
  - ghi lại lần gọi `project_write` để e2e kiểm.
- [X] T037 [P] `apps/studio/src/i18n/vi.ts`, `apps/studio/src/i18n/index.ts` cho T020: mọi chuỗi giao diện tiếng Việt; `t(key, params)`.

  **Ghi chú khi làm:**

  - `fold()` đặt trong `i18n/index.ts`;
  - test quét mã bỏ qua chú thích; khóa dựng động dùng bảng tra có kiểu `MessageKey`;
  - `vi.ts` mới có chuỗi các module này cần; editor ở Phase 3 thêm sau.
- [X] T038 [P] `apps/studio/src/theme/tokens.css`, `apps/studio/src/theme/base.css`: — **ghi chú khi làm:** test tương phản bắt được `--ok` của theme sáng chỉ đạt 4,29:1 trên `--ok-soft`; đổi #1a7f37 → #15703a (5,2:1), sửa luôn ở mockup. Test cũng kiểm hai khối tối giống nhau và `base.css` không viết cứng màu (36 test)
  - token sáng/tối lấy từ mockup (`:root`, `prefers-color-scheme`, `[data-theme]`);
  - màu nhấn khai báo đúng một chỗ (FR-013); màu trạng thái cố định (FR-012);
  - phông Segoe UI Variable / Segoe UI, Cascadia Mono / Consolas;
  - `prefers-reduced-motion`, chuyển động ≤ 150 ms (FR-015).

  Test `apps/studio/src/theme/contrast.test.ts` tính tương phản chữ/nền của các cặp token ở cả hai theme ≥ 4,5:1.
- [X] T039 [P] `apps/studio/src/icons/icons.ts`: nạp lúc build (`?raw`) các icon Fluent cần dùng (danh sách theo mockup), dựng sprite `<symbol>`; 16 px trong cây và lưới, 20 px trên thanh công cụ. — **ghi chú khi làm:** 77 icon (72 Fluent, 5 ký hiệu tự vẽ chỉ dùng nét: bơm, van, bồn, motor, ống). Sprite dựng bằng DOMParser, không innerHTML. Thành phần khung render ở light DOM để `<use href>` thấy sprite (research R1). Một số icon chỉ có bản 20 px (so sánh, theme, pulse, card, nhóm), co theo `viewBox`. Test `icons/icons.test.ts` (5)

**Checkpoint**:

- `npm test -w @mat/studio`, `npm test -w @mat/live-client`, `npm test -w @mat/runtime-web`, `cargo test` (trong `apps/studio/src-tauri`) xanh.
- Giao diện chưa đổi; Studio Sprint 1 vẫn chạy.
- **Đạt ngày 2026-10-11:**
  - Vitest 520 (Studio 285, live-client 43, project-schema 115, svg-renderer 38, binding-engine 23, runtime-web 16);
  - `cargo test --lib` 23/23;
  - `npm run typecheck`, `npm run lint` sạch;
  - `npm run build -w @mat/studio` đạt.

---

## Phase 3: User Story 1 — Kỹ sư làm việc trong khung kiểu IDE (Priority: P1) 🎯 MVP

**Goal**: khung bảy vùng; cây, tab, inspector, task card, thanh trạng thái; theme; bảng lệnh; nhớ bố cục; dùng được bằng bàn phím.

**Independent Test**: spec US1 (quickstart §4 bước 1–4, 18).

- [X] T040 [US1] ⏸ **Chờ người dùng duyệt mockup** `docs/architecture/mockups/studio-shell.html`: bố cục, màu nhấn, menu, nhãn giai đoạn, lưu khi còn lỗi (FR-023), thanh tiêu đề gốc của Windows (research R12). Ghi điều người dùng yêu cầu đổi vào `spec.md`, `docs/architecture/studio-ux.md` và sửa token, bố cục trước T041.

  **Ghi chú (2026-10-11):** người dùng dùng Studio 0.2.0 và trả lời "tôi check rồi giao diện ok" — duyệt bố cục và cả 5 lựa chọn mặc định của mockup (màu nhấn petrol, thanh tiêu đề gốc của Windows với menu ở hàng riêng, nhãn giai đoạn tắt được, cột giá trị sống ngay sau tên Tag, lưu được khi còn lỗi). Người dùng giao toàn quyền quyết định từ đây.

  **Ghi chú (2026-10-11):** người dùng chưa trả lời 5 điểm của mockup mà hỏi "Xong chưa?", nên Phase 3 làm tiếp theo mockup bản 1 và các lựa chọn mặc định (petrol, thanh tiêu đề gốc, nhãn giai đoạn, lưu khi còn lỗi). Task này để mở cho tới khi người dùng duyệt (cùng SC-008, T086); điều gì người dùng muốn đổi thì sửa token/bố cục sau.

### Tests for User Story 1 ⚠️ viết trước

- [X] T041 [P] [US1] Test component:
  - `apps/studio/src/ui/mat-tree.test.ts`: `role=tree`, `treeitem` có `aria-level` và `aria-expanded`; ↑ ↓ → ← Home End Enter theo contracts/commands.md; Enter phát sự kiện mở editor.
  - `apps/studio/src/ui/mat-tabs.test.ts`: `tablist`; ← → chuyển; Delete/Ctrl+W đóng (trừ Bắt đầu); không tạo tab trùng; dấu chưa lưu.
  - `apps/studio/src/ui/mat-palette.test.ts`: gõ lọc; ↑ ↓; Enter chạy; Esc đóng; lệnh bị khóa hiện lý do.
  - `apps/studio/src/ui/mat-shell.test.ts`: đủ bảy vùng; kéo thanh đổi cỡ cập nhật workspace; F6/Shift+F6 chuyển vùng; thu gọn task card.

  **Ghi chú khi làm:**

  - test viết trước, đỏ (chưa có module), rồi xanh: `mat-tree` 6, `mat-tabs` 6, `mat-palette` 5, `mat-shell` 7;
  - thêm `app/app.test.ts` (20) cho bộ điều khiển giao diện `StudioApp` và `app/shortcuts.test.ts` (20; kiểm bằng cách cố ý sửa sai ánh xạ phím: 3 test đỏ, khôi phục thì xanh);
  - store thêm `closeProject()` (test đỏ trước).
- [X] T042 [US1] E2E `apps/studio/tests/e2e/shell.e2e.mjs` (kèm `apps/studio/tests/e2e/run.mjs` chạy mọi file `*.e2e.mjs`):
  - mở project giả, kiểm các mục trên cây, mở 3 tab;
  - Ctrl+Shift+P "bang tag" Enter;
  - theme tối;
  - tải lại trang thì bố cục giữ nguyên;
  - chạy axe-core: 0 vi phạm `critical`/`serious`;
  - 0 lỗi console.

  **Ghi chú khi làm:**

  - `tests/e2e/run.mjs` phục vụ bản build e2e bằng máy chủ tĩnh, Chrome headless (puppeteer-core), axe-core; ảnh chụp ở `tests/e2e/out/` (gitignore); `MAT_E2E_OUT` đổi thư mục build để chạy song song;
  - `shell.e2e.mjs`: 28 kiểm đạt, gồm axe ở tab Bắt đầu, theme sáng, theme tối và lúc mở Bảng Tag, cửa sổ 960 × 600 không tràn ngang;
  - lỗi thật e2e bắt được và đã sửa: cây rỗng mang role=tree (axe critical); nút đóng là phần tử tương tác lồng trong role=tab (axe serious) → đổi thành biểu tượng không nhận focus, đóng bằng Delete/Ctrl+W/nhấp giữa; `<mat-shell>` có sẵn trong index.html được nâng cấp trước khi gắn app nên phím tắt không gắn → thêm `attached()/detached()` ở `AppElement`; handler đọc trạng thái cũ khi nhấp nhanh hai lần (theme).

### Implementation for User Story 1

- [X] T043 [US1] `apps/studio/index.html` chỉ còn `<mat-shell>`; `apps/studio/src/main.ts` khởi động:
  - theme từ workspace, sprite icon, store, platform;
  - đăng ký component.

  **Ghi chú khi làm:**

  - `index.html` chỉ còn `<mat-shell>`; `main.ts` mới (theme, sprite, `StudioApp`, platform);
  - bỏ markup form 5 tab và `src/styles.css` (một phần T078); `main.ts` ra khỏi `STUDIO_LEGACY_TEXT`.

  Bỏ markup form 5 tab cũ.
- [X] T044 [US1] `apps/studio/src/ui/mat-shell.ts`:
  - lưới bảy vùng theo mockup;
  - thanh kéo `pointer` (kẹp theo workspace), thu gọn task card;
  - lớp `online` vẽ viền cam;
  - cửa sổ < 1180 px thì task card nổi; < 900 px thì cây thành ngăn kéo.

  **Ghi chú khi làm:**

  - thanh kéo có `role=separator`, nhận focus, phím mũi tên đổi 16 px, kẹp theo `clampLayout`;
  - cửa sổ < 1180 px: task card nổi và tự thu khi nhấp ra ngoài; < 900 px: cây thành ngăn kéo (nút trên thanh công cụ);
  - menu nằm hàng riêng dưới thanh tiêu đề gốc của Windows (R12), cùng hàng với chip "Đang theo dõi".
- [X] T045 [P] [US1] `apps/studio/src/ui/mat-menubar.ts`:
  - menu Project, Sửa, Xem, Online, Công cụ, Trợ giúp, dựng từ danh mục lệnh;
  - lệnh khóa có tooltip lý do;
  - ↑ ↓ Esc trong menu; rê chuột chuyển menu khi đang mở.

  **Ghi chú khi làm:**

  - Project › Mở gần đây liệt kê ngay trong menu (không menu con); lệnh khóa `aria-disabled`, hiện lý do cạnh nhãn và ở tooltip; F10 vào menu.
- [X] T046 [P] [US1] `apps/studio/src/ui/mat-toolbar.ts`: nhóm nút theo mockup, mỗi nút có `aria-label` và tooltip kèm phím tắt. Nạp xuống, Đọc lên, So sánh hiện nhưng khóa ("Có ở feature 005"). — **ghi chú khi làm:** nút lệnh khóa dùng `aria-disabled` (vẫn nhận focus, nhấp thì báo lý do) thay cho `disabled`; mẫu ARIA toolbar một điểm dừng Tab
- [X] T047 [P] [US1] `apps/studio/src/ui/mat-tree.ts`, `apps/studio/src/ui/mat-details.ts`:
  - cây theo T023, nhãn giai đoạn tắt được;
  - Details liệt kê Tag (kéo được), phần tử màn hình, hoặc nhóm lưu trữ theo editor đang mở.

  **Ghi chú khi làm:**

  - Details là listbox (↑ ↓ Enter); nhấp Tag mở Bảng Tag đúng dòng (`revealTag`); phần tử màn hình, nhóm lưu trữ theo editor đang mở.
- [X] T048 [P] [US1] `apps/studio/src/ui/mat-tabs.ts` cho T041. — **ghi chú khi làm:** nút đóng tab không nhận focus (axe nested-interactive), đóng bằng Delete, Ctrl+W, nhấp giữa
- [X] T049 [P] [US1] `apps/studio/src/ui/mat-inspector.ts`:
  - tab Thuộc tính, Thông tin (huy hiệu số lỗi/cảnh báo), Chẩn đoán;
  - bảng đăng ký "loại lựa chọn → bộ vẽ thuộc tính" để các editor thêm vào.

  **Ghi chú khi làm:**

  - bảng đăng ký ở `ui/registry.ts` (`registerProps`, `registerDiagnostics`, `registerEditor`); tab Thông tin là listbox, nhấp đúp/Enter → `gotoIssue` (một phần T063).
- [X] T050 [P] [US1] `apps/studio/src/ui/mat-taskcards.ts`:
  - dải tab dọc;
  - Toolbox (nhóm widget có nhãn `GĐ 3a`; kéo thả lên màn hình chỉ báo "Có ở GĐ 3a");
  - Thư viện (`GĐ 3b`);
  - Công cụ online (trống khi chưa theo dõi);
  - Tìm (Tag, phần tử màn hình; Ctrl+F đưa focus vào ô tìm).

  **Ghi chú khi làm:**

  - widget là nút (nhấp hoặc kéo đều báo giai đoạn); thẻ Công cụ online phần cơ bản, US3 hoàn thiện ở T074.
- [X] T051 [P] [US1] `apps/studio/src/ui/mat-statusbar.ts`: thiết bị (không kết nối / đang theo dõi), số lỗi và cảnh báo (nhấp mở Thông tin), tiến trình, nút đổi theme. — **ghi chú khi làm:** trạng thái thiết bị có chữ kèm chấm màu; số lỗi/cảnh báo mở tab Thông tin; tiến trình "Đang kiểm tra…"; theme xoay vòng hệ thống → sáng → tối
- [X] T052 [P] [US1] `apps/studio/src/ui/mat-palette.ts`, `apps/studio/src/ui/mat-dialog.ts`, `apps/studio/src/ui/mat-toast.ts`:
  - hộp thoại giữ focus bên trong, Esc đóng (trừ khi đang chạy);
  - toast `role=status`.

  **Ghi chú khi làm:**

  - hộp thoại theo kiểu (`unsaved`, `conflict`, `saveError`, `shortcuts`, `about`) nên luồng lưu, xung đột, hỏi khi đóng của T064 đã có ở `app.ts`; bảng lệnh có lớp phủ trong suốt để nhấp ra ngoài thì đóng.
- [X] T053 [US1] `apps/studio/src/ui/editors/start-page.ts`, `apps/studio/src/ui/editors/phase-page.ts`:
  - Bắt đầu: project gần đây từ `project_recent` (mục mất cho bỏ khỏi danh sách), tác vụ nhanh, lộ trình;
  - trang giai đoạn cho mục chưa làm (nội dung như mockup, `SOON`).

  **Ghi chú khi làm:**

  - bỏ nút "Tạo project mới" của mockup (không có trong spec); tác vụ nhanh khóa thì nói lý do.
- [X] T054 [US1] `apps/studio/src/app/shortcuts.ts` nối phím với lệnh (contracts/commands.md):
  - `preventDefault` cho Ctrl+S, Ctrl+F, Ctrl+D, Ctrl+K, Ctrl+M, Ctrl+L, Ctrl+P, F5, F7 trong WebView2;
  - Ctrl+Z/Y trong ô nhập để cho ô nhập.

  **Ghi chú khi làm:**

  - Ctrl+S, O, Z, Y, F, D, K, M, L, W; Ctrl+Shift+P; F6, Shift+F6, F7, F10; chặn F5, Ctrl+R, Ctrl+P, Alt+← →, phím Back/Forward/Refresh;
  - Ctrl+Z/Y trong ô nhập để cho ô nhập; Ctrl+D trong ô nhập chỉ chặn; khi có hộp thoại hay bảng lệnh chỉ chặn phím trình duyệt;
  - chưa kiểm F5, Ctrl+P trên WebView2 thật: kiểm khi chạy bộ cài (T080/T084).

  Ghi chú khi làm: kết quả kiểm F5, Ctrl+P trên WebView2 thật.
- [X] T055 [US1] Trợ giúp › Giới thiệu và Phím tắt (hộp thoại): `app_info`, phiên bản WebView. Bỏ tab Giới thiệu cũ. — **ghi chú khi làm:** Trợ giúp › Giới thiệu và Phím tắt là hộp thoại; tab Giới thiệu cũ đã bỏ cùng form

**Checkpoint**: T041, T042 xanh; quickstart §4 bước 1–4 và 18 (phần khung) đạt.

- **Đạt ngày 2026-10-11 (bản build e2e, lớp Tauri giả):**
  - Vitest Studio 350 test (27 file), `tsc`, ESLint, Prettier sạch;
  - e2e `shell` 28/28, axe 0 vi phạm critical/serious ở 4 trạng thái;
  - bước 1–4 và phần khung của bước 18 kiểm bằng e2e; chạy trên Studio thật (WebView2) khi build bộ cài.

---

## Phase 4: User Story 2 — Sửa project với kiểm tra liên tục (Priority: P1)

**Goal**: thiết lập project, bảng Tag, kiểm tra liên tục, nhảy tới lỗi, hoàn tác, lưu giữ định dạng, lưu khi còn lỗi, xung đột, hỏi khi đóng.

**Independent Test**: spec US2 (quickstart §4 bước 5–11).

### Tests for User Story 2 ⚠️ viết trước

- [X] T056 [P] [US2] Test `apps/studio/src/ui/editors/tag-grid.test.ts`:
  - `role=grid`; phím theo contracts/commands.md;
  - nhấp đúp vào ô vào sửa đúng ô đó: chọn ô không vẽ lại dòng (lỗi đã gặp trong mockup);
  - gõ ký tự đặt con trỏ ở cuối;
  - ô lỗi có viền đỏ và lý do qua `title`/`aria-describedby`;
  - khi theo dõi, cột giá trị sống và quality nằm ngay sau cột tên.

  **Ghi chú khi làm:**

  - 22 test, đỏ trước (22/22) rồi xanh; thêm hai test cho lỗi tìm được khi rà soát (lưới đã gỡ vẫn chọn lại Tag khi chuyển tab; đóng tab khi đang gõ dở bằng Ctrl+W), đỏ rồi xanh.
- [X] T057 [P] [US2] Test `apps/studio/src/ui/editors/settings-editor.test.ts`:
  - ô tên, phiên bản, màn hình đầu, số client;
  - mã project và runtime tối thiểu chỉ đọc;
  - trợ giúp dưới ô; lỗi tại ô (ví dụ số client 11 → `E_MAX_CLIENTS`).

  **Ghi chú khi làm:**

  - 10 test, đỏ trước rồi xanh.
- [X] T058 [P] [US2] Sửa `apps/studio/src/app/save-policy.test.ts` theo FR-023:
  - lưu được khi còn lỗi;
  - `canPackage` sai khi còn lỗi, lý do "Project còn lỗi";
  - câu tóm tắt "còn N lỗi: thiết bị sẽ từ chối project này".

  **Ghi chú khi làm:**

  - 7 test, đỏ với save-policy cũ rồi xanh; bỏ `canSave` vì theo FR-023 luôn đúng — "lưu được khi còn lỗi" kiểm qua luồng lưu thật của `StudioApp`.
- [X] T059 [US2] E2E `apps/studio/tests/e2e/edit.e2e.mjs`:
  - Max < Min → ô đỏ và "1 lỗi" trong ≤ 1 s;
  - nhấp đúp lỗi trong Thông tin → ô Max đang sửa;
  - Ctrl+Z, Ctrl+Y;
  - chỉ sửa tên project → bản giả chỉ ghi `project.json`;
  - lưu khi còn lỗi;
  - bản giả trả `changed` → hộp thoại Ghi đè / Tải lại / Hủy;
  - đóng khi chưa lưu → hộp thoại Lưu / Không lưu / Hủy.

  **Ghi chú khi làm:**

  - 34/34 đạt; đỏ với bản build trước khi có editor (chờ `#set-projectName` quá hạn); axe ở theme sáng và tối 0 vi phạm critical/serious; Max < Min → ô đỏ và "1 lỗi" sau khoảng 260 ms.
- [X] T060 [US2] Test `apps/studio/src/model/vectors.test.ts` (SC-006): mở từng thư mục trong `tests/project-vectors/` qua store với nguồn đọc thư mục thật; tập mã lỗi khớp `expected.json` của vector.

  **Ghi chú khi làm:**

  - 82 vector mở qua `StudioStore` với Platform đọc đĩa qua `NodeDirSource` của `@mat/project-schema/node` (đúng cách đọc của CLI); `W_UID_NOT_IN_SVG` (cảnh báo riêng của Studio) không đem so;
  - xanh ngay vì kiểm mã Phase 2; thử bằng bộ đọc `readFileSync` đơn giản thì 2 vector đỏ (`invalid-file-missing-case`, `invalid-json-utf8`) — test bắt được sai khác.

### Implementation for User Story 2

- [X] T061 [US2] `apps/studio/src/ui/editors/tag-grid.ts` dùng `grid-model`:
  - chọn ô chỉ đổi lớp CSS, không vẽ lại dòng;
  - Thêm Tag (tên theo `tag-ids`), Xóa dòng, Điền xuống, Lọc;
  - Dán từ Excel, Nhập/Xuất CSV hiện nhưng khóa ("Có ở GĐ 2").

  **Ghi chú khi làm:**

  - ARIA grid với `aria-activedescendant` trên `<table role="grid">`; chọn ô chỉ đổi lớp, node `tr`/`td` giữ nguyên (có test);
  - cột Tên dính bên trái khi cuộn ngang; ô lỗi có icon, `aria-invalid`, lý do ở `title`/`aria-describedby`; Ctrl+V trên lưới báo "Có ở GĐ 2";
  - trạng thái lưới nhớ theo `WeakMap<StudioApp, {project, state}>`; lấy `takeReveal('tags')` trong `willUpdate`; chỉ vào sửa khi nhảy tới từ lỗi, từ Details/Tìm thì chỉ chọn ô tên;
  - cột giá trị sống và quality của T071 làm ở đây (chip xám "mất kết nối" khi STALE; "không có trên thiết bị");
  - đo tay 500 Tag trên Chrome headless: mũi tên 10,6 ms (tối đa 14), gõ khoảng 10 ms/phím, Enter 44 ms (SC-003 ≤ 100 ms); số đo chính thức ở T081;
  - hạn chế: bộ gõ Telex có sẵn của Windows (TSF) không vào sửa bằng phím đầu tiên khi lưới chưa ở chế độ sửa (focus ở bảng, không có ô nhập nên bộ gõ không ghép chữ); nhấn F2/Enter trước thì gõ được; Unikey không bị — xử lý cùng lưới kiểu Excel ở GĐ 2.
- [X] T062 [US2] `apps/studio/src/ui/editors/settings-editor.ts` (FR-019). — **ghi chú khi làm:** thêm ô "Múi giờ cột thời gian" chỉ đọc từ logging.json (có trong mockup); lỗi ở trường không có ô sửa (ví dụ `/screens`) liệt kê ở banner đầu editor, nhảy tới thì focus banner
- [X] T063 [US2] Kiểm tra liên tục và tab Thông tin:
  - store chạy kiểm 250 ms sau lần sửa cuối, chỉ áp kết quả mới nhất;
  - F7 đọc lại đĩa;
  - danh sách lỗi trong `mat-inspector`;
  - nhấp đúp/Enter → `issue-map` → mở editor, chọn ô hoặc trường, vào sửa;
  - thanh trạng thái cập nhật.

  **Ghi chú khi làm:**

  - danh sách lỗi và nhảy tới lỗi ở `mat-inspector` + `app.gotoIssue`; lưới nhận vị trí bằng `takeReveal('tags')`, Thiết lập bằng `takeReveal('settings')`.
- [X] T064 [US2] Lưu, xung đột, đóng:
  - Ctrl+S ghi file chưa lưu kèm `diskHash`;
  - hộp thoại xung đột (FR-025);
  - dấu chưa lưu ở tab và tiêu đề cửa sổ (`setTitle`);
  - `onCloseRequested` → hộp thoại Lưu / Không lưu / Hủy → `destroy()`;
  - thêm `core:window:allow-close`, `core:window:allow-destroy` vào `apps/studio/src-tauri/capabilities/default.json`.

  **Ghi chú khi làm:**

  - capability thêm `core:window:allow-close`, `allow-destroy`, `allow-set-title`; hỏi Lưu / Không lưu / Hủy, xung đột Ghi đè / Tải lại / Hủy, dấu chưa lưu ở tab và tiêu đề kiểm bằng e2e `edit`;
  - `app.settleUnsaved()` gọi `hooks.commitPending` trước khi hỏi: ô đang gõ dở cũng tính là chưa lưu khi đóng cửa sổ hay mở project khác.
- [X] T065 [US2] `apps/studio/src/app/save-policy.ts` theo T058; khóa đóng gói/nạp xuống khi còn lỗi. — **ghi chú khi làm:** `canPackage` (lý do "Project còn lỗi"), `checkSummary` ("Còn N lỗi: thiết bị sẽ từ chối project này."), `saveNotice` (thông báo sau khi lưu, `app.save()` dùng); chuỗi chuyển vào `vi-tags.ts`, `save-policy.ts` ra khỏi `STUDIO_LEGACY_TEXT`; `commands.ts` vẫn tự tính khóa Nạp xuống (cùng kết quả), `canPackage` để feature 005 dùng
- [X] T066 [US2] Inspector cho Tag: các trường của Tag và "Dùng ở đâu" (T028); nhấp một mục thì mở editor tương ứng. — **ghi chú khi làm:** trường của Tag, giá trị sống (`mat-tag-live` tự cập nhật), "Dùng ở đâu" (`whereUsed`); nhấp mục thì `app.revealLocation`

**Checkpoint**: T056–T060 xanh; quickstart §4 bước 5–11 đạt.

- **Đạt ngày 2026-10-11 (bản build e2e, lớp Tauri giả):** Vitest Studio 544 test (37 file); e2e `edit` 34/34 và `shell` 28/28; bước 5–11 kiểm bằng e2e (bước 8 so file lưu, bước 10–11 bằng `window.__matMock`); chạy lại trên Studio thật khi build bộ cài.

---

## Phase 5: User Story 3 — Xem trước màn hình và theo dõi thiết bị (Priority: P2)

**Goal**: xem trước Tắt / Mô phỏng / Thiết bị; kết nối theo dõi chỉ đọc (viền cam, giá trị sống, Chẩn đoán); một phiên duy nhất.

**Independent Test**: spec US3 (quickstart §4 bước 12–16).

### Tests for User Story 3 ⚠️ viết trước

- [X] T067 [P] [US3] Test `apps/studio/src/ui/editors/screen-preview.test.ts`:
  - ba chế độ; "Thiết bị" khóa khi chưa theo dõi; mất phiên thì về Mô phỏng và báo;
  - nhấp phần tử → lựa chọn `element` và inspector hiện binding chỉ đọc;
  - phóng to, thu nhỏ, vừa khung.

  **Ghi chú khi làm:**

  - 9 test, đỏ trước (8/8 trước khi cài; test "SVG hỏng" viết sau nên là test hồi quy, không có bước đỏ) rồi xanh; thêm Ctrl+lăn chuột, phím + − 0 Esc, chỉ 1 WebSocket.
- [X] T068 [P] [US3] Test `apps/studio/src/ui/editors/device-page.test.ts`:
  - chuẩn hóa địa chỉ như Sprint 1;
  - kiểm kết nối báo lỗi trong ≤ 3 s (fetch giả treo);
  - nhớ địa chỉ;
  - Mở web thiết bị gọi `open_device_web`.

  **Ghi chú khi làm:**

  - 10 test, đỏ trước (9/9) rồi xanh; fetch treo báo lỗi đúng hạn với đồng hồ giả; kiểm tra kết nối không chiếm phiên; thêm test trang Thiết bị mở được khi chưa mở project (đỏ → sửa 1 dòng `app.openEditor`).
- [X] T069 [US3] E2E `apps/studio/tests/e2e/monitor.e2e.mjs` với runtime giả `apps/studio/tests/e2e/fake-runtime.mjs` (Node: HTTP `/api/v1/system/info` + WebSocket nói giao thức live 1.0.0, snapshot có `unknown`, delta; chế độ trả 4429):
  - Ctrl+K → viền cam, cột giá trị sống, "không có trên thiết bị";
  - runtime giả tắt → mất kết nối rồi tự có lại;
  - đầy → báo và thử lại;
  - Ctrl+M → runtime giả thấy socket đóng ≤ 2 s;
  - chỉ một WebSocket mở dù bảng Tag và xem trước cùng mở.

  **Ghi chú khi làm:**

  - 37/37; runtime giả `fake-runtime.mjs` (Node + `ws` 8.22.0 MIT có sẵn, chỉ e2e): system/info, live 1.0.0, Tag lạ, delta 250 ms, heartbeat, chế độ đầy 4429 và chế độ treo; axe ở xem trước, trang Thiết bị, Chẩn đoán, cả theme sáng và tối;
  - số đo: runtime bật lại → theo dõi lại 158–512 ms; Ctrl+M → runtime giả thấy socket đóng 2–4 ms; Chẩn đoán tự làm mới 4,1–4,3 s; báo lỗi kết nối 3,006–3,015 s với hạn 3 s → phiên chính hạ hạn xuống 2,8 s (`DEVICE_TIMEOUT_MS`, test đỏ trước) để thông báo hiện trong ≤ 3 s kể cả lúc vẽ;
  - kiểm cả cột giá trị sống của lưới (US2): ngay sau cột Tên, "không có trên thiết bị".

### Implementation for User Story 3

- [X] T070 [US3] `apps/studio/src/ui/editors/device-page.ts` (trang Thiết bị: địa chỉ, kiểm kết nối, mở web), thay tab Thiết bị cũ. Nút thiết bị trên cây mở trang này. — **ghi chú khi làm:** lỗi địa chỉ hiện tại ô (`aria-invalid`, `aria-describedby`), kết quả kiểm ở vùng `role=status`; `model/device.ts`: lý do lỗi thành mã (chữ ở i18n), `checkDevice` có hạn chót không phụ thuộc lớp mạng (`Promise.race`) — lỗi thật: fetch treo bỏ qua tín hiệu hủy thì trước đây treo mãi; bỏ `historianSummary` của giao diện Sprint 1; `device.ts`, `preview.ts` ra khỏi `STUDIO_LEGACY_TEXT`
- [X] T071 [US3] Nối `DeviceSession` vào store và giao diện:
  - lớp `online` của khung; thanh trạng thái hiện tên, địa chỉ, runtime, trạng thái project;
  - chấm trạng thái trên cây;
  - cột giá trị sống và quality trong lưới ("không có trên thiết bị"; mất kết nối thì không giữ giá trị cũ như còn tốt);
  - báo khi thiết bị chạy project khác.

  **Ghi chú khi làm:**

  - thanh trạng thái: tên, địa chỉ, runtime, trạng thái project; "thiết bị đang chạy project khác (id, phiên bản)" (system/info không có tên project nên dùng `projectId`); đầy hoặc mất kết nối thì đếm ngược `retryAt`, có "Thử lại ngay"; chip trên hàng menu đúng trạng thái (đang kết nối, đầy); cột sống trong lưới làm ở T061.
- [X] T072 [US3] Tab Chẩn đoán (FR-029):
  - các trường `system/info` (runtime, giao thức, phiên, project, lưu trữ, từng DB ngoài);
  - trường thiếu ghi "chưa có";
  - làm mới mỗi 5 s.

  **Ghi chú khi làm:**

  - runtime 0.3.0 đã gửi `uptimeS` nên hiện thời gian chạy runtime (FR-029: hiện mọi thông tin thiết bị cung cấp); CPU, RAM vẫn "chưa có"; mất kết nối giữ số liệu cuối và ghi rõ là số liệu cũ; runtime cũ không có khối lưu trữ thì ghi "thiết bị không báo trạng thái lưu trữ".
- [X] T073 [US3] `apps/studio/src/ui/editors/screen-preview.ts` dùng `src/preview.ts` (svg-renderer + binding-engine):
  - nguồn là `SimSource` hoặc giá trị của `DeviceSession`, cùng `DomApplier`;
  - thước, lưới, phóng to/vừa khung như mockup;
  - chọn phần tử → inspector (binding chỉ đọc, ghi chú `GĐ 3b`).

  **Ghi chú khi làm:**

  - `Preview` không còn tự mở kết nối: nhận nguồn giá trị (SimSource hoặc giá trị của phiên duy nhất), vẫn dùng `DomApplier` chung với runtime web; đổi nguồn thì dựng lại bản vẽ gốc;
  - đọc màn hình từ `outline` nên xem trước được cả khi project còn lỗi; chế độ, tỉ lệ, lưới giữ khi đổi tab;
  - inspector phần tử 4 nhóm (Chung, Gắn Tag chỉ đọc + chip "Sửa bằng giao diện: GĐ 3b", Sự kiện, Bảo mật) và giá trị sống khi đang theo dõi.
- [X] T074 [US3] Task card Công cụ online: tóm tắt thiết bị, Mở web thiết bị; nút ghi xuống thiết bị khóa ("Có ở feature 005"). — **ghi chú khi làm:** không thêm "Đồng bộ giờ" và "Khởi động lại runtime" của mockup vì lộ trình và spec 005 không có hai chức năng này
- [X] T075 ⚠️🔌 [US3] Nghiệm thu theo dõi với BL335 thật, chỉ đọc qua web, **cần người dùng xác nhận thời điểm và địa chỉ**: quickstart §4 bước 13–16. Đo độ lệch giá trị so với Chrome (SC-007) và thời gian trả phiên (`system/info`). Ghi `docs/reports/004-acceptance.md`.

  **Ghi chú khi làm (2026-10-11):**

  - người dùng giao toàn quyền nên phiên làm việc tự chạy, chỉ đọc qua web (không SSH, không đổi gì trên thiết bị), địa chỉ công khai `198.51.100.200:9080` (runtime 0.3.0, tank-demo 0.1.0); công cụ `tools/measure/studio-monitor-check.mjs` chạy Studio 0.2.0 thật, client tham chiếu là `LiveConnection` trực tiếp (vai trò trang runtime trên Chrome);
  - 10/10 đạt, [004-bl335-monitor.json](../../docs/reports/004-bl335-monitor.json): Ctrl+K theo dõi sau 150 ms, Studio chiếm đúng 1 phiên; cột giá trị sống và quality ngay sau cột Tên; 180 lần cập nhật `TANK01.LEVEL` trong 45 s lệch so với client trực tiếp trung vị 0 ms, tối đa 1 ms (SC-007 ≤ 1 s); Chẩn đoán đúng (runtime 0.3.0, 2/10 phiên, project cùng phiên bản); Ctrl+M → thiết bị giảm số phiên sau 26 ms (≤ 2 s); đóng Studio → số phiên về 0;
  - chưa làm: rút cáp mạng 30 s (bước 15) và đủ 10 phiên thật — kiểm với runtime giả ở e2e `monitor`; trên BL335 thật cần người ở cạnh thiết bị.

**Checkpoint**: T067–T069 xanh; quickstart §4 bước 12–16 đạt (bước 14–16 với runtime x64 trong Docker nếu chưa có T075).

- **Đạt ngày 2026-10-11 (bản build e2e, runtime giả):** Vitest Studio 546 test; e2e `monitor` 37/37; cả 5 file e2e chạy chung 110/110 (mỗi file một ngữ cảnh trình duyệt riêng); bước 12–16 kiểm với runtime giả; với BL335 thật ở T075.

---

## Phase 6: User Story 4 — Xem cấu hình lưu trữ (Priority: P3)

**Goal**: editor Lưu trữ chỉ đọc, có ước tính ghi eMMC và cảnh báo tại chỗ.

**Independent Test**: spec US4 (quickstart §4 bước 17).

- [X] T076 [P] [US4] Test `apps/studio/src/ui/editors/logging-view.test.ts`:
  - project mẫu: 2 nhóm với chế độ, khoảng ghi, Tag và deadband, thời hạn, đích;
  - fixture có kết nối DB: hiện loại, máy chủ, bảng, TLS, không có mật khẩu (kể cả khi URL lỡ chứa mật khẩu thì che);
  - cảnh báo `W_LOG_*` hiện cạnh mục;
  - ước tính bằng đúng `estimateLogging` của `@mat/project-schema`;
  - không có `logging.json` → câu "project chưa lưu dữ liệu".

  **Ghi chú khi làm:**

  - 17 test, đỏ trước (16 "editor logging đã đăng ký" null, 1 `maskAddress` chưa có) rồi xanh; hai ca che địa chỉ thêm sau khi xanh (`u:a://b@h`, `https://u:p?x@h`) không chạy đỏ thật;
  - fixture bọc `platform.read` vì `pickProject()` của bản giả nạp lại project mẫu; kịch bản "sửa tay" dùng `editOutside` sau khi mở rồi F7.
- [X] T077 [US4] `apps/studio/src/ui/editors/logging-view.ts`; số nhóm trên cây; inspector cho nhóm lưu trữ (`kind: 'group'`).

  **Ghi chú khi làm:**

  - bảng nhóm, bảng Tag của nhóm đang chọn (thêm cột Kiểu, Cột), bảng kết nối; ước tính và ngân sách lấy từ `@mat/project-schema` (`estimateLogging`, `LOG_BUDGET_BYTES`, `defaultTableName`, `defaultColumnName`); lỗi xếp vào mục bằng `locate()`;
  - `maskAddress` che tài khoản, truy vấn, fragment trong URL InfluxDB và host SQL; không bao giờ hiện khóa lạ;
  - chỉ đọc theo FR-026 (mockup cho sửa deadband: bỏ); mở editor thì chọn sẵn nhóm đầu; đơn vị MB/GB thập phân, ngân sách ghi "2 GiB" theo hằng số của bộ kiểm tra;
  - phiên chính bổ sung: `app.ts` nhớ lựa chọn cuối của từng editor khi chuyển tab (test đỏ trước); e2e `logging.e2e.mjs` (6/6) — axe bắt chữ phụ trên dòng chọn ở theme tối chỉ 4,46:1 → token `--sel` tối đổi `#15404a`, `contrast.test.ts` thêm cặp muted/sel, muted/hover, muted/accent-soft; e2e cũng lộ va chạm CSS toàn cục `.lv` với CSS của US3 (light DOM) → quy ước: bộ chọn CSS của editor phải có phạm vi theo thẻ thành phần.

**Checkpoint**: T076 xanh; quickstart §4 bước 17 đạt.

---

## Phase 7: Polish & nghiệm thu

- [X] T078 Dọn mã Sprint 1 không còn dùng:
  - markup form trong `apps/studio/index.html`, phần giao diện cũ của `src/main.ts`, `src/styles.css`;
  - giữ `preview.ts`, `model/device.ts`;
  - sửa `apps/studio/README.md` mô tả khung mới.

  **Ghi chú khi làm:**

  - đã bỏ: markup form và `src/styles.css` (cùng T043), editor tạm `ui/editors/pending.ts`, lớp IPC cũ `platform/tauri-source.ts` (+test), logic form của Sprint 1 trong `model/project-doc.ts` (`fieldsOf`, `rowOf`, `editsFromForm`, `filesToWrite`, `OverlaySource`, `validateEdited`; test kết luận của bộ kiểm tra sau khi sửa giữ lại, gọi thẳng `validateProject`);
  - `STUDIO_LEGACY_TEXT` của ESLint đã rỗng nên bỏ hẳn: mọi chuỗi giao diện của Studio nằm trong `src/i18n`;
  - giữ `preview.ts` (nay nhận nguồn giá trị từ ngoài) và `model/device.ts`; `apps/studio/README.md` viết lại cho khung mới.
- [X] T079 [P] `tools/ci-local.ps1` thêm bước `npm run e2e -w @mat/studio`; `.github/workflows/ci.yml` thêm bước tương ứng (Chrome có sẵn trên runner); README gốc ghi bước mới. — **ghi chú khi làm:** bước "Studio e2e" chạy sau `build:web` trong `ci-local.ps1`; `ci.yml` job `web` chạy `npm run e2e -w @mat/studio` với `CHROME_PATH=/usr/bin/google-chrome`; `run.mjs` tìm Chrome/Edge trên Windows và Linux, mỗi file e2e một ngữ cảnh trình duyệt riêng; mẫu bỏ qua `dist-e2e*` trong ESLint, Prettier, git.
- [X] T080 [P] Mở rộng `tools/measure/studio-smoke.mjs` cho khung mới:
  - đo thời gian mở tới tab Bắt đầu và mở project mẫu (SC-004);
  - đi qua luồng theo dõi nếu có tham số địa chỉ thiết bị;
  - ghi JSON vào `docs/reports/004-studio-smoke.json`.

  **Ghi chú khi làm:**

  - `studio-smoke.mjs` viết lại cho khung mới: `--exe` tự chạy Studio với cổng debug và đo thời gian mở tới tab Bắt đầu (không có `--exe` thì gắn vào Studio đang chạy, đo bằng tải lại); IPC và quyền tối thiểu; đủ vùng; F5, Ctrl+P bị chặn (bắt `defaultPrevented`); mở tank-demo từ danh sách gần đây; `--device` đi luồng theo dõi và đo trả phiên qua `system/info`. Lần chạy 2026-10-11 trên bản 0.2.0: 19/19 đạt, [004-studio-smoke.json](../../docs/reports/004-studio-smoke.json); luồng `--device` chưa chạy (T075).
- [X] T081 [P] Hiệu năng (SC-003):
  - fixture 500 Tag `tests/fixtures/studio/tags-500/` (sinh bằng script);
  - e2e đo thời gian từ phím tới ô cập nhật (≤ 100 ms) và từ sửa tới lỗi hiện (≤ 1 s);
  - ghi số đo vào báo cáo.

  **Ghi chú khi làm:**

  - fixture `tests/fixtures/studio/tags-500/` sinh bằng `make-tags-500.mjs` (tank-demo + 495 Tag, hợp lệ theo `validate:project`); lớp giả thêm `control.useProject(files, display)` (test đỏ trước) để e2e nạp project này;
  - `tests/e2e/perf.e2e.mjs` đo trong Chrome headless (từ phím tới khi vẽ xong khung hình kế), ghi `tests/e2e/out/perf.json`;
  - số đo 2026-10-11 (máy dev): mở Bảng Tag 500 dòng 99 ms; mũi tên trung bình 14 ms, p95 21,8 ms, tối đa 22,2 ms; gõ trong ô trung bình 10,5 ms, tối đa 11,4 ms; sửa Max thành -1 tới khi ô đỏ và "1 lỗi" 280 ms (SC-003: ≤ 100 ms mỗi phím, ≤ 1 s). Đo lại trên WebView2 của bộ cài ở T084.
- [X] T082 Trợ năng (SC-005): axe-core trên mọi editor; chạy tay chỉ bằng bàn phím theo quickstart §4 bước 18; ghi kết quả.

  **Ghi chú khi làm:**

  - axe-core trong e2e: tab Bắt đầu, khung với Bảng Tag và tab Thông tin, Thiết lập project, Bảng Tag, Lưu trữ, xem trước, trang Thiết bị, Chẩn đoán — theme sáng và tối — 0 vi phạm critical/serious;
  - lỗi axe tìm được và đã sửa: cây rỗng mang role=tree; nút đóng lồng trong role=tab; chữ phụ trên dòng chọn ở theme tối 4,46:1 (token `--sel` tối → `#15404a`, thêm cặp vào `contrast.test.ts`);
  - bàn phím: e2e đi F6 qua sáu vùng, bảng lệnh, menu (↑ ↓ Esc), cây, tab, lưới (mũi tên, F2, Enter, Esc, Ctrl+D), hộp thoại; chạy tay toàn bộ quickstart §4 bước 18 trên Studio thật làm cùng T086.
- [X] T083 Tài liệu:
  - `docs/architecture/studio-ux.md` (trạng thái phần đã làm);
  - ADR-009 → Accepted (kèm số đo);
  - `docs/plans/roadmap-v2.md` (trạng thái feature 004);
  - kết quả kiểm ghi vào `quickstart.md`.

  **Ghi chú khi làm:**

  - studio-ux.md (trạng thái), ADR-009 → Accepted kèm số đo, roadmap-v2 §4.1 (004 xong phần phát triển; 005 có tasks), roadmap §8 đánh số ADR 010–012 theo plan 005, quickstart §7 kết quả kiểm.
- [X] T084 Chạy `./tools/ci-local.ps1` đầy đủ, `cargo test`, rồi build bộ cài: `$env:CARGO_TARGET_DIR='C:\build\mat-studio'; npm run studio:build`. Ghi đường dẫn, kích thước, thời điểm của bộ cài.

  **Ghi chú khi làm (2026-10-11):**

  - `ci-local.ps1` đạt toàn bộ: clang-format, armhf + smoke qemu, deploy/rollback, x64 ctest 377/377, Go, lint, typecheck, `validate:project`, Vitest 769 test (Studio 534), `build:web`, e2e Studio 110/110 ([004-ci-local.txt](../../docs/reports/004-ci-local.txt));
  - `cargo test --lib` 23/23;
  - bộ cài `C:uildmat-studioeleaseundle
sismAT Studio_0.2.0_x64-setup.exe`, 208,33 MiB, 2026-10-11 15:11 (phiên bản 0.1.0 → 0.2.0); kiểm Studio thật ở T080.
- [X] T085 `docs/reports/004-acceptance.md`: bảng SC-001…SC-008 (số đo và nguồn), bảng đối chiếu chức năng Sprint 1 (quickstart §5), hạn chế còn lại.

  **Ghi chú khi làm:**

  - [docs/reports/004-acceptance.md](../../docs/reports/004-acceptance.md): bảng SC-001…SC-008, test tự động, đối chiếu chức năng Sprint 1, hạn chế, bộ cài và kiểm trên Studio thật (CSP thật: `style-src` vẫn `unsafe-inline`, 0 vi phạm khi xem trước). SC-002 và SC-008 chờ người dùng (T086); SC-007 với BL335 thật chờ T075.
- [X] T086 Người dùng dùng thử bộ cài và duyệt giao diện (SC-008); ghi phản hồi và việc phải sửa.

  **Ghi chú (2026-10-11):** người dùng đã dùng thử và duyệt giao diện ("giao diện ok"); SC-008 đạt. Từ đây người dùng giao toàn quyền: nghiệm thu tiếp theo do phiên làm việc tự chạy và tự đánh giá.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → các user story.
- **GĐ 0** phải xong phần `project-form.ts` trước T002 và phần `live-client/state.ts` trước T014, T030.
- **US1 (Phase 3)** cần T040 (người dùng duyệt mockup) và Phase 2.
- **US2** cần US1 (khung, inspector, tab).
- **US3** cần US1, cộng T030 và T032. Cột giá trị sống của lưới cần T061 (US2).
- **US4** cần US1; làm song song với US2, US3 được.
- **Polish** cần các story muốn nghiệm thu. T075 và T086 cần người dùng.

### Within Each User Story

- Test (đỏ) → cài đặt (xanh) → e2e → kiểm theo quickstart.
- Logic thuần (`app/`, `model/`) trước component (`ui/`).

### Parallel Opportunities

- Phase 1: T003, T004 song song.
- Phase 2: T005–T020 song song (khác file test); T021–T029, T033, T037–T039 song song sau test tương ứng.
- US1: T045–T052 song song sau T044.
- US2: T056–T058 song song.
- US3: T067, T068 song song.
- US4 song song với US2, US3.

---

## Parallel Example: Phase 2

```text
# Test (viết trước, cùng lúc):
Task: "Test apps/studio/src/app/history.test.ts"
Task: "Test apps/studio/src/model/project-doc.test.ts"
Task: "Test apps/studio/src/model/tree.test.ts"
Task: "Test apps/studio/src/model/issue-map.test.ts"
Task: "Test apps/studio/src/model/grid-model.test.ts"
Task: "Test Rust apps/studio/src-tauri/src/recent.rs"

# Cài đặt (mỗi module một file):
Task: "apps/studio/src/app/history.ts"
Task: "apps/studio/src/model/tree.ts"
Task: "apps/studio/src/model/issue-map.ts"
```

---

## Implementation Strategy

### Trước khi người dùng duyệt mockup

Làm Phase 1 và Phase 2 (logic thuần, lệnh Rust, i18n, token, icon). Phần này không phụ thuộc bố cục: duyệt xong mà đổi màu hay vị trí vùng thì chỉ sửa token và `mat-shell`.

### MVP

Phase 3 (US1) + Phase 4 (US2): khung mới thay hẳn trang form, đủ chức năng sửa và lưu của Sprint 1. Build bộ cài cho người dùng thử ngay sau mốc này.

### Incremental Delivery

1. US1 + US2 → bộ cài thử lần 1.
2. US3 (xem trước, theo dõi) → bộ cài thử lần 2, nghiệm thu với BL335.
3. US4 (lưu trữ) → Polish → nghiệm thu feature 004.
4. Feature 005 (tìm thiết bị, đăng nhập, nạp xuống) dùng khung này.

## Notes

- Đánh dấu [X] khi xong; lệch kế hoạch thì ghi "ghi chú khi làm" ngay trong task.
- Không commit khi người dùng chưa yêu cầu.
