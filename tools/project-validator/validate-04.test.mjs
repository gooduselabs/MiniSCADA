// node --test tools/project-validator (feature 008, T031): kiểm project 0.4 và `--migrate` lên 0.4 (mặc định) hoặc
// `--migrate --to 0.3` (hành vi của feature 007).
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

/** `--migrate <from> --write <dest>` (lên 0.4 mặc định) cho đúng cây `want`; ra hợp lệ; thư mục ra có nội dung bị từ chối. */
function migrate04(from, want) {
  const out = mkdtempSync(join(tmpdir(), 'mat-migrate04-'));
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
    strictEqual(run(dest).status, 0); // hợp lệ trên bộ kiểm tra 0.4
    strictEqual(run('--migrate', from, '--write', dest).status, 2);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

test('project 0.4 hợp lệ (vector v04-valid-full) và lỗi in mã và đường dẫn như vector', () => {
  const ok = run('tests/project-vectors/v04-valid-full');
  strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  strictEqual(JSON.parse(ok.stdout).errors.length, 0);
  const bad = run('tests/project-vectors/v04-invalid-param-period-399');
  strictEqual(bad.status, 1);
  const err = JSON.parse(bad.stdout).errors.find((e) => e.code === 'E_BIND_PARAM');
  strictEqual(err.path, '/elements/0/bindings/0/period');
});

test('--migrate mặc định lên 0.4: dashboard-demo (0.3) cho đúng vector after/', () => {
  migrate04(
    'tests/migration-vectors/dashboard-demo-0.3to0.4/before',
    'tests/migration-vectors/dashboard-demo-0.3to0.4/after',
  );
});

test('--migrate lên 0.4 từ 0.2 và 0.1 (qua 0.3) cho đúng vector after/ của dự án mẫu', () => {
  migrate04(
    'tests/migration-vectors/modbus-demo-0.2to0.3/before',
    'tests/migration-vectors/modbus-demo-0.3to0.4/after',
  );
  migrate04(
    'tests/migration-vectors/tank-demo-0.2to0.3/before',
    'tests/migration-vectors/tank-demo-0.3to0.4/after',
  );
});

test('--migrate project đã là 0.4: ALREADY_04, mã thoát 1; --to lạ hoặc thiếu giá trị: mã thoát 2', () => {
  const r = run('--migrate', 'tests/project-vectors/v04-valid-full');
  strictEqual(r.status, 1);
  strictEqual(JSON.parse(r.stdout).error.code, 'ALREADY_04');
  strictEqual(run('--migrate', 'projects/modbus-demo', '--to', '0.9').status, 2);
  strictEqual(run('--migrate', 'projects/modbus-demo', '--to').status, 2);
});

test('--migrate không ghi đĩa khi thiếu --write; báo minRuntime 0.7.0', () => {
  const before = tree(join(root, 'projects/dashboard-demo'));
  const r = run('--migrate', 'projects/dashboard-demo');
  strictEqual(r.status, 0, r.stdout + r.stderr);
  const rep = JSON.parse(r.stdout);
  strictEqual(rep.written, null);
  strictEqual(
    rep.changes.some((c) => c.kind === 'minRuntime' && c.version === '0.7.0'),
    true,
  );
  deepStrictEqual(tree(join(root, 'projects/dashboard-demo')), before);
});
