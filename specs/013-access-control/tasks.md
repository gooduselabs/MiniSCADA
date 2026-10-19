# Tasks: Đăng nhập bắt buộc, phân quyền theo người dùng và trang Quản trị trên web (013)

Đầu vào: [spec.md](spec.md), [plan.md](plan.md), [contracts/access-model.md](contracts/access-model.md), [contracts/admin-api.md](contracts/admin-api.md). Test viết trước (Constitution VI): mỗi task cài đặt đi sau task test của nó, test phải đỏ trước.

## Phase 1: Setup

- [x] T001 ADR `docs/adr/042-access-control.md` (kho trên thiết bị, chuyển `users.json` sang `/var/lib/mat-runtime/auth`, mô hình quyền, thực thi máy chủ) và mục mới trong `docs/architecture/threat-model.md` (API quản trị, leo thang, CSRF, rò dữ liệu qua đường phụ)
- [x] T002 `deployment/config/runtime.json`: `viewerLogin` mặc định `required` cho bản cài mới; thiết bị đang chạy giữ tệp cũ (kiểm `deploy_rollback_test.sh`)
  - Ghi chú (luồng B, 2026-10-20): `deployment/config/runtime.json` `viewerLogin: required`; deploy.sh chỉ cài runtime.json khi chưa có, in cảnh báo "XEM KHÔNG CẦN ĐĂNG NHẬP" khi off; `deploy_rollback_test.sh` kiểm tệp cũ giữ nguyên và bản cài mới lấy required.

## Phase 2: Foundational (luồng A + B lõi)

- [x] T003 [P] Bộ sinh `tests/access-vectors/generate.mjs` + ≥ 40 ca theo access-model §7 (kết quả viết tay, không sinh bằng bộ tính) — 74 ca; quy ước chi tiết (mồ côi gồm mức không áp được, khóa chỉ cho item được xem, alarm không phụ thuộc `page:alarms`) ở `tests/access-vectors/README.md`
- [x] T004 [P] Test Vitest `packages/access-model/src/compute.test.ts` chạy mọi vector (đỏ) — 79 test, đỏ trước khi cài
- [x] T005 `packages/access-model/src/compute.ts` (`computeAccess`), `catalog.ts` (`catalogFromProject`) cho xanh — 85 test xanh; catalog test trên grid-demo, history-demo, alarm-demo; popup có tham số bung theo `args`; alarm theo thiết bị (không Tag) chưa vào danh mục
- [x] T006 [P] gtest `core/auth/tests/access_model_test.cpp` + `access_vectors_test.cpp` (đọc `tests/access-vectors`) (đỏ)
  - Ghi chú: `access_model_test` (18 ca riêng), `access_vectors_test` đọc `tests/access-vectors` (hoặc MAT_ACCESS_VECTORS), khớp 77/77 ca sau khi gộp 013-a; `access_catalog_test` trên grid-demo, tank-demo, history-demo, alarm-demo.
- [x] T007 `core/auth/access_model.{hpp,cpp}` + `access_catalog.{hpp,cpp}` cho xanh
  - Ghi chú: access.json nhận quy tắc mồ côi và người nhận không khớp (không coi là kho hỏng); alarm không có Tag nguồn theo `page:alarms`; Tag của bảng theo dõi vào live(P) khi xem được `page:watch` (ngoài vector). Lệch ghi ở access-model.md.
- [x] T008 [P] gtest `core/auth/tests/access_store_test.cpp`: users 1.0→1.1, khởi tạo từ `/etc`, `flock`, `rev`/409, `.bak`, tệp hỏng → chỉ admin, giới hạn kích thước (đỏ)
  - Ghi chú: `access_store_test` (khởi tạo một lần từ /etc giữ rev tài khoản, thư mục 0700 từ chối liên kết/nhóm ghi, rev + 1, .bak bằng hard link, 4 luồng × 10 lần không mất thay đổi, khôi phục .bak, 0644/2 MiB → hỏng, AccessService, T030).
- [x] T009 `core/auth/access_store.{hpp,cpp}`, `account_store.*` (đường mới, `groups`, `lastLoginAt`, 200 tài khoản) cho xanh
  - Ghi chú: users.json 1.1.0 giữ khóa `users` và ISO createdAt/updatedAt, thêm `rev`, `groups`, `lastLoginAt` (≤ 1 lần/giờ, không tăng rev); khóa flock trên thư mục auth/; runtime đọc auth/users.json (owner root hoặc chính tiến trình); AuthService: principalOf, reloadAccounts (giữ phiên), accountSummaries.
- [x] T010 [P] Schema `schemas/screen.schema.json`: `item.security.view/operate`, `screen.security.view`; luật `E_SECURITY_LEVEL`, `E_SECURITY_ITEM` ở `packages/project-schema/src/rules-11.ts` và `core/project-manager/rules_11.cpp`; vector `tests/project-vectors/v11-security-*` (test trước) — 23 ca, luật ở `tests/project-vectors/README-013.md` (`E_SECURITY_LEVEL`: operate viewer, thấp hơn view, khác minRole, hoặc security mới ở project 1.0); TS và C++ xanh

## Phase 3: US1 Đăng nhập bắt buộc (P1)

- [x] T011 [US1] e2e `apps/runtime-web/tests/e2e/login-required.e2e.mjs`: 401 → `/login?next=`, `next` độc hại (20 dạng) bị bỏ, hết phiên quay lại đúng trang (đỏ)
  - Xong (luồng C): 29 kiểm — liên kết trực tiếp khi chưa phiên (302 giữ fragment), 4401, 401 của `/project`, đăng xuất, 22 dạng `next` độc hại (tự chuyển khi đã có phiên + 4 dạng qua biểu mẫu, không có alert), khóa tạm kèm giờ, Đổi mật khẩu của tôi, HTTP chỉ thông báo + liên kết `/login?next=` HTTPS; axe sáng/tối. Vitest `next.test.ts` (41 ca). Bản build e2e thêm `--mode e2e-login` (trang /login vào dist-e2e).
- [x] T012 [US1] `login.ts`, `session.ts`, `main.ts`, `project-store.ts`: chuyển hướng và `next` an toàn
  - Xong: `next.ts` (regex §7 + chặt hơn: bỏ đoạn rỗng, `.`, `..`; phần `?…` của hash bị cắt khi dựng `next`), chuyển hướng chỉ khi `viewerLogin: required` (từ `web/session`) hoặc `projects/active` 401; thiết bị `off` giữ hành vi cũ (hết phiên chỉ khóa điều khiển). Trang /login mới (vivid/dark, tên project và thiết bị từ `system/info`, đã có phiên thì chuyển ngay). `WebSession.changePassword`, `groups`, `viewerLogin`; menu tài khoản + hộp đổi mật khẩu (tải lười).
- [x] T013 [US1] web-it `tests/web-it/scenarios/login-required.mjs`: mọi đường dữ liệu không phiên → 401, 0 byte giá trị Tag
  - Ghi chú: web-it `login-required` (trong `tests/web-it/scenarios/access.mjs`) 27/27 xanh x64, kết quả docs/reports/013-login-required-x64.json.

## Phase 4: US2 Quản lý tài khoản trên web (P1)

- [x] T014 [US2] gtest `server/tests/admin_api_test.cpp`: users/groups, reauth, LAST_ADMIN, IN_USE, CONFLICT, 413/400, 429, hủy phiên, audit before/after không có mật khẩu (đỏ)
  - Ghi chú: `server/tests/admin_api_test.cpp` 12 ca qua `AdminApi::call` với AuthService, AuthStore, AccessService thật.
- [x] T015 [US2] `server/http/admin_api.{hpp,cpp}` + bảng `core/auth/roles.cpp`; `web/password`, `web/session` thêm `groups`, `viewerLogin`; device-api 1.6.0
  - Ghi chú: thêm `effective?users=` theo lô, `reason` WEAK_PASSWORD TOO_SHORT/TOO_LONG/CONTAINS_NAME/COMMON, `/admin/audit` (beforeId); device-api 1.6.0, live 1.4.0.
- [x] T016 [US2] CLI `server/cli/users.cpp`: đường mới + `--user-groups`, `--user-remove`, `--group-add/remove`, `--access-reset` (test `user_cli_test`)
  - Ghi chú: CLI ghi auth/ dưới flock, chown về người dùng dịch vụ; `--user-groups`, `--user-remove`, `--group-add/remove` (gỡ khỏi tài khoản và quy tắc), `--access-reset`; user_cli_test cập nhật + 3 ca mới.
- [x] T017 [US2] Trang `apps/runtime-web/src/admin/`: khung Quản trị, tab Người dùng, tab Nhóm, hộp xác nhận lại; Đổi mật khẩu của tôi (e2e trước)
  - Xong: chunk tải lười `admin-page-*.js` (19,7 KB gzip) + CSS 3,9 KB; thẻ số liệu, dải cảnh báo (xem không cần đăng nhập, kho hỏng + Khôi phục, mồ côi + Dọn, 409), tab bàn phím (mũi tên/Home/End); Người dùng (tìm, lọc vai trò, thêm với mật khẩu sinh một lần + Chép, sửa vai trò/nhóm/trạng thái, mở khóa, đặt lại mật khẩu, xóa; hạ vai trò/tắt/đặt lại/xóa cần `reauth`), Nhóm (thẻ, mã gợi ý từ tên, đổi tên, xóa, IN_USE liệt kê nơi dùng). e2e `admin.e2e.mjs` (83 kiểm), Vitest `admin/model.test.ts`, `admin/api.test.ts`.
- [x] T018 [US2] Tab Nhật ký (`/api/v1/admin/audit`)
  - Xong: lọc người, loại (tiền tố), từ–đến; "Tải thêm" theo `beforeId`; chi tiết before → after.

## Phase 5: US3 Quyền theo trang (P1)

- [x] T019 [US3] gtest thực thi: `/project/<màn hình>` 403, navigation/projects/active lọc, live `denied`, history lọc/403, alarm lọc, `access-changed` (đỏ)
  - Ghi chú: `server/tests/access_enforce_test.cpp` (bộ lọc projects/active, màn hình, báo cáo, ghi của trang, live hub denied/access-changed/alarm) + ca alarm và lịch sử qua web-it access.
- [x] T020 [US3] Thực thi ở `http_api.cpp`, `live_hub.*`, `civet_transport.cpp`, `history_api.cpp`, alarm; `GET /api/v1/web/access`; `/api/v1/admin/access*`, `/admin/effective`
  - Ghi chú: lọc ở http_api (qua `access_filter`), history_api (`tagFilter`), alarms (GET cần page:alarms, POST 403), live hub hỏi lại quyền mỗi 1 s; access-changed đo 1 lần trên x64 ≤ 2 s.
  - Ghi chú (luồng B, 2026-10-20): counts của alarm tính trên larm(P) ở mọi chỗ (GET alarms, câu trả lời ack/shelve/unshelve/disable/enable, alarmSnapshot/alarmDelta theo từng phiên qua countsFor, khối larms của system/info); quyền của phiên đổi → hub gửi lại alarmSnapshot (bỏ alarm đã mất). ccess.json xem lại mỗi 1 s: quy tắc sửa bằng CLI có hiệu lực ≤ 2 s.
- [x] T021 [US3] Trang: `access.ts` (tải EffectiveAccess), menu lọc, trang "không có quyền", xử lý `access-changed`
  - Xong: `access.ts` + test; menu theo `screens`/`pages` + mục Quản trị cho admin; route `denied` giữ hash; 403 `ACCESS_DENIED` của `/project` → "Không có quyền xem trang này"; live `access-changed` (live-client `onAccessChanged`, `denied` như `unknown`) → tải lại quyền, dựng lại menu/màn hình (màn hình mới được xem → tải lại trang). e2e `access.e2e.mjs` (28 kiểm, gồm 0 giá trị Tag bị cấm).
- [x] T022 [US3] Tab Quyền theo trang (ma trận, đặt nhiều trang, sao chép)
  - Xong: hàng màn hình/popup/trang hệ thống/nhóm lưu trữ/mẫu báo cáo, cột Mọi người/vai trò/nhóm/người dùng; "Mặc định (theo project)" khác "Đã đặt" và "Chưa lưu"; đặt nhiều trang, sao chép từ trang khác, Về mặc định; bản nháp chung lưu theo lô ≤ 500 với `rev`.
- [x] T023 [US3] web-it `tests/web-it/scenarios/access.mjs`: bắt live của người bị cấm 0 giá trị Tag cấm; history, alarm, project file
  - Ghi chú: web-it `access` 28/28 xanh x64 (dashboard-demo không có lưu trữ và alarm). Lịch sử và alarm qua runtime thật: web-it `access-data` (project `tests/web-it/make-access-data.mjs`: dashboard-demo + nhóm lưu trữ `song` + 2 alarm) 16/16 xanh x64 — alarm, số đếm (REST, live, system/info), lệnh, lịch sử alarm, catalog và series lọc theo quyền, alarmSnapshot mới sau khi quyền đổi (965 ms); docs/reports/013-access-data-x64.json.

## Phase 6: US4 Quyền theo component (P2)

- [x] T024 [US4] gtest: màn hình trả về bỏ item ẩn, ô lưới bỏ `item`; `tags/write` cookie thiếu `context`/không `operate`/Tag không thuộc binding → `ACCESS_DENIED` + audit (đỏ)
  - Ghi chú: trong access_enforce_test (filteredScreen, pageWriteRefusal).
- [x] T025 [US4] Cài đặt ở `http_api.cpp`, `tags_api.cpp`
  - Ghi chú: ghi bằng cookie bắt buộc context; các kịch bản web-it cũ (control, locks, expect, write-min-role, deploy-live) đổi sang context thật (`PAGE_CONTEXT` của lib/api.mjs) và ghi Tag không component nào ghi nay là ACCESS_DENIED.
- [x] T026 [US4] Trang: component ẩn / khóa "cần quyền thao tác" (`lockedItems`), ô lưới trống
  - Xong: `filterScreen` bỏ item ẩn (ô lưới bỏ `item`), "Không có nội dung bạn được xem"; ui-components: `ActionHost.itemBlocked` tùy chọn, mã khóa `NO_PERMISSION` ("Cần quyền thao tác", sau NO_SESSION/ROLE) và `PREVIEW`; phần tử SVG hỏi quyền theo item `svg` chứa nó (`accessItem`).
- [x] T027 [US4] Tab Quyền theo component: xem trước màn hình bấm chọn + danh sách, "ai thấy, ai thao tác" (qua `/admin/effective`), Xem với tư cách (chỉ đọc)
  - Xong: `mat-screen` chỉ đọc (PreviewHost không gửi lệnh) + lớp phủ nút bấm chọn; sửa Ai được xem/Ai được thao tác (chỉ component thao tác được); bảng "ai thấy, ai thao tác" từ một lần gọi theo lô `GET /admin/effective?users=a,b,…` (≤ 200 mỗi lô, theo quyền đã lưu). Tab Xem với tư cách: banner, màn hình và trang hệ thống của người đó, ô ẩn trống, item khóa "Cần quyền thao tác".
- [x] T028 [US4] Studio Inspector tab Bảo mật: `view`, `operate` mặc định (test trước) — chỉ ở project 1.1 (1.0 giữ ô minRole cũ); `setItemAccess`, Thuộc tính màn hình có "Vai trò tối thiểu để xem"; 15 test
- [x] T029 [US4] web-it `tests/web-it/scenarios/admin-attack.mjs`: vai trò thấp gọi API quản trị, CSRF, sửa chính mình leo thang, xóa admin cuối, ghi bằng curl không quyền
  - Ghi chú: web-it `admin-attack` 33/33 xanh x64; attack cũ 37/37 xanh.

## Phase 7: US5 Quy tắc qua cập nhật project (P3)

- [x] T030 [US5] gtest + e2e: nạp project mới giữ quy tắc còn id, mồ côi được báo, Dọn; xóa nhóm/người dùng gỡ khỏi quy tắc
  - Ghi chú (phần máy chủ): `AccessService.RulesLiveThroughANewProject`, cleanup trong admin_api_test, xóa người dùng/nhóm gỡ khỏi quy tắc (API, CLI). Phần e2e trang: luồng C.

## Phase 8: Polish

- [x] T031 Tài liệu: `docs/user/admin-guide.md` (Quản trị trên web, CLI mới, phục hồi), `operator-guide.md` (đăng nhập, đổi mật khẩu, khóa do quyền), ảnh chụp
  - Ghi chú: admin-guide mục 4 viết lại (kho `/var/lib/mat-runtime/auth/`, khởi tạo một lần từ /etc; 4.1 Quản trị trên web từng tab, xác nhận lại, cách tính quyền, ví dụ ca A/Quản đốc, dải cảnh báo; 4.2 CLI mới; 4.3 phục hồi), 5.2 `viewerLogin`, sao lưu, sự cố, A20–A23; operator-guide mục 2 (đăng nhập bắt buộc, bị đăng xuất), 2.1 Đổi mật khẩu của tôi, 3.1 ẩn/khóa do quyền, V9–V10; engineer-guide 6.3 (neo `help-security`, tab Bảo mật, `E_SECURITY_*`, định danh ổn định). Ảnh: cảnh `web-quyen` trong `tools/docs-screenshots.mjs` (runtime giả access-fake; lọc theo tên cảnh; bản e2e thêm lượt `e2e-login`): op-dang-nhap-trang, op-can-quyen, adm-quan-tri-nguoi-dung, adm-quyen-theo-trang, adm-quyen-component, adm-xem-voi-tu-cach. help-topics.json không đổi (`screen:` → `help-screens` chứa 6.3). Mã lỗi API quản trị (LAST_ADMIN, IN_USE…) chưa có trong `schemas/error-codes.json`: tài liệu trích câu tiếng Việt thay vì mã.
- [ ] T032 Đo hiệu năng 500 Tag, 10 client với quyền khác nhau (SC-006), `docs/reports/013-perf.md`
- [ ] T033 `tools/ci-local.ps1` đầy đủ xanh; armhf qemu `access_*_test`

## Dependencies

T003 → T004/T006; T007, T009 → T014–T030 (C++); T015/T020 hợp đồng cố định nên trang (T017, T021, T022, T026, T027) làm song song với runtime giả.
