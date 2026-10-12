import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemorySource, validateProject, type Project, type TagList } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import {
  TAG_KEY_ORDER,
  applyDocEdits,
  applyProjectEdits,
  canonicalTag,
  filesOf,
  isDirty,
  loadDoc,
  markSaved,
  newPendingDoc,
  outlineOf,
  restoreSnapshot,
  serialize,
  setTagField,
  snapshotOf,
  withPending,
  withValue,
  writtenText,
  writeOrder,
  type ProjectDoc,
} from './project-doc.ts';

const DEMO = resolve(__dirname, '../../../../projects/tank-demo');
const FILES = [
  'project.json',
  'tags.json',
  'logging.json',
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

// Kết luận của bộ kiểm tra dùng chung trên nội dung đã sửa (trước là validateEdited của form Sprint 1;
// trong khung mới store kiểm qua textOf, xem store.test.ts).
describe('sửa đổi qua bộ kiểm tra dùng chung', () => {
  const codes = async (edits: Parameters<typeof applyProjectEdits>[1]) => {
    const b = base();
    const r = applyProjectEdits(b, edits);
    const v = await validateProject(
      new MemorySource({
        ...b.raw,
        'project.json': serialize(r.project),
        [r.project.tagFile]: serialize(r.tags),
      }),
    );
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
  it('xóa Tag đang được binding và logging.json dùng → E_REF_TAG, E_LOG_REF_TAG', async () => {
    expect(await codes([{ kind: 'tagRemove', index: 0 }])).toEqual(['E_LOG_REF_TAG', 'E_REF_TAG']);
  });
});

// ---- Feature 004 (T006, data-model §3.1, FR-022): tài liệu project trong khung Studio mới ----

// tags.json viết tay: thứ tự khóa khác chuẩn, description rỗng, unit có khoảng trắng; vẫn thụt 2.
const HAND_TAGS = `{
  "tags": [
    {
      "type": "FLOAT32",
      "id": "TANK01.LEVEL",
      "source": {
        "signal": "tank.level",
        "kind": "mock"
      },
      "description": "",
      "unit": " % ",
      "max": 100,
      "min": 0
    },
    {
      "id": "MOTOR01.RUN",
      "type": "BOOL",
      "description": "Bơm đang chạy",
      "source": {
        "kind": "mock",
        "signal": "motor.run"
      }
    }
  ],
  "schemaVersion": "0.1.0"
}
`;

const demoDocs = () => {
  const f = files();
  return {
    'project.json': loadDoc('project.json', f['project.json'], 'hash-p', true),
    'tags.json': loadDoc('tags.json', f['tags.json'], 'hash-t', true),
    'logging.json': loadDoc('logging.json', f['logging.json'], 'hash-l', false),
  } as Record<string, ProjectDoc>;
};
const handDocs = (): Record<string, ProjectDoc> => ({
  ...demoDocs(),
  'tags.json': loadDoc('tags.json', HAND_TAGS, 'hash-hand', true),
});
const tagsOf = (d: Record<string, ProjectDoc>) => (d['tags.json'].value as TagList).tags;

describe('ProjectDoc', () => {
  it('mở project mẫu: không có gì chưa lưu, value là đối tượng đọc từ đĩa', () => {
    const d = demoDocs();
    expect(Object.values(d).some(isDirty)).toBe(false);
    expect(d['project.json'].diskHash).toBe('hash-p');
    expect((d['project.json'].value as Project).projectId).toBe('tank-demo');
    expect(writeOrder(d)).toEqual([]);
  });

  it('tags.json viết tay: sửa projectName thì file Tag không chưa lưu, chỉ project.json được ghi', () => {
    const d = applyDocEdits(handDocs(), [
      { kind: 'project', field: 'projectName', value: 'Trạm B' },
    ]);
    expect(isDirty(d['project.json'])).toBe(true);
    expect(isDirty(d['tags.json'])).toBe(false);
    expect(serialize(d['tags.json'].value)).toBe(HAND_TAGS);
    expect(writeOrder(d).map((x) => x.rel)).toEqual(['project.json']);
  });

  it('file khác định dạng chuẩn (thụt 4, CRLF, BOM) mở ra không bị coi là chưa lưu', () => {
    const BOM = String.fromCharCode(0xfeff);
    const text = BOM + JSON.stringify(JSON.parse(HAND_TAGS), null, 4).replace(/\n/g, '\r\n');
    const doc = loadDoc('tags.json', text, 'h', true);
    expect(doc.diskText).toBe(text);
    expect(isDirty(doc)).toBe(false);
    expect(writeOrder({ 'tags.json': doc })).toEqual([]);
    // Sửa thật thì ghi theo định dạng chuẩn.
    const edited = withValue(
      doc,
      applyProjectEdits({ project: {} as Project, tags: doc.value as TagList }, [
        { kind: 'tagField', index: 1, field: 'unit', value: 'on' },
      ]).tags,
    );
    expect(isDirty(edited)).toBe(true);
  });

  it('sửa một Tag chỉ đổi trường đó: giữ thứ tự khóa, chuỗi rỗng và khoảng trắng', () => {
    const before = handDocs();
    const d = applyDocEdits(before, [{ kind: 'tagField', index: 0, field: 'max', value: 120 }]);
    const t0 = tagsOf(d)[0];
    expect(Object.keys(t0)).toEqual(Object.keys(tagsOf(before)[0]));
    expect(t0).toEqual({ ...tagsOf(before)[0], max: 120 });
    expect(tagsOf(d)[1]).toEqual(tagsOf(before)[1]);
    // diff đúng một dòng
    const a = HAND_TAGS.split('\n');
    const b = serialize(d['tags.json'].value).split('\n');
    expect(b.filter((l, i) => l !== a[i])).toEqual(['      "max": 120,']);
    // không đụng tài liệu cũ, không đụng project.json
    expect(tagsOf(before)[0].max).toBe(100);
    expect(d['project.json']).toBe(before['project.json']);
  });

  it('thêm trường còn thiếu: chèn theo thứ tự chuẩn; value undefined thì bỏ khóa', () => {
    const run = tagsOf(handDocs())[1]; // id, type, description, source
    expect(Object.keys(setTagField(run, 'unit', 'on/off'))).toEqual([
      'id',
      'type',
      'description',
      'unit',
      'source',
    ]);
    expect(Object.keys(setTagField(run, 'max', 1))).toEqual([
      'id',
      'type',
      'description',
      'max',
      'source',
    ]);
    const level = tagsOf(handDocs())[0]; // type, id, source, description, unit, max, min
    expect(Object.keys(setTagField(level, 'unit', undefined))).toEqual([
      'type',
      'id',
      'source',
      'description',
      'max',
      'min',
    ]);
    expect(setTagField(level, 'unit', '%').unit).toBe('%');
    expect(Object.keys(setTagField(level, 'unit', '%'))).toEqual(Object.keys(level));
  });

  it('Tag mới theo thứ tự id, type, description, unit, min, max, source', () => {
    expect(TAG_KEY_ORDER).toEqual(['id', 'type', 'description', 'unit', 'min', 'max', 'source']);
    const tag = canonicalTag({
      source: { kind: 'mock', signal: 'tank.level' },
      max: 100,
      unit: '%',
      id: 'TANK02.LEVEL',
      min: 0,
      type: 'FLOAT32',
      description: 'Mức bồn 2',
    });
    expect(Object.keys(tag)).toEqual([...TAG_KEY_ORDER]);
    // trường không có thì không sinh khóa
    expect(Object.keys(canonicalTag({ type: 'BOOL', id: 'X', source: tag.source }))).toEqual([
      'id',
      'type',
      'source',
    ]);
    const d = applyDocEdits(demoDocs(), [{ kind: 'tagUpsert', tag }]);
    expect(Object.keys(tagsOf(d).at(-1)!)).toEqual([...TAG_KEY_ORDER]);
  });

  it('chưa lưu khi serialize(value) khác nội dung trên đĩa; sửa về như cũ thì hết chưa lưu', () => {
    const d0 = demoDocs();
    const d1 = applyDocEdits(d0, [{ kind: 'project', field: 'maxClients', value: 8 }]);
    expect(isDirty(d1['project.json'])).toBe(true);
    const d2 = applyDocEdits(d1, [{ kind: 'project', field: 'maxClients', value: 10 }]);
    expect(d2['project.json']).not.toBe(d0['project.json']);
    expect(isDirty(d2['project.json'])).toBe(false);
  });

  it('thứ tự ghi: file Tag trước, project.json sau', () => {
    const d = applyDocEdits(demoDocs(), [
      { kind: 'project', field: 'projectName', value: 'B' },
      { kind: 'tagField', index: 0, field: 'unit', value: 'pct' },
    ]);
    const reordered = { 'project.json': d['project.json'], 'tags.json': d['tags.json'] };
    expect(writeOrder(reordered).map((x) => x.rel)).toEqual(['tags.json', 'project.json']);
    expect(writeOrder(d).map((x) => x.rel)).toEqual(['tags.json', 'project.json']);
  });

  it('markSaved: nội dung và hash mới, hết chưa lưu; sửa thêm trong lúc ghi thì vẫn chưa lưu', () => {
    const d = applyDocEdits(demoDocs(), [{ kind: 'project', field: 'projectName', value: 'B' }]);
    const doc = d['project.json'];
    const written = serialize(doc.value);
    const saved = markSaved(doc, written, 'hash-new');
    expect(saved.diskText).toBe(written);
    expect(saved.diskHash).toBe('hash-new');
    expect(isDirty(saved)).toBe(false);
    const editedDuringWrite = withValue(doc, { ...(doc.value as Project), projectName: 'C' });
    expect(isDirty(markSaved(editedDuringWrite, written, 'hash-new'))).toBe(true);
  });

  it('JSON hỏng: value null, không sửa được, không bao giờ chưa lưu', () => {
    const doc = loadDoc('tags.json', '{ "tags": [', 'h', true);
    expect(doc.value).toBeNull();
    expect(doc.editable).toBe(false);
    expect(isDirty(doc)).toBe(false);
    const d = applyDocEdits({ ...demoDocs(), 'tags.json': doc }, [
      { kind: 'tagField', index: 0, field: 'unit', value: 'x' },
    ]);
    expect(d['tags.json']).toBe(doc);
  });

  it('tài liệu chỉ đọc (logging.json) không bao giờ chưa lưu', () => {
    const d = demoDocs();
    const doc = withValue(d['logging.json'], { schemaVersion: '0.1.0', groups: [] });
    expect(isDirty(doc)).toBe(false);
  });

  it('snapshot của tài liệu sửa được và khôi phục', () => {
    const d0 = demoDocs();
    const snap = snapshotOf(d0);
    expect(Object.keys(JSON.parse(snap))).toEqual(['project.json', 'tags.json']);
    const d1 = applyDocEdits(d0, [
      { kind: 'project', field: 'projectName', value: 'B' },
      { kind: 'tagRemove', index: 0 },
    ]);
    const back = restoreSnapshot(d1, snap);
    expect(back['project.json'].value).toEqual(d0['project.json'].value);
    expect(back['tags.json'].value).toEqual(d0['tags.json'].value);
    expect(back['logging.json']).toBe(d1['logging.json']);
    expect(isDirty(back['project.json'])).toBe(false);
    expect(isDirty(back['tags.json'])).toBe(false);
  });
});

describe('outlineOf (cấu trúc project đọc được, kể cả khi còn lỗi)', () => {
  const parsed = () => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(files())) if (k.endsWith('.json')) out[k] = JSON.parse(v);
    return out;
  };

  it('project mẫu', () => {
    const o = outlineOf(parsed());
    expect(o.project?.projectId).toBe('tank-demo');
    expect(o.tagFile).toBe('tags.json');
    expect(o.loggingFile).toBe('logging.json');
    expect(o.tags?.tags).toHaveLength(5);
    expect(o.logging?.groups).toHaveLength(2);
    expect(o.screens.map((s) => [s.id, s.file, s.bindingFile])).toEqual([
      ['tank-motor', 'screens/tank-motor.screen.json', 'screens/tank-motor.bindings.json'],
    ]);
    expect(o.screens[0].screen?.name).toBe('Bồn nước + bơm');
    expect(o.screens[0].bindings?.elements).toHaveLength(8);
  });

  it('filesOf: giá trị đã parse theo đường dẫn, bỏ file hỏng', () => {
    const d = { ...demoDocs(), 'bad.json': loadDoc('bad.json', '{', null, false) };
    const f = filesOf(d);
    expect(Object.keys(f).sort()).toEqual(['logging.json', 'project.json', 'tags.json']);
    expect(outlineOf(f).tags?.tags).toHaveLength(5);
  });

  it('thiếu project.json: vẫn đọc file Tag mặc định, không có màn hình', () => {
    const f = parsed();
    delete f['project.json'];
    const o = outlineOf(f);
    expect(o.project).toBeNull();
    expect(o.tagFile).toBe('tags.json');
    expect(o.tags?.tags).toHaveLength(5);
    expect(o.screens).toEqual([]);
  });

  it('hình dạng sai không ném lỗi', () => {
    const o = outlineOf({
      'project.json': { screens: 'x', tagFile: 5, loggingFile: 'log.json' },
      'tags.json': { tags: 'x' },
      'log.json': [],
    });
    expect(o.project).not.toBeNull();
    expect(o.tagFile).toBe('tags.json');
    expect(o.tags).toBeNull();
    expect(o.loggingFile).toBe('log.json');
    expect(o.logging).toBeNull();
    expect(o.screens).toEqual([]);
    expect(outlineOf({ 'project.json': null }).project).toBeNull();
  });
});

describe('nội dung chờ ghi (feature 005, T132, FR-030)', () => {
  const DEVICE_TEXT = '{\n  "groups": [],\n  "connections": []\n}\n';
  const docsOf = (extra: Record<string, ProjectDoc> = {}) => {
    const f = files();
    const docs: Record<string, ProjectDoc> = {};
    for (const rel of FILES) docs[rel] = loadDoc(rel, f[rel], `h-${rel}`, rel === 'project.json');
    return { ...docs, ...extra };
  };

  it('file không sửa được theo đối tượng nhận nội dung chờ ghi: chưa lưu, ghi đúng chuỗi đó', () => {
    const docs = docsOf();
    expect(isDirty(docs['logging.json'])).toBe(false);
    const next = withPending(docs['logging.json'], DEVICE_TEXT);
    expect(isDirty(next)).toBe(true);
    expect(writtenText(next)).toBe(DEVICE_TEXT);
    expect(next.value).toEqual({ groups: [], connections: [] });
    expect(writeOrder({ ...docs, 'logging.json': next }).map((d) => d.rel)).toEqual([
      'logging.json',
    ]);
  });

  it('nội dung chờ ghi bằng nội dung trên đĩa thì không tính là chưa lưu', () => {
    const doc = docsOf()['logging.json'];
    expect(isDirty(withPending(doc, doc.diskText))).toBe(false);
  });

  it('snapshot gồm nội dung chờ ghi: khôi phục snapshot cũ bỏ nó, snapshot mới đặt lại', () => {
    const docs = docsOf();
    const before = snapshotOf(docs);
    const changed = { ...docs, 'logging.json': withPending(docs['logging.json'], DEVICE_TEXT) };
    const after = snapshotOf(changed);
    expect(after).not.toBe(before);
    const undone = restoreSnapshot(changed, before);
    expect(isDirty(undone['logging.json'])).toBe(false);
    expect(undone['logging.json'].value).toEqual(docs['logging.json'].value);
    const redone = restoreSnapshot(undone, after);
    expect(isDirty(redone['logging.json'])).toBe(true);
    expect(writtenText(redone['logging.json'])).toBe(DEVICE_TEXT);
  });

  it('file mới (chỉ có trên thiết bị): tạo tài liệu chờ ghi; hoàn tác bỏ tài liệu, làm lại tạo lại', () => {
    const docs = docsOf();
    const before = snapshotOf(docs);
    const created = { ...docs, 'screens/extra.svg': newPendingDoc('screens/extra.svg', '<svg/>') };
    expect(isDirty(created['screens/extra.svg'])).toBe(true);
    const after = snapshotOf(created);
    const undone = restoreSnapshot(created, before);
    expect(undone['screens/extra.svg']).toBeUndefined();
    const redone = restoreSnapshot(undone, after);
    expect(writtenText(redone['screens/extra.svg'])).toBe('<svg/>');
  });

  it('markSaved xóa nội dung chờ ghi và coi chuỗi đã ghi là nội dung trên đĩa', () => {
    const doc = withPending(docsOf()['logging.json'], DEVICE_TEXT);
    const saved = markSaved(doc, writtenText(doc), 'h-moi');
    expect(isDirty(saved)).toBe(false);
    expect(saved.diskText).toBe(DEVICE_TEXT);
    expect(saved.created).toBeUndefined();
    expect(newPendingDoc('a.svg', 'x').created).toBe(true);
    expect(markSaved(newPendingDoc('a.svg', 'x'), 'x', 'h').created).toBeUndefined();
  });
});
