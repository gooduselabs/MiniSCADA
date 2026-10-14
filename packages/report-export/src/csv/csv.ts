// Xuất CSV từ ReportTable (specs/010-history-reports/contracts/templates-config.md §5): UTF-8 có BOM, CRLF,
// hai kiểu (chuẩn: `,` và `.` thập phân; Excel vi-VN: `;` và `,`).
import { formatNumber, type ReportTable } from '@mat/history-math';
import type { CsvStyle, ExportLabels } from '../types.ts';

export interface CsvOptions {
  style: CsvStyle;
  labels: ExportLabels;
}

/** Ô chuỗi bắt đầu bằng = + - @ thêm nháy đơn (chống chèn công thức khi mở bằng bảng tính). */
export const guardFormula = (s: string): string => (/^[=+\-@]/.test(s) ? `'${s}` : s);

/** Bọc nháy kép khi có dấu phân tách, nháy kép hoặc xuống dòng. */
function quote(s: string, sep: string): string {
  return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Chữ số của bảng (vi-VN, có chấm nghìn) -> dạng CSV: bỏ chấm nghìn; chuẩn đổi `,` thành `.`. */
function number(text: string, style: CsvStyle): string {
  const plain = text.replace(/\./g, '');
  return style === 'standard' ? plain.replace(',', '.') : plain;
}

export function columnHeader(
  col: { label: string; fn: keyof ExportLabels['fn']; unit: string },
  labels: ExportLabels,
): string {
  return `${col.label} - ${labels.fn[col.fn]}${col.unit ? ` (${col.unit})` : ''}`;
}

export function coverageText(t: ReportTable, labels: ExportLabels): string {
  return `${labels.coverage} ${formatNumber(t.coverage * 100, 1)} %`;
}

/** CSV dạng chuỗi, không có BOM. */
export function toCsv(t: ReportTable, opts: CsvOptions): string {
  const sep = opts.style === 'standard' ? ',' : ';';
  const { labels } = opts;
  const text = (s: string) => quote(guardFormula(s), sep);
  const line = (cells: string[]) => cells.join(sep) + '\r\n';
  let out = '';
  out += line([text(t.title)]);
  out += line([text(`${labels.period}: ${t.periodLabel}`)]);
  out += line([text(labels.rowHeader), ...t.columns.map((c) => text(columnHeader(c, labels)))]);
  for (const r of t.rows) out += line([text(r.label), ...r.text.map((c) => number(c, opts.style))]);
  if (t.totalsText)
    out += line([text(labels.total), ...t.totalsText.map((c) => number(c, opts.style))]);
  out += line([text(coverageText(t, labels))]);
  return out;
}

/** CSV dạng byte UTF-8 có BOM. */
export function csvBytes(t: ReportTable, opts: CsvOptions): Uint8Array {
  const body = new TextEncoder().encode(toCsv(t, opts));
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(body, 3);
  return out;
}
