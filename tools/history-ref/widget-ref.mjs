// Bản tham chiếu độc lập của kỳ và mô hình widget lịch sử (feature 010, T096, T108):
// contracts/widget-catalog-010.md §2.2. Không dùng mã sản phẩm.
import { DAY_MS, HOUR_MS, MIN_MS, ddmm, hhmm, localMidnight, localParts } from './ref.mjs';

const floorMin = (t) => Math.floor(t / MIN_MS) * MIN_MS;

/** Nửa đêm địa phương của ngày chứa `ts`. */
function midnightOf(ts, tz) {
  const p = localParts(ts, tz);
  return localMidnight(p.y, p.m, p.d, tz);
}

/** `HH:MM` -> mili giây từ nửa đêm. */
const startOffset = (s) => {
  const [h, m] = s.split(':').map(Number);
  return h * HOUR_MS + m * MIN_MS;
};

/** Ca chứa `ts`: [from, to), ca dài DAY/count, gốc ngày làm việc là nửa đêm + shiftStart. */
function shiftContaining(ts, tz, shiftCount, shiftStart) {
  const len = DAY_MS / shiftCount;
  let origin = midnightOf(ts, tz) + startOffset(shiftStart);
  if (origin > ts) origin -= DAY_MS;
  const k = Math.floor((ts - origin) / len);
  return [origin + k * len, origin + (k + 1) * len];
}

const nextMonthStart = (y, m, tz) =>
  m === 12 ? localMidnight(y + 1, 1, 1, tz) : localMidnight(y, m + 1, 1, tz);

/** [from, to) của `period`, làm tròn xuống phút theo giờ địa phương `tz` (ms). */
export function periodRangeRef(period, now, tz, shiftCount = 3, shiftStart = '06:00') {
  const n = floorMin(now);
  const today = midnightOf(n, tz);
  const p = localParts(n, tz);
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
      return [localMidnight(p.y, p.m, 1, tz), nextMonthStart(p.y, p.m, tz)];
    case 'lastMonth': {
      const [py, pm] = p.m === 1 ? [p.y - 1, 12] : [p.y, p.m - 1];
      return [localMidnight(py, pm, 1, tz), localMidnight(p.y, p.m, 1, tz)];
    }
    case 'thisShift':
      return shiftContaining(n, tz, shiftCount, shiftStart);
    case 'lastShift': {
      const [a] = shiftContaining(n, tz, shiftCount, shiftStart);
      return [a - DAY_MS / shiftCount, a];
    }
    default:
      throw new Error(`period lạ: ${period}`);
  }
}

/**
 * Yêu cầu và hạng mục của biểu đồ cột: `cfg` { bucket, period, shiftCount, shiftStart }.
 * Cửa sổ căn theo giờ/ngày/ca địa phương; `from` làm tròn LÊN tới biên cửa sổ đầu tiên.
 * Trả { from, to, bucketMs, offsetMs, categories: [{ start, end, label }] }.
 */
export function barRequest(cfg, now, tz, shiftWord = 'Ca') {
  const shiftCount = cfg.shiftCount ?? 3;
  const shiftStart = cfg.shiftStart ?? '06:00';
  const [f, to] = periodRangeRef(cfg.period, now, tz, shiftCount, shiftStart);
  const bucketMs = { hour: HOUR_MS, day: DAY_MS, shift: DAY_MS / shiftCount }[cfg.bucket];
  const anchor = midnightOf(f, tz) + (cfg.bucket === 'shift' ? startOffset(shiftStart) : 0);
  const offsetMs = ((anchor % bucketMs) + bucketMs) % bucketMs;
  const a = Math.ceil((f - offsetMs) / bucketMs) * bucketMs + offsetMs;
  const categories = [];
  for (let s = a; s < to; s += bucketMs) {
    let label;
    if (cfg.bucket === 'hour') label = hhmm(s, tz);
    else if (cfg.bucket === 'day') label = ddmm(s, tz);
    else {
      // ngày làm việc chứa ca: ngày địa phương của (s - shiftStart)
      const off = startOffset(shiftStart);
      const origin = midnightOf(s - off, tz) + off;
      const idx = Math.round((s - origin) / bucketMs) + 1;
      label = `${ddmm(s - off, tz)} ${shiftWord} ${idx}`;
    }
    categories.push({ start: s, end: s + bucketMs, label });
  }
  return { from: a, to, bucketMs, offsetMs, categories };
}

/** Yêu cầu của biểu đồ tròn: một cửa sổ bao cả kỳ. */
export function pieRequest(cfg, now, tz) {
  const [from, to] = periodRangeRef(
    cfg.period,
    now,
    tz,
    cfg.shiftCount ?? 3,
    cfg.shiftStart ?? '06:00',
  );
  const bucketMs = Math.ceil((to - from) / MIN_MS) * MIN_MS;
  return { from, to, bucketMs, offsetMs: ((from % bucketMs) + bucketMs) % bucketMs };
}

/**
 * Mô hình biểu đồ tròn từ giá trị mỗi Tag: `values` [{ tagId, value|null }] (đã tính hàm của cửa sổ duy nhất).
 * Giá trị thiếu (null) hoặc âm bị loại; tổng 0 thì không có phần nào.
 */
export function pieSlices(values, labels = []) {
  const excluded = [];
  const kept = [];
  values.forEach((v, i) => {
    const label = labels[i] ?? v.tagId;
    if (v.value === null) excluded.push({ tagId: v.tagId, reason: 'missing' });
    else if (v.value < 0) excluded.push({ tagId: v.tagId, reason: 'negative' });
    else kept.push({ tagId: v.tagId, label, value: v.value });
  });
  const total = kept.reduce((s, k) => s + k.value, 0);
  const slices = total > 0 ? kept.map((k) => ({ ...k, percent: (k.value / total) * 100 })) : [];
  return { slices, excluded, total };
}
