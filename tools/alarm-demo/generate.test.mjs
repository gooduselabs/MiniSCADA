// node --test tools/alarm-demo (T021): hai project mẫu alarm sinh tất định, hợp lệ trên validator TS 0.5 (0 lỗi, runtime
// 0.8.0), đúng số lượng instance, và tệp đã commit ở projects/ khớp từng byte với đầu ra mới.
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateProject } from '@mat/project-schema';
import { NodeDirSource } from '@mat/project-schema/node';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const gen = join(root, 'tools/alarm-demo/index.mjs');
const run = (out) =>
  spawnSync(process.execPath, [gen, '--out', out], { cwd: root, encoding: 'utf8' });

function tree(dir, rel = '', out = {}) {
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) tree(dir, r, out);
    else if (n !== 'README.md') out[r] = readFileSync(join(dir, r), 'utf8');
  }
  return out;
}
const instances = (doc) =>
  doc.alarms
    .filter((a) => a.enabled !== false)
    .reduce((n, a) => n + (a.type === 'limit' ? Object.keys(a.limits).length : 1), 0);
const check = (dir) =>
  validateProject(new NodeDirSource(dir), { checkSvg: false, runtimeVersion: '0.8.0' });

test('sinh hai lần cho cùng từng byte', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mat-alarm-demo-'));
  try {
    const a = join(tmp, 'a');
    const b = join(tmp, 'b');
    strictEqual(run(a).status, 0);
    strictEqual(run(b).status, 0);
    for (const name of ['alarm-demo', 'alarm-200'])
      deepStrictEqual(tree(join(a, name)), tree(join(b, name)));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('alarm-demo: hợp lệ, 12 alarm (4 số, 5 ngưỡng, 3 quality), 4 lớp, 3 khu vực', async () => {
  const dir = join(root, 'projects/alarm-demo');
  const r = await check(dir);
  deepStrictEqual(r.errors, []);
  deepStrictEqual(r.warnings, []);
  const doc = r.project05.alarms;
  strictEqual(doc.alarms.length, 12);
  for (const [t, n] of [
    ['digital', 4],
    ['limit', 5],
    ['quality', 3],
  ])
    strictEqual(doc.alarms.filter((a) => a.type === t).length, n, t);
  ok(
    doc.alarms.some((a) => a.type === 'quality' && a.device !== undefined),
    'một alarm quality theo device',
  );
  const levels = new Set(
    doc.alarms.filter((a) => a.type === 'limit').flatMap((a) => Object.keys(a.limits)),
  );
  deepStrictEqual([...levels].sort(), ['H', 'HH', 'L', 'LL']);
  strictEqual(r.project05.alarmClasses.classes.length, 4);
  strictEqual(doc.areas.length, 3);
});

test('alarm-200: hợp lệ, đúng 200 instance (60 số, 100 ngưỡng, 40 quality), không cảnh báo số lượng', async () => {
  const r = await check(join(root, 'projects/alarm-200'));
  deepStrictEqual(r.errors, []);
  deepStrictEqual(r.warnings, []);
  const doc = r.project05.alarms;
  strictEqual(instances(doc), 200);
  strictEqual(doc.alarms.filter((a) => a.type === 'digital').length, 60);
  strictEqual(doc.alarms.filter((a) => a.type === 'quality').length, 40);
  strictEqual(
    doc.alarms
      .filter((a) => a.type === 'limit')
      .reduce((n, a) => n + Object.keys(a.limits).length, 0),
    100,
  );
});

test('tệp đã commit khớp từng byte với đầu ra mới', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mat-alarm-demo-'));
  try {
    strictEqual(run(tmp).status, 0);
    for (const name of ['alarm-demo', 'alarm-200'])
      deepStrictEqual(tree(join(root, 'projects', name)), tree(join(tmp, name)), name);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
