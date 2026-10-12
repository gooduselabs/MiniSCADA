// Chạy test giao diện Studio trên Chrome headless (feature 004, T042, research R14): phục vụ bản build
// chế độ `e2e` (lớp Tauri giả, project mẫu trong bộ nhớ), chạy từng file *.e2e.mjs, kiểm trợ năng bằng
// axe-core. Dùng: `npm run e2e -w @mat/studio` (build rồi chạy), hoặc
//   node tests/e2e/run.mjs [lọc tên file] [--headful] [--keep]
// Biến môi trường: CHROME_PATH (đường dẫn Chrome/Edge), MAT_E2E_OUT (thư mục build, mặc định dist-e2e).
// Ảnh chụp màn hình ghi vào tests/e2e/out/.
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const dist = resolve(root, process.env.MAT_E2E_OUT || 'dist-e2e');
const outDir = join(here, 'out');
const args = process.argv.slice(2);
const filter = args.find((a) => !a.startsWith('--'));
const headful = args.includes('--headful');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Không tìm thấy Chrome/Edge: đặt CHROME_PATH');
  return found;
}

/** Máy chủ tĩnh cho bản build e2e (chỉ đọc trong thư mục build). */
function serve() {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(dist, path === '/' ? 'index.html' : path));
    if (!file.startsWith(dist) || !existsSync(file)) file = join(dist, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`Chưa có bản build e2e ở ${dist}: chạy "npm run build:e2e -w @mat/studio" trước`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: !headful,
  args: ['--no-first-run', '--no-default-browser-check', '--lang=vi-VN', '--window-size=1400,900'],
  defaultViewport: { width: 1400, height: 860 },
});

const files = readdirSync(here)
  .filter((f) => f.endsWith('.e2e.mjs'))
  .filter((f) => !filter || f.includes(filter))
  .sort();
let failed = 0;
let passed = 0;
for (const file of files) {
  const mod = await import(new URL(file, import.meta.url));
  // Mỗi file một ngữ cảnh riêng: localStorage (theme, bố cục) của file trước không ảnh hưởng file sau.
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  const results = [];
  const ctx = {
    page,
    url,
    browser,
    check(name, pass, detail = '') {
      results.push({ name, pass: Boolean(pass), detail: String(detail) });
    },
    async shot(name) {
      await page.screenshot({ path: join(outDir, `${file.replace('.e2e.mjs', '')}-${name}.png`) });
    },
    /** axe-core trên trang hiện tại; trả các vi phạm mức critical/serious. */
    async axe(label) {
      if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: axePath });
      const r = await page.evaluate(async () => {
        const res = await window.axe.run(document, { resultTypes: ['violations'] });
        return res.violations
          .filter((v) => v.impact === 'critical' || v.impact === 'serious')
          .map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
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
    // Kịch bản có `export const gate = true` thấy hộp thoại Nâng cấp; các kịch bản khác chạy với cổng phiên bản tắt (`?gate=off`).
    await page.goto(mod.gate === true ? url : `${url}?gate=off`, { waitUntil: 'networkidle0' });
    await mod.default(ctx);
  } catch (e) {
    results.push({ name: 'chạy hết kịch bản', pass: false, detail: e?.stack ?? String(e) });
    await ctx.shot('loi').catch(() => undefined);
  }
  results.push({
    name: 'không có lỗi console',
    pass: consoleErrors.length === 0,
    detail: consoleErrors.slice(0, 5).join(' | '),
  });
  for (const r of results) {
    console.log(`  ${r.pass ? '✔' : '✘'} ${r.name}${r.detail && !r.pass ? ` — ${r.detail}` : ''}`);
    if (r.pass) passed++;
    else failed++;
  }
  await context.close();
}
await browser.close();
server.close();
console.log(`\n${passed} đạt, ${failed} không đạt`);
process.exit(failed ? 1 : 0);
