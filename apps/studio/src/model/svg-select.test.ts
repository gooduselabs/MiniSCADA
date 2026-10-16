// Chọn phần tử SVG (feature 008, T065; contract studio-svg-editor §10).
import { describe, expect, it } from 'vitest';
import {
  NOT_ENTERED,
  applyPick,
  breadcrumb,
  enterItem,
  exitItem,
  onSelectKey,
  pickUid,
  selectUids,
  selectionRect,
  syncEnter,
  uidsAtPoint,
  unionRect,
  type UidSource,
} from './svg-select.ts';

const el = (uid?: string): UidSource => ({
  getAttribute: (n) => (n === 'data-mat-uid' && uid ? uid : null),
});
const NO = { shift: false, alt: false };

describe('hit-test với elementsFromPoint giả', () => {
  const list = [el(), el('el_leaf'), el(), el('el_group'), el('el_root')];

  it('phần tử có UID đầu danh sách, bỏ phần tử không UID', () => {
    expect(uidsAtPoint(list)).toEqual(['el_leaf', 'el_group', 'el_root']);
    expect(pickUid(list, NO)).toBe('el_leaf');
    expect(pickUid([el(), el()], NO)).toBeNull();
    expect(pickUid([], NO)).toBeNull();
  });

  it('Alt chọn phần tử có UID kế tiếp (cha), liên tiếp đi lên dần, dừng ở cuối', () => {
    const alt = { shift: false, alt: true };
    expect(pickUid(list, alt)).toBe('el_group');
    expect(pickUid(list, alt, ['el_leaf'])).toBe('el_group');
    expect(pickUid(list, alt, ['el_group'])).toBe('el_root');
    expect(pickUid(list, alt, ['el_root'])).toBe('el_root');
    expect(pickUid([el('el_only')], alt)).toBe('el_only');
  });

  it('Shift thêm hoặc bớt cùng item; chỗ trống bỏ chọn trừ Shift', () => {
    expect(applyPick(['a'], 'b', { shift: true, alt: false })).toEqual(['a', 'b']);
    expect(applyPick(['a', 'b'], 'a', { shift: true, alt: false })).toEqual(['b']);
    expect(applyPick(['a', 'b'], 'c', NO)).toEqual(['c']);
    expect(applyPick(['a', 'b'], null, NO)).toEqual([]);
    expect(applyPick(['a', 'b'], null, { shift: true, alt: false })).toEqual(['a', 'b']);
    const same = ['a'];
    expect(applyPick(same, 'a', NO)).toEqual(['a']);
  });
});

describe('khung chọn theo đơn vị thiết kế', () => {
  it('trừ gốc canvas, pan và chia zoom', () => {
    const r = selectionRect(
      { left: 300, top: 150, width: 200, height: 100 },
      { left: 100, top: 50 },
      { zoom: 2, panX: 40, panY: 20 },
    );
    expect(r).toEqual({ x: 80, y: 40, width: 100, height: 50 });
  });

  it('zoom 1 và pan 0: chỉ trừ gốc; hợp nhiều khung', () => {
    const a = selectionRect(
      { left: 10, top: 10, width: 5, height: 5 },
      { left: 0, top: 0 },
      { zoom: 1, panX: 0, panY: 0 },
    );
    expect(a).toEqual({ x: 10, y: 10, width: 5, height: 5 });
    expect(unionRect([a, { x: 20, y: 0, width: 5, height: 5 }])).toEqual({
      x: 10,
      y: 0,
      width: 15,
      height: 15,
    });
    expect(unionRect([])).toBeNull();
  });
});

describe('trạng thái vào item', () => {
  it('vào, chọn UID, Esc thoát', () => {
    let s = enterItem(NOT_ENTERED, 'svg_bon');
    expect(s).toEqual({ enteredItemId: 'svg_bon', selectedUids: [] });
    s = selectUids(s, ['el_a']);
    expect(s.selectedUids).toEqual(['el_a']);
    expect(onSelectKey(s, 'Enter')).toBe(s);
    expect(onSelectKey(s, 'Escape')).toBe(NOT_ENTERED);
    expect(onSelectKey(NOT_ENTERED, 'Escape')).toBe(NOT_ENTERED);
  });

  it('chưa vào thì không chọn được phần tử; exitItem; nhấp ngoài item thoát', () => {
    expect(selectUids(NOT_ENTERED, ['a'])).toBe(NOT_ENTERED);
    expect(exitItem()).toBe(NOT_ENTERED);
    const s = enterItem(NOT_ENTERED, 'svg_bon');
    expect(syncEnter(s, ['svg_bon'])).toBe(s);
    expect(syncEnter(s, ['svg_khac'])).toBe(NOT_ENTERED);
    expect(syncEnter(s, [])).toBe(NOT_ENTERED);
  });

  it('đường dẫn thanh trạng thái', () => {
    expect(breadcrumb({ screen: 'Bồn', item: 'Sơ đồ', element: 'liquid' })).toEqual([
      'Bồn',
      'Sơ đồ',
      'liquid',
    ]);
    expect(breadcrumb({ screen: 'Bồn', item: 'Sơ đồ' })).toEqual(['Bồn', 'Sơ đồ']);
  });
});
