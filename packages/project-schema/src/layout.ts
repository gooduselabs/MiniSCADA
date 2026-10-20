// Hàm thuần của bố cục lưới (feature 012, T005; contracts/project-format-1.1.md §2, data-model.md). Dùng chung cho luật
// (rules-11.ts), Studio (grid-ops, đổi tên, so sánh) và trang vận hành. Không đổi đối số; trả bản mới khi có thay đổi,
// trả lại đúng đối tượng cũ khi không có gì đổi (để store bỏ qua sửa đổi rỗng).
import type { GridCell, GridLayout, GridRow, GridScreen } from './types-11.ts';

/** Số cột của lưới (D1: cố định). */
export const GRID_COLUMNS = 12;
/** Giới hạn của một màn hình (FR-009). */
export const GRID_LIMITS = { rows: 100, cellsPerRow: 12 } as const;
export const GRID_DEFAULTS = { gap: 12, padding: 16 } as const;

export interface CellRef {
  row: number;
  index: number;
  cell: GridCell;
}

/** Mọi ô theo thứ tự hàng rồi ô; màn hình tự do trả mảng rỗng. */
export function cellsOf(screen: Pick<GridScreen, 'layout'>): CellRef[] {
  const out: CellRef[] = [];
  screen.layout?.rows.forEach((r, row) =>
    r.cells.forEach((cell, index) => out.push({ row, index, cell })),
  );
  return out;
}

/** Ô chứa item, hoặc null. */
export function itemCell(screen: Pick<GridScreen, 'layout'>, itemId: string): CellRef | null {
  return cellsOf(screen).find((c) => c.cell.item === itemId) ?? null;
}

/** Id của item không ô nào trỏ tới (chỉ màn hình lưới). */
export function orphanItems(screen: Pick<GridScreen, 'layout' | 'items'>): string[] {
  if (!screen.layout) return [];
  const used = new Set(cellsOf(screen).flatMap((c) => (c.cell.item ? [c.cell.item] : [])));
  return screen.items.filter((i) => !used.has(i.id)).map((i) => i.id);
}

/** Tổng offset + span của một hàng. */
export function rowSpanSum(row: GridRow): number {
  return row.cells.reduce((n, c) => n + (c.offset ?? 0) + c.span, 0);
}

function mapCells(layout: GridLayout, f: (c: GridCell) => GridCell): GridLayout {
  let changed = false;
  const rows = layout.rows.map((r) => {
    let rowChanged = false;
    const cells = r.cells.map((c) => {
      const n = f(c);
      if (n !== c) rowChanged = true;
      return n;
    });
    if (!rowChanged) return r;
    changed = true;
    return { ...r, cells };
  });
  return changed ? { ...layout, rows } : layout;
}

/** Đổi tham chiếu item `from` thành `to` (đổi id item, nhân bản). */
export function renameItemRef(layout: GridLayout, from: string, to: string): GridLayout {
  return mapCells(layout, (c) => (c.item === from ? { ...c, item: to } : c));
}

/** Ô trỏ tới item bị xóa thành ô trống. */
export function removeItemRef(layout: GridLayout, itemId: string): GridLayout {
  return mapCells(layout, (c) => {
    if (c.item !== itemId) return c;
    const next = { ...c };
    delete next.item;
    return next;
  });
}
