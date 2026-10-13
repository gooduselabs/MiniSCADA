// Căn chỉnh theo hộp bao, phân bố đều, cùng cỡ (feature 007, T099; SC-014).
import { describe, expect, it } from 'vitest';
import { alignRects, boundsOf, distributeRects, matchRects } from './align.ts';

const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const a = r(10, 20, 30, 40);
const b = r(50, 0, 20, 10);
const c = r(100, 100, 10, 10);
// hộp bao: x 10..110 (rộng 100), y 0..110 (cao 110)

describe('boundsOf', () => {
  it('hộp bao của nhiều hình chữ nhật', () => {
    expect(boundsOf([a, b, c])).toEqual(r(10, 0, 100, 110));
    expect(boundsOf([a])).toEqual(a);
  });
});

describe('alignRects (6 kiểu)', () => {
  const xs = (k: Parameters<typeof alignRects>[1]) => alignRects([a, b, c], k).map((q) => q.x);
  const ys = (k: Parameters<typeof alignRects>[1]) => alignRects([a, b, c], k).map((q) => q.y);
  it('trái, phải, giữa ngang', () => {
    expect(xs('left')).toEqual([10, 10, 10]);
    expect(xs('right')).toEqual([80, 90, 100]);
    expect(xs('hcenter')).toEqual([45, 50, 55]);
  });
  it('trên, dưới, giữa dọc', () => {
    expect(ys('top')).toEqual([0, 0, 0]);
    expect(ys('bottom')).toEqual([70, 100, 100]);
    expect(ys('vmiddle')).toEqual([35, 50, 50]);
  });
  it('chỉ đổi một trục, giữ cỡ, kết quả nguyên (làm tròn .5 lên)', () => {
    const out = alignRects([r(0, 0, 31, 5), r(0, 0, 100, 5)], 'hcenter');
    expect(out[0]).toEqual(r(35, 0, 31, 5));
    expect(out[1]).toEqual(r(0, 0, 100, 5));
  });
  it('không đổi đối tượng đầu vào', () => {
    const src = [r(1, 2, 3, 4), r(5, 6, 7, 8)];
    const snap = JSON.stringify(src);
    alignRects(src, 'right');
    expect(JSON.stringify(src)).toBe(snap);
  });
});

describe('distributeRects', () => {
  it('ngang: giữ hai item ngoài cùng, chia đều khoảng trống', () => {
    const out = distributeRects([r(0, 0, 10, 5), r(15, 0, 30, 5), r(100, 0, 20, 5)], 'x');
    expect(out.map((q) => q.x)).toEqual([0, 40, 100]);
  });
  it('chia dư dồn vào khoảng cuối', () => {
    const out = distributeRects(
      [r(0, 0, 10, 5), r(5, 0, 10, 5), r(7, 0, 10, 5), r(100, 0, 10, 5)],
      'x',
    );
    // trống = 110 - 40 = 70; 3 khoảng: 23, 23, 24
    expect(out.map((q) => q.x)).toEqual([0, 33, 66, 100]);
  });
  it('thứ tự theo vị trí, kết quả theo thứ tự đầu vào', () => {
    const out = distributeRects(
      [r(100, 0, 10, 5), r(0, 0, 10, 5), r(7, 0, 10, 5), r(5, 0, 10, 5)],
      'x',
    );
    expect(out.map((q) => q.x)).toEqual([100, 0, 66, 33]);
  });
  it('dọc', () => {
    const out = distributeRects([r(0, 0, 5, 10), r(0, 3, 5, 10), r(0, 90, 5, 10)], 'y');
    expect(out.map((q) => q.y)).toEqual([0, 45, 90]);
  });
  it('dưới 3 item: không đổi', () => {
    const two = [r(0, 0, 10, 5), r(50, 0, 10, 5)];
    expect(distributeRects(two, 'x')).toEqual(two);
  });
  it('chồng nhau: khoảng âm vẫn nguyên và giữ hai đầu', () => {
    const out = distributeRects([r(0, 0, 50, 5), r(10, 0, 50, 5), r(60, 0, 50, 5)], 'x');
    expect(out.map((q) => q.x)).toEqual([0, 30, 60]);
  });
});

describe('matchRects', () => {
  const list = [r(0, 0, 10, 20), r(5, 5, 30, 40), r(9, 9, 50, 60)];
  it('cùng rộng theo item chính (mặc định item đầu)', () => {
    expect(matchRects(list, 'width').map((q) => q.width)).toEqual([10, 10, 10]);
    expect(matchRects(list, 'width', 1).map((q) => q.width)).toEqual([30, 30, 30]);
  });
  it('cùng cao; giữ x, y', () => {
    const out = matchRects(list, 'height', 2);
    expect(out.map((q) => q.height)).toEqual([60, 60, 60]);
    expect(out.map((q) => q.x)).toEqual([0, 5, 9]);
  });
});
