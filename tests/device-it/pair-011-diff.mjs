// So hai bản ghi của pair-011-rig.mjs (specs/011-pilot-hardening T200): in mọi đường dẫn JSON có giá trị khác, thiếu
// hay thêm, và số đường dẫn giống. Dùng: node tests/device-it/pair-011-diff.mjs old.json new.json [--json]
import { readFileSync } from 'node:fs';

const [a, b] = process.argv.slice(2, 4).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const IGNORE = /^(label|runtimeVersionCli)$/;

function flatten(v, path = '', out = {}) {
  if (v && typeof v === 'object' && !(Array.isArray(v) && v.every((x) => typeof x !== 'object'))) {
    for (const [k, x] of Object.entries(v)) flatten(x, path ? `${path}.${k}` : k, out);
  } else out[path] = JSON.stringify(v);
  return out;
}
const fa = flatten(a);
const fb = flatten(b);
const keys = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter((k) => !IGNORE.test(k));
const diff = [];
let same = 0;
for (const k of keys) {
  if (fa[k] === fb[k]) same++;
  else diff.push({ path: k, old: fa[k] ?? '(không có)', new: fb[k] ?? '(không có)' });
}
if (process.argv.includes('--json'))
  process.stdout.write(JSON.stringify({ same, diff }, null, 2) + '\n');
else {
  for (const d of diff) console.log(`${d.path}\n    cũ: ${d.old}\n   mới: ${d.new}`);
  console.log(`\n${same} đường dẫn giống, ${diff.length} khác`);
}
