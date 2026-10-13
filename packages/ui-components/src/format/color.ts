// Màu do project đặt đi vào thuộc tính style: chỉ nhận #RGB/#RRGGBB (không chuỗi tùy ý).
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function safeColor(v: unknown): string | undefined {
  return typeof v === 'string' && COLOR_RE.test(v) ? v : undefined;
}
