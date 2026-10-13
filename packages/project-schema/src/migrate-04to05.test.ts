// Nâng cấp 0.4 -> 0.5 (T012, T016; contract project-format-0.5 §7): cặp file tests/migration-vectors/0.4-to-0.5,
// giống từng byte với cùng đầu vào, chỉ đổi `schemaVersion` mọi file và nâng `minRuntimeVersion` lên 0.8.0, không tạo
// file alarm, project sau nâng cấp hợp lệ trên validator 0.5, lỗi của bản gốc được mang sang. Cũng kiểm 0.3 -> 0.4.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MemorySource,
  migrate03to04,
  migrate04to05,
  migrateTo05,
  validateProject,
} from './index.ts';

const DIR = resolve(__dirname, '../../../tests/migration-vectors/0.4-to-0.5');
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

describe('tests/migration-vectors/0.4-to-0.5', () => {
  it('has at least 5 pairs, with the chains from 0.1, 0.2 and 0.3', () => {
    expect(cases.filter((c) => !c.startsWith('error-')).length).toBeGreaterThanOrEqual(5);
    for (const c of ['from-0.1-tank-demo', 'from-0.2-modbus-demo', 'from-0.3-dashboard-demo'])
      expect(cases).toContain(c);
  });
  for (const c of cases) {
    it(c, async () => {
      const b = before(c);
      const r = await migrateTo05(b);
      const errFile = join(DIR, c, 'expected-error.json');
      if (existsSync(errFile)) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatchObject(JSON.parse(readFileSync(errFile, 'utf8')));
        return;
      }
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      const after = tree(join(DIR, c, 'after'));
      expect(r.files).toEqual(after);
      // không tạo file alarm
      expect(Object.keys(r.files).filter((f) => f.includes('alarm'))).toEqual([]);
      // cùng đầu vào cùng byte
      const again = await migrateTo05(b);
      expect(again.ok && again.files).toEqual(r.files);
      // hợp lệ ở 0.5 (hoặc cùng lỗi như bản gốc), runtime 0.8.0
      const v = await validateProject(new MemorySource(r.files), {
        checkSvg: false,
        runtimeVersion: '0.8.0',
      });
      if (c !== 'with-existing-error') expect(v.errors, JSON.stringify(v.errors)).toEqual([]);
      else expect(v.errors.map((e) => e.code)).toEqual(['E_DUP_TAG']);
      // chỉ những file đã đổi nằm trong backup
      expect(r.backup.every((f) => f in r.files)).toBe(true);
    });
  }
});

describe('migrate04to05', () => {
  it('changes only schemaVersion and minRuntimeVersion of project.json', async () => {
    const b = before('small-project');
    const r = await migrate04to05(b);
    if (!r.ok) throw new Error('migrate');
    const p = JSON.parse(r.files['project.json']!);
    const o = JSON.parse(b['project.json']!);
    expect(p).toEqual({ ...o, schemaVersion: '0.5.0', minRuntimeVersion: '0.8.0' });
    // mọi file khác: chỉ dòng schemaVersion khác
    for (const [f, t] of Object.entries(r.files)) {
      if (f === 'project.json' || !f.endsWith('.json')) continue;
      expect(t.replace('"0.5.0"', '"0.4.0"'), f).toBe(b[f]);
    }
  });
  it('keeps a higher minRuntimeVersion', async () => {
    const b = before('small-project');
    b['project.json'] = b['project.json']!.replace('"0.7.0"', '"0.9.0"');
    const r = await migrate04to05(b);
    // 0.9.0 > runtime 0.8.0 của bước kiểm: lỗi sẵn có E_RUNTIME_TOO_OLD của bản gốc, mang sang
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(JSON.parse(r.files['project.json']!).minRuntimeVersion).toBe('0.9.0');
  });
  it('says ALREADY_05 and UNSUPPORTED_VERSION', async () => {
    const r5 = await migrate04to05(before('small-project'));
    if (!r5.ok) throw new Error('migrate');
    expect(await migrate04to05(r5.files)).toEqual({ ok: false, error: { code: 'ALREADY_05' } });
    expect(await migrateTo05(r5.files)).toEqual({ ok: false, error: { code: 'ALREADY_05' } });
    const r3 = await migrate04to05(before('from-0.3-small-project'));
    expect(r3).toEqual({ ok: false, error: { code: 'UNSUPPORTED_VERSION', version: '0.3.0' } });
  });
});

describe('migrate03to04 (bản tối thiểu của nhánh 009)', () => {
  it('changes only schemaVersion and raises minRuntimeVersion to 0.7.0', async () => {
    const b = before('from-0.3-small-project');
    const r = await migrate03to04(b);
    if (!r.ok) throw new Error('migrate');
    const p = JSON.parse(r.files['project.json']!);
    expect(p.schemaVersion).toBe('0.4.0');
    expect(p.minRuntimeVersion).toBe('0.7.0');
    expect(r.files['screens/main.screen.json']).toBe(
      b['screens/main.screen.json']!.replace('"0.3.0"', '"0.4.0"'),
    );
    const v = await validateProject(new MemorySource(r.files), {
      checkSvg: false,
      runtimeVersion: '0.7.0',
    });
    expect(v.errors).toEqual([]);
    expect(v.project03).toBeDefined();
    expect(v.project05).toBeUndefined();
  });
});
