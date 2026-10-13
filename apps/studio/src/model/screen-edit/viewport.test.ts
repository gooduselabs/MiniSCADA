// Viewport: đổi tọa độ, zoom quanh con trỏ, pan, "Vừa khung" (feature 007, T097; SC-014).
import { describe, expect, it } from 'vitest';
import {
  fitViewport,
  panBy,
  toDesign,
  toScreen,
  zoomAt,
  zoomIn,
  zoomOut,
  zoomPercent,
  zoomWheel,
  type Viewport,
} from './viewport.ts';

const vp = (zoom: number, panX = 0, panY = 0): Viewport => ({ zoom, panX, panY });

/** Điểm thiết kế dưới con trỏ phải đứng yên (sai số do làm tròn pan về điểm ảnh nguyên). */
const underAnchor = (before: Viewport, after: Viewport, a: { x: number; y: number }) => {
  const d0 = toDesign(before, a);
  const d1 = toDesign(after, a);
  return Math.abs(d0.x - d1.x) <= 0.5 / after.zoom && Math.abs(d0.y - d1.y) <= 0.5 / after.zoom;
};

describe('đổi tọa độ', () => {
  it('toScreen và toDesign là nghịch đảo của nhau', () => {
    const v = vp(2, 10, 20);
    expect(toScreen(v, { x: 5, y: 5 })).toEqual({ x: 20, y: 30 });
    expect(toDesign(v, { x: 20, y: 30 })).toEqual({ x: 5, y: 5 });
    const p = toDesign(vp(0.25, -7, 3), toScreen(vp(0.25, -7, 3), { x: 123, y: 45 }));
    expect(p.x).toBeCloseTo(123, 9);
    expect(p.y).toBeCloseTo(45, 9);
  });
});

describe('zoom', () => {
  it('bước nhân 1,25 và kẹp 10–400 %', () => {
    expect(zoomIn(vp(1), { x: 0, y: 0 }).zoom).toBe(1.25);
    expect(zoomIn(vp(1.25), { x: 0, y: 0 }).zoom).toBe(1.5625);
    expect(zoomOut(vp(1), { x: 0, y: 0 }).zoom).toBe(0.8);
    expect(zoomIn(vp(4), { x: 0, y: 0 }).zoom).toBe(4);
    expect(zoomIn(vp(3.5), { x: 0, y: 0 }).zoom).toBe(4);
    expect(zoomOut(vp(0.1), { x: 0, y: 0 }).zoom).toBe(0.1);
    expect(zoomOut(vp(0.11), { x: 0, y: 0 }).zoom).toBe(0.1);
  });

  it('zoom quanh con trỏ giữ nguyên điểm thiết kế dưới con trỏ', () => {
    const r = zoomAt(vp(1), 2, { x: 100, y: 50 });
    expect(r).toEqual({ zoom: 2, panX: -100, panY: -50 });
    const a = { x: 333, y: 217 };
    const start = vp(0.8, 40, -15);
    for (const f of [1.25, 0.8, 1.1, 1 / 1.1])
      expect(underAnchor(start, zoomAt(start, f, a), a)).toBe(true);
  });

  it('lăn chuột nhân 1,1: lăn lên phóng to, lăn xuống thu nhỏ', () => {
    expect(zoomWheel(vp(1), -100, { x: 100, y: 50 })).toEqual({ zoom: 1.1, panX: -10, panY: -5 });
    expect(zoomWheel(vp(1.1), 100, { x: 0, y: 0 }).zoom).toBe(1);
    expect(zoomWheel(vp(4), -100, { x: 0, y: 0 }).zoom).toBe(4);
    expect(zoomWheel(vp(1), 0, { x: 0, y: 0 })).toEqual(vp(1));
  });

  it('phần trăm hiển thị làm tròn', () => {
    expect(zoomPercent(vp(1.5625))).toBe(156);
    expect(zoomPercent(vp(0.1))).toBe(10);
  });
});

describe('pan', () => {
  it('panBy cộng theo điểm ảnh màn hình', () => {
    expect(panBy(vp(1), 10, -5)).toEqual({ zoom: 1, panX: 10, panY: -5 });
    expect(panBy(vp(2, 1, 1), 0.4, 0.6)).toEqual({ zoom: 2, panX: 1, panY: 2 });
  });
});

describe('fitViewport ("Vừa khung")', () => {
  const area = { width: 1000, height: 600 };
  it('vừa theo cạnh chặt hơn, căn giữa', () => {
    expect(fitViewport(area, { width: 1280, height: 720 })).toEqual({
      zoom: 0.7812,
      panX: 0,
      panY: 19,
    });
  });
  it('có lề', () => {
    expect(fitViewport(area, { width: 1280, height: 720 }, 20)).toEqual({
      zoom: 0.75,
      panX: 20,
      panY: 30,
    });
  });
  it('màn hình nhỏ: phóng tới tối đa 400 %', () => {
    expect(fitViewport({ width: 1000, height: 800 }, { width: 100, height: 50 })).toEqual({
      zoom: 4,
      panX: 300,
      panY: 300,
    });
  });
  it('vùng nhìn tí hon hoặc không dương: kẹp 10 %, không NaN', () => {
    const v = fitViewport({ width: 0, height: 0 }, { width: 1280, height: 720 });
    expect(v.zoom).toBe(0.1);
    expect(Number.isFinite(v.panX) && Number.isFinite(v.panY)).toBe(true);
  });
});
