// Trạng thái "vào item svg" của máy cử chỉ (feature 008, T065/T069; contract studio-svg-editor §10).
import { describe, expect, it } from 'vitest';
import type { Item, ScreenModel } from '@mat/project-schema';
import { createGesture, type GestureEvent, type GestureOutput, type Modifiers } from './gesture.ts';
import { catalogMinSizeOf } from './resize.ts';

const NONE: Modifiers = { shift: false, alt: false, ctrl: false, space: false };
const svg = (id: string, x: number, y: number): Item =>
  ({
    id,
    type: 'svg',
    x,
    y,
    width: 200,
    height: 200,
    svgFile: 'graphics/a.svg',
    bindingFile: `screens/m.${id}.bindings.json`,
    viewBox: [0, 0, 100, 100],
    elements: [],
  }) as Item;
const btn: Item = {
  id: 'button_1',
  type: 'widget',
  widget: 'button',
  x: 600,
  y: 100,
  width: 100,
  height: 40,
} as Item;
const doc = (): ScreenModel => ({
  schemaVersion: '0.4.0',
  id: 'm',
  name: 'M',
  kind: 'screen',
  size: { width: 1000, height: 700 },
  items: [svg('svg_a', 100, 100), btn],
});

function rig(sel: string[] = []) {
  const st = { sel, entered: null as string | null };
  const g = createGesture({
    getDoc: doc,
    getSelection: () => st.sel,
    getViewport: () => ({ zoom: 1, panX: 0, panY: 0 }),
    getGrid: () => ({ size: 10, snap: false }),
    minSizeOf: catalogMinSizeOf,
    getEntered: () => st.entered,
  });
  const send = (e: GestureEvent): GestureOutput[] => {
    const out = g.handle(e);
    for (const o of out) {
      if (o.kind === 'select') st.sel = o.ids;
      if (o.kind === 'enter') st.entered = o.itemId;
      if (o.kind === 'exit') st.entered = null;
    }
    return out;
  };
  const down = (x: number, y: number, mods: Partial<Modifiers> = {}) =>
    send({
      type: 'down',
      point: { x, y },
      screen: { x, y },
      button: 0,
      mods: { ...NONE, ...mods },
    });
  return { st, g, send, down };
}

describe('vào item', () => {
  it('nhấp đúp trên item svg: chọn và vào', () => {
    const t = rig();
    expect(t.send({ type: 'dblclick', point: { x: 150, y: 150 }, mods: NONE })).toEqual([
      { kind: 'select', ids: ['svg_a'] },
      { kind: 'enter', itemId: 'svg_a' },
    ]);
    expect(t.st.entered).toBe('svg_a');
  });

  it('nhấp đúp trên widget hoặc chỗ trống không vào', () => {
    const t = rig();
    expect(t.send({ type: 'dblclick', point: { x: 620, y: 110 }, mods: NONE })).toEqual([]);
    expect(t.send({ type: 'dblclick', point: { x: 900, y: 600 }, mods: NONE })).toEqual([]);
  });

  it('Enter vào khi chọn đúng một item svg; không vào với widget hoặc nhiều item', () => {
    expect(rig(['svg_a']).send({ type: 'key', key: 'Enter', mods: NONE })).toEqual([
      { kind: 'enter', itemId: 'svg_a' },
    ]);
    expect(rig(['button_1']).send({ type: 'key', key: 'Enter', mods: NONE })).toEqual([]);
    expect(rig(['svg_a', 'button_1']).send({ type: 'key', key: 'Enter', mods: NONE })).toEqual([]);
    expect(rig([]).send({ type: 'key', key: 'Enter', mods: NONE })).toEqual([]);
  });
});

describe('đang vào item', () => {
  const entered = () => {
    const t = rig(['svg_a']);
    t.send({ type: 'key', key: 'Enter', mods: NONE });
    return t;
  };

  it('nhấp trong item phát pick (không chọn lại, không kéo)', () => {
    const t = entered();
    const out = t.down(150, 150, { alt: true });
    expect(out).toEqual([
      { kind: 'pick', itemId: 'svg_a', point: { x: 150, y: 150 }, mods: { ...NONE, alt: true } },
    ]);
    expect(
      t.send({ type: 'move', point: { x: 170, y: 170 }, screen: { x: 170, y: 170 }, mods: NONE }),
    ).toEqual([]);
    expect(
      t.send({ type: 'up', point: { x: 170, y: 170 }, screen: { x: 170, y: 170 }, mods: NONE }),
    ).toEqual([]);
    expect(t.st.entered).toBe('svg_a');
  });

  it('nhấp ngoài item thoát rồi xử lý như nhấp thường (chọn widget)', () => {
    const t = entered();
    const out = t.down(620, 110);
    expect(out[0]).toEqual({ kind: 'exit' });
    expect(out).toContainEqual({ kind: 'select', ids: ['button_1'] });
    expect(t.st.entered).toBeNull();
  });

  it('Esc thoát item, không bỏ chọn item', () => {
    const t = entered();
    expect(t.send({ type: 'key', key: 'Escape', mods: NONE })).toEqual([{ kind: 'exit' }]);
    expect(t.st.sel).toEqual(['svg_a']);
    expect(t.send({ type: 'key', key: 'Escape', mods: NONE })).toEqual([
      { kind: 'select', ids: [] },
    ]);
  });

  it('nhấp đúp khi đang vào không đổi gì; kéo giữa (pan) vẫn dùng được', () => {
    const t = entered();
    expect(t.send({ type: 'dblclick', point: { x: 150, y: 150 }, mods: NONE })).toEqual([]);
    const out = t.send({
      type: 'down',
      point: { x: 150, y: 150 },
      screen: { x: 150, y: 150 },
      button: 1,
      mods: NONE,
    });
    expect(out).toContainEqual({ kind: 'cursor', cursor: 'grabbing' });
  });
});
