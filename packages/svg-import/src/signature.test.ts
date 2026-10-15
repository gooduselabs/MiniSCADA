// T098: test chữ ký nhập lại (FR-026; contract svg-import §7; ADR-023 mục 7). Viết TRƯỚC, phải đỏ.
// Hộp bao tính từ THUỘC TÍNH (jsdom không có getBBox), áp `transform` của phần tử và mọi tổ tiên.
import { describe, expect, it } from 'vitest';
import { buildSignatures, distance } from './signature.ts';
import { parseBody } from './test-helpers.ts';

const one = (body: string, attrs?: string) => {
  const set = buildSignatures(parseBody(body, attrs));
  return { set, first: set.items[0] };
};
const box = (body: string) => one(body).first.box as number[];

describe('hộp bao từ thuộc tính', () => {
  it('rect, circle, ellipse, line', () => {
    expect(box('<rect x="10" y="20" width="30" height="40"/>')).toEqual([10, 20, 40, 60]);
    expect(box('<circle cx="50" cy="50" r="10"/>')).toEqual([40, 40, 60, 60]);
    expect(box('<ellipse cx="50" cy="40" rx="20" ry="5"/>')).toEqual([30, 35, 70, 45]);
    expect(box('<line x1="10" y1="40" x2="5" y2="2"/>')).toEqual([5, 2, 10, 40]);
  });

  it('polyline và polygon: hộp bao các điểm', () => {
    expect(box('<polyline points="10,10 30,5 20,40"/>')).toEqual([10, 5, 30, 40]);
    expect(box('<polygon points="0 0 8 3 4 9"/>')).toEqual([0, 0, 8, 9]);
  });

  it('path: điểm điều khiển của mọi lệnh, tuyệt đối và tương đối', () => {
    expect(box('<path d="M0 0 C10 -5 20 25 30 10"/>')).toEqual([0, -5, 30, 25]);
    expect(box('<path d="m5 5 l10 0 h10 v10 z"/>')).toEqual([5, 5, 25, 15]);
    expect(box('<path d="M10 10 L20 10 H30 V40 Q35 50 40 20 Z"/>')).toEqual([10, 10, 40, 50]);
    expect(box('<path d="M0 0 A5 5 0 0 1 10 0"/>')).toEqual([0, 0, 10, 0]);
  });

  it('text: x, y, cỡ chữ x độ dài x 0,6; text-anchor dịch hộp', () => {
    const b = box('<text x="10" y="50" font-size="10">ABCD</text>');
    expect(b[0]).toBeCloseTo(10);
    expect(b[1]).toBeCloseTo(40);
    expect(b[2]).toBeCloseTo(34);
    expect(b[3]).toBeCloseTo(50);
    const m = box('<text x="100" y="50" font-size="10" text-anchor="middle">ABCD</text>');
    expect(m[0]).toBeCloseTo(88);
    expect(m[2]).toBeCloseTo(112);
  });

  it('image và use (cộng hộp bao của đích)', () => {
    expect(box('<image x="1" y="2" width="30" height="40" href="data:image/png;base64,AA"/>')).toEqual([1, 2, 31, 42]);
    const { set } = one('<defs><rect id="t" x="0" y="0" width="10" height="10"/></defs><use href="#t" x="5" y="6"/>');
    const use = set.items.find((i) => i.tag === 'use')!;
    expect(use.box).toEqual([5, 6, 15, 16]);
  });

  it('g: hợp hộp bao các con (đã áp transform của con và của chính g)', () => {
    const { set } = one(
      '<g transform="translate(10 0)"><rect x="0" y="0" width="10" height="10"/><circle cx="30" cy="5" r="5"/></g>',
    );
    expect(set.items[0].tag).toBe('g');
    expect(set.items[0].box).toEqual([10, 0, 45, 10]);
    expect(set.items[0].kids).toBe(2);
  });
});

describe('áp transform đầy đủ', () => {
  it('translate, scale, rotate quanh gốc và quanh điểm', () => {
    expect(box('<rect transform="translate(5 7)" x="0" y="0" width="10" height="10"/>')).toEqual([5, 7, 15, 17]);
    expect(box('<rect transform="scale(2)" x="0" y="0" width="10" height="10"/>')).toEqual([0, 0, 20, 20]);
    const r = box('<rect transform="rotate(90)" x="0" y="0" width="10" height="20"/>');
    expect(r[0]).toBeCloseTo(-20);
    expect(r[1]).toBeCloseTo(0);
    expect(r[2]).toBeCloseTo(0);
    expect(r[3]).toBeCloseTo(10);
    const c = box('<rect transform="rotate(180 5 5)" x="0" y="0" width="10" height="10"/>');
    expect(c[0]).toBeCloseTo(0);
    expect(c[2]).toBeCloseTo(10);
  });

  it('transform của tổ tiên lồng nhau nhân với transform của chính phần tử', () => {
    const { set } = one(
      '<g transform="translate(5 5)"><g transform="scale(2)"><rect transform="translate(1 1)" x="0" y="0" width="10" height="10"/></g></g>',
    );
    const rect = set.items.find((i) => i.tag === 'rect')!;
    expect(rect.box).toEqual([7, 7, 27, 27]);
  });

  it('matrix và skew', () => {
    expect(box('<rect transform="matrix(1 0 0 1 100 200)" x="0" y="0" width="1" height="1"/>')).toEqual([100, 200, 101, 201]);
    const k = box('<rect transform="skewX(45)" x="0" y="0" width="10" height="10"/>');
    expect(k[2]).toBeCloseTo(20);
  });

  it('transform lỗi: bỏ qua (coi như đơn vị), không ném', () => {
    expect(() => box('<rect transform="bogus(1)" x="0" y="0" width="10" height="10"/>')).not.toThrow();
  });
});

describe('tập chữ ký', () => {
  it('chỉ phần tử gắn được; đường dẫn, cha, id, uid, kiểu', () => {
    const { set } = one(
      '<defs><rect id="d" x="0" y="0" width="1" height="1"/></defs>' +
        '<g id="grp" data-mat-uid="el_aaaaaaaaaa"><rect id="r1" x="0" y="0" width="5" height="5" fill="#f00" stroke="#000"/><rect id="r2" x="6" y="0" width="5" height="5"/></g>',
    );
    expect(set.items.map((i) => i.tag)).toEqual(['g', 'rect', 'rect']);
    expect(set.items.map((i) => i.path)).toEqual(['/svg/g[1]', '/svg/g[1]/rect[1]', '/svg/g[1]/rect[2]']);
    expect(set.items.map((i) => i.parent)).toEqual([-1, 0, 0]);
    expect(set.items[0].uid).toBe('el_aaaaaaaaaa');
    expect(set.items[1].id).toBe('r1');
    expect(set.items[1].style).toEqual({ fill: '#f00', stroke: '#000' });
  });

  it('viewBox và đường chéo', () => {
    const { set } = one('<rect x="0" y="0" width="1" height="1"/>', 'viewBox="0 0 300 400" width="300" height="400"');
    expect(set.viewBox).toEqual([0, 0, 300, 400]);
    expect(set.diag).toBeCloseTo(500);
  });
});

describe('khoảng cách D', () => {
  const pair = (a: string, b: string, attrs = 'viewBox="0 0 300 400" width="300" height="400"') => {
    const A = buildSignatures(parseBody(a, attrs));
    const B = buildSignatures(parseBody(b, attrs));
    return { A: A.items[0], B: B.items[0], diag: A.diag };
  };

  it('Chebyshev theo hộp bao chia đường chéo viewBox', () => {
    const { A, B, diag } = pair(
      '<rect x="0" y="0" width="10" height="10"/>',
      '<rect x="5" y="0" width="12" height="10"/>',
    );
    expect(distance(A, B, diag)).toBeCloseTo(7 / 500);
  });

  it('đối xứng, 0 khi giống hệt, vô cực khi khác thẻ', () => {
    const { A, B, diag } = pair('<rect x="0" y="0" width="10" height="10"/>', '<circle cx="5" cy="5" r="5"/>');
    expect(distance(A, B, diag)).toBe(Infinity);
    expect(distance(B, A, diag)).toBe(Infinity);
    const s = pair('<rect x="0" y="0" width="10" height="10"/>', '<rect x="3" y="4" width="10" height="10"/>');
    expect(distance(s.A, s.B, s.diag)).toBeCloseTo(distance(s.B, s.A, s.diag), 12);
    const z = pair('<rect x="0" y="0" width="10" height="10"/>', '<rect x="0" y="0" width="10" height="10"/>');
    expect(distance(z.A, z.B, z.diag)).toBe(0);
  });

  it('phạt 0,02 cho mỗi thuộc tính trình bày khác nhau, tối đa 0,1', () => {
    const one1 = pair('<rect x="0" y="0" width="10" height="10" fill="#f00"/>', '<rect x="0" y="0" width="10" height="10" fill="#0f0"/>');
    expect(distance(one1.A, one1.B, one1.diag)).toBeCloseTo(0.02);
    const many = pair(
      '<rect x="0" y="0" width="10" height="10" fill="#f00" stroke="#000" stroke-width="1" opacity="1" font-size="3" visibility="visible" display="inline"/>',
      '<rect x="0" y="0" width="10" height="10"/>',
    );
    expect(distance(many.A, many.B, many.diag)).toBeCloseTo(0.1);
  });

  it('bất biến khi dời toàn bộ cả hai bản cùng một lượng', () => {
    const a = '<rect x="0" y="0" width="10" height="10"/>';
    const b = '<rect x="4" y="3" width="10" height="10"/>';
    const base = pair(a, b);
    const shifted = pair(`<g transform="translate(50 60)">${a}</g>`, `<g transform="translate(50 60)">${b}</g>`);
    const inner = (p: typeof shifted) => p.A;
    expect(shifted.A.tag).toBe('g');
    const A2 = buildSignatures(parseBody(`<g transform="translate(50 60)">${a}</g>`, 'viewBox="0 0 300 400" width="300" height="400"')).items[1];
    const B2 = buildSignatures(parseBody(`<g transform="translate(50 60)">${b}</g>`, 'viewBox="0 0 300 400" width="300" height="400"')).items[1];
    expect(distance(A2, B2, base.diag)).toBeCloseTo(distance(base.A, base.B, base.diag), 12);
    expect(inner(shifted)).toBeDefined();
  });

  it('g rỗng (không hộp): chỉ khớp g rỗng khác', () => {
    const e = pair('<g/>', '<g/>');
    expect(distance(e.A, e.B, e.diag)).toBe(0);
    const f = pair('<g/>', '<g><rect x="0" y="0" width="1" height="1"/></g>');
    expect(distance(f.A, f.B, f.diag)).toBe(Infinity);
  });
});
