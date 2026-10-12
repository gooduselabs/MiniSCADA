// CSV của lưới (feature 006, T085; research R22; FR-045): RFC 4180, BOM, dấu phân cách `,` `;` tab, ô trong ngoặc kép có
// xuống dòng, xuất UTF-8 có BOM (dấu phân cách `;` khi dấu thập phân là `,`), chống chèn công thức (ô chữ bắt đầu
// `= + - @`, tab, CR được thêm `'` khi xuất và bỏ đúng một `'` khi nhập), nhận diện bảng mã.
import { describe, expect, it } from 'vitest';
import { decodeCsvBytes, detectDelimiter, parseCsv, toCsv } from './index.ts';

describe('parseCsv', () => {
  it('RFC 4180: ô trong ngoặc kép có dấu phân cách, nháy kép lặp đôi, xuống dòng', () => {
    const r = parseCsv('a,b,c\r\n1,"x, y","nói ""hay"""\r\n"dòng 1\ndòng 2",,z\r\n');
    expect(r.delimiter).toBe(',');
    expect(r.rows).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', 'nói "hay"'],
      ['dòng 1\ndòng 2', '', 'z'],
    ]);
  });

  it('bỏ BOM; dòng cuối không bắt buộc xuống dòng; không thêm dòng rỗng giả', () => {
    expect(parseCsv('﻿a,b\n1,2').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\n1,2\n').rows).toHaveLength(2);
    expect(parseCsv('').rows).toEqual([]);
  });

  it('tự nhận dấu phân cách: dấu phẩy, chấm phẩy, tab; dấu trong ngoặc kép không tính', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('a,b,c')).toBe(',');
    expect(detectDelimiter('"a;b;c",d')).toBe(',');
    expect(detectDelimiter('abc')).toBe(',');
    expect(parseCsv('a;b\n1;2').rows[1]).toEqual(['1', '2']);
  });

  it('ép dấu phân cách: dấu khác là chữ thường', () => {
    expect(parseCsv('a;b,c\n1;2,3', ',').rows[0]).toEqual(['a;b', 'c']);
  });

  it('nháy kép dở dang (file hỏng): đọc tới hết, không ném lỗi', () => {
    expect(parseCsv('a,"b\nc').rows).toEqual([['a', 'b\nc']]);
  });

  it('khi nhập bỏ đúng một nháy đơn ở ô bắt đầu bằng ký tự công thức', () => {
    const r = parseCsv("'=SUM(A1),'+84,'-x,'@a,'abc,''=x\n");
    expect(r.rows[0]).toEqual(['=SUM(A1)', '+84', '-x', '@a', "'abc", "'=x"]);
  });
});

describe('toCsv', () => {
  it('UTF-8 có BOM, dòng CRLF, ô có dấu phân cách, nháy kép hay xuống dòng được bọc', () => {
    const text = toCsv([
      ['Tên', 'Mô tả'],
      ['A', 'nói "hay", đúng\nxuống dòng'],
    ]);
    expect(text.startsWith('﻿')).toBe(true);
    expect(text).toBe('﻿Tên,Mô tả\r\nA,"nói ""hay"", đúng\nxuống dòng"\r\n');
  });

  it('dấu thập phân là phẩy thì dấu phân cách là chấm phẩy và số thập phân đổi dấu', () => {
    const text = toCsv([['x', '1.5', '-2.25', 'TANK01.LEVEL', '3']], { decimal: ',' });
    expect(text).toBe('﻿x;1,5;-2,25;TANK01.LEVEL;3\r\n');
    expect(parseCsv(text).delimiter).toBe(';');
  });

  it('ô chữ bắt đầu bằng = + - @ tab CR được thêm nháy đơn; số thì không', () => {
    const text = toCsv([['=SUM(A1)', '+x', '-x', '@a', '\tT', '\rC', '-5', '+84', '1e-3', 'abc']]);
    expect(text).toBe("﻿'=SUM(A1),'+x,'-x,'@a,\"'\tT\",\"'\rC\",-5,+84,1e-3,abc\r\n");
  });

  it('xuất rồi nhập lại không đổi (kể cả ô công thức, tiếng Việt, xuống dòng, ô rỗng)', () => {
    const rows = [
      ['Tên', 'Mô tả', 'Min'],
      ['TANK01.LEVEL', '=A1+B1', '-5'],
      ['PUMP01', 'dòng 1\ndòng 2', ''],
      ['X', "'=đã có nháy", '+3'],
      ['@mention', '"trích"', '1.5'],
    ];
    for (const delimiter of [',', ';', '\t'] as const) {
      const text = toCsv(rows, { delimiter });
      expect(parseCsv(text, delimiter).rows, JSON.stringify(delimiter)).toEqual(rows);
    }
    const comma = toCsv(rows, { decimal: ',' });
    expect(parseCsv(comma).rows.map((r) => r.map((c) => c.replace(',', '.')))).toEqual(rows);
  });
});

describe('decodeCsvBytes (bảng mã)', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it('BOM UTF-8: bỏ BOM', () => {
    const r = decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('Tên;Kiểu')]));
    expect(r).toEqual({ text: 'Tên;Kiểu', encoding: 'utf-8' });
  });

  it('UTF-8 hợp lệ không BOM', () => {
    expect(decodeCsvBytes(bytes('Mức nước')).encoding).toBe('utf-8');
  });

  it('không phải UTF-8 hợp lệ: Windows-1258 (file CSV của Excel tiếng Việt)', () => {
    // "Tên" trong Windows-1258: T=0x54, ê=0xEA, n=0x6E.
    const r = decodeCsvBytes(new Uint8Array([0x54, 0xea, 0x6e]));
    expect(r.encoding).toBe('windows-1258');
    expect(r.text).toBe('Tên');
  });

  it('đổi bảng mã bằng tay ở bước xem trước', () => {
    const raw = new Uint8Array([0x54, 0xea, 0x6e]);
    expect(decodeCsvBytes(raw, 'windows-1258').text).toBe('Tên');
    // Ép UTF-8 trên byte không hợp lệ: ký tự thay thế, không ném lỗi.
    expect(decodeCsvBytes(raw, 'utf-8').text).toContain('�');
  });
});
