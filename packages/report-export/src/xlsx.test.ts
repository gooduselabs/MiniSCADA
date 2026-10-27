// @vitest-environment jsdom
// T098 (XLSX): một sheet, ô số là số với numFmt theo decimals, freeze panes, chuỗi nội tuyến, XML hợp lệ, thoát & < > ",
// ô bắt đầu = + - @, đọc lại khớp 100 % ô. T050 (feature 012): tiêu đề màu theo chủ đề, độ rộng theo nội dung, numFmt có
// đơn vị. Bộ đọc viết riêng cho test: fflate (giải nén) + DOMParser (XML).
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildXlsx } from './xlsx/xlsx.ts';
import { LABELS, META, hostileTable, tableFromVector } from './testing.ts';

const dec = new TextDecoder();

interface Cell {
  ref: string;
  type: string | null;
  style: number | null;
  text: string;
}
function readSheet(bytes: Uint8Array) {
  const zip = unzipSync(bytes);
  const xml = (name: string) => {
    const d = new DOMParser().parseFromString(dec.decode(zip[name]), 'application/xml');
    expect(d.getElementsByTagName('parsererror').length, `${name}: XML hợp lệ`).toBe(0);
    return d;
  };
  const sheet = xml('xl/worksheets/sheet1.xml');
  const rows: Cell[][] = [];
  for (const r of Array.from(sheet.getElementsByTagName('row'))) {
    rows.push(
      Array.from(r.getElementsByTagName('c')).map((c) => ({
        ref: c.getAttribute('r')!,
        type: c.getAttribute('t'),
        style: c.hasAttribute('s') ? Number(c.getAttribute('s')) : null,
        text:
          c.getElementsByTagName('v')[0]?.textContent ??
          Array.from(c.getElementsByTagName('t'))
            .map((x) => x.textContent)
            .join(''),
      })),
    );
  }
  return { zip, sheet, rows, xml };
}

const t = tableFromVector('report-shift-3-0600');
const stdNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

describe('XLSX', () => {
  const bytes = buildXlsx(t, META, LABELS);
  const { zip, sheet, rows, xml } = readSheet(bytes);

  it('gói ZIP đủ phần cần thiết, một sheet, mọi phần là XML hợp lệ', () => {
    for (const f of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]) {
      expect(zip[f], f).toBeDefined();
      xml(f);
    }
    expect(
      Object.keys(zip).filter((f) => f.startsWith('xl/worksheets/') && f.endsWith('.xml')),
    ).toEqual(['xl/worksheets/sheet1.xml']);
    expect(xml('xl/workbook.xml').getElementsByTagName('sheet').length).toBe(1);
    expect(xml('xl/workbook.xml').getElementsByTagName('sheet')[0]!.getAttribute('name')).toBe(
      'Điện năng',
    );
  });

  it('tiêu đề, kỳ, người xuất, giờ xuất, hàng tiêu đề cột', () => {
    expect(rows[0]![0]!.text).toBe(t.title);
    expect(rows[1]![0]!.text).toBe(`${LABELS.period}: ${t.periodLabel}`);
    expect(rows[2]![0]!.text).toBe(`${LABELS.exportedBy}: vanhanh1`);
    expect(rows[3]![0]!.text).toBe(`${LABELS.exportedAt}: 2026-10-13 10:30:45`);
    const header = rows.find((r) => r[0]!.text === LABELS.rowHeader)!;
    expect(header.slice(1).map((c) => c.text)).toEqual(
      t.columns.map((c) => `${c.label} - ${LABELS.fn[c.fn]}${c.unit ? ` (${c.unit})` : ''}`),
    );
  });

  it('ô số là số (không phải chuỗi) và khớp từng ô của bảng; nhãn hàng là chuỗi', () => {
    const h = rows.findIndex((r) => r[0]!.text === LABELS.rowHeader);
    t.rows.forEach((tr, i) => {
      const r = rows[h + 1 + i]!;
      expect(r[0]!.type).toBe('inlineStr');
      expect(r[0]!.text).toBe(tr.label);
      tr.cells.forEach((v, k) => {
        const c = r[k + 1];
        if (v === null) return expect(c === undefined || c.text === '').toBe(true);
        expect(c!.type, `${tr.label}[${k}]`).toBeNull(); // số: không có t="s"/"inlineStr"
        expect(Number(c!.text)).toBe(stdNum(tr.text[k]!));
      });
    });
    const total = rows[h + 1 + t.rows.length]!;
    expect(total[0]!.text).toBe(LABELS.total);
    t.totals!.forEach((_v, k) =>
      expect(Number(total[k + 1]!.text)).toBe(stdNum(t.totalsText![k]!)),
    );
  });

  it('numFmt theo decimals và đơn vị của từng cột (T050: phân cách nghìn, đơn vị là chữ trong nháy)', () => {
    const styles = xml('xl/styles.xml');
    const h = rows.findIndex((r) => r[0]!.text === LABELS.rowHeader);
    for (const row of [rows[h + 1]!, rows[h + 1 + t.rows.length]!])
      // hàng dữ liệu đầu và dòng tổng
      t.columns.forEach((col, k) => {
        const dec = col.decimals === 0 ? '' : `.${'0'.repeat(col.decimals)}`;
        expect(formatOf(styles, row[k + 1]!.style), col.key).toBe(
          `#,##0${dec}${col.unit ? `" ${col.unit}"` : ''}`,
        );
      });
  });

  it('ký tự đặc biệt của đơn vị không phá định dạng số: bỏ nháy kép và gạch ngược, % là chữ', () => {
    const odd = {
      ...t,
      columns: t.columns.map((c, i) => ({ ...c, unit: ['%', 'm³/h', 'a"b\\c'][i] ?? c.unit })),
    };
    const r = readSheet(buildXlsx(odd, META, LABELS));
    const styles = r.xml('xl/styles.xml');
    const h = r.rows.findIndex((x) => x[0]!.text === LABELS.rowHeader);
    const codes = odd.columns.map((_, k) => formatOf(styles, r.rows[h + 1]![k + 1]!.style));
    expect(codes[0]).toMatch(/" %"$/);
    expect(codes[1]).toMatch(/" m³\/h"$/);
    expect(codes[2]).toMatch(/" abc"$/);
  });

  it('freeze panes dưới hàng tiêu đề cột', () => {
    const pane = sheet.getElementsByTagName('pane')[0]!;
    const h = rows.findIndex((r) => r[0]!.text === LABELS.rowHeader);
    expect(pane.getAttribute('state')).toBe('frozen');
    expect(Number(pane.getAttribute('ySplit'))).toBe(h + 1);
  });

  it('độ rộng cột tự tính theo nội dung, tối đa 40 ký tự', () => {
    const cols = Array.from(sheet.getElementsByTagName('col')).map((c) =>
      Number(c.getAttribute('width')),
    );
    expect(cols.length).toBe(t.columns.length + 1);
    for (const w of cols) {
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(40 + 2);
    }
  });

  // ---- T050 (feature 012, FR-039) ----

  const colWidths = () =>
    Array.from(sheet.getElementsByTagName('col')).map((c) => Number(c.getAttribute('width')));
  const headerIdx = () => rows.findIndex((r) => r[0]!.text === LABELS.rowHeader);

  it('hàng tiêu đề cột có nền màu nhấn của chủ đề (atscada; chủ đề cũ bị bỏ qua), chữ trắng đậm, xuống dòng', () => {
    const styles = xml('xl/styles.xml');
    for (const c of rows[headerIdx()]!) {
      const s = styleOf(styles, c.style);
      expect(s.fill, c.text).toBe('FF007272');
      expect(s.fontColor).toBe('FFFFFFFF');
      expect(s.bold).toBe(true);
      expect(s.wrap).toBe(true);
    }
    const ind = readSheet(buildXlsx(t, { ...META, theme: 'industrial' }, LABELS));
    const st = ind.xml('xl/styles.xml');
    const hi = ind.rows.findIndex((r) => r[0]!.text === LABELS.rowHeader);
    expect(styleOf(st, ind.rows[hi]![0]!.style).fill).toBe('FF007272');
  });

  it('tiêu đề báo cáo chữ lớn đậm màu nhấn', () => {
    const s = styleOf(xml('xl/styles.xml'), rows[0]![0]!.style);
    expect(s.bold).toBe(true);
    expect(s.size).toBeGreaterThanOrEqual(14);
    expect(s.fontColor).toBe('FF007272');
  });

  it('độ rộng cột số theo số dài nhất kèm đơn vị, tiêu đề dài thì xuống dòng thay vì kéo rộng cột', () => {
    const w = colWidths();
    const h = headerIdx();
    t.columns.forEach((col, k) => {
      const texts = [...t.rows.map((r) => r.text[k]!), ...(t.totalsText ?? []).slice(k, k + 1)];
      const num = Math.max(...texts.map((s) => s.length)) + (col.unit ? col.unit.length + 1 : 0);
      const header = rows[h]![k + 1]!.text;
      const word = Math.max(...header.split(/\s+/).map((x) => [...x].length));
      expect(w[k + 1], `${col.key}: đủ cho số và đơn vị`).toBeGreaterThanOrEqual(num + 1);
      expect(w[k + 1], `${col.key}: đủ cho từ dài nhất của tiêu đề`).toBeGreaterThanOrEqual(word);
      expect(w[k + 1], `${col.key}: không rộng bằng cả tiêu đề`).toBeLessThan([...header].length);
    });
    expect(w[0]).toBeGreaterThanOrEqual(Math.max(...t.rows.map((r) => [...r.label].length)));
  });

  it('hàng tiêu đề cột cao đủ cho số dòng xuống (ht, customHeight)', () => {
    const row = Array.from(sheet.getElementsByTagName('row'))[headerIdx()]!;
    expect(row.getAttribute('customHeight')).toBe('1');
    expect(Number(row.getAttribute('ht'))).toBeGreaterThanOrEqual(30);
  });
});

/** formatCode của kiểu ô (numFmt riêng hoặc dựng sẵn 0). */
function formatOf(styles: Document, style: number | null): string {
  const xfs = Array.from(styles.getElementsByTagName('cellXfs')[0]!.getElementsByTagName('xf'));
  const id = xfs[style ?? 0]!.getAttribute('numFmtId');
  return (
    Array.from(styles.getElementsByTagName('numFmt'))
      .find((n) => n.getAttribute('numFmtId') === id)
      ?.getAttribute('formatCode') ?? (id === '0' ? 'General' : `builtin:${id}`)
  );
}

/** Phông và nền của kiểu ô. */
function styleOf(styles: Document, style: number | null) {
  const xf = Array.from(styles.getElementsByTagName('cellXfs')[0]!.getElementsByTagName('xf'))[
    style ?? 0
  ]!;
  const font = Array.from(styles.getElementsByTagName('fonts')[0]!.getElementsByTagName('font'))[
    Number(xf.getAttribute('fontId'))
  ]!;
  const fill = Array.from(styles.getElementsByTagName('fills')[0]!.getElementsByTagName('fill'))[
    Number(xf.getAttribute('fillId'))
  ]!;
  return {
    bold: font.getElementsByTagName('b').length > 0,
    size: Number(font.getElementsByTagName('sz')[0]?.getAttribute('val')),
    fontColor: font.getElementsByTagName('color')[0]?.getAttribute('rgb') ?? null,
    fill: fill.getElementsByTagName('fgColor')[0]?.getAttribute('rgb') ?? null,
    wrap: xf.getElementsByTagName('alignment')[0]?.getAttribute('wrapText') === '1',
  };
}

describe('XLSX: chuỗi độc hại', () => {
  const h = hostileTable();
  const { rows, zip } = readSheet(buildXlsx(h, META, LABELS));
  const hdr = rows.findIndex((r) => r[0]!.text === LABELS.rowHeader);
  it('chuỗi bắt đầu = + - @ thêm nháy đơn, vẫn là chuỗi nội tuyến', () => {
    expect(rows[hdr + 1]![0]!.text).toBe(`'=HYPERLINK("http://x","a")`);
    expect(rows[hdr + 2]![0]!.text).toBe("'+1+1");
    expect(rows[hdr + 3]![0]!.text).toBe("'-2+3");
    expect(rows[hdr]![1]!.text.startsWith("'@SUM")).toBe(true);
    for (const r of rows.slice(hdr + 1, hdr + 4)) expect(r[0]!.type).toBe('inlineStr');
  });
  it('& < > " được thoát, XML vẫn hợp lệ, tiếng Việt nguyên vẹn', () => {
    const raw = dec.decode(zip['xl/worksheets/sheet1.xml']);
    expect(raw).not.toContain('<script>');
    expect(raw).toContain('&lt;script&gt;');
    expect(raw).toContain('a &amp; b &quot;c&quot; &lt;d&gt;');
    expect(rows[0]![0]!.text).toBe('Điện năng ằ ễ ỹ');
  });
  it('ký tự điều khiển không hợp lệ trong XML bị bỏ', () => {
    const t2 = { ...h, title: 'a\u0000b\u0008c' };
    const r = readSheet(buildXlsx(t2, META, LABELS));
    expect(r.rows[0]![0]!.text).toBe('abc');
  });
  it('tên trang tính được làm sạch và cắt 31 ký tự', () => {
    const z = unzipSync(buildXlsx(h, { ...META, sheetName: '[A]:*?/\\' + 'x'.repeat(40) }, LABELS));
    const name = new DOMParser()
      .parseFromString(dec.decode(z['xl/workbook.xml']), 'application/xml')
      .getElementsByTagName('sheet')[0]!
      .getAttribute('name')!;
    expect(name).not.toMatch(/[[\]:*?/\\]/);
    expect(name.length).toBeLessThanOrEqual(31);
  });
});
