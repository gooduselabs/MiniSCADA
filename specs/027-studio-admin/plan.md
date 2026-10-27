# Plan 027: Quản lý người dùng và quyền từ Studio

## Kiến trúc

```text
Studio (Lit)                                   @mat/admin-model                Runtime (C++)
editor admin:<trang> ─┐                        AdminApi(transport) ──┐
Inspector (props)     ├─ app.admin (AdminWorkspace) ──────────────────┤
admin-dialog          ┘        transport = DeviceLink.admin ─ Tauri device_admin ─ HTTPS ghim + Bearer ─ /api/v1/admin/*
trang Quản trị web ── AdminApi(fetchTransport: cookie + X-MAT-CSRF) ─────────────────────────────────────┘
```

- **Gói `packages/admin-model`** (mới): `api.ts` (kiểu, đọc thân, `AdminApiError`, `AdminApi` nhận `AdminTransport`,
  `fetchTransport` của web), `access.ts` (EffectiveAccess, `filterScreen`), `model.ts`, `email-model.ts`,
  `apikeys-model.ts`, `errors.ts` (`adminErrorText`), `text.ts` (chuỗi dùng chung), `preview-host.ts`. Trang web giữ các
  tệp cũ thành lớp re-export mỏng.
- **Rust** `device_admin({ id, method, path, query?, body? })` trong `src-tauri/src/device/mod.rs` + `http.rs`
  (`allowed_admin_path`, `admin_timeout`, `MAX_ADMIN_BODY`).
- **Studio**: `app/admin-workspace.ts` (dữ liệu, lựa chọn, bản nháp `RuleDraft`, hộp thoại, reauth, 409),
  `ui/editors/admin-editors.ts` (editor + xem trước có lớp chọn), `ui/editors/admin-inspector.ts`,
  `ui/dialogs/admin-dialog.ts`, cây `model/tree.ts` (nhóm `users`, Nhật ký là editor Audit), lệnh `admin.*`.
- **Giả lập**: `platform/mock-admin.ts` (API quản trị giả của e2e, dùng chung bảng tài khoản của thiết bị giả).
- **Máy chủ**: không đổi mã; route quản trị vốn nhận Bearer (bảng `endpointRules`); thêm test `AdminApi` qua Bearer.

## Quyết định

- Nhật ký trong nhóm dùng lại editor Audit có sẵn (cùng kho audit), không làm editor thứ hai.
- Mật khẩu SMTP vẫn đặt bằng CLI trên thiết bị (023); Studio chỉ hiện đã đặt hay chưa.
- Quyền theo component chỉ cho project định dạng 0.3+ (màn hình nhiều item); digest so bằng `compare.localDigest()` và
  `system/info.project.digest`.
