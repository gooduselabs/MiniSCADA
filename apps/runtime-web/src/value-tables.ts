// Bảng giá trị của trang xem (feature 006 T179; project-format-0.2 §8, §11): lấy `valueTables` của
// GET /api/v1/projects/active (chỉ bảng binding dùng tới) và bảng của từng Tag, để DomApplier tra bằng
// `@mat/expression` như xem trước của Studio.
import type { ValueTable } from '@mat/expression';

/** Phần của thân `projects/active` mà trang cần cho bảng giá trị. */
export interface ActiveTables {
  tags: { tags: ReadonlyArray<{ id: string; valueTable?: string }> };
  valueTables?: Record<string, ValueTable> | null;
}

/** `valueTables` của thân; rỗng với project 0.1 hay khi binding không dùng bảng nào. */
export function valueTablesOf(active: ActiveTables): Record<string, ValueTable> {
  return active.valueTables ?? {};
}

/** Tag có bảng → tên bảng (`valueTable` trong tags.json). */
export function tagValueTables(active: ActiveTables): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of active.tags.tags) if (t.valueTable) out[t.id] = t.valueTable;
  return out;
}
