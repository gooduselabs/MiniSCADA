import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySource, validateProject } from './index.ts';
import { NodeDirSource } from './node-source.ts';

const ROOT = resolve(__dirname, '../../..');
const demo = () => new NodeDirSource(resolve(ROOT, 'projects/tank-demo'));

async function demoFiles(): Promise<Record<string, string>> {
  const src = demo();
  const files: Record<string, string> = {};
  for (const f of [
    'project.json',
    'tags.json',
    'screens/tank-motor.screen.json',
    'screens/tank-motor.bindings.json',
    'screens/tank-motor.svg',
  ])
    files[f] = (await src.readText(f))!;
  return files;
}

describe('schema v0', () => {
  it('accepts the hand-written sample project', async () => {
    const r = await validateProject(demo());
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.project?.project.projectId).toBe('tank-demo');
    expect(Object.keys(r.project!.screens)).toEqual(['tank-motor']);
    expect(r.project!.screens['tank-motor'].bindings.elements.length).toBeGreaterThan(0);
  });

  it('reports E_SCHEMA with a JSON Pointer for a wrong type', async () => {
    const files = await demoFiles();
    const p = JSON.parse(files['project.json']);
    p.projectName = 42;
    files['project.json'] = JSON.stringify(p);
    const r = await validateProject(new MemorySource(files));
    expect(r.valid).toBe(false);
    const e = r.errors.find((x) => x.code === 'E_SCHEMA');
    expect(e?.file).toBe('project.json');
    expect(e?.path).toBe('/projectName');
  });

  it('reports E_SCHEMA for a missing required field and an unknown field', async () => {
    const files = await demoFiles();
    const t = JSON.parse(files['tags.json']);
    delete t.tags[0].type;
    t.tags[1].color = 'red';
    files['tags.json'] = JSON.stringify(t);
    const r = await validateProject(new MemorySource(files));
    expect(r.errors.filter((e) => e.code === 'E_SCHEMA').map((e) => e.file)).toContain('tags.json');
  });

  it('reports E_JSON for broken JSON and for files over 1 MB', async () => {
    const files = await demoFiles();
    files['tags.json'] = '{ not json';
    let r = await validateProject(new MemorySource(files));
    expect(r.errors.map((e) => e.code)).toContain('E_JSON');
    files['tags.json'] = ' '.repeat(1024 * 1024 + 1);
    r = await validateProject(new MemorySource(files));
    expect(r.errors.map((e) => e.code)).toContain('E_JSON');
  });

  it('rejects an unknown binding target outside the allowlist as E_SCHEMA', async () => {
    const files = await demoFiles();
    const b = JSON.parse(files['screens/tank-motor.bindings.json']);
    b.elements[0].bindings[0].target = 'attr.href';
    files['screens/tank-motor.bindings.json'] = JSON.stringify(b);
    const r = await validateProject(new MemorySource(files));
    expect(r.errors.map((e) => e.code)).toContain('E_SCHEMA');
  });
});

describe('NodeDirSource', () => {
  it('refuses to read outside the project root', async () => {
    const src = demo();
    expect(await src.readText('../tank-demo/project.json')).toBeNull();
    expect(await src.readText('/etc/passwd')).toBeNull();
    expect(await src.readText('missing.json')).toBeNull();
  });
});
