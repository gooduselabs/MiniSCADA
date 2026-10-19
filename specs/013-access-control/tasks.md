# Tasks: Đăng nhập bắt buộc, phân quyền theo người dùng và trang Quản trị trên web (013)

Đầu vào: [spec.md](spec.md), [plan.md](plan.md), [contracts/access-model.md](contracts/access-model.md), [contracts/admin-api.md](contracts/admin-api.md). Test viết trước (Constitution VI): mỗi task cài đặt đi sau task test của nó, test phải đỏ trước.

## Phase 1: Setup

- [ ] T001 ADR `docs/adr/042-access-control.md` (kho trên thiết bị, chuyển `users.json` sang `/var/lib/mat-runtime/auth`, mô hình quyền, thực thi máy chủ) và mục mới trong `docs/architecture/threat-model.md` (API quản trị, leo thang, CSRF, rò dữ liệu qua đường phụ)
- [ ] T002 `deployment/config/runtime.json`: `viewerLogin` mặc định `required` cho bản cài mới; thiết bị đang chạy giữ tệp cũ (kiểm `deploy_rollback_test.sh`)

## Phase 2: Foundational (luồng A + B lõi)

- [x] T003 [P] Bộ sinh `tests/access-vectors/generate.mjs` + ≥ 40 ca theo access-model §7 (kết quả viết tay, không sinh bằng bộ tính) — 74 ca; quy ước chi tiết (mồ côi gồm mức không áp được, khóa chỉ cho item được xem, alarm không phụ thuộc `page:alarms`) ở `tests/access-vectors/README.md`
- [x] T004 [P] Test Vitest `packages/access-model/src/compute.test.ts` chạy mọi vector (đỏ) — 79 test, đỏ trước khi cài
- [x] T005 `packages/access-model/src/compute.ts` (`computeAccess`), `catalog.ts` (`catalogFromProject`) cho xanh — 85 test xanh; catalog test trên grid-demo, history-demo, alarm-demo; popup có tham số bung theo `args`; alarm theo thiết bị (không Tag) chưa vào danh mục
- [ ] T006 [P] gtest `core/auth/tests/access_model_test.cpp` + `access_vectors_test.cpp` (đọc `tests/access-vectors`) (đỏ)
- [ ] T007 `core/auth/access_model.{hpp,cpp}` + `access_catalog.{hpp,cpp}` cho xanh
- [ ] T008 [P] gtest `core/auth/tests/access_store_test.cpp`: users 1.0→1.1, khởi tạo từ `/etc`, `flock`, `rev`/409, `.bak`, tệp hỏng → chỉ admin, giới hạn kích thước (đỏ)
- [ ] T009 `core/auth/access_store.{hpp,cpp}`, `account_store.*` (đường mới, `groups`, `lastLoginAt`, 200 tài khoản) cho xanh
- [x] T010 [P] Schema `schemas/screen.schema.json`: `item.security.view/operate`, `screen.security.view`; luật `E_SECURITY_LEVEL`, `E_SECURITY_ITEM` ở `packages/project-schema/src/rules-11.ts` và `core/project-manager/rules_11.cpp`; vector `tests/project-vectors/v11-security-*` (test trước) — 23 ca, luật ở `tests/project-vectors/README-013.md` (`E_SECURITY_LEVEL`: operate viewer, thấp hơn view, khác minRole, hoặc security mới ở project 1.0); TS và C++ xanh

## Phase 3: US1 Đăng nhập bắt buộc (P1)

- [ ] T011 [US1] e2e `apps/runtime-web/tests/e2e/login-required.e2e.mjs`: 401 → `/login?next=`, `next` độc hại (20 dạng) bị bỏ, hết phiên quay lại đúng trang (đỏ)
- [ ] T012 [US1] `login.ts`, `session.ts`, `main.ts`, `project-store.ts`: chuyển hướng và `next` an toàn
- [ ] T013 [US1] web-it `tests/web-it/scenarios/login-required.mjs`: mọi đường dữ liệu không phiên → 401, 0 byte giá trị Tag

## Phase 4: US2 Quản lý tài khoản trên web (P1)

- [ ] T014 [US2] gtest `server/tests/admin_api_test.cpp`: users/groups, reauth, LAST_ADMIN, IN_USE, CONFLICT, 413/400, 429, hủy phiên, audit before/after không có mật khẩu (đỏ)
- [ ] T015 [US2] `server/http/admin_api.{hpp,cpp}` + bảng `core/auth/roles.cpp`; `web/password`, `web/session` thêm `groups`, `viewerLogin`; device-api 1.6.0
- [ ] T016 [US2] CLI `server/cli/users.cpp`: đường mới + `--user-groups`, `--user-remove`, `--group-add/remove`, `--access-reset` (test `user_cli_test`)
- [ ] T017 [US2] Trang `apps/runtime-web/src/admin/`: khung Quản trị, tab Người dùng, tab Nhóm, hộp xác nhận lại; Đổi mật khẩu của tôi (e2e trước)
- [ ] T018 [US2] Tab Nhật ký (`/api/v1/admin/audit`)

## Phase 5: US3 Quyền theo trang (P1)

- [ ] T019 [US3] gtest thực thi: `/project/<màn hình>` 403, navigation/projects/active lọc, live `denied`, history lọc/403, alarm lọc, `access-changed` (đỏ)
- [ ] T020 [US3] Thực thi ở `http_api.cpp`, `live_hub.*`, `civet_transport.cpp`, `history_api.cpp`, alarm; `GET /api/v1/web/access`; `/api/v1/admin/access*`, `/admin/effective`
- [ ] T021 [US3] Trang: `access.ts` (tải EffectiveAccess), menu lọc, trang "không có quyền", xử lý `access-changed`
- [ ] T022 [US3] Tab Quyền theo trang (ma trận, đặt nhiều trang, sao chép)
- [ ] T023 [US3] web-it `tests/web-it/scenarios/access.mjs`: bắt live của người bị cấm 0 giá trị Tag cấm; history, alarm, project file

## Phase 6: US4 Quyền theo component (P2)

- [ ] T024 [US4] gtest: màn hình trả về bỏ item ẩn, ô lưới bỏ `item`; `tags/write` cookie thiếu `context`/không `operate`/Tag không thuộc binding → `ACCESS_DENIED` + audit (đỏ)
- [ ] T025 [US4] Cài đặt ở `http_api.cpp`, `tags_api.cpp`
- [ ] T026 [US4] Trang: component ẩn / khóa "cần quyền thao tác" (`lockedItems`), ô lưới trống
- [ ] T027 [US4] Tab Quyền theo component: xem trước màn hình bấm chọn + danh sách, "ai thấy, ai thao tác" (qua `/admin/effective`), Xem với tư cách (chỉ đọc)
- [x] T028 [US4] Studio Inspector tab Bảo mật: `view`, `operate` mặc định (test trước) — chỉ ở project 1.1 (1.0 giữ ô minRole cũ); `setItemAccess`, Thuộc tính màn hình có "Vai trò tối thiểu để xem"; 15 test
- [ ] T029 [US4] web-it `tests/web-it/scenarios/admin-attack.mjs`: vai trò thấp gọi API quản trị, CSRF, sửa chính mình leo thang, xóa admin cuối, ghi bằng curl không quyền

## Phase 7: US5 Quy tắc qua cập nhật project (P3)

- [ ] T030 [US5] gtest + e2e: nạp project mới giữ quy tắc còn id, mồ côi được báo, Dọn; xóa nhóm/người dùng gỡ khỏi quy tắc

## Phase 8: Polish

- [ ] T031 Tài liệu: `docs/user/admin-guide.md` (Quản trị trên web, CLI mới, phục hồi), `operator-guide.md` (đăng nhập, đổi mật khẩu, khóa do quyền), ảnh chụp
- [ ] T032 Đo hiệu năng 500 Tag, 10 client với quyền khác nhau (SC-006), `docs/reports/013-perf.md`
- [ ] T033 `tools/ci-local.ps1` đầy đủ xanh; armhf qemu `access_*_test`

## Dependencies

T003 → T004/T006; T007, T009 → T014–T030 (C++); T015/T020 hợp đồng cố định nên trang (T017, T021, T022, T026, T027) làm song song với runtime giả.
