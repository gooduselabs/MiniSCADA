// node --test "tools/svg-demo/*.test.mjs" (T093): project mẫu svg-demo sinh tất định, 0.4.0, đủ 13 loại động hóa, ≥ 30 binding,
// 5 sự kiện, hợp lệ trên bộ kiểm tra TS; tệp đã commit khớp từng byte; `--standard` đúng quy mô màn hình chuẩn 3b.
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const gen = join(root, 'tools/svg-demo/generate.mjs');
const committed = join(root, 'projects/svg-demo');
const validator = join(root, 'tools/project-validator/validate.mjs');
const run = (...args) =>
  spawnSync(process.execPath, [gen, ...args], { cwd: root, encoding: 'utf8' });
const validate = (dir) => {
  const r = spawnSync(process.execPath, [validator, dir], { cwd: root, encoding: 'utf8' });
  return JSON.parse(r.stdout);
};

function tree(dir, rel = '', out = {}) {
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) tree(dir, r, out);
    else if (n !== 'README.md') out[r] = readFileSync(join(dir, r));
  }
  return out;
}
const read = (dir, rel) => JSON.parse(readFileSync(join(dir, rel), 'utf8'));

/** Mọi binding và sự kiện của các file `*.bindings.json` của một project. */
function bindingsOf(dir) {
  const bindings = [];
  const events = [];
  for (const f of Object.keys(tree(dir)).filter((x) => x.endsWith('.bindings.json')))
    for (const e of read(dir, f).elements) {
      bindings.push(...(e.bindings ?? []));
      if (e.events?.click) events.push(e.events.click);
    }
  return { bindings, events };
}

function withTemp(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'mat-svg-demo-'));
  try {
    fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test('chạy lại cho cùng từng byte và khớp bản đã commit', () => {
  withTemp((tmp) => {
    const a = join(tmp, 'a');
    const b = join(tmp, 'b');
    strictEqual(run('--out', a).status, 0);
    strictEqual(run('--out', b).status, 0);
    deepStrictEqual(tree(a), tree(b));
    deepStrictEqual(tree(a), tree(committed));
  });
});

test('project 0.4.0: hai màn hình, một popup, ký hiệu và đồ họa nhập', () => {
  const p = read(committed, 'project.json');
  strictEqual(p.schemaVersion, '0.4.0');
  deepStrictEqual(p.screens, ['bon-nuoc', 'tong-quan', 'bom1']);
  strictEqual(read(committed, 'screens/bom1.screen.json').kind, 'popup');
  const files = Object.keys(tree(committed));
  for (const s of ['pump-centrifugal', 'valve-gate', 'tank-vertical', 'motor-ac', 'pipe-h'])
    ok(files.includes(`graphics/symbols/${s}.svg`), s);
  ok(files.includes('graphics/tram-bom.svg'));
});

test('đủ 13 loại động hóa, ≥ 30 binding, 5 sự kiện, đủ các hành động', () => {
  const { bindings, events } = bindingsOf(committed);
  ok(bindings.length >= 30, `${bindings.length} binding`);
  const kinds = new Set(
    bindings.map((b) =>
      b.target === 'transform.rotate'
        ? b.animation === 'spin'
          ? 'spin'
          : 'rotate'
        : b.target.replace(/^geometry\.(levelPercent|clipLevel)$/, 'level'),
    ),
  );
  for (const k of [
    'text.content',
    'style.fill',
    'style.stroke',
    'level',
    'rotate',
    'spin',
    'transform.translateX',
    'transform.translateY',
    'transform.scale',
    'effect.blink',
    'effect.flow',
    'style.visibility',
    'style.opacity',
  ])
    ok(kinds.has(k), `thiếu loại ${k}`);
  strictEqual(kinds.size, 13);
  ok(events.length >= 5, `${events.length} sự kiện`);
  const actions = new Set(events.map((e) => e.action));
  for (const a of ['toggle', 'write', 'pulse', 'navigate', 'popup', 'closePopup'])
    ok(actions.has(a), a);
});

test('hợp lệ trên bộ kiểm tra TS: 0 lỗi', () => {
  const r = validate(committed);
  strictEqual(r.valid, true, JSON.stringify(r.errors));
  deepStrictEqual(r.errors, []);
});

test('--standard: ≈ 3.000 phần tử, 30 binding, 10 hoạt ảnh, 5 sự kiện, ≥ 100 Tag, hợp lệ; cần --out', () => {
  strictEqual(run('--standard').status, 2);
  withTemp((tmp) => {
    const dir = join(tmp, 'std');
    strictEqual(run('--standard', '--out', dir).status, 0);
    const { bindings, events } = bindingsOf(dir);
    strictEqual(bindings.length, 30);
    strictEqual(events.length, 5);
    const anim = bindings.filter(
      (b) => b.target === 'effect.blink' || b.target === 'effect.flow' || b.animation === 'spin',
    );
    strictEqual(anim.length, 10);
    ok(read(dir, 'tags.json').tags.length >= 100);
    const svg = readFileSync(join(dir, 'graphics/chuan-3b.svg'), 'utf8');
    const n = (svg.match(/data-mat-uid=/g) ?? []).length;
    ok(n >= 3000 && n <= 3100, `${n} phần tử có UID`);
    strictEqual(validate(dir).valid, true);
  });
});
