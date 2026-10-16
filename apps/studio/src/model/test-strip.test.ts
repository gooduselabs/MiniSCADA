// Thanh Thử giá trị, phần model (feature 008, T073; D28).
import { describe, expect, it } from 'vitest';
import type { TagV1 } from '@mat/project-schema';
import { SimEngine } from './sim-engine.ts';
import { TestStrip, controlFor } from './test-strip.ts';
import type { TagInfo } from './screen-catalog.ts';

const tags: TagV1[] = [
  { id: 'LEVEL', kind: 'internal', access: 'RW', type: 'FLOAT32', initial: 10 } as unknown as TagV1,
  { id: 'RUN', kind: 'internal', access: 'RW', type: 'BOOL', initial: false } as unknown as TagV1,
  { id: 'OTHER', kind: 'internal', access: 'RW', type: 'FLOAT32', initial: 1 } as unknown as TagV1,
  { id: 'CALC', kind: 'calculated', type: 'FLOAT32', expression: 'LEVEL * 2' } as unknown as TagV1,
];
const rig = () => {
  const engine = new SimEngine();
  engine.load(tags, []);
  engine.tick();
  return { engine, strip: new TestStrip(engine) };
};

describe('TestStrip', () => {
  it('chưa vào item thì không đặt được; Tag ngoài item bị từ chối', () => {
    const { engine, strip } = rig();
    expect(strip.set('LEVEL', 50)).toEqual({ ok: false, reason: 'not-entered' });
    strip.enter('svg_bon', ['LEVEL', 'RUN']);
    expect(strip.set('OTHER', 5)).toEqual({ ok: false, reason: 'not-in-item' });
    expect(engine.get('OTHER')!.value).toBe(1);
  });

  it('đặt giá trị trong SimEngine; Đặt lại khôi phục giá trị mô phỏng; không đặt được Tag tính toán', () => {
    const { engine, strip } = rig();
    strip.enter('svg_bon', ['LEVEL', 'CALC']);
    expect(strip.set('LEVEL', 77)).toEqual({ ok: true });
    expect(engine.get('LEVEL')!.value).toBe(77);
    expect(engine.get('CALC')!.value).toBe(154);
    expect(strip.active).toEqual(['LEVEL']);
    expect(strip.set('CALC', 1)).toEqual({ ok: false, reason: 'calculated' });
    expect(strip.reset('LEVEL')).toBe(true);
    expect(engine.get('LEVEL')!.value).toBe(10);
    expect(engine.override('LEVEL')).toBeUndefined();
    expect(strip.reset('LEVEL')).toBe(false);
  });

  it('khôi phục giá trị ghi tay cũ (không phải giá trị cấu hình)', () => {
    const { engine, strip } = rig();
    engine.write('LEVEL', 33);
    strip.enter('svg_bon', ['LEVEL']);
    strip.set('LEVEL', 60);
    strip.set('LEVEL', 70);
    expect(engine.get('LEVEL')!.value).toBe(70);
    strip.reset('LEVEL');
    expect(engine.get('LEVEL')!.value).toBe(33);
  });

  it('thoát item hoặc đổi item khôi phục hết', () => {
    const { engine, strip } = rig();
    strip.enter('svg_bon', ['LEVEL', 'RUN']);
    strip.set('LEVEL', 99);
    strip.set('RUN', true);
    strip.enter('svg_khac', ['LEVEL']);
    expect(engine.get('LEVEL')!.value).toBe(10);
    expect(engine.get('RUN')!.value).toBe(false);
    strip.set('LEVEL', 5);
    strip.exit();
    expect(engine.get('LEVEL')!.value).toBe(10);
    expect(strip.set('LEVEL', 5)).toEqual({ ok: false, reason: 'not-entered' });
  });

  it('chỉ dùng SimEngine: không có đường tới phiên Online hay luồng ghi thiết bị', () => {
    const calls: string[] = [];
    const engine = {
      probe: (id: string) => (calls.push(`write:${id}`), { ok: true as const }),
      override: () => undefined,
      clearOverride: (id: string) => (calls.push(`clear:${id}`), true),
    };
    const strip = new TestStrip(engine);
    strip.enter('i', ['A']);
    strip.set('A', 1);
    strip.exit();
    expect(calls).toEqual(['write:A', 'clear:A']);
  });
});

describe('controlFor', () => {
  const t = (type: string, extra: Partial<TagInfo> = {}): TagInfo => ({
    id: 'X',
    type,
    access: 'R',
    kind: 'internal',
    ...extra,
  });
  it('BOOL công tắc; số thanh trượt theo min-max hoặc range của binding; bảng giá trị danh sách chọn; chuỗi ô chữ', () => {
    expect(controlFor(t('BOOL'))).toEqual({ kind: 'switch' });
    expect(controlFor(t('INT16', { min: 0, max: 200 }))).toEqual({
      kind: 'slider',
      min: 0,
      max: 200,
      step: 1,
    });
    expect(controlFor(t('FLOAT32', { min: 0, max: 1 }))).toEqual({
      kind: 'slider',
      min: 0,
      max: 1,
      step: 0.01,
    });
    expect(controlFor(t('FLOAT32'), { range: [10, 20] })).toMatchObject({ min: 10, max: 20 });
    const entries = [
      { value: 0, text: 'Dừng' },
      { value: 1, text: 'Chạy' },
    ];
    expect(controlFor(t('UINT16'), { entries })).toEqual({ kind: 'select', options: entries });
    expect(controlFor(t('STRING'))).toEqual({ kind: 'text' });
  });
});
