// node --test "tools/project-validator/*.test.mjs" (T041): kiểm 0.1 và 0.2, và --migrate so với vector nâng cấp.
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
