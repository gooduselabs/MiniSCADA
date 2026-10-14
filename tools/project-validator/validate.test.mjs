// node --test "tools/project-validator/*.test.mjs" (T041, T020 của feature 007): kiểm 0.1, 0.2, 0.3; --migrate so với vector nâng cấp.
import { strictEqual, deepStrictEqual } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cli = join(root, 'tools/project-validator/validate.mjs');
const run = (...args) =>
  spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });

function tree(dir, rel = '', out = {}) {
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) tree(dir, r, out);
    else out[r] = readFileSync(join(dir, r), 'utf8');
  }
  return out;
}

test('tank-demo (0.1 hoặc 0.2) hợp lệ', () => {
  const r = run('projects/tank-demo');
  strictEqual(r.status, 0, r.stdout + r.stderr);
  strictEqual(JSON.parse(r.stdout).valid, true);
});

test('modbus-demo (0.2) hợp lệ', () => {
  const r = run('projects/modbus-demo');
  strictEqual(r.status, 0, r.stdout + r.stderr);
  strictEqual(JSON.parse(r.stdout).errors.length, 0);
});

test('project 0.2 lỗi in mã như vector', () => {
  const dir = 'tests/project-vectors/v02-invalid-addr-syntax';
  const expected = JSON.parse(readFileSync(join(root, dir, 'expected.json'), 'utf8'));
  const r = run(dir);
  strictEqual(r.status, 1);
  const codes = new Set(JSON.parse(r.stdout).errors.map((e) => e.code));
  for (const e of expected.errors) strictEqual(codes.has(e), true, e);
});

test('--migrate của project 0.1 cho đúng vector after/', () => {
  const out = mkdtempSync(join(tmpdir(), 'mat-migrate-'));
  try {
    const dest = join(out, 'p');
    const r = run('--migrate', 'tests/migration-vectors/valid-tank-demo/before', dest);
    strictEqual(r.status, 0, r.stdout + r.stderr);
    const after = tree(join(root, 'tests/migration-vectors/valid-tank-demo/after'));
    const got = tree(dest);
    for (const [f, text] of Object.entries(after)) strictEqual(got[f], text, f);
    deepStrictEqual(
      Object.keys(got).filter((f) => !(f in after)),
      [],
    );
    strictEqual(run('--migrate', 'tests/migration-vectors/valid-tank-demo/before', dest).status, 2);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('dùng sai: thiếu thư mục', () => {
  strictEqual(run().status, 2);
  strictEqual(run('khong-co-thu-muc').status, 2);
});

// ---------- Định dạng 0.3 (feature 007, T020) ----------

test('project 0.3 hợp lệ (vector v03-valid-full)', () => {
  const r = run('tests/project-vectors/v03-valid-full');
  strictEqual(r.status, 0, r.stdout + r.stderr);
  const rep = JSON.parse(r.stdout);
  strictEqual(rep.valid, true);
  strictEqual(rep.errors.length, 0);
});

test('project 0.3 lỗi in mã và đường dẫn như vector', () => {
  const r = run('tests/project-vectors/v03-invalid-widget-unknown');
  strictEqual(r.status, 1);
  const err = JSON.parse(r.stdout).errors.find((e) => e.code === 'E_WIDGET_UNKNOWN');
  strictEqual(err.file, 'screens/main.screen.json');
  strictEqual(err.path, '/items/0/widget');
});

// ---------- Định dạng 0.6 (feature 010, T026) ----------

test('project 0.6 hợp lệ với logging trigger và báo cáo (vector v06-report-valid-shift)', () => {
  const r = run('tests/project-vectors/v06-report-valid-shift');
  strictEqual(r.status, 0, r.stdout + r.stderr);
  const rep = JSON.parse(r.stdout);
  strictEqual(rep.valid, true);
  strictEqual(rep.errors.length, 0);
});

test('project 0.6 lỗi in mã và đường dẫn như vector (E_LOG_TRIGGER, E_RPT_REF_TAG)', () => {
  const a = run('tests/project-vectors/v06-logging-010-invalid-trigger-string');
  strictEqual(a.status, 1);
  const e1 = JSON.parse(a.stdout).errors.find((e) => e.code === 'E_LOG_TRIGGER');
  strictEqual(e1.file, 'logging.json');
  strictEqual(e1.path, '/groups/0/trigger/tagId');
  const b = run('tests/project-vectors/v06-report-invalid-ref-tag');
  strictEqual(b.status, 1);
  const e2 = JSON.parse(b.stdout).errors.find((e) => e.code === 'E_RPT_REF_TAG');
  strictEqual(e2.path, '/reports/0/columns/0/tagId');
});

test('--migrate <thư mục 0.2> chỉ in thay đổi, không ghi đĩa', () => {
  const before = tree(join(root, 'projects/modbus-demo'));
  const r = run('--migrate', 'projects/modbus-demo');
  strictEqual(r.status, 0, r.stdout + r.stderr);
  const rep = JSON.parse(r.stdout);
  strictEqual(rep.ok, true);
  strictEqual(rep.written, null);
  strictEqual(
    rep.changes.some((c) => c.kind === 'screens' && c.count === 1),
    true,
  );
  strictEqual(
    rep.changes.some((c) => c.kind === 'minRuntime' && c.version === '0.6.0'),
    true,
  );
  deepStrictEqual(tree(join(root, 'projects/modbus-demo')), before);
});

function migrateTo(from, want) {
  const out = mkdtempSync(join(tmpdir(), 'mat-migrate03-'));
  try {
    const dest = join(out, 'p');
    const r = run('--migrate', from, '--write', dest);
    strictEqual(r.status, 0, r.stdout + r.stderr);
    strictEqual(JSON.parse(r.stdout).written, dest);
    const after = tree(join(root, want));
    const got = tree(dest);
    for (const [f, text] of Object.entries(after)) strictEqual(got[f], text, f);
    deepStrictEqual(
      Object.keys(got).filter((f) => !(f in after)),
      [],
    );
    // project ghi ra hợp lệ trên bộ kiểm tra 0.3
    strictEqual(run(dest).status, 0);
    // thư mục ra đã có nội dung: từ chối
    strictEqual(run('--migrate', from, '--write', dest).status, 2);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

test('--migrate --write của project 0.2 cho đúng vector after/ (modbus-demo)', () => {
  migrateTo(
    'tests/migration-vectors/modbus-demo-0.2to0.3/before',
    'tests/migration-vectors/modbus-demo-0.2to0.3/after',
  );
});

test('--migrate --write của project 0.1 đi qua 0.2 cho đúng vector after/ (tank-demo)', () => {
  migrateTo(
    'tests/migration-vectors/tank-demo-0.2to0.3/before',
    'tests/migration-vectors/tank-demo-0.2to0.3/after',
  );
});

test('--migrate project đã là 0.3: ALREADY_03, mã thoát 1', () => {
  const r = run('--migrate', 'tests/project-vectors/v03-valid-full');
  strictEqual(r.status, 1);
  strictEqual(JSON.parse(r.stdout).error.code, 'ALREADY_03');
});

test('--migrate dùng sai: thiếu giá trị --write, cờ lạ, thư mục không có', () => {
  strictEqual(run('--migrate', 'projects/modbus-demo', '--write').status, 2);
  strictEqual(run('--migrate', 'projects/modbus-demo', '--ghi', 'x').status, 2);
  strictEqual(run('--migrate', 'khong-co-thu-muc').status, 2);
  strictEqual(run('--migrate').status, 2);
});
