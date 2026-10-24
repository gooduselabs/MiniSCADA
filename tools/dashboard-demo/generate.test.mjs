// node --test "tools/dashboard-demo/*.test.mjs" (T021, T175): project mẫu dashboard-demo sinh tất định, đủ 15 loại widget,
// hợp lệ trên bộ kiểm tra TS (0 lỗi), và tệp đã commit ở projects/dashboard-demo khớp từng byte với đầu ra mới. Từ feature
// 011 project là 1.0.0: phần nền bằng đúng đầu ra của migration 0.3 -> 1.0 (vector đóng băng), cộng template `bom`,
// màn hình "Bơm" 20 bản sao và faceplate `bom-chi-tiet` (SC-037).
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { substituteParams } from '@mat/project-schema';

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

test('--format 0.3 cho đúng bản đóng băng tests/fixtures/dashboard-demo-0.3 (và vector migration 0.3 dùng nó); cần --out', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mat-dashboard-'));
  try {
    strictEqual(run('--format', '0.3', '--out', tmp).status, 0);
    const fresh = tree(tmp);
    for (const ref of [
      'tests/fixtures/dashboard-demo-0.3',
      'tests/migration-vectors/0.6-to-1.0/from-0.3-dashboard-demo/before',
    ]) {
      const have = tree(join(root, ref));
      deepStrictEqual(Object.keys(have), Object.keys(fresh), ref);
      for (const k of Object.keys(fresh)) ok(have[k].equals(fresh[k]), `${ref}/${k} lệch`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  strictEqual(run('--format', '0.3').status, 2);
  strictEqual(run('--format', '0.9', '--out', tmpdir()).status, 2);
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

const validate = (dir) => {
  const r = spawnSync(process.execPath, [join(root, 'tools/project-validator/validate.mjs'), dir], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: r.status, out: r.stdout + r.stderr, report: JSON.parse(r.stdout) };
};

test('validator TS: 0 lỗi, không W_TEMPLATE_DRIFT', () => {
  const r = validate(committed);
  strictEqual(r.status, 0, r.out);
  deepStrictEqual(r.report.errors, []);
  deepStrictEqual(
    r.report.warnings.filter((w) => w.code.includes('TEMPLATE')),
    [],
  );
});

test('6 màn hình, menu 4 mục, project 1.0.0 cần runtime 1.0.0, khai template bom', () => {
  const p = read('project.json');
  strictEqual(p.schemaVersion, '1.0.0');
  strictEqual(p.minRuntimeVersion, '1.0.0');
  deepStrictEqual(p.screens, ['tong-quan', 'bon-nuoc', 'giam-sat', 'bom1', 'bom', 'bom-chi-tiet']);
  deepStrictEqual(p.templates, ['templates/bom.template.json']);
  strictEqual(p.entryScreen, 'tong-quan');
  deepStrictEqual(
    p.navigation.items.map((i) => i.screen),
    ['tong-quan', 'bon-nuoc', 'giam-sat', 'bom'],
  );
  strictEqual(read('screens/bom1.screen.json').kind, 'popup');
  strictEqual(read('screens/bom-chi-tiet.screen.json').kind, 'popup');
  strictEqual(read('screens/tong-quan.screen.json').size.width, 1920);
});

test('phần nền bằng đúng đầu ra của migrateTo10 trên bản 0.3 đóng băng (tests/migration-vectors)', () => {
  const after = join(root, 'tests/migration-vectors/0.6-to-1.0/from-0.3-dashboard-demo/after');
  const ref = tree(after);
  const have = tree(committed);
  for (const k of Object.keys(ref)) {
    if (k === 'project.json' || k === 'tags.json') continue;
    ok(have[k]?.equals(ref[k]), `${k} khác vector migration`);
  }
  // tags.json: các dòng Tag của phần nền giữ nguyên, Tag của 20 bơm thêm sau
  const refTags = JSON.parse(ref['tags.json'].toString('utf8')).tags;
  const tags = read('tags.json').tags;
  deepStrictEqual(tags.slice(0, refTags.length), refTags);
  ok(tags.slice(refTags.length).every((t) => /^PUMP\d\d\./.test(t.id)));
  // project.json: mọi khóa của phần nền giữ giá trị, trừ phần thêm (màn hình, mục menu, templates)
  const refP = JSON.parse(ref['project.json'].toString('utf8'));
  const p = read('project.json');
  for (const k of Object.keys(refP)) {
    if (k === 'screens') deepStrictEqual(p.screens.slice(0, refP.screens.length), refP.screens);
    else if (k === 'navigation')
      deepStrictEqual(
        p.navigation.items.slice(0, refP.navigation.items.length),
        refP.navigation.items,
      );
    else deepStrictEqual(p[k], refP[k], k);
  }
});

const PUMPS = Array.from({ length: 20 }, (_, i) => ({
  inst: `pump${i + 1}`,
  prefix: `PUMP${String(i + 1).padStart(2, '0')}`,
  title: `Bơm ${i + 1}`,
}));

test('màn hình Bơm: 20 bản sao của template bom, bung bằng substituteParams, tpl.params trên mọi item', () => {
  const tpl = read('templates/bom.template.json');
  strictEqual(tpl.id, 'bom');
  deepStrictEqual(
    tpl.params.map((p) => [p.name, p.kind]),
    [
      ['prefix', 'tagPrefix'],
      ['title', 'string'],
    ],
  );
  const s = read('screens/bom.screen.json');
  const own = s.items.filter((i) => i.tpl);
  strictEqual(own.length, 20 * tpl.items.length);
  strictEqual(s.items.length - own.length, 1); // khung tiêu đề
  for (const { inst, prefix, title } of PUMPS) {
    const items = own.filter((i) => i.tpl.inst === inst);
    deepStrictEqual(
      items.map((i) => i.id),
      tpl.items.map((t) => `${inst}.${t.id}`),
    );
    const dx = items[0].x - tpl.items[0].x;
    const dy = items[0].y - tpl.items[0].y;
    for (const [k, it] of items.entries()) {
      const t = tpl.items[k];
      deepStrictEqual(it.tpl, { inst, tid: 'bom', rid: t.id, params: { prefix, title } });
      const r = substituteParams(t, tpl.params, { prefix, title }, { template: true });
      ok(r.ok);
      deepStrictEqual(
        { ...it, tpl: undefined },
        { ...r.value, id: it.id, x: t.x + dx, y: t.y + dy, tpl: undefined },
      );
    }
    const card = items.find((i) => i.tpl.rid === 'flow');
    strictEqual(card.tags.value, `${prefix}.FLOW`);
    strictEqual(card.props.label, `${title} (lưu lượng)`);
    strictEqual(items.find((i) => i.tpl.rid === 'lamp').tags.state, `${prefix}.RUN`);
    deepStrictEqual(items.find((i) => i.tpl.rid === 'detail').events.click, {
      action: 'popup',
      screen: 'bom-chi-tiet',
      args: { prefix, title },
    });
  }
});

test('faceplate bom-chi-tiet: 20 bộ args khác nhau, mỗi bộ thay ra Tag có thật đúng kiểu', () => {
  const fp = read('screens/bom-chi-tiet.screen.json');
  const callers = read('screens/bom.screen.json').items.filter(
    (i) => i.events?.click?.action === 'popup' && i.events.click.screen === 'bom-chi-tiet',
  );
  const combos = new Set(callers.map((i) => JSON.stringify(i.events.click.args)));
  strictEqual(combos.size, 20);
  const tags = new Map(read('tags.json').tags.map((t) => [t.id, t]));
  for (const { prefix, title } of PUMPS) {
    for (const item of fp.items) {
      const r = substituteParams(item, fp.params, { prefix, title });
      ok(r.ok, JSON.stringify(r.problems));
      for (const v of Object.values(r.value.tags ?? {}).flat()) {
        ok(v.startsWith(`${prefix}.`), v);
        ok(tags.has(v), `thiếu Tag ${v}`);
      }
      if (item.id === 'run_sw') strictEqual(tags.get(r.value.tags.target).access, 'RW');
      if (item.id === 'panel_f') strictEqual(r.value.props.title, title);
    }
  }
});

test('validator bung thật 20 bộ args: bỏ một Tag chỉ faceplate dùng (PUMP13.FAULT) thì E_TEMPLATE_TAG_REF ở bom-chi-tiet', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mat-dashboard-'));
  try {
    cpSync(committed, tmp, { recursive: true });
    const f = join(tmp, 'tags.json');
    const text = readFileSync(f, 'utf8');
    const lines = text.split('\n').filter((l) => !l.includes('"id":"PUMP13.FAULT"'));
    strictEqual(lines.length, text.split('\n').length - 1);
    writeFileSync(f, lines.join('\n'));
    const r = validate(tmp);
    strictEqual(r.status, 1, r.out);
    const errs = r.report.errors;
    ok(errs.length > 0);
    ok(
      errs.every(
        (e) =>
          e.code === 'E_TEMPLATE_TAG_REF' &&
          e.file === 'screens/bom-chi-tiet.screen.json' &&
          e.message.includes('PUMP13'),
      ),
      JSON.stringify(errs),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('Tag của 20 bơm: RUN (BOOL), FLOW (FLOAT32, mỗi bơm một giá trị cố định), RUN_CMD (BOOL RW), FAULT (BOOL)', () => {
  const tags = new Map(read('tags.json').tags.map((t) => [t.id, t]));
  const flows = new Set();
  for (const { prefix } of PUMPS) {
    strictEqual(tags.get(`${prefix}.RUN`)?.type, 'BOOL', prefix);
    strictEqual(tags.get(`${prefix}.FLOW`)?.type, 'FLOAT32', prefix);
    strictEqual(tags.get(`${prefix}.RUN_CMD`)?.access, 'RW', prefix);
    strictEqual(tags.get(`${prefix}.FAULT`)?.type, 'BOOL', prefix);
    flows.add(tags.get(`${prefix}.FLOW`).sim.initial);
  }
  strictEqual(flows.size, 20);
});

test('Tổng quan: 1 item svg và ít nhất 24 widget, đủ 15 loại của danh mục 007 (widget nhóm alarm của 009 và nhóm lịch sử của 010 có dự án mẫu riêng)', () => {
  const catalog = JSON.parse(readFileSync(join(root, 'schemas/widgets.catalog.json'), 'utf8'));
  const items = read('screens/tong-quan.screen.json').items;
  strictEqual(items.filter((i) => i.type === 'svg').length, 1);
  const widgets = items.filter((i) => i.type === 'widget');
  ok(widgets.length >= 24, `chỉ có ${widgets.length} widget`);
  const used = new Set(widgets.map((w) => w.widget));
  // Project mẫu này (phần nền 0.3, nay 1.0): minh họa 15 loại của danh mục 007. Widget nhóm "alarm" (feature 009) cần project 0.5
  // (alarms.json) và nhóm "history" (feature 010) cần project 0.6 nên có dự án mẫu riêng, không đưa vào đây.
  // 7 widget của feature 014 (thẻ chỉ số màu…) minh họa ở projects/grid-demo, không ở đây.
  const f014 = new Set(['stat-tile', 'kpi', 'progress', 'status-list', 'clock', 'text', 'image']);
  const own = catalog.widgets.filter(
    (w) => w.group !== 'alarm' && w.group !== 'history' && !f014.has(w.id),
  );
  for (const w of own) ok(used.has(w.id), `thiếu loại ${w.id}`);
  strictEqual(own.length, 15);
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
