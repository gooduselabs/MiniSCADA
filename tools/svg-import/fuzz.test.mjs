// Khói của fuzz importer (feature 008, T113): 300 ca tất định; bản đầy đủ 10.000 ca chạy ở CI/ci-local.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve(import.meta.dirname, 'fuzz.mjs');

test('fuzz 300 ca: không ném lỗi, không chậm, không lọt allowlist; báo cáo đủ trường', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'svg-fuzz-')), 'r.json');
  const r = spawnSync(process.execPath, [script, '--cases', '300', '--seed', '11', '--out', out], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const j = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(j.cases, 300);
  assert.equal(j.thrown, 0);
  assert.equal(j.slowOver2s, 0);
  assert.equal(j.allowlistViolations, 0);
  assert.ok(j.importedOk > 0 && j.rejected > 0);
});

test('tất định: cùng seed cho cùng số ok/từ chối', () => {
  const run = () => {
    const out = join(mkdtempSync(join(tmpdir(), 'svg-fuzz-')), 'r.json');
    spawnSync(process.execPath, [script, '--cases', '150', '--seed', '5', '--out', out]);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    return [j.importedOk, j.rejected, JSON.stringify(j.rejectCodes)];
  };
  assert.deepEqual(run(), run());
});
