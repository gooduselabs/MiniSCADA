# Implementation Plan: Màn hình v1, widget và điều khiển từ Chrome

**Branch**: `007-screens-widgets` | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/007-screens-widgets/spec.md`

## Summary

GĐ 3a của [lộ trình v2](../../docs/plans/roadmap-v2.md) (§4.3), một feature (D1). Người vận hành dùng Chrome xem dashboard nhiều màn hình có widget và điều khiển được máy sau khi đăng nhập qua HTTPS; kỹ sư dựng dashboard hoàn toàn trong Studio bằng trình bố trí kiểu IDE.

Cách làm ([research.md](research.md) R1–R25):

- **Mô hình màn hình v1** (ADR-013, định dạng **0.3.0**):
  - màn hình = khung `size` (mặc định 1920 × 1080) chứa `items` có thứ tự xếp lớp: item `svg` (binding theo `elementUid` như 0.2, mỗi item một Shadow DOM) và item `widget` (HTML đặt chồng, không nằm trong SVG);
  - cả khung co bằng một phép `transform: scale(k)` theo `fitMode`; vùng chứa tô nền của màn hình;
  - `navigation` trong `project.json`; đường dẫn `#/<id>`; popup là màn hình `kind: "popup"` trong lớp phủ riêng;
  - `projects/active` thành bản tóm tắt, mỗi màn hình tải lười (ước 250 item ≈ 67 KB; 32 màn hình ≈ 2,1 MB);
  - Studio nâng cấp 0.2 → 0.3 trong bộ nhớ, sao lưu trước lần lưu đầu; runtime 0.6 nhận 0.1, 0.2, 0.3; bộ chuyển `toScreenModel` cho một đường dựng.
- **Thư viện widget `@mat/ui-components`** (ADR-019):
  - 15 web component Lit trong Shadow DOM; widget không gọi mạng, nhận `TagSource` và `ActionHost` từ nơi chứa (trang runtime hoặc xem trước Studio);
  - **danh mục** `schemas/widgets.catalog.json` là nguồn duy nhất của khe, thuộc tính, hành động, cỡ cho hai validator (TS và C++), inspector và Toolbox;
  - `ControlController` thuần TS quyết định khóa, xác nhận, kết quả cho mọi widget điều khiển; `<mat-screen>` dựng màn hình dùng chung Studio và Chrome.
- **Biểu đồ** (ADR-020): uPlot 1.6.32 (MIT) cho biểu đồ đường, cột và tròn tự viết SVG; cửa sổ dữ liệu tự viết (bộ đệm vòng 3.600 điểm, đứt khi BAD), không lưu lịch sử.
- **Đăng nhập trên Chrome** (ADR-021):
  - dùng chung `AuthService` và `SessionStore` của 005, loại phiên `web`; cookie `__Host-mat_sid` (`HttpOnly; Secure; SameSite=Strict`), CSRF theo phiên + `Origin` + `Sec-Fetch-Site`;
  - cookie chỉ vào endpoint của trang runtime (`SESSION_SCOPE` với mọi API kỹ thuật); WebSocket có cookie bắt buộc `Origin`; `viewerLogin` `off` (mặc định) hoặc `required`;
  - ghi Tag vẫn chỉ qua `POST /api/v1/tags/write` (006); API 1.2.0 thêm `context`, `expect` (BOOL, so sánh rồi ghi), `pulseMs` (BL335 giữ nhịp xung).
- **Chứng chỉ** (ADR-021): chứng chỉ tự ký có SAN IP của card, `GET /device.crt`, `--make-csr` và `--import-cert` cho CA khách hàng, hướng dẫn cài vào kho gốc của Windows; không ACME.
- **Studio** (ADR-022): editor Màn hình = `<mat-screen mode="edit">` + lớp phủ; Pointer Events tự viết; hình học (bắt dính, gióng, căn chỉnh, đổi cỡ, phân bố, xếp lớp) là hàm thuần có bảng test; inspector sinh từ danh mục; kéo Tag và widget bằng HTML5 DnD; hoàn tác dùng lịch sử có sẵn; xem trước Mô phỏng và Thiết bị dùng cùng widget.

Quyết định ghi trong ADR [013](../../docs/adr/013-screen-model-v1.md), [019](../../docs/adr/019-widget-library.md), [020](../../docs/adr/020-realtime-chart.md), [021](../../docs/adr/021-web-login-certificates.md), [022](../../docs/adr/022-screen-editor.md) (Proposed). Bố cục giao diện: [mockup studio-screens.html](../../docs/architecture/mockups/studio-screens.html) (đã tạo ở bước plan, phiên làm việc tự duyệt).

**Phiên bản:** runtime 0.6.0; Studio 0.5.0; định dạng project 0.3.0; API thiết bị 1.2.0; giao thức live 1.2.0 (không đổi; alarm GĐ 4 vẫn là 1.3.0); gói `.matscada` 1.0.0; `@mat/ui-components` 0.1.0.

## Technical Context

**Language/Version**:

- C++17 (GCC 9 trong Docker Ubuntu 20.04; cross `arm-linux-gnueabihf`);
- TypeScript 7 (Vite 8, Lit 3.3.3);
- Rust 1.99, edition 2024 (Tauri 2.12): không đổi;
- Node ≥ 22 cho công cụ; PowerShell, sh.

**Primary Dependencies** (phiên bản, license: research R23):

- **Runtime C++:** không thêm thư viện. CivetWeb 1.16, Mbed TLS 3.6.7 (kiểm cấu hình có `MBEDTLS_X509_CSR_WRITE_C`; bật thì ghi `third_party/LICENSES.md`), SQLite, nlohmann/json, valijson, GoogleTest.
- **Trang runtime và Studio:** thêm **uPlot 1.6.32** (MIT, phát hành 2025-03-14, ADR-020). Lit 3.3.3, `@fluentui/svg-icons` 1.1.343 (thêm icon dùng tới) đã có.
- **Package mới trong workspace:** `@mat/ui-components`.
- **Test:** Vitest, jsdom, puppeteer-core, axe-core, GoogleTest (đã có); image CA thử (openssl) trong `web-it`.

**Storage**:

- **BL335:** `<dataDir>/tls/{server.pem, server.pem.prev, pending-key.pem, csr-*.pem}`; `audit.db` không đổi lược đồ; phiên web trong RAM (và `auth-state.json` trên tmpfs khi `execv`).
- **Project:** `screens/<id>.screen.json` đổi cấu trúc; `project.json` thêm `navigation`; `.mat-backup/` khi nâng cấp.
- **Trình duyệt:** bộ đệm biểu đồ trong RAM; không dùng `localStorage` cho phiên hay CSRF (chỉ có thể dùng cho tùy chọn giao diện như theme, bọc `try/catch`).

**Testing**:

- GoogleTest + CTest (x64 Docker); test armhf dưới qemu-user (thêm module mới vào `MAT_ARMHF_TEST_TARGETS`);
- Vitest (vector chung, hình học, `ControlController`, `ChartWindow`, widget trên jsdom); e2e Chrome headless với lớp Tauri giả (Studio) và runtime giả (trang), axe-core;
- tích hợp x64 `tools/web-it.ps1` (mạng Docker: runtime, giả lập Modbus, Chrome headless, client tấn công, CA thử);
- thử tay: bộ gõ, Chrome thật, trình đọc màn hình;
- đo trên BL335 ở task ⚠️🔌 (SSH và người).

**Target Platform**: BL335 (armv7l, 2 × Cortex-A7, 993 MB RAM, Ubuntu 20.04.5, systemd 245, eMMC ext4); Chrome/Chromium ≥ 120 trên Windows và Linux; Studio trên Windows 10/11 (WebView2).

**Project Type**: dịch vụ nhúng C++ (mở rộng `mat-runtime`: phiên web, cổng kiểm, chứng chỉ, validator 0.3), ứng dụng web TS (`apps/runtime-web`), package TS dùng chung (`@mat/ui-components`), ứng dụng desktop Tauri (Studio).

**Performance Goals**:

| Mục tiêu | Ngưỡng | Nguồn |
|---|---|---|
| Mở màn hình chuẩn (20 widget, 1 SVG, 100 Tag) | ≤ 2 s; chuyển màn hình đã mở ≤ 500 ms | SC-002 |
| 10 client cùng F5 | tất cả có giá trị sống ≤ 5 s | SC-003 |
| BL335 với 10 client + 500 Tag, 30 phút | CPU ≤ 30 %, RSS ≤ 150 MB, 0 mất sequence | SC-004 |
| Ghi từ Chrome (LAN) | ≥ 95 % `CONFIRMED` ≤ 2 s | SC-006 |
| Tải khởi động trang | ≤ 250 KB nén gzip; biểu đồ đường thêm ≤ 100 KB | SC-024 |
| Trình bố trí | mở 250 item ≤ 1 s; kéo 100 item ≤ 16,7 ms/khung; hoàn tác ≤ 100 ms | SC-013 |
| Biểu đồ | 8 × 8 × 3.600 điểm, 30 phút: bộ nhớ tab +≤ 100 MB; vẽ p95 ≤ 8 ms | SC-017 |
| Đổi cỡ cửa sổ | cập nhật ≤ 100 ms | FR-014 |
| Đăng nhập (ADR-011) | ≤ 2 s trên BL335 | US3-2 |

**Constraints**:

- Ngân sách Constitution III: thay đổi phía BL335 nhỏ (phiên web, phục vụ tĩnh, danh mục); ước tính RSS tăng ≤ 1 MB (research R18).
- Mỗi file JSON ≤ 1 MiB (gói 005): file màn hình 250 item ≈ 67 KB, thoải mái.
- Không thêm GPL/LGPL; thư viện mới phát hành ≥ 2 tuần (uPlot 1.6.32: 2025-03-14).
- Không sửa `specs/004`, `005`, `006`; điểm 007 đổi so với contract cũ (ADR-006 điểm 7 cho cookie; ADR-018 điểm 3) nằm ở ADR-021 và [contracts/device-api-1.2.md](contracts/device-api-1.2.md).
- SSH tới BL335 không có trong phiên viết kế hoạch: bước trên BL335 chờ quyền hoặc người dùng tự chạy lệnh ([quickstart.md](quickstart.md) §7, §9).
- Ổ D: máy dev còn ít chỗ (build Rust và C++ trên C:).

**Scale/Scope**:

- ≤ 32 màn hình, ≤ 250 item/màn hình, ≤ 1.000 Tag/màn hình; 15 loại widget; 8 phiên web.
- Khoảng 10 module C++ mới hoặc sửa (`core/auth`, `core/tag-engine`, `core/project-manager`, `server/http`, `server/tls`, `server/cli`); 1 package TS mới, 4 package/ứng dụng TS sửa; 5 endpoint mới, 3 có sẵn thêm trường; 5 ADR; 3 editor và 6 hộp thoại Studio mới.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution 2.0.1.

| Nguyên tắc | Đánh giá | Ghi chú |
|---|---|---|
| I. Vertical slice trên thiết bị thật | ✅ (cần đo) | Mọi chức năng chạy và kiểm trên x64 và Chrome headless trước; nghiệm thu trên BL335 ở task ⚠️🔌 (SC-002, 003, 004, 010, 019). Chứng chỉ có SAN IP chưa thử trên Chrome thật: task spike sớm |
| II. Ranh giới kiến trúc | ✅ | Trang chỉ hiển thị, tương tác, gọi API; widget không gọi mạng (`TagSource`/`ActionHost`), dùng chung cho Studio và Chrome; hai validator đọc cùng danh mục và chạy cùng vector; render trên Chrome, không trên BL335; `core/` không include UI. `apps/studio` điều phối package dùng chung (`@mat/ui-components`, `@mat/project-schema`) và chứa logic soạn thảo (không phải logic runtime) |
| III. Ngân sách tài nguyên | ✅ (cần đo) | RSS tăng ≤ 1 MB, CPU thêm do phục vụ file tĩnh và đăng nhập (research R18); tải trang ≤ 250 KB nén; đo ở SC-004 trên x64 và BL335. Ghi eMMC không đổi (audit 006) cộng ≤ 10 dòng/phút do web |
| IV. Chrome ≥ 120, 10 client | ✅ | Không tính năng mới hơn Chrome 120; đổi đăng ký trên cùng kết nối live (không thêm phiên); giao thức live 1.2.0 không đổi |
| V. An toàn, bảo mật (NON-NEGOTIABLE) | ✅ (cần rà soát) | Ghi Tag chỉ HTTPS + phiên + role operator + audit bền (006) qua một đường; cookie `HttpOnly; Secure; SameSite=Strict; __Host-`, CSRF ba lớp, cookie không vào API kỹ thuật, WebSocket có cookie bắt buộc `Origin`; không `eval`, không `innerHTML` với dữ liệu project, không script (hành động có sẵn); bộ kiểm tra ở Studio và runtime, runtime không kích hoạt project lỗi; chứng chỉ: khóa riêng không rời thiết bị, nhập chứng chỉ từ chối file có khóa riêng. Rà soát bảo mật là task bắt buộc (FR-077). **Giới hạn còn lại ghi rõ:** XSS đã thực thi có thể ghi dưới quyền operator đang đăng nhập; interlock ở PLC |
| VI. Test trước | ✅ | Test viết trước theo FR-073…FR-075; 30 ca tấn công; vector chung (≥ 120 ca); hình học; `ControlController`; tích hợp x64 |
| VII. Đơn giản, có phiên bản | ✅ | Đúng phạm vi GĐ 3a (không alarm, lịch sử, SVG import). YAGNI: một popup, menu một cấp nhóm, không quyền xem theo màn hình. SemVer: runtime 0.6.0, project 0.3.0 có migration, API 1.2.0, live 1.2.0 giữ, gói 1.0.0 giữ. Deploy atomic giữ chuỗi 005. Thêm uPlot (MIT, không phụ thuộc, ≥ 2 tuần) có ADR-020 |
| Ràng buộc công nghệ | ✅ | C++17/CMake/Ninja/armhf, CivetWeb, Mbed TLS (có sẵn); Studio Tauri 2 + TS + Vite + Lit; SQLite không đổi (`audit.db` FULL, lược đồ không đổi); không thêm thư viện C++. SVG.js và interact.js (Master Plan §4) **không dùng**: canvas là DOM thật (ADR-022) |
| Quy trình | ✅ | Spec Kit; ADR 013, 019–022; mockup trước code giao diện; thao tác BL335 chỉ khi người dùng cho phép |

**Kết quả trước Phase 0:** đạt. Không có `NEEDS CLARIFICATION`: mọi điểm spec để ngỏ đã chọn ở research, ghi "Quyết định (người dùng giao toàn quyền 2026-10-11)".

**Kiểm lại sau Phase 1** (data-model, contracts):

- Không phát sinh vi phạm mới.
- **Bề mặt mạng mới:** `web/login`, `web/session`, `web/logout`, `web/touch`, `GET /login`, `GET /device.crt`; endpoint cũ nhận cookie: `tags/write*`, `projects/active`, `system/info`, `device/identity`, `/project/*`, live. Mọi cái khác từ chối cookie.
- **Đường ghi Tag:** vẫn chỉ một; 30 ca tấn công có test từ chối và audit.
- **Điểm thay đổi so với ADR cũ:** ADR-006 điểm 7 (cookie → `Origin` bắt buộc), ADR-018 điểm 3 (cookie là phiên hợp lệ) — cả hai ghi ở ADR-021; bảng ADR cập nhật khi chuyển Accepted.
- **Điểm cần phiên chính duyệt:** câu hỏi 1, 2 ở mục "Câu hỏi cho phiên chính" (đã trả lời).

## Project Structure

### Documentation (this feature)

```text
specs/007-screens-widgets/
├── spec.md
├── plan.md                         # file này
├── research.md                     # R1–R25
├── data-model.md                   # màn hình, item, widget, hành động, điều hướng, trạng thái trang, phiên web, Studio
├── quickstart.md                   # test, tích hợp x64, Studio, chứng chỉ, lệnh chỉ đọc BL335, BL335 ⚠️🔌
├── contracts/
│   ├── project-format-0.3.md       # schema 0.3.0, ví dụ, mã lỗi, migration, toScreenModel, vector
│   ├── widget-catalog.md           # 15 widget: khe, thuộc tính, hành động, luật
│   ├── ui-components-api.md        # TagSource, ActionHost, <mat-screen>, ControlController, ChartWindow, token
│   ├── device-api-1.2.md           # web/*, /login, /device.crt, projects/active 0.3, tags/write mở rộng, cổng kiểm
│   ├── web-session.md              # phiên, cookie, CSRF, hành vi trang, 30 ca tấn công
│   ├── device-config-007.md        # runtime.json, lệnh chứng chỉ, deploy.sh, tài liệu
│   └── studio-screen-editor.md     # mô-đun, thao tác tài liệu, cử chỉ, phím, kéo thả, inspector, xem trước
├── checklists/requirements.md
└── tasks.md                        # /speckit-tasks
docs/adr/013, 019, 020, 021, 022; docs/architecture/mockups/studio-screens.html
```

### Source Code (repository root)

```text
schemas/
├── project.schema.json, screen.schema.json, binding.schema.json, tag.schema.json, …  # → 0.3.0
├── widgets.catalog.json                                                              # mới
├── 0.1/, 0.2/                                                                        # 0.2 đóng băng mới
└── protocol-version.json                                                             # project ["0.1","0.2","0.3"]; live 1.2.0

core/
├── auth/                           # (sửa) session_store: kind web, csrf; auth_service: loginWeb, authorizeWeb, touch, quota; roles: cột cookieAllowed
├── tag-engine/                     # (sửa) write_coordinator: context, expect, pulseMs (hẹn đơn điệu, lệnh ngược); audit detail
├── project-manager/                # (sửa) project_validator: chọn schema 0.3; rules_03.cpp (danh mục, luật màn hình, menu); widget_catalog.*
└── audit/                          # (sửa) action mới: auth.session_evicted, tls.*; mã access.denied mới

server/
├── http/
│   ├── web_api.*                   # (mới) web/login, logout, session, touch; /login; /device.crt; Set-Cookie một chỗ
│   ├── auth_gate.*                 # (sửa) nhánh cookie: phạm vi, Origin, CSRF, Sec-Fetch-Site
│   ├── viewer_gate.*, source_filter.*   # (sửa) phiên web như phiên hợp lệ; viewerLogin
│   ├── http_api.*                  # (sửa) projects/active 0.3 (tóm tắt), system/info.web, CSP không đổi
│   └── tags_api.cpp                # (sửa) trường mới, mã mới, channel web
├── websocket/civet_transport.*     # (sửa) nâng cấp mang cookie: Origin bắt buộc, kiểm lại 60 s
├── tls/server_cert.*               # (sửa) SAN IP, EKU, KeyUsage; đọc SAN; CSR; import
├── cli/cert.*                      # (sửa) --cert-info, --make-csr, --import-cert
├── config.*, main.cpp              # (sửa) viewerLogin, webSessionIdleMin, webMaxSessions, webSessionMaxHours
deployment/
├── device/deploy.sh                # (sửa) lời nhắc, kiểm widgets.catalog.json
└── package-runtime.ps1             # (sửa) schemas/0.2, widgets.catalog.json, web/login.html, kiểm kích thước gzip

packages/
├── ui-components/                  # (mới) host/, screen/, control/, format/, chart/, widgets/, i18n/, styles/
├── project-schema/src/             # (sửa) types-03.ts, rules-03.ts, migrate.ts (migrate02to03), to-screen-model.ts, compare.ts (kind mới), project-files.ts, codes.ts
├── binding-engine/, svg-renderer/  # (sửa nhẹ) không đổi giao diện công khai; kiểm item svg nhiều
└── live-client/                    # (sửa nhẹ nếu cần) không đổi giao thức

apps/runtime-web/                   # (viết lại main.ts) shell, route, menu, popup, đăng nhập, WebActionHost, LiveTagSource, i18n; login.html
apps/studio/
├── src/model/                      # screen-doc.ts, screen-edit/, screen-catalog.ts, screen-issues.ts, navigation-doc.ts, preview-hosts.ts; project-doc.ts, tree.ts, upgrade (0.2→0.3)
├── src/ui/editors/                 # screen-editor.ts (thay screen-preview.ts), navigation-editor.ts
├── src/ui/screen/                  # mat-screen-canvas.ts, mat-ruler.ts, mat-layers.ts, mat-screen-toolbar.ts
├── src/ui/                         # props-widget.ts, mat-taskcards.ts (Toolbox thật), dialogs/screen-props, delete-screen
└── src/i18n/vi-screens.ts

tests/
├── project-vectors/v03-*, widget-catalog-vectors/, migration-vectors/*-0.2to0.3/, web-it/ (compose, CA thử, kịch bản)
tools/
├── web-it.ps1, dashboard-demo/generate.mjs
└── project-validator/validate.mjs  # (sửa) 0.3, --migrate 0.2→0.3
projects/dashboard-demo/            # project mẫu 0.3.0
docs/
├── architecture/mockups/studio-screens.html   # đã có
├── deployment/mat-runtime.md                  # mục "HTTPS cho Chrome và đăng nhập trên trang vận hành"
└── reports/007-acceptance.md, device-profile.md (mục chứng chỉ), device-changes.md
```

**Structure Decision:**

- **BL335:** logic mới nằm trong `core/` (phiên web, validator 0.3, bộ điều phối ghi) thành thư viện độc lập CivetWeb để unit test không cần mạng; `server/` chỉ nối HTTP, WebSocket, TLS, CLI.
- **Hàm thuần có test trước:** `ControlController`, `ChartWindow`, `fit`, `formatValue`, hình học `screen-edit`, `migrate02to03`, `toScreenModel`, luật 0.3 (hai bản), hàm `Set-Cookie`, so sánh `Origin`, so CSRF.
- **Dùng chung (Constitution II):** widget, `<mat-screen>`, định dạng giá trị, danh mục, validator nằm trong `packages/*` và `schemas/`; trang và Studio chỉ cấp `TagSource` và `ActionHost`.
- **Studio:** quyết định ở TS thuần (`model/`), giao diện chỉ hiển thị; mạng và file qua Rust (không lệnh Tauri mới).

### Ảnh hưởng tới mã của 004, 005, 006

Cả ba feature đã xong về mã trên x64 (commit `bb765d1`); không có tác nhân khác đang sửa các file này, nên không cần xếp lịch chờ. Các file chung vẫn chỉ nên thêm dòng hoặc khối mới.

| File | Thay đổi | Rủi ro hồi quy |
|---|---|---|
| `core/auth/*`, `server/http/auth_gate.*` | loại phiên `web`, nhánh cookie | cao: chạy lại toàn bộ test `auth`, `device-it`, `driver-it -Scenario write` |
| `core/tag-engine/write_coordinator.*`, `server/http/tags_api.cpp` | `context`, `expect`, `pulseMs` | cao: chạy lại `write`, `write-race`, `write-kill`, `write-deploy` |
| `server/websocket/civet_transport.*`, `server/http/{viewer_gate,source_filter}.*` | cookie ở nâng cấp, `viewerLogin` | trung bình: chạy lại `driver-it -Scenario source` |
| `server/tls/server_cert.*` | SAN, EKU | trung bình: Studio phải ghim được chứng chỉ mới (005) |
| `core/project-manager/*`, `packages/project-schema/*` | luật 0.3 | cao: 82 ca 0.1 và ca 0.2 giữ kết luận (SC-012) |
| `apps/runtime-web/src/main.ts` | viết lại | cao: `compat` với 0.1 và 0.2 (SC-011) |
| `apps/studio/src/ui/editors/screen-preview.ts` | thay bằng `screen-editor.ts` | trung bình: giữ ba chế độ xem trước và e2e của 004, 006 |
| `apps/studio/src/ui/mat-taskcards.ts`, `model/tree.ts`, `model/project-doc.ts` | Toolbox thật, nút màn hình, tài liệu 0.3 | thấp |
| `CMakeLists.txt`, `package.json`, `eslint.config.mjs`, `tools/ci-local.ps1`, `third_party/LICENSES.md` | target, workspace, glob lint, bước CI, license uPlot | thấp |

## Thứ tự làm (gợi ý cho `/speckit-tasks`)

0. **Làm ngay, không phụ thuộc gì:**
   - mockup (đã tạo: T003; phiên chính tự duyệt: T004);
   - **spike** (task đầu): Chrome có tin chứng chỉ tự ký không-CA có SAN IP khi cài vào Trusted Root (kiểm trên máy dev bằng `openssl` sinh chứng chỉ tương đương + Chrome thật); đo kích thước gzip của uPlot; ba ảnh chụp `contain` của ADR-013;
   - người dùng chạy lệnh chỉ đọc trên BL335 ([quickstart.md](quickstart.md) §7), hoặc phiên làm việc khi có quyền.
1. **Nền dùng chung** (file mới, không đụng nhau):
   - schema 0.3.0 và danh mục; `rules-03.ts`; `migrate02to03`; `toScreenModel`; vector `v03-*`, `widget-catalog-vectors`, `migration-vectors`;
   - package `@mat/ui-components`: `host/` (kiểu), `format/`, `control/` (`ControlController`), `chart/window.ts`, `screen/fit.ts` (hàm thuần, test trước);
   - `projects/dashboard-demo` (sinh bằng script).

   **Mốc:** vector chung xanh ở bản TS; các hàm thuần xanh.
2. **Validator C++ 0.3 và runtime nhận 0.3:** `rules_03.cpp`, `widget_catalog.*`, chọn schema theo phiên bản, `projects/active` tóm tắt, `protocol-version.json`, `package-runtime.ps1` chép danh mục; **mốc:** vector chung xanh ở hai bản (SC-012); project 0.1, 0.2 qua mọi kiểm tra của 004–006 (SC-021).
3. **US1: trang runtime nhiều màn hình** (widget hiển thị, `<mat-screen>`, shell, route, popup, tải lười, `LiveTagSource`): **mốc:** `screens`, `compat`, `widgets` xanh trên x64.
4. **Phiên web và điều khiển (US3):** `core/auth` loại web, `web_api`, cổng kiểm, WebSocket có cookie, `viewerLogin`, `write_coordinator` mở rộng (`context`, `expect`, `pulseMs`), widget điều khiển và hộp xác nhận, đăng nhập trên trang; **mốc:** `control`, `locks`, `attack`, `session`, `pulse`, `expect` xanh.
5. **US4:** `line` (uPlot), `bar`, `pie`, `tag-table`; **mốc:** `charts` xanh; bundle ≤ ngân sách.
6. **US5:** SAN, `device.crt`, `--make-csr`, `--import-cert`, `--cert-info`, `deploy.sh`, tài liệu; `cert` xanh.
7. **US2: Studio** (bắt đầu được song song từ bước 1 phần mô hình; giao diện sau mockup được duyệt): `screen-doc`, `screen-edit/` (hình học), `gesture`; canvas, lớp phủ, thước; Toolbox; kéo thả; inspector; Lớp; điều hướng; quản lý màn hình; nâng cấp 0.2 → 0.3; kiểm tra liên tục; so sánh/đọc lên; **mốc:** e2e dựng dashboard 20 widget xanh (SC-001, phần x64).
8. **US6:** xem trước Mô phỏng và Thiết bị với `preview-hosts`; `f5x10`, `open`, `load`, `deploy-live`; đo.
9. **Hoàn thiện:** rà soát bảo mật (FR-077), trợ năng, đối chiếu studio-ux §5, tài liệu, báo cáo, ADR chuyển Accepted (phần đã đo).
10. **BL335 ⚠️🔌**, khi người dùng cho phép: [quickstart.md](quickstart.md) §9.

**Theo user story:**

| Story | Gồm |
|---|---|
| US1 (P1) Dashboard nhiều màn hình | bước 1, 2, 3 |
| US2 (P1) Trình bố trí Studio | bước 1 (mô hình), 7 |
| US3 (P1) Điều khiển có kiểm soát | bước 4 (gồm widget điều khiển) |
| US4 (P2) Biểu đồ và bảng | bước 5 |
| US5 (P2) Chứng chỉ HTTPS | bước 6 |
| US6 (P3) Xem trước và nhiều client | bước 8 |

Bước 4 phải xong (kể cả rà soát bảo mật) trước khi phát hành runtime 0.6 có điều khiển lên BL335 có port-forward: cổng HTTPS mở đăng nhập từ Internet.

## Rủi ro

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Chrome không tin chứng chỉ tự ký không-CA có SAN IP | Trung bình | Spike ở bước 0; dự phòng: CA cục bộ hai tầng (ADR-021) |
| Bề mặt tấn công mới (cookie, CSRF, WebSocket) | Cao | Ba lớp chống CSRF; phạm vi cookie hẹp; 30 ca tấn công tự động; rà soát bảo mật; chỉ nhận HTTPS |
| XSS đã thực thi ghi dưới quyền operator | Trung bình | Không `innerHTML`/`eval`; CSP; xác nhận; giới hạn tần suất; audit; interlock ở PLC; ghi giới hạn còn lại trong báo cáo |
| Phạm vi lớn (6 story, 15 widget, trình bố trí, đăng nhập, chứng chỉ) | Cao | Theo thứ tự P1 trước; mốc sau mỗi bước; widget thêm bằng danh mục |
| Hiệu năng kéo thả 250 item DOM thật | Trung bình | Đo sớm (SC-013); dự phòng bản xem nhanh khi kéo |
| Hai validator lệch nhau (danh mục) | Trung bình | Một danh mục, một bộ vector, mỗi mã một ca đúng và một ca sai |
| Tải BL335 khi 10 client F5 cùng lúc | Trung bình | Tải lười (≈ 70 KB/màn hình), gzip có sẵn; đo SC-002, SC-003 trên x64 rồi BL335 |
| Dự toán gzip của project nạp (không có `.gz`) | Thấp | Đo; nếu chậm: bật nén tại runtime (ngoài phạm vi, ghi rủi ro) |
| Không có SSH tới BL335 | Cao | Đo x64 trước; task ⚠️🔌; lệnh chỉ đọc cho người dùng |
| Mất phiên khi đổi IP (Wi-Fi, DHCP) | Thấp | Ghi trong tài liệu; đăng nhập lại 1 lần |
| Người vận hành quen trang xem HTTP không điều khiển được | Thấp | Dải "Mở bằng HTTPS để điều khiển" + liên kết |
| Thiếu người thử bộ gõ, trợ năng, Chrome thật | Trung bình | Tự đo, ghi rõ; kiểm tay ở §8 quickstart |

## Câu hỏi cho phiên chính

**Đã trả lời 2026-10-13** (phiên làm việc; người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11 và đang vắng; mọi điểm dưới đây có thể xem lại khi người dùng quay lại):

1. **`pulseMs` ở BL335** (thay hai lệnh từ trình duyệt): **đồng ý.** Đụng `write_coordinator` của 006, nên là task nền của bước 4, kèm chạy lại toàn bộ kịch bản ghi của 006 (`write`, `write-race`, `write-kill`, `write-deploy`).
2. **Cookie dùng chung `SessionStore` của 005** (loại phiên `web`, token `matw_`): **đồng ý.** Thêm cột vào `auth-state.json` (đi qua `execv`); không đổi lược đồ `audit.db`.
3. **Mặc định `viewerLogin: off`:** **đồng ý.** Khuyến nghị tài liệu: `required` cho nơi có truy cập từ xa; kiosk dùng `off`.
4. **uPlot là thư viện ngoài duy nhất thêm vào:** **đồng ý** với điều kiện đo gzip ≤ 100 KB ở spike (bước 0); không đạt thì tự viết Canvas (ADR-020 điều kiện xem xét lại).
5. **Không có quyền xem theo màn hình, không có nhiều popup, menu một cấp nhóm:** **đồng ý** (YAGNI, D12).
6. **Mockup:** tự duyệt (phiên chính). Mockup `studio-screens.html` đã tạo; ghi chú hạn chế (thước không có vạch theo con trỏ, tab "Bồn nước" và điều hướng sang màn hình khác chỉ là tĩnh).
7. **BL335:** chuyển danh sách lệnh chỉ đọc ([quickstart.md](quickstart.md) §7) cho người dùng cùng lời xin quyền SSH; task cần thiết bị đánh dấu ⚠️🔌.
8. **Phiên bản:** runtime 0.6.0, Studio 0.5.0, API 1.2.0, định dạng 0.3.0; live giữ 1.2.0 (không đổi bản tin).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Thêm thư viện uPlot (ngoài Constitution "tránh nếu được") | Trục thời gian, vẽ nhanh, con trỏ; GĐ 5 dùng lại | Tự viết Canvas: tốn công, dễ lỗi ở phần đắt nhất; vẫn là dự phòng nếu gzip > 100 KB |
| Danh mục JSON dùng chung đọc bởi hai validator | Một nguồn cho khe, thuộc tính, hành động; thêm widget bằng dữ liệu | Luật viết riêng từng bản: đã lệch ở 0.1 (BOM, FR-008 Sprint 1); sinh mã C++: thêm bước build |
| Loại phiên `web` và cột `cookieAllowed` trong bảng quyền | Cookie hẹp, tách biệt khỏi Bearer | Dùng cookie như Bearer: XSS hay CSRF thành nạp xuống, đọc audit |
| `pulseMs` ở BL335 (đổi `write_coordinator`) | Bit lệnh không kẹt khi trình duyệt chết | Hai lệnh từ trình duyệt: có đường làm bit kẹt bật |
| Đổi ADR-006 điểm 7 và ADR-018 điểm 3 cho cookie | WebSocket có cookie phải chống CSWSH | Giữ nguyên: kết nối không `Origin` mang cookie bị dùng chéo site |
| Canvas editor tự viết Pointer Events thay vì thư viện kéo thả | Chọn nhiều, bắt dính, gióng; kiểm bằng test hình học | interact.js: thêm phụ thuộc, vẫn phải tự viết bắt dính và hình học |
| Bộ chuyển `toScreenModel` cho màn hình 0.1/0.2 trong trang | Một đường dựng; 0.1/0.2 chạy như cũ | Đường dựng riêng cho cũ: hai nhánh mã, dễ lệch |
