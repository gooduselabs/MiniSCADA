// STRING trên thanh ghi (contract modbus-driver §6; quy ước chốt khi cài ở tests/codec-vectors/generate.mjs).
import type { StringByteOrder } from './types.ts';

/** Giải mã UTF-8; MỖI byte không thuộc một dãy hợp lệ thành một U+FFFD (không gộp như TextDecoder). */
function utf8DecodePerByte(bytes: readonly number[]): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i++;
      continue;
    }
    let need: number;
    let cp: number;
    let min: number;
    if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
      cp = b & 0x1f;
      min = 0x80;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      cp = b & 0x0f;
      min = 0x800;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      cp = b & 0x07;
      min = 0x10000;
    } else {
      out += '�';
      i++;
      continue;
    }
    let valid = true;
    for (let j = 1; j <= need; j++) {
      const c = bytes[i + j];
      if (c === undefined || (c & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      cp = (cp << 6) | (c & 0x3f);
    }
    if (valid && (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))) valid = false;
    if (!valid) {
      out += '�';
      i++;
      continue;
    }
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}

/** Đọc: lấy `length` byte đầu, dừng ở byte 0 đầu tiên, giải mã UTF-8. */
export function decodeString(
  length: number,
  order: StringByteOrder,
  regs: readonly number[],
): string {
  const bytes: number[] = [];
  for (const r of regs) {
    const hi = (r >> 8) & 0xff;
    const lo = r & 0xff;
    if (order === 'AB') bytes.push(hi, lo);
    else bytes.push(lo, hi);
  }
  let used = bytes.slice(0, length);
  const z = used.indexOf(0);
  if (z >= 0) used = used.slice(0, z);
  return utf8DecodePerByte(used);
}

export type EncodeStringResult =
  { ok: true; registers: number[] } | { ok: false; error: 'STRING_TOO_LONG' };

/** Ghi: UTF-8, đệm byte 0 tới `length` rồi tới số chẵn; dài hơn `length` thì lỗi. */
export function encodeString(
  length: number,
  order: StringByteOrder,
  text: string,
): EncodeStringResult {
  const bytes = [...new TextEncoder().encode(text)];
  if (bytes.length > length) return { ok: false, error: 'STRING_TOO_LONG' };
  const total = Math.ceil(length / 2) * 2;
  while (bytes.length < total) bytes.push(0);
  const registers: number[] = [];
  for (let i = 0; i < total; i += 2)
    registers.push(
      order === 'AB' ? (bytes[i]! << 8) | bytes[i + 1]! : (bytes[i + 1]! << 8) | bytes[i]!,
    );
  return { ok: true, registers };
}
