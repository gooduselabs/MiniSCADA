// Thanh Thử giá trị: Tag chỉ đọc và thứ tự báo đổi (feature 008, T073 phần UI).
import { describe, expect, it } from 'vitest';
import type { TagV1 } from '@mat/project-schema';
import { SimEngine } from './sim-engine.ts';
import { TestStrip } from './test-strip.ts';

const tags = [
  {
    id: 'LVL',
    kind: 'external',
    access: 'R',
    type: 'FLOAT32',
    min: 0,
    max: 100,
  } as unknown as TagV1,
];
const rig = () => {
  const engine = new SimEngine();
  engine.load(tags, []);
  engine.tick();
  return { engine, strip: new TestStrip(engine) };
};

describe('TestStrip: Tag chỉ đọc và thứ tự báo đổi', () => {
  it('thử được Tag chỉ đọc (chỉ để xem cách hiển thị), vẫn không ghi được bằng write', () => {
    const { engine, strip } = rig();
    strip.enter('svg_a', ['LVL']);
    expect(engine.write('LVL', 5)).toEqual({ ok: false, reason: 'readonly' });
    expect(strip.set('LVL', 42)).toEqual({ ok: true });
    expect(engine.get('LVL')!.value).toBe(42);
    expect(strip.reset('LVL')).toBe(true);
    expect(engine.override('LVL')).toBeUndefined();
  });

  it('Tag đã nằm trong danh sách đang thử ngay khi engine báo đổi (nguồn của canvas đọc đúng)', () => {
    const { engine, strip } = rig();
    strip.enter('svg_a', ['LVL']);
    const seen: boolean[] = [];
    engine.subscribe(() => seen.push(strip.active.includes('LVL')));
    strip.set('LVL', 10);
    strip.reset('LVL');
    expect(seen[0]).toBe(true);
    expect(seen.at(-1)).toBe(false);
  });
});
