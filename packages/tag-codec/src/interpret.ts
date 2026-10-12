// Bảng "cách hiểu" của Thử kết nối (R22, FR-044): giá trị thô đọc được hiểu theo từng kiểu và thứ tự byte.
import { unpackBits } from './bits.ts';
import { decodeNumber, WORDS } from './numeric.ts';
import type { ByteOrder, NumericType } from './types.ts';

export interface InterpretRow {
  type: NumericType;
  /** Không có với kiểu 16 bit. */
  byteOrder?: ByteOrder;
  value: number | bigint | null;
  /** Chữ hiển thị: số, hoặc `INVALID_VALUE` với NaN/vô cực. */
  text: string;
  invalid: boolean;
}

const ORDERS: readonly ByteOrder[] = ['ABCD', 'CDAB', 'BADC', 'DCBA'];
const SHOWN: readonly NumericType[][] = [
  ['INT16', 'UINT16'],
  ['INT32', 'UINT32', 'FLOAT32'],
  ['INT64', 'UINT64', 'FLOAT64'],
];

/**
 * 1 thanh ghi: INT16, UINT16. 2 (hoặc 3): thêm INT32, UINT32, FLOAT32 x 4 thứ tự. 4 trở lên: thêm
 * INT64, UINT64, FLOAT64 x 4 thứ tự. Kiểu 16 bit hiểu thanh ghi đầu.
 */
export function interpretRegisters(regs: readonly number[]): InterpretRow[] {
  const rows: InterpretRow[] = [];
  for (const group of SHOWN) {
    for (const type of group) {
      const w = WORDS[type];
      if (regs.length < w) continue;
      for (const order of w === 1 ? [undefined] : ORDERS) {
        const r = decodeNumber(type, order ?? 'ABCD', regs.slice(0, w));
        const row: InterpretRow = r.ok
          ? { type, value: r.value, text: String(r.value), invalid: false }
          : { type, value: null, text: r.reason, invalid: true };
        if (order !== undefined) row.byteOrder = order;
        rows.push(row);
      }
    }
  }
  return rows;
}

export interface BitRow {
  index: number;
  value: boolean;
}

/** Coil/DI: các bit đọc được, theo chỉ số trong yêu cầu. */
export function interpretBits(bytes: readonly number[], count: number): BitRow[] {
  return unpackBits(bytes, count).map((v, index) => ({ index, value: v === 1 }));
}
