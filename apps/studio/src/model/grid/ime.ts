// Chế độ sửa ô và bộ gõ của lưới (feature 006, ADR-016 điểm 2, data-model §13.2 "Máy trạng thái của ô nhập").
//
// Một `textarea` luôn giữ focus khi lưới được focus, nằm trên ô hiện hành (component mat-grid). Ở chế độ di chuyển nó
// rỗng và trong suốt; chữ tới qua sự kiện của chính nó:
//   - `keydown` có `key = "Process"` (bộ gõ Windows/TSF: Telex có sẵn) hoặc `isComposing`: lưới KHÔNG xử lý, KHÔNG chặn;
//   - `compositionstart` → vào sửa (origin `typed`), ime = `composing`;
//   - `beforeinput`/`input` có chữ → vào sửa (origin `typed`), giữ chữ đã vào ô nhập (Unikey, bàn phím thường);
//   - Esc khi đang ghép → `cancelPending`: hủy sửa sau `compositionend`, ô giữ nội dung cũ;
//   - Enter, Tab khi đang ghép thuộc về bộ gõ; khi rảnh xác nhận đúng một sửa đổi.
// Hàm thuần: trả `GridOutcome` (trạng thái mới, sửa đổi, `handled`, thông báo).
import type { MessageKey } from '../../i18n/index.ts';
import type { ProjectEdit } from '../project-doc.ts';
import {
  buildView,
  cellsOf,
  posIn,
  selectionRect,
  type EditSession,
  type GridState,
} from './selection.ts';
import type { CellChange, GridAdapter, Pos, Rejected } from './types.ts';

/** Phần của KeyboardEvent mà lưới cần. */
export interface KeyInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  /** Đang ghép chữ bằng bộ gõ. */
  isComposing?: boolean;
}

export interface GridNotice {
  key: MessageKey;
  params?: Record<string, string | number>;
}

export interface GridOutcome {
  state: GridState;
  edits: ProjectEdit[];
  /** true: lưới đã xử lý phím/sự kiện, component gọi preventDefault. */
  handled: boolean;
  notice?: GridNotice;
  /** Ô bị từ chối (chữ không đổi được thành giá trị): component đánh dấu lỗi tại ô. */
  rejected?: Rejected[];
}

export type Move = 'down' | 'right' | 'left' | 'none';

export const outcome = (state: GridState, extra: Partial<GridOutcome> = {}): GridOutcome => ({
  state,
  edits: [],
  handled: true,
  ...extra,
});
const unhandled = (state: GridState): GridOutcome => outcome(state, { handled: false });

/** Phím của bộ gõ: `Process` hoặc đang ghép chữ. Lưới không xử lý, không chặn. */
export const isImeKey = (e: KeyInput): boolean => e.key === 'Process' || !!e.isComposing;

const notice = (key: MessageKey, params?: Record<string, string | number>): GridNotice =>
  params ? { key, params } : { key };

/** Ô hiện hành sửa được không; không thì kèm thông báo. */
function editableCell(a: GridAdapter, s: GridState): { cell: Pos } | { notice: GridNotice } | null {
  const cell = s.cell;
  if (!cell) return null;
  const col = a.columns.find((c) => c.key === cell.col);
  if (!col || col.kind === 'readonly' || col.kind === 'live' || !a.editable(cell.row, cell.col))
    return { notice: notice('gx.notice.readonly') };
  return { cell };
}

function start(
  a: GridAdapter,
  s: GridState,
  origin: EditSession['origin'],
  text: string | null,
  ime: GridState['ime'],
): GridOutcome {
  if (s.editing) return outcome({ ...s, ime: ime === 'idle' ? s.ime : ime });
  const ok = editableCell(a, s);
  if (!ok) return unhandled(s);
  if ('notice' in ok) return outcome(s, { notice: ok.notice });
  const original = a.text(ok.cell.row, ok.cell.col);
  const editing: EditSession = {
    row: ok.cell.row,
    col: ok.cell.col,
    original,
    text: text ?? original,
    origin,
  };
  return outcome({ ...s, editing, ime });
}

/** F2, Enter (`f2`) hoặc nhấp đúp (`dblclick`): sửa với chữ hiện tại. */
export function beginEdit(
  a: GridAdapter,
  s: GridState,
  origin: 'f2' | 'dblclick' = 'f2',
): GridOutcome {
  if (s.editing) return outcome(s);
  return start(a, s, origin, null, 'idle');
}

/** `beforeinput`/`input` có chữ: vào sửa với chữ đã vào ô nhập; đang sửa thì chỉ cập nhật chữ. */
export function beginTyped(a: GridAdapter, s: GridState, text: string): GridOutcome {
  if (s.editing) return outcome(setEditText(s, text));
  return start(a, s, 'typed', text, 'idle');
}

/** `compositionstart`: vào sửa (chữ chưa có), ime = composing; đang sửa rồi thì giữ chữ. */
export function compositionStart(a: GridAdapter, s: GridState): GridOutcome {
  if (s.editing) return outcome({ ...s, ime: 'composing' });
  const r = start(a, s, 'typed', '', 'composing');
  return r.state.editing ? r : r;
}

/** `compositionend`: về idle; nếu đã Esc giữa lúc ghép thì hủy sửa, ô giữ nội dung cũ. */
export function compositionEnd(_a: GridAdapter, s: GridState): GridOutcome {
  if (s.ime === 'cancelPending') return outcome({ ...s, editing: null, ime: 'idle' });
  return outcome({ ...s, ime: 'idle' });
}

/** Cập nhật chữ đang gõ (sự kiện `input` khi đang sửa). */
export function setEditText(s: GridState, text: string): GridState {
  return s.editing && s.editing.text !== text ? { ...s, editing: { ...s.editing, text } } : s;
}

export const cancelEdit = (s: GridState): GridState => ({ ...s, editing: null, ime: 'idle' });

/**
 * Xác nhận chữ `text` của ô đang sửa rồi đi theo `move`. Vùng chọn nhiều ô thì áp chữ cho mọi ô sửa được trong vùng.
 * Chữ không đổi được (ô số gõ chữ, danh sách chọn gõ ngoài danh sách) thì giữ chế độ sửa và báo ô bị từ chối.
 */
export function commitEdit(a: GridAdapter, s: GridState, text: string, move: Move): GridOutcome {
  const ed = s.editing;
  if (!ed) return unhandled(s);
  const view = buildView(a, s);
  const rect = selectionRect(view, s);
  const multi = !!rect && (rect.r0 !== rect.r1 || rect.c0 !== rect.c1);
  const targets: Pos[] = multi ? cellsOf(view, rect) : [{ row: ed.row, col: ed.col }];
  const changes: CellChange[] = [];
  for (const p of targets) {
    const col = a.columns.find((c) => c.key === p.col);
    if (!col || col.kind === 'readonly' || col.kind === 'live' || !a.editable(p.row, p.col))
      continue;
    if (!multi && text === ed.original) continue;
    if (multi && a.text(p.row, p.col) === text) continue;
    changes.push({ row: p.row, col: p.col, text });
  }
  const res = changes.length
    ? a.apply(changes)
    : { edits: [] as ProjectEdit[], rejected: [] as Rejected[] };
  if (res.rejected.length && !multi)
    return outcome(s, {
      rejected: res.rejected,
      notice: notice('gx.notice.rejected', { count: res.rejected.length }),
    });
  let next: GridState = { ...s, editing: null, ime: 'idle' };
  if (!multi && move !== 'none') {
    const p = posIn(view, { row: ed.row, col: ed.col });
    if (p) {
      const dr = move === 'down' ? 1 : 0;
      const dc = move === 'right' ? 1 : move === 'left' ? -1 : 0;
      const r = Math.min(view.rows.length - 1, Math.max(0, p.r + dr));
      const c = Math.min(view.cols.length - 1, Math.max(0, p.c + dc));
      const cell = { row: view.rows[r], col: view.cols[c] };
      next = { ...next, cell, anchor: cell };
    }
  }
  const extra: Partial<GridOutcome> = { edits: res.edits };
  if (res.rejected.length) {
    extra.rejected = res.rejected;
    extra.notice = notice('gx.notice.rejected', { count: res.rejected.length });
  }
  return outcome(next, extra);
}

/**
 * Phím khi đang sửa. Bộ gõ giữ Enter, Tab, mũi tên khi đang ghép (không xử lý, không chặn); Esc khi đang ghép →
 * `cancelPending` (bộ gõ cũng nhận Esc). Khi rảnh: Enter xác nhận rồi xuống dòng, Tab/Shift+Tab xác nhận rồi sang
 * phải/trái, Esc hủy; phím khác để ô nhập tự xử lý.
 */
export function editKey(a: GridAdapter, s: GridState, e: KeyInput, text: string): GridOutcome {
  const composing = s.ime === 'composing' || !!e.isComposing || e.key === 'Process';
  if (composing) {
    if (e.key === 'Escape')
      return { state: { ...s, ime: 'cancelPending' }, edits: [], handled: false };
    return { state: s, edits: [], handled: false };
  }
  if (e.key === 'Enter') return commitEdit(a, s, text, 'down');
  if (e.key === 'Tab') return commitEdit(a, s, text, e.shiftKey ? 'left' : 'right');
  if (e.key === 'Escape') return outcome(cancelEdit(s));
  return unhandled(s);
}
