// Điền xuống (Ctrl+D) và kéo điền trên lưới (feature 006, T085; FR-045, FR-046; studio-ux §5): tên tăng số
// (`TANK_01` → `TANK_02`), ô khác chép nguyên, cột có hàm tăng riêng do adapter cấp (địa chỉ, T121).
import { describe, expect, it } from 'vitest';
import {
  dragFill,
  fillDown,
  incrementName,
  initialGrid,
  selectCell,
  type GridState,
} from './index.ts';
import { FakeAdapter } from './test-adapter.ts';

const demo = () =>
  new FakeAdapter([
    { id: 'TANK_01', type: 'INT16', addr: 'HR100', min: '5', desc: 'bể' },
    { id: 'x', addr: '', desc: '' },
    { id: 'y', addr: '', desc: '' },
    { id: 'z', addr: '', desc: '' },
  ]);
const sel = (a: FakeAdapter, from: [number, string], to?: [number, string]): GridState => {
  let s = selectCell(a, initialGrid, { row: from[0], col: from[1] });
  if (to) s = selectCell(a, s, { row: to[0], col: to[1] }, true);
  return s;
};

describe('incrementName', () => {
  it('tăng nhóm số cuối và giữ số chữ số; không có số thì thêm _1', () => {
    expect(incrementName('TANK_01')).toBe('TANK_02');
    expect(incrementName('TANK_09')).toBe('TANK_10');
    expect(incrementName('TANK02.LEVEL')).toBe('TANK03.LEVEL');
    expect(incrementName('T_99')).toBe('T_100');
    expect(incrementName('PUMP.RUN')).toBe('PUMP.RUN_1');
    expect(incrementName('TANK_01', 3)).toBe('TANK_04');
    expect(incrementName('')).toBe('TAG_1');
  });
});

describe('điền xuống một ô', () => {
  it('chép ô phía trên; cột tên thì tăng số', () => {
    const a = demo();
    const r = fillDown(a, sel(a, [1, 'desc']));
    expect(r.edits).toEqual([{ kind: 'tagField', index: 1, field: 'desc', value: 'bể' }]);
    const name = fillDown(a, sel(a, [1, 'id']));
    expect(name.edits).toEqual([{ kind: 'tagField', index: 1, field: 'id', value: 'TANK_02' }]);
  });

  it('không trùng tên đã có trong bảng', () => {
    const a = demo();
    a.rows[2].id = 'TANK_02';
    const r = fillDown(a, sel(a, [1, 'id']));
    expect(r.edits).toEqual([{ kind: 'tagField', index: 1, field: 'id', value: 'TANK_03' }]);
  });

  it('ở dòng đầu (kể cả dòng đầu đang hiện khi lọc) thì không làm gì', () => {
    const a = demo();
    expect(fillDown(a, sel(a, [0, 'desc'])).edits).toEqual([]);
    const filtered = { ...sel(a, [2, 'desc']), filter: 'y' };
    expect(fillDown(a, filtered).edits).toEqual([]);
  });

  it('cột chỉ đọc thì báo lý do', () => {
    const a = demo();
    const r = fillDown(a, sel(a, [1, 'info']));
    expect(r.edits).toEqual([]);
    expect(r.notice?.key).toBe('gx.notice.readonly');
  });

  it('cột có hàm tăng riêng của adapter (địa chỉ tăng theo số thanh ghi)', () => {
    const a = demo();
    a.stepCols.add('addr');
    const r = fillDown(a, sel(a, [1, 'addr']));
    expect(r.edits).toEqual([{ kind: 'tagField', index: 1, field: 'addr', value: 'HR102' }]);
  });
});

describe('điền xuống vùng nhiều dòng', () => {
  it('dòng đầu của vùng là nguồn; tên tăng dần theo vị trí, cột khác chép; một lô', () => {
    const a = demo();
    const r = fillDown(a, sel(a, [0, 'id'], [3, 'min']));
    expect(r.edits).toEqual([
      { kind: 'tagField', index: 1, field: 'id', value: 'TANK_02' },
      { kind: 'tagField', index: 1, field: 'type', value: 'INT16' },
      { kind: 'tagField', index: 1, field: 'addr', value: 'HR100' },
      { kind: 'tagField', index: 1, field: 'min', value: '5' },
      { kind: 'tagField', index: 2, field: 'id', value: 'TANK_03' },
      { kind: 'tagField', index: 2, field: 'type', value: 'INT16' },
      { kind: 'tagField', index: 2, field: 'addr', value: 'HR100' },
      { kind: 'tagField', index: 2, field: 'min', value: '5' },
      { kind: 'tagField', index: 3, field: 'id', value: 'TANK_04' },
      { kind: 'tagField', index: 3, field: 'type', value: 'INT16' },
      { kind: 'tagField', index: 3, field: 'addr', value: 'HR100' },
      { kind: 'tagField', index: 3, field: 'min', value: '5' },
    ]);
  });

  it('địa chỉ tăng theo bước của adapter qua nhiều dòng', () => {
    const a = demo();
    a.stepCols.add('addr');
    const r = fillDown(a, sel(a, [0, 'addr'], [3, 'addr']));
    expect(r.edits.map((e) => (e as { value: string }).value)).toEqual(['HR102', 'HR104', 'HR106']);
  });

  it('bỏ qua ô chỉ đọc trong vùng; ô giống nhau không sinh sửa đổi', () => {
    const a = demo();
    a.rows[1].desc = 'bể';
    const r = fillDown(a, sel(a, [0, 'info'], [1, 'desc']));
    expect(r.edits).toEqual([]);
  });
});

describe('kéo điền', () => {
  it('kéo xuống: lặp nguồn, cột tên tăng tiếp từ dòng cuối của nguồn', () => {
    const a = demo();
    const r = dragFill(a, sel(a, [0, 'id'], [0, 'desc']), 3);
    expect(
      r.edits
        .filter((e) => (e as { field: string }).field === 'id')
        .map((e) => (e as { value: string }).value),
    ).toEqual(['TANK_02', 'TANK_03', 'TANK_04']);
    expect(r.state.cell).toEqual({ row: 3, col: 'desc' });
    expect(r.state.anchor).toEqual({ row: 0, col: 'id' });
  });

  it('nguồn nhiều dòng thì lặp theo chu kỳ', () => {
    const a = demo();
    a.rows[1].desc = 'hai';
    const r = dragFill(a, sel(a, [0, 'desc'], [1, 'desc']), 3);
    expect(r.edits.map((e) => (e as { index: number; value: string }).value)).toEqual([
      'bể',
      'hai',
    ]);
    expect(r.edits.map((e) => (e as { index: number }).index)).toEqual([2, 3]);
  });

  it('kéo lên hoặc không kéo ra ngoài vùng thì không làm gì', () => {
    const a = demo();
    expect(dragFill(a, sel(a, [2, 'desc']), 1).edits).toEqual([]);
    expect(dragFill(a, sel(a, [2, 'desc']), 2).edits).toEqual([]);
  });
});
