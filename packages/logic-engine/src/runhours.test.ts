// Giờ chạy (T126; FR-088; contracts/logic-engine.md §6): 24 giờ mô phỏng sai ≤ 0,01 giờ, starts theo cạnh lên, due,
// reset giữ starts, unknown không cộng.
import { describe, expect, it } from 'vitest';
import { LogicHarness } from './harness.ts';
import type { LogicRunhours } from '@mat/project-schema';

const B = { type: 'BOOL', kind: 'external', access: 'R' } as const;
const make = (o: Partial<LogicRunhours> = {}, retain?: Record<string, number | boolean | string>) =>
  new LogicHarness(
    {
      schemaVersion: '1.0.0',
      runhours: [
        { id: 'h', run: 'RUN', reset: 'RST', hours: 'L.H', starts: 'L.S', due: 'L.D', ...o },
      ],
    },
    { tags: { RUN: B, RST: B }, ...(retain ? { retain } : {}) },
  );

describe('runhours', () => {
  it('24 giờ: chạy 1 giờ, nghỉ 1 giờ: 12 giờ (≤ 0,01), 12 lần khởi động', () => {
    const h = make({ serviceEveryHours: 11.5 });
    h.set('RST', false);
    h.set('RUN', false);
    h.runTo(0);
    for (let i = 0; i < 12; i++) {
      h.set('RUN', true);
      h.runTo(i * 7_200_000 + 3_600_000);
      h.set('RUN', false);
      h.runTo((i + 1) * 7_200_000);
    }
    expect(Math.abs((h.value('L.H') as number) - 12)).toBeLessThanOrEqual(0.01);
    expect(h.value('L.H')).toBe(12);
    expect(h.value('L.S')).toBe(12);
    expect(h.value('L.D')).toBe(true);
  });

  it('khoảng tính khi run = true ở đầu khoảng và cả hai quét hợp lệ', () => {
    const h = make();
    h.set('RUN', true);
    h.runTo(0);
    h.runTo(1000);
    expect(h.value('L.H')).toBe(1000 / 3_600_000);
    h.set('RUN', { value: null, quality: 'BAD' });
    h.runTo(5000);
    h.set('RUN', true);
    h.runTo(5100);
    expect(h.value('L.H')).toBe(1000 / 3_600_000);
    h.runTo(5200);
    expect(h.value('L.H')).toBe(1100 / 3_600_000);
    // lần thấy đầu tiên (true) không đếm khởi động
    expect(h.value('L.S')).toBe(0);
  });

  it('reset: hours = 0, due = false, starts giữ', () => {
    const h = make({ serviceEveryHours: 0.0001 });
    h.set('RST', false);
    h.set('RUN', false);
    h.runTo(0);
    h.set('RUN', true);
    h.runTo(1000);
    expect([h.value('L.S'), h.value('L.D')]).toEqual([1, true]);
    h.set('RST', true);
    h.runTo(1100);
    expect([h.value('L.H'), h.value('L.S'), h.value('L.D')]).toEqual([0, 1, false]);
  });

  it('retain: hours, starts, lastRun; run vẫn true sau khởi động lại không đếm thêm', () => {
    const h = make({}, { 'logic/h/hours': 2, 'logic/h/starts': 7, 'logic/h/lastRun': true });
    h.set('RUN', true);
    h.runTo(0);
    expect([h.value('L.H'), h.value('L.S')]).toEqual([2, 7]);
    h.runTo(3_600_000);
    expect([h.value('L.H'), h.value('L.S')]).toEqual([3, 7]);
    expect(h.retainSnapshot()).toEqual({
      'logic/h/hours': 3,
      'logic/h/starts': 7,
      'logic/h/lastRun': true,
    });
  });
});
