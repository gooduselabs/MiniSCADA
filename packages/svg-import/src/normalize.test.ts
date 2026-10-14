// T039: test chuẩn hóa (FR-017; research R5). Viết TRƯỚC, phải đỏ.
import { describe, expect, it } from 'vitest';
import { normalizePost, normalizePre } from './normalize.ts';
import { ReportBuilder } from './report.ts';
import { doc, parse, parseBody } from './test-helpers.ts';

function post(root: SVGSVGElement) {
  const rep = new ReportBuilder();
  const res = normalizePost(root, rep);
  return { rep, res };
}

describe('normalizePost: kích thước và viewBox', () => {
  it('đơn vị mm về px (C_UNITS) và giữ viewBox', () => {
    const root = parse(doc('<rect width="1" height="1"/>', 'width="100mm" height="50mm" viewBox="0 0 1000 500"'));
    const { rep, res } = post(root);
    expect(res.ok).toBe(true);
    expect(Number(root.getAttribute('width'))).toBeCloseTo(377.953, 2);
    expect(Number(root.getAttribute('height'))).toBeCloseTo(188.976, 2);
    expect(root.getAttribute('viewBox')).toBe('0 0 1000 500');
    expect(rep.codes().has('C_UNITS')).toBe(true);
  });
  it('cm, in, pt, pc, px', () => {
    const cases: Array<[string, number]> = [
      ['2.54cm', 96],
      ['1in', 96],
      ['72pt', 96],
      ['6pc', 96],
      ['96px', 96],
      ['96', 96],
    ];
    for (const [v, px] of cases) {
      const root = parse(doc('', `width="${v}" height="10" viewBox="0 0 10 10"`));
      post(root);
      expect(Number(root.getAttribute('width')), v).toBeCloseTo(px, 3);
    }
  });
  it('thiếu viewBox: sinh từ width/height', () => {
    const root = parse(doc('<rect/>', 'width="200px" height="100px"'));
    const { res } = post(root);
    expect(res).toMatchObject({ ok: true, viewBox: [0, 0, 200, 100] });
    expect(root.getAttribute('viewBox')).toBe('0 0 200 100');
  });
  it('thiếu cả viewBox lẫn kích thước: E_IMPORT_SIZE', () => {
    const { res } = post(parse(doc('<rect/>', '')));
    expect(res).toMatchObject({ ok: false, code: 'E_IMPORT_SIZE' });
  });
});

describe('normalizePre', () => {
  it('switch: mở nhánh đầu không phải foreignObject (C_SWITCH, R_FOREIGN)', () => {
    const root = parseBody(
      '<switch><foreignObject requiredExtensions="x"><div xmlns="http://www.w3.org/1999/xhtml">a</div></foreignObject><g id="keep"><rect width="1" height="1"/></g><foreignObject/></switch>',
    );
    const rep = new ReportBuilder();
    normalizePre(root, rep);
    expect(root.querySelector('switch')).toBeNull();
    expect(root.querySelector('foreignObject')).toBeNull();
    expect(root.querySelector('g#keep rect')).not.toBeNull();
    expect(rep.codes().has('C_SWITCH')).toBe(true);
    expect(rep.codes().has('R_FOREIGN')).toBe(true);
  });
  it('flowRoot thành text một dòng (C_FLOWROOT, W_IMPORT_FLOWTEXT_NOWRAP)', () => {
    const root = parseBody(
      '<flowRoot id="f" font-size="20"><flowRegion><rect x="10" y="20" width="50" height="50"/></flowRegion><flowPara>Xin chào</flowPara><flowPara>thế giới</flowPara></flowRoot>',
    );
    const rep = new ReportBuilder();
    normalizePre(root, rep);
    expect(root.querySelector('flowRoot')).toBeNull();
    const t = root.querySelector('text')!;
    expect(t.textContent).toBe('Xin chào thế giới');
    expect(t.getAttribute('x')).toBe('10');
    expect(t.getAttribute('y')).toBe('40');
    expect(t.getAttribute('id')).toBe('f');
    expect(rep.codes().has('C_FLOWROOT')).toBe(true);
    expect(rep.codes().has('W_IMPORT_FLOWTEXT_NOWRAP')).toBe(true);
  });
  it('<font> SVG bị bỏ (R_FONT_SVG)', () => {
    const root = parseBody('<defs><font id="f"><glyph unicode="a"/></font></defs><rect width="1" height="1"/>');
    const rep = new ReportBuilder();
    normalizePre(root, rep);
    expect(root.querySelector('font')).toBeNull();
    expect(rep.codes().has('R_FONT_SVG')).toBe(true);
  });
  it('xlink:href với mọi tiền tố được đếm (C_XLINK)', () => {
    const root = parse(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:q="http://www.w3.org/1999/xlink"><defs><g id="a"/></defs><use q:href="#a"/></svg>`,
    );
    const rep = new ReportBuilder();
    normalizePre(root, rep);
    expect(rep.codes().has('C_XLINK')).toBe(true);
  });
});

describe('normalizePost: nội dung', () => {
  it('font PostScript theo bảng (C_FONT_MAP), tên lạ thêm sans-serif', () => {
    const root = parseBody(
      '<text font-family="MyriadPro-Regular">a</text><text font-family="ArialMT">b</text><text font-family="Foo Bar">c</text><text font-family="Arial, sans-serif">d</text>',
    );
    const { rep } = post(root);
    const t = Array.from(root.querySelectorAll('text')).map((e) => e.getAttribute('font-family'));
    expect(t[0]).toContain('Myriad Pro');
    expect(t[1]).toContain('Arial');
    expect(t[1]).not.toContain('ArialMT');
    expect(t[2]).toBe("'Foo Bar', sans-serif");
    expect(t[3]).toBe('Arial, sans-serif');
    expect(rep.codes().has('C_FONT_MAP')).toBe(true);
    expect(rep.codes().has('W_IMPORT_FONT_FALLBACK')).toBe(true);
  });
  it('id trùng được đổi tên (C_DUP_ID)', () => {
    const root = parseBody('<rect id="a" width="1" height="1"/><rect id="a" width="2" height="2"/>');
    const { rep } = post(root);
    const ids = Array.from(root.querySelectorAll('rect')).map((e) => e.getAttribute('id'));
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe('a');
    expect(rep.codes().has('C_DUP_ID')).toBe(true);
  });
  it('tham chiếu treo bị bỏ (R_DANGLING_REF)', () => {
    const root = parseBody(
      '<rect fill="url(#nope)" width="1" height="1"/><use href="#nope"/><rect id="ok" width="1" height="1"/><use href="#ok"/>',
    );
    const { rep } = post(root);
    expect(root.querySelector('rect')!.hasAttribute('fill')).toBe(false);
    expect(root.querySelectorAll('use')).toHaveLength(1);
    expect(rep.codes().has('R_DANGLING_REF')).toBe(true);
  });
  it('phần tử rỗng và định nghĩa không dùng bị bỏ; định nghĩa được dùng giữ', () => {
    const root = parseBody(
      '<defs><linearGradient id="used"><stop offset="0" stop-color="#000"/></linearGradient><linearGradient id="unused"><stop offset="0" stop-color="#fff"/></linearGradient></defs><g/><g><g/></g><rect fill="url(#used)" width="1" height="1"/>',
    );
    const { rep } = post(root);
    expect(root.querySelector('#used')).not.toBeNull();
    expect(root.querySelector('#unused')).toBeNull();
    expect(root.querySelectorAll('g')).toHaveLength(0);
    expect(rep.codes().has('R_EMPTY')).toBe(true);
    expect(rep.codes().has('R_UNUSED_DEF')).toBe(true);
  });
  it('làm tròn số dài trong d và points (C_ROUND), số ngắn giữ nguyên', () => {
    const root = parseBody(
      '<path d="M0.123456 0.987654L10 10.5"/><polyline points="1.23456,2.34567 3,4"/>',
    );
    const { rep } = post(root);
    expect(root.querySelector('path')!.getAttribute('d')).toBe('M0.123 0.988L10 10.5');
    expect(root.querySelector('polyline')!.getAttribute('points')).toBe('1.235,2.346 3,4');
    expect(rep.codes().has('C_ROUND')).toBe(true);
  });
  it('title của phần tử gắn được được giữ', () => {
    const root = parseBody('<rect width="1" height="1"><title>Bồn 1</title></rect>');
    post(root);
    expect(root.querySelector('title')!.textContent).toBe('Bồn 1');
  });
});
