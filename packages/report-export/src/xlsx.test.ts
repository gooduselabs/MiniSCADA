// @vitest-environment jsdom
// T098 (XLSX): một sheet, ô số là số với numFmt theo decimals, freeze panes, chuỗi nội tuyến, XML hợp lệ, thoát & < > ",
// ô bắt đầu = + - @, đọc lại khớp 100 % ô. Bộ đọc viết riêng cho test: fflate (giải nén) + DOMParser (XML).
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

  it('numFmt theo decimals của từng cột', () => {
    const styles = xml('xl/styles.xml');
    const fmts = Array.from(styles.getElementsByTagName('numFmt')).map((n) =>
      n.getAttribute('formatCode'),
    );
    const xfs = Array.from(styles.getElementsByTagName('cellXfs')[0]!.getElementsByTagName('xf'));
    const h = rows.findIndex((r) => r[0]!.text === LABELS.rowHeader);
    const first = rows[h + 1]!;
    t.columns.forEach((col, k) => {
      const xf = xfs[first[k + 1]!.style ?? 0]!;
      const id = xf.getAttribute('numFmtId');
      const code = Array.from(styles.getElementsByTagName('numFmt'))
        .find((n) => n.getAttribute('numFmtId') === id)
        ?.getAttribute('formatCode');
      expect(code ?? (id === '1' ? '0' : id === '2' ? '0.00' : ''), col.key).toBe(
        col.decimals === 0 ? '0' : `0.${'0'.repeat(col.decimals)}`,
      );
    });
    expect(fmts.length).toBeGreaterThan(0);
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
});

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
