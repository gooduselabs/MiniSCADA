// @vitest-environment jsdom
// W_UID_NOT_IN_SVG chỉ có ở bản TS (Constitution II: core/ không parse SVG).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySource, validateProject } from './index.ts';

const SRC = resolve(__dirname, '../../../tests/project-vectors/valid-minimal');
const files = () => {
  const out: Record<string, string> = {};
  for (const f of [
    'project.json',
    'tags.json',
    'screens/main.screen.json',
    'screens/main.bindings.json',
    'screens/main.svg',
  ])
    out[f] = readFileSync(join(SRC, f), 'utf8');
  return out;
};

describe('W_UID_NOT_IN_SVG', () => {
  it('warns when a declared elementUid has no data-mat-uid in the SVG', async () => {
    const f = files();
    f['screens/main.svg'] = f['screens/main.svg'].replace('data-mat-uid="el_bbb"', '');
    const r = await validateProject(new MemorySource(f));
    expect(r.valid).toBe(true);
    expect(r.warnings.map((w) => w.code)).toEqual(['W_UID_NOT_IN_SVG']);
    expect(r.warnings[0].path).toBe('/elements/1/elementUid');
  });

  it('no warning when every uid exists', async () => {
    const r = await validateProject(new MemorySource(files()));
    expect(r.warnings).toEqual([]);
  });
});
