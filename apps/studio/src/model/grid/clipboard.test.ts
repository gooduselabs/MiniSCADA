// Sao chép và dán dạng TSV (Excel) trên lưới (feature 006, T085; FR-045, FR-046; US1-11, US1-12).
import { describe, expect, it } from 'vitest';
import {
  buildView,
  copyText,
  initialGrid,
  parseNumber,
  parseTsv,
  paste,
  selectCell,
  type GridState,
} from './index.ts';
import { FakeAdapter, names } from './test-adapter.ts';

const demo = () =>
  new FakeAdapter([
    { id: 'A', addr: 'HR1', min: '1', desc: 'a' },
    { id: 'B', addr: 'HR2', min: '2', desc: 'b' },
    { id: 'C', addr: 'HR3', min: '3', desc: 'c' },
  ]);
const sel = (a: FakeAdapter, from: [number, string], to?: [number, string]): GridState => {
  let s = selectCell(a, initialGrid, { row: from[0], col: from[1] });
  if (to) s = selectCell(a, s, { row: to[0], col: to[1] }, true);
  return s;
};

describe('sao chép', () => {
  it('chép vùng chọn ra TSV đúng cột, dòng theo thứ tự đang hiện', () => {
    const a = demo();
    expect(copyText(a, sel(a, [0, 'id'], [1, 'addr']))).toBe('A\tFLOAT32\tHR1\r\nB\tFLOAT32\tHR2');
    expect(copyText(a, sel(a, [2, 'desc']))).toBe('c');
    expect(copyText(a, initialGrid)).toBe('');
  });

  it('ô có tab, xuống dòng hoặc nháy kép được bọc nháy kép như Excel', () => {
    const a = new FakeAdapter([
      { id: 'A', desc: 'dòng 1\ndòng 2' },
      { id: 'B', desc: 'a\tb' },
      { id: 'C', desc: 'nói "hay"' },
    ]);
    expect(copyText(a, sel(a, [0, 'desc'], [2, 'desc']))).toBe(
      '"dòng 1\ndòng 2"\r\n"a\tb"\r\n"nói ""hay"""',
    );
    expect(parseTsv(copyText(a, sel(a, [0, 'desc'], [2, 'desc'])))).toEqual([
      ['dòng 1\ndòng 2'],
      ['a\tb'],
      ['nói "hay"'],
    ]);
  });

  it('theo thứ tự đang hiện khi có lọc', () => {
    const a = demo();
    const s = selectCell(a, { ...initialGrid, filter: 'b' }, { row: 1, col: 'id' });
    expect(copyText(a, s)).toBe('B');
  });
});

describe('parseTsv', () => {
  it('dòng bằng CRLF hoặc LF, bỏ dòng trống cuối, giữ ô rỗng', () => {
    expect(parseTsv('a\tb\r\nc\t\r\n')).toEqual([
      ['a', 'b'],
      ['c', ''],
    ]);
    expect(parseTsv('a\nb')).toEqual([['a'], ['b']]);
    expect(parseTsv('')).toEqual([]);
  });
});

describe('dán', () => {
  it('nhiều dòng, nhiều cột từ ô đang chọn; chỉ ô đổi mới sinh sửa đổi', () => {
    const a = demo();
    const r = paste(a, sel(a, [0, 'addr']), 'X1\t5\r\nX2\t6');
    expect(r.edits).toEqual([
      { kind: 'tagField', index: 0, field: 'addr', value: 'X1' },
      { kind: 'tagField', index: 0, field: 'min', value: '5' },
      { kind: 'tagField', index: 1, field: 'addr', value: 'X2' },
      { kind: 'tagField', index: 1, field: 'min', value: '6' },
    ]);
    expect(r.droppedCols).toBe(0);
    expect(r.droppedRows).toBe(0);
    expect(r.rejected).toEqual([]);
  });

  it('dán quá dòng cuối thì tạo dòng mới theo thứ tự', () => {
    const a = demo();
    const r = paste(a, sel(a, [2, 'id']), 'C2\tBOOL\r\nD\tINT16\r\nE\tFLOAT32');
    const upserts = r.edits.filter((e) => e.kind === 'tagUpsert');
    expect(upserts).toHaveLength(2);
    expect((upserts[0] as { tag: { id: string } }).tag.id).toBe('D');
    expect((upserts[1] as { tag: { id: string } }).tag.id).toBe('E');
    a.commit(r.edits);
    expect(names(a)).toEqual(['A', 'B', 'C2', 'D', 'E']);
  });

  it('cột thừa bị bỏ kèm số cột bỏ; ít cột hơn thì các ô còn lại giữ nguyên', () => {
    const a = demo();
    const wide = paste(a, sel(a, [0, 'min']), '9\tx\ty\tz\tw');
    // min, info (chỉ đọc), desc nhận 3 ô đầu; 2 ô cuối thừa.
    expect(wide.droppedCols).toBe(2);
    expect(wide.edits).toEqual([
      { kind: 'tagField', index: 0, field: 'min', value: '9' },
      { kind: 'tagField', index: 0, field: 'desc', value: 'y' },
    ]);
    const narrow = paste(a, sel(a, [0, 'id']), 'Z');
    expect(narrow.edits).toEqual([{ kind: 'tagField', index: 0, field: 'id', value: 'Z' }]);
  });

  it('cột chỉ đọc chiếm chỗ nhưng bị bỏ qua', () => {
    const a = demo();
    const r = paste(a, sel(a, [0, 'min']), '7\tkhong\tdesc moi');
    expect(r.edits.map((e) => (e as { field: string }).field)).toEqual(['min', 'desc']);
  });

  it('dòng đầu khớp tên cột (tiêu đề) thì bỏ qua', () => {
    const a = demo();
    const r = paste(a, sel(a, [0, 'id']), 'Tên\tKiểu\r\nZ1\tBOOL');
    expect(r.skippedHeader).toBe(true);
    expect(r.edits).toEqual([
      { kind: 'tagField', index: 0, field: 'id', value: 'Z1' },
      { kind: 'tagField', index: 0, field: 'type', value: 'BOOL' },
    ]);
    // Không phải tiêu đề: giữ.
    expect(paste(a, sel(a, [0, 'id']), 'Tên khác\tBOOL').skippedHeader).toBe(false);
  });

  it('số đọc theo lựa chọn dấu thập phân; ô mơ hồ là lỗi; ô sai bị đánh dấu, phần còn lại vẫn dán', () => {
    const a = demo();
    const r = paste(a, sel(a, [0, 'min']), '1,5\r\n1,000\r\nabc\r\n2', { decimal: ',' });
    expect(r.edits[0]).toEqual({ kind: 'tagField', index: 0, field: 'min', value: '1.5' });
    expect(r.edits).toHaveLength(2);
    expect(r.edits[1]).toMatchObject({ kind: 'tagUpsert', tag: { min: '2' } });
    expect(r.rejected.map((x) => [x.row, x.col, x.text, x.reason])).toEqual([
      [1, 'min', '1,000', 'gx.cell.ambiguousNumber'],
      [2, 'min', 'abc', 'gx.cell.invalidNumber'],
    ]);
  });

  it('một ô dán vào vùng nhiều ô: điền cả vùng', () => {
    const a = demo();
    const r = paste(a, sel(a, [0, 'desc'], [2, 'desc']), 'x');
    expect(r.edits).toEqual([
      { kind: 'tagField', index: 0, field: 'desc', value: 'x' },
      { kind: 'tagField', index: 1, field: 'desc', value: 'x' },
      { kind: 'tagField', index: 2, field: 'desc', value: 'x' },
    ]);
  });

  it('vượt giới hạn dòng: từ chối phần vượt, báo số dòng bị bỏ', () => {
    const a = new FakeAdapter([{ id: 'A' }, { id: 'B' }], 4);
    const r = paste(a, sel(a, [1, 'id']), 'b2\r\nc\r\nd\r\ne\r\nf');
    // Còn chỗ cho 3 dòng (B + 2 dòng mới = 4); 5 dòng dán: 2 dòng bị bỏ.
    expect(r.droppedRows).toBe(2);
    expect(r.edits.filter((e) => e.kind === 'tagUpsert')).toHaveLength(2);
  });

  it('khi lọc, dán vào các dòng đang hiện', () => {
    const a = demo();
    const s = { ...sel(a, [1, 'id']), filter: 'b' };
    const r = paste(a, s, 'B2\r\nB3');
    expect(r.edits[0]).toEqual({ kind: 'tagField', index: 1, field: 'id', value: 'B2' });
    expect(r.edits[1].kind).toBe('tagUpsert');
    expect(buildView(a, s).rows).toEqual([1]);
  });

  it('chưa chọn ô thì không dán', () => {
    const a = demo();
    expect(paste(a, initialGrid, 'x').edits).toEqual([]);
  });

  it('ô sai do adapter từ chối (kiểu lạ) bị đánh dấu, các ô khác vẫn dán', () => {
    const a = demo();
    const r = paste(a, sel(a, [0, 'id']), 'Z\tBAD\r\nY\tINT16');
    expect(r.rejected.map((x) => [x.row, x.col, x.text])).toEqual([[0, 'type', 'BAD']]);
    expect(r.edits.map((e) => (e as { value: string }).value)).toEqual(['Z', 'Y', 'INT16']);
  });
});

describe('parseNumber (dấu thập phân)', () => {
  it('đọc theo dấu thập phân đã chọn', () => {
    expect(parseNumber('1,5', ',')).toEqual({ ok: true, text: '1.5' });
    expect(parseNumber('1.5', '.')).toEqual({ ok: true, text: '1.5' });
    expect(parseNumber('-12,25', ',')).toEqual({ ok: true, text: '-12.25' });
    expect(parseNumber('  7 ', '.')).toEqual({ ok: true, text: '7' });
    expect(parseNumber('', '.')).toEqual({ ok: true, text: '' });
  });

  it('một nhóm đúng 3 chữ số sau dấu phân cách là mơ hồ (có thể là hàng nghìn)', () => {
    expect(parseNumber('1,000', ',')).toEqual({ ok: false, reason: 'ambiguous' });
    expect(parseNumber('1.000', '.')).toEqual({ ok: false, reason: 'ambiguous' });
    expect(parseNumber('1.000', ',')).toEqual({ ok: false, reason: 'ambiguous' });
    expect(parseNumber('12,345', '.')).toEqual({ ok: false, reason: 'ambiguous' });
    expect(parseNumber('1,25', '.')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseNumber('abc', '.')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseNumber('1e3', '.')).toEqual({ ok: true, text: '1e3' });
  });
});
