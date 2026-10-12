// Scaling thô <-> kỹ thuật (research R6; contract modbus-driver §6). Số thực 64 bit; khoảng thô của kiểu số
// nguyên so bằng số nguyên chính xác (INT64/UINT64 không qua số thực).
import type { NumericType } from './types.ts';

export interface Scaling {
  rawMin: number;
  rawMax: number;
  engMin: number;
  engMax: number;
  clamp?: boolean;
}

const INT_RANGE: Readonly<Record<string, readonly [bigint, bigint]>> = {
  INT16: [-(2n ** 15n), 2n ** 15n - 1n],
  UINT16: [0n, 2n ** 16n - 1n],
  INT32: [-(2n ** 31n), 2n ** 31n - 1n],
  UINT32: [0n, 2n ** 32n - 1n],
  INT64: [-(2n ** 63n), 2n ** 63n - 1n],
  UINT64: [0n, 2n ** 64n - 1n],
};

function roundHalfAway(x: number): number {
  const r = Math.trunc(x);
  return Math.abs(x - r) >= 0.5 ? r + (x > 0 ? 1 : -1) : r;
}

export interface ScaleReadResult {
  value: number;
  quality: 'GOOD' | 'UNCERTAIN';
  /** `CLAMPED` khi giá trị bị kẹp theo `clamp`. */
  reason?: string;
}

/**
 * Đọc: eng = engMin + ((raw - rawMin) * (engMax - engMin)) / (rawMax - rawMin).
 * Có `clamp` và raw ngoài khoảng thô: trả đúng cận kỹ thuật tương ứng, UNCERTAIN `CLAMPED`.
 * `raw` của INT64/UINT64 có thể là bigint hoặc chuỗi thập phân.
 */
export function scaleRead(
  raw: number | bigint | string,
  sc: Scaling,
  tagType: 'FLOAT32' | 'FLOAT64',
): ScaleReadResult {
  const x = Number(raw);
  const lo = Math.min(sc.rawMin, sc.rawMax);
  const hi = Math.max(sc.rawMin, sc.rawMax);
  let eng: number;
  let clamped = false;
  if (sc.clamp && x < lo) {
    eng = sc.rawMin < sc.rawMax ? sc.engMin : sc.engMax;
    clamped = true;
  } else if (sc.clamp && x > hi) {
    eng = sc.rawMin < sc.rawMax ? sc.engMax : sc.engMin;
    clamped = true;
  } else eng = sc.engMin + ((x - sc.rawMin) * (sc.engMax - sc.engMin)) / (sc.rawMax - sc.rawMin);
  if (tagType === 'FLOAT32') eng = Math.fround(eng);
  if (eng === 0) eng = 0; // -0 thành 0
  return clamped
    ? { value: eng, quality: 'UNCERTAIN', reason: 'CLAMPED' }
    : { value: eng, quality: 'GOOD' };
}

export type ScaleWriteResult =
  { ok: true; raw: number | bigint } | { ok: false; error: 'OUT_OF_RAW_RANGE' | 'NOT_FINITE' };

/**
 * Ghi (phép ngược): raw = rawMin + ((eng - engMin) * (rawMax - rawMin)) / (engMax - engMin).
 * Kiểu thô là số nguyên: round nửa ra xa số 0 rồi so với khoảng của kiểu. Không dùng `rawMin`, `rawMax` làm
 * giới hạn: chỉ khoảng của kiểu thô (FR-011).
 */
export function scaleWrite(eng: number, sc: Scaling, rawType: NumericType): ScaleWriteResult {
  if (!Number.isFinite(eng)) return { ok: false, error: 'NOT_FINITE' };
  let x = sc.rawMin + ((eng - sc.engMin) * (sc.rawMax - sc.rawMin)) / (sc.engMax - sc.engMin);
  if (!Number.isFinite(x)) return { ok: false, error: 'OUT_OF_RAW_RANGE' };
  if (rawType === 'FLOAT32') {
    x = Math.fround(x);
    return Number.isFinite(x)
      ? { ok: true, raw: x === 0 ? 0 : x }
      : { ok: false, error: 'OUT_OF_RAW_RANGE' };
  }
  if (rawType === 'FLOAT64') return { ok: true, raw: x === 0 ? 0 : x };
  const b = BigInt(roundHalfAway(x));
  const [lo, hi] = INT_RANGE[rawType]!;
  if (b < lo || b > hi) return { ok: false, error: 'OUT_OF_RAW_RANGE' };
  return { ok: true, raw: rawType === 'INT64' || rawType === 'UINT64' ? b : Number(b) };
}
