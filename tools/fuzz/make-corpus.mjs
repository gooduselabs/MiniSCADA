// Sinh kho mầm nhỏ tests/fuzz-corpus/ cho fuzz phía TS (feature 011, T058, T142; FR-029) từ các bộ vector đã có, tất
// định, rồi ghi SHA256SUMS. Không sửa tay tệp trong kho mầm: sửa script này rồi chạy lại.
//   node tools/fuzz/make-corpus.mjs           (ghi lại kho mầm)
//   node tools/fuzz/make-corpus.mjs --check   (chỉ so: kho mầm khớp script và SHA256SUMS; mã thoát 1 nếu lệch)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, 'tests/fuzz-corpus');
const check = process.argv.includes('--check');

function walkFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

// ---------- project-json: project nhỏ (≤ 24 KB) mọi định dạng, đúng và sai ----------
const PV = join(ROOT, 'tests/project-vectors');
const dirs = readdirSync(PV)
  .filter((d) => statSync(join(PV, d)).isDirectory())
  .sort();
const sizeOf = (d) => walkFiles(join(PV, d)).reduce((n, f) => n + statSync(f).size, 0);
const prefixOf = (d) => (/^v\d\d-/.test(d) ? d.slice(0, 3) : d.split('-')[0]);
const chosen = [];
const perPrefix = new Map();
for (const d of dirs) {
  if (sizeOf(d) > 24 * 1024) continue;
  const valid = /valid/.test(d) && !/invalid/.test(d);
  const key = prefixOf(d) + (valid ? ':valid' : ':other');
  const n = perPrefix.get(key) ?? 0;
  const cap = prefixOf(d) === 'v10' ? (valid ? 8 : 10) : valid ? 3 : 2;
  if (n >= cap) continue;
  perPrefix.set(key, n + 1);
  chosen.push(d);
}
const projects = chosen.map((d) => {
  const files = {};
  for (const f of walkFiles(join(PV, d))) {
    const rel = relative(join(PV, d), f).split('\\').join('/');
    if (rel === 'expected.json' || rel.startsWith('README')) continue;
    files[rel] = readFileSync(f, 'utf8');
  }
  return { name: d, files };
});

// ---------- expression: biểu thức của tests/expression-vectors (≤ 2.000 ký tự, bỏ trùng) ----------
const EV = join(ROOT, 'tests/expression-vectors');
const exprs = [];
const seenExpr = new Set();
for (const f of readdirSync(EV)
  .filter((x) => x.endsWith('.json'))
  .sort()) {
  for (const c of JSON.parse(readFileSync(join(EV, f), 'utf8')).cases) {
    if (typeof c.expr !== 'string' || c.expr.length > 2000) continue;
    const key = c.expr + '|' + c.target;
    if (seenExpr.has(key)) continue;
    seenExpr.add(key);
    const types = Object.fromEntries(Object.entries(c.inputs ?? {}).map(([k, v]) => [k, v.type]));
    exprs.push({ expr: c.expr, types, target: c.target, tables: c.tables ?? {} });
  }
}

// ---------- params: item có {tham số} của template và màn hình popup v10 ----------
const paramSeeds = [];
const seenParam = new Set();
for (const p of projects) {
  for (const [rel, text] of Object.entries(p.files)) {
    let j;
    try {
      j = JSON.parse(text.replace(/^\ufeff/, ''));
    } catch {
      continue;
    }
    if (!Array.isArray(j?.params) || !Array.isArray(j?.items)) continue;
    const template = rel.startsWith('templates/');
    for (const item of j.items) {
      const key = JSON.stringify([j.params, item, template]);
      if (!key.includes('{') || seenParam.has(key)) continue;
      seenParam.add(key);
      paramSeeds.push({ from: `${p.name}/${rel}`, template, params: j.params, item });
    }
  }
}
const argSeeds = [];
const seenArgs = new Set();
for (const p of projects)
  for (const text of Object.values(p.files)) {
    for (const m of text.matchAll(/"args": (\{[^{}]*\})/g)) {
      if (seenArgs.has(m[1])) continue;
      seenArgs.add(m[1]);
      try {
        argSeeds.push(JSON.parse(m[1]));
      } catch {
        // không phải JSON trọn: bỏ
      }
    }
  }

// ---------- logic-json: mọi ca của tests/logic-vectors (bỏ mô tả) ----------
const LV = join(ROOT, 'tests/logic-vectors');
const logic = [];
for (const f of readdirSync(LV)
  .filter((x) => x.endsWith('.json'))
  .sort()) {
  for (const c of JSON.parse(readFileSync(join(LV, f), 'utf8')).cases) {
    const rest = { ...c };
    delete rest.description;
    logic.push(rest);
  }
}

const files = {
  'project-json.json': JSON.stringify(projects) + '\n',
  'expression.json': JSON.stringify(exprs) + '\n',
  'params.json': JSON.stringify({ items: paramSeeds, args: argSeeds }) + '\n',
  'logic-json.json': JSON.stringify(logic) + '\n',
};
const sha = (s) => createHash('sha256').update(s).digest('hex');
const sums =
  Object.entries(files)
    .map(([n, s]) => `${sha(s)}  ${n}`)
    .join('\n') + '\n';

if (check) {
  let bad = 0;
  for (const [n, s] of Object.entries(files)) {
    const p = join(OUT, n);
    if (!existsSync(p) || readFileSync(p, 'utf8') !== s) {
      console.error(`lệch: ${n}`);
      bad++;
    }
  }
  if (
    !existsSync(join(OUT, 'SHA256SUMS')) ||
    readFileSync(join(OUT, 'SHA256SUMS'), 'utf8') !== sums
  ) {
    console.error('lệch: SHA256SUMS');
    bad++;
  }
  process.exit(bad ? 1 : 0);
}
mkdirSync(OUT, { recursive: true });
for (const [n, s] of Object.entries(files)) writeFileSync(join(OUT, n), s);
writeFileSync(join(OUT, 'SHA256SUMS'), sums);
console.log(
  JSON.stringify({
    projects: projects.length,
    expressions: exprs.length,
    paramItems: paramSeeds.length,
    paramArgs: argSeeds.length,
    logicCases: logic.length,
    bytes: Object.fromEntries(Object.entries(files).map(([n, s]) => [n, Buffer.byteLength(s)])),
  }),
);
