// Trạng thái và dòng đang hiện của lưới dùng chung (feature 006, ADR-016, data-model §13.2): ô hiện hành và neo (vùng
// chọn hình chữ nhật), bộ lọc, sắp xếp, ô đang sửa và trạng thái bộ gõ. Hàm thuần, không DOM.
import { fold } from '../../i18n/index.ts';
import type { GridAdapter, GridColumn, Pos } from './types.ts';

export type ImeState = 'idle' | 'composing' | 'cancelPending';

/** Ô đang sửa. `typed`: gõ thẳng (kể cả qua bộ gõ); `f2` (F2, Enter); `dblclick`. */
export interface EditSession {
  row: number;
  col: string;
  /** Chữ của ô lúc bắt đầu sửa: xác nhận mà chữ vẫn vậy thì không sinh sửa đổi. */
  original: string;
  /** Chữ hiện tại của ô nhập. */
  text: string;
  origin: 'typed' | 'f2' | 'dblclick';
}

export interface SortSpec {
  col: string;
  dir: 'asc' | 'desc';
}

export interface GridState {
  /** Ô hiện hành (đầu động của vùng chọn). */
  cell: Pos | null;
  /** Neo của vùng chọn; trùng `cell` khi chỉ một ô. */
  anchor: Pos | null;
  editing: EditSession | null;
  ime: ImeState;
  /** Ô tìm: chứa chữ (bỏ dấu), mọi từ phải đủ. */
  filter: string;
  /** Lọc theo cột: chuỗi chứa (bỏ dấu) hoặc so sánh số (`>5`, `<=10`, `=3`, `!=0`). */
  colFilters: Readonly<Record<string, string>>;
  sort: SortSpec | null;
}

export const initialGrid: GridState = {
  cell: null,
  anchor: null,
  editing: null,
  ime: 'idle',
  filter: '',
  colFilters: {},
  sort: null,
};

/** Dòng đang hiện (chỉ số dòng gốc, đã lọc và sắp xếp) và các cột. */
export interface GridView {
  rows: number[];
  cols: string[];
}

export interface Rect {
  /** Vị trí (trong dòng đang hiện, trong cột) đầu và cuối, gồm cả hai đầu. */
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

const COMPARE = /^(>=|<=|!=|>|<|=)\s*(-?\d+(?:[.,]\d+)?)$/;

const asNumber = (s: string): number =>
  s.trim() === '' ? Number.NaN : Number(s.replace(',', '.'));

/** Bộ lọc của một cột: hàm giữ dòng khi chữ của ô thỏa. */
function columnPredicate(col: GridColumn | undefined, filter: string): (text: string) => boolean {
  const m = col?.kind === 'number' || col?.kind === 'live' ? COMPARE.exec(filter.trim()) : null;
  if (m) {
    const n = Number(m[2].replace(',', '.'));
    return (text) => {
      const v = asNumber(text);
      if (Number.isNaN(v)) return false;
      switch (m[1]) {
        case '>':
          return v > n;
        case '>=':
          return v >= n;
        case '<':
          return v < n;
        case '<=':
          return v <= n;
        case '=':
          return v === n;
        default:
          return v !== n;
      }
    };
  }
  const words = fold(filter).split(/\s+/).filter(Boolean);
  return (text) => {
    const hay = fold(text);
    return words.every((w) => hay.includes(w));
  };
}

const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

/** Chữ để tìm của từng dòng, tính một lần cho mỗi adapter (adapter dựng lại khi dữ liệu đổi). */
const searchCache = new WeakMap<GridAdapter, string[]>();
function searchTexts(a: GridAdapter): string[] {
  let t = searchCache.get(a);
  if (!t) {
    t = [];
    for (let r = 0; r < a.rowCount(); r++)
      t.push(
        fold(a.searchText ? a.searchText(r) : a.columns.map((c) => a.text(r, c.key)).join(' ')),
      );
    searchCache.set(a, t);
  }
  return t;
}

/** Dòng đang hiện và cột theo bộ lọc, sắp xếp của `state`. */
export function buildView(a: GridAdapter, state: GridState): GridView {
  const n = a.rowCount();
  const cols = a.columns.map((c) => c.key);
  let rows: number[] = Array.from({ length: n }, (_, i) => i);
  const words = fold(state.filter).split(/\s+/).filter(Boolean);
  if (words.length) {
    const hay = searchTexts(a);
    rows = rows.filter((r) => words.every((w) => hay[r].includes(w)));
  }
  for (const [key, filter] of Object.entries(state.colFilters)) {
    if (filter.trim() === '') continue;
    const col = a.columns.find((c) => c.key === key);
    const keep = columnPredicate(col, filter);
    rows = rows.filter((r) => keep(a.text(r, key)));
  }
  if (state.sort) {
    const { col, dir } = state.sort;
    const numeric = a.columns.find((c) => c.key === col)?.kind === 'number';
    const sign = dir === 'asc' ? 1 : -1;
    rows = [...rows].sort((x, y) => {
      const tx = a.text(x, col);
      const ty = a.text(y, col);
      // Ô trống đứng đầu khi tăng dần, cuối khi giảm dần.
      if (tx === '' || ty === '') return tx === ty ? x - y : (tx === '' ? -1 : 1) * sign;
      const cmp = numeric ? asNumber(tx) - asNumber(ty) || 0 : collator.compare(tx, ty);
      return cmp * sign || x - y;
    });
  }
  return { rows, cols };
}

/** Vị trí đang hiện của `pos` (dòng, cột); `null` khi dòng bị lọc hay cột không có. */
export function posIn(view: GridView, pos: Pos): { r: number; c: number } | null {
  const r = view.rows.indexOf(pos.row);
  const c = view.cols.indexOf(pos.col);
  return r < 0 || c < 0 ? null : { r, c };
}

/** Vùng chọn theo vị trí đang hiện; `null` khi chưa chọn hay ô không còn hiện. */
export function selectionRect(view: GridView, state: GridState): Rect | null {
  if (!state.cell || !state.anchor) return null;
  const a = posIn(view, state.anchor);
  const b = posIn(view, state.cell);
  if (!a || !b) return null;
  return {
    r0: Math.min(a.r, b.r),
    r1: Math.max(a.r, b.r),
    c0: Math.min(a.c, b.c),
    c1: Math.max(a.c, b.c),
  };
}

/** Ô nằm trong vùng chọn không. */
export function inSelection(view: GridView, state: GridState, pos: Pos): boolean {
  const rect = selectionRect(view, state);
  const p = posIn(view, pos);
  return !!rect && !!p && p.r >= rect.r0 && p.r <= rect.r1 && p.c >= rect.c0 && p.c <= rect.c1;
}

/** Các ô của vùng chọn theo thứ tự dòng rồi cột. */
export function cellsOf(view: GridView, rect: Rect): Pos[] {
  const out: Pos[] = [];
  for (let r = rect.r0; r <= rect.r1; r++)
    for (let c = rect.c0; c <= rect.c1; c++) out.push({ row: view.rows[r], col: view.cols[c] });
  return out;
}

/** Đưa ô chọn về chỗ hợp lệ sau khi dữ liệu, bộ lọc hay cột đổi. */
export function clampSelection(a: GridAdapter, state: GridState): GridState {
  if (!state.cell) return state;
  const view = buildView(a, state);
  if (view.rows.length === 0 || view.cols.length === 0)
    return { ...state, cell: null, anchor: null, editing: null, ime: 'idle' };
  const fix = (p: Pos | null): Pos | null => {
    if (!p) return p;
    const row = view.rows.includes(p.row)
      ? p.row
      : p.row >= a.rowCount()
        ? view.rows[view.rows.length - 1]
        : view.rows[0];
    const col = view.cols.includes(p.col) ? p.col : view.cols[0];
    return row === p.row && col === p.col ? p : { row, col };
  };
  const cell = fix(state.cell);
  const anchor = fix(state.anchor) ?? cell;
  const editing =
    state.editing && cell && state.editing.row === cell.row && state.editing.col === cell.col
      ? state.editing
      : null;
  if (cell === state.cell && anchor === state.anchor && editing === state.editing) return state;
  return { ...state, cell, anchor, editing, ime: editing ? state.ime : 'idle' };
}

/** Chọn ô (nhấp); `extend` (Shift+nhấp, kéo chuột) giữ neo cũ và kéo vùng tới ô này. Ô không hiện thì bỏ qua. */
export function selectCell(a: GridAdapter, state: GridState, pos: Pos, extend = false): GridState {
  const view = buildView(a, state);
  if (!posIn(view, pos)) return state;
  const anchor = extend && state.anchor ? state.anchor : pos;
  return { ...state, cell: pos, anchor, editing: null, ime: 'idle' };
}

/** Ctrl+A: chọn mọi ô đang hiện. */
export function selectAll(a: GridAdapter, state: GridState): GridState {
  const view = buildView(a, state);
  if (!view.rows.length || !view.cols.length) return state;
  return {
    ...state,
    anchor: { row: view.rows[0], col: view.cols[0] },
    cell: { row: view.rows[view.rows.length - 1], col: view.cols[view.cols.length - 1] },
    editing: null,
    ime: 'idle',
  };
}

const settle = (a: GridAdapter, s: GridState): GridState =>
  clampSelection(a, { ...s, editing: null, ime: 'idle' });

export function setFilter(a: GridAdapter, state: GridState, filter: string): GridState {
  return settle(a, { ...state, filter });
}

/** Đặt (hoặc bỏ, chuỗi rỗng) bộ lọc của một cột. */
export function setColFilter(
  a: GridAdapter,
  state: GridState,
  col: string,
  filter: string,
): GridState {
  const colFilters = { ...state.colFilters };
  if (filter.trim() === '') delete colFilters[col];
  else colFilters[col] = filter;
  return settle(a, { ...state, colFilters });
}

/** Sắp xếp theo cột; `null` bỏ sắp xếp (thứ tự gốc). */
export function setSort(
  a: GridAdapter,
  state: GridState,
  col: string | null,
  dir: 'asc' | 'desc',
): GridState {
  return settle(a, { ...state, sort: col === null ? null : { col, dir } });
}
