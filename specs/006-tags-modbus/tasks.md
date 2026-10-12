---

description: "Task list — Tag v1, Modbus TCP/RTU, Tag tính toán và ghi Tag có kiểm soát"
---

# Tasks: Tag v1, Modbus TCP/RTU, Tag tính toán và ghi Tag có kiểm soát

**Input**: `specs/006-tags-modbus/` (plan.md, spec.md, research.md R1–R25, data-model.md, contracts/, quickstart.md); ADR [014](../../docs/adr/014-driver-sdk-modbus.md), [015](../../docs/adr/015-expression-language.md), [016](../../docs/adr/016-studio-grid-ime.md), [017](../../docs/adr/017-tag-engine-v1.md), [018](../../docs/adr/018-viewer-source-filter.md).

**Tests**: **Bắt buộc, viết trước** (Constitution VI; spec FR-058, FR-059). Mỗi task "Test" phải chạy **đỏ** trước task cài đặt tương ứng; ghi kết quả đỏ/xanh vào "**Ghi chú khi làm:**" ngay dưới task, như 003, 004, 005. Task gộp test và cài (ví dụ T007, T169) ghi cả hai pha.

- **C++:** GoogleTest + CTest x64 trong Docker (`deployment/toolchain/test-x64.ps1`; `-Target`, `-Filter` để chỉ build và chạy module đang làm); test armhf dưới qemu-user (`deployment/toolchain/test-armhf.sh`, T003); smoke armhf (`deployment/toolchain/smoke-armhf.sh`); build ASan + UBSan (`-DMAT_SANITIZE=ON`) cho fuzz.
- **TS:** Vitest; e2e Chrome headless + axe-core với lớp Tauri giả (`npm run e2e -w @mat/studio`, tự nhận mọi file `*.e2e.mjs`).
- **Rust:** `cargo test --lib` trong `apps/studio/src-tauri`, `$env:CARGO_TARGET_DIR='C:\build\mat-studio'`.
- **Node:** `node --test tools/project-validator tools/modbus-sim` (CLI kiểm project; giả lập Modbus TCP, không phụ thuộc gói ngoài).
- **Vector chung:**
  - C++ ↔ TS: `tests/expression-vectors/`, `tests/value-table-vectors/`, `tests/sim-vectors/`, `tests/codec-vectors/`, `tests/project-vectors/` (82 ca 0.1 + ca `v02-*`);
  - C++ ↔ giả lập Node: `tests/modbus-vectors/frames/`;
  - chỉ TS: `tests/migration-vectors/`.
- **Tích hợp x64:** `tools/driver-it.ps1 -Scenario …` trên mạng Docker riêng (runtime x64 build `MAT_TEST_HOOKS`, giả lập Node `node:24-slim`, client Node); kết quả `docs/reports/006-<scenario>-x64.json`.
- **Bộ gõ:** thử tay trên Windows 11 với Telex có sẵn (TSF) và Unikey; cần người gõ (phiên chính hoặc người dùng).

**Quy ước**:

- **Quyền quyết định:** người dùng giao toàn quyền cho phiên chính ngày 2026-10-11. Phiên chính tự duyệt mockup, tự nghiệm thu, commit mốc cục bộ (không push). Quyết định mới ghi "Quyết định (người dùng giao toàn quyền 2026-10-11)" vào task, plan hoặc ADR.
- **Câu hỏi của plan đã trả lời** (plan, mục "Câu hỏi cho phiên chính"), áp vào task như sau:
  - **Câu 1, sandbox:** phương án A (`DevicePolicy=closed` + `DeviceAllow` + `SupplementaryGroups=dialout`), với điều kiện kết quả T006 cho thấy systemd 245 và cgroup của BL335 áp được `DeviceAllow` theo nhóm major; không đạt thì phương án B (drop-in `BindPaths`). T169 chỉ đánh dấu xong khi T217 có số đo trên BL335.
  - **Câu 2:** `HAVE_FDATASYNC=1` là task nền đầu tiên (T007), chạy lại toàn bộ test của 003 và 005.
  - **Câu 3:** mặc định tạm `tagWriteGlobalPerMin` = 20; chốt bằng công thức R15 sau khi đo (T221).
  - **Câu 4:** thứ tự phối hợp với 005: live 1.2.0 sau 005 T105/T106; `live.rs` gửi token sau 005 T085a, sửa kỳ vọng test T070 của 005 trong cùng task (T070); `quiesce` sau 005 T100; `audit.db` phiên bản 2 sau khi 005 đóng.
  - **Câu 5, phiên bản:** 006 là runtime 0.5.0, Studio 0.4.0, API thiết bị 1.1.0, giao thức live 1.2.0 (005: runtime 0.4.0, Studio 0.3.0).
  - **Câu 6:** danh sách lệnh của quickstart §8 đã chuyển cho người dùng cùng lời xin quyền SSH; task cần thiết bị đánh dấu ⚠️🔌.
- **Constitution V, thứ tự bảo mật:**
  - không viết route `POST /api/v1/tags/write`, `POST /api/v1/drivers/test`, `GET /api/v1/serial/ports` trước Mốc bảo mật của 005 (Checkpoint Phase 2 của 005: HTTPS, đăng nhập, role, audit chạy trên x64 và qemu);
  - không lệnh ghi nào tới thiết bị trường trước khi bản ghi audit lúc nhận đã commit (FULL);
  - bộ kiểm tra chạy ở cả Studio và runtime; runtime không kích hoạt project lỗi.
- **Thiết bị BL335 ⚠️🔌:** **SSH đang bị chặn** (bộ phân loại quyền của phiên làm việc từ chối cả lệnh chỉ đọc, 2026-10-11); không tìm cách vòng qua. Task chờ người dùng cho phép, hoặc người dùng tự chạy lệnh quickstart §8 (kiểm chỉ đọc) và §9 (cài, đo, thử).
  - Ghi mọi thay đổi vào `docs/reports/device-changes.md` kèm cách hoàn tác (FR-057).
  - Không đụng `atscada-*`, `piano-edtech-*`. Không ghi mật khẩu vào repo.
  - BL335 không có `sudo`: lệnh root chạy trực tiếp; lệnh chỉ đọc chạy bằng `runuser -u matscada --`.
  - Cắt điện thật, RS485 thật: cần người ở cạnh thiết bị. Không tự khởi động lại thiết bị.
- **⏸ §8:** task phụ thuộc kết quả lệnh chỉ đọc trên BL335 (T006): danh sách cổng mặc định, chọn unit A hay B, luật udev, cổng RS485. Task ghi phương án mặc định đang dùng (`serialPorts` = `["ttyAS*"]`, unit phương án A); kết quả khác thì sửa task trước khi làm.
- **Phối hợp với feature 005** (agent khác đang implement 005; bảng đầy đủ ở mục Dependencies):
  - **"sau 005 Txxx":** task sửa file mà task đó của 005 đang hoặc sẽ sửa; chỉ bắt đầu khi 005 đã đánh dấu `[X]` task đó;
  - **"sau khi 005 đóng":** chờ mọi task của 005 xong, trừ task ⚠️🔌;
  - **"file chung với 005":** chỉ thêm dòng hoặc khối mới. Gồm `CMakeLists.txt` (target mới, dòng `mat_test(...)`), `package.json` gốc, `eslint.config.mjs`, `packages/project-schema/src/index.ts`, `tools/ci-local.ps1`, `.github/workflows/ci.yml`, `third_party/LICENSES.md`, `docs/reports/device-changes.md`, `apps/studio/src/ui/editors/index.ts`. Báo phiên 005 trước khi sửa;
  - không sửa `specs/005-*`. Điểm 006 đổi so với contract của 005 (live mang token: tauri-commands §7, §12.12 của 005) nằm ở [contracts/tauri-commands-006.md](contracts/tauri-commands-006.md) §1;
  - file mới của 006 (phần lớn mã) làm ngay, không chờ 005.
  - **Cắt bản phát hành của 005:** từ T040 (hằng phiên bản runtime 0.5.0) và các task nối vào file chung, cây làm việc chứa mã dở của 006. Gói runtime 0.4.0 (005 T156) và bộ cài Studio 0.3.0 (005 T157) phải build từ commit mốc của 005 (ví dụ `git worktree`), không từ cây làm việc hiện tại. Phiên chính sắp lịch.
- **Mockup trước code giao diện:** không viết `apps/studio/src/ui/**` của editor hay hộp thoại mới trước khi T004 (mockup) xong và được phiên chính duyệt, và T005 (bản thử bộ gõ) đạt hoặc được dời theo quyết định ghi trong T005. Studio theo [studio-ux.md](../../docs/architecture/studio-ux.md) §5, §9, chuẩn IDE kiểu TIA Portal; không làm giao diện dạng form cơ bản.
- **Thư viện:** không thêm thư viện, gói npm hay crate (research R25). Buộc phải thêm thì: bản phát hành ≥ 2 tuần (trước 2026-09-27), rà license, ghi `third_party/LICENSES.md`, không GPL/LGPL. Image `node:24-slim` (MIT) của `driver-it` ghim digest, ghi vào `third_party/LICENSES.md` (T074).
- **Dấu phẩy động:** mọi target C++ của biểu thức, bộ sinh, đổi giá trị, scaling build với `-ffp-contract=off` (ADR-015). Không gọi `std::round`, `std::sin`, `Math.round`, `Math.sin` trong phần phải giống từng bit.
- **Ổ D:** build Rust ở `C:\build\mat-studio`; build C++ nên ở `C:\build\mat-x64-<tên>` (`test-x64.ps1 -BuildDir`). Vector lớn (2.001 Tag, 2.000 dòng dán) sinh lúc chạy test vào `out/`, không commit.
- **Mật khẩu thử:** test và `driver-it` sinh ngẫu nhiên mỗi lần chạy (`--password-stdin`), không ghi vào repo.
- **Glob lint:** mỗi task tạo file `.mjs` đầu tiên trong một thư mục `tests/*` mới thì thêm mẫu glob tương ứng vào `lint`, `format` của `package.json` gốc và `eslint.config.mjs` (file chung với 005). Glob không khớp file nào làm prettier, eslint thoát mã 2.
- **Bẫy đã biết** (004, 005):
  - axe: `nested-interactive` (không đặt nút trong `role=tab`); `role=tree` rỗng là vi phạm; chữ mờ trên `--sel` cần ≥ 4,5:1;
  - light DOM làm CSS thành toàn cục: đặt CSS theo tên thẻ hoặc tiền tố;
  - handler đọc trạng thái lúc chạy, không đọc bản chụp lúc render; `HTMLElement` đã có `title`, `hidden`;
  - e2e mỗi file một browser context;
  - ctest `-Filter` lọc theo tên GoogleTest; lọc sai thì chạy 0 test mà vẫn thoát mã 0;
  - PowerShell 5.1: thông báo `Write-Host` không dấu.
- **File dùng chung khi làm song song:** mỗi file test C++ mới thêm một dòng `mat_test(...)` vào `CMakeLists.txt`; test chạy dưới qemu thêm một tên vào danh sách `MAT_ARMHF_TEST_TARGETS`. Các dòng thêm này không tính là xung đột giữa các task [P].
- **Mỗi Checkpoint:** chạy `./tools/ci-local.ps1` đầy đủ và ghi kết quả vào `docs/reports/006-acceptance.md`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1…US6 theo spec.md
- **⚠️🔌**: cần BL335 thật; SSH đang bị chặn
- **⏸ §8**: chờ kết quả lệnh chỉ đọc trên BL335 (T006); đang làm theo phương án mặc định ở trên
- **sau 005 Txxx**, **sau khi 005 đóng**: chờ task của 005

---

## Phase 1: Setup (thư mục, package, khung test armhf, mockup, kiểm BL335)

- [ ] T001 [P] Cấu trúc thư mục:
  - tạo `core/expression/tests/`, `drivers/sdk/tests/`, `drivers/modbus/tests/`, `tests/{expression-vectors,value-table-vectors,sim-vectors,codec-vectors,modbus-vectors/frames,migration-vectors,driver-it}/`, `tools/modbus-sim/maps/`, `apps/studio/src/{model/grid,ui/grid,workers}/`;
  - `.gitignore`: `tests/*-vectors/out/`, `tests/driver-it/out/`, `build/sim-*.jsonl`;
  - thư mục rỗng chưa vào git: không thêm file giữ chỗ (như T011 của 005). Glob lint thêm theo quy ước "Glob lint" ở trên.
- [X] T002 [P] Ba package workspace mới (plan "Primary Dependencies"): `packages/expression` (`@mat/expression`), `packages/tag-codec` (`@mat/tag-codec`), `packages/tag-sim` (`@mat/tag-sim`):
  - mỗi package: `package.json` (`private`, `version` 0.1.0, `type: module`, `exports` `./src/index.ts`, script `typecheck`, `test`; `devDependencies` cùng phiên bản với `@mat/project-schema`: `typescript`, `vitest`, `@types/node`), `tsconfig.json`, `vitest.config.ts`, `src/index.ts` rỗng;
  - `npm install` chỉ thêm ba mục liên kết workspace vào `package-lock.json`, không thêm gói ngoài (kiểm bằng diff);
  - `npm run typecheck`, `npm test` xanh.
  - **Ghi chú khi làm:** Ba package workspace tạo xong; `package-lock.json` chỉ thêm ba liên kết workspace (và typescript lồng của từng package, như `project-schema`).
- [ ] T003 Khung test armhf dưới qemu và tùy chọn build. **File chung với 005** (`CMakeLists.txt`, `tools/ci-local.ps1`, `.github/workflows/ci.yml`): chỉ thêm khối và bước.
  - `CMakeLists.txt`:
    - tùy chọn `MAT_ARMHF_TESTS`: khi cross-compile, build GoogleTest và các target có tên trong `MAT_ARMHF_TEST_TARGETS` (hiện nay khối test nằm trong `if(NOT CMAKE_CROSSCOMPILING)`);
    - tùy chọn `MAT_SANITIZE` (chỉ x64): `-fsanitize=address,undefined -fno-omit-frame-pointer` cho target của `core/`, `drivers/`, `server/` và test (không cho `third_party`), link với sanitizer; test chạy với `UBSAN_OPTIONS=halt_on_error=1`;
    - target thư viện mới của 006 tạo cùng file nguồn đầu tiên của nó, không tạo target rỗng (bài học T006/T017 của 005).
  - `deployment/toolchain/test-armhf.sh` (sh, chạy trong image `mat-armhf`): build `build/armhf-tests` với `-DMAT_ARMHF_TESTS=ON`; chép từng file test vào thư mục tạm (qemu-user đọc bind mount kém, như `smoke-armhf.sh`); chạy `qemu-arm -L /usr/arm-linux-gnueabihf <test>`; thoát mã khác 0 khi một test hỏng. Danh sách đầu: `tag_store_test`, `audit_log_test`, `local_store_test`.
  - Bước `armhf tests (qemu)` trong `tools/ci-local.ps1` (sau `armhf smoke (qemu)`) và trong job `build-armhf` của `.github/workflows/ci.yml`.
  - **Kiểm đỏ:** thêm tạm một test hỏng vào danh sách → bước báo hỏng, mã thoát khác 0; bỏ đi → xanh. Ghi thời gian bước vào ghi chú khi làm.
- [X] T004 [P] Mockup `docs/architecture/mockups/studio-tags.html` (research R22; theo kiểu và token của `studio-shell.html`; theme sáng và tối), trước mọi code giao diện mới:
  - **Bảng Tag** 2.000 dòng: bộ cột theo loại Tag; cột giá trị sống, quality, lý do khi Online; ô địa chỉ kèm mã hàm, offset thật, số thanh ghi; lỗi theo ô; mức dùng `tags.json` trên thanh trạng thái;
  - **Kết nối:** form chia nhóm cho kênh Modbus TCP, kênh RTU, thiết bị trường; panel Thử kết nối (thời gian, mã, hex, bảng cách hiểu 4 thứ tự); danh sách cổng serial có nút "Dò RS485";
  - **Bảng giá trị** (lưới mục, ô màu, mục mặc định, ô thử) và **Tag tính toán** (ô biểu thức tô màu, gợi ý, gạch lỗi, xem trước, danh sách đầu vào);
  - **Bảng theo dõi** (định dạng, giá trị sống, chữ và màu, cột giá trị ghi, kết quả từng dòng) và hộp xác nhận ghi (định nghĩa Tag trên BL335, cảnh báo khác biệt);
  - **Chẩn đoán driver** (cây kênh › thiết bị trường, số đếm, phần tăng từ lúc mở trang, chu kỳ thực cạnh chu kỳ đặt, dấu quá tải, Tag xấu);
  - **Mô phỏng:** dấu "MÔ PHỎNG" màu tím, khác viền cam của Online;
  - **hộp thoại:** Nâng cấp / Mở chỉ đọc / Hủy; Thêm hàng loạt; Nhập CSV (xem trước); Đổi tên Tag (danh sách chỗ đổi);
  - cây project theo FR-043 (bỏ nhãn GĐ);
  - phiên chính tự duyệt (người dùng giao toàn quyền); ghi ngày duyệt và các điểm chỉnh vào ghi chú khi làm.
  - **Ghi chú khi làm:** Mockup `docs/architecture/mockups/studio-tags.html` (7 màn: Bảng Tag, Kết nối, Bảng giá trị và Tag tính toán, Bảng theo dõi, Chẩn đoán, Mô phỏng/Online, hộp thoại). Phiên chính tự duyệt: cần ghi ngày duyệt khi xem.
- [ ] T005 Bản thử bộ gõ (spike) trong `docs/architecture/mockups/studio-tags.html` (sau T004; ADR-016 điểm 5, research R21). Đây là cổng quyết định trước khi làm lưới (T085–T088):
  - **cách nhận chữ:**
    - một `textarea` luôn giữ focus khi lưới được focus, đặt đúng trên ô đang chọn; ở chế độ di chuyển rỗng và trong suốt;
    - `compositionstart`, hoặc `beforeinput`/`input` có chữ: vào chế độ sửa ngay trên chính phần tử đó, không dời focus, không gán lại `value`;
    - phím `Process` không bị chặn; Enter, Tab, mũi tên khi đang ghép thuộc về bộ gõ; Esc khi đang ghép: hủy sau `compositionend` (máy trạng thái data-model §13.2);
  - **thử tay** trên Windows 11, ở WebView2 (Studio dev nạp trang thử tạm, không commit) và Edge, với Telex có sẵn (TSF) và Unikey (Telex): 20/20 lần chọn ô rồi gõ thẳng "Mức nước bồn 1"; Esc giữa lúc ghép; Enter giữa lúc ghép; ô danh sách chọn;
  - cần người gõ trên Windows (phiên chính hoặc người dùng). Không đạt 20/20 với Telex TSF thì dừng phần lưới, xem lại ADR-016 (điều kiện xem xét lại) trước khi làm T085;
  - **Quyết định (người dùng giao toàn quyền 2026-10-11; phiên chính xác nhận cùng ngày):** khi mockup đã xong mà chưa có người gõ, lưới vẫn làm theo ADR-016, kiểm bằng bộ gõ giả lập qua CDP (T085, T087, T135); phần thử tay dời thành điều kiện nghiệm thu ở T215. T215 không đạt thì xem lại ADR-016 trước khi phát hành Studio 0.4.0;
  - ghi kết quả (bản Windows, bản WebView2, số lần đạt từng ca) vào ghi chú khi làm và `docs/reports/006-acceptance.md` (tạo file).
  - **Ghi chú khi làm:** Phần mockup/spike xong trong `studio-tags.html` (textarea giữ focus, composition, Process, Esc). **Chưa thử tay** Telex/Unikey: dời thành điều kiện nghiệm thu T215 theo quyết định đã ghi; chưa đánh dấu xong.
- [ ] T006 ⚠️🔌 **(SSH đang bị chặn; chờ người dùng cho phép hoặc tự chạy lệnh quickstart §8)** Kiểm chỉ đọc cổng serial và RS485 trên BL335 ([quickstart.md](quickstart.md) §8; D7; plan câu 1, câu 6):
  - lệnh 1–9 không mở cổng nào; lệnh 10 mở `ttyAS1`–`ttyAS5` trong chốc lát (bỏ cổng đang nối thiết bị);
  - từ kết quả, chốt:
    - `serialPorts` mặc định (T058, T162);
    - unit phương án A hay B (T169). Điều kiện ở contract device-config §3: tên major `ttyAS` trong `/proc/devices`, controller `devices` trong `/proc/cgroups`, `/dev/ttyAS*` thuộc nhóm `dialout`, mode `0660`;
    - có cần luật udev không; cổng nào nối đầu RS485 (kèm sơ đồ BLIIoT); kernel có chế độ RS485 không; `ttyUSB0`–`3` có phải modem 4G không;
    - mốc ghi eMMC khi chưa có runtime 0.5 (`/sys/block/mmcblk0/stat` hai lần cách nhau 1 giờ), dùng cho T221;
  - ghi `docs/reports/device-profile.md` (mục serial) và `docs/reports/006-acceptance.md`; sửa các task ⏸ §8 khi kết quả khác mặc định;
  - chỉ đọc nên không ghi `device-changes.md`; riêng lệnh 10 ghi một dòng "mở cổng trong chốc lát, không đổi cấu hình".

**Checkpoint**:

- `./tools/ci-local.ps1` xanh, có bước `armhf tests (qemu)`; ba package mới typecheck, test xanh.
- Mockup đã duyệt; bản thử bộ gõ đạt, hoặc phần thử tay đã dời sang T215 theo quyết định trong T005 (điều kiện làm lưới).
- T006 có thể còn chờ người dùng: không chặn Phase 2, chỉ chặn T169 và các task ⚠️🔌.
- Ghi kết quả vào `docs/reports/006-acceptance.md`.

---

## Phase 2: Foundational — nền chung cho mọi story

**Mục đích**: phần "Nền chung" của spec:

- SQLite `fdatasync`;
- vector chung và bộ tính biểu thức, bảng giá trị, phép đổi thô ↔ giá trị, bộ sinh mô phỏng ở hai bản;
- định dạng 0.2.0, bộ kiểm tra hai bản, nâng cấp 0.1 → 0.2;
- Tag Engine v1, driver SDK với driver mô phỏng; cấu hình BL335;
- lọc nguồn (FR-055a, ADR-018) và giao thức live 1.2.0;
- nền Studio: tài liệu 0.2, nâng cấp, cây project, lưới có bộ gõ.

Nghiệm thu qua US1 kịch bản 1–2, FR-001…FR-008, SC-008, SC-009, SC-022 (phần x64).

**⚠️ CRITICAL**: chưa story nào nối vào runtime hay Studio trước Checkpoint của phase này.

**Quyết định (người dùng giao toàn quyền 2026-10-11)**: phần thư viện thuần và file mới làm ngay, song song với 005. Gồm vector, `packages/*` mới, `core/expression`, file mới của `core/tag-engine`, `drivers/*`, và thư viện thuần của các story (mã hóa Modbus, driver trên transport giả, bộ điều phối ghi, kho Tag giữ qua mất điện, giả lập Node, mô hình lưới). Phần nối vào file 005 đang sửa chờ task tương ứng của 005, ghi ở từng task.

### SQLite (task nền đầu tiên)

- [X] T007 Bật `HAVE_FDATASYNC=1` cho SQLite (plan câu 2; research R15; ADR-017 điểm 5). **File chung với 005** (`CMakeLists.txt`, target `mat_sqlite`): báo phiên 005 trước khi sửa, vì thay đổi áp cho `audit.db` (005) và `history.db` (003).
  - **Test viết trước** `core/historian/tests/sqlite_sync_test.cpp`: link với `-Wl,--wrap=fsync,--wrap=fdatasync`, đếm lời gọi. Một DB WAL, `synchronous=FULL`, 10 commit, có checkpoint: mọi lần đồng bộ là `fdatasync`, 0 lần `fsync`. **Đỏ** trên build hiện tại (bản amalgamation dùng `fsync` khi thiếu cờ).
  - Thêm `HAVE_FDATASYNC=1` vào `target_compile_definitions(mat_sqlite …)`, chú thích dẫn R15 ("độ bền không đổi, byte ghi mỗi commit FULL giảm khoảng một nửa"). **Xanh.**
  - **Chạy lại toàn bộ test của 003 và 005:**
    - x64: `test-x64.ps1` cả bộ;
    - 003: `tools/historian-it.ps1`;
    - armhf: `test-armhf.sh` (`audit_log_test`, `local_store_test`) và `smoke-armhf.sh`;
    - ghi số test và thời gian `append()` FULL trước/sau (bench tắt của `audit_log_test`) vào ghi chú khi làm.
  - Ghi vào ADR-017 ("Số đo / bằng chứng": đã bật, phiên chính duyệt 2026-10-11) và một dòng ở đầu `third_party/sqlite/PATCHES.md` (cờ build, không phải bản vá).
  - **Ghi chú khi làm (C++, 2026-10-12):** Đỏ: `sqlite_sync_test` thấy 12 `fsync`; xanh sau khi thêm `HAVE_FDATASYNC=1` (0 `fsync`, mọi lần là `fdatasync`). Chạy lại 156 test của 003, 005 (audit, lưu trữ, kho project): xanh. Chưa đo thời gian `append()` FULL trước/sau (bench `AuditLogBench` tắt mặc định); `historian-it.ps1` chưa chạy (cần cơ sở dữ liệu thật). ADR-017 và `third_party/sqlite/PATCHES.md` đã ghi.

### Vector chung (viết trước; C++ và TS cùng chạy)

- [X] T008 [P] `tests/expression-vectors/generate.mjs`, `tests/expression-vectors/handwritten/*.json` và file nhóm (FR-019, FR-020; SC-008; [contracts/expression-language.md](contracts/expression-language.md) §8):
  - **≥ 300 ca**, tối thiểu theo nhóm: `arith` 50, `mod-round` 40, `compare` 30, `logic-quality` 50, `ternary` 25, `functions` 35, `text` 20, `strings` 15, `assign` 25, `syntax-errors` 30, `type-errors` 25, `limits` 10. Script tự kiểm số ca từng nhóm;
  - ca sinh tự động lấy kết quả từ **bộ tính tham chiếu viết riêng trong script** (duyệt cây, không import `@mat/expression`); ca viết tay ghi sẵn kết quả;
  - **ca bắt buộc:**
    - `round(2.5)` = 3, `round(-2.5)` = −3, `round(0.49999999999999994)` = 0, `round(1.005, 2)` = 1; `%` theo dấu số bị chia;
    - chia và chia lấy dư cho `0` và `-0` (`DIV_ZERO`, `MOD_ZERO`); ±∞ → `OVERFLOW`; NaN → `NOT_A_NUMBER`; `clamp` với `lo > hi` → `CLAMP_RANGE`;
    - quality theo nhánh đã tính: ca `ternary-dead-branch-bad` của contract; `&&`, `||` lười; `NO_VALUE` khác `INPUT_BAD`; đầu vào UNCERTAIN mang lý do của nó;
    - `a < b < c`, `a == b == c`, `1e400`, `.5`, `5.` là lỗi cú pháp; chuỗi thoát `\"`, `\\`; chữ tiếng Việt;
    - gán vào 10 kiểu Tag: số nguyên làm tròn, ngoài khoảng `OUT_OF_RANGE`; FLOAT32 vượt `OVERFLOW`; `-0` thành `0`; chuỗi > 1.024 byte `OUT_OF_RANGE`; kết quả số vào Tag BOOL là `E_EXPR_TYPE`;
    - giới hạn: 1.000/1.001 ký tự, 4.096/4.097 byte, lồng 32/33, 32/33 Tag đầu vào (kèm `span`);
  - định dạng số: dạng ngắn nhất đọc lại đúng; `"NaN"`, `"Infinity"`, `"-Infinity"`; INT64/UINT64 là chuỗi thập phân; lỗi kiểm `{ "error", "span" }`;
  - thêm glob `tests/expression-vectors/*.mjs` (quy ước "Glob lint").
  - **Ghi chú khi làm:** 556 ca (nhóm nhỏ nhất vượt tối thiểu); bộ tham chiếu riêng trong generate.mjs, 93 ca viết tay đối chiếu với nó (ba ca tính tay sai đã bị bắt: 2.675 → 2.68). Quy ước chốt: span lỗi tách từ lười theo vị trí; chuỗi chưa đóng `[đầu, hết]`, thoát lạ `[\, ký tự sau]`; tên → số tham số → kiểu hậu thứ tự → giới hạn; lồng tính ở `(`, toán tử một ngôi, `(` của lời gọi, `?` và `:`; ngăn xếp > 64 theo công thức cố định là `E_EXPR_LIMIT` cả biểu thức; đầu vào NaN/∞ GOOD cho `NOT_A_NUMBER`/`OVERFLOW` (defensive).
- [X] T009 [P] `tests/value-table-vectors/generate.mjs` và vector (FR-021; [contracts/value-tables-simulation.md](contracts/value-tables-simulation.md) §1, §3):
  - ca bắt buộc: biên dưới và trên của khoảng, khoảng một đầu, `-0`, BOOL (`true` trùng `1`), NaN, không có mục mặc định, bảng 256 mục;
  - kết quả `{ text, color, entry }` từ bộ tra tham chiếu viết riêng trong script;
  - thêm ca kiểm (không phải tra): `E_VT_OVERLAP` (báo ở mục sau trong cặp), `E_VT_RANGE`; thêm glob.
  - **Ghi chú khi làm:** 106 ca (tra + kiểm). `E_VT_TEXT` thêm (đếm ký tự Unicode).
- [X] T010 [P] `tests/sim-vectors/generate.mjs` và vector (FR-022; [contracts/value-tables-simulation.md](contracts/value-tables-simulation.md) §2, §3), bộ tính tham chiếu viết riêng trong script, đúng thứ tự phép tính của contract:
  - mỗi bộ sinh (`const`, `ramp`, `sine`, `random`, `square`, `manual`) × mỗi kiểu Tag hợp lệ: ≥ 10 ca;
  - `t` gồm 0, `m = 0`, `m = T − 1`, năm 2026, năm 2100; pha; hạt giống; `manual` bằng chuỗi lệnh ghi;
  - script tự kiểm hai giá trị của contract: `sine` (center 50, amplitude 25, period 20.000, phase 0,25, FLOAT32), `t = 0` → 75, `t = 1791601205123` → 49.03419876098633;
  - `legacy.json` sinh từ bản C++ ở T027, không sinh ở đây; thêm glob.
  - **Ghi chú khi làm:** 1.174 ca, kèm `sin-turns.json` và `hash.json` (k >= 2^32). Hai giá trị của contract tự kiểm trong script và khớp ngay lần đầu.
- [X] T011 [P] `tests/codec-vectors/generate.mjs` và `address.json`, `numeric.json`, `string.json`, `scaling.json`, `bits.json` (FR-011, FR-013, FR-015; [contracts/modbus-driver.md](contracts/modbus-driver.md) §6; [contracts/project-format-0.2.md](contracts/project-format-0.2.md) §3; research R6):
  - **địa chỉ** → vùng, mã hàm đọc/ghi, offset, số thanh ghi, bit, hoặc mã lỗi:
    - dạng vùng (`HR100`, `IR5`, `C12`, `DI0`, `HR12.3`), Modicon 5 và 6 chữ số, chữ thường được đổi thành chữ hoa;
    - `addressBase` 1: `HR1` và `40001` đều là mã 03, offset 0; `addressBase` 0: `40001` là offset 1 kèm `W_ADDR_MODICON_BASE0`;
    - lỗi `E_ADDR_SYNTAX`, `E_ADDR_AREA`, `E_ADDR_RANGE` (offset + số thanh ghi > 65.536);
  - **số:** mọi kiểu × 4 thứ tự (bảng FLOAT32 123,456 = `42F6E979` và INT64 `0x0102030405060708` của contract); biên khoảng của kiểu; NaN và vô cực đọc từ FLOAT32/64;
  - **chuỗi:** `"Bơm 1"`, L = 8: `AB` → `42C6 A16D 2031 0000`, `BA` → `C642 6DA1 3120 0000`; UTF-8 lỗi → U+FFFD; byte 0 giữa chuỗi; L lẻ; quá dài → `STRING_TOO_LONG`;
  - **scaling:** thô ↔ kỹ thuật (US1-10: INT16 13824 → 50,0 với 0–27648 → 0–100); `clamp` → UNCERTAIN `CLAMPED`; làm tròn khi ghi như `round`; ngoài khoảng thô → `OUT_OF_RAW_RANGE`; INT64/UINT64 so dạng số nguyên, không qua số thực;
  - **bit:** coil/DI đóng gói (bit thấp trước); bit trong thanh ghi `(reg >> b) & 1`; mặt nạ mã 22 (`and = ~(1 << b)`, `or = v << b`);
  - thêm glob.
  - **Ghi chú khi làm:** address 114, numeric 256, string 50, scaling 68, bits 87. Quy ước chốt ghi đầu generate.mjs: UTF-8 lỗi thay TỪNG byte bằng U+FFFD (không như TextDecoder), `.bit` > 15 là E_ADDR_SYNTAX, clamp trả đúng cận kỹ thuật.
- [X] T012 [P] `tests/modbus-vectors/generate.mjs` và `tests/modbus-vectors/frames/*.json` ([contracts/modbus-driver.md](contracts/modbus-driver.md) §2–§4; tài liệu chuẩn Modbus Application Protocol V1.1b3, Modbus over Serial Line V1.02):
  - yêu cầu và phản hồi đúng cho mã 01, 02, 03, 04, 05, 06, 15, 16, 22, dạng PDU, MBAP và RTU; exception 01–0B và mã lạ;
  - CRC-16/MODBUS: `01 03 00 00 00 0A` → `C5 CD`, `11 03 00 6B 00 03` → `76 87` (script tự kiểm);
  - phản hồi sai, kèm loại lỗi mong đợi: mã giao dịch (`tid`), mã giao thức, độ dài MBAP (`length`), unit (`unit`), mã hàm, byte count, trường nhắc lại khác (`format`), CRC (`crc`), thiếu và thừa byte;
  - độ dài khung RTU mong đợi: 5 + n (01–04), 8 (05, 06, 15, 16), 10 (22), 5 (exception);
  - giới hạn: qty 0; đọc 2.001 bit, 126 thanh ghi; ghi 124 thanh ghi, 1.969 coil; thêm glob.
  - **Ghi chú khi làm:** pdu 35, mbap 35, rtu 35, bad-tcp 40, bad-rtu 37, crc, exceptions, rtu-length, limits, rtu-timing. Bộ kiểm tham chiếu xác nhận mỗi ca lỗi phạm đúng một luật.
- [X] T013 [P] Vector bộ kiểm tra 0.2: `tests/project-vectors/generate.mjs` thêm ca `v02-*` ([contracts/project-format-0.2.md](contracts/project-format-0.2.md) §7, §10; research R4):
  - ≥ 1 ca cho mỗi mã lỗi §7.1 (trừ `E_RUNTIME_TOO_OLD`, `E_SERIAL_NOT_ALLOWED`, chỉ có ở runtime) và mỗi cảnh báo §7.2: `E_MIN_RUNTIME`, `E_LIMIT`, `E_DUP_ID`, `E_REF_DEVICE`, `E_REF_TABLE`, `E_ADDR_*` (6 mã), `E_BIT_WRITE`, `E_SCALING`, `E_DEADBAND`, `E_LIMITS`, `E_TAG_ACCESS`, `E_SIM`, `E_INITIAL`, `E_RETAIN`, `E_EXPR_*` (9 mã), `E_VT_OVERLAP`, `E_VT_RANGE`, `E_VT_TEXT`, `E_SERIAL_PORT`, `E_SERIAL_SHARED`, `E_TYPE_MISMATCH` (transform `valueTable` cho Tag STRING; `output` sai đích), `E_SCHEMA_VERSION` (trộn 0.1 và 0.2); `W_WRITE_NO_LIMITS`, `W_DETECT_SLOW`, `W_RTU_SCAN_TIME`, `W_BIT_RMW`, `W_EXPR_INT64`, `W_WATCH_REF`, `W_ADDR_MODICON_BASE0`;
  - `E_LIMIT` cho từng giới hạn D12 (2.000 Tag, 500 Tag tính toán, 500 Tag giữ qua mất điện, 16 kênh, 64 thiết bị trường, 32 thiết bị trường mỗi kênh, 256 bảng giá trị, 256 mục, 32 bảng theo dõi, 200 dòng). Vector lớn sinh vào `out/` lúc chạy test, không commit;
  - `v02-invalid-expr-cycle` (hai Tag), `v02-invalid-expr-cycle-indirect` (ba Tag; mã ở mọi Tag trong vòng), `v02-invalid-expr-depth` (17 tầng); ca 16 tầng hợp lệ;
  - `expression` 4.097 byte (miễn trần 1.024 byte chung, chịu trần riêng); `W_RTU_SCAN_TIME` với ví dụ US3-6 (200 thanh ghi nhóm nhanh, 9.600 8E1, ước khoảng 520 ms so với 250 ms);
  - transform `rangeMap`, `format`, `expression` của binding vẫn là `E_TRANSFORM_UNSUPPORTED`;
  - phiên bản: project mọi file 0.3.0, hoặc 1.0.0 → `E_SCHEMA_VERSION` (FR-002: runtime từ chối phiên bản không hiểu). Hai ca 0.1 có sẵn (`invalid-schema-version`, `logging-invalid-version`) đặt một file là 0.2.0: nay là "trộn 0.1 và 0.2", vẫn `E_SCHEMA_VERSION`, kết luận không đổi;
  - ca hợp lệ: đủ bốn loại Tag, kênh TCP và RTU, bảng giá trị, bảng theo dõi, binding `valueTable`. `expected.json` có `files` (thêm `connectionFile`, `value-tables/*.json`, `watch-tables/*.json`; thứ tự byte UTF-8) và `digest`;
  - 82 ca 0.1 giữ nguyên từng byte: so SHA-256 trước và sau khi chạy lại generator. Chỉ chạy lại generator khi không còn container `mat-armhf` đang đọc thư mục (bài học T015 của 005).
  - **Ghi chú khi làm:** 156 ca nhỏ v02-* + 8 ca lớn ở `out/` (`node tests/project-vectors/generate.mjs --out`, test tự chạy). 82 ca 0.1 giữ nguyên từng byte (băm cây thư mục trước/sau: 522 file, cùng SHA-256). Ghi chú: `duty`/`phase`/`seed`/`periodMs` ngoài khoảng là E_SCHEMA (ràng buộc ở schema theo T032), không phải E_SIM; ca W_RTU_SCAN_TIME ra 524 ms.
- [X] T014 [P] Cặp file nâng cấp `tests/migration-vectors/<ca>/{before,after}/` và `tests/migration-vectors/generate.mjs` ([contracts/project-format-0.2.md](contracts/project-format-0.2.md) §9; research R3):
  - `before/` chép từ nguồn 0.1; `after/` do **một bộ biến đổi tham chiếu viết riêng trong script**, theo đúng định dạng ghi của R2 (Tag một dòng, khóa theo thứ tự chuẩn, bỏ trường bằng mặc định; file khác thụt 2 dấu cách);
  - ca bắt buộc: `tank-demo` (đọc lại `after/` bằng mắt, ghi vào ghi chú khi làm); mọi ca `valid-*` của `tests/project-vectors`; Tag có `signal` lạ; Tag không có `min`/`max`; project không có `logging.json`; nhiều màn hình; file có BOM; project 0.1 có lỗi (lỗi được mang sang);
  - ca không nâng cấp được: file không đọc được (`expected-error.json`); thêm glob.
  - **Ghi chú khi làm:** 22 cặp before/after. Thiếu: ca nhiều màn hình riêng (ca có sẵn một màn hình).

### Biểu thức và bảng giá trị (hai bản, ADR-015)

- [X] T015 [P] Test TS (viết trước; đỏ vì chưa có mã) `packages/expression/src/vectors.test.ts`, `packages/expression/src/parser.test.ts`, `packages/expression/src/value-table.test.ts`, `packages/expression/src/tokens.test.ts`:
  - mọi ca `tests/expression-vectors/`: giá trị bằng từng bit, kiểu, quality, lý do; lỗi kiểm cùng `code` và `span`;
  - parser: thứ tự ưu tiên và kết hợp (contract §2, R17); so sánh không kết hợp; mức lồng tính theo độ sâu đệ quy (chuỗi `a + b + …` 500 hạng không tính); `span` theo ký tự Unicode, kể cả ký tự ngoài BMP; lỗi đầu tiên theo thứ tự cú pháp → tên → số tham số → kiểu → giới hạn;
  - bytecode: ngăn xếp ≤ 64 kiểm lúc biên dịch; `&&`, `||`, `?:` là lệnh nhảy, đầu vào không nạp không tính vào quality;
  - `tokens()` cho tô màu, gợi ý, đổi tên: vị trí tên Tag, tên hàm, tên bảng;
  - bảng giá trị: mọi ca `tests/value-table-vectors/`, luật chồng và `E_VT_RANGE`.
  - **Ghi chú khi làm:** Đỏ trước (không có index: 5/5 file lỗi), xanh 718 test cùng package.
- [X] T016 [P] Test C++ (viết trước) `core/expression/tests/expression_vectors_test.cpp`, `core/expression/tests/parser_test.cpp`, `core/expression/tests/value_table_test.cpp`: cùng nội dung T015 trên cùng thư mục vector; bản cài tạm trả sai để đỏ ở mức assertion.
  - **Ghi chú khi làm (C++, 2026-10-12):** Test C++ viết cùng lúc với cài đặt vì có bản TS làm chuẩn (không có pha đỏ riêng). `expression_vectors_test` chạy cả 556 ca của TS, `parser_test` 17, `value_table_test` 3 (lookup + validate của vector chung).
- [X] T017 Cài TS `packages/expression/src/{lexer,parser,checker,compiler,vm,number,value-table,tokens,index}.ts` theo giao diện contract expression-language §9 (`compile`, `evaluate`, `tokens`, `CompileEnv`, `ExprIssue`), đạt T015. `round` tự viết (`trunc` rồi so phần dư). Không `eval`, không `new Function`: test tìm hai chuỗi này trong mã nguồn package.
  - **Ghi chú khi làm:** Xanh: 718 test (556 ca biểu thức, parser, tokens, bảng giá trị, đồ thị).
- [X] T018 Cài C++ `core/expression/{lexer,parser,checker,compiler,vm,number,value_table,expression}.{hpp,cpp}` (`mat::expr`), target `mat_expression` (STATIC, `-ffp-contract=off`), đạt T016. Thêm `expression_vectors_test`, `parser_test`, `value_table_test` vào `MAT_ARMHF_TEST_TARGETS`; xanh dưới qemu.
  - **Ghi chú khi làm (C++, 2026-10-12):** `core/expression/*` cùng `value_table_json.*`, target `mat_expression` (`-ffp-contract=off`). 556/556 ca biểu thức khớp TS từng bit, kể cả dưới armhf qemu. Lệch nhỏ: biểu thức dài hơn 8.192 ký tự báo `E_EXPR_LIMIT [1000,1001]` ngay (TS cho tới 100.000), để cây AST trái-sâu không tràn ngăn xếp; không ảnh hưởng vector.

### Đổi thô ↔ giá trị, scaling (hai bản)

- [X] T019 [P] Test TS (viết trước) `packages/tag-codec/src/vectors.test.ts` và `packages/tag-codec/src/interpret.test.ts`:
  - mọi file của `tests/codec-vectors/`;
  - `interpret(registers | bits)` cho bảng cách hiểu của Thử kết nối (R22): INT16, UINT16 với 1 thanh ghi; INT32, UINT32, FLOAT32 × 4 thứ tự với 2; thêm INT64, UINT64, FLOAT64 với 4; bit với coil/DI.
  - **Ghi chú khi làm:** Đỏ 585/587, xanh 587.
- [X] T020 [P] Test C++ (viết trước) `drivers/modbus/tests/codec_test.cpp` (địa chỉ, số, chuỗi, bit) và `core/tag-engine/tests/scaling_test.cpp` (`scaling.json`; khoảng thô của kiểu số nguyên so chính xác).
  - **Ghi chú khi làm (C++, 2026-10-12):** Test `codec_test` (address 114, numeric 256, string 50, bits 87 ca) và `scaling_test` (68 ca) đọc `tests/codec-vectors`.
- [X] T021 Cài TS `packages/tag-codec/src/{address,numeric,string,scaling,bits,interpret,index}.ts`, đạt T019.
  - **Ghi chú khi làm:** Xanh 587.
- [X] T022 Cài C++, đạt T020:
  - `drivers/modbus/{address,codec}.{hpp,cpp}`: target `mat_modbus_codec` (thuần, không I/O, `-ffp-contract=off`);
  - `core/tag-engine/scaling.{hpp,cpp}`: tạo target `mat_tag_engine` (STATIC, `-ffp-contract=off`), link `mat_core`, `mat_expression`, `mat_modbus_codec`;
  - thêm `codec_test`, `scaling_test` vào danh sách armhf.
  - **Ghi chú khi làm (C++, 2026-10-12):** `drivers/modbus/{address,codec}.*` (`mat_modbus_codec`), `core/tag-engine/scaling.*` (`mat_tag_engine`). Khớp từng bit với TS, xanh dưới armhf qemu.

### Bộ sinh mô phỏng (hai bản)

- [X] T023 [P] Test TS (viết trước) `packages/tag-sim/src/vectors.test.ts` và `packages/tag-sim/src/defaults.test.ts`:
  - mọi ca `tests/sim-vectors/*.json` trừ `legacy.json`, bằng từng bit; `U(seed, k)` với `k ≥ 2^32` (phần `k_hi`);
  - `sinTurns`, `U` không gọi `Math.sin`, `Math.random` (test tìm trong mã nguồn);
  - mặc định cho Tag ngoài chưa có `sim` (contract §2.3): Tag số `random` theo `min`/`max` (thiếu thì 0–100), chu kỳ 2.000 ms, hạt giống FNV-1a 32 bit của id; BOOL `square` 10.000 ms, `duty` 0,5; STRING `const ""`.
  - **Ghi chú khi làm:** Đỏ 85/88, xanh 88.
- [X] T024 [P] Test C++ (viết trước) `drivers/simulation/tests/sim_generators_test.cpp`: mọi ca `tests/sim-vectors/*.json` trừ `legacy.json`, bằng từng bit; đổi về kiểu Tag (`round`, ép `float`, kẹp khoảng).
  - **Ghi chú khi làm (C++, 2026-10-12):** `sim_generators_test`: 880 ca bộ sinh + `hash.json`, `sin-turns.json` + mặc định §2.3.
- [X] T025 Cài TS `packages/tag-sim/src/{sin-turns,hash,generators,defaults,index}.ts`, đạt T023.
  - **Ghi chú khi làm:** Xanh 88.
- [X] T026 Cài C++ `drivers/simulation/sim_generators.{hpp,cpp}` (target `mat_sim`, `-ffp-contract=off`), đạt T024; thêm vào danh sách armhf.
  - **Ghi chú khi làm (C++, 2026-10-12):** `drivers/simulation/sim_generators.*` (`mat_sim`). Khớp TS từng bit, kể cả armhf.
- [X] T027 [P] `tests/sim-vectors/legacy.json` sinh từ C++ (contract §2.4): test `drivers/simulation/tests/legacy_vectors_test.cpp` chạy `MockTagProvider` của Sprint 1 trên chuỗi thời điểm cố định (bước 250 ms, 400 bước, có tải `SIM.*`) và so với file (chính xác); `MAT_WRITE_VECTORS=1` ghi lại file. Đỏ khi chưa có file; sinh file lần đầu bằng chính test này.
  - **Ghi chú khi làm (C++, 2026-10-12):** Đỏ (thiếu file) rồi xanh sau `MAT_WRITE_VECTORS=1`. `tests/sim-vectors/legacy.json` (400 bước × 250 ms, 6 Tag mock + 5 Tag SIM đầy đủ + tổng cent của 500 Tag SIM). `tank.temp` BAD có lý do `DISCONNECTED`, tín hiệu lạ `NO_SIGNAL`: bản port TS (T028, T029) phải theo định dạng ghi ở đầu `legacy_vectors_test.cpp`.
- [X] T028 Test TS `packages/tag-sim/src/legacy-mock.test.ts` (viết trước, sau T027): bản port khớp `legacy.json` với sai số tuyệt đối 1e-9; tín hiệu lạ → BAD `NO_SIGNAL`; bước 250 ms tính từ lúc bật Mô phỏng.
  **Ghi chú khi làm:** CHUYỂN sang đợt Studio/TS, chưa làm trong đợt C++.
  **Ghi chú khi làm (Studio, 2026-10-12):** đỏ (thiếu legacy-mock.ts) rồi xanh: 5 test, so 400 bước × 11 ô và tổng SIM với legacy.json, sai số tối đa ≤ 1e-9.
- [X] T029 Cài `packages/tag-sim/src/legacy-mock.ts` (port TS của `MockTagProvider`, giữ nguyên thuật toán và hằng số, dùng `Math.sin` như bản gốc), đạt T028.
  **Ghi chú khi làm:** CHUYỂN sang đợt Studio/TS, chưa làm trong đợt C++.
  **Ghi chú khi làm (Studio, 2026-10-12):** xong, đạt T028; `LegacyMock` (round nửa ra xa số 0 như std::round, Math.sin), xuất qua `@mat/tag-sim`.

### Đồ thị phụ thuộc của Tag tính toán (hai bản)

- [X] T030 [P] Test (viết trước) `packages/expression/src/graph.test.ts` và `core/tag-engine/tests/calc_graph_test.cpp`, cùng bộ ca:
  - thứ tự tô-pô tất định (Kahn; hòa thì theo thứ tự Tag trong `tags.json`);
  - vòng: tự tham chiếu, A ↔ B, vòng gián tiếp ba Tag; báo ở **mỗi** Tag trong vòng, kèm đường vòng `A → B → A`;
  - độ sâu: tầng 1 là Tag tính toán không phụ thuộc Tag tính toán nào; 16 tầng hợp lệ, 17 tầng là `E_EXPR_DEPTH`;
  - danh sách Tag phía sau của mỗi Tag (để engine đánh dấu cần tính lại).
  - **Ghi chú khi làm:** Phần TS xong (`graph.ts`, `graph.test.ts` xanh: thứ tự Kahn, SCC, đường vòng ngắn nhất, tầng, Tag phía sau). Phần C++ (`calc_graph`) còn lại.
  - **Ghi chú khi làm (C++, 2026-10-12):** Phần C++ xong: `core/tag-engine/calc_graph.*` (`mat_calc_graph`), `calc_graph_test` 12 ca cùng bộ ca với TS.
- [X] T031 Cài `packages/expression/src/graph.ts` và `core/tag-engine/calc_graph.{hpp,cpp}`, đạt T030; thêm `calc_graph_test` vào danh sách armhf.
  - **Ghi chú khi làm:** Phần TS xong, C++ còn lại.
  - **Ghi chú khi làm (C++, 2026-10-12):** Cả hai bản xong.

### Định dạng 0.2.0, bộ kiểm tra hai bản, nâng cấp

- [X] T032 Test schema 0.2.0 (viết trước) `packages/project-schema/src/schema.test.ts` và `packages/project-schema/src/meta-schema.test.ts` (bổ sung) ([contracts/project-format-0.2.md](contracts/project-format-0.2.md) §1–§8; data-model §1–§5):
  - `schemas/0.1/*.schema.json` là bản sao đóng băng, giống từng byte bản 0.1 hiện tại (SHA-256 ghi trong test);
  - `schemas/*.schema.json` lên 0.2.0 (`$id` theo phiên bản); có `connections.schema.json`, `value-table.schema.json`, `watch-table.schema.json`; draft-07 hợp lệ;
  - ràng buộc trích nguyên văn data-model, mỗi ràng buộc ít nhất một ca đạt và một ca hỏng:
    - id kênh `^[a-z0-9][a-z0-9-]{0,31}$`; tên bảng giá trị `^[A-Za-z][A-Za-z0-9_]{0,63}$`; id bảng theo dõi `^[a-z0-9][a-z0-9-]{0,47}$`;
    - `description` ≤ 200, `unit` ≤ 16; `serial.baud` 1.200–115.200; `dataBits` 7 | 8; `parity` `none` | `even` | `odd`; `stopBits` 1 | 2;
    - `unitId` 0–255; `slave` 1–247; `timeoutMs` 100–10.000; `retries` 0–5; `writeDeadlineMs` 1.000–60.000; `requestGapMs` 0–1.000; `tcp.connectTimeoutMs` 500–30.000; `tcp.reconnectMaxS` 1–60; nhóm quét 100–60.000 ms;
    - `stringLength` 1–250; `periodMs` số nguyên 100–86.400.000; `phase`, `duty` 0–1; `seed` 0–4.294.967.295;
    - mục bảng giá trị có đúng một trong `value` hoặc (`from` và/hoặc `to`); `color` `#RRGGBB`; `rows` ≤ 200; `decimals` 0–9; `format` `auto` | `dec` | `hex` | `bin` | `bool`;
  - `expression` không có `pattern` (không chạy regex), trần 4.096 byte;
  - transform `valueTable` của binding: `table` tùy chọn, `output` `text` | `color`.
  - **Ghi chú khi làm:** Test mới `schema-02.test.ts` (252 ca) và bổ sung `meta-schema.test.ts` (SHA-256 của 0.1).
- [X] T033 Cài schema: `schemas/0.1/*.schema.json` (chép), `schemas/{project,tag,screen,binding,logging}.schema.json` lên 0.2.0, ba schema mới, `schemas/protocol-version.json` phần `project` thành `["0.1", "0.2"]` (phần `live` đổi ở T067), `schemas/README.md`; đạt T032.
  - **Ghi chú khi làm:** Schema 0.2 dựng bằng `tools/gen-schemas-02.mjs` (giữ lại để thấy khác biệt). `protocol-version.json`: `project` thành mảng ["0.1","0.2"]. Chưa cập nhật `schemas/README.md` và C++.
- [X] T034 [P] Test TS bộ kiểm tra 0.2 (viết trước; FR-006):
  - `packages/project-schema/src/vectors.test.ts` (bổ sung): mọi ca `v02-*` và 82 ca 0.1, cùng tập mã; ca hợp lệ có `files`, `digest` đúng; lỗi biểu thức có `span`;
  - bộ kiểm tra nhận phiên bản runtime làm tham số (mặc định `RUNTIME_VERSION`); test vector truyền `'0.5.0'` cho tới khi T040 nâng hằng;
  - `packages/project-schema/src/project-files.test.ts` (bổ sung): tập file thêm `connectionFile`, `value-tables/<tên>.json`, `watch-tables/<id>.json`;
  - `packages/project-schema/src/format-02.test.ts`: định dạng ghi của Studio (data-model §1): Tag một dòng, khóa theo thứ tự `id, kind, type, description, unit, min, max, access, limits, valueTable, deadband, source, scaling, initial, retain, expression, sim`, không ghi trường bằng mặc định, phần ngoài thụt 2 dấu cách; cùng đầu vào cùng byte.
  - **Ghi chú khi làm:** Test `vectors-02.test.ts`, `project-files.test.ts`, `format-02.test.ts`; `runtimeVersion` là tham số.
- [X] T035 [P] Test C++ bộ kiểm tra 0.2 (viết trước; FR-006) `core/project-manager/tests/project_validator_test.cpp` (bổ sung): mọi ca `v02-*` và 0.1; `LoadedProject::files()` có file mới; chọn bộ schema theo `schemaVersion` (`schemas/0.1/` cho 0.1.x); `E_RUNTIME_TOO_OLD`; phiên bản runtime là tham số (mặc định `kRuntimeVersion`), test vector truyền `"0.5.0"` cho tới khi T040 nâng hằng. `E_SERIAL_NOT_ALLOWED` làm ở US3 (T165).
  - **Ghi chú khi làm (C++, 2026-10-12):** `project_validator_test`: toàn bộ 156 ca `v02-*` + 8 ca lớn `out/` (`node tests/project-vectors/generate.mjs --out` trước; thiếu thì bỏ qua) + 82 ca 0.1, so tập mã lỗi, cảnh báo, `span`, tập file. Một ca đỏ lần đầu (`v02-invalid-schema-version-mixed-logging`, quên so phiên bản `logging.json`) rồi xanh.
- [X] T036 Cài TS bộ kiểm tra 0.2, đạt T034:
  - `packages/project-schema/src/rules-02.ts` (mới; nhánh 0.1 giữ nguyên), `format-02.ts` (mới), sửa `types.ts`, `codes.ts`, `validate.ts`, `project-files.ts`;
  - dùng `@mat/expression` (biên dịch, `graph.ts`) và `@mat/tag-codec` (địa chỉ); `@mat/project-schema` thêm hai phụ thuộc workspace này;
  - export mới trong `src/index.ts` (**file chung với 005**: chỉ thêm dòng);
  - phiên bản runtime là tham số của `validate` (mặc định `RUNTIME_VERSION`); chưa đổi hằng (T040).
  - **Ghi chú khi làm:** Cài `rules-02.ts`, `types-02.ts`, `rtu-estimate.ts`, `format-02.ts`; `validateProject` trả `project02` cho 0.2 (`project` chỉ 0.1, để không vỡ Studio). Phụ thuộc `@mat/expression`, `@mat/tag-codec`.
- [X] T037 Cài C++ bộ kiểm tra 0.2, đạt T035:
  - `core/project-manager/rules_02.{hpp,cpp}` (mới; dùng `mat_expression`, `mat_modbus_codec`, `calc_graph`);
  - sửa `core/project-manager/project_validator.{hpp,cpp}`: chọn luật và schema theo phiên bản; `LoadedProject` thêm `connections.json`, bảng giá trị, bảng theo dõi; `files()` có file mới. 005 T020 đã xong; không task 005 đang mở nào chạm file này;
  - phiên bản runtime là tham số (mặc định `kRuntimeVersion`); chưa đổi hằng (T040).
  - **Ghi chú khi làm (C++, 2026-10-12):** `core/project-manager/rules_02.*` (cùng luật `rules-02.ts`, dùng `mat_expression`, `mat_modbus_codec`, `calc_graph`, `merge_planner`), `project_validator.*` chọn bộ schema theo `schemaVersion` (0.1: `schemas/0.1/`), `validateProject(dir, schemasDir, runtimeVersion = kRuntimeVersion)`, `LoadedProject` thêm `connections`, `valueTables`, `watchTables`, `is02()`, `files()` và `activeJson()` (§11) cho 0.2. `deployment/package-runtime.ps1` chép thêm `schemas/0.1/`.
- [X] T038 [P] Test TS `packages/project-schema/src/migrate.test.ts` (viết trước; [contracts/project-format-0.2.md](contracts/project-format-0.2.md) §9; FR-003, FR-004, FR-005; R3):
  - mọi cặp `tests/migration-vectors/` giống từng byte; chạy hai lần cho cùng byte;
  - lỗi có sẵn từ bản 0.1 được mang sang, `changes` ghi "project gốc có N lỗi"; lỗi mới → không áp, trả lỗi; file không đọc được → không đổi gì, báo lý do;
  - `changes` liệt kê số Tag mock thành Tag mô phỏng `legacy`, runtime tối thiểu 0.5.0, các file sẽ ghi lại;
  - `schemaVersion` mới hơn mức hiểu (0.3.0, 1.0.0) → từ chối, nêu phiên bản Studio cần (FR-005).
  - **Ghi chú khi làm:** `migrate.test.ts` xanh (27).
- [X] T039 Cài `packages/project-schema/src/migrate.ts` (`migrate01to02(files) → { files, changes, backup }`, dùng `format-02.ts`), export trong `src/index.ts`; đạt T038.
  - **Ghi chú khi làm:** `migrate01to02` bất đồng bộ (cần validateProject); trả `{ ok, files, changes, backup }` hoặc `{ ok:false, error }` (ALREADY_02, UNSUPPORTED_VERSION, UNREADABLE, NEW_ERRORS).
- [X] T040 Nâng phiên bản runtime lên 0.5.0 (plan câu 5). **Sau 005 T091, T094** (bộ ghi gói và vector golden của 005); báo phiên 005.
  - `kRuntimeVersion` = `"0.5.0"` (`core/project-manager/project_validator.hpp`) và `RUNTIME_VERSION` = `'0.5.0'` (`packages/project-schema/src/codes.ts`, file chung); `meta-schema.test.ts` (hai hằng bằng nhau) xanh;
  - **test của 005 ghi cứng "0.4.0":** `core/package/tests/zip_writer_test.cpp` (kiểm `generatorVersion` của `ReaderReadsItBack`, manifest mong đợi của `ManifestTextHasAFixedForm`) đổi sang `kRuntimeVersion`; vector golden `valid-device-tank-demo` giữ `"0.4.0"` cố định như test đang ghi;
  - grep "0.4.0" trong `server`, `core`, `packages`, `apps`, `tests`, `deployment`: chỉ còn chỗ đúng nghĩa (ngưỡng `ONLINE_RUNTIME` của Studio, dữ liệu giả của test, `minRuntimeVersion` của project); ghi danh sách vào ghi chú khi làm, như T023 của 005;
  - test vector của T034, T035 về dùng hằng mặc định; cả bộ x64, Vitest xanh;
  - từ task này, cây làm việc là runtime 0.5.0: xem quy ước "Cắt bản phát hành của 005".
  - **Ghi chú khi làm (C++, 2026-10-12):** `kRuntimeVersion` và `RUNTIME_VERSION` = 0.5.0. Sửa `zip_writer_test.cpp` (hai chỗ ghi cứng, golden vẫn "0.4.0"), thêm `diagnostics_audit_api_test.cpp` (chỗ thứ ba, so `versions.runtime`), `smoke-armhf.sh` (API 1.1.0), `vectors-02.test.ts` dùng hằng mặc định. Còn "0.4.0" đúng nghĩa: dữ liệu giả của test discovery/health/project-store, `ONLINE_RUNTIME` và mock của Studio, test live-client; `apps/runtime-web` chỉ trong chú thích. Cả bộ x64 (1.622 test), Vitest xanh.
- [ ] T041 `tools/project-validator/validate.mjs` và `projects/modbus-demo/` (0.2.0; quickstart §0), sau T040 (`validate:project` dùng hằng phiên bản mặc định):
  - **test viết trước** `tools/project-validator/validate.test.mjs` (`node --test`): `tank-demo` (0.1) hợp lệ; `--migrate <thư mục 0.1> <thư mục ra>` của `tank-demo` cho đúng `tests/migration-vectors/tank-demo/after/`; project 0.2 lỗi in mã như vector; đỏ trước khi sửa;
  - `validate.mjs` (sửa): kiểm 0.1 và 0.2 theo `schemaVersion`; thêm `--migrate`;
  - `projects/modbus-demo/`:
    - kênh Modbus TCP tới giả lập (`127.0.0.1:1502`) và kênh RTU `ttyAS2` `enabled: false` (bật trong test pty);
    - đủ bốn loại Tag: đủ kiểu, 4 thứ tự byte, bit trong thanh ghi, STRING, scaling (`TANK01.LEVEL` như US1-10), deadband, Tag RW có `limits` (`TANK01.SP` 0–90), Tag lệnh xung `readback: false`, Tag nội bộ giữ qua mất điện, Tag tính toán của US4;
    - bảng giá trị `TrangThaiBom`, bảng theo dõi `van-hanh` ("Vận hành"); màn hình của `tank-demo` thêm binding `valueTable`;
  - `npm run validate:project` (root `package.json`, **file chung với 005**) kiểm cả `projects/tank-demo` và `projects/modbus-demo`; xanh ở hai bản (vector; `--check-project` C++ sau T060);
  - bước `tools (node --test)` trong `tools/ci-local.ps1` và job `web` của `.github/workflows/ci.yml` (**file chung với 005**), chạy `node --test tools/project-validator` (T096 thêm `tools/modbus-sim`).

### Tag Engine v1 (C++, ADR-017)

- [X] T042 [P] Test `core/tag-engine/tests/tag_store_test.cpp` (bổ sung, viết trước; data-model §6). Không có task 005 nào chạm `tag_store.*`.
  - `reason` lưu cùng giá trị; đổi lý do mà không đổi giá trị hay quality vẫn đánh dấu đổi;
  - `applyBatch` ghi nhiều Tag dưới một lần khóa: một luồng đọc `snapshot` lặp liên tục không bao giờ thấy trạng thái nửa chừng;
  - `revision`, `takeDirty()` như cũ; test cũ của Sprint 1 xanh.
  - **Ghi chú khi làm (C++, 2026-10-12):** Test `TagStoreReason`, `TagStoreBatch` (có luồng đọc `snapshot` liên tục, 20.000 vòng, 0 trạng thái nửa chừng).
- [X] T043 Cài `core/tag-engine/tag_store.{hpp,cpp}` (`reason`, `applyBatch`), đạt T042. JSON có `reason` làm ở T067 (live 1.2.0).
  - **Ghi chú khi làm (C++, 2026-10-12):** `TagValue::reason`, `set(…, reason, …)`, `applyBatch`; JSON snapshot và delta có lý do (T067).
- [X] T044 [P] Test `core/tag-engine/tests/tag_model_test.cpp` (viết trước; data-model §1–§5; FR-002, FR-009):
  - đọc Tag v1 từ `LoadedProject` 0.2, mặc định: `access` R, `scanGroup` normal, `rawType` = `type`, `byteOrder` của thiết bị trường, `readback` true, `retain` false, `initial` 0 / false / "";
  - phân giải `source.device` → (kênh, thiết bị trường), vùng, offset theo `addressBase`, số thanh ghi;
  - project 0.1 → Tag `simulation` bộ sinh `legacy`; file và digest không đổi;
  - kênh hay thiết bị trường tắt được đánh dấu.
  - **Ghi chú khi làm (C++, 2026-10-12):** `tag_model_test` 9 ca: mặc định, địa chỉ theo `addressBase`, nhóm quét, kênh/thiết bị tắt, nội bộ/tính toán/mô phỏng, scaling, project 0.1 thành `legacy` (file và digest không đổi), vector `v02-valid-full`.
- [X] T045 Cài `core/tag-engine/tag_model.{hpp,cpp}` (target `mat_tag_engine`), đạt T044.
  - **Ghi chú khi làm (C++, 2026-10-12):** `core/tag-engine/tag_model.*` (`buildProjectModel`).
- [X] T046 [P] Test `core/tag-engine/tests/engine_test.cpp` (viết trước; research R5, R6; FR-010, FR-011, FR-012, FR-016, FR-019). Đồng hồ giả, driver giả gọi `EngineSink`:
  - **một lượt:** tráo hộp nhận; Tag ngoài: scaling; NaN, ±∞ → BAD `INVALID_VALUE`, giữ giá trị cuối; `clamp` → UNCERTAIN `CLAMPED`;
  - **deadband:** phát khi `|mới − đã phát| > deadband`; đổi quality hoặc lý do luôn phát; deadband 0 phát mọi thay đổi; giá trị đọc lại sau ghi luôn phát, không xét deadband;
  - **Tag mô phỏng** theo `now`; **Tag nội bộ** có `initial` và nhận lệnh đặt qua hộp nhận (để US2 dùng);
  - **Tag tính toán:**
    - một lần theo thứ tự tô-pô, chỉ Tag có đầu vào đổi (giá trị hoặc quality);
    - A phụ thuộc B phụ thuộc C trong cùng lượt: client không thấy giá trị trung gian (US4-4);
    - gán kết quả theo bảng contract expression-language §3; lỗi khi tính → BAD kèm lý do, giữ giá trị cuối, tự hết khi đầu vào hợp lệ (US4-5, US4-6);
  - **một `applyBatch` mỗi lượt:** luồng historian đọc `snapshot` trong lúc chạy lượt không thấy trạng thái nửa chừng;
  - **khởi động:** Tag ngoài BAD `NO_VALUE` tới lần đọc đầu; Tag tính toán BAD `NO_VALUE` tới khi đủ đầu vào; kênh tắt → `DISABLED`;
  - **FR-002, SC-009, US1-2:** `tank-demo` (0.1) qua engine với bộ sinh `legacy` cho đúng chuỗi giá trị và quality của `MockTagProvider` chạy thẳng như runtime 0.4, ở cùng 500 thời điểm; bản đã nâng cấp (`tests/migration-vectors/tank-demo/after/`) cho cùng chuỗi đó.
  - **Ghi chú khi làm (C++, 2026-10-12):** `engine_test` 19 ca, trong đó so 500 thời điểm × 5 Tag: engine + `legacy` cho đúng chuỗi của `MockTagProvider` (0 khác biệt), và bản đã nâng cấp `tests/migration-vectors/valid-tank-demo/after/` cho cùng chuỗi (đường dẫn thật là `valid-tank-demo`, không phải `tank-demo`). Bắt được một lỗi: Tag mô phỏng không được ép FLOAT32 (runtime 0.4 giữ số thực 64 bit).
- [X] T047 Cài `core/tag-engine/engine.{hpp,cpp}` (hộp nhận khóa bằng mutex; `step(now)`), đạt T046; thêm `tag_model_test`, `engine_test` vào danh sách armhf.
  - **Ghi chú khi làm (C++, 2026-10-12):** `core/tag-engine/engine.*`, `sim_factory.*`. Một `applyBatch` mỗi lượt; Tag tính toán tô-pô một lần, chỉ tính khi đầu vào đổi; deadband; `afterWrite` ép phát. `retain_store` cũng nối ở đây (xem T174, T175).

### Driver SDK (ADR-014)

- [X] T048 `drivers/sdk/driver.hpp` (FR-023; Constitution II; [contracts/modbus-driver.md](contracts/modbus-driver.md) §1; research R7): `EngineSink`, `Driver`, `TagBinding`, `TagUpdate`, `WriteCommand`, `WriteResult`, `LinkState`, `DriverDiag`, `TestRequest`, `TestOutcome`; chỉ khai báo. Bộ test chuẩn `drivers/sdk/tests/driver_conformance.hpp` (`TYPED_TEST_SUITE`, contract §11 mục 1–7), viết trước mọi driver:
  - backend giả `ConformanceBackend`: đặt giá trị, ngừng trả lời, tiêm lỗi, đếm byte trên đường truyền;
  - các mục: `NO_VALUE` trước lần đọc đầu; giá trị khớp backend mọi kiểu và thứ tự; backend hỏng → BAD có lý do trong ≤ 2 chu kỳ, có lại → GOOD không khởi động lại; đủ kết quả ghi của data-model §8 (mục 4 bật ở US2); tắt → `DISABLED` và 0 byte; sau `stop()` không gọi `EngineSink`, luồng đã join; số đếm chẩn đoán khớp lỗi đã tiêm.
  - **Ghi chú khi làm (C++, 2026-10-12):** `drivers/sdk/driver.hpp` (giao diện, `TagBinding`, `WriteCommand`, `DiagCounters`…) và `driver_conformance.hpp` (7 mục; mục 3, 5, 7 bỏ qua với driver không có đường truyền, dành cho Modbus).
- [X] T049 [P] Test `drivers/sdk/tests/merge_planner_test.cpp` (viết trước; FR-024, FR-025; contract §7; research R8):
  - ca US1-6: 50 FLOAT32 liền nhau → 1 yêu cầu 100 thanh ghi; 130 thanh ghi → 2 yêu cầu; vùng bit (2.000 bit);
  - test thuộc tính, hạt giống cố định: mỗi Tag nằm trọn trong đúng một khối; khối ≤ `maxLen`; khoảng trống ≤ `maxGap`; với ≤ 8 Tag, số khối bằng kết quả vét cạn; `maxGap` 0 chỉ gộp liền nhau;
  - hai Tag cùng địa chỉ, khoảng chồng nhau: cùng khối, đọc một lần;
  - tách khi 02/03: chia tại khoảng trống lớn nhất (bằng nhau thì gần giữa nhất), không có khoảng trống thì tại ranh giới Tag gần giữa nhất; khối một Tag → Tag đó BAD `EXCEPTION_02`/`03`, khối vẫn đọc mỗi lượt; hội tụ ≤ ⌈log₂ n⌉ lượt (một lỗ, nhiều lỗ, lỗ trong khoảng trống); kế hoạch đã tách giữ tới khi kết nối lại hoặc đổi project.
  - **Ghi chú khi làm (C++, 2026-10-12):** Đỏ ở mức biên dịch rồi xanh: 15 ca, kể cả thuộc tính ngẫu nhiên (hạt giống cố định) so với vét cạn ≤ 8 Tag, hội tụ ≤ ⌈log₂ n⌉ lượt. Ngoại lệ ghi rõ: chuỗi chồng nhau dài hơn `maxLen` có thể bị cắt (validator chặn Tag dài hơn `maxLen`).
- [X] T050 [P] Test `drivers/sdk/tests/scheduler_test.cpp` (viết trước; FR-017; contract §5; đồng hồ giả):
  - vòng của (thiết bị trường, nhóm quét) đến hạn ở `t0 + k × chu kỳ`; chọn việc: lệnh ghi trước, rồi khối có hạn sớm nhất;
  - không dồn lượt: trễ hơn một chu kỳ thì bỏ lượt đã lỡ, tăng `overruns`;
  - chu kỳ thực = khoảng giữa hai lần bắt đầu vòng; trung bình và lớn nhất trong 60 s; `overloaded` khi trung bình > 110 % chu kỳ đặt;
  - `requestGapMs`; thiết bị trường tạm ngưng chỉ được hỏi thử một khối (khối đầu của nhóm thường) mỗi 10 s.
  - **Ghi chú khi làm (C++, 2026-10-12):** `scheduler_test` 14 ca với đồng hồ giả.
- [X] T051 [P] Test `drivers/sdk/tests/backoff_test.cpp` và `drivers/sdk/tests/diag_counters_test.cpp` (viết trước; FR-027, FR-029; R9):
  - `d_n = max(1 s, min(trần, 2ⁿ s) × (1 − 0,2·u))`: lần đầu đúng 1 s; từ lần thứ 5 trong 8–10 s; trần đặt được 1–60 s; `u` tiêm được;
  - số đếm nguyên tử: kênh (`state`, `lastError`, `reconnects`, `warnings`), thiết bị trường (`requestsOk`, `timeouts`, `exceptions` theo mã, `badFrames` theo loại, `responseMs` EWMA và lớn nhất 60 s, `writes`), nhóm quét; bản chụp đọc được từ luồng khác trong lúc ghi (test luồng); không có lệnh đặt lại (D28).
  - **Ghi chú khi làm (C++, 2026-10-12):** `backoff_test` 7 ca, `diag_counters_test` 5 ca (có test luồng).
- [X] T052 [P] Cài `drivers/sdk/merge_planner.{hpp,cpp}` (tạo target `mat_drivers`), đạt T049.
  - **Ghi chú khi làm (C++, 2026-10-12):** `drivers/sdk/merge_planner.*` (`mat_merge_planner`).
- [X] T053 [P] Cài `drivers/sdk/scheduler.{hpp,cpp}`, đạt T050.
  - **Ghi chú khi làm (C++, 2026-10-12):** `drivers/sdk/scheduler.*` (`mat_drivers`).
- [X] T054 [P] Cài `drivers/sdk/{backoff,diag_counters}.{hpp,cpp}`, đạt T051; thêm các test SDK vào danh sách armhf.
  - **Ghi chú khi làm (C++, 2026-10-12):** `backoff.*`, `diag.*`.
- [X] T055 Test `drivers/simulation/tests/simulation_driver_test.cpp` (viết trước): bộ test chuẩn T048 với `simulation` (không kênh, không luồng; engine gọi `step(now)`); bộ sinh và `legacy` phát qua `EngineSink`; tải `SIM.*` (`simLoad`) giữ nguyên; `mock_tag_provider_test` của Sprint 1 vẫn xanh.
  - **Ghi chú khi làm (C++, 2026-10-12):** `simulation_driver_test` 12 ca (bộ test chuẩn + ca riêng); `mock_tag_provider_test` của Sprint 1 vẫn xanh.
- [X] T056 Cài `drivers/simulation/simulation_driver.{hpp,cpp}`; sửa `drivers/simulation/mock_tag_provider.{hpp,cpp}` để phát qua `EngineSink` thay `TagStore::set`, giữ thuật toán và hằng số; đạt T055.
  - **Ghi chú khi làm (C++, 2026-10-12):** `SimulationDriver`; `MockTagProvider` giữ API cũ nhưng phát qua `EngineSink` (`StoreSink`), thuật toán là lớp `LegacyMock`.

### Cấu hình BL335

- [X] T057 [P] Test `server/tests/config_test.cpp` (bổ sung, viết trước; [contracts/device-config.md](contracts/device-config.md) §1). **File chung với 005**: không task 005 đang mở nào chạm `server/config.*`; báo phiên 005.
  - `serialPorts` (mặc định `["ttyAS*"]` ⏸ §8; mục là tên `tty…` có thể có `*` cuối, hoặc đường dẫn `/dev/serial/by-id/…`, `/dev/serial/by-path/…` đúng tên; mục sai → thoát mã 2);
  - `viewerAccess` `private` | `any` | `off` (mặc định `private`); `retainWindowS` 1–60 (5); `retainDir` (`<dataDir>/retain`);
  - `tagWriteSessionBurst` 1–10 (10), `tagWriteSessionPerMin` 1–20 (20), `tagWriteGlobalBurst` 1–20 (20), `tagWriteGlobalPerMin` 1–30 (**20**, tạm, plan câu 3), `tagWriteQueuePerChannel` 1–64 (16), `tagWriteQueueTotal` 1–256 (64);
  - tham số dòng lệnh `--serial-ports`, `--viewer-access`, `--retain-dir`;
  - `deployment/config/runtime.json` đang dùng trên BL335 vẫn nạp được; khóa lạ vẫn thoát mã 2.
  - **Ghi chú khi làm (C++, 2026-10-12):** `config_test` thêm 8 ca (Config006).
- [X] T058 Cài khóa mới trong `server/config.{hpp,cpp}`, đạt T057.
  - **Ghi chú khi làm (C++, 2026-10-12):** Khóa mới trong `server/config.*`: `serialPorts`, `viewerAccess`, `retainWindowS`, `retainDir`, sáu khóa `tagWrite*`; tham số `--serial-ports`, `--viewer-access`, `--retain-dir`.

### Nối Tag Engine vào runtime

- [X] T059 Test `server/tests/runtime_engine_test.cpp` (viết trước; contract device-config §7). Phần dựng runtime tách khỏi `main.cpp` vào `server/runtime_engine.{hpp,cpp}` để test không cần CivetWeb:
  - thứ tự khởi động bước 4 mới: dựng engine (Tag v1, kế hoạch đọc, thứ tự tô-pô), lượt engine đầu; bước 6: chạy luồng các driver;
  - `engine.step(now)` chạy ngay trước `hub.tick()` trên cùng vòng tick; project 0.1 → bộ sinh `legacy`; project lỗi không kích hoạt;
  - dừng: driver `stop()` (đóng kết nối, nhả cổng) trước các bước của 005.
  - **Ghi chú khi làm (C++, 2026-10-12):** `server/tests/runtime_engine_test.cpp` 10 ca (thứ tự khởi động, vòng engine trước `hub.tick()`, project 0.1 + SIM.*, project lỗi, lưu bền).
- [X] T060 Cài `server/runtime_engine.{hpp,cpp}` và nối vào `server/main.cpp`: thay `MockTagProvider provider; … provider.step(…)` bằng `RuntimeEngine` (`engine.step(now); hub.tick();`); đạt T059. **Sau 005 T044, T108.** T047, T060, T142, T146 của 005 cũng sửa `main.cpp`: chỉ thêm khối, báo phiên 005.
  - **Ghi chú khi làm (C++, 2026-10-12):** `server/runtime_engine.*` và nối vào `server/main.cpp` (`parts.engine` dừng trước `execv`). `startup.cpp` chuyển sang thư viện `mat_startup` (tránh vòng phụ thuộc); `activateProject` tự dựng mô hình. Chưa làm: luồng kênh của driver Modbus.
- [X] T061 Kiểm SC-009 (FR-002): runtime 0.5 (x64 và armhf) chạy project 0.1:
  - kiểm tự động của Sprint 1: `test-x64.ps1`; `tools/measure/{runtime-smoke,http-check,reconnect-check}.mjs`; `tools/load-tester` 500 Tag `SIM.*`, 10 client, 5 phút trên x64;
  - kiểm tự động của 003: `tools/historian-it.ps1`, `smoke-armhf.sh` với `tank-demo`;
  - giá trị Tag giống runtime 0.4 (T046 đã so); `system/info` như 0.4 trừ `runtimeVersion`;
  - ghi `docs/reports/006-acceptance.md`.
  - **Ghi chú khi làm (C++, 2026-10-12):** Chưa nghiệm thu đủ. Có: toàn bộ x64 (1.622 test), smoke armhf qemu với `tank-demo` (505 Tag), 500 Tag mô phỏng/10 client/90 s trên x64: RSS 11,5 MB lúc rảnh, 14,0 MB khi tải, CPU 0,6 % một lõi. Chưa chạy: `tools/measure/*.mjs`, `historian-it.ps1`, tải 5 phút.

### Lọc nguồn (FR-055a, ADR-018) và giao thức live 1.2.0

- [X] T062 [P] Test `server/tests/source_filter_test.cpp` (viết trước; research R19; [contracts/device-api-1.1.md](contracts/device-api-1.1.md) §1.2), hàm thuần:
  - `isPrivateSource(addr)` với 9 dải và biên: `10.255.255.255`/`11.0.0.0`, `172.15.255.255`/`172.16.0.0`/`172.31.255.255`/`172.32.0.0`, `100.63.255.255`/`100.64.0.0`/`100.127.255.255`/`100.128.0.0`, `169.254.x.x`, `127.x.x.x`, `192.168.x.x`, `fc00::/7`, `fe80::/10`, `::1`; IPv4 ánh xạ `::ffff:a.b.c.d` xét như IPv4; chuỗi sai dạng → không phải mạng riêng;
  - quyết định theo bảng contract §1.2: `viewerAccess` × loại đường dẫn (trang, `/assets/*`, `/project/*`, `system/info`, `projects/active`, live) × có phiên hợp lệ hay không × listener × loopback. `off` vẫn phục vụ `system/info` cho mạng riêng và loopback;
  - `device/identity`, `auth/*` và mọi API kỹ thuật không bị lọc;
  - phản hồi 403: trang HTML ngắn tiếng Việt (UTF-8, CSP `default-src 'none'`); API `{ "error": "SOURCE_NOT_ALLOWED" | "VIEWER_OFF", "message" }`;
  - không audit; tăng `blockedTotal`, `lastBlockedAt`.
  - **Ghi chú khi làm (C++, 2026-10-12):** `source_filter_test` 14 ca.
- [X] T063 Cài `server/http/source_filter.{hpp,cpp}` (thuần, không include CivetWeb), đạt T062.
  - **Ghi chú khi làm (C++, 2026-10-12):** `server/http/source_filter.*` (thuần).
- [X] T064 Test `server/tests/viewer_access_test.cpp` (viết trước; CivetWeb trong tiến trình, hai context của `server/http/web_contexts.*`, **sau 005 T044**; hàm phân loại nguồn tiêm được):
  - mọi đường dẫn bị lọc, trên cả HTTP và HTTPS, trả 403 cho nguồn công cộng giả; mạng riêng và loopback như cũ;
  - HTTPS kèm `Authorization: Bearer` hợp lệ (đúng IP lúc đăng nhập) không bị lọc; kiểm kiểu "nhìn", không làm mới hạn phiên; `Authorization` qua HTTP → 403 `HTTPS_REQUIRED`;
  - `system/info`: `device.viewerAccess`; `warnings: ["VIEWER_PUBLIC"]` khi `any`; không có thông tin kênh, IP PLC, tài khoản.
  - **Ghi chú khi làm (C++, 2026-10-12):** `viewer_access_test` 9 ca trên HTTP và HTTPS, cộng `ViewerGate` có móc thử (địa chỉ nguồn giả).
- [X] T065 Cài lọc nguồn trong `server/http/http_api.{hpp,cpp}` và `server/http/web_contexts.{hpp,cpp}` (callback `begin_request` cho file tĩnh của trang xem), `system/info.device.viewerAccess` và `warnings`; đạt T064. **Sau 005 T044.** Bộ đếm đưa ra `GET /api/v1/diagnostics` ở US5 (T195).
  - **Ghi chú khi làm (C++, 2026-10-12):** Lọc trong `http_api.*` (trang, assets, project, system/info, projects/active); `system/info.device.viewerAccess` và `warnings: ["VIEWER_PUBLIC"]`; `kDeviceApiVersion` 1.1.0. Chưa nối bộ đếm vào `GET /api/v1/diagnostics` (T195).
- [X] T066 Test live 1.2.0 (viết trước; [contracts/live-protocol-1.2.md](contracts/live-protocol-1.2.md) §1–§4, §6), bổ sung `server/websocket/tests/live_hub_test.cpp` và `server/websocket/tests/civet_transport_test.cpp`. **Sau 005 T105, T106.**
  - `hello.protocolVersion` = `"1.2.0"`; `schemas/protocol-version.json` có `live` bằng `kLiveProtocolVersion` (test đọc file);
  - snapshot có `reason` khi quality khác GOOD, không có khi GOOD; delta thêm vị trí thứ tư khi khác GOOD; đổi lý do sinh delta. Sửa kỳ vọng cũ có delta BAD (nay có thêm lý do);
  - bản tin `{"type":"write"}` → `error` `BAD_MESSAGE`, gọi móc `onRejectedWrite(tag?, value?, source)` (nối audit ở T145);
  - nâng cấp WebSocket:
    - token trên HTTP → 403, không lấy slot;
    - token hợp lệ trên HTTPS từ nguồn công cộng giả → nhận;
    - không token từ nguồn công cộng → 403, không tốn slot;
    - token hết hạn hoặc bị thu hồi → đóng 4401 trong ≤ 60 s (đồng hồ giả); kết nối từ mạng riêng không bị đóng;
  - giới hạn 10 phiên tính chung có và không có token (4429); `Origin` như ADR-006;
  - client đọc delta kiểu 1.1 (`[i, v, q]`) với máy chủ 1.2 không hỏng.
  - **Ghi chú khi làm (C++, 2026-10-12):** Thêm 4 ca `live_hub_test` và 9 ca `CivetTransportGate`; sửa kỳ vọng `1.1.0` → hằng. Kênh live qua TLS thật chưa thử (dùng móc `tls`).
- [X] T067 Cài, đạt T066:
  - `kLiveProtocolVersion` 1.2.0 và `reason` trong `server/websocket/live_hub.{hpp,cpp}`; JSON có `reason` trong `core/tag-engine/tag_store.cpp`;
  - `SessionPeek` tiêm vào `server/websocket/civet_transport.{hpp,cpp}`; kiểm lại phiên mỗi 60 s, đóng 4401;
  - `schemas/protocol-version.json` → `{ "live": "1.2.0", "project": ["0.1", "0.2"] }`.
  - **Ghi chú khi làm (C++, 2026-10-12):** `kLiveProtocolVersion` 1.2.0, `reason` trong snapshot và delta (bỏ khi lý do rỗng), `ViewerGate` trong `CivetLiveTransport` (403 trước slot, 4401 sau ≤ 60 s), `schemas/protocol-version.json`. Móc `setRejectedWriteHook` có, chưa nối audit (T145).
- [X] T068 [P] Test TS `packages/live-client/src/connection.test.ts` và `packages/live-client/src/state.test.ts` (bổ sung, viết trước; **sau 005 T101, T102**): đọc `reason` từ snapshot và delta, bỏ qua khi thiếu; mã lạ giữ nguyên để giao diện hiện "không rõ" kèm mã; 4401 gọi `onSessionEnded` thay vì tự kết nối lại; 1012 của 005 giữ nguyên.
  **Ghi chú khi làm (Studio, 2026-10-12):** đỏ: 8 test (reason ở snapshot/delta, mã lạ giữ nguyên, 4401 `onSessionEnded` không tự kết nối lại, 1012 của 005 giữ nguyên) rồi xanh: 64 test live-client.
- [X] T069 Cài `packages/live-client/src/{connection,state}.ts` (giao diện công khai chỉ thêm, không đổi), đạt T068.
  **Ghi chú khi làm (Studio, 2026-10-12):** xong, đạt T068: `LiveState.reasons`, `TagChange.reason?`, `ConnState` thêm `session-ended`, `onSessionEnded`, `CLOSE_SESSION_ENDED = 4401`; giao diện công khai chỉ thêm.
- [X] T070 [P] Test Rust `apps/studio/src-tauri/src/device/live.rs` (viết trước; [contracts/tauri-commands-006.md](contracts/tauri-commands-006.md) §1; **sau 005 T085a**, đã xong). **Sửa kỳ vọng của test T070 của 005** ("không gửi token") trong cùng task:
  - `{ id }` khi Rust giữ phiên → request nâng cấp có `Authorization: Bearer <token>`, header đánh dấu `sensitive`; chưa đăng nhập → không có; `{ address }` (`ws`) → không bao giờ có; `Origin` vẫn không gửi;
  - đóng 4401 → sự kiện `close` lý do `session-ended`; bắt tay `ws` bị 403 → 1006 lý do `viewer-private`;
  - phiên làm mới sau đăng nhập lại: lần mở sau dùng token mới, kết nối đang mở giữ nguyên;
  - máy chủ thử ghi lại header nhận được để so.
  **Ghi chú khi làm (Studio, 2026-10-12):** đỏ (không biên dịch: thiếu `token` ở `LiveEndpoint::Wss`) rồi xanh. Đã sửa kỳ vọng test T070 của 005 (có token khi đã đăng nhập, không có khi chưa hoặc theo dõi bằng địa chỉ). Thêm 4 test: không phiên, 4401 `session-ended`, 403 → `viewer-private`/`viewer-off`/`http`, phiên mới có token mới. `test_support::ws_server` thêm lệnh `end-session` (đóng 4401).
- [X] T071 Cài `apps/studio/src-tauri/src/device/live.rs` (`url.into_client_request()`, thêm header, `client_async_with_config`), đạt T070; `cargo test --lib`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check` xanh.
  **Ghi chú khi làm (Studio, 2026-10-12):** xong, đạt T070: `url.into_client_request()`, header `Authorization` đánh dấu `sensitive` chuyển qua byte, `client_async_with_config`; `Debug` của endpoint không in token. Mã 4401 báo lý do `session-ended`; 403 của bắt tay đọc `error` trong thân. Kiểm cuối lô: `cargo test --lib`, clippy, fmt.
- [X] T072 [P] Test Rust trong `apps/studio/src-tauri/src/device/http.rs` (viết trước; contract tauri-commands-006 §2, §4; **sau 005 T085b**): `monitor_get` và `device_get`: 403 `SOURCE_NOT_ALLOWED` → `viewer-private`; 403 `VIEWER_OFF` → `viewer-off`.
  **Ghi chú khi làm (Studio, 2026-10-12):** đỏ rồi xanh: `monitor_get` và `device_get` ánh xạ 403 `SOURCE_NOT_ALLOWED` → `viewer-private`, `VIEWER_OFF` → `viewer-off`, 404 `NO_SUCH_REQUEST` → `no-such-request`; 403 khác vẫn `forbidden`/`{ http: 403 }`. Đã sửa test cũ `only_the_paths_of_the_contract` (đường dẫn mới của 006 chuyển từ "bad" sang "ok").
- [X] T073 Cài ánh xạ lỗi trong `apps/studio/src-tauri/src/device/http.rs`, đạt T072.
  **Ghi chú khi làm (Studio, 2026-10-12):** xong, đạt T072: `DeviceError::{ViewerPrivate, ViewerOff, NoSuchRequest}`, `session::api_failure`, thân 403 của `monitor_get`.
- [ ] T074 `tools/driver-it.ps1` và `tests/driver-it/`: khung kiểm tích hợp x64, cách làm như `tools/device-it.ps1` của 005. **Sau 005 T047, T051.**
  - `tests/driver-it/compose.yaml`: mạng riêng `172.30.6.0/24` và mạng "công cộng" `203.0.113.0/24` (dải tài liệu); runtime x64 (image `mat-armhf`, build `-DMAT_TEST_HOOKS=ON` ở `build/x64-it`; cờ này do 005 T108 thêm, kịch bản `source` không cần nó) dưới vòng giám sát (dùng lại `tests/device-it/supervise.sh`); client Node ở cả hai mạng; chỗ cho giả lập Node (`node:24-slim`, ghim digest; T110);
  - tài khoản thử tạo bằng `--user-add … --password-stdin`, mật khẩu ngẫu nhiên mỗi lần; không ghi ra file trong repo;
  - tham số `-Scenario <tên>[,<tên>]`, `-Rounds`, `-Keep`; kết quả `docs/reports/006-<scenario>-x64.json`;
  - **kịch bản `source`** (SC-022, quickstart §3): từ 203.0.113.x, trang, `system/info`, `projects/active`, live không phiên → 403; live có phiên → chạy; từ 172.x như cũ; `viewerAccess: any` → xem được, `system/info.warnings` có `VIEWER_PUBLIC`; `off` → trang và live 403, `system/info` vẫn phục vụ mạng riêng;
  - bước `driver-it (source)` trong `tools/ci-local.ps1` (**file chung với 005**); dòng `node:24-slim` (MIT, digest) trong `third_party/LICENSES.md` mục công cụ test;
  - thêm glob `tests/driver-it/*.mjs`.

### Nền Studio

- [X] T075 [P] Test `apps/studio/src/i18n/i18n.test.ts` và `apps/studio/src/app/device-errors.test.ts` (bổ sung, viết trước): mọi mã có chuỗi tiếng Việt:
  - mã lý do của data-model §6, kể cả câu "không rõ" kèm mã cho mã lạ;
  - exception 01–0B ([contracts/modbus-driver.md](contracts/modbus-driver.md) §4, ví dụ "02: địa chỉ không hợp lệ");
  - mã lỗi và cảnh báo 0.2 (contract project-format-0.2 §7); lỗi biểu thức (contract expression-language §6);
  - mã kết quả ghi (mã `REJECTED` theo bước, `NOT_SENT_*`, `NO_READBACK` "thiết bị xác nhận, không đọc lại", `TIMEOUT` "không chắc đã ghi"…); mã Thử kết nối;
  - lỗi Rust mới: `viewer-private`, `viewer-off`, `no-such-request`, `session-ended`, `too-large`;
  - luật lint "chữ tiếng Việt chỉ trong `i18n/`" vẫn đạt.
  **Ghi chú khi làm (Studio, 2026-10-12):** đỏ rồi xanh: `app/code-text.test.ts` (mã lý do của Tag kể cả mã lạ "không rõ (MÃ)", exception 01–0B, 40 mã lỗi và cảnh báo 0.2, lỗi biểu thức, mã kết quả ghi, mã Thử kết nối) và `device-errors.test.ts` (bốn mã Rust mới). Test `i18n.test.ts` và lint "chữ tiếng Việt chỉ trong i18n/" vẫn xanh.
- [X] T076 Cài `apps/studio/src/i18n/vi-tags2.ts`, gộp vào `apps/studio/src/i18n/vi.ts`; câu cho lỗi mới trong `apps/studio/src/app/device-errors.ts`; đạt T075.
  **Ghi chú khi làm (Studio, 2026-10-12):** xong, đạt T075: `i18n/vi-tags2.ts` gộp vào `vi.ts`, hàm tra ở `app/code-text.ts` (`reasonText`, `exceptionText`, `issueText`, `writeCodeText`, `writeStatusText`, `probeCodeText`); câu cho lỗi mới trong `device-errors.ts`. Chuỗi riêng của lưới ở `vi-grid.ts`.
- [X] T077 [P] Test Rust trong `apps/studio/src-tauri/src/project_fs.rs` (viết trước; contract tauri-commands-006 §5). Không task 005 đang mở nào chạm file này.
  - `project_backup({ files: [{ rel, hash }], label })`: chép đúng các file vào thư mục mới `.mat-backup/<label>-<UTC yyyyMMddTHHmmssZ>/`, giữ đường dẫn tương đối; ghi `backup.json` (data-model §12); đọc lại so SHA-256; `label` theo `^[0-9]+\.[0-9]+\.[0-9]+$`; lỗi `exists` (không bao giờ ghi đè), `{ changed: rel }`, `bad-path`, `no-project`, `{ io }`; trả `{ dir, abs }`;
  - `project_write` tạo thư mục cha còn thiếu trong thư mục project (sâu ≤ 8; mỗi cấp không phải symlink hay junction trỏ ra ngoài); luật cũ của 004 giữ nguyên;
  - `project_remove({ rel, hash })`: xóa file `.json` khi hash khớp; không xóa `project.json`, `tagFile`; lỗi `{ changed }`, `missing`, `bad-path`, `{ io }`.
  **Ghi chú khi làm (Studio, 2026-10-12):** đỏ (không biên dịch) rồi xanh: 5 test mới ở `project_fs.rs` (tạo thư mục cha ≤ 8 cấp, junction ở cấp cha bị chặn, `project_backup` chép + `backup.json` + đọc lại so hash + không ghi đè + `changed`/`bad-path`, `project_remove` bảo vệ `project.json` và `tagFile`, tên lỗi IPC). Test cũ `writes_atomically_and_only_json` đổi theo luật mới (cha còn thiếu được tạo).
- [X] T078 Cài ba lệnh trong `apps/studio/src-tauri/src/project_fs.rs`, đạt T077; đăng ký trong `invoke_handler` của `lib.rs` (**sau 005 T117, T129**); hàm tương ứng trong `apps/studio/src/platform/{types,tauri,mock}.ts`.
  **Ghi chú khi làm (Studio, 2026-10-12):** xong, đạt T077: `project_backup`, `project_remove`, `csv_open`, `csv_save`, `device_post` đăng ký trong `invoke_handler`; `Platform.{projectBackup, projectRemove, csvOpen, csvSave}` ở `platform/{types,tauri,mock}.ts` (đỏ rồi xanh, 11 test mới ở `platform.test.ts`). Bản giả ghi lại `control.{removes, backups, savedCsv}` cho e2e.
- [X] T079 Test `apps/studio/src/model/project-doc.test.ts` (bổ sung, viết trước; **sau 005 T133**; data-model §13.1):
  - tài liệu sửa được theo đối tượng: `project.json`, `tags.json`, `connections.json`, `value-tables/*.json`, `watch-tables/*.json`. File mới tạo khi có nội dung đầu tiên; bảng bị xóa thì file bị xóa khi lưu (`project_remove`);
  - sửa đổi mới `tagUpsert`, `tagRemove`, `tagField` (trường v1), `channelUpsert`, `channelRemove`, `deviceUpsert`, `deviceRemove`, `scanGroups`, `valueTableUpsert`, `valueTableRemove`, `valueTableRename`, `watchTableUpsert`, `watchTableRemove`, `batch` (một bước hoàn tác);
  - ghi bằng `format-02.ts`; chế độ chỉ đọc khóa mọi sửa kèm lý do;
  - "nội dung chờ ghi" của 005 vẫn xanh.
  **Ghi chú khi làm (Studio, 2026-10-12):** test ở `model/project-doc-02.test.ts` (25 test) và `app/store-02.test.ts` (14 test), viết trước cài đặt (đỏ vì thiếu API, không chạy tách pha). Gồm: sửa theo đối tượng cho `connections.json`, `value-tables/*`, `watch-tables/*`; sửa đổi mới (`tagUpsert/tagField` v1, `channel*`, `device*`, `scanGroups`, `valueTable*`, `watchTable*`, `batch`); file mới tạo khi có nội dung đầu tiên, bảng bị xóa thì `removed` và file bị xóa khi lưu (`project_remove`); ghi `tags.json` bằng format-02; thứ tự ghi: file mới, `project.json`, file bị xóa; hoàn tác/làm lại cả việc tạo và xóa file; chế độ chỉ đọc khóa mọi sửa. Test cũ của 005 xanh.
- [X] T080 Cài `apps/studio/src/model/project-doc.ts`, `apps/studio/src/app/store.ts` (**sau 005 T133**), đạt T079.
  **Ghi chú khi làm (Studio, 2026-10-12):** xong, đạt T079: `model/project-doc.ts` (viết lại phần sửa đổi, `withEditable`, `outlineOf` thêm `version`, `connections`, `valueTables`, `watchTables`), `app/store.ts` (đọc file 0.2, `loaded02`, lưu theo thứ tự và xóa file, nâng cấp, chỉ đọc, từ chối project mới hơn). Quyết định: project 0.1 mới mở vẫn sửa được như 004 cho tới khi người dùng chọn (hộp thoại nâng cấp chặn), "Mở chỉ đọc" mới khóa; nhờ đó mọi test cũ của store/app xanh.
- [ ] T081 [P] Test `apps/studio/src/model/upgrade.test.ts` và component `apps/studio/src/ui/dialogs/upgrade-dialog.test.ts` (viết trước; FR-003, FR-004, FR-005; R3):
  - mở project 0.1 (từ đĩa, hoặc vừa đọc lên) → hộp thoại Nâng cấp / Mở chỉ đọc / Hủy, liệt kê `changes` của `migrate01to02` và nơi giữ bản sao lưu;
  - Nâng cấp → tài liệu 0.2 trong bộ nhớ, đĩa không đổi tới khi lưu; lưu lần đầu → `project_backup` trước khi ghi, hiện đường dẫn; `exists`, `changed` → không ghi, báo lý do;
  - Mở chỉ đọc → kiểm tra 0.1, xem trước, Mô phỏng `legacy`, Nạp xuống nguyên trạng (digest không đổi); mọi lệnh sửa khóa kèm lý do;
  - project mới hơn mức hiểu → từ chối, nêu phiên bản Studio cần, không ghi gì;
  - bàn phím, ARIA, theme.
- [ ] T082 Cài `apps/studio/src/model/upgrade.ts` và `apps/studio/src/ui/dialogs/upgrade-dialog.ts`, nối vào luồng mở project trong `apps/studio/src/app/app.ts`; đạt T081.
- [ ] T083 Test `apps/studio/src/model/tree.test.ts` (bổ sung, viết trước; **sau 005 T135**; FR-043; R22):
  - Kết nối (kênh › thiết bị trường, kèm số Tag; chấm trạng thái khi Online), Tag (Bảng Tag, Tag tính toán), Bảng giá trị (từng bảng), Bảng theo dõi (từng bảng), Chẩn đoán driver; bỏ nhãn GĐ;
  - thêm, đổi tên, nhân bản, xóa bằng menu chuột phải, phím (Insert, F2, Ctrl+Shift+D, Delete) và bảng lệnh;
  - Details liệt kê Tag của nút đang chọn, kéo được (kiểu dữ liệu `application/x-mat-tag`);
  - ký hiệu So sánh của 005 vẫn xanh.
- [ ] T084 Cài `apps/studio/src/model/tree.ts`, `apps/studio/src/ui/mat-tree.ts`, `apps/studio/src/ui/mat-details.ts`; lệnh mới trong `apps/studio/src/app/commands.ts` và `specs/004-studio-shell/contracts/commands.md` (`commands.test.ts` của 004 đọc thẳng file này); đạt T083. **Sau 005 T135, T124, T138, T149.**
- [X] T085 [P] Test lưới (viết trước; **sau T005**, hoặc khi T005 dời phần thử tay; ADR-016; data-model §13.2; FR-045, FR-046): `apps/studio/src/model/grid-model.test.ts` (bổ sung) và `apps/studio/src/model/grid/{selection,ime,clipboard,csv,fill,batch}.test.ts`:
  - `GridAdapter` (cột, đọc ô, chữ → giá trị, tạo dòng mới, lỗi theo ô); vùng chọn hình chữ nhật (Shift+mũi tên, kéo chuột, Ctrl+A); gõ một giá trị áp cả vùng; xóa vùng;
  - **bộ gõ:**
    - `keydown` `Process` không bị chặn; `compositionstart` → sửa (`origin: typed`); `beforeinput`/`input` có chữ → sửa, giữ chữ đã vào ô nhập;
    - Esc khi đang ghép → `cancelPending`, hủy sau `compositionend`, ô giữ nội dung cũ;
    - Enter, Tab khi đang ghép không xác nhận; Enter, Tab khi rảnh xác nhận đúng một sửa đổi;
    - F2, Enter, nhấp đúp vẫn vào chế độ sửa như 004 (`origin: f2 | dblclick`);
  - **clipboard TSV:**
    - chép ra giữ đúng cột; dán nhiều dòng, nhiều cột; tạo dòng mới khi dán quá dòng cuối;
    - cột thừa bị bỏ kèm số cột bỏ; ít cột hơn thì các ô còn lại giữ nguyên; dòng đầu khớp tên cột thì bỏ qua;
    - số đọc theo lựa chọn dấu thập phân; ô mơ hồ (`1,000` khi dấu thập phân là `,`) là lỗi; ô sai bị đánh dấu, phần còn lại vẫn dán;
    - vượt 2.000 dòng → từ chối phần vượt, báo số dòng bị bỏ;
  - **CSV** (R22): RFC 4180; có BOM; dấu phân cách `,`, `;`, tab; ô trong ngoặc kép có xuống dòng; xuất UTF-8 có BOM, dấu phân cách `;` khi dấu thập phân là `,`; ô chữ bắt đầu `= + - @`, tab, CR được thêm `'`; khi nhập bỏ đúng một `'` ở những ô đó, nên xuất rồi nhập lại không đổi;
  - **điền xuống** (Ctrl+D) và kéo điền: tên tăng số (`TANK_01` → `TANK_02`), ô khác chép nguyên; cột có hàm tăng riêng do adapter cấp (địa chỉ, T121);
  - mỗi thao tác hàng loạt (thêm, điền, dán, nhập) là một bước hoàn tác; hoàn tác dán 2.000 dòng là một bước;
  - test của 004 trong `grid-model.test.ts` vẫn xanh (ghi số test vào ghi chú khi làm).
  **Ghi chú khi làm (Studio, 2026-10-12):** đỏ (thiếu module) rồi xanh: 117 test ở `model/grid/{selection,ime,clipboard,csv,fill,batch}.test.ts` (adapter giả `test-adapter.ts`). `grid-model.test.ts` của 004 giữ nguyên (mô hình lưới mới nằm ở `model/grid/`, không sửa `grid-model.ts`: 35 test của 004 vẫn xanh).
- [X] T086 Cài `apps/studio/src/model/grid-model.ts` và `apps/studio/src/model/grid/{selection,ime,clipboard,csv,fill,batch}.ts`, đạt T085.
  **Ghi chú khi làm (Studio, 2026-10-12):** xong, đạt T085: `model/grid/{types,selection,ime,keys,fill,clipboard,csv,batch,index}.ts` (GridAdapter, vùng chọn, bộ gõ idle/composing/cancelPending, Ctrl+D/kéo điền, TSV, CSV RFC 4180 + chống công thức + Windows-1258, lọc theo cột có so sánh số, sắp xếp). `grid-model.ts` của 004 còn dùng cho `cellKey` (issue-map); phần còn lại của nó không còn người dùng sau khi viết lại Bảng Tag.
- [X] T087 [P] Test component `apps/studio/src/ui/grid/mat-grid.test.ts` (viết trước; jsdom; ADR-016):
  - ảo hóa: dòng cao cố định (24 px gọn, 28 px thoáng); chỉ vẽ khung nhìn cộng 10 dòng đệm mỗi phía; 2.000 dòng → số dòng trong DOM ≤ khung nhìn + 20;
  - một `textarea` giữ focus, đặt trên ô đang chọn; chế độ di chuyển: rỗng, `caret-color: transparent`; sự kiện composition giả → sửa ngay trên chính phần tử, không dời focus, không gán `value`;
  - `copy`, `cut`, `paste` qua `clipboardData` của ô nhập; ô danh sách chọn dùng ô nhập làm ô lọc (combobox);
  - ARIA `role="grid"`, `aria-rowcount`, `aria-rowindex`; ô nhập có `aria-activedescendant` và `aria-label` "<cột>, dòng <n>: <giá trị>"; tiêu đề và cột tên dính khi cuộn;
  - lỗi ô: viền đỏ, lý do khi trỏ chuột hoặc focus.
  **Ghi chú khi làm (Studio, 2026-10-12):** đỏ (thiếu component) rồi xanh: 22 test jsdom (`ui/grid/mat-grid.test.ts`): ảo hóa (2.000 dòng → ≤ 40 dòng trong DOM), một textarea, compositionstart/input/Process/Esc/Enter, copy/cut/paste qua ô nhập, ARIA, lỗi theo ô, combobox, sắp xếp, reveal. Bộ gõ thật kiểm bằng CDP ở T135.
- [X] T088 Cài `apps/studio/src/ui/grid/mat-grid.ts` và `apps/studio/src/ui/grid/mat-grid.css` (CSS theo tên thẻ), đạt T087.
  **Ghi chú khi làm (Studio, 2026-10-12):** xong, đạt T087: `ui/grid/mat-grid.ts` (+ `mat-grid.css`, CSS theo tên thẻ, chỉ token). Sự kiện `grid-state`, `grid-edit`, `grid-notice`; dòng 24 px (28 px thoáng); tiêu đề, cột số, cột tên dính; núm kéo điền; lọc theo cột có hàng riêng.
- [X] T089 [P] Test `apps/studio/src/model/validate-client.test.ts` và `apps/studio/src/platform/csp.test.ts` (bổ sung, viết trước; R21): kiểm project trong Web Worker; kết quả cũ bị bỏ theo số thế hệ; worker lỗi thì báo, không treo giao diện; CSP có `worker-src 'self'` và `connect-src` của 005 giữ nguyên.
  **Ghi chú khi làm (Studio, 2026-10-12):** đỏ rồi xanh: `model/validate-client.test.ts` (7 test: qua worker với đọc file qua luồng chính, W_UID_NOT_IN_SVG vẫn có, thế hệ cũ bị thay/bỏ, worker lỗi thì báo một lần và kiểm trong tiến trình, không có Worker) và `platform/csp.test.ts` (`worker-src 'self'`, `connect-src` của 005 giữ nguyên).
- [X] T090 Cài `apps/studio/src/workers/validate.worker.ts` (worker module do Vite đóng gói) và `apps/studio/src/model/validate-client.ts`; thêm `worker-src 'self'` vào CSP trong `apps/studio/src-tauri/tauri.conf.json` (**file chung với 005**: 005 T157 đổi phiên bản trong file này); đạt T089.
  **Ghi chú khi làm (Studio, 2026-10-12):** xong, đạt T089: `workers/validate.worker.ts` (Vite đóng gói worker module; không có DOMParser trong worker nên kiểm SVG do luồng chính làm sau), `model/validate-client.ts`, `worker-src 'self'` trong `tauri.conf.json`, nối trong `main.ts`.
- [ ] T091 E2E `apps/studio/tests/e2e/upgrade.e2e.mjs` (lớp giả):
  - mở `tank-demo` 0.1 → hộp thoại; Nâng cấp rồi Ctrl+S → có thư mục sao lưu (lớp giả); Mở chỉ đọc → lệnh sửa khóa kèm lý do; project 0.3.0 → từ chối;
  - cây theo FR-043 (thêm, đổi tên, xóa bằng phím và menu chuột phải); bộ gõ trên lưới thật kiểm ở T135 (Bảng Tag v1);
  - axe 0 lỗi critical hoặc serious ở theme sáng và tối; 0 lỗi console.
- [ ] T092 Kiểm Phase 2:
  - `./tools/ci-local.ps1` đầy đủ (có `armhf tests (qemu)`, `driver-it (source)`); `cargo test --lib`;
  - đếm ca vector ở hai bản: biểu thức ≥ 300, codec, bảng giá trị, bộ sinh, project 0.1 + 0.2, migration;
  - ghi `docs/reports/006-acceptance.md`.

**Checkpoint**:

- Vector chung xanh ở hai bản (SC-008); project 0.1 trên runtime 0.5 qua mọi kiểm tự động của Sprint 1 và 003 (SC-009, T061); lọc nguồn đạt trên x64 (SC-022 phần x64, T074).
- Studio mở, nâng cấp, sao lưu, chỉ đọc; cây FR-043; `mat-grid` và mô hình lưới nhận chữ qua bộ gõ (test T085, T087).
- `./tools/ci-local.ps1` xanh; ghi `docs/reports/006-acceptance.md`.

---

## Phase 3: User Story 1 — Đọc Tag thật qua Modbus TCP (Priority: P1) 🎯 MVP (cùng US2)

**Goal**: BL335 đọc PLC qua Modbus TCP: gộp yêu cầu, tách khi exception 02/03, mất kết nối thì BAD có lý do, có lại thì tự GOOD. Studio: nâng cấp project, thêm kênh và thiết bị trường, Thử kết nối trên BL335, Bảng Tag dạng lưới (thêm hàng loạt, dán, CSV, gõ qua bộ gõ), Bảng theo dõi và Bảng Tag hiện giá trị sống. Trang xem chạy bằng dữ liệu PLC.

**Independent Test**: spec US1. Giả lập Modbus TCP có đủ kiểu và thứ tự byte; nâng cấp project mẫu, thêm kênh và Tag, nạp xuống; so giá trị ở Bảng theo dõi và trên Chrome với giả lập; dừng giả lập, rút cáp, tiêm exception, rồi khôi phục (quickstart §2; §3 `read`, `merge`, `split`, `unplug`, `load`, `probe`; §5 bước 1–7).

**Phụ thuộc trong story**:

- mã hóa, giả lập, transport, driver, fuzz, Thử kết nối (T093–T104) chỉ cần thư viện của Phase 2 (T022, T048–T054): làm sớm được;
- route T105–T106 sau Mốc bảo mật của 005 (005 T042–T044); nối runtime T107–T108 sau 005 T044, T108;
- Studio Rust và TS: phần nối vào file của 005 ghi ở từng task.

### Thiết bị: mã hóa Modbus TCP, giả lập Node

- [X] T093 [P] [US1] Test `drivers/modbus/tests/frames_test.cpp` (viết trước): mọi vector PDU, MBAP của `tests/modbus-vectors/frames/` (mã hóa yêu cầu đúng từng byte; phản hồi đúng và sai cho đúng loại lỗi); kiểm phản hồi theo FR-032 (mã giao dịch, mã giao thức 0, độ dài, unit, mã hàm hoặc mã | 0x80, byte count, trường nhắc lại); ADU ≤ 260 byte.
  **Ghi chú khi làm:** 12 test; không có pha đỏ thật (cài trước khi dựng); thay bằng kiểm biến đổi (nhận mọi khung, bỏ kiểm byte count/unit) - đều bị bắt.
- [X] T094 [US1] Cài `drivers/modbus/{pdu,mbap,exceptions}.{hpp,cpp}` (tạo target `mat_modbus`; `exceptions` có nghĩa tiếng Việt cho trường `exception.meaning` của API, contract §4), đạt T093; thêm vào danh sách armhf.
  **Ghi chú khi làm:** xong; `exceptionMeaning` tiếng Việt.
- [X] T095 [P] [US1] Test giả lập `tools/modbus-sim/sim.test.mjs` (viết trước; `node --test`; [contracts/modbus-driver.md](contracts/modbus-driver.md) §12; R12):
  **Ghi chú khi làm:** 23 test; pha đỏ: thiếu module.
  - mã hóa riêng của giả lập qua mọi vector `tests/modbus-vectors/frames/` (phía máy chủ);
  - nhiều unit ID trên một cổng; vùng nhớ từ `map.json`; kịch bản `everySecond`, `counter`, `sine`;
  - điều khiển `POST /fault` với `timeout`, `exception` (mã, vùng địa chỉ), `delay`, `close`, `refuse`, `bad-tid`, `bad-unit`, `bad-length`, `garbage` (`count`, `delayMs`); `GET /counters`, `GET /log`, `POST /set`;
  - nhật ký JSONL mỗi yêu cầu (thời điểm, unit, mã hàm, địa chỉ, số lượng).
- [X] T096 [US1] Cài `tools/modbus-sim/{sim,codec,server,control,map}.mjs` (Node ≥ 22, không phụ thuộc gói; mã hóa viết độc lập với bản C++) và `tools/modbus-sim/maps/{modbus-demo,all-types,bench-500}.json` (`bench-500`: 500 Tag, mọi giá trị đổi mỗi giây); đạt T095. Bước `tools (node --test)` của T041 chạy thêm `tools/modbus-sim` (`tools/ci-local.ps1`, `.github/workflows/ci.yml`; **file chung với 005**).
  **Ghi chú khi làm:** xong, mã hóa độc lập với C++ (ADR-014); lỗi: timeout, exception, delay, close, refuse, bad-tid/unit/length, garbage; điều khiển /fault /counters /log /set /mem /reset. Chạy `node --test "tools/modbus-sim/*.test.mjs"` (Node 24 không nhận tham số thư mục). Đã thêm vào ci-local và ci.yml.

### Thiết bị: transport, driver Modbus TCP, fuzz

- [X] T097 [P] [US1] Test `drivers/sdk/tests/tcp_socket_test.cpp` (viết trước; máy chủ thử trên 127.0.0.1): kết nối không chặn có hạn `connectTimeoutMs`; `ECONNREFUSED` → `REFUSED`; không phân giải được tên → `DNS`; không tới mạng → `UNREACHABLE`; phía kia đóng khi rảnh → phát hiện lúc sắp gửi; đọc từng mảnh qua `poll()`; `O_CLOEXEC`.
  **Ghi chú khi làm:** có pha đỏ (thiếu tcp_socket).
- [X] T098 [US1] Cài `drivers/sdk/transport.hpp` và `drivers/sdk/tcp_socket.{hpp,cpp}`, đạt T097.
  **Ghi chú khi làm:** xong; `Transport`/`Clock` có chế độ `pump()` đồng hồ giả.
- [X] T099 [US1] Test `drivers/modbus/tests/modbus_tcp_driver_test.cpp` (viết trước; transport giả trong tiến trình; FR-024–FR-027, FR-031, FR-032; contract §3–§5, §7):
  **Ghi chú khi làm:** có pha đỏ; kèm test gộp khoảng trống.
  - bộ test chuẩn T048 với `modbus-tcp` (mục 1–3, 5–7; mục 4 ở US2);
  - mã giao dịch bắt đầu ngẫu nhiên, tăng 1, quay vòng sau 65.535; một yêu cầu đang chờ mỗi kết nối;
  - phản hồi trễ hoặc sai bị bỏ và đếm theo loại (`tid`, `unit`, `length`, `format`), chờ tiếp tới hết hạn; không bao giờ gán cho yêu cầu khác;
  - hết thời gian chờ → Tag của yêu cầu BAD `TIMEOUT`, đóng kết nối, mọi Tag của kênh BAD `DISCONNECTED`; kết nối lại theo backoff (đồng hồ giả); bị đóng khi rảnh → kết nối lại ngay một lần trước khi tính lỗi;
  - exception theo bảng contract §4: 01 → `EXCEPTION_01`; 02/03 → tách khối (T049); 05, 06 → thử lại theo `retries` rồi BAD; 09 và mã lạ → `EXCEPTION_OTHER`; 0A, 0B → chỉ thiết bị trường đó BAD, kênh vẫn `connected`;
  - nhiều thiết bị trường dùng chung kết nối (cổng nối TCP–RTU); lịch đọc qua `scheduler`; `requestGapMs`;
  - bit trong thanh ghi đọc cùng thanh ghi; hai Tag cùng địa chỉ đọc một lần; kênh hay thiết bị trường tắt → `DISABLED`, 0 byte;
  - `linkState(device)` đọc nguyên tử từ luồng khác (cho FR-037 bước 5); số đếm chẩn đoán đúng.
- [X] T100 [US1] Cài `drivers/modbus/modbus_tcp_driver.{hpp,cpp}` phần đọc (phần ghi ở T141), đạt T099; thêm vào danh sách armhf.
  **Ghi chú khi làm:** xong, đạt T099; thêm vào danh sách armhf.
- [X] T101 [P] [US1] Test fuzz `drivers/modbus/tests/modbus_fuzz_test.cpp` (viết trước; FR-032; R11):
  **Ghi chú khi làm:** fuzz xác định trong gtest, `MAT_FUZZ_SECONDS` (armhf mặc định 8 s); có pha đỏ.
  - hai đích: hàm giải mã thuần (MBAP, PDU, khung RTU khi có T158) và máy trạng thái nhận của driver trên transport giả (byte tới từng mảnh, có trễ, mất kết nối);
  - đột biến từ khung hợp lệ của `tests/modbus-vectors/frames/`: lật bit, chèn, xóa, cắt cụt, nhân đôi byte; sửa độ dài, byte count, mã giao dịch, unit, CRC; rác trước hoặc sau khung;
  - PRNG splitmix64, in hạt giống khi lỗi để lặp lại; thời lượng `MAT_FUZZ_SECONDS` (mặc định 60 s trong ctest thường);
  - bất biến: không dừng, không treo (hạn cho mỗi đầu vào); giá trị chỉ vào Tag khi phản hồi khớp yêu cầu (bộ so tham chiếu dựng từ yêu cầu và vùng nhớ giả lập).
- [ ] T102 [US1] Fuzz trong build sanitizer:
  **Ghi chú khi làm:** CHƯA làm (không dùng ASan theo chỉ thị); chỉ có fuzz gtest ở T101.
  - `tools/fuzz-modbus.ps1 -Seconds <n>`: build `-DMAT_SANITIZE=ON` ở `C:\build\mat-x64-asan`, chạy `modbus_fuzz_test`;
  - bước `x64 ASan/UBSan (fuzz 60 s)` trong `tools/ci-local.ps1`; job `sanitize-x64` trong `.github/workflows/ci.yml` (**file chung với 005**);
  - lỗi tìm được: thêm ca vào test thường (đỏ) rồi sửa (xanh); ghi hạt giống vào ghi chú khi làm.
- [X] T103 [P] [US1] Test `drivers/modbus/tests/test_probe_test.cpp` (viết trước; FR-044; contract §10), phần TCP:
  **Ghi chú khi làm:** có pha đỏ.
  - kết nối mới, tạm thời; không đụng kết nối của kênh đang chạy;
  - mã `OK`, `REFUSED` ("PLC từ chối kết nối (có thể đã đủ số kết nối)"), `TIMEOUT`, `UNREACHABLE`, `DNS`, `EXCEPTION` (mã và nghĩa), `BAD_FRAME`;
  - tùy chọn đọc 1–4 thanh ghi hoặc 1–16 bit: trả giá trị thô; kết quả trong ≤ chờ kết nối + chờ trả lời + 2 s.
- [X] T104 [US1] Cài `drivers/modbus/test_probe.{hpp,cpp}` phần TCP (phần RTU ở T164), đạt T103.
  **Ghi chú khi làm:** xong phần TCP.

### Thiết bị: Thử kết nối qua API, nối runtime

- [X] T105 [US1] Test `server/tests/drivers_api_test.cpp` (viết trước; CivetWeb trong tiến trình, HTTPS; [contracts/device-api-1.1.md](contracts/device-api-1.1.md) §1.1, §4, §7; **sau 005 T042, T043**):
  **Ghi chú khi làm:** 18 test; có pha đỏ.
  - `POST /api/v1/drivers/test` cần engineer: viewer, operator → 403 có audit; chưa đăng nhập → 401; qua HTTP → 403 `HTTPS_REQUIRED`;
  - thân ≤ 16 KiB; cấu hình sai → 400 `BAD_REQUEST` kèm `issues` theo mã của bộ kiểm tra (`E_ADDR_SYNTAX`, `E_SERIAL_PORT`…);
  - đang có lần thử khác → 409 `TEST_BUSY`; > 10 lần/phút → 429 `TEST_RATE_LIMITED` kèm `Retry-After`; không ghi được audit → 503 `AUDIT_UNAVAILABLE`;
  - audit `driver.test` (`target` = `host:cổng`, `code` = mã kết quả); trần cứng 35 s; `POST` làm mới hạn phiên;
  - bảng quyền: dòng mới của contract §1.1; `core/auth/tests/roles_test.cpp` thêm endpoint vào danh sách chép tay (test của 005 duyệt cả bảng).
- [X] T106 [US1] Cài, đạt T105:
  **Ghi chú khi làm:** xong; RTU trả 501 (thuộc đợt RTU); 409 TEST_BUSY, 429 + Retry-After, audit `driver.test`.
  - `server/http/drivers_api.{hpp,cpp}` phần `drivers/test`, qua `auth_gate`;
  - dòng bảng quyền trong `core/auth/roles.{hpp,cpp}` và action `driver.test` cuối danh mục `core/audit/audit_actions.hpp` (file của 005; không task 005 đang mở nào chạm; chỉ thêm dòng, báo phiên 005);
  - `device/identity.features` thêm `"drivers"` trong `server/http/engineering_api.{hpp,cpp}` và `kDeviceApiVersion` = `"1.1.0"` trong `server/device_state.hpp` (**sau 005 T043**; T110, T144 của 005 cũng sửa `engineering_api`: chỉ thêm);
  - đăng ký route trên context HTTPS (**sau 005 T044**).
- [X] T107 [US1] Test `server/tests/runtime_engine_test.cpp` (bổ sung, viết trước):
  **Ghi chú khi làm:** 5 test `RuntimeEngineChannels`; có pha đỏ.
  - mỗi kênh đang bật một luồng (≤ 16, stack 256 KiB); luồng kênh chạy ở bước 6 của device-config §7; `stop()` theo thứ tự khi dừng và trước `execv`;
  - `GET /api/v1/projects/active` của project 0.2 thêm `connections` (chỉ id, tên, loại; không IP, cổng, tham số serial; [contracts/project-format-0.2.md](contracts/project-format-0.2.md) §11).
- [X] T108 [US1] Cài driver Modbus TCP theo `connections.json` trong `server/runtime_engine.{hpp,cpp}`, `server/main.cpp` (**sau 005 T044, T108**) và phần `connections` của `projects/active` trong `server/http/http_api.{hpp,cpp}` (**sau 005 T044**); đạt T107.
  **Ghi chú khi làm:** xong; `connections` (id, name, kind) trong `projects/active` cho dự án 0.2.
- [ ] T109 [US1] `deployment/toolchain/run-x64.ps1` thêm tham số `-Project` (**sau 005 T050**); thông báo in ra không dấu. Lệnh quickstart §2 chạy được: `system/info` có `runtimeVersion` 0.5.0, `protocolVersion` 1.2.0, `schemaVersions` `["0.1","0.2"]`, `device.apiVersion` 1.1.0, `device.viewerAccess` `private`.
- [ ] T110 [US1] `tools/driver-it.ps1` thêm giả lập Node vào compose và các kịch bản (quickstart §3), project `tests/driver-it/projects/{read-all-types,bench-500-modbus}/`:
  - `read`: BOOL coil, bit trong thanh ghi, INT16…FLOAT64, STRING, 4 thứ tự byte: 100 % khớp giả lập (US1-9, US1-10; SC-001 phần x64);
  - `merge`: nhật ký giả lập có số yêu cầu bằng số khối tính trước, mỗi yêu cầu ≤ 125 thanh ghi, không Tag nào bị tách (US1-6);
  - `split`: một địa chỉ không có ở giữa khối → chỉ Tag đó BAD `EXCEPTION_02`, Tag khác GOOD từ lượt sau (US1-8);
  - `unplug -Rounds 20`: 10 lần ngắt mạng của giả lập, 10 lần dừng giả lập: BAD ≤ 2 chu kỳ kèm lý do; có lại: GOOD ≤ 12 s, không khởi động lại runtime; lưu trữ (003) ghi ô rỗng khi Tag BAD (US1-7; FR-026; SC-005 phần x64);
  - `load`: 500 Tag nhóm 1 s, giả lập đổi mọi giá trị mỗi giây, 10 client xem đủ 500 Tag: 0 mất sequence; chu kỳ thực 1 s ± 10 %; trễ ≤ 1 chu kỳ + 1 s (US1-5; SC-003 phần x64);
  - `probe`: Thử kết nối với `refuse`, `timeout`, exception 02, cổng sai: đúng mã và lý do, mỗi lần ≤ chờ + 2 s; kênh đang chạy không mất lượt nào (SC-014);
  - các kịch bản này là mục 1–3, 5, 7 của bộ test chuẩn (contract §11) chạy với giả lập Node; mục 4 ở T148; bản transport giả chạy trong ctest (T099);
  - job `driver-it` trong `.github/workflows/ci.yml` (ubuntu-latest có Docker và `pwsh`) chạy `source,read,merge,split,probe`; `unplug`, `load` chạy tay vì lâu, ghi trong chú thích (**file chung với 005**).

### Studio: Rust

- [X] T111 [P] [US1] Test Rust trong `apps/studio/src-tauri/src/device/http.rs` (viết trước; [contracts/tauri-commands-006.md](contracts/tauri-commands-006.md) §2, §3; **sau 005 T085b**):
  - `device_post({ id, path, body })`: chỉ `/api/v1/tags/write`, `/api/v1/drivers/test` (khác → `bad-path`); `body` ≤ 16 KiB sau tuần tự hóa (`too-large`, không gửi); hạn 10 s cho `tags/write`, 40 s cho `drivers/test`;
  - không tự gửi lại khi lỗi mạng (`unreachable`, `timeout`); trả `{ status, body }` với 2xx, 400 (kèm `issues`), 401 hoặc 403 có `results`, 409, 429, 503; 401 không có `results` → `session-*` và bỏ token như `device_get`;
  - `device_get` thêm `/api/v1/projects/active`, `/api/v1/tags/write/<uuid>`, `/api/v1/tags/write` (query `ids`), `/api/v1/drivers/diagnostics`, `/api/v1/serial/ports` (query `probe`); `/api/v1/audit` thêm khóa `target`; lỗi `no-such-request`.
  **Ghi chú khi làm (Studio, 2026-10-12):** đỏ (không biên dịch) rồi xanh: `device_post` chỉ `tags/write` và `drivers/test` (khác → `bad-path`), thân > 16 KiB → `too-large` không gửi, hạn 10 s/40 s, không tự gửi lại khi lỗi mạng (`unreachable`, `timeout`), trả `{status, body}` với 2xx, 400 kèm `issues`, 401/403 kèm `results`, 409, 429 (thêm `retryAfterS` từ header), 503; 401 `SESSION_*` bỏ token kể cả khi có `results`; `device_get` thêm đường dẫn của 006.
- [X] T112 [US1] Cài `device_post` và đường dẫn mới trong `apps/studio/src-tauri/src/device/http.rs`; đăng ký `device_post` trong `lib.rs` (**sau 005 T117, T129**); đạt T111.
  **Ghi chú khi làm (Studio, 2026-10-12):** xong, đạt T111: `DeviceManager::post`, `http::{allowed_post_path, post_timeout, MAX_POST_BODY}`, lệnh `device_post` đăng ký trong `lib.rs`.
- [X] T113 [P] [US1] Test Rust `apps/studio/src-tauri/src/csv.rs` (viết trước; contract §6): `csv_open` trả byte gốc ≤ 10 MiB (lớn hơn → `too-large`), hủy → `null`, Rust không giải mã; `csv_save` ghi đúng `text` nhận được, atomic như `write_atomic` của 004, hủy → `null`.
  **Ghi chú khi làm (Studio, 2026-10-12):** đỏ rồi xanh: 4 test ở `csv.rs` (byte gốc không giải mã, ≤ 10 MiB → `too-large`, ghi đúng văn bản atomic, thư mục đích không có → `io`).
- [X] T114 [US1] Cài `apps/studio/src-tauri/src/csv.rs`, đăng ký `csv_open`, `csv_save` (**sau 005 T117, T129**); hàm tương ứng trong `apps/studio/src/platform/{types,tauri,mock}.ts`; đạt T113.
  **Ghi chú khi làm (Studio, 2026-10-12):** xong, đạt T113: `csv.rs` (`csv_open`, `csv_save` qua hộp thoại của plugin dialog), đăng ký trong `lib.rs`; hàm `csvOpen/csvSave` ở `platform/{types,tauri,mock}.ts`.

### Studio: TS

- [ ] T115 [P] [US1] Test `apps/studio/src/platform/mock-device.test.ts` (bổ sung, viết trước; **sau 005 T123, T137, T148**; contract tauri-commands-006 §7): `DeviceLink.post`; bản giả có `drivers/test` mọi mã kết quả, `projects/active` 0.2, live có `reason` và đóng 4401, `system/info.device.viewerAccess = any`; điều khiển qua `window.__matMock.device`.
- [ ] T116 [US1] Cài `post` trong `apps/studio/src/platform/{device-types,tauri-device,mock-device}.ts`; `apps/studio/tests/e2e/fake-runtime.mjs` gửi `reason` trong delta khi cần; đạt T115.
- [ ] T117 [P] [US1] Test `apps/studio/src/model/device-session.test.ts` (bổ sung, viết trước; **sau 005 T133**; FR-055a): 4401 → `relogin` như `SESSION_EXPIRED`, mở lại live sau khi đăng nhập; theo dõi theo địa chỉ từ ngoài mạng riêng nhận `viewer-private` → thông báo "hãy Online (đăng nhập)"; `viewerAccess = any` → cờ cảnh báo.
- [ ] T118 [US1] Cài trong `apps/studio/src/model/device-session.ts` (**sau 005 T133**) và cảnh báo màu hổ phách "Trang xem đang mở cho mọi nguồn" trên `apps/studio/src/ui/mat-statusbar.ts` (**sau 005 T138**); đạt T117.
- [ ] T119 [P] [US1] Test `apps/studio/src/model/live-subscriptions.test.ts` (viết trước; data-model §13.5; R22): mỗi nơi khai tập Tag kèm ưu tiên (Bảng theo dõi 3, xem trước màn hình 2, dòng đang hiện của Bảng Tag 1); hợp lại; cắt ở 1.000 Tag theo ưu tiên; gửi `subscribe` sau 300 ms yên lặng; Bảng Tag 2.000 dòng chỉ đăng ký dòng đang hiện.
- [ ] T120 [US1] Cài `apps/studio/src/model/live-subscriptions.ts`, đạt T119.
- [ ] T121 [P] [US1] Test `apps/studio/src/model/tag-table.test.ts` (viết trước; FR-045, FR-015; data-model §1): adapter Bảng Tag cho `mat-grid`:
  - bộ cột theo loại (ngoài, nội bộ, tính toán, mô phỏng, tất cả); chọn cột; nhớ lựa chọn trong thiết lập của Studio;
  - trình sửa ô: danh sách chọn cho loại, kiểu, thiết bị trường, nhóm quét, bảng giá trị;
  - ô địa chỉ: chữ thường đổi thành chữ hoa, gợi ý cú pháp, hiện mã hàm, offset thật và số thanh ghi (`@mat/tag-codec`); điền xuống và kéo điền tăng địa chỉ theo số thanh ghi của kiểu;
  - lỗi theo ô lấy từ worker (T090); lọc theo cột (chuỗi chứa bỏ dấu, so sánh số), tìm, sắp xếp;
  - mức dùng `tags.json` so với trần 1 MiB, cảnh báo từ 85 % (R2);
  - project 0.1 mở chỉ đọc hiện bằng cột của 004 qua adapter 0.1.
- [ ] T122 [US1] Cài `apps/studio/src/model/tag-table.ts`, đạt T121.
- [ ] T123 [P] [US1] Test `apps/studio/src/model/grid/bulk-add.test.ts` và `apps/studio/src/model/csv-import.test.ts` (viết trước; FR-045; US1-11, US1-12):
  - **thêm hàng loạt:** số dòng, mẫu tên có số tăng, địa chỉ bắt đầu, bước (mặc định bằng số thanh ghi của kiểu), kiểu, thiết bị trường, nhóm quét. 50 FLOAT32 mẫu `TT_01` từ HR100 → `TT_01`…`TT_50` ở HR100, HR102, …, HR198; một bước hoàn tác;
  - **nhập CSV:**
    - xem trước; khớp cột theo tiêu đề; thêm mới và cập nhật theo tên, không xóa Tag;
    - dấu phân cách cột và dấu thập phân chọn được (mặc định theo vùng của Windows qua `Intl.NumberFormat`);
    - bảng mã: BOM UTF-8, UTF-8 hợp lệ, không thì Windows-1258, đổi được ở bước xem trước (`TextDecoder`);
    - tên Tag trùng trong file → các dòng trùng báo lỗi, không áp; lỗi theo dòng và ô; vượt 2.000 Tag → bỏ phần vượt, báo số dòng.
- [ ] T124 [US1] Cài `apps/studio/src/model/grid/bulk-add.ts` và `apps/studio/src/model/csv-import.ts`, đạt T123.
- [ ] T125 [P] [US1] Test component (viết trước) `apps/studio/src/ui/editors/tag-grid.test.ts` (viết lại), `apps/studio/src/ui/dialogs/bulk-add-dialog.test.ts`, `apps/studio/src/ui/dialogs/csv-import-dialog.test.ts`:
  - Bảng Tag trên `mat-grid`: bộ cột, sửa ô, gõ thẳng không cần F2; lỗi viền đỏ, liệt kê ở tab Thông tin, nhấp đúp tới đúng ô;
  - khi Online: cột giá trị sống, quality, lý do (tiếng Việt), chỉ dòng đang hiện;
  - Inspector của Tag (`apps/studio/src/ui/mat-inspector.ts`) hiện mọi thuộc tính theo nhóm và cho sửa (FR-047);
  - hộp thoại có xem trước; xuất CSV; bàn phím, ARIA.
- [ ] T126 [US1] Cài `apps/studio/src/ui/editors/tag-grid.ts` (viết lại trên `mat-grid`; bỏ đường F2 của 004), `apps/studio/src/ui/dialogs/{bulk-add-dialog,csv-import-dialog}.ts`, Inspector của Tag trong `apps/studio/src/ui/mat-inspector.ts`, xuất CSV qua `csv_save`; đạt T125.
- [ ] T127 [P] [US1] Test `apps/studio/src/model/connections.test.ts` (viết trước; FR-030, FR-044; data-model §2):
  - mô hình form Kết nối: nhóm theo loại kênh và thiết bị trường; mặc định của data-model §2; lỗi tại ô từ bộ kiểm tra; id duy nhất;
  - Thử kết nối: khóa kèm lý do khi Offline hoặc role < engineer; gửi cấu hình đang sửa qua `device_post /api/v1/drivers/test` (chưa cần nạp xuống); mỗi lúc một lần;
  - kết quả: thời gian, mã, lý do; bảng cách hiểu (`interpret` của `@mat/tag-codec`); `TEST_BUSY`, `TEST_RATE_LIMITED`;
  - Studio không tự kết nối tới thiết bị trường (không có đường mạng nào ngoài `DeviceLink`).
- [ ] T128 [US1] Cài `apps/studio/src/model/connections.ts`, đạt T127.
- [ ] T129 [P] [US1] Test component `apps/studio/src/ui/editors/connections-editor.test.ts` (viết trước; studio-ux §5, mục Form): nhóm theo kênh và thiết bị trường; trợ giúp ngay dưới ô; lỗi tại ô; panel Thử kết nối (thời gian, mã, hex, bảng cách hiểu 4 thứ tự; exception kèm nghĩa); bàn phím, ARIA.
- [ ] T130 [US1] Cài `apps/studio/src/ui/editors/connections-editor.ts` phần Modbus TCP (RTU ở T171), thêm import vào `apps/studio/src/ui/editors/index.ts` (file chung); đạt T129.
- [ ] T131 [P] [US1] Test `apps/studio/src/model/watch-table.test.ts` và component `apps/studio/src/ui/editors/watch-table-editor.test.ts` (viết trước; FR-050 phần xem; data-model §4):
  - nhiều bảng; thêm Tag bằng gõ tên (có gợi ý), dán danh sách tên, kéo từ Details hoặc Bảng Tag;
  - cột: tên; định dạng (`auto`, `dec`, `hex`, `bin`, `bool`; số chữ số lẻ 0–9); giá trị sống; quality và lý do; thời điểm; chữ và màu theo bảng giá trị (`lookup` của `@mat/expression`); giá trị ghi (lưu cùng bảng, không tự ghi khi mở);
  - Tag không có trên BL335 → "không có trên thiết bị"; Tag không có trong project → `W_WATCH_REF`;
  - lưới có cùng chọn ô, gõ thẳng qua bộ gõ, sao chép, dán, hoàn tác như Bảng Tag (FR-046).
- [ ] T132 [US1] Cài `apps/studio/src/model/watch-table.ts` và `apps/studio/src/ui/editors/watch-table-editor.ts` (phần xem; lệnh Ghi ở US2), đạt T131.
- [ ] T133 [P] [US1] Test So sánh và Nạp xuống cho đối tượng 0.2 (viết trước; FR-007, FR-008): `packages/project-schema/src/compare.test.ts` (bổ sung, **sau 005 T119**), `apps/studio/src/model/download-flow.test.ts` (bổ sung, **sau 005 T121**):
  - kind mới `channel`, `field-device`, `value-table`, `watch-table`; Tag so theo từng trường của Tag v1; khóa id kênh, id thiết bị trường, tên bảng giá trị, id bảng theo dõi;
  - bản trên BL335 là 0.1, trên máy là 0.2 → `migrate01to02` trong bộ nhớ trước khi so, kèm dòng "Bản trên thiết bị là 0.1, đã nâng cấp trong bộ nhớ để so";
  - xem trước Nạp xuống: dòng Tương thích runtime (project 0.2 cần ≥ 0.5.0; BL335 thấp hơn → khóa, nói cần cập nhật runtime); dòng Kết nối (kênh, thiết bị trường thêm, bớt, đổi; kênh nào sẽ kết nối lại).
- [ ] T134 [US1] Cài trong `packages/project-schema/src/compare.ts`, `apps/studio/src/model/download-flow.ts`, `apps/studio/src/ui/dialogs/download-dialog.ts` (**sau 005 T123**) và ánh xạ kind mới sang nút cây trong `apps/studio/src/model/compare-view.ts` (**sau 005 T131**); đạt T133.
- [ ] T135 [US1] E2E `apps/studio/tests/e2e/tags.e2e.mjs`, `apps/studio/tests/e2e/connections.e2e.mjs` và đo hiệu năng `apps/studio/tests/e2e/grid-perf.e2e.mjs` (lớp giả; fixture `tests/fixtures/studio/tags-2000-v02/` sinh bằng `tests/fixtures/studio/make-tags-2000.mjs`: 2.000 Tag 0.2 đủ loại, 500 biểu thức):
  - quickstart §5 bước 1–7 trên lớp giả: nâng cấp; thêm kênh; Thử kết nối mọi mã kèm bảng cách hiểu; thêm hàng loạt 50 rồi Ctrl+Z; dán 50 dòng có 2 ô sai; Online: cột sống chỉ cho dòng đang hiện; Bảng theo dõi hiện giá trị, quality, lý do;
  - bộ gõ giả lập bằng CDP: chọn ô Mô tả, gõ "Mức nước" → ô vào sửa ngay từ ký tự đầu, đúng chuỗi (US1-13; phần tự động của SC-013);
  - **SC-012** (Chrome headless, 2.000 Tag): mở ≤ 1 s; mỗi bước di chuyển hoặc cuộn ≤ 50 ms; mỗi phím ≤ 100 ms; lỗi do một lần sửa hiện tại ô ≤ 1 s; dán 2.000 dòng × 10 cột kể cả kiểm tra ≤ 5 s; xuất rồi nhập lại CSV → So sánh "giống". Ghi số đo vào `docs/reports/006-acceptance.md`;
  - axe 0 lỗi critical hoặc serious ở theme sáng và tối; 0 lỗi console.
- [ ] T136 [US1] Kiểm US1 với runtime x64 và giả lập theo quickstart §2 và §5 bước 1–7 (Studio dev thật), và bước 18 (container chạy runtime 0.4: dòng Tương thích runtime khóa nạp, FR-008); `./tools/ci-local.ps1`; ghi `docs/reports/006-acceptance.md`.

**Checkpoint**: US1 chạy độc lập trên x64: đọc đủ kiểu, gộp, tách, mất kết nối và có lại, tải 500 Tag, Thử kết nối (`driver-it`); Studio nâng cấp, Kết nối, Bảng Tag 2.000 dòng đạt SC-012, Bảng theo dõi xem. `./tools/ci-local.ps1` xanh; ghi `docs/reports/006-acceptance.md`.

---

## Phase 4: User Story 2 — Ghi Tag có kiểm soát từ Bảng theo dõi (Priority: P1)

**Goal**: operator ghi Tag từ Bảng theo dõi qua HTTPS có đăng nhập. BL335 kiểm theo thứ tự FR-037, lưu bền bản ghi audit lúc nhận trước khi gửi, trả `ACCEPTED` rồi `CONFIRMED` | `FAILED` | `TIMEOUT`, hoặc `REJECTED` trước khi có gì tới PLC. Mã yêu cầu chống chạy hai lần; nạp xuống khi đang ghi không làm lệnh chạy sai.

**Independent Test**: spec US2. Với giả lập: tài khoản viewer, operator, engineer; ghi mỗi kiểu; ngoài giới hạn, Tag chỉ đọc, mất kết nối, exception, không trả lời; hai Studio cùng ghi; giết runtime giữa lúc ghi; so nhật ký giả lập với audit (quickstart §3 `write`, `write-race`, `write-kill`, `write-deploy`; §5 bước 8–11).

**Phụ thuộc**: Mốc bảo mật của 005. `audit.db` phiên bản 2 **sau khi 005 đóng** (plan câu 4); `quiesce` **sau 005 T100**. Studio cần US1 (Bảng theo dõi, `DeviceLink.post`).

**Quyết định (người dùng giao toàn quyền 2026-10-11)**: bộ điều phối ghi và phần ghi của driver (hàm, lớp thuần với audit giả) làm ngay. Phần chạm `core/audit` chờ 005 đóng; route `tags/write` chờ cả hai.

### Thiết bị: bộ điều phối ghi, ghi Modbus

- [X] T137 [P] [US2] Test `core/tag-engine/tests/token_bucket_test.cpp` (viết trước; FR-041; R14): đồng hồ đơn điệu giả; hai tầng (theo phiên, khóa là băm token; toàn BL335); dung lượng và tốc độ theo cấu hình (mặc định 10 và 20/phút mỗi phiên, 20 và 20/phút toàn BL335); `retryAfterMs` đúng; hoàn token.
  **Ghi chú khi làm:** 11 test; không có pha đỏ thật, dùng kiểm biến đổi (sai nạp lại token).
- [X] T138 [P] [US2] Test `core/tag-engine/tests/write_coordinator_test.cpp` (viết trước; FR-037–FR-042; data-model §8; R14). Audit, driver, đồng hồ đều giả:
  **Ghi chú khi làm:** 36 test; có pha đỏ.
  - **thứ tự kiểm 2–8** (bước 1 ở `auth_gate`), dừng ở điều kiện đầu tiên:
    - `NO_SUCH_TAG`; `READ_ONLY` (Tag R, Tag tính toán); `BAD_TYPE`; `NOT_FINITE`;
    - `OUT_OF_LIMITS`; `OUT_OF_TYPE_RANGE`; `OUT_OF_RAW_RANGE` (scaling ngược, làm tròn như `round` khi kiểu thô là số nguyên); `STRING_TOO_LONG` (byte UTF-8);
    - `CONNECTION_BAD`, `DEVICE_NOT_ACTIVE`, `DISABLED` (đọc `linkState` nguyên tử);
    - `RATE_LIMITED` kèm `retryAfterMs`; `QUEUE_FULL` (16 mỗi kênh, 64 tổng); `PROJECT_CHANGING`; `AUDIT_UNAVAILABLE`;
    - chỉ yêu cầu qua bước 1–5 mới tiêu token; bước 7 hoặc 8 lỗi thì hoàn token;
  - `REJECTED` → không gì tới driver; ghi đúng bằng giá trị hiện tại vẫn gửi, vẫn audit;
  - giá trị: BOOL `true`/`false`; số hữu hạn hoặc chuỗi thập phân (bắt buộc với INT64/UINT64 ngoài ±2^53); STRING;
  - `ACCEPTED`: audit `started` và dòng `tag_write_request` lưu bền trong cùng giao dịch **trước** `enqueueWrite`; `old` (giá trị, quality) lấy lúc nhận;
  - **máy trạng thái** data-model §8: `CONFIRMED`; `NO_READBACK`; `APPLIED` (Tag nội bộ, Tag mô phỏng nhập tay: engine áp ở lượt sau, ≤ 250 ms); `WRITE_TIMEOUT`; `READBACK_TIMEOUT`; `DEVICE_EXCEPTION`; `READBACK_MISMATCH` (kèm giá trị đọc được); `READBACK_ERROR`; `NOT_SENT_DISCONNECTED`, `NOT_SENT_DEADLINE`, `NOT_SENT_PROJECT_CHANGE`, `NOT_SENT_READ_FAILED`;
  - kết quả cuối ghi qua luồng audit kết quả (giao dịch 2); sau `CONFIRMED`, Tag mang giá trị đọc lại ngay, không xét deadband;
  - **mã yêu cầu** (FR-040): lệnh đã `ACCEPTED` nhớ trong bảng ≥ 15 phút, qua cả khởi động lại; `REJECTED` nhớ LRU 1.024 trong RAM 10 phút; gửi lại cùng mã cùng nội dung → kết quả trước kèm `duplicate: true`, không chạy lại, không thêm audit; khác nội dung → `REQUEST_ID_CONFLICT`;
  - hai người ghi cùng Tag chạy theo thứ tự nhận (FIFO của kênh), mỗi người nhận kết quả của mình (US2-8);
  - kết quả để hỏi giữ 15 phút, tối đa 1.024; chỉ tài khoản gửi lệnh (hoặc administrator) xem được;
  - **`quiesce(deadline)`** (FR-042): từ chối lệnh mới (`PROJECT_CHANGING`); lệnh chưa gửi → `FAILED` `NOT_SENT_PROJECT_CHANGE`; chờ lệnh đang gửi tối đa `2 × thời gian chờ lớn nhất + 1 s`, trần 25 s; audit mọi kết quả rồi mới trả;
  - không ghi được audit → mọi lệnh `REJECTED` `AUDIT_UNAVAILABLE`; phiên hết hạn hay bị hạ role sau `ACCEPTED` → lệnh chạy tới cùng, kết quả ghi dưới tài khoản đã gửi.
- [X] T139 [US2] Cài `core/tag-engine/{token_bucket,write_coordinator}.{hpp,cpp}` (giao diện `WriteAudit` để làm trước audit phiên bản 2), đạt T137, T138; thêm vào danh sách armhf.
  **Ghi chú khi làm:** xong; thêm mã NOT_SENT_QUEUE_FULL ngoài kế hoạch.
- [X] T140 [P] [US2] Test `drivers/modbus/tests/modbus_tcp_write_test.cpp` (viết trước; FR-014, FR-028; [contracts/modbus-driver.md](contracts/modbus-driver.md) §8):
  **Ghi chú khi làm:** có pha đỏ.
  - hàng đợi ghi FIFO đi trước khối đọc đang chờ;
  - mã hàm theo cách ghi: 05 hoặc 15 (coil); 06 hoặc 16 (1 thanh ghi); 16 (2–123 thanh ghi); 22 (`registerBit = mask`); đọc-sửa-ghi (`rmw`: đọc 03 ưu tiên, sửa bit, 06 hoặc 16; đọc lỗi → `NOT_SENT_READ_FAILED`);
  - đọc lại ngay sau trả lời đúng, so giá trị thô (từng bit với số thực, từng byte với STRING đã đệm);
  - không bao giờ gửi lại lệnh đã gửi; chưa gửi mà kết nối đã đóng → kết nối lại một lần rồi gửi (R9); đã gửi rồi mất kết nối → `TIMEOUT`; quá `writeDeadlineMs` trong hàng đợi → `NOT_SENT_DEADLINE`; mất kết nối khi chưa gửi → `NOT_SENT_DISCONNECTED`;
  - mục 4 của bộ test chuẩn T048 với `modbus-tcp`.
- [X] T141 [US2] Cài phần ghi trong `drivers/modbus/modbus_tcp_driver.{hpp,cpp}`, đạt T140.
  **Ghi chú khi làm:** xong; 05/06/15/16/22, đọc lại, không thử lại lệnh ghi.

### Thiết bị: audit phiên bản 2, API ghi, nối runtime

- [X] T142 [US2] Test `core/audit/tests/tag_write_audit_test.cpp` (viết trước; **sau khi 005 đóng**; data-model §9; R15):
  **Ghi chú khi làm:** 16 test; có pha đỏ.
  - mở DB phiên bản 1 → `user_version` 2, tạo `tag_write_request` (`CREATE TABLE IF NOT EXISTS`, `WITHOUT ROWID`); DB phiên bản 2 vẫn mở được bằng mã của 0.4 (bảng thêm bị bỏ qua; kiểm bằng bản `AuditLog` của 005 trên file đã lên 2);
  - action `tag.write` (`started`, `ok`, `failed`, `denied` gộp 60 s qua `auditLimited`, `interrupted`) và `driver.test`; không thêm giá trị mới cho cột `result` (giữ `CHECK` của 005);
  - giao dịch 1 (bản ghi `started` + dòng mới) và giao dịch 2 (bản ghi kết quả + `result_id`), đều FULL;
  - dọn mỗi 10 phút trong một giao dịch: chỉ dòng đã có kết quả **và** đã qua ≥ 15 phút thời gian chạy; dòng của lần khởi động trước (`boot` khác) chỉ xóa sau khi lần chạy hiện tại qua 15 phút; giữ tối đa 4.096 dòng;
  - phục hồi lúc khởi động: mọi dòng `result_id IS NULL` nhận bản ghi `interrupted` (`UNKNOWN_OUTCOME`, chi tiết chép từ bản ghi lúc nhận) trong một giao dịch; chạy lại không tạo trùng;
  - `detail` ≤ 1 KiB, không có khóa giống bí mật; lọc `target` (bằng đúng) kết hợp `action=tag.`;
  - đo byte ghi một lần ghi Tag trên ext4 loop như R15 (mục tiêu khoảng 24,1 KB với `fdatasync`); ghi vào ghi chú khi làm.
- [X] T143 [US2] Cài trong `core/audit/audit_log.{hpp,cpp}` và `core/audit/audit_actions.hpp` (**sau khi 005 đóng**), đạt T142; `audit_log_test` của 005 vẫn xanh; thêm `tag_write_audit_test` vào danh sách armhf.
  **Ghi chú khi làm:** xong; `audit.db` v2, bảng `tag_write_request` WITHOUT ROWID; khoảng 22.7 KB ghi eMMC mỗi lệnh (đo /proc/self/io trong container).
- [X] T144 [US2] Test `server/tests/tags_api_test.cpp` (viết trước; CivetWeb trong tiến trình, HTTPS; [contracts/device-api-1.1.md](contracts/device-api-1.1.md) §3; **sau 005 T042–T044**; sau T143 của 006):
  **Ghi chú khi làm:** 28 test; có pha đỏ.
  - `POST /api/v1/tags/write` (operator): 1–16 yêu cầu, xử lý theo thứ tự; `requestId` UUID v4 chữ thường có gạch (sai → 400 cả lô); `tag` ≤ 64 byte; dạng `value` theo bảng §3.1;
  - 200 `results` (`ACCEPTED` kèm `phase: queued`, `old`, `receivedAt`; `REJECTED` kèm `reason`, `message`, `retryAfterMs`); `raw` khi Tag có scaling; `duplicate: true`; `REQUEST_ID_CONFLICT`;
  - lỗi cả lô: 400; 401 và 403 `FORBIDDEN` có `results` (`REJECTED` cùng mã) khi thân đọc được; 403 `HTTPS_REQUIRED` qua HTTP; 413 > 16 KiB; 503 `AUDIT_UNAVAILABLE` có `results`;
  - mọi lần từ chối, kể cả ở bước 1 (401, 403, qua HTTP), ghi audit `tag.write` `denied` kèm Tag và giá trị yêu cầu khi đọc được thân, thay cho `access.denied` của 005; gộp 60 s (FR-036, FR-039; US2-2; contract §3.4);
  - `GET /api/v1/tags/write/{requestId}` và `?ids=` (≤ 16): `status`, `code`, `phase`, `readback`, `exception { code, meaning }`, `finishedAt`, `clockOk`; mã lạ, quá 15 phút, hoặc của tài khoản khác → `UNKNOWN` (một mã: 404 `NO_SUCH_REQUEST`); administrator thấy mọi lệnh; không làm mới hạn phiên, không ghi audit;
  - `POST` làm mới hạn phiên; bảng quyền thêm hai dòng (operator) và `roles_test.cpp` thêm vào danh sách.
- [X] T145 [US2] Cài, đạt T144:
  **Ghi chú khi làm:** xong; `phase` luôn là "queued" (chưa phân biệt).
  - `server/http/tags_api.{hpp,cpp}`; dòng bảng quyền trong `core/auth/roles.{hpp,cpp}`;
  - `device/identity.features` thêm `"tag-write"` (`server/http/engineering_api.*`);
  - móc `onRejectedWrite` của live hub → audit `tag.write` `denied` `LIVE_WRITE_NOT_ALLOWED` (gộp 60 s), kèm Tag và giá trị khi đọc được;
  - tham số `target` của `GET /api/v1/audit` trong `server/http/engineering_api.*` (**sau 005 T144**).
- [X] T146 [US2] Test (viết trước) `core/project-store/tests/deploy_pipeline_test.cpp` (bổ sung, **sau 005 T100**) và `server/tests/runtime_engine_test.cpp` (bổ sung):
  **Ghi chú khi làm:** có pha đỏ (deploy_pipeline 2 test, diagnostics 1).
  - móc `quiesce` được gọi trước `activate`; chuỗi nạp xuống chờ móc trả về; kết quả và audit có trước khi đi tiếp;
  - khởi động bước 2 mới (device-config §7): phục hồi `interrupted` trước khi nhận lệnh ghi; không ghi được audit → runtime vẫn chạy, từ chối mọi lệnh ghi;
  - trước `execv`, theo thứ tự: `quiesce`, kho Tag giữ qua mất điện ghi phần chờ (móc rỗng tới T177), dừng driver, rồi các bước của 005;
  - luồng audit kết quả: engine không chờ `fsync`.
- [X] T147 [US2] Cài móc `quiesce` trong `core/project-store/deploy_pipeline.{hpp,cpp}` (**sau 005 T100**), luồng audit kết quả và thứ tự khởi động, dừng trong `server/runtime_engine.*`, `server/main.cpp` (**sau 005 T108**); cờ test `MAT_TEST_HOOKS` có điểm giết giữa lúc ghi (sau `started`, sau khi gửi, trước kết quả), không có trong bản armhf; đạt T146.
  **Ghi chú khi làm:** xong; thứ tự quiesce -> kho retained -> driver trước execv.
- [ ] T148 [US2] `tools/driver-it.ps1` thêm kịch bản (quickstart §3) và `tools/measure/device-api.mjs` thêm lệnh `write` (**sau 005 T052**; T126, T150 của 005 cũng sửa file này: chỉ thêm):
  **Ghi chú khi làm:** MỘT PHẦN: kịch bản read, merge, split, probe, write, write-race, unplug (+ -Net), write-kill, load đã có; còn thiếu write-deploy và kịch bản source (T074). Lệnh `write` của device-api.mjs đã có.
  - `write`: ≥ 1 ca cho mỗi kết quả và mỗi lý do của FR-037, FR-038, đúng 100 %; nhật ký giả lập có 0 lệnh gửi hai lần; viewer, chưa đăng nhập, qua HTTP, qua live: 0 lệnh tới giả lập, mỗi lần có audit; audit đủ trường FR-039; ≥ 95 % lệnh `CONFIRMED` ≤ 2 s (SC-006, SC-007 phần x64);
  - `write-race`: hai client ghi cùng Tag gần như cùng lúc: chạy theo thứ tự nhận; giả lập giữ giá trị của lệnh sau; hai bản ghi audit với giá trị cũ đúng (US2-8);
  - `write-kill -Rounds 20`: `kill -9` ngẫu nhiên giữa lúc ghi: 0 lệnh tới giả lập mà không có bản ghi `started`; mọi lệnh dở có `interrupted`; gửi lại cùng mã sau khởi động không chạy lần hai (SC-006);
  - `write-deploy`: nạp xuống khi đang ghi: lệnh đã gửi chạy tới cùng; lệnh chưa gửi `FAILED`; lệnh mới `REJECTED` `PROJECT_CHANGING`; mọi kết quả có audit (US2-12, FR-042).

### Studio

- [ ] T149 [P] [US2] Test `apps/studio/src/model/write-flow.test.ts` (viết trước; data-model §13.3; FR-050; R22):
  - `idle → sending → accepted → confirmed | failed | timeout`, `rejected`; hỏi kết quả mỗi 200 ms tới kết quả cuối, tối đa 30 s;
  - mất mạng sau khi gửi → `unknown`, hỏi lại theo mã khi có mạng, **không gửi lại** (US2-10); 401 `SESSION_EXPIRED` → hỏi đăng nhập lại → `idle`, phải xác nhận lại (US2-11);
  - mỗi lần xác nhận sinh `requestId` mới (UUID v4); nhiều dòng (≤ 16 mỗi `POST`);
  - khóa Ghi kèm lý do: chưa Online có đăng nhập; role < operator; Tag R hoặc tính toán; giá trị sai hoặc ngoài giới hạn (theo định nghĩa trên BL335); kết nối xấu (quality, lý do từ live); Tag không có trên BL335;
  - số: dấu chấm thập phân; gõ "12,5" → lỗi tại ô kèm gợi ý "12.5"; INT64 lớn gửi dạng chuỗi.
- [ ] T150 [US2] Cài `apps/studio/src/model/write-flow.ts`, đạt T149.
- [ ] T151 [P] [US2] Test component (viết trước) `apps/studio/src/ui/dialogs/write-confirm-dialog.test.ts` và `apps/studio/src/ui/editors/watch-table-editor.test.ts` (bổ sung phần ghi):
  - hộp xác nhận liệt kê từng Tag: thiết bị trường, giá trị hiện tại, giá trị mới đã hiểu, đơn vị, giới hạn; dùng định nghĩa Tag trên BL335 (`device_get /api/v1/projects/active`), có dòng cảnh báo khi khác project trên máy;
  - chỉ ghi khi người dùng xác nhận rõ; Enter trong ô không ghi; Esc hủy;
  - mỗi dòng hiện kết quả và thời điểm; `NO_READBACK` ghi "thiết bị xác nhận, không đọc lại"; `TIMEOUT` ghi "không chắc đã ghi";
  - bàn phím, ARIA.
- [ ] T152 [US2] Cài, đạt T151:
  - `apps/studio/src/ui/dialogs/write-confirm-dialog.ts` và phần ghi của `apps/studio/src/ui/editors/watch-table-editor.ts`;
  - lệnh Ghi (menu, bảng lệnh, Ctrl+Shift+Enter) trong `apps/studio/src/app/commands.ts` và `specs/004-studio-shell/contracts/commands.md` (**sau 005 T124, T138, T149**);
  - `apps/studio/src/platform/mock-device.ts` thêm `tags/write` mọi kết quả, trễ đặt được, mất mạng giữa chừng, `duplicate` (**sau 005 T123, T137, T148**).
- [ ] T153 [P] [US2] Test `apps/studio/src/ui/editors/audit-view.test.ts` (bổ sung, viết trước; **sau 005 T148**; FR-039, US2-9): administrator lọc theo Tag (`target`, có gợi ý tên Tag); mỗi lệnh ghi hiện thời điểm, tài khoản, role, IP, Tag, kênh và thiết bị trường, giá trị cũ, giá trị mới, kết quả, lý do.
- [ ] T154 [US2] Cài lọc theo Tag trong `apps/studio/src/ui/editors/audit-view.ts` (**sau 005 T148**), đạt T153.
- [ ] T155 [US2] E2E `apps/studio/tests/e2e/watch.e2e.mjs` (lớp giả): operator ghi `TANK01.SP` = 75 → `ACCEPTED` rồi `CONFIRMED`; viewer → lệnh Ghi khóa kèm lý do; 95 ngoài giới hạn 0–90; "12,5"; mất mạng sau khi gửi → hỏi lại theo mã, không gửi lại; phiên hết hạn → đăng nhập lại, không tự gửi; `NO_READBACK`; audit lọc theo Tag; axe 0 lỗi critical hoặc serious ở theme sáng và tối.
- [ ] T156 [US2] Kiểm US2 với runtime x64 và giả lập theo quickstart §5 bước 8–11; `./tools/ci-local.ps1`; ghi `docs/reports/006-acceptance.md`.

**Checkpoint**: US1 + US2 là MVP của GĐ 2: đọc PLC, ghi có kiểm soát, audit đủ, không lệnh nào chạy hai lần, nạp xuống khi đang ghi an toàn; mọi kịch bản `driver-it` của US2 đạt. `./tools/ci-local.ps1` xanh; ghi `docs/reports/006-acceptance.md`.

---

## Phase 5: User Story 3 — Modbus RTU qua RS485 (Priority: P2)

**Goal**: kênh Modbus RTU trên cổng serial trong danh sách cho phép của BL335: nhiều slave trên một bus; slave hỏng bị tạm ngưng mà các slave khác giữ nhịp; khung sai CRC bị bỏ; chế độ RS485 của kernel khi có, chế độ thường khi không; Studio thấy danh sách cổng; unit cấp quyền dùng cổng mà vẫn giữ sandbox.

**Independent Test**: spec US3. Trong CI: cặp pty (`openpty`), slave RTU giả lập trong luồng test, tiêm lỗi (CRC sai, không trả lời, byte rác, thiếu hoặc thừa byte, vọng lại, trả lời chậm). Trên BL335: một thiết bị RS485 thật qua bộ chuyển, có người ở cạnh thiết bị (T224).

**Phụ thuộc**: Phase 2 (SDK, codec); T104 (Thử kết nối), T106 (`drivers_api`) của US1; kết quả T006 cho `serialPorts` và unit (⏸ §8). Không cần US2: mục ghi của bộ test chuẩn chạy ở mức driver (`WriteCommand`), không qua bộ điều phối ghi; ghi RTU đầu-cuối qua API kiểm ở T218, T224.

- [ ] T157 [P] [US3] Test `drivers/modbus/tests/rtu_frame_test.cpp` (viết trước; FR-033, FR-034; [contracts/modbus-driver.md](contracts/modbus-driver.md) §3; R10). Đồng hồ giả, nguồn byte giả:
  - mọi vector RTU và CRC của `tests/modbus-vectors/frames/`;
  - độ dài mong đợi theo mã hàm và byte count; nhận theo độ dài; hai byte cách nhau quá `max(t3.5, gapFloor 20 ms)` mà chưa đủ → khung thiếu byte; đủ rồi vẫn chờ một khoảng lặng: có byte thừa → bỏ cả khung;
  - sai CRC, sai địa chỉ slave, sai mã hàm → bỏ, đếm, không cập nhật Tag;
  - t3.5: ký tự = 1 + bit dữ liệu + bit parity (nếu có) + bit stop; ≤ 19.200 bit/s là 3,5 ký tự, lớn hơn là 1,75 ms; 9.600 8E1 = 4,0 ms; `silenceMs` phải ≥ t3.5;
  - `dropEcho`: so N byte vừa gửi; khác → đếm `echo`, coi như khung hỏng.
- [ ] T158 [US3] Cài `drivers/modbus/rtu_frame.{hpp,cpp}`, đạt T157; mở rộng đích RTU của `modbus_fuzz_test` (T101).
- [ ] T159 [P] [US3] Test `drivers/sdk/tests/serial_port_test.cpp` (viết trước; pty bằng `openpty`; FR-035; R13):
  - mở `O_RDWR|O_NOCTTY|O_NONBLOCK|O_CLOEXEC`, `TIOCEXCL`, `flock(LOCK_EX|LOCK_NB)`; lần mở thứ hai → bận, lý do "cổng đang được chương trình khác dùng";
  - termios thô (`cfmakeraw`, `CLOCAL|CREAD`, `VMIN = VTIME = 0`); tốc độ, bit dữ liệu, parity, bit dừng áp đúng (đọc lại bằng `tcgetattr`);
  - `TIOCSRS485` trên pty → `ENOTTY` → cảnh báo `RS485_UNSUPPORTED`, vẫn chạy chế độ thường (US3-5);
  - chờ khoảng lặng rồi `tcflush(TCIFLUSH)` trước khi gửi; đóng thì nhả khóa.
- [ ] T160 [US3] Cài `drivers/sdk/serial_port.{hpp,cpp}`, đạt T159.
- [ ] T161 [P] [US3] Test `drivers/sdk/tests/serial_ports_test.cpp` (viết trước; cây `/sys/class/tty`, `/proc/consoles`, `/sys/class/tty/console/active`, `/etc/systemd/system/getty.target.wants`, `/dev/serial/by-id`, `/run/lock` giả trong thư mục tạm, gốc tiêm được; data-model §11):
  - tên, đường dẫn, tên `by-id`; `kind` `onboard` | `usb` (kèm `vid`, `pid`, `product`, `serial`), `driver`; ẩn cổng 8250 có `type` = 0;
  - `inUse`: console, getty, kênh của runtime, file khóa `LCK..<cổng>`;
  - `allowed` theo `serialPorts` (mẫu `ttyAS*`, đường dẫn `by-id` đúng tên); cổng console luôn bị loại, kể cả khi khớp mẫu;
  - `rs485`: `enabled` (cờ `TIOCGRS485` đang bật), `supported`/`unsupported` (chỉ khi dò), `unknown`; không mở cổng nào ngoài lúc dò.
- [ ] T162 [US3] Cài `drivers/sdk/serial_ports.{hpp,cpp}` (⏸ §8: danh sách mặc định theo kết quả T006), đạt T161.
- [ ] T163 [US3] Test `drivers/modbus/tests/modbus_rtu_driver_test.cpp` (viết trước; pty và slave giả lập chạy trong một luồng của test; mọi khung slave gửi được kiểm bằng vector; FR-027, FR-033–FR-035; US3-2…US3-5):
  - bộ test chuẩn T048 với `modbus-rtu`, cả mục 4 (ghi ở mức driver);
  - ba slave, slave 2 không trả lời: sau 3 lần liên tiếp không có trả lời hợp lệ → tạm ngưng, Tag BAD `DEVICE_SUSPENDED`; hỏi thử mỗi 10 s; slave 1 và 3 giữ chu kỳ (đồng hồ giả); slave 2 có lại → Tag có giá trị ≤ 15 s;
  - exception là trả lời hợp lệ (không tính vào tạm ngưng); CRC sai, byte rác, thiếu, thừa, vọng lại, trả lời chậm → bỏ, đếm, không cập nhật Tag; thử lại mặc định 1 lần;
  - cổng console hoặc cổng đã có kênh khác dùng → kênh lỗi kèm lý do, không chiếm cổng, các kênh khác vẫn chạy (US3-4);
  - ghi qua RTU (mã hàm như TCP) và đọc lại;
  - Thử kết nối RTU: cổng rảnh → mở tạm rồi đóng; cổng đang do một kênh chạy với cùng tốc độ và khung → gửi qua hàng đợi của kênh đó; khác tham số → `PORT_BUSY`; console → `PORT_CONSOLE`; ngoài danh sách → `PORT_NOT_ALLOWED`; lỗi mở → `PORT_ERROR`.
- [ ] T164 [US3] Cài `drivers/modbus/modbus_rtu_driver.{hpp,cpp}` và phần RTU của `drivers/modbus/test_probe.{hpp,cpp}`; chạy driver RTU theo `connections.json` trong `server/runtime_engine.*`; đạt T163; thêm các test RTU vào danh sách armhf (pty chạy dưới qemu-user).
- [ ] T165 [P] [US3] Test `core/project-manager/tests/project_validator_test.cpp` (bổ sung, viết trước): luật chỉ ở runtime `E_SERIAL_NOT_ALLOWED` theo `serialPorts` của cấu hình, sau khi loại cổng console; `--check-project` dùng `serialPorts` của file cấu hình (contract device-config §4).
- [ ] T166 [US3] Cài `E_SERIAL_NOT_ALLOWED` trong `core/project-manager/rules_02.{hpp,cpp}` (danh sách cổng truyền vào từ cấu hình), đạt T165.
- [ ] T167 [P] [US3] Test `server/tests/serial_api_test.cpp` và `server/tests/serial_cli_test.cpp` (viết trước; [contracts/device-api-1.1.md](contracts/device-api-1.1.md) §6; contract device-config §4):
  - `GET /api/v1/serial/ports` (engineer; viewer, operator → 403 có audit; HTTP → 403 `HTTPS_REQUIRED`); JSON theo contract; không mở cổng; không làm mới hạn phiên;
  - `?probe=1`: chỉ với cổng cho phép và đang rảnh; mở, đặt lại cấu hình đang có bằng `TIOCSRS485`, đóng; audit `driver.test` (`target` = tên cổng, `code` = `RS485_PROBE`);
  - `runuser -u matscada -- mat-runtime --list-serial` in đúng danh sách như API, không mở cổng; mã thoát như 005;
  - `device/identity.features` có `"serial-ports"`.
- [ ] T168 [US3] Cài `GET /api/v1/serial/ports` trong `server/http/drivers_api.{hpp,cpp}`, dòng bảng quyền, `features`; `server/cli/serial.{hpp,cpp}` và nhánh `--list-serial` trong `server/main.cpp` (**sau 005 T047**); đạt T167.
- [ ] T169 [US3] ⚠️🔌 ⏸ §8 **(SSH đang bị chặn; chờ người dùng cho phép hoặc tự chạy lệnh quickstart §8)** Unit và `deploy.sh` cho cổng serial ([contracts/device-config.md](contracts/device-config.md) §3, §5; FR-057; plan câu 1). **Sau 005 T049, T111.**
  - **Test viết trước**, bổ sung `deployment/device/tests/deploy_rollback_test.sh`:
    - unit có `PrivateDevices=false`, `DevicePolicy=closed`, `DeviceAllow=char-ttyAS rw`, `DeviceAllow=char-ttyUSB rw`, `DeviceAllow=char-ttyACM rw`, `SupplementaryGroups=dialout`;
    - phần sandbox khác giữ nguyên: `CapabilityBoundingSet=` rỗng, `NoNewPrivileges=true`, `ProtectSystem=strict`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`, `SystemCallFilter=@system-service`, `ReadOnlyPaths`;
    - `deploy.sh` với `/proc/devices`, `/proc/cgroups`, `stat` giả: điều kiện đủ → unit chính; thiếu → drop-in `/etc/systemd/system/mat-runtime.service.d/serial.conf` (`BindPaths=-/dev/<cổng>`, `DeviceAllow=/dev/<cổng> rw` cho mỗi cổng không có `*`) và giữ `PrivateDevices=true`; in lựa chọn;
    - sau khi đạt kiểm tra sức khỏe: in cảnh báo khi `viewerAccess` là `any`; lần đầu lên 0.5 từ bản < 0.5 in lời nhắc port-forward 9080 (FR-055a, ADR-018 điểm 6); in `--list-serial`; không đụng `/var/lib/mat-runtime/retain`;
    - **đỏ** trên unit và script hiện tại.
  - Sửa `deployment/systemd/mat-runtime.service` và `deployment/device/deploy.sh`; **xanh**.
  - Luật udev `/etc/udev/rules.d/60-mat-serial.rules` chỉ khi T006 cho thấy cần, và chỉ cài khi người dùng cho phép.
  - **Chỉ đánh dấu xong khi T217 có số đo trên BL335** (`systemd-analyze security mat-runtime` không tệ hơn bản 0.4 quá 0,3 điểm; `systemctl show mat-runtime -p DevicePolicy -p DeviceAllow`; runtime mở được cổng cho phép).
- [ ] T170 [P] [US3] Test (viết trước) `apps/studio/src/model/connections.test.ts` và `apps/studio/src/ui/editors/connections-editor.test.ts` (bổ sung RTU; US3-1, US3-6):
  - form kênh RTU: cổng, tốc độ 1.200–115.200, 7 hoặc 8 bit dữ liệu, parity, bit dừng, RS485, bỏ phần vọng lại, khoảng lặng; thiết bị trường slave 1–247;
  - danh sách cổng (`device_get /api/v1/serial/ports`): tên, loại, đang được ai dùng, RS485; nút "Dò RS485" (`?probe=1`);
  - cảnh báo `W_RTU_SCAN_TIME` kèm số ms ước tính; khi Online, Studio kiểm trước cổng ngoài danh sách cho phép của BL335.
- [ ] T171 [US3] Cài phần RTU của `apps/studio/src/model/connections.ts` và `apps/studio/src/ui/editors/connections-editor.ts`; `apps/studio/src/platform/mock-device.ts` thêm danh sách cổng (console, đang dùng, modem USB, RS485 `enabled`/`unsupported`) (**sau 005 T123, T137, T148**); đạt T170.
- [ ] T172 [US3] E2E `apps/studio/tests/e2e/connections.e2e.mjs` (bổ sung RTU): thêm kênh RTU, chọn cổng, Dò RS485, cảnh báo thời gian quét; axe 0 lỗi critical hoặc serious ở theme sáng và tối.
- [ ] T173 [US3] Kiểm US3 trên x64: test pty, bộ test chuẩn RTU, test armhf dưới qemu; `./tools/ci-local.ps1`; ghi `docs/reports/006-acceptance.md`.

**Checkpoint**: RTU chạy trên x64 qua pty với đủ lỗi tiêm; danh sách cổng và Thử kết nối RTU; unit sẵn sàng, chờ đo trên BL335 (T217, T224). `./tools/ci-local.ps1` xanh; ghi `docs/reports/006-acceptance.md`.

---

## Phase 6: User Story 4 — Tag nội bộ, Tag tính toán và bảng giá trị (Priority: P2)

**Goal**: Tag nội bộ có giá trị đầu và tùy chọn giữ qua mất điện (ghi eMMC có gom); Tag tính toán cập nhật cùng lần gửi với đầu vào; bảng giá trị dùng cho `text()`, Studio và binding trên Chrome. Studio có editor biểu thức (gợi ý, kiểm khi gõ, xem trước), editor Bảng giá trị, đổi tên Tag cập nhật mọi tham chiếu.

**Independent Test**: spec US4. Vector biểu thức chung ở hai bản (Phase 2); project mẫu có đủ ba loại trên giả lập: đổi đầu vào rồi kiểm Tag tính toán; giết tiến trình rồi kiểm Tag giữ qua mất điện; trong Studio kiểm gợi ý, báo lỗi, xem trước, đổi tên (quickstart §3 `calc`, `retain`; §5 bước 12–14, 19).

**Phụ thuộc**: Phase 2 (engine, biểu thức, bảng giá trị). Kịch bản `retain` (T180) và smoke ghi Tag nội bộ (T181) dùng đường ghi của US2 (T145). Phần Studio cần lưới của Phase 2.

### Thiết bị

- [X] T174 [P] [US4] Test `core/tag-engine/tests/retain_store_test.cpp` (viết trước; FR-018; data-model §10; R16). Lớp file tiêm được để đếm lời gọi và tiêm lỗi:
  - định dạng: phần đầu 64 byte (magic `MATRET01`, phiên bản 1, thế hệ u64, độ dài ảnh chụp, CRC32 của 60 byte trước); bản ghi (độ dài, số thứ tự, cờ ảnh chụp/thay đổi, số mục, các mục, CRC32); mục (id, mã kiểu, giá trị); little-endian tường minh;
  - tạo file: 512 KiB đầy số 0, `fsync` một lần;
  - mỗi lần lưu: `pwrite` bản ghi ngay sau bản ghi hợp lệ cuối rồi `fdatasync`; kích thước file không đổi; tối đa một lần mỗi cửa sổ (`retainWindowS`); Tag đổi luôn được ghi trong ≤ 1 cửa sổ;
  - nén khi chỗ còn lại < 2 lần bản ghi lớn nhất: ghi thân file kia, `fdatasync`, phần đầu thế hệ + 1, `fdatasync`;
  - tiêm mất điện ở từng bước (cắt dở bản ghi, phần đầu dở, rác): lúc khởi động chọn thế hệ hợp lệ cao nhất, phát lại tới bản ghi hỏng đầu tiên; chỉ mất thay đổi của cửa sổ cuối;
  - phần đầu file mới hỏng → dùng file cũ, chẩn đoán `fallback`; cả hai hỏng → đổi tên `*.corrupt-<thời điểm>` (giữ tối đa 3 bộ), Tag về `initial`, UNCERTAIN `RETAIN_LOST`, chẩn đoán `lost`;
  - đổi project: giữ giá trị của Tag cùng id, cùng `type`, vẫn `retain`; Tag khác về `initial`; có Tag bị bỏ thì nén lại ngay;
  - 500 Tag, chuỗi 256 byte vừa ảnh chụp; giá trị không phụ thuộc đồng hồ (RTC sai sau mất điện);
  - `ENOSPC`, `EIO` → báo trong chẩn đoán, runtime vẫn chạy; ghi ngay phần chờ khi được yêu cầu (trước `execv`);
  - đếm byte ghi mỗi lần lưu (mục tiêu khoảng 4,1 KB như R16), ghi vào ghi chú khi làm.
  - **Ghi chú khi làm (C++, 2026-10-12):** `retain_store_test` 22 ca: định dạng, mỗi lần lưu một `pwrite` + một `fdatasync`, cửa sổ gom, nén A/B, cắt điện ở từng bước (kiểm mọi chỉ số thao tác × giữ/bỏ phần chưa đồng bộ × ghi dở 3 cỡ), hỏng phần đầu → `fallback`, cả hai hỏng → `lost` (giữ tối đa 3 bộ), đổi project, ENOSPC/EIO, file thật. Một lần lưu một Tag nhỏ ghi 30 byte (cộng `fdatasync`).
- [X] T175 [US4] Cài `core/tag-engine/retain_store.{hpp,cpp}`, đạt T174; thêm vào danh sách armhf (bắt lỗi căn lề, `time_t`, số nguyên 64 bit của bản 32 bit).
  - **Ghi chú khi làm (C++, 2026-10-12):** `core/tag-engine/retain_store.*`, nối vào `server/runtime_engine.*` (luồng lưu riêng, ghi phần chờ trước `execv`); chạy dưới armhf qemu (22 test, 15 s). `--retain-dump` (T177) chưa làm.
- [ ] T176 [P] [US4] Test (viết trước) `server/tests/retain_cli_test.cpp` và `server/tests/runtime_engine_test.cpp` (bổ sung):
  - `runuser -u matscada -- mat-runtime --retain-dump` in giá trị đang lưu, thế hệ, file đang dùng, trạng thái (`ok` | `fallback` | `lost`); chỉ đọc; mã thoát như 005;
  - luồng lưu riêng; áp giá trị đã lưu lúc khởi động (bước 4) trước lượt engine đầu; ghi phần chờ trước `execv` (móc của T147); `retainWindowS`, `retainDir` từ cấu hình; thư mục `0700`, file `0600`.
- [ ] T177 [US4] Cài kho vào runtime trong `server/runtime_engine.*`, `server/main.cpp` (**sau 005 T044, T108**); `server/cli/retain.{hpp,cpp}` và nhánh `--retain-dump` (**sau 005 T047**); đạt T176.
- [ ] T178 [P] [US4] Test (viết trước; FR-054; [contracts/project-format-0.2.md](contracts/project-format-0.2.md) §8, §11):
  - `server/tests/startup_test.cpp` (bổ sung): `GET /api/v1/projects/active` của project 0.2 có `valueTables`, chỉ gồm bảng mà binding dùng tới (trực tiếp qua `table`, hoặc qua `valueTable` của Tag);
  - `packages/binding-engine/src/transforms.test.ts` (bổ sung): transform `valueTable`, `output` `text` hoặc `color`; vắng `table` thì dùng bảng của Tag; không khớp và không có mục mặc định → chữ rỗng, màu không áp (phần tử giữ màu gốc); `rangeMap`, `format`, `expression` vẫn không hỗ trợ;
  - `apps/runtime-web/src/value-tables.test.ts`: trang xem dùng `valueTables` của `projects/active`; cùng kết quả với xem trước của Studio (dùng chung `@mat/expression`).
- [ ] T179 [US4] Cài `valueTables` trong `server/http/http_api.{hpp,cpp}` (**sau 005 T044**); `packages/binding-engine/src/transforms.ts` (dùng `lookup` của `@mat/expression`; thêm phụ thuộc workspace); nối trong `apps/runtime-web/src/main.ts` (**sau 005 T104**); đạt T178.
- [ ] T180 [US4] `tools/driver-it.ps1` thêm kịch bản (quickstart §3), project `tests/driver-it/projects/calc-200/`:
  - `calc`: 200 Tag tính toán (2–5 đầu vào mỗi Tag) và 100 Tag nội bộ trên tải 500 Tag của `load`: 100 % lần đổi đầu vào, Tag tính toán nằm trong cùng delta với đầu vào (US4-4; SC-004 phần x64); lưu trữ (003) ghi Tag tính toán và Tag nội bộ theo cùng luật với Tag khác, Tag không GOOD ghi ô rỗng (FR-016);
  - `retain -Rounds 20`: ghi 42 qua `tags/write` (T145), chờ hơn một cửa sổ gom, `kill -9` (cả lúc đang lưu, qua điểm giết `MAT_TEST_HOOKS` sau `pwrite`, trước `fdatasync`); sau khởi động lại Tag là 42, 20/20; 0 lần bản lưu hỏng (US4-9; SC-010 phần x64; FR-059).
- [ ] T181 [US4] Mở rộng `deployment/toolchain/smoke-armhf.sh` (**sau 005 T053, T112**; sau T145, T177): runtime armhf nạp bản `projects/modbus-demo` chỉ có Tag mô phỏng, nội bộ, tính toán (image không có Node để chạy giả lập Modbus); Tag tính toán đúng giá trị; ghi một Tag nội bộ giữ qua mất điện (tài khoản thử `--password-stdin`), dừng, chạy lại, đọc lại đúng giá trị; `--retain-dump` báo `ok`.

### Studio

- [ ] T182 [P] [US4] Test `apps/studio/src/model/expression-assist.test.ts` (viết trước; FR-049; SC-015; R22):
  - gợi ý tên Tag theo một phần tên, không phân biệt hoa thường (`tank01.le` → `TANK01.LEVEL`), ≤ 200 ms mỗi phím với 2.000 Tag; tên hàm kèm cú pháp; tên bảng giá trị trong `text(`;
  - kiểm sau 200 ms ngừng gõ; lỗi hiện ≤ 500 ms, đúng `span`, có lý do (cú pháp, tên không có, sai kiểu, vòng tham chiếu kèm đường vòng);
  - xem trước kết quả với giá trị mô phỏng hoặc giá trị sống của đầu vào, kèm giá trị từng đầu vào; chỉ dùng `@mat/expression`.
- [ ] T183 [US4] Cài `apps/studio/src/model/expression-assist.ts`, đạt T182.
- [ ] T184 [P] [US4] Test component (viết trước) `apps/studio/src/ui/editors/expression-input.test.ts` và `apps/studio/src/ui/editors/calc-tags-editor.test.ts` (ADR-016 điểm 4):
  - `textarea` phủ lên lớp `pre` tô màu; chữ nhận qua bộ gõ (composition trên `textarea`); gạch dưới đúng `span`; danh sách gợi ý dùng được bằng bàn phím (↑, ↓, Enter, Tab, Esc); ARIA combobox;
  - editor Tag tính toán: danh sách Tag tính toán, ô biểu thức, danh sách đầu vào, xem trước; kéo Tag từ Details vào ô biểu thức.
- [ ] T185 [US4] Cài `apps/studio/src/ui/editors/expression-input.ts` và `apps/studio/src/ui/editors/calc-tags-editor.ts`, thêm import vào `apps/studio/src/ui/editors/index.ts`; đạt T184.
- [ ] T186 [P] [US4] Test (viết trước) `apps/studio/src/model/value-table-doc.test.ts` và component `apps/studio/src/ui/editors/value-table-editor.test.ts` (FR-048, FR-046; US4-7, US4-8):
  - lưới mục: giá trị hoặc khoảng, chữ (≤ 64 ký tự), màu (ô màu và `<input type="color">`); dòng mục mặc định;
  - ô thử: gõ một giá trị, thấy chữ và màu (`lookup`); lỗi tại ô `E_VT_OVERLAP`, `E_VT_RANGE`, `E_VT_TEXT`, màu sai; "Dùng ở đâu";
  - lưới có cùng chọn ô, gõ qua bộ gõ, sao chép, dán, hoàn tác như Bảng Tag; bàn phím, ARIA.
- [ ] T187 [US4] Cài `apps/studio/src/model/value-table-doc.ts` và `apps/studio/src/ui/editors/value-table-editor.ts`, thêm import vào `apps/studio/src/ui/editors/index.ts`; đạt T186.
- [ ] T188 [P] [US4] Test (viết trước; FR-047; D32; US4-12):
  - `packages/project-schema/src/rename.test.ts`: `renameTag(project, from, to)` đổi trong biểu thức theo token (giữ nguyên định dạng), bảng theo dõi, nhóm lưu trữ, binding; trả danh sách chỗ sẽ đổi; từ chối tên mới đã có hoặc sai luật;
  - `apps/studio/src/model/xref.test.ts` (bổ sung): "Dùng ở đâu" tính cả biểu thức, bảng theo dõi, binding `valueTable`, `valueTable` của Tag;
  - component `apps/studio/src/ui/dialogs/rename-tag-dialog.test.ts`: `TANK02.LEVEL` dùng ở hai biểu thức và một bảng theo dõi → liệt kê 3 chỗ; xác nhận thì đổi hết, không còn lỗi tham chiếu; một Ctrl+Z trả lại tên cũ ở mọi chỗ;
  - Inspector: "Dùng ở đâu"; Tag tính toán liệt kê Tag đầu vào.
- [ ] T189 [US4] Cài `packages/project-schema/src/rename.ts` (export trong `src/index.ts`), `apps/studio/src/model/xref.ts`, `apps/studio/src/ui/dialogs/rename-tag-dialog.ts`, phần "Dùng ở đâu" và đầu vào của `apps/studio/src/ui/mat-inspector.ts`; đạt T188.
- [ ] T190 [P] [US4] Test `apps/studio/src/model/download-flow.test.ts` (bổ sung, viết trước; **sau 005 T121**; FR-008; US4-10): dòng xem trước liệt kê Tag giữ qua mất điện sẽ về giá trị đầu (đổi kiểu, bỏ `retain`, bị xóa); Tag cùng tên, cùng kiểu không có trong danh sách.
- [ ] T191 [US4] Cài dòng đó trong `apps/studio/src/model/download-flow.ts` và hộp thoại Nạp xuống, đạt T190.
- [ ] T192 [US4] E2E `apps/studio/tests/e2e/calc.e2e.mjs` và `apps/studio/tests/e2e/value-tables.e2e.mjs` (lớp giả; quickstart §5 bước 12–14, 19):
  - gõ `tank01.le` → gợi ý `TANK01.LEVEL` ≤ 200 ms; biểu thức sai → gạch đúng chỗ ≤ 500 ms; vòng A ↔ B kèm đường vòng (SC-015);
  - Bảng giá trị `TrangThaiBom`: ô thử, hai khoảng chồng nhau; Bảng theo dõi hiện "Chạy" màu xanh lá khi `PUMP01.STATE` = 1 (US4-7); đổi tên Tag; dòng Tag giữ qua mất điện trong xem trước Nạp xuống;
  - axe 0 lỗi critical hoặc serious ở theme sáng và tối.
- [ ] T193 [US4] Kiểm US4 với runtime x64 và giả lập (quickstart §3 `calc`, `retain`; §5 bước 12–14, 19); `./tools/ci-local.ps1`; ghi `docs/reports/006-acceptance.md`.

**Checkpoint**: Tag nội bộ, Tag tính toán, bảng giá trị chạy trên x64 và qemu; trang xem đổi màu theo bảng giá trị; Studio có editor biểu thức, Bảng giá trị, đổi tên Tag. `./tools/ci-local.ps1` xanh; ghi `docs/reports/006-acceptance.md`.

---

## Phase 7: User Story 5 — Chẩn đoán driver (Priority: P3)

**Goal**: trang Chẩn đoán driver (Online, role viewer trở lên): cây kênh › thiết bị trường có trạng thái; số đếm từ lúc runtime chạy kèm phần tăng từ lúc mở trang; chu kỳ thực cạnh chu kỳ đặt, dấu quá tải; Tag xấu kèm lý do, nhấp đúp tới Tag.

**Independent Test**: spec US5. Tiêm từng loại lỗi vào giả lập; so số đếm ở trang chẩn đoán với số lỗi đã tiêm (quickstart §3 `faults`; §5 bước 15).

**Phụ thuộc**: US1 (driver TCP, `drivers_api`); khối `retain` cần T177. Phần Studio cần US1.

- [ ] T194 [P] [US5] Test `server/tests/drivers_diag_api_test.cpp` (viết trước; [contracts/device-api-1.1.md](contracts/device-api-1.1.md) §2, §5; FR-029, FR-051):
  - `GET /api/v1/drivers/diagnostics` (viewer; chỉ HTTPS); chưa đăng nhập → 401 và audit `access.denied` (US5-6);
  - JSON theo contract §5: kênh (`state`, `lastError`, `reconnects`, `warnings`), thiết bị trường (số đếm, `responseMs`, `groups` có `periodMs`, `actualMs`, `overruns`, `overloaded`, `writes`), `badTags` ≤ 500 xấu mới nhất trước, `detail` (đầu vào xấu hoặc mã exception), `badTagsTruncated`;
  - số đếm từ lúc runtime chạy, không đặt lại; không làm mới hạn phiên;
  - `GET /api/v1/diagnostics` (005; phần này **sau 005 T144**) thêm khối `viewer` (`access`, `blockedTotal`, `lastBlockedAt`), `tags` (`total`, `good`, `uncertain`, `bad`), `retain` (`state`, `tags`, `lastSaveAt`, `saves`).
- [ ] T195 [US5] Cài `GET /api/v1/drivers/diagnostics` trong `server/http/drivers_api.{hpp,cpp}` và ba khối mới của `/api/v1/diagnostics` trong `server/http/engineering_api.*` (**sau 005 T144**); dòng bảng quyền (viewer); đạt T194.
- [ ] T196 [US5] `tools/driver-it.ps1 -Scenario faults` và `tools/measure/device-api.mjs` thêm `drivers-diag` (**sau 005 T052**; SC-016): tiêm 10 lần hết thời gian chờ, exception từng mã, sai mã giao dịch, sai unit, sai độ dài, byte rác, trả lời chậm, đóng kết nối: số đếm ở chẩn đoán khớp số đã tiêm trong ≤ 5 s; lỗi gần nhất có thời điểm (US5-2).
- [ ] T197 [P] [US5] Test (viết trước) `apps/studio/src/model/driver-diag.test.ts` và component `apps/studio/src/ui/editors/driver-diagnostics.test.ts` (FR-051; R22):
  - hỏi mỗi 2 s, chỉ khi trang đang mở; giữ bản đầu khi mở trang để hiện "tăng thêm từ lúc mở" (US5-4);
  - cây kênh › thiết bị trường có trạng thái; chu kỳ thực cạnh chu kỳ đặt, dấu quá tải (US5-3); Tag xấu kèm lý do tiếng Việt;
  - nhấp đúp một Tag xấu → mở Bảng Tag và chọn đúng Tag (cơ chế `takeReveal` của 004; US5-5);
  - role viewer trở lên; Offline → trang báo cần Online.
- [ ] T198 [US5] Cài `apps/studio/src/model/driver-diag.ts`, `apps/studio/src/ui/editors/driver-diagnostics.ts` (import vào `ui/editors/index.ts`); khối `viewer`, `retain` hiện ở tab Chẩn đoán của `apps/studio/src/ui/diagnostics.ts` (**sau 005 T149**); `apps/studio/src/platform/mock-device.ts` thêm chẩn đoán driver đổi theo thời gian (**sau 005 T123, T137, T148**); đạt T197.
- [ ] T199 [US5] E2E `apps/studio/tests/e2e/diagnostics.e2e.mjs` (lớp giả): số đếm tăng đúng sau tiêm lỗi giả; phần tăng từ lúc mở; dấu quá tải; nhấp đúp tới Tag; axe 0 lỗi critical hoặc serious ở theme sáng và tối.
- [ ] T200 [US5] Kiểm US5 theo quickstart §5 bước 15 với runtime x64 và giả lập; `./tools/ci-local.ps1`; ghi `docs/reports/006-acceptance.md`.

**Checkpoint**: chẩn đoán driver đầy đủ trên x64; SC-016 đạt. `./tools/ci-local.ps1` xanh; ghi `docs/reports/006-acceptance.md`.

---

## Phase 8: User Story 6 — Mô phỏng trong Studio (Priority: P3)

**Goal**: bật Mô phỏng từ thanh công cụ: Tag ngoài chạy theo bộ sinh (hoặc mặc định), Tag nội bộ có giá trị đầu, Tag tính toán tính ngay trong Studio; Bảng Tag, Bảng theo dõi, xem trước biểu thức và xem trước màn hình dùng chung nguồn này; ghi tay vào Bảng theo dõi không cần đăng nhập; không gửi gì ra mạng.

**Independent Test**: spec US6. Studio trên máy không có mạng; project mẫu có đủ bốn loại Tag; so giá trị bộ sinh và Tag tính toán với vector chung; theo dõi mạng thấy 0 gói tin gửi đi (quickstart §5 bước 16–17).

**Phụ thuộc**: Phase 2 (`@mat/tag-sim`, `@mat/expression`); ghi tay dùng giao diện ghi của Bảng theo dõi (T152, US2).

- [ ] T201 [P] [US6] Test `apps/studio/src/model/sim-engine.test.ts` (viết trước; FR-052; data-model §13.4; contract value-tables-simulation §2.3; đồng hồ giả):
  - nguồn theo loại Tag: Tag có `sim` chạy theo `sim`; Tag ngoài chưa có `sim` theo mặc định (`@mat/tag-sim`); Tag nội bộ là `initial`; Tag tính toán tính bằng `@mat/expression` theo thứ tự tô-pô (`graph.ts`);
  - lượt mỗi 250 ms với `t = Date.now()`: giá trị khớp `tests/sim-vectors` ở cùng `t` (SC-017); bật xong ≤ 1 s;
  - ghi tay áp ngay vào bảng ghi đè; Tag tính toán phụ thuộc cập nhật ≤ 1 s;
  - project 0.1 mở chỉ đọc dùng `legacy-mock`;
  - không gọi `DeviceLink` nào, không mở kết nối mạng nào (spy).
- [ ] T202 [US6] Cài `apps/studio/src/model/sim-engine.ts`; bỏ `apps/studio/src/model/sim-source.ts` (và test của nó) sau khi chuyển xem trước màn hình (`apps/studio/src/preview.ts`, `apps/studio/src/ui/editors/screen-preview.ts`) sang `SimEngine`; đạt T201.
- [ ] T203 [P] [US6] Test component (viết trước) `apps/studio/src/ui/mat-toolbar.test.ts`, `apps/studio/src/ui/mat-statusbar.test.ts` (bổ sung, **sau 005 T138**), `apps/studio/src/app/app.test.ts` (bổ sung) (FR-052, D30; US6-1, US6-3, US6-5):
  - bật/tắt từ thanh công cụ và bảng lệnh; dấu "MÔ PHỎNG" màu tím, tương phản ≥ 4,5:1, khác viền cam của Online;
  - đang Online mà bật Mô phỏng → hỏi rồi chuyển Offline trước; bật Online khi đang Mô phỏng → tắt Mô phỏng; không bao giờ chạy cùng lúc;
  - Bảng theo dõi ghi được khi Mô phỏng: không đăng nhập, không audit, dòng ghi rõ "mô phỏng";
  - mọi chỗ hiện giá trị dùng nguồn mô phỏng.
- [ ] T204 [US6] Cài trong `apps/studio/src/ui/mat-toolbar.ts`, `apps/studio/src/ui/mat-statusbar.ts` (**sau 005 T138**), lệnh trong `apps/studio/src/app/commands.ts` và `specs/004-studio-shell/contracts/commands.md` (**sau 005 T124, T138, T149**), đường ghi mô phỏng của `apps/studio/src/model/write-flow.ts`, nối trong `apps/studio/src/app/app.ts`; đạt T203.
- [ ] T205 [US6] E2E `apps/studio/tests/e2e/simulation.e2e.mjs` (lớp giả; đồng hồ của trang cố định qua CDP): giá trị bộ sinh và Tag tính toán khớp vector ở cùng `t` (SC-017); `page.on('request')` thấy 0 request ra ngoài và lớp giả `DeviceLink` có 0 lời gọi; ghi tay áp ngay; chuyển Online ↔ Mô phỏng có hỏi; axe 0 lỗi critical hoặc serious ở theme sáng và tối.
- [ ] T206 [US6] Kiểm US6 theo quickstart §5 bước 16–17 trên máy rút mạng (Resource Monitor: 0 gói tin gửi đi); `./tools/ci-local.ps1`; ghi `docs/reports/006-acceptance.md`.

**Checkpoint**: mọi user story chạy độc lập trên x64. `./tools/ci-local.ps1` xanh; ghi `docs/reports/006-acceptance.md`.

---

## Phase 9: Polish, CI, tài liệu, đóng gói, nghiệm thu trên BL335

- [ ] T207 [P] CI (**sau 005 T151**; file chung):
  - `tools/ci-local.ps1`: rà các bước đã thêm (`armhf tests (qemu)`, `tools (node --test)`, `x64 ASan/UBSan`, `driver-it` kịch bản nhanh); thêm `cargo test --lib` nếu 005 T151 chưa thêm; sửa chú thích đầu file; ghi thời gian từng bước;
  - `.github/workflows/ci.yml`: job `driver-it`, `sanitize-x64`, bước `test-armhf.sh`, `node --test tools/project-validator tools/modbus-sim`; ghi lý do cho phần chạy tay (`unplug`, `load`, `write-kill`, `retain`, fuzz 1 giờ). Lệnh mới ghi vào `README.md` ở T211.
- [ ] T208 Hồi quy SC-021:
  - `npm test`, `npm run e2e -w @mat/studio` (mọi e2e của 004, 005, 006), `cargo test --lib`;
  - `tools/measure/http-check.mjs`, `tools/measure/runtime-smoke.mjs` với runtime x64 0.5.0 và project 0.1 từ mạng riêng: trang xem, CSP, allowlist, không đăng nhập không đổi hành vi (FR-055);
  - client live 1.1.0 và 1.0.0 với máy chủ 1.2.0 vẫn chạy (contract live-protocol-1.2 §5);
  - trang xem không có đường ghi nào (FR-055): tìm `tags/write` và bản tin `write` trong `apps/runtime-web/dist`;
  - ghi `docs/reports/006-acceptance.md`.
- [ ] T209 Fuzz ≥ 1 giờ (SC-020): `tools/fuzz-modbus.ps1 -Seconds 3600` (TCP và RTU, build ASan + UBSan): không dừng, không treo, không giá trị sai vào Tag; ghi số đầu vào, hạt giống, thời gian vào `docs/reports/006-acceptance.md`.
- [ ] T210 Review bảo mật (agent `agent-protocols:security-auditor`) và review code (agent `agent-protocols:code-reviewer`), cách làm như T153 của 005:
  - phạm vi: đường ghi Tag (thứ tự kiểm, audit trước khi gửi, mã yêu cầu, token bucket, `quiesce`); `drivers/test` (dò mạng qua BL335); mở cổng serial (danh sách cho phép, console, `TIOCEXCL`); unit và drop-in; parser khung Modbus; biểu thức (không `eval`, giới hạn); lọc nguồn và token trên live; CSV (chống CSV injection); `project_backup`, `project_remove` (đường dẫn, junction); mô hình mối đe dọa R24;
  - vá mức Critical và High, test trước; mục còn lại ghi `docs/reports/006-acceptance.md`.
- [ ] T211 [P] Tài liệu (**sau 005 T154**):
  - `docs/deployment/mat-runtime.md`: `viewerAccess` và SNAT của router; `serialPorts`, bộ chuyển USB qua `by-id`; unit chính hay drop-in; luật udev; `--list-serial`, `--retain-dump`; thư mục `retain/`; dung lượng `audit.db` khi ghi Tag liên tục (khoảng 70.000 lần ghi với 64 MiB, gợi ý nâng `auditMaxMB`); rollback 0.5 → 0.4 khi project đang chạy là 0.2 (contract device-config §6);
  - `schemas/README.md`; `README.md` (lệnh `driver-it`, `fuzz-modbus`, giả lập); `apps/studio/README.md` (Bảng Tag, Kết nối, Bảng theo dõi và ghi, Bảng giá trị, Tag tính toán, Chẩn đoán driver, Mô phỏng, nâng cấp 0.1);
  - `docs/architecture/studio-ux.md` §9 (phần đã làm của GĐ 2); `docs/plans/roadmap-v2.md` §4.2 (trạng thái feature 006);
  - `third_party/LICENSES.md` rà lần cuối: không thư viện mới; công cụ test (`node:24-slim`).
- [ ] T212 SC-018 và FR-053: bảng đối chiếu từng quy tắc lưới và form của studio-ux §5 cho mọi editor mới; axe 0 lỗi critical hoặc serious ở theme sáng và tối; tương phản chữ ≥ 4,5:1; mọi lệnh mới có trong menu, bảng lệnh và dùng được chỉ bằng bàn phím; ghi `docs/reports/006-acceptance.md`.
- [ ] T213 Phiên bản và gói runtime 0.5.0 (**sau 005 T113, T156**):
  - kiểm hằng: `kRuntimeVersion` / `RUNTIME_VERSION` 0.5.0, `kDeviceApiVersion` 1.1.0, `kLiveProtocolVersion` 1.2.0, `schemas/protocol-version.json`;
  - `deployment/package-runtime.ps1`: phiên bản 0.5.0; chép thêm `schemas/0.1/`; README triển khai nói về `viewerAccess`, cổng serial, unit; gói vẫn kèm project (0.1 `tank-demo`);
  - build → `build/mat-runtime-armhf.tar.gz` và `.sha256`; kiểm nội dung (`bin/`, `web/`, `project/`, `schemas/` có `0.1/`, `deployment/` có unit và `deploy.sh` mới); binary không có cờ `MAT_TEST_HOOKS`; ghi kích thước, SHA-256, thời điểm.
- [ ] T214 Studio 0.4.0 và bộ cài (**sau 005 T157**): phiên bản trong `apps/studio/package.json`, `apps/studio/src-tauri/tauri.conf.json`, `apps/studio/src-tauri/Cargo.toml` (và `Cargo.lock`); `./tools/ci-local.ps1` đầy đủ; `$env:CARGO_TARGET_DIR='C:\build\mat-studio'; npm run studio:build`; ghi đường dẫn, kích thước, thời điểm của bộ cài vào `docs/reports/006-acceptance.md`.
- [ ] T215 SC-013 thử tay bộ gõ (cần người gõ trên Windows 11), với bộ cài của T214 (WebView2):
  - Telex có sẵn (TSF) và Unikey (Telex), ở Bảng Tag, Bảng giá trị, Bảng theo dõi và ô biểu thức: 20/20 lần chọn ô rồi gõ thẳng "Mức nước bồn 1" ra đúng chuỗi, không cần F2;
  - Esc giữa lúc ghép (hủy, giữ nội dung cũ); Enter giữa lúc ghép (thuộc về bộ gõ); gõ ở ô danh sách chọn;
  - kiểm lại tay SC-012 trên WebView2;
  - ghi `docs/reports/006-acceptance.md`.
- [ ] T216 SC-019 (cần một kỹ sư chưa dùng các editor mới; không có thì ghi "tự đo", như 004): với bộ cài T214 và runtime x64 + giả lập, làm trọn trong ≤ 10 phút không cần tài liệu: thêm kênh Modbus TCP, Thử kết nối, tạo 20 Tag bằng thêm hàng loạt hoặc dán, nạp xuống, xem giá trị trong Bảng theo dõi, ghi một setpoint có xác nhận; ghi `docs/reports/006-acceptance.md`.
- [ ] T217 ⚠️🔌 **(SSH đang bị chặn; chờ người dùng cho phép hoặc tự chạy lệnh quickstart §8)** Cài runtime 0.5.0 lên BL335 (quickstart §9 bước 1–3), sau T006, T213:
  - kiểm chỉ đọc trước (§8); `deploy.sh` với gói T213; unit chính hoặc drop-in theo T006; in lời nhắc `viewerAccess`;
  - người dùng chọn giữ cách xem qua port-forward 9080 (`viewerAccess: any`, chỉ khi demo) hay dùng VPN;
  - kiểm unit: `systemd-analyze security mat-runtime` không tệ hơn 0.4 quá 0,3 điểm; `systemctl show mat-runtime -p DevicePolicy -p DeviceAllow`; `--list-serial`; số đo đủ thì đánh dấu T169;
  - không đụng `atscada-*`, `piano-edtech-*`; ghi `docs/reports/device-changes.md` kèm hoàn tác (`rollback.sh` về 0.4.0; xóa drop-in, luật udev nếu có).
- [ ] T218 ⚠️🔌 **(SSH đang bị chặn; chờ người dùng cho phép hoặc tự chạy lệnh quickstart §8)** SC-009, SC-021 và kiểm chức năng trên BL335 (quickstart §9 bước 3; Constitution I: mỗi tính năng phải được xác nhận trên thiết bị thật, không chỉ trên x64):
  - project 0.1 đang chạy vẫn chạy như 0.4; kiểm tự động của Sprint 1 và 003 qua mạng; trang xem từ mạng riêng không đổi hành vi;
  - nạp xuống `projects/modbus-demo` (giả lập Node chạy trên máy Windows trong LAN) bằng bộ cài T214, rồi đi một vòng mọi story: Online có token trên live; Bảng Tag và Bảng theo dõi có giá trị sống, quality, lý do; Thử kết nối; danh sách cổng serial (`--list-serial` và trong Studio); Tag tính toán, Tag nội bộ, trang xem đổi màu theo bảng giá trị; ghi một Tag ngoài và một Tag nội bộ giữ qua mất điện (operator), lọc audit theo Tag; Chẩn đoán driver; `--retain-dump`;
  - đo xong trả BL335 về project đang chạy trước đó; ghi `docs/reports/device-changes.md` và `docs/reports/006-acceptance.md`.
- [ ] T219 ⚠️🔌 **(SSH đang bị chặn; chờ người dùng cho phép hoặc tự chạy lệnh quickstart §8)** SC-003, SC-004, FR-056 trên BL335 (quickstart §9 bước 4–5; R23), đo bằng `tools/measure/sample.sh` qua `ssh … sh -s`, không ghi file trên thiết bị:
  - rảnh 10 phút với 0.4.0 rồi 0.5.0;
  - 500 Tag nhóm 1 s qua Modbus TCP từ giả lập chạy trên máy Windows trong LAN, 10 client, ≥ 30 phút: CPU trung bình ≤ 30 %, RSS ≤ 150 MB, chu kỳ thực 1 s ± 10 %, 0 mất sequence;
  - thêm 200 Tag tính toán, 100 Tag nội bộ: vẫn trong ngân sách; 100 % cùng delta;
  - vượt ngân sách thì cần ADR (Constitution III); ghi `docs/reports/006-acceptance.md`.
- [ ] T220 ⚠️🔌 **(SSH đang bị chặn; chờ người dùng cho phép hoặc tự chạy lệnh quickstart §8)** SC-005 trên BL335 (quickstart §9 bước 6): rút cáp PLC (hoặc ngắt mạng máy giả lập) 10 lần, tắt 10 lần, cấu hình mặc định, nhóm thường: 20/20 lần BAD ≤ 2 chu kỳ; 20/20 lần GOOD ≤ 12 s, không khởi động lại runtime; ghi thời điểm từng lần vào `docs/reports/006-acceptance.md`.
- [ ] T221 ⚠️🔌 **(SSH đang bị chặn; chờ người dùng cho phép hoặc tự chạy lệnh quickstart §8)** SC-011 trên BL335 (quickstart §9 bước 7; R15):
  - ghi liên tục ở mức trần 1 giờ (`tools/measure/device-api.mjs write`), có Tag giữ qua mất điện đổi theo; đếm `/sys/block/mmcblk0/stat` trước và sau (trừ mốc của T006), quy ra ngày: ≤ 1 GB/ngày;
  - chốt `tagWriteGlobalPerMin` = `min(30, ⌊1 GB / ((B_audit + B_retain) × 1.440)⌋)`; sửa mặc định trong `server/config.cpp`, contract device-config §1, ADR-017 (không sửa spec: FR-041 cho phép plan chốt mặc định ≤ trần);
  - ghi `docs/reports/006-acceptance.md`.
- [ ] T222 ⚠️🔌 **(SSH đang bị chặn; chờ người dùng cho phép hoặc tự chạy lệnh quickstart §8; cắt điện cần người ở cạnh thiết bị)** SC-010 trên BL335 (quickstart §9 bước 10): 20 lần `kill -9` và ≥ 3 lần cắt điện thật ngay sau khi ghi Tag giữ qua mất điện: 100 % lần có giá trị đã đổi trước cửa sổ gom cuối; 0 lần bản lưu hỏng; `audit.db`, `history.db` toàn vẹn.
- [ ] T223 ⚠️🔌 **(SSH đang bị chặn; chờ người dùng cho phép hoặc tự chạy lệnh quickstart §8; cần PLC Modbus TCP của người dùng)** SC-001, SC-007 với PLC thật (quickstart §7, §9 bước 8): mọi kiểu dùng được khớp 100 % với phần mềm lập trình PLC; ghi thử mỗi kiểu RW đều `CONFIRMED` và PLC có đúng giá trị; ≥ 95 % lệnh `CONFIRMED` ≤ 2 s trong LAN; ghi `docs/reports/006-acceptance.md`; ghi model, firmware vào báo cáo driver `docs/reports/006-driver-modbus.md` (T226).
- [ ] T224 ⚠️🔌 **(SSH đang bị chặn; chờ người dùng cho phép hoặc tự chạy lệnh quickstart §8; cần người ở cạnh thiết bị, thiết bị RS485 và bộ chuyển)** SC-002, US3-7 trên BL335 (quickstart §9 bước 9), sau T217: đọc khớp màn hình thiết bị; ghi một tham số RW `CONFIRMED`; chạy 30 phút ≥ 99 % lượt quét thành công; cổng, chế độ RS485 hay bộ chuyển tự đổi chiều ghi vào `docs/reports/device-profile.md`.
- [ ] T225 ⚠️🔌 **(SSH đang bị chặn; chờ người dùng cho phép hoặc tự chạy lệnh quickstart §8)** SC-022 từ địa chỉ công cộng (quickstart §9 bước 11): từ 4G của điện thoại mở `http://<IP công cộng>:9080` → 403 kèm hướng dẫn VPN; Studio Online qua port-forward HTTPS vẫn xem được (live kèm phiên); đặt `any` thì xem được và có cảnh báo; ghi `docs/reports/006-acceptance.md`.
- [ ] T226 Báo cáo driver `docs/reports/006-driver-modbus.md` (FR-060; Constitution VII; lộ trình §4.8): model và firmware đã thử (T223, T224); license (tự viết, không thư viện ngoài; công cụ test); mức đọc/ghi hỗ trợ; phần cứng thử; RAM/CPU trên BL335 (T219); giả lập trong CI (T096, T110, T163). Số nào chưa đo thì ghi "chưa đo" kèm lý do, và driver **chưa được phát hành** tới khi đủ số đo (Constitution VII).
- [ ] T227 ADR 014, 015, 016, 017, 018 → **Accepted**, kèm số đo từ `driver-it` và các task cần BL335 (ADR-014: RSS/CPU, SC-005, RS485; ADR-016: SC-012, SC-013; ADR-017: byte ghi eMMC, mặc định tần suất đã chốt; ADR-018: SC-022). Cập nhật `docs/adr/README.md`. ADR nào còn thiếu số đo thì giữ Proposed, ghi "chưa đo" kèm lý do.
- [ ] T228 Hoàn thiện `docs/reports/006-acceptance.md`:
  - SC-001…SC-022 có số đo và đường dẫn bằng chứng; mục chưa đo ghi "chưa đo" kèm lý do (thường là SSH bị chặn, chưa có phần cứng, cần người tại chỗ);
  - bảng đối chiếu FR-001…FR-060 với task và test; bảng đối chiếu quy tắc studio-ux §5 (T212);
  - hạn chế còn lại: trang xem không đăng nhập tới GĐ 3a; lọc nguồn mất tác dụng khi router có SNAT; `tags.json` trần 1 MiB (khoảng 1.400 Tag đủ mọi trường); bộ gõ chỉ kiểm được bằng tay.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → các user story → **Polish (Phase 9)**.
- **T005** (bản thử bộ gõ đạt, hoặc dời phần thử tay sang T215 theo quyết định trong T005) chặn mọi task lưới và giao diện mới (T081, T085 trở đi). **T006** (BL335, ⚠️🔌) chỉ chặn T169 và các task ⚠️🔌.
- **T007** là task nền đầu tiên: làm trước mọi task chạm SQLite.
- **Phase 2 có hai phần:**
  - **làm ngay** (file mới, hoặc file không có task 005 đang mở chạm): T007–T039, T042–T059, T062, T063, T070, T071, T075–T077, T081, T085–T090 (T090 báo phiên 005 vì `tauri.conf.json` là file chung);
  - **chờ 005**, ghi ở từng task: T040–T041 (005 T091, T094); T060–T061 (005 T044, T108); T064–T065 (005 T044); T066–T067 (005 T105, T106); T068–T069 (005 T101, T102); T072–T073 (005 T085b); T074 (005 T047, T051); phần đăng ký lệnh của T078 (005 T117, T129); T079–T080 (005 T133); T082 (sau T078, T080); T083–T084 (005 T135, T124, T138, T149); T091–T092.
- **Hai nửa của Phase 2 mở khóa riêng:** phần thiết bị của các story chỉ cần phần thiết bị của Phase 2 (T007–T074); phần Studio của các story cần phần Studio của Phase 2 (T075–T091). Checkpoint Phase 2 đầy đủ phụ thuộc các task 005 kể trên.
- **US1** cần Phase 2. Thư viện thiết bị T093–T104 làm sớm được (chỉ cần T022, T048–T054). Route T105–T106 cần Mốc bảo mật của 005.
- **US2** cần US1 (driver TCP, Bảng theo dõi). Thiết bị: T137–T141 làm sớm được; T142–T145 **sau khi 005 đóng**; T146–T147 sau 005 T100, T108.
- **US3** cần Phase 2 và T104, T106 của US1; không cần US2 (mục ghi của bộ test chuẩn chạy ở mức driver). T169 cần T006.
- **US4** cần Phase 2. T180 (kịch bản `retain`) và T181 cần đường ghi của US2 (T145).
- **US5** cần US1 (driver, `drivers_api`); khối `retain` cần T177.
- **US6** cần Phase 2 và giao diện ghi của Bảng theo dõi (T152, US2).
- **Polish:** T213–T214 sau 005 T156, T157; T217 cần T006, T213; T218–T225 cần T217; T226 cần T219, T223, T224.

### Phối hợp với feature 005

| Task 006 | File của 005 hoặc dùng chung | Điều kiện |
|---|---|---|
| T007 | `CMakeLists.txt` (`mat_sqlite`) | file chung; báo phiên 005; chạy lại test 003, 005 |
| T001, T003, T018, T022, T026, T052, T094, … | `CMakeLists.txt` (target mới, `mat_test`) | file chung: chỉ thêm khối, dòng |
| T008–T014, T041, T074 | `package.json` gốc (glob, `validate:project`), `eslint.config.mjs` | file chung: chỉ thêm |
| T003, T041, T074, T096, T102, T110, T207 | `tools/ci-local.ps1`, `.github/workflows/ci.yml` | file chung: chỉ thêm bước; T207 sau 005 T151 |
| T036, T039, T040, T189 | `packages/project-schema/src/{index,codes}.ts` | file chung: thêm export; `RUNTIME_VERSION` 0.5.0 ở T040 |
| T040 | `core/project-manager/project_validator.hpp` (`kRuntimeVersion`), `core/package/tests/zip_writer_test.cpp` (005, ghi cứng "0.4.0") | sau 005 T091, T094; xem "Cắt bản phát hành của 005" |
| T037, T166 | `core/project-manager/project_validator.*` | làm ngay: 005 T020 đã xong, không task 005 đang mở chạm |
| T043, T067 | `core/tag-engine/tag_store.*` | làm ngay |
| T056 | `drivers/simulation/mock_tag_provider.*` | làm ngay |
| T057, T058 | `server/config.*`, `server/tests/config_test.cpp` | file chung: không task 005 đang mở chạm; báo phiên 005 |
| T060, T108, T147, T164, T168, T177 | `server/main.cpp` | sau 005 T044, T108; T047, T060, T142, T146 của 005 cũng sửa: chỉ thêm khối; nhánh CLI (T168, T177) sau 005 T047 |
| T064, T065, T108, T179 | `server/http/http_api.*`, `server/http/web_contexts.*` | sau 005 T044 |
| T066, T067 | `server/websocket/{live_hub,civet_transport}.*` và test; `schemas/protocol-version.json` | sau 005 T105, T106 |
| T068, T069 | `packages/live-client/src/*` | sau 005 T101, T102 |
| T105, T106, T144, T145, T167, T168 | `server/http/auth_gate.*` (dùng), `server/http/engineering_api.*` (`features`), `server/device_state.hpp` (`kDeviceApiVersion`) | sau 005 T042, T043; T110, T144 của 005 cũng sửa `engineering_api`: chỉ thêm |
| T145, T194, T195 | `server/http/engineering_api.*` (`audit?target`, `/api/v1/diagnostics`) | sau 005 T144 |
| T106, T145, T168, T195 | `core/auth/roles.*`, `core/auth/tests/roles_test.cpp`, `core/audit/audit_actions.hpp` | file của 005, không task 005 đang mở chạm: chỉ thêm dòng, báo phiên 005 |
| T142, T143 | `core/audit/audit_log.*` (`user_version` 2) | **sau khi 005 đóng** (plan câu 4) |
| T146, T147 | `core/project-store/deploy_pipeline.*` và test | sau 005 T100 |
| T169 | `deployment/systemd/mat-runtime.service`, `deployment/device/deploy.sh`, `deployment/device/tests/deploy_rollback_test.sh` | sau 005 T049, T111 |
| T181 | `deployment/toolchain/smoke-armhf.sh` | sau 005 T053, T112 |
| T109 | `deployment/toolchain/run-x64.ps1` | sau 005 T050 |
| T213 | `deployment/package-runtime.ps1` | sau 005 T113, T156 |
| T074, T110, T148, T180, T196 | `tools/driver-it.ps1` (mới, theo mẫu `tools/device-it.ps1`), `tests/device-it/supervise.sh` (dùng lại) | sau 005 T047, T051 |
| T148, T196, T221 | `tools/measure/device-api.mjs` | sau 005 T052; T126, T150 của 005 cũng sửa: chỉ thêm |
| T070, T071 | `src-tauri/src/device/live.rs` (+ test T070 của 005) | sau 005 T085a (đã xong) |
| T072, T073, T111, T112 | `src-tauri/src/device/http.rs` | sau 005 T085b |
| T078, T112, T114 | `invoke_handler` của `src-tauri/src/lib.rs` | sau 005 T117, T129 |
| T077, T078 | `src-tauri/src/project_fs.rs` | làm ngay |
| T089, T090 | `src-tauri/tauri.conf.json` (CSP), `platform/csp.test.ts` | file chung: 005 T157 đổi phiên bản trong file này |
| T079, T080, T117, T118 | `model/project-doc.ts`, `app/store.ts`, `model/device-session.ts` | sau 005 T133 |
| T083, T084 | `model/tree.ts`, `ui/mat-tree.ts` | sau 005 T135 |
| T084, T152, T204 | `app/commands.ts`, `specs/004-studio-shell/contracts/commands.md` | sau 005 T124, T138, T149 |
| T118, T203, T204 | `ui/mat-statusbar.ts` (+ test) | sau 005 T138 |
| T115, T116, T152, T171, T198 | `platform/mock-device.ts` | sau 005 T123, T137, T148 |
| T133, T134, T190, T191 | `packages/project-schema/src/compare.ts`, `model/download-flow.ts`, `ui/dialogs/download-dialog.ts`, `model/compare-view.ts` | sau 005 T119, T121, T123, T131 |
| T153, T154 | `ui/editors/audit-view.ts` | sau 005 T148 |
| T198 | `ui/diagnostics.ts` | sau 005 T149 |
| T179 | `apps/runtime-web/src/main.ts` | sau 005 T104 |
| T211 | `docs/deployment/mat-runtime.md`, `README.md`, `apps/studio/README.md`, `docs/architecture/studio-ux.md`, `docs/plans/roadmap-v2.md`, `third_party/LICENSES.md` | sau 005 T154 |
| T214 | phiên bản Studio, bộ cài | sau 005 T157 |
| mọi task | `specs/005-*` | không sửa |

File của 004 không có task 005 đang mở nào chạm (`model/grid-model.ts`, `ui/editors/tag-grid.ts`, `model/sim-source.ts`, `model/xref.ts`, `ui/mat-inspector.ts`, `ui/mat-details.ts`, `ui/mat-toolbar.ts`, `preview.ts`, `ui/editors/screen-preview.ts`, `app/app.ts`, `app/device-errors.ts`, `i18n/vi.ts`, `platform/{types,tauri,mock}.ts`) làm được ngay khi tới lượt (giao diện vẫn sau T005).

### Within Each User Story

- Test (đỏ) → cài đặt (xanh) → nối vào runtime hoặc giao diện → kiểm theo quickstart.
- C++: hàm thuần (`merge_planner`, `rtu_frame`, `write_coordinator`, `retain_store`, `source_filter`) trước phần có luồng hay I/O; transport giả trước pty, giả lập Node, thiết bị thật.
- Rust: module trước lệnh Tauri; lệnh trước giao diện TS.
- TS: logic thuần (`model/`, `packages/*`) trước component (`ui/`); component trước khi nối vào file của 004, 005.
- Mỗi story kết thúc bằng task "Kiểm" chạy `./tools/ci-local.ps1` và ghi `docs/reports/006-acceptance.md`.

### Parallel Opportunities

- **Phase 1:** T001, T002, T004 song song; T003 song song với T001, T002; T005 sau T004; T006 chờ người dùng, không chặn ai ngoài T169 và task ⚠️🔌.
- **Phase 2:**
  - vector T008–T014 song song;
  - test T015, T016, T019, T020, T023, T024, T027, T030, T032, T034, T035, T038, T042, T044, T046, T049–T051, T057, T062, T068, T070, T072, T075, T077, T081, T085, T087, T089 song song (khác file);
  - cài T017 ‖ T018 ‖ T021 ‖ T022 ‖ T025 ‖ T026; T052 ‖ T053 ‖ T054.
- **Ba luồng làm việc** sau Phase 1:
  - (A) C++ thiết bị: T007 → vector → T016, T018, T020, T022, T024, T026, T031, T035, T037, T042–T058 → thư viện US1 (T093–T104), US2 (T137–T141), US3 (T157–T164), US4 (T174–T175) → phần nối theo lịch 005;
  - (B) TS: `packages/*` (T015, T017, T019, T021, T023, T025, T028–T030, T034, T036, T038, T039), giả lập Node (T095, T096), mô hình lưới (T085, T086) → Studio theo bảng phối hợp;
  - (C) Rust: T070–T073, T077–T078, T111–T114.
- **US1:** T093, T095, T097, T101, T103 ‖ T111, T113 ‖ T115, T117, T119, T121, T123, T125, T127, T129, T131, T133.
- **US2:** T137, T138, T140 ‖ T149, T151, T153; T142 chờ 005 đóng.
- **US3:** T157, T159, T161 ‖ T165, T167 ‖ T170.
- **US4:** T174, T176, T178 ‖ T182, T184, T186, T188, T190.
- **Giữa các story:** thư viện thiết bị của US3, US4 làm song song với US1, US2; US5 sau phần API của US1; US6 sau giao diện ghi của US2.

---

## Parallel Example: Phase 2

```text
# Vector chung (cùng lúc):
Task: "tests/expression-vectors/generate.mjs (≥ 300 ca)"
Task: "tests/value-table-vectors/generate.mjs"
Task: "tests/sim-vectors/generate.mjs"
Task: "tests/codec-vectors/generate.mjs"
Task: "tests/modbus-vectors/generate.mjs"
Task: "tests/project-vectors/generate.mjs: ca v02-*"
Task: "tests/migration-vectors/generate.mjs"

# Test hai bản (viết trước, cùng lúc):
Task: "Test TS packages/expression/src/vectors.test.ts"
Task: "Test C++ core/expression/tests/expression_vectors_test.cpp"
Task: "Test TS packages/tag-codec/src/vectors.test.ts"
Task: "Test C++ drivers/modbus/tests/codec_test.cpp + core/tag-engine/tests/scaling_test.cpp"
Task: "Test TS packages/tag-sim/src/vectors.test.ts"
Task: "Test C++ drivers/simulation/tests/sim_generators_test.cpp"
Task: "Test drivers/sdk/tests/merge_planner_test.cpp"
Task: "Test drivers/sdk/tests/scheduler_test.cpp"
Task: "Test server/tests/source_filter_test.cpp"
```

## Parallel Example: User Story 1

```text
# Thiết bị (test viết trước, cùng lúc):
Task: "Test drivers/modbus/tests/frames_test.cpp"
Task: "Test tools/modbus-sim/sim.test.mjs"
Task: "Test drivers/sdk/tests/tcp_socket_test.cpp"
Task: "Test drivers/modbus/tests/modbus_fuzz_test.cpp"
Task: "Test drivers/modbus/tests/test_probe_test.cpp"

# Studio, song song với thiết bị:
Task: "Test Rust apps/studio/src-tauri/src/device/http.rs (device_post)"
Task: "Test Rust apps/studio/src-tauri/src/csv.rs"
Task: "Test apps/studio/src/model/live-subscriptions.test.ts"
Task: "Test apps/studio/src/model/tag-table.test.ts"
Task: "Test apps/studio/src/model/grid/bulk-add.test.ts + csv-import.test.ts"
Task: "Test apps/studio/src/model/connections.test.ts"
Task: "Test apps/studio/src/model/watch-table.test.ts"
```

## Parallel Example: User Story 2

```text
# Thư viện, làm trước khi 005 đóng:
Task: "Test core/tag-engine/tests/token_bucket_test.cpp"
Task: "Test core/tag-engine/tests/write_coordinator_test.cpp"
Task: "Test drivers/modbus/tests/modbus_tcp_write_test.cpp"

# Studio:
Task: "Test apps/studio/src/model/write-flow.test.ts"
Task: "Test apps/studio/src/ui/dialogs/write-confirm-dialog.test.ts"
```

---

## Implementation Strategy

### Ngay bây giờ, trong lúc 005 còn làm

- Phase 1 (T001–T005); chuyển T006 cho người dùng (đã gửi lệnh §8 và xin quyền SSH).
- T007 (`HAVE_FDATASYNC`), báo phiên 005 trước.
- Mọi vector và thư viện thuần ở hai bản (T008–T058, T062–T063; riêng T040 sau 005 T091, T094), mô hình lưới (T085–T090, sau T005).
- Thư viện thiết bị của các story, chỉ dùng file mới: US1 T093–T104, US2 T137–T141, US3 T157–T164, US4 T174–T175, giả lập Node.
- Phần nối vào file của 005 làm theo bảng phối hợp, khi task tương ứng của 005 đã `[X]`.

### Mốc 1: nền (Phase 1–2)

Vector chung xanh ở hai bản (SC-008); project 0.1 trên runtime 0.5 như 0.4 (SC-009); lọc nguồn và live 1.2.0 trên x64 (SC-022 phần x64); Studio nâng cấp và lưới có bộ gõ. Mốc nội bộ, chưa giao cho người dùng.

### Mốc 2, giao sớm: nền + US1

BL335 đọc PLC qua Modbus TCP; Studio có Kết nối, Thử kết nối, Bảng Tag dạng lưới, Bảng theo dõi chỉ xem. Lọc nguồn đã có, nên runtime 0.5 cài được lên BL335 có port-forward (D33). Nếu người dùng cho phép SSH, cài và đo SC-003, SC-005 sớm (T217, T219, T220).

### MVP đề xuất: nền + US1 + US2 (hai story P1)

Đọc và ghi có kiểm soát: là nghiệm thu cốt lõi của GĐ 2 (spec: "Điều khiển là nửa còn lại của SCADA"). Phần thiết bị của US2 chờ 005 đóng (audit phiên bản 2), nên làm thư viện US2 sớm để khi 005 đóng chỉ còn phần nối. Giao gói runtime 0.5.0 và bộ cài Studio thử; nghiệm thu phần thiết bị khi được phép (T217–T223).

### Incremental Delivery

1. US3 (RTU): phần pty và CI làm sớm; nghiệm thu thật cần kết quả T006 và người ở cạnh thiết bị (T224).
2. US4 (Tag nội bộ, tính toán, bảng giá trị): thư viện song song US1; Studio sau lưới.
3. US5 (chẩn đoán driver), US6 (Mô phỏng).
4. Polish: CI, review bảo mật, tài liệu, bộ cài 0.4.0, nghiệm thu BL335, ADR Accepted (T207–T228).

Mỗi bước giữ `test-x64.ps1`, `test-armhf.sh`, `npm test`, `cargo test --lib`, e2e và `driver-it` kịch bản nhanh xanh.

### Làm song song

- Luồng C++ thiết bị, luồng TS (`packages/*`, Studio) và luồng Rust chạy từ Phase 1; gặp nhau ở bộ vector chung, ở `driver-it` và ở các task "Kiểm" của mỗi story.
- Phần chạm file của 005 xếp theo bảng phối hợp; phiên chính báo phiên 005 trước khi sửa file chung.

---

## Notes

- `[P]` = khác file, không phụ thuộc task chưa xong.
- Đánh dấu `[X]` khi xong. Ghi "**Ghi chú khi làm:**" ngay trong task: kết quả đỏ/xanh (số test), lệch kế hoạch và lý do, số đo, quyết định của phiên chính (như 003, 004, 005).
- Task ⚠️🔌 ghi ngày người dùng cho phép, ai làm, lệnh đã chạy; mọi thay đổi trên BL335 vào `docs/reports/device-changes.md`.
- Commit mốc cục bộ theo quyết định của phiên chính (người dùng cho phép 2026-10-11); không push.
