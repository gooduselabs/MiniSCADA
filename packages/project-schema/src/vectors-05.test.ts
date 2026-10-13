// Bộ vector dùng chung TS <-> C++ cho định dạng 0.5 (T011): tests/project-vectors, ca `v05-*`. So TẬP mã lỗi, TẬP mã
// cảnh báo, các `issues` {code, file, path} phải có mặt, và tập file của ca hợp lệ. Mỗi ca ghi `runtimeVersion`.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, projectFiles, validateProject, type WarningCode } from './index.ts';
import { NodeDirSource } from './node-source.ts';

const ROOT = resolve(__dirname, '../../..');
const DIR = join(ROOT, 'tests/project-vectors');
const cases = readdirSync(DIR).filter(
  (n) => n.startsWith('v05-') && statSync(join(DIR, n)).isDirectory(),
);

interface Expected {
  valid: boolean;
  errors: string[];
  warnings?: string[];
  issues?: Array<{ code: string; file: string; path: string }>;
  files?: string[];
  runtimeVersion: string;
}
const expectedOf = (name: string): Expected =>
  JSON.parse(readFileSync(join(DIR, name, 'expected.json'), 'utf8'));

describe('tests/project-vectors: ca v05-*', () => {
  it('has at least 60 cases covering every E_ALARM_* and W_ALARM_* code', () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
    const errors = new Set<string>();
    const warnings = new Set<string>();
    for (const c of cases) {
      const e = expectedOf(c);
      e.errors.forEach((x) => errors.add(x));
      (e.warnings ?? []).forEach((x) => warnings.add(x));
    }
    for (const code of ERROR_CODES.filter((x) => x.startsWith('E_ALARM_')))
      expect(errors.has(code), code).toBe(true);
    const need: WarningCode[] = [
      'W_ALARM_COUNT_HIGH',
      'W_ALARM_NO_ACK_CRITICAL',
      'W_ALARM_CHATTER_RISK',
      'W_ALARM_DEVICE_EMPTY',
    ];
    for (const w of need) expect(warnings.has(w), w).toBe(true);
    for (const code of ['E_SCHEMA_VERSION', 'E_MIN_RUNTIME', 'E_PATH', 'E_FILE_MISSING', 'E_JSON'])
      expect(errors.has(code), code).toBe(true);
  });

  for (const name of cases) {
    it(name, async () => {
      const dir = join(DIR, name);
      const exp = expectedOf(name);
      const r = await validateProject(new NodeDirSource(dir), {
        checkSvg: false,
        runtimeVersion: exp.runtimeVersion,
      });
      const codes = [...new Set(r.errors.map((e) => e.code))].sort();
      expect(codes, JSON.stringify(r.errors, null, 1)).toEqual([...exp.errors].sort());
      expect(r.valid).toBe(exp.valid);
      const warns = [...new Set(r.warnings.map((e) => e.code))].sort();
      expect(warns, JSON.stringify(r.warnings, null, 1)).toEqual([...(exp.warnings ?? [])].sort());
      const all = [...r.errors, ...r.warnings].map((x) => ({
        code: x.code,
        file: x.file,
        path: x.path,
      }));
      for (const i of exp.issues ?? []) expect(all, `issue ${i.code} ${i.path}`).toContainEqual(i);
      if (exp.valid) {
        expect(r.project05).toBeDefined();
        expect(r.project03).toBe(r.project05);
        expect(projectFiles(r.project05!)).toEqual(exp.files);
        expect(existsSync(join(dir, 'project.json'))).toBe(true);
      }
    });
  }
});
