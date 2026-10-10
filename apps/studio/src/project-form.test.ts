import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemorySource, type Project, type TagList } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { applyProjectEdits, serialize, validateEdited } from './project-form.ts';

const DEMO = resolve(__dirname, '../../../projects/tank-demo');
const FILES = [
  'project.json',
  'tags.json',
  'screens/tank-motor.screen.json',
  'screens/tank-motor.bindings.json',
  'screens/tank-motor.svg',
];
const files = () =>
  Object.fromEntries(FILES.map((f) => [f, readFileSync(resolve(DEMO, f), 'utf8')]));
const base = () => {
  const f = files();
  return {
    source: new MemorySource(f),
    project: JSON.parse(f['project.json']) as Project,
    tags: JSON.parse(f['tags.json']) as TagList,
    raw: f,
  };
};

describe('applyProjectEdits', () => {
  it('sửa trường project, giữ nguyên trường khác và thứ tự khóa', () => {
    const b = base();
    const r = applyProjectEdits(b, [
      { kind: 'project', field: 'maxClients', value: 8 },
      { kind: 'project', field: 'projectName', value: 'Trạm bơm A' },
    ]);
    expect(r.project.maxClients).toBe(8);
    expect(Object.keys(r.project)).toEqual(Object.keys(b.project));
    expect(b.project.maxClients).toBe(10); // không sửa bản gốc
    expect(r.tags).toEqual(b.tags);
  });

  it('serialize: 2 dấu cách + xuống dòng cuối; file mẫu đã ở dạng chuẩn (diff gọn)', () => {
    const b = base();
    expect(serialize(b.project)).toBe(b.raw['project.json']);
    expect(serialize(b.tags)).toBe(b.raw['tags.json']);
    const r = applyProjectEdits(b, [{ kind: 'project', field: 'maxClients', value: 8 }]);
    const before = b.raw['project.json'].split('\n');
    const after = serialize(r.project).split('\n');
    expect(after.filter((l, i) => l !== before[i])).toEqual(['  "maxClients": 8,']);
  });

  it('thêm, sửa, xóa Tag', () => {
    const b = base();
    const r = applyProjectEdits(b, [
      {
        kind: 'tagUpsert',
        tag: { id: 'PUMP02.RUN', type: 'BOOL', source: { kind: 'mock', signal: 'motor.run' } },
      },
      { kind: 'tagUpsert', index: 0, tag: { ...b.tags.tags[0], unit: 'pct' } },
    ]);
    expect(r.tags.tags.at(-1)!.id).toBe('PUMP02.RUN');
    expect(r.tags.tags[0].unit).toBe('pct');
    const r2 = applyProjectEdits(r, [{ kind: 'tagRemove', index: r.tags.tags.length - 1 }]);
    expect(r2.tags.tags.map((t) => t.id)).not.toContain('PUMP02.RUN');
  });
});

describe('validateEdited (bộ kiểm tra dùng chung)', () => {
  const codes = async (edits: Parameters<typeof applyProjectEdits>[1]) => {
    const b = base();
    const r = applyProjectEdits(b, edits);
    const v = await validateEdited(b.source, r.project, r.tags);
    return [...new Set(v.errors.map((e) => e.code))];
  };

  it('hợp lệ khi không sửa gì', async () => {
    expect(await codes([])).toEqual([]);
  });
  it('maxClients 11 → E_MAX_CLIENTS', async () => {
    expect(await codes([{ kind: 'project', field: 'maxClients', value: 11 }])).toEqual([
      'E_MAX_CLIENTS',
    ]);
  });
  it('phiên bản không theo SemVer → E_SCHEMA', async () => {
    expect(await codes([{ kind: 'project', field: 'projectVersion', value: '1.0' }])).toEqual([
      'E_SCHEMA',
    ]);
  });
  it('entryScreen không có trong screens → E_SCREEN_ID', async () => {
    expect(await codes([{ kind: 'project', field: 'entryScreen', value: 'other' }])).toEqual([
      'E_SCREEN_ID',
    ]);
  });
  it('Tag trùng id → E_DUP_TAG', async () => {
    const b = base();
    expect(await codes([{ kind: 'tagUpsert', tag: { ...b.tags.tags[0] } }])).toEqual(['E_DUP_TAG']);
  });
  it('xóa Tag đang được binding dùng → E_REF_TAG', async () => {
    expect(await codes([{ kind: 'tagRemove', index: 0 }])).toEqual(['E_REF_TAG']);
  });
});
