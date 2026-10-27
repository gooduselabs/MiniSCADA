// Khói của fuzz phía TS (feature 011, T058, T142, T165): mỗi mục tiêu 300 ca tất định đạt; bộ canh bắt được treo,
// ngoại lệ, vi phạm bất biến (mục tiêu giả _selftest); cùng seed cho cùng thống kê; kho mầm khớp SHA256SUMS và script.
// Bản dài chạy tay: `node tools/fuzz/ts-fuzz.mjs --target <tên> --seconds 3600 --report docs/reports/011-fuzz-x64.json`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve(import.meta.dirname, 'ts-fuzz.mjs');
const TARGETS = ['project-json', 'expression', 'params', 'package-digest', 'logic-json'];

const run = (target, cases, seed = 7) => {
  const out = join(mkdtempSync(join(tmpdir(), 'ts-fuzz-')), 'r.json');
  const r = spawnSync(
    process.execPath,
    [
      script,
      '--target',
      target,
      '--max-cases',
      String(cases),
      '--seed',
      String(seed),
      '--out',
      out,
    ],
    { encoding: 'utf8' },
  );
  return {
    status: r.status,
    log: r.stdout + r.stderr,
    report: JSON.parse(readFileSync(out, 'utf8')),
  };
};

for (const t of TARGETS)
  test(`${t}: 300 ca không sự cố`, () => {
    const { status, log, report } = run(t, 300);
    assert.equal(status, 0, log);
    assert.equal(report.cases, 300);
    assert.equal(report.crashes, 0);
    assert.ok(Object.keys(report.counters).length > 0);
  });

test('tất định: cùng seed cho cùng thống kê', () => {
  const a = run('expression', 400, 3).report;
  const b = run('expression', 400, 3).report;
  assert.deepEqual(a.counters, b.counters);
});

test('bộ canh: treo, ngoại lệ, vi phạm bất biến đều là sự cố; chạy tiếp sau ca treo', () => {
  const { status, report } = run('_selftest', 10);
  assert.equal(status, 1);
  assert.equal(report.hangs, 1);
  assert.equal(report.crashes, 3);
  assert.deepEqual(
    report.findingSamples.map((f) => f.case).sort((x, y) => x - y),
    [3, 5, 7],
  );
  assert.equal(report.cases, 9);
});

test('kho mầm tests/fuzz-corpus khớp script và SHA256SUMS', () => {
  const r = spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, 'make-corpus.mjs'), '--check'],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
