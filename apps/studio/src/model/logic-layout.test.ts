// Tệp phụ vị trí của sơ đồ Logic (feature 015, T003; spec D2): tên tệp, đọc khoan dung, lưới, đặt/xóa, đổi id, tỉa.
import { describe, expect, it } from 'vitest';
import {
  LAYOUT_GRID,
  emptyLayout,
  logicLayoutFile,
  placeNodes,
  pruneLayout,
  readLayout,
  renameLayoutNode,
  snap,
} from './logic-layout.ts';

describe('logic-layout', () => {
  it('tên tệp phụ cạnh logic.json', () => {
    expect(logicLayoutFile('logic.json')).toBe('logic.layout.json');
    expect(logicLayoutFile('cfg/pump.json')).toBe('cfg/pump.layout.json');
    expect(logicLayoutFile('logic')).toBe('logic.layout.json');
  });

  it('đọc khoan dung: bỏ mục sai, giá trị không phải đối tượng là layout rỗng', () => {
    expect(readLayout(null)).toEqual(emptyLayout());
    expect(readLayout([1, 2])).toEqual(emptyLayout());
    const l = readLayout({
      kind: 'mat-logic-layout',
      version: 1,
      nodes: {
        a: { x: 16, y: 32 },
        b: { x: 'x', y: 0 },
        c: { x: Number.NaN, y: 0 },
        d: null,
        'tag:T1': { x: -48, y: 1e9 },
      },
    });
    expect(l.nodes).toEqual({ a: { x: 16, y: 32 }, 'tag:T1': { x: -48, y: 100000 } });
  });

  it('lưới 16 px', () => {
    expect(LAYOUT_GRID).toBe(16);
    expect(snap(7)).toBe(0);
    expect(snap(8)).toBe(16);
    expect(snap(-9)).toBe(-16);
    expect(snap(37, 1)).toBe(37);
  });

  it('đặt, xóa, đổi id, tỉa trả bản mới, không sửa bản cũ', () => {
    const a = placeNodes(emptyLayout(), { r1: { x: 10, y: 20 }, t1: { x: 0, y: 0 } });
    expect(a.nodes.r1).toEqual({ x: 10, y: 20 });
    const b = placeNodes(a, { t1: null });
    expect(b.nodes.t1).toBeUndefined();
    expect(a.nodes.t1).toEqual({ x: 0, y: 0 });
    const c = renameLayoutNode(a, 'r1', 'r2');
    expect(c.nodes).toEqual({ r2: { x: 10, y: 20 }, t1: { x: 0, y: 0 } });
    expect(renameLayoutNode(a, 'zz', 'r9')).toBe(a);
    expect(pruneLayout(a, new Set(['t1'])).nodes).toEqual({ t1: { x: 0, y: 0 } });
  });
});
