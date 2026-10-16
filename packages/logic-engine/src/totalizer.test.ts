// Totalizer (T126; FR-087; contracts/logic-engine.md §5): hình thang, dòng hằng 1 giờ ≤ 0,1 %, cutoff, maxGapMs và
// gapSeconds, rolloverAt, reset; số học double theo thứ tự cố định (không FMA) nên kết quả trùng từng bit với công
// thức tham chiếu.
import { describe, expect, it } from 'vitest';
import { LogicEngine } from './engine.ts';
import { LogicHarness } from './harness.ts';
import type { LogicTotalizer } from '@mat/project-schema';

const TAGS = {
  FLOW: { type: 'FLOAT64', kind: 'external', access: 'R' },
  RST: { type: 'BOOL', kind: 'external', access: 'R' },
} as const;
const doc = (o: Partial<LogicTotalizer> = {}) => ({
  schemaVersion: '1.0.0',
  totalizers: [
    {
      id: 'z',
      source: 'FLOW',
      rateUnit: 'h',
      maxGapMs: 5000,
      total: 'L.TOTAL',
      gapSeconds: 'L.GAP',
      ...o,
    },
  ],
});
const make = (o: Partial<LogicTotalizer> = {}) => new LogicHarness(doc(o), { tags: TAGS });

/** Công thức tham chiếu của contract §5, đúng thứ tự phép toán. */
const inc = (factor: number, a: number, b: number, dtMs: number, unit: number) =>
  (factor * ((a + b) / 2) * (dtMs / 1000)) / unit;

describe('totalizer', () => {
  it('dòng hằng 36 m³/h trong 1 giờ, quét 100 ms: sai số ≤ 0,1 %', () => {
    const h = make();
    h.set('FLOW', 36);
    h.runTo(3_600_000);
    const total = h.value('L.TOTAL') as number;
    expect(Math.abs(total - 36) / 36).toBeLessThanOrEqual(0.001);
    let ref = 0;
    for (let k = 1; k <= 36000; k++) ref = ref + inc(1, 36, 36, 100, 3600);
    expect(total).toBe(ref);
  });

  it('dòng dốc tuyến tính: hình thang đúng (trùng bit với tham chiếu)', () => {
    const h = make({ rateUnit: 's', factor: 0.5 });
    let ref = 0;
    let prev = 0;
    for (let k = 0; k <= 600; k++) {
      const r = k * 0.1;
      h.set('FLOW', r);
      h.runTo(k * 100);
      if (k > 0) ref = ref + inc(0.5, prev, r, 100, 1);
      prev = r;
    }
    expect(h.value('L.TOTAL')).toBe(ref);
    // tích phân 0,5 · ∫₀⁶⁰ 0,1·t/0,1 … = 0,5 · 60²/2 · 0,1/0,1 · 0,1: kiểm gần đúng
    expect(
      Math.abs((h.value('L.TOTAL') as number) - 0.5 * ((60 * 60) / 2) * 0.1 * 10),
    ).toBeLessThan(1e-6);
  });

  it('cutoff: tốc độ dưới ngưỡng coi là 0 ở cả hai đầu', () => {
    const h = make({ rateUnit: 's', cutoff: 1 });
    h.set('FLOW', 0.5);
    h.runTo(1000);
    expect(h.value('L.TOTAL')).toBe(0);
    h.set('FLOW', 2);
    h.runTo(1100);
    expect(h.value('L.TOTAL')).toBe(inc(1, 0, 2, 100, 1));
  });

  it('source BAD: không cộng, gapSeconds cộng các khoảng có đầu mút unknown', () => {
    const h = make({ rateUnit: 's' });
    h.set('FLOW', 10);
    h.runTo(1000);
    const before = h.value('L.TOTAL') as number;
    expect(before).toBe(10 * 1);
    h.set('FLOW', { value: null, quality: 'BAD' });
    h.runTo(2000);
    h.set('FLOW', 10);
    h.runTo(2100);
    expect(h.value('L.TOTAL')).toBe(before);
    expect(h.value('L.GAP')).toBe(1.1);
    h.runTo(2200);
    expect(h.value('L.TOTAL')).toBe(before + 1);
  });

  it('dt > maxGapMs: không cộng, tính vào gapSeconds', () => {
    const e = new LogicEngine(doc({ rateUnit: 's', maxGapMs: 5000 }), { tags: TAGS });
    const read = () => ({ value: 4, quality: 'GOOD' as const });
    e.step(0, read);
    e.step(5000, read);
    expect(e.output('L.TOTAL')!.value).toBe(20);
    e.step(10001, read);
    expect(e.output('L.TOTAL')!.value).toBe(20);
    expect(e.output('L.GAP')!.value).toBe(5.001);
  });

  it('rolloverAt: total ≥ rolloverAt thì trừ rolloverAt', () => {
    const h = make({ rateUnit: 's', rolloverAt: 100 });
    h.set('FLOW', 30);
    h.runTo(3000);
    expect(h.value('L.TOTAL')).toBeCloseTo(90, 9);
    h.runTo(3400);
    expect(h.value('L.TOTAL')).toBeCloseTo(2, 9);
  });

  it('reset: cạnh lên đặt total = 0 và gapSeconds = 0', () => {
    const h = make({ rateUnit: 's', reset: 'RST' });
    h.set('RST', false);
    h.set('FLOW', 1);
    h.runTo(1000);
    expect(h.value('L.TOTAL')).toBeCloseTo(1, 9);
    h.set('RST', true);
    h.runTo(1100);
    expect(h.value('L.TOTAL')).toBe(0);
    h.runTo(1200);
    expect(h.value('L.TOTAL')).toBe(0.1);
  });

  it('retain: total và gapSeconds khôi phục', () => {
    const h = new LogicHarness(doc({ rateUnit: 's' }), {
      tags: TAGS,
      retain: { 'logic/z/total': 12.5, 'logic/z/gapSeconds': 3 },
    });
    h.set('FLOW', 10);
    h.runTo(1000);
    expect(h.value('L.TOTAL')).toBe(22.5);
    expect(h.value('L.GAP')).toBe(3);
    expect(h.retainSnapshot()).toEqual({ 'logic/z/total': 22.5, 'logic/z/gapSeconds': 3 });
  });
});
