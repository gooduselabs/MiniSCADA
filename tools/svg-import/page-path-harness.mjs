// Harness đường trang (feature 008, T112, FR-064): đưa SVG GỐC (không qua bộ nhập) vào mountScreen trong Chrome, giống
// gói bị sửa tay hoặc project cũ (D30: runtime không từ chối gói có SVG độc). Mỗi ca: canary __pwned phải null, 0 yêu cầu
// mạng ngoài, và mọi phần tử/thuộc tính còn lại trong Shadow DOM phải nằm trong allowlist (kiểm bằng bảng, không regex).
// Nguồn ca: tests/fixtures/svg-import/malicious/*.svg và tests/fixtures/svg-import/malicious/page-path/*.svg.
// Dùng: node tools/svg-import/page-path-harness.mjs [--out docs/reports/008-page-path-x64.json]
// Mã thoát: 0 = đạt; 1 = không đạt; 2 = lỗi chạy.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'rolldown';
import { launchChrome } from './chrome-util.mjs';

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const out = oi >= 0 ? args[oi + 1] : '';
const root = resolve(import.meta.dirname, '../..');
const dirs = [
  join(root, 'tests/fixtures/svg-import/malicious'),
  join(root, 'tests/fixtures/svg-import/malicious/page-path'),
];

const bundled = await build({
  input: join(root, 'packages/svg-renderer/src/index.ts'),
  output: { format: 'iife', name: 'R' },
  write: false,
  logLevel: 'silent',
});
const code = bundled.output[0].code;

const DOC = 'https://harness.invalid/page.html';
const cases = [];
for (const d of dirs) {
  let files;
  try {
    files = readdirSync(d).filter((f) => f.endsWith('.svg'));
  } catch {
    continue;
  }
  for (const f of files)
    cases.push({ id: f.replace(/\.svg$/, ''), bytes: readFileSync(join(d, f), 'utf8') });
}

let { browser, version } = await launchChrome();
const rows = [];
const HANG_MS = 20000;
try {
  for (const c of cases) {
    const page = await browser.newPage();
    const external = [];
    const errors = [];
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (u === DOC)
        req.respond({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><meta charset="utf-8"><div id="host"></div>',
        });
      else if (u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank')
        req.continue();
      else if (u.endsWith('/favicon.ico')) req.abort();
      else {
        external.push(u);
        req.abort();
      }
    });
    page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 160)));
    await page.evaluateOnNewDocument(() => {
      window.__pwned = null;
    });
    await page.goto(DOC, { waitUntil: 'load' });
    await page.evaluate(code);
    const run = page.evaluate((svg) => {
      const host = document.getElementById('host');
      let mounted = null;
      let thrown = null;
      try {
        mounted = window.R.mountScreen(host, svg, {
          viewBox: [0, 0, 200, 100],
          fitMode: 'contain',
          elements: [],
        });
      } catch (e) {
        thrown = String(e.message ?? e).slice(0, 120);
      }
      const bad = [];
      if (mounted) {
        const okEl = window.R.ALLOW_ELEMENTS;
        const walk = (n) => {
          for (const el of n.children) {
            if (el.localName === 'style' && el.parentNode === mounted.root) continue;
            if (el.namespaceURI !== 'http://www.w3.org/2000/svg' || !okEl.has(el.localName))
              bad.push('el:' + el.localName);
            for (const a of el.attributes) {
              if (a.namespaceURI !== null) bad.push('ns-attr:' + a.name);
              else if (
                a.name === 'style' ||
                a.name.startsWith('data-mat-') ||
                a.name === 'id' ||
                a.name === 'transform'
              )
                continue;
              else if (!window.R.ruleFor(el.localName, a.name)) bad.push('attr:' + a.name);
              else if (
                a.name === 'href' &&
                !(a.value.startsWith('#') || a.value.startsWith('data:image/'))
              )
                bad.push('href:' + a.value.slice(0, 30));
            }
            walk(el);
          }
        };
        walk(mounted.root);
        for (const el of mounted.root.querySelectorAll('*'))
          for (const t of ['click', 'mouseover', 'focus', 'load', 'error'])
            el.dispatchEvent(new Event(t, { bubbles: true }));
      }
      return { thrown, bad: [...new Set(bad)], pwned: window.__pwned };
    }, c.bytes);
    run.catch(() => {});
    // sau mount, ép vẽ một khung (rAF) rồi đọc canary: bom use chỉ treo ở bước vẽ này
    const full = run.then(async (r) => {
      await new Promise((ok) => setTimeout(ok, 120));
      r.pwned =
        r.pwned ??
        (await page.evaluate(
          () => new Promise((ok) => requestAnimationFrame(() => ok(window.__pwned))),
        ));
      return r;
    });
    full.catch(() => {});
    const res = await Promise.race([
      full,
      new Promise((r) => setTimeout(() => r({ hang: true }), HANG_MS)),
    ]);
    if (res.hang) {
      // tab treo (ví dụ bom use): ghi lỗi, giết Chrome và mở lại cho ca sau
      rows.push({ id: c.id, hang: true, pass: false, bad: [], external, errors });
      console.log(`LỖI  ${c.id} TREO > ${HANG_MS} ms (tab không phản hồi)`);
      browser.process()?.kill();
      ({ browser } = await launchChrome());
      continue;
    }
    const pass = res.pwned === null && external.length === 0 && res.bad.length === 0;
    rows.push({
      id: c.id,
      thrown: res.thrown,
      bad: res.bad,
      pwned: res.pwned,
      external,
      errors,
      pass,
    });
    console.log(
      `${pass ? 'ĐẠT ' : 'LỖI '} ${c.id}` +
        (res.thrown ? ` (từ chối khi parse: ${res.thrown.slice(0, 50)})` : '') +
        (res.bad.length ? ` bad=${res.bad.join(',')}` : '') +
        (external.length ? ` ext=${external.join(',')}` : '') +
        (res.pwned !== null ? ` PWNED=${res.pwned}` : ''),
    );
    await page.close();
  }
} finally {
  await browser.close();
}
const pass = rows.length > 0 && rows.every((r) => r.pass);
if (out) {
  mkdirSync(resolve(out, '..'), { recursive: true });
  writeFileSync(
    resolve(out),
    JSON.stringify(
      {
        feature: '008-svg-import-binding',
        task: 'T112',
        chrome: version,
        cases: rows.length,
        pass,
        results: rows,
      },
      null,
      2,
    ) + '\n',
  );
}
console.log(`${rows.length} ca; ${rows.filter((r) => !r.pass).length} lỗi`);
console.log(pass ? 'ĐẠT' : 'KHÔNG ĐẠT');
process.exit(pass ? 0 : 1);
