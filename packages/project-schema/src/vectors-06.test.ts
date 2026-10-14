// Bộ vector định dạng 0.6 (feature 010): tests/project-vectors `v06-report-*` và khung `v06-valid-*`, `v06-invalid-*`
// (ca `v06-logging-010-*` chạy ở logging-010.test.ts). So TẬP mã lỗi, TẬP cảnh báo, `issues` và tập file.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectFiles, validateProject } from './index.ts';
import { NodeDirSource } from './node-source.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors');
const cases = readdirSync(DIR).filter(
  (d) =>
    d.startsWith('v06-') &&
    !d.startsWith('v06-logging-010-') &&
    statSync(join(DIR, d)).isDirectory(),
);
interface Exp {
  valid: boolean;
  errors: string[];
  warnings?: string[];
  issues?: Array<{ code: string; file: string; path: string }>;
  files?: string[];
}
const expOf = (d: string): Exp => JSON.parse(readFileSync(join(DIR, d, 'expected.json'), 'utf8'));

describe('tests/project-vectors: v06-report-* và khung 0.6', () => {
  it('phủ mọi mã E_RPT_*, E_NAV_REPORT và ba kỳ hợp lệ', () => {
    const codes = new Set(cases.flatMap((c) => expOf(c).errors));
    for (const c of [
      'E_RPT_DUP_ID',
      'E_RPT_REF_GROUP',
      'E_RPT_REF_TAG',
      'E_RPT_NO_AGG',
      'E_RPT_PERIOD',
      'E_RPT_SHIFT',
      'E_RPT_FN',
      'E_RPT_LIMIT',
      'E_NAV_REPORT',
      'E_PATH',
      'E_FILE_MISSING',
      'E_SCHEMA',
      'E_SCHEMA_VERSION',
      'E_MIN_RUNTIME',
      'E_RUNTIME_TOO_OLD',
    ])
      expect(codes.has(c), c).toBe(true);
    for (const c of ['v06-report-valid-day', 'v06-report-valid-shift', 'v06-report-valid-month'])
      expect(cases).toContain(c);
  });

  for (const c of cases)
    it(c, async () => {
      const exp = expOf(c);
      const r = await validateProject(new NodeDirSource(join(DIR, c)), { checkSvg: false });
      const codes = [...new Set(r.errors.map((e) => e.code))].sort();
      expect(codes, JSON.stringify(r.errors, null, 1)).toEqual([...exp.errors].sort());
      expect(r.valid).toBe(exp.valid);
      if (exp.warnings)
        expect([...new Set(r.warnings.map((w) => w.code))].sort()).toEqual(
          [...exp.warnings].sort(),
        );
      const all = [...r.errors, ...r.warnings].map(({ code, file, path }) => ({
        code,
        file,
        path,
      }));
      for (const i of exp.issues ?? []) expect(all).toContainEqual(i);
      if (exp.valid) {
        expect(r.project03).toBeDefined();
        expect(projectFiles(r.project03!)).toEqual(exp.files);
      }
    });
});
