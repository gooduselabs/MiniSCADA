// Dựng báo cáo từ kết quả `aggregate` (specs/010-history-reports/contracts/templates-config.md §4). Hàm thuần: cùng
// một `ReportTable` cho màn hình, CSV, XLSX và PDF (SC-016).
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  evalFn,
  mergeBuckets,
  type AggFn,
  type MaybeBucket,
} from './agg.ts';
import { formatLocal, formatNumber, localMidnight, parseUtcOffset } from './format.ts';
import { bucketAt, type AggregateResult } from './types.ts';

/** Phần của một mẫu `reports.json` mà phép tính cần (cấu trúc của `ReportTemplate` ở project-schema). */
export interface ReportTemplate {
  id: string;
  name: string;
  period: 'day' | 'shift' | 'month';
  rowMinutes?: number;
  shifts?: { count: number; start: string };
  title?: string;
  footer?: string;
  totals?: boolean;
  columns: Array<{
    tagId: string;
    label?: string;
    unit?: string;
    decimals?: number;
    functions: AggFn[];
  }>;
}

/** Kỳ chọn: ngày (`day`, `shift`: ngày làm việc) hoặc tháng. */
export interface ReportSelection {
  d?: string;
  m?: string;
}

export interface ReportRow {
  start: number;
  end: number;
  label: string;
}

export interface ReportRequest {
  from: number;
  to: number;
  bucketMs: number;
  offsetMs: number;
  rows: ReportRow[];
  periodLabel: string;
  /** Tag khác nhau theo thứ tự xuất hiện, chia lô <= 16 mỗi yêu cầu `aggregate`. */
  batches: string[][];
}

export const MAX_TAGS_PER_REQUEST = 16;

export interface ReportColumnOut {
  key: string;
  tagId: string;
  fn: AggFn;
  label: string;
  unit: string;
  decimals: number;
}

export interface ReportRowOut {
  label: string;
  cells: Array<number | null>;
  /** Ô đã định dạng vi-VN theo `decimals` của cột ('' cho ô trống). */
  text: string[];
  coverage: number;
  pending: boolean;
}

export interface ReportTable {
  title: string;
  footer: string;
  periodLabel: string;
  columns: ReportColumnOut[];
  rows: ReportRowOut[];
  totals: Array<number | null> | null;
  totalsText: string[] | null;
  coverage: number;
  generatedAt: number;
  tz: string;
}

const p2 = (n: number) => String(n).padStart(2, '0');
const mod = (a: number, b: number) => ((a % b) + b) % b;
const parseDate = (s: string): [number, number, number] => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`ngày sai: '${s}'`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

/** Kỳ báo cáo, các hàng và yêu cầu `aggregate` cần gửi. */
export function reportRequest(
  tpl: ReportTemplate,
  sel: ReportSelection,
  tzMs: number,
  shiftWord = 'Ca',
): ReportRequest {
  const rows: ReportRow[] = [];
  let from: number;
  let to: number;
  let bucketMs: number;
  let periodLabel: string;
  const dm = (t: number) => formatLocal(t, tzMs, 'dm');
  const hm = (t: number) => formatLocal(t, tzMs, 'hm');
  if (tpl.period === 'month') {
    const [y, m] = (sel.m ?? '').split('-').map(Number) as [number, number];
    from = localMidnight(y, m, 1, tzMs);
    to = m === 12 ? localMidnight(y + 1, 1, 1, tzMs) : localMidnight(y, m + 1, 1, tzMs);
    bucketMs = DAY_MS;
    periodLabel = `${p2(m)}/${y}`;
    for (let s = from; s < to; s += DAY_MS) rows.push({ start: s, end: s + DAY_MS, label: dm(s) });
  } else {
    const [y, m, d] = parseDate(sel.d ?? '');
    periodLabel = `${p2(d)}/${p2(m)}/${y}`;
    if (tpl.period === 'day') {
      from = localMidnight(y, m, d, tzMs);
      bucketMs = (tpl.rowMinutes ?? 60) * MINUTE_MS;
      to = from + DAY_MS;
      for (let s = from; s < to; s += bucketMs)
        rows.push({ start: s, end: s + bucketMs, label: `${dm(s)} ${hm(s)}–${hm(s + bucketMs)}` });
    } else {
      const sh = tpl.shifts!;
      const [hh, mi] = sh.start.split(':').map(Number) as [number, number];
      from = localMidnight(y, m, d, tzMs) + hh * HOUR_MS + mi * MINUTE_MS;
      to = from + DAY_MS;
      bucketMs = DAY_MS / sh.count;
      for (let i = 0; i < sh.count; i++) {
        const s = from + i * bucketMs;
        rows.push({
          start: s,
          end: s + bucketMs,
          label: `${shiftWord} ${i + 1} ${hm(s)}–${hm(s + bucketMs)}`,
        });
      }
    }
  }
  const tags = [...new Set(tpl.columns.map((c) => c.tagId))];
  const batches: string[][] = [];
  for (let i = 0; i < tags.length; i += MAX_TAGS_PER_REQUEST)
    batches.push(tags.slice(i, i + MAX_TAGS_PER_REQUEST));
  return { from, to, bucketMs, offsetMs: mod(from, bucketMs), rows, periodLabel, batches };
}

export interface BuildReportInput {
  template: ReportTemplate;
  select: ReportSelection;
  /** Múi giờ của nhóm (`±HH:MM`). */
  tz: string;
  now: number;
  shiftWord?: string;
  tagInfo?: Record<string, { description?: string; unit?: string }>;
  /** Kết quả `aggregate` của từng lô (có thể thiếu: ô trống). */
  aggregates: AggregateResult[];
}

/** Bảng báo cáo: một cột cho mỗi (cột mẫu, hàm); hàng có đầu >= `now` là "chưa tới" (ô trống, không đóng góp). */
export function buildReport(input: BuildReportInput): ReportTable {
  const { template: tpl, now } = input;
  const tzMs = parseUtcOffset(input.tz);
  const req = reportRequest(tpl, input.select, tzMs, input.shiftWord ?? 'Ca');
  const tagIds = req.batches.flat();

  // bucket theo (Tag, hàng)
  const buckets = new Map<string, MaybeBucket[]>();
  for (const t of tagIds)
    buckets.set(
      t,
      req.rows.map(() => null),
    );
  for (const a of input.aggregates)
    for (const s of a.series) {
      const arr = buckets.get(s.tagId);
      if (!arr) continue;
      req.rows.forEach((r, i) => {
        const k = Math.round((r.start - a.start) / a.bucketMs);
        if (k >= 0 && k < a.count) arr[i] = bucketAt(s, k);
      });
    }

  const columns: ReportColumnOut[] = [];
  for (const c of tpl.columns)
    for (const fn of c.functions) {
      const info = input.tagInfo?.[c.tagId];
      columns.push({
        key: `${c.tagId}.${fn}`,
        tagId: c.tagId,
        fn,
        label: c.label ?? info?.description ?? c.tagId,
        unit: c.unit ?? info?.unit ?? '',
        decimals: c.decimals ?? 2,
      });
    }

  const merged = new Map<string, MaybeBucket>(tagIds.map((t) => [t, null]));
  let arrived = 0;
  let wmsTotal = 0;
  const rows: ReportRowOut[] = req.rows.map((r, i) => {
    const pending = r.start >= now;
    const cells = columns.map((c) => (pending ? null : evalFn(c.fn, buckets.get(c.tagId)![i]!)));
    let wms = 0;
    if (!pending) {
      arrived += 1;
      for (const t of tagIds) {
        const b = buckets.get(t)![i]!;
        wms += b === null ? 0 : b.wms;
        merged.set(t, mergeBuckets(merged.get(t)!, b));
      }
      wmsTotal += wms;
    }
    return {
      label: r.label,
      cells,
      text: cells.map((v, k) => formatNumber(v, columns[k]!.decimals)),
      coverage: pending ? 0 : wms / (tagIds.length * req.bucketMs),
      pending,
    };
  });

  const totals =
    tpl.totals === false
      ? null
      : columns.map((c) => (arrived === 0 ? null : evalFn(c.fn, merged.get(c.tagId)!)));
  return {
    title: tpl.title ?? tpl.name,
    footer: tpl.footer ?? '',
    periodLabel: req.periodLabel,
    columns,
    rows,
    totals,
    totalsText:
      totals === null ? null : totals.map((v, k) => formatNumber(v, columns[k]!.decimals)),
    coverage: arrived === 0 ? 0 : wmsTotal / (tagIds.length * arrived * req.bucketMs),
    generatedAt: now,
    tz: input.tz,
  };
}
