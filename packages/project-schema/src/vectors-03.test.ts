// Bộ vector dùng chung TS <-> C++ cho định dạng 0.3 (T013): tests/project-vectors (ca `v03-*`, và ca lớn ở `out/`)
// và tests/widget-catalog-vectors. Ca project: so TẬP mã lỗi, TẬP mã cảnh báo (khi có), các `issues` {code, file, path}
// phải có mặt, và tập file của ca hợp lệ. Ca danh mục: so ĐA TẬP {code, path} của file screens/main.screen.json.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { MemorySource, projectFiles, validateProject } from './index.ts';
import { NodeDirSource } from './node-source.ts';

const ROOT = resolve(__dirname, '../../..');
const DIR = join(ROOT, 'tests/project-vectors');
const OUT = join(DIR, 'out');
const CAT = join(ROOT, 'tests/widget-catalog-vectors');
const dirsOf = (d: string, prefix = '') =>
  readdirSync(d).filter((n) => n.startsWith(prefix) && statSync(join(d, n)).isDirectory());
const small = dirsOf(DIR, 'v03-');

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
    expect(r.project03).toBeDefined();
    expect(projectFiles(r.project03!)).toEqual(exp.files);
  }
}

// Ca lớn ở out/ (không commit) được sinh một lần trước mọi test của tệp này.
beforeAll(() => {
  execFileSync(process.execPath, [join(DIR, 'generate.mjs'), '--out03'], { stdio: 'pipe' });
}, 120000);

describe('tests/project-vectors: ca v03-*', () => {
  it('covers every error and warning code of contract §7 and enough valid cases', () => {
    const errors = new Set<string>();
    const warnings = new Set<string>();
    let valid = 0;
    const dirs = small.map((d) => join(DIR, d));
    if (existsSync(OUT)) dirs.push(...dirsOf(OUT, 'v03-').map((d) => join(OUT, d)));
    for (const d of dirs) {
      const e = expectedOf(d);
      if (e.valid) valid++;
      e.errors.forEach((c) => errors.add(c));
      (e.warnings ?? []).forEach((c) => warnings.add(c));
    }
    expect(small.length).toBeGreaterThanOrEqual(120);
    expect(valid).toBeGreaterThanOrEqual(30);
    const needErrors = [
      'E_SCHEMA',
      'E_JSON',
      'E_PATH',
      'E_FILE_MISSING',
      'E_SCHEMA_VERSION',
      'E_MIN_RUNTIME',
      'E_RUNTIME_TOO_OLD',
      'E_SCREEN_ID',
      'E_SCREEN_SIZE',
      'E_SCREEN_KIND',
      'E_LIMIT',
      'E_ITEM_ID',
      'E_ITEM_SIZE',
      'E_WIDGET_UNKNOWN',
      'E_WIDGET_SLOT',
      'E_WIDGET_PROP',
      'E_WIDGET_TAG_TYPE',
      'E_REF_TAG',
      'E_REF_TABLE',
      'E_TAG_ACCESS',
      'E_WIDGET_LIMITS',
      'E_WIDGET_MINROLE',
      'E_WIDGET_CONFIRM',
      'E_ACTION',
      'E_ACTION_TARGET',
      'E_NAV',
      'E_REF_UID',
      'E_DUP_UID',
      'E_DUP_BINDING',
      'E_TARGET_UNSUPPORTED',
      'E_TYPE_MISMATCH',
      'E_TRANSFORM_UNSUPPORTED',
      'E_SCALE_RANGE',
      'E_SCREEN_TAGS', // ca lớn ở out/
    ];
    for (const c of needErrors) expect(errors.has(c), c).toBe(true);
    for (const c of [
      'W_ITEM_OUTSIDE',
      'W_SCREEN_EMPTY',
      'W_STRETCH_WIDGETS',
      'W_WRITE_NO_LIMITS',
      'W_CONFIRM_NONE',
      'W_PULSE_READBACK',
      'W_ACTION_NOOP',
      'W_SCREEN_TAGS_MANY', // ca lớn ở out/
      'W_ITEM_COVERED',
    ])
      expect(warnings.has(c), c).toBe(true);
  });

  for (const c of small) it(c, () => check(join(DIR, c)));
});

describe('tests/project-vectors/out: ca lớn của 0.3 (sinh bằng `node tests/project-vectors/generate.mjs --out03`)', () => {
  it('has the limit cases', () => {
    expect(dirsOf(OUT, 'v03-').sort()).toEqual(
      expect.arrayContaining([
        'v03-large-invalid-pair-1001',
        'v03-large-invalid-tags-1001',
        'v03-large-valid-pair-1000',
        'v03-large-valid-tags-500',
        'v03-large-valid-tags-hidden-excluded',
        'v03-large-warn-tags-1000',
        'v03-large-warn-tags-501',
      ]),
    );
  });

  for (const name of [
    'v03-large-valid-tags-500',
    'v03-large-warn-tags-501',
    'v03-large-warn-tags-1000',
    'v03-large-invalid-tags-1001',
    'v03-large-valid-tags-hidden-excluded',
    'v03-large-valid-pair-1000',
    'v03-large-invalid-pair-1001',
    'v03-large-valid-pair-hidden-button',
  ])
    it(name, () => check(join(OUT, name)), 60000);
});

// ---- tests/widget-catalog-vectors ----
interface CatIssue {
  code: string;
  path: string;
}
const catCases = dirsOf(CAT);
const MAIN = 'screens/main.screen.json';

function readTree(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) Object.assign(out, readTree(dir, r));
    else out[r] = readFileSync(join(dir, r), 'utf8');
  }
  return out;
}

/** Dựng project từ ca danh mục theo README của thư mục vector. */
function projectOf(dir: string): Record<string, string> {
  const tree = readTree(dir);
  const files: Record<string, string> = {};
  for (const [rel, text] of Object.entries(tree)) {
    if (rel === 'expect.json') continue;
    files[rel === 'screen.json' ? MAIN : rel] = text;
  }
  const others = Object.keys(files)
    .filter((f) => /^screens\/[^/]+\.screen\.json$/.test(f) && f !== MAIN)
    .map((f) => f.slice('screens/'.length, -'.screen.json'.length))
    .sort();
  // Ca widget lịch sử (feature 010, định dạng 0.6.0) mang sẵn `project.json` và `logging.json`.
  files['project.json'] ??= JSON.stringify({
    format: 'matscada-project',
    schemaVersion: '0.3.0',
    projectId: 'catalog-vector',
    projectName: 'Catalog vector',
    projectVersion: '0.1.0',
    minRuntimeVersion: '0.6.0',
    entryScreen: 'main',
    screens: ['main', ...others],
    tagFile: 'tags.json',
    connectionFile: 'connections.json',
    valueTables: ['TrangThaiBom'],
    maxClients: 10,
  });
  return files;
}
const key = (i: CatIssue) => `${i.code} ${i.path}`;

describe('tests/widget-catalog-vectors', () => {
  it('has enough cases: valid ones for each of the 15 widgets, and violations of every kind', () => {
    expect(catCases.length).toBeGreaterThanOrEqual(80);
    const catalog = JSON.parse(
      readFileSync(join(ROOT, 'schemas/widgets.catalog.json'), 'utf8'),
    ) as {
      widgets: { id: string }[];
    };
    for (const w of catalog.widgets) {
      expect(catCases, w.id).toContain(`valid-${w.id}-lower`);
      expect(catCases, w.id).toContain(`valid-${w.id}-upper`);
    }
    const codes = new Set<string>();
    for (const c of catCases)
      for (const i of JSON.parse(readFileSync(join(CAT, c, 'expect.json'), 'utf8')) as CatIssue[])
        codes.add(i.code);
    for (const c of [
      'E_WIDGET_UNKNOWN',
      'E_WIDGET_SLOT',
      'E_WIDGET_PROP',
      'E_WIDGET_TAG_TYPE',
      'E_WIDGET_LIMITS',
      'E_WIDGET_MINROLE',
      'E_WIDGET_CONFIRM',
      'E_ACTION',
      'E_ACTION_TARGET',
      'E_REF_TAG',
      'E_REF_TABLE',
      'E_TAG_ACCESS',
      'E_LIMIT',
      'W_CONFIRM_NONE',
      'W_PULSE_READBACK',
      'W_ACTION_NOOP',
      'W_WRITE_NO_LIMITS',
    ])
      expect(codes.has(c), c).toBe(true);
  });

  for (const c of catCases)
    it(c, async () => {
      const dir = join(CAT, c);
      const exp = JSON.parse(readFileSync(join(dir, 'expect.json'), 'utf8')) as CatIssue[];
      const r = await validateProject(new MemorySource(projectOf(dir)), { checkSvg: false });
      const got = [...r.errors, ...r.warnings]
        .filter((i) => i.file === MAIN)
        .map((i) => ({ code: i.code, path: i.path }));
      expect(got.map(key).sort(), JSON.stringify([...r.errors, ...r.warnings], null, 1)).toEqual(
        exp.map(key).sort(),
      );
      // lỗi ở file khác (tags, kết nối, bảng giá trị) không được có: các file chuẩn đều hợp lệ
      expect(r.errors.filter((i) => i.file !== MAIN)).toEqual([]);
      expect(r.valid).toBe(!exp.some((i) => i.code.startsWith('E_')));
    });
});
