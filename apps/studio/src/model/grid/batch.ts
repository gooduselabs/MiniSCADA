// Thao tác hàng loạt thành một sửa đổi (feature 006, data-model §13.1): thêm hàng loạt, điền, dán, nhập CSV, đổi tên
// Tag. `store.edit` ghi MỘT bước hoàn tác cho cả mảng sửa đổi; `batch` dùng khi cần gói thành một ProjectEdit.
import type { ProjectEdit } from '../project-doc.ts';

/** Trải phẳng `batch` lồng nhau. */
export function flattenEdits(edits: readonly ProjectEdit[]): ProjectEdit[] {
  const out: ProjectEdit[] = [];
  for (const e of edits) {
    if (e.kind === 'batch') out.push(...flattenEdits(e.edits));
    else out.push(e);
  }
  return out;
}

/** Không có gì: rỗng; một sửa đổi: giữ nguyên; nhiều: gộp thành một `batch`. */
export function batchOf(edits: readonly ProjectEdit[]): ProjectEdit[] {
  const flat = flattenEdits(edits);
  return flat.length > 1 ? [{ kind: 'batch', edits: flat }] : flat;
}
