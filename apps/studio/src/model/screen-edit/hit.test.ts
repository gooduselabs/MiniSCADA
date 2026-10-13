// Chọn theo điểm, theo khung, Tab (feature 007, T101; R19).
import { describe, expect, it } from 'vitest';
import type { Item } from '@mat/project-schema';
import { hitTest, itemsInRect, nextByTab } from './hit.ts';

const w = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<Item> = {},
): Item => ({ id, type: 'widget', widget: 'panel', x, y, width, height, ...extra }) as Item;
const A = w('a', 0, 0, 100, 100);
const B = w('b', 50, 50, 100, 100);
const C = w('c', 0, 0, 200, 200, { locked: true });
const D = w('d', 0, 0, 200, 200, { hidden: true });
const items = [A, B, C, D];

describe('hitTest', () => {
  it('item trên cùng trước, bỏ locked và hidden', () => {
    expect(hitTest(items, { x: 75, y: 75 })).toBe('b');
    expect(hitTest(items, { x: 25, y: 25 })).toBe('a');
    expect(hitTest(items, { x: 175, y: 175 })).toBeNull();
    expect(hitTest(items, { x: 500, y: 500 })).toBeNull();
  });
  it('biên: gồm cạnh trái/trên, loại cạnh phải/dưới', () => {
    expect(hitTest(items, { x: 50, y: 50 })).toBe('b');
    expect(hitTest(items, { x: 150, y: 100 })).toBeNull();
    expect(hitTest(items, { x: 149, y: 149 })).toBe('b');
  });
});

describe('itemsInRect', () => {
  it('chọn mọi item giao khung, theo thứ tự lớp, bỏ locked/hidden', () => {
    expect(itemsInRect(items, { x: 90, y: 90, width: 20, height: 20 })).toEqual(['a', 'b']);
  });
  it('chỉ chạm cạnh hoặc khung rỗng thì không giao', () => {
    expect(itemsInRect(items, { x: 100, y: 0, width: 10, height: 10 })).toEqual([]);
    expect(itemsInRect(items, { x: 10, y: 10, width: 0, height: 0 })).toEqual([]);
  });
});

describe('nextByTab', () => {
  const list = [
    w('a', 0, 0, 5, 5),
    w('b', 0, 0, 5, 5),
    w('c', 0, 0, 5, 5, { locked: true }),
    w('d', 0, 0, 5, 5),
    w('e', 0, 0, 5, 5, { hidden: true }),
  ];
  it('theo thứ tự lớp, bỏ khóa/ẩn, vòng lại', () => {
    expect(nextByTab(list, 'a', false)).toBe('b');
    expect(nextByTab(list, 'b', false)).toBe('d');
    expect(nextByTab(list, 'd', false)).toBe('a');
  });
  it('Shift+Tab ngược', () => {
    expect(nextByTab(list, 'a', true)).toBe('d');
    expect(nextByTab(list, 'd', true)).toBe('b');
  });
  it('chưa chọn: Tab lấy đầu, Shift+Tab lấy cuối; id lạ như chưa chọn', () => {
    expect(nextByTab(list, null, false)).toBe('a');
    expect(nextByTab(list, null, true)).toBe('d');
    expect(nextByTab(list, 'zz', false)).toBe('a');
  });
  it('item hiện tại đang khóa: đi tiếp từ vị trí của nó', () => {
    expect(nextByTab(list, 'c', false)).toBe('d');
    expect(nextByTab(list, 'c', true)).toBe('b');
  });
  it('không có item chọn được', () => {
    expect(nextByTab([w('x', 0, 0, 1, 1, { locked: true })], null, false)).toBeNull();
    expect(nextByTab([], null, false)).toBeNull();
  });
});
