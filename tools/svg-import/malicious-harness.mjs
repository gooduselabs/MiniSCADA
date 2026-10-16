// Harness bộ SVG độc hại (feature 008, T051/T053, FR-062, SC-003; research R19). Bốn bước cho từng ca trong
// tests/fixtures/svg-import/malicious/:
//  1. importSvg (jsdom): so với <id>.expect.json (outcome, codes, forbid, keep);
//  2. assertAllowlisted trên bản đã nhập: không còn gì ngoài allowlist;
//  3. dựng bản đã nhập trong Chrome headless với canary `window.__pwned = null`, mọi yêu cầu mạng bị chặn và đếm
//     (hai cách: mở làm tài liệu SVG độc lập; nhúng bằng innerHTML vào trang HTML rồi bắn sự kiện trên mọi phần tử);
//  4. dựng BẢN GỐC không lọc làm đối chứng: ít nhất một ca phải làm `__pwned` khác null (canary có hiệu lực).
// Dùng: node tools/svg-import/malicious-harness.mjs [--out docs/reports/008-malicious-x64.json] [--only <id>]
// Mã thoát: 0 = đạt (0 __pwned, 0 yêu cầu mạng ngoài, >= 1 canary của bản gốc, khớp expect); 1 = không đạt; 2 = lỗi chạy.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { installDom, launchChrome } from './chrome-util.mjs';

installDom();
const { importSvg, assertAllowlisted, makeSeededUid } =
  await import('../../packages/svg-import/src/index.ts');
const limits = await import('../../tests/fixtures/svg-import/limits.mjs');

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args.splice(i, 2)[1] : '';
};
const out = opt('--out');
const only = opt('--only');
const dir = resolve(import.meta.dirname, '../../tests/fixtures/svg-import/malicious');
const DOC_URL = 'https://harness.invalid/case.svg';
const PAGE_URL = 'https://harness.invalid/page.html';

export function codesOf(r) {
  const s = new Set();
  for (const x of [...r.report.removed, ...r.report.converted, ...r.report.warnings]) s.add(x.code);
  if (!r.ok) s.add(r.error.code);
  return s;
}

/**
 * Mở `body` trong Chrome như tài liệu `mime` ở một nguồn ảo; chặn và đếm mọi yêu cầu khác. Trả về
 * { pwned, external: [url], errors, ms }. `mode`: 'doc' (điều hướng tới tài liệu) hoặc 'inline' (nhúng vào HTML).
 */
async function observe(browser, body, mode) {
  const page = await browser.newPage();
  const external = [];
  const errors = [];
  try {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (u === DOC_URL && mode === 'doc') {
        req.respond({ status: 200, contentType: 'image/svg+xml', body });
      } else if (u === PAGE_URL && mode === 'inline') {
        const html = `<!doctype html><meta charset="utf-8"><body><div id="host"></div>`;
        req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      } else if (u === 'https://harness.invalid/favicon.ico') {
        req.abort(); // Chrome tự xin biểu tượng trang; không do SVG
      } else if (u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank') {
        req.continue();
      } else {
        external.push(u);
        req.abort();
      }
    });
    page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)));
    await page.evaluateOnNewDocument(() => {
      window.__pwned = null;
    });
    const t0 = Date.now();
    await page.goto(mode === 'doc' ? DOC_URL : PAGE_URL, { waitUntil: 'load', timeout: 15000 });
    if (mode === 'inline') {
      await page.evaluate((svg) => {
        document.getElementById('host').innerHTML = svg;
      }, body);
    }
    // bắn sự kiện thường gặp trên mọi phần tử và chờ một nhịp (onload/SMIL/timer nếu có)
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('*'))
        for (const t of ['click', 'mouseover', 'focus', 'load', 'error'])
          el.dispatchEvent(new Event(t, { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 150));
    const pwned = await page.evaluate(() => window.__pwned);
    return { pwned, external, errors, ms: Date.now() - t0 };
  } catch (e) {
    return {
      pwned: await page.evaluate(() => window.__pwned).catch(() => null),
      external,
      errors: [...errors, String(e.message ?? e).slice(0, 200)],
      loadError: true,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

const files = readdirSync(dir).filter((f) => f.endsWith('.expect.json'));
const cases = [];
const { browser, version } = await launchChrome();
try {
  for (const f of files) {
    const ex = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (only && ex.id !== only) continue;
    const raw = ex.generated
      ? Buffer.from(limits.buildLimitCase(ex.generated.case).content, 'utf8')
      : readFileSync(join(dir, ex.id + '.svg'));
    const row = { id: ex.id, outcome: ex.outcome, expectMismatch: [], rawCanary: !!ex.rawCanary };
    cases.push(row);

    // 1. nhập và so expect
    const r = importSvg(raw, { fileName: ex.id + '.svg', uid: makeSeededUid(1) });
    const codes = codesOf(r);
    row.importOk = r.ok;
    row.codes = [...codes].sort();
    for (const c of ex.codes) if (!codes.has(c)) row.expectMismatch.push(`thiếu mã ${c}`);
    if (ex.outcome === 'rejected') {
      if (r.ok) row.expectMismatch.push('mong bị từ chối nhưng ok:true');
    } else if (!r.ok) {
      row.expectMismatch.push(`mong ok:true nhưng ${r.error.code}`);
    } else {
      const lower = r.svg.toLowerCase();
      for (const bad of ex.forbid)
        if (lower.includes(bad.toLowerCase())) row.expectMismatch.push(`còn "${bad}"`);
      for (const k of ex.keep ?? []) if (!r.svg.includes(k)) row.expectMismatch.push(`mất "${k}"`);
      // 2. allowlist
      try {
        assertAllowlisted(r.svg);
        row.allowlisted = true;
      } catch (e) {
        row.allowlisted = false;
        row.expectMismatch.push(String(e.message));
      }
      // 3. dựng bản đã nhập
      row.imported = {
        doc: await observe(browser, r.svg, 'doc'),
        inline: await observe(browser, r.svg, 'inline'),
      };
    }
    // 4. bản gốc (đối chứng canary); ca sinh lúc chạy quá lớn nên bỏ qua
    // `skipOriginal`: bản gốc làm treo Chrome (bom use), không dựng làm đối chứng
    if (!ex.generated && !ex.skipOriginal) {
      row.original = { doc: await observe(browser, raw, 'doc') };
      row.original.canary = row.original.doc.pwned !== null;
    }
    const bad =
      row.expectMismatch.length > 0 ||
      (row.imported &&
        [row.imported.doc, row.imported.inline].some(
          (o) => o.pwned !== null || o.external.length > 0,
        ));
    row.pass = !bad;
    console.log(
      `${row.pass ? 'ĐẠT ' : 'LỖI '} ${ex.id}` +
        (row.original?.canary ? ` [bản gốc kích hoạt canary: ${row.original.doc.pwned}]` : '') +
        (row.expectMismatch.length ? ` -> ${row.expectMismatch.join('; ')}` : ''),
    );
  }
} finally {
  await browser.close();
}

const pwnedImported = cases.filter(
  (c) => c.imported && [c.imported.doc, c.imported.inline].some((o) => o.pwned !== null),
).length;
const externalImported = cases.reduce(
  (n, c) =>
    n + (c.imported ? c.imported.doc.external.length + c.imported.inline.external.length : 0),
  0,
);
const canaryCases = cases.filter((c) => c.original?.canary).map((c) => c.id);
const summary = {
  feature: '008-svg-import-binding',
  task: 'T051/T053',
  chrome: version,
  cases: cases.length,
  sanitized: cases.filter((c) => c.outcome === 'sanitized').length,
  rejected: cases.filter((c) => c.outcome === 'rejected').length,
  importedPwned: pwnedImported,
  importedExternalRequests: externalImported,
  originalCanaryCases: canaryCases,
  // đối chứng mạng: bản gốc làm Chrome xin tài nguyên ngoài thì việc chặn/đếm có hiệu lực
  originalExternalRequestCases: cases
    .filter((c) => c.original?.doc.external.length)
    .map((c) => c.id),
  expectMismatches: cases
    .filter((c) => c.expectMismatch.length)
    .map((c) => ({ id: c.id, why: c.expectMismatch })),
  pass:
    cases.length > 0 &&
    pwnedImported === 0 &&
    externalImported === 0 &&
    canaryCases.length >= 1 &&
    cases.every((c) => c.pass),
  results: cases,
};
if (out) {
  mkdirSync(resolve(out, '..'), { recursive: true });
  writeFileSync(resolve(out), JSON.stringify(summary, null, 2) + '\n');
  console.log('Đã ghi', out);
}
console.log(
  `${cases.length} ca; bản đã nhập: __pwned ${pwnedImported}, yêu cầu mạng ngoài ${externalImported}; ` +
    `bản gốc kích hoạt canary: ${canaryCases.length} (${canaryCases.join(', ')})`,
);
console.log(summary.pass ? 'ĐẠT' : 'KHÔNG ĐẠT');
process.exit(summary.pass ? 0 : 1);
