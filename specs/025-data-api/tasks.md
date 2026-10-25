# Tasks: API dữ liệu (025)

Đầu vào: [spec.md](spec.md), [plan.md](plan.md). Test viết trước (Constitution VI).

## Phase 1: Lõi key

- [x] T001 gtest `core/auth/tests/api_keys_test.cpp`: token, băm, IP/CIDR, tệp (đọc/ghi/hỏng), hạn, nguồn, tốc độ, chặn IP đoán key, tạo/sửa/thu hồi theo `rev`
- [x] T002 `core/auth/api_keys.{hpp,cpp}`, CMake

## Phase 2: API

- [x] T010 gtest `server/tests/data_api_test.cpp`: quyền theo 013, từ chối + audit, tags, values, lịch sử, alarm, ghi idempotent, `expect`, HTTPS; số route `roles_test`, `https_api_test`, `auth_gate_test`
- [x] T011 `server/http/data_api.*`, `roles.cpp`, hành động và kênh audit, `main.cpp`
- [x] T012 gtest `admin_api_test` (apikeys: tạo, token một lần, reauth, rev, thu hồi, audit)
- [x] T013 `admin_api.cpp` nhánh apikeys

## Phase 3: MQTT

- [x] T020 Vector `v11-mqtt-group-pattern*`, gtest payload `sourceTs` và mở rộng mẫu
- [x] T021 Schema, luật TS/C++, model, payload

## Phase 4: Trang Quản trị

- [x] T030 Vitest `apikeys-model.test.ts`, `api.test.ts`
- [x] T031 `tab-apikeys.ts`, `admin-page.ts`, `api.ts`, CSS
- [x] T032 e2e `admin-apikeys.e2e.mjs` (+ axe), `access-fake.mjs`

## Phase 5: Tài liệu, bảo mật, tích hợp

- [x] T040 OpenAPI + `tools/data-api-openapi.test.mjs`; `docs/user/data-api.md`; liên kết trong tab
- [x] T041 ADR-053 + README; threat-model I-18; mã lỗi + sinh lại tài liệu
- [x] T042 Kịch bản tích hợp `tests/web-it` (`data-api`): runtime x64 thật + giả lập Modbus, curl đọc/ghi, thu hồi
- [x] T043 Kiểm cuối: lint, typecheck, `npm test`, ctest, armhf qemu test mới, e2e, clang-format, docs-check
