// Từ khóa tên phần tử cho Gợi ý (feature 008, contract studio-svg-editor §6). Dữ liệu, so khớp không phân biệt hoa thường
// và dấu (model/svg-suggest.ts gọi `fold`). Nằm ở i18n vì chứa chữ tiếng Việt có dấu.
export const SUGGEST_KEYWORDS = {
  level: ['liquid', 'water', 'level', 'nước', 'mức', 'chất lỏng'],
  spin: ['rotor', 'impeller', 'fan', 'blade', 'cánh', 'quạt', 'trục'],
  alarm: ['alarm', 'warn', 'cảnh báo', 'báo động'],
} as const;
export type KeywordGroup = keyof typeof SUGGEST_KEYWORDS;
