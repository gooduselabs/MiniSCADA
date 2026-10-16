// T152 (SC-031; FR-100, research R25): biến đổi trong hệ tài liệu quy về hệ của cha; bake vào thuộc tính hình học khi
// chính xác (không nghiêng, det > 0; xoay chỉ bội 90° với rect/ellipse/circle; circle co không đều thành ellipse),
// ngược lại ghi `transform`. Mỗi ca so hộp bao với bản tham chiếu không bake (sai số ≤ 0,001).
import { describe, expect, it } from 'vitest';
import { moveNodes, rotateNodes, scaleNodes, transformNodes } from './bake.ts';
import { bbox } from './bbox.ts';
import { SetAttr, applyCommand } from './command.ts';
import { multiply, skewXM, type Matrix } from './matrix.ts';
import { findByUid, type DrawDoc, type NodeId } from './node.ts';
import { canonical, serialize } from './serialize.ts';
import { parentCtm, serializeTransform, transformOf } from './transform.ts';
import { attr, body, byId, expectBox, open } from './test-helpers.ts';
import { invert } from './matrix.ts';

/** Hộp bao tham chiếu: chỉ ghi transform = L·M (không bake) trên bản sao của tài liệu. */
function referenceBox(doc: DrawDoc, id: NodeId, T: Matrix) {
  const copy = open(serialize(doc));
  const P = parentCtm(copy, id);
  const L = multiply(multiply(invert(P)!, T), P);
  const M = transformOf(copy, id);
  applyCommand(
    copy,
    new SetAttr(id, 'transform', serializeTransform(multiply(L, M)) || 'translate(0 0)'),
  );
  return bbox(copy, id)!;
}

function run(inner: string, T: Matrix, id = 'x') {
  const doc = body(inner);
  const nid = byId(doc, id);
  const ref = referenceBox(doc, nid, T);
  const r = transformNodes(doc, [nid], T);
  applyCommand(doc, r.batch);
  const now = r.replaced.get(nid) ?? nid;
  const b = bbox(doc, now)!;
  expectBox(expect, b, ref.x, ref.y, ref.width, ref.height, 3);
  return { doc, id: now, n: doc.nodes.get(now)! };
}

const T = (a: number, b: number, c: number, d: number, e: number, f: number): Matrix => [
  a,
  b,
  c,
  d,
  e,
  f,
];
const move = (dx: number, dy: number) => T(1, 0, 0, 1, dx, dy);
const scaleAt = (sx: number, sy: number, ox = 0, oy = 0) =>
  T(sx, 0, 0, sy, ox - sx * ox, oy - sy * oy);
const rot = (deg: number, cx = 0, cy = 0): Matrix => {
  const r = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e12) / 1e12;
  const s = Math.round(Math.sin(r) * 1e12) / 1e12;
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
};

describe('bake: rect', () => {
  it('di chuyển: x, y đổi, không transform', () => {
    const { n } = run(
      '<rect id="x" x="10" y="20" width="30" height="40" stroke-width="2"/>',
      move(5, -3),
    );
    expect([n.attrs.get('x'), n.attrs.get('y'), n.attrs.has('transform')]).toEqual([
      '15',
      '17',
      false,
    ]);
    expect(n.attrs.get('stroke-width')).toBe('2');
  });
  it('co không đều quanh gốc: x y width height rx ry nhân tỉ lệ', () => {
    const { n } = run(
      '<rect id="x" x="10" y="10" width="10" height="10" rx="2" ry="1"/>',
      scaleAt(2, 3),
    );
    expect(['x', 'y', 'width', 'height', 'rx', 'ry'].map((k) => n.attrs.get(k))).toEqual([
      '20',
      '30',
      '20',
      '30',
      '4',
      '3',
    ]);
  });
  it('co quanh tâm', () => {
    const { n } = run('<rect id="x" x="0" y="0" width="10" height="10"/>', scaleAt(0.5, 0.5, 5, 5));
    expect(['x', 'y', 'width', 'height'].map((k) => n.attrs.get(k))).toEqual([
      '2.5',
      '2.5',
      '5',
      '5',
    ]);
  });
  it('xoay 90: bake, đổi vai rộng/cao', () => {
    const { n } = run('<rect id="x" x="0" y="0" width="10" height="4" rx="1" ry="2"/>', rot(90));
    expect(['x', 'y', 'width', 'height', 'rx', 'ry'].map((k) => n.attrs.get(k))).toEqual([
      '-4',
      '0',
      '4',
      '10',
      '2',
      '1',
    ]);
    expect(n.attrs.has('transform')).toBe(false);
  });
  it('xoay 180 và 270: bake', () => {
    for (const a of [180, 270, -90]) {
      const { n } = run('<rect id="x" x="1" y="2" width="10" height="4"/>', rot(a, 3, 3));
      expect(n.attrs.has('transform')).toBe(false);
    }
  });
  it('xoay 30: ghi transform rotate quanh tâm', () => {
    const { n } = run('<rect id="x" x="0" y="0" width="10" height="10"/>', rot(30, 5, 5));
    expect(n.attrs.get('transform')).toBe('rotate(30 5 5)');
    expect(n.attrs.get('x')).toBe('0');
  });
  it('lật (det < 0): ghi transform', () => {
    const { n } = run('<rect id="x" width="10" height="10"/>', scaleAt(-1, 1));
    expect(n.attrs.get('transform')).toBe('scale(-1 1)');
  });
  it('nghiêng: ghi matrix', () => {
    const { n } = run('<rect id="x" width="10" height="10"/>', skewXM(30));
    expect(n.attrs.get('transform')!.startsWith('matrix(')).toBe(true);
  });
  it('có sẵn rotate(30), di chuyển: bake phần dịch vào x, y, giữ transform', () => {
    const { n } = run(
      '<rect id="x" x="0" y="0" width="10" height="10" transform="rotate(30)"/>',
      move(10, 0),
    );
    expect(n.attrs.get('transform')).toBe('rotate(30)');
    expect(Number(n.attrs.get('x'))).toBeCloseTo(8.66, 2);
    expect(Number(n.attrs.get('y'))).toBeCloseTo(-5, 2);
  });
  it('có sẵn rotate(30), co không đều: không bake được, gộp vào transform', () => {
    const { n } = run(
      '<rect id="x" width="10" height="10" transform="rotate(30)"/>',
      scaleAt(2, 1),
    );
    expect(n.attrs.get('transform')!.startsWith('matrix(')).toBe(true);
  });
  it('đơn vị mm: không bake, ghi transform', () => {
    const { n } = run('<rect id="x" x="1mm" width="10mm" height="10mm"/>', move(5, 0));
    expect(n.attrs.get('x')).toBe('1mm');
    expect(n.attrs.get('transform')).toBe('translate(5 0)');
  });
  it('làm tròn 3 chữ số khi ghi', () => {
    const { n } = run('<rect id="x" x="10" width="1" height="1"/>', move(0.12345, 1 / 3));
    expect([n.attrs.get('x'), n.attrs.get('y')]).toEqual(['10.123', '0.333']);
  });
  it('trong g scale(2): dịch 10 đơn vị tài liệu = 5 đơn vị cha', () => {
    const { n } = run(
      '<g transform="scale(2)"><rect id="x" x="1" width="1" height="1"/></g>',
      move(10, 0),
    );
    expect(n.attrs.get('x')).toBe('6');
  });
  it('lồng 3 tầng có xoay: dịch trong hệ tài liệu quy về hệ cha', () => {
    const { n } = run(
      '<g transform="translate(50 50)"><g transform="rotate(90)"><g transform="scale(1 2)"><rect id="x" x="0" y="0" width="4" height="4"/></g></g></g>',
      move(10, 0),
    );
    // hệ cha: xoay 90 rồi co (1,2): dịch tài liệu (10,0) thành (0,-5) trong hệ cha
    expect([n.attrs.get('x'), n.attrs.get('y')]).toEqual(['0', '-5']);
  });
  it('lồng 3 tầng có nghiêng: dịch vẫn bake (K là phép dịch)', () => {
    const { n } = run(
      '<g transform="skewX(30)"><g transform="rotate(20)"><g transform="scale(2 1)"><rect id="x" width="4" height="4"/></g></g></g>',
      move(3, 4),
    );
    expect(n.attrs.has('transform')).toBe(false);
  });
  it('lồng 3 tầng có nghiêng: co trong hệ tài liệu thành transform (không bake)', () => {
    const { n } = run(
      '<g transform="skewX(30)"><g transform="rotate(20)"><g transform="scale(2 1)"><rect id="x" width="4" height="4"/></g></g></g>',
      scaleAt(2, 1),
    );
    expect(n.attrs.has('transform')).toBe(true);
  });
});

describe('bake: circle, ellipse', () => {
  it('circle co đều: r nhân', () => {
    const { n } = run('<circle id="x" cx="10" cy="10" r="5"/>', scaleAt(2, 2));
    expect(['cx', 'cy', 'r'].map((k) => n.attrs.get(k))).toEqual(['20', '20', '10']);
  });
  it('circle co không đều: thành ellipse, giữ uid, id và thứ tự', () => {
    const { doc, n } = run(
      '<circle id="x" data-mat-uid="el_cccccccccc" cx="10" cy="10" r="5" fill="#f00"/>',
      scaleAt(2, 1),
    );
    expect(n.tag).toBe('ellipse');
    expect([...n.attrs.keys()]).toEqual(['id', 'data-mat-uid', 'cx', 'cy', 'rx', 'ry', 'fill']);
    expect(['cx', 'cy', 'rx', 'ry'].map((k) => n.attrs.get(k))).toEqual(['20', '10', '10', '5']);
    expect(findByUid(doc, 'el_cccccccccc')).toBe(n.id);
  });
  it('circle xoay 45: bake (tròn bất biến khi xoay)', () => {
    const { n } = run('<circle id="x" cx="10" cy="0" r="5"/>', rot(45));
    expect(n.attrs.has('transform')).toBe(false);
    expect(n.tag).toBe('circle');
  });
  it('ellipse xoay 90: đổi rx, ry', () => {
    const { n } = run('<ellipse id="x" cx="10" cy="0" rx="5" ry="2"/>', rot(90));
    expect(['cx', 'cy', 'rx', 'ry'].map((k) => n.attrs.get(k))).toEqual(['0', '10', '2', '5']);
  });
  it('ellipse xoay 45: transform', () => {
    const { n } = run('<ellipse id="x" rx="5" ry="2"/>', rot(45));
    expect(n.attrs.get('transform')).toBe('rotate(45)');
  });
  it('ellipse di chuyển', () => {
    const { n } = run('<ellipse id="x" cx="1" cy="2" rx="5" ry="2"/>', move(1, 1));
    expect([n.attrs.get('cx'), n.attrs.get('cy')]).toEqual(['2', '3']);
  });
});

describe('bake: line, polyline, polygon (mọi góc xoay)', () => {
  it('line xoay 45: điểm mới', () => {
    const { n } = run('<line id="x" x1="0" y1="0" x2="10" y2="0"/>', rot(45));
    expect(n.attrs.has('transform')).toBe(false);
    expect(Number(n.attrs.get('x2'))).toBeCloseTo(7.071, 3);
    expect(Number(n.attrs.get('y2'))).toBeCloseTo(7.071, 3);
  });
  it('polyline co', () => {
    const { n } = run('<polyline id="x" points="0,0 10,5 20,0"/>', scaleAt(2, 3));
    expect(n.attrs.get('points')).toBe('0,0 20,15 40,0');
  });
  it('polygon di chuyển', () => {
    const { n } = run('<polygon id="x" points="0 0 10 0 5 5"/>', move(1, 2));
    expect(n.attrs.get('points')).toBe('1,2 11,2 6,7');
  });
  it('polygon lật: transform', () => {
    const { n } = run('<polygon id="x" points="0 0 10 0 5 5"/>', scaleAt(1, -1));
    expect(n.attrs.get('transform')).toBe('scale(1 -1)');
  });
});

describe('không bake: path, g, text, use, svg lồng', () => {
  it.each([
    ['path', '<path id="x" d="M0 0 L10 10"/>'],
    ['path cong', '<path id="x" d="M0 0 C5 5 5 5 10 0"/>'],
    ['g', '<g id="x"><rect width="1" height="1"/></g>'],
    ['text', '<text id="x" x="1" y="10">A</text>'],
    ['use', '<defs><rect id="t" width="2" height="2"/></defs><use id="x" href="#t"/>'],
    ['svg lồng', '<svg id="x" width="10" height="10"><rect width="1" height="1"/></svg>'],
  ])('%s: ghi transform', (_l, inner) => {
    const { n } = run(inner, move(4, 5));
    expect(n.attrs.get('transform')).toBe('translate(4 5)');
  });
  it('hai lần di chuyển path: transform gộp', () => {
    const doc = body('<path id="x" d="M0 0 L10 10"/>');
    applyCommand(doc, moveNodes(doc, [byId(doc, 'x')], 10, 0).batch);
    applyCommand(doc, moveNodes(doc, [byId(doc, 'x')], 5, 5).batch);
    expect(attr(doc, 'x', 'transform')).toBe('translate(15 5)');
  });
  it('g có transform sẵn, xoay thêm: gộp rotate', () => {
    const doc = body('<g id="x" transform="rotate(10)"><rect width="1" height="1"/></g>');
    applyCommand(doc, rotateNodes(doc, [byId(doc, 'x')], 20, 0, 0).batch);
    expect(attr(doc, 'x', 'transform')).toBe('rotate(30)');
  });
});

describe('nhiều nút và hoàn tác', () => {
  it('co vùng chọn gồm rect và path trong cùng một lô; hoàn tác về đúng byte', () => {
    const doc = body('<rect id="a" width="10" height="10"/><path id="b" d="M0 0 L10 10"/>');
    const before = canonical(doc);
    const r = scaleNodes(doc, [byId(doc, 'a'), byId(doc, 'b')], 2, 2, 0, 0);
    const inv = applyCommand(doc, r.batch);
    expect(attr(doc, 'a', 'width')).toBe('20');
    expect(attr(doc, 'b', 'transform')).toBe('scale(2)');
    applyCommand(doc, inv);
    expect(canonical(doc)).toBe(before);
  });
});
