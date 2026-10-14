// Kiểu dữ liệu phía trình duyệt (specs/010-history-reports/data-model.md §4). Thời gian là epoch ms UTC.
import type { MaybeBucket } from './agg.ts';

/** Một đường của phản hồi `aggregate`: mảng cùng độ dài `count`; cửa sổ rỗng có `n`, `wms` bằng 0 và còn lại `null`. */
export interface AggregateSeries {
  tagId: string;
  n: number[];
  min: Array<number | null>;
  max: Array<number | null>;
  first: Array<number | null>;
  last: Array<number | null>;
  sumw: Array<number | null>;
  wms: number[];
  /** Có trong phản hồi thật (`avg`, `sum`) nhưng người dựng tự tính từ `sumw`, `wms`. */
  avg?: Array<number | null>;
  sum?: Array<number | null>;
}

export interface AggregateResult {
  start: number;
  count: number;
  bucketMs: number;
  series: AggregateSeries[];
}

/** Bucket của cửa sổ `k` của một đường (null khi rỗng). */
export function bucketAt(s: AggregateSeries, k: number): MaybeBucket {
  const n = s.n[k] ?? 0;
  const wms = s.wms[k] ?? 0;
  if (n === 0 && wms === 0) return null;
  return {
    n,
    min: s.min[k]!,
    max: s.max[k]!,
    first: s.first[k]!,
    last: s.last[k]!,
    sumw: s.sumw[k]!,
    wms,
  };
}
