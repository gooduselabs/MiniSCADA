# Cài mAT Studio offline trên Windows 10/11 (US4 — T042/T043, SC-006)

**Trạng thái: ĐẠT** — người dùng xác nhận cài offline OK trên Windows 10 và 11, kể cả trường hợp chưa có WebView2 (2026-10-10). Bộ cài đã dựng và đã cài/mở/gỡ thành công trên máy dev Windows 11. **Chưa thử** trên Windows 10, trên máy **không có Internet**, và trên máy **chưa có WebView2**. Đó là điều kiện thật của SC-006 và cần máy của người dùng.

## Bộ cài

| Mục | Giá trị |
|---|---|
| File | `mAT Studio_0.1.0_x64-setup.exe` (NSIS, x64) |
| Kích thước | 218.215.603 B (~208 MiB). Chủ yếu là WebView2 offline installer nhúng sẵn; `mat-studio.exe` chỉ ~4 MB |
| SHA-256 | `F0ED6788ECF281BFB6020FA3813C2FEC565AACB38C0A88212B3B6783C4564E36` |
| Vị trí trên máy dev | `C:\build\mat-studio\release\bundle\nsis\` (không nằm trong repo) |
| Dựng | 2026-10-10 12:35, `npm run studio:build`, 197 s (bản release biên dịch đầu tiên ~4 phút) |
| Cấu hình | `targets: ["nsis"]`, `webviewInstallMode: offlineInstaller (silent)`, `installMode: currentUser`, CSP chặt, `freezePrototype: true` ([tauri.conf.json](../../apps/studio/src-tauri/tauri.conf.json)) |
| Môi trường build | Windows 11, Rust 1.99.0 MSVC, Visual Studio 2026 Insiders (MSVC 14.51, Windows SDK 26100), Tauri 2.12.2, Node 24.15 |

Lần build đầu **cần Internet trên máy build**: bundler tải NSIS 3.11, `nsis_tauri_utils.dll` và WebView2 offline installer (Microsoft fwlink 2124701). Các lần sau dùng cache.

## Đã kiểm chứng trên máy dev (Windows 11, có mạng, đã có WebView2 154)

| Bước | Kết quả |
|---|---|
| `tauri dev` | Cửa sổ "mAT Studio" hiện; IPC `app_info` trả "mAT Studio 0.1.0 / Tauri 2.12.2"; console không lỗi |
| Chạy bản release (chưa cài) | Trang nạp từ `http://tauri.localhost/`. Header CSP thực tế đúng cấu hình (Tauri thêm hash cho script). IPC hoạt động. `Object.prototype` đã đóng băng. Console trống: không vi phạm CSP, không cảnh báo IPC dùng đường dự phòng |
| Cài im lặng `/S` | Mã thoát 0, 15,5 s, **không hỏi quyền admin**. Cài vào `%LOCALAPPDATA%\mAT Studio` (`mat-studio.exe`, `uninstall.exe`), có shortcut Start menu, mục gỡ cài đặt (HKCU, Publisher: ATPro) |
| Mở bản đã cài | Cửa sổ "mAT Studio", IPC hoạt động, CSP và `freezePrototype` như trên |
| Gỡ im lặng `uninstall.exe /S` | Mã thoát 0; xóa thư mục cài, shortcut và mục gỡ cài đặt. Thư mục dữ liệu WebView2 `%LOCALAPPDATA%\vn.com.atpro.matstudio` **còn lại** (gỡ im lặng giữ dữ liệu ứng dụng); đã xóa tay sau khi thử |

Cách kiểm tra IPC/CSP: chạy app với `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<cổng>`, rồi đọc trang qua DevTools protocol (puppeteer `connect`). Không chụp màn hình desktop.

## Còn phải thử (T043) — quy trình trên mỗi máy

1. Ghi phiên bản Windows (`winver`) và tình trạng WebView2 Runtime (Settings → Apps, hoặc registry `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`). Ưu tiên một máy **chưa có** WebView2.
2. Ngắt Internet (rút cáp, tắt Wi-Fi) và xác nhận không truy cập ra ngoài được.
3. Chép bộ cài bằng USB; kiểm tra SHA-256 (`Get-FileHash <file> -Algorithm SHA256`) khớp giá trị ở trên.
4. Chạy bộ cài. Ghi lại: có hỏi quyền admin không (đặc biệt khi phải cài WebView2), thời gian, lỗi nếu có.
5. Mở mAT Studio. Cửa sổ chính phải hiện và dòng **Rust backend** ghi "phản hồi (IPC hoạt động)".
   - Nếu IPC lỗi, danh sách sẽ hiện "Lỗi: …". Khi đó mở DevTools của WebView2 để xem console.
   - Lưu ý: dòng "Chạy ngoài Tauri" chỉ hiện khi trang không chạy trong Tauri, **không** phải dấu hiệu CSP chặn IPC.
6. Gỡ cài đặt (Settings → Apps). Xác nhận thư mục cài và shortcut đã bị xóa.

| Máy | Windows | WebView2 trước khi cài | Không Internet | Cài OK | Hỏi admin | Studio mở | IPC | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| Máy dev | Windows 11 (10.0.26200) | có (154) | **không** (có mạng) | ✓ 15,5 s | không | ✓ | ✓ | thử bổ trợ, không thay cho SC-006 |
| Máy offline của người dùng | (chưa ghi) | (chưa ghi) | ✓ | ✓ (người dùng báo 2026-10-10) | (chưa ghi) | ✓ | (chưa ghi) | người dùng xác nhận (2026-10-10): đã thử đủ Windows 10/11, trường hợp chưa có WebView2 và quyền admin đều OK |

Kết luận SC-006: **Đạt** theo báo cáo người dùng cài trên máy offline. Đường cài, mở và gỡ đã chạy đúng trên Windows 11 có mạng. Phần offline và Windows 10 còn thiếu.
