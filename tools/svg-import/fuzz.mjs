// Fuzz importer SVG (feature 008, T113, FR-059). Đột biến ngẫu nhiên TẤT ĐỊNH theo seed trên 10 fixture và bộ độc hại
// (cắt, lặp đoạn, đổi ký tự, lồng sâu, thuộc tính dài, chèn mảnh nguy hiểm, lật byte). Mỗi ca kiểm:
//  - importSvg không ném lỗi (chỉ trả ok:false khi từ chối);
//  - mỗi ca <= 2 giây;
//  - ok:true thì assertAllowlisted đúng trên SVG đầu ra (và nhập lại không ném);
//  - ok:false có mã lỗi E_IMPORT_*.
// Dùng: node tools/svg-import/fuzz.mjs [--cases 10000] [--seed 1] [--minutes M] [--out docs/reports/008-fuzz-x64.json]
//       [--keep-failures <thư mục>]
// `--minutes M`: bản dài chạy tay (lặp các khối 10.000 ca với seed tăng dần tới hết M phút). Mã thoát: 0 = đạt, 1 = có lỗi.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { installDom } from './chrome-util.mjs';

installDom();
const { importSvg, assertAllowlisted, makeSeededUid } =
  await import('../../packages/svg-import/src/index.ts');

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args.splice(i, 2)[1] : '';
};
const CASES = Number(opt('--cases') || 10000);
const SEED = Number(opt('--seed') || 1);
const MINUTES = Number(opt('--minutes') || 0);
const out = opt('--out');
const keepDir = opt('--keep-failures');
const PER_CASE_MS = 2000;

const root = resolve(import.meta.dirname, '../../tests/fixtures/svg-import');
const corpus = [];
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
for (const f of manifest.fixtures)
  corpus.push({ name: f.file, bytes: readFileSync(join(root, f.file)) });
const mdir = join(root, 'malicious');
for (const f of readdirSync(mdir).filter((x) => x.endsWith('.svg')))
  corpus.push({ name: f, bytes: readFileSync(join(mdir, f)) });

// ---------- PRNG tất định ----------
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mix = (seed, i) => (Math.imul(seed ^ 0x9e3779b9, 2654435761) + Math.imul(i + 1, 40503)) >>> 0;

const CHARS = [
  '<',
  '>',
  '"',
  "'",
  '&',
  ';',
  '=',
  '/',
  '#',
  '(',
  ')',
  '{',
  '}',
  ' ',
  '\0',
  '\n',
  '-',
  ':',
  'x',
  '9',
  '%',
  '\\',
  '!',
  '?',
];
const FRAGMENTS = [
  '<script>window.__pwned=1</script>',
  '<rect onclick="alert(1)" width="1" height="1"/>',
  '<use href="http://evil.invalid/x#a"/>',
  '<use href="#a"/>',
  '<g id="a"><use href="#a"/></g>',
  '<image href="http://evil.invalid/x.png"/>',
  '<style>@import url(http://evil.invalid/a.css);</style>',
  '<style>.a{fill:red}</style>',
  '<foreignObject><iframe src="x"/></foreignObject>',
  '<!DOCTYPE svg [<!ENTITY a "aaaa">]>',
  '<?xml-stylesheet href="x.css"?>',
  '<![CDATA[<script>x</script>]]>',
  '<text>&amp;&lt;&gt;&#x41;&#0;</text>',
  '<rect style="fill:url(http://evil.invalid/f)"/>',
  '<animate attributeName="href" values="javascript:alert(1)"/>',
  '<path d="M0 0 L 1e999 1e999 Z"/>',
  '<g transform="matrix(1e308 0 0 1e308 0 0)"/>',
  '<filter id="f"><feGaussianBlur stdDeviation="99999"/></filter>',
];
const ATTRS = ['d', 'style', 'transform', 'fill', 'points', 'class', 'data-name', 'href'];

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const ri = (rnd, lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

function mutate(rnd, base) {
  let s = base.toString('utf8'); // đột biến ở mức ký tự để phần lớn ca vẫn là UTF-8 hợp lệ
  const ops = ri(rnd, 1, 4);
  const kinds = [];
  for (let k = 0; k < ops; k++) {
    // phần lớn là đột biến giữ XML đúng cấu trúc (3-5, 2 trên giá trị); cắt, lặp, lật byte, xóa chỉ chiếm ~30 %
    const kind = pick(rnd, [3, 4, 4, 5, 5, 5, 8, 8, 2, 0, 1, 6, 7]);
    kinds.push(kind);
    let pos = ri(rnd, 0, s.length);
    if (kind === 3 || kind === 4 || kind === 5 || kind === 8) {
      // chèn ở ranh giới thẻ (sau một '>') để giữ XML đúng
      const gt = s.indexOf('>', pos);
      pos = gt >= 0 ? gt + 1 : s.length;
    }
    if (kind === 0) {
      s = s.slice(0, pos); // cắt
    } else if (kind === 1) {
      const len = ri(rnd, 1, Math.min(200, s.length || 1)); // lặp một đoạn
      s = s.slice(0, pos) + s.slice(pos, pos + len).repeat(ri(rnd, 2, 40)) + s.slice(pos);
    } else if (kind === 2) {
      const n = ri(rnd, 1, 8); // đổi ký tự
      for (let j = 0; j < n; j++) {
        const p = ri(rnd, 0, Math.max(0, s.length - 1));
        s = s.slice(0, p) + pick(rnd, CHARS) + s.slice(p + 1);
      }
    } else if (kind === 3) {
      const d = ri(rnd, 10, 300); // lồng sâu
      s =
        s.slice(0, pos) +
        '<g>'.repeat(d) +
        '<rect width="1" height="1"/>' +
        '</g>'.repeat(d) +
        s.slice(pos);
    } else if (kind === 4) {
      const len = pick(rnd, [100, 1000, 10000, 100000]); // thuộc tính dài
      s = s.slice(0, pos) + ` ${pick(rnd, ATTRS)}="${'9 '.repeat(len / 2)}"` + s.slice(pos);
    } else if (kind === 5) {
      s = s.slice(0, pos) + pick(rnd, FRAGMENTS) + s.slice(pos); // chèn mảnh nguy hiểm
    } else if (kind === 6) {
      const n = ri(rnd, 1, 6); // lật byte
      for (let j = 0; j < n; j++) {
        const p = ri(rnd, 0, Math.max(0, s.length - 1));
        s = s.slice(0, p) + String.fromCharCode(ri(rnd, 0, 255)) + s.slice(p + 1);
      }
    } else if (kind === 8) {
      // thuộc tính lạ trên phần tử kế tiếp: đổi giá trị của một thuộc tính hiện có bằng giá trị nguy hiểm
      const vals = [
        'javascript:alert(1)',
        'url(http://evil.invalid/x)',
        'NaN',
        '1e999',
        '-1',
        '',
        'expression(1)',
        '#nope',
        'data:text/html;base64,PGI+',
        'calc(1px + 2px)',
      ];
      const m = /(s[a-z:-]+=")[^"]*"/.exec(s.slice(pos));
      if (m) {
        const at = pos + m.index;
        s = s.slice(0, at) + m[1] + pick(rnd, vals) + '"' + s.slice(at + m[0].length);
      }
    } else {
      const a = ri(rnd, 0, s.length); // xóa một đoạn
      s = s.slice(0, a) + s.slice(a + ri(rnd, 1, 300));
    }
  }
  const bytes = Buffer.from(s, 'utf8');
  if (rnd() < 0.03 && bytes.length > 0) {
    bytes[ri(rnd, 0, bytes.length - 1)] = ri(rnd, 128, 255); // 3 %: một byte hỏng (UTF-8 không hợp lệ)
    kinds.push(9);
  }
  return { bytes, kinds };
}

function runBlock(seed, cases, report, deadline) {
  for (let i = 0; i < cases; i++) {
    if (deadline && Date.now() > deadline) return false;
    const rnd = mulberry32(mix(seed, i));
    const src = pick(rnd, corpus);
    const { bytes, kinds } = mutate(rnd, src.bytes);
    const id = `seed${seed}#${i} (${src.name}, ops ${kinds.join(',')})`;
    const fail = (why) => {
      report.failures.push({ id, why, bytes: bytes.length });
      if (keepDir) {
        mkdirSync(resolve(keepDir), { recursive: true });
        writeFileSync(join(resolve(keepDir), `fail-seed${seed}-${i}.svg`), bytes);
      }
    };
    const t0 = performance.now();
    let r;
    try {
      r = importSvg(bytes, { fileName: 'fuzz.svg', uid: makeSeededUid(7) });
    } catch (e) {
      report.thrown++;
      fail(`ném lỗi: ${String(e?.stack ?? e).slice(0, 300)}`);
      continue;
    }
    const ms = performance.now() - t0;
    report.cases++;
    report.totalMs += ms;
    if (ms > report.maxMs) {
      report.maxMs = ms;
      report.slowest = id;
    }
    if (ms > PER_CASE_MS) {
      report.slow++;
      fail(`quá ${PER_CASE_MS} ms: ${ms.toFixed(0)} ms`);
    }
    if (r.ok) {
      report.ok++;
      try {
        assertAllowlisted(r.svg);
      } catch (e) {
        report.allowlistViolations++;
        fail(`ok:true nhưng ${String(e.message).slice(0, 200)}`);
        continue;
      }
      try {
        const again = importSvg(r.svg, { fileName: 'fuzz2.svg', uid: makeSeededUid(7) });
        if (!again.ok) {
          report.reimportRejected++;
          fail(`nhập lại bản đã nhập bị từ chối: ${again.error.code}`);
        }
      } catch (e) {
        report.thrown++;
        fail(`nhập lại ném lỗi: ${String(e?.message ?? e).slice(0, 200)}`);
      }
    } else {
      report.rejected++;
      const code = r.error?.code;
      report.rejectCodes[code] = (report.rejectCodes[code] ?? 0) + 1;
      if (typeof code !== 'string' || !code.startsWith('E_IMPORT_'))
        fail(`ok:false với mã lạ: ${code}`);
    }
  }
  return true;
}

const report = {
  cases: 0,
  ok: 0,
  rejected: 0,
  thrown: 0,
  slow: 0,
  allowlistViolations: 0,
  reimportRejected: 0,
  rejectCodes: {},
  failures: [],
  totalMs: 0,
  maxMs: 0,
  slowest: '',
};
const t0 = Date.now();
if (MINUTES > 0) {
  const deadline = t0 + MINUTES * 60_000;
  for (let s = SEED; runBlock(s, CASES, report, deadline); s++) {
    console.log(`khối seed ${s}: ${report.cases} ca, ${report.failures.length} lỗi`);
  }
} else {
  runBlock(SEED, CASES, report, 0);
}
const wall = (Date.now() - t0) / 1000;
const summary = {
  feature: '008-svg-import-binding',
  task: 'T113',
  node: process.version,
  seed: SEED,
  requestedCases: MINUTES > 0 ? `đến ${MINUTES} phút` : CASES,
  corpus: corpus.length,
  cases: report.cases,
  importedOk: report.ok,
  rejected: report.rejected,
  rejectCodes: report.rejectCodes,
  thrown: report.thrown,
  slowOver2s: report.slow,
  allowlistViolations: report.allowlistViolations,
  reimportRejected: report.reimportRejected,
  maxCaseMs: Math.round(report.maxMs),
  slowestCase: report.slowest,
  meanCaseMs: report.cases ? Math.round((report.totalMs / report.cases) * 10) / 10 : 0,
  wallSeconds: Math.round(wall * 10) / 10,
  budgetSeconds: MINUTES > 0 ? MINUTES * 60 : 180,
  failures: report.failures.slice(0, 50),
  pass:
    report.failures.length === 0 &&
    report.thrown === 0 &&
    report.cases >= (MINUTES > 0 ? 1 : CASES) &&
    (MINUTES > 0 || wall <= 180),
};
if (out) {
  mkdirSync(resolve(out, '..'), { recursive: true });
  writeFileSync(resolve(out), JSON.stringify(summary, null, 2) + '\n');
  console.log('Đã ghi', out);
}
console.log(
  `${summary.cases} ca trong ${summary.wallSeconds} s: ok ${summary.importedOk}, từ chối ${summary.rejected}, ` +
    `ném lỗi ${summary.thrown}, quá 2 s ${summary.slowOver2s}, lọt allowlist ${summary.allowlistViolations}; ` +
    `ca chậm nhất ${summary.maxCaseMs} ms`,
);
console.log(summary.pass ? 'ĐẠT' : 'KHÔNG ĐẠT');
process.exit(summary.pass ? 0 : 1);
