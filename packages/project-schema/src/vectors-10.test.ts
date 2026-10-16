// Bộ vector định dạng 1.0 (feature 011, T018; FR-124, SC-037): tests/project-vectors `v10-*` (template, bản sao, faceplate,
// khung 1.0). So TẬP mã lỗi, TẬP cảnh báo, `issues` và tập file; validator chạy với `runtimeVersion` của expected.json
// (1.0.0). Bản C++: core/project-manager/tests/vectors_10_test.cpp (T020), cùng thư mục, cùng kết luận.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectFiles, validateProject } from './index.ts';
import { NodeDirSource } from './node-source.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors');
const cases = readdirSync(DIR).filter(
  (d) => d.startsWith('v10-') && statSync(join(DIR, d)).isDirectory(),
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

describe('tests/project-vectors: v10-*', () => {
  it('đủ ca (≥ 60) và mỗi mã mới có ít nhất một ca đúng và một ca sai', () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
    const errs = new Set(cases.flatMap((c) => expOf(c).errors));
    const warns = new Set(cases.flatMap((c) => expOf(c).warnings ?? []));
    for (const c of [
      'E_TEMPLATE_ID',
      'E_TEMPLATE_REF',
      'E_TEMPLATE_PARAM',
      'E_TEMPLATE_TAG_REF',
      'E_POPUP_ARGS',
      'E_SCHEMA',
      'E_SCHEMA_VERSION',
      'E_FILE_MISSING',
      'E_PATH',
      'E_MIN_RUNTIME',
      'E_RUNTIME_TOO_OLD',
    ])
      expect(errs.has(c), c).toBe(true);
    expect(warns.has('W_TEMPLATE_DRIFT')).toBe(true);
    // ca đúng (hợp lệ) cho từng mã: phần của định dạng mà mã đó kiểm, ở dạng đúng
    const valid: Record<string, string[]> = {
      E_TEMPLATE_ID: ['v10-valid-full', 'v10-valid-template-no-params'],
      E_TEMPLATE_REF: ['v10-valid-full', 'v10-valid-instance-params-every-item'],
      E_TEMPLATE_PARAM: ['v10-template-args-param-valid', 'v10-valid-instance-defaults'],
      E_TEMPLATE_TAG_REF: ['v10-valid-popup-20-callers', 'v10-valid-popup-multi-slot'],
      E_POPUP_ARGS: ['v10-popup-args-1000-valid', 'v10-popup-args-svg-event-valid'],
      W_TEMPLATE_DRIFT: ['v10-valid-instance-moved-resized', 'v10-valid-expanded-no-tpl'],
    };
    for (const [code, list] of Object.entries(valid))
      for (const c of list) {
        const e = expOf(c);
        expect(e.valid && (e.warnings ?? []).length === 0, `${code}: ${c}`).toBe(true);
      }
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
