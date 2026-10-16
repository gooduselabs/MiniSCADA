// Kiểm contract HTTP + bảo mật của mat-runtime (contracts/http-api.md, T058/T068/T069, SC-009):
// CSP trang runtime và file project, nosniff, 404 ngoài allowlist, 405 với POST, fixture độc hại
// không có trong gói, Origin lạ bị 403. Tùy chọn --script-svg <path>: mở thẳng SVG có <script>
// trên Chrome và xác nhận script KHÔNG chạy (CSP sandbox).
// Dùng: node tools/measure/http-check.mjs <baseUrl> [--script-svg /project/screens/main.svg] [--out f.json]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:\/\//.test(a))?.replace(/\/$/, '');
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
if (!base) {
  console.error(
    'Usage: node tools/measure/http-check.mjs <baseUrl> [--script-svg path] [--out f.json]',
  );
  process.exit(2);
}
const CSP_RUNTIME =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const CSP_PROJECT = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";

const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });

const page = await fetch(`${base}/`);
check('GET / 200', page.status === 200, page.status);
check('CSP trang runtime', page.headers.get('content-security-policy') === CSP_RUNTIME);
check('nosniff trang runtime', page.headers.get('x-content-type-options') === 'nosniff');
check('index no-cache', page.headers.get('cache-control') === 'no-cache');

const active = await fetch(`${base}/api/v1/projects/active`);
let svgFile = '';
if (active.ok) {
  const j = await active.json();
  svgFile = j.screens[j.project.entryScreen].screen.svgFile;
}
check('GET /api/v1/projects/active 200', active.ok, active.status);
if (svgFile) {
  const svg = await fetch(`${base}/project/${svgFile}`);
  check('SVG project 200', svg.status === 200, svg.status);
  check('CSP file project (sandbox)', svg.headers.get('content-security-policy') === CSP_PROJECT);
  check('SVG content-type', svg.headers.get('content-type') === 'image/svg+xml');
}
for (const p of [
  '/project/project.json',
  '/project/tags.json',
  '/project/../etc/passwd',
  '/project/',
]) {
  const r = await fetch(`${base}${p}`);
  check(`404 ngoài allowlist: ${p}`, r.status === 404, r.status);
}
for (const p of ['/screens/unsafe-elements.svg', '/lab.html', '/screens/index.json']) {
  const r = await fetch(`${base}${p}`);
  check(`không có trong gói: ${p}`, r.status === 404, r.status);
}
const post = await fetch(`${base}/api/v1/system/info`, { method: 'POST' });
check('POST → 405', post.status === 405, post.status);

// Origin lạ: nâng cấp WebSocket bị 403 trước khi lấy slot
const before = await (await fetch(`${base}/api/v1/system/info`)).json();
const ws = await new Promise((resolve) => {
  const req = request(`${base}/api/v1/live`, {
    headers: {
      Origin: 'http://evil.example',
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    },
  });
  req.on('response', (res) => {
    res.resume();
    resolve({ status: res.statusCode });
  });
  req.on('upgrade', (_res, socket) => {
    socket.destroy();
    resolve({ status: 101 });
  });
  req.on('error', (e) => resolve({ status: String(e) }));
  req.end();
});
const after = await (await fetch(`${base}/api/v1/system/info`)).json();
check('Origin lạ → 403', ws.status === 403, ws.status);
check(
  'Origin lạ không tốn slot, có đếm',
  after.clients === before.clients && after.originRejectedTotal === before.originRejectedTotal + 1,
  `${before.originRejectedTotal}→${after.originRejectedTotal}`,
);

const scriptSvg = opt('--script-svg', '');
if (scriptSvg) {
  const executablePath = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].find((p) => p && existsSync(p));
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const p = await browser.newPage();
    await p.goto(`${base}${scriptSvg}`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 500));
    const pwned = await p.evaluate(() => globalThis.__pwned ?? null).catch(() => null);
    check('SVG có <script>/onload mở thẳng: script không chạy', pwned === null, String(pwned));
    const rt = await browser.newPage();
    await rt.goto(`${base}/`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1500));
    const rtPwned = await rt.evaluate(() => globalThis.__pwned ?? null);
    const scripts = await rt.evaluate(
      () =>
        document.getElementById('app-screen')?.shadowRoot?.querySelectorAll('script').length ?? -1,
    );
    check(
      'trang runtime: script trong SVG bị lọc',
      rtPwned === null && scripts === 0,
      `${rtPwned} ${scripts}`,
    );
  } finally {
    await browser.close();
  }
}

const result = { base, pass: checks.every((c) => c.pass), checks };
const out = opt('--out', '');
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2));
}
for (const c of checks)
  console.log(`${c.pass ? 'OK  ' : 'FAIL'} ${c.name}${c.detail !== '' ? ` (${c.detail})` : ''}`);
console.log(result.pass ? 'HTTP CHECK: PASS' : 'HTTP CHECK: FAIL');
process.exit(result.pass ? 0 : 1);
