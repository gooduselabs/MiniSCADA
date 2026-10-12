// Tên Tag tự tăng số (feature 004, FR-020): Thêm Tag và điền xuống cột tên.
// TANK02.LEVEL → TANK03.LEVEL, T_09 → T_10, PUMP.RUN → PUMP.RUN_1.

/** Nhóm chữ số cuối cùng của tên (phần sau nó không còn chữ số). */
const LAST_NUMBER = /(\d+)(\D*)$/;

function bump(id: string): string {
  const m = LAST_NUMBER.exec(id);
  if (!m) return `${id}_1`;
  const digits = m[1];
  const next = (BigInt(digits) + 1n).toString().padStart(digits.length, '0');
  return id.slice(0, m.index) + next + m[2];
}

/**
 * Tên kế tiếp: tăng nhóm số cuối và giữ số chữ số; không có số thì thêm `_1`; tên trống thì `TAG_1`.
 * Trùng một tên trong `taken` (so đúng chữ hoa/thường như bộ kiểm tra) thì tăng tiếp.
 */
export function nextTagId(id: string, taken: Iterable<string> = []): string {
  const used = taken instanceof Set ? (taken as ReadonlySet<string>) : new Set(taken);
  const base = id.trim();
  let next = base === '' ? 'TAG_1' : bump(base);
  while (used.has(next)) next = bump(next);
  return next;
}
