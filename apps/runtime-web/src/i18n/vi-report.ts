// Nhãn cho @mat/report-export (CSV, XLSX, PDF) và `<mat-report-view>` của trang báo cáo (feature 010, 015). Chuỗi trang ở
// vi-history.ts.
import type { ExportLabels } from '@mat/report-export';
import { viReport, type ReportViewLabels } from '@mat/ui-components';

export const exportLabels: ExportLabels = {
  period: 'Kỳ',
  total: 'Tổng',
  exportedBy: 'Người xuất',
  exportedAt: 'Giờ xuất',
  page: 'Trang',
  of: '/',
  rowHeader: 'Thời gian',
  coverage: 'Dữ liệu đủ',
  fn: {
    min: 'nhỏ nhất',
    max: 'lớn nhất',
    avg: 'trung bình',
    sum: 'tích phân',
    first: 'đầu kỳ',
    last: 'cuối kỳ',
    delta: 'chênh lệch',
    count: 'số dòng',
    onTime: 'thời gian ON',
    starts: 'số lần bật',
  },
};

/** Chữ của `<mat-report-view>`: tên hàm như ở tệp xuất (cùng tiêu đề cột trên màn hình và trong tệp). */
export const viewLabels: ReportViewLabels = { ...viReport, fn: exportLabels.fn };
