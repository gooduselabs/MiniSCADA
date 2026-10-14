import { describe, expect, it } from 'vitest';
import { clipRect } from './clip-level.ts';

const b = { x: 10, y: 20, width: 100, height: 200 };

describe('clipRect', () => {
  it('up ở 0, 50, 100 %', () => {
    expect(clipRect(b, 'up', 0)).toEqual({ x: 10, y: 220, width: 100, height: 0 });
    expect(clipRect(b, 'up', 50)).toEqual({ x: 10, y: 120, width: 100, height: 100 });
    expect(clipRect(b, 'up', 100)).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });
  it('down', () => {
    expect(clipRect(b, 'down', 0)).toEqual({ x: 10, y: 20, width: 100, height: 0 });
    expect(clipRect(b, 'down', 50)).toEqual({ x: 10, y: 20, width: 100, height: 100 });
    expect(clipRect(b, 'down', 100)).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });
  it('right', () => {
    expect(clipRect(b, 'right', 0)).toEqual({ x: 10, y: 20, width: 0, height: 200 });
    expect(clipRect(b, 'right', 50)).toEqual({ x: 10, y: 20, width: 50, height: 200 });
    expect(clipRect(b, 'right', 100)).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });
  it('left', () => {
    expect(clipRect(b, 'left', 0)).toEqual({ x: 110, y: 20, width: 0, height: 200 });
    expect(clipRect(b, 'left', 50)).toEqual({ x: 60, y: 20, width: 50, height: 200 });
    expect(clipRect(b, 'left', 100)).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });
  it('làm tròn 2 chữ số; kẹp ngoài [0, 100]', () => {
    expect(clipRect({ x: 0, y: 0, width: 10, height: 10 }, 'up', 33.333)).toEqual({
      x: 0,
      y: 6.67,
      width: 10,
      height: 3.33,
    });
    expect(clipRect(b, 'up', 150).height).toBe(200);
    expect(clipRect(b, 'up', -5).height).toBe(0);
  });
});
