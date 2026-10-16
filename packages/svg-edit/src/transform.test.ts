// T152 (SC-031; FR-100): phân tích và ghi `transform`, ma trận tích lũy qua 3 tầng lồng (xoay, nghiêng, co không đều),
// làm tròn 3 chữ số.
import { describe, expect, it } from 'vitest';
import {
  applyPoint,
  multiply,
  rotateM,
  scaleM,
  skewXM,
  translateM,
  type Matrix,
} from './matrix.ts';
import { ctm, fmt, parentCtm, parseTransformAttr, serializeTransform } from './transform.ts';
import { body, byId } from './test-helpers.ts';

describe('fmt: tối đa 3 chữ số thập phân, bỏ số 0 thừa, -0 thành 0', () => {
  it.each<[number, string]>([
    [1, '1'],
    [1.5, '1.5'],
    [1.23456, '1.235'],
    [-0, '0'],
    [-0.0004, '0'],
    [0.1 + 0.2, '0.3'],
    [100.1, '100.1'],
    [-12.3456, '-12.346'],
    [1e-7, '0'],
    [123456.7891, '123456.789'],
  ])('%s → %s', (n, s) => expect(fmt(n)).toBe(s));
});

describe('parseTransformAttr', () => {
  it.each<[string, Matrix]>([
    ['', [1, 0, 0, 1, 0, 0]],
    ['translate(10)', [1, 0, 0, 1, 10, 0]],
    ['translate(10,20)', [1, 0, 0, 1, 10, 20]],
    ['scale(2)', [2, 0, 0, 2, 0, 0]],
    ['scale(2 3)', [2, 0, 0, 3, 0, 0]],
    ['rotate(90)', rotateM(90)],
    ['rotate(90 10 10)', rotateM(90, 10, 10)],
    ['skewX(45)', skewXM(45)],
    ['matrix(1 2 3 4 5 6)', [1, 2, 3, 4, 5, 6]],
    [
      'translate(5 5) rotate(30) scale(2,1)',
      multiply(translateM(5, 5), multiply(rotateM(30), scaleM(2, 1))),
    ],
  ])('%s', (s, m) => {
    const r = parseTransformAttr(s)!;
    r.forEach((v, i) => expect(v).toBeCloseTo(m[i], 9));
  });
  it('chuỗi hỏng: null', () => expect(parseTransformAttr('foo(1)')).toBeNull());
});

describe('serializeTransform: dạng ngắn khi chính xác, ngược lại matrix', () => {
  it.each<[string, Matrix, string]>([
    ['đơn vị', [1, 0, 0, 1, 0, 0], ''],
    ['dịch', translateM(10, 20), 'translate(10 20)'],
    ['dịch lẻ', translateM(1.23456, -0.0001), 'translate(1.235 0)'],
    ['co đều', scaleM(2, 2), 'scale(2)'],
    ['co không đều', scaleM(2, 0.5), 'scale(2 0.5)'],
    ['xoay', rotateM(30), 'rotate(30)'],
    ['xoay âm', rotateM(-45), 'rotate(-45)'],
    ['xoay quanh tâm', rotateM(90, 10, 20), 'rotate(90 10 20)'],
    ['dịch rồi co', multiply(translateM(5, 6), scaleM(2, 3)), 'translate(5 6) scale(2 3)'],
    ['nghiêng', skewXM(30), 'matrix(1 0 0.577 1 0 0)'],
    ['tổng quát', [1, 2, 3, 4, 5, 6], 'matrix(1 2 3 4 5 6)'],
  ])('%s', (_l, m, s) => {
    expect(serializeTransform(m)).toBe(s);
    // ghi rồi đọc lại: sai số ≤ 0,001 trên điểm mẫu
    const back = parseTransformAttr(s)!;
    for (const p of [
      { x: 0, y: 0 },
      { x: 10, y: -7 },
      { x: 100, y: 100 },
    ]) {
      const a = applyPoint(m, p);
      const b = applyPoint(back, p);
      expect(Math.abs(a.x - b.x)).toBeLessThan(0.01 + 1e-3 * Math.abs(a.x));
      expect(Math.abs(a.y - b.y)).toBeLessThan(0.01 + 1e-3 * Math.abs(a.y));
    }
  });
});

describe('ma trận tích lũy (CTM) qua 3 tầng lồng', () => {
  const doc = body(
    '<g id="a" transform="translate(100 0) rotate(90)">' +
      '<g id="b" transform="skewX(30) scale(2 1)">' +
      '<g id="c" transform="scale(1 -3) translate(1 2)">' +
      '<rect id="r" x="1" y="1" width="2" height="2" transform="rotate(-15 2 2)"/>' +
      '</g></g></g>',
  );
  const A = multiply(translateM(100, 0), rotateM(90));
  const B = multiply(skewXM(30), scaleM(2, 1));
  const C = multiply(scaleM(1, -3), translateM(1, 2));
  const R = rotateM(-15, 2, 2);

  it.each<[string, string, Matrix]>([
    ['a', 'a', A],
    ['b', 'b', multiply(A, B)],
    ['c', 'c', multiply(multiply(A, B), C)],
    ['r (gồm transform của chính nó)', 'r', multiply(multiply(multiply(A, B), C), R)],
  ])('CTM(%s)', (_l, id, m) => {
    const got = ctm(doc, byId(doc, id));
    got.forEach((v, i) => expect(v).toBeCloseTo(m[i], 9));
  });

  it('parentCtm(r) = CTM(c)', () => {
    const got = parentCtm(doc, byId(doc, 'r'));
    const want = ctm(doc, byId(doc, 'c'));
    got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 9));
  });

  it('gốc: CTM là đơn vị (hệ tài liệu là hệ người dùng của gốc)', () => {
    expect(ctm(doc, doc.root)).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it.each<[number, number]>([
    [1, 1],
    [3, 3],
    [2, 1],
  ])('điểm (%s,%s) của rect qua CTM khớp phép nhân tay', (x, y) => {
    const p = applyPoint(ctm(doc, byId(doc, 'r')), { x, y });
    const q = applyPoint(A, applyPoint(B, applyPoint(C, applyPoint(R, { x, y }))));
    expect(p.x).toBeCloseTo(q.x, 9);
    expect(p.y).toBeCloseTo(q.y, 9);
  });
});
