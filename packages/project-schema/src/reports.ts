// Mẫu báo cáo reports.json (specs/010-history-reports/contracts/templates-config.md §2).
export type ReportPeriod = 'day' | 'shift' | 'month';
export type ReportFn = 'min' | 'max' | 'avg' | 'sum' | 'first' | 'last' | 'delta' | 'count';

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
  group: string;
  period: ReportPeriod;
  rowMinutes?: 15 | 30 | 60;
  shifts?: { count: number; start: string };
  title?: string;
  footer?: string;
  paper?: { size?: 'A4' | 'A3'; orientation?: 'portrait' | 'landscape' };
  totals?: boolean;
  columns: ReportColumn[];
}

export interface ReportsConfig {
  schemaVersion: string;
  reports: ReportTemplate[];
}

/** Số ca mỗi ngày làm việc cho phép (E_RPT_SHIFT). */
export const SHIFT_COUNTS: readonly number[] = [2, 3, 4, 6, 8, 12];
export const REPORT_LIMITS = { columns: 24, tags: 24 } as const;
