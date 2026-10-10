// Đo thời gian hiển thị SVG trên Chrome thật (SC-005) qua trang thử apps/runtime-web (?auto=1).
// Dùng: node tools/measure/svg-load.mjs <baseUrl> [--runs 3] [--out docs/reports/svg-load.json] [--timeout 300]
// Chrome lấy từ biến CHROME_PATH hoặc đường dẫn cài đặt mặc định của Windows/Linux/macOS.
// Mã thoát: 0 = mọi file đạt; 1 = có file lỗi/không đạt/script lọt; 2 = không chạy được phép đo.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:\/\//.test(a));
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
if (!base) {
  console.error(
    'Usage: node tools/measure/svg-load.mjs <baseUrl> [--runs N] [--out file.json] [--timeout giây]',
  );
  process.exit(2);
}
const runs = Number(opt('--runs', '3'));
const out = opt('--out', '');
const timeoutMs = Number(opt('--timeout', '300')) * 1000;

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('Không tìm thấy Chrome; đặt CHROME_PATH.');
  process.exit(2);
}

const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  const pageErrors = [];
  const firstPageError = new Promise((resolve) =>
    page.on('pageerror', (e) => {
      pageErrors.push(String(e));
      resolve('pageerror');
    }),
  );
  const url = new URL(base);
  url.searchParams.set('auto', '1');
  url.searchParams.set('runs', String(runs));
  await page.goto(url.href, { waitUntil: 'load' });
  // Dừng sớm khi trang báo lỗi (data-done="error") hoặc có lỗi JavaScript, không chờ hết thời gian.
  const outcome = await Promise.race([
    page.waitForSelector('body[data-done]', { timeout: timeoutMs }).then(() => 'done'),
    firstPageError,
  ]);
  const done = await page.evaluate(() => document.body.dataset.done ?? null);
  if (outcome !== 'done' || done !== '1') {
    const note = await page.evaluate(() => document.getElementById('app-stage-note')?.textContent);
    console.error(`Phép đo không hoàn tất (data-done=${done}). ${note ?? ''}`);
    if (pageErrors.length) console.error('Lỗi trang:', pageErrors);
    process.exitCode = 2;
  } else {
    const report = await page.evaluate(() => ({
      ...window.__svgLoadReport,
      pwned: window.__svgPwned ?? null, // phải null: bộ lọc đã chặn script trong unsafe-elements.svg
      live: document.getElementById('app-live').textContent,
    }));
    report.measuredAt = new Date().toISOString();
    report.baseUrl = base;
    report.runs = runs;
    report.browserVersion = await browser.version();
    report.pageErrors = pageErrors;

    console.log(`${report.browserVersion} | ${base} | ${runs} lần/tệp | ${report.live}`);
    console.log(
      'tệp'.padEnd(34),
      'KB'.padStart(8),
      'truyền KB'.padStart(10),
      'median ms'.padStart(10),
      'max ms'.padStart(8),
      'phần tử'.padStart(8),
      ' kết luận · nguồn · cảnh báo định dạng',
    );
    for (const r of report.results) {
      console.log(
        r.name.padEnd(34),
        (r.bytes / 1024).toFixed(1).padStart(8),
        (r.transferBytes / 1024).toFixed(1).padStart(10),
        String(r.medianTotalMs).padStart(10),
        String(r.maxTotalMs).padStart(8),
        String(r.elements).padStart(8),
        r.error
          ? ` LỖI ${r.error}`
          : `${r.pass ? ' đạt' : ' KHÔNG ĐẠT'} · ${r.generator} · ${r.warnings.length}`,
      );
    }
    console.log(
      report.pwned === null
        ? 'Bộ lọc: script trong unsafe-elements.svg không chạy ✓'
        : `CẢNH BÁO: script đã chạy (${report.pwned})`,
    );
    if (pageErrors.length) console.log('Lỗi trang:', pageErrors);

    if (out) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(report, null, 2));
      console.log('Đã ghi', out);
    }
    const failed = report.results.filter((r) => r.error || !r.pass).length;
    const empty = report.results.length === 0;
    process.exitCode = failed || empty || pageErrors.length || report.pwned !== null ? 1 : 0;
  }
} finally {
  await browser.close();
}
