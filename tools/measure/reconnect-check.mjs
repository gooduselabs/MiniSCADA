// Kiểm SC-003 trên Chrome thật: mất kết nối → STALE trong ≤ 15 s; có lại kết nối → tự kết nối
// lại, snapshot mới, hết STALE trong ≤ 30 s, không tải lại trang.
// Mô phỏng "rút cáp" bằng lệnh tùy chọn, ví dụ với runtime x64 trong Docker:
//   node tools/measure/reconnect-check.mjs http://localhost:8080/ \
//     --cut "docker pause mat-runtime-x64" --restore "docker unpause mat-runtime-x64" --offline 30
// Mã thoát: 0 đạt, 1 không đạt, 2 không chạy được.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const cut = opt('--cut', '');
const restore = opt('--restore', '');
if (!url || !cut || !restore) {
  console.error(
    'Usage: node tools/measure/reconnect-check.mjs <url> --cut "<cmd>" --restore "<cmd>" [--offline 30] [--out f.json]',
  );
  process.exit(2);
}
const offlineS = Number(opt('--offline', '30'));
const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!executablePath) {
  console.error('Không tìm thấy Chrome; đặt CHROME_PATH.');
  process.exit(2);
}

const status = (page) =>
  page.evaluate(() => {
    const root = document.getElementById('app-screen')?.shadowRoot;
    return {
      badge: document.getElementById('app-live')?.textContent,
      motorFill: root?.querySelector('[data-mat-uid="el_motor_body"]')?.style.fill,
      txtLevel: root?.querySelector('[data-mat-uid="el_txt_level"]')?.textContent,
      navigations: performance.getEntriesByType('navigation').length,
    };
  });

const browser = await puppeteer.launch({ executablePath, headless: true });
const result = { url, offlineS };
let restored = false;
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(
    () => document.getElementById('app-live')?.textContent === 'Trực tuyến',
    {
      timeout: 15000,
    },
  );
  result.before = await status(page);
  const tCut = Date.now();
  execSync(cut, { stdio: 'inherit' });
  await page.waitForFunction(
    () => document.getElementById('app-live')?.textContent?.startsWith('Mất kết nối'),
    { timeout: 20000 },
  );
  result.staleAfterMs = Date.now() - tCut; // SC-003: ≤ 15000
  result.duringOutage = await status(page);
  const remaining = offlineS * 1000 - (Date.now() - tCut);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  const tRestore = Date.now();
  execSync(restore, { stdio: 'inherit' });
  restored = true;
  await page.waitForFunction(
    () => document.getElementById('app-live')?.textContent === 'Trực tuyến',
    {
      timeout: 40000,
    },
  );
  result.recoveredAfterMs = Date.now() - tRestore; // SC-003: ≤ 30000
  result.after = await status(page);
  result.pageReloaded = result.after.navigations !== result.before.navigations;
  result.pass =
    result.staleAfterMs <= 15000 &&
    result.recoveredAfterMs <= 30000 &&
    !result.pageReloaded &&
    result.duringOutage.txtLevel === '--';
} catch (e) {
  result.error = String(e);
  result.pass = false;
} finally {
  if (!restored) {
    try {
      execSync(restore, { stdio: 'inherit' });
    } catch {
      /* đã khôi phục hoặc lệnh lỗi: in kết quả */
    }
  }
  await browser.close();
}
const out = opt('--out', '');
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
