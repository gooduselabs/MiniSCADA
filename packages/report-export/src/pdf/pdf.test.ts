// T098 (PDF): khổ và hướng, lặp hàng tiêu đề, trích chữ khớp 100 % ô, dấu Việt, nhiều trang.
// T048 (feature 012): mẫu mới: dải tiêu đề, logo, thẻ số liệu, bảng xen kẽ, số trang, Inter, biểu đồ vector.
import { extractText, getDocumentProxy } from 'unpdf';
import { describe, expect, it } from 'vitest';
import { buildPdf, pdfDefinition } from './pdf.ts';
import { REPORT_PALETTES, reportPalette } from '../theme.ts';
import type { ReportTable } from '@mat/history-math';
import { LABELS, META, tableFromVector } from '../testing.ts';

async function pages(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return text as string[];
}
const norm = (s: string) => s.replace(/\s+/g, ' ');

describe('PDF', () => {
  it('báo cáo ca: tiêu đề, kỳ, người xuất, giờ xuất, từng ô và dòng tổng có trong chữ trích ra (dấu Việt)', async () => {
    const t = tableFromVector('report-shift-3-0600');
    const bytes = await buildPdf(t, META, LABELS);
    expect(new TextDecoder('latin1').decode(bytes.slice(0, 5))).toBe('%PDF-');
    const text = norm((await pages(bytes)).join(' '));
    expect(text).toContain(norm(t.title));
    expect(text).toContain(`${LABELS.period}: ${t.periodLabel}`);
    expect(text).toContain(`${LABELS.exportedBy}: vanhanh1`);
    expect(text).toContain('2026-10-13 10:30:45');
    for (const r of t.rows) {
      expect(text, r.label).toContain(norm(r.label));
      for (const c of r.text) if (c !== '') expect(text, `${r.label}: ${c}`).toContain(c);
    }
    for (const c of t.totalsText!) expect(text).toContain(c);
    expect(text).toContain(LABELS.total);
    for (const col of t.columns) expect(text).toContain(col.label);
    expect(text).toContain('Điện năng');
  }, 60000);

  it('báo cáo ngày hàng 15 phút (96 hàng): nhiều trang, mỗi trang lặp tiêu đề cột, có số trang', async () => {
    const t = tableFromVector('report-day-15min');
    const ps = await pages(
      await buildPdf(t, { ...META, paper: { size: 'A4', orientation: 'portrait' } }, LABELS),
    );
    expect(ps.length).toBeGreaterThan(1);
    const header = t.columns[0]!.label;
    for (const [i, p] of ps.entries()) {
      expect(norm(p), `trang ${i + 1} lặp tiêu đề`).toContain(header);
      expect(norm(p)).toContain(`${LABELS.page} ${i + 1} ${LABELS.of} ${ps.length}`);
    }
    const all = norm(ps.join(' '));
    for (const r of t.rows) expect(all, r.label).toContain(norm(r.label));
  }, 60000);

  it('khổ và hướng theo mẫu', async () => {
    const t = tableFromVector('report-shift-3-0600');
    const size = async (paper: NonNullable<typeof META.paper>) => {
      const raw = new TextDecoder('latin1').decode(await buildPdf(t, { ...META, paper }, LABELS));
      const m = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(raw);
      return m ? [Math.round(Number(m[1])), Math.round(Number(m[2]))] : null;
    };
    expect(await size({ size: 'A4', orientation: 'portrait' })).toEqual([595, 842]);
    expect(await size({ size: 'A4', orientation: 'landscape' })).toEqual([842, 595]);
    expect(await size({ size: 'A3', orientation: 'portrait' })).toEqual([842, 1191]);
  }, 90000);

  // Hồi quy T105: số có chấm nghìn ở bảng rộng bị ngắt dòng giữa số ("257.039,2" thành "257." và "039,2").
  function wideTable(nCols: number, nRows: number): ReportTable {
    const base = tableFromVector('report-shift-3-0600');
    const cell = (i: number, k: number) =>
      k % 4 === 3
        ? `6.${155 + i}.${String(100 + k).padStart(3, '0')},3`
        : `${200 + i}.${String(100 + k * 7).padStart(3, '0')},${k % 10}`;
    const columns = Array.from({ length: nCols }, (_, k) => ({
      ...base.columns[0]!,
      key: `c${k}`,
      label: `Điện năng ${k + 1}`,
      unit: 'kWh',
      decimals: 1,
    }));
    const rows = Array.from({ length: nRows }, (_, i) => ({
      ...base.rows[0]!,
      label: `${String(i + 1).padStart(2, '0')}/08`,
      text: columns.map((_, k) => cell(i, k)),
      cells: columns.map((_, k) => 200000 + i * 1000 + k),
    }));
    return { ...base, columns, rows, totals: null, totalsText: null };
  }

  for (const [nCols, paper] of [
    [12, { size: 'A4', orientation: 'landscape' }],
    [12, { size: 'A4', orientation: 'portrait' }],
    [24, { size: 'A4', orientation: 'landscape' }],
  ] as const) {
    it(`bảng ${nCols} cột, ${paper.size} ${paper.orientation}: mọi ô số 9 ký tự nguyên vẹn, không ngắt giữa số`, async () => {
      const t = wideTable(nCols, 31);
      const ps = await pages(await buildPdf(t, { ...META, paper }, LABELS));
      const tokens = new Map<string, number>();
      for (const tok of norm(ps.join(' ')).split(' ')) tokens.set(tok, (tokens.get(tok) ?? 0) + 1);
      const want = new Map<string, number>();
      for (const r of t.rows) for (const c of r.text) want.set(c, (want.get(c) ?? 0) + 1);
      const broken = [...want].filter(([c, n]) => (tokens.get(c) ?? 0) < n).map(([c]) => c);
      expect(broken, `ô bị ngắt: ${broken.slice(0, 5).join(', ')}`).toEqual([]);
    }, 90000);
  }
});

// ---- T048 (feature 012, US4, FR-038, SC-009): mẫu PDF mới ----------------------------------------------------------

type Node = Record<string, unknown>;
/** Mọi đối tượng trong cây định nghĩa pdfmake (duyệt mảng và giá trị đối tượng; bỏ hàm). */
function nodes(root: unknown): Node[] {
  const out: Node[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      out.push(v as Node);
      Object.values(v).forEach(walk);
    }
  };
  walk(root);
  return out;
}
const texts = (root: unknown): string[] =>
  nodes(root)
    .map((n) => n.text)
    .filter((x): x is string => typeof x === 'string');
const svgNodes = (root: unknown) =>
  nodes(root).filter((n) => typeof n.svg === 'string') as Array<Node & { svg: string }>;
const imageNodes = (root: unknown) => nodes(root).filter((n) => typeof n.image === 'string');
/** Bảng dữ liệu chính: bảng có `headerRows` (dải tiêu đề, thẻ số liệu không có). */
const dataTables = (def: Node) =>
  nodes(def.content).filter(
    (n) => (n.table as Node | undefined)?.headerRows !== undefined,
  ) as Array<Node & { table: Node & { body: unknown[][] }; layout: Node }>;

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20" fill="#ff8800"/></svg>';

describe('PDF mẫu mới: định nghĩa tài liệu (T048)', () => {
  const t = tableFromVector('report-shift-3-0600');
  const vivid = REPORT_PALETTES.vivid;

  it('phông mặc định là Inter (không còn Roboto)', () => {
    const def = pdfDefinition(t, META, LABELS);
    expect((def.defaultStyle as Node).font).toBe('Inter');
    expect(JSON.stringify(def)).not.toContain('Roboto');
  });

  it('dải tiêu đề màu nhấn của chủ đề, chữ tiêu đề và kỳ nằm trong dải; mặc định là vivid', () => {
    const def = pdfDefinition(t, META, LABELS);
    const band = nodes(def.content).find((n) => n.fillColor === vivid.accent);
    expect(band, 'ô có nền màu nhấn vivid').toBeDefined();
    expect(texts(band)).toContain(t.title);
    expect(texts(band).join(' ')).toContain(t.periodLabel);
    const title = nodes(band).find((n) => n.text === t.title)!;
    expect(title.color).toBe(vivid.accentInk);
  });

  it('chủ đề industrial lấy màu industrial; dark in trên giấy trắng như vivid', () => {
    const ind = pdfDefinition(t, { ...META, theme: 'industrial' }, LABELS);
    const fills = nodes(ind.content).map((n) => n.fillColor);
    expect(fills).toContain(REPORT_PALETTES.industrial.accent);
    expect(fills).not.toContain(vivid.accent);
    expect(reportPalette('dark')).toEqual(vivid);
  });

  it('logo tùy chọn: SVG thành nút svg, PNG/JPEG data URL thành nút image; không có logo thì không có', () => {
    const none = pdfDefinition(t, META, LABELS);
    expect(imageNodes(none.content)).toEqual([]);
    expect(svgNodes(none.content).filter((n) => n.svg === LOGO_SVG)).toEqual([]);
    const withSvg = pdfDefinition(t, { ...META, logo: LOGO_SVG }, LABELS);
    expect(svgNodes(withSvg.content).some((n) => n.svg === LOGO_SVG)).toBe(true);
    const withPng = pdfDefinition(t, { ...META, logo: PNG_1PX }, LABELS);
    expect(imageNodes(withPng.content).map((n) => n.image)).toEqual([PNG_1PX]);
  });

  it('logo không an toàn bị bỏ: URL ngoài, SVG có script, foreignObject hoặc tham chiếu ngoài', () => {
    for (const logo of [
      'http://example.com/logo.png',
      'data:text/html;base64,PGI+',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="http://x/a.png"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="file:///etc/passwd"/></svg>',
    ]) {
      const def = pdfDefinition(t, { ...META, logo, chart: false }, LABELS);
      expect(imageNodes(def.content), logo).toEqual([]);
      expect(svgNodes(def.content), logo).toEqual([]);
    }
  });

  it('thẻ số liệu tổng hợp: giá trị dòng tổng kèm đơn vị của các cột đầu và thẻ "Dữ liệu đủ"', () => {
    const def = pdfDefinition(t, META, LABELS);
    const cards = nodes(def.content).find((n) => n.id === 'summary-cards');
    expect(cards, 'khối thẻ số liệu').toBeDefined();
    const all = texts(cards);
    expect(all).toContain(t.totalsText![0]);
    expect(all.join(' ')).toContain(t.columns[0]!.label);
    expect(all.join(' ')).toContain(t.columns[0]!.unit);
    expect(all.join(' ')).toContain(LABELS.coverage);
    // bảng không có dòng tổng: chỉ còn thẻ dữ liệu đủ
    const noTot = pdfDefinition({ ...t, totals: null, totalsText: null }, META, LABELS);
    const c2 = texts(nodes(noTot.content).find((n) => n.id === 'summary-cards'));
    expect(c2.join(' ')).toContain(LABELS.coverage);
    expect(c2).not.toContain(t.totalsText![0]);
  });

  it('bảng kẻ xen kẽ: headerRows 1 lặp khi sang trang, hàng tiêu đề màu nhấn, hàng lẻ nền nhạt, không ngắt giữa hàng', () => {
    const def = pdfDefinition(t, META, LABELS);
    const [tbl] = dataTables(def);
    expect(tbl).toBeDefined();
    expect(tbl!.table.headerRows).toBe(1);
    expect(tbl!.table.dontBreakRows).toBe(true);
    const fill = tbl!.layout.fillColor as (row: number) => string | null;
    expect(typeof fill).toBe('function');
    expect(fill(0)).toBe(vivid.accent);
    expect(fill(1)).toBeNull();
    expect(fill(2)).toBe(vivid.zebra);
    expect(fill(3)).toBeNull();
    const head = tbl!.table.body[0] as Node[];
    expect(head.every((c) => c.color === vivid.accentInk && c.bold === true)).toBe(true);
  });

  it('chân trang: "Trang x / n" và chân trang của mẫu', () => {
    const def = pdfDefinition(t, META, LABELS, 'Phòng Kỹ thuật');
    const f = (def.footer as (c: number, n: number) => unknown)(2, 5);
    expect(texts(f)).toContain('Trang 2 / 5');
    expect(texts(f)).toContain('Phòng Kỹ thuật');
  });

  it('biểu đồ là vector: nút svg do ECharts SSR dựng, có nhãn hàng, màu chuỗi của chủ đề, không có ảnh hay script', () => {
    const def = pdfDefinition(t, META, LABELS);
    const charts = svgNodes(def.content).filter((n) => n.id === 'chart');
    expect(charts.length).toBe(1);
    const svg = charts[0]!.svg;
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(t.rows[0]!.label);
    expect(svg.toLowerCase()).toContain(vivid.chart[0]!.toLowerCase());
    expect(svg).not.toMatch(/<image|<foreignObject|<script|href="http/i);
    expect(charts[0]!.width as number).toBeLessThanOrEqual(842 - 2 * 28);
  });

  it('biểu đồ tắt được (chart: false) và không vẽ khi chỉ có một hàng', () => {
    const off = pdfDefinition(t, { ...META, chart: false }, LABELS);
    expect(svgNodes(off.content).filter((n) => n.id === 'chart')).toEqual([]);
    const one = pdfDefinition({ ...t, rows: t.rows.slice(0, 1) }, META, LABELS);
    expect(svgNodes(one.content).filter((n) => n.id === 'chart')).toEqual([]);
  });
});

describe('PDF mẫu mới: tệp PDF thật (T048)', () => {
  const t = tableFromVector('report-shift-3-0600');

  it('nhúng phông Inter (thường, đậm), không nhúng Roboto', async () => {
    const raw = new TextDecoder('latin1').decode(await buildPdf(t, META, LABELS));
    const fonts = [...raw.matchAll(/\/BaseFont\s*\/(?:[A-Z]{6}\+)?([\w-]+)/g)].map((m) => m[1]!);
    expect(fonts).toContain('Inter-Regular');
    expect(fonts).toContain('Inter-SemiBold');
    expect(fonts.some((f) => /Roboto/.test(f))).toBe(false);
  }, 60000);

  it('đủ dấu tiếng Việt (cả U+1EA0-1EF9) ở tiêu đề và chữ trích ra khớp', async () => {
    const title =
      'Báo cáo ạ ả ấ ầ ẩ ẫ ậ ắ ằ ẳ ẵ ặ ẹ ẻ ẽ ế ề ể ễ ệ ỉ ị ọ ỏ ố ồ ổ ỗ ộ ớ ờ ở ỡ ợ ụ ủ ứ ừ ử ữ ự ỳ ỵ ỷ ỹ Ơ Ư Đ';
    const text = norm((await pages(await buildPdf({ ...t, title }, META, LABELS))).join(' '));
    expect(text).toContain(title);
  }, 60000);

  it('biểu đồ vẽ bằng vector: không có ảnh raster, nhãn trục là chữ trích được', async () => {
    const bytes = await buildPdf(t, META, LABELS);
    const raw = new TextDecoder('latin1').decode(bytes);
    expect(raw).not.toMatch(/\/Subtype\s*\/Image/);
    const p1 = norm((await pages(bytes))[0]!);
    const label = t.rows[0]!.label;
    expect(p1.split(label).length - 1, 'nhãn hàng ở bảng và ở trục biểu đồ').toBeGreaterThanOrEqual(
      2,
    );
  }, 60000);

  it('logo PNG thành ảnh trong PDF; logo SVG vẫn là vector', async () => {
    const png = new TextDecoder('latin1').decode(
      await buildPdf(t, { ...META, logo: PNG_1PX }, LABELS),
    );
    expect(png).toMatch(/\/Subtype\s*\/Image/);
    const svg = new TextDecoder('latin1').decode(
      await buildPdf(t, { ...META, logo: LOGO_SVG }, LABELS),
    );
    expect(svg).not.toMatch(/\/Subtype\s*\/Image/);
  }, 60000);
});
