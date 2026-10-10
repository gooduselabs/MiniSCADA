# mAT Studio (Sprint 1: cấu hình + xem trước)

Ứng dụng desktop Tauri 2 + Vite + TypeScript. Sprint 1 có:

- **Mở project** (thư mục viết tay theo schema v0, ví dụ `projects/tank-demo`). Hộp thoại chọn thư mục chạy ở phía Rust; giao diện chỉ đọc/ghi được file `.json`/`.svg` **bên trong** thư mục đó (`src-tauri/src/project_fs.rs`).
- **Kiểm tra** bằng đúng bộ kiểm tra dùng chung với runtime (`@mat/project-schema`), liệt kê lỗi theo file, vị trí, lý do.
- **Cấu hình**: sửa tên, phiên bản, màn hình đầu vào, `maxClients` (1–10), danh sách Tag. Chỉ cho lưu khi hợp lệ; ghi atomic theo định dạng chuẩn (JSON 2 dấu cách), chỉ đổi đúng dòng đã sửa.
- **Thiết bị**: nhập địa chỉ (ví dụ `192.168.1.110` hoặc `198.51.100.200:9080`), kiểm kết nối qua `/api/v1/system/info`, nút **Mở web thiết bị** (mở trình duyệt mặc định).
- **Xem trước**: SVG + binding của project trên máy này, Tag lấy từ thiết bị, dùng đúng package của runtime web (`svg-renderer`, `binding-engine`, `live-client`). Xem trước chiếm 1 trong 10 phiên của thiết bị; bấm **Dừng** để trả slot.

Chưa có: trình vẽ SVG (Sprint 3), sửa binding (Sprint 4), đẩy project lên thiết bị (Sprint 6). Hiện vẫn copy thủ công theo [docs/deployment/mat-runtime.md](../../docs/deployment/mat-runtime.md).

CSP Sprint 1: `connect-src 'self' ipc: http://ipc.localhost http: ws:`. Không giới hạn host vì IP thiết bị do người dùng nhập lúc chạy; `script-src 'self'` giữ nguyên (biện minh: plan.md, Complexity Tracking). Plugin `dialog` và `opener` chỉ được gọi từ lệnh Rust; capability của giao diện vẫn chỉ `core:default`.

Test: `npm test -w @mat/studio` (Vitest: form cấu hình, địa chỉ thiết bị) và `cargo test --lib` trong `src-tauri` (đường dẫn an toàn, ghi atomic).

## Trạng thái kiểm chứng bộ cài (Sprint 0, 2026-10-10)

| Hạng mục | Trạng thái |
|---|---|
| `typecheck`, build giao diện, `rustfmt`, `cargo generate-lockfile` | ✓ |
| `tauri dev`: cửa sổ "mAT Studio" hiện, IPC `app_info` trả lời, console không lỗi | ✓ |
| Bản release chạy dưới **CSP thật**: IPC hoạt động, không vi phạm CSP, `freezePrototype` bật | ✓ |
| Bộ cài NSIS nhúng WebView2 offline (~208 MiB): cài, mở, gỡ im lặng trên Windows 11 có mạng, không cần admin | ✓ |
| Cài trên Windows 10 và trên máy **không Internet / chưa có WebView2** | **chưa thử** (cần máy của người dùng) — [studio-install.md](../../docs/reports/studio-install.md) |

## Yêu cầu máy build

- Rust toolchain MSVC (`rustup`; máy dev: stable 1.99.0).
- Visual Studio 2022/2026 hoặc Build Tools có thành phần **MSVC x64/x86 build tools** và **Windows 11 SDK** (workload "Desktop development with C++"). Máy dev dùng VS 2026 Insiders (MSVC 14.51, SDK 26100).
- WebView2 Runtime (Windows 11 có sẵn). Bộ cài NSIS nhúng bản offline cho máy chưa có.
- **Lần build đầu cần Internet**: bundler tải NSIS, `nsis_tauri_utils.dll` và WebView2 offline installer.
- Kiểm tra môi trường: `npm run tauri -w @mat/studio -- info`.

## Chạy và đóng gói

Thư mục `target` của Rust rất lớn (vài GB). Đặt ra ngoài ổ chứa dự án nếu ổ đó gần đầy:

```powershell
$env:CARGO_TARGET_DIR = 'C:\build\mat-studio'
npm run studio:dev      # cửa sổ Tauri + Vite dev server (cổng 1420); lần đầu biên dịch ~3 phút
npm run studio:build    # → $env:CARGO_TARGET_DIR\release\bundle\nsis\mAT Studio_0.1.0_x64-setup.exe
```

Xem giao diện không cần Rust: `npm run dev -w @mat/studio`, mở `http://localhost:1420` (hiện "Chạy ngoài Tauri").

Gỡ lỗi WebView2 (đọc console, kiểm tra IPC/CSP): đặt `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` trước khi chạy app, rồi mở `http://127.0.0.1:9223` hoặc dùng puppeteer `connect`.

## Ghi chú thiết kế

- Quyền: capability `default` chỉ có `core:default`; không dùng plugin nào; `withGlobalTauri` tắt (giao diện nhập API bằng `import`). Lệnh tùy biến `app_info` không cần permission. `core:default` vẫn rộng hơn mức Sprint 0 cần: thu hẹp khi có tính năng thật.
- CSP: `default-src 'self'; img-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; form-action 'none'`, kèm `freezePrototype`. Đã chạy thử ở bản release.
- Nhãn "Chạy ngoài Tauri" dựa trên `isTauri()`, tức chỉ cho biết trang có chạy trong Tauri hay không. Nếu IPC lỗi, danh sách hiện "Lỗi: …". Muốn biết CSP có chặn gì không thì xem console WebView2.
- Giao diện chỉ dùng `textContent`, không `innerHTML`; Constitution V cấm `eval`/script tùy ý (ESLint kiểm `no-eval`, `no-new-func`).
- Studio dùng chung schema/expression với Runtime qua `packages/*` (Constitution II). Sprint 0 chưa có phần này.
