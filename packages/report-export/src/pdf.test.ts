// T098 (PDF): khổ và hướng, lặp hàng tiêu đề, trích chữ khớp 100 % ô, dấu Việt, nhiều trang.
import { extractText, getDocumentProxy } from 'unpdf';
import { describe, expect, it } from 'vitest';
import { buildPdf } from './pdf/pdf.ts';
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
});
