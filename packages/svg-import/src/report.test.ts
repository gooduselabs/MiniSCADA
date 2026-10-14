// T041: test báo cáo (FR-020, FR-022; contract §6). Viết TRƯỚC, phải đỏ.
import { describe, expect, it } from 'vitest';
import { VI_IMPORT, viMessage } from './i18n/vi-import.ts';
import { ReportBuilder, fileNameOf, reportToMarkdown, sha256Hex } from './report.ts';

const init = {
  file: { name: 'a.svg', bytes: 10, sha256: 'x' },
  generator: { name: 'Inkscape', certainty: 'có dấu hiệu' as const, evidence: ['ns'] },
  counts: { elementsBefore: 10, elementsAfter: 8, depth: 3, uidAssigned: 5, named: 2 },
  viewBox: [0, 0, 10, 10] as [number, number, number, number],
  optimize: { enabled: false, merged: 0, elementsSaved: 0 },
};

describe('ReportBuilder', () => {
  it('gộp theo (mã, tên), đếm số lần, ví dụ tối đa 3', () => {
    const b = new ReportBuilder();
    for (let i = 1; i <= 5; i++) b.removed('element', 'R_SCRIPT', 'script', `/svg/g[1]/script[${i}]`);
    const r = b.build(init);
    expect(r.removed).toHaveLength(1);
    expect(r.removed[0]).toMatchObject({ kind: 'element', code: 'R_SCRIPT', name: 'script', count: 5 });
    expect(r.removed[0].examples).toEqual(['/svg/g[1]/script[1]', '/svg/g[1]/script[2]', '/svg/g[1]/script[3]']);
  });
  it('sắp xếp tất định theo mã rồi tên, bất kể thứ tự thêm', () => {
    const add = (order: string[]) => {
      const b = new ReportBuilder();
      for (const c of order) b.removed('element', c, c.toLowerCase());
      b.converted('C_UNITS', 'đơn vị');
      b.converted('C_CSS', 'css');
      b.warn('W_IMPORT_HEAVY', 'm');
      b.warn('W_IMPORT_CSS_PARTIAL', 'm');
      return JSON.stringify(b.build(init));
    };
    expect(add(['R_B', 'R_A', 'R_C'])).toBe(add(['R_C', 'R_A', 'R_B']));
    const r = JSON.parse(add(['R_B', 'R_A']));
    expect(r.removed.map((x: { code: string }) => x.code)).toEqual(['R_A', 'R_B']);
    expect(r.converted.map((x: { code: string }) => x.code)).toEqual(['C_CSS', 'C_UNITS']);
    expect(r.warnings.map((x: { code: string }) => x.code)).toEqual(['W_IMPORT_CSS_PARTIAL', 'W_IMPORT_HEAVY']);
  });
  it('cấu trúc theo contract §6', () => {
    const r = new ReportBuilder().build(init);
    expect(r.tool).toBe('mat-svg-import 0.1.0');
    expect(Object.keys(r).sort()).toEqual(
      ['converted', 'counts', 'file', 'fonts', 'generator', 'match', 'optimize', 'removed', 'tool', 'viewBox', 'warnings'].sort(),
    );
    expect(r.match).toBeNull();
    expect(r.fonts).toEqual({ used: [], mapped: [], fallback: [] });
  });
  it('codes() trả mọi mã đã ghi', () => {
    const b = new ReportBuilder();
    b.removed('attribute', 'R_EVENT_ATTR', 'onclick');
    b.converted('C_CSS', 'css');
    b.warn('W_IMPORT_NO_DRAWABLE', 'x');
    expect([...b.codes()].sort()).toEqual(['C_CSS', 'R_EVENT_ATTR', 'W_IMPORT_NO_DRAWABLE']);
  });
  it('không chứa nội dung SVG gốc: chỉ tên thẻ và đường dẫn', () => {
    const b = new ReportBuilder();
    b.removed('element', 'R_SCRIPT', 'script', '/svg/script[1]');
    const json = JSON.stringify(b.build(init));
    expect(json).not.toContain('alert');
    expect(json).not.toContain('<');
  });
});

describe('fileNameOf', () => {
  it('đường dẫn file:/// chỉ còn tên tệp', () => {
    expect(fileNameOf('file:///C:/Users/x/a.png')).toBe('a.png');
    expect(fileNameOf('file:///home/u/b%20c.png')).toBe('b c.png');
    expect(fileNameOf('C:\\dir\\z.png')).toBe('z.png');
  });
});

describe('sha256Hex', () => {
  it('đúng giá trị chuẩn', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('reportToMarkdown', () => {
  it('sinh từ cùng dữ liệu: có tên tệp, mã và câu tiếng Việt', () => {
    const b = new ReportBuilder();
    b.removed('element', 'R_SCRIPT', 'script', '/svg/script[1]');
    b.converted('C_CSS', 'khai báo CSS', 'thành thuộc tính', 4);
    b.warn('W_IMPORT_HEAVY', 'nặng');
    const md = reportToMarkdown(b.build(init));
    expect(md).toContain('a.svg');
    expect(md).toContain('R_SCRIPT');
    expect(md).toContain('C_CSS');
    expect(md).toContain('W_IMPORT_HEAVY');
    expect(md).toContain(VI_IMPORT.R_SCRIPT);
    expect(md).toContain('/svg/script[1]');
  });
});

describe('i18n vi-import', () => {
  it('có câu tiếng Việt cho mọi mã trong contract §6', () => {
    const codes = [
      'R_SCRIPT', 'R_EVENT_ATTR', 'R_FOREIGN', 'R_NAMESPACE', 'R_ELEMENT_NOT_ALLOWED', 'R_ATTR_NOT_ALLOWED',
      'R_VALUE_INVALID', 'R_HREF_EXTERNAL', 'R_URL_EXTERNAL', 'R_DATA_ATTR', 'R_CSS_PROP', 'R_CSS_RULE',
      'R_CSS_AT', 'R_PI', 'R_DTD', 'R_IMAGE_LINKED', 'R_IMAGE_BAD', 'R_IMAGE_LIMIT', 'R_FILTER_HEAVY',
      'R_FILTER_LIMIT', 'R_FONT_SVG', 'R_SMIL', 'R_META', 'R_EMPTY', 'R_UNUSED_DEF', 'R_DANGLING_REF',
      'R_TEXT_LONG', 'C_CSS', 'C_UNITS', 'C_SWITCH', 'C_FLOWROOT', 'C_FONT_MAP', 'C_ENTITY', 'C_XLINK',
      'C_ROUND', 'C_DUP_ID', 'W_IMPORT_CSS_PARTIAL', 'W_IMPORT_FLOWTEXT_NOWRAP', 'W_IMPORT_NO_DRAWABLE',
      'W_IMPORT_FONT_FALLBACK', 'W_IMPORT_HEAVY', 'E_IMPORT_LIMIT', 'E_IMPORT_PARSE', 'E_IMPORT_ENCODING',
      'E_IMPORT_ROOT', 'E_IMPORT_DTD', 'E_IMPORT_USE_BOMB', 'E_IMPORT_SIZE', 'E_IMPORT_EXT',
    ];
    for (const c of codes) expect(viMessage(c).length, c).toBeGreaterThan(10);
    expect(VI_IMPORT.R_SCRIPT).toBe('Phần tử script bị loại: file SVG nhập vào không được chứa mã chạy');
  });
});
