// Nguồn giá trị của canvas chỉnh sửa khi Thử giá trị (feature 008, T073).
import { describe, expect, it } from 'vitest';
import type { TagSource } from '@mat/ui-components';
import type { TagV1 } from '@mat/project-schema';
import { EditTestSource } from './edit-source.ts';
import { SimEngine } from './sim-engine.ts';
import { TestStrip } from './test-strip.ts';

const tags = [
  { id: 'A', kind: 'internal', access: 'RW', type: 'FLOAT32', initial: 1 },
  { id: 'B', kind: 'internal', access: 'RW', type: 'FLOAT32', initial: 2 },
] as unknown as TagV1[];

function rig() {
  const engine = new SimEngine();
  engine.load(tags, []);
  engine.tick();
  const strip = new TestStrip(engine);
  strip.enter('svg_1', ['A', 'B']);
  // Nguồn thông tin tối thiểu như MemoryTagSource của chế độ chỉnh sửa: có thông tin Tag, không có giá trị.
  const base: TagSource = {
    connection: 'live',
    info: (id) => ({ id, type: 'FLOAT32', kind: 'internal', access: 'RW' }),
    get: () => ({ value: null, quality: 'UNKNOWN' }),
    subscribe: () => () => undefined,
    now: () => 0,
    valueTable: () => undefined,
  };
  const src = new EditTestSource({
    base: () => base,
    engine,
    active: () => strip.active,
    tables: () => [],
  });
  return { engine, strip, src };
}

describe('EditTestSource', () => {
  it('Tag không đặt thử không có giá trị; Tag đang thử lấy giá trị từ SimEngine', () => {
    const { strip, src } = rig();
    expect(src.get('A')).toMatchObject({ value: null, quality: 'UNKNOWN' });
    strip.set('A', 42);
    expect(src.get('A')).toMatchObject({ value: 42, quality: 'GOOD' });
    expect(src.get('B').value).toBeNull();
    expect(src.info('A')?.type).toBe('FLOAT32');
  });

  it('báo đổi cho Tag đang thử ngay lúc đặt, và một lần khi hết thử; Tag khác im lặng', () => {
    const { strip, src, engine } = rig();
    const seen: string[][] = [];
    src.subscribe(['A', 'B'], (c) => seen.push([...c]));
    strip.set('A', 10);
    src.get('A');
    expect(seen.at(-1)).toEqual(['A']);
    const n = seen.length;
    engine.tick();
    engine.tick();
    // B đổi theo engine nhưng không đang thử: không báo.
    expect(seen.length).toBe(n);
    strip.reset('A');
    expect(seen.at(-1)).toEqual(['A']);
    expect(src.get('A').value).toBeNull();
    const m = seen.length;
    engine.tick();
    expect(seen.length).toBe(m);
  });
});
