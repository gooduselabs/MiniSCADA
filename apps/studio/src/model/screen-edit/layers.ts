// Thứ tự lớp: phần tử cuối mảng `items` nằm trên cùng (feature 007, T101).

export type ReorderOp = 'front' | 'back' | 'forward' | 'backward' | { toIndex: number };

/**
 * Đổi thứ tự `items` cho các id được chọn, giữ tương quan thứ tự giữa chúng. Không đổi gì thì trả
 * đúng mảng đầu vào (để bên gọi bỏ qua bước hoàn tác rỗng).
 */
export function reorderItems<T extends { id: string }>(
  items: readonly T[],
  ids: readonly string[],
  op: ReorderOp,
): readonly T[] {
  const chosen = new Set(ids);
  const sel = items.map((it) => chosen.has(it.id));
  if (!sel.some(Boolean)) return items;
  let next: T[];
  if (typeof op === 'object') {
    const rest = items.filter((_, i) => !sel[i]);
    const block = items.filter((_, i) => sel[i]);
    const at = Math.min(rest.length, Math.max(0, Math.trunc(op.toIndex)));
    next = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  } else if (op === 'front' || op === 'back') {
    const rest = items.filter((_, i) => !sel[i]);
    const block = items.filter((_, i) => sel[i]);
    next = op === 'front' ? [...rest, ...block] : [...block, ...rest];
  } else {
    next = [...items];
    const flag = [...sel];
    const swap = (i: number, j: number) => {
      [next[i], next[j]] = [next[j]!, next[i]!];
      [flag[i], flag[j]] = [flag[j]!, flag[i]!];
    };
    if (op === 'forward') {
      for (let i = next.length - 2; i >= 0; i--) if (flag[i] && !flag[i + 1]) swap(i, i + 1);
    } else {
      for (let i = 1; i < next.length; i++) if (flag[i] && !flag[i - 1]) swap(i, i - 1);
    }
  }
  return next.every((it, i) => it === items[i]) ? items : next;
}
