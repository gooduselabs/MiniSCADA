// Lưới dùng chung: dòng đang hiện (lọc, sắp xếp), vùng chọn hình chữ nhật, di chuyển bằng phím (feature 006, T085,
// ADR-016, data-model §13.2; FR-045, FR-046).
import { describe, expect, it } from 'vitest';
import {
  buildView,
  clampSelection,
  gridKey,
  initialGrid,
  selectAll,
  selectCell,
  selectionRect,
  setColFilter,
  setFilter,
  setSort,
  type GridState,
  type KeyInput,
} from './index.ts';
import { FakeAdapter, names } from './test-adapter.ts';

const demo = () =>
  new FakeAdapter([
    { id: 'TANK01.LEVEL', addr: 'HR100', min: '0', desc: 'Mức nước bồn' },
    { id: 'TANK01.SP', addr: 'HR200', min: '10', desc: 'Điểm đặt' },
    { id: 'PUMP01.RUN', type: 'BOOL', addr: 'C10', min: '', desc: 'Bơm chạy' },
    { id: 'METER1.P', addr: '30013', min: '-5', desc: 'Công suất' },
    { id: 'TEMP', addr: 'HR7', min: '100', desc: 'Nhiệt độ' },
  ]);
const at = (row: number, col: string, extra: Partial<GridState> = {}): GridState => ({
  ...initialGrid,
  cell: { row, col },
  anchor: { row, col },
  ...extra,
});
const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({ key: k, ...mods });

describe('dòng đang hiện', () => {
  it('không lọc: mọi dòng theo thứ tự gốc, mọi cột', () => {
    const v = buildView(demo(), initialGrid);
    expect(v.rows).toEqual([0, 1, 2, 3, 4]);
    expect(v.cols).toEqual(['id', 'type', 'addr', 'min', 'info', 'desc']);
  });

  it('ô tìm: chứa chữ bỏ dấu, không phân biệt hoa thường, nhiều từ phải đủ', () => {
    const a = demo();
    expect(buildView(a, setFilter(a, initialGrid, 'muc nuoc')).rows).toEqual([0]);
    expect(buildView(a, setFilter(a, initialGrid, 'tank01')).rows).toEqual([0, 1]);
    expect(buildView(a, setFilter(a, initialGrid, 'tank sp')).rows).toEqual([1]);
    expect(buildView(a, setFilter(a, initialGrid, 'khong co')).rows).toEqual([]);
  });

  it('lọc theo cột: chuỗi chứa (bỏ dấu); cột số có so sánh > >= < <= = !=', () => {
    const a = demo();
    expect(buildView(a, setColFilter(a, initialGrid, 'desc', 'bom')).rows).toEqual([2]);
    expect(buildView(a, setColFilter(a, initialGrid, 'min', '>=10')).rows).toEqual([1, 4]);
    expect(buildView(a, setColFilter(a, initialGrid, 'min', '<0')).rows).toEqual([3]);
    expect(buildView(a, setColFilter(a, initialGrid, 'min', '=0')).rows).toEqual([0]);
    expect(buildView(a, setColFilter(a, initialGrid, 'min', '!=0')).rows).toEqual([1, 3, 4]);
    // Ô rỗng không thỏa so sánh số.
    expect(buildView(a, setColFilter(a, initialGrid, 'min', '>-100')).rows).toEqual([0, 1, 3, 4]);
    const both = setColFilter(a, setFilter(a, initialGrid, 'tank'), 'min', '>5');
    expect(buildView(a, both).rows).toEqual([1]);
    // Bỏ bộ lọc cột bằng chuỗi rỗng.
    expect(setColFilter(a, both, 'min', '').colFilters).toEqual({});
  });

  it('sắp xếp: cột chữ theo tiếng Việt, cột số theo giá trị; đổi chiều; dòng gốc không đổi', () => {
    const a = demo();
    // Ô trống đứng đầu khi tăng dần, cuối khi giảm dần.
    expect(buildView(a, setSort(a, initialGrid, 'min', 'asc')).rows).toEqual([2, 3, 0, 1, 4]);
    expect(buildView(a, setSort(a, initialGrid, 'min', 'desc')).rows).toEqual([4, 1, 0, 3, 2]);
    expect(buildView(a, setSort(a, initialGrid, 'id', 'asc')).rows).toEqual([3, 2, 0, 1, 4]);
    expect(buildView(a, setSort(a, initialGrid, null, 'asc')).rows).toEqual([0, 1, 2, 3, 4]);
    expect(names(a)).toEqual(['TANK01.LEVEL', 'TANK01.SP', 'PUMP01.RUN', 'METER1.P', 'TEMP']);
  });

  it('đổi bộ lọc: ô chọn giữ nếu còn hiện, không thì về dòng đầu đang hiện; không còn dòng thì bỏ chọn', () => {
    const a = demo();
    expect(setFilter(a, at(1, 'desc'), 'tank').cell).toEqual({ row: 1, col: 'desc' });
    expect(setFilter(a, at(4, 'desc'), 'tank').cell).toEqual({ row: 0, col: 'desc' });
    const none = setFilter(a, at(4, 'desc'), 'khong co');
    expect(none.cell).toBeNull();
    expect(none.anchor).toBeNull();
  });

  it('clampSelection: dòng bị xóa thì về dòng cuối còn lại, cột không còn thì về cột đầu', () => {
    const a = demo();
    a.rows.length = 2;
    expect(clampSelection(a, at(4, 'desc')).cell).toEqual({ row: 1, col: 'desc' });
    expect(clampSelection(a, at(0, 'khong-co')).cell).toEqual({ row: 0, col: 'id' });
    a.rows.length = 0;
    expect(clampSelection(a, at(0, 'id')).cell).toBeNull();
  });
});

describe('vùng chọn hình chữ nhật', () => {
  it('chọn ô: ô hiện hành và neo trùng nhau; Shift+chọn kéo vùng từ neo', () => {
    const a = demo();
    const s = selectCell(a, initialGrid, { row: 1, col: 'type' });
    expect(s.cell).toEqual({ row: 1, col: 'type' });
    expect(s.anchor).toEqual({ row: 1, col: 'type' });
    const ext = selectCell(a, s, { row: 3, col: 'min' }, true);
    expect(ext.anchor).toEqual({ row: 1, col: 'type' });
    expect(selectionRect(buildView(a, ext), ext)).toEqual({ r0: 1, r1: 3, c0: 1, c1: 3 });
  });

  it('vùng theo vị trí đang hiện (khi sắp xếp, lọc): hai đầu bất kỳ thứ tự', () => {
    const a = demo();
    const sorted = setSort(a, initialGrid, 'min', 'asc'); // 2, 3, 0, 1, 4
    let s = selectCell(a, sorted, { row: 0, col: 'id' });
    s = selectCell(a, s, { row: 2, col: 'type' }, true);
    expect(selectionRect(buildView(a, s), s)).toEqual({ r0: 0, r1: 2, c0: 0, c1: 1 });
  });

  it('Shift+mũi tên mở rộng từ neo; mũi tên thường thu về một ô', () => {
    const a = demo();
    let r = gridKey(a, at(1, 'id'), key('ArrowDown', { shiftKey: true }));
    expect(r.handled).toBe(true);
    r = gridKey(a, r.state, key('ArrowRight', { shiftKey: true }));
    r = gridKey(a, r.state, key('ArrowDown', { shiftKey: true }));
    expect(selectionRect(buildView(a, r.state), r.state)).toEqual({ r0: 1, r1: 3, c0: 0, c1: 1 });
    expect(r.state.anchor).toEqual({ row: 1, col: 'id' });
    const back = gridKey(a, r.state, key('ArrowUp', { shiftKey: true }));
    expect(selectionRect(buildView(a, back.state), back.state)).toEqual({
      r0: 1,
      r1: 2,
      c0: 0,
      c1: 1,
    });
    const plain = gridKey(a, r.state, key('ArrowLeft'));
    expect(plain.state.anchor).toEqual(plain.state.cell);
  });

  it('Ctrl+A chọn mọi ô', () => {
    const a = demo();
    const r = gridKey(a, at(2, 'desc'), key('a', { ctrlKey: true }));
    expect(r.handled).toBe(true);
    expect(selectionRect(buildView(a, r.state), r.state)).toEqual({ r0: 0, r1: 4, c0: 0, c1: 5 });
    expect(selectAll(a, at(0, 'id')).anchor).toEqual({ row: 0, col: 'id' });
  });

  it('không chọn gì thì không có vùng', () => {
    const a = demo();
    expect(selectionRect(buildView(a, initialGrid), initialGrid)).toBeNull();
  });
});

describe('di chuyển bằng phím', () => {
  it('mũi tên di chuyển, chặn ở biên', () => {
    const a = demo();
    let s = at(0, 'id');
    s = gridKey(a, s, key('ArrowUp')).state;
    expect(s.cell).toEqual({ row: 0, col: 'id' });
    s = gridKey(a, s, key('ArrowDown')).state;
    s = gridKey(a, s, key('ArrowRight')).state;
    expect(s.cell).toEqual({ row: 1, col: 'type' });
    s = at(4, 'desc');
    expect(gridKey(a, s, key('ArrowDown')).state.cell).toEqual({ row: 4, col: 'desc' });
    expect(gridKey(a, s, key('ArrowRight')).state.cell).toEqual({ row: 4, col: 'desc' });
  });

  it('bỏ qua dòng bị lọc và đi theo thứ tự sắp xếp', () => {
    const a = demo();
    const filtered = at(0, 'id', { filter: 'tank01' });
    expect(gridKey(a, filtered, key('ArrowDown')).state.cell?.row).toBe(1);
    expect(gridKey(a, at(1, 'id', { filter: 'tank01' }), key('ArrowDown')).state.cell?.row).toBe(1);
    const sorted = setSort(a, at(3, 'id'), 'min', 'asc'); // 2, 3, 0, 1, 4
    expect(gridKey(a, sorted, key('ArrowDown')).state.cell?.row).toBe(0);
  });

  it('Ctrl+mũi tên tới biên; Home, End trong dòng; Ctrl+Home, Ctrl+End tới ô đầu, cuối', () => {
    const a = demo();
    const s = at(2, 'addr');
    expect(gridKey(a, s, key('ArrowDown', { ctrlKey: true })).state.cell?.row).toBe(4);
    expect(gridKey(a, s, key('ArrowUp', { ctrlKey: true })).state.cell?.row).toBe(0);
    expect(gridKey(a, s, key('ArrowRight', { ctrlKey: true })).state.cell?.col).toBe('desc');
    expect(gridKey(a, s, key('ArrowLeft', { ctrlKey: true })).state.cell?.col).toBe('id');
    expect(gridKey(a, s, key('Home')).state.cell).toEqual({ row: 2, col: 'id' });
    expect(gridKey(a, s, key('End')).state.cell).toEqual({ row: 2, col: 'desc' });
    expect(gridKey(a, s, key('Home', { ctrlKey: true })).state.cell).toEqual({ row: 0, col: 'id' });
    expect(gridKey(a, s, key('End', { ctrlKey: true })).state.cell).toEqual({
      row: 4,
      col: 'desc',
    });
  });

  it('PageDown, PageUp đi theo số dòng của khung nhìn', () => {
    const a = new FakeAdapter(Array.from({ length: 100 }, (_, i) => ({ id: `T${i}` })));
    const s = at(10, 'id');
    expect(gridKey(a, s, key('PageDown'), { pageSize: 20 }).state.cell?.row).toBe(30);
    expect(gridKey(a, s, key('PageUp'), { pageSize: 20 }).state.cell?.row).toBe(0);
    expect(gridKey(a, at(95, 'id'), key('PageDown'), { pageSize: 20 }).state.cell?.row).toBe(99);
  });

  it('Tab sang phải, Shift+Tab sang trái; ở biên không giữ phím để focus rời lưới', () => {
    const a = demo();
    const r = gridKey(a, at(1, 'id'), key('Tab'));
    expect(r.handled).toBe(true);
    expect(r.state.cell).toEqual({ row: 1, col: 'type' });
    expect(gridKey(a, at(1, 'type'), key('Tab', { shiftKey: true })).state.cell?.col).toBe('id');
    const edge = gridKey(a, at(4, 'desc'), key('Tab'));
    expect(edge.handled).toBe(false);
    expect(gridKey(a, at(0, 'id'), key('Tab', { shiftKey: true })).handled).toBe(false);
  });

  it('chưa chọn ô: phím di chuyển chọn ô đầu tiên', () => {
    const a = demo();
    const r = gridKey(a, initialGrid, key('ArrowDown'));
    expect(r.state.cell).toEqual({ row: 0, col: 'id' });
    expect(r.handled).toBe(true);
  });

  it('bảng trống: phím không làm gì', () => {
    const a = new FakeAdapter([]);
    expect(gridKey(a, initialGrid, key('ArrowDown')).handled).toBe(false);
  });
});
