// Nâng cấp 0.1 -> 0.2 (T038; contract §9): cặp file tests/migration-vectors, tất định, lỗi mang sang.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySource, migrate01to02, validateProject } from './index.ts';

const DIR = resolve(__dirname, '../../../tests/migration-vectors');
// Ca 0.1 -> 0.2; các ca `*-0.2to0.3` chạy ở migrate-02to03.test.ts.
const cases = readdirSync(DIR).filter(
  (d) =>
    statSync(join(DIR, d)).isDirectory() && !d.endsWith('-0.2to0.3') && !d.endsWith('-0.3to0.6'),
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

describe('tests/migration-vectors', () => {
  it('has the required cases', () => {
    for (const c of [
      'valid-tank-demo',
      'edge-unknown-signal',
      'edge-no-min-max',
      'edge-bom',
      'invalid-dup-tag',
      'unreadable-tags',
    ])
      expect(cases).toContain(c);
  });
  for (const c of cases) {
    it(c, async () => {
      const before = tree(join(DIR, c, 'before'));
      const r = await migrate01to02(before);
      const errFile = join(DIR, c, 'expected-error.json');
      if (existsSync(errFile)) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatchObject(JSON.parse(readFileSync(errFile, 'utf8')));
        return;
      }
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      expect(r.files).toEqual(tree(join(DIR, c, 'after')));
      // chạy hai lần cho cùng byte
      const again = await migrate01to02(before);
      expect(again.ok && again.files).toEqual(r.files);
    });
  }
});

describe('migrate01to02', () => {
  const demo = () => tree(join(DIR, 'valid-tank-demo', 'before'));
  it('the migrated project is valid 0.2 for runtime 0.5.0', async () => {
    const r = await migrate01to02(demo());
    if (!r.ok) throw new Error('migrate');
    const v = await validateProject(new MemorySource(r.files), {
      checkSvg: false,
      runtimeVersion: '0.5.0',
    });
    expect(v.errors).toEqual([]);
    expect(
      v.project02?.tags.tags.every((t) => t.kind === 'simulation' && t.sim?.kind === 'legacy'),
    ).toBe(true);
  });
  it('changes list legacy tags, minimum runtime and files', async () => {
    const r = await migrate01to02(demo());
    if (!r.ok) throw new Error('migrate');
    expect(r.changes.find((c) => c.kind === 'legacyTags')).toMatchObject({ count: 5 });
    expect(r.changes).toContainEqual({ kind: 'minRuntime', version: '0.5.0' });
    expect(r.backup).toContain('tags.json');
    expect(r.backup).toContain('project.json');
  });
  it('carries original errors instead of blocking', async () => {
    const r = await migrate01to02(tree(join(DIR, 'invalid-dup-tag', 'before')));
    expect(r.ok && r.changes[0]).toMatchObject({ kind: 'originalErrors' });
  });
  it('refuses newer versions and 0.2 projects', async () => {
    const f = demo();
    for (const v of ['0.3.0', '1.0.0']) {
      const p = JSON.parse(f['project.json']!);
      p.schemaVersion = v;
      const r = await migrate01to02({ ...f, 'project.json': JSON.stringify(p) });
      expect(r).toEqual({ ok: false, error: { code: 'UNSUPPORTED_VERSION', version: v } });
    }
    const p = JSON.parse(f['project.json']!);
    p.schemaVersion = '0.2.0';
    expect(await migrate01to02({ ...f, 'project.json': JSON.stringify(p) })).toEqual({
      ok: false,
      error: { code: 'ALREADY_02' },
    });
  });
});

describe('malformed 0.1 input does not throw (T210)', () => {
  it('survives null tags and a non-array screens list', async () => {
    const f = tree(join(DIR, 'valid-tank-demo', 'before'));
    const p = JSON.parse(f['project.json']!);
    p.screens = 'main';
    const tags = JSON.parse(f['tags.json']!);
    tags.tags = [null, 7, ...tags.tags];
    await expect(
      migrate01to02({
        ...f,
        'project.json': JSON.stringify(p),
        'tags.json': JSON.stringify(tags),
      }),
    ).resolves.toBeDefined();
  });
});
