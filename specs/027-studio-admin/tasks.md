# Tasks 027

- [x] T001 Gói `@mat/admin-model`: chuyển `api.ts`, `model.ts`, `email-model.ts`, `apikeys-model.ts` và test từ trang web;
      `AdminTransport`, `fetchTransport`; `access.ts`, `errors.ts`, `text.ts`, `preview-host.ts`; web re-export.
- [x] T002 Test trước: Vitest kênh tùy ý (đường, thân, 409, lỗi kênh) trong gói.
- [x] T003 Rust `device_admin` + test (`admin_paths`, `device_admin_forwards_and_returns_every_status`).
- [x] T004 `DeviceLink.admin` (Tauri + giả `mock-admin.ts`), test `tauri-device`.
- [x] T005 `AdminWorkspace` + test (tải, gate, tạo người dùng, reauth, 409, API key, email, lỗi kênh).
- [x] T006 Cây: nhóm "Người dùng và quyền" thay trang giữ chỗ; test cây, lệnh.
- [x] T007 Editor, Inspector, hộp thoại, lệnh bảng lệnh; i18n `vi-admin.ts`.
- [x] T008 e2e Studio `admin.e2e.mjs` (41 kiểm, axe hai theme), ảnh `C:\build\tmp-027b\`.
- [x] T009 ctest `AdminApi.StudioManagesUsersWithItsBearerSession`.
- [x] T010 Sửa 5 kiểm `admin` hỏng sẵn của trang web: chọn nút Lọc của tab Nhật ký (chuông 026 cũng có `[data-filter]`);
      vùng cuộn bảng Nhật ký nhận focus (`tabindex=0`, `role=region`).
- [x] T011 Tài liệu: admin-guide 4.7, engineer-guide, `specs/013-access-control` 8.6.
