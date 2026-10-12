// Thêm, đổi tên, nhân bản, xóa trên cây project 0.2 (feature 006, T083, FR-043): kế hoạch sửa đổi thuần, một bước hoàn tác.
import { describe, expect, it } from 'vitest';
import {
  applyEdits,
  outlineOf,
  type EditableProject,
  type ProjectEdit,
  type ProjectFiles,
} from './project-doc.ts';
import { full02 } from './test-fixtures.ts';
import {
  canAdd,
  canDuplicate,
  canRemove,
  canRename,
  currentName,
  planAdd,
  planDuplicate,
  planRemove,
  planRename,
  tagsOfNode,
} from './tree-ops.ts';

const files = (): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(full02())
      .filter(([p]) => p.endsWith('.json'))
      .map(([p, v]) => [p, JSON.parse(v)]),
  );
const outline = () => outlineOf(files() as ProjectFiles);

/** Áp sửa đổi lên project đầy đủ và dựng lại outline. */
function after(edits: readonly ProjectEdit[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = files() as Record<string, any>;
  const base = {
    project: f['project.json'],
    tags: f['tags.json'],
    connections: f['connections.json'],
    valueTables: { TrangThaiBom: f['value-tables/TrangThaiBom.json'] },
    watchTables: { 'van-hanh': f['watch-tables/van-hanh.json'] },
  } as unknown as EditableProject;
  const next = applyEdits(base, edits).state;
  return next;
}

describe('quyền của từng nút', () => {
  it('thêm, đổi tên, nhân bản, xóa', () => {
    expect(canAdd({ type: 'connections' })).toBe(true);
    expect(canAdd({ type: 'channel', id: 'plc1' })).toBe(true);
    expect(canAdd({ type: 'device', id: 'plc1' })).toBe(true);
    expect(canAdd({ type: 'valueTables' })).toBe(true);
    expect(canAdd({ type: 'watchTables' })).toBe(true);
    for (const ref of [
      { type: 'connections' },
      { type: 'valueTables' },
      { type: 'watchTables' },
    ] as const) {
      expect(canRename(ref)).toBe(false);
      expect(canDuplicate(ref)).toBe(false);
      expect(canRemove(ref)).toBe(false);
    }
    for (const ref of [
      { type: 'channel', id: 'a' },
      { type: 'device', id: 'a' },
      { type: 'valueTable', name: 'a' },
      { type: 'watch', id: 'a' },
    ] as const) {
      expect(canRename(ref)).toBe(true);
      expect(canDuplicate(ref)).toBe(true);
      expect(canRemove(ref)).toBe(true);
    }
  });
});

describe('thêm', () => {
  it('kênh Modbus TCP mới: id không trùng cả id thiết bị trường; chọn nút mới', () => {
    const r = planAdd({ type: 'connections' }, outline());
    expect(r.edits).toHaveLength(1);
    expect(r.edits[0].kind).toBe('channelUpsert');
    expect(r.select).toBe('channel:plc2');
    const next = after(r.edits);
    expect(next.connections?.channels.map((c) => c.id)).toEqual(['plc1', 'rs485-1', 'plc2']);
  });

  it('kênh Modbus RTU mới (T171): id rtu1, cổng trống, chưa có thiết bị trường; chọn nút mới', () => {
    const r = planAdd({ type: 'connections' }, outline(), 'modbus-rtu');
    expect(r.select).toBe('channel:rtu1');
    const added = after(r.edits).connections?.channels.at(-1);
    expect(added).toMatchObject({
      id: 'rtu1',
      kind: 'modbus-rtu',
      serial: { port: '' },
      devices: [],
    });
  });

  it('thiết bị trường mới vào kênh đang chọn hoặc kênh của thiết bị đang chọn', () => {
    const o = outline();
    const a = planAdd({ type: 'channel', id: 'rs485-1' }, o);
    expect(a.select).toBe('fdev:rs485-1-d1');
    const next = after(a.edits);
    expect(next.connections?.channels[1].devices.map((d) => d.id)).toEqual([
      'meter1',
      'meter2',
      'rs485-1-d1',
    ]);
    expect(next.connections?.channels[1].devices.at(-1)).toMatchObject({ slave: 1 });
    const b = planAdd({ type: 'device', id: 'plc1' }, o);
    expect(b.select).toBe('fdev:plc1-d1');
    expect(after(b.edits).connections?.channels[0].devices).toHaveLength(2);
  });

  it('bảng giá trị mới: tên BangGiaTri1…; bảng theo dõi mới: id từ tên mặc định', () => {
    const v = planAdd({ type: 'valueTables' }, outline());
    expect(v.select).toBe('valuetable:BangGiaTri1');
    expect(after(v.edits).valueTables?.BangGiaTri1).toMatchObject({
      name: 'BangGiaTri1',
      entries: [],
    });
    expect(after(v.edits).project.valueTables).toContain('BangGiaTri1');
    const w = planAdd({ type: 'watchTables' }, outline());
    expect(w.select).toBe('watch:bang-theo-doi-1');
    expect(after(w.edits).watchTables?.['bang-theo-doi-1']).toMatchObject({ rows: [] });
  });
});

describe('đổi tên', () => {
  it('tên hiện tại', () => {
    const o = outline();
    expect(currentName({ type: 'channel', id: 'plc1' }, o)).toBe('PLC trạm bơm');
    expect(currentName({ type: 'device', id: 'meter1' }, o)).toBe('Đồng hồ 1');
    expect(currentName({ type: 'valueTable', name: 'TrangThaiBom' }, o)).toBe('TrangThaiBom');
    expect(currentName({ type: 'watch', id: 'van-hanh' }, o)).toBe('Vận hành');
  });

  it('kênh và thiết bị trường: đổi tên hiển thị, giữ id (Tag không phải đổi tham chiếu)', () => {
    const o = outline();
    const c = planRename({ type: 'channel', id: 'rs485-1' }, 'RS485 mới', o);
    expect('edits' in c && after(c.edits).connections?.channels[1]).toMatchObject({
      id: 'rs485-1',
      name: 'RS485 mới',
    });
    expect('edits' in c && after(c.edits).connections?.channels[1].devices).toHaveLength(2);
    const d = planRename({ type: 'device', id: 'meter2' }, 'Công tơ 2', o);
    expect('edits' in d && after(d.edits).connections?.channels[1].devices[1]).toMatchObject({
      id: 'meter2',
      name: 'Công tơ 2',
    });
  });

  it('bảng giá trị: đổi khóa, Tag dùng bảng đổi theo; tên sai hoặc trùng bị từ chối', () => {
    const o = outline();
    const r = planRename({ type: 'valueTable', name: 'TrangThaiBom' }, 'TrangThaiMay', o);
    expect(r).toEqual({
      edits: [{ kind: 'valueTableRename', from: 'TrangThaiBom', to: 'TrangThaiMay' }],
    });
    expect(planRename({ type: 'valueTable', name: 'TrangThaiBom' }, '1x', o)).toEqual({
      error: 'tree.err.vtName',
    });
    expect(planRename({ type: 'valueTable', name: 'TrangThaiBom' }, '  ', o)).toEqual({
      error: 'tree.err.empty',
    });
    const twice = outline();
    expect(planRename({ type: 'valueTable', name: 'TrangThaiBom' }, 'TrangThaiBom', twice)).toEqual(
      { edits: [] },
    );
  });

  it('bảng theo dõi: đổi tên hiển thị, giữ id; tên rỗng hoặc quá 80 ký tự bị từ chối', () => {
    const o = outline();
    const r = planRename({ type: 'watch', id: 'van-hanh' }, 'Vận hành ca 2', o);
    expect('edits' in r && after(r.edits).watchTables?.['van-hanh']).toMatchObject({
      id: 'van-hanh',
      name: 'Vận hành ca 2',
    });
    expect(planRename({ type: 'watch', id: 'van-hanh' }, 'x'.repeat(81), o)).toEqual({
      error: 'tree.err.tooLong',
    });
    expect(planRename({ type: 'channel', id: 'plc1' }, '', o)).toEqual({ error: 'tree.err.empty' });
    expect(planRename({ type: 'channel', id: 'plc1' }, 'y'.repeat(65), o)).toEqual({
      error: 'tree.err.tooLong',
    });
  });
});

describe('nhân bản', () => {
  it('kênh: id mới, tên thêm "bản sao", mọi thiết bị trường có id mới; Tag không được nhân bản', () => {
    const o = outline();
    const r = planDuplicate({ type: 'channel', id: 'rs485-1' }, o);
    expect(r.select).toBe('channel:rs485-1-2');
    const next = after(r.edits);
    const copy = next.connections!.channels[2];
    expect(copy).toMatchObject({ id: 'rs485-1-2', kind: 'modbus-rtu' });
    expect(copy.name).toContain('bản sao');
    expect(copy.devices.map((d) => d.id)).toEqual(['meter1-2', 'meter2-2']);
    expect((next.tags as { tags: unknown[] }).tags).toHaveLength(13);
  });

  it('thiết bị trường: vào cùng kênh với id mới', () => {
    const r = planDuplicate({ type: 'device', id: 'meter1' }, outline());
    expect(r.select).toBe('fdev:meter1-2');
    const devs = after(r.edits).connections!.channels[1].devices;
    expect(devs.map((d) => d.id)).toEqual(['meter1', 'meter2', 'meter1-2']);
    expect(devs[2]).toMatchObject({ slave: 1 });
  });

  it('bảng giá trị và bảng theo dõi', () => {
    const v = planDuplicate({ type: 'valueTable', name: 'TrangThaiBom' }, outline());
    expect(v.select).toBe('valuetable:TrangThaiBom_2');
    expect(after(v.edits).valueTables?.TrangThaiBom_2.entries).toEqual(
      after([]).valueTables?.TrangThaiBom.entries,
    );
    const w = planDuplicate({ type: 'watch', id: 'van-hanh' }, outline());
    expect(w.select).toBe('watch:van-hanh-2');
    const t = after(w.edits).watchTables?.['van-hanh-2'];
    expect(t?.rows).toEqual(after([]).watchTables?.['van-hanh'].rows);
    expect(t?.name).toContain('bản sao');
  });
});

describe('xóa', () => {
  it('kênh: bỏ cả thiết bị trường; báo số Tag còn tham chiếu thiết bị đã mất', () => {
    const o = outline();
    const r = planRemove({ type: 'channel', id: 'rs485-1' }, o);
    expect(r.edits).toEqual([{ kind: 'channelRemove', index: 1 }]);
    expect(r.orphanTags).toBe(1);
    expect(after(r.edits).connections?.channels.map((c) => c.id)).toEqual(['plc1']);
  });

  it('thiết bị trường, bảng giá trị, bảng theo dõi', () => {
    const o = outline();
    const d = planRemove({ type: 'device', id: 'meter2' }, o);
    expect(d.edits).toEqual([{ kind: 'deviceRemove', channel: 1, index: 1 }]);
    expect(d.orphanTags).toBe(0);
    const p = planRemove({ type: 'device', id: 'plc1' }, o);
    expect(p.orphanTags).toBe(6);
    const v = planRemove({ type: 'valueTable', name: 'TrangThaiBom' }, o);
    expect(v.edits).toEqual([{ kind: 'valueTableRemove', name: 'TrangThaiBom' }]);
    expect(v.orphanTags).toBe(1);
    const w = planRemove({ type: 'watch', id: 'van-hanh' }, o);
    expect(w.edits).toEqual([{ kind: 'watchTableRemove', id: 'van-hanh' }]);
  });
});

describe('Tag của nút (vùng Details)', () => {
  it('kênh, thiết bị trường, bảng giá trị, bảng theo dõi; nút khác thì null', () => {
    const o = outline();
    expect(tagsOfNode({ type: 'device', id: 'plc1' }, o)).toHaveLength(6);
    expect(tagsOfNode({ type: 'device', id: 'meter1' }, o)?.map((x) => x.id)).toHaveLength(1);
    expect(tagsOfNode({ type: 'channel', id: 'rs485-1' }, o)).toHaveLength(1);
    expect(tagsOfNode({ type: 'channel', id: 'plc1' }, o)).toHaveLength(6);
    expect(tagsOfNode({ type: 'valueTable', name: 'TrangThaiBom' }, o)).toHaveLength(1);
    const w = tagsOfNode({ type: 'watch', id: 'van-hanh' }, o) ?? [];
    expect(w.length).toBeGreaterThan(0);
    expect(w[0]).toMatchObject({
      row: expect.any(Number),
      id: expect.any(String),
      type: expect.any(String),
    });
    expect(tagsOfNode({ type: 'connections' }, o)).toBeNull();
    expect(tagsOfNode(null, o)).toBeNull();
  });
});
