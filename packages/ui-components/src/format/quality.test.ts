import { describe, expect, it } from 'vitest';
import type { Quality, TagState } from '../host/types.ts';
import { qualityView } from './quality.ts';

const st = (quality: Quality, reason?: string): TagState => ({ value: 1, quality, reason });

describe('qualityView (FR-018)', () => {
  it('GOOD: không lớp lỗi, không nhãn', () => {
    const v = qualityView(st('GOOD'), 'run');
    expect(v.cls).toBe('q-good');
    expect(v.badge).toBe('');
    expect(v.dim).toBe(false);
  });
  it('BAD: nhãn "BAD", giá trị mờ, lý do trong tooltip', () => {
    const v = qualityView(st('BAD', 'TIMEOUT'), 'run');
    expect(v.cls).toBe('q-bad');
    expect(v.badge).toBe('BAD');
    expect(v.dim).toBe(true);
    expect(v.tooltip).toContain('Hết thời gian chờ');
  });
  it('STALE: nhãn "STALE", mờ', () => {
    const v = qualityView(st('STALE'), 'run');
    expect(v.cls).toBe('q-stale');
    expect(v.badge).toBe('STALE');
    expect(v.dim).toBe(true);
  });
  it('UNCERTAIN: có biểu tượng chấm và tooltip, không mờ', () => {
    const v = qualityView(st('UNCERTAIN', 'CLAMPED'), 'run');
    expect(v.cls).toBe('q-uncertain');
    expect(v.badge).toBe('●');
    expect(v.dim).toBe(false);
    expect(v.tooltip).toContain('Giá trị bị cắt');
  });
  it('UNKNOWN: "?" và khóa', () => {
    const v = qualityView(st('UNKNOWN'), 'run');
    expect(v.cls).toBe('q-unknown');
    expect(v.badge).toBe('?');
    expect(v.locked).toBe(true);
  });
  it('mọi quality khác GOOD luôn có chữ hoặc biểu tượng và tooltip (không chỉ màu)', () => {
    for (const q of ['UNCERTAIN', 'BAD', 'STALE', 'UNKNOWN'] as Quality[]) {
      const v = qualityView(st(q), 'edit');
      expect(v.badge.length).toBeGreaterThan(0);
      expect(v.tooltip.length).toBeGreaterThan(0);
    }
  });
  it('mã lý do lạ hiện nguyên mã', () => {
    expect(qualityView(st('BAD', 'XYZ_NEW'), 'run').tooltip).toContain('XYZ_NEW');
  });
});
