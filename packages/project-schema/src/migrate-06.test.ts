// Nâng cấp 0.5 -> 0.6 (feature 010, T021): cặp file tests/migration-vectors/0.5-to-0.6, giống từng byte với cùng đầu vào,
// chỉ đổi `schemaVersion` mọi file (kể cả file alarm) và nâng `minRuntimeVersion` lên 0.9.0, không tạo file nào, project sau
// nâng cấp hợp lệ trên validator 0.6, lỗi của bản gốc được mang sang.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySource, migrate05to06, migrateTo06, validateProject } from './index.ts';

const DIR = resolve(__dirname, '../../../tests/migration-vectors/0.5-to-0.6');
const cases = readdirSync(DIR).filter((d) => statSync(join(DIR, d)).isDirectory());

function tree(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) Object.assign(out, tree(dir, r));
    else out[r] = readFileSync(join(dir, r), 'utf8');
  }
  return out;
}
const before = (c: string) => tree(join(DIR, c, 'before'));

describe('tests/migration-vectors/0.5-to-0.6', () => {
  it('có các ca cần thiết, kể cả chuỗi từ 0.1 đến 0.4 và file alarm', () => {
    for (const c of [
      'small-project',
      'with-alarms',
      'with-logging',
      'with-existing-error',
      'from-0.1-tank-demo',
      'from-0.2-modbus-demo',
      'from-0.3-dashboard-demo',
      'from-0.4-dashboard-demo',
      'error-already-0.6',
      'error-unsupported-0.7',
      'error-unreadable-project',
    ])
      expect(cases).toContain(c);
  });
  for (const c of cases)
    it(c, async () => {
      const b = before(c);
      const r = await migrateTo06(b);
      const errFile = join(DIR, c, 'expected-error.json');
      if (existsSync(errFile)) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatchObject(JSON.parse(readFileSync(errFile, 'utf8')));
        return;
      }
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      expect(r.files).toEqual(tree(join(DIR, c, 'after')));
      // cùng đầu vào cùng byte
      const again = await migrateTo06(b);
      expect(again.ok && again.files).toEqual(r.files);
      // hợp lệ ở 0.6 (hoặc cùng lỗi như bản gốc), runtime 0.9.0
      const v = await validateProject(new MemorySource(r.files), {
        checkSvg: false,
        runtimeVersion: '0.9.0',
      });
      if (c !== 'with-existing-error') expect(v.errors, JSON.stringify(v.errors)).toEqual([]);
      else expect(v.errors.map((e) => e.code)).toEqual(['E_DUP_TAG']);
      // chỉ những file đã đổi nằm trong backup
      expect(r.backup.every((f) => f in r.files)).toBe(true);
    });
});

describe('migrate05to06', () => {
  it('chỉ đổi schemaVersion và minRuntimeVersion của project.json', async () => {
    const b = before('small-project');
    const r = await migrate05to06(b);
    if (!r.ok) throw new Error('migrate');
    const p = JSON.parse(r.files['project.json']!);
    const o = JSON.parse(b['project.json']!);
    expect(p).toEqual({ ...o, schemaVersion: '0.6.0', minRuntimeVersion: '0.9.0' });
    for (const [f, t] of Object.entries(r.files)) {
      if (f === 'project.json' || !f.endsWith('.json')) continue;
      expect(t.replace('"0.6.0"', '"0.5.0"'), f).toBe(b[f]);
    }
  });
  it('đổi cả alarms.json và alarm-classes.json', async () => {
    const b = before('with-alarms');
    const r = await migrate05to06(b);
    if (!r.ok) throw new Error('migrate');
    for (const f of ['alarms.json', 'alarm-classes.json']) {
      expect(r.files[f], f).toContain('"0.6.0"');
      expect(r.backup).toContain(f);
    }
  });
  it('nói ALREADY_06 và UNSUPPORTED_VERSION', async () => {
    const r6 = await migrate05to06(before('small-project'));
    if (!r6.ok) throw new Error('migrate');
    expect(await migrate05to06(r6.files)).toEqual({ ok: false, error: { code: 'ALREADY_06' } });
    expect(await migrateTo06(r6.files)).toEqual({ ok: false, error: { code: 'ALREADY_06' } });
    const r4 = await migrate05to06(before('from-0.4-dashboard-demo'));
    expect(r4).toEqual({ ok: false, error: { code: 'UNSUPPORTED_VERSION', version: '0.4.0' } });
  });
});
