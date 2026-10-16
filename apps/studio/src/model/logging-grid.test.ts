// T116 (lưới): adapter lưới nhóm và lưới Tag của editor Lưu trữ: chữ ô theo chế độ, sửa ô thành sửa đổi logging,
// điền xuống, dán, ô mờ theo kiểu Tag, lỗi theo ô (ô bị từ chối), xóa dòng.
import type { LoggingConfig, TagDataType } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { estimateView } from './estimate-view.ts';
import {
  formatMs,
  groupAdapter,
  parseDuration,
  tagAdapter,
  type GroupAdapterOptions,
} from './logging-grid.ts';
import type { ProjectEdit } from './project-doc.ts';

const types = new Map<string, TagDataType>([
  ['P', 'FLOAT32'],
  ['B', 'BOOL'],
  ['S', 'STRING'],
]);

const cfg = (): LoggingConfig => ({
  schemaVersion: '0.6.0',
  groups: [
    {
      id: 'a',
      name: 'Áp suất',
      mode: 'cyclic',
      periodMs: 60000,
      retentionDays: 30,
      tags: [{ tagId: 'P', deadband: 0.1 }, { tagId: 'B' }, { tagId: 'S', maxLength: 32 }],
      aggregates: {},
    },
    {
      id: 'b',
      name: 'Thay đổi',
      mode: 'onChange',
      minIntervalMs: 1000,
      retentionDays: 7,
      tags: [{ tagId: 'P' }],
    },
    {
      id: 'c',
      name: 'Kết hợp',
      mode: 'onChange',
      minIntervalMs: 1000,
      maxIntervalMs: 60000,
      retentionDays: 7,
      tags: [],
    },
    {
      id: 'd',
      name: 'Kích hoạt',
      mode: 'trigger',
      minIntervalMs: 5000,
      retentionDays: 365,
      trigger: { tagId: 'B', edge: 'rising' },
      tags: [{ tagId: 'P' }],
    },
  ],
});

const opts = (c = cfg(), readOnly = false): GroupAdapterOptions => ({
  cfg: c,
  types,
  estimate: estimateView(c, types),
  readOnly,
});

const loggingOf = (edits: ProjectEdit[]): LoggingConfig => {
  const e = edits.find((x) => x.kind === 'logging');
  if (!e || e.kind !== 'logging') throw new Error('không có sửa đổi logging');
  return e.value;
};

describe('parseDuration / formatMs', () => {
  it('đọc số kèm đơn vị; số trần là ms', () => {
    expect(parseDuration('1000')).toBe(1000);
    expect(parseDuration('250 ms')).toBe(250);
    expect(parseDuration('60 s')).toBe(60000);
    expect(parseDuration('1,5 s')).toBe(1500);
    expect(parseDuration('2 phút')).toBe(120000);
    expect(parseDuration('1 giờ')).toBe(3_600_000);
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('-5')).toBeNull();
  });
  it('định dạng gọn', () => {
    expect(formatMs(100)).toBe('100 ms');
    expect(formatMs(1000)).toBe('1 s');
    expect(formatMs(60000)).toBe('1 phút');
    expect(formatMs(1500)).toBe('1,5 s');
    expect(formatMs(3_600_000)).toBe('1 giờ');
  });
});

describe('groupAdapter', () => {
  it('chữ ô theo chế độ: chu kỳ, thay đổi, kết hợp, kích hoạt', () => {
    const a = groupAdapter(opts());
    expect(a.rowCount()).toBe(4);
    expect(a.text(0, 'id')).toBe('a');
    expect(a.text(0, 'mode')).toBe('Chu kỳ');
    expect(a.text(0, 'interval')).toBe('1 phút');
    expect(a.text(1, 'mode')).toBe('Thay đổi');
    expect(a.text(1, 'interval')).toBe('≥ 1 s');
    expect(a.text(2, 'mode')).toBe('Kết hợp');
    expect(a.text(2, 'interval')).toBe('1 s – 1 phút');
    expect(a.text(3, 'mode')).toBe('Kích hoạt');
    expect(a.text(3, 'interval')).toContain('B');
    expect(a.text(0, 'tags')).toBe('3');
    expect(a.text(0, 'agg')).toBe('Bật');
    expect(a.text(1, 'agg')).toBe('Tắt');
    expect(a.text(0, 'retention')).toBe('30');
    expect(a.text(0, 'mb')).toMatch(/\d/);
  });

  it('sửa tên, thời hạn, chu kỳ: một sửa đổi logging', () => {
    const a = groupAdapter(opts());
    const r = a.apply([
      { row: 0, col: 'name', text: 'Áp suất mới' },
      { row: 0, col: 'retention', text: '90' },
      { row: 0, col: 'interval', text: '5 s' },
    ]);
    expect(r.rejected).toEqual([]);
    expect(r.edits.length).toBe(1);
    const g = loggingOf(r.edits).groups[0]!;
    expect(g).toMatchObject({ name: 'Áp suất mới', retentionDays: 90, periodMs: 5000 });
  });

  it('đổi chế độ qua ô: Kết hợp đặt maxIntervalMs, Kích hoạt tạo trigger', () => {
    const a = groupAdapter(opts());
    const r1 = loggingOf(a.apply([{ row: 1, col: 'mode', text: 'Kết hợp' }]).edits);
    expect(r1.groups[1]).toMatchObject({ mode: 'onChange', maxIntervalMs: 60000 });
    const r2 = loggingOf(a.apply([{ row: 0, col: 'mode', text: 'Kích hoạt' }]).edits);
    expect(r2.groups[0]!.mode).toBe('trigger');
    expect(r2.groups[0]!.trigger).toEqual({ tagId: 'P', edge: 'rising' });
    expect(r2.groups[0]!.periodMs).toBeUndefined();
  });

  it('ô khoảng ghi theo chế độ: Thay đổi sửa minIntervalMs; Kết hợp sửa "min – max"; Kích hoạt chỉ đọc', () => {
    const a = groupAdapter(opts());
    expect(
      loggingOf(a.apply([{ row: 1, col: 'interval', text: '2 s' }]).edits).groups[1]!.minIntervalMs,
    ).toBe(2000);
    const g2 = loggingOf(a.apply([{ row: 2, col: 'interval', text: '500 ms – 30 s' }]).edits)
      .groups[2]!;
    expect([g2.minIntervalMs, g2.maxIntervalMs]).toEqual([500, 30000]);
    expect(a.editable(3, 'interval')).toBe(false);
    expect(a.editable(0, 'tags')).toBe(false);
    expect(a.editable(0, 'mb')).toBe(false);
  });

  it('bật/tắt tổng hợp qua ô', () => {
    const a = groupAdapter(opts());
    expect(
      loggingOf(a.apply([{ row: 1, col: 'agg', text: 'Bật' }]).edits).groups[1]!.aggregates,
    ).toEqual({});
    expect(
      loggingOf(a.apply([{ row: 0, col: 'agg', text: 'Tắt' }]).edits).groups[0]!.aggregates,
    ).toBeUndefined();
  });

  it('chữ không hiểu bị từ chối theo ô và không đổi gì ở ô đó; ô tốt vẫn áp', () => {
    const a = groupAdapter(opts());
    const r = a.apply([
      { row: 0, col: 'retention', text: 'abc' },
      { row: 0, col: 'interval', text: 'xyz' },
      { row: 0, col: 'name', text: 'Tên tốt' },
    ]);
    expect(r.rejected.map((x) => x.col).sort()).toEqual(['interval', 'retention']);
    expect(loggingOf(r.edits).groups[0]!.name).toBe('Tên tốt');
    expect(loggingOf(r.edits).groups[0]!.retentionDays).toBe(30);
  });

  it('chế độ lạ bị từ chối; options có đủ 4 chế độ; điền xuống chế độ', () => {
    const a = groupAdapter(opts());
    expect(a.options!(0, 'mode')).toEqual(['Chu kỳ', 'Thay đổi', 'Kết hợp', 'Kích hoạt']);
    expect(a.apply([{ row: 0, col: 'mode', text: 'Lạ' }]).rejected.length).toBe(1);
  });

  it('thêm, xóa nhóm; chỉ đọc khóa mọi sửa', () => {
    const a = groupAdapter(opts());
    expect(loggingOf(a.append!().edits).groups.length).toBe(5);
    expect(a.append!().row).toBe(4);
    expect(loggingOf(a.remove!([1, 3])).groups.map((g) => g.id)).toEqual(['a', 'c']);
    const ro = groupAdapter(opts(cfg(), true));
    expect(ro.editable(0, 'name')).toBe(false);
  });

  it('nhóm tối đa 32', () => {
    expect(groupAdapter(opts()).maxRows).toBe(32);
  });
});

describe('tagAdapter', () => {
  const adapter = (group = 0, readOnly = false) => tagAdapter({ ...opts(cfg(), readOnly), group });

  it('chữ ô: Tag, cột mặc định, deadband, độ dài, tổng hợp', () => {
    const a = adapter();
    expect(a.rowCount()).toBe(3);
    expect(a.text(0, 'tag')).toBe('P');
    expect(a.text(0, 'column')).toBe('P');
    expect(a.text(0, 'deadband')).toBe('0.1');
    expect(a.text(2, 'length')).toBe('32');
    expect(a.text(0, 'agg')).toBe('Bật');
  });

  it('ô mờ theo kiểu Tag: deadband không cho BOOL, STRING; độ dài chỉ STRING; tổng hợp không cho STRING', () => {
    const a = adapter();
    expect(a.editable(0, 'deadband')).toBe(true);
    expect(a.editable(1, 'deadband')).toBe(false);
    expect(a.editable(2, 'deadband')).toBe(false);
    expect(a.editable(2, 'length')).toBe(true);
    expect(a.editable(0, 'length')).toBe(false);
    expect(a.editable(2, 'agg')).toBe(false);
    expect(a.editable(0, 'agg')).toBe(true);
    expect(a.editable(0, 'note')).toBe(false);
    expect(a.text(2, 'agg')).toBe('—');
  });

  it('sửa deadband, cột, tổng hợp; xóa chữ thì bỏ trường', () => {
    const a = adapter();
    const r = a.apply([
      { row: 0, col: 'deadband', text: '0,5' },
      { row: 0, col: 'column', text: 'ap_suat' },
      { row: 0, col: 'agg', text: 'Tắt' },
    ]);
    expect(r.rejected).toEqual([]);
    const t = loggingOf(r.edits).groups[0]!.tags[0]!;
    expect(t).toMatchObject({ deadband: 0.5, column: 'ap_suat', aggregate: false });
    const r2 = adapter().apply([{ row: 0, col: 'deadband', text: '' }]);
    expect(loggingOf(r2.edits).groups[0]!.tags[0]).not.toHaveProperty('deadband');
  });

  it('ô không áp dụng bị từ chối khi dán vào; số sai bị từ chối', () => {
    const a = adapter();
    expect(a.apply([{ row: 1, col: 'deadband', text: '1' }]).rejected.length).toBe(1);
    expect(a.apply([{ row: 0, col: 'deadband', text: 'x' }]).rejected.length).toBe(1);
    expect(a.apply([{ row: 0, col: 'deadband', text: '-1' }]).rejected.length).toBe(1);
  });

  it('đổi Tag bằng gõ tên có trong project', () => {
    const a = adapter();
    expect(
      loggingOf(a.apply([{ row: 0, col: 'tag', text: 'B' }]).edits).groups[0]!.tags[0]!.tagId,
    ).toBe('B');
    expect(a.apply([{ row: 0, col: 'tag', text: '' }]).rejected.length).toBe(1);
  });

  it('xóa dòng; nhóm khác; tối đa 200 dòng; chỉ đọc', () => {
    const a = adapter();
    expect(loggingOf(a.remove!([0, 2])).groups[0]!.tags.map((t) => t.tagId)).toEqual(['B']);
    expect(adapter(1).rowCount()).toBe(1);
    expect(a.maxRows).toBe(200);
    expect(adapter(0, true).editable(0, 'deadband')).toBe(false);
  });

  it('dòng ngoài phạm vi / nhóm không tồn tại không ném', () => {
    expect(tagAdapter({ ...opts(), group: 99 }).rowCount()).toBe(0);
    expect(adapter().text(9, 'tag')).toBe('');
  });
});
