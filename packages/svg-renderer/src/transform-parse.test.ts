import { describe, expect, it } from 'vitest';
import {
  IDENTITY_MATRIX,
  isTransform,
  multiplyMatrix,
  parseTransform,
  parseTransformMatrix,
  type Matrix2D,
} from './transform-parse.ts';

const close = (a: Matrix2D, b: Matrix2D) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

describe('parseTransform', () => {
  it('chuỗi rỗng là danh sách rỗng, ma trận đơn vị', () => {
    expect(parseTransform('')).toEqual([]);
    expect(parseTransform('  ')).toEqual([]);
    expect(parseTransformMatrix('')).toEqual(IDENTITY_MATRIX);
  });

  it('phân tích đủ sáu phép, cho phép phân cách bằng khoảng trắng hoặc dấu phẩy', () => {
    expect(
      parseTransform('matrix(1 0 0 1 5 6), translate(3) translate(1,2) scale(2) scale(2 3)'),
    ).toEqual([
      { type: 'matrix', values: [1, 0, 0, 1, 5, 6] },
      { type: 'translate', tx: 3, ty: 0 },
      { type: 'translate', tx: 1, ty: 2 },
      { type: 'scale', sx: 2, sy: 2 },
      { type: 'scale', sx: 2, sy: 3 },
    ]);
    expect(parseTransform('rotate(90) rotate(45 10 20) skewX(30) skewY(-10)')).toEqual([
      { type: 'rotate', angle: 90, cx: 0, cy: 0 },
      { type: 'rotate', angle: 45, cx: 10, cy: 20 },
      { type: 'skewX', angle: 30 },
      { type: 'skewY', angle: -10 },
    ]);
  });

  it('chấp nhận số dạng mũ, dấu, khoảng trắng quanh ngoặc', () => {
    expect(parseTransform('translate( 1e1 , -.5 )')).toEqual([
      { type: 'translate', tx: 10, ty: -0.5 },
    ]);
  });

  it.each([
    'foo(1)',
    'translate(1,2,3)',
    'matrix(1 2 3)',
    'rotate(1 2)',
    'scale()',
    'translate(NaN)',
    'translate(Infinity)',
    'translate(0x10)',
    'translate(1e999)',
    'translate(1px)',
    'translate(1',
    'translate 1',
    'translate(1)garbage',
    'url(#a)',
    'rotate(45deg)',
    'translate(2e9)',
    'scale(1,)',
  ])('từ chối %s', (s) => {
    expect(parseTransform(s)).toBeNull();
    expect(isTransform(s)).toBe(false);
  });

  it('isTransform chấp nhận chuỗi hợp lệ', () => {
    expect(isTransform('translate(10,20) rotate(30)')).toBe(true);
    expect(isTransform('')).toBe(true);
  });
});

describe('ma trận hợp', () => {
  it('multiplyMatrix theo thứ tự SVG (M1·M2: M2 áp lên điểm trước)', () => {
    // translate(10,0) rồi scale(2): điểm (1,0) -> scale -> (2,0) -> translate -> (12,0)
    const m = parseTransformMatrix('translate(10 0) scale(2)')!;
    close(m, [2, 0, 0, 2, 10, 0]);
    close(multiplyMatrix([1, 0, 0, 1, 10, 0], [2, 0, 0, 2, 0, 0]), [2, 0, 0, 2, 10, 0]);
  });

  it('rotate(a cx cy) = translate(c)·rotate(a)·translate(-c)', () => {
    const m = parseTransformMatrix('rotate(90 10 10)')!;
    // điểm (20,10) quanh (10,10) quay 90° -> (10,20)
    const x = m[0] * 20 + m[2] * 10 + m[4];
    const y = m[1] * 20 + m[3] * 10 + m[5];
    expect(x).toBeCloseTo(10, 9);
    expect(y).toBeCloseTo(20, 9);
  });

  it('skew', () => {
    close(parseTransformMatrix('skewX(45)')!, [1, 0, 1, 1, 0, 0]);
    close(parseTransformMatrix('skewY(45)')!, [1, 1, 0, 1, 0, 0]);
  });

  it('chuỗi không hợp lệ cho null', () => {
    expect(parseTransformMatrix('wobble(2)')).toBeNull();
  });
});
