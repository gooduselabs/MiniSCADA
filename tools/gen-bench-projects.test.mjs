// node --test tools/gen-bench-projects.test.mjs (feature 011, T072; FR-038, FR-039): project đo bench-1000 và soak-standard
// sinh lúc chạy vào thư mục tạm, kiểm bằng tools/project-validator, tất định, Tag trùng tên với `load-tester -tags 500|1000`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gen = join(root, 'tools/gen-bench-projects.mjs');
const validator = join(root, 'tools/project-validator/validate.mjs');
const run = (cli, ...args) =>
  spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
const json = (...p) => JSON.parse(readFileSync(join(...p), 'utf8'));

function tree(dir, rel = '', out = {}) {
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) tree(dir, r, out);
    else out[r] = readFileSync(join(dir, r), 'utf8');
  }
  return out;
}

let tmp;
let out;
before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mat-gen-bench-'));
  out = join(tmp, 'a');
  const r = run(gen, '--out', out);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
after(() => rmSync(tmp, { recursive: true, force: true }));

test('bench-1000: 1.000 Tag SIM.T0001..SIM.T1000, không trùng, như load-tester -tags 1000', () => {
  const tags = json(out, 'bench-1000', 'tags.json').tags;
  assert.equal(tags.length, 1000);
  const ids = tags.map((t) => t.id);
  assert.equal(new Set(ids).size, 1000);
  for (let i = 1; i <= 1000; i++) assert.equal(ids[i - 1], `SIM.T${String(i).padStart(4, '0')}`);
  assert.ok(tags.every((t) => t.kind === 'simulation'));
  const project = json(out, 'bench-1000', 'project.json');
  assert.equal(project.projectId, 'bench-1000');
  assert.equal(project.maxClients, 10);
});

test('màn hình 250 item cho L4 (F5 đồng loạt) ở cả hai project', () => {
  for (const p of ['bench-1000', 'soak-standard']) {
    const s = json(out, p, 'screens', 'tong-quan.screen.json');
    assert.equal(s.items.length, 250, p);
    assert.ok(
      s.items.some((i) => i.widget === 'card'),
      'có card (f5-storm chờ số trên card)',
    );
  }
});

test('soak-standard: 500 Tag (mô phỏng + tính toán), lưu 200 Tag theo thay đổi, 3 màn hình', () => {
  const tags = json(out, 'soak-standard', 'tags.json').tags;
  assert.equal(tags.length, 500);
  const ids = tags.map((t) => t.id);
  for (let i = 1; i <= 500; i++) assert.equal(ids[i - 1], `SIM.T${String(i).padStart(4, '0')}`);
  assert.ok(tags.some((t) => t.kind === 'calculated'));
  assert.ok(tags.some((t) => t.kind === 'simulation'));
  const logging = json(out, 'soak-standard', 'logging.json');
  const onChange = logging.groups.filter((g) => g.mode === 'onChange');
  const logged = onChange.flatMap((g) => g.tags.map((t) => t.tagId));
  assert.equal(new Set(logged).size, 200);
  assert.ok(logged.every((id) => ids.includes(id)));
  assert.equal(
    logging.groups.length,
    onChange.length,
    'chỉ nhóm theo thay đổi (không thêm tải ghi khác)',
  );
  const project = json(out, 'soak-standard', 'project.json');
  assert.equal(project.screens.length, 3);
  for (const s of project.screens)
    assert.equal(json(out, 'soak-standard', 'screens', `${s}.screen.json`).id, s);
  assert.equal(project.logic, undefined, 'chưa có logic (engine chưa tích hợp: T136, T141)');
});

test('validator: cả hai project hợp lệ (0 lỗi, 0 cảnh báo)', () => {
  for (const p of ['bench-1000', 'soak-standard']) {
    const r = run(validator, join(out, p));
    assert.equal(r.status, 0, `${p}: ${r.stdout}${r.stderr}`);
    const rep = JSON.parse(r.stdout);
    assert.equal(rep.valid, true, p);
    assert.deepEqual(rep.errors, [], p);
    assert.deepEqual(rep.warnings, [], `${p}: không cảnh báo (W_LOG_SIZE_CAP với lưu trữ 30 ngày)`);
  }
});

test('tất định: chạy lại cho cùng từng byte; --only chỉ sinh một project', () => {
  const b = join(tmp, 'b');
  assert.equal(run(gen, '--out', b).status, 0);
  assert.deepEqual(tree(b), tree(out));
  const c = join(tmp, 'c');
  const r = run(gen, '--out', c, '--only', 'soak-standard');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(c), ['soak-standard']);
  // chạy lại vào cùng chỗ: thay project cũ, không để lại tệp thừa
  assert.equal(run(gen, '--out', c, '--only', 'soak-standard').status, 0);
  assert.deepEqual(tree(join(c, 'soak-standard')), tree(join(out, 'soak-standard')));
});

test('đối số sai: mã 2', () => {
  assert.equal(run(gen, '--only', 'khong-co').status, 2);
  assert.equal(run(gen, '--out').status, 2);
  assert.equal(run(gen, '--la').status, 2);
});
