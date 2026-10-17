// Tìm và chạy PowerShell, openssl cho test và công cụ phát hành (feature 011, T088).
// Thứ tự: biến môi trường MAT_PWSH / MAT_OPENSSL; Windows: `powershell.exe` (Windows PowerShell 5.1, môi trường của
// máy ký) rồi `pwsh`; nơi khác: `pwsh` trong PATH, ~/.local/bin, /usr/local/bin, /opt/homebrew/bin.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const isWin = process.platform === 'win32';

function works(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 30000, windowsHide: true });
    return !r.error && r.status === 0;
  } catch {
    return false;
  }
}

/** Đường dẫn PowerShell dùng được, hoặc null. */
export function findPwsh() {
  const probe = ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'];
  const list = [
    process.env.MAT_PWSH,
    ...(isWin ? ['powershell.exe', 'pwsh.exe'] : ['pwsh']),
    ...(isWin
      ? []
      : [join(homedir(), '.local/bin/pwsh'), '/usr/local/bin/pwsh', '/opt/homebrew/bin/pwsh']),
  ].filter(Boolean);
  for (const c of list) {
    if ((c.includes('/') || c.includes('\\')) && !existsSync(c)) continue;
    if (works(c, probe)) return c;
  }
  return null;
}

/** Đường dẫn openssl dùng được (LibreSSL cũng được), hoặc null. */
export function findOpenssl() {
  const list = [
    process.env.MAT_OPENSSL,
    'openssl',
    ...(isWin ? ['C:\\Program Files\\Git\\usr\\bin\\openssl.exe'] : []),
  ].filter(Boolean);
  for (const c of list) {
    if ((c.includes('/') || c.includes('\\')) && !existsSync(c)) continue;
    if (works(c, ['version'])) return c;
  }
  return null;
}

/** Chạy PowerShell không profile, không tương tác; Windows thêm `-ExecutionPolicy Bypass` cho tiến trình này. */
export function runPwsh(pwsh, args, opt = {}) {
  const base = ['-NoProfile', '-NonInteractive', ...(isWin ? ['-ExecutionPolicy', 'Bypass'] : [])];
  return spawnSync(pwsh, [...base, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 300000,
    ...opt,
  });
}
