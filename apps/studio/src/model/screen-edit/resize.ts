// Đổi cỡ bằng 8 tay nắm, cho một item hoặc cả nhóm (feature 007, T100; R20).
// Hàm thuần trên `Rect`; kết quả là số nguyên, cỡ không âm và không dưới tối thiểu.
import { catalogWidget, type Item, type Rect } from '@mat/project-schema';
import { boundsOf } from './align.ts';

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: readonly Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export interface Size {
  width: number;
  height: number;
}
export type MinSizeOf = (item: Item) => Size;

/** Cỡ tối thiểu theo danh mục cho widget; item `svg` và loại lạ: 16 × 16. */
export const catalogMinSizeOf: MinSizeOf = (item) => {
  if (item.type === 'widget') {
    const spec = catalogWidget(item.widget);
    if (spec) return { width: spec.minSize[0], height: spec.minSize[1] };
  }
  return { width: 16, height: 16 };
};

export interface ResizeOptions {
  min: Size;
  /** Shift: giữ tỉ lệ; chỉ có hiệu lực ở tay nắm góc. */
  keepRatio?: boolean;
}

export const isCorner = (h: Handle): boolean => h.length === 2;
export const handleEdges = (h: Handle) => ({
  w: h.includes('w'),
  e: h.includes('e'),
  n: h.includes('n'),
  s: h.includes('s'),
});

/** Đổi cỡ một hình chữ nhật: chỉ cạnh đang kéo đổi, neo cạnh đối diện khi chạm tối thiểu. */
export function resizeRect(
  r: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  o: ResizeOptions,
): Rect {
  const { w: hw, e: he, n: hn, s: hs } = handleEdges(handle);
  if (o.keepRatio === true && isCorner(handle) && r.width > 0 && r.height > 0) {
    const nw = r.width + (he ? dx : -dx);
    const nh = r.height + (hs ? dy : -dy);
    const s = Math.max(nw / r.width, nh / r.height, o.min.width / r.width, o.min.height / r.height);
    const width = Math.round(r.width * s);
    const height = Math.round(r.height * s);
    return {
      x: hw ? r.x + r.width - width : r.x,
      y: hn ? r.y + r.height - height : r.y,
      width,
      height,
    };
  }
  let left = r.x;
  let right = r.x + r.width;
  let top = r.y;
  let bottom = r.y + r.height;
  if (hw) left = Math.round(left + dx);
  if (he) right = Math.round(right + dx);
  if (hn) top = Math.round(top + dy);
  if (hs) bottom = Math.round(bottom + dy);
  if (right - left < o.min.width) {
    if (hw) left = right - o.min.width;
    else right = left + o.min.width;
  }
  if (bottom - top < o.min.height) {
    if (hn) top = bottom - o.min.height;
    else bottom = top + o.min.height;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export interface GroupResizeOptions {
  /** Cỡ tối thiểu của từng item, cùng thứ tự với `rects`. */
  mins: readonly Size[];
  keepRatio?: boolean;
}

/**
 * Đổi cỡ nhóm: kéo tay nắm của hộp bao, mỗi item co giãn theo tỉ lệ hộp bao. Hộp bao không nhỏ hơn
 * mức làm item "chặt nhất" chạm cỡ tối thiểu (item đã ở tối thiểu thì nhóm không co thêm theo trục đó).
 */
export function resizeGroup(
  rects: readonly Rect[],
  handle: Handle,
  dx: number,
  dy: number,
  o: GroupResizeOptions,
): Rect[] {
  if (rects.length === 0) return [];
  const b = boundsOf(rects);
  let rw = 0;
  let rh = 0;
  rects.forEach((r, i) => {
    const m = o.mins[i] ?? { width: 0, height: 0 };
    if (r.width > 0) rw = Math.max(rw, Math.min(1, m.width / r.width));
    if (r.height > 0) rh = Math.max(rh, Math.min(1, m.height / r.height));
  });
  const min: Size = {
    width: Math.ceil(b.width * rw - 1e-9),
    height: Math.ceil(b.height * rh - 1e-9),
  };
  const nb = resizeRect(b, handle, dx, dy, { min, keepRatio: o.keepRatio === true });
  const sx = b.width > 0 ? nb.width / b.width : 1;
  const sy = b.height > 0 ? nb.height / b.height : 1;
  return rects.map((r, i) => {
    const m = o.mins[i] ?? { width: 0, height: 0 };
    const x0 = Math.round(nb.x + (r.x - b.x) * sx);
    const x1 = Math.round(nb.x + (r.x + r.width - b.x) * sx);
    const y0 = Math.round(nb.y + (r.y - b.y) * sy);
    const y1 = Math.round(nb.y + (r.y + r.height - b.y) * sy);
    return {
      x: x0,
      y: y0,
      width: Math.max(x1 - x0, Math.min(r.width, m.width)),
      height: Math.max(y1 - y0, Math.min(r.height, m.height)),
    };
  });
}
