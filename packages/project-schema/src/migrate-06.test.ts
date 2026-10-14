// Nâng cấp 0.3 -> 0.6 (feature 010, T021): cặp file tests/migration-vectors/*-0.3to0.6; chỉ đổi `schemaVersion` của mọi
// file và nâng `minRuntimeVersion` lên tối thiểu 0.9.0; các byte khác giữ nguyên. Project sau nâng cấp hợp lệ trên
// validator 0.6, lỗi của bản gốc mang sang.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySource, migrate03to06, migrateTo06, validateProject } from './index.ts';

const DIR = resolve(__dirname, '../../../tests/migration-vectors');
const cases = readdirSync(DIR).filter(
  (d) => d.endsWith('-0.3to0.6') && statSync(join(DIR, d)).isDirectory(),
);

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

describe('tests/migration-vectors/*-0.3to0.6', () => {
  it('có các ca cần thiết', () => {
    for (const c of [
      'valid-full',
      'tank-demo',
      'modbus-demo',
      'minimal',
      'already-06',
      'min-runtime-higher',
      'screen-existing-error',
      'unreadable-project',
    ])
      expect(cases).toContain(`${c}-0.3to0.6`);
  });
  for (const c of cases)
    it(c, async () => {
      const r = await migrateTo06(before(c));
      const errFile = join(DIR, c, 'expected-error.json');
      if (existsSync(errFile)) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatchObject(JSON.parse(readFileSync(errFile, 'utf8')));
        return;
      }
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      expect(r.files).toEqual(tree(join(DIR, c, 'after')));
      // bản sao lưu: đúng các file bị ghi
      const changed = Object.keys(r.files)
        .filter((f) => r.files[f] !== before(c)[f])
        .sort();
      expect(r.backup).toEqual(changed);
      expect(r.changes).toContainEqual({ kind: 'rewrite', files: changed });
      // hợp lệ trên 0.6 trừ lỗi đã có ở bản gốc
      const was = await validateProject(new MemorySource(before(c)), {
        checkSvg: false,
        runtimeVersion: '0.9.0',
      });
      const now = await validateProject(new MemorySource(r.files), {
        checkSvg: false,
        runtimeVersion: '0.9.0',
      });
      expect([...new Set(now.errors.map((e) => e.code))].sort()).toEqual(
        [...new Set(was.errors.map((e) => e.code))].sort(),
      );
      if (was.errors.length === 0) {
        expect(now.valid).toBe(true);
        expect(now.project03!.project.schemaVersion).toBe('0.6.0');
      }
    });

  it('chạy lại trên kết quả: ALREADY_06', async () => {
    const r = await migrate03to06(before('valid-full-0.3to0.6'));
    if (!r.ok) throw new Error('migrate');
    expect(await migrate03to06(r.files)).toEqual({ ok: false, error: { code: 'ALREADY_06' } });
  });

  it('migrateTo06 đi qua 0.2 -> 0.3 cho project 0.2', async () => {
    const files = tree(join(DIR, 'modbus-demo-0.2to0.3', 'before'));
    const r = await migrateTo06(files);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(JSON.parse(r.files['project.json']!).schemaVersion).toBe('0.6.0');
  });
});
