// Chọn phần tử SVG trong item đang "vào" (feature 008, T069; contract studio-svg-editor §10). Hàm thuần, không DOM thật:
// hit-test nhận danh sách `elementsFromPoint` (phần tử trên cùng trước) qua giao diện tối thiểu `UidSource`; khung chọn quy
// từ `getBoundingClientRect` về đơn vị thiết kế bằng viewport của canvas. Không sửa DOM của SVG.
import type { Rect } from '@mat/project-schema';
import { toDesign, type Viewport } from './screen-edit/viewport.ts';

export const UID_ATTR = 'data-mat-uid';

/** Phần tử DOM như hit-test thấy: chỉ cần đọc thuộc tính. */
export interface UidSource {
  getAttribute(name: string): string | null;
}

/** UID của các phần tử có `data-mat-uid` theo thứ tự đầu vào (trên cùng trước); bỏ phần tử không có UID. */
export function uidsAtPoint(list: readonly UidSource[]): string[] {
  const out: string[] = [];
  for (const el of list) {
    const uid = el.getAttribute(UID_ATTR);
    if (uid !== null && uid !== '' && !out.includes(uid)) out.push(uid);
  }
  return out;
}

export interface PickMods {
  shift: boolean;
  alt: boolean;
}

/**
 * Phần tử được nhấp: phần tử có UID đầu danh sách; Alt+nhấp lấy phần tử có UID kế tiếp (cha), tính từ phần tử đang chọn
 * nếu nó nằm trong danh sách (nhấp Alt liên tiếp đi lên dần), không thì từ phần tử đầu. Không có UID: `null`.
 */
export function pickUid(
  list: readonly UidSource[],
  mods: PickMods,
  current: readonly string[] = [],
): string | null {
  const uids = uidsAtPoint(list);
  if (uids.length === 0) return null;
  if (!mods.alt) return uids[0]!;
  const at = Math.max(0, uids.indexOf(current[current.length - 1] ?? ''));
  return uids[Math.min(at + 1, uids.length - 1)]!;
}

/** Vùng chọn sau một cú nhấp: Shift thêm hoặc bớt (cùng item); nhấp vào chỗ trống không UID bỏ chọn trừ khi Shift. */
export function applyPick(
  selected: readonly string[],
  uid: string | null,
  mods: PickMods,
): string[] {
  if (uid === null) return mods.shift ? [...selected] : [];
  if (mods.shift)
    return selected.includes(uid) ? selected.filter((u) => u !== uid) : [...selected, uid];
  return selected.length === 1 && selected[0] === uid ? [...selected] : [uid];
}

/** Hình chữ nhật client (như `getBoundingClientRect`). */
export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Khung chọn theo đơn vị thiết kế: `rect` (client) trừ gốc canvas (`origin`: vị trí client của góc trên trái vùng vẽ) rồi
 * chia zoom, trừ pan của viewport.
 */
export function selectionRect(
  rect: ClientRect,
  origin: { left: number; top: number },
  vp: Viewport,
): Rect {
  const a = toDesign(vp, { x: rect.left - origin.left, y: rect.top - origin.top });
  return { x: a.x, y: a.y, width: rect.width / vp.zoom, height: rect.height / vp.zoom };
}

/** Hợp các khung (nhiều phần tử chọn); rỗng thì `null`. */
export function unionRect(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  const y1 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// ---- Trạng thái "vào item" ----

export interface EnterState {
  /** Item `svg` đang vào; `null` = không vào. */
  enteredItemId: string | null;
  selectedUids: readonly string[];
}
export const NOT_ENTERED: EnterState = { enteredItemId: null, selectedUids: [] };

export const enterItem = (_s: EnterState, itemId: string): EnterState => ({
  enteredItemId: itemId,
  selectedUids: [],
});
export const exitItem = (): EnterState => NOT_ENTERED;

/** Đổi vùng chọn phần tử; không vào item thì giữ nguyên. */
export const selectUids = (s: EnterState, uids: readonly string[]): EnterState =>
  s.enteredItemId === null ? s : { ...s, selectedUids: [...uids] };

/** Phím khi đang vào: Esc thoát item. */
export function onSelectKey(s: EnterState, key: string): EnterState {
  return s.enteredItemId !== null && key === 'Escape' ? NOT_ENTERED : s;
}

/** Vùng chọn của canvas đổi: item đang vào không còn được chọn thì thoát (nhấp ngoài item). */
export function syncEnter(s: EnterState, itemSelection: readonly string[]): EnterState {
  return s.enteredItemId !== null && !itemSelection.includes(s.enteredItemId) ? NOT_ENTERED : s;
}

/** Đường dẫn thanh trạng thái "Màn hình › Item › Phần tử" (tên do giao diện truyền; vắng thì bỏ đoạn). */
export function breadcrumb(parts: { screen: string; item?: string; element?: string }): string[] {
  return [parts.screen, parts.item, parts.element].filter((x): x is string => !!x);
}
