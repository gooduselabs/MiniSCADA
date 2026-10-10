---

description: "Task list — Kiểm chứng nền tảng (Sprint 0)"
---

# Tasks: Kiểm chứng nền tảng (Sprint 0)

**Input**: `specs/001-platform-validation/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Tests**: Có test cho session manager và load-tester (Constitution VI — test-first). Phần đo trên thiết bị kiểm chứng bằng quickstart.

**Quy ước an toàn**: Task đánh dấu 🔌 cần SSH vào BL335. Task đánh dấu ⚠️ thay đổi thiết bị/máy dev (cài phần mềm, ghi file lên thiết bị) — hỏi người dùng trước khi chạy. Mật khẩu không ghi vào repo.

## Phase 1: Setup (khung dự án)

- [x] T001 Tạo cây thư mục theo plan.md: `core/session-manager/`, `server/`, `apps/runtime-web/`, `tools/load-tester/`, `tools/measure/`, `tests/fixtures/svg/`, `deployment/toolchain/`, `deployment/systemd/`, `docs/reports/`, `.github/workflows/`
- [x] T002 [P] Tạo `README.md` gốc và `.gitignore` (build/, node_modules/, *.log, secrets) tại thư mục gốc
- [x] T003 [P] Cấu hình format/lint: `.clang-format`, `.editorconfig`, `.prettierrc`, `eslint.config.js` tại gốc — **ghi chú review**: `eslint.config.js` không tồn tại khi đánh dấu; đã thêm `eslint.config.mjs` ở T055
- [x] T004 [P] Tạo `CMakeLists.txt` gốc + `CMakePresets.json` (preset `x64`, `armhf`, generator Ninja) — **ghi chú T047: `CMakePresets.json` KHÔNG tồn tại** (CMake 3.16 trong container không hỗ trợ preset); build thực tế dùng `deployment/toolchain/build.ps1` và `test-x64.ps1`
- [x] T005 [P] Tạo `package.json` gốc (npm workspaces: `apps/*`, `packages/*`) với script `lint`, `test`
- [x] T006 [P] Tạo workflow `.github/workflows/ci.yml` với job `lint`, `test`, `build-armhf` (theo research R7) và script cục bộ tương đương `tools/ci-local.ps1` — **ghi chú review**: không có job `lint` riêng; Prettier + ESLint chạy trong job `web`, clang-format trong job `build-armhf` (T055)

## Phase 2: Foundational (chặn mọi user story)

- [x] T007 ⚠️ Kiểm tra/bật Docker Desktop (hoặc dựng WSL2 Ubuntu 20.04) và xác nhận `docker run hello-world` chạy được
- [x] T008 Viết `deployment/toolchain/Dockerfile` (ubuntu:20.04, g++-arm-linux-gnueabihf, cmake, ninja) và `deployment/toolchain/build.ps1` để build trong container
- [x] T009 Tạo `tools/hello-armhf/main.cpp` (in phiên bản C++17 + `uname`) và build chéo thành công bằng preset `armhf`, kiểm tra `file` ra "ARM, EABI5, hard-float"

**Checkpoint**: có binary armhf để mang lên thiết bị.

## Phase 3: User Story 1 — Biết chắc thiết bị đủ sức (P1) 🎯 MVP

**Goal**: hồ sơ thiết bị + binary tự build chạy trên BL335 + baseline OS rảnh.
**Independent Test**: quickstart mục 1, 2, 3.

- [x] T010 [P] [US1] Viết `tools/measure/device-profile.sh` thu thập: `uname -a`, `getconf LONG_BIT`, `ldd --version`, `free -m`, `df -h`, mount, `/proc/cpuinfo`, `/dev/tty*`, `/dev/rtc*`, nhiệt độ, thông tin eMMC nếu có (chỉ đọc, không ghi)
- [x] T011 [P] [US1] Viết `tools/measure/sample.sh <scenario> <seconds>` ghi CSV mỗi 1 s: `memAvailMb`, `rssMb` (theo PID tùy chọn), `cpuPct` từ `/proc/stat` — khớp `contracts/measurement.schema.json`
- [x] T012 [US1] 🔌 Chạy `device-profile.sh` qua SSH, lưu kết quả vào `docs/reports/device-profile.md` (FR-001)
- [x] T013 [US1] 🔌 ⚠️ Chép `hello-armhf` lên `/tmp` của BL335, chạy và xác nhận mã thoát 0, ghi vào báo cáo (FR-002, SC-001)
- [x] T014 [US1] 🔌 Đo baseline 300 s sau khi máy rảnh ≥ 5 phút bằng `sample.sh baseline 300`; lưu `docs/reports/baseline.csv` và so với ngưỡng ≤ 250 MB (FR-003, SC-002)

**Checkpoint**: quyết định được "thiết bị chạy được binary C++17 và RAM nền đạt/không đạt".

## Phase 4: User Story 2 — 10 client + client thứ 11 (P1)

**Goal**: PoC HTTP/WS + 500 Tag giả lập + load-tester + so sánh CivetWeb/Drogon.
**Independent Test**: quickstart mục 4, 5.

### Tests (viết trước, phải fail)

- [x] T015 [P] [US2] Test GoogleTest `core/session-manager/tests/session_manager_test.cpp`: chấp nhận 10 phiên, phiên 11 bị từ chối, slot giải phóng sau timeout 15 s (dùng đồng hồ giả), `max_clients > 10` bị cắt về 10 — **ghi chú review**: test dùng macro `CHECK` tự viết + CTest, không phải GoogleTest
- [x] T016 [P] [US2] Test `go test` trong `tools/load-tester/` cho bộ phân tích kết quả (đếm accepted/rejected, seqGaps, p95) dùng server giả

### Implementation

- [x] T017 [P] [US2] Cài đặt `core/session-manager/` (`session_manager.hpp/.cpp`): acquire/release/heartbeat/expire, thread-safe, đếm `rejectedTotal` — **ghi chú**: chỉ có `session_manager.hpp` (header-only), không có `.cpp`
- [x] T018 [P] [US2] Bộ sinh Tag giả lập `server/sim_tags.hpp/.cpp`: 500 Tag `SIM.T0001..T0500`, đổi giá trị mỗi giây, quality `GOOD`
- [x] T019 [US2] Vendor CivetWeb (MIT) vào `third_party/civetweb/` kèm LICENSE và thêm vào CMake
- [x] T020 [US2] Cài đặt `server/main.cpp` theo `contracts/live-ws.md`: phục vụ file tĩnh nén sẵn, `/api/v1/system/info`, WebSocket `/api/v1/live` với hello/subscribe/snapshot/delta (gom 250 ms)/heartbeat 5 s, đóng 4429 khi đầy, giới hạn hàng đợi 256 KB → `resync_required` — **phần hàng đợi 256 KB/`resync_required` CHƯA cài** (PoC ghi đồng bộ; chuyển Sprint 1, xem ADR-001)
- [x] T021 [US2] Tạo `deployment/systemd/mat-poc.service` với `MemoryMax=300M`, user không đặc quyền (chưa cài lên thiết bị)
- [x] T022 [P] [US2] Viết `tools/load-tester/main.go`: cờ `--host --clients --extra --duration`, mô phỏng N client + client dư, xuất JSON theo `measurement.schema.json` (`clientResults`)
- [x] T023 [US2] Build chéo `mat-poc` armhf; 🔌 ⚠️ chép lên BL335 và chạy
- [x] T024 [US2] 🔌 Chạy load-tester 10 + 1 client 300 s song song `sample.sh poc 300`; lưu `docs/reports/poc-civetweb.json` (SC-003, SC-004)
- [x] T025 [US2] 🔌 Kiểm tra giải phóng slot: ngắt không sạch 1 client, đợi > 15 s, client mới được nhận (FR-006)
- [x] T026 [P] [US2] Dựng PoC Drogon tối giản `server/poc-drogon/` (cùng contract) và build chéo armhf (FR-007) — Drogon v1.9.13 tĩnh, không TLS/ORM (`Dockerfile.drogon`, `build-drogon.ps1`); cùng contract, chung SessionManager/SimTags
- [x] T027 [US2] 🔌 Chạy cùng kịch bản với Drogon, lưu `docs/reports/poc-drogon.json`, lập bảng so sánh RSS/CPU — `docs/reports/poc-drogon.*`, bảng so sánh trong `poc-results.md`: CPU ngang, Drogon RAM 3,6 MB vs 2,1–2,3 MB, binary 1,97 MB vs 161 KB → giữ CivetWeb. Race lúc đăng ký (cả hai server) đã sửa, 100 lần đăng ký/server 0 mất sequence

**Checkpoint**: có số đo đủ để chọn web server và xác nhận giới hạn 10 client.

## Phase 5: User Story 5 — Go/No-Go có hồ sơ (P1)

**Goal**: báo cáo + 5 ADR + quyết định. (Phụ thuộc US1–US4 để có đủ số đo; tiêu chí Studio/SVG điền sau khi US3, US4 xong.)

- [x] T028 [P] [US5] ADR-001 máy chủ web (CivetWeb vs Drogon, dựa T024/T027) tại `docs/adr/001-web-server.md` — bản nháp, `Accepted`; Drogon chưa đo nên FR-007 cần Tech Lead chấp nhận ngoại lệ ở T034
- [x] T029 [P] [US5] ADR-002 hệ điều hành thương mại (Buildroot vs Ubuntu có vá) tại `docs/adr/002-commercial-os.md` — bản nháp, `Proposed` (thiếu dữ kiện BSP/spike Buildroot)
- [x] T030 [P] [US5] ADR-003 định danh đối tượng `elementUid` tại `docs/adr/003-element-uid.md` — bản nháp, nguyên tắc `Accepted`, định dạng UID `Proposed`
- [x] T031 [P] [US5] ADR-004 schema/versioning (SemVer + migration) tại `docs/adr/004-schema-versioning.md` — bản nháp, nguyên tắc `Accepted`, quy tắc tương thích chi tiết `Proposed`
- [x] T032 [P] [US5] ADR-005 ngân sách tài nguyên (xác nhận §6 bằng số đo) tại `docs/adr/005-resource-budget.md` — bản nháp; nhiều chỉ số ghi "chưa đo"; nêu mâu thuẫn ngưỡng RAM 200 MB (Constitution) so với 250 MB (SC-002)
- [x] T033 [US5] Lập `docs/reports/go-no-go.md`: 7 tiêu chí Master Plan §13, giá trị đo, ngưỡng, kết luận, biện pháp nếu không đạt (FR-013) — **bản nháp**: 6/7 tiêu chí đạt, #7 (Studio) chờ US4; ô quyết định để trống cho T034
- [ ] T034 [US5] Trình Tech Lead duyệt và ghi quyết định Go/No-Go (SC-007)

## Phase 6: User Story 3 — Mở SVG nhanh trên Chrome (P2)

**Goal**: ≥ 10 SVG mẫu hiển thị ≤ 2 s từ BL335.
**Independent Test**: quickstart mục 6.

- [x] T035 [P] [US3] Tạo ≥ 10 SVG mẫu trong `tests/fixtures/svg/` (bồn, motor, van, ống, đồng hồ, icon, nested group, gradient, clipPath, use) kèm `README.md` ghi phần mềm nguồn và đặc điểm (FR-011) — 12 file viết tay + file stress của người dùng (`factory-isometric-stress.svg`); **FR-011 "≥ 3 phần mềm" chưa đạt**, xem T036 và `tests/fixtures/svg/README.md`
- [ ] T036 [US3] Yêu cầu người dùng cung cấp ≥ 3 SVG xuất từ Illustrator/CorelDRAW (nếu có) và thêm vào fixtures; ghi rõ nếu thiếu
- [x] T037 [P] [US3] Trang thử `apps/runtime-web/index.html` + `src/main.ts`: liệt kê và hiển thị SVG, kiểm tra Chromium ≥ 120, nhận delta WS đổi màu 1 phần tử — kèm bộ lọc SVG tối thiểu (không phải sanitizer thật) và 21 test Vitest; đã chạy thử trên Chrome 154 với server x64 trong container cục bộ
- [x] T038 [US3] Nén sẵn (gzip) tài nguyên tĩnh, thêm bước build `apps/runtime-web` vào CMake/npm — `npm run build:web` (Vite + gzip), target CMake `runtime-web` (ngoài `all`), job CI `web`; CivetWeb phục vụ `.gz` đã kiểm chứng (file stress 4,55 MB → 554 KB)
- [x] T039 [US3] 🔌 ⚠️ Đưa fixtures + web lên thiết bị, đo thời gian tải từng SVG bằng Chrome DevTools, lưu `docs/reports/svg-load.md` (SC-005) — đo bằng Chrome headless (`tools/measure/svg-load.mjs`) thay vì DevTools thủ công; 13/13 file ≤ 2 s (lớn nhất 936 ms) **trong điều kiện đo** (Wi-Fi, 1 client, 12/13 file viết tay); xem hạn chế trong `docs/reports/svg-load.md`

## Phase 7: User Story 4 — Studio khởi tạo và CI (P2)

**Goal**: Studio cài offline được; CI chạy được.
**Independent Test**: quickstart mục 7 + `tools/ci-local.ps1`.

- [x] T040 [US4] ⚠️ Xin phép người dùng rồi cài Rust (rustup, toolchain MSVC) và Visual Studio Build Tools C++; xác nhận `cargo --version` — Rust 1.99.0 (winget, hash đã xác minh) + C++ của Visual Studio 2026 Insiders do người dùng tự thêm (MSVC 14.44/14.51, Windows SDK 22621/26100); `tauri info` ✔ mọi mục. Lệnh cài VS Build Tools tự động bị hệ thống chặn nên người dùng tự cài
- [x] T041 [US4] Khởi tạo `apps/studio/` bằng Tauri 2 + Vite + vanilla-ts, chạy `npm run tauri dev` hiển thị cửa sổ — `apps/studio` (Tauri 2.12.2 + Vite + TS). `tauri dev`: biên dịch 2 phút 38 giây, cửa sổ "mAT Studio" hiện, IPC `app_info` trả lời, console không lỗi (kiểm qua DevTools của WebView2)
- [x] T042 [US4] Cấu hình đóng gói NSIS với WebView2 offline trong `apps/studio/src-tauri/tauri.conf.json`; build bộ cài thử — bộ cài `mAT Studio_0.1.0_x64-setup.exe` (~208 MiB, nhúng WebView2 offline), release biên dịch ~4 phút; bản release chạy dưới CSP thật, IPC hoạt động, không vi phạm CSP — `docs/reports/studio-install.md`
- [x] T043 [US4] Cài thử bộ cài trên máy Windows 10 và Windows 11 không có Internet; ghi kết quả `docs/reports/studio-install.md` (SC-006) — **một phần**: đã cài/mở/gỡ im lặng trên máy dev Windows 11 (có mạng, đã có WebView2): cài 18,7 s không cần admin, IPC OK, gỡ sạch. **Chưa thử** trên Windows 10 và trên máy không Internet/không có WebView2 (cần máy của người dùng) — `docs/reports/studio-install.md` — **cập nhật**: người dùng xác nhận cài offline OK trên Windows 10/11, kể cả máy chưa có WebView2
- [x] T044 [P] [US4] Chạy `tools/ci-local.ps1` (lint + test + build x64 + armhf) và sửa đến khi xanh (FR-009) — `tools/ci-local.ps1` viết lại (dừng ở bước lỗi đầu tiên, thêm build x64 + ctest, `go test -count=1`): 8/8 bước xanh (armhf, x64+ctest 1/1, go vet, go test, lint, typecheck, test 21/21, build:web); build armhf từ đầu trong container cũng OK (binary 161.348 B, ELF ARM EABI5). Chưa chạy trên GitHub Actions

## Phase 8: Polish

- [x] T045 [P] Cập nhật `README.md` với hướng dẫn build/chạy/đo — README: yêu cầu, kiểm tra, chạy PoC, đo, cấu trúc
- [x] T046 [P] Hoàn tác/ghi nhận mọi thay đổi trên BL335 trong `docs/reports/device-changes.md` (FR-014) — nhật ký đã đủ các thay đổi do Sprint 0; bổ sung kiểm tra chỉ đọc: lần khởi động lại 10:20, các unit atscada cũ còn lại và timer 5 s (chưa đụng tới)
- [x] T047 Chạy lại toàn bộ `quickstart.md` từ đầu để xác nhận lặp lại được — mục 1–6 chạy lại trên BL335 (`quickstart-rerun.md`), mục 7 người dùng xác nhận cài offline OK trên Windows 10/11; quickstart đã sửa 3 chỗ sai
- [x] T048 Điền các tiêu chí Studio/SVG còn thiếu vào `docs/reports/go-no-go.md` và chốt quyết định — `go-no-go.md` đủ 7/7 tiêu chí có số đo; ô quyết định để Tech Lead điền (T034)

## Phase 9: Sau review mã và khác biệt định dạng SVG (bổ sung 2026-10-10)

Nguồn: review độc lập (5 Important, 0 Critical) và yêu cầu của người dùng xem xét SVG từ nhiều phần mềm vẽ.

- [x] T049 Bộ lọc SVG: khớp `href` theo localName ở mọi namespace (I-1), bỏ phần tử ngoài namespace SVG (I-2), giải escape CSS + chặn `image-set`/`url()` ngoài trong `<style>` và thuộc tính `style` (S-2), chặn SMIL đổi `href`; test trong `sanitize.test.ts`
- [x] T050 `apps/runtime-web/src/inspect.ts`: nhận diện phần mềm xuất (Inkscape, Illustrator Save As/Export As, CorelDRAW, draw.io, LibreOffice) và cảnh báo khác biệt định dạng; CLI `tools/svg-inspect` (`npm run svg:inspect`); test trong `inspect.test.ts`
- [x] T051 5 fixture mô phỏng `synthetic-*.svg`; so ảnh Inkscape ↔ Chrome cho file thật (giống nhau, chỉ khác khử răng cưa); thí nghiệm ghép 2 SVG (class/id trùng → sai màu, Shadow DOM sửa được) — `docs/architecture/svg-dialects.md`
- [x] T052 Trang thử: Shadow DOM cho màn hình, bù viewBox, hiện nguồn + cảnh báo, CSP meta, favicon; lỗi khởi động không treo (I-3)
- [x] T053 Client WebSocket theo contract: bỏ delta trước snapshot, mất sequence thì đóng 4000 rồi kết nối lại, watchdog 15 s (4001), STALE khi mất kết nối; hàm thuần + test (I-5, S-5, S-6); contract ghi 4408 và quy tắc echo heartbeat
- [x] T054 `tools/measure/svg-load.mjs`: dừng sớm khi trang lỗi, mã thoát khác 0 khi không có kết quả/lỗi trang (I-3)
- [x] T055 Lint/format theo Constitution: ESLint + Prettier (`npm run lint`), clang-format 10 trong image toolchain (định dạng lại 5 file C++: chỉ khoảng trắng và thứ tự `#include`), gofmt; có trong CI và `ci-local.ps1` (I-4)
- [x] T056 CI/script (S-4): `permissions: contents: read`, `go-version-file`, `test-x64.ps1` kiểm mã thoát `docker build`, `ci-local.ps1` không đỏ giả vì stderr, CMake tìm `npm.cmd`; target CMake `runtime-web` đã chạy thử trên Windows (CMake 4.3.1 của VS 2026 + Ninja)
- [x] T057 Studio (S-7): `isTauri()`, CSP thêm `object-src/base-uri/form-action 'none'`, `freezePrototype`; dựng lại bộ cài
- [x] T058 (làm ở Sprint 1: specs/002-vertical-slice T066–T071; kiểm bằng tools/measure/http-check.mjs trên x64 và BL335) Server kiểm `Origin` cho WebSocket; header CSP cho `/screens/*.svg`; không triển khai `unsafe-elements.svg` kèm bản thật (review S-3)
- [ ] T059 (Sprint 2) Importer theo yêu cầu trong `docs/architecture/svg-dialects.md` (bỏ DTD, allowlist, CSS → thuộc tính theo cascade, tiền tố id khi ghép, font PostScript, `flowRoot`, giới hạn node — cần quyết định ngưỡng 20.000)

## Dependencies & Execution Order

- Phase 1 → Phase 2 → các story. T007 (Docker) chặn T008–T009 và mọi build armhf.
- **US1** (T010–T014) chỉ cần T009; **US2** cần T009 + T017–T022; T023 cần US1 xong để biết thiết bị chạy được binary.
- **US5** cần số đo từ US1/US2 (ADR-001/005), phần Studio/SVG cần US3/US4 (hoàn tất ở T048).
- **US3** cần T020 (server) cho phục vụ file; **US4** độc lập với thiết bị, có thể làm song song với US2.

### Cơ hội chạy song song
- Phase 1: T002–T006. US1: T010 ‖ T011. US2: T015 ‖ T016, T017 ‖ T018 ‖ T022, T026. ADR: T028–T032. US3 T035 ‖ T037. US4 độc lập với US2/US3.

## Implementation Strategy

1. **MVP = US1** (đến T014): nếu thiết bị không chạy được binary hoặc RAM nền > 250 MB thì dừng và xử lý (Go/No-Go) trước khi làm tiếp.
2. Tiếp US2 (số đo cốt lõi), rồi US5 phần ADR.
3. US3 và US4 làm sau/song song; kết thúc bằng T047–T048.

**Tổng:** 48 tác vụ — Setup 6, Foundational 3, US1 5, US2 13, US5 7, US3 5, US4 5, Polish 4.
