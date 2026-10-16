// Dính điểm gắn trong bắt dính (feature 008, T090; contract symbol-library §6): điểm gắn thắng lưới và đường gióng; Alt tắt.
import type { PortRef } from '@mat/symbols';
import { describe, expect, it } from 'vitest';
import { snapBoxWithPorts, type SnapOptions } from './snap.ts';

const opts = (over: Partial<SnapOptions> = {}): SnapOptions => ({
  grid: 30,
  zoom: 1,
  snap: true,
  alt: false,
  others: [],
  screen: { width: 1280, height: 720 },
  ...over,
});
const fixed: PortRef[] = [{ itemId: 'a', portId: 'east', x: 205, y: 117, dir: 'e', kind: 'pipe' }];
const moving: PortRef[] = [{ itemId: 'b', portId: 'west', x: 0, y: 10, dir: 'w', kind: 'pipe' }];
const box = { x: 212, y: 110, width: 100, height: 20 };

describe('snapBoxWithPorts', () => {
  it('điểm gắn trong ngưỡng thắng lưới: hai điểm trùng', () => {
    const r = snapBoxWithPorts(box, opts(), { moving, fixed });
    expect([r.x, r.y]).toEqual([205, 107]);
    expect(r.snapX).toBe('port');
    expect(r.port?.pair[1].portId).toBe('east');
    expect(r.guides).toEqual([]);
  });

  it('Alt hoặc tắt bắt dính: rơi về kết quả của snapBox', () => {
    for (const o of [opts({ alt: true }), opts({ snap: false })]) {
      const r = snapBoxWithPorts(box, o, { moving, fixed });
      expect(r.port).toBeUndefined();
      expect(r.snapX).not.toBe('port');
    }
  });

  it('ngoài ngưỡng hoặc cùng hướng: không dính, lưới vẫn chạy', () => {
    const far = snapBoxWithPorts({ ...box, x: 400 }, opts(), { moving, fixed });
    expect(far.port).toBeUndefined();
    expect(far.x).toBe(390);
    const same = snapBoxWithPorts(box, opts(), {
      moving: [{ ...moving[0]!, dir: 'e' }],
      fixed,
    });
    expect(same.port).toBeUndefined();
  });

  it('không có điểm gắn: giống snapBox', () => {
    const r = snapBoxWithPorts(box, opts(), { moving: [], fixed });
    expect(r.port).toBeUndefined();
    expect(r.x).toBe(210);
  });
});
