// Bộ vector định dạng 1.1 (feature 012, T009; contracts/project-format-1.1.md §3, §5): tests/project-vectors `v11-*`
// (bố cục lưới, chủ đề). So TẬP mã lỗi, TẬP cảnh báo, `issues`; validator chạy với `runtimeVersion` của expected.json
// (1.1.0). Bản C++: core/project-manager/tests/vectors_11_test.cpp (T011), cùng thư mục, cùng kết luận.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectFiles, validateProject } from './index.ts';
import { NodeDirSource } from './node-source.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors');
const cases = readdirSync(DIR).filter(
  (d) => d.startsWith('v11-') && statSync(join(DIR, d)).isDirectory(),
);
interface Exp {
  valid: boolean;
  errors: string[];
  warnings?: string[];
  issues?: Array<{ code: string; file: string; path: string }>;
  files?: string[];
  runtimeVersion: string;
}
const expOf = (d: string): Exp => JSON.parse(readFileSync(join(DIR, d, 'expected.json'), 'utf8'));

describe('tests/project-vectors: v11-*', () => {
  it('đủ ca (≥ 40) và mỗi mã mới có ít nhất hai ca', () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    const count = (code: string) =>
      cases.filter((c) => [...expOf(c).errors, ...(expOf(c).warnings ?? [])].includes(code)).length;
    for (const c of [
      'E_LAYOUT_COLUMNS',
      'E_LAYOUT_SPAN',
      'E_LAYOUT_ID',
      'E_LAYOUT_ITEM_REF',
      'E_LAYOUT_ITEM_DUP',
      'E_LAYOUT_ITEM_POS',
      'E_LAYOUT_LIMIT',
      'E_LAYOUT_VERSION',
      'W_LAYOUT_ITEM_ORPHAN',
    ])
      expect(count(c), c).toBeGreaterThanOrEqual(2);
  });

  for (const c of cases)
    it(c, async () => {
      const exp = expOf(c);
      const r = await validateProject(new NodeDirSource(join(DIR, c)), {
        checkSvg: false,
        runtimeVersion: exp.runtimeVersion,
      });
      const codes = [...new Set(r.errors.map((e) => e.code))].sort();
      expect(codes, JSON.stringify(r.errors, null, 1)).toEqual([...exp.errors].sort());
      expect(r.valid).toBe(exp.valid);
      if (exp.warnings)
        expect(
          [...new Set(r.warnings.map((w) => w.code))].sort(),
          JSON.stringify(r.warnings, null, 1),
        ).toEqual([...exp.warnings].sort());
      const all = [...r.errors, ...r.warnings].map(({ code, file, path }) => ({
        code,
        file,
        path,
      }));
      for (const i of exp.issues ?? []) expect(all, JSON.stringify(all)).toContainEqual(i);
      if (exp.valid) {
        expect(r.project10).toBeDefined();
        expect(projectFiles(r.project10!)).toEqual(exp.files);
      }
    });
});
