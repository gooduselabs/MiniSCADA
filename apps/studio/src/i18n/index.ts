// Lấy chuỗi giao diện (feature 004, FR-014, research R13): t('khóa', { tham số }). Chuỗi nằm trong
// vi.ts. Khóa hay tham số thiếu: khi test, chạy dev hoặc build e2e thì ném lỗi để bắt sớm; bản phát
// hành trả về khóa (hoặc giữ nguyên {tên}) để giao diện không vỡ.
import { viMessages } from './vi.ts';

export type MessageKey = keyof typeof viMessages;
/** Bộ chuỗi của một ngôn ngữ: đủ mọi khóa của vi.ts. */
export type Messages = Readonly<Record<MessageKey, string>>;
export type Params = Readonly<Record<string, string | number>>;

const messages: Messages = viMessages;

const env = (import.meta as ImportMeta & { env?: { MODE?: string; DEV?: boolean } }).env;
let strict = env?.DEV === true || env?.MODE === 'test' || env?.MODE === 'e2e';

/** Bật/tắt chế độ ném lỗi khi thiếu khóa (để test hành vi của bản phát hành). Trả giá trị cũ. */
export function setStrictKeys(on: boolean): boolean {
  const old = strict;
  strict = on;
  return old;
}

export const hasKey = (key: string): key is MessageKey =>
  Object.prototype.hasOwnProperty.call(messages, key);

export function t(key: MessageKey, params?: Params): string {
  if (!hasKey(key)) {
    if (strict) throw new Error(`i18n: không có khóa '${key}'`);
    return key;
  }
  return messages[key].replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params?.[name];
    if (v !== undefined) return String(v);
    if (strict) throw new Error(`i18n: khóa '${key}' thiếu tham số '${name}'`);
    return whole;
  });
}

/**
 * Dạng để so khớp không dấu, không phân biệt hoa thường (bảng lệnh, lọc Tag): bỏ dấu tiếng Việt,
 * đ → d, chữ thường. "Mở Bảng Tag" → "mo bang tag".
 */
export function fold(s: string): string {
  // NFD tách dấu thành ký tự dấu kết hợp (\p{M}) rồi bỏ; đ/Đ không tách nên đổi riêng.
  return s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
}
