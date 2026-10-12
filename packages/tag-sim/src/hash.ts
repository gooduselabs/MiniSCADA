// U(seed, k) trong [0, 1): hàm băm theo bộ đếm (contract value-tables-simulation §2.2).
// mix là "lowbias32" (Chris Wellons, public domain).

function mix(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** `k` là số nguyên không âm < 2^53; `seed` là u32. */
export function hashU(seed: number, k: number): number {
  const kLo = k >>> 0; // ToUint32: phần dư theo 2^32, chính xác với số nguyên < 2^53
  const kHi = Math.floor(k / 4294967296) >>> 0;
  let h = mix((seed ^ 0x9e3779b9) >>> 0);
  h = mix((h ^ kLo) >>> 0);
  h = mix((h ^ kHi) >>> 0);
  return (h >>> 8) / 16777216; // 24 bit, chính xác
}

/** FNV-1a 32 bit của chuỗi UTF-8 (hạt giống mặc định theo id Tag, contract §2.3). */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
