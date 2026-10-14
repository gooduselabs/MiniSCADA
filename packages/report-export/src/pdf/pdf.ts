// Xuất PDF từ ReportTable bằng pdfmake (tải lười, ADR-033): khổ và hướng theo mẫu, tiêu đề, kỳ, người xuất, giờ
// xuất, bảng lặp hàng tiêu đề khi sang trang, chân trang có số trang. Phông Roboto của pdfmake có đủ chữ Việt.
import { formatLocal, type ReportTable } from '@mat/history-math';
import { columnHeader, coverageText } from '../csv/csv.ts';
import type { ExportLabels, ExportMeta } from '../types.ts';

type Cell = { text: string; [k: string]: unknown };

/** Định nghĩa tài liệu pdfmake (hàm thuần, kiểm được không cần dựng PDF). */
export function pdfDefinition(
  t: ReportTable,
  meta: ExportMeta,
  labels: ExportLabels,
  footer = '',
): Record<string, unknown> {
  const head: Cell[] = [
    { text: labels.rowHeader, bold: true, fillColor: '#eeeeee', alignment: 'center' },
    ...t.columns.map((c) => ({
      text: columnHeader(c, labels),
      bold: true,
      fillColor: '#eeeeee',
      alignment: 'center',
    })),
  ];
  const body: Cell[][] = [head];
  for (const r of t.rows)
    body.push([
      { text: r.label, noWrap: true },
      ...r.text.map((c) => ({ text: c, alignment: 'right' })),
    ]);
  if (t.totalsText)
    body.push([
      { text: labels.total, bold: true },
      ...t.totalsText.map((c) => ({ text: c, bold: true, alignment: 'right' })),
    ]);
  const paper = meta.paper ?? {};
  return {
    pageSize: paper.size ?? 'A4',
    pageOrientation: paper.orientation ?? 'portrait',
    pageMargins: [28, 36, 28, 44],
    defaultStyle: { font: 'Roboto', fontSize: 8 },
    content: [
      { text: t.title, fontSize: 14, bold: true, margin: [0, 0, 0, 4] },
      { text: `${labels.period}: ${t.periodLabel}` },
      { text: `${labels.exportedBy}: ${meta.exportedBy}` },
      {
        text: `${labels.exportedAt}: ${formatLocal(meta.exportedAt, meta.tz, 'sec')}`,
        margin: [0, 0, 0, 8],
      },
      {
        table: {
          headerRows: 1,
          widths: ['auto', ...t.columns.map(() => '*')],
          body,
        },
        layout: 'lightHorizontalLines',
      },
      { text: coverageText(t, labels), margin: [0, 6, 0, 0], italics: true },
    ],
    footer: (current: number, count: number) => ({
      columns: [
        { text: footer, alignment: 'left' },
        { text: `${labels.page} ${current} ${labels.of} ${count}`, alignment: 'right' },
      ],
      margin: [28, 12, 28, 0],
      fontSize: 8,
    }),
    info: { title: t.title },
  };
}

interface PdfMake {
  addVirtualFileSystem(vfs: Record<string, unknown>): void;
  createPdf(def: Record<string, unknown>): { getBuffer(): Promise<Uint8Array> };
}

/** Dựng PDF. Nạp pdfmake và phông Roboto bằng `import()` ở lần gọi đầu (chunk riêng, không có ở tải khởi động). */
export async function buildPdf(
  t: ReportTable,
  meta: ExportMeta,
  labels: ExportLabels,
  footer = '',
): Promise<Uint8Array> {
  const [pm, fonts] = await Promise.all([
    import('pdfmake/build/pdfmake.min.js'),
    import('pdfmake/build/vfs_fonts.js'),
  ]);
  const pdfMake = ((pm as { default?: PdfMake }).default ?? pm) as unknown as PdfMake;
  const vfs = ((fonts as { default?: Record<string, unknown> }).default ?? fonts) as Record<
    string,
    unknown
  >;
  pdfMake.addVirtualFileSystem(vfs);
  return pdfMake.createPdf(pdfDefinition(t, meta, labels, footer)).getBuffer();
}
