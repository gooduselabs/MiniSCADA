// T098 (CSV): hai kiểu, BOM, escape, số, ô chuỗi bắt đầu = + - @ thêm dấu nháy đơn.
import { describe, expect, it } from 'vitest';
import { csvBytes, toCsv } from './csv/csv.ts';
import { LABELS, hostileTable, tableFromVector } from './testing.ts';

/** Bộ đọc CSV RFC 4180 viết riêng cho test (độc lập với bộ ghi). */
function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(cur);
      cur = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
      i++;
    } else cur += c;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

const t = tableFromVector('report-shift-3-0600');
const std = (s: string) => s.replace(/\./g, '').replace(',', '.');
const vi = (s: string) => s.replace(/\./g, '');

describe('CSV chuẩn', () => {
  const csv = toCsv(t, { style: 'standard', labels: LABELS });
  const rows = parseCsv(csv, ',');

  it('UTF-8 có BOM, xuống dòng CRLF, không BOM trong chuỗi trả về của toCsv', () => {
    const b = csvBytes(t, { style: 'standard', labels: LABELS });
    expect([...b.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(b.slice(3))).toBe(csv);
    expect(csv.startsWith('﻿')).toBe(false);
    expect(csv.includes('\n') && !/[^\r]\n/.test(csv)).toBe(true);
  });

  it('tiêu đề mẫu, kỳ, hàng nhãn cột, các hàng, dòng tổng, ghi chú dữ liệu', () => {
    expect(rows[0]).toEqual([t.title]);
    expect(rows[1]).toEqual([`${LABELS.period}: ${t.periodLabel}`]);
    const header = rows[2]!;
    expect(header[0]).toBe(LABELS.rowHeader);
    expect(header.slice(1)).toEqual(
      t.columns.map((c) => `${c.label} - ${LABELS.fn[c.fn]}${c.unit ? ` (${c.unit})` : ''}`),
    );
    const body = rows.slice(3, 3 + t.rows.length);
    body.forEach((r, i) => {
      expect(r[0]).toBe(t.rows[i]!.label);
      expect(r.slice(1)).toEqual(t.rows[i]!.text.map(std));
    });
    const total = rows[3 + t.rows.length]!;
    expect(total[0]).toBe(LABELS.total);
    expect(total.slice(1)).toEqual(t.totalsText!.map(std));
    expect(rows.at(-1)![0]).toMatch(new RegExp(`^${LABELS.coverage} `));
  });

  it('số dùng dấu chấm thập phân, không phân cách nghìn; ô rỗng cho null', () => {
    for (const r of rows.slice(3, 3 + t.rows.length))
      for (const c of r.slice(1)) expect(c).toMatch(/^(-?\d+(\.\d+)?)?$/);
  });
});

describe('CSV Excel vi-VN', () => {
  const csv = toCsv(t, { style: 'excel-vi', labels: LABELS });
  const rows = parseCsv(csv, ';');
  it('phân tách `;`, thập phân `,`', () => {
    rows
      .slice(3, 3 + t.rows.length)
      .forEach((r, i) => expect(r.slice(1)).toEqual(t.rows[i]!.text.map(vi)));
    expect(rows[2]!.length).toBe(t.columns.length + 1);
  });
});

describe('escape và chống chèn công thức', () => {
  const h = hostileTable();
  const csv = toCsv(h, { style: 'standard', labels: LABELS });
  const rows = parseCsv(csv, ',');
  it('ô chuỗi bắt đầu bằng = + - @ được thêm nháy đơn; ô số không đổi', () => {
    expect(rows[3]![0]).toBe(`'=HYPERLINK("http://x","a")`);
    expect(rows[4]![0]).toBe("'+1+1");
    expect(rows[5]![0]).toBe("'-2+3");
    expect(rows[2]!.some((c) => c.startsWith("'@SUM"))).toBe(true);
    for (const r of rows.slice(3, 6))
      for (const c of r.slice(1)) expect(c.startsWith("'")).toBe(false);
  });
  it('dấu phẩy, nháy kép, xuống dòng, tiếng Việt qua vòng ghi - đọc', () => {
    expect(rows[0]).toEqual(['Điện năng ằ ễ ỹ']);
    expect(rows[1]![0]).toBe(`${LABELS.period}: dòng\nhai`);
    expect(rows[2]!.some((c) => c.startsWith('<script>') || c.startsWith('a & b "c" <d>'))).toBe(
      true,
    );
  });
  it('kiểu Excel vi-VN: ô có `;` được bọc nháy kép', () => {
    const rows2 = parseCsv(
      toCsv(
        { ...h, rows: [{ ...h.rows[0]!, label: 'x;y' }] },
        { style: 'excel-vi', labels: LABELS },
      ),
      ';',
    );
    expect(rows2[3]![0]).toBe('x;y');
  });
});

describe('trường hợp biên', () => {
  it('không có dòng tổng khi totals null', () => {
    const rows = parseCsv(
      toCsv({ ...t, totals: null, totalsText: null }, { style: 'standard', labels: LABELS }),
      ',',
    );
    expect(rows.some((r) => r[0] === LABELS.total)).toBe(false);
  });
  it('hàng chưa tới: ô trống', () => {
    const run = tableFromVector('report-running-day');
    const rows = parseCsv(toCsv(run, { style: 'standard', labels: LABELS }), ',');
    const last = rows[3 + run.rows.length - 1]!;
    expect(last.slice(1).every((c) => c === '')).toBe(true);
  });
});
