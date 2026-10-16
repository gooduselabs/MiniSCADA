// Kiểm UID và binding qua vòng Nạp xuống rồi Đọc lên (feature 008, FR-029, T103):
//   node tools/svg-demo/uid-roundtrip.mjs --before <project gửi xuống> --after <project đọc lên> [--out báo cáo.json]
// `--before` là thư mục project trước khi Nạp xuống (ví dụ projects/svg-demo); `--after` là thư mục Studio ghi sau khi Đọc lên từ
// runtime x64 (Online › Đọc lên; thư mục khác). Kiểm: mọi tệp SVG đồ họa còn đủ và đúng tập `data-mat-uid`; mọi file binding giống
// nhau theo cấu trúc (JSON); `elements` của item `svg` không đổi; tập tệp `graphics/` và `screens/` như nhau. Không có `--after`:
// thoát mã 3 "CHƯA CHẠY" (cần runtime x64 cho Nạp xuống và Đọc lên, nên cần Docker). Mã thoát: 0 giữ nguyên, 1 có khác biệt.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { deepStrictEqual } from 'node:assert';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const before = opt('--before');
const after = opt('--after');
if (!before || !after) {
  console.log('CHƯA CHẠY: cần --before và --after (project sau Đọc lên từ runtime x64).');
  process.exit(3);
}

function tree(dir, rel = '', out = {}) {
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) tree(dir, r, out);
    else if (/\.(json|svg)$/.test(n)) out[r] = readFileSync(join(dir, r), 'utf8');
  }
  return out;
}
const uidsOf = (svg) => [...svg.matchAll(/data-mat-uid="([^"]+)"/g)].map((m) => m[1]).sort();

for (const d of [before, after])
  if (!existsSync(d)) {
    console.error(`Không có thư mục ${d}`);
    process.exit(2);
  }
const a = tree(resolve(before));
const b = tree(resolve(after));
const results = [];
const check = (name, fn) => {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (e) {
    results.push({ name, pass: false, detail: String(e.message ?? e).split('\n')[0] });
  }
};
const graphics = (t) =>
  Object.keys(t).filter((k) => k.startsWith('graphics/') && k.endsWith('.svg'));
const bindings = (t) => Object.keys(t).filter((k) => k.endsWith('.bindings.json'));
const screens = (t) => Object.keys(t).filter((k) => k.endsWith('.screen.json'));

check('tập tệp SVG đồ họa như nhau', () => deepStrictEqual(graphics(a), graphics(b)));
check('tập file binding như nhau', () => deepStrictEqual(bindings(a), bindings(b)));
check('tập màn hình như nhau', () => deepStrictEqual(screens(a), screens(b)));
for (const f of graphics(a))
  check(`UID của ${f} không đổi (${uidsOf(a[f]).length} phần tử)`, () =>
    deepStrictEqual(uidsOf(a[f]), uidsOf(b[f] ?? '')),
  );
for (const f of bindings(a))
  check(`binding và sự kiện của ${f} giữ nguyên`, () =>
    deepStrictEqual(JSON.parse(a[f]), JSON.parse(b[f] ?? 'null')),
  );
for (const f of screens(a))
  check(`item svg và elements của ${f} giữ nguyên`, () => {
    const pick = (t) => JSON.parse(t).items.filter((i) => i.type === 'svg');
    deepStrictEqual(pick(a[f]), pick(b[f] ?? '{"items":[]}'));
  });

for (const r of results)
  console.log(`${r.pass ? '✔' : '✘'} ${r.name}${r.pass ? '' : ` — ${r.detail}`}`);
const failed = results.filter((r) => !r.pass).length;
const out = opt('--out');
if (out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), JSON.stringify({ before, after, results }, null, 2) + '\n');
}
console.log(`${results.length - failed} đạt, ${failed} không đạt`);
process.exit(failed ? 1 : 0);
