// Khói của fuzz mở/dán SVG của trình vẽ (feature 011, T165): 300 ca tất định; bản đầy đủ chạy tay hoặc ở CI
// (`node tools/fuzz/svg-sanitize.mjs --cases 100000`).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve(import.meta.dirname, 'svg-sanitize.mjs');

const run = (cases, seed) => {
  const out = join(mkdtempSync(join(tmpdir(), 'svg-edit-fuzz-')), 'r.json');
  const r = spawnSync(
    process.execPath,
    [script, '--cases', String(cases), '--seed', String(seed), '--out', out],
    {
      encoding: 'utf8',
    },
  );
  return {
    status: r.status,
    log: r.stdout + r.stderr,
    report: JSON.parse(readFileSync(out, 'utf8')),
  };
};

test('300 ca: không ném lỗi, không chậm, không lọt allowlist', () => {
  const { status, log, report } = run(300, 11);
  assert.equal(status, 0, log);
  assert.equal(report.cases, 300);
  assert.equal(report.failures, 0);
  assert.equal(report.slowOver2s, 0);
  assert.ok(report.opened > 0 && report.pasted > 0);
  assert.ok(report.corpus >= 30);
});

test('tất định: cùng seed cho cùng số mở/dán được', () => {
  const a = run(150, 5).report;
  const b = run(150, 5).report;
  assert.deepEqual([a.opened, a.pasted], [b.opened, b.pasted]);
});
