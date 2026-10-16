// T041: test bộ ghi SVG (FR-020, FR-022; research R6). Viết TRƯỚC, phải đỏ.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeSvg } from './write.ts';
import { NS, doc, parse, parseBody } from './test-helpers.ts';

describe('writeSvg', () => {
  it('gốc có xmlns, kết thúc bằng xuống dòng', () => {
    const out = writeSvg(parseBody('<rect width="1" height="1"/>'));
    expect(out.startsWith(`<svg xmlns="${NS}"`)).toBe(true);
    expect(out.endsWith('</svg>\n')).toBe(true);
  });
  it('thứ tự thuộc tính cố định: id, hình học, trình bày, transform, data-mat-*', () => {
    const root = parseBody(
      '<rect fill="#f00" data-mat-name="Tên" y="2" id="r" data-mat-uid="el_abcdefghij" transform="translate(1 2)" x="1" stroke="#000" height="4" width="3"/>',
    );
    const out = writeSvg(root);
    expect(out).toContain(
      '<rect id="r" x="1" y="2" width="3" height="4" fill="#f00" stroke="#000" transform="translate(1 2)" data-mat-uid="el_abcdefghij" data-mat-name="Tên"/>',
    );
  });
  it('tất định: ghi hai lần và ghi lại bản đã đọc đều cho cùng chuỗi', () => {
    const root = parseBody(
      '<g id="a" opacity="0.5"><path d="M0 0L1 1" stroke="#000"/><text x="1" y="2">chữ  <tspan>x</tspan></text></g>',
    );
    const a = writeSvg(root);
    expect(writeSvg(root)).toBe(a);
    expect(writeSvg(parse(a))).toBe(a);
  });
  it('thoát & < > " trong giá trị thuộc tính', () => {
    const root = parseBody('<rect/>');
    root.querySelector('rect')!.setAttribute('data-mat-name', 'a & b < c > "d"');
    expect(writeSvg(root)).toContain('data-mat-name="a &amp; b &lt; c &gt; &quot;d&quot;"');
  });
  it('nội dung chữ giữ nguyên, kể cả khoảng trắng; ký tự đặc biệt được thoát', () => {
    const out = writeSvg(parseBody('<text>  a &lt;b&gt; &amp; c </text>'));
    expect(out).toContain('<text>  a &lt;b&gt; &amp; c </text>');
  });
  it('chuỗi giống thẻ trong chữ không thành phần tử', () => {
    const out = writeSvg(parseBody('<text>&lt;script&gt;alert(1)&lt;/script&gt;</text>'));
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('xml:space giữ dạng có tiền tố', () => {
    const out = writeSvg(parseBody('<text xml:space="preserve">a</text>'));
    expect(out).toContain('xml:space="preserve"');
  });
  it('phần tử không con tự đóng', () => {
    expect(writeSvg(parseBody('<g><circle r="1"/></g>'))).toContain('<circle r="1"/>');
  });
  it('cây rất sâu không tràn ngăn xếp (duyệt không đệ quy)', () => {
    const root = parse(doc(''));
    let cur: Element = root;
    for (let i = 0; i < 5000; i++) {
      const g = root.ownerDocument.createElementNS(NS, 'g');
      cur.appendChild(g);
      cur = g;
    }
    const out = writeSvg(root);
    expect(out.split('<g').length - 1).toBe(5000); // g trong cùng là <g/>
    expect(out.split('</g>').length - 1).toBe(4999);
  });
});

describe('cấu trúc mã nguồn (Constitution V)', () => {
  it('không XMLSerializer, innerHTML, outerHTML, insertAdjacentHTML, eval, new Function', () => {
    const dir = resolve(__dirname);
    const banned = [
      'XMLSerializer',
      'innerHTML',
      'outerHTML',
      'insertAdjacentHTML',
      'eval(',
      'new Function',
      'document.write',
    ];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts') || f === 'test-helpers.ts') continue;
      const src = readFileSync(resolve(dir, f), 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');
      for (const b of banned) expect(src.includes(b), `${f} chứa ${b}`).toBe(false);
    }
  });
});
