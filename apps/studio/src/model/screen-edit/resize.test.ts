// Đổi cỡ bằng 8 tay nắm (feature 007, T100; SC-014).
import { describe, expect, it } from 'vitest';
import { catalogMinSizeOf, resizeGroup, resizeRect } from './resize.ts';

const R = { x: 100, y: 100, width: 200, height: 100 };
const min = { width: 64, height: 32 };
const rs = (h: Parameters<typeof resizeRect>[1], dx: number, dy: number, keepRatio = false) =>
  resizeRect(R, h, dx, dy, { min, keepRatio });

describe('resizeRect: chỉ cạnh đang kéo đổi', () => {
  it('cạnh', () => {
    expect(rs('e', 30, 99)).toEqual({ x: 100, y: 100, width: 230, height: 100 });
    expect(rs('w', -20, 99)).toEqual({ x: 80, y: 100, width: 220, height: 100 });
    expect(rs('w', 50, 0)).toEqual({ x: 150, y: 100, width: 150, height: 100 });
    expect(rs('n', 99, -40)).toEqual({ x: 100, y: 60, width: 200, height: 140 });
    expect(rs('s', 99, 25)).toEqual({ x: 100, y: 100, width: 200, height: 125 });
  });
  it('góc', () => {
    expect(rs('se', 20, 10)).toEqual({ x: 100, y: 100, width: 220, height: 110 });
    expect(rs('nw', -10, -5)).toEqual({ x: 90, y: 95, width: 210, height: 105 });
    expect(rs('ne', 10, -10)).toEqual({ x: 100, y: 90, width: 210, height: 110 });
    expect(rs('sw', -10, 10)).toEqual({ x: 90, y: 100, width: 210, height: 110 });
  });
  it('kẹp tối thiểu, neo cạnh đối diện; không lật, không âm', () => {
    expect(rs('w', 300, 0)).toEqual({ x: 236, y: 100, width: 64, height: 100 });
    expect(rs('s', 0, -90)).toEqual({ x: 100, y: 100, width: 200, height: 32 });
    expect(rs('n', 0, 500)).toEqual({ x: 100, y: 168, width: 200, height: 32 });
    expect(rs('e', -9999, 0).width).toBe(64);
  });
  it('làm tròn cạnh đang kéo về số nguyên', () => {
    expect(rs('e', 10.6, 0).width).toBe(211);
    expect(rs('w', -10.4, 0)).toEqual({ x: 90, y: 100, width: 210, height: 100 });
  });
});

describe('resizeRect: Shift giữ tỉ lệ ở góc', () => {
  it('theo trục đổi nhiều hơn (tỉ lệ 2:1)', () => {
    expect(rs('se', 40, 0, true)).toEqual({ x: 100, y: 100, width: 240, height: 120 });
    expect(rs('se', 0, 30, true)).toEqual({ x: 100, y: 100, width: 260, height: 130 });
    expect(rs('se', 44, 0, true)).toMatchObject({ width: 244, height: 122 });
  });
  it('neo góc đối diện', () => {
    expect(rs('nw', -20, 0, true)).toEqual({ x: 80, y: 90, width: 220, height: 110 });
    expect(rs('ne', 20, 0, true)).toEqual({ x: 100, y: 90, width: 220, height: 110 });
    expect(rs('sw', -20, 0, true)).toEqual({ x: 80, y: 100, width: 220, height: 110 });
  });
  it('chạm tối thiểu thì dừng ở hệ số nhỏ nhất vẫn hợp lệ', () => {
    expect(rs('se', -190, -90, true)).toEqual({ x: 100, y: 100, width: 64, height: 32 });
  });
  it('tay nắm cạnh bỏ qua Shift', () => {
    expect(rs('e', 30, 0, true)).toEqual(rs('e', 30, 0, false));
  });
});

describe('resizeGroup: co tỉ lệ theo hộp bao', () => {
  const r1 = { x: 0, y: 0, width: 100, height: 50 };
  const r2 = { x: 100, y: 50, width: 100, height: 50 };
  const m = (w: number, h: number) => ({ width: w, height: h });
  it('kéo tay nắm đông', () => {
    const out = resizeGroup([r1, r2], 'e', 100, 0, { mins: [m(10, 10), m(10, 10)] });
    expect(out).toEqual([
      { x: 0, y: 0, width: 150, height: 50 },
      { x: 150, y: 50, width: 150, height: 50 },
    ]);
  });
  it('thu về một nửa', () => {
    const out = resizeGroup([r1, r2], 'se', -100, 0, { mins: [m(10, 10), m(10, 10)] });
    expect(out).toEqual([
      { x: 0, y: 0, width: 50, height: 50 },
      { x: 50, y: 50, width: 50, height: 50 },
    ]);
  });
  it('dừng khi item nhỏ nhất chạm giới hạn', () => {
    const out = resizeGroup([r1, r2], 'e', -150, 0, { mins: [m(40, 20), m(40, 20)] });
    expect(out).toEqual([
      { x: 0, y: 0, width: 40, height: 50 },
      { x: 40, y: 50, width: 40, height: 50 },
    ]);
  });
  it('item đã ở cỡ tối thiểu thì cả nhóm không co theo trục đó', () => {
    const s1 = { x: 0, y: 0, width: 30, height: 30 };
    const s2 = { x: 50, y: 0, width: 100, height: 30 };
    const out = resizeGroup([s1, s2], 'e', -50, 0, { mins: [m(30, 30), m(20, 20)] });
    expect(out).toEqual([s1, s2]);
  });
  it('Shift ở góc theo tỉ lệ hộp bao nhóm', () => {
    const out = resizeGroup([r1, r2], 'se', 100, 0, {
      mins: [m(10, 10), m(10, 10)],
      keepRatio: true,
    });
    expect(out).toEqual([
      { x: 0, y: 0, width: 150, height: 75 },
      { x: 150, y: 75, width: 150, height: 75 },
    ]);
  });
  it('một item tương đương resizeRect', () => {
    expect(resizeGroup([R], 'se', 20, 10, { mins: [min] })).toEqual([rs('se', 20, 10)]);
  });
});

describe('catalogMinSizeOf', () => {
  it('theo danh mục cho widget, 16×16 cho svg và loại lạ', () => {
    const base = { id: 'a', x: 0, y: 0, width: 10, height: 10 };
    expect(catalogMinSizeOf({ ...base, type: 'widget', widget: 'card' })).toEqual({
      width: 96,
      height: 56,
    });
    expect(
      catalogMinSizeOf({
        ...base,
        type: 'svg',
        svgFile: 'a.svg',
        bindingFile: 'a.json',
        viewBox: [0, 0, 1, 1],
        elements: [],
      }),
    ).toEqual({ width: 16, height: 16 });
    expect(catalogMinSizeOf({ ...base, type: 'widget', widget: 'nope' })).toEqual({
      width: 16,
      height: 16,
    });
  });
});
