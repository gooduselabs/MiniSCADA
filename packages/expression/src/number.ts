// Số học dùng chung (contract expression-language §3, §4). Không gọi Math.round: nửa ra xa số 0.
import type { TagDataType } from './types.ts';

/** round(x): nửa ra xa số 0. x - trunc(x) là chính xác với mọi số thực 64 bit. */
export function roundHalfAway(x: number): number {
  const r = Math.trunc(x);
  if (Math.abs(x - r) >= 0.5) return r + (x > 0 ? 1 : -1);
  return r;
}

/** 10^n chính xác với n <= 9. */
export const POW10: readonly number[] = [
  1, 10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000,
];

export const INT_RANGE: Readonly<Record<string, readonly [bigint, bigint]>> = {
  INT16: [-(2n ** 15n), 2n ** 15n - 1n],
  UINT16: [0n, 2n ** 16n - 1n],
  INT32: [-(2n ** 31n), 2n ** 31n - 1n],
  UINT32: [0n, 2n ** 32n - 1n],
  INT64: [-(2n ** 63n), 2n ** 63n - 1n],
  UINT64: [0n, 2n ** 64n - 1n],
};

export type Assigned =
  { ok: true; value: number | boolean | string | bigint } | { ok: false; reason: string };

/** Đổi kết quả của biểu thức về kiểu của Tag (bảng "Gán kết quả vào Tag", contract §3). */
export function assignToTarget(target: TagDataType, v: number | boolean | string): Assigned {
  if (target === 'BOOL') return { ok: true, value: v as boolean };
  if (target === 'STRING') {
    const s = v as string;
    if (utf8Length(s) > 1024) return { ok: false, reason: 'OUT_OF_RANGE' };
    return { ok: true, value: s };
  }
  const x = typeof v === 'boolean' ? (v ? 1 : 0) : (v as number);
  if (Number.isNaN(x)) return { ok: false, reason: 'NOT_A_NUMBER' };
  if (x === Infinity || x === -Infinity) return { ok: false, reason: 'OVERFLOW' };
  if (target === 'FLOAT64') return { ok: true, value: x === 0 ? 0 : x };
  if (target === 'FLOAT32') {
    const f = Math.fround(x);
    if (!Number.isFinite(f)) return { ok: false, reason: 'OVERFLOW' };
    return { ok: true, value: f === 0 ? 0 : f };
  }
  const b = BigInt(roundHalfAway(x));
  const [lo, hi] = INT_RANGE[target]!;
  if (b < lo || b > hi) return { ok: false, reason: 'OUT_OF_RANGE' };
  return { ok: true, value: target === 'INT64' || target === 'UINT64' ? b : Number(b) };
}

export function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}
