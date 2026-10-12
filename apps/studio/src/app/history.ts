// Lịch sử sửa của Studio (feature 004, data-model §4, research R5, FR-021): hoàn tác/làm lại bằng
// snapshot của các tài liệu sửa được (chuỗi JSON, xem snapshotOf của model/project-doc.ts). Hàm thuần
// trên trạng thái bất biến; store giữ trạng thái và tự khôi phục snapshot.
//
// Cách dùng: trước mỗi lần sửa gọi recordEdit(h, snapshot hiện tại, now, mergeKey?); hoàn tác gọi
// undoEdit(h, snapshot hiện tại) rồi khôi phục `snapshot` trả về. Lưu không đụng tới lịch sử: hoàn tác
// sau khi lưu làm tài liệu chưa lưu trở lại.

/** Số bước hoàn tác tối đa (FR-021); đầy thì bỏ bước cũ nhất. */
export const HISTORY_LIMIT = 100;
/** Gõ liên tục vào cùng ô/trường, mỗi lần cách nhau dưới 1,2 s, gộp thành một bước. */
export const MERGE_MS = 1200;

export interface EditHistory<S> {
  /** Snapshot trước các lần sửa, cũ nhất trước. */
  readonly past: readonly S[];
  /** Snapshot để làm lại, bước gần nhất ở cuối. */
  readonly future: readonly S[];
  /** Khóa gộp của lần sửa cuối (ví dụ `settings:projectName`); null thì lần sửa sau luôn là bước mới. */
  readonly mergeKey: string | null;
  /** Thời điểm (ms) của lần sửa cuối có khóa gộp. */
  readonly mergeAt: number;
}

export interface HistoryStep<S> {
  history: EditHistory<S>;
  /** Snapshot cần khôi phục. */
  snapshot: S;
}

export function createHistory<S>(): EditHistory<S> {
  return { past: [], future: [], mergeKey: null, mergeAt: 0 };
}

/**
 * Ghi một lần sửa; `before` là snapshot TRƯỚC khi sửa. Cùng `mergeKey` với lần sửa trước và cách lần
 * đó dưới MERGE_MS thì gộp vào cùng bước (không đẩy snapshot). Sửa mới luôn xóa `future`.
 */
export function recordEdit<S>(
  h: EditHistory<S>,
  before: S,
  now: number,
  mergeKey?: string,
): EditHistory<S> {
  if (mergeKey !== undefined && mergeKey === h.mergeKey && now - h.mergeAt < MERGE_MS)
    return { ...h, future: [], mergeAt: now };
  const past = [...h.past, before];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, future: [], mergeKey: mergeKey ?? null, mergeAt: now };
}

/** Hoàn tác: `current` (snapshot hiện tại) vào `future`, trả snapshot cần khôi phục; hết bước thì null. */
export function undoEdit<S>(h: EditHistory<S>, current: S): HistoryStep<S> | null {
  if (h.past.length === 0) return null;
  return {
    history: {
      past: h.past.slice(0, -1),
      future: [...h.future, current],
      mergeKey: null,
      mergeAt: 0,
    },
    snapshot: h.past[h.past.length - 1],
  };
}

/** Làm lại: ngược với undoEdit. */
export function redoEdit<S>(h: EditHistory<S>, current: S): HistoryStep<S> | null {
  if (h.future.length === 0) return null;
  return {
    history: {
      past: [...h.past, current],
      future: h.future.slice(0, -1),
      mergeKey: null,
      mergeAt: 0,
    },
    snapshot: h.future[h.future.length - 1],
  };
}

export const canUndo = (h: EditHistory<unknown>): boolean => h.past.length > 0;
export const canRedo = (h: EditHistory<unknown>): boolean => h.future.length > 0;

/** Ngắt gộp (ví dụ khi rời ô hoặc vừa lưu): lần sửa sau luôn là bước mới. */
export function breakMerge<S>(h: EditHistory<S>): EditHistory<S> {
  return h.mergeKey === null ? h : { ...h, mergeKey: null };
}
