// Chọn theo điểm, theo khung, Tab theo thứ tự lớp (feature 007, T101; R19).
// Không dùng DOM: chỉ duyệt hình chữ nhật của item (mảng đảo: item trên cùng trước).
import type { Item, Rect } from '@mat/project-schema';

const selectable = (it: Item): boolean => it.locked !== true && it.hidden !== true;

/** Item trên cùng, không khóa, không ẩn, chứa điểm (gồm cạnh trái/trên, loại cạnh phải/dưới). */
export function hitTest(items: readonly Item[], p: { x: number; y: number }): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (!selectable(it)) continue;
    if (p.x >= it.x && p.x < it.x + it.width && p.y >= it.y && p.y < it.y + it.height) return it.id;
  }
  return null;
}

/** Id mọi item không khóa/ẩn giao (diện tích > 0) với khung, theo thứ tự lớp (dưới lên trên). */
export function itemsInRect(items: readonly Item[], rect: Rect): string[] {
  if (rect.width <= 0 || rect.height <= 0) return [];
  return items
    .filter(
      (it) =>
        selectable(it) &&
        it.x < rect.x + rect.width &&
        rect.x < it.x + it.width &&
        it.y < rect.y + rect.height &&
        rect.y < it.y + it.height,
    )
    .map((it) => it.id);
}

/**
 * Tab / Shift+Tab: item chọn được kế tiếp (hoặc trước) theo thứ tự lớp, vòng lại. Chưa chọn (hoặc id
 * lạ): Tab lấy item đầu, Shift+Tab lấy item cuối.
 */
export function nextByTab(
  items: readonly Item[],
  currentId: string | null,
  reverse: boolean,
): string | null {
  const n = items.length;
  if (n === 0) return null;
  const cur = currentId === null ? -1 : items.findIndex((it) => it.id === currentId);
  const step = reverse ? -1 : 1;
  const start = cur < 0 ? (reverse ? 0 : n - 1) : cur;
  for (let k = 1; k <= n; k++) {
    const it = items[(((start + step * k) % n) + n) % n]!;
    if (selectable(it)) return it.id;
  }
  return null;
}
