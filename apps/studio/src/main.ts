// mAT Studio — khung kiểu IDE (feature 004, T043): nạp theme, sprite icon, bộ điều khiển giao diện
// (StudioApp) trên lớp platform (Tauri, hoặc bản giả ở chế độ e2e) rồi gắn vào <mat-shell>.
// Feature 005: mọi kết nối tới thiết bị đi qua Rust (DeviceLink), kể cả chế độ theo dõi của 004 (CSP chặn
// WebView tự gọi ra mạng).
import './theme/tokens.css';
import './theme/base.css';
import './ui/shell.css';
import { StudioApp } from './app/app.ts';
import { StudioStore } from './app/store.ts';
import { t } from './i18n/index.ts';
import { ValidateClient } from './model/validate-client.ts';
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

// Kiểm project trong Web Worker (feature 006, ADR-016): gõ không bị trễ với 2.000 Tag. Worker lỗi thì báo rồi kiểm
// ngay trong tiến trình.
let notify: (text: string) => void = () => undefined;
const validator = new ValidateClient({
  onFailure: (reason) => notify(t('validate.workerFailed', { reason })),
});
const store = new StudioStore({ platform, validate: (source) => validator.validate(source) });
// Chế độ e2e: `?gate=off` tắt cổng phiên bản (hộp thoại Nâng cấp) để các kịch bản 004, 005 chạy trên project 0.1 mẫu; kịch bản
// nâng cấp bật cổng. Bản phát hành không đọc tham số này.
const gateOff =
  (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE === 'e2e' &&
  new URLSearchParams(window.location.search).get('gate') === 'off';
const app = new StudioApp({
  platform,
  store,
  link: deviceLink,
  storage: localStore(),
  windowWidth: window.innerWidth,
  versionGate: !gateOff,
});
notify = (text) => app.toast(text);
applyTheme(document.documentElement, app.workspace.theme);
document.body.prepend(buildSprite(document));
let shell = document.querySelector('mat-shell');
if (!(shell instanceof MatShell)) {
  shell = document.createElement('mat-shell');
  document.body.append(shell);
}
(shell as MatShell).app = app;
void app.start();
