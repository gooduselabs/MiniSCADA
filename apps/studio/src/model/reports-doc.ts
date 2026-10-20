// Mô hình tài liệu của editor Mẫu báo cáo (feature 010, US8, T132; contracts/templates-config.md §2, studio-010.md §2): hàm thuần
// trên `ReportsConfig`, mỗi hàm cho ra cấu hình mới (người gọi gói thành MỘT sửa đổi `{ kind: 'reports' }`, một bước hoàn tác).
// Chỉ nhóm có `aggregates` và Tag số hoặc BOOL có `aggregate ≠ false` được chọn; hàm mờ theo kiểu Tag; ca chỉ trong
// {2, 3, 4, 6, 8, 12}. Giá trị sai luật (id trùng, ca sai khi gõ tay…) vẫn ghi để bộ kiểm tra báo lỗi theo ô (FR-054).
import {
  EQUIPMENT_FNS,
  SHIFT_COUNTS,
  type LoggingConfig,
  type ReportChartKind,
  type ReportColumn,
  type ReportFn,
  type ReportKind,
  type ReportPeriod,
  type ReportTemplate,
  type ReportsConfig,
  type TagDataType,
} from '@mat/project-schema';
import { fold, t } from '../i18n/index.ts';
import type { ApplyResult, CellChange, GridAdapter, GridColumn, Rejected } from './grid/types.ts';
import type { ProjectEdit } from './project-doc.ts';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Hàm của mẫu bảng theo thứ tự chuẩn; onTime (giờ ON của BOOL) cần định dạng 1.1 (feature 015). */
export const REPORT_FNS: readonly ReportFn[] = [
  'min',
  'max',
  'avg',
  'sum',
  'first',
  'last',
  'delta',
  'count',
  'onTime',
];
/** Hàm theo loại mẫu: bảng (REPORT_FNS), thiết bị (giờ chạy, số lần bật), alarm/logic (không có cột). */
export function fnsFor(kind: ReportKind | undefined): readonly ReportFn[] {
  return kind === 'equipment'
    ? EQUIPMENT_FNS
    : kind === 'alarm' || kind === 'logic'
      ? []
      : REPORT_FNS;
}
export const MAX_REPORTS = 16;
export const MAX_COLUMNS = 24;
/** reports.json mới mang đúng phiên bản của project.json (mọi file phải cùng phiên bản, E_SCHEMA_VERSION): định dạng 0.6. */
export const SCHEMA_VERSION = '0.6.0';
const START_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const reportsEdit = (value: ReportsConfig): ProjectEdit => ({ kind: 'reports', value });

// ---- nhóm và Tag được chọn -----------------------------------------------------------------------------------------

/** Nhóm có `aggregates` (chỉ nhóm này dựng được báo cáo). */
export function eligibleGroups(
  logging: LoggingConfig | null | undefined,
): Array<{ id: string; name: string }> {
  return (logging?.groups ?? [])
    .filter((g) => g.aggregates !== undefined)
    .map((g) => ({ id: g.id, name: g.name }));
}

/** Tag của nhóm làm được cột: `aggregate ≠ false`, không phải chuỗi (số hoặc BOOL), theo thứ tự trong nhóm. */
export function eligibleTags(
  logging: LoggingConfig | null | undefined,
  groupId: string,
  types: ReadonlyMap<string, TagDataType> | null,
): string[] {
  const g = logging?.groups.find((x) => x.id === groupId);
  if (!g || g.aggregates === undefined) return [];
  return g.tags
    .filter((x) => x.aggregate !== false && types?.get(x.tagId) !== 'STRING')
    .map((x) => x.tagId);
}

/**
 * Hàm tính được cho kiểu Tag và loại mẫu (mờ khi không): BOOL không có `delta`; `onTime`, `starts` chỉ cho BOOL;
 * `starts` chỉ ở mẫu thiết bị; chuỗi không có hàm nào; kiểu chưa biết cho phép (bộ kiểm tra báo lỗi nếu sai).
 */
export function fnApplicable(
  type: TagDataType | undefined,
  fn: ReportFn,
  kind: ReportKind = 'table',
): boolean {
  if (!fnsFor(kind).includes(fn)) return false;
  if (type === 'STRING') return false;
  if (fn === 'onTime' || fn === 'starts') return type === undefined || type === 'BOOL';
  if (type === 'BOOL') return fn !== 'delta';
  return true;
}

// ---- mẫu ------------------------------------------------------------------------------------------------------------

function uniqueId(cfg: ReportsConfig, base: string): string {
  const used = new Set(cfg.reports.map((r) => r.id));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Thêm mẫu trống; chưa có `reports.json` (`cfg` null) thì dựng cấu hình mới mang `schemaVersion` của project (mọi file
 * cùng phiên bản). Nhóm là nhóm đầu có tổng hợp.
 */
export function addReport(
  cfg: ReportsConfig | null,
  logging: LoggingConfig | null,
  schemaVersion: string = SCHEMA_VERSION,
): ReportsConfig {
  return addTemplate(cfg, schemaVersion, {
    id: 'bao-cao',
    name: '',
    group: eligibleGroups(logging)[0]?.id ?? '',
    period: 'day',
    rowMinutes: 60,
    totals: true,
    columns: [],
  });
}

/** Thêm một mẫu dựng sẵn (mẫu có sẵn của trình thiết kế): id không trùng, tên mặc định khi trống. */
export function addTemplate(
  cfg: ReportsConfig | null,
  schemaVersion: string,
  tpl: ReportTemplate,
): ReportsConfig {
  const next: ReportsConfig = cfg ? clone(cfg) : { schemaVersion, reports: [] };
  const r = clone(tpl);
  r.id = uniqueId(next, tpl.id);
  if (!r.name) r.name = t('rpt.defaultName', { n: next.reports.length + 1 });
  next.reports.push(r);
  return next;
}

/**
 * Đổi loại mẫu (định dạng 1.1): alarm, logic bỏ nhóm và cột; thiết bị giữ cột Tag BOOL với giờ chạy và số lần bật; bảng
 * bỏ hàm `starts`. `table` bỏ khóa (mặc định).
 */
export function setKind(
  cfg: ReportsConfig,
  index: number,
  kind: ReportKind,
  logging: LoggingConfig | null,
  types: ReadonlyMap<string, TagDataType> | null,
): ReportsConfig {
  return mapReport(cfg, index, (r) => {
    if (kind === 'table') delete r.kind;
    else r.kind = kind;
    if (kind === 'alarm' || kind === 'logic') {
      delete r.group;
      delete r.columns;
      return;
    }
    r.group ??= eligibleGroups(logging)[0]?.id ?? '';
    const cols = r.columns ?? [];
    if (kind === 'equipment')
      r.columns = cols
        .filter((c) => types?.get(c.tagId) === 'BOOL')
        .map((c) => ({ ...c, functions: ['onTime', 'starts'] as ReportFn[] }));
    else
      r.columns = cols
        .map((c) => ({ ...c, functions: c.functions.filter((f) => f !== 'starts') }))
        .filter((c) => c.functions.length > 0);
  });
}

/** Hàng thẻ tổng hợp: bật là mặc định (bỏ khóa). */
export function setTiles(cfg: ReportsConfig, index: number, on: boolean): ReportsConfig {
  return mapReport(cfg, index, (r) => {
    if (on) delete r.tiles;
    else r.tiles = false;
  });
}

/** Biểu đồ: `auto` (bỏ khóa, tự chọn theo cột), đường, cột, hoặc không có. */
export function setChart(
  cfg: ReportsConfig,
  index: number,
  chart: ReportChartKind | 'auto',
): ReportsConfig {
  return mapReport(cfg, index, (r) => {
    if (chart === 'auto') delete r.chart;
    else r.chart = chart;
  });
}

/** Tên đơn vị trên dải tiêu đề (chung cho mọi mẫu); rỗng thì bỏ khóa (dùng tên project). */
export function setOrg(cfg: ReportsConfig, org: string): ReportsConfig {
  const next = clone(cfg);
  if (org.trim() === '') delete next.org;
  else next.org = org.trim();
  return next;
}

export function duplicateReport(cfg: ReportsConfig, index: number): ReportsConfig {
  const src = cfg.reports[index];
  if (!src) return cfg;
  const next = clone(cfg);
  const copy = clone(src);
  copy.id = uniqueId(next, src.id);
  copy.name = t('rpt.copyName', { name: src.name });
  next.reports.splice(index + 1, 0, copy);
  return next;
}

export function removeReport(cfg: ReportsConfig, index: number): ReportsConfig {
  if (!cfg.reports[index]) return cfg;
  const next = clone(cfg);
  next.reports.splice(index, 1);
  return next;
}

function mapReport(
  cfg: ReportsConfig,
  index: number,
  fn: (r: ReportTemplate) => void,
): ReportsConfig {
  if (!cfg.reports[index]) return cfg;
  const next = clone(cfg);
  fn(next.reports[index]!);
  return next;
}

/** Đặt một trường chữ của mẫu; `title` và `footer` rỗng thì bỏ khóa. */
export function setReportField(
  cfg: ReportsConfig,
  index: number,
  field: 'id' | 'name' | 'group' | 'title' | 'footer',
  value: string,
): ReportsConfig {
  return mapReport(cfg, index, (r) => {
    if ((field === 'title' || field === 'footer') && value === '') delete r[field];
    else r[field] = value;
  });
}

export function setTotals(cfg: ReportsConfig, index: number, on: boolean): ReportsConfig {
  return mapReport(cfg, index, (r) => {
    r.totals = on;
  });
}

export function setPaper(
  cfg: ReportsConfig,
  index: number,
  patch: { size?: 'A4' | 'A3'; orientation?: 'portrait' | 'landscape' },
): ReportsConfig {
  return mapReport(cfg, index, (r) => {
    r.paper = { ...(r.paper ?? {}), ...patch };
  });
}

/** Đổi kỳ: đặt đúng các trường của kỳ mới (shift: 3 ca từ 06:00; day: 60 phút), bỏ trường của kỳ cũ. */
export function setPeriod(cfg: ReportsConfig, index: number, period: ReportPeriod): ReportsConfig {
  return mapReport(cfg, index, (r) => {
    r.period = period;
    if (period === 'day') {
      r.rowMinutes ??= 60;
      delete r.shifts;
    } else if (period === 'shift') {
      r.shifts ??= { count: 3, start: '06:00' };
      delete r.rowMinutes;
    } else {
      delete r.shifts;
      delete r.rowMinutes;
    }
  });
}

export function setRowMinutes(cfg: ReportsConfig, index: number, n: 15 | 30 | 60): ReportsConfig {
  return mapReport(cfg, index, (r) => {
    r.rowMinutes = n;
  });
}

/** Số ca từ chữ gõ: chỉ {2, 3, 4, 6, 8, 12} (số ca không chia đều 24 giờ bị từ chối). */
export function parseShiftCount(text: string): number | null {
  const s = text.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return SHIFT_COUNTS.includes(n) ? n : null;
}

/** Ghi `shifts` đúng như nhận (nhập tay sai vẫn ghi để bộ kiểm tra báo E_RPT_SHIFT theo ô). */
export function setShifts(
  cfg: ReportsConfig,
  index: number,
  patch: { count?: number; start?: string },
): ReportsConfig {
  return mapReport(cfg, index, (r) => {
    r.shifts = {
      count: patch.count ?? r.shifts?.count ?? 3,
      start: patch.start ?? r.shifts?.start ?? '06:00',
    };
  });
}

const hm = (min: number): string => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Nhãn ca hiện ngay khi sửa: "Ca 1 06:00–14:00"; rỗng khi số ca hay giờ bắt đầu chưa hợp lệ. */
export function shiftLabels(count: number, start: string): string[] {
  if (!SHIFT_COUNTS.includes(count) || !START_RE.test(start)) return [];
  const [h, m] = start.split(':').map(Number) as [number, number];
  const len = 1440 / count;
  return Array.from(
    { length: count },
    (_, i) =>
      `${t('rpt.shiftWord')} ${i + 1} ${hm(h * 60 + m + i * len)}–${hm(h * 60 + m + (i + 1) * len)}`,
  );
}

// ---- cột và hàm -----------------------------------------------------------------------------------------------------

export type RejectReason = 'dup' | 'notInGroup' | 'noAgg' | 'limit' | 'notBool' | 'noColumns';

/**
 * Thêm cột cho các Tag (kéo từ cây, gõ tên, dán): bỏ Tag trùng, Tag ngoài nhóm, Tag không tổng hợp, quá 24 cột. Hàm mặc định
 * là `avg`; BOOL: `onTime` (giờ chạy) ở định dạng 1.1, `sum` ở định dạng cũ. Mẫu thiết bị chỉ nhận Tag BOOL (giờ chạy và
 * số lần bật); mẫu alarm, logic không có cột.
 */
export function addColumns(
  cfg: ReportsConfig,
  index: number,
  tagIds: readonly string[],
  logging: LoggingConfig | null,
  types: ReadonlyMap<string, TagDataType> | null,
  format11 = false,
): { cfg: ReportsConfig; rejected: Array<{ tagId: string; reason: RejectReason }> } {
  const tpl = cfg.reports[index];
  if (!tpl) return { cfg, rejected: [] };
  const kind = tpl.kind ?? 'table';
  if (kind === 'alarm' || kind === 'logic')
    return { cfg, rejected: tagIds.map((tagId) => ({ tagId, reason: 'noColumns' as const })) };
  const ok = new Set(eligibleTags(logging, tpl.group ?? '', types));
  const inGroup = new Set(
    logging?.groups.find((g) => g.id === tpl.group)?.tags.map((x) => x.tagId) ?? [],
  );
  const next = clone(cfg);
  const cols = (next.reports[index]!.columns ??= []);
  const before = cols.length;
  const have = new Set(cols.map((c) => c.tagId));
  const rejected: Array<{ tagId: string; reason: RejectReason }> = [];
  for (const id of tagIds) {
    const bool = types?.get(id) === 'BOOL';
    if (have.has(id)) rejected.push({ tagId: id, reason: 'dup' });
    else if (!inGroup.has(id)) rejected.push({ tagId: id, reason: 'notInGroup' });
    else if (!ok.has(id)) rejected.push({ tagId: id, reason: 'noAgg' });
    else if (kind === 'equipment' && !bool) rejected.push({ tagId: id, reason: 'notBool' });
    else if (cols.length >= MAX_COLUMNS) rejected.push({ tagId: id, reason: 'limit' });
    else {
      have.add(id);
      const functions: ReportFn[] =
        kind === 'equipment'
          ? ['onTime', 'starts']
          : bool
            ? [format11 ? 'onTime' : 'sum']
            : ['avg'];
      cols.push(
        bool
          ? { tagId: id, unit: t('rpt.unit.hour'), decimals: 2, functions }
          : { tagId: id, functions },
      );
    }
  }
  return { cfg: cols.length === before ? cfg : next, rejected };
}

export function removeColumns(
  cfg: ReportsConfig,
  index: number,
  rows: readonly number[],
): ReportsConfig {
  const drop = new Set(rows);
  return mapReport(cfg, index, (r) => {
    r.columns = (r.columns ?? []).filter((_, i) => !drop.has(i));
  });
}

export function moveColumn(
  cfg: ReportsConfig,
  index: number,
  from: number,
  to: number,
): ReportsConfig {
  const cols = cfg.reports[index]?.columns;
  if (!cols || !cols[from] || to < 0 || to >= cols.length || from === to) return cfg;
  return mapReport(cfg, index, (r) => {
    const list = r.columns!;
    const [c] = list.splice(from, 1);
    list.splice(to, 0, c!);
  });
}

export function setColumnField(
  cfg: ReportsConfig,
  index: number,
  col: number,
  field: 'tagId' | 'label' | 'unit' | 'decimals',
  value: string | number | undefined,
): ReportsConfig {
  if (!cfg.reports[index]?.columns?.[col]) return cfg;
  return mapReport(cfg, index, (r) => {
    const c = r.columns![col]! as unknown as Record<string, unknown>;
    if (value === undefined || value === '') delete c[field];
    else c[field] = value;
  });
}

export function setColumnFunctions(
  cfg: ReportsConfig,
  index: number,
  col: number,
  fns: readonly ReportFn[],
): ReportsConfig {
  if (!cfg.reports[index]?.columns?.[col]) return cfg;
  return mapReport(cfg, index, (r) => {
    r.columns![col]!.functions = [...fns];
  });
}

/** Bật/tắt một hàm của cột, giữ thứ tự chuẩn (min, max, avg…); không cho bỏ hàm cuối cùng. */
export function toggleFunction(
  cfg: ReportsConfig,
  index: number,
  col: number,
  fn: ReportFn,
): ReportsConfig {
  const cur = cfg.reports[index]?.columns?.[col]?.functions;
  if (!cur) return cfg;
  const set = new Set(cur);
  if (set.has(fn)) set.delete(fn);
  else set.add(fn);
  if (set.size === 0) return cfg;
  return setColumnFunctions(
    cfg,
    index,
    col,
    [...REPORT_FNS, 'starts' as const].filter((f) => set.has(f)),
  );
}

/** Gợi ý đơn vị theo hàm (không tự suy từ Tag): kW + tích phân → kWh; BOOL + tích phân → giờ; số lượng không đơn vị. */
export function suggestUnit(fn: ReportFn, unit: string | undefined, type?: TagDataType): string {
  if (fn === 'count') return '';
  if (fn === 'onTime') return t('rpt.unit.hour');
  if (fn === 'starts') return t('rpt.unit.times');
  if (fn === 'sum') {
    if (type === 'BOOL') return t('rpt.unit.hour');
    const u = unit ?? '';
    if (u === 'kW' || u === 'MW' || u === 'W') return `${u}h`;
    if (u.endsWith('/h')) return u.slice(0, -2);
    return u;
  }
  return unit ?? '';
}

/** Tên hàm để hiện (tiếng Việt). */
export const fnLabel = (fn: ReportFn): string => t(`rpt.fn.${fn}`);

/** Hàm từ chữ gõ: mã (`avg`) hoặc tên tiếng Việt, không phân biệt hoa thường và dấu. */
export function parseFn(text: string): ReportFn | null {
  const s = fold(text.trim());
  return REPORT_FNS.find((f) => f === s || fold(fnLabel(f)) === s) ?? null;
}

// ---- lưới cột ------------------------------------------------------------------------------------------------------

export interface ColumnsAdapterOptions {
  cfg: ReportsConfig;
  /** Chỉ số mẫu của lưới. */
  index: number;
  logging: LoggingConfig | null;
  types: ReadonlyMap<string, TagDataType> | null;
  readOnly: boolean;
}

const rej = (c: CellChange, reason: string): Rejected => ({
  row: c.row,
  ...(c.newIndex !== undefined ? { newIndex: c.newIndex } : {}),
  col: c.col,
  text: c.text,
  reason,
});

export function columnsAdapter(o: ColumnsAdapterOptions): GridAdapter {
  const tpl = o.cfg.reports[o.index];
  const cols: ReportColumn[] = tpl?.columns ?? [];
  const columns: GridColumn[] = [
    { key: 'tag', label: t('rpt.col.tag'), kind: 'text', width: 220, mono: true, name: true },
    { key: 'label', label: t('rpt.col.label'), kind: 'text', width: 170 },
    { key: 'unit', label: t('rpt.col.unit'), kind: 'text', width: 80 },
    { key: 'decimals', label: t('rpt.col.decimals'), kind: 'number', width: 80, end: true },
    { key: 'fns', label: t('rpt.col.fns'), kind: 'text', width: 260 },
    { key: 'note', label: t('rpt.col.note'), kind: 'readonly', width: 160 },
  ];
  const typeOf = (row: number): TagDataType | undefined => {
    const id = cols[row]?.tagId;
    return id === undefined ? undefined : o.types?.get(id);
  };
  const text = (row: number, col: string): string => {
    const c = cols[row];
    if (!c) return '';
    switch (col) {
      case 'tag':
        return c.tagId;
      case 'label':
        return c.label ?? '';
      case 'unit':
        return c.unit ?? '';
      case 'decimals':
        return c.decimals === undefined ? '' : String(c.decimals);
      case 'fns':
        return c.functions.map(fnLabel).join(', ');
      case 'note':
        return typeOf(row) ?? (o.types ? t('rpt.tag.unknown') : '');
      default:
        return '';
    }
  };
  const apply = (changes: readonly CellChange[]): ApplyResult => {
    if (o.readOnly) return { edits: [], rejected: changes.map((c) => rej(c, 'rpt.err.readOnly')) };
    let cfg = o.cfg;
    const rejected: Rejected[] = [];
    const allowed = new Set(tpl ? eligibleTags(o.logging, tpl.group ?? '', o.types) : []);
    for (const c of changes) {
      const row = c.row;
      if (row === null || !cols[row]) {
        rejected.push(rej(c, 'rpt.err.row'));
        continue;
      }
      const txt = c.text.trim();
      switch (c.col) {
        case 'tag':
          if (txt === '') rejected.push(rej(c, 'rpt.err.tag'));
          else if (!allowed.has(txt)) rejected.push(rej(c, 'rpt.err.tagGroup'));
          else cfg = setColumnField(cfg, o.index, row, 'tagId', txt);
          break;
        case 'label':
        case 'unit':
          cfg = setColumnField(cfg, o.index, row, c.col, txt === '' ? undefined : c.text.trim());
          break;
        case 'decimals': {
          if (txt === '') {
            cfg = setColumnField(cfg, o.index, row, 'decimals', undefined);
            break;
          }
          const n = /^\d$/.test(txt) ? Number(txt) : NaN;
          if (!Number.isInteger(n) || n < 0 || n > 6) rejected.push(rej(c, 'rpt.err.decimals'));
          else cfg = setColumnField(cfg, o.index, row, 'decimals', n);
          break;
        }
        case 'fns': {
          const parts = txt
            .split(/[,;]/)
            .map((x) => x.trim())
            .filter((x) => x !== '');
          const fns = parts.map(parseFn);
          if (parts.length === 0 || fns.some((f) => f === null))
            rejected.push(rej(c, 'rpt.err.fn'));
          else if (fns.some((f) => !fnApplicable(typeOf(row), f!)))
            rejected.push(rej(c, 'rpt.err.fnType'));
          else cfg = setColumnFunctions(cfg, o.index, row, fns as ReportFn[]);
          break;
        }
        default:
          rejected.push(rej(c, 'rpt.err.readOnlyCell'));
      }
    }
    return { edits: cfg === o.cfg ? [] : [reportsEdit(cfg)], rejected };
  };
  return {
    columns,
    maxRows: MAX_COLUMNS,
    rowCount: () => cols.length,
    text,
    editable: (row, col) => !o.readOnly && !!cols[row] && col !== 'note',
    apply,
    remove: (rows) => [reportsEdit(removeColumns(o.cfg, o.index, rows))],
    searchText: (row) => `${cols[row]?.tagId ?? ''} ${cols[row]?.label ?? ''}`,
  };
}
