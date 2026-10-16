// Fuzz đường trang trong Chrome (feature 008, T112, FR-064): đột biến ngẫu nhiên tất định theo seed trên bộ độc hại, ca
// page-path và fixture, rồi đưa THẲNG vào mountScreen (không qua bộ nhập) và kiểm trên DOM thật: mọi phần tử nằm trong
// ALLOW_ELEMENTS, thuộc tính qua ruleFor, `style` chỉ thuộc tính CSS cho phép và `url(#…)`, `href` chỉ `#id` hoặc
// `data:image/`, không nút lạ; canary `__pwned` null; không yêu cầu mạng ngoài. Phần lớn đột biến làm XML hỏng (bị từ chối
// khi parse): chỉ ca parse được mới có giá trị, báo số `parsed`.
// Dùng: node tools/svg-import/page-fuzz.mjs [--cases 4000] [--seed 11] [--out docs/reports/008-page-fuzz-x64.json]
// Mã thoát: 0 = đạt; 1 = có vi phạm.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const base = resolve(import.meta.dirname, '../..') + '/';
const { build } = await import('rolldown');
const { launchChrome } = await import('./chrome-util.mjs');
const bundled = await build({
  input: base + 'packages/svg-renderer/src/index.ts',
  output: { format: 'iife', name: 'R' },
  write: false,
  logLevel: 'silent',
});
const code = bundled.output[0].code;

const corpus = [];
for (const d of [
  'tests/fixtures/svg-import/malicious',
  'tests/fixtures/svg-import/malicious/page-path',
  'tests/fixtures/svg-import',
]) {
  for (const f of readdirSync(base + d).filter((x) => x.endsWith('.svg')))
    if (!f.startsWith('m17') && !f.startsWith('p11') && !f.startsWith('p09')) {
      const t = readFileSync(join(base + d, f), 'utf8');
      if (t.length < 200000) corpus.push(t);
    }
}
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SNIP = [
  ' onload="window.__pwned=1" ',
  ' onclick="window.__pwned=2" ',
  ' href="javascript:window.__pwned=3" ',
  ' xlink:href="javascript:window.__pwned=4" ',
  '<script>window.__pwned=5</script>',
  '<svg:script xmlns:svg="http://www.w3.org/2000/svg">window.__pwned=6</svg:script>',
  ' style="fill:url(http://evil.example/a#b);behavior:url(x)" ',
  ' style="background:url(http://evil.example/x.png)" ',
  '<image href="http://evil.example/i.png"/>',
  '<use href="http://evil.example/x.svg#a"/>',
  '<feImage href="http://evil.example/f.png"/>',
  '<set attributeName="href" to="javascript:window.__pwned=7"/>',
  '<animate attributeName="onclick" values="window.__pwned=8"/>',
  '<foreignObject><iframe src="javascript:window.__pwned=9"></iframe></foreignObject>',
  '<style>*{background:url(http://evil.example/s.png)}</style>',
  ' xml:base="http://evil.example/" ',
  ' filter="url(http://evil.example/f.svg#f)" ',
  ' fill="url(\'http://evil.example/a\')" ',
  '<a href="javascript:window.__pwned=10"><text>x</text></a>',
  '<![CDATA[<script>window.__pwned=11</script>]]>',
  '<!--[if IE]><script>window.__pwned=12</script><![endif]-->',
  '<html:script xmlns:html="http://www.w3.org/1999/xhtml">window.__pwned=13</html:script>',
  ' ONCLICK="window.__pwned=14" ',
  ' data-mat-uid="el_aaaaaaaa" ',
  '<image href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIG9ubG9hZD0id2luZG93Ll9fcHduZWQ9MTUiLz4="/>',
  '<image href="data:text/html,<script>window.__pwned=16</script>"/>',
  ' href="data:text/html;base64,PHNjcmlwdD53aW5kb3cuX19wd25lZD0xNzwvc2NyaXB0Pg==" ',
  '<animateTransform attributeName="transform"/>',
  '<script xlink:href="data:,window.__pwned=18"/>',
  '<?xml-stylesheet href="http://evil.example/s.css"?>',
];
const argv = process.argv.slice(2);
const flag = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : '';
};
const N = Number(flag('--cases') || 4000);
const seed = Number(flag('--seed') || 1);
const outFile = flag('--out');
const rnd = mulberry32(seed);
const pick = (a) => a[Math.floor(rnd() * a.length)];
function mutate(s) {
  const k = 1 + Math.floor(rnd() * 4);
  for (let i = 0; i < k; i++) {
    const op = Math.floor(rnd() * 7);
    const at = Math.floor(rnd() * (s.length + 1));
    if (op <= 1) s = s.slice(0, at) + pick(SNIP) + s.slice(at);
    else if (op === 2) {
      // chèn vào ngay sau '<tag' đầu tiên bất kỳ
      const j = s.indexOf('<rect', at);
      if (j >= 0) s = s.slice(0, j + 5) + pick(SNIP) + s.slice(j + 5);
    } else if (op === 3) {
      const e = Math.min(s.length, at + Math.floor(rnd() * 60));
      s = s.slice(0, e) + s.slice(at, e) + s.slice(e);
    } else if (op === 4) {
      const j = s.indexOf('=', at);
      if (j >= 0) s = s.slice(0, j) + pick(['=', ' = ', '\n=\t', '=&#x22;', "='"]) + s.slice(j + 1);
    } else if (op === 5) {
      const j = s.indexOf('<', at + 1);
      if (j >= 0 && s[j + 1] !== '/' && s[j + 1] !== '!' && s[j + 1] !== '?')
        s = s.slice(0, j + 1) + pick(['s:', 'svg:', 'X', 'xlink:']) + s.slice(j + 1);
    } else {
      s =
        s.slice(0, at) +
        pick([
          '&#x3c;',
          '&#60;script&#62;',
          ']]>',
          '<![CDATA[',
          '\u0000',
          '\ufeff',
          '&amp;',
          '&lt;',
        ]) +
        s.slice(at);
    }
  }
  return s;
}
const cases = [];
for (let i = 0; i < N; i++) cases.push(mutate(pick(corpus)));

const { browser } = await launchChrome();
const page = await browser.newPage();
const external = [];
await page.setRequestInterception(true);
page.on('request', (req) => {
  const u = req.url();
  if (u === 'https://harness.invalid/p')
    req.respond({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><div id="h"></div>',
    });
  else if (u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank') req.continue();
  else {
    external.push(u);
    req.abort();
  }
});
await page.evaluateOnNewDocument(() => {
  window.__pwned = null;
});
await page.goto('https://harness.invalid/p');
await page.evaluate(code);
const result = await page.evaluate((cs) => {
  const bad = [];
  let parsed = 0;
  let rejected = 0;
  cs.forEach((svg, idx) => {
    const host = document.createElement('div');
    document.getElementById('h').appendChild(host);
    let m = null;
    try {
      m = window.R.mountScreen(host, svg, {
        viewBox: [0, 0, 200, 100],
        fitMode: 'contain',
        elements: [],
      });
    } catch {
      rejected++;
      return;
    }
    parsed++;
    const walk = (n) => {
      for (const el of n.children) {
        if (el.localName === 'style' && el.parentNode === m.root) continue;
        const prob = [];
        if (
          el.namespaceURI !== 'http://www.w3.org/2000/svg' ||
          !window.R.ALLOW_ELEMENTS.has(el.localName)
        )
          prob.push('el:' + el.localName);
        for (const a of el.attributes) {
          if (a.namespaceURI !== null) prob.push('nsattr:' + a.name);
          else if (a.name === 'style' && el === m.svg) continue;
          else if (a.name === 'style') {
            for (const d of window.R.parseDeclarations(a.value)) {
              if (!window.R.CSS_PROPS.has(d.prop)) prob.push('cssprop:' + d.prop);
              if (d.value.toLowerCase().includes('url(') && !d.value.includes('url(#'))
                prob.push('cssurl:' + d.value.slice(0, 40));
            }
            if (
              a.value.includes('@') ||
              a.value.includes('\\') ||
              a.value.toLowerCase().includes('expression')
            )
              prob.push('style-odd:' + a.value.slice(0, 40));
          } else if (a.name.startsWith('data-mat-') || a.name === 'id' || a.name === 'transform')
            continue;
          else if (!window.R.ruleFor(el.localName, a.name)) prob.push('attr:' + a.name);
          else if (a.value.toLowerCase().includes('url(') && !a.value.includes('url(#'))
            prob.push('url:' + a.name);
          else if (
            a.name === 'href' &&
            !(a.value.startsWith('#') || a.value.startsWith('data:image/'))
          )
            prob.push('href:' + a.value.slice(0, 30));
        }
        if (prob.length) bad.push({ idx, prob });
        walk(el);
      }
    };
    walk(m.root);
    // chữ: không nút lạ
    for (const t of m.root.querySelectorAll('*'))
      for (const c of t.childNodes)
        if (c.nodeType !== 1 && c.nodeType !== 3 && c.nodeType !== 4)
          bad.push({ idx, prob: ['node:' + c.nodeType] });
  });
  return { bad: bad.slice(0, 10), nbad: bad.length, parsed, rejected };
}, cases);
await new Promise((r) => setTimeout(r, 200));
const pwned = await page.evaluate(
  () => new Promise((ok) => requestAnimationFrame(() => ok(window.__pwned))),
);
await browser.close();
// favicon do Chrome tự xin, không do SVG
const ext = external.filter((u) => !u.endsWith('/favicon.ico'));
const pass = result.nbad === 0 && pwned === null && ext.length === 0 && result.parsed > 0;
const summary = {
  feature: '008-svg-import-binding',
  task: 'T112',
  cases: N,
  seed,
  parsed: result.parsed,
  rejectedAtParse: result.rejected,
  violations: result.nbad,
  pwned,
  externalRequests: ext.length,
  pass,
};
console.log(JSON.stringify({ ...summary, sample: result.bad.slice(0, 3) }, null, 1));
for (const b of result.bad.slice(0, 3)) console.log(JSON.stringify(cases[b.idx]).slice(0, 600));
if (outFile) {
  mkdirSync(resolve(outFile, '..'), { recursive: true });
  writeFileSync(resolve(outFile), JSON.stringify(summary, null, 2) + '\n');
}
console.log(pass ? 'ĐẠT' : 'KHÔNG ĐẠT');
process.exit(pass ? 0 : 1);
