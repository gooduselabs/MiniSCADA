// Mẫu báo cáo reports.json (specs/010-history-reports/contracts/templates-config.md §2; dòng 1.1 của feature 015:
// specs/015-reports/plan.md mục Hợp đồng).
export type ReportPeriod = 'day' | 'shift' | 'month' | 'week' | 'range';
export type ReportFn =
  'min' | 'max' | 'avg' | 'sum' | 'first' | 'last' | 'delta' | 'count' | 'onTime' | 'starts';
/** Loại báo cáo (1.1): bảng tổng hợp (010), alarm, vận hành thiết bị, ghi PLC của logic. */
export type ReportKind = 'table' | 'alarm' | 'equipment' | 'logic';
export type ReportChartKind = 'line' | 'bar' | 'none';

export interface ReportColumn {
  tagId: string;
  label?: string;
  unit?: string;
  decimals?: number;
  functions: ReportFn[];
}

export interface ReportTemplate {
  id: string;
  name: string;
  kind?: ReportKind;
  /** Bắt buộc với `table`, `equipment`; không có ở `alarm`, `logic`. */
  group?: string;
  period: ReportPeriod;
  rowMinutes?: 15 | 30 | 60;
  shifts?: { count: number; start: string };
  title?: string;
  footer?: string;
  paper?: { size?: 'A4' | 'A3'; orientation?: 'portrait' | 'landscape' };
  totals?: boolean;
  tiles?: boolean;
  chart?: ReportChartKind;
  columns?: ReportColumn[];
}

export interface ReportsConfig {
  schemaVersion: string;
  /** Tên đơn vị trên dải tiêu đề (1.1). */
  org?: string;
  /** Ảnh logo của đơn vị (1.1, feature 024): `graphics/*.svg` hoặc `graphics/*.png`, tối đa 256 KiB. */
  logo?: string;
  reports: ReportTemplate[];
}

/** Số ca mỗi ngày làm việc cho phép (E_RPT_SHIFT). */
export const SHIFT_COUNTS: readonly number[] = [2, 3, 4, 6, 8, 12];
export const REPORT_LIMITS = { columns: 24, tags: 24 } as const;
/** Hàm chỉ có ở định dạng 1.1; `starts` chỉ ở loại `equipment`, loại đó chỉ có hai hàm này. */
export const EQUIPMENT_FNS: readonly ReportFn[] = ['onTime', 'starts'];
/** Loại không đọc lưu trữ Tag (không có `group`, `columns`). */
export const EVENT_KINDS: readonly ReportKind[] = ['alarm', 'logic'];
