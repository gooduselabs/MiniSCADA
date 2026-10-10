// Kiểm tự động phần Studio không cần hộp thoại (T088): chạy trên bản release đang mở với
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223'
// Dùng: node tools/measure/studio-smoke.mjs <địa chỉ thiết bị> [--cdp http://127.0.0.1:9223] [--out f.json]
// Kiểm: IPC, chặn đọc file khi chưa mở project, chặn URL không phải http(s), "Kiểm tra kết nối"
// dưới CSP thật (CORS từ http://tauri.localhost), WebSocket live từ origin của Studio, không lỗi CSP.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const device = args.find((a) => !a.startsWith('--') && !/^https?:\/\/127/.test(a));
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
if (!device) {
  console.error(
    'Usage: node tools/measure/studio-smoke.mjs <device host:port> [--cdp url] [--out f.json]',
  );
  process.exit(2);
}
const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });

const browser = await puppeteer.connect({ browserURL: opt('--cdp', 'http://127.0.0.1:9223') });
try {
  const pages = await browser.pages();
  const page = pages.find((p) => p.url().includes('tauri.localhost')) ?? pages[0];
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  check('trang Studio', page.url().startsWith('http://tauri.localhost'), page.url());

  const env = await page.evaluate(() => document.getElementById('env')?.textContent ?? '');
  check('IPC app_info (tab Giới thiệu)', /Tauri/.test(env), env.slice(0, 80));

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
  const read = await ipc('project_read', { rel: 'project.json' });
  check('project_read khi chưa mở project bị từ chối', !read.ok, read.e ?? JSON.stringify(read.v));
  const write = await ipc('project_write', { rel: 'project.json', content: '{}' });
  check('project_write khi chưa mở project bị từ chối', !write.ok, write.e);
  for (const url of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'http://x" & calc']) {
    const r = await ipc('open_device_web', { url });
    check(`open_device_web từ chối ${url}`, !r.ok, r.e);
  }

  // Tab Thiết bị: kiểm kết nối qua giao diện (fetch dưới CSP thật)
  await page.evaluate(() => document.querySelector('[data-tab="device"]').click());
  await page.evaluate((d) => {
    const i = document.getElementById('device-address');
    i.value = d;
    document.getElementById('device-form').requestSubmit();
  }, device);
  await page.waitForFunction(
    () => document.getElementById('device-info')?.textContent?.includes('Runtime'),
    {
      timeout: 15000,
    },
  );
  const info = await page.evaluate(() => document.getElementById('device-info').textContent);
  check('Kiểm tra kết nối thiết bị', /0\.2\.0/.test(info), info.replace(/\s+/g, ' ').slice(0, 120));

  // WebSocket live từ origin của Studio (Origin http://tauri.localhost có trong allowedOrigins)
  const ws = await page.evaluate(
    (d) =>
      new Promise((resolve) => {
        const s = new WebSocket(`ws://${d}/api/v1/live`);
        const t = setTimeout(() => resolve({ ok: false, why: 'timeout' }), 10000);
        s.onmessage = (e) => {
          const m = JSON.parse(e.data);
          if (m.type === 'hello') {
            clearTimeout(t);
            s.close(1000);
            resolve({ ok: true, protocolVersion: m.protocolVersion, project: m.project });
          }
        };
        s.onclose = (e) => resolve({ ok: false, why: `close ${e.code}` });
      }),
    device.replace(/^https?:\/\//, ''),
  );
  check('WebSocket live từ Studio (Origin + CSP)', ws.ok, JSON.stringify(ws));
  check('không lỗi console/CSP', consoleErrors.length === 0, consoleErrors.join(' | '));
} finally {
  browser.disconnect();
}
const result = { device, pass: checks.every((c) => c.pass), checks };
const out = opt('--out', '');
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2));
}
for (const c of checks)
  console.log(`${c.pass ? 'OK  ' : 'FAIL'} ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
console.log(result.pass ? 'STUDIO SMOKE: PASS' : 'STUDIO SMOKE: FAIL');
process.exit(result.pass ? 0 : 1);
