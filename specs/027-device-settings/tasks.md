# Tasks: Thiết lập thiết bị từ Studio (027)

Đầu vào: [spec.md](spec.md), [plan.md](plan.md). Test viết trước (Constitution VI).

## Phase 1: Lớp đè cấu hình

- [x] T001 gtest `config_test` (DeviceSettings.*): đè 6 khóa, `base`, `.bak`, tệp hỏng không chặn khởi động, khóa ngoài danh sách bị từ chối
- [x] T002 `server/config.{hpp,cpp}`: `applyDeviceSettings`, `deviceSettingsOf`, nạp `<dataDir>/settings.json` sau dòng lệnh

## Phase 2: API và chứng chỉ

- [x] T010 gtest `admin_api_test` (AdminDevice.*): GET lớp/chứng chỉ, lưu + `.bak` + khởi động lại, 400, 409, reauth khi giảm bảo vệ, audit before/after, regen có IP SAN (hết `TLS_NO_IP_SAN`), CSR, nhập sai khóa/khóa riêng/rác bị từ chối, nhập đúng
- [x] T011 `server/device_admin.{hpp,cpp}`, nhánh trong `admin_api.cpp`, `ImportOptions.rejectExpired` (mã 5), `main.cpp` (khởi động lại từ vòng tick qua `deployHooks.restart`)
- [x] T012 Bảng quyền `roles.cpp` + `roles_test` (hợp đồng, cookie), số route `https_api_test` (92), `auth_gate_test`; audit `device.settings` + `audit_log_test`
- [x] T013 Mã lỗi `CERT_EXPIRED` (mới), `CERT_FILE_INVALID`/`CERT_KEY_MISMATCH` thêm HTTP 400; sinh lại `docs/user/error-codes.md`; câu `UPDATE_DISABLED` chỉ tới Thiết lập thiết bị

## Phase 3: OTA

- [x] T020 `deploy_rollback_test.sh`: gói có `updater/*` và `bin/` 0644 (như tar của Windows) vẫn cài mat-updater 0755
- [x] T021 `deploy.sh`: đặt 0755 cho `updater/*`, kiểm `-f` thay `-x`
- [x] T022 `tools/update-it` kịch bản `settings`: tắt OTA bằng thiết lập → `UPDATE_DISABLED`; bật lại cần mật khẩu; một cập nhật đủ vòng với khóa thử

## Phase 4: Giao diện

- [x] T030 Vitest `packages/access-model/src/device-settings.test.ts` (parse, overlay, khóa giảm bảo vệ, tên/host, so vân tay)
- [x] T031 Trang Quản trị: tab "Thiết bị" (`tab-device.ts`, `api.ts`, i18n, CSS); e2e `admin-device.e2e.mjs` (+ axe), `access-fake.mjs`
- [x] T032 Vitest `model/device-settings-flow.test.ts` (lưu overlay, reauth, regen → chờ → xác nhận → bỏ ghim cũ, ghim mới, kết nối lại; vân tay khác thì không ghim; lỗi nhập)
- [x] T033 Studio: nút cây Thiết bị › Thiết lập thiết bị (Online administrator), editor `device-settings-editor.ts` (tab Chung, Chứng chỉ), `mock-device-settings.ts`; e2e `device-settings.e2e.mjs` (+ axe)
- [x] T034 Rust: `device_get`/`device_post` cho phép 5 đường mới (`http.rs` + test)

## Phase 5: Tích hợp, tài liệu

- [x] T040 web-it `device-settings`: runtime x64 thật, viewerLogin qua API → khởi động lại → 401; regen → fingerprint 8443 đổi đúng giá trị API trả; CSR; nhập hỏng bị từ chối; audit
- [x] T041 ADR-054 + README, threat-model I-19/RR-19, admin-guide (5.0, 5.4, mục 3, 7.2), engineer-guide 10.4a
- [x] T042 Kiểm cuối: lint, typecheck, `npm test`, ctest (trừ `ProjectDigestVector|AlarmStorm`), armhf qemu (test mới), web-it, update-it `settings`, e2e, clang-format, docs-check (xem ghi chú commit)
- [ ] T043 BL335 thật (chờ người dùng): cài gói mới bằng `deploy.sh` (kèm mat-updater), đổi thiết lập và sinh lại chứng chỉ từ Studio, ghim lại; gói phát hành thật cần khóa ký thật của công ty
