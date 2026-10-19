// Nâng cấp 0.x -> 1.0.0 (feature 011, T015; FR-002, SC-042): cặp tệp tests/migration-vectors/0.6-to-1.0, giống từng
// byte với cùng đầu vào; thuần thêm (chỉ đổi `schemaVersion` mọi tệp và nâng `minRuntimeVersion` lên 1.0.0, không tạo
// tệp nào); idempotent (chạy hai lần cùng kết quả; chạy trên kết quả: ALREADY_10, không đổi gì); project > 1.0 bị từ
// chối; project sau nâng cấp hợp lệ trên validator 1.0 (runtime 1.0.0), lỗi của bản gốc được mang sang.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySource, migrate06to10, migrateTo10, validateProject } from './index.ts';

const DIR = resolve(__dirname, '../../../tests/migration-vectors/0.6-to-1.0');
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

describe('tests/migration-vectors/0.6-to-1.0', () => {
  it('có ca của mọi định dạng trước (0.1 đến 0.6, project mẫu thật) và ca lỗi', () => {
    for (const c of [
      'small-project',
      'with-alarms',
      'with-existing-error',
      'history-demo',
      'from-0.1-tank-demo',
      'from-0.2-modbus-demo',
      'from-0.3-dashboard-demo',
      'from-0.4-svg-demo',
      'from-0.5-alarm-demo',
      'error-already-1.0',
      'error-unsupported-1.2',
      'error-unreadable-project',
    ])
      expect(cases).toContain(c);
  });
  for (const c of cases)
    it(c, async () => {
      const b = before(c);
      const r = await migrateTo10(b);
      const errFile = join(DIR, c, 'expected-error.json');
      if (existsSync(errFile)) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toEqual(JSON.parse(readFileSync(errFile, 'utf8')));
        return;
      }
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      expect(r.files).toEqual(tree(join(DIR, c, 'after')));
      // cùng đầu vào cùng byte
      const again = await migrateTo10(b);
      expect(again.ok && again.files).toEqual(r.files);
      // chạy trên kết quả: đã là 1.0, không đổi gì
      expect(await migrateTo10(r.files)).toEqual({ ok: false, error: { code: 'ALREADY_10' } });
      // hợp lệ ở 1.0 (hoặc cùng lỗi như bản gốc), runtime 1.0.0
      const v = await validateProject(new MemorySource(r.files), {
        checkSvg: false,
        runtimeVersion: '1.0.0',
      });
      if (c !== 'with-existing-error') expect(v.errors, JSON.stringify(v.errors)).toEqual([]);
      else expect(v.errors.map((e) => e.code)).toEqual(['E_DUP_TAG']);
      expect(v.valid ? v.project10 : 'invalid').toBeDefined();
      // chỉ những tệp đã đổi nằm trong backup
      expect(r.backup.every((f) => f in r.files && r.files[f] !== b[f])).toBe(true);
    });
});

describe('migrate06to10', () => {
  it('chỉ đổi schemaVersion và minRuntimeVersion của project.json, không thêm logic hay template', async () => {
    const b = before('small-project');
    const r = await migrate06to10(b);
    if (!r.ok) throw new Error('migrate');
    const p = JSON.parse(r.files['project.json']!);
    const o = JSON.parse(b['project.json']!);
    expect(p).toEqual({ ...o, schemaVersion: '1.0.0', minRuntimeVersion: '1.0.0' });
    expect(Object.keys(r.files).sort()).toEqual(Object.keys(b).sort());
    for (const [f, t] of Object.entries(r.files)) {
      if (f === 'project.json' || !f.endsWith('.json')) continue;
      expect(t.replace('"1.0.0"', '"0.6.0"'), f).toBe(b[f]);
    }
    expect(r.changes).toContainEqual({ kind: 'minRuntime', version: '1.0.0' });
  });
  it('nói ALREADY_10 và UNSUPPORTED_VERSION', async () => {
    const r = await migrate06to10(before('small-project'));
    if (!r.ok) throw new Error('migrate');
    expect(await migrate06to10(r.files)).toEqual({ ok: false, error: { code: 'ALREADY_10' } });
    const r5 = await migrate06to10(before('from-0.5-alarm-demo'));
    expect(r5).toEqual({ ok: false, error: { code: 'UNSUPPORTED_VERSION', version: '0.5.0' } });
  });
});
