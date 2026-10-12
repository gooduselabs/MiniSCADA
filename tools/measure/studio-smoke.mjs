// Kiểm Studio thật (WebView2 + Rust) cho khung mới (feature 004, T080, SC-004, SC-007, research R15).
// Dùng:
//   node tools/measure/studio-smoke.mjs --exe "<đường dẫn mAT Studio.exe>" [--device <host:port>] [--out f.json]
//   node tools/measure/studio-smoke.mjs [--cdp http://127.0.0.1:9223] [--device <host:port>] [--out f.json]
// --exe: script tự chạy Studio với cổng debug của WebView2 và đo thời gian mở tới tab Bắt đầu. Không có
// --exe thì gắn vào Studio đang chạy (đã đặt WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS) và đo bằng tải lại.
// Kiểm: IPC, chặn đọc/ghi khi chưa mở project, chặn URL không phải http(s); khung đủ vùng; F5, Ctrl+P bị
// chặn; mở tank-demo từ danh sách gần đây (thời gian tới cây đầy đủ); nếu có --device: theo dõi chỉ đọc,
// ngắt thì thiết bị báo số phiên giảm trong ≤ 2 s. Không ghi gì xuống thiết bị.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const exe = opt('--exe', '');
const device = opt('--device', '');
const port = Number(opt('--port', '9223'));
const cdp = opt('--cdp', `http://127.0.0.1:${port}`);
const checks = [];
const metrics = {};
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForCdp(timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${cdp}/json/version`);
      if (r.ok) return true;
    } catch {
      /* chưa mở cổng */
    }
    await sleep(50);
  }
  return false;
}

async function studioPage(browser, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const page = (await browser.pages()).find((p) => p.url().includes('tauri.localhost'));
    if (page) return page;
    await sleep(50);
  }
  throw new Error('không thấy trang của Studio (tauri.localhost)');
}

async function systemInfo(base) {
  const r = await fetch(`http://${base}/api/v1/system/info`, { signal: AbortSignal.timeout(3000) });
  return r.json();
}

let child = null;
const t0 = Date.now();
if (exe) {
  child = spawn(exe, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    detached: false,
    stdio: 'ignore',
  });
  if (!(await waitForCdp(20000))) throw new Error('WebView2 không mở cổng debug');
}
const browser = await puppeteer.connect({ browserURL: cdp, defaultViewport: null });
try {
  const page = await studioPage(browser, 20000);
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  // 1. Thời gian mở tới tab Bắt đầu (SC-004 ≤ 3 s)
  if (exe) {
    await page.waitForSelector('mat-start-page .start-hero', { timeout: 20000 });
    metrics.startToStartTabMs = Date.now() - t0;
    check(
      'mở Studio tới tab Bắt đầu ≤ 3 s (SC-004)',
      metrics.startToStartTabMs <= 3000,
      `${metrics.startToStartTabMs} ms`,
    );
  } else {
    const r0 = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('mat-start-page .start-hero', { timeout: 20000 });
    metrics.reloadToStartTabMs = Date.now() - r0;
    check(
      'tải lại tới tab Bắt đầu (gắn vào Studio đang chạy, không đo khởi động)',
      true,
      `${metrics.reloadToStartTabMs} ms`,
    );
  }
  check('trang Studio', page.url().startsWith('http://tauri.localhost'), page.url());

  // 2. IPC và quyền tối thiểu (chưa mở project)
  const ipc = (cmd, a) =>
    page.evaluate(
      (c, x) =>
        window.__TAURI_INTERNALS__
          .invoke(c, x)
          .then((v) => ({ ok: true, v }))
          .catch((e) => ({ ok: false, e: String(e) })),
      cmd,
      a,
    );
  const info = await ipc('app_info', {});
  check(
    'IPC app_info',
    info.ok && /Studio/.test(info.v?.name ?? ''),
    JSON.stringify(info.v ?? info.e),
  );
  const read = await ipc('project_read', { rel: 'project.json' });
  check('project_read khi chưa mở project bị từ chối', !read.ok, read.e ?? 'đọc được');
  const write = await ipc('project_write', {
    rel: 'project.json',
    content: '{}',
    expectedHash: null,
    force: false,
  });
  check('project_write khi chưa mở project bị từ chối', !write.ok, write.e ?? 'ghi được');
  for (const url of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'http://x" & calc']) {
    const r = await ipc('open_device_web', { url });
    check(`open_device_web từ chối ${url}`, !r.ok, r.e);
  }

  // 3. Khung đủ vùng
  for (const [name, sel] of [
    ['menu', '[role="menubar"]'],
    ['thanh công cụ', 'mat-toolbar[role="toolbar"]'],
    ['cây project', 'mat-tree'],
    ['tab editor', 'mat-tabs[role="tablist"]'],
    ['inspector', 'mat-inspector'],
    ['task card', 'mat-taskcards'],
    ['thanh trạng thái', 'mat-statusbar'],
  ])
    check(`khung có ${name}`, (await page.$(sel)) !== null);

  // 4. F5, Ctrl+P bị chặn trong WebView2 (research R15)
  await page.evaluate(() => {
    window.__smokeMarker = 1;
    window.__lastPrevented = {};
    window.addEventListener('keydown', (e) => (window.__lastPrevented[e.key] = e.defaultPrevented));
  });
  await page.focus('mat-tree');
  await page.keyboard.press('F5');
  await sleep(500);
  const afterF5 = await page.evaluate(() => ({
    marker: window.__smokeMarker,
    prevented: window.__lastPrevented?.F5,
  }));
  check(
    'F5 không tải lại trang',
    afterF5.marker === 1 && afterF5.prevented === true,
    JSON.stringify(afterF5),
  );
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyP');
  await page.keyboard.up('Control');
  const printPrevented = await page.evaluate(() => window.__lastPrevented?.p);
  check('Ctrl+P (in) bị chặn', printPrevented === true, String(printPrevented));

  // 5. Mở tank-demo từ danh sách gần đây (SC-004 ≤ 2 s tới cây đầy đủ)
  const recent = await ipc('project_recent', {});
  const entry = recent.ok
    ? recent.v.find((r) => r.exists && /tank-demo[\\/]?$/i.test(r.display))
    : null;
  if (!entry) {
    check(
      'mở tank-demo từ danh sách gần đây',
      false,
      'mở projects/tank-demo bằng tay một lần rồi chạy lại',
    );
  } else {
    const o0 = Date.now();
    await page.evaluate((name) => {
      const b = [...document.querySelectorAll('mat-start-page .li-open')].find(
        (x) => x.querySelector('span')?.textContent === name,
      );
      b?.click();
    }, entry.name);
    await page.waitForFunction(
      () => document.querySelectorAll('mat-tree [role="treeitem"]').length > 10,
      { timeout: 10000 },
    );
    metrics.openProjectMs = Date.now() - o0;
    check(
      'mở project mẫu tới cây đầy đủ ≤ 2 s (SC-004)',
      metrics.openProjectMs <= 2000,
      `${metrics.openProjectMs} ms`,
    );
  }

  // 6. Theo dõi thiết bị chỉ đọc (nếu có --device); ngắt thì thiết bị giảm số phiên ≤ 2 s (SC-007)
  if (device) {
    const before = await systemInfo(device);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Control');
    // Chưa nhập địa chỉ: Ctrl+K mở trang Thiết bị; nhập địa chỉ rồi kết nối.
    await sleep(300);
    const needsAddress = await page.evaluate(() => !document.querySelector('.win.online'));
    if (needsAddress) {
      const input = await page.$('#editor-panel input');
      if (input) {
        await input.click({ clickCount: 3 });
        await input.type(device);
        await page.keyboard.press('Enter');
      }
      await page.evaluate(() =>
        [...document.querySelectorAll('#editor-panel button')]
          .find((b) => /Kết nối theo dõi/.test(b.textContent))
          ?.click(),
      );
    }
    const c0 = Date.now();
    await page.waitForFunction(
      () => document.querySelector('mat-statusbar')?.textContent?.includes('Đang theo dõi'),
      { timeout: 10000 },
    );
    metrics.connectMs = Date.now() - c0;
    check(
      'kết nối theo dõi: thanh trạng thái "Đang theo dõi", viền cam',
      (await page.$('.win.online')) !== null,
      `${metrics.connectMs} ms`,
    );
    const during = await systemInfo(device);
    check(
      'theo dõi chiếm đúng 1 phiên',
      during.clients === before.clients + 1,
      `${before.clients} → ${during.clients}`,
    );
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyM');
    await page.keyboard.up('Control');
    const d0 = Date.now();
    let after = during;
    while (Date.now() - d0 < 5000) {
      after = await systemInfo(device);
      if (after.clients < during.clients) break;
      await sleep(100);
    }
    metrics.releaseMs = Date.now() - d0;
    check(
      'ngắt: thiết bị giảm số phiên ≤ 2 s (SC-007)',
      after.clients < during.clients && metrics.releaseMs <= 2000,
      `${metrics.releaseMs} ms`,
    );
  }

  check('không lỗi console/CSP', consoleErrors.length === 0, consoleErrors.join(' | '));
} finally {
  browser.disconnect();
  if (child) child.kill();
}
const result = {
  at: new Date().toISOString(),
  device: device || null,
  mode: exe ? 'exe' : 'attach',
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
console.log(result.pass ? 'STUDIO SMOKE: PASS' : 'STUDIO SMOKE: FAIL');
process.exit(result.pass ? 0 : 1);
