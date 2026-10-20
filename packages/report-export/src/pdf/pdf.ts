// Xuất PDF từ ReportTable bằng pdfmake (tải lười, ADR-033). Mẫu feature 012 (FR-038, research R6): dải tiêu đề màu
// nhấn của chủ đề (logo tùy chọn), thẻ số liệu tổng hợp, biểu đồ vector (ECharts SSR SVG, chart.ts), bảng kẻ xen kẽ
// lặp hàng tiêu đề khi sang trang, chân trang có số trang; phông Inter nhúng (pdf-fonts.ts) đủ dấu tiếng Việt. Khổ và hướng
// theo mẫu báo cáo; bảng quá rộng chia nhóm cột như trước (planLayout).
import { formatLocal, formatNumber, type ReportTable } from '@mat/history-math';
import { columnHeader, coverageText } from '../csv/csv.ts';
import type { ExportLabels, ExportMeta } from '../types.ts';
import { chartSpec, chartSvg } from './chart.ts';
import { reportPalette, type ReportPalette } from '../theme.ts';

type Cell = { text: string; [k: string]: unknown };
type Node = Record<string, unknown>;

const FONT = 'Inter';
const PAGE: Record<string, [number, number]> = { A4: [595, 842], A3: [842, 1191] };
const MARGIN_X = 28;
const CELL_PAD = 16; // pdfmake 0.3: đệm 8 pt mỗi bên (đo thật: bước cột = độ rộng + 16)
const FONT_SIZES = [8, 7, 6];
const MAX_CARDS = 4;
const DATA_MAX = 150;
/** Bảng hụt bề rộng trang không quá tỉ lệ này (sau trần DATA_MAX) thì trải cho đủ. */
const FILL_GAP = 0.25;

/**
 * Độ rộng ước (đơn vị em) theo Inter 4.1 (đo bằng fontkit trên tệp đã cắt, lấy số lớn hơn của Regular và SemiBold):
 * chữ số ≤ 0,666, dấu . , : 0,319, khoảng trắng 0,281, chữ cái trung bình 0,615 (lấy 0,70, dư cho chữ hoa rộng).
 */
function em(s: string): number {
  let w = 0;
  for (const ch of s) w += /\d/.test(ch) ? 0.67 : /[.,:]/.test(ch) ? 0.32 : ch === ' ' ? 0.29 : 0.7;
  return w;
}
const longestWord = (s: string) => Math.max(...s.split(/\s+/).map(em), 0);

interface Layout {
  fontSize: number;
  /** Mỗi nhóm cột (chỉ số cột dữ liệu) là một bảng, lặp cột nhãn; nhiều nhóm thì ngắt trang giữa các nhóm. */
  groups: number[][];
  widths: { label: number; data: number[] };
}

const pageSize = (meta: ExportMeta): [number, number] => {
  const paper = meta.paper ?? {};
  const [pw, ph] = PAGE[paper.size ?? 'A4']!;
  return paper.orientation === 'landscape' ? [ph, pw] : [pw, ph];
};

/**
 * Chia cột theo nội dung: ô số không ngắt dòng, độ rộng cột = số/tiêu đề dài nhất (ước theo Inter). Thử cỡ chữ 8, 7, 6;
 * nếu bảng vẫn rộng hơn khổ giấy thì chia các cột thành nhóm, mỗi nhóm một bảng (lặp cột nhãn) ở trang riêng.
 */
export function planLayout(t: ReportTable, meta: ExportMeta, labels: ExportLabels): Layout {
  const avail = pageSize(meta)[0] - 2 * MARGIN_X;
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
    const used = w.label + w.data.reduce((a, b) => a + b, 0);
    if (used <= avail) {
      // Vừa trang: chia phần dư cho các cột số (mỗi cột tối đa DATA_MAX pt) để bảng trải rộng, tiêu đề ít xuống dòng.
      const extra = w.data.length ? Math.floor((avail - used) / w.data.length) : 0;
      const data = w.data.map((d) => Math.max(d, Math.min(d + extra, DATA_MAX)));
      // Phần còn thiếu nhỏ (≤ FILL_GAP bề rộng) thì chia nốt cho cột số, bỏ trần: bảng thẳng mép phải với dải tiêu đề và
      // thẻ số liệu thay vì hụt một khúc (T054). Bảng ít cột vẫn gọn.
      const gap = avail - w.label - data.reduce((a, b) => a + b, 0);
      if (data.length && gap > 0 && gap <= avail * FILL_GAP) {
        const each = Math.floor(gap / data.length);
        data.forEach((_, k) => (data[k]! += each));
        data[data.length - 1]! += gap - each * data.length;
      }
      return { fontSize: size, groups: [t.columns.map((_, k) => k)], widths: { ...w, data } };
    }
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

// ---- logo ----------------------------------------------------------------------------------------------------------

const RASTER_LOGO = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=\s]+$/;
const LOGO_MAX = 512 * 1024;
/** SVG logo chỉ là hình vẽ tĩnh: không script, foreignObject, ảnh, sự kiện, tham chiếu ngoài (href khác `#id`). */
const SVG_UNSAFE =
  /<\s*(?:script|foreignObject|image|iframe|object|embed|style)\b|\bon[a-z]+\s*=|(?:xlink:)?href\s*=\s*["']?\s*(?!#)|url\(\s*["']?\s*(?!#)|<!ENTITY|<!DOCTYPE/i;

/** Logo dùng được hay không (kiểu nút pdfmake). */
export function safeLogo(logo: string | undefined): { svg: string } | { image: string } | null {
  if (!logo || logo.length > LOGO_MAX) return null;
  const s = logo.trim();
  if (RASTER_LOGO.test(s)) return { image: s };
  if (/^<svg[\s>]/i.test(s) && /<\/svg>$/i.test(s) && !SVG_UNSAFE.test(s)) return { svg: s };
  return null;
}

// ---- các khối ------------------------------------------------------------------------------------------------------

function headerBand(
  t: ReportTable,
  meta: ExportMeta,
  labels: ExportLabels,
  p: ReportPalette,
): Node {
  const ink = p.accentInk;
  const info: Node = {
    stack: [
      { text: t.title, color: ink, fontSize: 15, bold: true, margin: [0, 0, 0, 3] },
      { text: `${labels.period}: ${t.periodLabel}`, color: ink, fontSize: 9 },
      {
        text: [
          { text: `${labels.exportedBy}: ${meta.exportedBy}`, color: ink },
          { text: '    ', color: ink },
          {
            text: `${labels.exportedAt}: ${formatLocal(meta.exportedAt, meta.tz, 'sec')}`,
            color: ink,
          },
        ],
        fontSize: 8,
      },
    ],
  };
  const logo = safeLogo(meta.logo);
  const cells: Node[] = [];
  const widths: Array<number | string> = [];
  if (logo) {
    cells.push({
      ...('svg' in logo ? { svg: logo.svg } : { image: logo.image }),
      fit: [64, 36],
      fillColor: p.accent,
    });
    widths.push(64);
  }
  cells.push({ ...info, fillColor: p.accent });
  widths.push('*');
  return {
    table: { widths, body: [cells] },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: (i: number) => (i === 0 ? 12 : 8),
      paddingRight: () => 12,
      paddingTop: () => 10,
      paddingBottom: () => 10,
    },
    margin: [0, 0, 0, 10],
  };
}

function summaryCards(t: ReportTable, labels: ExportLabels, p: ReportPalette): Node {
  const card = (i: number, label: string, value: string, unit: string): Node => ({
    table: {
      widths: [3, '*'],
      body: [
        [
          { text: '', fillColor: p.chart[i % p.chart.length] },
          {
            fillColor: p.zebra,
            stack: [
              { text: label, color: p.muted, fontSize: 7.5, margin: [0, 0, 0, 2] },
              {
                text: [
                  { text: value, fontSize: 14, bold: true, color: p.text },
                  ...(unit ? [{ text: ` ${unit}`, fontSize: 8, color: p.muted }] : []),
                ],
              },
            ],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: (i: number) => (i === 0 ? 0 : 8),
      paddingRight: (i: number) => (i === 0 ? 0 : 8),
      paddingTop: () => 6,
      paddingBottom: () => 6,
    },
  });
  const cards: Node[] = [];
  if (t.totalsText)
    t.columns.slice(0, MAX_CARDS).forEach((c, k) => {
      const v = t.totalsText![k] ?? '';
      if (v !== '') cards.push(card(k, `${c.label} (${labels.fn[c.fn]})`, v, c.unit));
    });
  cards.push(card(cards.length, labels.coverage, formatNumber(t.coverage * 100, 1), '%'));
  return { id: 'summary-cards', columns: cards, columnGap: 8, margin: [0, 0, 0, 10] };
}

function chartBlock(
  t: ReportTable,
  meta: ExportMeta,
  labels: ExportLabels,
  p: ReportPalette,
): Node | null {
  if (meta.chart === false) return null;
  const spec = chartSpec(t);
  if (!spec) return null;
  const [pw, ph] = pageSize(meta);
  const width = pw - 2 * MARGIN_X;
  const height = Math.round(Math.min(200, Math.max(140, ph * 0.26)));
  const svg = chartSvg(t, spec, {
    width,
    height,
    palette: p,
    names: spec.columns.map((k) => columnHeader(t.columns[k]!, labels)),
    font: FONT,
  });
  return { id: 'chart', svg, width, height, font: FONT, margin: [0, 0, 0, 10] };
}

function dataTables(
  t: ReportTable,
  labels: ExportLabels,
  layout: Layout,
  p: ReportPalette,
): Node[] {
  return layout.groups.map((group, gi) => {
    const head: Cell[] = [
      { text: labels.rowHeader, bold: true, color: p.accentInk, alignment: 'left' },
      ...group.map((k) => ({
        text: columnHeader(t.columns[k]!, labels),
        bold: true,
        color: p.accentInk,
        alignment: 'right',
      })),
    ];
    const body: Cell[][] = [head];
    for (const r of t.rows)
      body.push([
        { text: r.label, noWrap: true },
        ...group.map((k) => ({ text: r.text[k] ?? '', alignment: 'right', noWrap: true })),
      ]);
    const totalRow = t.totalsText ? body.length : -1;
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
    const rows = body.length;
    return {
      table: {
        headerRows: 1,
        keepWithHeaderRows: 1,
        dontBreakRows: true,
        widths: [
          layout.widths.label - CELL_PAD,
          ...group.map((k) => layout.widths.data[k]! - CELL_PAD),
        ],
        body,
      },
      layout: {
        fillColor: (row: number): string | null =>
          row === 0
            ? p.accent
            : row === totalRow
              ? p.chartSoft[0]!
              : row % 2 === 0
                ? p.zebra
                : null,
        hLineWidth: (i: number) => (i === totalRow ? 1 : i === rows ? 0.75 : 0),
        hLineColor: (i: number) => (i === totalRow ? p.accent : p.border),
        vLineWidth: () => 0,
        paddingLeft: () => 8,
        paddingRight: () => 8,
        paddingTop: () => 3,
        paddingBottom: () => 3,
      },
      ...(gi > 0 ? { pageBreak: 'before' } : {}),
    };
  });
}

/** Định nghĩa tài liệu pdfmake (hàm thuần, kiểm được không cần dựng PDF). */
export function pdfDefinition(
  t: ReportTable,
  meta: ExportMeta,
  labels: ExportLabels,
  footer = '',
): Record<string, unknown> {
  const p = reportPalette(meta.theme);
  const layout = planLayout(t, meta, labels);
  const chart = chartBlock(t, meta, labels, p);
  const paper = meta.paper ?? {};
  const lineEnd = pageSize(meta)[0] - 2 * MARGIN_X;
  return {
    pageSize: paper.size ?? 'A4',
    pageOrientation: paper.orientation ?? 'portrait',
    pageMargins: [MARGIN_X, 28, MARGIN_X, 40],
    defaultStyle: { font: FONT, fontSize: layout.fontSize, color: p.text },
    content: [
      headerBand(t, meta, labels, p),
      summaryCards(t, labels, p),
      ...(chart ? [chart] : []),
      ...dataTables(t, labels, layout, p),
      {
        text: coverageText(t, labels),
        margin: [0, 6, 0, 0],
        italics: true,
        color: p.muted,
        fontSize: 7.5,
      },
    ],
    footer: (current: number, count: number) => ({
      margin: [MARGIN_X, 10, MARGIN_X, 0],
      stack: [
        {
          canvas: [
            { type: 'line', x1: 0, y1: 0, x2: lineEnd, y2: 0, lineWidth: 0.5, lineColor: p.border },
          ],
          margin: [0, 0, 0, 4],
        },
        {
          columns: [
            { text: footer, alignment: 'left' },
            { text: `${labels.page} ${current} ${labels.of} ${count}`, alignment: 'right' },
          ],
          fontSize: 7.5,
          color: p.muted,
        },
      ],
    }),
    info: { title: t.title },
  };
}

interface PdfMake {
  addVirtualFileSystem(vfs: Record<string, unknown>): void;
  setFonts(fonts: Record<string, unknown>): void;
  createPdf(def: Record<string, unknown>): { getBuffer(): Promise<Uint8Array> };
}

/** Dựng PDF. Nạp pdfmake và phông Inter bằng `import()` ở lần gọi đầu (chunk riêng, không có ở tải khởi động). */
export async function buildPdf(
  t: ReportTable,
  meta: ExportMeta,
  labels: ExportLabels,
  footer = '',
): Promise<Uint8Array> {
  const [pm, fonts] = await Promise.all([
    import('pdfmake/build/pdfmake.min.js'),
    import('./pdf-fonts.ts'),
  ]);
  const pdfMake = ((pm as { default?: PdfMake }).default ?? pm) as unknown as PdfMake;
  pdfMake.addVirtualFileSystem(fonts.INTER_VFS);
  pdfMake.setFonts(fonts.INTER_FONTS);
  return pdfMake.createPdf(pdfDefinition(t, meta, labels, footer)).getBuffer();
}
