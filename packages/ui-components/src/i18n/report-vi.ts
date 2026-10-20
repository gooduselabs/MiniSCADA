// Chữ mặc định của `<mat-report-view>` (feature 015): runtime-web và Studio có thể thay bằng i18n của mình.
import { REPORT_FN_VI, type ReportFn } from '@mat/history-math';

export interface ReportViewLabels {
  period: string;
  rowHeader: string;
  total: string;
  pending: string;
  missingCell: string;
  tableTitle: string;
  noRows: string;
  chartHint: string;
  coverage: (pct: string) => string;
  fn: Record<ReportFn, string>;
}

export const viReport: ReportViewLabels = {
  period: 'Kỳ',
  rowHeader: 'Thời gian',
  total: 'Tổng',
  pending: 'chưa tới',
  missingCell: 'Thiếu dữ liệu (dưới 95 %)',
  tableTitle: 'Bảng số liệu',
  noRows: 'Không có dòng nào trong kỳ.',
  chartHint: 'Số liệu chi tiết ở bảng bên dưới.',
  coverage: (pct) => `Dữ liệu đủ ${pct}`,
  fn: REPORT_FN_VI,
};
