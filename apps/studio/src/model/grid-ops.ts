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
  // hàng hết ô thì bỏ luôn hàng (hàng không có ô là bố cục sai, E_LAYOUT_LIMIT)
  const cells = l.rows[at.r]!.cells.filter((_, i) => i !== at.c);
  const layout = cells.length
    ? mapRow(l, at.r, (row) => ({ ...row, cells }))
    : { ...l, rows: l.rows.filter((_, i) => i !== at.r) };
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
 * Đặt một item mới vào màn hình lưới (nhập SVG; feature 012, FR-014): bỏ `x`, `y`, `width`, `height` của item,
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

// ---- Feature 035: kéo thả component giữa các hàng, đổi thứ tự hàng, sao chép, dán, nhân bản ----

/** Vị trí thả so với ô đích: chèn trước, đặt vào ô, chèn sau. */
export type DropZone = 'before' | 'into' | 'after';

/**
 * Dời cả ô `cellId` (độ rộng, thuộc tính, component) sang hàng `toRowId` ở vị trí `index` (tính trên hàng đích trước khi
 * dời). Hàng đích không đủ chỗ thì ô co lại bằng số cột còn trống (tối thiểu 1); hàng nguồn trống hẳn thì bị xóa.
 */
export function moveCellTo(
  doc: ScreenModel,
  cellId: string,
  toRowId: string,
  index: number,
): GridEditResult {
  const l = layoutOf(doc);
  if (!l) return reject(doc, 'not-grid');
  const at = findCell(l, cellId);
  if (!at) return reject(doc, 'unknown-cell');
  const to = l.rows.findIndex((x) => x.id === toRowId);
  if (to < 0) return reject(doc, 'unknown-row');
  const cell = l.rows[at.r]!.cells[at.c]!;
  const sel = cell.item === undefined ? {} : { selection: [cell.item] };
  if (to === at.r) {
    const last = l.rows[to]!.cells.length - 1;
    const dest = Math.max(0, Math.min(index > at.c ? index - 1 : index, last));
    if (dest === at.c) return { doc, ...sel };
    const cells = [...l.rows[to]!.cells];
    cells.splice(at.c, 1);
    cells.splice(dest, 0, cell);
    return {
      ...withLayout(
        doc,
        mapRow(l, to, (row) => ({ ...row, cells })),
      ),
      ...sel,
    };
  }
  const target = l.rows[to]!;
  if (target.cells.length >= GRID_LIMITS.cellsPerRow) return reject(doc, 'max-cells');
  const free = GRID_COLUMNS - sumOf(target.cells);
  if (free < 1) return reject(doc, 'row-overflow');
  const moved: GridCell = { ...cell, span: Math.min(cell.span, free) };
  delete moved.offset;
  const cells = [...target.cells];
  cells.splice(Math.max(0, Math.min(index, cells.length)), 0, moved);
  const rows = l.rows
    .map((row, i) =>
      i === to
        ? { ...row, cells }
        : i === at.r
          ? { ...row, cells: row.cells.filter((x) => x.id !== cellId) }
          : row,
    )
    .filter((row) => row.cells.length > 0);
  return { ...withLayout(doc, { ...l, rows }), ...sel };
}

/** Đưa component của ô `fromCellId` vào ô `toCellId`; ô đích đã có component thì hai ô đổi component cho nhau. */
export function moveItemToCell(
  doc: ScreenModel,
  fromCellId: string,
  toCellId: string,
): GridEditResult {
  const l = layoutOf(doc);
  if (!l) return reject(doc, 'not-grid');
  const a = findCell(l, fromCellId);
  const b = findCell(l, toCellId);
  if (!a || !b) return reject(doc, 'unknown-cell');
  const ia = l.rows[a.r]!.cells[a.c]!.item;
  const ib = l.rows[b.r]!.cells[b.c]!.item;
  if (fromCellId === toCellId || ia === undefined) return { doc };
  const setItem = (c: GridCell, item: string | undefined): GridCell => {
    const n = { ...c };
    if (item === undefined) delete n.item;
    else n.item = item;
    return n;
  };
  const rows = l.rows.map((row) => ({
    ...row,
    cells: row.cells.map((c) =>
      c.id === fromCellId ? setItem(c, ib) : c.id === toCellId ? setItem(c, ia) : c,
    ),
  }));
  return { ...withLayout(doc, { ...l, rows }), selection: [ia] };
}

/** Dời hàng `rowId` tới vị trí `index` (tính trên danh sách trước khi dời; `rows.length` là cuối). */
export function moveRowTo(doc: ScreenModel, rowId: string, index: number): GridEditResult {
  const l = layoutOf(doc);
  if (!l) return reject(doc, 'not-grid');
  const r = l.rows.findIndex((x) => x.id === rowId);
  if (r < 0) return reject(doc, 'unknown-row');
  const dest = Math.max(0, Math.min(index > r ? index - 1 : index, l.rows.length - 1));
  if (dest === r) return { doc };
  const rows = [...l.rows];
  const [row] = rows.splice(r, 1);
  rows.splice(dest, 0, row!);
  return withLayout(doc, { ...l, rows });
}

type GridItem = ScreenModel['items'][number];

/** Nội dung clipboard của trình soạn lưới: một ô (độ rộng, component) hoặc cả một hàng. */
export type GridClip =
  | { kind: 'cell'; cell: GridCell; item: GridItem | null }
  | { kind: 'row'; row: GridRow; items: GridItem[] };

const cloneJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Sao chép ô `cellId` (component giữ nguyên mọi thuộc tính, Tag, sự kiện, bảo mật). */
export function copyCell(doc: ScreenModel, cellId: string): GridClip | null {
  const l = layoutOf(doc);
  const at = l ? findCell(l, cellId) : null;
  if (!l || !at) return null;
  const cell = l.rows[at.r]!.cells[at.c]!;
  const item = cell.item === undefined ? undefined : doc.items.find((i) => i.id === cell.item);
  return { kind: 'cell', cell: cloneJson(cell), item: item ? cloneJson(item) : null };
}

/** Sao chép hàng `rowId` cùng mọi ô và component. */
export function copyRow(doc: ScreenModel, rowId: string): GridClip | null {
  const row = layoutOf(doc)?.rows.find((x) => x.id === rowId);
  if (!row) return null;
  const ids = new Set(row.cells.flatMap((c) => (c.item === undefined ? [] : [c.item])));
  return {
    kind: 'row',
    row: cloneJson(row),
    items: doc.items.filter((i) => ids.has(i.id)).map((i) => cloneJson(i)),
  };
}

/** Bản sao item cho lưới: id mới, bỏ tọa độ và dấu bản sao template; mọi thuộc tính khác giữ nguyên. */
function cloneItem(src: GridItem, used: Set<string>): GridItem {
  const kind = src.type === 'svg' ? 'svg' : src.widget.replace(/-/g, '_');
  const id = nextItemId(kind, used);
  used.add(id);
  const copy = cloneJson(src) as unknown as Record<string, unknown>;
  copy.id = id;
  for (const k of ['x', 'y', 'width', 'height', 'tpl']) delete copy[k];
  return copy as unknown as GridItem;
}

/** Số item tối đa của một màn hình (LIMITS_03.items). */
const MAX_ITEMS = 250;

/** Id hàng mới (tránh cả id ô `reserved` vừa cấp, vì hàng và ô chung không gian tên). */
function freshRowId(l: GridLayout, reserved: readonly string[]): string {
  const probe = reserved.map((id) => ({ id, span: 1 }));
  return freshIds(
    { ...l, rows: [...l.rows, { id: '', height: 'auto', cells: probe }] },
    'r',
    1,
  )[0]!;
}

/**
 * Dán clipboard của lưới. Hàng: chèn ngay dưới hàng của ô `targetCellId` (vắng: cuối màn hình). Ô: ô đích trống thì
 * đặt component vào ô đó; không thì chèn ô mới ngay sau ô đích (cùng hàng nếu đủ cột, không thì hàng mới ngay dưới).
 * Item `svg` không nhân bản được (một file binding chỉ thuộc một item). Mọi id (hàng, ô, item) là id mới.
 */
export function pasteGrid(
  doc: ScreenModel,
  clip: GridClip,
  targetCellId: string | null,
): GridEditResult {
  const l = layoutOf(doc);
  if (!l) return reject(doc, 'not-grid');
  const at = targetCellId === null ? null : findCell(l, targetCellId);
  const used = new Set(doc.items.map((i) => i.id));
  if (clip.kind === 'row') {
    if (clip.items.some((i) => i.type === 'svg')) return reject(doc, 'svg-copy');
    if (l.rows.length >= GRID_LIMITS.rows) return reject(doc, 'max-rows');
    if (doc.items.length + clip.items.length > MAX_ITEMS) return reject(doc, 'max-items');
    const cellIds = freshIds(l, 'c', clip.row.cells.length);
    const rowId = freshRowId(l, cellIds);
    const byId = new Map(clip.items.map((i) => [i.id, i]));
    const items: GridItem[] = [];
    const cells = clip.row.cells.map((c, i) => {
      const n: GridCell = { ...cloneJson(c), id: cellIds[i]! };
      const src = c.item === undefined ? undefined : byId.get(c.item);
      if (src) {
        const copy = cloneItem(src, used);
        items.push(copy);
        n.item = copy.id;
      } else delete n.item;
      return n;
    });
    const row: GridRow = { ...cloneJson(clip.row), id: rowId, cells };
    const rows = [...l.rows];
    rows.splice(at ? at.r + 1 : rows.length, 0, row);
    return {
      ...withLayout(doc, { ...l, rows }, [...doc.items, ...items]),
      selection: items.length ? [items[0]!.id] : [],
    };
  }
  const src = clip.item;
  if (src?.type === 'svg') return reject(doc, 'svg-copy');
  if (src && doc.items.length + 1 > MAX_ITEMS) return reject(doc, 'max-items');
  const copy = src ? cloneItem(src, used) : null;
  const items = copy ? [...doc.items, copy] : doc.items;
  const selection = copy ? [copy.id] : [];
  const target = at ? l.rows[at.r]!.cells[at.c]! : null;
  if (at && target && target.item === undefined && copy) {
    const layout = mapRow(l, at.r, (row) => ({
      ...row,
      cells: row.cells.map((c, i) => (i === at.c ? { ...c, item: copy.id } : c)),
    }));
    return { ...withLayout(doc, layout, items), selection };
  }
  const [cellId] = freshIds(l, 'c', 1);
  const cell: GridCell = { ...cloneJson(clip.cell), id: cellId! };
  delete cell.offset;
  if (copy) cell.item = copy.id;
  else delete cell.item;
  if (at) {
    const row = l.rows[at.r]!;
    const free = GRID_COLUMNS - sumOf(row.cells);
    if (row.cells.length < GRID_LIMITS.cellsPerRow && free >= cell.span) {
      const cells = [...row.cells];
      cells.splice(at.c + 1, 0, cell);
      return {
        ...withLayout(
          doc,
          mapRow(l, at.r, (x) => ({ ...x, cells })),
          items,
        ),
        selection,
      };
    }
  }
  if (l.rows.length >= GRID_LIMITS.rows) return reject(doc, 'max-rows');
  const rowId = freshRowId(l, [cellId!]);
  const height = at ? l.rows[at.r]!.height : 'auto';
  const rows = [...l.rows];
  rows.splice(at ? at.r + 1 : rows.length, 0, { id: rowId, height, cells: [cell] });
  return { ...withLayout(doc, { ...l, rows }, items), selection };
}

/** Nhân bản ô (Ctrl+D): bản sao ngay sau ô, component giữ nguyên thuộc tính với id mới. */
export function duplicateCell(doc: ScreenModel, cellId: string): GridEditResult {
  const clip = copyCell(doc, cellId);
  return clip ? pasteGrid(doc, clip, cellId) : reject(doc, 'unknown-cell');
}

/** Nhân bản hàng (Ctrl+Shift+D): bản sao ngay dưới hàng, mọi ô và component có id mới. */
export function duplicateRow(doc: ScreenModel, rowId: string): GridEditResult {
  const clip = copyRow(doc, rowId);
  const row = layoutOf(doc)?.rows.find((x) => x.id === rowId);
  return clip && row ? pasteGrid(doc, clip, row.cells[0]?.id ?? null) : reject(doc, 'unknown-row');
}
