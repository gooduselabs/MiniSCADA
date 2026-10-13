// Thứ tự lớp (feature 007, T101): phần tử cuối mảng nằm trên cùng.
import { describe, expect, it } from 'vitest';
import { reorderItems, type ReorderOp } from './layers.ts';

const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
const run = (ids: string[], op: ReorderOp) =>
  reorderItems(items, ids, op)
    .map((i) => i.id)
    .join('');

describe('reorderItems', () => {
  it('một item', () => {
    expect(run(['b'], 'front')).toBe('acdeb');
    expect(run(['d'], 'back')).toBe('dabce');
    expect(run(['b'], 'forward')).toBe('acbde');
    expect(run(['c'], 'backward')).toBe('acbde');
  });
  it('không đổi ở biên: trả đúng mảng cũ', () => {
    expect(reorderItems(items, ['e'], 'forward')).toBe(items);
    expect(reorderItems(items, ['a'], 'backward')).toBe(items);
    expect(reorderItems(items, ['e'], 'front')).toBe(items);
    expect(reorderItems(items, ['a'], 'back')).toBe(items);
    expect(reorderItems(items, [], 'front')).toBe(items);
    expect(reorderItems(items, ['zz'], 'front')).toBe(items);
  });
  it('nhiều item giữ tương quan (không phụ thuộc thứ tự chọn)', () => {
    expect(run(['d', 'b'], 'front')).toBe('acebd');
    expect(run(['e', 'c'], 'back')).toBe('ceabd');
    expect(run(['a', 'c'], 'forward')).toBe('badce');
    expect(run(['b', 'c'], 'forward')).toBe('adbce');
    expect(run(['d', 'e'], 'forward')).toBe('abcde');
    expect(run(['b', 'd'], 'backward')).toBe('badce');
  });
  it('toIndex: vị trí của item đầu khối sau khi bỏ khối ra', () => {
    expect(run(['c', 'e'], { toIndex: 0 })).toBe('ceabd');
    expect(run(['a'], { toIndex: 2 })).toBe('bcade');
    expect(run(['a'], { toIndex: 99 })).toBe('bcdea');
    expect(run(['e'], { toIndex: -3 })).toBe('eabcd');
  });
  it('không đổi đầu vào', () => {
    const snap = JSON.stringify(items);
    run(['b', 'c'], 'front');
    expect(JSON.stringify(items)).toBe(snap);
  });
});
