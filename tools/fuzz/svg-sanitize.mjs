// Fuzz đường mở và dán SVG của trình vẽ (feature 011, T165; FR-029, SC-034). Đột biến TẤT ĐỊNH theo seed trên kho mầm
// tests/svg-editor-fixtures (fixture và bộ độc): cắt, lặp đoạn, đổi ký tự, chèn mảnh nguy hiểm, lồng sâu, lật byte.
// Mỗi ca:
//  - parseDrawDoc (mở tệp) và pasteSvgText (dán) không ném lỗi, mỗi ca ≤ 2 giây;
//  - mở được: văn bản ghi ra qua được bộ lọc DOM của feature 008 (assertAllowlisted), ≤ 20.000 phần tử, ghi lần hai
//    cùng byte lần một;
//  - dán được: tài liệu sau khi dán qua được assertAllowlisted.
// Fuzz lệnh (100.000 chuỗi) nằm ở packages/svg-edit/src/fuzz.test.ts.
// Dùng: node tools/fuzz/svg-sanitize.mjs [--cases 10000] [--seed 1] [--minutes M] [--out docs/reports/011-fuzz-svg.json]
// Mã thoát: 0 = đạt, 1 = có lỗi.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { installDom } from '../svg-import/chrome-util.mjs';

installDom();
const { assertAllowlisted } = await import('../../packages/svg-import/src/index.ts');
const edit = await import('../../packages/svg-edit/src/index.ts');

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args.splice(i, 2)[1] : '';
};
const CASES = Number(opt('--cases') || 10000);
const SEED = Number(opt('--seed') || 1);
const MINUTES = Number(opt('--minutes') || 0);
const out = opt('--out');
const PER_CASE_MS = 2000;

const root = resolve(import.meta.dirname, '../../tests/svg-editor-fixtures');
const corpus = [];
for (const f of readdirSync(root)
  .filter((x) => x.endsWith('.svg'))
  .sort())
  corpus.push({ name: f, text: readFileSync(join(root, f), 'utf8') });
for (const f of readdirSync(join(root, 'malicious'))
  .filter((x) => x.endsWith('.svg'))
  .sort()) {
  const text = readFileSync(join(root, 'malicious', f), 'utf8');
  if (text.length < 200_000) corpus.push({ name: 'malicious/' + f, text });
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

const FRAGMENTS = [
  '<script>alert(1)</script>',
  ' onload="alert(1)"',
  '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>',
  ' href="javascript:alert(1)"',
  ' xlink:href="https://evil.invalid/x#a"',
  ' style="fill:url(https://evil.invalid/x);behavior:url(x.htc)"',
  '<style>@import url(https://evil.invalid/x.css);</style>',
  '<!DOCTYPE svg [<!ENTITY a "aaaa">]>',
  '&a;',
  '<use href="#pump"/>',
  '<?xml-stylesheet href="https://evil.invalid/x.css"?>',
  '<![CDATA[ <script> ]]>',
  '<!-- -- -->',
  ' data-mat-layer="‮x"',
  '<a href="#x"><rect/></a>',
  '<image href="data:image/svg+xml;base64,PHN2Zz4="/>',
  '\u0000',
  '<g>'.repeat(40),
];
const CHARS = ['<', '>', '"', "'", '&', ';', '=', '/', '#', ':', ' ', '\n', '-', '!', '?', ']'];

function mutate(text, r) {
  let s = text;
  const n = r() < 0.6 ? 1 : 2 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const i = Math.floor(r() * (s.length + 1));
    switch (Math.floor(r() * 9) % 7 === 0 && r() < 0.5 ? 5 : Math.floor(r() * 7)) {
      case 0: // cắt
        s = s.slice(0, i) + s.slice(Math.min(s.length, i + 1 + Math.floor(r() * 40)));
        break;
      case 1: {
        // lặp đoạn
        const len = Math.floor(r() * 200);
        s = s.slice(0, i) + s.slice(i, i + len) + s.slice(i);
        break;
      }
      case 2:
        s = s.slice(0, i) + CHARS[Math.floor(r() * CHARS.length)] + s.slice(i + 1);
        break;
      case 3:
      case 4:
        s = s.slice(0, i) + FRAGMENTS[Math.floor(r() * FRAGMENTS.length)] + s.slice(i);
        break;
      case 5: {
        // chèn sau thẻ mở đầu tiên sau i
        const j = s.indexOf('>', i);
        if (j > 0) s = s.slice(0, j) + FRAGMENTS[Math.floor(r() * 7)] + s.slice(j);
        break;
      }
      default:
        if (s.length > 0)
          s = s.slice(0, i) + String.fromCharCode(Math.floor(r() * 0x3000)) + s.slice(i + 1);
    }
  }
  return s;
}

function runCase(text) {
  const problems = [];
  const t0 = performance.now();
  let opened = false;
  let pasted = false;
  try {
    const r = edit.parseDrawDoc(text);
    if (r.ok) {
      opened = true;
      const s1 = edit.serialize(r.doc);
      if (r.doc.elementCount > edit.SVG_MAX_NODES) problems.push('mở: quá số phần tử');
      try {
        assertAllowlisted(s1);
      } catch (e) {
        problems.push('mở: ' + e.message);
      }
      const r2 = edit.parseDrawDoc(s1);
      if (!r2.ok) problems.push('mở lại thất bại: ' + r2.message);
      else if (edit.serialize(r2.doc) !== s1) problems.push('ghi lần hai khác lần một');
    }
  } catch (e) {
    problems.push('mở ném lỗi: ' + (e?.stack ?? e));
  }
  try {
    const doc = edit.parseDrawDoc(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n</svg>\n',
    );
    if (!doc.ok) throw new Error('tài liệu nền hỏng');
    const p = edit.pasteSvgText(doc.doc, text);
    if (p.ok) {
      pasted = true;
      edit.applyCommand(doc.doc, p.batch);
      try {
        assertAllowlisted(edit.serialize(doc.doc));
      } catch (e) {
        problems.push('dán: ' + e.message);
      }
    }
  } catch (e) {
    if (!(e instanceof edit.CommandError)) problems.push('dán ném lỗi: ' + (e?.stack ?? e));
  }
  const ms = performance.now() - t0;
  return { problems, ms, opened, pasted };
}

function block(seed, cases) {
  const stats = { cases: 0, opened: 0, pasted: 0, failures: [], slowOver2s: 0, maxMs: 0 };
  for (let c = 0; c < cases; c++) {
    const r = mulberry32(
      (Math.imul(seed ^ 0x9e3779b9, 2654435761) + Math.imul(c + 1, 40503)) >>> 0,
    );
    const base = corpus[Math.floor(r() * corpus.length)];
    const text = mutate(base.text, r);
    const res = runCase(text);
    stats.cases++;
    if (res.opened) stats.opened++;
    if (res.pasted) stats.pasted++;
    if (res.ms > PER_CASE_MS) stats.slowOver2s++;
    stats.maxMs = Math.max(stats.maxMs, res.ms);
    if (res.problems.length > 0 && stats.failures.length < 20)
      stats.failures.push({
        seed,
        case: c,
        base: base.name,
        problems: res.problems.map((p) => String(p).slice(0, 300)),
      });
  }
  return stats;
}

const started = Date.now();
let total = block(SEED, CASES);
let seed = SEED;
while (MINUTES > 0 && Date.now() - started < MINUTES * 60_000) {
  seed++;
  const b = block(seed, 10_000);
  total = {
    cases: total.cases + b.cases,
    opened: total.opened + b.opened,
    pasted: total.pasted + b.pasted,
    failures: [...total.failures, ...b.failures].slice(0, 50),
    slowOver2s: total.slowOver2s + b.slowOver2s,
    maxMs: Math.max(total.maxMs, b.maxMs),
  };
}
const report = {
  tool: 'tools/fuzz/svg-sanitize.mjs',
  seed: SEED,
  corpus: corpus.length,
  cases: total.cases,
  opened: total.opened,
  pasted: total.pasted,
  failures: total.failures.length,
  failureSamples: total.failures,
  slowOver2s: total.slowOver2s,
  maxMs: Math.round(total.maxMs),
  seconds: Math.round((Date.now() - started) / 1000),
};
if (out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), JSON.stringify(report, null, 2) + '\n');
}
console.log(
  JSON.stringify({ ...report, failureSamples: report.failureSamples.slice(0, 3) }, null, 2),
);
process.exit(report.failures === 0 && report.slowOver2s === 0 ? 0 : 1);
