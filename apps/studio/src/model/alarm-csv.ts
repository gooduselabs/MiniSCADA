// Nhập và xuất CSV của lưới alarm (feature 009, T084, FR-074; contract studio-alarm-editor §3.2): cột nhận theo tên tiêu đề tiếng
// Việt hoặc khóa (`id`, `name`, `type`, `tag`, `device`, `trigger`, `on`, `HH`, `H`, `L`, `LL`, `deadband`, `onDelayS`,
// `offDelayS`, `class`, `area`, `text`, `enabled`), UTF-8 có hoặc không BOM, `,` hoặc `;` tự nhận; chế độ "Thay thế tất cả"
// hoặc "Thêm vào" (gộp theo `id`); lỗi theo dòng (cột thiếu, loại lạ, thừa cột). Xuất: tiêu đề tiếng Việt, thứ tự cột như
// lưới, trích dẫn RFC 4180, BOM, chống công thức (thêm `'`). Hàm thuần.
import { ALARM_LIMITS, ALARM_THRESHOLDS, type AlarmDef } from '@mat/project-schema';
import { fold, t } from '../i18n/index.ts';
import {
  ALARM_COLS,
  alarmFromCells,
  cellText,
  insertAlarms,
  type AlarmCol,
  type AlarmCtx,
  type AlarmDoc,
} from './alarm-doc.ts';
import { parseCsv, toCsv } from './grid/csv.ts';

export type CsvMode = 'replace' | 'append';

export interface CsvLineIssue {
  /** Số dòng trong tệp (dòng tiêu đề là 1). */
  line: number;
  severity: 'error' | 'warning';
  text: string;
}

export interface AlarmCsvRow {
  line: number;
  def: AlarmDef;
}

export interface AlarmCsvParse {
  rows: AlarmCsvRow[];
  issues: CsvLineIssue[];
  /** Tiêu đề không nhận ra (bỏ qua). */
  ignoredColumns: string[];
  /** Không có cột id hoặc không có dòng dữ liệu: không nhập được. */
  fatal: string | null;
}

/** Khóa CSV (không phân biệt dấu, hoa thường) → cột lưới; `device` đi vào cột Tag / Thiết bị. */
const KEY_ALIASES: Readonly<Record<string, AlarmCol>> = {
  id: 'id',
  name: 'name',
  type: 'type',
  tag: 'tag',
  device: 'tag',
  trigger: 'cond',
  on: 'cond',
  hh: 'HH',
  h: 'H',
  l: 'L',
  ll: 'LL',
  deadband: 'deadband',
  ondelays: 'onDelay',
  offdelays: 'offDelay',
  ondelay: 'onDelay',
  offdelay: 'offDelay',
  class: 'class',
  area: 'area',
  text: 'text',
  enabled: 'enabled',
};

function headerMap(header: readonly string[]): { map: Array<AlarmCol | null>; ignored: string[] } {
  const byLabel = new Map<string, AlarmCol>();
  for (const c of ALARM_COLS) byLabel.set(fold(t(`alarm.grid.col.${c}`)), c);
  const ignored: string[] = [];
  const map = header.map((h) => {
    const k = fold(h.trim());
    const col = KEY_ALIASES[k] ?? byLabel.get(k) ?? null;
    if (col === null && h.trim() !== '') ignored.push(h.trim());
    return col;
  });
  return { map, ignored };
}

/** Đọc CSV thành các dòng alarm (chưa áp vào tài liệu). Dòng loại lạ bị bỏ kèm lỗi; thừa cột chỉ cảnh báo. */
export function parseAlarmCsv(text: string, doc: AlarmDoc, ctx: AlarmCtx): AlarmCsvParse {
  const parsed = parseCsv(text);
  const out: AlarmCsvParse = { rows: [], issues: [], ignoredColumns: [], fatal: null };
  const header = parsed.rows[0];
  if (!header) return { ...out, fatal: t('alarm.csv.err.empty') };
  const { map, ignored: ignoredAll } = headerMap(header);
  // `textHH`, `textH`, `textL`, `textLL`: nội dung riêng của từng ngưỡng (xuất khi có).
  const thresholdText = new Map<number, string>();
  header.forEach((h, k) => {
    const m = /^text(HH|H|L|LL)$/i.exec(h.trim());
    if (m) thresholdText.set(k, m[1]!.toUpperCase());
  });
  const ignored = ignoredAll.filter((h) => !/^text(HH|H|L|LL)$/i.test(h));
  out.ignoredColumns = ignored;
  if (!map.includes('id')) return { ...out, fatal: t('alarm.csv.err.header') };
  if (parsed.rows.length < 2) return { ...out, fatal: t('alarm.csv.err.empty') };
  const seen = new Set<string>();
  // Id tạm của các dòng đã đọc để gợi ý id không trùng; tài liệu làm việc chỉ chứa các dòng đã nhận.
  let working: AlarmDoc = { ...doc, alarms: [] };
  for (let i = 1; i < parsed.rows.length; i++) {
    const cells = parsed.rows[i]!;
    const line = i + 1;
    if (cells.every((c) => c.trim() === '')) continue;
    if (cells.length > header.length)
      out.issues.push({
        line,
        severity: 'warning',
        text: t('alarm.csv.rowError', { row: line, reason: t('alarm.csv.err.rowCols') }),
      });
    const byCol: Partial<Record<AlarmCol, string>> = {};
    map.forEach((col, k) => {
      if (col === null) return;
      const v = cells[k] ?? '';
      // `tag` và `device` cùng cột: ô không rỗng thắng.
      if (byCol[col] === undefined || (byCol[col] === '' && v !== '')) byCol[col] = v;
    });
    const typeText = byCol.type?.trim();
    const probe = alarmFromCells(working, byCol, ctx);
    for (const [k, name] of thresholdText) {
      const v = cells[k] ?? '';
      const limits = (probe.def as unknown as { limits?: Record<string, { text?: string }> })
        .limits;
      if (v !== '' && limits?.[name]) limits[name]!.text = v;
    }
    if (typeText && probe.rejected.some((r) => r.col === 'type')) {
      out.issues.push({
        line,
        severity: 'error',
        text: t('alarm.csv.rowError', {
          row: line,
          reason: t('alarm.csv.err.unknownType', { type: typeText }),
        }),
      });
      continue;
    }
    const id = String((probe.def as unknown as { id: string }).id);
    if (seen.has(id)) {
      out.issues.push({
        line,
        severity: 'error',
        text: t('alarm.csv.rowError', { row: line, reason: t('alarm.csv.err.dupInFile', { id }) }),
      });
      continue;
    }
    seen.add(id);
    working = { ...working, alarms: [...working.alarms, probe.def] };
    out.rows.push({ line, def: probe.def });
  }
  return out;
}

export interface AlarmCsvApply {
  doc: AlarmDoc;
  added: number;
  replaced: number;
  skipped: number;
  /** Số dòng bỏ vì vượt 500 instance. */
  dropped: number;
  /** Id trùng với alarm đang có (chế độ "Thêm vào"). */
  duplicates: string[];
}

/**
 * Áp các dòng đã đọc: "Thay thế tất cả" thay cả danh sách; "Thêm vào" gộp theo `id`: trùng thì `onDuplicate` quyết định
 * (`replace`: thay alarm cũ; `skip`: giữ cũ).
 */
export function applyAlarmCsv(
  doc: AlarmDoc,
  parse: AlarmCsvParse,
  mode: CsvMode,
  onDuplicate: 'skip' | 'replace' = 'skip',
): AlarmCsvApply {
  const defs = parse.rows.map((r) => r.def);
  if (mode === 'replace') {
    const r = insertAlarms({ ...doc, alarms: [] }, defs);
    return {
      doc: r.doc,
      added: r.added,
      replaced: 0,
      skipped: 0,
      dropped: r.dropped,
      duplicates: [],
    };
  }
  const index = new Map(
    doc.alarms.map((a, i) => [String((a as unknown as { id: string }).id), i] as const),
  );
  const alarms = [...doc.alarms];
  const duplicates: string[] = [];
  let replaced = 0;
  let skipped = 0;
  const fresh: AlarmDef[] = [];
  for (const d of defs) {
    const id = String((d as unknown as { id: string }).id);
    const at = index.get(id);
    if (at === undefined) {
      fresh.push(d);
      continue;
    }
    duplicates.push(id);
    if (onDuplicate === 'replace') {
      alarms[at] = d;
      replaced++;
    } else skipped++;
  }
  const r = insertAlarms({ ...doc, alarms }, fresh);
  return { doc: r.doc, added: r.added, replaced, skipped, dropped: r.dropped, duplicates };
}

/** Văn bản CSV của các dòng `rows` (chỉ số trong tài liệu; rỗng là tất cả), thứ tự cột như lưới. */
export function alarmsToCsv(
  doc: AlarmDoc,
  rows?: readonly number[],
  decimal: '.' | ',' = '.',
): string {
  const picked = rows && rows.length ? rows : doc.alarms.map((_, i) => i);
  const withThresholdText = picked.some((r) => {
    const d = doc.alarms[r] as unknown as { limits?: Record<string, { text?: string }> };
    return Object.values(d?.limits ?? {}).some((l) => l.text !== undefined);
  });
  const header = ALARM_COLS.map((c) => t(`alarm.grid.col.${c}`));
  const extra = withThresholdText ? ALARM_THRESHOLDS.map((n) => `text${n}`) : [];
  const body = picked.map((r) => {
    const def = doc.alarms[r];
    const cells: string[] = ALARM_COLS.map((c) => cellText(def, c, doc));
    for (const n of extra.map((e) => e.slice(4))) {
      const l = (def as unknown as { limits?: Record<string, { text?: string }> })?.limits?.[n];
      cells.push(l?.text ?? '');
    }
    return cells;
  });
  return toCsv([[...header, ...extra], ...body], { decimal });
}

/** Số instance tối đa của tệp nhập (cùng giới hạn của tài liệu). */
export const CSV_MAX_INSTANCES = ALARM_LIMITS.instances;
