// T152 (SC-031): ma trận affine 2D. Sai số ≤ 0,001.
import { describe, expect, it } from 'vitest';
import {
  IDENTITY,
  applyPoint,
  decompose,
  hasSkew,
  invert,
  isIdentity,
  matrixEquals,
  multiply,
  rotateM,
  scaleM,
  skewXM,
  translateM,
  type Matrix,
} from './matrix.ts';

const close = (a: Matrix, b: Matrix) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe('matrix: phép cơ bản', () => {
  it.each<[string, Matrix, [number, number], [number, number]]>([
    ['đơn vị', [1, 0, 0, 1, 0, 0], [3, 4], [3, 4]],
    ['dịch', translateM(10, -5), [1, 1], [11, -4]],
    ['co đều', scaleM(2, 2), [3, 4], [6, 8]],
    ['co không đều', scaleM(2, 3), [3, 4], [6, 12]],
    ['co quanh tâm', scaleM(2, 2, 10, 10), [12, 10], [14, 10]],
    ['xoay 90', rotateM(90), [1, 0], [0, 1]],
    ['xoay 180', rotateM(180), [1, 2], [-1, -2]],
    ['xoay 90 quanh (5,5)', rotateM(90, 5, 5), [6, 5], [5, 6]],
    ['xoay -45', rotateM(-45), [1, 0], [Math.SQRT1_2, -Math.SQRT1_2]],
    ['nghiêng X 45', skewXM(45), [0, 1], [1, 1]],
    ['lật ngang', scaleM(-1, 1), [3, 4], [-3, 4]],
  ])('%s', (_l, m, p, q) => {
    const r = applyPoint(m, { x: p[0], y: p[1] });
    expect(r.x).toBeCloseTo(q[0], 6);
    expect(r.y).toBeCloseTo(q[1], 6);
  });

  it.each<[string, Matrix]>([
    ['dịch', translateM(3, 4)],
    ['xoay', rotateM(33, 2, 7)],
    ['co', scaleM(0.5, 4)],
    ['nghiêng', skewXM(20)],
    ['tổng hợp', multiply(translateM(5, 6), multiply(rotateM(17), scaleM(2, -3)))],
  ])('nghịch đảo: M·M⁻¹ = I (%s)', (_l, m) => {
    close(multiply(m, invert(m)!), IDENTITY);
    close(multiply(invert(m)!, m), IDENTITY);
  });

  it('ma trận suy biến không có nghịch đảo', () => {
    expect(invert([0, 0, 0, 0, 1, 1])).toBeNull();
    expect(invert(scaleM(0, 1))).toBeNull();
  });

  it('thứ tự nhân như danh sách transform của SVG (phải trước)', () => {
    const p = applyPoint(multiply(translateM(10, 0), scaleM(2, 2)), { x: 1, y: 1 });
    expect(p).toEqual({ x: 12, y: 2 });
  });

  it.each<[string, Matrix, boolean]>([
    ['đơn vị', IDENTITY, false],
    ['xoay', rotateM(30), false],
    ['co không đều', scaleM(2, 5), false],
    ['xoay sau co không đều', multiply(rotateM(30), scaleM(2, 1)), false],
    ['co không đều sau xoay', multiply(scaleM(2, 1), rotateM(30)), true],
    ['nghiêng', skewXM(10), true],
  ])('hasSkew: %s', (_l, m, skew) => expect(hasSkew(m)).toBe(skew));

  it.each<[string, Matrix, { tx: number; ty: number; angle: number; sx: number; sy: number }]>([
    ['dịch', translateM(4, 5), { tx: 4, ty: 5, angle: 0, sx: 1, sy: 1 }],
    ['xoay 30', rotateM(30), { tx: 0, ty: 0, angle: 30, sx: 1, sy: 1 }],
    ['co 2,3', scaleM(2, 3), { tx: 0, ty: 0, angle: 0, sx: 2, sy: 3 }],
    [
      'xoay 90 + co',
      multiply(rotateM(90), scaleM(2, 3)),
      { tx: 0, ty: 0, angle: 90, sx: 2, sy: 3 },
    ],
    ['lật dọc', scaleM(1, -1), { tx: 0, ty: 0, angle: 0, sx: 1, sy: -1 }],
  ])('decompose: %s', (_l, m, d) => {
    const r = decompose(m);
    expect(r.tx).toBeCloseTo(d.tx, 6);
    expect(r.ty).toBeCloseTo(d.ty, 6);
    expect(r.angle).toBeCloseTo(d.angle, 6);
    expect(r.sx).toBeCloseTo(d.sx, 6);
    expect(r.sy).toBeCloseTo(d.sy, 6);
  });

  it('isIdentity và matrixEquals với sai số', () => {
    expect(isIdentity([1, 1e-12, 0, 1, 0, -1e-12])).toBe(true);
    expect(isIdentity(translateM(0.01, 0))).toBe(false);
    expect(matrixEquals(rotateM(360), IDENTITY)).toBe(true);
  });
});
