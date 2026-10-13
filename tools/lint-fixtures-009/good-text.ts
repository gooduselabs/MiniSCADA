// Mẫu hợp lệ: chú thích tiếng Việt được phép; chuỗi không dấu hoặc lấy từ bảng i18n.
export const key = 'alarm.state.activeUnack';
export const css = 'alarm-row';
export function label(t: (k: string) => string): string {
  return t(key) + ' ' + css;
}
