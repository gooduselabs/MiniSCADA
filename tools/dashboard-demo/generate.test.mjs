// node --test "tools/dashboard-demo/*.test.mjs" (T021): project mẫu dashboard-demo sinh tất định, đủ 15 loại widget,
// hợp lệ trên bộ kiểm tra TS (0 lỗi), và tệp đã commit ở projects/dashboard-demo khớp từng byte với đầu ra mới.
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const gen = join(root, 'tools/dashboard-demo/generate.mjs');
const committed = join(root, 'projects/dashboard-demo');
const run = (...args) =>
  spawnSync(process.execPath, [gen, ...args], { cwd: root, encoding: 'utf8' });

function tree(dir, rel = '', out = {}) {
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) tree(dir, r, out);
    else if (n !== 'README.md') out[r] = readFileSync(join(dir, r));
  }
  return out;
}
const read = (rel) => JSON.parse(readFileSync(join(committed, rel), 'utf8'));

function generateTwice(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'mat-dashboard-'));
  try {
    const a = join(tmp, 'a');
    const b = join(tmp, 'b');
    strictEqual(run('--out', a).status, 0);
    strictEqual(run('--out', b).status, 0);
    fn(a, b);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('chạy lại cho cùng từng byte', () => {
  generateTwice((a, b) => {
    const ta = tree(a);
    const tb = tree(b);
    deepStrictEqual(Object.keys(ta), Object.keys(tb));
    for (const k of Object.keys(ta)) ok(ta[k].equals(tb[k]), k);
  });
});

test('tệp đã commit ở projects/dashboard-demo khớp đầu ra của công cụ', () => {
  generateTwice((a) => {
    const fresh = tree(a);
    const have = tree(committed);
    deepStrictEqual(Object.keys(have), Object.keys(fresh));
    for (const k of Object.keys(fresh))
      ok(have[k].equals(fresh[k]), `${k} lệch: chạy lại node tools/dashboard-demo/generate.mjs`);
  });
});

test('ghi đè thư mục không phải project bị từ chối (mã 2)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mat-dashboard-'));
  try {
    writeFileSync(join(tmp, 'khac.txt'), 'x');
    strictEqual(run('--out', tmp).status, 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('validator TS: 0 lỗi', () => {
  const r = spawnSync(
    process.execPath,
    [join(root, 'tools/project-validator/validate.mjs'), committed],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  strictEqual(r.status, 0, r.stdout + r.stderr);
  deepStrictEqual(JSON.parse(r.stdout).errors, []);
});

test('4 màn hình, menu 3 mục, project 0.3.0 cần runtime 0.6.0', () => {
  const p = read('project.json');
  strictEqual(p.schemaVersion, '0.3.0');
  strictEqual(p.minRuntimeVersion, '0.6.0');
  deepStrictEqual(p.screens, ['tong-quan', 'bon-nuoc', 'giam-sat', 'bom1']);
  strictEqual(p.entryScreen, 'tong-quan');
  deepStrictEqual(
    p.navigation.items.map((i) => i.screen),
    ['tong-quan', 'bon-nuoc', 'giam-sat'],
  );
  strictEqual(read('screens/bom1.screen.json').kind, 'popup');
  strictEqual(read('screens/tong-quan.screen.json').size.width, 1920);
});

test('Tổng quan: 1 item svg và ít nhất 24 widget, đủ 15 loại của danh mục', () => {
  const catalog = JSON.parse(readFileSync(join(root, 'schemas/widgets.catalog.json'), 'utf8'));
  const items = read('screens/tong-quan.screen.json').items;
  strictEqual(items.filter((i) => i.type === 'svg').length, 1);
  const widgets = items.filter((i) => i.type === 'widget');
  ok(widgets.length >= 24, `chỉ có ${widgets.length} widget`);
  const used = new Set(widgets.map((w) => w.widget));
  for (const w of catalog.widgets) ok(used.has(w.id), `thiếu loại ${w.id}`);
  strictEqual(catalog.widgets.length, 15);
});

test('Giám sát có biểu đồ; Tag của modbus-demo đều có mặt cùng Tag mô phỏng SIM.*', () => {
  const kinds = new Set(read('screens/giam-sat.screen.json').items.map((i) => i.widget));
  for (const k of ['line', 'bar', 'pie', 'tag-table']) ok(kinds.has(k), k);
  const ids = new Set(read('tags.json').tags.map((t) => t.id));
  const modbus = JSON.parse(readFileSync(join(root, 'projects/modbus-demo/tags.json'), 'utf8'));
  for (const t of modbus.tags) ok(ids.has(t.id), t.id);
  ok([...ids].some((i) => i.startsWith('SIM.')));
  // Tag mô phỏng tất định: mỗi Tag `random` có seed
  for (const t of read('tags.json').tags.filter((t) => t.sim?.kind === 'random'))
    ok(t.sim.seed !== undefined);
});
