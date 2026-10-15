// T098 (PDF): khổ và hướng, lặp hàng tiêu đề, trích chữ khớp 100 % ô, dấu Việt, nhiều trang.
import { extractText, getDocumentProxy } from 'unpdf';
import { describe, expect, it } from 'vitest';
import { buildPdf } from './pdf/pdf.ts';
import type { ReportTable } from '@mat/history-math';
import { LABELS, META, tableFromVector } from './testing.ts';

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
