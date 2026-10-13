// @vitest-environment jsdom
// Test allowlist (Constitution V, FR-013, FR-014, SC-021): viết TRƯỚC khi cài allowlist.ts.
import { describe, expect, it } from 'vitest';
import {
  ALLOW_ELEMENTS,
  ATTR_RULES,
  CSS_PROPS,
  PRESENTATION,
  UNWRAP_ELEMENTS,
  sanitizeStyleAttr,
} from './allowlist.ts';
import { SVG_NS, parseSvg, sanitizeSvg } from './sanitize.ts';

const XLINK = 'http://www.w3.org/1999/xlink';
const doc = (inner: string, extra = '') =>
  `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK}" ${extra}>${inner}</svg>`;
const run = (inner: string, extra = '') => {
  const svg = parseSvg(doc(inner, extra));
  const report = sanitizeSvg(svg);
  return { svg, report };
};
const names = (svg: Element) => Array.from(svg.querySelectorAll('*')).map((e) => e.localName);

const ALLOWED = [
  'svg', 'g', 'defs', 'symbol', 'use', 'title',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath',
  'linearGradient', 'radialGradient', 'stop', 'pattern',
  'clipPath', 'mask', 'marker', 'image',
  'filter', 'feGaussianBlur', 'feOffset', 'feColorMatrix', 'feFlood', 'feComposite', 'feMerge',
  'feMergeNode', 'feBlend', 'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA',
  'feDropShadow',
]; // prettier-ignore

const DENIED = [
  'script', 'style', 'foreignObject', 'switch', 'view', 'cursor', 'animate', 'animateMotion',
  'animateTransform', 'set', 'mpath', 'discard', 'font', 'font-face', 'font-face-src',
  'font-face-uri', 'glyph', 'missing-glyph', 'metadata', 'desc',
  'feImage', 'feTurbulence', 'feDisplacementMap', 'feConvolveMatrix', 'feMorphology', 'feTile',
  'feSpecularLighting', 'feDiffuseLighting', 'feDistantLight', 'fePointLight', 'feSpotLight',
  'iframe', 'object', 'embed', 'audio', 'video', 'canvas', 'link', 'meta', 'base',
  'SCRIPT', 'sCrIpT', 'RECT', 'Rect', 'lineargradient', 'clippath', 'unknownthing',
]; // prettier-ignore

describe('bảng phần tử', () => {
  it('ALLOW_ELEMENTS đúng bằng danh sách của contract §2', () => {
    expect([...ALLOW_ELEMENTS].sort()).toEqual([...ALLOWED].sort());
    expect([...UNWRAP_ELEMENTS]).toEqual(['a']);
  });

  it.each(ALLOWED)('giữ phần tử %s', (name) => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const markup =
      name === 'title'
        ? '<g><title/></g>'
        : name === 'image'
          ? `<image href="${png}"/>`
          : `<${name}/>`;
    const { svg, report } = run(markup);
    expect(names(svg).filter((n) => n === name)).toEqual([name]);
    expect(report.removedElements).toEqual({});
  });

  it.each(DENIED)('bỏ %s cùng cây con', (name) => {
    const { svg, report } = run(`<${name}><rect id="child"/></${name}>`);
    expect(names(svg)).toEqual([]);
    expect(Object.values(report.removedElements).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('mở vỏ <a>: bỏ phần tử, giữ con, kể cả a lồng a', () => {
    const { svg, report } = run(
      '<a href="javascript:alert(1)"><rect id="r1"/><a><circle id="c1"/></a></a><path id="p1"/>',
    );
    expect(names(svg)).toEqual(['rect', 'circle', 'path']);
    expect(report.unwrapped).toBe(2);
  });

  it('phần tử ngoài namespace SVG bị bỏ dù trùng tên (rect của XHTML)', () => {
    const { svg } = run('<rect xmlns="http://www.w3.org/1999/xhtml"/><circle/>');
    expect(names(svg)).toEqual(['circle']);
  });

  it('script nằm sâu trong defs hoặc nhóm bị bỏ', () => {
    const { svg } = run('<defs><g><script>alert(1)</script></g></defs><g><g><script/></g></g>');
    expect(svg.querySelector('script')).toBeNull();
    expect(names(svg)).toEqual(['defs', 'g', 'g', 'g']);
  });

  it('mã lý do (report.codes)', () => {
    const { report } = run(
      '<script/><foreignObject/><animate/><metadata/><switch/><html:div xmlns:html="http://www.w3.org/1999/xhtml"/>',
    );
    expect(report.codes.R_SCRIPT).toBe(1);
    expect(report.codes.R_FOREIGN).toBe(1);
    expect(report.codes.R_SMIL).toBe(1);
    expect(report.codes.R_META).toBe(1);
    expect(report.codes.R_NAMESPACE).toBe(1);
    expect(report.codes.R_ELEMENT_NOT_ALLOWED).toBe(1);
  });
});

describe('bảng thuộc tính', () => {
  it('thuộc tính trình bày của contract §3 đều có luật', () => {
    for (const a of [
      'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
      'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
      'stroke-dashoffset', 'opacity', 'display', 'visibility', 'clip-path', 'clip-rule', 'mask',
      'filter', 'marker-start', 'marker-mid', 'marker-end', 'color', 'stop-color', 'stop-opacity',
      'flood-color', 'flood-opacity', 'font-family', 'font-size', 'font-style', 'font-weight',
      'font-stretch', 'text-anchor', 'text-decoration', 'letter-spacing', 'word-spacing',
      'dominant-baseline', 'alignment-baseline', 'baseline-shift', 'writing-mode', 'direction',
      'shape-rendering', 'text-rendering', 'image-rendering', 'color-interpolation-filters',
      'paint-order', 'vector-effect',
    ]) expect(PRESENTATION.has(a), a).toBe(true); // prettier-ignore
    expect(CSS_PROPS.has('fill')).toBe(true);
    expect(CSS_PROPS.has('transform')).toBe(true);
    for (const bad of ['mix-blend-mode', 'pointer-events', 'animation', 'content', 'behavior'])
      expect(CSS_PROPS.has(bad), bad).toBe(false);
  });

  it('mọi phần tử trong ATTR_RULES nằm trong ALLOW_ELEMENTS', () => {
    for (const el of ATTR_RULES.keys()) expect(ALLOW_ELEMENTS.has(el), el).toBe(true);
  });

  // [phần tử, thuộc tính, giá trị, giữ nguyên?]
  const CASES: Array<[string, string, string, boolean]> = [
    ['rect', 'x', '10', true],
    ['rect', 'width', '10px', true],
    ['rect', 'width', '50%', true],
    ['rect', 'width', '1e2', true],
    ['rect', 'x', 'NaN', false],
    ['rect', 'x', 'Infinity', false],
    ['rect', 'x', '1e999', false],
    ['rect', 'x', '0x10', false],
    ['rect', 'x', '10vw', false],
    ['rect', 'x', 'calc(1px + 2px)', false],
    ['rect', 'x', 'var(--x)', false],
    ['rect', 'rx', '2', true],
    ['rect', 'cx', '2', false], // không thuộc rect
    ['rect', 'class', 'a', false],
    ['rect', 'foo', 'bar', false],
    ['rect', 'onclick', 'alert(1)', false],
    ['rect', 'ONCLICK', 'alert(1)', false],
    ['rect', 'onload', 'alert(1)', false],
    ['circle', 'r', '5', true],
    ['ellipse', 'ry', '5', true],
    ['line', 'x2', '5', true],
    ['polyline', 'points', '0,0 10,10', true],
    ['polygon', 'points', '0,0 10,10 5', false],
    ['path', 'd', 'M0 0L10 10z', true],
    ['path', 'd', 'M0 0 <script>', false],
    ['path', 'd', 'L1 1', false],
    ['g', 'transform', 'translate(1,2) rotate(30)', true],
    ['g', 'transform', 'scale(2) url(x)', false],
    ['g', 'transform', 'foo(1)', false],
    ['g', 'id', 'tank-1', true],
    ['g', 'id', 'a b', false],
    ['g', 'id', 'a"b', false],
    ['g', 'data-mat-uid', 'el_abc123', true],
    ['g', 'data-mat-uid', 'EL_ABC', false],
    ['g', 'data-mat-name', 'Bồn 1', true],
    ['g', 'data-other', 'x', false],
    ['g', 'data-mat-uid', 'x y', false],
    ['svg', 'viewBox', '0 0 100 50', true],
    ['svg', 'viewBox', '0 0 100', false],
    ['svg', 'viewBox', '0 0 a b', false],
    ['svg', 'preserveAspectRatio', 'xMidYMid meet', true],
    ['svg', 'preserveAspectRatio', 'none', true],
    ['svg', 'preserveAspectRatio', 'evil', false],
    ['svg', 'width', '100mm', true],
    ['svg', 'onload', 'alert(1)', false],
    ['rect', 'fill', '#f00', true],
    ['rect', 'fill', '#ff0000aa', true],
    ['rect', 'fill', 'rgb(1,2,3)', true],
    ['rect', 'fill', 'hsl(120,50%,50%)', true],
    ['rect', 'fill', 'red', true],
    ['rect', 'fill', 'none', true],
    ['rect', 'fill', 'url(#g1)', true],
    ['rect', 'fill', 'url(#g1) red', true],
    ['rect', 'fill', 'url(http://evil/x.svg#g)', false],
    ['rect', 'fill', 'url(javascript:alert(1))', false],
    ['rect', 'fill', 'var(--c)', false],
    ['rect', 'fill', 'env(safe-area-inset-top)', false],
    ['rect', 'stroke-width', '2', true],
    ['rect', 'stroke-width', 'NaN', false],
    ['rect', 'stroke-linecap', 'round', true],
    ['rect', 'stroke-linecap', 'evil', false],
    ['rect', 'stroke-dasharray', '4 2', true],
    ['rect', 'stroke-dasharray', 'none', true],
    ['rect', 'stroke-dasharray', '4 x', false],
    ['rect', 'opacity', '0.5', true],
    ['rect', 'opacity', 'abc', false],
    ['rect', 'display', 'none', true],
    ['rect', 'visibility', 'hidden', true],
    ['rect', 'visibility', 'url(x)', false],
    ['rect', 'clip-path', 'url(#c1)', true],
    ['rect', 'clip-path', 'url(http://evil/x#c)', false],
    ['rect', 'mask', 'url(#m1)', true],
    ['rect', 'filter', 'url(#f1)', true],
    ['rect', 'filter', 'url(http://evil/f)', false],
    ['rect', 'marker-end', 'url(#arrow)', true],
    ['rect', 'marker-end', 'url(//evil/a)', false],
    ['rect', 'color', 'blue', true],
    ['text', 'font-family', "Arial, 'Segoe UI', sans-serif", true],
    ['text', 'font-family', 'url(http://evil/f.woff)', false],
    ['text', 'font-family', 'a;b', false],
    ['text', 'font-family', 'Arial\\', false],
    ['text', 'font-size', '12', true],
    ['text', 'font-size', '12px', true],
    ['text', 'font-weight', 'bold', true],
    ['text', 'font-weight', '700', true],
    ['text', 'font-weight', 'evil', false],
    ['text', 'text-anchor', 'middle', true],
    ['text', 'text-anchor', 'center', false],
    ['text', 'x', '10', true],
    ['tspan', 'dy', '1.2em', true],
    ['text', 'rotate', '10 20', true],
    ['text', 'xml:space', 'preserve', true],
    ['text', 'xml:space', 'evil', false],
    ['text', 'lang', 'vi', false],
    ['use', 'href', '#a', true],
    ['use', 'href', 'http://evil/x.svg#a', false],
    ['use', 'href', 'https://evil/x.svg#a', false],
    ['use', 'href', 'javascript:alert(1)', false],
    ['use', 'href', 'file:///etc/passwd', false],
    ['use', 'href', 'data:text/html,<script>alert(1)</script>', false],
    ['use', 'href', 'sym.svg#a', false],
    ['use', 'xlink:href', '#a', true], // chuẩn hóa thành href
    ['use', 'xlink:href', 'javascript:alert(1)', false],
    ['linearGradient', 'x1', '0', true],
    ['linearGradient', 'gradientUnits', 'userSpaceOnUse', true],
    ['linearGradient', 'gradientUnits', 'evil', false],
    ['linearGradient', 'gradientTransform', 'rotate(90)', true],
    ['linearGradient', 'href', '#other', true],
    ['linearGradient', 'spreadMethod', 'reflect', true],
    ['radialGradient', 'fr', '0.1', true],
    ['stop', 'offset', '0.5', true],
    ['stop', 'offset', '50%', true],
    ['stop', 'offset', 'x', false],
    ['stop', 'stop-color', '#fff', true],
    ['stop', 'stop-color', 'url(#x)', false],
    ['pattern', 'patternTransform', 'scale(2)', true],
    ['pattern', 'patternUnits', 'userSpaceOnUse', true],
    ['clipPath', 'clipPathUnits', 'objectBoundingBox', true],
    ['mask', 'maskUnits', 'userSpaceOnUse', true],
    ['marker', 'orient', 'auto', true],
    ['marker', 'orient', '45', true],
    ['marker', 'orient', 'evil', false],
    ['marker', 'markerUnits', 'strokeWidth', true],
    ['symbol', 'viewBox', '0 0 10 10', true],
    ['textPath', 'href', '#p', true],
    ['textPath', 'startOffset', '50%', true],
    ['textPath', 'href', 'http://evil/x#p', false],
    ['filter', 'filterUnits', 'userSpaceOnUse', true],
    ['filter', 'width', '120%', true],
    ['feGaussianBlur', 'in', 'SourceGraphic', true],
    ['feGaussianBlur', 'stdDeviation', '3', true],
    ['feGaussianBlur', 'stdDeviation', '3 4', true],
    ['feGaussianBlur', 'stdDeviation', 'abc', false],
    ['feOffset', 'dx', '2', true],
    ['feColorMatrix', 'type', 'saturate', true],
    ['feColorMatrix', 'type', 'evil', false],
    ['feColorMatrix', 'values', '0 1 0 0 0 1 0 0 0 0 0 0 1 0 0 0 0 0 1 0', true],
    ['feFlood', 'flood-color', '#000', true],
    ['feFlood', 'flood-opacity', '0.5', true],
    ['feComposite', 'operator', 'arithmetic', true],
    ['feComposite', 'k1', '0.5', true],
    ['feComposite', 'in2', 'BackgroundImage', true],
    ['feBlend', 'mode', 'multiply', true],
    ['feFuncR', 'type', 'linear', true],
    ['feFuncR', 'slope', '2', true],
    ['feFuncA', 'tableValues', '0 0.5 1', true],
    ['feDropShadow', 'dx', '2', true],
    ['feDropShadow', 'stdDeviation', '2', true],
    ['feMergeNode', 'in', 'a', true],
    ['feGaussianBlur', 'href', '#x', false],
  ];

  it.each(CASES)('%s %s=%j giữ=%s', (el, attr, value, keep) => {
    const escaped = value
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('"').join('&quot;'); // prettier-ignore
    const markup = `<${el} ${attr}="${escaped}"/>`;
    const { svg, report } = run(markup);
    const target = el === 'svg' ? svg.querySelector('svg')! : svg.querySelector(el)!;
    expect(target).not.toBeNull();
    const probe =
      attr === 'xlink:href'
        ? target.getAttribute('href')
        : attr === 'xml:space'
          ? target.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'space')
          : target.getAttribute(attr);
    if (keep) {
      expect(probe).not.toBeNull();
      expect(report.removedAttributes).toBe(0);
    } else {
      expect(probe).toBeNull();
      expect(report.removedAttributes + report.removedDataAttributes).toBeGreaterThanOrEqual(1);
    }
  });

  it('xlink:href được chuẩn hóa thành href (mọi tiền tố của namespace xlink)', () => {
    const { svg } = run('<use x:href="#a" xmlns:x="' + XLINK + '"/><use xlink:href="#b"/>');
    const uses = Array.from(svg.querySelectorAll('use'));
    expect(uses.map((u) => u.getAttribute('href'))).toEqual(['#a', '#b']);
    expect(uses.every((u) => u.getAttributeNS(XLINK, 'href') === null)).toBe(true);
  });

  it('href ở namespace lạ bị bỏ', () => {
    const { svg } = run('<use y:href="#a" xmlns:y="http://evil.invalid/ns"/>');
    const use = svg.querySelector('use')!;
    expect(use.attributes.length).toBe(0);
  });

  it('khai báo xmlns lạ và thuộc tính namespace lạ bị bỏ', () => {
    const { svg } = run(
      '<rect inkscape:label="x" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"/>',
    );
    expect(svg.querySelector('rect')!.attributes.length).toBe(0);
  });

  it('stdDeviation kẹp tối đa 30 (ghi R_FILTER_HEAVY)', () => {
    const { svg, report } = run(
      '<feGaussianBlur stdDeviation="1e9"/><feDropShadow stdDeviation="100 2"/>',
    );
    expect(svg.querySelector('feGaussianBlur')!.getAttribute('stdDeviation')).toBe('30');
    expect(svg.querySelector('feDropShadow')!.getAttribute('stdDeviation')).toBe('30 2');
    expect(report.codes.R_FILTER_HEAVY).toBe(2);
  });

  it('data-* thêm qua keepDataAttributes vẫn phải qua isName', () => {
    const svg = parseSvg(doc('<rect data-x="ok" data-y="a&#9;b"/>'));
    sanitizeSvg(svg, { keepDataAttributes: ['data-x', 'data-y'] });
    expect(svg.querySelector('rect')!.getAttribute('data-x')).toBe('ok');
    expect(svg.querySelector('rect')!.hasAttribute('data-y')).toBe(false);
  });
});

describe('thuộc tính style qua bộ tách từ vựng', () => {
  it.each([
    ['fill:red;stroke:#000', 'fill:red;stroke:#000'],
    ['fill:red !important', 'fill:red'],
    ['/* c */ fill : red ;; stroke:blue', 'fill:red;stroke:blue'],
    ['fill:url(http://evil/x);stroke:#000', 'stroke:#000'],
    ['fill:url(javascript:alert(1))', ''],
    ['fill:\\75rl(http://evil/x)', ''],
    ['fill:url(#g1);stroke:#000', 'fill:url(#g1);stroke:#000'],
    ['pointer-events:none;fill:red', 'fill:red'],
    ['mix-blend-mode:multiply', ''],
    ['behavior:url(x.htc);-moz-binding:url(x)', ''],
    ['width:expression(alert(1))', ''],
    ['animation:spin 1s;transition:all 1s;content:"x"', ''],
    ['font-family:url(http://evil/f)', ''],
    [
      "font-family:'Segoe UI', Arial;font-size:12px",
      "font-family:'Segoe UI', Arial;font-size:12px",
    ],
    ['opacity:NaN', ''],
    ['fill:red;fill:blue', 'fill:red;fill:blue'],
  ])('sanitizeStyleAttr(%j) = %j', (input, expected) => {
    expect(sanitizeStyleAttr(input).css).toBe(expected);
  });

  it('transform trong style được tách ra để chuyển thành thuộc tính', () => {
    const r = sanitizeStyleAttr('fill:red;transform:translate(1,2)');
    expect(r.css).toBe('fill:red');
    expect(r.transform).toBe('translate(1,2)');
    expect(sanitizeStyleAttr('transform:wobble(3)').transform).toBeNull();
  });

  it('sanitizeSvg: style rỗng sau lọc thì gỡ thuộc tính, ghi mã', () => {
    const { svg, report } = run(
      '<rect id="a" style="behavior:url(x)"/><rect id="b" style="fill:url(#g1);stroke:#000"/>' +
        '<rect id="c" style="fill:red;transform:translate(5,6)"/>',
    );
    expect(svg.querySelector('#a')!.hasAttribute('style')).toBe(false);
    expect(svg.querySelector('#b')!.getAttribute('style')).toBe('fill:url(#g1);stroke:#000');
    expect(svg.querySelector('#c')!.getAttribute('style')).toBe('fill:red');
    expect(svg.querySelector('#c')!.getAttribute('transform')).toBe('translate(5,6)');
    expect(report.codes.R_CSS_PROP).toBeGreaterThanOrEqual(1);
    expect(report.codes.R_URL_EXTERNAL ?? 0).toBe(0);
  });
});

describe('ảnh nhúng, nút chữ, title và giới hạn', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';

  it('image: giữ data:image hợp lệ, bỏ cả phần tử khi href ngoài hoặc sai chữ ký', () => {
    const { svg, report } = run(
      `<image id="ok" href="${PNG}"/>` +
        '<image id="ext" href="http://evil/x.png"/>' +
        '<image id="file" xlink:href="file:///c:/a.png"/>' +
        '<image id="bad" href="data:image/jpeg;base64,iVBORw0KGgo="/>' +
        '<image id="svgdata" href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg=="/>' +
        '<image id="none"/>',
    );
    expect(Array.from(svg.querySelectorAll('image')).map((e) => e.id)).toEqual(['ok']);
    expect((report.codes.R_IMAGE_LINKED ?? 0) + (report.codes.R_IMAGE_BAD ?? 0)).toBe(5);
    expect(report.codes.R_IMAGE_LINKED).toBeGreaterThanOrEqual(1);
    expect(report.codes.R_IMAGE_BAD).toBeGreaterThanOrEqual(1);
  });

  it('tối đa 16 ảnh nhúng, 8 filter, 64 phần tử fe*; phần dư bị loại', () => {
    const imgs = Array.from({ length: 18 }, () => `<image href="${PNG}"/>`).join('');
    const { svg, report } = run(imgs);
    expect(svg.querySelectorAll('image')).toHaveLength(16);
    expect(report.codes.R_IMAGE_LIMIT).toBe(2);

    const filters = Array.from({ length: 10 }, (_v, i) => `<filter id="f${i}"/>`).join('');
    const r2 = run(filters);
    expect(r2.svg.querySelectorAll('filter')).toHaveLength(8);
    expect(r2.report.codes.R_FILTER_LIMIT).toBe(2);

    const fes = '<filter id="f">' + '<feOffset/>'.repeat(70) + '</filter>';
    const r3 = run(fes);
    expect(r3.svg.querySelectorAll('feOffset')).toHaveLength(64);
    expect(r3.report.codes.R_FILTER_LIMIT).toBe(6);
  });

  it('tổng ảnh nhúng sau giải mã tối đa 2 MiB', () => {
    const big = 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(1_500_000 - 12) + '=';
    // mỗi ảnh ~1,1 MB sau giải mã: ảnh thứ hai vượt 2 MiB tổng
    const body = `<image id="i1" href="${big}"/><image id="i2" href="${big}"/><image id="i3" href="${PNG}"/>`;
    const { svg, report } = run(body);
    const ids = Array.from(svg.querySelectorAll('image')).map((e) => e.id);
    expect(ids[0]).toBe('i1');
    expect(ids).not.toContain('i2');
    expect(report.codes.R_IMAGE_LIMIT).toBeGreaterThanOrEqual(1);
  });

  it('nút chữ dài hơn 4096 ký tự bị cắt (R_TEXT_LONG); chữ giống HTML vẫn là chữ', () => {
    const { svg, report } = run(
      `<text id="long">${'x'.repeat(5000)}</text><text id="html">&lt;script&gt;alert(1)&lt;/script&gt;</text>`,
    );
    expect(svg.querySelector('#long')!.textContent!.length).toBe(4096);
    expect(report.codes.R_TEXT_LONG).toBe(1);
    expect(svg.querySelector('#html')!.textContent).toBe('<script>alert(1)</script>');
    expect(svg.querySelector('script')).toBeNull();
  });

  it('title chỉ giữ ở con của phần tử gắn được, cắt còn 200 ký tự', () => {
    const { svg } = run(
      `<g id="g1"><title>${'t'.repeat(300)}</title></g><title>gốc</title><defs><title>trong defs</title></defs>`,
    );
    const titles = Array.from(svg.querySelectorAll('title'));
    expect(titles).toHaveLength(1);
    expect(titles[0].parentElement!.id).toBe('g1');
    expect(titles[0].textContent!.length).toBe(200);
  });

  it('văn bản ngoài phần tử chữ và bình luận, chỉ thị xử lý bị bỏ', () => {
    const { svg } = run('<g>chữ lạc<!-- c --><rect/></g>');
    expect(svg.querySelector('g')!.childNodes).toHaveLength(1);
  });
});

describe('duyệt không đệ quy', () => {
  // jsdom dựng cây sâu O(n²) (5.000 cấp mất > 3 phút), nên cây 100.000 cấp dùng DOM giả tối thiểu cài
  // đúng các thao tác mà sanitizeSvg gọi. Mục đích: chứng minh bộ duyệt dùng vòng lặp, không đệ quy.
  class FakeNode {
    parentNode: FakeEl | null = null;
    nodeType = 1;
    nodeValue: string | null = null;
  }
  class FakeEl extends FakeNode {
    namespaceURI = SVG_NS;
    attributes: unknown[] = [];
    childNodes: FakeNode[] = [];
    localName: string;
    constructor(localName: string) {
      super();
      this.localName = localName;
    }
    appendChild(n: FakeEl): void {
      n.parentNode = this;
      this.childNodes.push(n);
    }
    removeChild(n: FakeNode): void {
      this.childNodes.splice(this.childNodes.indexOf(n), 1);
    }
    insertBefore(): void {
      throw new Error('không dùng ở test này');
    }
    hasAttribute(): boolean {
      return false;
    }
  }

  it('cây sâu 100.000 cấp không làm tràn ngăn xếp', () => {
    const root = new FakeEl('svg');
    let cur = root;
    for (let i = 0; i < 100_000; i++) {
      const g = new FakeEl('g');
      cur.appendChild(g);
      cur = g;
    }
    cur.appendChild(new FakeEl('script'));
    const report = sanitizeSvg(root as unknown as Element);
    expect(report.maxDepth).toBe(100_001);
    expect(report.elementCount).toBe(100_001);
    expect(report.removedElements).toEqual({ script: 1 });
    expect(cur.childNodes).toHaveLength(0);
  });
});
