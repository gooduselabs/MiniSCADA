# Implementation Plan: Đăng nhập bắt buộc, phân quyền theo người dùng và trang Quản trị trên web

**Branch**: `013-access-control` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)

## Summary

Thêm nhóm người dùng và quy tắc quyền theo tài nguyên (màn hình, popup, component, trang hệ thống, nhóm lưu trữ, mẫu báo cáo) lưu **trên thiết bị**; runtime tính quyền hiệu lực cho mỗi phiên và **thực thi ở máy chủ** trên mọi đường dữ liệu; trang vận hành chuyển về trang đăng nhập khi chưa có phiên, ẩn hoặc khóa theo quyền và có trang **Quản trị** cho administrator (người dùng, nhóm, quyền theo trang, quyền theo component trên xem trước màn hình, xem với tư cách, nhật ký). Hợp đồng: [access-model.md](contracts/access-model.md), [admin-api.md](contracts/admin-api.md).

## Technical Context

- **Ngôn ngữ:** C++17 (runtime, `core/auth`, `server/http`, `server/websocket`), TypeScript 5 + Lit 3.3.3 (trang vận hành, `packages/*`), JSON Schema 2020-12.
- **Lưu trữ:** tệp JSON trong `/var/lib/mat-runtime/auth/` (ghi nguyên tử, `flock`), `audit.db` có sẵn.
- **Test:** gtest/ctest (x64 + armhf qemu), Vitest, e2e Chrome (`apps/runtime-web/tests/e2e`, runtime giả), `tools/web-it.ps1` (runtime x64 thật trong Docker).
- **Đích:** BL335 (armhf, 512 MB); ngân sách Constitution III; device-api 1.5.0 → 1.6.0.
- **Ràng buộc:** không thư viện mới; mật khẩu dùng hàng đợi Argon2id có sẵn; không ghi eMMC thường xuyên (`lastLoginAt` ≤ 1 lần/giờ/người).

## Constitution Check

| Nguyên tắc | Đánh giá |
|---|---|
| II Dùng chung | Bộ tính quyền có hai bản (C++ thực thi, TS cho Studio/kiểm) với vector chung `tests/access-vectors`; luật `E_SECURITY_*` ở cả hai bộ kiểm project, vector `v11-*` |
| III Ngân sách | Quyền tính trước theo phiên, tra bảng băm; đo 500 Tag, 10 client (SC-006) |
| V An toàn | Thực thi ở máy chủ mọi đường (bảng admin-api §6); API quản trị chỉ HTTPS, CSRF, xác nhận lại, giới hạn tần suất, audit; mặc định an toàn khi kho hỏng; cập nhật threat-model |
| VI Test trước | Mỗi bước viết test đỏ trước (gtest, Vitest, e2e, web-it ca tấn công) |
| VII Tương thích | Định dạng 1.1 cộng thêm khóa tùy chọn; `users.json` 1.0.0 đọc được; thiết bị cũ giữ `viewerLogin` |

**Lệch có lý do (ADR-042):** kho tài khoản chuyển từ `/etc/mat-runtime` (root, runtime chỉ đọc) sang `/var/lib/mat-runtime/auth` (runtime ghi được) để admin sửa trên web (yêu cầu của người dùng, D22). Rủi ro: lỗ hổng trong runtime có thể sửa tài khoản. Giảm: runtime vốn đã giữ quyền ghi PLC (lỗ hổng ở runtime đã là mức cao nhất); API quản trị hẹp, kiểm chặt, audit; CLI root vẫn phục hồi được; `access.json` hỏng thì chỉ admin vào.

## Project Structure

```
core/auth/            access_store.{hpp,cpp}   (users 1.1 + access.json, flock, rev, .bak)
                      access_model.{hpp,cpp}   (ResourceCatalog, computeAccess, thuần)
                      access_catalog.{hpp,cpp} (dựng danh mục từ LoadedProject)
                      account_store.*          (đường mới, groups, lastLoginAt, 200 tài khoản)
server/http/          admin_api.{hpp,cpp}      (/api/v1/admin/*, web/access, web/password)
                      http_api.cpp, history_api.cpp, tags_api.cpp, auth_gate.cpp (thực thi)
server/websocket/     live_hub.*               (lọc Tag theo phiên, access-changed)
server/cli/users.cpp  (đường mới, --user-groups/--user-remove/--group-*/--access-reset)
packages/access-model/ (TS: computeAccess, catalogFromProject)
packages/project-schema/ schemas/screen.schema.json (security.view/operate), rules E_SECURITY_*
tests/access-vectors/ (generate.mjs, ≥ 40 ca)
apps/runtime-web/src/ login.ts, session.ts, main.ts, menu.ts, access.ts, admin/* (trang Quản trị)
apps/studio/          Inspector: tab Bảo mật (view/operate mặc định)
tests/web-it/scenarios/access.mjs, admin-attack.mjs
docs/adr/042-*.md, docs/architecture/threat-model.md, docs/user/admin-guide.md, operator-guide.md
```

## Phân luồng làm song song

1. **Luồng A (TS, schema):** `security.view/operate` ở schema + luật hai bộ kiểm + vector `v11-security-*`; `packages/access-model` + `tests/access-vectors` (≥ 40 ca); Studio Inspector.
2. **Luồng B (C++ runtime):** kho, bộ tính, danh mục, API quản trị, thực thi mọi đường, CLI, gtest (kèm bộ chạy `access_vectors_test` đọc vector của luồng A), `web-it` ca mới.
3. **Luồng C (trang web):** chuyển hướng đăng nhập + `next`, Đổi mật khẩu, lọc menu, trang 403, ẩn/khóa component, `access-changed`, trang Quản trị đủ 5 tab + xem với tư cách; e2e với runtime giả theo hợp đồng.

Gộp: A → B (chạy vector) → C; rồi tài liệu, đo hiệu năng, ci-local.
