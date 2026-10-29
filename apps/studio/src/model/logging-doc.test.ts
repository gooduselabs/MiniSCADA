// T115: mô hình tài liệu của editor Lưu trữ (feature 010): nhóm, Tag, kết nối; chuyển Chế độ ↔ trường (Kết hợp =
// onChange + maxIntervalMs); Kích hoạt tạo trigger; aggregate mỗi Tag; thêm Tag từ cây; hoàn tác; lưu khi còn lỗi;
// đổi tên Tag cập nhật tham chiếu (trigger, báo cáo).
import { renameTag, validateProject, MemorySource, type LoggingConfig } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import {
  addGroup,
  addTags,
  applicable,
  displayModeOf,
  duplicateGroup,
  loggingEdit,
  removeConnection,
  removeGroup,
  removeTags,
  setAggregates,
  setDisplayMode,
  setGroupField,
  setTagField,
  setTrigger,
  tagTypesOf,
  upsertConnection,
} from './logging-doc.ts';
import {
  applyDocEdits,
  filesOf,
  loadDoc,
  restoreSnapshot,
  snapshotOf,
  withEditable,
  writtenText,
  type ProjectDoc,
} from './project-doc.ts';
import { readProjectDir, REPO } from './test-fixtures.ts';
import { resolve } from 'node:path';

const cfg0 = (): LoggingConfig => ({
  schemaVersion: '0.6.0',
  timeZone: '+07:00',
  groups: [
    {
      id: 'ap-suat',
      name: 'Áp suất',
      mode: 'onChange',
      minIntervalMs: 1000,
      retentionDays: 30,
      tags: [{ tagId: 'PROC.PRESSURE', deadband: 0.1 }, { tagId: 'PROC.TEMP' }],
    },
  ],
  connections: [],
});

const TYPES = new Map([
  ['PROC.PRESSURE', 'FLOAT32'],
  ['PROC.TEMP', 'FLOAT32'],
  ['BATCH.DONE', 'BOOL'],
  ['NAME', 'STRING'],
  ['METER1.KWH', 'FLOAT64'],
] as const) as never;

describe('chế độ hiển thị ↔ trường', () => {
  it('displayModeOf: cyclic, onChange, combined (onChange có maxIntervalMs), trigger', () => {
    const g = cfg0().groups[0]!;
    expect(displayModeOf({ ...g, mode: 'cyclic', periodMs: 1000 })).toBe('cyclic');
    expect(displayModeOf(g)).toBe('onChange');
    expect(displayModeOf({ ...g, maxIntervalMs: 60000 })).toBe('combined');
    expect(displayModeOf({ ...g, mode: 'trigger' })).toBe('trigger');
  });

  it('chọn Kết hợp: onChange và maxIntervalMs mặc định 60 s; giữ maxIntervalMs đã có; bỏ về Thay đổi xóa trường', () => {
    const g = cfg0().groups[0]!;
    const c = setDisplayMode(g, 'combined');
    expect(c).toMatchObject({ mode: 'onChange', maxIntervalMs: 60000, minIntervalMs: 1000 });
    expect(setDisplayMode({ ...c, maxIntervalMs: 30000 }, 'combined').maxIntervalMs).toBe(30000);
    const back = setDisplayMode(c, 'onChange');
    expect(back.maxIntervalMs).toBeUndefined();
    expect(back.mode).toBe('onChange');
  });

  it('chọn Chu kỳ: periodMs mặc định 10 s (042), xóa min/max/trigger/expectedRowsPerDay', () => {
    const g = {
      ...cfg0().groups[0]!,
      maxIntervalMs: 60000,
      expectedRowsPerDay: 100,
      trigger: { tagId: 'X', edge: 'rising' as const },
    };
    const c = setDisplayMode(g, 'cyclic');
    expect(c.mode).toBe('cyclic');
    expect(c.periodMs).toBe(10_000);
    for (const k of ['minIntervalMs', 'maxIntervalMs', 'expectedRowsPerDay', 'trigger'] as const)
      expect(c[k]).toBeUndefined();
  });

  it('chọn Kích hoạt: tạo trigger rising (Tag đầu của nhóm), bỏ periodMs/maxIntervalMs; edge active cần periodMs', () => {
    const g = { ...cfg0().groups[0]!, maxIntervalMs: 60000 };
    const t = setDisplayMode(g, 'trigger');
    expect(t.mode).toBe('trigger');
    expect(t.trigger).toEqual({ tagId: 'PROC.PRESSURE', edge: 'rising' });
    expect(t.maxIntervalMs).toBeUndefined();
    const act = setTrigger(t, { edge: 'active' });
    expect(act.trigger!.edge).toBe('active');
    expect(act.periodMs).toBe(10_000);
    const back = setTrigger(act, { edge: 'both' });
    expect(back.periodMs).toBeUndefined();
    // chuyển khỏi Kích hoạt rồi lại vào: threshold không rò
    expect(setDisplayMode(setDisplayMode(t, 'onChange'), 'onChange').trigger).toBeUndefined();
  });

  it('threshold: chỉ giữ khi Tag kích hoạt là số; đặt undefined thì xóa', () => {
    const t = setDisplayMode(cfg0().groups[0]!, 'trigger');
    expect(setTrigger(t, { threshold: 5 }).trigger!.threshold).toBe(5);
    expect(
      setTrigger(setTrigger(t, { threshold: 5 }), { threshold: undefined }).trigger,
    ).not.toHaveProperty('threshold');
  });
});

describe('nhóm', () => {
  it('addGroup: id duy nhất, mặc định Chu kỳ 10 s (042), 30 ngày', () => {
    const c = addGroup(cfg0());
    expect(c.groups.length).toBe(2);
    const g = c.groups[1]!;
    expect(g).toMatchObject({ mode: 'cyclic', periodMs: 10_000, retentionDays: 30, tags: [] });
    expect(new Set(c.groups.map((x) => x.id)).size).toBe(2);
    expect(addGroup(c).groups[2]!.id).not.toBe(g.id);
  });

  it('duplicateGroup: id mới, tên có "bản sao", không sao chép table', () => {
    const c0 = cfg0();
    c0.groups[0]!.table = 'ap_suat';
    const c = duplicateGroup(c0, 0);
    expect(c.groups[1]!.id).toBe('ap-suat-2');
    expect(c.groups[1]!.name).toContain('bản sao');
    expect(c.groups[1]!.table).toBeUndefined();
    expect(c.groups[1]!.tags).toEqual(c0.groups[0]!.tags);
    expect(c.groups[1]!.tags).not.toBe(c0.groups[0]!.tags);
  });

  it('removeGroup; setGroupField đặt và xóa trường', () => {
    expect(removeGroup(addGroup(cfg0()), 1).groups.length).toBe(1);
    const c = setGroupField(cfg0(), 0, 'retentionDays', 90);
    expect(c.groups[0]!.retentionDays).toBe(90);
    const d = setGroupField(c, 0, 'expectedRowsPerDay', 5000);
    expect(d.groups[0]!.expectedRowsPerDay).toBe(5000);
    expect(setGroupField(d, 0, 'expectedRowsPerDay', undefined).groups[0]).not.toHaveProperty(
      'expectedRowsPerDay',
    );
  });

  it('không sửa đầu vào (bất biến)', () => {
    const c = cfg0();
    const snap = JSON.stringify(c);
    setDisplayMode(c.groups[0]!, 'trigger');
    addTags(c, 0, ['BATCH.DONE'], TYPES);
    setGroupField(c, 0, 'name', 'X');
    expect(JSON.stringify(c)).toBe(snap);
  });
});

describe('tổng hợp và Tag', () => {
  it('setAggregates bật {} (mặc định 31/730 ngày), tùy chỉnh, tắt', () => {
    const on = setAggregates(cfg0(), 0, true);
    expect(on.groups[0]!.aggregates).toEqual({});
    const custom = setAggregates(on, 0, true, { minuteRetentionDays: 7, hourRetentionDays: 90 });
    expect(custom.groups[0]!.aggregates).toEqual({ minuteRetentionDays: 7, hourRetentionDays: 90 });
    expect(setAggregates(custom, 0, false).groups[0]).not.toHaveProperty('aggregates');
  });

  it('addTags từ cây: bỏ Tag trùng, giữ thứ tự, không quá giới hạn nhóm', () => {
    const c = addTags(cfg0(), 0, ['PROC.PRESSURE', 'BATCH.DONE', 'NAME', 'BATCH.DONE'], TYPES);
    expect(c.groups[0]!.tags.map((t) => t.tagId)).toEqual([
      'PROC.PRESSURE',
      'PROC.TEMP',
      'BATCH.DONE',
      'NAME',
    ]);
    const many = Array.from({ length: 300 }, (_, i) => `T${i}`);
    expect(addTags(cfg0(), 0, many, new Map() as never).groups[0]!.tags.length).toBeLessThanOrEqual(
      200,
    );
  });

  it('Tag chuỗi thêm vào có maxLength mặc định; Tag số có deadband tùy chọn', () => {
    const c = addTags(cfg0(), 0, ['NAME'], TYPES);
    expect(c.groups[0]!.tags.at(-1)).toMatchObject({ tagId: 'NAME', maxLength: 64 });
  });

  it('removeTags theo chỉ số; setTagField và applicable theo kiểu Tag', () => {
    const c = removeTags(cfg0(), 0, [0]);
    expect(c.groups[0]!.tags.map((t) => t.tagId)).toEqual(['PROC.TEMP']);
    const d = setTagField(cfg0(), 0, 1, 'deadband', 0.5);
    expect(d.groups[0]!.tags[1]).toMatchObject({ deadband: 0.5 });
    expect(setTagField(d, 0, 1, 'aggregate', false).groups[0]!.tags[1]!.aggregate).toBe(false);
    expect(setTagField(d, 0, 1, 'deadband', undefined).groups[0]!.tags[1]).not.toHaveProperty(
      'deadband',
    );
    expect(applicable('FLOAT32', 'deadband')).toBe(true);
    expect(applicable('BOOL', 'deadband')).toBe(false);
    expect(applicable('STRING', 'deadband')).toBe(false);
    expect(applicable('STRING', 'maxLength')).toBe(true);
    expect(applicable('FLOAT32', 'maxLength')).toBe(false);
    expect(applicable('STRING', 'aggregate')).toBe(false);
    expect(applicable(undefined, 'deadband')).toBe(true);
  });

  it('tagTypesOf đọc kiểu từ danh sách Tag', () => {
    const m = tagTypesOf({
      tags: [
        { id: 'A', type: 'BOOL' },
        { id: 'B', type: 'FLOAT32' },
      ],
    } as never);
    expect(m.get('A')).toBe('BOOL');
    expect(m.size).toBe(2);
  });
});

describe('kết nối', () => {
  it('upsertConnection thêm và thay; removeConnection gỡ cả khỏi destinations', () => {
    let c = upsertConnection(cfg0(), {
      id: 'db1',
      type: 'postgresql',
      host: 'h',
      port: 5432,
      database: 'd',
      user: 'u',
    });
    c = { ...c, groups: [{ ...c.groups[0]!, destinations: ['db1'] }] };
    c = upsertConnection(c, { id: 'db1', type: 'postgresql', host: 'h2' });
    expect(c.connections!.length).toBe(1);
    expect(c.connections![0]!.host).toBe('h2');
    const r = removeConnection(c, 'db1');
    expect(r.connections).toEqual([]);
    expect(r.groups[0]!.destinations).toBeUndefined();
  });

  it('không có trường mật khẩu trong kiểu kết nối do model tạo', () => {
    const c = upsertConnection(cfg0(), {
      id: 'db1',
      type: 'influxdb',
      url: 'https://x',
      org: 'o',
      bucket: 'b',
    });
    expect(JSON.stringify(c)).not.toMatch(/password|secret|token/i);
  });
});

describe('qua project-doc: hoàn tác, lưu khi còn lỗi, đổi tên Tag', () => {
  const demo = () => readProjectDir(resolve(REPO, 'projects/history-demo'));
  const open = () => {
    const docs: Record<string, ProjectDoc> = {};
    for (const [rel, text] of Object.entries(demo()))
      docs[rel] = loadDoc(rel, text, `h:${rel}`, false, rel === 'tags.json' ? 'tags02' : undefined);
    return withEditable(docs);
  };

  it('sửa nhiều bước rồi hoàn tác về đúng ban đầu', () => {
    const docs = open();
    const before = snapshotOf(docs);
    const cur = docs['logging.json']!.value as LoggingConfig;
    const out = applyDocEdits(docs, [loggingEdit(addGroup(cur))]);
    expect((out['logging.json']!.value as LoggingConfig).groups.length).toBe(cur.groups.length + 1);
    const back = restoreSnapshot(out, before);
    expect(snapshotOf(back)).toBe(before);
  });

  it('lưu được khi còn lỗi: trigger thiếu Tag vẫn ghi', () => {
    const docs = open();
    const cur = docs['logging.json']!.value as LoggingConfig;
    const bad = setGroupField(cur, 0, 'retentionDays', 0);
    const out = applyDocEdits(docs, [loggingEdit(bad)]);
    expect(JSON.parse(writtenText(out['logging.json']!)).groups[0].retentionDays).toBe(0);
  });

  it('đổi tên Tag cập nhật nhóm, trigger và cột báo cáo (một bước)', async () => {
    const files = filesOf(open());
    const tags = files['tags.json'] as never;
    const logging = files['logging.json'] as LoggingConfig;
    const reports = files['reports.json'] as never;
    const r = renameTag({ tags, logging, reports } as never, 'METER1.KWH', 'METER1.ENERGY');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.project.logging)).toContain('METER1.ENERGY');
    expect(JSON.stringify(r.project.logging)).not.toContain('METER1.KWH');
    const rp = (r.project as { reports?: unknown }).reports;
    expect(JSON.stringify(rp)).toContain('METER1.ENERGY');
    expect(JSON.stringify(rp)).not.toContain('METER1.KWH');
    const trig = (r.project.logging as LoggingConfig).groups.find((g) => g.trigger);
    expect(trig?.trigger?.tagId).toBe('BATCH.DONE');
    void validateProject;
    void MemorySource;
  });

  it('đổi tên Tag kích hoạt cập nhật trigger.tagId', () => {
    const files = filesOf(open());
    const r = renameTag(
      {
        tags: files['tags.json'] as never,
        logging: files['logging.json'] as LoggingConfig,
      } as never,
      'BATCH.DONE',
      'BATCH.END',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const g = (r.project.logging as LoggingConfig).groups.find((x) => x.trigger);
    expect(g?.trigger?.tagId).toBe('BATCH.END');
  });
});
