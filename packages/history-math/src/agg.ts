// Phép ghép bucket tổng hợp và đại lượng suy ra (specs/010-history-reports/contracts/history-db.md §6).
// Bản C++ tương ứng: core/historian/agg_math.*; cùng vector tests/agg-vectors.

/** Một bucket tổng hợp. `null` (kiểu `MaybeBucket`) là bucket rỗng: phần tử đơn vị của `mergeBuckets`. */
export interface AggBucket {
  n: number;
  min: number;
  max: number;
  first: number;
  last: number;
  sumw: number;
  wms: number;
}
export type MaybeBucket = AggBucket | null;

export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

/** Ghép `a` (trước) với `b` (sau); cửa sổ liền kề hoặc cách nhau. */
export function mergeBuckets(a: MaybeBucket, b: MaybeBucket): MaybeBucket {
  if (a === null) return b;
  if (b === null) return a;
  return {
    n: a.n + b.n,
    min: Math.min(a.min, b.min),
    max: Math.max(a.max, b.max),
    first: a.first,
    last: b.last,
    sumw: a.sumw + b.sumw,
    wms: a.wms + b.wms,
  };
}

/** Ghép dãy theo thứ tự (gấp trái). */
export function mergeAll(list: Iterable<MaybeBucket>): MaybeBucket {
  let acc: MaybeBucket = null;
  for (const b of list) acc = mergeBuckets(acc, b);
  return acc;
}

/** Trung bình theo thời gian; `last` khi chưa có đoạn giữ (wms = 0). Bucket rỗng: null. */
export const avg = (b: MaybeBucket): number | null =>
  b === null ? null : b.wms > 0 ? b.sumw / b.wms : b.last;
/** Tích phân theo giờ (đơn vị x giờ): kW -> kWh, BOOL -> giờ chạy. */
export const sum = (b: MaybeBucket): number | null => (b === null ? null : b.sumw / HOUR_MS);
export const delta = (b: MaybeBucket): number | null => (b === null ? null : b.last - b.first);
/** Tỉ lệ thời gian có dữ liệu của cửa sổ dài `windowMs`; bucket rỗng: 0. */
export const coverage = (b: MaybeBucket, windowMs: number): number =>
  b === null ? 0 : b.wms / windowMs;

export type AggFn = 'min' | 'max' | 'avg' | 'sum' | 'first' | 'last' | 'delta' | 'count';

/** Giá trị hàm `fn` của bucket (báo cáo, biểu đồ cột và tròn); bucket rỗng: null. */
export function evalFn(fn: AggFn, b: MaybeBucket): number | null {
  if (b === null) return null;
  switch (fn) {
    case 'min':
      return b.min;
    case 'max':
      return b.max;
    case 'avg':
      return avg(b);
    case 'sum':
      return sum(b);
    case 'first':
      return b.first;
    case 'last':
      return b.last;
    case 'delta':
      return delta(b);
    case 'count':
      return b.n;
  }
}
