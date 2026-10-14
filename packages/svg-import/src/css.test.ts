// T038: test CSS (FR-016; research R4). Viết TRƯỚC, phải đỏ.
import { describe, expect, it } from 'vitest';
import { applyCss, parseStylesheet } from './css.ts';
import { ReportBuilder } from './report.ts';
import { parseBody } from './test-helpers.ts';

describe('parseStylesheet: từ vựng', () => {
  it('bỏ bình luận, nhận luật và khai báo', () => {
    const s = parseStylesheet('/* a */ .a { fill: #f00; /* x */ stroke: blue } rect{opacity:.5}');
    expect(s.rules).toHaveLength(2);
    expect(s.rules[0].decls.map((d) => d.prop)).toEqual(['fill', 'stroke']);
  });
  it('chuỗi chứa dấu } và ; không cắt khai báo', () => {
    const s = parseStylesheet('.a{font-family:"a}b;c"}');
    expect(s.rules).toHaveLength(1);
    expect(s.rules[0].decls[0].value).toBe('"a}b;c"');
  });
  it('at-rule bị bỏ (cả khối lồng) và được ghi tên', () => {
    const s = parseStylesheet(
      '@charset "utf-8"; @import url(http://evil.example/x.css); @media screen{.a{fill:red}} @font-face{font-family:x;src:url(a)} .b{fill:blue}',
    );
    expect(s.atRules).toEqual(['charset', 'import', 'media', 'font-face']);
    expect(s.rules).toHaveLength(1);
    expect(s.rules[0].selectors[0].classes).toEqual(['b']);
  });
  it('khối không đóng bị bỏ, không ném lỗi', () => {
    expect(() => parseStylesheet('.a{fill:red')).not.toThrow();
    expect(parseStylesheet('.a{fill:red').rules).toHaveLength(0);
  });
  it('giới hạn 100.000 luật', () => {
    const s = parseStylesheet('.a{fill:red}'.repeat(100_005));
    expect(s.rules.length).toBeLessThanOrEqual(100_000);
  });
});

describe('parseStylesheet: bộ chọn', () => {
  it('hỗ trợ *, thẻ, .lớp, #id, ghép, danh sách; độ đặc hiệu (id, lớp, thẻ)', () => {
    const s = parseStylesheet('* {fill:red} rect.a#b {fill:red} .a.b {fill:red} rect, .a, #b {fill:red}');
    expect(s.rules[0].selectors[0].spec).toEqual([0, 0, 0]);
    expect(s.rules[1].selectors[0].spec).toEqual([1, 1, 1]);
    expect(s.rules[2].selectors[0].spec).toEqual([0, 2, 0]);
    expect(s.rules[3].selectors.map((x) => x.spec)).toEqual([[0, 0, 1], [0, 1, 0], [1, 0, 0]]);
  });
  it('bộ chọn không hỗ trợ: tổ hợp, giả lớp, thuộc tính, hậu duệ', () => {
    const s = parseStylesheet('g > rect{fill:red} a:hover{fill:red} [x]{fill:red} g rect{fill:red} g+rect{fill:red}');
    expect(s.rules).toHaveLength(0);
    expect(s.unsupportedSelectors).toBe(5);
  });
});

describe('applyCss: cascade', () => {
  const style = (css: string) => `<style>${css}</style>`;

  it('chuyển luật lớp thành thuộc tính trình bày, bỏ class và <style> (C_CSS)', () => {
    const root = parseBody(style('.cls-1{fill:#f00;stroke-width:2}') + '<rect class="cls-1" width="5" height="5"/>');
    const rep = new ReportBuilder();
    applyCss(root, rep);
    const r = root.querySelector('rect')!;
    expect(r.getAttribute('fill')).toBe('#f00');
    expect(r.getAttribute('stroke-width')).toBe('2');
    expect(r.hasAttribute('class')).toBe(false);
    expect(root.querySelector('style')).toBeNull();
    expect(rep.codes().has('C_CSS')).toBe(true);
  });
  it('độ đặc hiệu: #id > .lớp > thẻ, bất kể thứ tự', () => {
    const root = parseBody(
      style('#i{fill:green} .a{fill:blue} rect{fill:red}') + '<rect id="i" class="a" width="5" height="5"/>',
    );
    applyCss(root, new ReportBuilder());
    expect(root.querySelector('rect')!.getAttribute('fill')).toBe('green');
  });
  it('cùng độ đặc hiệu: luật sau thắng, kể cả giữa các khối <style>', () => {
    const root = parseBody(
      style('.a{fill:red}') + style('.a{fill:blue}') + '<rect class="a" width="5" height="5"/>',
    );
    applyCss(root, new ReportBuilder());
    expect(root.querySelector('rect')!.getAttribute('fill')).toBe('blue');
  });
  it('style nội tuyến thắng luật thường; !important của luật thắng nội tuyến; nội tuyến !important thắng tất cả', () => {
    const a = parseBody(style('.a{fill:red}') + '<rect class="a" style="fill:blue" width="5" height="5"/>');
    applyCss(a, new ReportBuilder());
    expect(a.querySelector('rect')!.getAttribute('fill')).toBe('blue');
    const b = parseBody(style('.a{fill:red !important}') + '<rect class="a" style="fill:blue" width="5" height="5"/>');
    applyCss(b, new ReportBuilder());
    expect(b.querySelector('rect')!.getAttribute('fill')).toBe('red');
    const c = parseBody(
      style('.a{fill:red !important}') + '<rect class="a" style="fill:blue !important" width="5" height="5"/>',
    );
    applyCss(c, new ReportBuilder());
    expect(c.querySelector('rect')!.getAttribute('fill')).toBe('blue');
    expect(c.querySelector('rect')!.hasAttribute('style')).toBe(false);
  });
  it('thuộc tính trình bày gốc thua mọi luật CSS', () => {
    const root = parseBody(style('rect{fill:red}') + '<rect fill="blue" width="5" height="5"/>');
    applyCss(root, new ReportBuilder());
    expect(root.querySelector('rect')!.getAttribute('fill')).toBe('red');
  });
  it('ca stress: .cls-1 trùng tên ở 8 khối, khối cuối thắng', () => {
    const blocks = Array.from({ length: 8 }, (_, i) => style(`.cls-1{fill:#00000${i}}`)).join('');
    const root = parseBody(blocks + '<rect class="cls-1" width="5" height="5"/>');
    applyCss(root, new ReportBuilder());
    expect(root.querySelector('rect')!.getAttribute('fill')).toBe('#000007');
  });
  it('CDATA của Corel', () => {
    const root = parseBody(
      '<defs><style type="text/css"><![CDATA[ .fil0 {fill:#CFD8E0} .str0 {stroke:#33414F;stroke-width:150} ]]></style></defs><rect class="fil0 str0" width="5" height="5"/>',
    );
    applyCss(root, new ReportBuilder());
    const r = root.querySelector('rect')!;
    expect(r.getAttribute('fill')).toBe('#CFD8E0');
    expect(r.getAttribute('stroke-width')).toBe('150');
  });
  it('thuộc tính CSS ngoài allowlist bị bỏ (R_CSS_PROP)', () => {
    const root = parseBody(
      '<rect style="mix-blend-mode:multiply;pointer-events:none;animation:a 1s;fill:#0f0" width="5" height="5"/>',
    );
    const rep = new ReportBuilder();
    applyCss(root, rep);
    const r = root.querySelector('rect')!;
    expect(r.getAttribute('fill')).toBe('#0f0');
    expect(r.hasAttribute('mix-blend-mode')).toBe(false);
    expect(rep.codes().has('R_CSS_PROP')).toBe(true);
  });
  it('giá trị url(javascript:) hoặc url ngoài bị bỏ (R_URL_EXTERNAL), kể cả viết thoát', () => {
    const root = parseBody(
      '<rect style="fill:url(javascript:alert(1))" width="5" height="5"/>' +
        '<rect style="fill:u\\72l(http://evil.example/a)" width="5" height="5"/>',
    );
    const rep = new ReportBuilder();
    applyCss(root, rep);
    for (const r of Array.from(root.querySelectorAll('rect'))) expect(r.hasAttribute('fill')).toBe(false);
    expect(rep.codes().has('R_URL_EXTERNAL')).toBe(true);
  });
  it('transform trong style thành thuộc tính transform nếu hợp lệ', () => {
    const root = parseBody('<rect style="transform:translate(5 5)" width="5" height="5"/>');
    applyCss(root, new ReportBuilder());
    expect(root.querySelector('rect')!.getAttribute('transform')).toBe('translate(5 5)');
  });
  it('bộ chọn lạ: W_IMPORT_CSS_PARTIAL và R_CSS_RULE; at-rule: R_CSS_AT', () => {
    const root = parseBody(
      style('@import url(http://evil.example/x.css); g > rect{fill:red}') + '<g><rect width="5" height="5"/></g>',
    );
    const rep = new ReportBuilder();
    applyCss(root, rep);
    const codes = rep.codes();
    expect(codes.has('W_IMPORT_CSS_PARTIAL')).toBe(true);
    expect(codes.has('R_CSS_RULE')).toBe(true);
    expect(codes.has('R_CSS_AT')).toBe(true);
    expect(root.querySelector('rect')!.hasAttribute('fill')).toBe(false);
  });
});
