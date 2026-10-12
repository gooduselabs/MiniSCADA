// Nghiệm thu theo dõi thiết bị từ Studio thật (feature 004, T075, SC-007, quickstart §4 bước 14, 16).
// Chỉ đọc: Studio kết nối theo dõi (Ctrl+K) qua giao diện live 1.0.0 và system/info, không ghi gì xuống
// thiết bị. So thời điểm giá trị cập nhật trong Bảng Tag của Studio với một client live trực tiếp
// (vai trò trang runtime trên Chrome), và kiểm thiết bị trả phiên trong ≤ 2 s sau Ctrl+M.
// Dùng:
//   node tools/measure/studio-monitor-check.mjs --exe "<mat-studio.exe>" --device <host:port>
//        [--seconds 60] [--out docs/reports/004-bl335-monitor.json]
// Studio phải có sẵn tank-demo trong "Mở gần đây" và địa chỉ thiết bị đã nhập (trang Thiết bị).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';
import { LiveConnection } from '../../packages/live-client/src/connection.ts';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const exe = opt('--exe', '');
const device = opt('--device', '');
const seconds = Number(opt('--seconds', '60'));
const port = Number(opt('--port', '9225'));
const TAG = opt('--tag', 'TANK01.LEVEL');
if (!exe || !device) {
  console.error(
    'Usage: node tools/measure/studio-monitor-check.mjs --exe <mat-studio.exe> --device <host:port>',
  );
  process.exit(2);
}
const checks = [];
const metrics = {};
const check = (name, pass, detail = '') =>
  checks.push({ name, pass: Boolean(pass), detail: String(detail) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const info = async () =>
  (
    await fetch(`http://${device}/api/v1/system/info`, { signal: AbortSignal.timeout(3000) })
  ).json();
const num = (text) => {
  const m = /-?\d+(?:[.,]\d+)?/.exec(String(text).replace(/\s/g, ''));
  return m ? Number(m[0].replace(',', '.')) : NaN;
};

// Client tham chiếu: nhận delta trực tiếp từ thiết bị như trang runtime trên Chrome.
const refEvents = [];
const ref = new LiveConnection({
  url: `ws://${device}/api/v1/live`,
  tags: [TAG],
  createSocket: (url) => new WebSocket(url),
});
ref.onChange = (changes) => {
  const t = Date.now();
  for (const c of changes)
    if (c.id === TAG && typeof c.value === 'number') refEvents.push({ v: c.value, t });
};

const before = await info();
check(
  'thiết bị trả lời system/info',
  before.runtimeVersion,
  `runtime ${before.runtimeVersion}, ${before.clients} phiên`,
);

const child = spawn(exe, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  stdio: 'ignore',
});
let browser;
try {
  for (let i = 0; i < 400; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch {
      /* chưa mở cổng */
    }
    await sleep(50);
  }
  browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: null,
  });
  let page;
  for (let i = 0; i < 200 && !page; i++) {
    page = (await browser.pages()).find((p) => p.url().includes('tauri.localhost'));
    if (!page) await sleep(100);
  }
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('mat-start-page .li-open');
  await page.$eval('mat-start-page .li-open', (b) => b.click());
  await page.waitForFunction(
    () => document.querySelectorAll('mat-tree [role="treeitem"]').length > 10,
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-tree [role="treeitem"]')]
      .find((e) => e.querySelector('.lbl')?.textContent.trim() === 'Bảng Tag mặc định')
      ?.click(),
  );
  await page.waitForSelector('mat-tag-grid table');

  ref.start();
  await sleep(1500);
  const withRef = await info();

  // Ctrl+K: kết nối theo dõi bằng địa chỉ đã nhập.
  const c0 = Date.now();
  await page.focus('mat-tag-grid table');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Control');
  await page.waitForFunction(
    () => document.querySelector('mat-statusbar')?.textContent?.includes('Đang theo dõi'),
    { timeout: 15000 },
  );
  metrics.connectMs = Date.now() - c0;
  check(
    'Ctrl+K: thanh trạng thái "Đang theo dõi", khung viền cam',
    (await page.$('.win.online')) !== null,
    `${metrics.connectMs} ms`,
  );
  await sleep(1500);
  const during = await info();
  check(
    'Studio chiếm đúng 1 phiên',
    during.clients === withRef.clients + 1,
    `${withRef.clients} → ${during.clients}`,
  );

  // Ghi thời điểm ô giá trị sống của TAG đổi trong lưới.
  await page.evaluate((tag) => {
    window.__live = [];
    const cell = () => {
      const row = [...document.querySelectorAll('mat-tag-grid tbody tr')].find(
        (tr) => tr.querySelector('td[data-c="id"]')?.textContent.trim() === tag,
      );
      return row?.querySelector('td[data-c="value"]');
    };
    const target = cell();
    if (!target) return;
    new MutationObserver(() =>
      window.__live.push({ text: cell()?.textContent ?? '', t: Date.now() }),
    ).observe(target.closest('tbody'), { subtree: true, characterData: true, childList: true });
  }, TAG);
  const grid = await page.evaluate(() => {
    const head = [...document.querySelectorAll('mat-tag-grid thead th')].map((th) => th.dataset.c);
    const rows = [...document.querySelectorAll('mat-tag-grid tbody tr')].map((tr) => ({
      id: tr.querySelector('td[data-c="id"]')?.textContent.trim(),
      value: tr.querySelector('td[data-c="value"]')?.textContent.trim(),
      quality: tr.querySelector('td[data-c="quality"]')?.textContent.trim(),
    }));
    return { head, rows };
  });
  // Cột đầu là số thứ tự (không có data-c); sau đó phải là Tên, Giá trị sống, Quality.
  const cols = grid.head.filter(Boolean);
  check(
    'cột giá trị sống và quality ngay sau cột Tên',
    cols[0] === 'id' && cols[1] === 'value' && cols[2] === 'quality',
    cols.join(','),
  );
  // tank-demo cố ý cho TANK01.TEMP chập chờn (BAD 5 s mỗi 20 s): chỉ đòi mọi Tag có giá trị và quality
  // hợp lệ, không đòi GOOD.
  check(
    'mọi Tag có giá trị sống và quality (GOOD/BAD/UNCERTAIN)',
    grid.rows.every((r) => r.value && /^(GOOD|BAD|UNCERTAIN)$/.test(r.quality ?? '')),
    JSON.stringify(grid.rows),
  );

  await sleep(seconds * 1000);
  const studioEvents = (await page.evaluate(() => window.__live)).map((e) => ({
    v: num(e.text),
    t: e.t,
  }));
  // Cặp sự kiện: mỗi lần Studio đổi giá trị, tìm lần client tham chiếu nhận cùng giá trị (làm tròn 1 chữ
  // số sau dấu phẩy) gần nhất về thời gian.
  const lags = [];
  for (const s of studioEvents) {
    if (!Number.isFinite(s.v)) continue;
    const same = refEvents.filter((r) => Math.abs(Math.round(r.v * 10) / 10 - s.v) < 0.051);
    if (!same.length) continue;
    const best = same.reduce((a, b) => (Math.abs(b.t - s.t) < Math.abs(a.t - s.t) ? b : a));
    lags.push(s.t - best.t);
  }
  lags.sort((a, b) => a - b);
  metrics.samples = lags.length;
  metrics.studioUpdates = studioEvents.length;
  metrics.refUpdates = refEvents.length;
  if (lags.length) {
    metrics.lagMs = {
      median: lags[Math.floor(lags.length / 2)],
      p95: lags[Math.floor(lags.length * 0.95)],
      max: lags.at(-1),
      min: lags[0],
    };
  }
  check(
    'giá trị trong Bảng Tag lệch so với client trực tiếp ≤ 1 s (SC-007)',
    lags.length >= 10 && metrics.lagMs.p95 <= 1000,
    JSON.stringify(metrics.lagMs ?? null),
  );

  await page.evaluate(() =>
    [...document.querySelectorAll('mat-inspector [role="tab"]')]
      .find((b) => b.textContent.includes('Chẩn đoán'))
      ?.click(),
  );
  await sleep(500);
  const diag = await page.$eval('mat-inspector .insp-body', (e) =>
    e.textContent.replace(/\s+/g, ' ').trim(),
  );
  check(
    'tab Chẩn đoán hiện runtime và số phiên',
    /0\.3\.0|0\.4\.0/.test(diag) && /\d+\s*\/\s*10/.test(diag),
    diag.slice(0, 200),
  );
  mkdirSync('apps/studio/tests/e2e/out', { recursive: true });
  await page.screenshot({ path: 'apps/studio/tests/e2e/out/real-3-bl335-theo-doi.png' });

  // Ctrl+M: thiết bị phải giảm số phiên trong ≤ 2 s.
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyM');
  await page.keyboard.up('Control');
  const d0 = Date.now();
  let after = during;
  while (Date.now() - d0 < 5000) {
    after = await info();
    if (after.clients < during.clients) break;
    await sleep(100);
  }
  metrics.releaseMs = Date.now() - d0;
  check(
    'Ctrl+M: thiết bị giảm số phiên ≤ 2 s (SC-007)',
    after.clients < during.clients && metrics.releaseMs <= 2000,
    `${metrics.releaseMs} ms`,
  );
  check('không lỗi console', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  ref.stop();
  browser?.disconnect();
  child.kill();
}
await sleep(1500);
const end = await info();
check(
  'sau khi đóng: số phiên về như ban đầu',
  end.clients === before.clients,
  `${before.clients} → ${end.clients}`,
);
const result = {
  at: new Date().toISOString(),
  device,
  tag: TAG,
  seconds,
  metrics,
  pass: checks.every((c) => c.pass),
  checks,
};
const out = opt('--out', '');
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2));
}
for (const c of checks)
  console.log(`${c.pass ? 'OK  ' : 'FAIL'} ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
console.log(JSON.stringify(metrics));
console.log(result.pass ? 'MONITOR CHECK: PASS' : 'MONITOR CHECK: FAIL');
process.exit(result.pass ? 0 : 1);
