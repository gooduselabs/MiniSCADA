// Timer ton/tof/tp (T126; FR-085; contracts/logic-engine.md §3): bảng chân trị, sai số ≤ 1 quét + 20 ms, đầu vào
// unknown giữ đầu ra và dừng đếm, pt nhỏ hơn scanMs làm tròn lên.
import { describe, expect, it } from 'vitest';
import { LogicHarness } from './harness.ts';
import type { LogicDoc } from '@mat/project-schema';

const TAGS = { IN: { type: 'BOOL', kind: 'external', access: 'R' } } as const;
const make = (kind: string, pt: number, scanMs = 100) =>
  new LogicHarness(
    {
      schemaVersion: '1.0.0',
      timers: [{ id: 't', kind, in: 'IN', pt, q: 'L.Q', et: 'L.ET' }],
    } satisfies LogicDoc,
    { tags: TAGS, config: { scanMs } },
  );
const qe = (h: LogicHarness) => [h.value('L.Q'), h.value('L.ET')];

describe('ton', () => {
  it('bảng chân trị: q sau pt liên tục, et dừng ở pt, in xuống đặt lại', () => {
    const h = make('ton', 500);
    h.set('IN', false);
    h.runTo(900);
    expect(qe(h)).toEqual([false, 0]);
    h.set('IN', true);
    h.runTo(1000);
    expect(qe(h)).toEqual([false, 0]);
    h.runTo(1400);
    expect(qe(h)).toEqual([false, 400]);
    h.runTo(1500);
    expect(qe(h)).toEqual([true, 500]);
    h.runTo(3000);
    expect(qe(h)).toEqual([true, 500]);
    h.set('IN', false);
    h.runTo(3100);
    expect(qe(h)).toEqual([false, 0]);
  });

  it('xung ngắn hơn pt không bật q', () => {
    const h = make('ton', 500);
    h.set('IN', true);
    h.runTo(400);
    h.set('IN', false);
    h.runTo(1000);
    expect(qe(h)).toEqual([false, 0]);
  });

  it('sai số ≤ 1 quét + 20 ms với pt không chia hết scanMs', () => {
    for (const pt of [101, 150, 250, 999, 1001, 4321]) {
      const h = make('ton', pt);
      h.set('IN', false);
      h.runTo(0);
      h.set('IN', true);
      let t = 100;
      h.runTo(t);
      while (h.value('L.Q') !== true) h.runTo((t += 100));
      expect(t - 100).toBeGreaterThanOrEqual(pt);
      expect(t - 100 - pt).toBeLessThanOrEqual(100 + 20);
    }
  });

  it('in unknown: giữ q và et, dừng đếm, degraded; tiếp tục khi in trở lại', () => {
    const h = make('ton', 1000);
    h.set('IN', true);
    h.runTo(500);
    expect(qe(h)).toEqual([false, 500]);
    h.set('IN', { value: null, quality: 'BAD' });
    h.runTo(5000);
    expect(qe(h)).toEqual([false, 500]);
    expect(h.state('t').degraded).toBe(true);
    h.set('IN', true);
    h.runTo(5100);
    expect(h.state('t').degraded).toBe(false);
    expect(qe(h)).toEqual([false, 500]);
    h.runTo(5600);
    expect(qe(h)).toEqual([true, 1000]);
  });

  it('pt < scanMs làm tròn lên scanMs', () => {
    const h = make('ton', 30, 100);
    h.set('IN', true);
    h.runTo(0);
    expect(qe(h)).toEqual([false, 0]);
    h.runTo(100);
    expect(qe(h)).toEqual([true, 100]);
  });

  it('trước lần quét đầu: q = false, et = 0, quality GOOD', () => {
    const h = make('ton', 500);
    expect(h.output('L.Q')).toEqual({ value: false, quality: 'GOOD' });
    expect(h.output('L.ET')).toEqual({ value: 0, quality: 'GOOD' });
  });
});

describe('tof', () => {
  it('bảng chân trị: q giữ pt sau cạnh xuống; lên lại trước hạn thì hủy', () => {
    const h = make('tof', 500);
    h.set('IN', false);
    h.runTo(0);
    expect(qe(h)).toEqual([false, 0]);
    h.set('IN', true);
    h.runTo(1000);
    expect(qe(h)).toEqual([true, 0]);
    h.set('IN', false);
    h.runTo(1100);
    expect(qe(h)).toEqual([true, 0]);
    h.runTo(1400);
    expect(qe(h)).toEqual([true, 300]);
    h.set('IN', true);
    h.runTo(1500);
    expect(qe(h)).toEqual([true, 0]);
    h.set('IN', false);
    h.runTo(1600);
    h.runTo(2000);
    expect(qe(h)).toEqual([true, 400]);
    h.runTo(2100);
    expect(qe(h)).toEqual([false, 500]);
    h.runTo(5000);
    expect(qe(h)).toEqual([false, 500]);
  });
});

describe('tp', () => {
  it('cạnh lên: q đúng pt bất kể in, không kích lại khi đang chạy', () => {
    const h = make('tp', 500);
    h.set('IN', false);
    h.runTo(0);
    h.set('IN', true);
    h.runTo(100);
    expect(qe(h)).toEqual([true, 0]);
    h.set('IN', false);
    h.runTo(200);
    h.set('IN', true);
    h.runTo(300);
    expect(qe(h)).toEqual([true, 200]);
    h.runTo(500);
    expect(qe(h)).toEqual([true, 400]);
    h.runTo(600);
    expect(qe(h)).toEqual([false, 500]);
    // in vẫn true: et giữ pt, không xung mới
    h.runTo(1000);
    expect(qe(h)).toEqual([false, 500]);
    h.set('IN', false);
    h.runTo(1100);
    expect(qe(h)).toEqual([false, 0]);
    h.set('IN', true);
    h.runTo(1200);
    expect(qe(h)).toEqual([true, 0]);
  });

  it('in true ở lần quét đầu là cạnh lên (in ban đầu coi là false như PLC)', () => {
    const h = make('tp', 300);
    h.set('IN', true);
    h.runTo(0);
    expect(qe(h)).toEqual([true, 0]);
    h.runTo(300);
    expect(qe(h)).toEqual([false, 300]);
  });
});
