// Xuất báo cáo CSV/XLSX/PDF trên trình duyệt (specs/010-history-reports/contracts/templates-config.md §5).
// CSV nhẹ nên nạp thẳng; XLSX (fflate) và PDF (pdfmake) tải lười bằng import() khi bấm nút (ADR-033), để tải khởi
// động không đổi. Mọi định dạng dựng từ cùng một ReportTable.
import type { ReportTable } from '@mat/history-math';
import { csvBytes, type CsvOptions } from './csv/csv.ts';
import type { ExportLabels, ExportMeta } from './types.ts';

export { exportFileName } from './filename.ts';
export { toCsv, csvBytes, guardFormula } from './csv/csv.ts';
export type { CsvOptions } from './csv/csv.ts';
export type { CsvStyle, ExportLabels, ExportMeta } from './types.ts';

export type ExportKind = 'csv' | 'csv-excel' | 'xlsx' | 'pdf';

/** Đuôi và kiểu MIME của từng định dạng. */
export const EXPORT_FORMATS: Record<ExportKind, { ext: string; mime: string }> = {
  csv: { ext: 'csv', mime: 'text/csv;charset=utf-8' },
  'csv-excel': { ext: 'csv', mime: 'text/csv;charset=utf-8' },
  xlsx: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pdf: { ext: 'pdf', mime: 'application/pdf' },
};

export function exportCsv(
  t: ReportTable,
  labels: ExportLabels,
  style: CsvOptions['style'] = 'standard',
): Uint8Array {
  return csvBytes(t, { style, labels });
}

export async function exportXlsx(
  t: ReportTable,
  meta: ExportMeta,
  labels: ExportLabels,
): Promise<Uint8Array> {
  const { buildXlsx } = await import('./xlsx/xlsx.ts');
  return buildXlsx(t, meta, labels);
}

export async function exportPdf(
  t: ReportTable,
  meta: ExportMeta,
  labels: ExportLabels,
  footer = '',
): Promise<Uint8Array> {
  const { buildPdf } = await import('./pdf/pdf.ts');
  return buildPdf(t, meta, labels, footer);
}
