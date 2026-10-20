// Xuất CSV từ ReportTable (specs/010-history-reports/contracts/templates-config.md §5): UTF-8 có BOM, CRLF,
// hai kiểu (chuẩn: `,` và `.` thập phân; Excel vi-VN: `;` và `,`).
import { formatNumber, type ReportTable } from '@mat/history-math';
import type { CsvStyle, ExportLabels } from '../types.ts';

export interface CsvOptions {
  style: CsvStyle;
  labels: ExportLabels;
}

/**
 * Ô chuỗi bắt đầu bằng = + - @ TAB CR thêm nháy đơn (chống chèn công thức khi mở bằng bảng tính; cùng tập ký tự với
 * bản C++). XLSX cũng dùng hàm này dù ô `inlineStr` không bao giờ là công thức: chọn giữ để từng ô khớp CSV, PDF và
 * màn hình, và để bảo vệ còn nguyên khi người dùng lưu lại XLSX thành CSV rồi mở bằng bảng tính (rà soát 010 M3).
 */
export const guardFormula = (s: string): string => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

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
  col: { label: string; fn: keyof ExportLabels['fn']; unit: string; plain?: boolean },
  labels: ExportLabels,
): string {
  const unit = col.unit ? ` (${col.unit})` : '';
  // cột của báo cáo sự kiện (feature 015): không kèm tên hàm
  return col.plain ? `${col.label}${unit}` : `${col.label} - ${labels.fn[col.fn] ?? col.fn}${unit}`;
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
  if (t.org) out += line([text(t.org)]);
  out += line([text(`${labels.period}: ${t.periodLabel}`)]);
  out += line([
    text(t.rowHeader ?? labels.rowHeader),
    ...t.columns.map((c) => text(columnHeader(c, labels))),
  ]);
  for (const r of t.rows) out += line([text(r.label), ...r.text.map((c) => number(c, opts.style))]);
  if (t.totalsText)
    out += line([text(labels.total), ...t.totalsText.map((c) => number(c, opts.style))]);
  if (t.showCoverage !== false) out += line([text(coverageText(t, labels))]);
  for (const n of t.notes ?? []) out += line([text(n)]);
  // bảng phụ (feature 015): dòng trống, tiêu đề, đầu bảng, các hàng; ô số theo kiểu CSV
  for (const s of t.sections ?? []) {
    out += '\r\n' + line([text(s.title)]);
    out += line(s.columns.map((c) => text(c.label)));
    for (const r of s.rows)
      out += line(r.map((v, k) => (s.columns[k]?.numeric ? number(v, opts.style) : text(v))));
  }
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
