// Bộ vector dùng chung TS <-> C++ cho định dạng 0.4 (T011, T014): tests/project-vectors (ca `v04-*`, và ca lớn ở
// `out/` sinh bằng `generate.mjs --out04`). Quy ước ca: xem đầu tests/project-vectors/v04.mjs. Ca project: so TẬP mã
// lỗi, TẬP mã cảnh báo (khi có), các `issues` {code, file, path} phải có mặt, và tập file của ca hợp lệ.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { projectFiles, validateProject } from './index.ts';
import { NodeDirSource } from './node-source.ts';

const ROOT = resolve(__dirname, '../../..');
const DIR = join(ROOT, 'tests/project-vectors');
const OUT = join(DIR, 'out');
const dirsOf = (d: string, prefix = '') =>
  readdirSync(d).filter((n) => n.startsWith(prefix) && statSync(join(d, n)).isDirectory());
const small = dirsOf(DIR, 'v04-');

interface Issue {
  code: string;
  file: string;
  path: string;
}
interface Expected {
  valid: boolean;
  errors: string[];
  warnings?: string[];
  issues?: Issue[];
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
  const all = [...r.errors, ...r.warnings];
  for (const i of exp.issues ?? [])
    expect(
      all.map((x) => ({ code: x.code, file: x.file, path: x.path })),
      `issue ${i.code} ${i.file} ${i.path}`,
    ).toContainEqual(i);
  if (exp.valid) {
    expect(r.project04).toBeDefined();
    expect(projectFiles(r.project04!)).toEqual(exp.files);
  }
}

// Ca lớn ở out/ (không commit) được sinh một lần trước mọi test của tệp này.
beforeAll(() => {
  execFileSync(process.execPath, [join(DIR, 'generate.mjs'), '--out04'], { stdio: 'pipe' });
}, 120000);

describe('tests/project-vectors: ca v04-*', () => {
  it('covers every common code of contract §6 and has >= 100 cases', () => {
    const errors = new Set<string>();
    const warnings = new Set<string>();
    let valid = 0;
    const dirs = small.map((d) => join(DIR, d));
    if (existsSync(OUT)) dirs.push(...dirsOf(OUT, 'v04-').map((d) => join(OUT, d)));
    for (const d of dirs) {
      const e = expectedOf(d);
      if (e.valid) valid++;
      e.errors.forEach((c) => errors.add(c));
      (e.warnings ?? []).forEach((c) => warnings.add(c));
    }
    expect(small.length).toBeGreaterThanOrEqual(100);
    expect(valid).toBeGreaterThanOrEqual(60);
    // mã chung (cột C): ca sai
    for (const c of [
      'E_SCHEMA',
      'E_PATH',
      'E_FILE_MISSING',
      'E_SCHEMA_VERSION',
      'E_MIN_RUNTIME',
      'E_RUNTIME_TOO_OLD',
      'E_SCREEN_ID',
      'E_BIND_TRANSFORM',
      'E_BIND_PARAM',
      'E_RANGE',
      'E_EVENT_ACTION',
      'E_EVENT_TAG',
      'E_EVENT_TARGET',
      'E_EVENT_CONFIRM',
      'E_EVENT_MINROLE',
      'E_DUP_BINDING',
      'E_DUP_UID',
      'E_LIMIT', // ca lớn ở out/
      'E_REF_UID',
      'E_REF_TAG',
      'E_REF_TABLE',
      'E_TARGET_UNSUPPORTED',
      'E_TRANSFORM_UNSUPPORTED',
      'E_TYPE_MISMATCH',
      'E_SCALE_RANGE',
      'E_SCREEN_TAGS', // ca lớn ở out/
    ])
      expect(errors.has(c), c).toBe(true);
    for (const c of [
      'W_ANIM_MANY', // ca lớn ở out/
      'W_BLINK_ONLY',
      'W_EVENT_CONFIRM_NONE',
      'W_EVENT_PULSE_READBACK',
      'W_SCREEN_TAGS_MANY', // ca lớn ở out/
    ])
      expect(warnings.has(c), c).toBe(true);
  });

  it('has the boundary cases of contract §8', () => {
    const names = new Set(small);
    for (const n of [
      'v04-valid-param-period-400',
      'v04-valid-param-period-5000',
      'v04-invalid-param-period-399',
      'v04-invalid-param-period-5001',
      'v04-valid-param-speed-0',
      'v04-valid-param-speed-300',
      'v04-invalid-param-speed-301',
      'v04-invalid-param-pivot-x-negative',
      'v04-invalid-param-pivot-y-over-1',
      'v04-valid-param-minopacity-0_9',
      'v04-invalid-param-minopacity-0_91',
      'v04-valid-rangemap-63-ranges',
      'v04-valid-rangemap-64-ranges',
      'v04-invalid-range-65-ranges',
      'v04-valid-event-label-80',
      'v04-invalid-event-label-81',
      'v04-valid-event-pulse-duration-100',
      'v04-invalid-event-pulse-duration-99',
      'v04-valid-event-pulse-duration-10000',
      'v04-invalid-event-pulse-duration-10001',
      'v04-valid-element-events-only',
      'v04-invalid-dup-group-fill-twice',
      'v04-invalid-min-runtime-0_6_0',
    ])
      expect(names.has(n), n).toBe(true);
  });

  for (const c of small) it(c, () => check(join(DIR, c)));
});

describe('tests/project-vectors/out: ca lớn của 0.4 (sinh bằng `node tests/project-vectors/generate.mjs --out04`)', () => {
  const large = [
    'v04-large-valid-svg-items-64',
    'v04-large-invalid-svg-items-65',
    'v04-large-valid-anim-64',
    'v04-large-warn-anim-65',
    'v04-large-warn-anim-256',
    'v04-large-invalid-anim-257',
    'v04-large-warn-anim-256-two-items',
    'v04-large-invalid-anim-257-two-items',
    'v04-large-valid-anim-hidden-item-excluded',
    'v04-large-warn-anim-mixed-65',
    'v04-large-valid-anim-mixed-64',
    'v04-large-warn-screen-tags-1000-with-event',
    'v04-large-invalid-screen-tags-1001-with-event',
  ];
  it('has the limit cases', () => {
    expect(dirsOf(OUT, 'v04-').sort()).toEqual(expect.arrayContaining(large));
  });
  for (const name of large) it(name, () => check(join(OUT, name)), 60000);
});
