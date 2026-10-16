// Giới hạn của trình vẽ SVG (contracts/svg-editor.md §2, §3; Constitution V): cùng số với bộ nhập của feature 008.

/** Kích thước tối đa của văn bản SVG (mở, dán, lưu), byte UTF-8. */
export const SVG_MAX_BYTES = 5 * 1024 * 1024;
/** Số phần tử tối đa của tài liệu (kể cả gốc; nút chữ và chú thích không tính). */
export const SVG_MAX_NODES = 20_000;
/** Độ sâu tối đa (gốc là 1). */
export const SVG_MAX_DEPTH = 32;
/** Số bước hoàn tác (FR-098). */
export const SVG_UNDO_DEPTH = 100;
/** Tổng số nút mà ngăn xếp hoàn tác được giữ trong các cây con đã xóa (research R26). */
export const SVG_UNDO_NODE_BUDGET = 20_000;
/** Gõ chữ liên tiếp trong khoảng này (ms) gộp thành một bước. */
export const SVG_TEXT_MERGE_MS = 1500;
/** Độ dài tối đa nội dung chữ của một phần tử (`title`: 200), như bộ lọc của trang. */
export const SVG_MAX_TEXT = 4096;
export const SVG_MAX_TITLE = 200;

/** Số byte UTF-8 của chuỗi (không cấp phát). */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}
