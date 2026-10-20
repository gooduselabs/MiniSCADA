// Hàm thuần của bố cục lưới (feature 012, T004; contracts/project-format-1.1.md, data-model.md).
import { describe, expect, it } from 'vitest';
import {
  cellsOf,
  GRID_COLUMNS,
  itemCell,
  orphanItems,
  removeItemRef,
  renameItemRef,
  rowSpanSum,
} from './layout.ts';
import type { GridScreen } from './types-11.ts';

const screen = (): GridScreen => ({
  schemaVersion: '1.1.0',
  id: 'tong-quan',
  name: 'Tổng quan',
  size: { width: 1920, height: 1080 },
  layout: {
    mode: 'grid',
    columns: 12,
    gap: 12,
    padding: 16,
    rows: [
      {
        id: 'r1',
        height: 'auto',
        cells: [
          { id: 'c1', span: 4, item: 'a' },
          { id: 'c2', span: 4, item: 'b' },
          { id: 'c3', span: 3, offset: 1 },
        ],
      },
      { id: 'r2', height: 320, cells: [{ id: 'c4', span: 12, item: 'c' }] },
    ],
  },
  items: [
    { id: 'a', type: 'widget', widget: 'card' },
    { id: 'b', type: 'widget', widget: 'gauge' },
    { id: 'c', type: 'widget', widget: 'line' },
    { id: 'd', type: 'widget', widget: 'lamp' },
  ],
});

describe('layout', () => {
  it('lưới cố định 12 cột', () => {
    expect(GRID_COLUMNS).toBe(12);
  });

  it('cellsOf: mọi ô theo thứ tự hàng rồi ô, kèm chỉ số', () => {
    expect(cellsOf(screen()).map((c) => [c.row, c.index, c.cell.id])).toEqual([
      [0, 0, 'c1'],
      [0, 1, 'c2'],
      [0, 2, 'c3'],
      [1, 0, 'c4'],
    ]);
    expect(cellsOf({ ...screen(), layout: undefined })).toEqual([]);
  });

  it('itemCell: ô chứa item, hoặc null', () => {
    expect(itemCell(screen(), 'b')?.cell.id).toBe('c2');
    expect(itemCell(screen(), 'd')).toBeNull();
  });

  it('orphanItems: item không ô nào trỏ tới', () => {
    expect(orphanItems(screen())).toEqual(['d']);
    expect(orphanItems({ ...screen(), layout: undefined })).toEqual([]);
  });

  it('rowSpanSum: tổng offset + span', () => {
    const s = screen();
    expect(rowSpanSum(s.layout!.rows[0]!)).toBe(12);
    expect(rowSpanSum(s.layout!.rows[1]!)).toBe(12);
  });

  it('renameItemRef: đổi tham chiếu, trả bố cục mới, không đổi bản gốc', () => {
    const s = screen();
    const next = renameItemRef(s.layout!, 'a', 'a2');
    expect(next.rows[0]!.cells[0]!.item).toBe('a2');
    expect(s.layout!.rows[0]!.cells[0]!.item).toBe('a');
    expect(renameItemRef(s.layout!, 'zzz', 'y')).toBe(s.layout);
  });

  it('removeItemRef: ô trỏ item bị xóa thành ô trống', () => {
    const s = screen();
    const next = removeItemRef(s.layout!, 'c');
    expect(next.rows[1]!.cells[0]).toEqual({ id: 'c4', span: 12 });
    expect(removeItemRef(s.layout!, 'zzz')).toBe(s.layout);
  });
});
