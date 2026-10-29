// Thử luật trên thẻ (feature 043): chạy một luật bằng LogicSim với giá trị giả và giờ giả lập.
import { describe, expect, it } from 'vitest';
import type { LogicDoc, TagV1 } from '@mat/project-schema';
import { tryRule } from './logic-card-try.ts';

const TAGS = [
  { id: 'TEMP', kind: 'external', type: 'FLOAT32', source: { device: 'p', address: 'HR1' } },
  {
    id: 'FAN',
    kind: 'external',
    type: 'BOOL',
    access: 'RW',
    source: { device: 'p', address: 'C1' },
  },
  { id: 'FLAG', kind: 'internal', type: 'BOOL', access: 'RW', initial: false },
] as unknown as TagV1[];

const DOC: LogicDoc = {
  schemaVersion: '1.0.0',
  writes: [
    {
      id: 'w',
      tag: 'FAN',
      allowed: { values: [true, false] },
      minIntervalMs: 1000,
      maxPerHour: 60,
    },
  ],
  rules: [
    {
      id: 'hot',
      when: 'TEMP > 80',
      hold: 5000,
      onRise: [{ do: 'write', write: 'w', value: true }],
    },
    { id: 'seven', when: 'LOGIC.S_1.Q', onRise: [{ do: 'setTag', tag: 'FLAG', value: true }] },
  ],
  schedules: [
    {
      id: 's_1',
      weekly: [{ days: [1, 2, 3, 4, 5], from: '07:00', to: '07:01' }],
      out: 'LOGIC.S_1.Q',
    },
  ],
};

describe('tryRule', () => {
  it('vượt ngưỡng liên tục 5 s thì ghi', () => {
    const r = tryRule(DOC, 'hot', TAGS, { values: { TEMP: 90 }, day: 1, time: '10:00' });
    expect(r.error).toBeNull();
    expect(r.fired).toBe(true);
    expect(r.actions[0]).toMatchObject({ do: 'write', tag: 'FAN', value: true, result: 'QUEUED' });
    expect(r.ranMs).toBeGreaterThanOrEqual(5000);
    expect(tryRule(DOC, 'hot', TAGS, { values: { TEMP: 50 }, day: 1, time: '10:00' }).fired).toBe(
      false,
    );
  });
  it('theo giờ: 07:00 thứ Hai kích, Chủ nhật hay 08:00 thì không', () => {
    expect(tryRule(DOC, 'seven', TAGS, { values: {}, day: 1, time: '07:00' }).fired).toBe(true);
    expect(tryRule(DOC, 'seven', TAGS, { values: {}, day: 7, time: '07:00' }).fired).toBe(false);
    expect(tryRule(DOC, 'seven', TAGS, { values: {}, day: 1, time: '08:00' }).fired).toBe(false);
  });
});
