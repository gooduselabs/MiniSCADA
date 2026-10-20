// Thao tác thuần của trình soạn bố cục lưới (feature 012, T024; FR-016 đến FR-021; contracts/project-format-1.1.md §2).
// Cùng quy ước với screen-doc.ts: `(doc, ...) → { doc, selection?, rejected? }`, không sửa đầu vào, không có gì đổi hoặc bị
// từ chối thì trả đúng `doc` cũ. Bên gọi gói kết quả thành MỘT sửa đổi `screenUpsert` (một bước hoàn tác).
import {
  catalogWidget,
  GRID_COLUMNS,
  GRID_DEFAULTS,
  GRID_LIMITS,
  removeItemRef,
  type CellAlign,
  type GridCell,
  type GridLayout,
  type GridRow,
  type ScreenModel,
} from '@mat/project-schema';
import type { EditResult } from './screen-doc.ts';
import { nextItemId } from './screen-edit/clipboard.ts';

/** Kết quả như screen-doc.ts (lý do từ chối của lưới nằm trong `Rejection` chung). */
export type GridEditResult = EditResult;
export type GridRejection = NonNullable<EditResult['rejected']>;

/** Mẫu chia cột của nút Thêm hàng (FR-016). */
export const GRID_PRESETS: readonly (readonly number[])[] = [
  [12],
  [6, 6],
  [4, 4, 4],
  [3, 3, 3, 3],
  [8, 4],
  [4, 8],
  [3, 6, 3],
];

const ROW_HEIGHT = { min: 24, max: 4000 } as const;

type GridDoc = ScreenModel & { layout: GridLayout };
const layoutOf = (doc: ScreenModel): GridLayout | null => (doc as Partial<GridDoc>).layout ?? null;
const reject = (doc: ScreenModel, rejected: GridRejection): GridEditResult => ({ doc, rejected });
const withLayout = (doc: ScreenModel, layout: GridLayout, items = doc.items): GridEditResult => ({
  doc: { ...doc, layout, items } as GridDoc,
});
const sumOf = (cells: readonly GridCell[]): number =>
  cells.reduce((n, c) => n + (c.offset ?? 0) + c.span, 0);

/** Bố cục của màn hình lưới mới: một hàng 12 cột trống (FR-015). */
export function emptyGridLayout(): GridLayout {
  return {
    mode: 'grid',
    columns: GRID_COLUMNS,
    gap: GRID_DEFAULTS.gap,
    padding: GRID_DEFAULTS.padding,
    rows: [{ id: 'r1', height: 'auto', cells: [{ id: 'c1', span: GRID_COLUMNS }] }],
  };
}

/** Id mới `<prefix><n>` không trùng với id hàng và ô nào (hàng và ô chung không gian tên). */
function freshIds(layout: GridLayout, prefix: 'r' | 'c', count: number): string[] {
  const used = new Set(layout.rows.flatMap((r) => [r.id, ...r.cells.map((c) => c.id)]));
  const out: string[] = [];
  for (let n = 1; out.length < count; n++) {
    const id = `${prefix}${n}`;
    if (!used.has(id)) {
      used.add(id);
      out.push(id);
    }
  }
  return out;
}

function findCell(layout: GridLayout, cellId: string): { r: number; c: number } | null {
  for (let r = 0; r < layout.rows.length; r++) {
    const c = layout.rows[r]!.cells.findIndex((x) => x.id === cellId);
    if (c >= 0) return { r, c };
  }
  return null;
}

function mapRow(layout: GridLayout, r: number, f: (row: GridRow) => GridRow): GridLayout {
  return { ...layout, rows: layout.rows.map((row, i) => (i === r ? f(row) : row)) };
}

/** Thêm hàng chia theo `spans` (tổng ≤ 12) ở vị trí `at` (mặc định cuối). */
export function addRow(doc: ScreenModel, spans: readonly number[], at?: number): GridEditResult {
  const l = layoutOf(doc);
  if (!l) return reject(doc, 'not-grid');
  if (
    spans.length === 0 ||
    spans.length > GRID_LIMITS.cellsPerRow ||
    spans.some((s) => !Number.isInteger(s) || s < 1)
  )
    return reject(doc, 'bad-preset');
  if (spans.reduce((a, b) => a + b, 0) > GRID_COLUMNS) return reject(doc, 'row-overflow');
  if (l.rows.length >= GRID_LIMITS.rows) return reject(doc, 'max-rows');
  const [rowId] = freshIds(l, 'r', 1);
  const cellIds = freshIds(
    { ...l, rows: [...l.rows, { id: rowId!, height: 'auto', cells: [] }] },
    'c',
    spans.length,
  );
  const row: GridRow = {
    id: rowId!,
    height: 'auto',
    cells: spans.map((span, i) => ({ id: cellIds[i]!, span })),
  };
  const rows = [...l.rows];
  rows.splice(at === undefined ? rows.length : Math.max(0, Math.min(at, rows.length)), 0, row);
  return withLayout(doc, { ...l, rows });
}

/** Thêm ô vào cuối hàng, rộng bằng phần cột còn trống. */
export function addCell(doc: ScreenModel, rowId: string): GridEditResult {
  const l = layoutOf(doc);
  if (!l) return reject(doc, 'not-grid');
  const r = l.rows.findIndex((x) => x.id === rowId);
  if (r < 0) return reject(doc, 'unknown-row');
  const row = l.rows[r]!;
  if (row.cells.length >= GRID_LIMITS.cellsPerRow) return reject(doc, 'max-cells');
  const free = GRID_COLUMNS - sumOf(row.cells);
  if (free < 1) return reject(doc, 'row-overflow');
  const [id] = freshIds(l, 'c', 1);
  return withLayout(
    doc,
    mapRow(l, r, (x) => ({ ...x, cells: [...x.cells, { id: id!, span: free }] })),
  );
}

/** Gắn một widget mới vào ô trống; item mới không có tọa độ (ô quyết định cỡ). */
export function attachWidget(doc: ScreenModel, cellId: string, type: string): GridEditResult {
  const l = layoutOf(doc);
  if (!l) return reject(doc, 'not-grid');
  if (catalogWidget(type) === undefined) return reject(doc, 'unknown-widget');
  const at = findCell(l, cellId);
  if (!at) return reject(doc, 'unknown-cell');
  if (l.rows[at.r]!.cells[at.c]!.item !== undefined) return reject(doc, 'cell-occupied');
  const id = nextItemId(type.replace(/-/g, '_'), new Set(doc.items.map((i) => i.id)));
  const item = { id, type: 'widget', widget: type } as unknown as ScreenModel['items'][number];
  const layout = mapRow(l, at.r, (row) => ({
    ...row,
    cells: row.cells.map((c, i) => (i === at.c ? { ...c, item: id } : c)),
  }));
  return { ...withLayout(doc, layout, [...doc.items, item]), selection: [id] };
}

/** Thay component của ô bằng widget mới (item cũ bị xóa). */
export function replaceWidget(doc: ScreenModel, cellId: string, type: string): GridEditResult {
  const l = layoutOf(doc);
  if (!l) return reject(doc, 'not-grid');
  const at = findCell(l, cellId);
  if (!at) return reject(doc, 'unknown-cell');
  if (catalogWidget(type) === undefined) return reject(doc, 'unknown-widget');
  const old = l.rows[at.r]!.cells[at.c]!.item;
  if (old === undefined) return attachWidget(doc, cellId, type);
  const cleared = withLayout(
    doc,
    removeItemRef(l, old),
    doc.items.filter((i) => i.id !== old),
  );
  return attachWidget(cleared.doc, cellId, type);
}

/** Kéo đường chia giữa ô `index` và ô kế tiếp `delta` cột (mỗi ô tối thiểu 1 cột). */
export function resizeDivider(
  doc: ScreenModel,
  rowId: string,
  index: number,
  delta: number,
): GridEditResult {
  const l = layoutOf(doc);
  if (!l) return reject(doc, 'not-grid');
  const r = l.rows.findIndex((x) => x.id === rowId);
  if (r < 0) return reject(doc, 'unknown-row');
  const row = l.rows[r]!;
  const a = row.cells[index];
  const b = row.cells[index + 1];
  if (!a || !b) return reject(doc, 'unknown-cell');
  const total = a.span + b.span;
  const nextA = Math.max(1, Math.min(total - 1, a.span + Math.round(delta)));
  if (nextA === a.span) return { doc };
  return withLayout(
    doc,
    mapRow(l, r, (x) => ({
      ...x,
      cells: x.cells.map((c, i) =>
        i === index ? { ...c, span: nextA } : i === index + 1 ? { ...c, span: total - nextA } : c,
      ),
    })),
  );
}

export interface CellProps {
  span?: number;
  offset?: number;
  align?: CellAlign;
  minHeight?: number;
}

/** Thuộc tính của ô; giá trị bằng mặc định (offset 0, align stretch, minHeight 0) bỏ khóa. */
export function setCellProps(doc: ScreenModel, cellId: string, p: CellProps): GridEditResult {
  const l = layoutOf(doc);
  if (!l) return reject(doc, 'not-grid');
  const at = findCell(l, cellId);
  if (!at) return reject(doc, 'unknown-cell');
  const cur = l.rows[at.r]!.cells[at.c]!;
  const next: GridCell = { ...cur };
  if (p.span !== undefined) next.span = Math.max(1, Math.min(GRID_COLUMNS, Math.round(p.span)));
  if (p.offset !== undefined) {
    const o = Math.max(0, Math.min(GRID_COLUMNS - 1, Math.round(p.offset)));
    if (o === 0) delete next.offset;
    else next.offset = o;
  }
  if (p.align !== undefined) {
    if (p.align === 'stretch') delete next.align;
    else next.align = p.align;
  }
  if (p.minHeight !== undefined) {
    const h = Math.max(0, Math.min(ROW_HEIGHT.max, Math.round(p.minHeight)));
    if (h === 0) delete next.minHeight;
    else next.minHeight = h;
  }
  // thứ tự khóa chuẩn (format-03.ts CELL_KEYS)
  const ordered: GridCell = { id: next.id, span: next.span };
  if (next.offset !== undefined) ordered.offset = next.offset;
  if (next.align !== undefined) ordered.align = next.align;
  if (next.minHeight !== undefined) ordered.minHeight = next.minHeight;
  if (next.item !== undefined) ordered.item = next.item;
  if (JSON.stringify(ordered) === JSON.stringify(cur)) return { doc };
  const cells = l.rows[at.r]!.cells.map((c, i) => (i === at.c ? ordered : c));
  if (sumOf(cells) > GRID_COLUMNS) return reject(doc, 'row-overflow');
  return withLayout(
    doc,
    mapRow(l, at.r, (row) => ({ ...row, cells })),
  );
}

export interface RowProps {
  height?: 'auto' | number;
  /** `null` bỏ khóa (dùng khoảng cách chung của lưới). */
  gap?: number | null;
}

/** Thuộc tính của hàng: chiều cao (`auto` hoặc 24 đến 4.000 px), khoảng cách giữa ô (0 đến 64 px). */
export function setRowProps(doc: ScreenModel, rowId: string, p: RowProps): GridEditResult {
  const l = layoutOf(doc);
  if (!l) return reject(doc, 'not-grid');
  const r = l.rows.findIndex((x) => x.id === rowId);
  if (r < 0) return reject(doc, 'unknown-row');
  const cur = l.rows[r]!;
  const next: GridRow = { ...cur };
  if (p.height !== undefined)
    next.height =
      p.height === 'auto'
        ? 'auto'
        : Math.max(ROW_HEIGHT.min, Math.min(ROW_HEIGHT.max, Math.round(p.height)));
  if (p.gap === null) delete next.gap;
  else if (p.gap !== undefined) next.gap = Math.max(0, Math.min(64, Math.round(p.gap)));
  // thứ tự khóa chuẩn (format-03.ts ROW_KEYS): id, height, gap, cells
  const ordered: GridRow =
    next.gap === undefined
      ? { id: next.id, height: next.height, cells: next.cells }
      : { id: next.id, height: next.height, gap: next.gap, cells: next.cells };
  if (JSON.stringify(ordered) === JSON.stringify(cur)) return { doc };
  return withLayout(
    doc,
    mapRow(l, r, () => ordered),
  );
}

/** Đổi thứ tự hàng (`dir` -1 lên, 1 xuống); ở mép thì không đổi. */
export function moveRow(doc: ScreenModel, rowId: string, dir: -1 | 1): GridEditResult {
  const l = layoutOf(doc);
  if (!l) return reject(doc, 'not-grid');
  const r = l.rows.findIndex((x) => x.id === rowId);
  if (r < 0) return reject(doc, 'unknown-row');
  const to = r + dir;
  if (to < 0 || to >= l.rows.length) return { doc };
  const rows = [...l.rows];
  [rows[r], rows[to]] = [rows[to]!, rows[r]!];
  return withLayout(doc, { ...l, rows });
}

/** Đổi thứ tự ô trong hàng (`dir` -1 trái, 1 phải); ở mép thì không đổi. */
export function moveCell(doc: ScreenModel, cellId: string, dir: -1 | 1): GridEditResult {
  const l = layoutOf(doc);
  if (!l) return reject(doc, 'not-grid');
  const at = findCell(l, cellId);
  if (!at) return reject(doc, 'unknown-cell');
  const to = at.c + dir;
  const cells = [...l.rows[at.r]!.cells];
  if (to < 0 || to >= cells.length) return { doc };
  [cells[at.c], cells[to]] = [cells[to]!, cells[at.c]!];
  return withLayout(
    doc,
    mapRow(l, at.r, (row) => ({ ...row, cells })),
  );
}

/** Xóa ô (và component trong ô). */
export function removeCell(doc: ScreenModel, cellId: string): GridEditResult {
  const l = layoutOf(doc);
  if (!l) return reject(doc, 'not-grid');
  const at = findCell(l, cellId);
  if (!at) return reject(doc, 'unknown-cell');
  const gone = l.rows[at.r]!.cells[at.c]!.item;
  const layout = mapRow(l, at.r, (row) => ({
    ...row,
    cells: row.cells.filter((_, i) => i !== at.c),
  }));
  return {
    ...withLayout(
      doc,
      layout,
      gone === undefined ? doc.items : doc.items.filter((i) => i.id !== gone),
    ),
    selection: [],
  };
}

/** Xóa hàng (và mọi component trong hàng). */
export function removeRow(doc: ScreenModel, rowId: string): GridEditResult {
  const l = layoutOf(doc);
  if (!l) return reject(doc, 'not-grid');
  const row = l.rows.find((x) => x.id === rowId);
  if (!row) return reject(doc, 'unknown-row');
  const gone = new Set(row.cells.flatMap((c) => (c.item === undefined ? [] : [c.item])));
  return {
    ...withLayout(
      doc,
      { ...l, rows: l.rows.filter((x) => x.id !== rowId) },
      doc.items.filter((i) => !gone.has(i.id)),
    ),
    selection: [],
  };
}

/**
 * Đặt một item mới vào màn hình lưới (nhập SVG, ký hiệu; feature 012, FR-014): bỏ `x`, `y`, `width`, `height` của item,
 * trỏ ô trống đầu tiên (theo thứ tự hàng rồi ô) tới nó; hết ô trống thì thêm một hàng 12 cột ở cuối. Màn hình tự do trả
 * màn hình có item thêm nguyên trạng.
 */
export function placeInGrid(doc: ScreenModel, item: ScreenModel['items'][number]): ScreenModel {
  const l = layoutOf(doc);
  if (!l) return { ...doc, items: [...doc.items, item] };
  const loose = { ...item } as Record<string, unknown>;
  for (const k of ['x', 'y', 'width', 'height']) delete loose[k];
  const placed = loose as unknown as ScreenModel['items'][number];
  for (let r = 0; r < l.rows.length; r++) {
    const c = l.rows[r]!.cells.findIndex((x) => x.item === undefined);
    if (c < 0) continue;
    const layout = mapRow(l, r, (row) => ({
      ...row,
      cells: row.cells.map((x, i) => (i === c ? { ...x, item: placed.id } : x)),
    }));
    return { ...doc, layout, items: [...doc.items, placed] } as GridDoc;
  }
  const [rowId] = freshIds(l, 'r', 1);
  const [cellId] = freshIds(
    { ...l, rows: [...l.rows, { id: rowId!, height: 'auto', cells: [] }] },
    'c',
    1,
  );
  const row: GridRow = {
    id: rowId!,
    height: 'auto',
    cells: [{ id: cellId!, span: GRID_COLUMNS, item: placed.id }],
  };
  return {
    ...doc,
    layout: { ...l, rows: [...l.rows, row] },
    items: [...doc.items, placed],
  } as GridDoc;
}

// ---- Mẫu hàng có sẵn widget (feature 014, phản hồi 2026-10-20: "kích thước ô card chart nhìn xấu") ----

/** Loại tên của widget mẫu (khóa i18n `lay.tpl.<loại>` ở giao diện): thẻ chỉ số, các biểu đồ, đồng hồ. */
export type TemplateNameKind = 'tile' | 'chartLine' | 'chartBar' | 'chartPie' | 'gauge';

interface TemplateCell {
  span: number;
  widget: string;
  /** Thuộc tính tên (`label` của thẻ, `title` của khung) điền bằng hàm đặt tên của bên gọi. */
  name: { prop: 'label' | 'title'; kind: TemplateNameKind };
  props: Readonly<Record<string, string | number | boolean>>;
}

export type RowTemplateId = 'tiles4' | 'charts3' | 'charts2plus1' | 'wide';

const TILE_LOOK: ReadonlyArray<{ color: string; icon: string }> = [
  { color: 'teal', icon: 'thermometer' },
  { color: 'blue', icon: 'droplet' },
  { color: 'rose', icon: 'bolt' },
  { color: 'violet', icon: 'pressure' },
];

const lineCell = (span: number): TemplateCell => ({
  span,
  widget: 'line',
  name: { prop: 'title', kind: 'chartLine' },
  props: { windowSec: 300 },
});
const barCell = (span: number): TemplateCell => ({
  span,
  widget: 'bar',
  name: { prop: 'title', kind: 'chartBar' },
  props: {},
});

/**
 * Mẫu hàng: chiều cao cố định (các ô cùng hàng cao bằng nhau) và widget đặt sẵn với tên, màu, biểu tượng; người dùng chỉ
 * việc gắn Tag. Cỡ theo dashboard tham khảo: hàng thẻ 116 px, hàng biểu đồ 260 px, biểu đồ rộng 300 px.
 */
export const ROW_TEMPLATES: Readonly<
  Record<RowTemplateId, { height: number; cells: readonly TemplateCell[] }>
> = {
  tiles4: {
    height: 116,
    cells: TILE_LOOK.map((look) => ({
      span: 3,
      widget: 'stat-tile',
      name: { prop: 'label', kind: 'tile' },
      props: { color: look.color, icon: look.icon },
    })),
  },
  charts3: {
    height: 260,
    cells: [
      lineCell(4),
      barCell(4),
      { span: 4, widget: 'pie', name: { prop: 'title', kind: 'chartPie' }, props: {} },
    ],
  },
  charts2plus1: {
    height: 260,
    cells: [
      lineCell(5),
      barCell(4),
      { span: 3, widget: 'gauge', name: { prop: 'title', kind: 'gauge' }, props: {} },
    ],
  },
  wide: { height: 300, cells: [lineCell(12)] },
};

export const ROW_TEMPLATE_IDS = Object.keys(ROW_TEMPLATES) as RowTemplateId[];

/**
 * Thêm hàng theo mẫu ở vị trí `at` (mặc định cuối): hàng cao cố định, mỗi ô một widget mới (chưa gắn Tag) có tên do
 * `nameOf(loại, thứ tự trong hàng)` đặt. Chọn widget đầu tiên. Một sửa đổi (một bước hoàn tác) ở bên gọi.
 */
export function addTemplateRow(
  doc: ScreenModel,
  id: RowTemplateId,
  nameOf: (kind: TemplateNameKind, n: number) => string,
  at?: number,
): GridEditResult {
  const tpl = ROW_TEMPLATES[id];
  if (!tpl) return reject(doc, 'bad-preset');
  const added = addRow(
    doc,
    tpl.cells.map((c) => c.span),
    at,
  );
  if (added.rejected) return added;
  const l = layoutOf(added.doc)!;
  const rowIndex =
    at === undefined ? l.rows.length - 1 : Math.max(0, Math.min(at, l.rows.length - 1));
  const row = l.rows[rowIndex]!;
  const taken = new Set(doc.items.map((i) => i.id));
  const counts = new Map<TemplateNameKind, number>();
  const items: ScreenModel['items'] = [];
  const cells = row.cells.map((cell, i) => {
    const c = tpl.cells[i]!;
    const n = (counts.get(c.name.kind) ?? 0) + 1;
    counts.set(c.name.kind, n);
    const itemId = nextItemId(c.widget.replace(/-/g, '_'), taken);
    taken.add(itemId);
    items.push({
      id: itemId,
      type: 'widget',
      widget: c.widget,
      props: { [c.name.prop]: nameOf(c.name.kind, n), ...c.props },
    } as unknown as ScreenModel['items'][number]);
    return { ...cell, item: itemId };
  });
  const layout = mapRow(l, rowIndex, (r) => ({ ...r, height: tpl.height, cells }));
  return {
    ...withLayout(added.doc, layout, [...added.doc.items, ...items]),
    selection: items.length ? [items[0]!.id] : [],
  };
}
