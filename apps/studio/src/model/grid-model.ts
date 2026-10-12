// Logic thuần của lưới Bảng Tag (feature 004, FR-020, research R3; phím theo contracts/commands.md
// "Phím trong từng vùng"): chọn ô, di chuyển, sửa, xác nhận, hủy, xóa ô, điền xuống, thêm/xóa dòng,
// lọc, dán dữ liệu dạng tab. Không đụng DOM: lưới Lit của GĐ 1 và lưới ảo hóa của GĐ 2 dùng chung.
//
// Mỗi thao tác trả GridResult: trạng thái lưới mới, các sửa đổi (ProjectEdit) để store ghi lịch sử rồi
// áp vào tài liệu, `handled` (component gọi preventDefault) và `notice` (khóa i18n để báo, ví dụ cột
// chỉ đọc). Dòng (`row`) luôn là chỉ số Tag trong tags.json, không phải vị trí đang hiện.
import type { TagDataType, TagDefinition } from '@mat/project-schema';
import { fold, t, type MessageKey } from '../i18n/index.ts';
import { canonicalTag, setTagField, type ProjectEdit, type TagField } from './project-doc.ts';
import { nextTagId } from './tag-ids.ts';

export type TagColumn = TagField;
export type LiveColumn = 'value' | 'quality';
export type GridColumn = TagColumn | LiveColumn;
/** text, number, select: sửa được; readonly: nguồn Tag (sửa từ GĐ 2); live: giá trị sống khi theo dõi. */
export type ColumnKind = 'text' | 'number' | 'select' | 'readonly' | 'live';

export interface ColumnSpec {
  key: GridColumn;
  label: MessageKey;
  kind: ColumnKind;
  /** Bề rộng gợi ý (px), như mockup. */
  width: number;
  /** Phông đơn cách (tên Tag). */
  mono?: boolean;
}

export const TAG_COLUMNS: readonly ColumnSpec[] = [
  { key: 'id', label: 'grid.col.id', kind: 'text', width: 150, mono: true },
  { key: 'type', label: 'grid.col.type', kind: 'select', width: 86 },
  { key: 'source', label: 'grid.col.source', kind: 'readonly', width: 170 },
  { key: 'unit', label: 'grid.col.unit', kind: 'text', width: 60 },
  { key: 'min', label: 'grid.col.min', kind: 'number', width: 60 },
  { key: 'max', label: 'grid.col.max', kind: 'number', width: 60 },
  { key: 'description', label: 'grid.col.description', kind: 'text', width: 220 },
];

export const LIVE_COLUMNS: readonly ColumnSpec[] = [
  { key: 'value', label: 'grid.col.value', kind: 'live', width: 110 },
  { key: 'quality', label: 'grid.col.quality', kind: 'live', width: 84 },
];

/** Cột của lưới; khi theo dõi thiết bị, giá trị sống và quality đứng ngay sau tên (FR-028). */
export function gridColumns(monitoring: boolean): readonly ColumnSpec[] {
  return monitoring ? [TAG_COLUMNS[0], ...LIVE_COLUMNS, ...TAG_COLUMNS.slice(1)] : TAG_COLUMNS;
}

export const TAG_TYPES: readonly TagDataType[] = [
  'BOOL',
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
  'STRING',
];

export interface GridData {
  /** Tag trong file Tag đang sửa (có thể có trường sai kiểu khi người dùng đang sửa dở). */
  tags: readonly TagDefinition[];
  columns: readonly ColumnSpec[];
}

export interface CellRef {
  row: number;
  column: GridColumn;
}

export interface EditState {
  row: number;
  column: TagColumn;
  /** Nội dung ô lúc bắt đầu sửa: xác nhận mà nội dung vẫn vậy thì không sinh sửa đổi. */
  original: string;
  /** Nội dung ban đầu của ô nhập. */
  text: string;
  /** `all`: chọn hết (Enter, F2, nhấp đúp); `end`: con trỏ sau ký tự vừa gõ. */
  caret: 'all' | 'end';
}

export interface GridState {
  cell: CellRef | null;
  editing: EditState | null;
  /** Lọc theo tên và mô tả (bỏ dấu). */
  filter: string;
}

export interface GridResult {
  state: GridState;
  edits: ProjectEdit[];
  /** true: lưới đã xử lý phím, component gọi preventDefault. */
  handled: boolean;
  notice?: MessageKey;
}

/** Phần của KeyboardEvent mà lưới cần. */
export interface KeyInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  /** Đang gõ bằng bộ gõ (IME): không bắt Enter/Tab. */
  isComposing?: boolean;
}

export type Move = 'down' | 'right' | 'left' | 'none';

export const initialGridState: GridState = { cell: null, editing: null, filter: '' };

/** Khóa của một ô, ví dụ cho bảng ô lỗi (issue-map): `3:max`. */
export const cellKey = (row: number, column: GridColumn): string => `${row}:${column}`;

const EDITABLE: ReadonlySet<ColumnKind> = new Set(['text', 'number', 'select']);
const asText = (v: unknown): string =>
  v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const field = (tag: TagDefinition, column: GridColumn): unknown =>
  (tag as unknown as Record<string, unknown>)[column];
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const result = (state: GridState, edits: ProjectEdit[] = [], handled = true): GridResult => ({
  state,
  edits,
  handled,
});
const readonlyNotice = (kind: ColumnKind): MessageKey =>
  kind === 'live' ? 'grid.notice.liveReadonly' : 'grid.notice.sourceReadonly';

/** Chỉ số các dòng đang hiện: tên hoặc mô tả chứa mọi từ của bộ lọc (bỏ dấu, không phân biệt hoa thường). */
export function visibleRows(tags: readonly TagDefinition[], filter: string): number[] {
  const words = fold(filter).split(/\s+/).filter(Boolean);
  const out: number[] = [];
  tags.forEach((tag, i) => {
    const hay = words.length ? fold(`${asText(tag?.id)} ${asText(tag?.description)}`) : '';
    if (words.every((w) => hay.includes(w))) out.push(i);
  });
  return out;
}

/** Nội dung hiển thị của ô (cũng là nội dung ban đầu khi sửa). Cột giá trị sống do giao diện vẽ. */
export function cellText(tag: TagDefinition | undefined, column: GridColumn): string {
  if (!tag || column === 'value' || column === 'quality') return '';
  const v = field(tag, column);
  if (column === 'source') {
    if (v === null || typeof v !== 'object') return asText(v);
    const s = v as { kind?: unknown; signal?: unknown };
    return s.kind === 'mock' ? t('grid.source.mock', { signal: asText(s.signal) }) : asText(s.kind);
  }
  return asText(v);
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * Số nhập ở Min/Max: nhận dấu phẩy thập phân (`1,5` → 1.5); trống → undefined (bỏ khóa); không phải
 * số thì giữ chuỗi để bộ kiểm tra báo lỗi ngay tại ô (lưu việc làm dở vẫn được, FR-023).
 */
export function parseNumber(raw: string): number | string | undefined {
  const s = raw.trim();
  if (s === '') return undefined;
  const dotted = !s.includes('.') && s.split(',').length === 2 ? s.replace(',', '.') : s;
  return NUMBER.test(dotted) ? Number(dotted) : s;
}

/** Giá trị ghi vào file khi xác nhận nội dung `raw` của ô. */
function parseCell(column: TagColumn, raw: string): unknown {
  switch (column) {
    case 'min':
    case 'max':
      return parseNumber(raw);
    case 'unit':
    case 'description':
      return raw.trim() === '' ? undefined : raw.trim();
    default:
      return raw.trim();
  }
}

function fieldEdit(
  tag: TagDefinition,
  row: number,
  column: TagColumn,
  value: unknown,
): ProjectEdit[] {
  return same(field(tag, column), value)
    ? []
    : [{ kind: 'tagField', index: row, field: column, value }];
}

const specOf = (data: GridData, column: GridColumn) => data.columns.find((c) => c.key === column);

/** Đưa ô chọn về chỗ hợp lệ sau khi Tag, bộ lọc hay cột đổi. */
export function clampCell(data: GridData, state: GridState): GridState {
  const rows = visibleRows(data.tags, state.filter);
  if (!state.cell) return state;
  if (rows.length === 0) return { ...state, cell: null, editing: null };
  const row = rows.includes(state.cell.row) ? state.cell.row : rows[0];
  const column = specOf(data, state.cell.column) ? state.cell.column : 'id';
  const cell =
    row === state.cell.row && column === state.cell.column ? state.cell : { row, column };
  const editing =
    state.editing && state.editing.row === cell.row && state.editing.column === cell.column
      ? state.editing
      : null;
  return { ...state, cell, editing };
}

export function selectCell(data: GridData, state: GridState, cell: CellRef): GridState {
  return clampCell(data, { ...state, cell, editing: null });
}

export function setFilter(data: GridData, state: GridState, filter: string): GridState {
  return clampCell(data, { ...state, filter, editing: null });
}

/** Ô sau khi đi `dr` dòng (trong các dòng đang hiện) và `dc` cột, chặn ở biên. */
function moved(data: GridData, state: GridState, dr: number, dc: number): CellRef | null {
  const rows = visibleRows(data.tags, state.filter);
  if (!rows.length || !data.columns.length) return null;
  const cell = state.cell;
  const ri = Math.max(0, cell ? rows.indexOf(cell.row) : 0);
  const ci = Math.max(0, cell ? data.columns.findIndex((c) => c.key === cell.column) : 0);
  const clamp = (v: number, n: number) => Math.min(n - 1, Math.max(0, v));
  return {
    row: rows[clamp(ri + dr, rows.length)],
    column: data.columns[clamp(ci + dc, data.columns.length)].key,
  };
}

const sameCell = (a: CellRef | null, b: CellRef | null) =>
  !!a && !!b && a.row === b.row && a.column === b.column;

/** Bắt đầu sửa ô (nhấp đúp, Enter, F2) hoặc gõ thẳng (`typed`: ký tự vừa gõ). */
export function beginEdit(
  data: GridData,
  state: GridState,
  cell: CellRef,
  typed?: string,
): GridResult {
  const spec = specOf(data, cell.column);
  const tag = data.tags[cell.row];
  if (!spec || !tag) return result(state, [], false);
  const selected: GridState = { ...state, cell, editing: null };
  if (!EDITABLE.has(spec.kind)) return { ...result(selected), notice: readonlyNotice(spec.kind) };
  // Danh sách chọn (kiểu): gõ chữ không vào sửa; Enter/F2 mở danh sách.
  if (spec.kind === 'select' && typed !== undefined) return result(selected, [], false);
  const original = cellText(tag, cell.column);
  return result({
    ...selected,
    editing: {
      row: cell.row,
      column: cell.column as TagColumn,
      original,
      text: typed ?? original,
      caret: typed === undefined ? 'all' : 'end',
    },
  });
}

/** Xác nhận nội dung `text` của ô đang sửa rồi đi theo `move`. */
export function commitEdit(data: GridData, state: GridState, text: string, move: Move): GridResult {
  const ed = state.editing;
  if (!ed) return result(state, [], false);
  const tag = data.tags[ed.row];
  const edits =
    tag && text !== ed.original
      ? fieldEdit(tag, ed.row, ed.column, parseCell(ed.column, text))
      : [];
  let next: GridState = { ...state, editing: null, cell: { row: ed.row, column: ed.column } };
  const delta = { down: [1, 0], right: [0, 1], left: [0, -1], none: [0, 0] }[move];
  if (move !== 'none') next = { ...next, cell: moved(data, next, delta[0], delta[1]) };
  return result(next, edits);
}

export function cancelEdit(state: GridState): GridState {
  return { ...state, editing: null };
}

/** Delete: xóa nội dung ô (bỏ khóa khỏi Tag); tên và kiểu là bắt buộc nên không xóa. */
export function clearCell(data: GridData, state: GridState): GridResult {
  const cell = state.cell;
  const spec = cell && specOf(data, cell.column);
  const tag = cell && data.tags[cell.row];
  if (!cell || !spec || !tag) return result(state, [], false);
  if (!EDITABLE.has(spec.kind)) return { ...result(state), notice: readonlyNotice(spec.kind) };
  if (cell.column === 'id' || cell.column === 'type')
    return { ...result(state), notice: 'grid.notice.required' };
  return result(state, fieldEdit(tag, cell.row, cell.column as TagColumn, undefined));
}

/** Điền xuống (Ctrl+D): chép ô của dòng đang hiện bên trên; cột tên thì tăng số, không trùng tên. */
export function fillDown(data: GridData, state: GridState): GridResult {
  const cell = state.cell;
  const spec = cell && specOf(data, cell.column);
  const tag = cell && data.tags[cell.row];
  if (!cell || !spec || !tag) return result(state);
  if (!EDITABLE.has(spec.kind)) return { ...result(state), notice: readonlyNotice(spec.kind) };
  const rows = visibleRows(data.tags, state.filter);
  const p = rows.indexOf(cell.row);
  if (p <= 0) return result(state);
  const above = data.tags[rows[p - 1]];
  const column = cell.column as TagColumn;
  let value = field(above, column);
  if (column === 'id') {
    const taken = data.tags.filter((_, i) => i !== cell.row).map((x) => asText(x?.id));
    value = nextTagId(asText(value), taken);
  }
  return result(state, fieldEdit(tag, cell.row, column, value));
}

/** Nguồn mô phỏng cho Tag mới khi không có dòng mẫu: tên viết thường (signal của mock driver). */
const signalFor = (id: string): string => {
  const s = id.toLowerCase().replace(/[^a-z0-9_.]/g, '_');
  return (/^[a-z]/.test(s) ? s : `t${s}`).slice(0, 64);
};

/** Tag mới theo dòng mẫu: tên tăng số, chép kiểu, đơn vị, nguồn; thứ tự khóa chuẩn. */
function newTag(template: TagDefinition | undefined, taken: Iterable<string>): TagDefinition {
  const id = nextTagId(asText(template?.id), taken);
  const type = TAG_TYPES.includes(template?.type as TagDataType) ? template!.type : 'FLOAT32';
  const unit =
    typeof template?.unit === 'string' && template.unit !== '' ? template.unit : undefined;
  const src = template?.source;
  const source =
    src !== null && typeof src === 'object'
      ? src
      : { kind: 'mock' as const, signal: signalFor(id) };
  return canonicalTag({ id, type, unit, source });
}

/** Thêm Tag cuối bảng (theo dòng cuối), bỏ lọc để thấy dòng mới và vào sửa tên. */
export function addTag(data: GridData, state: GridState): GridResult {
  const tags = data.tags;
  const tag = newTag(
    tags[tags.length - 1],
    tags.map((x) => asText(x?.id)),
  );
  const row = tags.length;
  return result(
    {
      ...state,
      filter: '',
      cell: { row, column: 'id' },
      editing: { row, column: 'id', original: tag.id, text: tag.id, caret: 'all' },
    },
    [{ kind: 'tagUpsert', tag }],
  );
}

/** Xóa dòng của ô đang chọn; ô chọn giữ vị trí (dòng dưới dồn lên). */
export function deleteRow(data: GridData, state: GridState): GridResult {
  const cell = state.cell;
  if (!cell || !data.tags[cell.row]) return result(state, [], false);
  const p = Math.max(0, visibleRows(data.tags, state.filter).indexOf(cell.row));
  const after = visibleRows(
    data.tags.filter((_, i) => i !== cell.row),
    state.filter,
  );
  const row = after.length ? after[Math.min(p, after.length - 1)] : null;
  return result(
    { ...state, editing: null, cell: row === null ? null : { row, column: cell.column } },
    [{ kind: 'tagRemove', index: cell.row }],
  );
}

/**
 * Dán dữ liệu dạng tab (copy từ Excel) từ ô đang chọn: dòng theo các dòng đang hiện, cột theo các
 * cột đang hiện (cột chỉ đọc chiếm chỗ nhưng bỏ qua); quá dòng cuối thì thêm Tag mới. Logic có sẵn
 * nhưng giao diện GĐ 1 chưa bật (research R3).
 */
export function pasteTsv(data: GridData, state: GridState, text: string): GridResult {
  const cell = state.cell;
  const rows = visibleRows(data.tags, state.filter);
  const p = cell ? rows.indexOf(cell.row) : -1;
  const c0 = cell ? data.columns.findIndex((c) => c.key === cell.column) : -1;
  if (!cell || p < 0 || c0 < 0) return result(state, [], false);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  const edits: ProjectEdit[] = [];
  const created: TagDefinition[] = [];
  const ids = new Set(data.tags.map((x) => asText(x?.id)));
  let template = data.tags[data.tags.length - 1];
  lines.forEach((line, i) => {
    const target = rows[p + i];
    let tag = target === undefined ? newTag(template, ids) : data.tags[target];
    line.split('\t').forEach((raw, j) => {
      const spec = data.columns[c0 + j];
      if (!spec || !EDITABLE.has(spec.kind)) return;
      const column = spec.key as TagColumn;
      let value = parseCell(column, raw);
      if (column === 'type') {
        const up = asText(value).toUpperCase();
        if (!TAG_TYPES.includes(up as TagDataType)) return;
        value = up;
      }
      if (column === 'id' && value === '') return;
      if (target === undefined) tag = setTagField(tag, column, value);
      else edits.push(...fieldEdit(tag, target, column, value));
    });
    if (target === undefined) {
      created.push(tag);
      ids.add(asText(tag.id));
      template = tag;
    }
  });
  for (const tag of created) edits.push({ kind: 'tagUpsert', tag: canonicalTag(tag) });
  return result({ ...state, editing: null }, edits);
}

const isTyped = (e: KeyInput): boolean => {
  if ([...e.key].length !== 1) return false;
  const altGr = !!e.ctrlKey && !!e.altKey; // AltGr trên bàn phím châu Âu gửi Ctrl+Alt
  return altGr || (!e.ctrlKey && !e.metaKey && !e.altKey);
};

/**
 * Phím trên lưới. Khi đang sửa, `editText` là nội dung hiện tại của ô nhập: Enter xác nhận rồi xuống
 * dòng, Tab/Shift+Tab xác nhận rồi sang phải/trái, Esc hủy; phím khác để ô nhập tự xử lý.
 */
export function gridKey(
  data: GridData,
  state: GridState,
  e: KeyInput,
  editText?: string,
): GridResult {
  if (e.isComposing) return result(state, [], false);
  if (state.editing) {
    const text = editText ?? state.editing.text;
    if (e.key === 'Enter') return commitEdit(data, state, text, 'down');
    if (e.key === 'Tab') return commitEdit(data, state, text, e.shiftKey ? 'left' : 'right');
    if (e.key === 'Escape') return result(cancelEdit(state));
    return result(state, [], false);
  }
  const ctrl = !!e.ctrlKey || !!e.metaKey;
  const go = (dr: number, dc: number): GridResult => {
    // Chưa chọn ô: phím di chuyển nào cũng chọn ô đầu tiên.
    const cell = state.cell ? moved(data, state, dr, dc) : moved(data, state, 0, 0);
    return cell ? result({ ...state, cell }) : result(state, [], false);
  };
  const FAR = Number.MAX_SAFE_INTEGER;
  switch (e.key) {
    case 'ArrowUp':
      return go(ctrl ? -FAR : -1, 0);
    case 'ArrowDown':
      return go(ctrl ? FAR : 1, 0);
    case 'ArrowLeft':
      return go(0, ctrl ? -FAR : -1);
    case 'ArrowRight':
      return go(0, ctrl ? FAR : 1);
    case 'Home':
      return go(ctrl ? -FAR : 0, -FAR);
    case 'End':
      return go(ctrl ? FAR : 0, FAR);
    case 'Tab': {
      // Ở cột đầu/cuối, Tab không bị giữ lại: focus rời lưới (tránh bẫy bàn phím).
      if (!state.cell) return result(state, [], false);
      const next = moved(data, state, 0, e.shiftKey ? -1 : 1);
      return next && !sameCell(next, state.cell)
        ? result({ ...state, cell: next })
        : result(state, [], false);
    }
  }
  if (!state.cell) return result(state, [], false);
  if (e.key === 'Enter' || e.key === 'F2') return beginEdit(data, state, state.cell);
  if (e.key === 'Delete') return clearCell(data, state);
  if (ctrl && !e.altKey && (e.key === 'd' || e.key === 'D')) return fillDown(data, state);
  if (isTyped(e)) return beginEdit(data, state, state.cell, e.key);
  return result(state, [], false);
}
