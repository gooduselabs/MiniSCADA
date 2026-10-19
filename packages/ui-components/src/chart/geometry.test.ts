import { describe, expect, it } from 'vitest';
import {
  arcPath,
  fraction,
  gaugeAngle,
  gaugeStops,
  polar,
  resolveRange,
  sliceShape,
  zoneColorAt,
  zoneSegments,
} from './geometry.ts';
import { barLayout } from './bar-chart.ts';
import { pieSlices } from './pie-chart.ts';
import { autoYRange } from './line-chart.ts';

describe('geometry: thang và cung', () => {
  it('fraction kẹp 0..1, NaN và thang suy biến cho 0', () => {
    expect(fraction(5, 0, 10)).toBe(0.5);
    expect(fraction(-5, 0, 10)).toBe(0);
    expect(fraction(50, 0, 10)).toBe(1);
    expect(fraction(NaN, 0, 10)).toBe(0);
    expect(fraction(1, 5, 5)).toBe(0);
  });
  it('resolveRange: thuộc tính, Tag, 0–100, suy biến về 0–100', () => {
    expect(resolveRange(1, 9, 0, 5)).toEqual({ min: 1, max: 9 });
    expect(resolveRange(undefined, undefined, 2, 4)).toEqual({ min: 2, max: 4 });
    expect(resolveRange(undefined, undefined, undefined, undefined)).toEqual({ min: 0, max: 100 });
    expect(resolveRange(10, 10, undefined, undefined)).toEqual({ min: 0, max: 100 });
  });
  it('gaugeAngle và polar', () => {
    expect(gaugeAngle(0)).toBe(-90);
    expect(gaugeAngle(1)).toBe(90);
    expect(polar(100, 100, 50, 0)).toEqual({ x: 100, y: 50 });
    expect(polar(100, 100, 50, 90)).toEqual({ x: 150, y: 100 });
  });
  it('arcPath: nửa vòng và cả vòng', () => {
    expect(arcPath(100, 100, 50, -90, 90)).toBe('M 50 100 A 50 50 0 0 1 150 100');
    expect(arcPath(100, 100, 50, 0, 270)).toContain('A 50 50 0 1 1');
    expect(arcPath(100, 100, 50, 0, 360).match(/A /g)).toHaveLength(2);
  });
  it('sliceShape: miếng bánh đặc và vành khuyên đều là đường kín hữu hạn', () => {
    expect(sliceShape(100, 100, 50, 0, 0, 90)).toMatch(/^M 100 100 L .* Z$/);
    expect(sliceShape(100, 100, 50, 30, 0, 90)).not.toContain('NaN');
  });
  it('zoneSegments: cắt theo thang, bỏ vùng sai/ngoài thang/sai màu, tối đa 4', () => {
    const z = zoneSegments(
      [
        { from: -10, to: 20, color: '#111111' },
        { from: 200, to: 300, color: '#222222' },
        { from: 20, to: 30, color: 'red' },
        { from: 30, to: 50, color: '#333333' },
      ],
      0,
      100,
    );
    expect(z).toEqual([
      { from: 0, to: 20, color: '#111111' },
      { from: 30, to: 50, color: '#333333' },
    ]);
    expect(zoneSegments('nope', 0, 1)).toEqual([]);
  });
  it('zoneColorAt: nửa mở, vùng cuối gồm đầu mút phải', () => {
    const z = [
      { from: 0, to: 50, color: '#aa0000' },
      { from: 50, to: 100, color: '#00aa00' },
    ];
    expect(zoneColorAt(z, 49.9)).toBe('#aa0000');
    expect(zoneColorAt(z, 50)).toBe('#00aa00');
    expect(zoneColorAt(z, 100)).toBe('#00aa00');
    expect(zoneColorAt(z, 120)).toBeUndefined();
  });
});

describe('barLayout (FR-030): hình học cột', () => {
  const area = { x: 0, y: 0, width: 300, height: 100 };
  it('dọc: chiều cao tỉ lệ theo min–max, cột bám đáy', () => {
    const l = barLayout([50, 100, 0], { min: 0, max: 100, orientation: 'vertical', area });
    expect(l.bars).toHaveLength(3);
    expect(l.bars[0]).toMatchObject({ y: 50, height: 50 });
    expect(l.bars[1]).toMatchObject({ y: 0, height: 100 });
    expect(l.bars[2]!.height).toBe(0);
    // dải đều nhau, cột căn giữa dải
    expect(l.bars[0]!.x + l.bars[0]!.width / 2).toBeCloseTo(50, 1);
    expect(l.bars[1]!.x + l.bars[1]!.width / 2).toBeCloseTo(150, 1);
  });
  it('ngang: chiều rộng tỉ lệ, cột bám trái', () => {
    const l = barLayout([25, 100], { min: 0, max: 100, orientation: 'horizontal', area });
    expect(l.bars[0]).toMatchObject({ x: 0, width: 75 });
    expect(l.bars[1]).toMatchObject({ x: 0, width: 300 });
    expect(l.bars[0]!.y + l.bars[0]!.height / 2).toBeCloseTo(25, 1);
  });
  it('giá trị âm: cột đi xuống từ đường 0', () => {
    const l = barLayout([-50, 50], {
      min: -100,
      max: 100,
      orientation: 'vertical',
      area: { x: 0, y: 0, width: 200, height: 200 },
    });
    expect(l.zero).toBe(100);
    expect(l.bars[0]).toMatchObject({ y: 100, height: 50 });
    expect(l.bars[1]).toMatchObject({ y: 50, height: 50 });
  });
  it('tự co từ 0: min = min(0, dữ liệu), max = lớn nhất; cột lớn nhất cao đủ khung', () => {
    const l = barLayout([5, 20], { orientation: 'vertical', area });
    expect(l.min).toBe(0);
    expect(l.max).toBe(20);
    expect(l.bars[1]!.height).toBe(100);
  });
  it('giá trị vượt thang bị kẹp; null không có cột', () => {
    const l = barLayout([500, null], { min: 0, max: 100, orientation: 'vertical', area });
    expect(l.bars[0]!.height).toBe(100);
    expect(l.bars[1]!.height).toBe(0);
    expect(l.bars[1]!.value).toBeNull();
  });
  it('toàn số 0 hoặc rỗng: thang 0–1, không chia cho 0', () => {
    const l = barLayout([0, 0], { orientation: 'vertical', area });
    expect(l.max).toBeGreaterThan(l.min);
    expect(barLayout([], { orientation: 'vertical', area }).bars).toEqual([]);
  });
});

describe('pieSlices (FR-030, research R11)', () => {
  it('cung tổng 100 % = 360°, phân số theo giá trị', () => {
    const r = pieSlices([1, 1, 2]);
    expect(r.total).toBe(4);
    expect(r.slices.map((s) => s.fraction)).toEqual([0.25, 0.25, 0.5]);
    const sum = r.slices.reduce((a, s) => a + (s.endDeg - s.startDeg), 0);
    expect(sum).toBeCloseTo(360, 6);
    expect(r.slices[0]).toMatchObject({ startDeg: 0, endDeg: 90, included: true });
    expect(r.slices[2]!.endDeg).toBeCloseTo(360, 6);
  });
  it('tổng 0: rỗng, không chia cho 0', () => {
    const r = pieSlices([0, 0]);
    expect(r.total).toBe(0);
    expect(r.empty).toBe(true);
    expect(r.slices.every((s) => s.fraction === 0)).toBe(true);
  });
  it('âm và null (BAD) bị loại khỏi tổng, kèm lý do', () => {
    const r = pieSlices([10, -5, null, 30]);
    expect(r.total).toBe(40);
    expect(r.slices[1]).toMatchObject({ included: false, reason: 'negative', fraction: 0 });
    expect(r.slices[2]).toMatchObject({ included: false, reason: 'bad' });
    expect(r.slices[0]!.fraction).toBe(0.25);
    expect(r.slices[3]!.fraction).toBe(0.75);
  });
  it('một phần tử duy nhất: 100 %', () => {
    const r = pieSlices([7]);
    expect(r.slices[0]).toMatchObject({ fraction: 1, startDeg: 0, endDeg: 360 });
  });
  it('NaN, Infinity coi như BAD', () => {
    const r = pieSlices([NaN, Infinity, 5]);
    expect(r.slices[0]!.reason).toBe('bad');
    expect(r.slices[1]!.reason).toBe('bad');
    expect(r.total).toBe(5);
  });
});

describe('autoYRange (ADR-020, R11)', () => {
  it('cố định khi cả yMin và yMax được đặt', () => {
    expect(autoYRange(3, 7, 0, 100)).toEqual([0, 100]);
  });
  it('tự co: thêm 5 % mỗi phía', () => {
    const [a, b] = autoYRange(0, 100, undefined, undefined);
    expect(a).toBe(-5);
    expect(b).toBe(105);
  });
  it('dữ liệu phẳng: mở rộng quanh giá trị; không có dữ liệu: 0–1', () => {
    const [a, b] = autoYRange(5, 5, undefined, undefined);
    expect(a).toBeLessThan(5);
    expect(b).toBeGreaterThan(5);
    expect(autoYRange(null, null, undefined, undefined)).toEqual([0, 1]);
  });
});

describe('gaugeStops (feature 012): điểm dừng màu cung đồng hồ ECharts', () => {
  const T = '#dddddd';
  it('không vùng: một đoạn rãnh', () => {
    expect(gaugeStops([], 0, 100, T)).toEqual([[1, T]]);
  });
  it('vùng liền nhau phủ hết thang', () => {
    const z = zoneSegments(
      [
        { from: 0, to: 60, color: '#00aa00' },
        { from: 60, to: 100, color: '#aa0000' },
      ],
      0,
      100,
    );
    expect(gaugeStops(z, 0, 100, T)).toEqual([
      [0.6, '#00aa00'],
      [1, '#aa0000'],
    ]);
  });
  it('khoảng trống thành màu rãnh; vùng không theo thứ tự được sắp; chồng nhau không lùi', () => {
    const z = [
      { from: 50, to: 70, color: '#bb0000' },
      { from: 10, to: 60, color: '#00bb00' },
    ];
    expect(gaugeStops(z, 0, 100, T)).toEqual([
      [0.1, T],
      [0.6, '#00bb00'],
      [0.7, '#bb0000'],
      [1, T],
    ]);
  });
});
