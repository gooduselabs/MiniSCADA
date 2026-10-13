# Nghiệm thu feature 007 (GĐ 3a): màn hình v1, widget, điều khiển trên Chrome

Ngày: 2026-10-13. Phần thiết bị, trang xem, web-it, rà soát bảo mật, tài liệu và gói: agent s2. Phần Studio (editor Màn hình, US2, US6 phía Studio): agent s1, xem [007-acceptance-studio.md](007-acceptance-studio.md). Bảng FR và SC: [007-fr-matrix.md](007-fr-matrix.md). Rà soát bảo mật: [007-security-review.md](007-security-review.md).

**Kết luận:** mọi thứ làm được trên x64 đã đạt và có số đo; còn lại chờ thiết bị BL335 (SSH đang tắt) hoặc người (Chrome Windows, NVDA, bộ gõ). Không có phát hiện Critical hay High còn mở. Không có gì được thử hay đổi trên BL335.

## 1. Kiểm thử tự động (x64, armhf)

| Bộ | Kết quả | Ghi chú |
|---|---|---|
| ctest x64 (`test-x64.ps1`, `C:\build\mat-x64-e2`) | 2.852 test: 2.851 đạt ở lần chạy đầy đủ, 1 đỏ (`Phc.FormatThenParse`: test cứng `t=2`, sót khi đổi Argon2id sang `t=1`); sửa test rồi chạy lại nhóm `Phc\|Password\|Argon2` 43/43 đạt. 1 test bị tắt có sẵn (`AuditLogBench`) | Lần chạy đầy đủ 3.350 s. Nhóm `Argon2id\|Password\|AuthService\|UserCli\|AuthBench` chạy đầu phiên: 58 test, 1 đỏ (`Password.NeedsRehashWhenTheParametersDiffer`, cũng cứng `t=2`), đã sửa |
| armhf (build + qemu) | build 60 bước đạt; smoke đạt; 42 nhị phân test, 767 test đạt; `deploy_rollback_test.sh` đạt | `C:\build\mat-armhf-e2` |
| ASan/UBSan | không chạy | không cần cho thay đổi lần này (không đổi parser hay luồng mới; chỉ cấu hình, danh sách cho phép, nhánh cổng) |
| clang-format | sạch (toàn bộ `core server drivers tools/hello-armhf`) | |
| Vitest | project-schema 1.579 (21 file); ui-components 432 (27); runtime-web 188 (15); binding-engine 35; svg-renderer 38; live-client 64; expression 718; tag-codec 587; Studio 1.852 (theo s1) | |
| `npm run lint`, `typecheck` | sạch | gồm `tests/web-it/**/*.mjs` |
| `node --test` (modbus-sim, project-validator, dashboard-demo, gen-widget-docs) | 44 đạt | |
| e2e `apps/runtime-web` (Chrome 155 headless, axe sáng và tối) | 127 kiểm đạt, 0 đỏ | |
| `npm run validate:project` | 3 project hợp lệ (`tank-demo`, `modbus-demo`, `dashboard-demo`) | |
| go (load-tester) | gofmt, vet, test sạch | |
| e2e Studio (Chrome headless, axe) | 648 kiểm đạt, 0 đỏ (s2 chạy lại ở cuối phiên) | |
| `cargo test --lib` (Studio, `C:uildmat-studio`) | 144 đạt | |
| Hồi quy 005, 006 (T075) | `driver-it` source, read, merge, split, probe, write, write-race, unplug (+ cắt mạng thật), write-kill, load, calc, faults: **đạt hết**; `device-it` auth, discovery, packages, deploy, busy, health: **đạt hết** | Bản chạy lại: `docs/reports/007-regression-x64/` (không ghi đè báo cáo 005, 006 đã commit). `driver-it` không có kịch bản `write-deploy` như T075 ghi: phần đó nằm ở web-it `deploy-live` |

Không chạy `tools/ci-local.ps1` trọn một lần (mất hơn 90 phút và lặp lại ctest): từng bước của nó đã chạy riêng, như bảng trên (trừ ASan/UBSan).

## 2. web-it (x64, runtime thật trong Docker, Chrome 155)

Tất cả đạt (`tools/web-it.ps1`; báo cáo `007-<kịch bản>-x64.json`).

| Kịch bản | Số kiểm | Nội dung và số đo |
|---|---|---|
| `bundle` | 1 | khởi động JS + CSS 68,4 KB gzip (ngưỡng 250), uPlot 21,5 KB (ngưỡng 100), không eval, new Function, innerHTML |
| `control` | 23 | FLOAT, BOOL ngoài, BOOL và INT mô phỏng, nội bộ; OUT_OF_LIMITS, READ_ONLY, NO_SUCH_TAG; DEVICE_EXCEPTION, TIMEOUT (đúng 1 lệnh tới giả lập, không gửi lại); trùng `requestId`; audit `channel: web` có `screen`, `widget`; `context` sai dạng bị bỏ |
| `locks` | 8 | viewer, chưa đăng nhập, HTTP, Tag chỉ đọc, mất kết nối PLC; 0 lệnh ghi tới giả lập |
| `expect` | 7 | hai client đảo `false → true`: A `CONFIRMED`, B `REJECTED STALE_EXPECTATION`, 0 lệnh của B tới giả lập |
| `pulse` | 9 | 20 xung 500 ms: bật rồi tắt đúng 2 lệnh, khoảng 556-736 ms; đóng trang ngay sau ACCEPTED: nhả 5/5; `PULSE_RANGE`, `PULSE_NOT_BOOL`; lần ghi đầu lỗi không ghi lần hai |
| `pulse-kill` | 5 | `kill -9` giữa lúc chờ xung (5 vòng): mọi lệnh dở có dòng `interrupted`; **bit lệnh ở giả lập còn BẬT sau kill** (research R17: PLC phải tự xóa bit xung) |
| `session` | 24 | `Set-Cookie` đủ `Secure; HttpOnly; SameSite=Strict; Path=/`, không `Domain`, `Max-Age`, `Expires`; csrf 43 ký tự; `web/session` khôi phục; `touch`; sai mật khẩu và tên lạ cùng một câu; 413, 415; logout 204 và xóa cookie |
| `attack` | 37 | A1-A25 và A30 (CSRF, Origin, cookie qua HTTP, phạm vi cookie, Bearer chéo loại, GET đổi trạng thái, content-type, Fetch Metadata, WebSocket thiếu hoặc lạ Origin, cố định phiên, logout, đổi IP, viewer, login CSRF, clickjacking): 100 % đúng mã, 0 lệnh tới giả lập |
| `attack-accounts` | 3 | A26 (6 lần sai: 429 `AUTH_LOCKED`, đúng cũng 429), A27 (phiên thứ 9 loại phiên cũ nhất) |
| `session28` | 4 | A28: đổi mật khẩu bằng CLI hủy phiên đang mở |
| `gate` | 28 | `viewerAccess private`: nguồn 203.0.113.0/24 vào được `/login`, `assets/login-*`, `/device.crt`, `web/login`; `/` và dữ liệu 403; phiên hợp lệ không bị lọc. `viewerLogin required`: 302 `/login`, dữ liệu 401, WebSocket 401, HTTP là trang hướng dẫn, có phiên thì vào được |
| `cert` | 15 | SAN IP của card và hostname; `/device.crt` một khối CERTIFICATE; CSR → CA thử (ECDSA) ký → nhập; nhập sai khóa, có khóa riêng, hỏng: từ chối, chứng chỉ cũ nguyên; client TLS nghiêm ngặt tin khi có CA, từ chối khi không |
| `compat` | 16 | `tank-demo` (0.1), `modbus-demo` (0.2): chạy như cũ; bản nâng cấp 0.3 của chúng cùng uid và thuộc tính SVG; một màn hình thì không menu |
| `screens` | 18 | menu, đổi màn hình, F5 giữ màn hình, Back, id lạ, popup (Esc), kiosk, item svg dựng được, console sạch; HTTP: dải "Chế độ chỉ xem". Màn hình đầu: 0,24 s |
| `widgets` | 18 | đủ 15 loại widget trên màn hình Tổng quan thật, bảng Tag có giá trị sống, CSP không cho script nội tuyến |
| `chrome-control` | 11 | khách khóa; viewer khóa theo role; operator đăng nhập 0,11 s; cookie HttpOnly mà JS không đọc được; hộp xác nhận; ghi công tắc `CONFIRMED` sau **0,26 s** (từ lúc bấm); F5 giữ phiên; không token trong storage hay URL; đăng xuất khóa lại |
| `f5x10` | 2 | 10 phiên F5 cùng lúc, 3 vòng: mọi trang có giá trị sống ≤ **0,52 s** (trung vị 0,47 s); 0 trang báo 4429 |
| `full` | 4 | client thứ 11: banner "Đầy" có câu của máy chủ, không dựng nửa chừng, vào được khi có chỗ |
| `deploy-live` | 10 | nạp xuống (5,6 s) khi 10 trang đang xem và 1 xung 6 s đang chờ: 10/10 trang tự tải lại giữ `#/bon-nuoc`; phiên operator còn (execv); project mới chạy; xung đã nhả và có dòng `ok` |
| `open` | 4 | màn hình chuẩn (20 widget, 100 Tag) có giá trị sống **0,20 s** sau khi mở trang; 250 item: 0,08 s sau khi chọn, 0,21 s mở lạnh; chuyển lại màn hình đã mở **0,03 s** |
| `charts` | 5 | 8 biểu đồ × 8 đường, cửa sổ 3.600 s, mẫu 250 ms, chạy 5 phút: bộ nhớ JS 4 MB ở phút 1 và 4 MB ở phút 5 (ngưỡng +100 MB), p95 khung hình 10,2 ms |

Các số này là x64 qua loopback trong Docker, **không** thay cho SC-002, SC-003, SC-004 trên BL335.

## 3. Phát hiện khi chạy trên runtime thật (không thấy bằng test đơn vị hay runtime giả)

| # | Phát hiện | Xử lý |
|---|---|---|
| F-1 | `httpsThreads` = 8: WebSocket live và kết nối keep-alive rảnh giữ worker; 4 trang cùng mở mất **15,6 s** mới có dữ liệu sống (SC-003 trượt nặng) | mặc định 40, giới hạn 4-64; sau sửa 10 trang F5 ≤ 0,52 s. Đề xuất này đã nằm ở rà soát 005. RAM trên BL335 chưa đo |
| F-2 | `/project/*` không phục vụ `*.bindings.json` của item `svg` (test C++ còn khẳng định "không phục vụ"): đồ họa SVG của project 0.3 không có binding | sửa `LoadedProject::allowlist()` và test |
| F-3 | CA ký bằng RSA bị từ chối ở `--import-cert` (mbedTLS không có RSA) | giới hạn ghi vào docs và ADR-021; chưa thử CA thật |
| F-4 | `kill -9` giữa xung để bit lệnh BẬT | theo research R17; ghi vào docs; thử trên thiết bị ở T153 |

## 4. Rà soát bảo mật và review (T138)

Hai agent (security-auditor, code-reviewer): 0 Critical, 0 High do rà mã; đã sửa S-L1 (kiểm Origin của login/logout khi có header Authorization), S-L5 (đoạn `..` trong đường dẫn project), R-4 (race `ProjectStore.open`), R-5 (slot `mat-screen` rò trạng thái giữa màn hình), và ba lỗi của chính bộ test (`bundle` luôn đạt, `pulse-kill` đạt khi rỗng, `expect` cho phép 1-2 lệnh). Test cho S-L1, R-4, R-5, S-L5 viết trước: S-L1, R-4, R-5 có lần chạy đỏ rồi xanh; S-L5 viết cùng lúc với sửa (không có pha đỏ riêng). Medium còn lại và quyết định: `007-security-review.md`.

## 5. Đỏ và xanh: nói thật

- Có pha đỏ ghi lại: `WebGate.LoginAndLogoutKeepTheOriginCheck…` (đỏ khi bỏ bản sửa, xanh khi có); `ProjectStore` kết quả thế hệ cũ vào cache; `mat-screen` slot theo màn hình; `httpsThreads` (đỏ bằng số đo: 15,6 s; test `config_test` cập nhật cùng lúc, không chạy đỏ riêng); `allowlist` binding (đỏ bằng web-it; test `startup_test` đổi cùng lúc với sửa).
- Không có pha đỏ: toàn bộ `tests/web-it` (viết xong là chạy với runtime đã có, hầu hết xanh ngay; chỗ đỏ ở lần đầu là lỗi của harness: `Content-Type` bị `pinnedRequest` ghi đè, `R.FLAG` địa chỉ không có trong giả lập, A27 sau khóa IP, 15,6 s ở `f5x10`, binding 404, `wsUpgrade` treo khi 101). Phần mã của lô 1 (Phase 2 TS/C++, ui-components, runtime-web) được kiểm lại xanh nhưng pha đỏ của lô 1 không ghi lại, nên không khẳng định.

## 6. Việc còn mở

**Chờ SSH BL335 (T007, T148-T154):** cài runtime 0.6.0 (gói `build/mat-runtime-armhf.tar.gz`, 2,7 MB, SHA-256 `FEA4595C…556E`, project `dashboard-demo`, đã chạy `deploy_rollback_test.sh`); chứng chỉ; đo SC-002, SC-003 (10 client F5 trên thiết bị); SC-004 (30 phút, CPU, RSS, eMMC); RAM của 40 worker HTTPS; điều khiển thật; xung kể cả `kill -9`; rollback; kiểm chỉ đọc chứng chỉ và mạng (T007).

**Chờ người:** T004 (duyệt mockup, thuộc phiên chính và s1; chưa đánh dấu), T130 (Telex, Unikey, NVDA), T149 (cài chứng chỉ vào Windows, Chrome Windows, SC-019 trên thiết bị), T157 (SC-023), SC-022 (Chrome 120: máy này chỉ có 155).

**Chưa làm, làm được trên x64:** T136 (biểu đồ 30 phút; đã chạy bản 5 phút), `load` của web-it (10 trang + 500 Tag 30 phút; 006 `driver-it load` đã đo phía runtime), hết hạn phiên bằng đồng hồ thật (`webSessionIdleMin` tối thiểu 5 phút; có test đồng hồ giả), đổi role bằng CLI khi phiên mở, 7 trong 12 điều kiện khóa ở web-it (có ở `controller.test.ts` và e2e giả), ảnh chụp từ runtime 0.5 (không còn bản 0.5 để chụp).

**Quyết định cho giai đoạn sau:** allowlist `Host` (DNS rebinding đọc dữ liệu xem trên HTTP), khóa theo tên tài khoản (DoS đăng nhập), giới hạn kết nối theo nguồn, CA RSA, bit xung kẹt sau mất điện: ghi ở `007-security-review.md` và ADR-021.

## 7. Phiên bản và gói (T146)

Runtime 0.6.0 (`kRuntimeVersion`), API 1.2.0, giao thức live 1.2.0, `@mat/ui-components` 0.1.0, Studio 0.5.0 (s1). Gói: `deployment/package-runtime.ps1 -Project projects/dashboard-demo -Bin C:/build/mat-armhf-e2/armhf/bin/mat-runtime` (chạy bằng PowerShell, không qua Git Bash: `tar` của Git không hiểu `D:`); chứa `schemas/widgets.catalog.json`, `schemas/0.2/`, `web/login.html`; cổng kích thước bản build ≤ 250 KB gzip đạt (68,4 KB). Bộ cài Studio 0.5.0 (`npm run studio:build`) không dựng ở đây.

## 8. ADR

013, 019, 020, 021 chuyển Accepted kèm số đo x64 (020: bản 30 phút chờ; 021: BL335 và Chrome Windows chờ). ADR-022 (editor Màn hình) thuộc phần Studio: xem báo cáo của s1. Ghi chú thêm ở ADR-006 và ADR-018 trỏ ADR-021.
