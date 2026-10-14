// Kỳ của widget lịch sử và mô hình biểu đồ cột, tròn (specs/010-history-reports/contracts/widget-catalog-010.md §2.2).
// Cùng hàm tính (`evalFn`) như báo cáo nên cùng kỳ cho cùng số (SC-015).
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  evalFn,
  mergeAll,
  type AggFn,
  type MaybeBucket,
} from './agg.ts';
import { formatLocal, localMidnight, localParts } from './format.ts';
import { bucketAt, type AggregateResult } from './types.ts';

export type WidgetPeriod =
  | 'last24h'
  | 'last7d'
  | 'last30d'
  | 'today'
  | 'yesterday'
  | 'thisShift'
  | 'lastShift'
  | 'thisMonth'
  | 'lastMonth';

const floorMin = (t: number) => Math.floor(t / MINUTE_MS) * MINUTE_MS;
const mod = (a: number, b: number) => ((a % b) + b) % b;
const startMs = (s: string) => {
  const [h, m] = s.split(':').map(Number) as [number, number];
  return h * HOUR_MS + m * MINUTE_MS;
};

function dayStart(ts: number, tz: number): number {
  const p = localParts(ts, tz);
  return localMidnight(p.y, p.m, p.d, tz);
}

/** Ca chứa `ts` (ca dài 24 giờ / shiftCount, gốc ngày làm việc là nửa đêm + shiftStart). */
function shiftOf(ts: number, tz: number, shiftCount: number, shiftStart: string): [number, number] {
  const len = DAY_MS / shiftCount;
  let origin = dayStart(ts, tz) + startMs(shiftStart);
  if (origin > ts) origin -= DAY_MS;
  const a = origin + Math.floor((ts - origin) / len) * len;
  return [a, a + len];
}

/** `[from, to)` của kỳ, làm tròn xuống phút theo giờ địa phương (`tz` là độ lệch ms). */
export function periodRange(
  period: WidgetPeriod,
  now: number,
  tz: number,
  shiftCount = 3,
  shiftStart = '06:00',
): [number, number] {
  const n = floorMin(now);
  const today = dayStart(n, tz);
  const p = localParts(n, tz);
  const monthStart = (y: number, m: number) => localMidnight(y, m, 1, tz);
  const nextMonth = (y: number, m: number) =>
    m === 12 ? monthStart(y + 1, 1) : monthStart(y, m + 1);
  switch (period) {
    case 'last24h':
      return [n - DAY_MS, n];
    case 'last7d':
      return [n - 7 * DAY_MS, n];
    case 'last30d':
      return [n - 30 * DAY_MS, n];
    case 'today':
      return [today, n];
    case 'yesterday':
      return [today - DAY_MS, today];
    case 'thisMonth':
      return [monthStart(p.y, p.m), nextMonth(p.y, p.m)];
    case 'lastMonth':
      return p.m === 1
        ? [monthStart(p.y - 1, 12), monthStart(p.y, 1)]
        : [monthStart(p.y, p.m - 1), monthStart(p.y, p.m)];
    case 'thisShift':
      return shiftOf(n, tz, shiftCount, shiftStart);
    case 'lastShift': {
      const [a] = shiftOf(n, tz, shiftCount, shiftStart);
      return [a - DAY_MS / shiftCount, a];
    }
  }
}

export interface BarConfig {
  fn?: AggFn;
  bucket: 'hour' | 'shift' | 'day';
  period: WidgetPeriod;
  shiftCount?: number;
  shiftStart?: string;
}
export interface PieConfig {
  fn?: AggFn;
  period: WidgetPeriod;
  shiftCount?: number;
  shiftStart?: string;
}

export interface WidgetRequest {
  from: number;
  to: number;
  bucketMs: number;
  offsetMs: number;
  count?: number;
}

export interface BarCategory {
  start: number;
  end: number;
  label: string;
}
export interface BarSeries {
  tagId: string;
  label: string;
  values: Array<number | null>;
}
export interface BarModel {
  request: WidgetRequest & { count: number };
  categories: BarCategory[];
  series: BarSeries[];
}

/**
 * Biểu đồ cột: cửa sổ căn theo giờ, ngày hoặc ca địa phương; `from` làm tròn LÊN tới biên cửa sổ đầu. Nhãn: giờ
 * `HH:mm`, ngày `dd/MM`, ca `dd/MM Ca n` (ngày làm việc). Chưa có `aggregate` thì giá trị đều null.
 */
export function barModel(
  cfg: BarConfig,
  now: number,
  tz: number,
  aggregate: AggregateResult | undefined,
  tagIds: string[],
  labels: string[] = [],
  shiftWord = 'Ca',
): BarModel {
  const shiftCount = cfg.shiftCount ?? 3;
  const shiftStart = cfg.shiftStart ?? '06:00';
  const [f, to] = periodRange(cfg.period, now, tz, shiftCount, shiftStart);
  const bucketMs =
    cfg.bucket === 'hour' ? HOUR_MS : cfg.bucket === 'day' ? DAY_MS : DAY_MS / shiftCount;
  const off = startMs(shiftStart);
  const anchor = dayStart(f, tz) + (cfg.bucket === 'shift' ? off : 0);
  const offsetMs = mod(anchor, bucketMs);
  const from = Math.ceil((f - offsetMs) / bucketMs) * bucketMs + offsetMs;
  const categories: BarCategory[] = [];
  for (let s = from; s < to; s += bucketMs) {
    let label: string;
    if (cfg.bucket === 'hour') label = formatLocal(s, tz, 'hm');
    else if (cfg.bucket === 'day') label = formatLocal(s, tz, 'dm');
    else {
      const origin = dayStart(s - off, tz) + off;
      label = `${formatLocal(s - off, tz, 'dm')} ${shiftWord} ${Math.round((s - origin) / bucketMs) + 1}`;
    }
    categories.push({ start: s, end: s + bucketMs, label });
  }
  const fn = cfg.fn ?? 'delta';
  const series = tagIds.map((tagId, i): BarSeries => {
    const s = aggregate?.series.find((x) => x.tagId === tagId);
    return {
      tagId,
      label: labels[i] ?? tagId,
      values: categories.map((c) => {
        if (!s || !aggregate) return null;
        const k = Math.round((c.start - aggregate.start) / aggregate.bucketMs);
        return k >= 0 && k < aggregate.count ? evalFn(fn, bucketAt(s, k)) : null;
      }),
    };
  });
  return {
    request: { from, to, bucketMs, offsetMs, count: categories.length },
    categories,
    series,
  };
}

export interface PieSlice {
  tagId: string;
  label: string;
  value: number;
  percent: number;
}
export interface PieModel {
  request: WidgetRequest;
  values: Array<{ tagId: string; value: number | null }>;
  slices: PieSlice[];
  excluded: Array<{ tagId: string; reason: 'missing' | 'negative' }>;
  total: number;
}

/**
 * Biểu đồ tròn: một cửa sổ bao cả kỳ (`bucketMs` = độ dài kỳ làm tròn lên bội 60.000). Giá trị thiếu hoặc âm bị
 * loại; tổng bằng 0 thì không có phần nào.
 */
export function pieModel(
  cfg: PieConfig,
  now: number,
  tz: number,
  aggregate: AggregateResult | undefined,
  tagIds: string[],
  labels: string[] = [],
): PieModel {
  const [from, to] = periodRange(
    cfg.period,
    now,
    tz,
    cfg.shiftCount ?? 3,
    cfg.shiftStart ?? '06:00',
  );
  const bucketMs = Math.max(MINUTE_MS, Math.ceil((to - from) / MINUTE_MS) * MINUTE_MS);
  const fn = cfg.fn ?? 'delta';
  const values = tagIds.map((tagId) => {
    const s = aggregate?.series.find((x) => x.tagId === tagId);
    const b: MaybeBucket = s
      ? mergeAll(Array.from({ length: aggregate!.count }, (_, k) => bucketAt(s, k)))
      : null;
    return { tagId, value: evalFn(fn, b) };
  });
  const excluded: PieModel['excluded'] = [];
  const kept: Array<Omit<PieSlice, 'percent'>> = [];
  values.forEach((v, i) => {
    if (v.value === null) excluded.push({ tagId: v.tagId, reason: 'missing' });
    else if (v.value < 0) excluded.push({ tagId: v.tagId, reason: 'negative' });
    else kept.push({ tagId: v.tagId, label: labels[i] ?? v.tagId, value: v.value });
  });
  const total = kept.reduce((s, k) => s + k.value, 0);
  return {
    request: { from, to, bucketMs, offsetMs: mod(from, bucketMs) },
    values,
    slices: total > 0 ? kept.map((k) => ({ ...k, percent: (k.value / total) * 100 })) : [],
    excluded,
    total,
  };
}
