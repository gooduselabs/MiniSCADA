// Thanh ghi <-> số (contract modbus-driver §6). Kiểu 16 bit luôn lớn trước; thứ tự byte chỉ áp cho 32/64 bit.
import type { ByteOrder, NumericType } from './types.ts';

export const WORDS: Readonly<Record<NumericType, number>> = {
  INT16: 1,
  UINT16: 1,
  INT32: 2,
  UINT32: 2,
  FLOAT32: 2,
  INT64: 4,
  UINT64: 4,
  FLOAT64: 4,
};

export type NumericValue = number | bigint;

/** Thanh ghi (theo thứ tự đọc) thành dãy byte lớn trước. */
function toBigEndian(regs: readonly number[], order: ByteOrder): Uint8Array {
  let words = regs.map((r) => [(r >> 8) & 0xff, r & 0xff] as [number, number]);
  if (words.length > 1) {
    if (order === 'BADC' || order === 'DCBA') words = words.map(([a, b]) => [b, a]);
    if (order === 'CDAB' || order === 'DCBA') words = [...words].reverse();
  }
  return Uint8Array.from(words.flat());
}

/** Dãy byte lớn trước thành thanh ghi theo thứ tự ghi. */
function fromBigEndian(bytes: Uint8Array, order: ByteOrder): number[] {
  let words: [number, number][] = [];
  for (let i = 0; i < bytes.length; i += 2) words.push([bytes[i]!, bytes[i + 1]!]);
  if (words.length > 1) {
    if (order === 'CDAB' || order === 'DCBA') words = [...words].reverse();
    if (order === 'BADC' || order === 'DCBA') words = words.map(([a, b]) => [b, a]);
  }
  return words.map(([a, b]) => (a << 8) | b);
}

export type DecodeResult =
  { ok: true; value: NumericValue } | { ok: false; reason: 'INVALID_VALUE' };

/** Giải mã. NaN và vô cực của FLOAT32/FLOAT64 là BAD `INVALID_VALUE`. */
export function decodeNumber(
  type: NumericType,
  order: ByteOrder,
  regs: readonly number[],
): DecodeResult {
  const bytes = toBigEndian(regs.slice(0, WORDS[type]), order);
  const dv = new DataView(bytes.buffer);
  switch (type) {
    case 'INT16':
      return { ok: true, value: dv.getInt16(0) };
    case 'UINT16':
      return { ok: true, value: dv.getUint16(0) };
    case 'INT32':
      return { ok: true, value: dv.getInt32(0) };
    case 'UINT32':
      return { ok: true, value: dv.getUint32(0) };
    case 'INT64':
      return { ok: true, value: dv.getBigInt64(0) };
    case 'UINT64':
      return { ok: true, value: dv.getBigUint64(0) };
    case 'FLOAT32': {
      const v = dv.getFloat32(0);
      return Number.isFinite(v) ? { ok: true, value: v } : { ok: false, reason: 'INVALID_VALUE' };
    }
    case 'FLOAT64': {
      const v = dv.getFloat64(0);
      return Number.isFinite(v) ? { ok: true, value: v } : { ok: false, reason: 'INVALID_VALUE' };
    }
  }
}

/** Mã hóa một giá trị thô (đã kiểm khoảng của kiểu) thành thanh ghi. */
export function encodeNumber(type: NumericType, order: ByteOrder, value: NumericValue): number[] {
  const bytes = new Uint8Array(WORDS[type] * 2);
  const dv = new DataView(bytes.buffer);
  switch (type) {
    case 'INT16':
      dv.setInt16(0, Number(value));
      break;
    case 'UINT16':
      dv.setUint16(0, Number(value));
      break;
    case 'INT32':
      dv.setInt32(0, Number(value));
      break;
    case 'UINT32':
      dv.setUint32(0, Number(value));
      break;
    case 'INT64':
      dv.setBigInt64(0, BigInt(value));
      break;
    case 'UINT64':
      dv.setBigUint64(0, BigInt(value));
      break;
    case 'FLOAT32':
      dv.setFloat32(0, Number(value));
      break;
    case 'FLOAT64':
      dv.setFloat64(0, Number(value));
      break;
  }
  return fromBigEndian(bytes, order);
}
