import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SVG_NS, namespaceLabel, parseSvg, sanitizeSvg, type SanitizeReport } from './sanitize';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../../../tests/fixtures/svg', name), 'utf8');

describe('parseSvg', () => {
  it('trả về phần tử gốc <svg> cho file hợp lệ', () => {
    const svg = parseSvg(fixture('tank.svg'));
    expect(svg.localName).toBe('svg');
  });

  it('ném lỗi khi XML hỏng', () => {
    expect(() => parseSvg('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>')).toThrow();
  });

  it('ném lỗi khi gốc không phải <svg>', () => {
    expect(() => parseSvg('<html xmlns="http://www.w3.org/1999/xhtml"/>')).toThrow(/svg/i);
  });
});

describe('sanitizeSvg', () => {
  it('loại script, foreignObject, image ngoài, on* và href javascript:', () => {
    const svg = parseSvg(fixture('unsafe-elements.svg'));
    const report = sanitizeSvg(svg);

    expect(svg.querySelector('script')).toBeNull();
    expect(svg.querySelector('foreignObject')).toBeNull();
    expect(svg.querySelector('image')).toBeNull();
    expect(svg.hasAttribute('onload')).toBe(false);
    expect(svg.querySelector('#unsafe-ok')?.hasAttribute('onclick')).toBe(false);
    expect(svg.querySelector('a')?.getAttribute('xlink:href') ?? null).toBeNull();

    expect(report.removedElements).toMatchObject({ script: 1, foreignobject: 1, image: 1 });
    expect(report.removedAttributes).toBeGreaterThanOrEqual(3); // onload, onclick, href
  });

  it('giữ nguyên tham chiếu nội bộ #id (use, gradient)', () => {
    const svg = parseSvg(fixture('use-symbol.svg'));
    const report = sanitizeSvg(svg);
    expect(svg.querySelectorAll('use').length).toBe(7);
    // allowlist (008): xlink:href được chuẩn hóa thành href
    expect(svg.querySelector('use')?.getAttribute('href')).toBe('#sym-lamp');
    expect(report.removedAttributes).toBe(0);
  });

  it('không đụng vào SVG sạch', () => {
    const svg = parseSvg(fixture('gradients.svg'));
    const before = svg.querySelectorAll('*').length;
    const report = sanitizeSvg(svg);
    // allowlist 008: chỉ <title> gốc (1 cái) bị bỏ; mọi hình, gradient còn nguyên
    expect(svg.querySelectorAll('*').length).toBe(before - 1);
    expect(report.removedAttributes).toBe(0);
    expect(report.removedElements).toEqual({ title: 1 });
  });

  it('loại mọi <style> (allowlist 008: CSS do importer chuyển thành thuộc tính, trang không giữ <style>)', () => {
    const doc = `<svg xmlns="http://www.w3.org/2000/svg">
      <style>@import url(http://evil.invalid/a.css); .a{fill:red}</style>
      <style>.cls-1{fill:url(#g1)}</style><rect class="cls-1"/></svg>`;
    const svg = parseSvg(doc);
    const report = sanitizeSvg(svg);
    expect(svg.querySelectorAll('style')).toHaveLength(0);
    expect(report.removedElements.style).toBe(2);
  });

  it('thống kê số phần tử và độ sâu', () => {
    const svg = parseSvg(fixture('nested-groups.svg'));
    const report = sanitizeSvg(svg);
    expect(report.elementCount).toBeGreaterThan(15);
    expect(report.maxDepth).toBeGreaterThanOrEqual(10);
  });
});

const XLINK = 'http://www.w3.org/1999/xlink';
const svgDoc = (inner: string, ns = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="${XLINK}" ${ns}>${inner}</svg>`;

describe('sanitizeSvg — các đường lách (review I-1, I-2, S-2)', () => {
  it('gỡ href javascript: dù dùng tiền tố namespace khác (x:href)', () => {
    const svg = parseSvg(
      svgDoc('<a x:href="javascript:alert(1)"><rect/></a>', `xmlns:x="${XLINK}"`),
    );
    const report = sanitizeSvg(svg);
    expect(svg.querySelector('a')).toBeNull(); // mở vỏ
    expect(svg.querySelector('rect')).not.toBeNull();
    expect(svg.querySelector('rect')!.getAttributeNS(XLINK, 'href')).toBeNull();
    expect(report.removedAttributes).toBe(1);
  });

  it('bỏ phần tử ngoài namespace SVG (XHTML meta/img, metadata của phần mềm vẽ)', () => {
    const svg = parseSvg(
      svgDoc(
        '<sodipodi:namedview/>' +
          '<meta xmlns="http://www.w3.org/1999/xhtml" http-equiv="refresh" content="0;url=http://evil.invalid"/>' +
          '<img xmlns="http://www.w3.org/1999/xhtml" src="http://evil.invalid/p.png"/><rect/>',
        'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"',
      ),
    );
    const report = sanitizeSvg(svg);
    expect(Array.from(svg.querySelectorAll('*')).map((e) => e.localName)).toEqual(['rect']);
    expect(report.removedElements).toMatchObject({
      'sodipodi:namedview': 1,
      'xhtml:meta': 1,
      'xhtml:img': 1,
    });
  });

  it('parseSvg từ chối gốc <svg> không thuộc namespace SVG', () => {
    expect(() => parseSvg('<svg xmlns="http://example.invalid/"/>')).toThrow(/namespace/i);
  });

  it.each([
    ['@import viết bằng escape', '@\\69mport "http://evil.invalid/a.css";'],
    ['image-set()', 'svg{background-image:image-set("http://evil.invalid/p.png" 1x)}'],
    ['url() viết bằng escape', 'svg{background-image:\\75rl(http://evil.invalid/p.png)}'],
    ['url() không giao thức', 'svg{background:url( "//evil.invalid/p.png" )}'],
  ])('gỡ <style> tham chiếu ra ngoài: %s', (_label, css) => {
    const svg = parseSvg(svgDoc(`<style>${css}</style><rect/>`));
    const report = sanitizeSvg(svg);
    expect(svg.querySelector('style')).toBeNull();
    expect(report.removedElements.style).toBe(1);
  });

  it('gỡ thuộc tính style có url() ra ngoài, giữ url(#id) nội bộ', () => {
    const svg = parseSvg(
      svgDoc(
        '<rect id="bad" style="fill:url(http://evil.invalid/x.svg#g)"/>' +
          '<rect id="ok" style="fill:url(#g1);stroke:#000"/>',
      ),
    );
    const report = sanitizeSvg(svg);
    expect(svg.querySelector('#bad')!.hasAttribute('style')).toBe(false);
    expect(svg.querySelector('#ok')!.getAttribute('style')).toBe('fill:url(#g1);stroke:#000');
    expect(report.removedAttributes).toBe(1);
  });

  it('gỡ SMIL animate/set đổi href', () => {
    const svg = parseSvg(
      svgDoc(
        '<a><set attributeName="href" to="javascript:alert(1)"/>' +
          '<animate attributeName="xlink:href" values="javascript:alert(1)"/>' +
          '<animate attributeName="opacity" values="0;1" dur="1s"/><rect/></a>',
      ),
    );
    const report = sanitizeSvg(svg);
    expect(svg.querySelector('set')).toBeNull();
    expect(svg.querySelectorAll('animate')).toHaveLength(0); // allowlist 008: loại mọi SMIL
    expect(report.removedElements).toMatchObject({ set: 1, animate: 2 });
  });
});

describe('sanitizeSvg — tương thích API (T020/T022)', () => {
  it('giữ chữ ký sanitizeSvg(root, opts) và các trường cũ của SanitizeReport, thêm trường mới', () => {
    const svg = parseSvg(svgDoc('<rect data-tag="x" data-mat-uid="el_abc"/><script/>'));
    const report: SanitizeReport = sanitizeSvg(svg, { keepDataAttributes: ['data-mat-uid'] });
    expect(Object.keys(report)).toEqual(
      expect.arrayContaining([
        'removedElements',
        'removedAttributes',
        'removedDataAttributes',
        'elementCount',
        'maxDepth',
        'codes',
        'unwrapped',
      ]),
    );
    expect(report.removedDataAttributes).toBe(1);
    expect(report.elementCount).toBe(2);
    expect(report.maxDepth).toBe(2);
    expect(svg.querySelector('rect')!.getAttribute('data-mat-uid')).toBe('el_abc');
  });

  it('vẫn xuất SVG_NS, namespaceLabel, parseSvg', () => {
    expect(SVG_NS).toBe('http://www.w3.org/2000/svg');
    expect(namespaceLabel('http://www.w3.org/1999/xhtml')).toBe('xhtml');
    expect(namespaceLabel(null)).toBe('no-ns');
  });

  it('script ở mọi dạng hoa thường và lồng nhau không chạy mã, không còn trong cây', () => {
    const svg = parseSvg(
      svgDoc(
        '<SCRIPT>1</SCRIPT><g><sCrIpT/></g><defs><script/></defs><rect onload="x()" onbegin="y()"/>',
      ),
    );
    sanitizeSvg(svg);
    const all = Array.from(svg.querySelectorAll('*'));
    expect(all.some((e) => e.localName.toLowerCase() === 'script')).toBe(false);
    expect(all.some((e) => Array.from(e.attributes).some((a) => a.name.startsWith('on')))).toBe(
      false,
    );
  });
});

describe('sanitizeSvg — định dạng của nhiều phần mềm vẽ (fixture mô phỏng)', () => {
  it('CorelDRAW: <style> (CSS trong CDATA) bị loại ở trang, id thoát ký tự vẫn giữ', () => {
    const svg = parseSvg(fixture('synthetic-coreldraw.svg'));
    const report = sanitizeSvg(svg);
    expect(svg.querySelector('style')).toBeNull();
    expect(svg.querySelector('#Layer_x0020_1')).not.toBeNull();
    expect(report.removedElements.style).toBe(1);
  });

  it('Illustrator Save As: <switch> (chứa foreignObject + i:pgf của Adobe) bị loại cả cây ở trang', () => {
    const svg = parseSvg(fixture('synthetic-illustrator-saveas.svg'));
    const report = sanitizeSvg(svg);
    expect(report.removedElements.switch).toBe(1);
    expect(svg.querySelector('switch')).toBeNull();
    expect(svg.querySelector('foreignObject')).toBeNull();
  });

  it('Inkscape: bỏ sodipodi:namedview và ảnh liên kết file:///, giữ layer', () => {
    const svg = parseSvg(fixture('synthetic-inkscape-features.svg'));
    const report = sanitizeSvg(svg);
    expect(report.removedElements).toMatchObject({ 'sodipodi:namedview': 1, image: 1 });
    expect(svg.querySelector('#layer1')).not.toBeNull();
  });

  it('văn bản bị bình luận/CDATA/chỉ thị tách vẫn bị cắt theo tổng độ dài liền kề (fuzz T113)', () => {
    // 10009 ký tự + chỉ thị xử lý + 25 ký tự: sau khi bỏ chỉ thị, hai nút liền nhau; tổng phải <= 4096 để nhập lại không đổi
    const svg = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><text>${'a'.repeat(10009)}<?x y?>${'b'.repeat(25)}</text>` +
        `<text>${'c'.repeat(4000)}<!--k-->${'d'.repeat(4000)}</text></svg>`,
    );
    const report = sanitizeSvg(svg);
    expect(report.codes.R_TEXT_LONG).toBeGreaterThanOrEqual(1);
    for (const t of Array.from(svg.querySelectorAll('text')))
      expect((t.textContent ?? '').length).toBeLessThanOrEqual(4096);
    // chạy lại: không còn gì để cắt
    expect(sanitizeSvg(parseSvg(new XMLSerializer().serializeToString(svg))).codes).toEqual({});
  });
});
