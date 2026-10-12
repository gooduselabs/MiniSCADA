// mAT Studio — khung kiểu IDE (feature 004, T043): nạp theme, sprite icon, bộ điều khiển giao diện
// (StudioApp) trên lớp platform (Tauri, hoặc bản giả ở chế độ e2e) rồi gắn vào <mat-shell>.
// Feature 005: mọi kết nối tới thiết bị đi qua Rust (DeviceLink), kể cả chế độ theo dõi của 004 (CSP chặn
// WebView tự gọi ra mạng).
import './theme/tokens.css';
import './theme/base.css';
import './ui/shell.css';
import { StudioApp } from './app/app.ts';
import type { StorageLike } from './app/workspace.ts';
import { buildSprite } from './icons/icons.ts';
import { deviceLink } from './platform/tauri-device.ts';
import { platform } from './platform/tauri.ts';
import { applyTheme, MatShell } from './ui/mat-shell.ts';

/** localStorage có thể bị chặn (chế độ riêng tư, chính sách): khi đó không nhớ bố cục, không lỗi. */
function localStore(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const app = new StudioApp({
  platform,
  link: deviceLink,
  storage: localStore(),
  windowWidth: window.innerWidth,
});
applyTheme(document.documentElement, app.workspace.theme);
document.body.prepend(buildSprite(document));
let shell = document.querySelector('mat-shell');
if (!(shell instanceof MatShell)) {
  shell = document.createElement('mat-shell');
  document.body.append(shell);
}
(shell as MatShell).app = app;
void app.start();
