import { describe, expect, it } from 'vitest';
import { buildTransform, readM0, scaleFactors, type TransformState } from './transform-state.ts';

const ID = [1, 0, 0, 1, 0, 0] as const;
const box = { x: 0, y: 0, width: 100, height: 50 };
const st = (over: Partial<TransformState> = {}): TransformState => ({
  m0: [...ID],
  bbox: box,
  translate: null,
  rotate: null,
  scale: null,
  ...over,
});

describe('readM0', () => {
  it('thiếu hoặc rỗng: ma trận đơn vị; không hợp lệ: đơn vị', () => {
    expect(readM0(null)).toEqual(ID);
    expect(readM0('')).toEqual(ID);
    expect(readM0('foo(1)')).toEqual(ID);
  });
  it('dời, quay 90, co giãn, lệch, hợp', () => {
    expect(readM0('translate(10 20)')).toEqual([1, 0, 0, 1, 10, 20]);
    const r = readM0('rotate(90)');
    expect(r[0]).toBeCloseTo(0);
    expect(r[1]).toBeCloseTo(1);
    expect(readM0('scale(2 3)')).toEqual([2, 0, 0, 3, 0, 0]);
    expect(readM0('skewX(45)')[2]).toBeCloseTo(1);
    expect(readM0('translate(5 5) scale(2)')).toEqual([2, 0, 0, 2, 5, 5]);
  });
});

describe('scaleFactors', () => {
  it('axis xy, x, y', () => {
    expect(scaleFactors(2, 'xy')).toEqual({ sx: 2, sy: 2 });
    expect(scaleFactors(2, 'x')).toEqual({ sx: 2, sy: 1 });
    expect(scaleFactors(2, 'y')).toEqual({ sx: 1, sy: 2 });
    expect(scaleFactors(2, undefined)).toEqual({ sx: 2, sy: 2 });
  });
});

describe('buildTransform', () => {
  it('chỉ dời, M0 đơn vị: không có đoạn matrix', () => {
    expect(buildTransform(st({ translate: { x: 5, y: -3 } }))).toBe('translate(5px, -3px)');
  });
  it('không có đoạn nào: chuỗi rỗng', () => {
    expect(buildTransform(st())).toBe('');
  });
  it('M0 dời giữ nguyên, nằm sau dời của binding', () => {
    expect(buildTransform(st({ m0: [1, 0, 0, 1, 10, 20], translate: { x: 1, y: 2 } }))).toBe(
      'translate(1px, 2px) matrix(1, 0, 0, 1, 10, 20)',
    );
  });
  it('quay 90 quanh tâm hộp bao', () => {
    expect(buildTransform(st({ rotate: { angle: 90, pivot: [0.5, 0.5] } }))).toBe(
      'translate(50px, 25px) rotate(90deg) translate(-50px, -25px)',
    );
  });
  it('M0 quay 90, co giãn, lệch: ma trận làm tròn 6 chữ số', () => {
    const m0 = readM0('rotate(90)');
    expect(buildTransform(st({ m0, rotate: { angle: 10, pivot: [0, 0] } }))).toBe(
      'matrix(0, 1, -1, 0, 0, 0) translate(0px, 0px) rotate(10deg) translate(0px, 0px)',
    );
    expect(buildTransform(st({ m0: readM0('scale(2 3)') }))).toBe('matrix(2, 0, 0, 3, 0, 0)');
    expect(buildTransform(st({ m0: readM0('skewX(45)'), translate: { x: 0, y: 0 } }))).toBe(
      'translate(0px, 0px) matrix(1, 0, 1, 1, 0, 0)',
    );
  });
  it('co giãn theo axis quanh pivot', () => {
    expect(buildTransform(st({ scale: { sx: 2, sy: 1, pivot: [0, 0] } }))).toBe(
      'translate(0px, 0px) scale(2, 1) translate(0px, 0px)',
    );
    expect(buildTransform(st({ scale: { sx: 1, sy: 2, pivot: [1, 1] } }))).toBe(
      'translate(100px, 50px) scale(1, 2) translate(-100px, -50px)',
    );
  });
  it('tâm 9 điểm của quay', () => {
    const b = { x: 10, y: 20, width: 100, height: 40 };
    for (const px of [0, 0.5, 1])
      for (const py of [0, 0.5, 1]) {
        const cx = 10 + px * 100;
        const cy = 20 + py * 40;
        expect(buildTransform(st({ bbox: b, rotate: { angle: 45, pivot: [px, py] } }))).toBe(
          `translate(${cx}px, ${cy}px) rotate(45deg) translate(${-cx}px, ${-cy}px)`,
        );
      }
  });
  it('quay + dời + co giãn cùng lúc, đúng thứ tự', () => {
    expect(
      buildTransform(
        st({
          m0: [1, 0, 0, 1, 10, 20],
          translate: { x: 3, y: 4 },
          rotate: { angle: 30, pivot: [0.5, 0.5] },
          scale: { sx: 2, sy: 2, pivot: [0, 0] },
        }),
      ),
    ).toBe(
      'translate(3px, 4px) matrix(1, 0, 0, 1, 10, 20) translate(50px, 25px) rotate(30deg) translate(-50px, -25px) translate(0px, 0px) scale(2, 2) translate(0px, 0px)',
    );
  });
  it('góc quay tùy biến cho hoạt ảnh spin', () => {
    expect(buildTransform(st({ rotate: { angle: 0, pivot: [0.5, 0.5] } }), '360deg')).toBe(
      'translate(50px, 25px) rotate(360deg) translate(-50px, -25px)',
    );
  });
  it('chưa có hộp bao: bỏ đoạn quay và co giãn, giữ dời', () => {
    expect(
      buildTransform(
        st({
          bbox: null,
          translate: { x: 1, y: 1 },
          rotate: { angle: 5, pivot: [0.5, 0.5] },
          scale: { sx: 2, sy: 2, pivot: [0.5, 0.5] },
        }),
      ),
    ).toBe('translate(1px, 1px)');
  });
});
