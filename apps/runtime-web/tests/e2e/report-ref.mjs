// Đối chiếu độc lập cho e2e báo cáo và màn hình Điện năng (feature 010, T105, T113): dựng bảng báo cáo bằng
// tools/history-ref (không dùng @mat/history-math) từ dữ liệu của runtime giả (valueAt, mỗi phút một mẫu).
import {
  DAY_MS,
  MIN_MS,
  aggregateStore,
  evalFn,
  formatVi,
  localMidnight,
  localParts,
  reportPeriod,
  reportTable,
  tzOffsetMs,
  windowsFromMinutes,
} from '../../../../tools/history-ref/ref.mjs';
import { valueAt } from './history-fake.mjs';

export const TZ = '+07:00';
export const tzMs = tzOffsetMs(TZ);
export { DAY_MS, MIN_MS, formatVi, localMidnight, localParts };
const p2 = (n) => String(n).padStart(2, '0');

/** Chuỗi ngày `YYYY-MM-DD` của hôm qua theo giờ địa phương. */
export function yesterday(now = Date.now()) {
  const p = localParts(now - DAY_MS, tzMs);
  return `${p.y}-${p2(p.m)}-${p2(p.d)}`;
}

/** Tháng 31 ngày gần nhất đã kết thúc (`YYYY-MM`). */
export function lastMonth31(now = Date.now()) {
  const p = localParts(now, tzMs);
  let y = p.y;
  let m = p.m;
  for (let i = 0; i < 12; i++) {
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    if ([1, 3, 5, 7, 8, 10, 12].includes(m)) return `${y}-${p2(m)}`;
  }
  throw new Error('không có tháng 31 ngày');
}

/** Bảng tham chiếu của mẫu `tpl` cho kỳ `sel` ({d} hoặc {m}): { period, table } (ô là số hoặc null). */
export function refReport(tpl, sel, now = Date.now(), shiftWord = 'Ca') {
  const period = reportPeriod(tpl, sel, tzMs, shiftWord);
  const tagIds = [...new Set(tpl.columns.map((c) => c.tagId))];
  const buckets = {};
  for (const id of tagIds) {
    const events = [];
    for (let t = period.from - MIN_MS; t < period.to; t += MIN_MS)
      events.push({ op: 'row', t, values: { [id]: valueAt(id, t) } });
    events.push({ op: 'advance', t: period.to });
    const rows = aggregateStore(events, id)[MIN_MS];
    buckets[id] = windowsFromMinutes(rows, period.from, period.bucketMs, period.rows.length);
  }
  return { period, table: reportTable(tpl, period, buckets, now) };
}

/** Giá trị hàm `fn` của Tag `tagId` trên một cửa sổ [from, to) (tham chiếu độc lập; null khi không có dữ liệu). */
export function refWindow(tagId, fn, from, to) {
  const events = [];
  for (let t = from - MIN_MS; t < to; t += MIN_MS)
    events.push({ op: 'row', t, values: { c: valueAt(tagId, t) } });
  events.push({ op: 'advance', t: to });
  const rows = aggregateStore(events, 'c')[MIN_MS];
  return evalFn(fn, windowsFromMinutes(rows, from, to - from, 1)[0]);
}

/** Văn bản ô -> số (bỏ chấm nghìn, dấu phẩy thập phân). */
export const viNumber = (s) => Number(s.replace(/\./g, '').replace(',', '.'));

/** Văn bản mong đợi của một ô tham chiếu. */
export const refText = (v, decimals) => formatVi(v, decimals);
