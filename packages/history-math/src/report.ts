// Dựng báo cáo từ kết quả `aggregate` (specs/010-history-reports/contracts/templates-config.md §4; feature 015:
// specs/015-reports/plan.md). Hàm thuần: cùng một `ReportTable` cho màn hình, xem trước Studio, CSV, XLSX và PDF
// (SC-016). Feature 015 thêm kỳ tuần (ISO) và khoảng tùy chọn, hàm `onTime` (giờ ON của BOOL), `starts` (số lần bật,
// đếm từ dòng thô, nơi gọi cấp), thẻ tổng hợp, dữ liệu biểu đồ và bảng phụ.
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  evalFn,
  mergeBuckets,
  type AggFn,
  type MaybeBucket,
} from './agg.ts';
import {
  daysFromCivil,
  formatLocal,
  formatNumber,
  localMidnight,
  parseUtcOffset,
} from './format.ts';
import { bucketAt, type AggregateResult } from './types.ts';

/** Hàm của cột báo cáo: hàm tổng hợp, `onTime` (= tích phân của BOOL, đơn vị giờ), `starts` (cạnh lên, dòng thô). */
export type ReportFn = AggFn | 'onTime' | 'starts';
export type ReportKind = 'table' | 'alarm' | 'equipment' | 'logic';
export type ReportPeriodKind = 'day' | 'shift' | 'month' | 'week' | 'range';

/** Phần của một mẫu `reports.json` mà phép tính cần (cấu trúc của `ReportTemplate` ở project-schema). */
export interface ReportTemplate {
  id: string;
  name: string;
  kind?: ReportKind;
  period: ReportPeriodKind;
  rowMinutes?: number;
  shifts?: { count: number; start: string };
  title?: string;
  footer?: string;
  totals?: boolean;
  tiles?: boolean;
  chart?: 'line' | 'bar' | 'none';
  columns?: Array<{
    tagId: string;
    label?: string;
    unit?: string;
    decimals?: number;
    functions: ReportFn[];
  }>;
}

/** Kỳ chọn: ngày (`day`, `shift`: ngày làm việc), tháng, tuần ISO (`2026-W43`) hoặc khoảng ngày (gồm ngày cuối). */
export interface ReportSelection {
  d?: string;
  m?: string;
  w?: string;
  from?: string;
  to?: string;
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
/** Kỳ `range` dài nhất (ngày). */
export const MAX_RANGE_DAYS = 31;

export interface ReportColumnOut {
  key: string;
  tagId: string;
  fn: ReportFn;
  label: string;
  unit: string;
  decimals: number;
  /** Cột không theo hàm (báo cáo sự kiện): tiêu đề chỉ có nhãn và đơn vị. */
  plain?: boolean;
}

export interface ReportRowOut {
  label: string;
  cells: Array<number | null>;
  /** Ô đã định dạng vi-VN theo `decimals` của cột ('' cho ô trống). */
  text: string[];
  coverage: number;
  pending: boolean;
}

/** Màu thẻ: tên trong bảng `--mat-tile-*` (feature 014), cùng giá trị ở mọi chủ đề. */
export type ReportTileColor =
  'teal' | 'blue' | 'rose' | 'violet' | 'olive' | 'indigo' | 'orange' | 'cyan' | 'green' | 'slate';
export const TILE_ORDER: readonly ReportTileColor[] = [
  'teal',
  'blue',
  'violet',
  'orange',
  'indigo',
  'green',
  'rose',
  'cyan',
];

export interface ReportTile {
  label: string;
  value: number | null;
  /** Giá trị đã định dạng ('–' khi chưa có). */
  text: string;
  unit: string;
  color: ReportTileColor;
}

export interface ReportChart {
  kind: 'line' | 'bar';
  title: string;
  unit: string;
  decimals: number;
  categories: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
}

export interface ReportSection {
  title: string;
  columns: Array<{ label: string; numeric?: boolean }>;
  /** Ô đã định dạng. */
  rows: string[][];
  /** Giá trị số của ô (XLSX ghi số); null: ô chữ hoặc trống. */
  values?: Array<Array<number | null>>;
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
  // ---- feature 015 (tùy chọn: bảng của 010 không có thì bộ xuất dựng như cũ) ----
  kind?: ReportKind;
  /** Tên đơn vị (reports.json `org`, mặc định tên project). */
  org?: string;
  /** Nhãn cột hàng thay nhãn chung ("Thời gian"). */
  rowHeader?: string;
  /** Hàng thẻ tổng hợp; [] khi mẫu tắt thẻ. */
  tiles?: ReportTile[];
  /** Biểu đồ; null khi mẫu tắt hoặc không đáng vẽ. */
  chart?: ReportChart | null;
  /** Bảng phụ sau bảng chính (thống kê, danh sách sự kiện). */
  sections?: ReportSection[];
  /** Ghi chú cuối báo cáo (giới hạn dữ liệu…). */
  notes?: string[];
  /** false: không hiện "Dữ liệu đủ" (báo cáo sự kiện). */
  showCoverage?: boolean;
}

const p2 = (n: number) => String(n).padStart(2, '0');
const mod = (a: number, b: number) => ((a % b) + b) % b;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const parseDate = (s: string): [number, number, number] => {
  const m = DAY_RE.exec(s);
  if (!m) throw new Error(`ngày sai: '${s}'`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
/** Thứ của số ngày kể từ 1970-01-01 (0 = Chủ nhật; 1970-01-01 là thứ Năm). */
const weekdayOfDays = (days: number) => mod(days + 4, 7);
/** Số ngày của thứ Hai tuần ISO 1 của năm (tuần chứa ngày 4/1). */
const isoMonday1 = (y: number) => {
  const jan4 = daysFromCivil(y, 1, 4);
  return jan4 - mod(weekdayOfDays(jan4) + 6, 7);
};
const isoWeeksIn = (y: number) => (isoMonday1(y + 1) - isoMonday1(y)) / 7;

/** Nửa đêm địa phương của thứ Hai tuần ISO `YYYY-Www`. */
export function isoWeekStart(w: string, tzMs: number): number {
  const m = WEEK_RE.exec(w);
  if (!m) throw new Error(`tuần sai: '${w}'`);
  return (isoMonday1(Number(m[1])) + (Number(m[2]) - 1) * 7) * DAY_MS - tzMs;
}

/** Tuần ISO (`YYYY-Www`) chứa ngày lịch (y, m, d). */
export function isoWeekOf(y: number, m: number, d: number): string {
  const days = daysFromCivil(y, m, d);
  let year = y + 1;
  while (isoMonday1(year) > days) year--;
  return `${year}-W${p2(Math.floor((days - isoMonday1(year)) / 7) + 1)}`;
}

const dayOk = (s: string | undefined): s is string => {
  const m = s ? DAY_RE.exec(s) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const len =
    (mo === 12 ? daysFromCivil(y + 1, 1, 1) : daysFromCivil(y, mo + 1, 1)) -
    daysFromCivil(y, mo, 1);
  return d <= len;
};

/** Kỳ chọn đủ và đúng dạng cho mẫu (khoảng: từ ≤ đến, ≤ 31 ngày). */
export function validSelection(tpl: { period: ReportPeriodKind }, sel: ReportSelection): boolean {
  switch (tpl.period) {
    case 'month': {
      const m = /^(\d{4})-(\d{2})$/.exec(sel.m ?? '');
      return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12;
    }
    case 'week': {
      const m = WEEK_RE.exec(sel.w ?? '');
      return !!m && Number(m[2]) >= 1 && Number(m[2]) <= isoWeeksIn(Number(m[1]));
    }
    case 'range': {
      if (!dayOk(sel.from) || !dayOk(sel.to)) return false;
      const a = daysFromCivil(...parseDate(sel.from));
      const b = daysFromCivil(...parseDate(sel.to));
      return b >= a && b - a + 1 <= MAX_RANGE_DAYS;
    }
    default:
      return dayOk(sel.d);
  }
}

/** Kỳ báo cáo, các hàng và yêu cầu `aggregate` cần gửi. */
export function reportRequest(
  tpl: ReportTemplate,
  sel: ReportSelection,
  tzMs: number,
  shiftWord = 'Ca',
  weekWord = 'Tuần',
): ReportRequest {
  const rows: ReportRow[] = [];
  let from: number;
  let to: number;
  let bucketMs: number;
  let periodLabel: string;
  const dm = (t: number) => formatLocal(t, tzMs, 'dm');
  const hm = (t: number) => formatLocal(t, tzMs, 'hm');
  const wdm = (t: number) => `${WEEKDAYS[weekdayOfDays(Math.floor((t + tzMs) / DAY_MS))]} ${dm(t)}`;
  const daily = (label: (t: number) => string) => {
    for (let s = from; s < to; s += DAY_MS)
      rows.push({ start: s, end: s + DAY_MS, label: label(s) });
  };
  if (tpl.period === 'month') {
    const [y, m] = (sel.m ?? '').split('-').map(Number) as [number, number];
    from = localMidnight(y, m, 1, tzMs);
    to = m === 12 ? localMidnight(y + 1, 1, 1, tzMs) : localMidnight(y, m + 1, 1, tzMs);
    bucketMs = DAY_MS;
    periodLabel = `${p2(m)}/${y}`;
    daily(dm);
  } else if (tpl.period === 'week') {
    const w = WEEK_RE.exec(sel.w ?? '');
    from = isoWeekStart(sel.w ?? '', tzMs);
    to = from + 7 * DAY_MS;
    bucketMs = DAY_MS;
    periodLabel = `${weekWord} ${Number(w![2])}/${w![1]} (${dm(from)}–${dm(to - DAY_MS)})`;
    daily(wdm);
  } else if (tpl.period === 'range') {
    const [y1, m1, d1] = parseDate(sel.from ?? '');
    const [y2, m2, d2] = parseDate(sel.to ?? '');
    from = localMidnight(y1, m1, d1, tzMs);
    to = localMidnight(y2, m2, d2, tzMs) + DAY_MS;
    bucketMs = DAY_MS;
    periodLabel = `${p2(d1)}/${p2(m1)}/${y1}–${p2(d2)}/${p2(m2)}/${y2}`;
    daily(wdm);
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
      const sh = tpl.shifts ?? { count: 3, start: '06:00' };
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
  const tags = [...new Set((tpl.columns ?? []).map((c) => c.tagId))];
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
  weekWord?: string;
  tagInfo?: Record<string, { description?: string; unit?: string }>;
  /** Kết quả `aggregate` của từng lô (có thể thiếu: ô trống). */
  aggregates: AggregateResult[];
  /** Số lần bật theo Tag (hàm `starts`): mỗi hàng, null khi không đếm được (vượt trần dòng thô). */
  starts?: Record<string, Array<number | null>>;
  /** Tên hàm hiển thị (nhãn thẻ, tên chuỗi biểu đồ); thiếu thì dùng mã hàm. */
  fnNames?: Partial<Record<ReportFn, string>>;
  /** Nhãn thẻ độ đủ dữ liệu. */
  coverageLabel?: string;
  org?: string;
}

/** Tên hàm tiếng Việt mặc định (nhãn thẻ, tên chuỗi biểu đồ). */
export const REPORT_FN_VI: Record<ReportFn, string> = {
  min: 'nhỏ nhất',
  max: 'lớn nhất',
  avg: 'trung bình',
  sum: 'tổng',
  first: 'đầu kỳ',
  last: 'cuối kỳ',
  delta: 'chênh lệch',
  count: 'số mẫu',
  onTime: 'thời gian ON',
  starts: 'số lần bật',
};

const MAX_TILES = 4;
const BAR_FNS: ReadonlySet<ReportFn> = new Set(['sum', 'delta', 'count', 'onTime', 'starts']);
const MAX_SERIES = 4;

const aggFnOf = (fn: ReportFn): AggFn => (fn === 'onTime' ? 'sum' : (fn as AggFn));

/** Bảng báo cáo: một cột cho mỗi (cột mẫu, hàm); hàng có đầu >= `now` là "chưa tới" (ô trống, không đóng góp). */
export function buildReport(input: BuildReportInput): ReportTable {
  const { template: tpl, now } = input;
  const tzMs = parseUtcOffset(input.tz);
  const req = reportRequest(tpl, input.select, tzMs, input.shiftWord ?? 'Ca', input.weekWord);
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
  for (const c of tpl.columns ?? [])
    for (const fn of c.functions) {
      const info = input.tagInfo?.[c.tagId];
      columns.push({
        key: `${c.tagId}.${fn}`,
        tagId: c.tagId,
        fn,
        label: c.label ?? info?.description ?? c.tagId,
        unit: c.unit ?? info?.unit ?? '',
        decimals: c.decimals ?? (fn === 'starts' ? 0 : 2),
      });
    }

  const startsOf = (tag: string, i: number): number | null => input.starts?.[tag]?.[i] ?? null;
  const merged = new Map<string, MaybeBucket>(tagIds.map((t) => [t, null]));
  const startsTotal = new Map<string, number | null>();
  let arrived = 0;
  let wmsTotal = 0;
  const rows: ReportRowOut[] = req.rows.map((r, i) => {
    const pending = r.start >= now;
    const cells = columns.map((c) =>
      pending
        ? null
        : c.fn === 'starts'
          ? startsOf(c.tagId, i)
          : evalFn(aggFnOf(c.fn), buckets.get(c.tagId)![i]!),
    );
    let wms = 0;
    if (!pending) {
      arrived += 1;
      for (const t of tagIds) {
        const b = buckets.get(t)![i]!;
        wms += b === null ? 0 : b.wms;
        merged.set(t, mergeBuckets(merged.get(t)!, b));
        const st = startsOf(t, i);
        const prev = startsTotal.has(t) ? startsTotal.get(t)! : 0;
        startsTotal.set(t, prev === null || st === null ? null : prev + st);
      }
      wmsTotal += wms;
    }
    return {
      label: r.label,
      cells,
      text: cells.map((v, k) => formatNumber(v, columns[k]!.decimals)),
      coverage: pending || tagIds.length === 0 ? 0 : wms / (tagIds.length * req.bucketMs),
      pending,
    };
  });

  const totalsAll = columns.map((c) =>
    arrived === 0
      ? null
      : c.fn === 'starts'
        ? (startsTotal.get(c.tagId) ?? null)
        : evalFn(aggFnOf(c.fn), merged.get(c.tagId)!),
  );
  const totals = tpl.totals === false ? null : totalsAll;
  const coverage =
    arrived === 0 || tagIds.length === 0 ? 0 : wmsTotal / (tagIds.length * arrived * req.bucketMs);
  const fnName = (fn: ReportFn) => input.fnNames?.[fn] ?? REPORT_FN_VI[fn];
  const seriesName = (c: ReportColumnOut) => `${c.label} · ${fnName(c.fn)}`;

  const table: ReportTable = {
    title: tpl.title ?? tpl.name,
    footer: tpl.footer ?? '',
    periodLabel: req.periodLabel,
    columns,
    rows,
    totals,
    totalsText:
      totals === null ? null : totals.map((v, k) => formatNumber(v, columns[k]!.decimals)),
    coverage,
    generatedAt: now,
    tz: input.tz,
    kind: tpl.kind ?? 'table',
  };
  if (input.org) table.org = input.org;

  // thẻ: tổng kỳ của tối đa 4 cột đầu, rồi độ đủ dữ liệu
  if (tpl.tiles === false) table.tiles = [];
  else {
    const tiles: ReportTile[] = columns.slice(0, MAX_TILES).map((c, k) => ({
      label: seriesName(c),
      value: totalsAll[k] ?? null,
      text: totalsAll[k] == null ? '–' : formatNumber(totalsAll[k]!, c.decimals),
      unit: c.unit,
      color: TILE_ORDER[k % TILE_ORDER.length]!,
    }));
    tiles.push({
      label: input.coverageLabel ?? 'Dữ liệu đủ',
      value: coverage * 100,
      text: formatNumber(coverage * 100, 1),
      unit: '%',
      color: 'slate',
    });
    table.tiles = tiles;
  }
  table.chart = tpl.chart === 'none' ? null : reportChart(table, tpl.chart, seriesName);
  return table;
}

/**
 * Dữ liệu biểu đồ của bảng: các cột cùng đơn vị và cùng loại hàm (cộng dồn hay không) với cột đầu, tối đa 4; hàm cộng
 * dồn vẽ cột, còn lại vẽ đường (hoặc theo `prefer`). null khi dưới hai hàng hoặc không có số. Hàng chưa tới là null.
 */
export function reportChart(
  t: ReportTable,
  prefer?: 'line' | 'bar',
  name: (c: ReportColumnOut) => string = (c) => c.label,
): ReportChart | null {
  if (t.rows.length < 2 || t.columns.length === 0) return null;
  const first = t.columns[0]!;
  const bar = BAR_FNS.has(first.fn);
  const picked = t.columns
    .map((c, k) => ({ c, k }))
    .filter(({ c }) => c.unit === first.unit && BAR_FNS.has(c.fn) === bar)
    .slice(0, MAX_SERIES);
  const hasNumber = t.rows.some((r) => picked.some(({ k }) => r.cells[k] !== null));
  if (!hasNumber) return null;
  const labels = [...new Set(picked.map(({ c }) => c.label))].join(', ');
  return {
    kind: prefer ?? (bar ? 'bar' : 'line'),
    title: first.unit ? `${labels} (${first.unit})` : labels,
    unit: first.unit,
    decimals: Math.max(0, ...picked.map(({ c }) => c.decimals)),
    categories: t.rows.map((r) => r.label),
    series: picked.map(({ c, k }) => ({
      name: name(c),
      values: t.rows.map((r) => (r.pending ? null : (r.cells[k] ?? null))),
    })),
  };
}

/**
 * Lùi bao nhiêu ms trước khi lấy ngày địa phương của kỳ mặc định ("đang chạy"). Mẫu theo ca: ngày làm việc
 * bắt đầu lúc ca 1 (`shifts.start`), nên trước giờ đó (ví dụ 01:07 với ca 06:00) ngày làm việc đang chạy là
 * của hôm trước. Ngày và tháng: 0. Giờ sai dạng: 0 (validator báo lỗi mẫu).
 */
export function workDayOffsetMs(tpl: {
  period: string;
  shifts?: { count: number; start: string };
}): number {
  if (tpl.period !== 'shift') return 0;
  const m = /^(\d{2}):(\d{2})$/.exec(tpl.shifts?.start ?? '');
  if (!m) return 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return 0;
  return (h * 60 + min) * 60_000;
}
