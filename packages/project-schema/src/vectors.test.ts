// Bộ vector dùng chung TS ↔ C++ (tests/project-vectors). So TẬP mã lỗi, không so câu chữ.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateProject } from './index.ts';
import { NodeDirSource } from './node-source.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors');
// Ca 0.1; các ca `v02-*`, `v03-*` và `out/` (ca lớn) chạy ở vectors-02.test.ts, vectors-03.test.ts.
const cases = readdirSync(DIR).filter(
  (d) =>
    statSync(join(DIR, d)).isDirectory() &&
    !d.startsWith('v02-') &&
    !d.startsWith('v03-') &&
    !d.startsWith('v04-') &&
    d !== 'out',
);

describe('tests/project-vectors', () => {
  it('has at least one case per error and warning code and 3 valid cases', () => {
    const codes = new Set<string>();
    const warningCodes = new Set<string>();
    let valid = 0;
    for (const c of cases) {
      const exp = JSON.parse(readFileSync(join(DIR, c, 'expected.json'), 'utf8'));
      if (exp.valid) valid++;
      exp.errors.forEach((e: string) => codes.add(e));
      (exp.warnings ?? []).forEach((w: string) => warningCodes.add(w));
    }
    expect(valid).toBeGreaterThanOrEqual(3);
    expect([...warningCodes].sort()).toEqual([
      'W_LOG_SIZE_CAP',
      'W_LOG_TLS_UNVERIFIED',
      'W_LOG_WRITE_BUDGET',
    ]);
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
        'E_SCREEN_TAGS',
        'E_TAG_RANGE',
        'E_TARGET_UNSUPPORTED',
        'E_TRANSFORM_UNSUPPORTED',
        'E_TYPE_MISMATCH',
        // feature 003 (contracts/logging-config.md)
        'E_LOG_SECRET',
        'E_LOG_DUP_ID',
        'E_LOG_REF_TAG',
        'E_LOG_DUP_TAG',
        'E_LOG_REF_DEST',
        'E_LOG_COLUMN',
        'E_LOG_TABLE',
        'E_LOG_DEADBAND',
        'E_LOG_MAXLEN',
        'E_LOG_MODE',
        'E_LOG_LIMIT',
        'E_LOG_CONN',
        'E_LOG_TLS',
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
      if (exp.warnings) {
        const warns = [...new Set(r.warnings.map((e) => e.code))].sort();
        expect(warns, JSON.stringify(r.warnings, null, 1)).toEqual([...exp.warnings].sort());
      }
      for (const [code, paths] of Object.entries(exp.warningPaths ?? {})) {
        const got = r.warnings.filter((w) => w.code === code).map((w) => w.path);
        expect(got.sort(), code).toEqual([...(paths as string[])].sort());
      }
    });
  }
});
