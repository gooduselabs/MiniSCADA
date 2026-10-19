// Spike R2 (feature 012, T037): build trang mẫu, đo gzip (mức 9, như apps/runtime-web/scripts/package-web.mjs) từng chunk,
// quét mẫu cấm của cổng nội dung bản thiết bị (eval, new Function, innerHTML), rồi đo trên Chrome thật:
//  - nạp chunk ECharts và vẽ 12 widget (trung vị 5 lần, renderer SVG và Canvas);
//  - CPU khi cập nhật 1 Hz × 10 tab trong 30 s (TaskDuration của DevTools / thời gian thực).
// Dùng: node tools/spikes/charts-r2/run.mjs [--out <thư mục build>] [--no-browser]
// Chrome lấy từ CHROME_PATH hoặc đường dẫn cài đặt mặc định.
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const here = import.meta.dirname;
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = resolve(outIdx >= 0 ? args[outIdx + 1] : join(tmpdir(), 'mat-charts-r2'));
process.env.MAT_R2_OUT = out;
await build({ configFile: join(here, 'vite.config.mjs') });

const gz = (f) => gzipSync(readFileSync(f), { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const assets = readdirSync(join(out, 'assets')).filter((f) => /\.(js|css)$/.test(f));
const index = readFileSync(join(out, 'index.html'), 'utf8');
console.log('Chunk (gzip mức 9):');
const sizes = {};
for (const f of assets.sort()) {
  const p = join(out, 'assets', f);
  sizes[f] = { raw: statSync(p).size, gzip: gz(p), startup: index.includes(f) };
  console.log(
    `  ${f.padEnd(36)} ${kb(sizes[f].raw).padStart(10)} ${kb(sizes[f].gzip).padStart(10)}  ${sizes[f].startup ? 'khởi động' : 'tải lười'}`,
  );
}
const ec = assets.find((f) => /^echarts-lite-/.test(f));
if (!ec) throw new Error('không thấy chunk echarts-lite');
const ecSrc = readFileSync(join(out, 'assets', ec), 'utf8');
const BANNED = [
  [/\beval\s*\(/g, 'eval('],
  [/\bnew\s+Function\b/g, 'new Function'],
  [/\.innerHTML\b/g, 'innerHTML'],
];
console.log(`ECharts lite: ${kb(sizes[ec].gzip)} gzip (mục tiêu ≤ 350 KB)`);
for (const [re, name] of BANNED) {
  const hits = [...ecSrc.matchAll(re)].map((m) =>
    ecSrc.slice(Math.max(0, m.index - 60), m.index + 40).replace(/\s+/g, ' '),
  );
  console.log(`  ${name}: ${hits.length} chỗ`);
  for (const h of hits) console.log(`    …${h}…`);
}

if (args.includes('--no-browser')) process.exit(0);

const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
  .filter(Boolean)
  .find((p) => existsSync(p));
if (!executablePath) {
  console.error('Không tìm thấy Chrome; đặt CHROME_PATH.');
  process.exit(2);
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = join(out, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!path.startsWith(out) || !existsSync(path) || statSync(path).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;
const { default: puppeteer } = await import('puppeteer-core');
const browser = await puppeteer.launch({ executablePath, headless: true });
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
try {
  console.log(`Chrome ${await browser.version()}`);
  for (const renderer of ['svg', 'canvas']) {
    const load = [];
    const draw = [];
    for (let i = 0; i < 5; i++) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1600, height: 900 });
      await page.setCacheEnabled(false);
      await page.goto(`${base}?renderer=${renderer}`, { waitUntil: 'load' });
      await page.waitForSelector('body[data-done]', { timeout: 30000 });
      const r = await page.evaluate(() => globalThis.__r2);
      load.push(r.loadMs);
      draw.push(r.drawMs);
      await page.close();
    }
    console.log(
      `  ${renderer}: nạp chunk trung vị ${median(load)} ms, vẽ 12 widget trung vị ${median(draw)} ms (5 lần)`,
    );
  }
  // CPU: 10 tab cập nhật 1 Hz trong 30 s.
  const SECONDS = 30;
  const pages = [];
  for (let i = 0; i < 10; i++) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900 });
    await page.goto(`${base}?renderer=svg&live=1`, { waitUntil: 'load' });
    await page.waitForSelector('body[data-done]');
    pages.push(page);
  }
  const before = await Promise.all(pages.map((p) => p.metrics()));
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  const after = await Promise.all(pages.map((p) => p.metrics()));
  const busy = after.map((m, i) => m.TaskDuration - before[i].TaskDuration);
  const pct = busy.map((b) => (100 * b) / SECONDS);
  console.log(
    `  CPU 1 Hz × 10 tab, ${SECONDS} s: mỗi tab trung vị ${median(pct).toFixed(1)} %, lớn nhất ${Math.max(...pct).toFixed(1)} % một lõi; tổng ${pct.reduce((a, b) => a + b, 0).toFixed(1)} %`,
  );
} finally {
  await browser.close();
  server.close();
}
