// Phím của lưới ở chế độ di chuyển (feature 006, ADR-016, contract commands.md "Phím trong từng vùng"): mũi tên,
// Shift+mũi tên (mở rộng vùng), Ctrl+mũi tên (tới biên), Home, End, PageUp, PageDown, Tab, Enter/F2 (sửa), Delete
// (xóa vùng), Ctrl+A (chọn hết), Ctrl+D (điền xuống). Phím của bộ gõ và ký tự thường không bị lưới xử lý (ô nhập
// nhận chữ qua beforeinput/input). Hàm thuần.
import { fillDown } from './fill.ts';
import {
  beginEdit,
  isImeKey,
  outcome,
  type GridNotice,
  type GridOutcome,
  type KeyInput,
} from './ime.ts';
import {
  buildView,
  cellsOf,
  posIn,
  selectAll,
  selectionRect,
  type GridState,
} from './selection.ts';
import type { CellChange, GridAdapter, Pos, Rejected } from './types.ts';

export interface KeyOptions {
  /** Số dòng của khung nhìn (PageUp, PageDown). */
  pageSize?: number;
}

const FAR = Number.MAX_SAFE_INTEGER;

/** Di chuyển ô hiện hành `dr` dòng và `dc` cột trong dòng đang hiện; `extend` giữ neo (Shift). */
function move(a: GridAdapter, s: GridState, dr: number, dc: number, extend: boolean): GridOutcome {
  const view = buildView(a, s);
  if (!view.rows.length || !view.cols.length) return outcome(s, { handled: false });
  const cur = s.cell ? posIn(view, s.cell) : null;
  // Chưa chọn ô: phím di chuyển nào cũng chọn ô đầu tiên.
  const base = cur ?? { r: 0, c: 0 };
  const clamp = (v: number, n: number) => Math.min(n - 1, Math.max(0, v));
  const r = cur ? clamp(base.r + dr, view.rows.length) : 0;
  const c = cur ? clamp(base.c + dc, view.cols.length) : 0;
  const cell: Pos = { row: view.rows[r], col: view.cols[c] };
  const anchor = extend && s.anchor && cur ? s.anchor : cell;
  return outcome({ ...s, cell, anchor, ime: 'idle' });
}

/** Delete: xóa nội dung vùng chọn (một lô); ô bắt buộc (tên) bị adapter từ chối kèm lý do. */
export function clearSelection(a: GridAdapter, s: GridState): GridOutcome {
  const view = buildView(a, s);
  const rect = selectionRect(view, s);
  if (!rect) return outcome(s, { handled: false });
  const changes: CellChange[] = [];
  let readonly = 0;
  for (const p of cellsOf(view, rect)) {
    const col = a.columns.find((c) => c.key === p.col);
    if (!col || col.kind === 'readonly' || col.kind === 'live' || !a.editable(p.row, p.col)) {
      readonly++;
      continue;
    }
    if (a.text(p.row, p.col) !== '') changes.push({ row: p.row, col: p.col, text: '' });
  }
  if (!changes.length) return outcome(s, readonly ? { notice: { key: 'gx.notice.readonly' } } : {});
  const res = a.apply(changes);
  const extra: Partial<GridOutcome> = { edits: res.edits };
  if (res.rejected.length) {
    extra.rejected = res.rejected;
    extra.notice = rejectedNotice(res.rejected);
  }
  return outcome(s, extra);
}

/** Thông báo cho ô bị từ chối: ô bắt buộc thì nói bắt buộc, không thì nói số ô không hợp lệ. */
function rejectedNotice(rejected: readonly Rejected[]): GridNotice {
  return rejected.every((r) => r.reason === 'required')
    ? { key: 'gx.notice.required' }
    : { key: 'gx.notice.rejected', params: { count: rejected.length } };
}

/** Phím khi KHÔNG đang sửa. */
export function gridKey(
  a: GridAdapter,
  s: GridState,
  e: KeyInput,
  opts: KeyOptions = {},
): GridOutcome {
  // Bộ gõ: không xử lý, không chặn.
  if (isImeKey(e)) return outcome(s, { handled: false });
  const ctrl = !!e.ctrlKey || !!e.metaKey;
  const shift = !!e.shiftKey;
  const page = Math.max(1, opts.pageSize ?? 20);
  switch (e.key) {
    case 'ArrowUp':
      return move(a, s, ctrl ? -FAR : -1, 0, shift);
    case 'ArrowDown':
      return move(a, s, ctrl ? FAR : 1, 0, shift);
    case 'ArrowLeft':
      return move(a, s, 0, ctrl ? -FAR : -1, shift);
    case 'ArrowRight':
      return move(a, s, 0, ctrl ? FAR : 1, shift);
    case 'Home':
      return move(a, s, ctrl ? -FAR : 0, -FAR, shift);
    case 'End':
      return move(a, s, ctrl ? FAR : 0, FAR, shift);
    case 'PageUp':
      return move(a, s, -page, 0, shift);
    case 'PageDown':
      return move(a, s, page, 0, shift);
    case 'Tab': {
      // Ở cột đầu/cuối, Tab không bị giữ lại: focus rời lưới (tránh bẫy bàn phím).
      if (!s.cell) return outcome(s, { handled: false });
      const r = move(a, s, 0, shift ? -1 : 1, false);
      return r.state.cell?.col === s.cell.col && r.state.cell.row === s.cell.row
        ? outcome(s, { handled: false })
        : r;
    }
  }
  if (!s.cell) return outcome(s, { handled: false });
  if (e.key === 'Enter' || e.key === 'F2') return beginEdit(a, s, 'f2');
  if (e.key === 'Delete') return clearSelection(a, s);
  if (ctrl && !e.altKey && (e.key === 'a' || e.key === 'A')) return outcome(selectAll(a, s));
  if (ctrl && !e.altKey && (e.key === 'd' || e.key === 'D')) return fillDown(a, s);
  return outcome(s, { handled: false });
}
