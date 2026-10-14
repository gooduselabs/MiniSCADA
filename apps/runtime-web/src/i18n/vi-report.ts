// Nhãn cho @mat/report-export (CSV, XLSX, PDF) của trang báo cáo (feature 010). Chuỗi trang ở vi-history.ts.
import type { ExportLabels } from '@mat/report-export';

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
  },
};
