// Từ được chấp nhận khi gõ giá trị BOOL (không phân biệt hoa thường, có hoặc không dấu). Chuỗi tiếng Việt chỉ ở thư mục i18n.
export const TRUE_WORDS: readonly string[] = ['true', '1', 'có', 'co'];
export const FALSE_WORDS: readonly string[] = ['false', '0', 'không', 'khong'];
/** Từ nhập cho ô Bật/Tắt của lưới Lưu trữ (feature 010): thêm "bật", "tắt" và "x", "yes", "no". */
export const ON_WORDS: readonly string[] = [...TRUE_WORDS, "bật", "bat", "x", "yes"];
export const OFF_WORDS: readonly string[] = [...FALSE_WORDS, "tắt", "tat", "no"];
