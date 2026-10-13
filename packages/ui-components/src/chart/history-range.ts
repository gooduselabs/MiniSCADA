// Khoảng thời gian chọn nhanh của widget lịch sử (thuộc tính `range`): tương đối so với bây giờ hoặc theo ngày
// địa phương của nhóm (nửa đêm theo `±HH:MM`, không theo múi giờ trình duyệt).
import type { TimeRange } from './history-plot.ts';

export const RANGE_KEYS = ['1h', '8h', '24h', '7d', '30d', 'today', 'yesterday'] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

const H = 3_600_000;
const DAY = 86_400_000;
const DUR: Record<string, number> = {
  '1h': H,
  '8h': 8 * H,
  '24h': 24 * H,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
};

export const isRangeKey = (v: string): v is RangeKey =>
  (RANGE_KEYS as readonly string[]).includes(v);

/** Khoảng `[from, to)` của `key` tại thời điểm `now` (ms UTC) với độ lệch múi giờ nhóm `offsetMs`. */
export function baseRange(key: RangeKey, now: number, offsetMs: number): TimeRange {
  if (key === 'today' || key === 'yesterday') {
    const midnight = Math.floor((now + offsetMs) / DAY) * DAY - offsetMs;
    return key === 'today' ? { from: midnight, to: now } : { from: midnight - DAY, to: midnight };
  }
  return { from: now - (DUR[key] ?? DUR['24h']!), to: now };
}

/** Khoảng kết thúc ở "bây giờ" (được theo dõi). */
export const endsNow = (key: RangeKey): boolean => key !== 'yesterday';
