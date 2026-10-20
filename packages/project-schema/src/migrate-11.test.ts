// Nâng cấp lên 1.1.0 (feature 012, T013; contracts/project-format-1.1.md §1): 1.0 → 1.1 chỉ đổi `schemaVersion` của
// mọi tệp (kể cả logic.json và template) và nâng `minRuntimeVersion` lên 1.1.0; 0.1 đến 0.6 đi qua cả chuỗi trong một
// lần (một danh sách sao lưu). Đã là 1.1: ALREADY_11; 1.2 trở lên: UNSUPPORTED_VERSION.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySource, migrate10to11, migrateTo11, validateProject } from './index.ts';

const REPO = resolve(__dirname, '../../..');

function tree(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) Object.assign(out, tree(dir, r));
    else if (n !== 'expected.json') out[r] = readFileSync(join(dir, r), 'utf8');
  }
  return out;
}
const versionOf = (text: string | undefined) =>
  text === undefined ? undefined : (JSON.parse(text) as { schemaVersion?: string }).schemaVersion;

describe('migrateTo11', () => {
  it('1.0 → 1.1: mọi tệp JSON có schemaVersion (cả logic.json, template) thành 1.1.0, runtime 1.1.0, hợp lệ', async () => {
    const files = tree(join(REPO, 'tests/project-vectors/v10-valid-full'));
    const r = await migrateTo11(files);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    for (const [rel, text] of Object.entries(r.files))
      if (rel.endsWith('.json') && versionOf(files[rel]) !== undefined)
        expect(versionOf(text), rel).toBe('1.1.0');
    expect(versionOf(r.files['logic.json'])).toBe('1.1.0');
    expect(versionOf(r.files['templates/bom.template.json'])).toBe('1.1.0');
    expect(JSON.parse(r.files['project.json']!).minRuntimeVersion).toBe('1.1.0');
    expect(r.backup).toContain('logic.json');
    expect(r.backup).toContain('templates/bom.template.json');
    expect(r.changes).toContainEqual({ kind: 'minRuntime', version: '1.1.0' });
    const v = await validateProject(new MemorySource(r.files), {
      checkSvg: false,
      runtimeVersion: '1.1.0',
    });
    expect(v.errors).toEqual([]);
  });

  it('0.6 → 1.1 trong một lần (project mẫu history-demo)', async () => {
    const files = tree(join(REPO, 'projects/history-demo'));
    const r = await migrateTo11(files);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(versionOf(r.files['project.json'])).toBe('1.1.0');
    expect(r.changes.filter((c) => c.kind === 'minRuntime')).toEqual([
      { kind: 'minRuntime', version: '1.1.0' },
    ]);
    expect(r.changes.filter((c) => c.kind === 'rewrite')).toHaveLength(1);
  });

  it('đã là 1.1: ALREADY_11; 1.2: UNSUPPORTED_VERSION', async () => {
    const files = tree(join(REPO, 'tests/project-vectors/v11-valid-full'));
    expect(await migrateTo11(files)).toEqual({ ok: false, error: { code: 'ALREADY_11' } });
    const p = JSON.parse(files['project.json']!);
    p.schemaVersion = '1.2.0';
    const r = await migrateTo11({ ...files, 'project.json': JSON.stringify(p) });
    expect(r).toEqual({ ok: false, error: { code: 'UNSUPPORTED_VERSION', version: '1.2.0' } });
  });

  it('migrate10to11 chỉ nhận 1.0', async () => {
    const r = await migrate10to11(tree(join(REPO, 'projects/history-demo')));
    expect(r).toEqual({ ok: false, error: { code: 'UNSUPPORTED_VERSION', version: '0.6.0' } });
  });
});
