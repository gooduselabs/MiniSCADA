// Nâng cấp 0.3 -> 0.4 (T016; contract project-format-0.4 §7): cặp file tests/migration-vectors/*-0.3to0.4, giống từng
// byte với cùng đầu vào (chạy hai lần), chỉ `schemaVersion` và `minRuntimeVersion` đổi, project sau nâng cấp hợp lệ
// trên validator 0.4, lỗi của bản gốc được mang sang, chuỗi từ 0.1/0.2 (`migrateTo04`).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySource, migrate03to04, migrateTo04, validateProject } from './index.ts';

const DIR = resolve(__dirname, '../../../tests/migration-vectors');
const cases = readdirSync(DIR).filter(
  (d) => d.endsWith('-0.3to0.4') && statSync(join(DIR, d)).isDirectory(),
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
const modbus = () => before('modbus-demo-0.3to0.4');

describe('tests/migration-vectors/*-0.3to0.4', () => {
  it('has the required cases', () => {
    for (const c of [
      'tank-demo',
      'modbus-demo',
      'dashboard-demo',
      'multi-screen',
      'edge-bom',
      'min-runtime-higher',
      'min-runtime-lower',
      'screen-existing-error',
      'screen-broken-file',
      'already-04',
      'unsupported-version',
      'unreadable-project',
    ])
      expect(cases).toContain(`${c}-0.3to0.4`);
  });
  for (const c of cases) {
    it(c, async () => {
      const b = before(c);
      const r = await migrateTo04(b);
      const errFile = join(DIR, c, 'expected-error.json');
      if (existsSync(errFile)) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatchObject(JSON.parse(readFileSync(errFile, 'utf8')));
        return;
      }
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      expect(r.files).toEqual(tree(join(DIR, c, 'after')));
      const again = await migrateTo04(b);
      expect(again.ok && again.files).toEqual(r.files);
    });
  }
});

describe('migrate03to04', () => {
  it('project sau nâng cấp hợp lệ trên validator 0.4 (runtime 0.7.0), không cảnh báo mới', async () => {
    for (const c of ['modbus-demo', 'dashboard-demo', 'multi-screen', 'tank-demo']) {
      const b = before(`${c}-0.3to0.4`);
      const w0 = (await validateProject(new MemorySource(b), { checkSvg: false })).warnings.length;
      const r = await migrate03to04(b);
      if (!r.ok) throw new Error(`${c}: ${JSON.stringify(r)}`);
      const v = await validateProject(new MemorySource(r.files), {
        checkSvg: false,
        runtimeVersion: '0.7.0',
      });
      expect(v.errors, c).toEqual([]);
      expect(v.project04, c).toBeDefined();
      expect(v.project04!.project.schemaVersion).toBe('0.4.0');
      expect(v.warnings.length, c).toBe(w0);
    }
  });

  it('chỉ đổi schemaVersion và minRuntimeVersion: mọi byte khác của mọi file giữ nguyên', async () => {
    const b = modbus();
    const r = await migrate03to04(b);
    if (!r.ok) throw new Error('migrate');
    for (const [f, t] of Object.entries(b)) {
      if (!f.endsWith('.json')) {
        expect(r.files[f]).toBe(t);
        continue;
      }
      const want = t
        .replace('"schemaVersion": "0.3.0"', '"schemaVersion": "0.4.0"')
        .replace('"minRuntimeVersion": "0.6.0"', '"minRuntimeVersion": "0.7.0"');
      expect(r.files[f], f).toBe(want);
    }
    expect(JSON.parse(r.files['project.json']!).minRuntimeVersion).toBe('0.7.0');
    expect(r.changes).toContainEqual({ kind: 'minRuntime', version: '0.7.0' });
    expect(r.backup).toEqual([...r.backup].sort());
    expect(r.backup).toContain('screens/main.bindings.json');
    expect(r.backup).not.toContain('screens/main.svg');
  });

  it('minRuntimeVersion cao hơn 0.7.0 được giữ; thấp hơn thì lên 0.7.0', async () => {
    const hi = await migrate03to04(before('min-runtime-higher-0.3to0.4'));
    if (!hi.ok) throw new Error('migrate');
    expect(JSON.parse(hi.files['project.json']!).minRuntimeVersion).toBe('0.7.0');
    const b = modbus();
    b['project.json'] = b['project.json']!.replace(
      '"minRuntimeVersion": "0.6.0"',
      '"minRuntimeVersion": "0.9.0"',
    );
    const r = await migrate03to04(b);
    if (!r.ok) throw new Error('migrate');
    expect(JSON.parse(r.files['project.json']!).minRuntimeVersion).toBe('0.9.0');
  });

  it('BOM của tệp chỉ đổi phiên bản được giữ', async () => {
    const r = await migrate03to04(before('edge-bom-0.3to0.4'));
    if (!r.ok) throw new Error('migrate');
    expect(r.files['tags.json']!.charCodeAt(0)).toBe(0xfeff);
    expect(r.files['tags.json']).toContain('"schemaVersion": "0.4.0"');
  });

  it('lỗi của bản gốc được mang sang; màn hình hỏng JSON mang nguyên văn', async () => {
    const r = await migrate03to04(before('screen-existing-error-0.3to0.4'));
    expect(r.ok && r.changes[0]).toMatchObject({ kind: 'originalErrors' });
    if (!r.ok) throw new Error('migrate');
    const v = await validateProject(new MemorySource(r.files), { checkSvg: false });
    expect([...new Set(v.errors.map((e) => e.code))]).toEqual(['E_REF_UID']);
    const b = before('screen-broken-file-0.3to0.4');
    const r2 = await migrate03to04(b);
    if (!r2.ok) throw new Error(JSON.stringify(r2));
    expect(r2.files['screens/second.screen.json']).toBe(b['screens/second.screen.json']);
  });

  it('từ chối: đã là 0.4, phiên bản mới hơn, 0.2, project không đọc được', async () => {
    expect(await migrate03to04(before('already-04-0.3to0.4'))).toEqual({
      ok: false,
      error: { code: 'ALREADY_04' },
    });
    expect(await migrate03to04(before('unsupported-version-0.3to0.4'))).toEqual({
      ok: false,
      error: { code: 'UNSUPPORTED_VERSION', version: '0.5.0' },
    });
    expect(await migrate03to04(before('modbus-demo-0.2to0.3'))).toEqual({
      ok: false,
      error: { code: 'UNSUPPORTED_VERSION', version: '0.2.0' },
    });
    expect(await migrate03to04(before('unreadable-project-0.3to0.4'))).toEqual({
      ok: false,
      error: { code: 'UNREADABLE', file: 'project.json' },
    });
  });
});

describe('migrateTo04 từ 0.1 và 0.2', () => {
  it('0.1 -> 0.2 -> 0.3 -> 0.4 trong một lần, một danh sách sao lưu, hợp lệ 0.4', async () => {
    const r = await migrateTo04(before('tank-demo-0.2to0.3'));
    if (!r.ok) throw new Error(JSON.stringify(r));
    const v = await validateProject(new MemorySource(r.files), { checkSvg: false });
    expect(v.errors).toEqual([]);
    expect(v.project04?.project.schemaVersion).toBe('0.4.0');
    expect(r.changes).toContainEqual({ kind: 'legacyTags', count: 5 });
    expect(r.changes.filter((c) => c.kind === 'rewrite')).toHaveLength(1);
    expect(r.backup).toContain('tags.json');
  });
  it('0.2 -> 0.3 -> 0.4; 0.3 đi thẳng; đã là 0.4 thì ALREADY_04', async () => {
    const r = await migrateTo04(before('modbus-demo-0.2to0.3'));
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(JSON.parse(r.files['project.json']!).schemaVersion).toBe('0.4.0');
    expect(r.changes.some((c) => c.kind === 'screens')).toBe(true);
    const direct = await migrate03to04(modbus());
    expect(await migrateTo04(modbus())).toEqual(direct);
    expect(await migrateTo04(before('already-04-0.3to0.4'))).toEqual({
      ok: false,
      error: { code: 'ALREADY_04' },
    });
  });
});
