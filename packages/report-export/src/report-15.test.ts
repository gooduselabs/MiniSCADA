// @vitest-environment jsdom
// Feature 015 (T022): PDF, XLSX, CSV dựng từ ReportTable mở rộng: thẻ màu đặc, biểu đồ trong khung có tiêu đề, bảng
// phụ, cột thường (sự kiện), ghi chú; XLSX có sọc, dòng tổng đậm có nền, ô số của bảng phụ là số.
import { alarmReport, localMidnight, parseUtcOffset, type ReportTable } from '@mat/history-math';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { toCsv } from './csv/csv.ts';
import { pdfDefinition } from './pdf/pdf.ts';
import { TILE_HEX, reportPalette } from './theme.ts';
import { LABELS, META, tableFromVector } from './testing.ts';
import { buildXlsx } from './xlsx/xlsx.ts';

const TZ = '+07:00';
const D0 = localMidnight(2026, 10, 19, parseUtcOffset(TZ));
const H = 3_600_000;

function alarms(): ReportTable {
  return alarmReport({
    template: { id: 'a', name: 'Alarm ngày', kind: 'alarm', period: 'day' },
    select: { d: '2026-10-19' },
    tz: TZ,
    now: D0 + 30 * H,
    org: 'Nhà máy A',
    items: [
      {
        alarmId: 'x',
        name: 'Mức cao',
        priority: 'critical',
        area: 'bon',
        text: '=cmd|x',
        tsActive: D0 + H,
        tsAck: D0 + H + 600_000,
        tsReturn: null,
      },
      {
        alarmId: 'y',
        name: 'Bơm lỗi',
        priority: 'major',
        area: null,
        text: 'Bơm 1 lỗi',
        tsActive: D0 + 2 * H,
        tsAck: null,
        tsReturn: D0 + 3 * H,
      },
    ],
  });
}

type Node = Record<string, unknown>;
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
const texts = (root: unknown) =>
  nodes(root)
    .map((n) => n.text)
    .filter((x): x is string => typeof x === 'string');

describe('PDF (015)', () => {
  it('thẻ màu đặc theo màu của thẻ, chữ trắng; biểu đồ trong khung có tiêu đề', () => {
    const t = tableFromVector('report-shift-3-0600');
    const def = pdfDefinition(t, META, LABELS);
    const cards = nodes(def.content).find((n) => n.id === 'summary-cards')!;
    const fills = nodes(cards)
      .map((n) => n.fillColor)
      .filter(Boolean);
    expect(fills[0]).toBe(TILE_HEX[t.tiles![0]!.color]);
    expect(
      nodes(cards)
        .filter((n) => n.color)
        .every((n) => n.color === '#ffffff'),
    ).toBe(true);
    const frame = nodes(def.content).find(
      (n) => n.table && nodes(n).some((x) => x.id === 'chart'),
    ) as { table: { body: Node[][] } };
    expect(frame.table.body[0]![0]!.text).toBe(t.chart!.title);
  });

  it('báo cáo alarm: tên đơn vị, không có "Dữ liệu đủ", bảng phụ với tiêu đề, chữ nguyên văn', () => {
    const t = alarms();
    const def = pdfDefinition(t, META, LABELS);
    const all = texts(def.content);
    expect(all).toContain('NHÀ MÁY A');
    expect(all.join(' ')).not.toContain(LABELS.coverage);
    for (const s of t.sections!) expect(all).toContain(s.title);
    expect(all).toContain('=cmd|x');
    expect(all).toContain('Xuất hiện');
  });

  it('tiles: [] và chart: null thì không có thẻ, không có biểu đồ', () => {
    const t = { ...tableFromVector('report-shift-3-0600'), tiles: [], chart: null };
    const def = pdfDefinition(t, META, LABELS);
    expect(nodes(def.content).find((n) => n.id === 'summary-cards')).toBeUndefined();
    expect(nodes(def.content).find((n) => n.id === 'chart')).toBeUndefined();
  });
});

function sheet(bytes: Uint8Array) {
  const z = unzipSync(bytes);
  const doc = (p: string) => new DOMParser().parseFromString(strFromU8(z[p]!), 'text/xml');
  const s = doc('xl/worksheets/sheet1.xml');
  const st = doc('xl/styles.xml');
  const xfs = Array.from(st.getElementsByTagName('cellXfs')[0]!.getElementsByTagName('xf'));
  const fills = Array.from(st.getElementsByTagName('fills')[0]!.getElementsByTagName('fill'));
  const fonts = Array.from(st.getElementsByTagName('fonts')[0]!.getElementsByTagName('font'));
  const styleOf = (c: Element) => {
    const xf = xfs[Number(c.getAttribute('s') ?? 0)]!;
    return {
      fill:
        fills[Number(xf.getAttribute('fillId'))]!.getElementsByTagName('fgColor')[0]?.getAttribute(
          'rgb',
        ) ?? null,
      bold: fonts[Number(xf.getAttribute('fontId'))]!.getElementsByTagName('b').length > 0,
    };
  };
  const rows = Array.from(s.getElementsByTagName('row')).map((r) =>
    Array.from(r.getElementsByTagName('c')),
  );
  const text = (c: Element) =>
    c.getElementsByTagName('t')[0]?.textContent ??
    c.getElementsByTagName('v')[0]?.textContent ??
    '';
  return { rows, styleOf, text, s };
}

describe('XLSX (015)', () => {
  it('sọc, dòng tổng đậm có nền, thẻ tổng hợp là số, cố định hàng đầu', async () => {
    const t = tableFromVector('report-shift-3-0600');
    const x = sheet(buildXlsx(t, META, LABELS));
    const p = reportPalette(META.theme);
    const hi = x.rows.findIndex((r) => x.text(r[0]!) === LABELS.rowHeader);
    expect(x.styleOf(x.rows[hi + 1]![0]!).fill).toBeNull();
    expect(x.styleOf(x.rows[hi + 2]![0]!).fill).toBe(`FF${p.zebra.slice(1).toUpperCase()}`);
    const total = x.rows.find((r) => x.text(r[0]!) === LABELS.total)!;
    expect(x.styleOf(total[1]!).bold).toBe(true);
    expect(x.styleOf(total[1]!).fill).toBe(`FF${p.chartSoft[0]!.slice(1).toUpperCase()}`);
    const tileRow = x.rows.find((r) => x.text(r[0]!) === t.tiles![0]!.label)!;
    expect(tileRow[1]!.getElementsByTagName('v')).toHaveLength(1);
    expect(x.s.getElementsByTagName('pane')[0]!.getAttribute('ySplit')).toBe(String(hi + 1));
  });

  it('báo cáo alarm: bảng phụ dưới bảng chính, ô số là số, chữ chống công thức', () => {
    const t = alarms();
    const x = sheet(buildXlsx(t, META, LABELS));
    const titles = x.rows.map((r) => (r[0] ? x.text(r[0]) : ''));
    for (const s of t.sections!) expect(titles).toContain(s.title);
    const byPrio = titles.indexOf(t.sections![0]!.title);
    const first = x.rows[byPrio + 2]!;
    expect(x.text(first[0]!)).toBe('Khẩn cấp');
    expect(first[1]!.getElementsByTagName('v')[0]!.textContent).toBe('1');
    const all = x.rows.flat().map(x.text);
    expect(all).toContain("'=cmd|x");
    expect(all.join(' ')).not.toContain(LABELS.coverage);
  });
});

describe('CSV (015)', () => {
  it('tên đơn vị, cột thường không kèm hàm, bảng phụ sau dòng trống', () => {
    const t = alarms();
    const csv = toCsv(t, { style: 'standard', labels: LABELS });
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('Nhà máy A');
    expect(lines[3]).toBe('Thời gian,Xuất hiện,Xác nhận,Hết');
    expect(csv).not.toContain(LABELS.coverage);
    const i = lines.indexOf(t.sections![0]!.title);
    expect(lines[i - 1]).toBe('');
    expect(lines[i + 1]).toBe('Mức,Số lần,Chưa xác nhận,TB tới xác nhận (phút)');
    expect(lines[i + 2]).toBe('Khẩn cấp,1,0,10.0');
    expect(csv).toContain("'=cmd|x");
  });
});
