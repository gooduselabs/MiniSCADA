// Counter (T126; FR-086; contracts/logic-engine.md §4): 10.000 cạnh sai 0, down không âm, reset bỏ cạnh up cùng
// quét, unknown không tạo cạnh, tràn dừng ở INT64 max không quay vòng.
import { describe, expect, it } from 'vitest';
import { LogicHarness } from './harness.ts';
import type { LogicCounter } from '@mat/project-schema';

const B = { type: 'BOOL', kind: 'external', access: 'R' } as const;
const TAGS = { UP: B, DOWN: B, RST: B };
const make = (o: Partial<LogicCounter> = {}, retain?: Record<string, number | boolean | string>) =>
  new LogicHarness(
    {
      schemaVersion: '1.0.0',
      counters: [
        {
          id: 'c',
          up: 'UP',
          down: 'DOWN',
          reset: 'RST',
          preset: 5,
          value: 'L.V',
          reached: 'L.R',
          ...o,
        },
      ],
    },
    { tags: TAGS, ...(retain ? { retain } : {}) },
  );
const MAX = 9223372036854775807n;

describe('counter', () => {
  it('10.000 cạnh lên: đếm đúng 10.000, reached từ preset', () => {
    const h = make({ preset: 10000, down: null, reset: null });
    let t = 0;
    for (let i = 0; i < 10000; i++) {
      h.set('UP', false);
      h.runTo(t);
      t += 100;
      h.set('UP', true);
      h.runTo(t);
      t += 100;
      if (i === 9998) expect(h.value('L.R')).toBe(false);
    }
    expect(h.value('L.V')).toBe(10000n);
    expect(h.value('L.R')).toBe(true);
  });

  it('down giảm 1 và dừng ở 0; up và down cùng quét bù nhau', () => {
    const h = make();
    h.set('UP', false);
    h.set('DOWN', false);
    h.set('RST', false);
    h.runTo(0);
    h.set('DOWN', true);
    h.runTo(100);
    expect(h.value('L.V')).toBe(0n);
    h.set('UP', true);
    h.set('DOWN', false);
    h.runTo(200);
    expect(h.value('L.V')).toBe(1n);
    h.set('UP', false);
    h.runTo(300);
    h.set('UP', true);
    h.set('DOWN', true);
    h.runTo(400);
    expect(h.value('L.V')).toBe(1n);
  });

  it('reset: cạnh lên đặt 0 và reached = false; cạnh up cùng quét bị bỏ', () => {
    const h = make({ preset: 2 });
    h.set('UP', false);
    h.set('DOWN', false);
    h.set('RST', false);
    h.runTo(0);
    for (let i = 0; i < 3; i++) {
      h.set('UP', true);
      h.runTo(100 + i * 200);
      h.set('UP', false);
      h.runTo(200 + i * 200);
    }
    expect([h.value('L.V'), h.value('L.R')]).toEqual([3n, true]);
    h.set('UP', true);
    h.set('RST', true);
    h.runTo(800);
    expect([h.value('L.V'), h.value('L.R')]).toEqual([0n, false]);
    // reset vẫn true: không phải cạnh; up vẫn true: không phải cạnh
    h.runTo(900);
    expect(h.value('L.V')).toBe(0n);
  });

  it('lần thấy hợp lệ đầu tiên không phải cạnh; unknown không cập nhật mốc trước', () => {
    const h = make({ down: null, reset: null });
    h.set('UP', true);
    h.runTo(0);
    expect(h.value('L.V')).toBe(0n);
    h.set('UP', false);
    h.runTo(100);
    h.set('UP', { value: null, quality: 'BAD' });
    h.runTo(200);
    h.set('UP', true);
    h.runTo(300);
    expect(h.value('L.V')).toBe(1n);
    // true → BAD → true: không cạnh
    h.set('UP', { value: true, quality: 'BAD' });
    h.runTo(400);
    h.set('UP', true);
    h.runTo(500);
    expect(h.value('L.V')).toBe(1n);
  });

  it('tràn: dừng ở 9223372036854775807, overflow = true, không quay vòng', () => {
    const h = make({ down: null, reset: null }, { 'logic/c/value': '9223372036854775805' });
    h.set('UP', false);
    h.runTo(0);
    for (let i = 0; i < 4; i++) {
      h.set('UP', true);
      h.runTo(100 + i * 200);
      h.set('UP', false);
      h.runTo(200 + i * 200);
    }
    expect(h.value('L.V')).toBe(MAX);
    expect(h.state('c').overflow).toBe(true);
    expect(h.retainSnapshot()['logic/c/value']).toBe('9223372036854775807');
    expect(h.retainSnapshot()['logic/c/overflow']).toBe(true);
  });

  it('retain: false không lưu', () => {
    const h = make({ retain: false });
    expect(Object.keys(h.retainSnapshot())).toEqual([]);
  });
});
