// Giờ địa phương theo múi cố định của nhóm, số vi-VN, nhãn trục, chọn nguồn và con trỏ cho biểu đồ lịch sử
// (specs/010-history-reports/contracts/widget-catalog-010.md §5, history-api.md §3.1). Không dùng múi giờ hay
// bộ định dạng của trình duyệt: mọi phép tính là số học trên epoch ms.
import { DAY_MS, HOUR_MS, MINUTE_MS } from './agg.ts';

/** `±HH:MM` -> mili giây (±12:00..+14:00 theo schema; chấp nhận mọi giờ 00-23 và phút 00-59). */
export function parseUtcOffset(tz: string): number {
  const m = /^([+-])([01]\d|2[0-3]):([0-5]\d)$/.exec(tz);
  if (!m) throw new Error(`múi giờ sai: '${tz}'`);
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * HOUR_MS + Number(m[3]) * MINUTE_MS);
}

const toMs = (tz: string | number) => (typeof tz === 'number' ? tz : parseUtcOffset(tz));

/** Số ngày kể từ 1970-01-01 -> [năm, tháng, ngày] (thuật toán Howard Hinnant). */
function civilFromDays(z0: number): [number, number, number] {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

/** [năm, tháng, ngày] -> số ngày kể từ 1970-01-01. */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Nửa đêm địa phương của ngày (y, m, d) theo độ lệch `tzMs`, tính bằng UTC ms. */
export const localMidnight = (y: number, m: number, d: number, tzMs: number): number =>
  daysFromCivil(y, m, d) * DAY_MS - tzMs;

export interface LocalParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
  ms: number;
}

/** Thời điểm UTC ms -> thành phần lịch theo giờ địa phương. */
export function localParts(ts: number, tz: string | number): LocalParts {
  const t = ts + toMs(tz);
  const days = Math.floor(t / DAY_MS);
  const rem = t - days * DAY_MS;
  const [y, m, d] = civilFromDays(days);
  return {
    y,
    m,
    d,
    hh: Math.floor(rem / HOUR_MS),
    mm: Math.floor((rem % HOUR_MS) / MINUTE_MS),
    ss: Math.floor((rem % MINUTE_MS) / 1000),
    ms: rem % 1000,
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');

export type LocalFormat = 'ms' | 'sec' | 'min' | 'date' | 'time' | 'hm' | 'dm';

/** Định dạng giờ địa phương: `ms` yyyy-MM-dd HH:mm:ss.SSS; `sec`, `min` bỏ bớt; `date` dd/MM/yyyy; `time` HH:mm:ss; `hm`; `dm` dd/MM. */
export function formatLocal(ts: number, tz: string | number, kind: LocalFormat = 'sec'): string {
  const p = localParts(ts, tz);
  const date = `${String(p.y).padStart(4, '0')}-${p2(p.m)}-${p2(p.d)}`;
  switch (kind) {
    case 'ms':
      return `${date} ${p2(p.hh)}:${p2(p.mm)}:${p2(p.ss)}.${String(p.ms).padStart(3, '0')}`;
    case 'sec':
      return `${date} ${p2(p.hh)}:${p2(p.mm)}:${p2(p.ss)}`;
    case 'min':
      return `${date} ${p2(p.hh)}:${p2(p.mm)}`;
    case 'date':
      return `${p2(p.d)}/${p2(p.m)}/${p.y}`;
    case 'time':
      return `${p2(p.hh)}:${p2(p.mm)}:${p2(p.ss)}`;
    case 'hm':
      return `${p2(p.hh)}:${p2(p.mm)}`;
    case 'dm':
      return `${p2(p.d)}/${p2(p.m)}`;
  }
}

/** Số dạng vi-VN: nghìn `.`, thập phân `,`; làm tròn nửa ra xa số 0; null hoặc không hữu hạn: chuỗi rỗng. */
export function formatNumber(v: number | null, decimals: number): string {
  if (v === null || !Number.isFinite(v)) return '';
  const abs = Math.abs(v);
  let scaled = Math.round(abs * 10 ** decimals + 1e-9);
  let digits: string;
  if (scaled <= Number.MAX_SAFE_INTEGER) {
    digits = String(scaled).padStart(decimals + 1, '0');
  } else if (abs < 1e21) {
    // abs·10^d vượt 2^53: số học nhân không còn đúng từng chữ số; toFixed lấy đúng khai triển thập phân của double.
    digits = abs.toFixed(decimals).replace('.', '');
  } else {
    // abs >= 1e21 là số nguyên: BigInt cho đủ chữ số (String(1e21) sẽ ra dạng mũ).
    digits = BigInt(abs).toString() + '0'.repeat(decimals);
  }
  if (scaled > Number.MAX_SAFE_INTEGER) scaled = Number.POSITIVE_INFINITY; // khác 0, chỉ dùng cho dấu âm
  const int = digits.slice(0, digits.length - decimals).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const frac = decimals > 0 ? `,${digits.slice(digits.length - decimals)}` : '';
  return `${v < 0 && scaled !== 0 ? '-' : ''}${int}${frac}`;
}

// ---- Nhãn trục thời gian ----

const STEPS_MS = [
  1000,
  2000,
  5000,
  10000,
  15000,
  30000,
  60000,
  120000,
  300000,
  600000,
  900000,
  1800000,
  HOUR_MS,
  2 * HOUR_MS,
  3 * HOUR_MS,
  6 * HOUR_MS,
  12 * HOUR_MS,
  DAY_MS,
  2 * DAY_MS,
  7 * DAY_MS,
  14 * DAY_MS,
  30 * DAY_MS,
  90 * DAY_MS,
  180 * DAY_MS,
  365 * DAY_MS,
];

export interface AxisTick {
  t: number;
  label: string;
}

/**
 * Nhãn trục cho `[from, to)`: bước nhỏ nhất trong bảng cho không quá `maxTicks` nhãn, nhãn rơi đúng biên bước theo
 * giờ địa phương của nhóm (bước từ một ngày trở lên: nửa đêm địa phương). Nhãn: `HH:mm:ss` (< 1 phút), `HH:mm`
 * (< 1 ngày), `dd/MM` (< 90 ngày), `MM/yyyy`.
 */
export function axisTicks(
  from: number,
  to: number,
  tz: string | number,
  maxTicks: number,
): AxisTick[] {
  if (!(to > from) || maxTicks < 1) return [];
  const off = toMs(tz);
  const step = STEPS_MS.find((s) => Math.ceil((to - from) / s) <= maxTicks) ?? STEPS_MS.at(-1)!;
  const out: AxisTick[] = [];
  for (let t = Math.ceil((from + off) / step) * step - off; t < to; t += step) {
    const label =
      step < MINUTE_MS
        ? formatLocal(t, off, 'time')
        : step < DAY_MS
          ? formatLocal(t, off, 'hm')
          : step < 90 * DAY_MS
            ? formatLocal(t, off, 'dm')
            : `${p2(localParts(t, off).m)}/${localParts(t, off).y}`;
    out.push({ t, label });
  }
  return out.slice(0, maxTicks);
}

// ---- Chọn nguồn (history-api.md §3.1), để xem trước khớp bản C++ ----

export interface SourceQuery {
  from: number;
  to: number;
  maxPoints: number;
  res: 'auto' | 'raw' | '1m' | '1h';
  reduce: 'minmax' | 'lttb' | 'decimate';
  /** Phạm vi dữ liệu của nhóm (`catalog`); null khi nhóm không bật tổng hợp. */
  aggregates: {
    minute: { from: number; to: number } | null;
    hour: { from: number; to: number } | null;
  } | null;
  /** Số dòng thô ước tính của khoảng (`seqMax - seqMin + 1`), byte một dòng, giới hạn quét. */
  rowsInRange: number;
  rowBytes: number;
  scanLimitBytes: number;
}

export type SourceChoice =
  | {
      ok: true;
      res: 'raw' | '1m' | '1h';
      reduce: 'merge' | 'minmax' | 'lttb' | 'decimate';
      approximate: boolean;
    }
  | { ok: false; error: 'NO_AGGREGATES' | 'SCAN_LIMIT' };

const covers = (r: { from: number; to: number } | null | undefined, from: number, to: number) =>
  r != null && Math.max(0, Math.min(r.to, to) - Math.max(r.from, from)) >= 0.5 * (to - from);

export function chooseSource(q: SourceQuery): SourceChoice {
  const agg = q.aggregates;
  const tooBig = q.rowsInRange * (q.rowBytes + 16) > q.scanLimitBytes;
  if (q.res === '1m' || q.res === '1h')
    return agg === null
      ? { ok: false, error: 'NO_AGGREGATES' }
      : { ok: true, res: q.res, reduce: 'merge', approximate: false };
  if (q.res === 'raw')
    return tooBig
      ? { ok: false, error: 'SCAN_LIMIT' }
      : { ok: true, res: 'raw', reduce: q.reduce, approximate: q.reduce === 'decimate' };
  const w = (q.to - q.from) / (q.maxPoints / 2);
  if (agg) {
    if (w >= HOUR_MS && covers(agg.hour, q.from, q.to))
      return { ok: true, res: '1h', reduce: 'merge', approximate: false };
    if (w >= MINUTE_MS && covers(agg.minute, q.from, q.to))
      return { ok: true, res: '1m', reduce: 'merge', approximate: false };
  }
  if (!tooBig)
    return { ok: true, res: 'raw', reduce: q.reduce, approximate: q.reduce === 'decimate' };
  if (agg?.minute) return { ok: true, res: '1m', reduce: 'merge', approximate: false };
  if (agg?.hour) return { ok: true, res: '1h', reduce: 'merge', approximate: false };
  return { ok: true, res: 'raw', reduce: 'decimate', approximate: true };
}

// ---- Con trỏ ----

/** Chỉ số điểm có `t` gần `x` nhất (hòa thì điểm trước); -1 khi rỗng. `ts` tăng dần. */
export function nearestPoint(ts: ArrayLike<number>, x: number): number {
  const n = ts.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && x - ts[lo - 1]! <= ts[lo]! - x ? lo - 1 : lo;
}
