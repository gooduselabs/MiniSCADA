// Xuất PDF từ ReportTable bằng pdfmake (tải lười, ADR-033): khổ và hướng theo mẫu, tiêu đề, kỳ, người xuất, giờ
// xuất, bảng lặp hàng tiêu đề khi sang trang, chân trang có số trang. Phông Roboto của pdfmake có đủ chữ Việt.
import { formatLocal, type ReportTable } from '@mat/history-math';
import { columnHeader, coverageText } from '../csv/csv.ts';
import type { ExportLabels, ExportMeta } from '../types.ts';

type Cell = { text: string; [k: string]: unknown };

const PAGE: Record<string, [number, number]> = { A4: [595, 842], A3: [842, 1191] };
const MARGIN_X = 28;
const CELL_PAD = 16; // pdfmake 0.3: đệm 8 pt mỗi bên (đo thật: bước cột = độ rộng + 16)
const FONT_SIZES = [8, 7, 6];

/** Độ rộng ước (đơn vị em) của Roboto: chữ số 0,57, dấu phân cách 0,27, ký tự khác 0,62 (dư để không thiếu). */
function em(s: string): number {
  let w = 0;
  for (const ch of s)
    w += /\d/.test(ch) ? 0.57 : /[.,:]/.test(ch) ? 0.27 : ch === ' ' ? 0.27 : 0.62;
  return w;
}
const longestWord = (s: string) => Math.max(...s.split(/\s+/).map(em), 0);

interface Layout {
  fontSize: number;
  /** Mỗi nhóm cột (chỉ số cột dữ liệu) là một bảng, lặp cột nhãn; nhiều nhóm thì ngắt trang giữa các nhóm. */
  groups: number[][];
  widths: { label: number; data: number[] };
}

/**
 * Chia cột theo nội dung: ô số không ngắt dòng, độ rộng cột = số/tiêu đề dài nhất (ước theo Roboto). Thử cỡ chữ 8, 7, 6;
 * nếu bảng vẫn rộng hơn khổ giấy thì chia các cột thành nhóm, mỗi nhóm một bảng (lặp cột nhãn) ở trang riêng.
 */
export function planLayout(t: ReportTable, meta: ExportMeta, labels: ExportLabels): Layout {
  const paper = meta.paper ?? {};
  const [pw, ph] = PAGE[paper.size ?? 'A4']!;
  const avail = (paper.orientation === 'landscape' ? ph : pw) - 2 * MARGIN_X;
  const labelEm = Math.max(
    em(labels.rowHeader),
    em(labels.total),
    ...t.rows.map((r) => em(r.label)),
  );
  const dataEm = t.columns.map((c, k) =>
    Math.max(
      longestWord(columnHeader(c, labels)),
      ...t.rows.map((r) => em(r.text[k] ?? '')),
      ...(t.totalsText ? [em(t.totalsText[k] ?? '')] : []),
    ),
  );
  const at = (size: number) => ({
    label: Math.ceil(labelEm * size * 1.06 + CELL_PAD),
    data: dataEm.map((e) => Math.ceil(e * size * 1.06 + CELL_PAD)),
  });
  for (const size of FONT_SIZES) {
    const w = at(size);
    if (w.label + w.data.reduce((a, b) => a + b, 0) <= avail)
      return { fontSize: size, groups: [t.columns.map((_, k) => k)], widths: w };
  }
  const size = FONT_SIZES[FONT_SIZES.length - 1]!;
  const w = at(size);
  const groups: number[][] = [];
  let cur: number[] = [];
  let used = w.label;
  for (let k = 0; k < t.columns.length; k++) {
    if (cur.length > 0 && used + w.data[k]! > avail) {
      groups.push(cur);
      cur = [];
      used = w.label;
    }
    cur.push(k);
    used += w.data[k]!;
  }
  if (cur.length > 0) groups.push(cur);
  return { fontSize: size, groups, widths: w };
}

/** Định nghĩa tài liệu pdfmake (hàm thuần, kiểm được không cần dựng PDF). */
export function pdfDefinition(
  t: ReportTable,
  meta: ExportMeta,
  labels: ExportLabels,
  footer = '',
): Record<string, unknown> {
  const layout = planLayout(t, meta, labels);
  const tables = layout.groups.map((group, gi) => {
    const head: Cell[] = [
      { text: labels.rowHeader, bold: true, fillColor: '#eeeeee', alignment: 'center' },
      ...group.map((k) => ({
        text: columnHeader(t.columns[k]!, labels),
        bold: true,
        fillColor: '#eeeeee',
        alignment: 'center',
      })),
    ];
    const body: Cell[][] = [head];
    for (const r of t.rows)
      body.push([
        { text: r.label, noWrap: true },
        ...group.map((k) => ({ text: r.text[k] ?? '', alignment: 'right', noWrap: true })),
      ]);
    if (t.totalsText)
      body.push([
        { text: labels.total, bold: true },
        ...group.map((k) => ({
          text: t.totalsText![k] ?? '',
          bold: true,
          alignment: 'right',
          noWrap: true,
        })),
      ]);
    return {
      table: {
        headerRows: 1,
        widths: [
          layout.widths.label - CELL_PAD,
          ...group.map((k) => layout.widths.data[k]! - CELL_PAD),
        ],
        body,
      },
      layout: 'lightHorizontalLines',
      ...(gi > 0 ? { pageBreak: 'before' } : {}),
    };
  });
  const paper = meta.paper ?? {};
  return {
    pageSize: paper.size ?? 'A4',
    pageOrientation: paper.orientation ?? 'portrait',
    pageMargins: [28, 36, 28, 44],
    defaultStyle: { font: 'Roboto', fontSize: layout.fontSize },
    content: [
      { text: t.title, fontSize: 14, bold: true, margin: [0, 0, 0, 4] },
      { text: `${labels.period}: ${t.periodLabel}` },
      { text: `${labels.exportedBy}: ${meta.exportedBy}` },
      {
        text: `${labels.exportedAt}: ${formatLocal(meta.exportedAt, meta.tz, 'sec')}`,
        margin: [0, 0, 0, 8],
      },
      ...tables,
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
