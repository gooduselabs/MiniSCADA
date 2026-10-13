import { describe, expect, it } from 'vitest';
import { computeFit } from './fit.ts';

const size = { width: 1920, height: 1080 };

describe('computeFit (ADR-013 điểm 4)', () => {
  it('contain: k = min, căn giữa', () => {
    const f = computeFit(size, 'contain', { width: 1366, height: 768 });
    expect(f.k).toBeCloseTo(0.7113, 3); // 1366/1920
    expect(Math.abs(f.x)).toBeLessThan(1);
    expect(f.y).toBeCloseTo((768 - 1080 * f.k) / 2, 1);
    const g = computeFit(size, 'contain', { width: 2000, height: 600 });
    expect(g.k).toBeCloseTo(600 / 1080, 3);
    expect(g.x).toBeCloseTo((2000 - 1920 * g.k) / 2, 1);
    expect(g.y).toBe(0);
  });

  it('contain vừa khít: k = 1, không lệch', () => {
    const f = computeFit(size, 'contain', { width: 1920, height: 1080 });
    expect(f).toMatchObject({ k: 1, x: 0, y: 0, overflowX: false, overflowY: false });
  });

  it('contain phóng to khi vùng lớn hơn', () => {
    const f = computeFit(size, 'contain', { width: 3840, height: 2160 });
    expect(f.k).toBe(2);
  });

  it('cover: k = max, khung tràn và căn giữa (offset âm)', () => {
    const f = computeFit(size, 'cover', { width: 1366, height: 768 });
    expect(f.k).toBeCloseTo(Math.max(768 / 1080, 1366 / 1920), 3);
    expect(f.x).toBeLessThanOrEqual(0);
    expect(f.y).toBeLessThanOrEqual(0);
    expect(f.overflowX).toBe(false);
  });

  it('stretch: kx và ky khác nhau', () => {
    const f = computeFit(size, 'stretch', { width: 960, height: 1080 });
    expect(f.kx).toBeCloseTo(0.5, 3);
    expect(f.ky).toBe(1);
    expect(f.x).toBe(0);
    expect(f.y).toBe(0);
  });

  it('fit-width: k = W/w, cuộn dọc khi cao hơn vùng', () => {
    const f = computeFit(size, 'fit-width', { width: 960, height: 400 });
    expect(f.k).toBe(0.5);
    expect(f.overflowY).toBe(true);
    expect(f.overflowX).toBe(false);
    expect(f.y).toBe(0);
  });

  it('fit-width: vùng cao hơn khung thì không cuộn', () => {
    const f = computeFit(size, 'fit-width', { width: 960, height: 2000 });
    expect(f.overflowY).toBe(false);
  });

  it('none: k = 1, cuộn khi khung lớn hơn vùng', () => {
    const f = computeFit(size, 'none', { width: 800, height: 600 });
    expect(f).toMatchObject({ k: 1, x: 0, y: 0, overflowX: true, overflowY: true });
  });

  it('mặc định khi thiếu fitMode là contain', () => {
    expect(computeFit(size, undefined, { width: 960, height: 540 }).k).toBe(0.5);
  });

  it('làm tròn: k 4 số lẻ, vị trí tới 0,01 điểm ảnh', () => {
    const f = computeFit({ width: 1000, height: 700 }, 'contain', { width: 333, height: 777 });
    expect(f.k).toBe(0.333);
    expect(f.y * 100).toBeCloseTo(Math.round(f.y * 100), 6);
  });

  it('vùng chứa 0 (chưa bố cục): trả k = 1, không NaN, không vô cực', () => {
    for (const mode of ['contain', 'cover', 'stretch', 'fit-width', 'none'] as const) {
      const f = computeFit(size, mode, { width: 0, height: 0 });
      expect(Number.isFinite(f.k)).toBe(true);
      expect(f.k).toBe(1);
      expect(f.empty).toBe(true);
    }
  });

  it('khung kích thước 0 không gây chia cho 0', () => {
    const f = computeFit({ width: 0, height: 0 }, 'contain', { width: 100, height: 100 });
    expect(Number.isFinite(f.k)).toBe(true);
  });
});
