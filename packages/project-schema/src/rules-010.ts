// Luật của feature 010: mẫu báo cáo (E_RPT_*, E_NAV_REPORT) và widget lịch sử (E_WIDGET_HISTORY_*, tổ hợp
// bucket/period). Bản C++ (core/project-manager/rules_010.*) cho cùng mã và vị trí trên tests/project-vectors
// (v06-report-*) và tests/widget-catalog-vectors (history-*).
import type { ErrorCode, Issue } from './codes.ts';
import { SHIFT_COUNTS, REPORT_LIMITS, type ReportsConfig } from './reports.ts';
import type { LoggingConfig, LoggingGroup, TagDataType } from './types.ts';

const SHIFT_START = /^([01]\d|2[0-3]):[0-5]\d$/;
const isNumOrBool = (t: TagDataType | undefined) => t !== undefined && t !== 'STRING';

/**
 * Luật reports.json. `logging` là undefined khi project không có `loggingFile` (`hasLoggingFile` false: nhóm không tra
 * được: E_RPT_REF_GROUP) hoặc khi file đó lỗi (`hasLoggingFile` true: bỏ qua luật cần nó).
 */
export function reportRules(
  cfg: ReportsConfig,
  file: string,
  logging: LoggingConfig | undefined,
  hasLoggingFile: boolean,
  tagTypes: Map<string, TagDataType> | undefined,
): Issue[] {
  const out: Issue[] = [];
  const add = (code: ErrorCode, path: string, message: string) =>
    out.push({ code, file, path, message });
  const ids = new Set<string>();
  cfg.reports.forEach((r, i) => {
    const p = `/reports/${i}`;
    if (ids.has(r.id)) add('E_RPT_DUP_ID', `${p}/id`, `id '${r.id}' bị trùng`);
    ids.add(r.id);

    // kỳ và ca
    if (r.period === 'shift') {
      if (r.shifts === undefined) add('E_RPT_PERIOD', p, 'kỳ shift cần shifts');
      else if (!SHIFT_COUNTS.includes(r.shifts.count) || !SHIFT_START.test(r.shifts.start))
        add('E_RPT_SHIFT', `${p}/shifts`, 'count thuộc {2, 3, 4, 6, 8, 12} và start dạng HH:MM');
    } else if (r.shifts !== undefined) add('E_RPT_PERIOD', p, 'shifts chỉ dùng với kỳ shift');
    if (r.rowMinutes !== undefined && r.period !== 'day')
      add('E_RPT_PERIOD', p, 'rowMinutes chỉ dùng với kỳ day');

    // hàm lặp, số cột
    let pairs = 0;
    r.columns.forEach((c, j) => {
      const seen = new Set<string>();
      c.functions.forEach((f, k) => {
        if (seen.has(f)) add('E_RPT_FN', `${p}/columns/${j}/functions/${k}`, `hàm '${f}' lặp`);
        seen.add(f);
      });
      pairs += c.functions.length;
    });
    if (
      pairs > REPORT_LIMITS.columns ||
      new Set(r.columns.map((c) => c.tagId)).size > REPORT_LIMITS.tags
    )
      add('E_RPT_LIMIT', `${p}/columns`, 'quá 24 cột (Tag x hàm) hoặc quá 24 Tag');

    // nhóm và Tag
    if (logging === undefined) {
      if (!hasLoggingFile) add('E_RPT_REF_GROUP', `${p}/group`, 'project không có logging.json');
      return;
    }
    const g = logging.groups.find((x) => x.id === r.group);
    if (!g) return add('E_RPT_REF_GROUP', `${p}/group`, `không có nhóm '${r.group}'`);
    if (g.aggregates === undefined)
      return add('E_RPT_NO_AGG', `${p}/group`, `nhóm '${g.id}' không bật tổng hợp`);
    r.columns.forEach((c, j) => {
      const lt = g.tags.find((t) => t.tagId === c.tagId);
      const cp = `${p}/columns/${j}/tagId`;
      if (!lt) return add('E_RPT_REF_TAG', cp, `Tag '${c.tagId}' không thuộc nhóm '${g.id}'`);
      if (lt.aggregate === false || (tagTypes && !isNumOrBool(tagTypes.get(c.tagId))))
        add('E_RPT_NO_AGG', cp, `Tag '${c.tagId}' không được tổng hợp`);
    });
  });
  return out;
}

export interface HistoryCtx {
  logging: LoggingConfig | undefined;
  hasLoggingFile: boolean;
}

interface HistorySlot {
  name: string;
  types: string[];
  inGroup?: string;
  needsAggregate?: boolean;
}

const BAR_PERIODS: Record<string, string[]> = {
  hour: ['last24h', 'today', 'yesterday'],
  shift: ['last24h', 'last7d', 'today', 'yesterday', 'thisShift', 'lastShift'],
  day: ['last7d', 'last30d', 'thisMonth', 'lastMonth'],
};
const MAX_CATEGORIES = 48;

/**
 * Luật widget lịch sử (danh mục 0.5.0). \`tagClass\`/\`tagType\` tra Tag trong tags.json (undefined: Tag không có,
 * E_REF_TAG đã báo). Trả mã và đường dẫn tương đối \`p\` (\`/items/<i>\`).
 */
export function historyWidgetRules(
  widget: string,
  p: string,
  slots: HistorySlot[],
  props: Record<string, unknown>,
  tagsObj: Record<string, unknown>,
  ctx: HistoryCtx,
  classOf: (tagId: string) => string | undefined,
  add: (code: ErrorCode, path: string, message: string) => void,
): void {
  // tổ hợp thuộc tính của biểu đồ cột và tròn
  if (widget === 'history-bar' || widget === 'history-pie') {
    const sc = props.shiftCount;
    if (
      typeof sc === 'number' &&
      Number.isInteger(sc) &&
      sc >= 2 &&
      sc <= 12 &&
      !SHIFT_COUNTS.includes(sc)
    )
      add('E_WIDGET_PROP', `${p}/props/shiftCount`, 'shiftCount thuộc {2, 3, 4, 6, 8, 12}');
  }
  if (widget === 'history-bar') {
    const bucket = (props.bucket ?? 'shift') as string;
    const period = (props.period ?? 'last7d') as string;
    const allowed = BAR_PERIODS[bucket];
    if (allowed !== undefined && typeof period === 'string' && PERIODS.has(period)) {
      const count = typeof props.shiftCount === 'number' ? props.shiftCount : 3;
      if (!allowed.includes(period))
        add('E_WIDGET_PROP', `${p}/props/period`, `bucket ${bucket} không đi với period ${period}`);
      else if (bucket === 'shift' && period === 'last7d' && count * 7 > MAX_CATEGORIES)
        add('E_WIDGET_PROP', `${p}/props/period`, 'quá 48 hạng mục (shiftCount x 7)');
    }
  }

  // nhóm lưu trữ
  const gid = props.group;
  if (gid === undefined)
    return add('E_WIDGET_HISTORY_GROUP', `${p}/props`, 'thiếu thuộc tính group');
  if (typeof gid !== 'string' || gid === '') return; // E_WIDGET_PROP do kiểm giá trị thuộc tính
  let group: LoggingGroup | undefined;
  if (ctx.logging) group = ctx.logging.groups.find((g) => g.id === gid);
  else if (ctx.hasLoggingFile) return; // logging.json lỗi: bỏ qua luật cần nó
  if (!group)
    return add('E_WIDGET_HISTORY_GROUP', `${p}/props/group`, `không có nhóm lưu trữ '${gid}'`);
  for (const slot of slots) {
    if (slot.inGroup !== 'group') continue;
    const v = tagsObj[slot.name];
    if (!Array.isArray(v)) continue;
    v.forEach((id, k) => {
      if (typeof id !== 'string') return;
      const cls = classOf(id);
      if (cls === undefined || !slot.types.includes(cls)) return; // E_REF_TAG, E_WIDGET_TAG_TYPE
      const lt = group.tags.find((t) => t.tagId === id);
      const path = `${p}/tags/${slot.name}/${k}`;
      if (!lt) add('E_WIDGET_HISTORY_TAG', path, `Tag '${id}' không thuộc nhóm '${gid}'`);
      else if (slot.needsAggregate && (group.aggregates === undefined || lt.aggregate === false))
        add('E_WIDGET_HISTORY_AGG', path, `Tag '${id}' không có tổng hợp trong nhóm '${gid}'`);
    });
  }
}

const PERIODS = new Set([
  'last24h',
  'last7d',
  'last30d',
  'today',
  'yesterday',
  'thisShift',
  'lastShift',
  'thisMonth',
  'lastMonth',
]);
