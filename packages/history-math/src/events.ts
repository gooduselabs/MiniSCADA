// Báo cáo sự kiện của feature 015 (specs/015-reports/spec.md US3–US5, plan.md mục Hợp đồng): alarm (từ
// `GET /api/v1/alarms/history`), số lần bật của thiết bị (cạnh lên trên dòng thô `GET /api/v1/history/rows`) và ghi PLC
// của logic (`GET /api/v1/logic/events`). Hàm thuần cho ra ReportTable mở rộng (cùng bộ dựng web, Studio, CSV, XLSX,
// PDF). Mọi chữ của project (tên alarm, nội dung, khu, luật) đi nguyên văn: nơi hiển thị dùng textContent/binding.
import { formatLocal, formatNumber, parseUtcOffset } from './format.ts';
import {
  reportRequest,
  type ReportColumnOut,
  type ReportRequest,
  type ReportRowOut,
  type ReportSection,
  type ReportSelection,
  type ReportTable,
  type ReportTemplate,
  type ReportTile,
} from './report.ts';

/** Một lần xảy ra alarm (phần của phần tử `alarms/history` mà báo cáo cần). */
export interface AlarmOccurrence {
  alarmId: string;
  name: string;
  priority: string;
  area: string | null;
  text: string;
  tsActive: number;
  tsAck: number | null;
  tsReturn: number | null;
  ackUser?: string | null;
}

/** Một bản ghi của `GET /api/v1/logic/events`. */
export interface LogicEvent {
  id: number;
  ts: number;
  rule: string;
  action: string;
  tag: string | null;
  result: string;
  code: string | null;
  /** JSON của audit (`{"value": …}`); có thể null. */
  detail: string | null;
}

/** Chữ của báo cáo sự kiện (mặc định tiếng Việt; nơi gọi đổi được). */
export const EVENT_WORDS = {
  appear: 'Xuất hiện',
  ack: 'Xác nhận',
  ret: 'Hết',
  times: 'lần',
  minutes: 'phút',
  tileTotal: 'Số lần xuất hiện',
  tileUnacked: 'Chưa xác nhận',
  tileMeanAck: 'TB tới xác nhận',
  tileActive: 'Đang còn',
  byPriority: 'Theo mức ưu tiên',
  byArea: 'Theo khu vực',
  top: 'Top 10 alarm xảy ra nhiều nhất',
  events: 'Danh sách sự kiện',
  priority: 'Mức',
  area: 'Khu vực',
  alarm: 'Alarm',
  text: 'Nội dung',
  count: 'Số lần',
  unacked: 'Chưa xác nhận',
  meanAck: 'TB tới xác nhận (phút)',
  time: 'Thời điểm',
  event: 'Sự kiện',
  user: 'Người xác nhận',
  noArea: '(không khu)',
  chartAlarm: 'Số lần xuất hiện',
  priorities: {
    critical: 'Khẩn cấp',
    major: 'Quan trọng',
    minor: 'Nhỏ',
    advisory: 'Lưu ý',
  } as Record<string, string>,
  truncated: (n: number) =>
    `Chỉ đọc ${formatNumber(n, 0)} lần xảy ra đầu tiên của kỳ: thống kê trên phần đã đọc.`,
  listCapped: (n: number) => `Danh sách sự kiện chỉ hiện ${formatNumber(n, 0)} sự kiện đầu.`,
  // logic
  ok: 'Thành công',
  failed: 'Lỗi',
  blocked: 'Bị chặn',
  tileWrites: 'Lệnh ghi PLC',
  byRule: 'Theo luật',
  rule: 'Luật',
  tag: 'Tag',
  value: 'Giá trị',
  result: 'Kết quả',
  total: 'Tổng',
  last: 'Lần cuối',
  chartLogic: 'Lệnh ghi PLC',
  logicTruncated: (n: number) =>
    `Chỉ đọc ${formatNumber(n, 0)} lệnh ghi đầu tiên của kỳ: thống kê trên phần đã đọc.`,
};
export type EventWords = typeof EVENT_WORDS;

/** Trần đọc: lần xảy ra alarm, lệnh ghi logic, dòng của danh sách sự kiện. */
export const EVENT_LIMITS = { alarms: 5000, logic: 5000, list: 1000 } as const;
const PRIORITY_ORDER = ['critical', 'major', 'minor', 'advisory'];

interface Base {
  template: ReportTemplate;
  select: ReportSelection;
  tz: string;
  now: number;
  shiftWord?: string;
  weekWord?: string;
  words?: Partial<EventWords>;
  org?: string;
}

const int = (n: number) => formatNumber(n, 0);

/** Khung chung: hàng theo kỳ, cột đếm (chữ thuần, 0 số lẻ), dòng tổng. */
function countTable(
  b: Base,
  req: ReportRequest,
  labels: string[],
  /** chỉ số hàng của thời điểm (−1: ngoài kỳ) → cộng 1 vào cột `col`. */
  hits: Array<{ ts: number; col: number }>,
): ReportTable {
  const columns: ReportColumnOut[] = labels.map((label, k) => ({
    key: `c${k}`,
    tagId: '',
    fn: 'count',
    label,
    unit: '',
    decimals: 0,
    plain: true,
  }));
  const counts = req.rows.map(() => labels.map(() => 0));
  for (const h of hits) {
    const i = req.rows.findIndex((r) => h.ts >= r.start && h.ts < r.end);
    if (i >= 0) counts[i]![h.col]! += 1;
  }
  const totals = labels.map(() => 0);
  const rows: ReportRowOut[] = req.rows.map((r, i) => {
    const pending = r.start >= b.now;
    const cells = pending ? labels.map(() => null) : counts[i]!;
    if (!pending) cells.forEach((v, k) => (totals[k]! += v ?? 0));
    return {
      label: r.label,
      cells,
      text: cells.map((v) => (v === null ? '' : int(v))),
      coverage: 0,
      pending,
    };
  });
  const tpl = b.template;
  const t: ReportTable = {
    title: tpl.title ?? tpl.name,
    footer: tpl.footer ?? '',
    periodLabel: req.periodLabel,
    columns,
    rows,
    totals: tpl.totals === false ? null : totals,
    totalsText: tpl.totals === false ? null : totals.map(int),
    coverage: 0,
    generatedAt: b.now,
    tz: b.tz,
    kind: tpl.kind ?? 'table',
    showCoverage: false,
    sections: [],
    notes: [],
  };
  if (b.org) t.org = b.org;
  return t;
}

const tilesOrNone = (b: Base, tiles: ReportTile[]): ReportTile[] =>
  b.template.tiles === false ? [] : tiles;

function barChart(
  b: Base,
  t: ReportTable,
  title: string,
  series: Array<{ name: string; col: number }>,
): ReportTable['chart'] {
  if (b.template.chart === 'none' || t.rows.length < 2) return null;
  return {
    kind: b.template.chart === 'line' ? 'line' : 'bar',
    title,
    unit: '',
    decimals: 0,
    categories: t.rows.map((r) => r.label),
    series: series.map((s) => ({
      name: s.name,
      values: t.rows.map((r) => (r.pending ? null : (r.cells[s.col] ?? null))),
    })),
  };
}

const section = (
  title: string,
  columns: Array<[string, boolean]>,
  rows: Array<Array<string | number | null>>,
): ReportSection => ({
  title,
  columns: columns.map(([label, numeric]) => (numeric ? { label, numeric } : { label })),
  rows: rows.map((r) =>
    r.map((v) =>
      v === null ? '' : typeof v === 'number' ? formatNumber(v, Number.isInteger(v) ? 0 : 1) : v,
    ),
  ),
  values: rows.map((r) => r.map((v) => (typeof v === 'number' ? v : null))),
});

// ---- alarm ----------------------------------------------------------------------------------------------------------

export interface AlarmReportInput extends Base {
  items: readonly AlarmOccurrence[];
  /** Đã dừng ở trần đọc (EVENT_LIMITS.alarms). */
  truncated?: boolean;
}

/** Báo cáo alarm: đếm xuất hiện, xác nhận, hết theo hàng; thẻ; thống kê theo mức, khu, top 10; danh sách sự kiện. */
export function alarmReport(input: AlarmReportInput): ReportTable {
  const w: EventWords = { ...EVENT_WORDS, ...input.words };
  const tzMs = parseUtcOffset(input.tz);
  const req = reportRequest(input.template, input.select, tzMs, input.shiftWord, input.weekWord);
  const inside = (ts: number | null): ts is number =>
    ts !== null && ts >= req.from && ts < req.to && ts < input.now;
  const occ = input.items.filter((o) => inside(o.tsActive));
  const hits: Array<{ ts: number; col: number }> = [];
  for (const o of input.items) {
    if (inside(o.tsActive)) hits.push({ ts: o.tsActive, col: 0 });
    if (inside(o.tsAck)) hits.push({ ts: o.tsAck, col: 1 });
    if (inside(o.tsReturn)) hits.push({ ts: o.tsReturn, col: 2 });
  }
  const t = countTable(input, req, [w.appear, w.ack, w.ret], hits);
  const prio = (p: string) => w.priorities[p] ?? p;
  const ackMinutes = (list: readonly AlarmOccurrence[]) => {
    const d = list
      .filter((o) => o.tsAck !== null && o.tsAck >= o.tsActive)
      .map((o) => (o.tsAck! - o.tsActive) / 60_000);
    return d.length === 0 ? null : d.reduce((a, x) => a + x, 0) / d.length;
  };
  const unacked = (list: readonly AlarmOccurrence[]) => list.filter((o) => o.tsAck === null).length;
  const mean = ackMinutes(occ);
  t.tiles = tilesOrNone(input, [
    { label: w.tileTotal, value: occ.length, text: int(occ.length), unit: w.times, color: 'rose' },
    {
      label: w.tileUnacked,
      value: unacked(occ),
      text: int(unacked(occ)),
      unit: w.times,
      color: 'orange',
    },
    {
      label: w.tileMeanAck,
      value: mean,
      text: mean === null ? '–' : formatNumber(mean, 1),
      unit: w.minutes,
      color: 'blue',
    },
    {
      label: w.tileActive,
      value: occ.filter((o) => o.tsReturn === null).length,
      text: int(occ.filter((o) => o.tsReturn === null).length),
      unit: w.times,
      color: 'violet',
    },
  ]);
  t.chart = barChart(input, t, w.chartAlarm, [{ name: w.appear, col: 0 }]);

  // theo mức (nặng trước; mức lạ cuối), theo khu (nhiều trước, không khu cuối), top 10
  const groupBy = <K>(key: (o: AlarmOccurrence) => K) => {
    const m = new Map<K, AlarmOccurrence[]>();
    for (const o of occ) {
      const k = key(o);
      const arr = m.get(k);
      if (arr) arr.push(o);
      else m.set(k, [o]);
    }
    return m;
  };
  const rank = (p: string) => {
    const i = PRIORITY_ORDER.indexOf(p);
    return i < 0 ? PRIORITY_ORDER.length : i;
  };
  const byPrio = [...groupBy((o) => o.priority)].sort((a, b) => rank(a[0]) - rank(b[0]));
  const meanText = (list: AlarmOccurrence[]) => {
    const m = ackMinutes(list);
    return m === null ? '–' : formatNumber(m, 1);
  };
  const byArea = [...groupBy((o) => o.area)].sort(
    (a, b) =>
      b[1].length - a[1].length ||
      (a[0] === null ? 1 : 0) - (b[0] === null ? 1 : 0) ||
      String(a[0]).localeCompare(String(b[0])),
  );
  const top = [...groupBy((o) => o.alarmId)]
    .sort((a, b) => b[1].length - a[1].length || a[1][0]!.name.localeCompare(b[1][0]!.name))
    .slice(0, 10);

  type Ev = { ts: number; word: string; o: AlarmOccurrence; user: string };
  const evs: Ev[] = [];
  for (const o of input.items) {
    if (inside(o.tsActive)) evs.push({ ts: o.tsActive, word: w.appear, o, user: '' });
    if (inside(o.tsAck)) evs.push({ ts: o.tsAck, word: w.ack, o, user: o.ackUser ?? '' });
    if (inside(o.tsReturn)) evs.push({ ts: o.tsReturn, word: w.ret, o, user: '' });
  }
  evs.sort((a, b) => a.ts - b.ts);
  const time = (ts: number) => `${formatLocal(ts, tzMs, 'dm')} ${formatLocal(ts, tzMs, 'time')}`;
  t.sections = [
    section(
      w.byPriority,
      [
        [w.priority, false],
        [w.count, true],
        [w.unacked, true],
        [w.meanAck, true],
      ],
      byPrio.map(([p, list]) => [prio(p), list.length, unacked(list), meanText(list)]),
    ),
    section(
      w.byArea,
      [
        [w.area, false],
        [w.count, true],
        [w.unacked, true],
      ],
      byArea.map(([a, list]) => [a ?? w.noArea, list.length, unacked(list)]),
    ),
    section(
      w.top,
      [
        [w.alarm, false],
        [w.text, false],
        [w.priority, false],
        [w.count, true],
      ],
      top.map(([, list]) => [list[0]!.name, list[0]!.text, prio(list[0]!.priority), list.length]),
    ),
    section(
      w.events,
      [
        [w.time, false],
        [w.event, false],
        [w.alarm, false],
        [w.priority, false],
        [w.area, false],
        [w.text, false],
        [w.user, false],
      ],
      evs
        .slice(0, EVENT_LIMITS.list)
        .map((e) => [
          time(e.ts),
          e.word,
          e.o.name,
          prio(e.o.priority),
          e.o.area ?? '',
          e.o.text,
          e.user,
        ]),
    ),
  ];
  if (input.truncated) t.notes!.push(w.truncated(EVENT_LIMITS.alarms));
  if (evs.length > EVENT_LIMITS.list) t.notes!.push(w.listCapped(EVENT_LIMITS.list));
  return t;
}

// ---- thiết bị: số lần bật -------------------------------------------------------------------------------------------

const isOn = (v: unknown): boolean | null =>
  v === null || v === undefined ? null : v === true || (typeof v === 'number' && v !== 0);

/**
 * Số lần bật (cạnh lên) theo hàng của kỳ cho mỗi Tag, trên dòng thô `[seq, ts, v1, v2, …]` (cột theo thứ tự `tags`, đã
 * sắp theo thời gian). Trạng thái trước dòng đầu không biết: lần bật ở dòng đầu không đếm. `complete` false (chưa đọc
 * hết kỳ): mọi ô null.
 */
export function countStarts(
  rows: ReadonlyArray<ReadonlyArray<number | boolean | null>>,
  tags: readonly string[],
  req: Pick<ReportRequest, 'rows'>,
  complete: boolean,
): Record<string, Array<number | null>> {
  const out: Record<string, Array<number | null>> = {};
  for (const t of tags) out[t] = req.rows.map(() => (complete ? 0 : null));
  if (!complete) return out;
  const prev: Array<boolean | null> = tags.map(() => null);
  for (const row of rows) {
    const ts = row[1] as number;
    const i = req.rows.findIndex((r) => ts >= r.start && ts < r.end);
    tags.forEach((t, k) => {
      const on = isOn(row[k + 2]);
      if (on === null) return;
      if (on && prev[k] === false && i >= 0) out[t]![i]! += 1;
      prev[k] = on;
    });
  }
  return out;
}

// ---- logic ----------------------------------------------------------------------------------------------------------

export interface LogicReportInput extends Base {
  events: readonly LogicEvent[];
  truncated?: boolean;
}

/** Nhóm kết quả: 0 thành công, 1 lỗi, 2 bị chặn (ghi bị tắt, giới hạn). */
function outcome(e: LogicEvent): 0 | 1 | 2 {
  if (e.action !== 'logic.write' || e.result === 'denied') return 2;
  return e.result === 'ok' ? 0 : 1;
}

function valueOf(detail: string | null): string {
  if (!detail) return '';
  try {
    const v = (JSON.parse(detail) as { value?: unknown }).value;
    return v === undefined || v === null ? '' : typeof v === 'object' ? '' : String(v);
  } catch {
    return '';
  }
}

/** Báo cáo ghi PLC của logic: đếm thành công, lỗi, bị chặn theo hàng; thẻ; theo luật; danh sách. */
export function logicReport(input: LogicReportInput): ReportTable {
  const w: EventWords = { ...EVENT_WORDS, ...input.words };
  const tzMs = parseUtcOffset(input.tz);
  const req = reportRequest(input.template, input.select, tzMs, input.shiftWord, input.weekWord);
  const evs = input.events
    .filter((e) => e.ts >= req.from && e.ts < req.to && e.ts < input.now)
    .filter((e) => !(e.action === 'logic.write' && e.result === 'started'))
    .slice()
    .sort((a, b) => a.ts - b.ts || a.id - b.id);
  const t = countTable(
    input,
    req,
    [w.ok, w.failed, w.blocked],
    evs.map((e) => ({ ts: e.ts, col: outcome(e) })),
  );
  const n = [0, 0, 0];
  for (const e of evs) n[outcome(e)]! += 1;
  t.tiles = tilesOrNone(input, [
    { label: w.tileWrites, value: evs.length, text: int(evs.length), unit: w.times, color: 'blue' },
    { label: w.ok, value: n[0]!, text: int(n[0]!), unit: w.times, color: 'green' },
    { label: w.failed, value: n[1]!, text: int(n[1]!), unit: w.times, color: 'rose' },
    { label: w.blocked, value: n[2]!, text: int(n[2]!), unit: w.times, color: 'orange' },
  ]);
  t.chart = barChart(input, t, w.chartLogic, [
    { name: w.ok, col: 0 },
    { name: w.failed, col: 1 },
    { name: w.blocked, col: 2 },
  ]);
  const byRule = new Map<string, { n: number[]; last: number }>();
  for (const e of evs) {
    const r = byRule.get(e.rule) ?? { n: [0, 0, 0], last: 0 };
    r.n[outcome(e)]! += 1;
    r.last = Math.max(r.last, e.ts);
    byRule.set(e.rule, r);
  }
  const time = (ts: number) => `${formatLocal(ts, tzMs, 'dm')} ${formatLocal(ts, tzMs, 'time')}`;
  const word = [w.ok, w.failed, w.blocked];
  t.sections = [
    section(
      w.byRule,
      [
        [w.rule, false],
        [w.total, true],
        [w.ok, true],
        [w.failed, true],
        [w.blocked, true],
        [w.last, false],
      ],
      [...byRule]
        .sort((a, b) => sum(b[1].n) - sum(a[1].n) || a[0].localeCompare(b[0]))
        .map(([rule, r]) => [rule, sum(r.n), r.n[0]!, r.n[1]!, r.n[2]!, time(r.last)]),
    ),
    section(
      w.events,
      [
        [w.time, false],
        [w.rule, false],
        [w.tag, false],
        [w.value, false],
        [w.result, false],
      ],
      evs
        .slice(0, EVENT_LIMITS.list)
        .map((e) => [time(e.ts), e.rule, e.tag ?? '', valueOf(e.detail), word[outcome(e)]!]),
    ),
  ];
  if (input.truncated) t.notes!.push(w.logicTruncated(EVENT_LIMITS.logic));
  if (evs.length > EVENT_LIMITS.list) t.notes!.push(w.listCapped(EVENT_LIMITS.list));
  return t;
}

const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);
