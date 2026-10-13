// Căn chỉnh, phân bố đều, cùng cỡ trên các hình chữ nhật (feature 007, T099; R20).
// Hàm thuần: nhận và trả danh sách `Rect` theo cùng thứ tự; mọi kết quả là số nguyên.
import type { Rect } from '@mat/project-schema';

export type AlignKind = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom';
export type DistributeAxis = 'x' | 'y';
export type MatchAxis = 'width' | 'height';

/** Hộp bao nhỏ nhất của các hình chữ nhật (danh sách không rỗng). */
export function boundsOf(rects: readonly Rect[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Căn theo hộp bao của vùng chọn; chỉ đổi một trục, giữ cỡ. */
export function alignRects(rects: readonly Rect[], kind: AlignKind): Rect[] {
  if (rects.length === 0) return [];
  const b = boundsOf(rects);
  return rects.map((r) => {
    switch (kind) {
      case 'left':
        return { ...r, x: b.x };
      case 'right':
        return { ...r, x: b.x + b.width - r.width };
      case 'hcenter':
        return { ...r, x: b.x + Math.round((b.width - r.width) / 2) };
      case 'top':
        return { ...r, y: b.y };
      case 'bottom':
        return { ...r, y: b.y + b.height - r.height };
      case 'vmiddle':
        return { ...r, y: b.y + Math.round((b.height - r.height) / 2) };
    }
  });
}

/**
 * Phân bố đều (≥ 3 item): giữ hai item ngoài cùng theo vị trí, chia đều khoảng trống giữa các cạnh;
 * phần dư dồn vào khoảng cuối. Kết quả theo thứ tự đầu vào.
 */
export function distributeRects(rects: readonly Rect[], axis: DistributeAxis): Rect[] {
  const out = rects.map((r) => ({ ...r }));
  const n = rects.length;
  if (n < 3) return out;
  const pos = axis === 'x' ? 'x' : 'y';
  const len = axis === 'x' ? 'width' : 'height';
  const order = rects.map((_, i) => i).sort((i, j) => rects[i]![pos] - rects[j]![pos] || i - j);
  const first = rects[order[0]!]!;
  const last = rects[order[n - 1]!]!;
  const sum = rects.reduce((s, r) => s + r[len], 0);
  const free = last[pos] + last[len] - first[pos] - sum;
  const gap = Math.floor(free / (n - 1));
  let cursor = first[pos] + first[len];
  for (let k = 1; k < n - 1; k++) {
    const i = order[k]!;
    out[i]![pos] = cursor + gap;
    cursor = cursor + gap + rects[i]![len];
  }
  return out;
}

/** Cùng rộng/cao theo item chính (`main` = chỉ số trong danh sách, mặc định item đầu). */
export function matchRects(rects: readonly Rect[], axis: MatchAxis, main = 0): Rect[] {
  const ref = rects[main] ?? rects[0];
  return rects.map((r) => (ref ? { ...r, [axis]: ref[axis] } : { ...r }));
}
