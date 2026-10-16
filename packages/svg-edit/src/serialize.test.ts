// T154 (SC-030, FR-111): đọc và tuần tự hóa chuẩn tắc. Mở rồi lưu không sửa: cùng byte; sửa một thuộc tính: chỉ nút
// đó khác; nút mới nằm trên dòng riêng; phần ngoài allowlist bị loại khi đọc và lần lưu thứ hai ổn định.
import { describe, expect, it } from 'vitest';
import { makeSeededUid } from '@mat/svg-import';
import { parseDrawDoc } from './parse.ts';
import { serialize } from './serialize.ts';
import { applyCommand, InsertNode, RemoveNode, SetAttr, SetText } from './command.ts';
import { buildSubtree } from './build.ts';
import { findByUid, textOf, type DrawDoc } from './node.ts';

const NS = 'xmlns="http://www.w3.org/2000/svg"';

function open(text: string): DrawDoc {
  const r = parseDrawDoc(text, { uid: makeSeededUid(1) });
  if (!r.ok) throw new Error(r.code + ' ' + r.message);
  return r.doc;
}
function openReport(text: string) {
  const r = parseDrawDoc(text, { uid: makeSeededUid(1) });
  if (!r.ok) throw new Error(r.code + ' ' + r.message);
  return r;
}
const save2 = (text: string) => serialize(open(serialize(open(text))));

describe('mở rồi lưu không sửa: cùng byte', () => {
  it.each([
    [
      'tệp do bộ nhập ghi',
      `<svg ${NS} viewBox="0 0 100 100">\n<rect x="1" y="2" width="3" height="4" data-mat-uid="el_aaaaaaaaaa"/>\n</svg>\n`,
    ],
    [
      'thụt 2 dấu cách, chú thích, nháy đơn',
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- đầu -->\n<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox='0 0 10 10'>\n  <!-- ký hiệu -->\n  <g   id = "a"  >\n    <rect x='1' y="2"   width="3" height="4"/>\n  </g >\n</svg>\n<!-- cuối -->\n`,
    ],
    ['CRLF và BOM', `\ufeff<svg ${NS}>\r\n\t<circle cx="5" cy="5" r="2"/>\r\n</svg>\r\n`],
    [
      'thực thể và CDATA trong chữ',
      `<svg ${NS}><text x="1" y="2">a &amp; b &#x1EA1; &lt;<![CDATA[ c < d ]]></text></svg>`,
    ],
    [
      'style nội tuyến có khoảng trắng',
      `<svg ${NS}><rect style="fill: #f00 ; stroke : #000;" width="1" height="1"/></svg>`,
    ],
    [
      'số viết lạ giữ nguyên',
      `<svg ${NS}><rect x="1.50000" y="-0" width="1e1" height=".5"/></svg>`,
    ],
    [
      'xlink:href và href',
      `<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><defs><symbol id="s"><rect width="1" height="1"/></symbol></defs><use xlink:href="#s"/><use href="#s" x="3"/></svg>`,
    ],
    ['không có xuống dòng cuối', `<svg ${NS}><g/></svg>`],
    ['thuộc tính có thực thể', `<svg ${NS}><g data-mat-name="a &amp; b &quot;c&quot;"/></svg>`],
  ])('%s', (_l, text) => {
    expect(serialize(open(text))).toBe(text);
    expect(save2(text)).toBe(text);
  });
});

describe('sửa một thuộc tính: chỉ nút đó khác', () => {
  const text = `<svg ${NS} viewBox="0 0 100 100">\n  <g id='g1'>\n    <rect   id="r1" x="1" width="2" height="2"/>\n    <rect id="r2"  x="5" width="2" height="2"/>\n  </g>\n</svg>\n`;

  it('đổi x của r1: r1 ghi chuẩn tắc, phần còn lại nguyên byte', () => {
    const doc = open(text);
    const r1 = [...doc.nodes.values()].find((n) => n.attrs.get('id') === 'r1')!;
    applyCommand(doc, new SetAttr(r1.id, 'x', '10'));
    expect(serialize(doc)).toBe(
      text.replace(
        '<rect   id="r1" x="1" width="2" height="2"/>',
        '<rect id="r1" x="10" width="2" height="2"/>',
      ),
    );
  });

  it('thêm thuộc tính mới theo bảng ưu tiên (id, data-mat-*, hình học, transform, fill, stroke…)', () => {
    const doc = open(`<svg ${NS}><rect fill="#f00" x="1" width="2" height="2"/></svg>`);
    const r = [...doc.nodes.values()].find((n) => n.tag === 'rect')!;
    applyCommand(doc, new SetAttr(r.id, 'stroke', '#000'));
    applyCommand(doc, new SetAttr(r.id, 'id', 'k'));
    applyCommand(doc, new SetAttr(r.id, 'transform', 'rotate(5)'));
    applyCommand(doc, new SetAttr(r.id, 'data-mat-name', 'Tên'));
    applyCommand(doc, new SetAttr(r.id, 'opacity', '0.5'));
    expect(serialize(doc)).toBe(
      `<svg ${NS}><rect id="k" data-mat-name="Tên" fill="#f00" x="1" width="2" height="2" transform="rotate(5)" stroke="#000" opacity="0.5"/></svg>`,
    );
  });

  it('hoàn tác khôi phục đúng byte cũ', () => {
    const doc = open(text);
    const r1 = [...doc.nodes.values()].find((n) => n.attrs.get('id') === 'r1')!;
    const inv = applyCommand(doc, new SetAttr(r1.id, 'x', '10'));
    applyCommand(doc, inv);
    expect(serialize(doc)).toBe(text);
  });

  it('đổi chữ: chỉ nội dung chữ khác', () => {
    const doc = open(
      `<svg ${NS}>\n<text data-mat-uid="el_tttttttttt" x="1" y="2">Cũ</text>\n</svg>\n`,
    );
    const t = findByUid(doc, 'el_tttttttttt')!;
    applyCommand(doc, new SetText(t, 'Mới <&>'));
    expect(textOf(doc, t)).toBe('Mới <&>');
    expect(serialize(doc)).toBe(
      `<svg ${NS}>\n<text data-mat-uid="el_tttttttttt" x="1" y="2">Mới &lt;&amp;&gt;</text>\n</svg>\n`,
    );
  });
});

describe('nút mới và nút xóa', () => {
  it('tệp thụt 2 dấu cách: nút mới nằm trên dòng riêng, cùng thụt', () => {
    const doc = open(
      `<svg ${NS}>\n  <g id="a">\n    <rect width="1" height="1"/>\n  </g>\n</svg>\n`,
    );
    const g = [...doc.nodes.values()].find((n) => n.tag === 'g')!;
    const sub = buildSubtree(doc, { tag: 'circle', attrs: [['r', '2']] });
    applyCommand(doc, new InsertNode(g.id, g.children.length, sub));
    expect(serialize(doc)).toBe(
      `<svg ${NS}>\n  <g id="a">\n    <rect width="1" height="1"/>\n    <circle r="2"/>\n  </g>\n</svg>\n`,
    );
  });

  it('tệp do bộ nhập ghi (không thụt): nút mới trên dòng riêng', () => {
    const doc = open(`<svg ${NS}>\n<g>\n<rect width="1" height="1"/>\n</g>\n</svg>\n`);
    const g = [...doc.nodes.values()].find((n) => n.tag === 'g')!;
    const sub = buildSubtree(doc, {
      tag: 'g',
      attrs: [['id', 'n']],
      children: [{ tag: 'rect', attrs: [['width', '2']] }],
    });
    applyCommand(doc, new InsertNode(g.id, 2, sub));
    const out = serialize(doc);
    expect(out).toBe(
      `<svg ${NS}>\n<g>\n<rect width="1" height="1"/>\n<g id="n">\n<rect width="2"/>\n</g>\n</g>\n</svg>\n`,
    );
    // lưu lần hai sau khi mở lại: cùng byte
    expect(serialize(open(out))).toBe(out);
  });

  it('g tự đóng nhận con', () => {
    const doc = open(`<svg ${NS}>\n  <g id="a" />\n</svg>\n`);
    const g = [...doc.nodes.values()].find((n) => n.tag === 'g')!;
    applyCommand(doc, new InsertNode(g.id, 0, buildSubtree(doc, { tag: 'rect', attrs: [] })));
    expect(serialize(doc)).toBe(`<svg ${NS}>\n  <g id="a">\n    <rect/>\n  </g>\n</svg>\n`);
  });

  it('chữ không bị chèn khoảng trắng', () => {
    const doc = open(`<svg ${NS}>\n<text x="1">a</text>\n</svg>\n`);
    const t = [...doc.nodes.values()].find((n) => n.tag === 'text')!;
    applyCommand(
      doc,
      new InsertNode(t.id, 1, buildSubtree(doc, { tag: 'tspan', attrs: [], text: 'b' })),
    );
    expect(serialize(doc)).toBe(`<svg ${NS}>\n<text x="1">a<tspan>b</tspan></text>\n</svg>\n`);
  });

  it('xóa rồi hoàn tác: cùng byte', () => {
    const text = `<svg ${NS}>\n  <rect id="a" width="1" height="1"/>\n  <rect id="b"/>\n</svg>\n`;
    const doc = open(text);
    const a = [...doc.nodes.values()].find((n) => n.attrs.get('id') === 'a')!;
    const inv = applyCommand(doc, new RemoveNode(a.id));
    expect(serialize(doc)).not.toContain('id="a"');
    applyCommand(doc, inv);
    expect(serialize(doc)).toBe(text);
  });
});

describe('phần ngoài allowlist bị loại khi đọc, báo cáo, lần lưu thứ hai ổn định', () => {
  it('Inkscape thô: namespace, sodipodi, on*, script', () => {
    const text =
      `<svg ${NS} xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" viewBox="0 0 10 10">\n` +
      `  <sodipodi:namedview inkscape:zoom="1"/>\n` +
      `  <g inkscape:label="Lớp 1" inkscape:groupmode="layer" onclick="x()">\n` +
      `    <script>alert(1)</script>\n` +
      `    <rect width="1" height="1" style="fill:red;behavior:url(x.htc)"/>\n` +
      `  </g>\n</svg>\n`;
    const r = openReport(text);
    expect(r.report.removedElements).toBe(2);
    expect(r.report.removedAttributes).toBeGreaterThanOrEqual(4);
    expect(r.report.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        'R_NAMESPACE',
        'R_SCRIPT',
        'R_EVENT_ATTR',
        'R_ATTR_NOT_ALLOWED',
        'R_CSS_PROP',
      ]),
    );
    const once = serialize(r.doc);
    expect(once).not.toContain('script');
    expect(once).not.toContain('onclick');
    expect(once).not.toContain('inkscape');
    expect(once).toContain('style="fill:red"');
    expect(serialize(open(once))).toBe(once);
    expect(r.report.rebuilt).toBe(false);
    expect(r.report.domChecked).toBe(true);
  });

  it('a được mở vỏ, giữ con', () => {
    const r = openReport(`<svg ${NS}><a href="#x"><rect width="1" height="1"/></a></svg>`);
    expect(serialize(r.doc)).toBe(`<svg ${NS}><rect width="1" height="1"/></svg>`);
  });

  it.each([
    ['DOCTYPE', `<!DOCTYPE svg [<!ENTITY a "b">]><svg ${NS}/>`, 'SVG_UNSAFE'],
    ['XML hỏng', `<svg ${NS}><g></svg>`, 'SVG_PARSE'],
    ['gốc không phải svg', `<g ${NS}/>`, 'SVG_PARSE'],
    ['thực thể lạ', `<svg ${NS}><text>&nbsp;</text></svg>`, 'SVG_PARSE'],
    [
      'quá 5 MiB (trước phân tích)',
      `<svg ${NS}>` + ' '.repeat(5 * 1024 * 1024) + '</svg>',
      'SVG_LIMIT',
    ],
    ['sâu 33', `<svg ${NS}>` + '<g>'.repeat(32) + '</g>'.repeat(32) + '</svg>', 'SVG_LIMIT'],
    ['20.001 phần tử', `<svg ${NS}>` + '<g/>'.repeat(20_000) + '</svg>', 'SVG_LIMIT'],
  ])('từ chối: %s', (_l, text, code) => {
    const r = parseDrawDoc(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });

  it('đúng 20.000 phần tử và sâu 32: nhận', () => {
    expect(parseDrawDoc(`<svg ${NS}>` + '<g/>'.repeat(19_999) + '</svg>').ok).toBe(true);
    expect(parseDrawDoc(`<svg ${NS}>` + '<g>'.repeat(31) + '</g>'.repeat(31) + '</svg>').ok).toBe(
      true,
    );
  });

  it('không có DOMParser: vẫn đọc được bằng bộ đọc thuần (domCheck: false)', () => {
    const r = parseDrawDoc(`<svg ${NS}><rect onclick="x" width="1"/></svg>`, { domCheck: false });
    expect(r.ok && serialize(r.doc)).toBe(`<svg ${NS}><rect width="1"/></svg>`);
    expect(r.ok && r.report.domChecked).toBe(false);
  });
});
