// Bộ vector dùng chung TS ↔ C++ cho định dạng 0.2 (tests/project-vectors, ca `v02-*`, và ca lớn ở `out/`).
// So TẬP mã lỗi, TẬP mã cảnh báo (khi expected có `warnings`), vị trí `span` của lỗi biểu thức, và tập file
// của ca hợp lệ. Phiên bản runtime là hằng mặc định RUNTIME_VERSION (0.5.0 từ T040).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { projectFiles, validateProject } from './index.ts';
import { NodeDirSource } from './node-source.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors');
const OUT = join(DIR, 'out');
const small = readdirSync(DIR).filter(
  (d) => d.startsWith('v02-') && statSync(join(DIR, d)).isDirectory(),
);

interface Expected {
  valid: boolean;
  errors: string[];
  warnings?: string[];
  spans?: { code: string; span: [number, number] }[];
  files?: string[];
}
const expectedOf = (dir: string): Expected =>
  JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));

async function check(dir: string): Promise<void> {
  const exp = expectedOf(dir);
  const r = await validateProject(new NodeDirSource(dir), { checkSvg: false });
  const codes = [...new Set(r.errors.map((e) => e.code))].sort();
  expect(codes, JSON.stringify(r.errors, null, 1)).toEqual([...exp.errors].sort());
  expect(r.valid).toBe(exp.valid);
  if (exp.warnings) {
    const warns = [...new Set(r.warnings.map((e) => e.code))].sort();
    expect(warns, JSON.stringify(r.warnings, null, 1)).toEqual([...exp.warnings].sort());
  }
  for (const s of exp.spans ?? []) {
    const got = r.errors.filter((e) => e.code === s.code).map((e) => e.span);
    expect(got, `span of ${s.code}`).toContainEqual(s.span);
  }
  if (exp.valid) {
    expect(r.project02).toBeDefined();
    expect(projectFiles(r.project02!)).toEqual(exp.files);
  }
}

describe('tests/project-vectors: ca v02-*', () => {
  it('covers every error and warning code of contract §7 and the 0.2 valid cases', () => {
    const errors = new Set<string>();
    const warnings = new Set<string>();
    let valid = 0;
    const dirs = [...small.map((d) => join(DIR, d))];
    if (existsSync(OUT))
      dirs.push(
        ...readdirSync(OUT)
          .filter((d) => d.startsWith('v02-'))
          .map((d) => join(OUT, d)),
      );
    for (const d of dirs) {
      const e = expectedOf(d);
      if (e.valid) valid++;
      e.errors.forEach((c) => errors.add(c));
      (e.warnings ?? []).forEach((c) => warnings.add(c));
    }
    expect(valid).toBeGreaterThanOrEqual(10);
    const needErrors = [
      'E_SCHEMA_VERSION',
      'E_MIN_RUNTIME',
      'E_LIMIT',
      'E_DUP_ID',
      'E_DUP_TAG',
      'E_REF_DEVICE',
      'E_REF_TABLE',
      'E_ADDR_SYNTAX',
      'E_ADDR_AREA',
      'E_ADDR_RANGE',
      'E_ADDR_READ_LIMIT',
      'E_ADDR_WRITE_LIMIT',
      'E_BIT_WRITE',
      'E_SCALING',
      'E_DEADBAND',
      'E_LIMITS',
      'E_TAG_RANGE',
      'E_TAG_ACCESS',
      'E_SIM',
      'E_INITIAL',
      'E_RETAIN',
      'E_EXPR_SYNTAX',
      'E_EXPR_UNKNOWN_TAG',
      'E_EXPR_UNKNOWN_TABLE',
      'E_EXPR_UNKNOWN_FUNC',
      'E_EXPR_ARITY',
      'E_EXPR_TYPE',
      'E_EXPR_CYCLE',
      'E_EXPR_DEPTH',
      'E_EXPR_LIMIT',
      'E_VT_OVERLAP',
      'E_VT_RANGE',
      'E_VT_TEXT',
      'E_SERIAL_PORT',
      'E_SERIAL_SHARED',
      'E_TYPE_MISMATCH',
      'E_TRANSFORM_UNSUPPORTED',
      'E_SCHEMA',
      'E_JSON',
      'E_PATH',
      'E_FILE_MISSING',
    ];
    for (const c of needErrors) expect(errors.has(c), c).toBe(true);
    for (const c of [
      'W_WRITE_NO_LIMITS',
      'W_DETECT_SLOW',
      'W_RTU_SCAN_TIME',
      'W_BIT_RMW',
      'W_EXPR_INT64',
      'W_WATCH_REF',
      'W_ADDR_MODICON_BASE0',
    ])
      expect(warnings.has(c), c).toBe(true);
  });

  for (const c of small) it(c, () => check(join(DIR, c)));
});

describe('tests/project-vectors/out: ca lớn của 0.2 (sinh bằng `node tests/project-vectors/generate.mjs --out`)', () => {
  beforeAll(() => {
    execFileSync(process.execPath, [join(DIR, 'generate.mjs'), '--out02'], { stdio: 'pipe' });
  }, 120000);

  it('has the limit cases', () => {
    const names = readdirSync(OUT)
      .filter((d) => d.startsWith('v02-'))
      .sort();
    expect(names).toEqual(
      expect.arrayContaining([
        'v02-invalid-limit-calculated-501',
        'v02-invalid-limit-retain-501',
        'v02-invalid-limit-tags-2001',
        'v02-invalid-limit-value-tables-257',
        'v02-large-valid-calculated-500',
        'v02-large-valid-retain-500',
        'v02-large-valid-tags-2000',
        'v02-large-valid-value-tables-256',
      ]),
    );
  });

  for (const name of [
    'v02-large-valid-tags-2000',
    'v02-invalid-limit-tags-2001',
    'v02-large-valid-calculated-500',
    'v02-invalid-limit-calculated-501',
    'v02-large-valid-retain-500',
    'v02-invalid-limit-retain-501',
    'v02-large-valid-value-tables-256',
    'v02-invalid-limit-value-tables-257',
  ])
    it(name, () => check(join(OUT, name)), 60000);
});
