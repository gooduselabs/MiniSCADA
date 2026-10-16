// Kiểu dùng chung của @mat/report-export. Chuỗi hiển thị (tên hàm, "Tổng", "Người xuất"...) do nơi gọi cấp từ
// i18n của ứng dụng: gói này không chứa chuỗi giao diện.
import type { AggFn } from '@mat/history-math';

export interface ExportLabels {
  /** "Kỳ" (đứng trước `periodLabel`). */
  period: string;
  /** Nhãn dòng tổng. */
  total: string;
  exportedBy: string;
  exportedAt: string;
  /** "Trang" và "/" của chân trang PDF. */
  page: string;
  of: string;
  /** Tiêu đề cột nhãn hàng. */
  rowHeader: string;
  /** "Dữ liệu đủ" (đứng trước phần trăm). */
  coverage: string;
  /** Tên hàm hiển thị ở tiêu đề cột. */
  fn: Record<AggFn, string>;
}

export interface ExportMeta {
  /** Tài khoản đăng nhập. */
  exportedBy: string;
  /** Giờ xuất, UTC ms. */
  exportedAt: number;
  /** Múi giờ của nhóm (`±HH:MM`). */
  tz: string;
  paper?: { size?: 'A4' | 'A3'; orientation?: 'portrait' | 'landscape' };
  /** Tên trang tính XLSX (làm sạch và cắt 31 ký tự). */
  sheetName?: string;
}

export type CsvStyle = 'standard' | 'excel-vi';
