// Mô hình Bảng theo dõi, phần xem (feature 006, T131, FR-050 phần xem, data-model §4): nhiều bảng, thêm Tag bằng gõ tên
// (gợi ý) hoặc dán danh sách, cột định dạng, giá trị sống, quality, lý do, thời điểm, chữ và màu theo bảng giá trị, Tag không
// có trên thiết bị, Tag không có trong project, lưới dùng chung như Bảng Tag.
import type { ValueTableDoc, WatchTableDoc } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import {
  WATCH_MAX_ROWS,
  addNames,
  formatWatchValue,
  newWatchTable,
  parseNameList,
  suggestTags,
  watchAdapter,
  watchTags,
  type LiveCell,
  type WatchTagInfo,
} from './watch-table.ts';

const TABLE: WatchTableDoc = {
  schemaVersion: '0.2.0',
  id: 'van-hanh',
  name: 'Vận hành',
  rows: [
    { tag: 'TANK01.SP', format: 'dec', decimals: 1, writeValue: '80' },
    { tag: 'PUMP01.STATE' },
    { tag: 'PUMP01.RUN_CMD', format: 'bool' },
    { tag: 'KHONG.CO' },
  ],
};
const TAGS = new Map<string, WatchTagInfo>([
  ['TANK01.SP', { id: 'TANK01.SP', type: 'FLOAT32', unit: '%' }],
  ['PUMP01.STATE', { id: 'PUMP01.STATE', type: 'UINT16', valueTable: 'TrangThaiBom' }],
  ['PUMP01.RUN_CMD', { id: 'PUMP01.RUN_CMD', type: 'BOOL' }],
]);
const VT: Record<string, ValueTableDoc> = {
  TrangThaiBom: {
    schemaVersion: '0.2.0',
    name: 'TrangThaiBom',
    entries: [
      { value: 0, text: 'Dừng', color: '#757575' },
      { value: 1, text: 'Chạy', color: '#2E7D32' },
    ],
  },
};
const LIVE: Record<string, LiveCell> = {
  'TANK01.SP': { value: 75, quality: 'GOOD', ts: Date.UTC(2026, 9, 20, 3, 12, 5) },
  'PUMP01.STATE': { value: 1, quality: 'GOOD', ts: Date.UTC(2026, 9, 20, 3, 12, 5) },
  'PUMP01.RUN_CMD': {
    value: true,
    quality: 'BAD',
    reason: 'TIMEOUT',
    ts: Date.UTC(2026, 9, 20, 3, 12, 6),
  },
};

function adapter(opts: { online?: boolean; table?: WatchTableDoc; readOnly?: boolean } = {}) {
  return watchAdapter({
    table: opts.table ?? TABLE,
    tags: TAGS,
    valueTables: VT,
    online: opts.online ?? false,
    live: (id) => LIVE[id] ?? null,
    unknownOnDevice: new Set(['KHONG.CO']),
    readOnly: opts.readOnly,
    timeZone: 'UTC',
  });
}

describe('cột', () => {
  it('Offline: tên, định dạng, số lẻ, giá trị ghi; Online thêm giá trị, chữ, quality, lý do, thời điểm', () => {
    expect(adapter().columns.map((c) => c.key)).toEqual([
      'tag',
      'format',
      'decimals',
      'writeValue',
    ]);
    expect(adapter({ online: true }).columns.map((c) => c.key)).toEqual([
      'tag',
      'value',
      'text',
      'quality',
      'reason',
      'time',
      'format',
      'decimals',
      'writeValue',
    ]);
    expect(adapter({ online: true }).columns.filter((c) => c.kind === 'live')).toHaveLength(5);
  });

  it('giới hạn 200 dòng', () => {
    expect(WATCH_MAX_ROWS).toBe(200);
    expect(adapter().maxRows).toBe(200);
  });
});

describe('nội dung ô', () => {
  const a = adapter({ online: true });
  it('giá trị sống theo định dạng của dòng; chữ theo bảng giá trị; quality và lý do tiếng Việt', () => {
    expect(a.text(0, 'value')).toBe('75.0');
    expect(a.text(1, 'value')).toBe('1');
    expect(a.text(1, 'text')).toBe('Chạy');
    expect(a.color(1)).toBe('#2E7D32');
    expect(a.text(2, 'value')).toBe('TRUE');
    expect(a.text(2, 'quality')).toBe('BAD');
    expect(a.text(2, 'reason')).toBe('thiết bị trường không trả lời kịp');
    expect(a.text(0, 'time')).toBe('03:12:05');
    expect(a.text(0, 'writeValue')).toBe('80');
    expect(a.text(0, 'format')).toBe('dec');
    expect(a.text(0, 'decimals')).toBe('1');
  });

  it('Tag không có trên thiết bị và Tag không có trong project', () => {
    expect(a.text(3, 'value')).toBe('không có trên thiết bị');
    expect(a.missingInProject(3)).toBe(true);
    expect(a.missingInProject(0)).toBe(false);
    expect(a.deviceMissing(3)).toBe(true);
    expect(a.deviceMissing(0)).toBe(false);
  });

  it('chưa có giá trị: dấu gạch; Offline: ô sống rỗng', () => {
    const w = watchAdapter({
      table: { ...TABLE, rows: [{ tag: 'TANK01.SP' }] },
      tags: TAGS,
      valueTables: VT,
      online: true,
      live: () => null,
    });
    expect(w.text(0, 'value')).toBe('—');
    expect(adapter().text(0, 'value')).toBe('');
  });

  it('cột sống và dòng thiếu không sửa được; định dạng, số lẻ, giá trị ghi sửa được', () => {
    expect(a.editable(0, 'value')).toBe(false);
    for (const c of ['tag', 'format', 'decimals', 'writeValue'])
      expect(a.editable(0, c)).toBe(true);
    expect(adapter({ readOnly: true }).editable(0, 'format')).toBe(false);
  });

  it('danh sách chọn cho định dạng', () => {
    expect(a.options?.(0, 'format')).toEqual(['auto', 'dec', 'hex', 'bin', 'bool']);
    expect(a.options?.(0, 'decimals')).toBeNull();
  });
});

describe('định dạng giá trị', () => {
  it('auto, dec với số lẻ, hex và bin theo độ rộng kiểu, bool', () => {
    expect(formatWatchValue(12.5, 'FLOAT32', 'auto')).toBe('12.5');
    expect(formatWatchValue(12.3456, 'FLOAT32', 'dec', 2)).toBe('12.35');
    expect(formatWatchValue(255, 'UINT16', 'hex')).toBe('0x00FF');
    expect(formatWatchValue(-1, 'INT16', 'hex')).toBe('0xFFFF');
    expect(formatWatchValue(5, 'UINT16', 'bin')).toBe('0b0000000000000101');
    expect(formatWatchValue(1, 'UINT16', 'bool')).toBe('TRUE');
    expect(formatWatchValue(0, 'UINT16', 'bool')).toBe('FALSE');
    expect(formatWatchValue(true, 'BOOL', 'dec')).toBe('1');
    expect(formatWatchValue('chữ', 'STRING', 'auto')).toBe('chữ');
    expect(formatWatchValue(null, 'FLOAT32', 'auto')).toBe('—');
    expect(formatWatchValue(1.5, 'FLOAT32', 'hex')).toBe('1.5');
    expect(formatWatchValue('12345678901234567890', 'UINT64', 'hex')).toBe('0xAB54A98CEB1F0AD2');
  });
});

describe('sửa', () => {
  const upsert = (edits: ReturnType<ReturnType<typeof adapter>['apply']>['edits']) => {
    expect(edits).toHaveLength(1);
    const e = edits[0];
    if (e.kind !== 'watchTableUpsert') throw new Error(e.kind);
    return e.table;
  };

  it('định dạng, số lẻ, giá trị ghi: một watchTableUpsert; auto là mặc định nên bỏ khóa', () => {
    const a = adapter();
    const t = upsert(
      a.apply([
        { row: 1, col: 'format', text: 'hex' },
        { row: 1, col: 'writeValue', text: '7' },
        { row: 0, col: 'format', text: 'auto' },
        { row: 0, col: 'decimals', text: '' },
      ]).edits,
    );
    expect(t.rows[1]).toEqual({ tag: 'PUMP01.STATE', format: 'hex', writeValue: '7' });
    expect(t.rows[0]).toEqual({ tag: 'TANK01.SP', writeValue: '80' });
    expect(t.id).toBe('van-hanh');
  });

  it('từ chối định dạng lạ, số lẻ ngoài 0–9', () => {
    const a = adapter();
    expect(a.apply([{ row: 0, col: 'format', text: 'octal' }]).rejected[0].reason).toBe(
      'wt.err.format',
    );
    expect(a.apply([{ row: 0, col: 'decimals', text: '10' }]).rejected[0].reason).toBe(
      'wt.err.decimals',
    );
    expect(a.apply([{ row: 0, col: 'decimals', text: 'x' }]).rejected[0].reason).toBe(
      'wt.err.decimals',
    );
  });

  it('gõ tên vào ô tên đổi Tag của dòng; tên sai luật bị từ chối', () => {
    const a = adapter();
    expect(upsert(a.apply([{ row: 1, col: 'tag', text: ' TANK01.SP ' }]).edits).rows[1].tag).toBe(
      'TANK01.SP',
    );
    expect(a.apply([{ row: 1, col: 'tag', text: '1x' }]).rejected[0].reason).toBe('wt.err.tag');
    expect(a.apply([{ row: 1, col: 'tag', text: '' }]).rejected[0].reason).toBe('wt.err.tag');
  });

  it('dán danh sách tên vào ô cuối: tạo dòng mới', () => {
    const a = adapter();
    const t = upsert(
      a.apply([
        { row: null, newIndex: 0, col: 'tag', text: 'A.ONE' },
        { row: null, newIndex: 1, col: 'tag', text: 'A.TWO' },
        { row: null, newIndex: 1, col: 'format', text: 'hex' },
      ]).edits,
    );
    expect(t.rows.slice(-2)).toEqual([{ tag: 'A.ONE' }, { tag: 'A.TWO', format: 'hex' }]);
  });

  it('xóa dòng', () => {
    const a = adapter();
    const e = a.remove?.([1, 3]);
    const t = upsert(e!);
    expect(t.rows.map((r) => r.tag)).toEqual(['TANK01.SP', 'PUMP01.RUN_CMD']);
  });

  it('chỉ đọc: không sửa đổi', () => {
    const a = adapter({ readOnly: true });
    expect(a.maxRows).toBe(0);
  });
});

describe('thêm Tag và bảng', () => {
  it('gợi ý khi gõ tên: bỏ dấu, không phân biệt hoa thường, đầu tên trước', () => {
    const ids = ['TANK01.LEVEL', 'TANK01.SP', 'PUMP01.STATE', 'MOTOR.TANK_X'];
    expect(suggestTags(ids, 'tank0')).toEqual(['TANK01.LEVEL', 'TANK01.SP']);
    expect(suggestTags(ids, 'tank')).toEqual(['TANK01.LEVEL', 'TANK01.SP', 'MOTOR.TANK_X']);
    expect(suggestTags(ids, '')).toEqual(ids);
    expect(suggestTags(ids, 'sp', 1)).toHaveLength(1);
  });

  it('dán danh sách tên: tách theo dòng, tab, dấu phẩy, chấm phẩy, khoảng trắng; bỏ rỗng', () => {
    expect(parseNameList('A.ONE\r\nA.TWO\tA.THREE, A.FOUR;  A.FIVE\n\n')).toEqual([
      'A.ONE',
      'A.TWO',
      'A.THREE',
      'A.FOUR',
      'A.FIVE',
    ]);
  });

  it('addNames: thêm vào cuối, cắt ở 200 dòng và báo số bị bỏ; một sửa đổi', () => {
    const r = addNames(TABLE, ['X.ONE', 'X.TWO']);
    expect(r.added).toBe(2);
    expect(r.edit.kind).toBe('watchTableUpsert');
    const big = { ...TABLE, rows: Array.from({ length: 199 }, (_, i) => ({ tag: `T${i}` })) };
    const cut = addNames(big, ['A', 'B', 'C']);
    expect(cut.added).toBe(1);
    expect(cut.dropped).toBe(2);
  });

  it('bảng mới: id từ tên (bỏ dấu, gạch ngang), duy nhất; tên rỗng thì "Bảng theo dõi n"', () => {
    expect(newWatchTable(['van-hanh'], 'Vận hành').id).toBe('van-hanh-2');
    expect(newWatchTable([], 'Bơm số 1 / Khu A').id).toBe('bom-so-1-khu-a');
    const blank = newWatchTable(['bang-theo-doi-1'], '');
    expect(blank.id).toBe('bang-theo-doi-2');
    expect(blank.name.length).toBeGreaterThan(0);
    expect(blank.rows).toEqual([]);
  });

  it('Tag cần đăng ký live của bảng: không trùng, bỏ rỗng', () => {
    expect(watchTags({ ...TABLE, rows: [{ tag: 'A' }, { tag: 'A' }, { tag: 'B' }] })).toEqual([
      'A',
      'B',
    ]);
  });
});

describe('cột Kết quả ghi (US2)', () => {
  it('chỉ có khi cấp hàm writes; chữ và sắc thái theo dòng; không sửa được', () => {
    expect(adapter().columns.map((c) => c.key)).not.toContain('result');
    const a = watchAdapter({
      table: TABLE,
      tags: TAGS,
      valueTables: VT,
      online: true,
      writes: (row) => (row === 0 ? { text: 'đã xác nhận · 03:12:07', tone: 'ok' } : null),
    });
    expect(a.columns.at(-1)?.key).toBe('result');
    expect(a.text(0, 'result')).toBe('đã xác nhận · 03:12:07');
    expect(a.text(1, 'result')).toBe('');
    expect(a.writeTone(0)).toBe('ok');
    expect(a.writeTone(1)).toBeNull();
    expect(a.editable(0, 'result')).toBe(false);
  });
});
