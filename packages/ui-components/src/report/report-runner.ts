// Dựng MỘT ReportTable cho một mẫu và một kỳ (feature 015, specs/015-reports/plan.md): dùng chung cho trang Báo cáo của
// runtime-web và khung Xem trước của trình thiết kế báo cáo trong Studio (Constitution II: một nơi lấy dữ liệu và tính).
// Theo loại mẫu: bảng tổng hợp (`aggregate`, lô ≤ 16 Tag), thiết bị (giờ chạy từ `aggregate`, số lần bật đếm trên dòng
// thô `rows` tới trần 20 × 500 dòng), alarm và logic (nguồn sự kiện của nơi gọi). Phép tính ở @mat/history-math.
import {
  EVENT_LIMITS,
  alarmReport,
  buildReport,
  countStarts,
  logicReport,
  parseUtcOffset,
  reportRequest,
  type AggregateResult as MathAggregate,
  type AlarmOccurrence,
  type LogicEvent,
  type ReportFn,
  type ReportSelection,
  type ReportTable,
  type ReportTemplate,
} from '@mat/history-math';
import type { HistorySource } from '../host/history-source.ts';

/** Nguồn sự kiện của báo cáo alarm và logic. Lỗi mang `code` (`ACCESS_DENIED`, `NOT_SUPPORTED`…). */
export interface ReportEventSource {
  alarms(
    from: number,
    to: number,
    max: number,
    signal: AbortSignal,
  ): Promise<{ items: AlarmOccurrence[]; truncated: boolean }>;
  logic(
    from: number,
    to: number,
    max: number,
    signal: AbortSignal,
  ): Promise<{ events: LogicEvent[]; truncated: boolean; enabled: boolean }>;
}

export interface RunReportInput {
  template: ReportTemplate & { group?: string };
  select: ReportSelection;
  /** Múi giờ của báo cáo (`±HH:MM`): của nhóm lưu trữ, hoặc của thiết bị/trình duyệt với alarm, logic. */
  tz: string;
  now: number;
  signal: AbortSignal;
  history?: HistorySource;
  events?: ReportEventSource;
  shiftWord?: string;
  fnNames?: Partial<Record<ReportFn, string>>;
  coverageLabel?: string;
  org?: string;
  tagInfo?: (tagId: string) => { description?: string; unit?: string } | undefined;
  /** Chữ ghi chú (i18n của ứng dụng). */
  notes?: { startsCapped?: string; noLogic?: string };
}

export const MAX_ROW_PAGES = 20;
export const ROWS_PER_PAGE = 500;

const unsupported = () => Object.assign(new Error('NOT_SUPPORTED'), { code: 'NOT_SUPPORTED' });

/** Báo cáo của mẫu cho kỳ đã chọn (kỳ phải hợp lệ: `validSelection`). */
export async function runReport(o: RunReportInput): Promise<ReportTable> {
  const tpl = o.template;
  const kind = tpl.kind ?? 'table';
  const req = reportRequest(tpl, o.select, parseUtcOffset(o.tz), o.shiftWord);
  if (kind === 'alarm' || kind === 'logic') {
    if (!o.events) throw unsupported();
    const base = {
      template: tpl,
      select: o.select,
      tz: o.tz,
      now: o.now,
      ...(o.shiftWord ? { shiftWord: o.shiftWord } : {}),
      ...(o.org ? { org: o.org } : {}),
    };
    const to = Math.min(req.to, o.now);
    if (kind === 'alarm') {
      const r = await o.events.alarms(req.from, to, EVENT_LIMITS.alarms, o.signal);
      return alarmReport({ ...base, items: r.items, truncated: r.truncated });
    }
    const r = await o.events.logic(req.from, to, EVENT_LIMITS.logic, o.signal);
    const t = logicReport({ ...base, events: r.events, truncated: r.truncated });
    if (!r.enabled && o.notes?.noLogic) t.notes = [...(t.notes ?? []), o.notes.noLogic];
    return t;
  }

  const hist = o.history;
  const group = tpl.group;
  if (!hist || !group) throw unsupported();
  const aggs = (await Promise.all(
    req.batches.map((tags) =>
      hist.aggregate(
        {
          group,
          tags,
          from: req.from,
          to: req.to,
          bucketMs: req.bucketMs,
          offsetMs: req.offsetMs,
          priority: 'user',
        },
        o.signal,
      ),
    ),
  )) as unknown as MathAggregate[];

  // số lần bật (hàm starts): cạnh lên trên dòng thô, đọc theo trang tới trần
  const startTags = [
    ...new Set(
      (tpl.columns ?? []).filter((c) => c.functions.includes('starts')).map((c) => c.tagId),
    ),
  ];
  let starts: Record<string, Array<number | null>> | undefined;
  let capped = false;
  if (startTags.length > 0) {
    const rows: Array<Array<number | boolean | null>> = [];
    let after: number | undefined;
    let complete = false;
    const to = Math.min(req.to, o.now);
    for (let page = 0; page < MAX_ROW_PAGES && to > req.from; page++) {
      const r = await hist.rows(
        {
          group,
          tags: startTags,
          from: req.from,
          to,
          limit: ROWS_PER_PAGE,
          order: 'asc',
          ...(after !== undefined ? { after } : {}),
          priority: 'user',
        },
        o.signal,
      );
      for (const row of r.rows) rows.push(row.map((v) => (typeof v === 'string' ? null : v)));
      if (r.next === null) {
        complete = true;
        break;
      }
      after = r.next;
    }
    if (to <= req.from) complete = true;
    capped = !complete;
    starts = countStarts(rows, startTags, req, complete);
  }
  const tagInfo: Record<string, { description?: string; unit?: string }> = {};
  for (const c of tpl.columns ?? []) {
    const i = o.tagInfo?.(c.tagId);
    if (i) tagInfo[c.tagId] = i;
  }
  const t = buildReport({
    template: tpl,
    select: o.select,
    tz: o.tz,
    now: o.now,
    ...(o.shiftWord ? { shiftWord: o.shiftWord } : {}),
    tagInfo,
    aggregates: aggs,
    ...(starts ? { starts } : {}),
    ...(o.fnNames ? { fnNames: o.fnNames } : {}),
    ...(o.coverageLabel ? { coverageLabel: o.coverageLabel } : {}),
    ...(o.org ? { org: o.org } : {}),
  });
  if (capped && o.notes?.startsCapped) t.notes = [...(t.notes ?? []), o.notes.startsCapped];
  return t;
}
