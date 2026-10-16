// M3 và M4 (rà soát 010): guardFormula có \t \r như bản C++; XLSX ghi ô trống khi chữ số không phải số vi-VN hợp lệ.
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { guardFormula } from './csv/csv.ts';
import { buildXlsx } from './xlsx/xlsx.ts';
import { LABELS, META, tableFromVector } from './testing.ts';

describe('guardFormula: tab và CR đầu ô', () => {
  it('thêm nháy đơn cho = + - @ \\t \\r; chuỗi thường giữ nguyên', () => {
    for (const s of ['=1', '+1', '-1', '@a', '\tx', '\rx']) expect(guardFormula(s)).toBe(`'${s}`);
    for (const s of ['', 'abc', 'a=1', ' =1']) expect(guardFormula(s)).toBe(s);
  });
});

describe('XLSX: ô số sai hình dạng', () => {
  it('chuỗi mũ hoặc Infinity thành ô trống, không phải <v>1e+25</v>', () => {
    const bad = structuredClone(tableFromVector('report-shift-3-0600'));
    bad.rows[0]!.text[0] = '1e+25';
    bad.rows[0]!.text[1] = 'Infinity';
    const zip = unzipSync(buildXlsx(bad, META, LABELS));
    const xml = new TextDecoder().decode(zip['xl/worksheets/sheet1.xml']);
    expect(xml).not.toMatch(/<v>[^<]*(e\+|Infinity|NaN)/i);
    expect(xml).not.toContain('<v>NaN');
  });
  it('số vi-VN hợp lệ vẫn là số', () => {
    const ok = structuredClone(tableFromVector('report-shift-3-0600'));
    ok.rows[0]!.text[0] = '1.234,5';
    const xml = new TextDecoder().decode(
      unzipSync(buildXlsx(ok, META, LABELS))['xl/worksheets/sheet1.xml'],
    );
    expect(xml).toContain('<v>1234.5</v>');
  });
});
