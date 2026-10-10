// Mở trang runtime trên Chrome thật, đo thời gian tới khi có dữ liệu sống (SC-004) và kiểm màn
// hình có đổi theo Mock Tag. Dùng: node tools/measure/runtime-smoke.mjs <url> [--seconds 10]
//   [--screenshot file.png] [--out file.json]
// Mã thoát: 0 đạt; 1 không đạt (không lên "Trực tuyến", không đổi, lỗi trang); 2 không chạy được.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
if (!url) {
  console.error(
    'Usage: node tools/measure/runtime-smoke.mjs <url> [--seconds N] [--screenshot f.png] [--out f.json]',
  );
  process.exit(2);
}
const seconds = Number(opt('--seconds', '10'));
const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!executablePath) {
  console.error('Không tìm thấy Chrome; đặt CHROME_PATH.');
  process.exit(2);
}

const browser = await puppeteer.launch({ executablePath, headless: true });
const result = { url, pageErrors: [], consoleWarnings: [] };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  page.on('pageerror', (e) => result.pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'warn' || m.type() === 'error') result.consoleWarnings.push(m.text());
  });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  result.loadMs = Date.now() - t0;
  await page.waitForFunction(
    () => document.getElementById('app-live')?.textContent === 'Trực tuyến',
    { timeout: 15000 },
  );
  result.liveMs = Date.now() - t0; // mở trang → có snapshot đầu tiên (SC-004 ≤ 2000 ms)

  const sample = () =>
    page.evaluate(() => {
      const host = document.getElementById('app-screen');
      const root = host?.shadowRoot;
      const q = (uid) => root?.querySelector(`[data-mat-uid="${uid}"]`);
      return {
        level: q('el_tank_level')?.getAttribute('height'),
        motorFill: q('el_motor_body')?.style.fill,
        txtLevel: q('el_txt_level')?.textContent,
        txtSpeed: q('el_txt_speed')?.textContent,
        txtTemp: q('el_txt_temp')?.textContent,
        fanAnimations: q('el_motor_fan')?.getAnimations().length ?? 0,
        status: document.getElementById('app-live')?.textContent,
      };
    });
  result.samples = [await sample()];
  for (let i = 0; i < seconds; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    result.samples.push(await sample());
  }
  const levels = new Set(result.samples.map((s) => s.level));
  result.levelChanged = levels.size > 1;
  result.textsFilled = result.samples.at(-1).txtLevel !== '--';
  const shot = opt('--screenshot', '');
  if (shot) {
    mkdirSync(dirname(shot), { recursive: true });
    await page.screenshot({ path: shot });
  }
  result.pass =
    result.pageErrors.length === 0 &&
    result.liveMs <= 2000 &&
    result.levelChanged &&
    result.textsFilled;
} catch (e) {
  result.error = String(e);
  result.pass = false;
} finally {
  await browser.close();
}
const out = opt('--out', '');
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
