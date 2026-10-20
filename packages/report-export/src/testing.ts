// Dữ liệu dùng chung cho test của @mat/report-export (không export ở index, không vào bản build).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildReport, type ReportTable } from '@mat/history-math';
import type { ExportLabels, ExportMeta } from './types.ts';

const DIR = resolve(__dirname, '../../../tests/report-vectors');

/** Bảng báo cáo thật dựng từ một vector của tests/report-vectors (cùng phép tính với màn hình). */
export function tableFromVector(name: string): ReportTable {
  const v = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8'));
  return buildReport({
    template: v.template,
    select: v.select,
    tz: v.tz,
    now: v.now,
    shiftWord: v.shiftWord,
    tagInfo: v.tagInfo,
    aggregates: v.aggregates,
  });
}

export const LABELS: ExportLabels = {
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

export const META: ExportMeta = {
  exportedBy: 'vanhanh1',
  exportedAt: Date.UTC(2026, 9, 13, 3, 30, 45),
  tz: '+07:00',
  paper: { size: 'A4', orientation: 'landscape' },
  sheetName: 'Điện năng',
};

/** Bảng có nhãn và tên "độc hại": công thức bảng tính, ký tự XML, HTML, dấu phẩy, nháy kép, xuống dòng, tiếng Việt. */
export function hostileTable(): ReportTable {
  const base = tableFromVector('report-shift-3-0600');
  const evil = [
    '=HYPERLINK("http://x","a")',
    '+1+1',
    '-2+3',
    '@SUM(A1)',
    '<script>alert(1)</script>',
    'a & b "c" <d>',
    'x,y;z',
    'dòng\nhai',
    'Điện năng ằ ễ ỹ',
  ];
  const rows = evil.slice(0, 3).map((label, i) => ({ ...base.rows[i]!, label }));
  const columns = base.columns.map((c, i) => ({ ...c, label: evil[3 + i] ?? c.label }));
  return { ...base, title: evil[8]!, periodLabel: evil[7]!, columns, rows, totals: base.totals };
}
