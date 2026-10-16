/* global window, document */
// Chạy e2e của trang vận hành trên Chrome headless (feature 007, T040, T074): mỗi kịch bản `*.e2e.mjs` có runtime giả
// riêng (fake-runtime.mjs) phục vụ bản build `dist-e2e`, một ngữ cảnh trình duyệt riêng, axe-core cho trợ năng.
// Dùng: `npm run e2e -w @mat/runtime-web` (build rồi chạy) hoặc `node tests/e2e/run.mjs [lọc tên] [--headful]`.
// Biến môi trường: CHROME_PATH (Chrome/Edge). Ảnh chụp ghi vào tests/e2e/out/.
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { startFakeRuntime } from './fake-runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const dist = resolve(root, process.env.MAT_E2E_OUT || 'dist-e2e');
const outDir = join(here, 'out');
const args = process.argv.slice(2);
const filter = args.find((a) => !a.startsWith('--'));
const headful = args.includes('--headful');

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Không tìm thấy Chrome/Edge: đặt CHROME_PATH');
  return found;
}

if (!existsSync(join(dist, 'index.html'))) {
  console.error(
    `Chưa có bản build e2e ở ${dist}: chạy "vite build --mode e2e -w @mat/runtime-web" trước`,
  );
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: !headful,
  args: [
    '--no-first-run',
    '--no-default-browser-check',
    '--lang=vi-VN',
    '--ignore-certificate-errors',
  ],
  defaultViewport: { width: 1366, height: 768 },
});

const files = readdirSync(here)
  .filter((f) => f.endsWith('.e2e.mjs'))
  .filter((f) => !filter || f.includes(filter))
  .sort();
let failed = 0;
let passed = 0;
for (const file of files) {
  const mod = await import(new URL(file, import.meta.url));
  const rt = await startFakeRuntime({ staticDir: dist, ...(mod.options ?? {}) });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  const results = [];
  const ctx = {
    page,
    rt,
    browser,
    context,
    /** Địa chỉ trang qua HTTP và HTTPS (null nếu máy không có openssl). */
    url: rt.httpUrl,
    httpsUrl: rt.httpsUrl,
    /** Lỗi console được kỳ vọng (vd. 401/403 của yêu cầu bị từ chối): bỏ khỏi kiểm "không có lỗi console". */
    allowConsole: [],
    consoleErrors,
    check(name, pass, detail = '') {
      results.push({ name, pass: Boolean(pass), detail: String(detail) });
    },
    async shot(name) {
      await page.screenshot({ path: join(outDir, `${file.replace('.e2e.mjs', '')}-${name}.png`) });
    },
    /** axe-core trên trang hiện tại; chỉ tính critical/serious. */
    async axe(label) {
      if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: axePath });
      const r = await page.evaluate(async () => {
        const res = await window.axe.run(document, { resultTypes: ['violations'] });
        return res.violations
          .filter((v) => v.impact === 'critical' || v.impact === 'serious')
          .map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
          }));
      });
      results.push({
        name: `axe: 0 vi phạm critical/serious (${label})`,
        pass: r.length === 0,
        detail: r.map((v) => `${v.id} [${v.impact}] ${v.nodes.join(' | ')}`).join('; '),
      });
      return r;
    },
  };
  console.log(`\n▶ ${file}`);
  try {
    await mod.default(ctx);
  } catch (e) {
    results.push({ name: 'chạy hết kịch bản', pass: false, detail: e?.stack ?? String(e) });
    await ctx.shot('loi').catch(() => undefined);
  }
  const bad = consoleErrors.filter((c) => !ctx.allowConsole.some((a) => c.includes(a)));
  results.push({
    name: 'không có lỗi console',
    pass: bad.length === 0,
    detail: bad.slice(0, 5).join(' | '),
  });
  for (const r of results) {
    console.log(`  ${r.pass ? '✔' : '✘'} ${r.name}${r.detail && !r.pass ? ` — ${r.detail}` : ''}`);
    if (r.pass) passed++;
    else failed++;
  }
  await context.close();
  await rt.close();
}
await browser.close();
console.log(`\n${passed} đạt, ${failed} không đạt`);
process.exit(failed ? 1 : 0);
