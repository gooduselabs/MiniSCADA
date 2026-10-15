// T088: test đỏ portSnap (FR-057; contract symbol-library §6). Viết TRƯỚC src/ports.ts.
import { describe, expect, it } from 'vitest';
import { portSnap } from '../src/index.ts';
import type { PortRef } from '../src/index.ts';

function port(
  itemId: string,
  portId: string,
  x: number,
  y: number,
  dir: PortRef['dir'],
  kind = 'pipe',
): PortRef {
  return { itemId, portId, x, y, dir, kind };
}

describe('portSnap: trùng khít và ngưỡng', () => {
  it('hai điểm đối hướng trùng khít: độ dời 0', () => {
    const r = portSnap([port('a', 'east', 100, 50, 'e')], [port('b', 'west', 100, 50, 'w')], 1);
    expect(r).not.toBeNull();
    expect(r!.dx).toBe(0);
    expect(r!.dy).toBe(0);
    expect(r!.pair[0].itemId).toBe('a');
    expect(r!.pair[1].itemId).toBe('b');
  });

  it('trong ngưỡng: trả độ dời để hai điểm trùng', () => {
    const r = portSnap([port('a', 'east', 100, 50, 'e')], [port('b', 'west', 106, 58, 'w')], 1);
    expect(r).toEqual({
      dx: 6,
      dy: 8,
      pair: [port('a', 'east', 100, 50, 'e'), port('b', 'west', 106, 58, 'w')],
    });
  });

  it('đúng 10 điểm ảnh thì dính (biên bao gồm), 10,01 thì không', () => {
    const m = [port('a', 'east', 0, 0, 'e')];
    expect(portSnap(m, [port('b', 'west', 10, 0, 'w')], 1)).not.toBeNull();
    expect(portSnap(m, [port('b', 'west', 10.01, 0, 'w')], 1)).toBeNull();
  });

  it('ngoài ngưỡng: null', () => {
    expect(
      portSnap([port('a', 'east', 0, 0, 'e')], [port('b', 'west', 30, 0, 'w')], 1),
    ).toBeNull();
  });

  it('thresholdPx tùy chọn', () => {
    const m = [port('a', 'east', 0, 0, 'e')];
    const f = [port('b', 'west', 30, 0, 'w')];
    expect(portSnap(m, f, 1, { thresholdPx: 40 })).not.toBeNull();
    expect(portSnap(m, [port('b', 'west', 6, 0, 'w')], 1, { thresholdPx: 5 })).toBeNull();
  });
});

describe('portSnap: zoom (khoảng cách đo bằng điểm ảnh màn hình)', () => {
  const m = [port('a', 'east', 0, 0, 'e')];
  const f = [port('b', 'west', 20, 0, 'w')];

  it('zoom 25 %: 20 đơn vị thiết kế = 5 điểm ảnh, dính; độ dời tính bằng đơn vị thiết kế', () => {
    const r = portSnap(m, f, 0.25);
    expect(r).not.toBeNull();
    expect(r!.dx).toBe(20);
  });

  it('zoom 400 %: 20 đơn vị = 80 điểm ảnh, không dính', () => {
    expect(portSnap(m, f, 4)).toBeNull();
  });

  it('zoom 400 %: 2 đơn vị = 8 điểm ảnh, dính', () => {
    expect(portSnap(m, [port('b', 'west', 2, 0, 'w')], 4)).not.toBeNull();
  });

  it('zoom 25 %: 40 đơn vị = 10 điểm ảnh dính, 41 thì không', () => {
    expect(portSnap(m, [port('b', 'west', 40, 0, 'w')], 0.25)).not.toBeNull();
    expect(portSnap(m, [port('b', 'west', 41, 0, 'w')], 0.25)).toBeNull();
  });
});

describe('portSnap: tương thích', () => {
  it('cùng hướng không dính (e với e)', () => {
    expect(portSnap([port('a', 'east', 0, 0, 'e')], [port('b', 'east', 0, 0, 'e')], 1)).toBeNull();
  });

  it('hướng vuông góc không dính (e với n)', () => {
    expect(portSnap([port('a', 'east', 0, 0, 'e')], [port('b', 'top', 0, 0, 'n')], 1)).toBeNull();
  });

  it('các cặp đối hướng w↔e và n↔s đều dính', () => {
    expect(portSnap([port('a', 'p', 0, 0, 'w')], [port('b', 'q', 0, 0, 'e')], 1)).not.toBeNull();
    expect(portSnap([port('a', 'p', 0, 0, 'n')], [port('b', 'q', 0, 0, 's')], 1)).not.toBeNull();
    expect(portSnap([port('a', 'p', 0, 0, 's')], [port('b', 'q', 0, 0, 'n')], 1)).not.toBeNull();
  });

  it('khác kind không dính', () => {
    expect(
      portSnap([port('a', 'p', 0, 0, 'e', 'pipe')], [port('b', 'q', 0, 0, 'w', 'cable')], 1),
    ).toBeNull();
  });
});

describe('portSnap: nhiều cặp', () => {
  it('chọn cặp gần nhất', () => {
    const moving = [port('a', 'east', 100, 50, 'e'), port('a', 'top', 50, 0, 'n')];
    const fixed = [
      port('b', 'west', 108, 50, 'w'),
      port('c', 'west', 103, 50, 'w'),
      port('d', 'bottom', 50, 9, 's'),
    ];
    const r = portSnap(moving, fixed, 1);
    expect(r!.pair[0].portId).toBe('east');
    expect(r!.pair[1].itemId).toBe('c');
    expect(r!.dx).toBe(3);
    expect(r!.dy).toBe(0);
  });

  it('cặp tương thích xa hơn không bị cặp không tương thích gần hơn che', () => {
    const moving = [port('a', 'east', 0, 0, 'e')];
    const fixed = [port('b', 'east', 1, 0, 'e'), port('c', 'west', 7, 0, 'w')];
    expect(portSnap(moving, fixed, 1)!.pair[1].itemId).toBe('c');
  });

  it('hòa khoảng cách: cặp đầu theo thứ tự id', () => {
    const moving = [port('a', 'east', 0, 0, 'e')];
    const fixed = [port('z', 'west', 5, 0, 'w'), port('b', 'west', -5, 0, 'w')];
    const r = portSnap(moving, fixed, 1);
    expect(r!.pair[1].itemId).toBe('b');
    expect(r!.dx).toBe(-5);
  });

  it('hòa: so tiếp theo portId rồi item cố định', () => {
    const moving = [port('a', 'p2', 0, 0, 'e'), port('a', 'p1', 0, 0, 'e')];
    const fixed = [port('b', 'west', 4, 0, 'w')];
    expect(portSnap(moving, fixed, 1)!.pair[0].portId).toBe('p1');
  });

  it('không đổi đầu vào', () => {
    const moving = [port('a', 'east', 100, 50, 'e')];
    const fixed = [port('b', 'west', 104, 50, 'w')];
    const before = JSON.stringify([moving, fixed]);
    portSnap(moving, fixed, 1);
    expect(JSON.stringify([moving, fixed])).toBe(before);
  });
});

describe('portSnap: biên', () => {
  it('danh sách rỗng: null', () => {
    expect(portSnap([], [], 1)).toBeNull();
    expect(portSnap([port('a', 'p', 0, 0, 'e')], [], 1)).toBeNull();
    expect(portSnap([], [port('a', 'p', 0, 0, 'e')], 1)).toBeNull();
  });

  it('Alt tắt dính: disabled trả null dù có cặp trùng khít', () => {
    const m = [port('a', 'east', 0, 0, 'e')];
    const f = [port('b', 'west', 0, 0, 'w')];
    expect(portSnap(m, f, 1, { disabled: true })).toBeNull();
    expect(portSnap(m, f, 1, { disabled: false })).not.toBeNull();
  });

  it('zoom không hợp lệ (0, âm, NaN): null', () => {
    const m = [port('a', 'east', 0, 0, 'e')];
    const f = [port('b', 'west', 0, 0, 'w')];
    expect(portSnap(m, f, 0)).toBeNull();
    expect(portSnap(m, f, -1)).toBeNull();
    expect(portSnap(m, f, Number.NaN)).toBeNull();
  });
});
