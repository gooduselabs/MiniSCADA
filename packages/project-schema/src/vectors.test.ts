// Bộ vector dùng chung TS ↔ C++ (tests/project-vectors). So TẬP mã lỗi, không so câu chữ.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateProject } from './index.ts';
import { NodeDirSource } from './node-source.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors');
const cases = readdirSync(DIR).filter((d) => statSync(join(DIR, d)).isDirectory());

describe('tests/project-vectors', () => {
  it('has at least one case per error code and 3 valid cases', () => {
    const codes = new Set<string>();
    let valid = 0;
    for (const c of cases) {
      const exp = JSON.parse(readFileSync(join(DIR, c, 'expected.json'), 'utf8'));
      if (exp.valid) valid++;
      exp.errors.forEach((e: string) => codes.add(e));
    }
    expect(valid).toBeGreaterThanOrEqual(3);
    expect([...codes].sort()).toEqual(
      [
        'E_DUP_BINDING',
        'E_DUP_TAG',
        'E_DUP_UID',
        'E_FILE_MISSING',
        'E_JSON',
        'E_MAX_CLIENTS',
        'E_PATH',
        'E_REF_TAG',
        'E_REF_UID',
        'E_RUNTIME_TOO_OLD',
        'E_SCALE_RANGE',
        'E_SCHEMA',
        'E_SCHEMA_VERSION',
        'E_SCREEN_ID',
        'E_TAG_RANGE',
        'E_TARGET_UNSUPPORTED',
        'E_TRANSFORM_UNSUPPORTED',
        'E_TYPE_MISMATCH',
      ].sort(),
    );
  });

  for (const c of cases) {
    it(c, async () => {
      const exp = JSON.parse(readFileSync(join(DIR, c, 'expected.json'), 'utf8'));
      const r = await validateProject(new NodeDirSource(join(DIR, c)), { checkSvg: false });
      const codes = [...new Set(r.errors.map((e) => e.code))].sort();
      expect(codes, JSON.stringify(r.errors, null, 1)).toEqual([...exp.errors].sort());
      expect(r.valid).toBe(exp.valid);
    });
  }
});
