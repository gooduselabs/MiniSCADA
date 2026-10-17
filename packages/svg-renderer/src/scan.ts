/**
 * Ký tự định dạng vô hình đánh lừa hiển thị tên ("Trojan Source", F13 của rà soát 008): rộng 0 và dấu hướng
 * U+200B-200F, nhúng/đè hướng U+202A-202E, cô lập hướng U+2066-2069; thêm (T202) dấu hướng Ả Rập U+061C, nối từ và toán
 * tử vô hình U+2060-2064, định dạng cũ U+206A-206F, BOM/ZWNBSP U+FEFF, tách nguyên âm Mông Cổ U+180E, CGJ U+034F và
 * chữ lấp Hangul U+115F, U+1160, U+3164, U+FFA0 (hiển thị trống).
 */
export function isBidiOrInvisible(c: number): boolean {
  return (
    (c >= 0x200b && c <= 0x200f) ||
    (c >= 0x202a && c <= 0x202e) ||
    (c >= 0x2060 && c <= 0x2064) ||
    (c >= 0x2066 && c <= 0x206f) ||
    c === 0x034f ||
    c === 0x061c ||
    c === 0x115f ||
    c === 0x1160 ||
    c === 0x180e ||
    c === 0x3164 ||
    c === 0xfeff ||
    c === 0xffa0
  );
}
// Bộ quét ký tự dùng chung cho các hàm kiểm giá trị (css-value.ts) và bộ phân tích transform.
// Không dùng biểu thức chính quy (FR-013): quyết định giữ/bỏ chỉ bằng so sánh mã ký tự.

/** Giới hạn độ lớn của một số trong thuộc tính SVG (contract svg-import §3). */
export const MAX_ABS_NUMBER = 1e9;

export function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

export function isAsciiLetter(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

export function isWs(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
}

export function isHexDigit(c: number): boolean {
  return isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}

/** Ký tự điều khiển C0, DEL và C1 (không hợp lệ trong tên và chữ hiển thị). */
export function isControl(c: number): boolean {
  return c < 32 || (c >= 127 && c <= 159);
}

export function skipWs(s: string, i: number): number {
  while (i < s.length && isWs(s.charCodeAt(i))) i++;
  return i;
}

/** Bỏ khoảng trắng và tối đa một dấu phẩy (phân cách danh sách số). */
export function skipSeparator(s: string, i: number): number {
  i = skipWs(s, i);
  if (s.charCodeAt(i) === 44) i = skipWs(s, i + 1);
  return i;
}

export interface ScannedNumber {
  value: number;
  /** Chỉ số ký tự ngay sau số. */
  end: number;
}

/**
 * Quét một số thập phân (dấu tùy chọn, phần thập phân, mũ) bắt đầu tại `i`.
 * Trả null khi không có số, số vô hạn hoặc |x| > 1e9. Không nhận hex, `NaN`, `Infinity`.
 * Chữ `e` chỉ thành phần mũ khi theo sau là chữ số (nên `1em` là số 1 kèm đơn vị `em`).
 */
export function scanNumber(s: string, i: number): ScannedNumber | null {
  let j = i;
  let c = s.charCodeAt(j);
  if (c === 43 || c === 45) j++;
  let digits = 0;
  while (isDigit(s.charCodeAt(j))) {
    j++;
    digits++;
  }
  if (s.charCodeAt(j) === 46) {
    j++;
    while (isDigit(s.charCodeAt(j))) {
      j++;
      digits++;
    }
  }
  if (digits === 0) return null;
  c = s.charCodeAt(j);
  if (c === 101 || c === 69) {
    let k = j + 1;
    const sign = s.charCodeAt(k);
    if (sign === 43 || sign === 45) k++;
    let expDigits = 0;
    while (isDigit(s.charCodeAt(k))) {
      k++;
      expDigits++;
    }
    if (expDigits > 0) j = k;
  }
  const value = Number(s.slice(i, j));
  if (!Number.isFinite(value) || Math.abs(value) > MAX_ABS_NUMBER) return null;
  return { value, end: j };
}

/**
 * Quét danh sách số cách nhau bằng khoảng trắng và/hoặc một dấu phẩy.
 * Trả null khi có phần tử không phải số hoặc dấu phẩy thừa.
 */
export function scanNumberList(s: string): number[] | null {
  const out: number[] = [];
  let i = skipWs(s, 0);
  if (i >= s.length) return null;
  while (i < s.length) {
    const n = scanNumber(s, i);
    if (!n) return null;
    out.push(n.value);
    i = skipWs(s, n.end);
    if (i >= s.length) break;
    if (s.charCodeAt(i) === 44) {
      i = skipWs(s, i + 1);
      if (i >= s.length) return null; // dấu phẩy treo ở cuối
    }
    // số kế tiếp có thể dính liền khi bắt đầu bằng dấu hoặc '.' ("1-2"): scanNumber sẽ kiểm
  }
  return out;
}
