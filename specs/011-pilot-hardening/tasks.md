---

description: "Task list — Hoàn thiện và pilot, trình vẽ SVG đầy đủ, logic v2"
---

# Tasks: Hoàn thiện và pilot, trình vẽ SVG đầy đủ, logic v2

**Input**: `specs/011-pilot-hardening/` (plan.md, spec.md, research.md R1–R32, data-model.md, contracts/, quickstart.md); ADR [035](../../docs/adr/035-release-trust-ota.md), [036](../../docs/adr/036-security-hardening.md), [037](../../docs/adr/037-logic-v2.md), [038](../../docs/adr/038-svg-editor-templates.md) (Proposed khi lập tasks); [Constitution](../../.specify/memory/constitution.md) 2.0.1 (cần PATCH 2.0.2, T004).

**Tests**: **Bắt buộc, viết trước** (Constitution VI; FR-006). Mỗi task "Test" phải chạy **đỏ** trước task cài đặt tương ứng; ghi kết quả đỏ/xanh vào "**Ghi chú khi làm:**" ngay dưới task, như 003 đến 007. Task gộp test và cài ghi cả hai.

- **C++:** GoogleTest + CTest x64 trong Docker (`deployment/toolchain/test-x64.ps1`; `-Target`, `-Filter`, `-BuildDir C:\build\mat-x64-<tên>`); test armhf dưới qemu-user (`deployment/toolchain/test-armhf.sh`; thêm module mới vào `MAT_ARMHF_TEST_TARGETS`); smoke armhf; ASan + UBSan (`-DMAT_SANITIZE=ON`).
- **TS:** Vitest (`npm test -w <package>`), e2e Chrome headless + axe-core (`npm run e2e -w @mat/studio`, `-w @mat/runtime-web`).
- **Rust:** `cargo test --lib` trong `apps/studio/src-tauri` với `$env:CARGO_TARGET_DIR='C:\build\mat-studio'`.
- **Node:** `node --test tools/<thư mục>`.
- **Vector chung:** C++ ↔ TS: `tests/project-vectors/` (ca `v10-*`), `tests/logic-vectors/`, `tests/package-vectors/`, `tests/update-vectors/`; chỉ TS: `tests/migration-vectors/`, `tests/svg-editor-fixtures/`, `tests/pilot-kpi/`.
- **Tích hợp x64:** `tools/device-it.ps1`, `tools/driver-it.ps1`, `tools/web-it.ps1`, `tools/update-it.ps1` (mới), `tools/logic-it.ps1` (mới) trên mạng Docker; kết quả `docs/reports/011-<kịch bản>-x64.json`.
- **Thử tay (cần người):** bộ gõ, trình đọc màn hình, Chrome và Windows thật, cài bộ cài trên máy sạch.

**Ký hiệu**:

- **⚠️🔌** cần BL335 thật, người, thiết bị phụ (bộ điều khiển nguồn, máy Windows sạch) hoặc khách hàng. **SSH không có trong phiên viết kế hoạch**; không tìm cách vòng qua.
- **🌐** cần Internet cho công cụ (`cargo audit`, `npm audit`, tra cứu CVE). Không có mạng thì ghi "BỎ QUA: không có mạng", không báo xanh.
- **Quyền quyết định:** người dùng giao toàn quyền cho phiên chính ngày 2026-10-11; quyết định mới ghi "Quyết định (người dùng giao toàn quyền 2026-10-11)" vào task, plan hoặc research. Phiên chính tự duyệt mockup, tự nghiệm thu, commit mốc cục bộ (không push).

**Quy ước**:

- **Constitution V, thứ tự bảo mật:** không viết đường nhận gói cập nhật ở runtime (T111 trở đi) trước khi bộ gói xấu (T106, T107) đỏ; không viết đường ghi PLC của logic (T137) trước khi T004 (PATCH 2.0.2, đã duyệt 2026-10-16) xong và bộ test ghi (T129) đỏ; mọi endpoint mới khai `cookieAllowed = false` rõ ràng trong bảng quyền; không lệnh ghi nào tới thiết bị trường trước khi bản ghi audit đã commit (FULL).
- **Mockup trước code giao diện:** không viết `apps/studio/src/ui/logic/**`, `apps/studio/src/ui/svg/**`, hộp thoại OTA trước khi T007 (duyệt mockup) ghi ngày duyệt.
- **Thiết bị BL335 ⚠️🔌:** chỉ khi người dùng cho phép (Constitution, quy trình bước 3); ghi mọi thay đổi vào `docs/reports/device-changes.md` kèm cách hoàn tác; không đụng `atscada-*`, `piano-edtech-*`; không tự khởi động lại hay cắt điện; không ghi mật khẩu vào repo; BL335 không có `sudo` (lệnh root chạy trực tiếp; lệnh chỉ đọc chạy bằng `runuser -u matscada --`). Đổi `sshd`, đóng cổng, cắt điện: cần người đồng ý và ở cạnh.
- **Cấm sửa mã khi `ci-local` đang chạy trên cây:** các task ghi mã chạy sau khi lượt `ci-local` hiện hành kết thúc.
- **Thư viện:** không thêm gói npm, crate hay thư viện C++ nào mới. Buộc phải thêm thì: bản phát hành ≥ 2 tuần, rà license, ghi `third_party/LICENSES.md`, không GPL/LGPL, ghi lý do.
- **Chuỗi và an toàn DOM:** `apps/studio/src/ui/{svg,logic}/`, `packages/{svg-edit,logic-engine}/` không dùng `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `unsafeHTML` (lint T014; SC-034).
- **Ổ D:** build Rust ở `C:\build\mat-studio`; build C++ ở `C:\build\mat-x64-<tên>`; vector lớn sinh lúc chạy vào `out/` (không commit); `release/` không commit.
- **Mật khẩu thử:** sinh ngẫu nhiên mỗi lần chạy (`--user-add --password-stdin`), không ghi vào repo. Khóa thử (`tests/update-vectors/keys/`) chỉ cho test.
- **Glob lint:** mỗi task tạo file `.mjs` đầu tiên trong thư mục `tests/*` hoặc `tools/*` mới thì thêm mẫu glob vào `lint`, `format` của `package.json` gốc và `eslint.config.mjs`.
- **Bẫy đã biết** (004 đến 007): axe `nested-interactive`, `role=tree` rỗng; light DOM làm CSS toàn cục; handler đọc trạng thái lúc chạy, không đọc bản chụp lúc render; `HTMLElement` đã có `title`, `hidden`; e2e mỗi file một browser context; ctest `-Filter` lọc sai thì chạy 0 test mà vẫn thoát mã 0 (kiểm số test); PowerShell 5.1 làm mất dấu nháy khi truyền cờ cho native exe.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1…US9 theo spec.md
- **Spec**: mỗi task nêu FR hoặc SC mà nó phục vụ

---

## Phase 1: Setup (cấu trúc, gói, mockup, spike, kiểm BL335)

- [x] T001 [P] Cấu trúc thư mục và `.gitignore` (FR-001, FR-135):
  - tạo `packages/{logic-engine,svg-edit}/src/`, `core/{logic,update}/tests/`, `server/updater/`, `tools/{release,soak,powercut,pilot,sast,fuzz}/`, `tests/{logic-vectors,update-vectors,svg-editor-fixtures,pilot-kpi,fuzz-corpus}/`, `docs/{user,training,pilot,release}/`, `apps/studio/src/{model/svg,ui/svg,ui/logic}/`;
  - `.gitignore`: `release/`, `tests/*-vectors/out/`, `tests/pilot-kpi/out/`, `docs/pilot/data/`, `**/.mat-editor/`;
  - thư mục rỗng chưa vào git: không thêm file giữ chỗ.
  - **Ghi chú khi làm (2026-10-16):** `.gitignore` thêm `release/`, `tests/pilot-kpi/out/`, `docs/pilot/data/`, `**/.mat-editor/` (`tests/*-vectors/out/` đã có từ 005). Thư mục tạo khi task đầu tiên ghi file vào đó.
- [x] T002 [P] Hai package workspace `@mat/logic-engine` và `@mat/svg-edit` (FR-092, FR-097): `package.json` (`private`, `version` 1.0.0-rc.1, `type: module`, `exports` `./src/index.ts`, script `typecheck`, `test`; phụ thuộc workspace `@mat/expression`, `@mat/project-schema`, `@mat/svg-renderer` ở dạng `*`; `devDependencies` cùng phiên bản với package có sẵn), `tsconfig.json`, `vitest.config.ts` (`environment: 'node'`, không jsdom), `src/index.ts`; `npm install` chỉ thêm liên kết workspace vào `package-lock.json` (kiểm bằng diff).
  - **Ghi chú khi làm (2026-10-16):** `packages/logic-engine`, `packages/svg-edit` (1.0.0-rc.1, khung `index.ts`); `npm install` chỉ thêm 2 liên kết workspace và 2 bản `typescript` 7.0.2 lồng trong package như mọi package khác (không thêm phụ thuộc ngoài); typecheck xanh.
- [x] T003 [P] Chốt số phiên bản trung gian và phụ thuộc (FR-001, FR-002; D2, R2): đọc lại trạng thái các feature 008 (GĐ 3b), 009 (GĐ 4), 010 (GĐ 5) (`specs/`, roadmap-v2 §4.4 đến §4.6): bảng "Các feature đứng trước" ở plan đã có số lúc viết (2026-10-13); cập nhật số API thiết bị (MINOR kế tiếp của 010), các định dạng trung gian (0.4.0, 0.5.0, của 010) và việc mã của 008 đã có chưa (`sanitizeSvg` allowlist, `@mat/svg-import`, `model/svg-doc.ts`); kiểm ADR 035 đến 038 còn trống; nếu 008 chưa có mã importer thì ghi "US6, US7 chờ" vào plan và tasks.
  - **Ghi chú khi làm (2026-10-16):** bảng "Các feature đứng trước" của plan cập nhật: 008, 009, 010 đã có mã (runtime 0.9.0, Studio 0.8.0, định dạng 0.6.0, API 1.4.0, live 1.3.0); 011 dùng API **1.5.0**; ADR 035–038 có sẵn (Proposed), ADR-039 đã dùng cho bộ đếm ghi SQLite nên ADR mới từ 040; không cần "US6, US7 chờ".
- [x] T004 **Constitution PATCH 2.0.2** (xong 2026-10-16: `.specify/memory/constitution.md` 2.0.2, Sync Impact Report; plan, tasks, ADR 035/036 đã cập nhật) (D22, R31): chạy `/speckit-constitution` với đề xuất: (a) làm rõ nguyên tắc V: lệnh ghi do luật logic đã triển khai khởi tạo được ủy quyền bởi người nạp xuống (role `engineer`) và danh sách `writes` đã khai, và lệnh nhả xung dở khi khởi động (T045) là phần của lệnh xung đã được ủy quyền và audit từ đầu, vẫn qua chuỗi kiểm và audit bền; (b) thêm "cập nhật runtime qua mạng" vào nhóm chức năng chỉ bật khi có HTTPS, đăng nhập, role, audit; (c) ghi Sync Impact Report, cập nhật Constitution Check của plan 011. Phiên chính duyệt (người dùng giao toàn quyền). **Chặn** T129 và T137 (ghi PLC của logic) và T111 đến T113 (đường OTA ở runtime); T045 (nhả xung khi khởi động) làm được trước nhưng không đóng (đánh dấu xong) trước khi PATCH được duyệt. (FR-058, FR-080)
- [x] T005 [P] Mockup `docs/architecture/mockups/studio-logic.html` (FR-094; theo kiểu và token của `studio-shell.html`, `studio-screens.html`; sáng và tối; không CDN):
  - **cảnh 1:** nút Logic trên cây (Luật, Timer, Counter, Cộng dồn, Giờ chạy, Lịch, Ghi PLC), bảng khối, inspector, ô biểu thức, danh sách lỗi;
  - **cảnh 2:** bảng Thử logic (đường thời gian đầu vào/đầu ra, đặt tay, tua ×1/×10/×100);
  - **cảnh 3:** hộp xem trước Nạp xuống liệt kê "Logic sẽ tự động ghi N Tag xuống PLC", chip trạng thái "Ghi PLC: tắt/bật/dừng", hộp "Dừng ghi của logic";
  - **cảnh 4:** chú giải (trạng thái `OK`, `SUSPENDED`, `THROTTLED`, `DISABLED` có màu và biểu tượng).
- [x] T006 [P] Mockup `docs/architecture/mockups/studio-svg-draw.html` (FR-116, FR-127; khác `studio-svg.html` của feature 008): **cảnh 1** editor SVG (Toolbox công cụ dọc trái, canvas có thước, lưới, tay nắm, đường gióng, panel Lớp, inspector Chung/Hình học/Hiển thị/Văn bản/Gắn Tag); **cảnh 2** tab "Mới: SVG trống", hộp "Khôi phục bản tự lưu", hộp "Tệp đã đổi bên ngoài", cảnh báo xóa phần tử có binding; **cảnh 3** Template (tạo từ vùng chọn, tham số, thư viện, danh sách bản sao, "Cập nhật mọi bản sao"), hộp `args` của hành động Mở popup, faceplate; **cảnh 4** chú giải phím.
- [x] T007 Phiên chính xem và duyệt hai mockup T005, T006 (người dùng giao toàn quyền; D3): ghi ngày duyệt và điểm chỉnh vào ghi chú khi làm; đối chiếu `studio-ux.md` §5, §7, §9. **Chặn** mọi task giao diện Studio mới (T119, T143, T144, T162, T163, T173). (FR-094, FR-116)
  - **Ghi chú khi làm (2026-10-16): duyệt** `studio-logic.html` (4 cảnh, mô phỏng quét 100 ms chạy thật) và `studio-svg-draw.html` (4 cảnh, editor tương tác); jsdom + parse5 + axe (wcag2a/aa) 0 lỗi critical/serious; chụp bằng chrome-headless-shell 155 sáng/tối: 0 lỗi trang, 0 tài nguyên ngoài; đúng kiểu IDE của `studio-ux.md` §5, §7, §9. **Điểm chỉnh khi dựng:** panel Thuộc tính của Logic quá chật (cột hẹp, chữ bị cắt): cho Inspector rộng tối thiểu 360 px hoặc xếp ba nhóm thành hàng dọc khi hẹp; kiểm tương phản màu ở e2e (axe chưa kiểm color-contrast trong jsdom). Quyết định (người dùng giao toàn quyền 2026-10-16), theo đề xuất của mockup: (1) chip Ghi PLC 4 trạng thái tắt/bật/dừng/chưa hỗ trợ (theo `system/info.logic.writes` off/on/stopped và thiết bị cũ); (2) màu khối: SUSPENDED hổ phách, THROTTLED xanh dương thông tin, DISABLED xám, luôn kèm biểu tượng và chữ; (3) Logic: khung dưới chia Inspector trái, Thông tin phải, "Thử logic" là tab cạnh Thông tin; (4) Nạp xuống bắt buộc tích "Tôi đã xem danh sách" khi project có ghi tự động; (5) "Dừng ghi của logic" không đòi nhập lại mật khẩu (D35 chỉ cho OTA), "Bật" bị khóa kèm `LOGIC_ENABLE_ROOT_ONLY`; (6) editor SVG: Toolbox trong vùng editor, panel phải Lớp trên/Thuộc tính dưới, tab Gắn Tag dẫn sang inspector 13 dòng của 008; (7) "Mới: SVG trống" là tab; (8) Tệp đổi bên ngoài: Nạp lại xóa lịch sử hoàn tác, Giữ thì lần Lưu sau hỏi trước khi ghi đè; (9) **`args` của popup trong template được dùng `{param}`** (bổ sung contract project-format-1.0 §3, giao nhánh định dạng); (10) xóa template còn bản sao: chỉ "bung thành item thường rồi xóa" hoặc Hủy; (11) bản sao template màu tím (token `--tplc`) kèm biểu tượng.
- [x] T008 [P] **Spike** `mat-update-verify` (R16, R17): trong scratchpad, đọc phong bì tar (hai tiêu đề đầu), băm SHA-256 dòng, kiểm ECDSA P-256 bằng Mbed TLS 3.6.7 (`mbedtls_pk_verify`); kiểm vector ký bằng `openssl dgst -sha256 -sign` và bằng Node `crypto`; build x64 và armhf (qemu); đo kích thước tệp tĩnh và thời gian kiểm trên armhf; ghi số vào mục "Số đo" của ADR-035. **Điều kiện:** tệp ≤ 400 KB, kiểm một chữ ký ≤ 100 ms trên Cortex-A7 (hoặc qemu, ghi rõ); không đạt thì ghi vào ADR-035. (FR-069)
  - **Ghi chú khi làm (2026-10-16, macOS):** mã thử ngoài repo; kiểm vector ký bằng `openssl dgst` (1.1.1f) và Node 24 `crypto` đúng, 11/11 ca xấu bị từ chối đúng mã. Kích thước armhf (strip): tĩnh hoàn toàn 465 KiB (**không đạt** ≤ 400 KB, gần hết là glibc tĩnh), glibc động + libstdc++/Mbed TLS tĩnh **154 KiB** (đạt). Thời gian **chỉ đo dưới qemu-arm** trên Apple Silicon: 9,4–10,6 ms một chữ ký (đạt ≤ 100 ms dưới qemu); số Cortex-A7 đo ở T122. Quyết định (người dùng giao toàn quyền 2026-10-16): liên kết glibc động, điều kiện đổi thành "≤ 400 KB, chỉ phụ thuộc libc" (`GLIBC_2.25`), giới hạn ≤ 4 khóa tin cậy. Số đo ở ADR-035 mục "Số đo", chi tiết `docs/reports/011-spikes.md`.
- [ ] T009 [P] **Spike** `signtool` và chứng chỉ thử (R15; FR-050): xác định đường dẫn `signtool.exe` (Windows SDK 26100); `New-SelfSignedCertificate -Type CodeSigningCert` vào `Cert:\CurrentUser\My`; ký một `.exe` thử; `Get-AuthenticodeSignature` trả `NotTrusted` và dấu vân tay đúng; `signtool verify /pa /v` trả lỗi chuỗi nhưng báo toàn vẹn đúng; sửa 1 byte → `HashMismatch`; gỡ chứng chỉ. Không đụng kho tin cậy. Ghi kết quả vào ADR-035 và `contracts/release-signing.md` §3 nếu khác giả định.
- [ ] T010 [P] **Spike** Tauri `signCommand` (R15; FR-048): đọc tài liệu Tauri 2.12 và mã của `tauri-bundler` (trong cache cargo) để xác nhận tên khóa `bundle.windows.signCommand`, dạng đối số (`%1`), nó có ký trình gỡ NSIS và `mat-studio.exe` không; dựng thử bằng chứng chỉ thử (4 phút) và kiểm 3 tệp; ghi kết quả vào `contracts/release-signing.md` §4.
- [x] T011 [P] **Spike** SAST trong container (R11; FR-028): kiểm `cppcheck` và `clang-tidy` có trong image toolchain `mat-armhf` (nếu thiếu: thêm vào `deployment/toolchain/Dockerfile` ở task T056); chạy một lần trên `core/auth/` và `drivers/modbus/`; ghi số phát hiện cơ sở và thời gian chạy.
  - **Ghi chú khi làm (2026-10-16):** `cppcheck`, `clang-tidy` **không có** trong `mat-armhf`: chạy trong container dùng một lần (cppcheck 1.90, clang-tidy 10). 16 tệp của `core/auth/` và `drivers/modbus/`: cppcheck 1 s, 11 phát hiện (9 style `useStlAlgorithm`, `noExplicitConstructor`, `virtualCallInConstructor`); clang-tidy mở rộng 20 s, 2 (`VirtualCall` ở destructor của `modbus_tcp_driver.cpp:155`, `inefficient-vector-operation` ở `codec.cpp:71`). Không có phát hiện bảo mật. T056: thêm hai gói vào Dockerfile, cổng CI ở mức warning/performance/portability; hai chỗ trên sửa ở US1 (đánh dấu lớp `final`).
- [x] T012 [P] **Spike** thu thập eMMC (R13, R14; FR-045): trong Docker không đo được; chuẩn bị lệnh chỉ đọc cho T013 và bộ phân tích `mmc extcsd read` (mẫu đầu ra thật từ tài liệu `mmc-utils`) làm fixture `tools/soak/fixtures/extcsd-*.txt` cho `analyze.mjs`.
  - **Ghi chú khi làm (2026-10-16):** định dạng lấy từ chuỗi `printf` của nhị phân `mmc` (mmc-utils Ubuntu 20.04), không viết theo trí nhớ; 4 fixture `tools/soak/fixtures/extcsd-{healthy,worn,eol,emmc45-no-health}.txt` và `README.md` (giải mã JEDEC, regex, lệnh chỉ đọc cho T013, lệnh `mmc` ghi bị cấm). Giá trị là giả lập; T013 chép đầu ra thật vào `extcsd-bl335.txt`.
- [ ] T013 ⚠️🔌 **(SSH không có; chờ người dùng cho phép hoặc tự chạy lệnh quickstart §7)** Kiểm chỉ đọc trên BL335: `mmc extcsd read /dev/mmcblk0` (có `mmc-utils`?), `/sys/block/mmcblk*/stat`, `mount`, `df`, `hostname`, `timedatectl show`/`chronyc tracking`, `sshd_config` và `sshd_config.d/*`, `systemd --version`, `tar --version`, `sha256sum`, `openssl version`, `ls /etc/mat-runtime`, `systemctl show mat-runtime -p NRestarts`; chốt: có `mmc-utils` không, đường đọc tuổi thọ eMMC, cách phát hiện đồng bộ giờ (R23), `sshd` có cho root bằng mật khẩu không. Ghi `docs/reports/device-profile.md` (mục "011") và `docs/reports/011-load.md`. (FR-034, FR-045)
- [x] T014 [P] Lint an toàn DOM mở rộng (FR-004; SC-034): `eslint.config.mjs` thêm khối cho `apps/studio/src/ui/{svg,logic}/**`, `apps/studio/src/model/svg/**`, `packages/{svg-edit,logic-engine}/src/**` (không áp cho `*.test.ts`) cấm `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, import `lit/directives/unsafe-*`, `setTimeout`/`setInterval` với chuỗi; thêm ca vào `tools/lint-rules.test.mjs` (đỏ rồi xanh); mẫu fixture ở `tools/lint-fixtures-007/` (tạo `tools/lint-fixtures-011/`).
  - **Ghi chú khi làm (2026-10-16):** `tools/lint-rules.test.mjs` thêm 5 đường dẫn (ui/svg, ui/logic, model/svg, svg-edit, logic-engine): **đỏ 5/22**; khối mới cuối `eslint.config.mjs` (no-eval, no-new-func, no-implied-eval, cấm import `lit/directives/unsafe-*`, innerHTML, outerHTML, insertAdjacentHTML, document.write/writeln, setTimeout/setInterval với chuỗi): **xanh 22/22**. Quyết định: dùng lại fixture `tools/lint-fixtures-007/` (cùng mẫu vi phạm) thay vì sao chép sang `lint-fixtures-011/`.

---

## Phase 2: Foundational — nền chung cho mọi story

**Mục đích:** định dạng project 1.0.0, quy tắc tập tệp, cấu hình `runtime.json`, danh mục mã lỗi, chẩn đoán. Hầu hết story cần chúng.

### Định dạng, migration, validator

- [ ] T015 [P] [US7] **Test đỏ** migration 0.x → 1.0.0 (FR-002; SC-042): `tests/migration-vectors/` thêm cặp file (đầu vào 0.1, 0.2, 0.3 → đầu ra 1.0.0 giống từng byte) cho `tank-demo`, `modbus-demo`, `dashboard-demo`; `packages/project-schema/src/migrate-10.test.ts` (idempotent: chạy hai lần cho cùng kết quả; project đã 1.0.0 giữ nguyên; project > 1.0 từ chối).
- [ ] T016 [US7] Migration `migrate_to_1_0_0` (FR-002): `packages/project-schema/src/migrate.ts` (chuỗi 0.1 → 0.2 → 0.3 → (trung gian) → 1.0.0, thuần thêm), `apps/studio/src/model/project-doc.ts` (nâng cấp có sao lưu `.mat-backup/` như 007); Studio hiện lời nhắc "Runtime cũ không nhận 1.0.0" khi thiết bị Online báo `system/info` không có `update`/`logic` (R32). T015 xanh.
- [ ] T017 [P] [US7] Schema 1.0 (FR-073, FR-119, FR-123; contracts/project-format-1.0.md §7): `schemas/logic.schema.json`, `schemas/template.schema.json` mới; `schemas/screen.schema.json` thêm `tpl`, `params`, `args`; `schemas/binding.schema.json` (feature 008) thêm `args` cho sự kiện `events.click` kiểu `popup`; `schemas/project.schema.json` thêm `logic`, `templates`; `schemas/widgets.catalog.json` thêm `args` và "chỗ dùng được `{param}`"; đóng băng `schemas/1.0/`; cập nhật `schemas/README.md`; `meta-schema.test.ts` phủ schema mới.
- [ ] T018 [P] [US7] **Test đỏ** vector chung `v10-*` (FR-124; SC-037): `tests/project-vectors/` thêm ≥ 60 ca: template (tham số sai kiểu, `{x}` không khai, Tag không có, `tagPrefix` ký tự lạ, giá trị 65 byte), popup `args` (thiếu, thừa, sai kiểu, 1.000+ tổ hợp), `tpl` (id trùng, `tid` không có), mỗi mã `E_TEMPLATE_*`, `E_POPUP_ARGS`, `W_TEMPLATE_DRIFT` ≥ 1 ca đúng và 1 ca sai; chạy bằng `packages/project-schema/src/vectors-10.test.ts` (đỏ) và C++ (`core/project-manager/tests/vectors_10_test.cpp`, đỏ).
- [ ] T019 [US7] Validator TS 1.0.0 (FR-120 đến FR-124): `packages/project-schema/src/{format-10,types-10,rules-10}.ts`, `codes.ts`, `validate.ts`; bung tĩnh mọi chỗ gọi popup có tham số; T018 phần TS xanh.
- [ ] T020 [US7] Validator C++ 1.0.0 (FR-124): `core/project-manager/rules_10.{hpp,cpp}`, `project_validator.cpp`, `widget_catalog.cpp`; dùng cùng danh mục; T018 phần C++ xanh; vector 0.1, 0.2, 0.3 giữ kết luận (SC-012 của 007).
- [ ] T021 [P] [US7] `substituteParams` thuần (FR-122, FR-125): `packages/project-schema/src/params.ts` + `params.test.ts` (đỏ rồi xanh): chỉ `{name}` đúng chỗ, không lồng, ký tự `{}` lạ lỗi, kiểu `tagPrefix` regex, độ dài, trả cùng kết quả cho mọi ca của vector; `@mat/ui-components` dùng lại ở T174.

### Tập tệp của gói và project (FR-024)

- [ ] T022 [P] [US1] **Test đỏ** file thừa (SC-006): `tests/package-vectors/` thêm ≥ 10 ca (thừa ở gốc, trong `screens/`, SVG không tham chiếu, `.mat-editor/`, `.mat-backup/`, tệp ẩn, trùng tên khác hoa thường, binding mồ côi, template không liệt kê, thư mục lạ, tệp quá lớn); test C++ ở `core/package/tests/` và `core/project-manager/tests/`, Vitest `packages/project-schema/src/project-files.test.ts`, Rust `apps/studio/src-tauri/src/package/rules.rs` (`#[cfg(test)]`).
- [ ] T023 [US1] File thừa ở runtime (FR-024; R9): `core/package/{package_check,package_rules,project_digest}.cpp` từ chối `E_PACKAGE_EXTRA_FILE`, digest trên cùng tập tệp; T022 phần C++ xanh; `device-it` nạp xuống 30 lần không `HEALTH_TIMEOUT` do lệch digest (ghi vào T054).
- [ ] T024 [US1] File thừa ở Studio (FR-024): `packages/project-schema/src/{project-files,package-digest}.ts`, `apps/studio/src-tauri/src/package/{rules,mod}.rs` loại `.mat-editor/`, `.mat-backup/`, `.git/`, `.vs/`, `node_modules/`, `Thumbs.db`, `desktop.ini`, `~*`, `*.tmp` khi đóng gói; mở project có tệp thừa: lỗi `E_PACKAGE_EXTRA_FILE` kèm danh sách; T022 phần TS và Rust xanh.

### Danh mục mã lỗi, cấu hình, chẩn đoán

- [x] T025 [P] [US8] Danh mục mã lỗi duy nhất (FR-006; SC-038): `schemas/error-codes.json` (mã, HTTP, nhóm, thông điệp tiếng Việt, nơi dùng) cho mọi mã của 005 đến 011; `tools/gen-error-codes.mjs` sinh `docs/user/error-codes.md`; `tools/gen-error-codes.test.mjs`: grep `E_[A-Z0-9_]+`, `W_[A-Z0-9_]+` và chuỗi mã trong `server/`, `core/`, `drivers/`, `packages/*/src` không có trong danh mục thì thất bại (đỏ trước khi điền, rồi xanh).
  - **Ghi chú khi làm (2026-10-16):** `tools/gen-error-codes.test.mjs` **đỏ** (thiếu danh mục: 5/6 đỏ; danh mục rỗng: "358/358 mã chưa có") rồi **xanh 6/6**. `schemas/error-codes.json`: 358 mã (159 `E_`, 37 `W_`, 162 mã API/kết quả/quality; 57 có HTTP) trong 15 nhóm; `docs/user/error-codes.md` sinh bằng `tools/gen-error-codes.mjs` (`--check`). Luật nhận mã ghi ở đầu file test (cố ý hẹp: `E_/W_` mọi nơi; chuỗi SCREAMING_SNAKE có gạch dưới chỉ trong C++; mã một từ chỉ ở chỗ phát lỗi), kiểm cả mã thừa, `usedIn` khớp, thông điệp có dấu. Mã của 011 chưa cài (E_LOGIC_*, UPDATE_*, E_TEMPLATE_*, E_PACKAGE_EXTRA_FILE) thêm khi task cài chúng (test bắt). Test chạy trong `ci-local.ps1` và GitHub CI. Sửa kèm lỗi chữ có sẵn `issue.E_ALARM_ON` ("BAD hoặc BAD hoặc UNCERTAIN").
- [x] T026 [P] [US1] **Test đỏ** khóa `runtime.json` mới (FR-008): `server/tests/config_test.cpp` (mặc định, khoảng, kiểu sai khiến không khởi động và thông báo cụ thể, khóa lạ bị bỏ qua có cảnh báo): `allowedHosts`, `hostCheck`, `maxConnPerSource`, `maxConcurrentLogins`, `pulseRecovery`, `update.{enabled,maxPackageMiB,trustedKeysDir}`, `logic.{writes,maxWritesPerMin,flushS,scanMs}`, `tzOffsetMin`.
  - **Ghi chú khi làm (2026-10-16):** `server/tests/config_test.cpp` thêm 5 test `Config011.*` (mặc định an toàn, biên khoảng, 27 ca sai kiểu/ngoài khoảng nêu tên khóa, `allowedHosts` ≤ 32 tên ≤ 253 byte, khóa lạ ở gốc và trong `update`/`logic` thành cảnh báo): **đỏ** (32 lỗi biên dịch). Theo contract §6 (khóa lạ: bỏ qua kèm cảnh báo), 3 test cũ kiểm "khóa lạ dừng runtime" (`Config.InvalidValuesAreErrors`, `DeviceConfig.RuntimeJsonOfTheDeviceStillLoads`, `Config009.*UnknownAlarmKey*`) đổi sang kiểm cảnh báo nêu tên khóa và mặc định giữ nguyên. Quyết định (người dùng giao toàn quyền 2026-10-16): làm theo contract vì mọi khóa mới mặc định an toàn (gõ sai tên giữ bảo vệ bật) và file viết cho bản mới hơn vẫn chạy được.
- [x] T027 [US1] Cài đặt cấu hình (FR-008): `server/config.{hpp,cpp}`, `deployment/config/runtime.json` (giá trị mặc định tường minh), `docs/deployment/mat-runtime.md` (mục 5e); T026 xanh.
  - **Ghi chú khi làm (2026-10-16):** `applyJson011` trong `server/config.cpp` (lỗi nêu tên khóa, gồm `update.*`, `logic.*`), cảnh báo in stderr qua `main.cpp`; `deployment/config/runtime.json` ghi tường minh mọi khóa mới; tài liệu ở mục **5h** (5e đã dùng cho 008), kèm lưu ý rollback xuống 0.9 (bản cũ vẫn từ chối khóa lạ; `deploy.sh` chỉ cài `runtime.json` lần đầu nên file trên thiết bị không bị đè). Config x64: **xanh 47/47**.
- [ ] T028 [P] [US2] **Test đỏ** `system/diagnostics` mới (FR-009; SC-016): `server/tests/diagnostics_audit_api_test.cpp`: `uptimeS`, `restarts`, `rssPeakMb`, `fdCount`, `threads`, `ioWriteBytesToday` theo thành phần (đặt lại 00:00 giờ địa phương theo `tzOffsetMin`), `emmcLife` (`null` kèm lý do), `liveLagP95Ms` (cửa sổ 5 phút), `timeSynced`; role viewer đọc được; không lộ bí mật.
- [ ] T029 [US2] Cài đặt chẩn đoán (FR-009): `core/diagnostics/proc_stats.{hpp,cpp}` (`/proc/self/io`, `fd`, `threads`, `/sys/block/*/stat`, `mmc extcsd` hoặc sysfs `life_time`), bộ đếm ghi theo thành phần (`core/historian`, `core/audit`, `core/tag-engine/retain_store`, log), `liveLagP95Ms` ở `core/session-manager` (đo commit → ghi khung), `server/http/engineering_api.cpp`; T028 xanh.
- [x] T030 [P] [US1] **Test đỏ** cơ chế cảnh báo `system/info.warnings` (FR-010): `server/tests/` thêm ca cho cấu trúc mới (`code`, `message`, `since`, `detail`) và các khóa `update`, `logic`; `apps/studio/src/model/device-adapters.test.ts` đọc cảnh báo lạ không lỗi.
  - **Ghi chú khi làm (2026-10-16):** `server/tests/system_info_011_test.cpp` (4 test: thông điệp tiếng Việt cho mọi mã của contract, `since` giữ suốt đợt cảnh báo, `warnings` vẫn là mảng chuỗi và `warningDetails` cùng thứ tự, khối `update`/`logic` theo cấu hình): **đỏ** (thiếu header); `apps/studio/src/model/device-011.test.ts` (6 ca `deviceSupport`, `warningList`, mã lạ, thiết bị 0.x): **đỏ 6/6**. Quyết định (người dùng giao toàn quyền 2026-10-16): **`warnings` giữ là mảng mã** (Studio 0.8 và trang vận hành đọc chuỗi; đổi kiểu sẽ vỡ tương thích trong bản MINOR 1.5.0), cấu trúc `{code, message, since, detail}` của contract đặt ở mảng song song **`warningDetails`**.
- [x] T031 [US1] Cài đặt hạ tầng cảnh báo (FR-010): `server/http/http_api.cpp`, `server/device_state.hpp`; từng nguồn cảnh báo thêm ở task của story (T049, T116, T137, T140); T030 xanh.
  - **Ghi chú khi làm (2026-10-16):** `server/system_warnings.hpp` (header-only vì `http_api.cpp` biên dịch vào nhiều target test: `warningMessage`, `SystemWarnings` an toàn luồng); `HttpApi::Options` thêm `systemWarnings`, `updateEnabled`, `logicWrites`, `logicPresent`; mã cũ (VIEWER_PUBLIC, HTTPS_DOWN, chứng chỉ, alarm) lấy `since` là lúc HttpApi thấy lần đầu; `main.cpp` nối theo `runtime.json`; Studio `deviceSupport`/`warningList` ở `model/device.ts`. Xanh: x64 61/61 (SystemInfo011, ViewerAccess, WebApi, HttpsApi, Startup), Vitest 6/6; runtime giả lập trả `update`/`logic` đúng.

---

## Phase 3: User Story 1 — Rà soát bảo mật tổng và xử lý mọi phát hiện còn tồn (Priority: P1) 🎯

**Goal**: không còn Medium mở ngoài mục chờ người; công cụ quét sạch; kiểm chứng động.

**Independent Test**: bộ test đơn vị, `web-it`, `device-it`, `driver-it` x64; `ci-local` xanh với bước mới.

### Tests (viết trước, phải ĐỎ; Constitution V)

- [x] T032 [P] [US1] Test `HostPolicy` (SC-002; FR-011, FR-012, FR-013): `server/tests/host_policy_test.cpp` ≥ 16 ca: IP v4/v6, `localhost`, tên máy, `<tên>.local`, `allowedHosts`, tên lạ, cổng, hoa thường, dấu chấm cuối, thiếu `Host` (1.1 và 1.0, loopback), hai `Host`, ký tự điều khiển, dài > 255; HTTP, HTTPS, nâng cấp WebSocket; audit gộp 60 s, `detail.host` ≤ 64 byte; `hostCheck: off` kèm cảnh báo; không áp cho `/device.crt` ngoài quy tắc chung (cũng bị kiểm); `device/identity` có `acceptedHosts`.
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-host):** `server/tests/host_policy_test.cpp`: đỏ (thiếu header) rồi **22/22 đỏ** với bản cài rỗng, **xanh 22/22** (16 ca bảng quyết định + 6 ca trên hai listener thật HTTP/HTTPS, gồm nâng cấp WebSocket); hồi quy 165/165; x64 đầy đủ 4959/4959.
- [x] T033 [P] [US1] Test `LoginGuard` (SC-003; FR-014 đến FR-017): `core/auth/tests/login_guard_test.cpp` ≥ 14 ca: khóa theo cặp (tên, IP) 5 lần/5 phút, nhân đôi tối đa 60 phút, không vĩnh viễn; khóa IP 20 lần; thành công chỉ xóa bộ đếm cặp; tên ở IP B không bị khóa; LRU 4.096; tên NFC; đồng hồ monotonic (nhảy `CLOCK_REALTIME` không ảnh hưởng); `LOGIN_BUSY` khi vượt `maxConcurrentLogins` (luồng); phân tán ≥ 50 lần/10 phút/≥ 5 IP ghi `auth.distributed_attack` một lần/10 phút và không khóa.
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-login):** `login_guard_test` 19 ca: **đỏ 18/19** (bản giả) rồi **xanh 19/19**; `auth_service_test` 13 đỏ rồi 33/33.
- [x] T034 [P] [US1] Test cổng đăng nhập (SC-003): `server/tests/auth_gate_test.cpp`, `web_gate_test.cpp`: 429 `ACCOUNT_LOCKED` kèm `retryAfterS`, 429 `LOGIN_BUSY` kèm `Retry-After`; thông điệp không phân biệt tên không tồn tại; đăng nhập thành công từ IP B trong lúc IP A bị khóa ≤ 2 s; hồi quy 30 ca tấn công của 007 vẫn đạt.
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-login):** `https_api_test` 3 đỏ, `web_api_test` 1, `auth_gate_test` 2, `web_gate_test` 1 rồi xanh 24/24, 25/25, 16/16, 30/30; khóa ở 127.0.0.1 thì cùng tài khoản từ 127.0.0.2 vào < 2 s (Argon2id thật); trả lời khi bị khóa giống hệt cho tên không tồn tại; ca tấn công 007 (A26, WebGate) vẫn đạt.
- [x] T035 [P] [US1] Test CLI tài khoản (FR-017): `server/tests/user_cli_test.cpp`: `--user-unlock <tên>`, `--user-unlock-all` (tệp yêu cầu, runtime đọc ở chu kỳ kế hoặc khởi động lại, audit), mật khẩu mới < 10 ký tự bị từ chối (`--user-add`, `--user-passwd`), tài khoản cũ không bị ép, BOM bỏ.
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-login):** `user_cli_test` 3 đỏ rồi 26/26; `account_store_test` (quyền `users.json`) 1 đỏ rồi 17/17.
- [x] T036 [P] [US1] Test nhật ký xung (SC-004; FR-018 đến FR-020): `core/tag-engine/tests/pulse_journal_test.cpp`, `write_coordinator_test.cpp`: `arm` fsync **trước** khi ghi bit bật (thứ tự quan sát qua driver giả); không ghi được nhật ký ⇒ `FAILED` `PULSE_JOURNAL_FAILED` và 0 lệnh tới driver; `done` sau nhả; hai xung cùng Tag `PULSE_IN_PROGRESS`; khởi động có mục `armed` ⇒ nhả khi kênh nối lại (thử 5 s, tối đa 10 phút), audit `tag.write` nguồn `pulse-recovery`; hết hạn ⇒ `PULSE_STUCK` và giữ mục; `pulseRecovery: off`; `releasePulse` không ngủ (hàng đợi driver đầy ⇒ hẹn lại, không chặn xung ngắn khác quá 100 ms).
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-pulse):** `pulse_journal_test` **đỏ 20/21** (stub) rồi **xanh 22/22**; 2 test mới của `write_coordinator_test` (`PULSE_IN_PROGRESS`, nhả không ngủ: bị chặn ~500 ms) đỏ rồi xanh; `write_coordinator_test` 39/39, `write_extensions_test` 25/25, `write_subsystem_test` 8/8 (2 test tích hợp viết sau khi cài, không có lần đỏ); chạy lặp 10–30 lần không lỗi; armhf qemu xanh.
- [ ] T037 [P] [US1] Test Modbus TCP nhiều unit (SC-005; FR-021, FR-022): `drivers/modbus/tests/modbus_tcp_multiunit_test.cpp` và bản đồ `tools/modbus-sim/maps/gateway-3unit.json` (unit 2 câm theo lệnh điều khiển): Tag unit 1, 3 GOOD ở 100 % của 1.000 chu kỳ; unit 2 BAD sau timeout; kết nối không đóng; phản hồi muộn bị bỏ theo `transactionId` (10.000 ca ngẫu nhiên có hạt cố định); đóng khi lỗi socket, lỗi khung, hoặc ≥ 3 timeout liên tiếp trên ≥ 2 thiết bị; backoff riêng 1 s đến 30 s; RTU qua TCP và RTU nối tiếp giữ hành vi cũ (hồi quy 006).
- [ ] T038 [P] [US1] Test `persist()` (SC-007; FR-023): `core/project-store/tests/deploy_pipeline_test.cpp`: fsync giả 500 ms ⇒ `GET projects/active` p99 ≤ 50 ms; lỗi ghi giả (ENOSPC, chỉ đọc) ⇒ `PERSIST_FAILED` trước kích hoạt và bản cũ chạy; tuần tự hóa theo số thứ tự (bản cũ không ghi đè bản mới); bỏ ghi dư khi trạng thái không đổi.
- [ ] T039 [P] [US1] Test giới hạn kết nối (SC-008; FR-025): `server/tests/conn_limit_test.cpp`: `maxConnPerSource` đếm HTTP, HTTPS, WebSocket chung; vượt ⇒ đóng ngay; 40 TLS im lặng từ một IP không làm đăng nhập từ IP khác chậm > 2 s; một nguồn ≤ 60 % worker với cấu hình mặc định; giải phóng khi đóng; không rò bộ đếm khi lỗi bắt tay.
- [x] T040 [P] [US1] Test cảnh báo SSH (FR-034): `server/tests/ssh_warning_test.cpp`: đọc `sshd_config` và `sshd_config.d/*.conf` (thứ tự, ca đầu thắng của OpenSSH, `Include`), cảnh báo `SSH_ROOT_PASSWORD` khi `PermitRootLogin yes` và `PasswordAuthentication` không `no`; không đọc được ⇒ không cảnh báo; không ghi gì.
  - **Ghi chú khi làm (2026-10-16):** `ssh_warning_test.cpp` 10/13 đỏ (bản rỗng) rồi **13/13 xanh**.
- [ ] T041 [P] [US1] Test các mục Low rẻ (FR-026; D32): Vitest `packages/ui-components/src/control/confirm-dialog.test.ts` (bỏ nhấp 400 ms đầu), `chart/window.test.ts` (đồng hồ lùi > 2 s đặt lại, lùi nhỏ bỏ mẫu), người nghe widget ném lỗi không chặn người sau (`widgets/base.test.ts`), `setInterval` dọn khi gỡ (`screen/mat-screen.test.ts`), `#poll` xử lý 403/5xx (`apps/runtime-web/src/project-store.test.ts`); GoogleTest: quyền `users.json` (cấm group-write và chủ khác root; `core/auth/tests/account_store_test.cpp`), giới hạn độ dài tên trong gói discovery (`server/tests/discovery_server_test.cpp`), độ sâu chuỗi toán tử nhị phân (`core/expression/tests/`), `audit.suppressed` giữ nguồn (`core/audit/tests/`); Rust `open_device_web` chỉ mở `https://<thiết bị đã lưu>` (`apps/studio/src-tauri/src/device/`); phản hồi web có `Referrer-Policy: no-referrer` và `/assets/*.svg` có CSP riêng (`server/http/web_api.cpp`); `logout` hủy phiên phía máy chủ (dùng lại cookie cũ nhận 401, `server/tests/web_gate_test.cpp`).
  - **Ghi chú khi làm (2026-10-16, gd6-websec): phần TypeScript xong**: confirm-dialog bỏ nhấp chuột thật (`detail > 0`) 400 ms đầu (đỏ 3), ChartWindow đặt lại khi đồng hồ lùi > 2 s (đỏ 2), người nghe widget không chặn người sau (đỏ 1), `#poll` (ở `action-host.ts`, không phải `project-store.ts`: 403 ⇒ UNKNOWN `FORBIDDEN`, 10 lần 5xx ⇒ `SERVER_ERROR`; đỏ 5, xanh 45/45); `setInterval` của mat-screen không tái hiện được rò, giữ test hồi quy. **Còn:** các mục C++ (quyền `users.json`, tên discovery, độ sâu biểu thức, `audit.suppressed`), Rust `open_device_web`, `Referrer-Policy`/CSP, `logout` phía máy chủ.

### Implementation

- [x] T042 [US1] `HostPolicy` (FR-011, FR-012, FR-013; R4): `server/host_policy.{hpp,cpp}` (chuẩn hóa, bảng quyết định của contract §1, tên máy lấy lúc khởi động), gắn vào `server/http/http_api.cpp`, `web_api.cpp`, `viewer_gate.cpp`, `engineering_api.cpp` và nâng cấp WebSocket (`server/websocket/`) **trước** mọi xử lý khác; 421 `HOST_NOT_ALLOWED`, 400 `BAD_REQUEST`; audit `access.denied` gộp; `device/identity.acceptedHosts`; cảnh báo `HOST_CHECK_OFF`. T032 xanh.
  - **Ghi chú khi làm (2026-10-16):** `server/host_policy.{hpp,cpp}` (thuần, trong `mat_core`). Quyết định (người dùng giao toàn quyền 2026-10-16): kiểm **một chỗ** ở callback `begin_request` của CivetWeb (`web_contexts.cpp`) thay vì gắn vào từng handler: CivetWeb gọi nó trước khi tìm handler, kể cả nâng cấp WebSocket và đường dẫn không có handler, nên route mới không thể quên kiểm. IPv4 phải dạng thập phân chuẩn (`01.2.3.4` ⇒ coi là tên ⇒ 421); IPv6 trong ngoặc qua `inet_pton`, không thì 400; tên chỉ `[a-z0-9.-_]`, ký tự khác 400; `Host` rỗng như thiếu. 400 cùng dạng thân với 421, kèm `Connection: close`, `no-store`, `nosniff`. Audit `access.denied` cho cả 421 và 400 (`detail {reason:"host", host}` ≤ 64 byte, ký tự không in được thành `?`). `device/identity.acceptedHosts` = `{names:[localhost, tên máy, tên máy.local, …allowedHosts], ips:["*"]}` (`names:["*"]` khi `hostCheck off`); `deploy.sh` nhắc `allowedHosts`. Còn: kiểm trên BL335 (T063), Studio hiện `acceptedHosts` và hướng dẫn khi 421 (T052).
- [x] T043 [US1] Khóa đăng nhập (FR-014 đến FR-016; R5): `core/auth/login_guard.{hpp,cpp}` (cặp, IP, tên-cửa-sổ cho phân tán, LRU), `auth_service.{hpp,cpp}` (giới hạn đồng thời bằng semaphore, `LOGIN_BUSY`), `server/http/auth_gate.cpp` (mã trả lời, `Retry-After`), audit `auth.distributed_attack` (`core/audit/audit_actions.hpp`). T033, T034 xanh; chạy lại `device-it -Scenario auth` và `web-it -Scenario attack`.
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-login):** Quyết định (người dùng giao toàn quyền 2026-10-16): giữ mã **`AUTH_LOCKED`** của 005 (contract ghi "như 005"; Studio, trang, IT đã dùng), không thêm `ACCOUNT_LOCKED`; **`LOGIN_BUSY`** (429, `Retry-After: 1`) thay `AUTH_BUSY`, `maxConcurrentLogins` đếm lần đang chờ hoặc đang băm, lần bị từ chối vì bận không tính sai và không audit (Studio, trang hiểu cả hai mã cho thiết bị cũ); lần sai tính trước khi băm và trả lại khi đúng (tránh tự khóa IP); chỉ tên hợp lệ (ASCII thường, đã là NFC) có bộ đếm cặp; phân tán theo dõi ≤ 256 tên × 64 lần; trạng thái khóa giữ qua execv (`auth-state.json` 1.1.0), mất khi khởi động lại dịch vụ đúng contract.
- [x] T044 [US1] CLI tài khoản (FR-017): `server/cli/users.{hpp,cpp}` (`--user-unlock`, `--user-unlock-all` ghi tệp yêu cầu 0600 vào `<dataDir>/auth-unlock.req`; độ dài mật khẩu ≥ 10 cho tài khoản mới), `core/auth/auth_service.cpp` đọc và xóa tệp yêu cầu mỗi chu kỳ 5 s và khi khởi động; quyền `users.json` (T041). T035 xanh.
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-login):** Quyết định: **mật khẩu mới tối thiểu vẫn là 15** (ADR-011, NIST SP 800-63B-4 khi chỉ dùng mật khẩu; FR-017 chỉ đòi ≥ 10 nên 15 vẫn đạt), tài khoản cũ không bị ép; `--user-unlock <tên>` giữ cơ chế `unlockSeq` (không gỡ khóa IP); `--user-unlock-all` ghi `<dataDir>/auth-unlock.req` (0600, xóa file/symlink cũ, không theo symlink), runtime kiểm 5 s một lần và khi khởi động, audit `account.unlock` target `*`, mã mới `UNLOCK_REQUEST_FAILED`; runtime từ chối `users.json` nhóm ghi được hoặc chủ khác root (mục T041). Còn: ADR-011 và roadmap còn câu "khóa theo tên".
- [x] T045 [US1] Nhật ký xung và nhả khi khởi động (FR-018 đến FR-020; R6) (PATCH 2.0.2 đã chấp thuận 2026-10-16: đóng được khi xong): `core/tag-engine/pulse_journal.{hpp,cpp}` (dòng JSON, `O_APPEND`, `fdatasync`, gọn lại), `write_coordinator.{hpp,cpp}` (`arm` trước ghi bật, `done` sau nhả, `PULSE_JOURNAL_FAILED`, hẹn lại thay vì ngủ), `server/write_subsystem.cpp` và `server/runtime_engine.cpp` (đọc nhật ký lúc khởi động, vòng phục hồi theo kênh, `PULSE_STUCK`), `server/http/tags_api.cpp` (nguồn audit `pulse-recovery`); `docs/deployment/mat-runtime.md` nêu PLC phải tự nhả xung (giới hạn D10). T036 xanh.
  - **Ghi chú khi làm (2026-10-16):** `core/tag-engine/pulse_journal.{hpp,cpp}` (dòng JSON, `O_APPEND` 0600, `fdatasync` mỗi dòng, gọn lại bằng tệp tạm + rename khi khởi động và > 256 dòng); thứ tự audit `started` → `arm` → lệnh bật; `done` ghi trên luồng audit; phục hồi trong `WriteCoordinator` (thử ngay, 5 s một lần, tối đa 10 phút), audit bền trước lệnh nhả, kênh `system`, `detail.source=pulse-recovery`, `detail.pulseOf`. Quyết định (người dùng giao toàn quyền 2026-10-16): Tag không còn trong project ⇒ kẹt ngay; lệnh nhả thất bại khi chạy ⇒ vào vòng phục hồi; xung sau nhả được thì đóng mục kẹt cùng Tag; hàng đợi đầy ⇒ hẹn lại 100 ms, tối đa 5 lần (test 007 sửa theo đồng hồ giả); hai test 007 chỉnh theo `PULSE_IN_PROGRESS`. Tài liệu ở mục 5h (giới hạn D10). Còn mở: kịch bản `kill -9` (T054), `--check-data` đọc nhật ký (T069), chip Studio (T052).
- [ ] T046 [US1] Cô lập timeout đa unit (FR-021, FR-022; R7): `drivers/modbus/modbus_tcp_driver.{hpp,cpp}` (bảng yêu cầu đang chờ theo `transactionId`, bỏ phản hồi muộn, bộ đếm timeout liên tiếp theo thiết bị và toàn kênh), `drivers/sdk/{backoff,scheduler}.cpp` (backoff riêng thiết bị, không làm chậm thiết bị khác), `tools/modbus-sim/` (unit câm, trả muộn có kiểm soát). T037 xanh; chạy lại `driver-it` các kịch bản `unplug`, `faults`, `merge`, `split`, `read` (hồi quy 006).
- [ ] T047 [US1] `persist()` (FR-023; R8): `core/project-store/deploy_pipeline.cpp` (sao chụp dưới mutex, ghi và fsync ngoài mutex, khóa ghi riêng và số thứ tự, `PERSIST_FAILED`, bỏ ghi dư), `core/project-store/store.cpp` nếu liên quan. T038 xanh; `device-it -Scenario kill` (24 vòng) vẫn đạt.
- [ ] T048 [US1] Giới hạn kết nối theo nguồn (FR-025; R10): `server/http/conn_limit.{hpp,cpp}` (đếm theo IP trong `init_connection` của CivetWeb `civetweb_runtime`, giải phóng ở `connection_close`; mặc định 24), nối vào `server/web_contexts.cpp` và `server/websocket/`; ghi trong `third_party/LICENSES.md` nếu cần bản vá CivetWeb mới (đánh dấu "mAT patch 5"). T039 xanh.
- [ ] T049 [US1] Cảnh báo SSH và các cảnh báo mới (FR-010, FR-034): `server/ssh_audit.{hpp,cpp}` (đọc chỉ-đọc), nối `system/info.warnings` ở `server/http/http_api.cpp`: `HOST_CHECK_OFF`, `SSH_ROOT_PASSWORD`, `PULSE_STUCK`, `TIME_NOT_SYNCED`. T040, T030 xanh.
  - **Ghi chú khi làm (2026-10-16, gd6-host): `SSH_ROOT_PASSWORD` và `HOST_CHECK_OFF` xong** (`server/ssh_audit.{hpp,cpp}` đọc theo luật OpenSSH: `sshd_config.d` chỉ khi có `Include`, dòng trong `Match` không tính, đọc lúc khởi động và 10 phút một lần; giới hạn: `Match User root` không xét, `KbdInteractiveAuthentication` không xét); `PULSE_STUCK` có từ gd6-pulse. **Còn:** `TIME_NOT_SYNCED`.
- [ ] T050 [US1] Các mục Low rẻ (FR-026; D32): sửa theo T041 ở `packages/ui-components/src/{control/confirm-dialog,chart/window,widgets/base,screen/mat-screen}.ts`, `apps/runtime-web/src/project-store.ts`, `core/auth/account_store.cpp`, `server/discovery/`, `core/expression/`, `core/audit/`, `apps/studio/src-tauri/src/device/`, `server/http/web_api.cpp`; mục Low không sửa ghi "hạn chế có chủ ý" ở plan (bảng truy vết). T041 xanh.
- [ ] T051 [US1] `deploy.sh` và tài liệu triển khai (FR-013, FR-033, FR-067 phần nhắc): `deployment/device/deploy.sh` in lời nhắc `allowedHosts`, mật khẩu ≥ 10, cảnh báo SSH khi `PermitRootLogin yes`; `deployment/device/tests/` cập nhật; `docs/deployment/mat-runtime.md` mục 5e (Host, khóa, xung, đa unit, giới hạn kết nối).
- [ ] T052 [P] [US1] Studio: cảnh báo (FR-036; FR-013): `apps/studio/src/ui/mat-statusbar.ts`, `apps/studio/src/ui/editors/device-page.ts` hiện chip cho mã cảnh báo mới kèm hướng dẫn hành động và danh sách `acceptedHosts`; Bảng theo dõi hiện chip `PULSE_STUCK`; test `mat-statusbar-006.test.ts`, `device-page-online.test.ts` mở rộng (đỏ rồi xanh).

### Chứng cứ động, công cụ rà soát, báo cáo

- [ ] T053 [P] [US1] `web-it` kịch bản `host-rebind` và `lockout-dos` (SC-002, SC-003): `tools/web-it.ps1`, `tests/web-it/host-rebind.mjs` (DNS thử trong mạng Docker trả IP của runtime cho `evil.test`; Chrome headless đọc `fetch` ⇒ 421; IP, tên trong `allowedHosts` ⇒ 200), `lockout-dos.mjs` (1.000 lần sai từ IP A bị chặn ≤ 20 lần; người dùng IP B vào ≤ 2 s); kết quả `docs/reports/011-host-x64.json`, `011-lockout-x64.json`.
- [ ] T054 [P] [US1] `driver-it` và `device-it` kịch bản mới (SC-004, SC-005, SC-006, SC-007): `tools/driver-it.ps1` `gateway-multiunit` (1.000 chu kỳ), `pulse-recovery` (20 vòng `kill -9` giữa xung và 20 vòng nhật ký không ghi được); `tools/device-it.ps1` `persist-slow`, `deploy-extra-file` (30 lần nạp xuống không `HEALTH_TIMEOUT`); kết quả `docs/reports/011-gateway-x64.json`, `011-pulse-x64.json`, `011-persist-x64.json`, `011-extra-file-x64.json`.
- [ ] T055 [P] [US1] SAST (FR-028; D15): `tools/sast/{cppcheck.cfg,clang-tidy.yaml,run.ps1,suppressions.txt}`; thêm công cụ vào `deployment/toolchain/Dockerfile` nếu thiếu (T011); chạy trên `core/`, `server/`, `drivers/`; mỗi phát hiện error/warning bảo mật phân loại (sửa, ngoại lệ có lý do ngay trong mã, dương tính giả) ghi `docs/reports/011-sast.md`; SC-009.
- [ ] T056 🌐 [US1] Kiểm phụ thuộc (FR-027; SC-009): `cargo audit` (cho `apps/studio/src-tauri/Cargo.lock`), `npm audit` và `npm audit --omit=dev`, tra CVE cho CivetWeb 1.16, Mbed TLS 3.6.7, SQLite 3.54.0, miniz 3.1.2, argon2 20190702, nlohmann 3.11.3, valijson 1.0.3 (NVD, GitHub advisories); kết quả `docs/reports/011-audit-cargo.json`, `011-audit-npm.json`, bảng CVE trong `third_party/LICENSES.md` kèm ngày tra cứu; Critical/High phải sửa hoặc có chấp nhận ghi lý do. Không có mạng: ghi "BỎ QUA: không có mạng" và để task mở.
- [ ] T057 [P] [US1] Rà license (FR-027; D16): `tools/release/license-report.mjs` + `license-report.test.mjs` (đỏ rồi xanh): đọc `package-lock.json` (và `node_modules/*/package.json` cho `license`), `Cargo.lock` kèm `cargo metadata` (nếu có `cargo`), `third_party/LICENSES.md`; từ chối GPL/AGPL/LGPL link tĩnh và license không rõ; xuất `licenses.md`; chạy một lần và đưa kết quả vào `docs/reports/011-license.md`; cập nhật `third_party/LICENSES.md`.
- [ ] T058 [P] [US1] Mục tiêu fuzz và kho mầm (FR-029; SC-009): `tools/fuzz/` (bộ sinh tất định hạt cố định hoặc libFuzzer nếu clang trong container hỗ trợ `-fsanitize=fuzzer`): trình đọc gói `.matscada`, parser project JSON, bộ lọc SVG (TS), parser biểu thức; mục tiêu cho `.matupdate` (T118), parser `logic.json` (T142) và lệnh SVG (T165) thêm ở task của story; kho mầm `tests/fuzz-corpus/` (nhỏ, có mã băm); chạy mỗi mục tiêu ≥ 1 giờ ở x64 ASan + UBSan (`tools/fuzz/run.ps1 -Seconds 3600`), ghi `docs/reports/011-fuzz-x64.json`.
- [ ] T059 [US1] `ci-local.ps1` (FR-030; SC-042): chạy trọn và sửa phát hiện của bước `ctest` đầy đủ dưới ASan + UBSan (nợ từ 006); thêm các bước `audit` (T056, bỏ qua có thông báo khi không mạng), `sast` (T055), `docs-check` (T177), `update-it` và `logic-it` khi có; bước không chạy được in "BỎ QUA: lý do", không báo xanh; ghi giờ từng bước; `tools/ci-local.ps1`, `.github/workflows/ci.yml` nếu có tương ứng.
- [ ] T060 [P] [US1] Mô hình mối đe dọa (FR-031): `docs/architecture/threat-model.md`: giao diện (HTTP, HTTPS, WebSocket, UDP discovery, CLI root, gói `.matscada`, file project, cổng serial, DB ngoài, Tauri IPC, OTA, logic), tài sản, kẻ tấn công (LAN, Internet qua port-forward, máy kỹ sư bị chiếm, thiết bị trường độc hại), biện pháp, rủi ro còn lại; mỗi phát hiện Medium trở lên ánh xạ một dòng (ID của plan).
- [ ] T061 [P] [US1] Hướng dẫn gia cố thiết bị (FR-033): `docs/deployment/hardening.md`: SSH chỉ khóa công khai và `PermitRootLogin prohibit-password`, đóng port-forward 9080 và 22, VPN, `nft` `ct count` theo nguồn (kèm bộ luật mẫu), `viewerLogin: required` khi ra ngoài LAN, IP tĩnh, NTP, quyền tập tin, khuyến nghị bàn thử.
- [ ] T062 [US1] Review bảo mật lần 1 (FR-032): chạy agent `agent-protocols:security-auditor` và `agent-protocols:code-reviewer` trên `git diff <mốc 007 = 634d528>..HEAD -- core server drivers apps packages deployment tools` kèm bằng chứng T053, T054; ghi `docs/reports/011-security-review.md` (bảng nguồn, mức, xử lý, bằng chứng); sửa mọi Critical/High; Medium sửa hoặc đưa vào bảng chờ người. Lần hai ở T202.
- [ ] T063 ⚠️🔌 [US1] BL335: đo giới hạn kết nối và kiểm Host trên thiết bị thật (SC-008): cài runtime 1.0.0-rc theo `docs/deployment/mat-runtime.md` (chờ SSH và người dùng cho phép; mọi thay đổi ghi `device-changes.md`); 40 kết nối TLS im lặng từ một máy, đăng nhập từ máy khác ≤ 2 s; RAM (`/proc/<pid>/status`) tăng ≤ 1 MB; `curl -H 'Host: evil.test'` ⇒ 421, bằng IP ⇒ 200; `system/info.warnings` có `SSH_ROOT_PASSWORD` nếu đúng; ghi `docs/reports/011-security-bl335.json`.
- [ ] T064 ⚠️🔌 [US1] **Chờ người dùng đồng ý và ở cạnh:** gia cố BL335 theo `hardening.md` (SSH khóa công khai, tắt mật khẩu root, đóng port-forward 9080, bộ luật `nft`): thử đăng nhập SSH bằng khóa **trước** khi tắt mật khẩu và giữ một phiên SSH mở; ghi `device-changes.md` kèm cách hoàn tác; sau OTA đạt kiểm (T122) mới đề nghị. Không tự làm. (FR-033)
- [ ] T065 [US1] Bảng truy vết "Phát hiện tồn" (FR-035; SC-001): hoàn thiện bảng ở `plan.md` (mỗi dòng: ID, nguồn, mức, xử lý, task, test hoặc bằng chứng, trạng thái); đối chiếu `005-acceptance.md` §9, `006-acceptance.md` §12, `007-security-review.md` §2; cập nhật các báo cáo cũ bằng ghi chú trỏ sang `011-security-review.md` (chỉ thêm một dòng "Cập nhật 011", không sửa nội dung cũ).

### Phát hiện tồn từ rà soát bảo mật 008 (nguồn: [`docs/reports/008-security-review.md`](../../docs/reports/008-security-review.md); thêm sau 008, chưa sửa ở 008)

- [ ] T209 [US1] F5 (Medium): `minRole` của sự kiện SVG chỉ là khóa giao diện, máy chủ chỉ đòi `operator` ([báo cáo F5](../../docs/reports/008-security-review.md)). Làm: nêu rõ trong inspector "Sự kiện" và tài liệu rằng `minRole` không phải phân quyền; thêm `writeMinRole` theo Tag, validator TS và C++ nhận, máy chủ kiểm ở API ghi (`core/auth/`, `server/http/`); test `web-it` (operator `POST` ghi Tag `writeMinRole: engineer` bị 403).
- [ ] T210 [US1] F6 (Medium, giới hạn đã chấp nhận D30): runtime C++ không parse SVG nên không từ chối gói có SVG độc ([báo cáo F6](../../docs/reports/008-security-review.md)). Làm: quyết định giữ hay thêm bước lọc/từ chối SVG ở nạp gói (`core/package/`, `core/project-store/`); nếu giữ, ghi vào `threat-model.md` (T060) và `hardening.md` (T061) và chạy lại `page-path-harness`, `page-fuzz` làm chứng cứ.
- [x] T211 [P] [US1] F7 (Low): `packages/svg-renderer/src/css-value.ts` `parseDataImage` từ chối ảnh data > 16 triệu điểm ảnh (đọc IHDR/GIF/VP8X); test PNG 20.000² xám ([báo cáo F7](../../docs/reports/008-security-review.md)).
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-websec):** `parseDataImage` đọc kích thước PNG IHDR, GIF, WebP VP8X/VP8/VP8L, JPEG SOFn (256 KiB đầu; SOF sau đó ⇒ từ chối); test `hardening-011.test.ts` (PNG 20.000², biên 4000²) đỏ rồi xanh.
- [x] T212 [P] [US1] F8 (Low): `packages/svg-renderer/src/sanitize.ts` dùng `Map` hoặc `Object.create(null)` thay `removedElements = {}`; test `<__proto__/>`, `<constructor/>` ([báo cáo F8](../../docs/reports/008-security-review.md)).
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-websec):** `removedElements`, `codes` dùng `Object.create(null)`; `namespaceLabel` tra bằng Map (URI `constructor` từng trả hàm).
- [x] T213 [P] [US1] F9 (Low): `packages/svg-import/src/match.ts` bước 1 đòi xác nhận khi D > 0,05 hoặc phần tử có sự kiện ghi; test UID lạ ở gần/xa ([báo cáo F9](../../docs/reports/008-security-review.md)).
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-websec):** bước 1 chỉ tự khớp khi D ≤ 0,05 và phần tử cũ không có sự kiện ghi, còn lại thành "cần chọn" (UID luôn trong danh sách ứng viên); đỏ 4, xanh 34/34; contract svg-import §7 cập nhật. Hạn chế có chủ ý: bước 2, 3 giữ ngưỡng cũ (F9 chỉ nói bước 1).
- [x] T214 [P] [US1] F10 (Low): `packages/binding-engine/src/transforms.ts` `COLOR` dùng `isColor` của svg-renderer, bỏ regex; mở rộng `no-regex.test.ts` sang binding-engine ([báo cáo F10](../../docs/reports/008-security-review.md)).
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-websec):** màu binding qua `isColor` (loại `inherit`); `no-regex.test.ts` quét toàn binding-engine, đỏ ở `transforms.ts` rồi xanh.
- [x] T215 [P] [US1] F11 (Low): `apps/studio/src/model/svg-upgrade.ts` luôn ghi lại bằng bộ ghi tất định hoặc từ chối `DOCTYPE` ở `parseSvg`; test project 0.3 có `<!DOCTYPE … <!ATTLIST rect onclick …>` ([báo cáo F11](../../docs/reports/008-security-review.md)).
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-websec):** nâng cấp 0.1–0.3 bỏ DOCTYPE/PI bằng `prescan` rồi ghi lại (mã `R_DTD`, hộp thoại nêu "khai báo DOCTYPE"); DTD có entity lạ ⇒ để nguyên và validator báo `E_SVG_UNSAFE`; Studio đỏ 2, xanh 6/6.
- [x] T216 [P] [US1] F12 (Low): `packages/svg-renderer/src/sanitize.ts` `parseSvg` từ chối chuỗi chứa `<!DOCTYPE`/`<!ENTITY`; chạy lại `m14`, `m42` ([báo cáo F12](../../docs/reports/008-security-review.md)).
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-websec):** `parseSvg` từ chối `<!DOCTYPE` ở phần mở đầu (không phân biệt hoa thường); page-path harness trên Chrome 64 ca đạt (m14, m42, p03 bị từ chối ở bước parse), malicious harness 48 ca đạt; `rules-04-svg.ts` báo `E_SVG_UNSAFE`.
- [x] T217 [P] [US1] F13 (Low): `packages/svg-import/src/name.ts` `cleanName` và `css-value.ts` `isName` bỏ U+202A–202E, U+2066–2069, U+200B–200F; test `inkscape:label` có ký tự điều khiển hai chiều ([báo cáo F13](../../docs/reports/008-security-review.md)).
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-websec):** `cleanName` và `isName` bỏ U+200B–200F, U+202A–202E, U+2066–2069; test `inkscape:label` có U+202E. Thay đổi hành vi: `data-mat-name` cũ chứa ký tự hướng bị gỡ (`R_VALUE_INVALID`).
- [x] T218 [P] [US1] F14 (Low): `packages/binding-engine/src/applier.ts` id clipPath `mat-clip-<uid>` không đụng id của SVG: bỏ id bắt đầu `mat-` khi nhập hoặc kiểm trùng khi sinh ([báo cáo F14](../../docs/reports/008-security-review.md)).
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-websec):** `ensureClip` chọn id trống `mat-clip-<uid>`, `-2`, `-3`… trong cây gốc.
- [x] T219 [P] [US1] F15 (Low): `apps/studio/src-tauri/src/csv.rs` `csv_save` đặt trần `text` (ví dụ 32 MiB) và tiền tố `'` cho ô bắt đầu bằng `=`, `+`, `-`, `@`; `cargo test --lib` ([báo cáo F15](../../docs/reports/008-security-review.md)).
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-websec):** trần 32 MiB mọi đuôi; CSV tách ô RFC 4180, tự nhận dấu phân cách, tiền tố ' cho `= + - @` trừ ô là số; `cargo test --lib` 149. Hạn chế có chủ ý: nhập lại CSV vào Studio đọc cả dấu '; contract tauri-commands-006 §6 chưa cập nhật.
- [x] T220 [P] [US1] F16 (Low): `tools/svg-fixtures/make-malicious.mjs` đưa `m39`–`m47` vào bộ sinh để `--check` phủ đủ ([báo cáo F16](../../docs/reports/008-security-review.md)).
  - **Ghi chú khi làm (2026-10-16, nhánh gd6-websec):** m39–m47 dựng bằng bộ sinh, đúng từng byte bản đã commit; `--check` báo cả tệp viết tay ngoài bộ sinh: đỏ 18 tệp lệch, xanh 48 ca.

**Checkpoint**: US1 xong về mã và x64; BL335 (T063, T064) chờ người.

---

## Phase 4: User Story 2 — Tải, soak 7 ngày và mất điện 100 lần trên BL335 (Priority: P1)

**Goal**: bộ công cụ đo và số đo thật; x64 trước, BL335 sau.

**Independent Test**: công cụ có test với dữ liệu giả; tiền kiểm x64; phần BL335 là ⚠️🔌.

### Tests (viết trước, phải ĐỎ)

- [ ] T066 [P] [US2] Test `--check-data` (FR-040): `server/tests/check_data_test.cpp`: dữ liệu sạch ⇒ mã 0; `history.db` cắt ngang ⇒ 2; `-wal` cần phục hồi ⇒ 1; digest project khác `state.json` ⇒ 2; `retain/` hỏng ⇒ 2; `pulse.journal` có mục ⇒ 1; chỉ đọc (không đổi mtime, không tạo tệp); ≤ 30 s với DB 500 MB giả; đầu ra JSON theo schema.
- [ ] T067 [P] [US2] Test bộ lấy mẫu và phân tích (FR-037; SC-013): `tools/soak/mat-sample.test.mjs` (cây `/proc` giả qua biến `MAT_PROC_ROOT`: một dòng JSON/phút, quay vòng 8 tệp × 1 MiB, không ghi ngoài `/run/mat-sample`); `tools/soak/analyze.test.mjs` (dữ liệu tổng hợp: rò 1 MB/ngày ⇒ vượt; phẳng ⇒ đạt; khởi động lại ⇒ phát hiện qua `boot`; ghi đĩa/ngày; FD tăng 6 % ⇒ vượt; fixture `extcsd-*.txt`).
- [ ] T068 [P] [US2] Test bộ điều khiển nguồn (FR-041): `tools/powercut/powercut.test.mjs` với thiết bị giả (HTTP Tasmota, tty giả, chế độ tay): chu trình cắt/chờ/cấp/chờ `READY`/kiểm; vòng có chủ đích bắt sự kiện từ nhật ký giả; ghi JSON từng vòng; dừng khi lỗi và giữ trạng thái.

### Implementation

- [ ] T069 [US2] `mat-runtime --check-data` (FR-040): `server/cli/check_data.{hpp,cpp}`, `server/main.cpp`; dùng `PRAGMA quick_check` ở chế độ chỉ đọc, đọc `state.json`, `retain/`, `pulse.journal`, `logic-state.json`. T066 xanh.
- [ ] T070 [P] [US2] Bộ lấy mẫu `deployment/device/mat-sample.sh` (FR-037) và `tools/soak/{collect.ps1,analyze.mjs}`: theo contract test-protocols §2; `package-runtime.ps1` đưa script vào gói (thêm ở T100 cùng `mat-update-verify`); T067 xanh.
- [ ] T071 [P] [US2] Mở rộng `tools/load-tester` (FR-038; Go): cờ `--tags 500|1000`, `--clients 10 --extra 1` (client 11), `--flap 50`, `--latency`; `tests/web-it/f5-storm.mjs` (10 Chrome headless F5 đồng loạt 50 vòng, màn hình 250 item); `tests/web-it/svg-load.mjs` (300 đến 500 phần tử); JSON theo mẫu `docs/reports/011-load.md`; `go test`, `gofmt`, `go vet` xanh.
- [ ] T072 [P] [US2] Project đo (FR-038, FR-039): `tools/gen-bench-projects.mjs` sinh `projects/bench-1000/` (1.000 Tag) và `projects/soak-standard/` (500 Tag, lưu trữ 200 Tag theo thay đổi, 3 màn hình, logic mẫu khi có T141); kiểm bằng validator; không commit dữ liệu sinh lớn (sinh lúc chạy).
- [ ] T073 [P] [US2] `tools/powercut/powercut.mjs` (FR-041, FR-042): trình điều khiển Tasmota (HTTP), rơ-le USB (serial, lệnh cấu hình được), chế độ tay; chu trình 6 bước của contract §4; đối chiếu `requestId` với `--export-audit`; ghi `docs/reports/011-powercut-<x64|bl335>.json`; T068 xanh.
- [ ] T074 [P] [US2] `tools/powercut/x64-kill.ps1` (FR-043; D14): `docker kill -s KILL` 100 vòng (ngẫu nhiên và theo điểm D1, D3, D4, D5) kèm `--check-data` và đối chiếu audit; ghi hạn chế (không mô phỏng mất dữ liệu chưa fsync).

### Chạy x64 (tự động, không cần người)

- [ ] T075 [US2] Tải x64 rút gọn (FR-044; SC-011 phần x64): L1 (1 giờ), L3, L4 (50 vòng, Chrome headless), L5, L8 trong Docker; `docs/reports/011-load-x64.json`; mục chưa đo ghi rõ; phần x64 của `docs/reports/011-load.md`.
- [ ] T076 [US2] Soak gia tốc x64 S0 24 giờ (FR-039): tải L1 rút gọn, `kill -9` mỗi 30 phút, nạp xuống mỗi 2 giờ, `mat-sample` trong container; `analyze.mjs`; `docs/reports/011-soak-x64.json`; phần x64 của `011-soak.md`. Chạy nền, dùng `run_in_background`.
- [ ] T077 [US2] Tiền kiểm mất điện x64 (FR-043; SC-014): chạy T074 (100 vòng + 5 điểm × 10); `docs/reports/011-powercut-x64.json`; phần x64 của `011-powercut.md` nêu rõ hạn chế.
- [ ] T078 [US2] Cắt mạng x64 (FR-038, L6; SC-015): 50 lần ngắt/nối mạng Docker với 10 client; `docs/reports/011-flap-x64.json`.

### Chạy trên BL335 (⚠️🔌)

- [ ] T079 ⚠️🔌 [US2] BL335: cài runtime 1.0.0-rc và `mat-sample` (chờ SSH và người dùng cho phép); tải L1 (4 giờ), L3, L4 (50 vòng), L5, L8; ghi `docs/reports/011-load-bl335.json`; cập nhật `011-load.md` (SC-011).
- [ ] T080 ⚠️🔌 [US2] BL335: L2 (1.000 Tag, 10 client, 1 giờ; SC-012): ghi CPU, RSS; không đạt ≤ 50 % thì báo giới hạn và phương án trong `011-load.md`.
- [ ] T081 ⚠️🔌 [US2] BL335: soak S1 7 ngày liên tục (SC-013; D13): cài project `soak-standard`, `load-tester` 10 client và giả lập Modbus ở máy khác, `collect.ps1` mỗi giờ; phân tích `analyze.mjs`; `docs/reports/011-soak-bl335.json`, `011-soak.md`. Gián đoạn do mất điện phòng thì chạy lại từ đầu (quy tắc §2 contract).
- [ ] T082 ⚠️🔌 [US2] BL335: tuổi thọ eMMC (FR-045; SC-016; D30): đọc `EXT_CSD` đầu và cuối soak, phân thành phần ghi; **cần người cung cấp datasheet của chip eMMC** (TBW hoặc số chu kỳ P/E); tính theo công thức §3; thiếu datasheet thì ghi "chưa tính được tuổi thọ tuyệt đối" vào `011-soak.md`.
- [ ] T083 ⚠️🔌 [US2] **Cần người:** lắp bộ điều khiển nguồn (ổ cắm Tasmota hoặc rơ-le USB) cho BL335, thử khô (cắt/cấp 5 lần có mặt), xác nhận không gây hỏng nguồn; ghi vào `device-changes.md`. (FR-041)
- [ ] T084 ⚠️🔌 [US2] BL335: mất điện 100 vòng ngẫu nhiên (SC-014; FR-041): `powercut.mjs`; `docs/reports/011-powercut-bl335.json`; mọi vòng hỏng giữ nguyên trạng thái để điều tra.
- [ ] T085 ⚠️🔌 [US2] BL335: mất điện có chủ đích D1 (nạp xuống), D3 (ghi lịch sử dày), D4 (xung), D5 (logic, sau T139) ≥ 10 vòng mỗi điểm; D2 (OTA) làm ở T123 sau khi có OTA; cập nhật `011-powercut.md`. (FR-041, SC-014)
- [ ] T086 ⚠️🔌 [US2] BL335: cắt mạng 50 lần với 10 client thật (L6; SC-015) bằng cổng switch hoặc `ip link` (người thao tác); `docs/reports/011-flap-bl335.json`.
- [ ] T087 [US2] Báo cáo `docs/reports/011-load.md`, `011-soak.md`, `011-powercut.md` (FR-044, FR-046): mỗi chỉ tiêu ngân sách (Master Plan §6) Đạt, Không đạt kèm báo cáo giới hạn và phương án, hoặc Chưa đo; ghi vào ADR-005 một dòng "Cập nhật 011" trỏ báo cáo (chỉ thêm).

**Checkpoint**: US2 x64 xong; BL335 (T079 đến T086) chờ SSH, 7 ngày thiết bị, bộ điều khiển nguồn, datasheet.

---

## Phase 5: User Story 3 — Bộ cài Studio có chữ ký số và gói phát hành tin cậy được (Priority: P1)

**Goal**: quy trình ký Authenticode và chữ ký phát hành kiểm được bằng chứng chỉ thử; chứng chỉ thật là việc người.

**Independent Test**: bộ cài thật ký bằng chứng chỉ thử; 12 ca hỏng; cổng `-Release`.

### Tests (viết trước, phải ĐỎ)

- [ ] T088 [P] [US3] Test công cụ ký (SC-017; FR-048 đến FR-051): `tools/release/sign.test.mjs`, `gate.test.mjs`, `verify-release.test.mjs` (`node --test`, gọi PowerShell): ba chế độ `sign.ps1`; 8 điều kiện từ chối của cổng `-Release` (chứng chỉ `TEST`, tự ký, hết hạn/≤ 30 ngày, thiếu EKU, khóa yếu, thiếu dấu thời gian, không kiểm lại được, cây git bẩn); 12 ca hỏng của `verify-release.ps1`; bí mật không có trong log.
- [ ] T089 [P] [US3] Test SBOM (FR-052; SC-018): `tools/release/sbom.test.mjs`: CycloneDX 1.5 tối thiểu (`bomFormat`, `specVersion`, `serialNumber`, `metadata`, `components[]` có `name`, `version`, `purl`, `licenses`), 100 % gói của `package-lock.json` và `Cargo.lock` có mặt (đếm), `third_party` có mặt, id ổn định giữa hai lần chạy (cùng đầu vào cùng đầu ra trừ `serialNumber` và `timestamp`).
- [ ] T090 [P] [US3] Test phong bì và chữ ký (FR-057, FR-061, FR-069; SC-020): `core/update/tests/envelope_test.cpp`, `signature_test.cpp`: phong bì tar đúng, ba thành viên đúng thứ tự, tiêu đề lạ (`x`, `g`, `L`), kích thước vượt, thành viên thứ tư, cắt ngang, tổng kiểm tiêu đề sai; chữ ký ECDSA P-256 DER đúng/sai/khóa lạ; `SHA256SUMS` + `.sig`; không đọc quá kích thước cố định (ASan); mã thoát của `mat-update-verify` (0, 3, 4, 5).

### Implementation

- [ ] T091 [P] [US3] `tools/release/make-test-cert.ps1` (FR-050): tạo và gỡ (`-Remove`) chứng chỉ thử trong `Cert:\CurrentUser\My`, không đụng kho tin cậy.
- [ ] T092 [US3] `tools/release/sign.ps1` (FR-047, FR-048): chế độ `store`, `command`, `test`; in dấu vân tay, chủ thể, hạn, URL dấu thời gian; ghi `signing-log.json`; thử ba URL từ `tools/release/timestamp-urls.json`; bí mật chỉ qua trình điều khiển token hoặc biến môi trường. Phần ký của T088 xanh.
- [ ] T093 [US3] Tauri ký (FR-047; T010): `apps/studio/src-tauri/tauri.conf.json` `bundle.windows.signCommand` gọi `sign.ps1`; dựng bộ cài thử bằng chứng chỉ thử; `mat-studio.exe`, setup, `uninstall.exe` đều có chữ ký `NotTrusted` đúng dấu vân tay (SC-017).
- [ ] T094 [US3] `tools/release/verify-release.ps1` (FR-051): kiểm chữ ký Authenticode, `SHA256SUMS` và chữ ký, SBOM, danh sách tệp; 12 ca hỏng; T088 xanh.
- [ ] T095 [P] [US3] `tools/release/sbom.mjs` (FR-052; D16) từ `package-lock.json`, `Cargo.lock`, `third_party/LICENSES.md`; T089 xanh.
- [ ] T096 [US3] Thư viện `core/update/` và tệp `mat-update-verify` (FR-057, FR-061, FR-069; T008): `core/update/{envelope,signature,manifest,paths}.{hpp,cpp}`, `server/updater/verify_main.cpp`, `CMakeLists.txt` (target tĩnh nhỏ, link Mbed TLS), armhf; dùng chung cho `mat-updater`, `deploy.sh`, `release.ps1`. T090 xanh; fuzz mục tiêu ở T118.
- [ ] T097 [P] [US3] Khóa phát hành (FR-053): `tools/release/keygen.ps1` (hướng dẫn sinh bằng `openssl ecparam -name prime256v1`, trong container), `tools/release/sign-sums.ps1` (ký `SHA256SUMS` bằng khóa người phát hành qua `openssl dgst`), `deployment/keys/README.md` (nơi đặt `release-primary.pub.pem`, `release-backup.pub.pem`; **khóa công khai thật do người cung cấp ở T102**), từ chối khóa nằm trong danh sách khóa thử.
- [ ] T098 [US3] `tools/release/release.ps1` (FR-052, FR-055; contract §7): 9 bước, cổng `-Release`, `build-info.json` (`releaseSeq` từ `release/releaseSeq.txt`), `RELEASE-NOTES.md` từ `docs/release/notes/<ver>.md`, đồng nhất phiên bản ở `package.json`, `tauri.conf.json`, `Cargo.toml`, `CMakeLists.txt`.
- [ ] T099 [P] [US3] Tài liệu phát hành (FR-054, FR-055): `docs/release/signing.md` (loại chứng chỉ OV/EV và quy định khóa phần cứng, nơi mua và chi phí tham khảo là việc người, máy ký, quy trình, dấu thời gian, gia hạn, thu hồi, lộ khóa, hạn chế SmartScreen), `docs/release/process.md` (checklist phát hành), `docs/release/incident-keys.md` (quy trình khi lộ khóa).
- [ ] T100 [US3] `deploy.sh` kiểm chữ ký (FR-067): `deployment/device/deploy.sh` kiểm `SHA256SUMS.sig` bằng `mat-update-verify` khi có (cảnh báo, không chặn, khi thiếu để giữ đường khôi phục), cài `mat-update-verify` vào `/usr/lib/mat-updater/`, cài khóa công khai vào `/etc/mat-runtime/trusted-keys/` (root, 0644) nếu thư mục chưa có khóa, `deployment/package-runtime.ps1` đưa các tệp vào gói; `deployment/device/tests/` cập nhật.
- [ ] T101 [US3] Studio hiện trạng thái chữ ký (FR-056): lệnh Tauri chỉ-đọc `app_signature` (`apps/studio/src-tauri/src/lib.rs`, `apps/studio/src-tauri/src/signature.rs`): chạy cố định `powershell -NoProfile -NonInteractive -Command Get-AuthenticodeSignature -LiteralPath <đường dẫn exe của chính nó>` (đối số cố định, không nhận chuỗi từ giao diện), phân tích JSON; giao diện "Giới thiệu" hiện người ký và dấu vân tay hoặc "chưa ký (bản dựng nội bộ)"; test Rust (đầu ra giả) và Vitest; allowlist Tauri cập nhật tối thiểu.
- [ ] T102 [P] [US3] Chạy thử toàn bộ quy trình (SC-017, SC-018): `release.ps1` (không `-Release`) bằng chứng chỉ thử và khóa thử; `verify-release.ps1`; `docs/reports/011-release-dryrun.md` (thời gian, kích thước, kết quả 12 ca hỏng, SBOM); `release.ps1 -Release` bị cổng từ chối ở cả 8 điều kiện (chạy bằng `gate.test.mjs`).
- [ ] T103 ⚠️🔌 [US3] **Cần người/công ty:** quyết định và mua chứng chỉ ký mã (OV hoặc EV, khóa trên token hoặc dịch vụ ký đám mây theo quy định CA/Browser Forum); cung cấp máy ký (hoặc tài khoản dịch vụ ký), dấu vân tay và URL dấu thời gian; sinh **hai** khóa ECDSA phát hành ngoại tuyến (T097) và đưa khóa công khai vào `deployment/keys/`; ghi vào `docs/release/signing.md` mục "Hiện trạng". Chặn T104, T105. (FR-053, FR-054)
- [ ] T104 ⚠️🔌 [US3] Ký bản rc đầu bằng chứng chỉ thật (SC-017): `release.ps1 -Release` trên máy ký; kiểm `Get-AuthenticodeSignature` `Valid` và `signtool verify /pa`; lưu `release/<ver>/`.
- [ ] T105 ⚠️🔌 [US3] Cài thử trên Windows 10 (1809 trở lên) và 11 sạch (máy thật hoặc ảo, offline; SC-019; contract release-signing §9): ghi `winver`, UAC, tên nhà phát hành, SmartScreen (nguyên văn, kèm ảnh chụp ngoài repo hoặc mô tả), dấu vân tay, gỡ cài đặt sạch; `docs/reports/011-install.md` và mục cập nhật ở `docs/reports/studio-install.md`.

**Checkpoint**: US3 xong về mã và thử; chứng chỉ thật, cài thử trên Windows sạch (T103 đến T105) chờ người.

---

## Phase 6: User Story 4 — Cập nhật runtime qua mạng có xác thực, atomic, rollback (Priority: P2)

**Goal**: OTA mặc định tắt, đường thủ công còn nguyên; kiểm lab nhiều.

**Independent Test**: `tools/update-it.ps1` trên x64 với `mat-updater` chạy trên cây thư mục giả (biến `MAT_OPT_ROOT`) và bộ giả `systemctl`; bộ 30 gói xấu; kill từng bước.

### Tests (viết trước, phải ĐỎ; Constitution V)

- [ ] T106 [P] [US4] Bộ vector gói và công cụ tạo (SC-020; FR-061): `tools/release/make-update.mjs` (Node `crypto`, không phụ thuộc mới) sinh gói hợp lệ và 30 ca xấu của contract update-package §6 vào `tests/update-vectors/` kèm khóa thử `keys/test-ec-p256.pem`; `make-update.test.mjs` kiểm công cụ; `tests/update-vectors/README.md`.
- [ ] T107 [P] [US4] Test API cập nhật (SC-022; FR-058, FR-059, FR-060, FR-065): `server/tests/update_api_test.cpp`: OTA tắt ⇒ 404 `UPDATE_DISABLED` cho cả 5 endpoint; ma trận quyền (không đăng nhập, viewer, operator, engineer, cookie web ⇒ `SESSION_SCOPE`, HTTP ⇒ `HTTPS_REQUIRED`) ⇒ 401/403 và audit, 0 tệp ghi ngoài `update/`; audit `accepted` trước byte đầu; `Content-Length` bắt buộc, `chunked` ⇒ 411; vượt `maxPackageMiB` ⇒ 413; slowloris ⇒ `UPDATE_RECEIVE_ABORTED` và dọn; 30 ca xấu của T106 qua API ⇒ đúng mã; `DEVICE_BUSY` chung khóa với nạp xuống; `apply` thiếu hoặc sai mật khẩu ⇒ `REAUTH_FAILED` (tính vào khóa cặp); `verified` hết hạn 30 phút; `cancel`.
- [ ] T108 [P] [US4] Test `mat-updater` (SC-021; FR-062, FR-063): `deployment/device/tests/updater_test.sh` trên cây giả (`MAT_OPT_ROOT`, giả `systemctl` chạy runtime thật hoặc giả): 8 bước thành công; kiểm lại ở root trên bản sao (gói bị đổi sau kiểm sơ bộ ⇒ từ chối, TOCTOU); danh sách `tar` đối chiếu `files[]` (liên kết, thiết bị, `..`, setuid); sức khỏe lỗi ⇒ quay về ≤ 90 s; kill ở mỗi bước S1–S8 rồi `mat-updater-recover` ⇒ bản cũ hoặc mới hoàn chỉnh (40 ca: 8 bước × 5); `request.json` lạ (`updateId` sai dạng, băm sai) bị bỏ; giới hạn 1 lần/5 phút; `.failed` giữ một bản.
- [ ] T109 [P] [US4] Test `--self-check`, `--trust-key`, `keyset`, `rollback` (FR-066; R17): `server/tests/self_check_test.cpp`, `trust_key_cli_test.cpp`: `--self-check` không mở cổng, không ghi; `--trust-key add|remove|list` (root, đường dẫn, quyền 0644); gói `keyset` ký bởi khóa tin cậy thêm khóa mới; `remove` chính khóa đã ký ⇒ `KEYSET_SELF_REVOKE`; khóa không có chữ ký của khóa tin cậy ⇒ từ chối; `POST rollback` chạy lại `.prev`, không có ⇒ từ chối; audit.
- [ ] T110 [P] [US4] Test Studio OTA (FR-068): `apps/studio/src/model/update-flow.test.ts`, `apps/studio/src/ui/dialogs/update-wizard.test.ts`, `apps/studio/src-tauri/src/device/update.rs` (`#[cfg(test)]`, máy chủ giả): chỉ hiện với administrator và thiết bị báo `update.supported`; tải có tiến trình; xem kế hoạch (phiên bản, tương thích, thời gian ngừng, người ký); nhập mật khẩu; theo dõi nối lại (3 trạng thái: committed, rolled-back, mất kết nối quá 120 s); nút "Quay về bản trước"; thiết bị cũ ẩn chức năng.

### Implementation

- [ ] T111 [US4] Dịch vụ cập nhật ở runtime (FR-058 đến FR-061, FR-064, FR-065; T004 xong 2026-10-16): `server/update_service.{hpp,cpp}` (trạng thái, khóa với `DeployPipeline`, kiểm sơ bộ bằng `core/update`, thư mục `update/{incoming,ready,ops}`, hết hạn 30 phút), `server/http/update_api.{hpp,cpp}` (5 endpoint, `cookieAllowed = false`, HTTPS, administrator, `Content-Length` bắt buộc, giới hạn tốc độ), audit (`core/audit/audit_actions.hpp`), `server/http/http_api.cpp` đăng ký route. T107 xanh (trừ phần `apply`).
- [ ] T112 [US4] Áp dụng và xác thực lại (FR-059, FR-062): `apply` kiểm mật khẩu bằng `AuthService` (Argon2id, tính vào `maxConcurrentLogins` và khóa cặp), audit `system.update.applying`, ghi `request.json`; trả 202 trước khi dịch vụ dừng. T107 xanh trọn.
- [ ] T113 [US4] `--self-check`, `--trust-key`, `--update-status` (FR-066; contract device-api §7): `server/cli/{self_check,trust_key,update_status}.{hpp,cpp}`, `server/main.cpp`; gói `keyset` xử lý ở `server/update_service.cpp` (ghi `trusted-keys/` cần quyền root ⇒ runtime **không** ghi: `keyset` đi qua `mat-updater`, thao tác `kind: keyset` của T114). T109 xanh phần CLI.
- [ ] T114 [US4] `mat-updater` (FR-063, FR-066, FR-070, FR-072): `deployment/device/mat-updater.sh` (8 bước, ghi `ops/<id>.json` trước mỗi bước, kiểm lại bằng `mat-update-verify` trên bản sao của root, đối chiếu `tar -tvzf`, `--no-same-owner`, `--self-check` dưới `matscada`, đổi tên nguyên tử, kiểm sức khỏe 60 s, quay về, `last.json`, `kind: keyset`, `UPDATER_MANUAL_ONLY`), `mat-updater-recover.sh`, biến `MAT_OPT_ROOT` và `MAT_SYSTEMCTL` cho test. T108 xanh.
- [ ] T115 [P] [US4] Unit systemd (FR-062; contract §5): `deployment/systemd/{mat-updater.service,mat-updater.path,mat-updater-recover.service}` (sandbox như contract; `mat-runtime.service` **không đổi** quyền); `deployment/device/deploy.sh` cài ba unit, `mat-updater`, thư mục `/var/lib/mat-updater` (0700), kiểm `systemd-analyze verify`; `deployment/device/tests/` cập nhật.
- [ ] T116 [US4] Ghi audit khi khởi động sau cập nhật (FR-063): `server/runtime_engine.cpp` đọc `last.json` (`audited=false`) ghi `system.update.committed` hoặc `rolled-back` (kèm `planned`), đặt `audited=true`; cảnh báo `UPDATE_ROLLED_BACK` (30 ngày hoặc tới khi administrator xác nhận); `system/info.update`; kiểm phiên Bearer và web còn sau cập nhật (FR-071: `auth-state.json` đi qua khởi động lại; không thì đăng nhập lại, kiểm không nâng quyền).
- [ ] T117 [P] [US4] `tools/release/make-update.mjs` hoàn thiện (FR-057): đọc `build-info.json`, tạo `files[]` từ `deployment/package-runtime.ps1` đầu ra, ký bằng khóa phát hành, tự kiểm lại bằng `mat-update-verify`; `release.ps1` gọi (T098).
- [ ] T118 [P] [US4] Fuzz bộ đọc phong bì (FR-029): mục tiêu `tools/fuzz/update-envelope` (ASan + UBSan, ≥ 1 giờ), kho mầm từ `tests/update-vectors/`; 0 sự cố; `docs/reports/011-fuzz-x64.json`.
- [ ] T119 [US4] Studio OTA (FR-068; sau T007): `apps/studio/src-tauri/src/device/update.rs` (lệnh Tauri: tải lên có tiến trình, trạng thái, apply, cancel, rollback; dùng phiên và ghim TLS có sẵn), `apps/studio/src/model/update-flow.ts`, `apps/studio/src/ui/dialogs/update-wizard.ts` (+ css), task card "Cập nhật runtime" trong `apps/studio/src/ui/editors/device-page.ts`, `mat-taskcards.ts`; chuỗi `apps/studio/src/i18n/`. T110 xanh; axe-core 0 lỗi.
- [ ] T120 [US4] `tools/update-it.ps1` (SC-020, SC-021, SC-022): trên x64 trong Docker (runtime thật, `mat-updater` chạy trên `MAT_OPT_ROOT` với giả `systemctl`): kịch bản `ok` (20 cập nhật hợp lệ; dịch vụ ngừng ≤ 30 s, toàn bộ ≤ 120 s), `bad` (30 gói xấu qua HTTPS), `kill` (5 lần mỗi bước S1–S8 = 40), `health` (sức khỏe giả lỗi ⇒ quay về ≤ 90 s), `busy`, `keyset`, `downgrade`, `manual-rollback`, `auth` (ma trận quyền); kết quả `docs/reports/011-update-x64.json`.
- [ ] T121 [US4] Tài liệu OTA (FR-067): `docs/deployment/mat-runtime.md` mục 5f (bật OTA, khóa tin cậy, quy trình từ Studio, khôi phục thủ công bằng `deploy.sh`, xoay khóa), mục "Quy trình thủ công" giữ nguyên và ghi rõ là đường khôi phục.
- [ ] T122 ⚠️🔌 [US4] BL335: cài `mat-updater`, unit và khóa bằng `deploy.sh` (chờ SSH và người dùng cho phép; ghi `device-changes.md`; **chỉ sau khi người dùng đồng ý**), bật `update.enabled` (cấu hình root), 10 cập nhật OTA thật (armhf) bằng Studio (SC-023); đo thời gian ngừng.
- [ ] T123 ⚠️🔌 [US4] BL335: cắt điện giữa bước S4 đến S7 (5 lần mỗi bước, bộ điều khiển nguồn T083; SC-021, SC-023; điểm D2 của test-protocols §4): bản cũ hoặc bản mới hoàn chỉnh; cập nhật `docs/reports/011-powercut.md`.
- [ ] T124 [US4] ADR-035 cập nhật số đo (T008, T120, T122): chuyển trạng thái chỉ ở T198; ở đây ghi số đo và quyết định chi tiết (kích thước `mat-update-verify`, thời gian ngừng). (FR-070)

**Checkpoint**: US4 xong về mã và x64; BL335 (T122, T123) chờ người.

---

## Phase 7: User Story 5 — Logic v2 (Priority: P2)

**Goal**: luật, timer, counter, cộng dồn, giờ chạy, lịch; hai engine cùng vector; ghi PLC có khai báo và audit.

**Independent Test**: ≥ 200 vector; giả lập Modbus; kill -9, mất điện giả lập.

### Tests (viết trước, phải ĐỎ; Constitution V, VI)

- [ ] T125 [P] [US5] Vector chung logic (SC-024; FR-092): `tests/logic-vectors/` ≥ 200 ca theo phân bố của contract logic-engine §12 (luật 40, timer 30, counter 25, totalizer 25, giờ chạy 15, lịch 40, ghi và giới hạn 15, lỗi tĩnh 30 gồm mỗi mã `E_LOGIC_*` một ca đúng và một ca sai, retain 10); `tests/logic-vectors/README.md`; chạy bằng `packages/logic-engine/src/vectors.test.ts` (đỏ) và `core/logic/tests/vectors_test.cpp` (đỏ).
- [ ] T126 [P] [US5] Test độ chính xác (SC-025; FR-085 đến FR-089): `packages/logic-engine/src/{timers,counters,totalizer,runhours,schedule}.test.ts` và bản C++: `ton/tof/tp` theo bảng chân trị (≤ 1 quét + 20 ms), counter 10.000 cạnh sai 0 và tràn không quay vòng, totalizer dòng hằng 1 giờ ≤ 0,1 % (cộng `cutoff`, `maxGapMs`, `gapSeconds`, `rolloverAt`), giờ chạy 24 giờ mô phỏng ≤ 0,01 giờ, lịch ≥ 40 ca (nửa đêm, `[from,to)`, ngoại lệ, `tzOffsetMin`, `timeSynced`).
- [ ] T127 [P] [US5] Test ngữ nghĩa luật (FR-076, FR-077; SC-024): `packages/logic-engine/src/rules.test.ts`, `core/logic/tests/rules_test.cpp`: `hold`, cạnh, `fireOnStart`, `repeatMs`, `SUSPENDED` và tiếp tục không cạnh giả, `edgeId` khử trùng lặp, thứ tự theo id, sắp xếp tô-pô, `E_LOGIC_CYCLE`, `E_LOGIC_SELF_TRIGGER`, `THROTTLED`, `W_LOGIC_WRITE_CONFLICT`.
- [ ] T128 [P] [US5] Test validator logic (FR-093; SC-024): `packages/project-schema/src/rules-logic.test.ts`, `core/project-manager/tests/rules_logic_test.cpp`: mọi mã `E_LOGIC_*` và `W_LOGIC_*`; giới hạn số khối; `writes` hợp lệ (`E_LOGIC_WRITE_UNDECLARED/TARGET/VALUE`); `E_LOGIC_TAG_COLLISION`; kết quả TS = C++ trên vector T125.
- [ ] T129 [P] [US5] Test ghi từ logic (SC-027; FR-078 đến FR-083; T004 xong 2026-10-16): `core/logic/tests/logic_write_test.cpp`, `server/tests/logic_write_test.cpp` với `WriteCoordinator` và driver giả: audit bền **trước** khi gửi (thứ tự quan sát), `actor` `logic:<id>`, `channel` `logic`, ≤ 8 giá trị đầu vào; chuỗi kiểm của 006 áp nguyên (Tag RW, giới hạn, kết nối, hàng đợi); `minIntervalMs`, `maxPerHour`, `logic.maxWritesPerMin` ⇒ `RATE_LIMITED`, `THROTTLED`, audit gộp, cảnh báo; `logic.writes: off` ⇒ 0 lệnh và audit `suppressed`; dừng bởi administrator giữ qua khởi động lại; bật lại bằng API bị từ chối `LOGIC_ENABLE_ROOT_ONLY`; `pulse` dùng nhật ký xung.
- [ ] T130 [P] [US5] Test API và Tag logic (FR-083, FR-084): `server/tests/logic_api_test.cpp`, `tags_api_test.cpp`: `GET /logic` (trạng thái, `scan`), `POST /logic/writes`, `POST /logic/reset` (engineer, audit), ghi vào Tag logic ⇒ `OWNED_BY_LOGIC` ở API, Bảng theo dõi, widget; quyền (viewer đọc, administrator dừng).
- [ ] T131 [P] [US5] Test lưu trạng thái (SC-026; FR-090, FR-091): `core/logic/tests/retain_test.cpp`: ghi mỗi `flushS` khi có thay đổi và khi dừng, không ghi khi không đổi, phục hồi, không bao giờ giảm, retain hỏng ⇒ 0 + `LOGIC_RETAIN_LOST` + audit một lần; nạp xuống giữ giá trị theo `id`, id mới từ 0, id bị xóa bỏ; ước tính ghi đĩa và `W_LOGIC_RETAIN_IO`.
- [ ] T132 [P] [US5] Test Studio logic (FR-094, FR-096): `apps/studio/src/model/logic-doc.test.ts` (thêm/sửa/xóa khối, đổi id cập nhật tham chiếu, kiểm khi gõ qua validator TS), `apps/studio/src/ui/logic/*.test.ts` (editor, inspector, danh sách lỗi, bảng Thử logic), `apps/studio/src/model/deploy-preview.test.ts` (danh sách ghi tự động và trạng thái `logic.writes` của thiết bị), chip trạng thái Online; e2e `apps/studio/tests/e2e/logic.e2e.mjs` + axe-core.

### Implementation (engine, validator)

- [ ] T133 [US5] `packages/logic-engine` (FR-074 đến FR-077, FR-085 đến FR-089, FR-092; R20): `src/{index,types,engine,rules,timers,counters,totalizer,runhours,schedule,order}.ts` (đồng hồ monotonic và giờ thực tiêm vào, không `Date.now()` trực tiếp, số học không FMA như ADR-015); T125 phần TS, T126, T127 phần TS xanh.
- [ ] T134 [US5] `core/logic` (FR-076 đến FR-090): `core/logic/{engine,rules,timers,counters,totalizer,runhours,schedule,order,state}.{hpp,cpp}`, `CMakeLists.txt` (module lib, thêm `core/logic/tests` vào `MAT_ARMHF_TEST_TARGETS`); không phụ thuộc UI. T125 phần C++, T126, T127 phần C++ xanh; hai bản cùng kết luận 100 % (SC-024).
- [ ] T135 [US5] Validator logic TS và C++ (FR-073, FR-075, FR-079, FR-093): `packages/project-schema/src/rules-logic.ts`, `core/project-manager/rules_logic.{hpp,cpp}`, `schemas/logic.schema.json` (T017), `project_validator.cpp`; tham chiếu Tag, kiểu, vòng, ghi chưa khai báo, trùng đầu ra; `W_LOGIC_*`; ước tính `W_LOGIC_RETAIN_IO` (dùng `core/project-manager/logging_estimate` làm khuôn). T128 xanh.

### Implementation (runtime)

- [ ] T136 [US5] Tích hợp vào Tag Engine (FR-076, FR-084; R20): `core/tag-engine/engine.{hpp,cpp}` móc `logic.step(now)` ngay sau tính toán Tag tính toán và trước `hub.tick()` (cùng khóa, một ảnh chụp đầu vào), Tag logic đăng ký như Tag nội bộ chỉ đọc (`owner = logic`), `tags_api.cpp` ⇒ `OWNED_BY_LOGIC`, `server/runtime_engine.cpp` dựng `LogicSubsystem` khi có `logic.json`; nạp xuống/khởi động lại giữ trạng thái theo `id` (FR-091). T130 phần Tag và T131 phần nạp xuống xanh.
- [ ] T137 [US5] Ghi từ logic (FR-078 đến FR-083; T004 xong 2026-10-16; chặn bởi T129 đỏ): `server/logic_glue.{hpp,cpp}` (hàng đợi hành động → `WriteCoordinator`, `actor`, `channel`, audit trước khi gửi, bộ chặn tần suất cửa sổ trượt và token bucket, nhật ký xung cho `pulse`, trạng thái `suppressed`, `logic-state.json`), `core/tag-engine/write_coordinator.cpp` (nhận `source = logic`), `core/audit/audit_actions.hpp` (`logic.write`, `.suppressed`, `.throttled`, `.writes.disabled`, `.reset`, `.retain.lost`), cảnh báo `LOGIC_WRITES_OFF`, `LOGIC_THROTTLED`, `LOGIC_RETAIN_LOST`. T129 xanh.
- [ ] T138 [US5] API logic (FR-083): `server/http/logic_api.{hpp,cpp}` (`GET /logic`, `POST /logic/writes` chỉ `enabled: false`, `POST /logic/reset`), bảng quyền (`cookieAllowed`: chỉ `GET /logic` = true), `system/info.logic`. T130 xanh.
- [ ] T139 [US5] Lưu trạng thái (FR-090): `core/logic/state.cpp` dùng `RetainStore` (`core/tag-engine/retain_store.cpp`): khóa `logic/<id>/<trường>`, `flushS`, SIGTERM, hỏng ⇒ 0; `server/runtime_engine.cpp`. T131 xanh.
- [ ] T140 [US5] Thời gian đồng bộ (FR-089; R23): `server/time_sync.{hpp,cpp}` (đọc chỉ-đọc `timedatectl show -p NTPSynchronized` hoặc `chronyc tracking` hoặc cờ RTC, chốt theo T013; nếu không đọc được thì coi là đồng bộ khi năm ≥ 2026 và ghi cảnh báo `TIME_NOT_SYNCED` khi ngược lại), `system/info.timeSynced`, `diagnostics.timeSynced`.
- [ ] T141 [US5] Cấu hình và ngân sách (FR-081, FR-095): `logic.scanMs`, `maxWritesPerMin` hoạt động; đo vòng quét (`scan.lastMs`, `p99Ms`); `server/tests/runtime_engine_test.cpp` ca có `logic.json`; dự án mẫu `projects/logic-demo/` (luật bơm tự bật, counter khởi động, totalizer lưu lượng, giờ chạy, lịch) và `projects/logic-load/` (200 luật…) sinh bằng `tools/gen-bench-projects.mjs`.
- [ ] T142 [P] [US5] Fuzz parser `logic.json` (FR-029): mục tiêu `tools/fuzz/logic-json`, ASan + UBSan ≥ 1 giờ; kho mầm từ `tests/logic-vectors/`.

### Implementation (Studio)

- [ ] T143 [US5] Mô hình logic trong Studio (FR-094; sau T007): `apps/studio/src/model/logic-doc.ts` (thao tác khối, đổi id, tham chiếu), `logic-sim.ts` (chạy `@mat/logic-engine` trên mô phỏng 006: `preview.ts`, `preview-hosts.ts`), `deploy-preview.ts` (danh sách ghi tự động và trạng thái thiết bị đích); T132 phần model xanh.
- [ ] T144 [US5] Editor Logic (FR-094, FR-096; theo mockup T005): `apps/studio/src/ui/logic/{logic-editor,rules-table,block-inspector,test-panel,writes-editor,schedule-editor}.ts` + css, nút Logic trên cây (`apps/studio/src/ui/registry.ts`, `mat-tree.ts`), ô biểu thức dùng lại `expression-input.ts`, bảng Thử logic (đường thời gian bằng SVG), chip Online "Ghi PLC", hộp "Dừng ghi của logic" (administrator), hộp Nạp xuống liệt kê ghi tự động (`apps/studio/src/ui/dialogs/`); i18n; T132 xanh; axe-core 0 lỗi; thử tay bộ gõ cho tên khối ⚠️🔌 (quickstart §8).
- [ ] T145 [P] [US5] Studio Tauri: lệnh logic (FR-083): `apps/studio/src-tauri/src/device/logic.rs` (đọc `GET /logic`, `POST /logic/writes`, `POST /logic/reset` qua phiên có sẵn) + `apps/studio/src/model/device-session.ts`; test Rust và Vitest.

### Chứng cứ

- [ ] T146 [US5] `tools/logic-it.ps1` (SC-025 đến SC-028): runtime x64 + giả lập Modbus: kịch bản `rules` (luật bơm tự bật qua giả lập, kiểm lệnh ghi và audit), `writes-off`, `throttle`, `stop`, `retain-kill` (100 vòng `kill -9`: không giảm, mất ≤ `flushS`, 0 ghi trùng cạnh), `retain-lost`, `deploy-keep`, `load` (cấu hình tối đa: thêm CPU/RSS/vòng quét); kết quả `docs/reports/011-logic-x64.json`.
- [ ] T147 [US5] Đo tải logic x64 (FR-095; SC-028): `projects/logic-load` với L1; `docs/reports/011-logic-load-x64.json`.
- [ ] T148 ⚠️🔌 [US5] BL335: tải logic tối đa (SC-028; chờ SSH) ≤ +3 điểm CPU, ≤ +5 MB RSS, vòng quét ≤ 5 ms; `docs/reports/011-logic-bl335.json`.
- [ ] T149 ⚠️🔌 [US5] BL335: `kill -9` và mất điện giữa lúc lưu trạng thái (điểm D5, SC-026): giá trị counter, totalizer, giờ chạy mất ≤ một chu kỳ; luật ghi PLC thật tới **một PLC hoặc giả lập Modbus do người dùng chọn** với `logic.writes: on` bật bởi người dùng; kiểm audit; **không** thử trên thiết bị đang điều khiển máy thật.
- [ ] T150 [US5] Thử người dùng và tài liệu logic (SC-029): người chưa dùng editor làm luật bơm, counter, totalizer, lịch trong ≤ 25 phút (⚠️🔌 cần người; không có thì "tự đo"); `docs/user/engineer-guide.md` mục Logic (T179, hoàn thiện ở T203).

**Checkpoint**: US5 xong về mã và x64; BL335 (T148, T149) chờ người.

---

## Phase 8: User Story 6 — Trình vẽ SVG đầy đủ (Priority: P2)

**Goal**: sửa phần tử trong SVG, nhóm, lớp, bắt dính, hoàn tác 100, tự lưu; chuẩn tắc, an toàn.

**Phụ thuộc:** `sanitizeSvg` (allowlist), `@mat/svg-import` (uid), `model/svg-doc.ts` của feature 008 (T003); tránh trùng tên (contracts/svg-editor.md §0). Chặn giao diện bởi T007.

### Tests (viết trước, phải ĐỎ)

- [ ] T151 [P] [US6] Fixture SVG (FR-117; SC-030): `tests/svg-editor-fixtures/` ≥ 20 tệp (Inkscape, Illustrator, CorelDRAW, ký hiệu tay, transform lồng 3 tầng gồm xoay, nghiêng và co không đều, đơn vị khác px, `style` nội tuyến, gradient, `use`/`symbol`, `mask`, `filter`, nested `svg`) kèm `expected.json` (canonical, số nút, uid, hộp bao) và `malicious/` (10 tệp: script, `on*`, `foreignObject`, `href` ngoài, `data:`, SVG bomb, độ sâu 33, 20.001 nút, `<style>@import`, `javascript:`); nguồn gốc và license ghi ở `README.md`.
- [ ] T152 [P] [US6] Test hình học (SC-031; FR-100 đến FR-104): `packages/svg-edit/src/{matrix,transform,bbox,bake,group,snap,align,order}.test.ts` ≥ 150 ca (transform lồng 3 tầng, bake và không bake, `circle` co không đều thành `ellipse`, xoay bội 90° và khác, nhóm/bỏ nhóm giữ hiển thị và uid, bắt dính 4 loại và ưu tiên, căn chỉnh, phân bố, cùng rộng/cao, xếp lớp khác cha, sửa nút đa giác, `isPolygonPath`), sai số ≤ 0,001.
- [ ] T153 [P] [US6] Test lệnh và hoàn tác (SC-032; FR-098, FR-110): `packages/svg-edit/src/command.test.ts`: từng lệnh và đảo, `Batch`, gộp `mergeKey`, độ sâu 100 (bước 101 đẩy bước cũ), làm lại bị xóa khi có thao tác mới, từ chối khi vượt giới hạn/allowlist, property test 1.000 chuỗi lệnh (hạt cố định): hoàn tác hết ⇒ `canonical` bằng ban đầu, làm lại hết ⇒ bằng cuối; xóa phần tử có binding đi kèm lô khôi phục binding.
- [ ] T154 [P] [US6] Test tuần tự hóa và round-trip (SC-030; FR-111): `packages/svg-edit/src/{serialize,roundtrip}.test.ts`: mở rồi lưu không sửa hai lần ⇒ cùng byte với tệp mở; sửa một thuộc tính ⇒ chỉ nút đó khác; uid giữ 100 %; phần tử giữ nguyên (`mask`, `filter`…) không đổi byte; ảnh dựng lại sai khác ≤ 1 % (`tests/svg-editor-fixtures/render-diff.test.ts` dùng `packages/svg-renderer` và Chrome headless).
- [ ] T155 [P] [US6] Test an toàn (SC-034; FR-109): `packages/svg-edit/src/{clipboard,fuzz}.test.ts`: dán 10 SVG độc ⇒ 100 % loại đúng và báo; kích thước > 5 MB bị từ chối **trước** phân tích; fuzz lệnh 100.000 chuỗi: mọi trạng thái nằm trong allowlist và giới hạn; id trùng khi dán được đổi và `url(#id)` cập nhật.
- [ ] T156 [P] [US6] Test trạng thái soạn thảo và tự lưu (FR-105, FR-112, FR-113): `apps/studio/src/model/svg-state.test.ts`: lớp ẩn/khóa ở `.mat-editor/svg-state.json` (không vào gói, không đổi SVG), tự lưu 30 s ghi tạm rồi đổi tên, tối đa 3 bản, khôi phục sau tắt đột ngột (kill giả), phát hiện đổi trên đĩa (mtime và băm), không ghi đè im lặng.
- [ ] T157 [P] [US6] Test editor (FR-097, FR-099, FR-101, FR-106 đến FR-108, FR-115): `apps/studio/src/ui/svg/*.test.ts` và e2e `apps/studio/tests/e2e/svg-editor.e2e.mjs` (Chrome headless, lớp Tauri giả, axe-core): công cụ tạo, chọn, tay nắm, phím tắt (bảng §9 contract), panel Lớp, inspector, văn bản (bộ gõ giả qua CDP như ADR-016), nhập số, `path` đường cong khóa sửa nút và lý do, mọi lệnh bằng bàn phím; p95 ≤ 16,7 ms/khung với 2.000 phần tử, mở 20.000 nút ≤ 3 s (SC-033).

### Implementation

- [ ] T158 [US6] `packages/svg-edit` mô hình và lệnh (FR-097 đến FR-100, FR-102, FR-110, FR-111; R24, R26): `src/{doc,node,parse,serialize,command,undo,matrix,transform,bbox,bake,group}.ts` dùng parser/allowlist của GĐ 3b (`@mat/svg-renderer`), không DOM; T152 (phần hình học), T153, T154, T155 phần lệnh xanh.
- [ ] T159 [P] [US6] `packages/svg-edit` bắt dính, căn chỉnh, xếp lớp, sửa nút (FR-103, FR-104, FR-107): `src/{snap,align,order,polygon}.ts`; T152 phần còn lại xanh.
- [ ] T160 [P] [US6] `packages/svg-edit` clipboard và nhập (FR-109): `src/clipboard.ts` (cây con, uid mới, id mới, `url(#id)` cập nhật; dán văn bản qua parser và allowlist, giới hạn kích thước trước phân tích); T155 xanh.
- [ ] T161 [US6] Trạng thái, tự lưu, đổi trên đĩa (FR-105, FR-112, FR-113): `apps/studio/src/model/svg-state.ts`, `apps/studio/src/model/svg/{autosave,watch}.ts`, lệnh Tauri chỉ trong thư mục project (`apps/studio/src-tauri/src/project_fs.rs`: đọc/ghi `.mat-editor/` đã nằm trong allowlist đường dẫn project; thêm hàm `file_fingerprint`); T156 xanh.
- [ ] T162 [US6] Editor SVG: canvas và công cụ (FR-097, FR-099, FR-101, FR-103; sau T007): `apps/studio/src/ui/svg/{svg-editor,canvas,tools,handles,guides,layers-panel,inspector,text-input}.ts` + css (DOM thật của `<svg>` trong Shadow DOM của tab, lớp phủ chọn/tay nắm riêng, đệm hộp bao theo `doc.version`), cây project "Đồ họa SVG" và "Mới: SVG trống" (`apps/studio/src/ui/registry.ts`, `mat-tree.ts`), mở bằng lệnh "Sửa trong trình vẽ" (menu ngữ cảnh item `svg` trong `screen-editor.ts`, Ctrl+Alt+Enter) và nhấp đúp tệp SVG trên cây (nhấp đúp item trên canvas giữ "Vào đồ họa" của feature 008; không sửa `model/svg-doc.ts` và `mat-svg-overlay.ts` của 008, chỉ dùng chung đường đọc/ghi văn bản SVG qua `project_fs`; contracts/svg-editor.md §0), phím tắt và Palette lệnh; theo mockup T006 (`studio-svg-draw.html`).
- [ ] T163 [US6] Inspector, văn bản, lớp, hoàn tác (FR-101, FR-105 đến FR-108): thuộc tính theo bảng của contract §8; `text-input` qua `textarea` giữ focus (ADR-016); panel Lớp (tạo, đổi tên, thứ tự, chuyển, xóa có hỏi, mắt, khóa); phím Ctrl+Z/Y nối với `UndoStack`; cảnh báo xóa phần tử có binding; T157 xanh; axe-core 0 lỗi (SC-015 của 007 giữ).
- [ ] T164 [US6] Hiệu năng (FR-114; SC-033): đo và tối ưu chọn khung, kéo, mở 20.000 nút (đệm hộp bao, cập nhật cục bộ, bản xem nhanh khi kéo ≥ 200 nút); `apps/studio/tests/e2e/svg-perf.e2e.mjs` ghi `docs/reports/011-svg-perf.json`; dự phòng hạ cấp nếu p95 vượt (ghi vào plan rủi ro).
- [ ] T165 [P] [US6] Fuzz bộ lọc SVG và lệnh (FR-029; SC-034): `tools/fuzz/svg-sanitize.mjs`, `packages/svg-edit/src/fuzz.test.ts` (100.000 chuỗi); kho mầm từ `tests/svg-editor-fixtures/`.
- [ ] T166 [US6] Thêm `data-mat-layer`, `data-mat-name` vào allowlist (FR-105; contracts/project-format-1.0.md §8): `packages/svg-renderer/src/allowlist.ts`, `sanitize.ts` (viết lại ở feature 008; nếu 008 chưa có mã thì làm sau khi 008 xong) kèm test và vector `v10-svg-*`; runtime bỏ qua hai thuộc tính.
- [ ] T167 [US6] Thử tay ⚠️🔌: bộ gõ Telex/Unikey nhập văn bản trong editor SVG trên Windows 11, trình đọc màn hình (NVDA) với editor; ghi `docs/reports/011-svg-manual.md`; người dựng ký hiệu "bơm" từ đầu và gắn Tag trong ≤ 20 phút (SC-036; không có người thì "tự đo").
- [ ] T168 [US6] Tài liệu trình vẽ (FR-118): `docs/user/engineer-guide.md` mục "Trình vẽ SVG" (T179): công cụ, phím tắt, lớp, hạn chế có chủ ý (không Bézier, boolean, filter, mask, gradient, văn bản nhiều dòng; dùng Inkscape khi cần).

**Checkpoint**: US6 xong; thử tay (T167) chờ người.

---

## Phase 9: User Story 7 — Faceplate và template (Priority: P3)

**Goal**: template bung khi lưu; faceplate popup có tham số; runtime thay chuỗi.

### Tests (viết trước, phải ĐỎ)

- [ ] T169 [P] [US7] Test mô hình template (FR-119 đến FR-122, FR-126; SC-037): `apps/studio/src/model/template-doc.test.ts`: tạo từ vùng chọn (chọn tham số), thêm bản sao (id `<inst>.<rid>`, Tag thay đúng), "Cập nhật mọi bản sao" (giữ vị trí, cỡ, tham số; xóa item thêm tay; một bước hoàn tác), "Bung thành item thường", xóa template còn bản sao (hỏi), `W_TEMPLATE_DRIFT`; 20 bản sao sửa một lần cập nhật 20/20.
- [ ] T170 [P] [US7] Test runtime faceplate (FR-123, FR-125; SC-037): `packages/ui-components/src/screen/popup-layer.test.ts`, `apps/runtime-web/src/popup-host.test.ts`, `action-host.test.ts`: `args` thay `{param}` bằng `substituteParams` (T021), đăng ký Tag đã thay, hủy khi đóng; mở popup khác thay popup hiện tại; Tag không có trong tập đã công bố ⇒ widget hiện lỗi và **không** đăng ký; `args` lạ bị từ chối; e2e `apps/runtime-web/tests/e2e/faceplate.e2e.mjs` (một popup cho 20 bơm, runtime giả).
- [ ] T171 [P] [US7] Test Studio faceplate (FR-126): `apps/studio/src/ui/dialogs/args-dialog.test.ts`, `template-*.test.ts`: hộp `args` ở hành động Mở popup (đúng bộ tham số), tạo faceplate từ màn hình popup, thư viện template trên cây; e2e `apps/studio/tests/e2e/template.e2e.mjs` dựng 20 bản sao và một faceplate.

### Implementation

- [ ] T172 [US7] Mô hình template (FR-119 đến FR-122): `apps/studio/src/model/template-doc.ts` (tạo, bung, cập nhật, bung thành item thường), đọc/ghi `templates/<id>.template.json` và `tpl` (`project-doc.ts`, `project_fs.rs` liệt kê `templates/`), `project.json` `templates`; T169 xanh.
- [ ] T173 [US7] Giao diện template và faceplate (FR-126, FR-127; sau T007): `apps/studio/src/ui/dialogs/{template-create,template-instance,args-dialog}.ts`, mục "Template" trên cây, danh sách bản sao, nút "Cập nhật mọi bản sao", item "Tạo template…" trong menu ngữ cảnh của vùng chọn (`screen-editor.ts`), inspector `args` của hành động `popup` (`props-widget.ts`), màn hình popup có `params` (inspector Chung); T171 xanh; axe-core 0 lỗi.
- [ ] T174 [US7] Runtime faceplate (FR-125; ADR-038): `packages/ui-components/src/screen/popup-layer.ts`, `apps/runtime-web/src/{popup-host,action-host}.ts` thay `{param}` bằng `substituteParams`, kiểm tập Tag đã công bố (`projects/active` tóm tắt), hủy đăng ký khi đóng; **không** đổi mã phục vụ file của runtime cho template (SC-037: diff trống ở `server/http/`, `core/project-store/`); T170 xanh.
- [ ] T175 [US7] Dự án mẫu (SC-037): `projects/dashboard-demo/` thêm màn hình "Bơm" dùng template `bom` 20 bản sao và popup `bom-chi-tiet`; `tools/dashboard-demo/` sinh; chạy trong `web-it -Scenario faceplate` (`docs/reports/011-faceplate-x64.json`): runtime x64 + Chrome headless hiện đúng giá trị Tag thay thế cho 20 bơm.

**Checkpoint**: US7 xong.

---

## Phase 10: User Story 8 — Tài liệu người dùng, huấn luyện và hồ sơ pilot (Priority: P1)

**Goal**: ba hướng dẫn, giáo trình, hồ sơ pilot; kiểm tự động và kiểm với người.

### Tests và công cụ

- [ ] T176 [P] [US8] Test `tools/docs-check.mjs` (FR-130; SC-038): `tools/docs-check.test.mjs` với thư mục tài liệu mẫu có lỗi: liên kết hỏng, tham chiếu tệp không có, lệnh CLI không có trong `--help`, mã lỗi không có trong `schemas/error-codes.json`, tiêu đề lặp; đỏ rồi xanh.
- [ ] T177 [US8] `tools/docs-check.mjs`: đọc `docs/**/*.md`, `specs/**/*.md` (liên kết tương đối), khối mã chứa `mat-runtime --...`, `deploy.sh`, `release.ps1`... đối chiếu `--help` thật (chạy bản x64 đã build) hoặc danh sách `tools/docs-check.cli.json`; xuất mã thoát; thêm vào `ci-local.ps1` (T059). T176 xanh. (FR-130)
- [ ] T178 [P] [US8] Dựng tài liệu HTML đi kèm bộ cài (FR-133): `tools/build-docs.mjs` (bộ chuyển Markdown tối giản đủ cho tập tính năng đã dùng, hoặc `marked` nếu đã có trong workspace; ghi lý do và license), `tools/build-docs.test.mjs` (không có liên kết ra ngoài, nhúng ảnh nội bộ); `apps/studio/src-tauri/tauri.conf.json` `bundle.resources` đưa `docs-html/` vào gói; Studio nút "Trợ giúp" mở đúng mục (lệnh Tauri mở tệp trong tài nguyên, đường dẫn cố định).

### Tài liệu

- [ ] T179 [P] [US8] `docs/user/engineer-guide.md` (FR-128, FR-129): tạo project, kết nối Modbus, Tag, màn hình và widget, trình vẽ SVG (T168), template và faceplate, logic (T150), gắn Tag, nạp xuống, đọc lên, so sánh, chẩn đoán, lỗi thường gặp; ≥ 12 tác vụ kiểm tra được (mục tiêu, bước, kết quả mong đợi); dùng `projects/training-demo`.
- [ ] T180 [P] [US8] `docs/user/operator-guide.md` (≤ 6 trang): đăng nhập, xem, điều khiển có xác nhận, trạng thái BAD/STALE/UNCERTAIN, kết quả lệnh (`ACCEPTED/CONFIRMED/REJECTED/TIMEOUT/FAILED` và lý do), chế độ chỉ xem, mất kết nối, alarm (theo GĐ 4), ai gọi; ≥ 6 tác vụ. (FR-128, FR-129)
- [ ] T181 [P] [US8] `docs/user/admin-guide.md`: cài đặt BL335 và Studio, chứng chỉ (007), tài khoản (khóa, mở khóa, mật khẩu ≥ 10), backup và khôi phục, cập nhật OTA và thủ công (T121), gia cố (T061), `allowedHosts`, `logic.writes`, chẩn đoán và KPI, ma trận phiên bản Studio ↔ runtime ↔ định dạng (R32), xử lý sự cố thường gặp; ≥ 10 tác vụ. (FR-002, FR-128, FR-129)
- [ ] T182 [P] [US8] `docs/user/glossary.md` và sinh `docs/user/error-codes.md` (T025) từ danh mục; `docs/user/README.md` mục lục. (FR-006, FR-128)
- [ ] T183 [P] [US8] Dự án huấn luyện `projects/training-demo/` (bài thực hành: Tag, kết nối giả lập, màn hình, logic, template; kèm kết quả mong đợi) và `docs/training/` (FR-131): `operator.md` (2 giờ), `engineer.md` (1 ngày), `admin.md` (nửa ngày), mỗi bộ có mục tiêu, lịch, bài thực hành, bài kiểm thực hành với tiêu chí đạt, phiếu đánh giá, hướng dẫn người dạy.
- [ ] T184 [P] [US8] Hồ sơ pilot (FR-132, FR-141, FR-143): `docs/pilot/{plan,criteria,incident-log,weekly-report,acceptance-minutes,customer-checklist,data-handling}.md` theo contract test-protocols §5, §6; `criteria.md` có bảng E1 đến E9 và X1 đến X11 với nơi ghi bằng chứng; `customer-checklist.md` là danh sách tập trung mọi mục ⚠️🔌 (ai, làm gì, cần gì, chặn task nào).
- [ ] T185 [P] [US8] Kế hoạch sau pilot (FR-134; D28): `docs/plans/post-1.0-backlog.md`: thông báo alarm ngoài, recipe, API dữ liệu ra (REST, MQTT), mobile, Buildroot, driver đợt 2 đến 4, soak 30 ngày, Bézier/boolean; mỗi mảng có mục tiêu, phụ thuộc, hướng thiết kế, rủi ro, ước lượng, điều kiện bắt đầu; không mã.
- [ ] T186 [US8] Thử với người (SC-038, SC-039): ⚠️🔌 người chưa biết hệ thống làm bảng tác vụ của ba hướng dẫn (≥ 90 % không hỏi); buổi huấn luyện thử nội bộ cho từng nhóm (≥ 2 vận hành, ≥ 1 kỹ sư); ghi `docs/pilot/training-results.md`; không có người thì ghi "tự đo, chưa có người thử".

**Checkpoint**: US8 xong về tài liệu và công cụ; thử với người (T186) chờ người.

---

## Phase 11: User Story 9 — Nghiệm thu pilot và phát hành 1.0.0 (Priority: P1)

**Goal**: công cụ KPI kiểm được; pilot chạy; Go/No-Go có bằng chứng.

### Tests và công cụ

- [ ] T187 [P] [US9] Bộ dữ liệu mẫu KPI (FR-138; SC-041): `tests/pilot-kpi/` ≥ 6 kịch bản (bình thường, khởi động lại giữa kỳ, đồng hồ nhảy, khoảng trống dữ liệu, mất nguồn site loại trừ, cập nhật có kế hoạch loại trừ, thiếu `emmcLife`) kèm `expected.json`; `README.md` giải thích quy tắc; `tools/pilot/kpi.test.mjs` (đỏ).
- [ ] T188 [US9] `tools/pilot/kpi.mjs` (FR-138; contract test-protocols §6): uptime, restarts, RSS/CPU, ghi đĩa, `liveLagP95Ms`, `emmcLife`, sự cố từ `incident-log.md`, đối chiếu X1 đến X11; T187 xanh.
- [ ] T189 [P] [US9] `tools/pilot/collect.ps1` (FR-137; D38): thu `system/diagnostics`, `system/info`, tóm tắt audit mỗi 15 phút, ghi JSON dòng; mật khẩu từ biến môi trường hoặc kho thông tin xác thực Windows; không thu tên Tag hay giá trị; chạy bằng tay khi không có mạng; test với máy chủ giả (`tools/pilot/collect.test.mjs`).
- [ ] T190 [P] [US9] Bàn thử nội bộ (FR-136): script cài và cấu hình bàn thử (`tools/pilot/bench-setup.ps1`: project `soak-standard`, giả lập Modbus, 10 client, `collect.ps1`), tài liệu `docs/pilot/plan.md` mục "Bàn thử".

### Pilot và nghiệm thu

- [ ] T191 [US9] Đóng gói `1.0.0-rc.1`: nâng phiên bản (Studio, runtime, định dạng, gói), `release.ps1` (ký thử hoặc thật theo T103), cập nhật `RELEASE-NOTES`; `ci-local.ps1` xanh; cập nhật `docs/plans/roadmap-v2.md` §4.7 (trạng thái). (FR-001, FR-136)
- [ ] T192 ⚠️🔌 [US9] **Cần người/khách hàng:** chọn site pilot (1 đến 2), điều kiện: BL335, PLC thật Modbus, mạng (IP tĩnh, NTP, VPN), người liên hệ, người vận hành, kỹ sư, kế hoạch ngày; ký thoả thuận pilot và bảo mật dữ liệu (D38); điền `docs/pilot/customer-checklist.md` và `plan.md`. (FR-136, FR-143)
- [ ] T193 ⚠️🔌 [US9] Xác nhận tiêu chí vào (E1 đến E9; FR-140): đối chiếu từng mục với bằng chứng; Tech Lead ký ghi `docs/reports/011-pilot-entry.md`; mục chưa đạt có quyết định bằng văn bản hoặc chặn pilot. (FR-139, FR-140)
- [ ] T194 ⚠️🔌 [US9] Cài bản rc lên site và bàn thử (FR-136): cài theo `admin-guide.md` (SSH hoặc OTA), project do kỹ sư của khách dựng bằng Studio, bật `collect.ps1`, huấn luyện (T186 cho người thật), ghi ngày bắt đầu đồng hồ pilot.
- [ ] T195 ⚠️🔌 [US9] Chạy pilot ≥ 30 ngày (FR-136, FR-141; không quá 90 ngày): theo dõi hằng tuần (`weekly-report.md`), ghi sự cố (`incident-log.md`), vá qua hồi quy; chạy `kpi.mjs` mỗi tuần; đồng hồ pilot theo quy tắc §5. (FR-139)
- [ ] T196 ⚠️🔌 [US9] Đo độ trễ đầu-cuối bằng Chrome ≥ 3 lần mỗi site (X3; `load-tester --latency`) và `EXT_CSD` đầu/cuối kỳ (X4, X5); soak 30 ngày bàn thử (S2, D13). (FR-139, SC-040)
- [ ] T197 ⚠️🔌 [US9] Nghiệm thu với khách hàng: bài kiểm thực hành huấn luyện (X9), ≥ 10 tác vụ đại diện (X8), biên bản `acceptance-minutes.md` có chữ ký (X10; SC-041).
- [ ] T198 [US9] `docs/reports/011-go-no-go.md` (FR-142; SC-043): đối chiếu X1 đến X11 và từng SC (Đạt, Không đạt, Chưa đo) và Definition of Done Master Plan §14.6 từng dòng; Tech Lead ký. **Go**: gắn `1.0.0`, ký bản phát hành, cập nhật roadmap §4.7, ADR 035 đến 038 Accepted, Constitution nếu cần; **No-Go**: báo cáo giới hạn và kế hoạch. Không có pilot thật thì ghi "Chưa đo" và **không** gắn 1.0.0.

**Checkpoint**: pilot và Go/No-Go; phần lớn chờ người, khách hàng, thời gian.

---

## Phase 12: Polish, tích hợp, nghiệm thu

- [ ] T199 Đồng bộ tài liệu và tham chiếu: `docs/adr/035` đến `038` (số đo, trạng thái), `docs/adr/README.md`, `docs/plans/roadmap-v2.md` §4.7, `CLAUDE.md` (dòng lộ trình), `mAT_SCADA_Master_Plan.md` ghi chú Sprint 3 và 7 "thay bởi 011", `docs/architecture/studio-ux.md` (§5 editor SVG và Logic nếu cần). (FR-001)
- [ ] T200 Hồi quy toàn bộ (FR-003; SC-042): `ci-local.ps1` đầy đủ (gồm ASan ctest, `device-it`, `driver-it`, `web-it`, `update-it`, `logic-it`, e2e Studio và runtime-web, `cargo test --lib`, armhf smoke); so cặp hành vi 0.6 và 1.0 cho trang xem từ mạng riêng và quy trình nạp xuống; ghi giờ từng bước; bước bỏ qua ghi lý do.
- [ ] T201 Ngân sách và so sánh (FR-005; SC-011 đến SC-013, SC-028): tổng hợp RSS, CPU, ghi eMMC của US2 và logic; nếu vượt ghi ADR (ADR-005 mục cập nhật).
- [ ] T202 Review bảo mật lần 2 (FR-032): chạy lại hai agent trên `git diff 634d528..HEAD` gồm OTA, logic, editor SVG, template; cập nhật `docs/reports/011-security-review.md`; không Critical/High mở; Medium mở chỉ là mục chờ người.
- [ ] T203 Hoàn thiện tài liệu người dùng và `docs-check` (SC-038): cập nhật ba hướng dẫn với phần logic, SVG, template, OTA, cảnh báo mới; `tools/docs-check.mjs` 0 lỗi; HTML đi kèm bộ cài dựng lại.
- [ ] T204 [P] Bảng FR → task → bằng chứng (FR-135): `docs/reports/011-fr-matrix.md` (143 FR, 43 SC), cột trạng thái Đạt/Không đạt/Chưa đo; mẫu như `007-fr-matrix.md`.
- [ ] T205 Báo cáo nghiệm thu `docs/reports/011-acceptance.md` (FR-135; SC-001 đến SC-043): bảng SC với kết quả, hạn chế còn lại, phát hiện review, việc chờ người (danh sách tập trung từ `customer-checklist.md`), phiên bản và số đo; trung thực về mục chưa đo.
- [ ] T206 Cập nhật `docs/reports/device-changes.md` và `docs/reports/device-profile.md` cho mọi thay đổi trên BL335 (FR-007) và hướng dẫn hoàn tác.
- [ ] T207 Commit mốc cục bộ theo story (không push): US1, US2 (x64), US3, US8, US4, US5, US6, US7, rồi pilot; mỗi commit kèm báo cáo của story; không commit `release/`, dữ liệu pilot, khóa, mật khẩu. (FR-003)
- [ ] T208 Đóng feature: chạy `/speckit-analyze` lần cuối trên artefact đã cập nhật; sửa CRITICAL/HIGH; ghi trạng thái vào `specs/011-pilot-hardening/spec.md` (Status) và roadmap §4.7; ADR 035 đến 038 chuyển Accepted **chỉ** ở T198 khi Go. (FR-142)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** → **Phase 2** (nền) → mọi story.
- **US1 (Phase 3), US2 (Phase 4), US3 (Phase 5), US8 (Phase 10)** là P1; US1, US3, US8 độc lập nhau sau Phase 2; US2 cần `--check-data` (T069) và nên chạy sau US1 (cùng bản runtime) nhưng công cụ (T066 đến T074) song song.
- **US4 (Phase 6)** cần `core/update` và `mat-update-verify` của US3 (T090, T096) và `HostPolicy`/khóa đăng nhập của US1 cho `apply`; **T004** (chặn phần runtime) xong 2026-10-16; giao diện chặn bởi **T007**.
- **US5 (Phase 7)** cần Phase 2 (định dạng 1.0.0), nhật ký xung của US1 (T045) cho `pulse`; ghi PLC: **T004** xong 2026-10-16; giao diện chặn bởi **T007**.
- **US6 (Phase 8)** cần GĐ 3b (importer, sanitizer, uid; T003) và T007; **US7 (Phase 9)** cần US6 (một phần: template dùng item thường, không cần SVG editor; faceplate cần 007) và T021.
- **US9 (Phase 11)** cần US1, US2, US3, US8 (và US4 hoặc quyết định thủ công); logic, SVG, template đến trong lúc pilot dưới dạng rc nhưng `1.0.0` đòi tất cả.
- **Phase 12** sau cùng.

### Phối hợp với 003 đến 010

- **Sửa mã của 005, 006, 007:** `core/auth/`, `core/project-store/deploy_pipeline.cpp`, `core/package/`, `drivers/modbus/modbus_tcp_driver.cpp`, `core/tag-engine/write_coordinator.cpp`, `server/http/*`, `packages/ui-components/`, `apps/runtime-web/`; mỗi lần sửa chạy lại bộ test của feature đó (`device-it`, `driver-it`, `web-it`).
- **GĐ 3b, 4, 5** (feature riêng, có thể đang làm song song): hợp nhất ở `schemas/*`, `project-schema`, `server/runtime_engine.cpp`, `apps/studio/src/ui/registry.ts`; xung đột giải bằng rebase theo từng story; phiên bản định dạng trung gian ghi ở T003.
- **`ci-local`:** không sửa mã khi một lượt `ci-local` đang chạy trên cây; hàng đợi task chờ.

### Parallel Opportunities

- Phase 1: T001, T002, T005, T006, T008 đến T012, T014 cùng lúc.
- Phase 3 tests (T032 đến T041) cùng lúc; implementation T042 đến T049 theo module (khác file) song song sau khi test đỏ; công cụ (T055 đến T058, T060, T061) song song.
- Phase 4: T066 đến T068 song song; T070 đến T074 song song; T075, T076 chạy nền song song.
- Phase 5: T088 đến T090 song song; T091, T095, T097, T099 song song.
- US5 và US6 độc lập nhau (khác package, khác thư mục UI): hai người làm song song được sau T007.

### Parallel Example: Phase 3 tests

```text
T032 host_policy_test   T033 login_guard_test   T036 pulse_journal_test
T037 modbus_tcp_multiunit_test   T038 deploy_pipeline_test   T039 conn_limit_test
```

---

## Implementation Strategy

1. **Phase 1 và 2**, cổng T004 và T007 ngay từ đầu (chặn song song).
2. **Mốc A (P1, x64):** US1 → US8 (tài liệu và công cụ) → US3 (ký và phát hành thử) → US2 (công cụ và x64). Dừng, commit, báo cáo từng story.
3. **Mốc B (cần BL335 và người):** gom mọi task ⚠️🔌 của US1, US2, US3 thành một đợt xin SSH và bộ điều khiển nguồn; chạy theo thứ tự: T063, T079, T080, T081, T082, T083, T084, T085, T086 (soak 7 ngày chạy nền trong khi làm tiếp US4 đến US7).
4. **Mốc C (P2):** US4 (OTA) → US5 (logic) → US6 (SVG) song song với US5 nếu có người; US7.
5. **Mốc D (pilot):** T191 đến T198; vào pilot khi P1 và US4 đạt (FR-140); US5 đến US7 có thể vào qua OTA.
6. Nếu trễ: tách US6, US7 thành feature riêng (D1) mà không ảnh hưởng pilot; giữ `1.0.0` đòi tất cả hoặc quyết định Go/No-Go ghi rõ phạm vi giảm.

## Notes

- Mỗi story có mốc commit, báo cáo và nghiệm thu riêng; không gộp kết luận.
- Báo cáo trung thực (Constitution VI): mục chưa đo ghi "Chưa đo"; không gắn `1.0.0` khi thiếu bằng chứng của tiêu chí bắt buộc.
- Mọi quyết định mới trong lúc làm ghi "Quyết định (người dùng giao toàn quyền 2026-10-11)" vào task, plan hoặc research kèm lý do.
