// Bit: coil/DI đóng gói, bit trong thanh ghi, mặt nạ mã 22 (contract modbus-driver §6, §8).

/** Coil/DI: bit thứ i nằm ở byte ⌊i/8⌋, bit thấp trước. */
export function unpackBits(bytes: readonly number[], count: number): number[] {
  return Array.from({ length: count }, (_, i) => ((bytes[i >> 3] ?? 0) >> (i & 7)) & 1);
}

export function packBits(bits: readonly number[]): number[] {
  const out = new Array<number>(Math.ceil(bits.length / 8)).fill(0);
  bits.forEach((b, i) => {
    out[i >> 3]! |= (b & 1) << (i & 7);
  });
  return out;
}

/** Bit trong thanh ghi: (reg >> b) & 1. */
export function registerBit(reg: number, bit: number): boolean {
  return ((reg >> bit) & 1) === 1;
}

/** Mã 22 (ghi có mặt nạ): and = ~(1 << b), or = v << b; kết quả (reg & and) | or. */
export function maskWrite(bit: number, value: boolean): { and: number; or: number } {
  return { and: ~(1 << bit) & 0xffff, or: (value ? 1 : 0) << bit };
}

/** Đọc-sửa-ghi: giá trị mới của thanh ghi sau khi đặt bit. */
export function applyBit(reg: number, bit: number, value: boolean): number {
  const m = maskWrite(bit, value);
  return ((reg & m.and) | m.or) & 0xffff;
}
