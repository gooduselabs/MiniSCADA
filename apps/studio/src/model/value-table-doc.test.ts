// Mô hình editor Bảng giá trị (T186, FR-048, FR-046, US4-7, US4-8): adapter lưới (cột Giá trị hoặc khoảng, Chữ, Màu; dòng mặc
// định ở cuối), cách viết giá trị và khoảng, lỗi theo ô (E_VT_OVERLAP, E_VT_RANGE, E_VT_TEXT, màu sai), ô thử (lookup).
import { describe, expect, it } from 'vitest';
import type { ValueTableDoc } from '@mat/project-schema';
import {
  VT_MAX_ENTRIES,
  formatKey,
  parseKey,
  tableIssues,
  tryLookup,
  valueTableAdapter,
} from './value-table-doc.ts';

const doc = (over: Partial<ValueTableDoc> = {}): ValueTableDoc => ({
  schemaVersion: '0.2.0',
  name: 'TrangThaiBom',
  entries: [
    { value: 0, text: 'Dừng', color: '#808080' },
    { value: 1, text: 'Chạy', color: '#2E7D32' },
    { value: 2, text: 'Lỗi', color: '#C62828' },
    { from: 10, to: 20, text: 'Bảo trì' },
  ],
  default: { text: 'Không rõ', color: '#B26A00' },
  ...over,
});

const edited = (r: { edits: readonly unknown[] }): ValueTableDoc => {
  expect(r.edits).toHaveLength(1);
  const e = r.edits[0] as { kind: string; table: ValueTableDoc };
  expect(e.kind).toBe('valueTableUpsert');
  return e.table;
};

describe('formatKey / parseKey', () => {
  it('giá trị đơn, BOOL, khoảng nửa mở, khoảng một đầu', () => {
    expect(formatKey({ value: 0, text: '' })).toBe('0');
    expect(formatKey({ value: -2.5, text: '' })).toBe('-2.5');
    expect(formatKey({ value: true, text: '' })).toBe('true');
    expect(formatKey({ from: 10, to: 20, text: '' })).toBe('[10, 20)');
    expect(formatKey({ from: 10, text: '' })).toBe('[10, )');
    expect(formatKey({ to: 20, text: '' })).toBe('[, 20)');
  });

  it.each([
    ['0', { value: 0 }],
    ['  42 ', { value: 42 }],
    ['-2.5', { value: -2.5 }],
    ['1e3', { value: 1000 }],
    ['true', { value: true }],
    ['FALSE', { value: false }],
    ['[10, 20)', { from: 10, to: 20 }],
    ['[10,20)', { from: 10, to: 20 }],
    ['[-5, 0)', { from: -5, to: 0 }],
    ['10..20', { from: 10, to: 20 }],
    ['[10, )', { from: 10 }],
    ['>=10', { from: 10 }],
    ['[, 20)', { to: 20 }],
    ['<20', { to: 20 }],
    ['..20', { to: 20 }],
    ['10..', { from: 10 }],
    ['[20, 10)', { from: 20, to: 10 }],
  ])('đọc "%s"', (text, want) => {
    expect(parseKey(text)).toEqual({ ok: true, key: want });
  });

  it.each(['', 'abc', '[10, 20]', '1,5', '[1;2)', '[, )', '..', 'NaN', 'Infinity'])(
    'từ chối "%s"',
    (text) => {
      expect(parseKey(text).ok).toBe(false);
    },
  );

  it('viết rồi đọc lại cho cùng kết quả', () => {
    for (const e of doc().entries) {
      const back = parseKey(formatKey(e));
      expect(back.ok && back.key).toEqual(
        e.value !== undefined ? { value: e.value } : { from: e.from, to: e.to },
      );
    }
  });
});

describe('valueTableAdapter: lưới', () => {
  const ad = (d = doc(), readOnly = false) => valueTableAdapter({ table: d, readOnly });

  it('3 cột; mỗi mục một dòng, dòng mặc định ở cuối', () => {
    const a = ad();
    expect(a.columns.map((c) => c.key)).toEqual(['value', 'text', 'color']);
    expect(a.columns.map((c) => c.label)).toEqual(['Giá trị / khoảng', 'Chữ', 'Màu']);
    expect(a.columns[2]!.kind).toBe('color');
    expect(a.rowCount()).toBe(5);
    expect(a.maxRows).toBe(VT_MAX_ENTRIES + 1);
    expect(a.text(0, 'value')).toBe('0');
    expect(a.text(3, 'value')).toBe('[10, 20)');
    expect(a.text(3, 'color')).toBe('');
    expect(a.text(4, 'value')).toBe('(mặc định)');
    expect(a.text(4, 'text')).toBe('Không rõ');
    expect(a.text(4, 'color')).toBe('#B26A00');
    expect(a.editable(4, 'value')).toBe(false);
    expect(a.editable(4, 'text')).toBe(true);
    expect(a.editable(0, 'value')).toBe(true);
  });

  it('chỉ đọc: không ô nào sửa được', () => {
    const a = ad(doc(), true);
    expect(a.editable(0, 'text')).toBe(false);
    expect(a.editable(4, 'color')).toBe(false);
  });

  it('sửa chữ, màu và giá trị của một mục: một sửa đổi valueTableUpsert', () => {
    const a = ad();
    const next = edited(
      a.apply([
        { row: 1, col: 'text', text: 'Đang chạy' },
        { row: 1, col: 'color', text: '#00ff00' },
        { row: 3, col: 'value', text: '[10, 15)' },
      ]),
    );
    expect(next.entries[1]).toEqual({ value: 1, text: 'Đang chạy', color: '#00ff00' });
    expect(next.entries[3]).toEqual({ from: 10, to: 15, text: 'Bảo trì' });
    expect(next.entries[0]).toEqual(doc().entries[0]);
  });

  it('đổi kiểu khóa: từ giá trị sang khoảng thì bỏ `value`, từ khoảng sang giá trị thì bỏ from/to', () => {
    const a = ad();
    const next = edited(
      a.apply([
        { row: 0, col: 'value', text: '[0, 5)' },
        { row: 3, col: 'value', text: '7' },
      ]),
    );
    expect(next.entries[0]).toEqual({ from: 0, to: 5, text: 'Dừng', color: '#808080' });
    expect(next.entries[3]).toEqual({ value: 7, text: 'Bảo trì' });
  });

  it('xóa màu bằng ô trống; dòng mặc định: sửa chữ và màu, xóa hết thì bỏ `default`', () => {
    const a = ad();
    expect(edited(a.apply([{ row: 0, col: 'color', text: '' }])).entries[0]).toEqual({
      value: 0,
      text: 'Dừng',
    });
    expect(edited(a.apply([{ row: 4, col: 'text', text: 'Lạ' }])).default).toEqual({
      text: 'Lạ',
      color: '#B26A00',
    });
    const cleared = edited(
      a.apply([
        { row: 4, col: 'text', text: '' },
        { row: 4, col: 'color', text: '' },
      ]),
    );
    expect(cleared.default).toBeUndefined();
  });

  it('từ chối tại ô: màu sai, chữ quá 64 ký tự, giá trị không đọc được, sửa cột Giá trị của dòng mặc định', () => {
    const a = ad();
    const r = a.apply([
      { row: 1, col: 'color', text: 'xanh' },
      { row: 1, col: 'text', text: 'x'.repeat(65) },
      { row: 2, col: 'value', text: 'abc' },
      { row: 4, col: 'value', text: '5' },
    ]);
    expect(r.rejected.map((x) => [x.row, x.col])).toEqual([
      [1, 'color'],
      [1, 'text'],
      [2, 'value'],
      [4, 'value'],
    ]);
    expect(r.rejected[0]!.reason).toBe('vt.err.color');
    expect(r.rejected[1]!.reason).toBe('vt.err.textLen');
    expect(r.rejected[2]!.reason).toBe('vt.err.key');
    expect(r.edits).toHaveLength(0);
  });

  it('màu 3 chữ số (#abc) mở rộng thành #aabbcc; chữ đúng 64 ký tự nhận', () => {
    const a = ad();
    const next = edited(
      a.apply([
        { row: 0, col: 'color', text: '#abc' },
        { row: 1, col: 'text', text: 'ế'.repeat(64) },
      ]),
    );
    expect(next.entries[0]!.color).toBe('#aabbcc');
    expect(next.entries[1]!.text).toHaveLength(64);
  });

  it('dòng mới (dán, gõ ở cuối): thêm mục theo thứ tự, trước dòng mặc định; thiếu cột giá trị bị từ chối', () => {
    const a = ad();
    const r = a.apply([
      { row: null, newIndex: 0, col: 'value', text: '3' },
      { row: null, newIndex: 0, col: 'text', text: 'Bảo dưỡng' },
      { row: null, newIndex: 1, col: 'text', text: 'Thiếu giá trị' },
    ]);
    const next = edited(r);
    expect(next.entries).toHaveLength(5);
    expect(next.entries[4]).toEqual({ value: 3, text: 'Bảo dưỡng' });
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]).toMatchObject({ row: null, newIndex: 1, reason: 'vt.err.keyRequired' });
  });

  it('append: mục mới có giá trị là số nguyên nhỏ nhất chưa dùng, chữ rỗng; hàng cuối trước mặc định', () => {
    const a = ad();
    const r = a.append!();
    expect(r.row).toBe(4);
    expect(edited(r).entries[4]).toEqual({ value: 3, text: '' });
  });

  it('không thêm quá 256 mục', () => {
    const full = doc({
      entries: Array.from({ length: VT_MAX_ENTRIES }, (_, i) => ({ value: i, text: 'x' })),
    });
    const a = ad(full);
    const r = a.apply([{ row: null, newIndex: 0, col: 'value', text: '999' }]);
    expect(r.edits).toHaveLength(0);
    expect(r.rejected[0]!.reason).toBe('vt.err.max');
    expect(a.append!().edits).toHaveLength(0);
  });

  it('xóa dòng: mục bị bỏ; dòng mặc định bị xóa thì bỏ `default`', () => {
    const a = ad();
    expect(edited({ edits: a.remove!([1, 2]) }).entries.map((e) => e.text)).toEqual([
      'Dừng',
      'Bảo trì',
    ]);
    expect(edited({ edits: a.remove!([4]) }).default).toBeUndefined();
  });

  it('tìm theo chữ của cả dòng', () => {
    expect(ad().searchText!(1)).toContain('Chạy');
  });
});

describe('tableIssues: lỗi theo ô', () => {
  it('chồng nhau: báo ở mục sau của cặp, cột Giá trị, kèm mã E_VT_OVERLAP', () => {
    const d = doc({
      entries: [
        { value: 0, text: 'a' },
        { from: 10, to: 20, text: 'b' },
        { from: 15, to: 25, text: 'c' },
      ],
    });
    const m = tableIssues(d);
    expect(m.get('2:value')?.[0]).toContain('E_VT_OVERLAP');
    expect(m.get('2:value')?.[0]).toContain('mục 2');
    expect(m.has('1:value')).toBe(false);
  });

  it('khoảng rỗng, chữ quá dài, mục thiếu khóa, màu sai trong file', () => {
    const d = doc({
      entries: [
        { from: 5, to: 5, text: 'a' },
        { value: 1, text: 'x'.repeat(65) },
        { value: 2, text: 'ok', color: 'red' },
        { text: 'khong khoa' },
      ],
      default: { text: 'y'.repeat(65) },
    });
    const m = tableIssues(d);
    expect(m.get('0:value')?.[0]).toContain('E_VT_RANGE');
    expect(m.get('1:text')?.[0]).toContain('E_VT_TEXT');
    expect(m.get('2:color')?.[0]).toContain('red');
    expect(m.get('3:value')?.length).toBe(1);
    expect(m.get('4:text')?.[0]).toContain('E_VT_TEXT');
  });

  it('bảng đúng: không lỗi', () => {
    expect(tableIssues(doc()).size).toBe(0);
  });
});

describe('tryLookup: ô thử', () => {
  const d = doc();
  it('khớp giá trị: chữ, màu, số thứ tự mục', () => {
    expect(tryLookup(d, '1')).toEqual({
      kind: 'entry',
      text: 'Chạy',
      color: '#2E7D32',
      entry: 1,
      label: 'mục 2',
    });
  });
  it('khớp khoảng nửa mở: 10 vào, 20 ra; không màu thì null', () => {
    expect(tryLookup(d, '10')).toMatchObject({
      kind: 'entry',
      text: 'Bảo trì',
      color: null,
      entry: 3,
    });
    expect(tryLookup(d, '19.9')).toMatchObject({ entry: 3 });
    expect(tryLookup(d, '20')).toMatchObject({
      kind: 'default',
      text: 'Không rõ',
      color: '#B26A00',
    });
  });
  it('BOOL là 1/0; ô trống là chưa thử; không phải số báo lỗi', () => {
    expect(tryLookup(d, 'true')).toMatchObject({ entry: 1 });
    expect(tryLookup(d, 'false')).toMatchObject({ entry: 0 });
    expect(tryLookup(d, '  ')).toEqual({ kind: 'empty' });
    expect(tryLookup(d, 'abc')).toEqual({ kind: 'invalid' });
  });
  it('không khớp và không có mặc định: chữ rỗng, không mục', () => {
    expect(tryLookup(doc({ default: undefined }), '99')).toEqual({
      kind: 'none',
      text: '',
      color: null,
    });
  });
});
