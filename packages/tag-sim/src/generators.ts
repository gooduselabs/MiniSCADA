// Bộ sinh mô phỏng (contract value-tables-simulation §2): thời gian t là số nguyên ms UTC, T = periodMs.
import { hashU } from './hash.ts';
import { sinTurns } from './sin-turns.ts';

export type TagDataType =
  | 'BOOL'
  | 'INT16'
  | 'UINT16'
  | 'INT32'
  | 'UINT32'
  | 'INT64'
  | 'UINT64'
  | 'FLOAT32'
  | 'FLOAT64'
  | 'STRING';

export type SimKind = 'const' | 'ramp' | 'sine' | 'random' | 'square' | 'manual' | 'legacy';

export interface SimConfig {
  kind: SimKind;
  value?: number | boolean | string;
  from?: number;
  to?: number;
  center?: number;
  amplitude?: number;
  periodMs?: number;
  phase?: number;
  min?: number;
  max?: number;
  seed?: number;
  duty?: number;
  initial?: number | boolean | string;
  signal?: string;
}

/** Giá trị của Tag: số nguyên 64 bit là bigint, các số khác là number. */
export type SimValue = number | boolean | string | bigint;

const INT_RANGE: Readonly<Record<string, readonly [bigint, bigint]>> = {
  INT16: [-(2n ** 15n), 2n ** 15n - 1n],
  UINT16: [0n, 2n ** 16n - 1n],
  INT32: [-(2n ** 31n), 2n ** 31n - 1n],
  UINT32: [0n, 2n ** 32n - 1n],
  INT64: [-(2n ** 63n), 2n ** 63n - 1n],
  UINT64: [0n, 2n ** 64n - 1n],
};

/** Nửa ra xa số 0 (cùng hàm round của biểu thức). */
function roundHalfAway(x: number): number {
  const r = Math.trunc(x);
  return Math.abs(x - r) >= 0.5 ? r + (x > 0 ? 1 : -1) : r;
}

/** Đổi về kiểu Tag: số nguyên thì round rồi kẹp vào khoảng của kiểu; FLOAT32 thì làm tròn 32 bit. */
export function toTagType(v: number | boolean | string, type: TagDataType): SimValue {
  if (type === 'BOOL' || type === 'STRING') return v;
  const x = typeof v === 'boolean' ? (v ? 1 : 0) : (v as number);
  if (type === 'FLOAT64') return x === 0 ? 0 : x;
  if (type === 'FLOAT32') {
    const f = Math.fround(x);
    return f === 0 ? 0 : f;
  }
  const [lo, hi] = INT_RANGE[type]!;
  let b = BigInt(roundHalfAway(x));
  if (b < lo) b = lo;
  if (b > hi) b = hi;
  return type === 'INT64' || type === 'UINT64' ? b : Number(b);
}

/**
 * Giá trị của bộ sinh tại thời điểm `t` (ms UTC, số nguyên >= 0, < 2^53).
 * `manual`: `lastWrite` là giá trị của lệnh ghi cuối (vắng thì `initial`). `legacy` không thuộc hàm này.
 */
export function simValue(
  sim: SimConfig,
  t: number,
  type: TagDataType,
  lastWrite?: number | boolean | string,
): SimValue {
  return toTagType(rawValue(sim, t, type, lastWrite), type);
}

function rawValue(
  sim: SimConfig,
  t: number,
  type: TagDataType,
  lastWrite?: number | boolean | string,
): number | boolean | string {
  switch (sim.kind) {
    case 'const':
      return sim.value!;
    case 'manual':
      return lastWrite ?? sim.initial!;
    case 'legacy':
      throw new Error('legacy is handled by legacy-mock');
    default:
      break;
  }
  const T = sim.periodMs!;
  const m = t % T; // chính xác với số nguyên < 2^53
  const k = (t - m) / T; // chia hết nên chính xác
  switch (sim.kind) {
    case 'ramp': {
      const p = m / T;
      return sim.from! + (sim.to! - sim.from!) * p;
    }
    case 'sine': {
      let f = m / T + (sim.phase ?? 0);
      if (f >= 1) f = f - 1;
      return sim.center! + sim.amplitude! * sinTurns(f);
    }
    case 'random': {
      const u = hashU(sim.seed ?? 1, k);
      return type === 'BOOL' ? u >= 0.5 : sim.min! + (sim.max! - sim.min!) * u;
    }
    case 'square': {
      const on = m < (sim.duty ?? 0.5) * T;
      return type === 'BOOL' ? on : on ? 1 : 0;
    }
  }
  throw new Error(`unknown sim kind ${String(sim.kind)}`);
}
