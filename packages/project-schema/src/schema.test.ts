import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  MemorySource,
  textOf,
  validateProject,
  type ProjectSource,
  type ReadFailure,
  type ReadResult,
} from './index.ts';
import { NodeDirSource } from './node-source.ts';

const ROOT = resolve(__dirname, '../../..');
const demo = () => new NodeDirSource(resolve(ROOT, 'projects/tank-demo'));

async function demoFiles(): Promise<Record<string, string>> {
  const src = demo();
  const files: Record<string, string> = {};
  for (const f of [
    'project.json',
    'tags.json',
    'logging.json',
    'screens/tank-motor.screen.json',
    'screens/tank-motor.bindings.json',
    'screens/tank-motor.svg',
  ])
    files[f] = textOf(await src.read(f))!;
  return files;
}

/** Nguồn giả: file `fail` trả lỗi đọc đã phân loại (như lệnh Rust của Studio), còn lại đọc thật. */
class FailingSource implements ProjectSource {
  private readonly base: ProjectSource;
  private readonly fail: Record<string, ReadFailure>;
  constructor(base: ProjectSource, fail: Record<string, ReadFailure>) {
    this.base = base;
    this.fail = fail;
  }
  read(rel: string): Promise<ReadResult> {
    const e = this.fail[rel];
    return e ? Promise.resolve({ error: e }) : this.base.read(rel);
  }
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

// Audit FR-032: lỗi đọc có phân loại cho cùng mã lỗi với bản C++ (contracts/project-format.md).
describe('lỗi đọc file → mã lỗi như bản C++', () => {
  const codes = async (fail: Record<string, ReadFailure>) => {
    const r = await validateProject(new FailingSource(new MemorySource(await demoFiles()), fail));
    return [...new Set(r.errors.map((e) => e.code))];
  };
  const svg = 'screens/tank-motor.svg';

  it('JSON quá lớn hoặc không phải UTF-8 → E_JSON; không có hoặc bị từ chối → E_FILE_MISSING', async () => {
    expect(await codes({ 'tags.json': 'too-large' })).toEqual(['E_JSON']);
    expect(await codes({ 'tags.json': 'bad-utf8' })).toEqual(['E_JSON']);
    expect(await codes({ 'tags.json': 'missing' })).toEqual(['E_FILE_MISSING']);
    expect(await codes({ 'tags.json': 'bad-path' })).toEqual(['E_FILE_MISSING']);
  });

  it('SVG > 5 MB hoặc không phải UTF-8 vẫn là có file (bản C++ chỉ kiểm tồn tại)', async () => {
    expect(await codes({ [svg]: 'too-large' })).toEqual([]);
    expect(await codes({ [svg]: 'bad-utf8' })).toEqual([]);
    expect(await codes({ [svg]: 'missing' })).toEqual(['E_FILE_MISSING']);
    expect(await codes({ [svg]: 'bad-path' })).toEqual(['E_FILE_MISSING']);
  });

  it('bỏ đúng một BOM UTF-8 đầu file JSON (audit FR-008)', async () => {
    const files = await demoFiles();
    files['project.json'] = '﻿' + files['project.json'];
    expect((await validateProject(new MemorySource(files))).errors).toEqual([]);
    files['project.json'] = '﻿' + files['project.json'];
    const r = await validateProject(new MemorySource(files));
    expect(r.errors.map((e) => e.code)).toEqual(['E_JSON']);
  });
});

describe('NodeDirSource', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'mat-node-source-'));
  cpSync(resolve(ROOT, 'projects/tank-demo'), tmp, { recursive: true });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const src = () => new NodeDirSource(tmp);

  it('refuses to read outside the project root', async () => {
    expect(await demo().read('../tank-demo/project.json')).toEqual({ error: 'bad-path' });
    expect(await demo().read('/etc/passwd')).toEqual({ error: 'bad-path' });
    expect(await demo().read('missing.json')).toEqual({ error: 'missing' });
    expect(await demo().read('screens')).toEqual({ error: 'missing' }); // thư mục, không phải file
  });

  it('tên file đúng chữ hoa/thường như ext4 trên thiết bị (audit FR-032)', async () => {
    expect(await src().read('screens/Tank-Motor.svg')).toEqual({ error: 'missing' });
    expect(await src().read('Screens/tank-motor.svg')).toEqual({ error: 'missing' });
    expect(await src().read('PROJECT.json')).toEqual({ error: 'missing' });
    expect('text' in (await src().read('screens/tank-motor.svg'))).toBe(true);
  });

  it('UTF-8 hỏng → bad-utf8, BOM được giữ cho bộ kiểm tra (audit FR-008)', async () => {
    writeFileSync(join(tmp, 'bad.json'), Buffer.from([0x7b, 0x22, 0xea, 0xd2, 0x22, 0x7d]));
    expect(await src().read('bad.json')).toEqual({ error: 'bad-utf8' });
    writeFileSync(join(tmp, 'bom.json'), Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]));
    expect(await src().read('bom.json')).toEqual({ text: '﻿{}' });
  });

  it('trần đọc: JSON 1 MB, SVG 5 MB (ADR-003)', async () => {
    writeFileSync(join(tmp, 'big.json'), ' '.repeat(1024 * 1024 + 1));
    expect(await src().read('big.json')).toEqual({ error: 'too-large' });
    writeFileSync(join(tmp, 'mid.svg'), '<svg/>' + ' '.repeat(2 * 1024 * 1024));
    expect('text' in (await src().read('mid.svg'))).toBe(true);
    writeFileSync(join(tmp, 'huge.svg'), ' '.repeat(5 * 1024 * 1024 + 1));
    expect(await src().read('huge.svg')).toEqual({ error: 'too-large' });
  });

  it('project có SVG > 5 MB vẫn hợp lệ, như `mat-runtime --check-project`', async () => {
    writeFileSync(join(tmp, 'screens/tank-motor.svg'), '<svg/>' + ' '.repeat(5 * 1024 * 1024));
    const r = await validateProject(src(), { checkSvg: false });
    expect(r.errors).toEqual([]);
  });
});
