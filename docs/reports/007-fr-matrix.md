# Bảng đối chiếu FR và SC của feature 007 (T143)

Ngày lập: 2026-10-13 (phiên s2; phần Studio của s1 ghi theo trạng thái lúc lập). Nguồn: `specs/007-screens-widgets/{spec.md, tasks.md}`, `docs/reports/007-acceptance.md`, `docs/reports/007-security-review.md`, `docs/reports/007-*-x64.json`.

Trạng thái: **Đạt x64** (có test hoặc kịch bản tự động xanh, số đo ở báo cáo nghiệm thu); **Chờ BL335** (cần SSH hoặc thiết bị: T148-T154); **Chờ người** (thử tay, Chrome Windows, NVDA, bộ gõ: T130, T149, T157); **Studio** (phần của s1: xem `tasks.md` T097-T132, báo cáo riêng của họ); **Một phần** (ghi rõ phần thiếu).

Viết tắt: `ps` = `packages/project-schema/src`; `uc` = `packages/ui-components/src`; `rw` = `apps/runtime-web`; `ws-it` = `tests/web-it`; `A:` = `docs/reports/007-attack-x64.json`.

## Định dạng, nâng cấp, kiểm tra

| FR | Nội dung | Bằng chứng | Trạng thái |
|---|---|---|---|
| FR-001, 002, 003, 004 | Màn hình 0.3 (id, kind, size, items), item `svg`, item `widget`, danh mục widget là nguồn duy nhất | `ps/schema-03.test.ts`, `ps/catalog.test.ts`, `schemas/widgets.catalog.json`, `core/project-manager/tests/widget_catalog_test.cpp` | Đạt x64 |
| FR-005 | `navigation` (vị trí, mục, nhóm một cấp, biểu tượng) | `ps/rules-03.test.ts`; `rw/src/menu.test.ts`; ws-it `screens` (menu 3 mục) | Đạt x64 |
| FR-006 | Runtime 0.6 nhận 0.1, 0.2, 0.3; 0.1 và 0.2 chạy như 0.5 | `ps/to-screen-model.test.ts`; `rw/src/project-store.test.ts`; ws-it `compat` (`tank-demo`, `modbus-demo`: cùng uid và thuộc tính SVG với bản nâng cấp 0.3) | Đạt x64 (không có ảnh chụp từ runtime 0.5) |
| FR-007, 008 | Studio đề nghị nâng cấp, nâng cấp xác định, sao lưu | `ps/migrate-02to03.test.ts`, `tests/migration-vectors`; ws-it `compat` chạy `--migrate`; hộp thoại Studio | Đạt x64 (hộp thoại Studio: s1) |
| FR-009, 073 | Hai bộ kiểm tra cùng kết luận; vector chung ≥ 120 ca | `tests/project-vectors` (`v03-*`), `tests/widget-catalog-vectors`; `ps/vectors-03.test.ts`; `core/project-manager/tests/project_validator_test.cpp`, `widget_catalog_test.cpp` | Đạt x64 |
| FR-010 | Giới hạn (32 màn hình, 250 item, 8 svg, 16 biểu đồ…) | vector biên `v03-*`; ws-it `open` (250 item chạy được) | Đạt x64 |
| FR-011 | So sánh, Đọc lên, Xem trước Nạp xuống hiểu màn hình, item, navigation | `ps/compare.test.ts`; dòng xem trước ở T122 | Một phần (phần Studio: s1) |
| FR-012 | Gói `.matscada` 1.0.0 giữ nguyên, thêm file của item svg | `core/project-manager` `LoadedProject::files()`; `deployment/device/tests/deploy_rollback_test.sh` | Đạt x64 |

## Trang vận hành

| FR | Nội dung | Bằng chứng | Trạng thái |
|---|---|---|---|
| FR-013, 016 | Thanh trên, menu, popup (focus, Esc, nền) | `rw/src/{menu,popup-host}.test.ts`; `rw` e2e `screens`; ws-it `screens` | Đạt x64 |
| FR-014 | Khung `size` co một phép `transform`, lớp theo thứ tự | `uc/screen/{fit,layers,mat-screen}.test.ts`; e2e 1366/1920/2560 | Đạt x64 |
| FR-015 | `#/<id>`, Back/Forward, F5, id lạ, kiosk | `rw/src/route.test.ts`; ws-it `screens` (trên runtime thật) | Đạt x64 |
| FR-017 | Đăng ký live theo tập Tag của màn hình (cộng popup) trên cùng kết nối | `rw/src/live-source.test.ts`; e2e `screens` | Đạt x64 |
| FR-018, 031, 032 | quality, định dạng chung, ARIA | `uc/format/*.test.ts`, widget test | Đạt x64 |
| FR-019 | Gom theo khung hình, tạm dừng khi tab ẩn | `uc/widgets/base.test.ts`, `line.test.ts` | Đạt x64 (T135 đo thật: chưa) |
| FR-020 | Tải lười: `projects/active` tóm tắt, màn hình và SVG qua `/project/*` | `rw/src/project-store.test.ts`; `server/tests/startup_test.cpp` (`StartupActive03`); ws-it `screens` (phát hiện thiếu file binding, đã sửa) | Đạt x64 |
| FR-021 | Giữ hành vi 004-006 (Chrome < 120, banner 4429, tải lại khi đổi project) | `rw/src/{main,status,reload}.test.ts`; ws-it `full` (client thứ 11) | Đạt x64 |
| FR-022 | Không `innerHTML`, `eval`; chạy dưới CSP | ESLint (`npm run lint`); `package-web.mjs` grep bản build; ws-it `widgets` (CSP) | Đạt x64 |
| FR-023 | Lỗi một màn hình không lan | `rw` e2e (màn hình hỏng) | Đạt x64 |
| FR-024 | Khởi động ≤ 250 KB gzip, biểu đồ đường ≤ 100 KB | `apps/runtime-web/scripts/package-web.mjs`; ws-it `bundle`: 68,3 KB, uPlot 21,5 KB | Đạt x64 |

## Widget

| FR | Nội dung | Bằng chứng | Trạng thái |
|---|---|---|---|
| FR-025, 026, 027, 028 | 15 widget (hiển thị, điều khiển) | `uc/widgets/*.test.ts`; ws-it `widgets` (đủ 15 loại trên màn hình Tổng quan thật) | Đạt x64 |
| FR-029 | Biểu đồ đường (≤ 8 đường, 10-3.600 s, uPlot lười) | `uc/chart/window.test.ts`, `uc/widgets/line.test.ts`; ws-it `charts` | Một phần (30 phút: T136 chờ) |
| FR-030 | Biểu đồ cột, tròn, bảng Tag | `uc/widgets/{bar,pie,tag-table}.test.ts` | Đạt x64 |

## Điều khiển và phiên web

| FR | Nội dung | Bằng chứng | Trạng thái |
|---|---|---|---|
| FR-033 | Hành động `write`, `toggle`, `pulse`, `navigate`, `popup`, `closePopup` | `uc/control/controller.test.ts`; `rw` e2e `control` | Đạt x64 |
| FR-034 | Ghi chỉ qua `POST tags/write`, UUID, không gửi lại | `rw/src/action-host.test.ts`; ws-it `control` (0 lệnh gửi hai lần) | Đạt x64 |
| FR-035, 036 | Hộp xác nhận, trạng thái và kết quả tại widget | `uc/control/{confirm-dialog,result-banner}.test.ts`; ws-it `chrome-control` | Đạt x64 |
| FR-037 | Khóa kèm lý do (role, HTTP, mất live, BAD, Tag R, đang gửi) | `uc/control/controller.test.ts`; ws-it `locks` | Một phần (5 trong 12 điều kiện ở web-it) |
| FR-038, 039 | HTTPS đầy đủ, HTTP chỉ xem; đăng nhập cookie `__Host-mat_sid` | `server/tests/{web_api_test,web_gate_test}.cpp`; ws-it `session`, `chrome-control`, `gate` | Đạt x64 |
| FR-040 | Hạn rảnh, tối đa, IP, quota 8, hủy khi đổi tài khoản | `core/auth/tests/web_session_test.cpp` (đồng hồ giả); ws-it `session`, `session28`, `attack-accounts` (A27) | Một phần (hết hạn bằng đồng hồ thật: chưa) |
| FR-041, 042 | CSRF + Origin; cookie chỉ vào endpoint của trang | `server/tests/web_gate_test.cpp`; A: A1-A13, A25 | Đạt x64 |
| FR-043 | WebSocket có cookie đòi Origin | `server/websocket/tests/civet_cookie_upgrade_test.cpp`; A: A19, A20 | Đạt x64 |
| FR-044 | `viewerLogin` off và required | `server/tests/web_api_test.cpp`; ws-it `gate` | Đạt x64 |
| FR-045, 046, 047 | Chuỗi kiểm ghi của 006, `context`, `expect`, `pulseMs` | `core/tag-engine/tests/write_extensions_test.cpp`; ws-it `control`, `expect`, `pulse`, `pulse-kill` | Đạt x64 |
| FR-048, 049 | Tài khoản của 005; `no-store`, `nosniff`, cookie đủ thuộc tính | ws-it `session` (thuộc tính `Set-Cookie`) | Đạt x64 |
| FR-050 | Giới hạn tần suất áp cho phiên web | ws-it `pulse` (RATE_LIMITED được xử lý); `rw/src/action-host.test.ts` | Đạt x64 |
| FR-051, 052 | Hộp Đăng nhập bằng bàn phím, `autocomplete`; `security.minRole` | `rw/src/login-*.test.ts`; `ps/rules-03.test.ts` | Đạt x64 |

## Chứng chỉ

| FR | Nội dung | Bằng chứng | Trạng thái |
|---|---|---|---|
| FR-053 | SAN IP của mọi card | `server/tests/server_cert_test.cpp`; ws-it `cert` | Đạt x64 |
| FR-054 | `/device.crt` chỉ chứng chỉ | `server/http/tests/device_crt_test.cpp`; ws-it `cert`, `gate` | Đạt x64 |
| FR-055 | `--make-csr`, `--import-cert` | `server/tests/cert_cli_test.cpp`; ws-it `cert` (CA thử ECDSA) | Đạt x64 (CA RSA không nhận: giới hạn ghi ở docs) |
| FR-056, 057 | Tài liệu HTTPS cho Chrome; lời nhắc `deploy.sh` | `docs/deployment/mat-runtime.md` §5d; `deployment/device/tests/deploy_rollback_test.sh` | Đạt x64 (Chrome Windows: T149) |

## Studio (editor Màn hình): s1

FR-058 đến FR-072, FR-076 và SC-001, SC-013 đến SC-016, SC-023: xem `tasks.md` T097-T132 và báo cáo của s1. Không đánh giá ở bảng này.

## Kiểm thử, rà soát, tài liệu

| FR | Nội dung | Bằng chứng | Trạng thái |
|---|---|---|---|
| FR-074 | Test C++ phiên, CSRF, cookie, WebSocket, xung, SAN, CSR | `core/auth/tests/web_session_test.cpp`, `server/tests/web_*_test.cpp`, `core/tag-engine/tests/write_extensions_test.cpp`, `server/tests/cert_cli_test.cpp` | Đạt x64 |
| FR-075 | Test tích hợp x64 `tools/web-it.ps1` | ws-it: `bundle`, `control`, `locks`, `expect`, `pulse`, `pulse-kill`, `session`, `session28`, `attack`, `attack-accounts`, `gate`, `cert`, `compat`, `screens`, `widgets`, `chrome-control`, `f5x10`, `full`, `open`, `charts` | Một phần (`load` và `deploy-live` chưa làm) |
| FR-077 | Rà soát bảo mật | `docs/reports/007-security-review.md` | Đạt (0 Critical, 0 High còn mở) |
| FR-078 | Thư viện mới: chỉ uPlot | `third_party/LICENSES.md`, `packages/ui-components/package.json` | Đạt |
| FR-079 | Tài liệu | `packages/ui-components/README.md` (sinh từ danh mục), `docs/deployment/mat-runtime.md` §5d, `docs/architecture/svg-dialects.md`, ADR 013, 019-022 | Một phần (`apps/studio/README.md`: s1) |

## Tiêu chí thành công

| SC | Tiêu chí (rút gọn) | Số đo hoặc bằng chứng | Trạng thái |
|---|---|---|---|
| SC-002 | Mở màn hình chuẩn ≤ 2 s (BL335) | x64 loopback: xem báo cáo nghiệm thu (`007-open-x64.json`) | Đạt x64, Chờ BL335 (T150) |
| SC-003 | 10 client F5 ≤ 5 s (BL335) | x64: `007-f5x10-x64.json`; trước khi sửa `httpsThreads` 15,6 s | Đạt x64, Chờ BL335 (T150) |
| SC-004 | 30 phút, 10 client, 500 Tag: CPU ≤ 30 %, RSS ≤ 150 MB | chưa đo | Chờ BL335 (T151) |
| SC-005 | 100 % lệnh ghi từ khách, viewer, HTTP, sai CSRF/Origin, live bị từ chối, 0 lệnh tới giả lập | `007-attack-x64.json`, `007-locks-x64.json`; `driver-it write` (006) cho bản tin live | Đạt x64 |
| SC-006 | Operator ghi từ Chrome ≥ 95 % `CONFIRMED` ≤ 2 s; audit `channel: web` + screen, widget | `007-control-x64.json`, `007-chrome-control-x64.json` | Đạt x64, Chờ BL335 (T152) |
| SC-007 | 30 ca tấn công 100 % bị từ chối | `007-attack-x64.json` + `attack-accounts` + `session28` | Đạt x64 |
| SC-008 | Phiên: hạn, IP, đăng xuất, tắt tài khoản, đổi role/mật khẩu, đầy | `007-session-x64.json`, `007-session28-x64.json`, `007-attack-x64.json` (A23), `attack-accounts` (A27) | Một phần (hết hạn đồng hồ thật, đổi role) |
| SC-009 | Ca khóa điều khiển 100 % | `007-locks-x64.json` + `controller.test.ts` | Một phần |
| SC-010 | Xung 20/20, kill -9 giữa lúc chờ | `007-pulse-x64.json`, `007-pulse-kill-x64.json` | Đạt x64, Chờ BL335 (T153) |
| SC-011 | Project 0.1, 0.2 chạy như 0.5; nâng cấp giống | `007-compat-x64.json` | Một phần (không có ảnh chụp 0.5) |
| SC-012 | Vector chung 100 % | ctest `ProjectVectors/*`; `ps/vectors-03.test.ts` | Đạt x64 |
| SC-015 | axe 0 critical/serious (trang runtime) | `rw` e2e (sáng và tối) | Đạt x64 (Studio: s1; NVDA: T130) |
| SC-017 | 8 x 8 x 3.600 điểm 30 phút | `007-charts-x64.json` (bản rút gọn) | Một phần (30 phút: T136) |
| SC-018 | Điểm khớp Tag, đứt ở BAD | `uc/widgets/line.test.ts` | Đạt x64 |
| SC-019 | Chứng chỉ không cảnh báo (Chrome Windows, CA) | `007-cert-x64.json` (client TLS nghiêm ngặt) | Một phần (Chrome Windows và BL335: T149) |
| SC-020 | `props` chứa mã độc hiện dạng chữ; 0 `innerHTML`, `eval` | ESLint, `package-web.mjs`, e2e `screens` (nhãn XSS), `control` (`confirmText`) | Đạt x64 |
| SC-021 | Không hồi quy 004-006 | ctest đủ, `ci-local`, `driver-it`, `device-it` | Xem báo cáo nghiệm thu |
| SC-022 | Chrome ≥ 120: danh sách phiên bản đã thử | Chrome 155 (ổn định hiện tại); Chrome 120 chưa có để thử, e2e giả user agent < 120 chỉ kiểm cảnh báo | Một phần |
| SC-024 | Khởi động ≤ 250 KB, biểu đồ ≤ 100 KB | 68,3 KB; 21,5 KB (uPlot) | Đạt x64 |
