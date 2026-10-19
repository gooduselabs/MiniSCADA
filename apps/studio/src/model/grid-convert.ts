// Chuyển màn hình bố cục tự do sang lưới 12 cột (feature 012, T052; US5, FR-040, SC-010). Hàm thuần: không đổi đầu vào,
// trả màn hình mới (có `layout`, item bỏ `x`, `y`, `width`, `height`, mọi trường khác giữ nguyên) và báo cáo cho hộp
// thoại xem trước. Bên gọi áp bằng MỘT `screenUpsert` (một bước hoàn tác).
//
// Quy tắc:
// 1. Hàng: sắp item theo `y` (rồi `x`), gom các item có dải dọc [y, y + height) chồng lấn (bắc cầu) thành một dải; mỗi
//    dải là một hàng, theo thứ tự từ trên xuống. Item ẩn (`hidden`) vẫn được đặt vào ô.
// 2. Ô: trong hàng sắp theo `x` (rồi `y`). Mép trái và mép phải của item quy về cột gần nhất theo tỷ lệ chiều rộng màn
//    hình (`size.width` / 12). Ô bắt đầu ở cột trống đầu tiên không sớm hơn mép trái: `offset` = khoảng trống từ ô trước,
//    `span` = tới mép phải, tối thiểu 1 cột. Item chồng lên item đứng trước theo chiều ngang thì xếp liền sau nó (cảnh
//    báo `overlap`).
// 3. Tổng `offset + span` của hàng vượt 12 thì bớt dần: trước hết bớt khoảng trống (`offset`) lớn nhất, rồi bớt ô rộng
//    nhất (mỗi ô còn ≥ 1 cột; cảnh báo `squeezed`).
// 4. Dải có hơn 12 item tách thành nhiều hàng liên tiếp, mỗi hàng tối đa 12 ô theo thứ tự `x` (cảnh báo `split`).
// 5. Chiều cao hàng: `auto` (theo nội dung) khi item cao nhất của hàng không quá 120 px (cỡ một thẻ giá trị, nút, đèn);
//    cao hơn (biểu đồ, bảng, đồ họa SVG) thì hàng giữ đúng chiều cao lớn nhất đó (24 đến 4.000 px) để nội dung không bị
//    co lại.
// 6. Màn hình rỗng: một hàng 12 cột trống như màn hình lưới mới. Màn hình đã là lưới: trả đúng `doc` cũ.
import {
  GRID_COLUMNS,
  GRID_DEFAULTS,
  GRID_LIMITS,
  type GridCell,
  type GridLayout,
  type GridRow,
  type Item,
  type ScreenModel,
} from '@mat/project-schema';
import { emptyGridLayout } from './grid-ops.ts';

/** Item cao hơn mức này thì hàng có chiều cao cố định (quy tắc 5). */
export const AUTO_ROW_MAX = 120;
const ROW_HEIGHT = { min: 24, max: 4000 } as const;

export type ConvertWarningCode = 'overlap' | 'squeezed' | 'split' | 'max-rows' | 'already-grid';

export interface ConvertWarning {
  code: ConvertWarningCode;
  /** Chỉ số hàng (từ 0) của kết quả; vắng với cảnh báo của cả màn hình. */
  row?: number;
  /** Id item liên quan. */
  items: string[];
}

export interface ConvertReport {
  /** Số hàng của bố cục đề xuất. */
  rows: number;
  /** Sơ đồ cột: mỗi hàng, mỗi ô `[offset, span]`. */
  layout: Array<Array<[number, number]>>;
  warnings: ConvertWarning[];
}

export interface ConvertResult {
  doc: ScreenModel;
  report: ConvertReport;
}

const POS = ['x', 'y', 'width', 'height'] as const;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const boxOf = (it: Item): Box => ({
  id: it.id,
  x: num(it.x),
  y: num(it.y),
  w: Math.max(0, num(it.width)),
  h: Math.max(0, num(it.height)),
});

/** Gom theo dải dọc chồng lấn (quy tắc 1). */
function bands(boxes: readonly Box[]): Box[][] {
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Box[][] = [];
  let bottom = -Infinity;
  for (const b of sorted) {
    const cur = out[out.length - 1];
    if (cur && b.y < bottom) {
      cur.push(b);
      bottom = Math.max(bottom, b.y + b.h);
    } else {
      out.push([b]);
      bottom = b.y + b.h;
    }
  }
  return out;
}

/** Bớt tổng của hàng về ≤ 12 (quy tắc 3); trả `true` khi phải bớt độ rộng ô. */
function squeeze(cells: Array<{ offset: number; span: number }>): boolean {
  let squeezed = false;
  const total = () => cells.reduce((n, c) => n + c.offset + c.span, 0);
  while (total() > GRID_COLUMNS) {
    let k = -1;
    cells.forEach((c, i) => {
      if (c.offset > 0 && (k < 0 || c.offset >= cells[k]!.offset)) k = i;
    });
    if (k >= 0) {
      cells[k]!.offset--;
      continue;
    }
    cells.forEach((c, i) => {
      if (c.span > 1 && (k < 0 || c.span > cells[k]!.span)) k = i;
    });
    if (k < 0) break; // không xảy ra: tối đa 12 ô, mỗi ô ≥ 1
    cells[k]!.span--;
    squeezed = true;
  }
  return squeezed;
}

/** Chuyển màn hình tự do sang lưới theo các quy tắc ở đầu tệp. */
export function convertToGrid(doc: ScreenModel): ConvertResult {
  if ((doc as { layout?: unknown }).layout !== undefined)
    return {
      doc,
      report: { rows: 0, layout: [], warnings: [{ code: 'already-grid', items: [] }] },
    };

  const boxes = doc.items.map(boxOf);
  const width =
    num(doc.size?.width) > 0 ? num(doc.size.width) : Math.max(1, ...boxes.map((b) => b.x + b.w));
  const col = (v: number) => Math.round((Math.max(0, Math.min(width, v)) / width) * GRID_COLUMNS);
  const warnings: ConvertWarning[] = [];
  const rows: GridRow[] = [];
  let nextId = 1;

  for (const band of bands(boxes)) {
    const inRow = [...band].sort((a, b) => a.x - b.x || a.y - b.y);
    if (inRow.length > GRID_LIMITS.cellsPerRow)
      warnings.push({ code: 'split', row: rows.length, items: inRow.map((b) => b.id) });
    for (let at = 0; at < inRow.length; at += GRID_LIMITS.cellsPerRow) {
      const chunk = inRow.slice(at, at + GRID_LIMITS.cellsPerRow);
      const r = rows.length;
      const overlap: string[] = [];
      const cells: Array<{ offset: number; span: number }> = [];
      let cursor = 0;
      let right = -Infinity;
      for (const b of chunk) {
        if (b.x < right) overlap.push(b.id);
        right = Math.max(right, b.x + b.w);
        let start = col(b.x);
        let end = col(b.x + b.w);
        if (start >= GRID_COLUMNS) start = GRID_COLUMNS - 1;
        if (end <= start) end = start + 1;
        const s = Math.max(start, cursor);
        const span = Math.max(1, end - s);
        cells.push({ offset: Math.max(0, start - cursor), span });
        cursor = s + span;
      }
      if (overlap.length) warnings.push({ code: 'overlap', row: r, items: overlap });
      if (squeeze(cells))
        warnings.push({ code: 'squeezed', row: r, items: chunk.map((b) => b.id) });
      const tallest = Math.max(...chunk.map((b) => b.h));
      const rowId = `r${nextId++}`;
      const gridCells: GridCell[] = chunk.map((b, i) => {
        const c: GridCell = { id: `c${nextId++}`, span: cells[i]!.span };
        if (cells[i]!.offset > 0) c.offset = cells[i]!.offset;
        c.item = b.id;
        return c;
      });
      rows.push({
        id: rowId,
        height:
          tallest > AUTO_ROW_MAX
            ? Math.max(ROW_HEIGHT.min, Math.min(ROW_HEIGHT.max, Math.round(tallest)))
            : 'auto',
        cells: gridCells,
      });
    }
  }
  if (rows.length > GRID_LIMITS.rows) warnings.push({ code: 'max-rows', items: [] });

  const layout: GridLayout =
    rows.length === 0
      ? emptyGridLayout()
      : {
          mode: 'grid',
          columns: GRID_COLUMNS,
          gap: GRID_DEFAULTS.gap,
          padding: GRID_DEFAULTS.padding,
          rows,
        };
  const items = doc.items.map((it) => {
    const next = { ...it } as Record<string, unknown>;
    for (const k of POS) delete next[k];
    return next as unknown as Item;
  });
  return {
    doc: { ...doc, layout, items } as ScreenModel,
    report: {
      rows: layout.rows.length,
      layout: layout.rows.map((r) => r.cells.map((c): [number, number] => [c.offset ?? 0, c.span])),
      warnings,
    },
  };
}
