// Máy trạng thái cử chỉ của canvas Màn hình (feature 007, T104; contract §3). Bảng ca chuỗi sự kiện.
import { describe, expect, it } from 'vitest';
import type { Item, ScreenModel } from '@mat/project-schema';
import {
  createGesture,
  cursorOfHandle,
  type GestureEvent,
  type GestureOutput,
  type Modifiers,
} from './gesture.ts';
import { catalogMinSizeOf, type Handle } from './resize.ts';

const NONE: Modifiers = { shift: false, alt: false, ctrl: false, space: false };
const w = (
  id: string,
  widget: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<Item> = {},
): Item => ({ id, type: 'widget', widget, x, y, width, height, ...extra }) as Item;

const baseDoc = (): ScreenModel => ({
  schemaVersion: '0.3.0',
  id: 'main',
  name: 'Chính',
  kind: 'screen',
  size: { width: 1280, height: 720 },
  items: [
    w('card_1', 'card', 100, 100, 220, 110),
    w('button_1', 'button', 400, 100, 160, 48),
    w('panel_1', 'panel', 0, 300, 400, 100, { locked: true }),
  ],
});

/** Giả lập Studio: áp `select` và `commit` như UI thật rồi đưa kết quả cho test. */
function rig(opts: { sel?: string[]; zoom?: number; snap?: boolean; doc?: ScreenModel } = {}) {
  const zoom = opts.zoom ?? 1;
  const st = {
    doc: opts.doc ?? baseDoc(),
    sel: opts.sel ?? ['card_1'],
    vp: { zoom, panX: 0, panY: 0 },
  };
  const g = createGesture({
    getDoc: () => st.doc,
    getSelection: () => st.sel,
    getViewport: () => st.vp,
    getGrid: () => ({ size: 10, snap: opts.snap ?? true }),
    minSizeOf: catalogMinSizeOf,
  });
  const all: GestureOutput[] = [];
  const send = (e: GestureEvent): GestureOutput[] => {
    const out = g.handle(e);
    for (const o of out) {
      if (o.kind === 'select') st.sel = o.ids;
      if (o.kind === 'commit') st.doc = o.doc;
      if (o.kind === 'viewport') st.vp = o.viewport;
    }
    all.push(...out);
    return out;
  };
  const at = (x: number, y: number) => ({ point: { x, y }, screen: { x: x * zoom, y: y * zoom } });
  const m = (mods: Partial<Modifiers> = {}) => ({ ...NONE, ...mods });
  return {
    g,
    st,
    all,
    down: (
      x: number,
      y: number,
      mods: Partial<Modifiers> = {},
      extra: { handle?: Handle; button?: 0 | 1 | 2 } = {},
    ) => send({ type: 'down', ...at(x, y), button: 0, mods: m(mods), ...extra }),
    move: (x: number, y: number, mods: Partial<Modifiers> = {}) =>
      send({ type: 'move', ...at(x, y), mods: m(mods) }),
    up: (x: number, y: number, mods: Partial<Modifiers> = {}) =>
      send({ type: 'up', ...at(x, y), mods: m(mods) }),
    key: (key: string) => send({ type: 'key', key, mods: m() }),
    send,
    of: <K extends GestureOutput['kind']>(out: GestureOutput[], kind: K) =>
      out.filter((o): o is Extract<GestureOutput, { kind: K }> => o.kind === kind),
  };
}
const item = (d: ScreenModel, id: string) => d.items.find((i) => i.id === id)!;

describe('nhấp (idle)', () => {
  it('nhấp trống bỏ chọn khi nhả chuột', () => {
    const t = rig();
    expect(t.down(700, 500)).toEqual([]);
    expect(t.up(700, 500)).toContainEqual({ kind: 'select', ids: [] });
    expect(t.g.state()).toBe('idle');
  });
  it('nhấp item chưa chọn: chọn ngay khi nhấn xuống', () => {
    const t = rig({ sel: [] });
    expect(t.down(150, 120)).toContainEqual({ kind: 'select', ids: ['card_1'] });
    expect(t.of(t.up(150, 120), 'select')).toEqual([]);
  });
  it('Shift hoặc Ctrl thêm/bớt', () => {
    const t = rig({ sel: ['card_1'] });
    expect(t.down(450, 120, { shift: true })).toContainEqual({
      kind: 'select',
      ids: ['card_1', 'button_1'],
    });
    t.up(450, 120, { shift: true });
    t.down(450, 120, { ctrl: true });
    expect(t.up(450, 120, { ctrl: true })).toContainEqual({ kind: 'select', ids: ['card_1'] });
  });
  it('nhấp (không kéo) một item trong nhiều item đã chọn: thu về item đó', () => {
    const t = rig({ sel: ['card_1', 'button_1'] });
    expect(t.down(150, 120)).toEqual([]);
    expect(t.up(150, 120)).toContainEqual({ kind: 'select', ids: ['card_1'] });
  });
  it('item khóa coi như nền trống', () => {
    const t = rig();
    t.down(10, 310);
    expect(t.up(10, 310)).toContainEqual({ kind: 'select', ids: [] });
  });
  it('Esc ở idle bỏ chọn; không có gì để bỏ thì im lặng', () => {
    const t = rig();
    expect(t.key('Escape')).toContainEqual({ kind: 'select', ids: [] });
    expect(t.key('Escape')).toEqual([]);
  });
});

describe('moving', () => {
  it('dưới ngưỡng 3 điểm ảnh chưa kéo; qua ngưỡng thì xem trước, thả cho đúng một commit', () => {
    const t = rig();
    t.down(150, 120);
    expect(t.move(151, 121)).toEqual([]);
    expect(t.g.state()).toBe('idle');
    const out = t.move(170, 130);
    expect(t.g.state()).toBe('moving');
    const prev = t.of(out, 'preview');
    expect(prev).toHaveLength(1);
    expect(item(prev[0]!.doc, 'card_1')).toMatchObject({ x: 120, y: 110 });
    const up = t.up(170, 130);
    const commits = t.of(up, 'commit');
    expect(commits).toHaveLength(1);
    expect(item(commits[0]!.doc, 'card_1')).toMatchObject({ x: 120, y: 110 });
    expect(commits[0]!.mergeKey).toMatch(/^move#/);
    expect(commits[0]!.selection).toEqual(['card_1']);
    expect(t.of(up, 'guides').at(-1)).toEqual({ kind: 'guides', guides: [] });
    expect(t.g.state()).toBe('idle');
    expect(t.of(t.all, 'commit')).toHaveLength(1);
  });
  it('mỗi cử chỉ có mergeKey riêng (một bước hoàn tác mỗi cử chỉ)', () => {
    const t = rig();
    t.down(150, 120);
    t.move(170, 130);
    const a = t.of(t.up(170, 130), 'commit')[0]!.mergeKey;
    t.down(170, 130);
    t.move(190, 150);
    const b = t.of(t.up(190, 150), 'commit')[0]!.mergeKey;
    expect(a).not.toBe(b);
  });
  it('Esc hủy: không commit, tài liệu không đổi', () => {
    const t = rig();
    t.down(150, 120);
    t.move(170, 130);
    const out = t.key('Escape');
    expect(out).toContainEqual({ kind: 'cancel' });
    expect(t.g.state()).toBe('idle');
    expect(t.up(170, 130)).toEqual([]);
    expect(t.of(t.all, 'commit')).toEqual([]);
    expect(item(t.st.doc, 'card_1')).toMatchObject({ x: 100, y: 100 });
  });
  it('bắt dính lưới mặc định, Alt tắt', () => {
    const snapped = rig();
    snapped.down(150, 120);
    snapped.move(173, 120);
    expect(item(snapped.of(snapped.up(173, 120), 'commit')[0]!.doc, 'card_1')).toMatchObject({
      x: 120,
      y: 100,
    });
    const alt = rig();
    alt.down(150, 120);
    alt.move(173, 120, { alt: true });
    expect(item(alt.of(alt.up(173, 120, { alt: true }), 'commit')[0]!.doc, 'card_1')).toMatchObject(
      { x: 123, y: 100 },
    );
  });
  it('đường gióng với item khác', () => {
    const t = rig();
    t.down(150, 120);
    const out = t.move(150, 117); // trên card 97 → gióng cạnh trên button (y=100)
    expect(t.of(out, 'guides')[0]!.guides).toContainEqual({ axis: 'y', pos: 100, source: 'item' });
    expect(item(t.of(out, 'preview')[0]!.doc, 'card_1').y).toBe(100);
  });
  it('Shift khóa theo trục chính', () => {
    const t = rig();
    t.down(150, 120);
    t.move(180, 128, { shift: true });
    const c = t.of(t.up(180, 128, { shift: true }), 'commit')[0]!;
    expect(item(c.doc, 'card_1')).toMatchObject({ x: 130, y: 100 });
  });
  it('tooltip tọa độ theo con trỏ', () => {
    const t = rig();
    t.down(150, 120);
    const tip = t.of(t.move(170, 130), 'tooltip')[0]!;
    expect(tip.info).toEqual({ kind: 'move', x: 120, y: 110 });
  });
  it('item khóa trong vùng chọn không bị dịch', () => {
    const t2 = rig({ sel: ['card_1', 'panel_1'] });
    t2.down(150, 120);
    t2.move(170, 130);
    const c = t2.of(t2.up(170, 130), 'commit')[0]!;
    expect(item(c.doc, 'panel_1')).toMatchObject({ x: 0, y: 300 });
    expect(item(c.doc, 'card_1')).toMatchObject({ x: 120, y: 110 });
  });
  it('kéo về chỗ cũ: không commit, chỉ hủy xem trước', () => {
    const t = rig();
    t.down(150, 120);
    t.move(170, 130);
    t.move(150, 120);
    const up = t.up(150, 120);
    expect(t.of(up, 'commit')).toEqual([]);
    expect(up).toContainEqual({ kind: 'cancel' });
  });
  it('ngưỡng tính theo điểm ảnh màn hình (zoom 400 %)', () => {
    const t = rig({ zoom: 4 });
    t.down(150, 120);
    expect(t.move(150.5, 120)).toEqual([]); // 2 px
    expect(t.of(t.move(155, 120), 'preview')).toHaveLength(1); // 20 px
  });
  it('không bắt dính khi tắt bắt dính', () => {
    const t = rig({ snap: false });
    t.down(150, 120);
    t.move(173, 123);
    expect(item(t.of(t.up(173, 123), 'commit')[0]!.doc, 'card_1')).toMatchObject({
      x: 123,
      y: 103,
    });
  });
});

describe('marquee', () => {
  it('kéo trên nền trống chọn mọi item giao khung, bỏ item khóa', () => {
    const t = rig({ sel: [] });
    t.down(50, 50);
    const out = t.move(450, 200);
    expect(t.g.state()).toBe('marquee');
    expect(t.of(out, 'marquee')[0]!.rect).toEqual({ x: 50, y: 50, width: 400, height: 150 });
    const up = t.up(450, 200);
    expect(up).toContainEqual({ kind: 'select', ids: ['card_1', 'button_1'] });
    expect(up).toContainEqual({ kind: 'marquee', rect: null });
    const t2 = rig({ sel: ['card_1'] });
    t2.down(10, 290);
    t2.move(50, 350);
    expect(t2.up(50, 350)).toContainEqual({ kind: 'select', ids: [] });
  });
  it('kéo ngược chiều vẫn chuẩn hóa khung', () => {
    const t = rig({ sel: [] });
    t.down(450, 200);
    expect(t.of(t.move(50, 50), 'marquee')[0]!.rect).toEqual({
      x: 50,
      y: 50,
      width: 400,
      height: 150,
    });
  });
  it('Shift cộng thêm vào vùng chọn hiện có', () => {
    const t = rig({ sel: ['button_1'] });
    t.down(50, 50, { shift: true });
    t.move(150, 150, { shift: true });
    expect(t.up(150, 150, { shift: true })).toContainEqual({
      kind: 'select',
      ids: ['button_1', 'card_1'],
    });
  });
  it('Esc hủy marquee, không đổi vùng chọn', () => {
    const t = rig({ sel: ['button_1'] });
    t.down(50, 50);
    t.move(450, 200);
    const out = t.key('Escape');
    expect(out).toContainEqual({ kind: 'marquee', rect: null });
    expect(out).toContainEqual({ kind: 'cancel' });
    expect(t.up(450, 200)).toEqual([]);
    expect(t.st.sel).toEqual(['button_1']);
  });
});

describe('resizing', () => {
  it('kéo tay nắm đông: một commit, chỉ cạnh phải đổi, dính lưới', () => {
    const t = rig();
    t.down(320, 155, {}, { handle: 'e' });
    const out = t.move(353, 155);
    expect(t.g.state()).toBe('resizing');
    expect(t.of(out, 'tooltip')[0]!.info).toEqual({ kind: 'size', width: 250, height: 110 });
    const c = t.of(t.up(353, 155), 'commit');
    expect(c).toHaveLength(1);
    expect(item(c[0]!.doc, 'card_1')).toMatchObject({ x: 100, y: 100, width: 250, height: 110 });
    expect(c[0]!.mergeKey).toMatch(/^resize#/);
  });
  it('Shift giữ tỉ lệ ở góc', () => {
    const t = rig();
    t.down(320, 210, {}, { handle: 'se' });
    t.move(364, 210, { shift: true });
    const c = t.of(t.up(364, 210, { shift: true }), 'commit')[0]!;
    expect(item(c.doc, 'card_1')).toMatchObject({ width: 264, height: 132 });
  });
  it('kẹp tối thiểu theo danh mục', () => {
    const t = rig();
    t.down(320, 155, {}, { handle: 'e' });
    t.move(-500, 155);
    const c = t.of(t.up(-500, 155), 'commit')[0]!;
    expect(item(c.doc, 'card_1').width).toBe(96);
  });
  it('dưới ngưỡng: không đổi cỡ', () => {
    const t = rig();
    t.down(320, 155, {}, { handle: 'e' });
    expect(t.move(321, 155)).toEqual([]);
    expect(t.up(321, 155)).toEqual([]);
  });
  it('Esc hủy', () => {
    const t = rig();
    t.down(320, 155, {}, { handle: 'e' });
    t.move(380, 155);
    expect(t.key('Escape')).toContainEqual({ kind: 'cancel' });
    expect(t.of(t.all, 'commit')).toEqual([]);
  });
  it('con trỏ theo tay nắm', () => {
    expect(cursorOfHandle('n')).toBe('ns-resize');
    expect(cursorOfHandle('w')).toBe('ew-resize');
    expect(cursorOfHandle('nw')).toBe('nwse-resize');
    expect(cursorOfHandle('ne')).toBe('nesw-resize');
  });
});

describe('panning', () => {
  it('Space + kéo đổi viewport, không đổi tài liệu hay vùng chọn', () => {
    const t = rig();
    const first = t.down(100, 100, { space: true });
    expect(first).toContainEqual({ kind: 'cursor', cursor: 'grabbing' });
    expect(t.g.state()).toBe('panning');
    const out = t.move(130, 90, { space: true });
    expect(out).toEqual([{ kind: 'viewport', viewport: { zoom: 1, panX: 30, panY: -10 } }]);
    expect(t.up(130, 90, { space: true })).toContainEqual({ kind: 'cursor', cursor: 'default' });
    expect(t.of(t.all, 'commit')).toEqual([]);
    expect(t.st.sel).toEqual(['card_1']);
  });
  it('chuột giữa tương tự; Esc trả viewport', () => {
    const t = rig();
    t.down(100, 100, {}, { button: 1 });
    t.move(140, 100);
    expect(t.key('Escape')).toContainEqual({
      kind: 'viewport',
      viewport: { zoom: 1, panX: 0, panY: 0 },
    });
    expect(t.g.state()).toBe('idle');
  });
  it('pan tính theo điểm ảnh màn hình dù zoom 200 %', () => {
    const t = rig({ zoom: 2 });
    t.down(50, 50, { space: true });
    expect(t.move(60, 50, { space: true })).toEqual([
      { kind: 'viewport', viewport: { zoom: 2, panX: 20, panY: 0 } },
    ]);
  });
});

describe('tool-drop', () => {
  it('thả widget: addWidget tại điểm thả, dính lưới, chọn item mới, một commit', () => {
    const t = rig();
    const out = t.send({
      type: 'tool-drop',
      widget: 'gauge',
      point: { x: 203, y: 98 },
      mods: NONE,
    });
    const c = t.of(out, 'commit');
    expect(c).toHaveLength(1);
    expect(item(c[0]!.doc, 'gauge_1')).toMatchObject({ x: 200, y: 100, width: 240, height: 200 });
    expect(c[0]!.selection).toEqual(['gauge_1']);
    expect(c[0]!.mergeKey).toMatch(/^add#/);
    expect(out).toContainEqual({ kind: 'select', ids: ['gauge_1'] });
  });
  it('Alt: không dính', () => {
    const t = rig();
    const out = t.send({
      type: 'tool-drop',
      widget: 'gauge',
      point: { x: 203, y: 98 },
      mods: { ...NONE, alt: true },
    });
    expect(item(t.of(out, 'commit')[0]!.doc, 'gauge_1')).toMatchObject({ x: 203, y: 98 });
  });
  it('tool-over xem trước; tool-leave hủy', () => {
    const t = rig();
    const over = t.send({
      type: 'tool-over',
      widget: 'card',
      point: { x: 700, y: 400 },
      mods: NONE,
    });
    expect(t.g.state()).toBe('tool-drop');
    expect(item(t.of(over, 'preview')[0]!.doc, 'card_2')).toMatchObject({ x: 700, y: 400 });
    expect(t.send({ type: 'tool-leave' })).toContainEqual({ kind: 'cancel' });
    expect(t.g.state()).toBe('idle');
  });
  it('quá 250 item hoặc loại lạ: báo từ chối, không commit', () => {
    const doc = baseDoc();
    doc.items = Array.from({ length: 250 }, (_, i) => w(`panel_${i + 1}`, 'panel', 0, 0, 80, 60));
    const t = rig({ doc });
    const out = t.send({ type: 'tool-drop', widget: 'card', point: { x: 5, y: 5 }, mods: NONE });
    expect(out).toContainEqual({ kind: 'rejected', reason: 'max-items' });
    expect(t.of(out, 'commit')).toEqual([]);
    const t2 = rig();
    expect(
      t2.send({ type: 'tool-drop', widget: 'nope', point: { x: 5, y: 5 }, mods: NONE }),
    ).toContainEqual({ kind: 'rejected', reason: 'unknown-widget' });
  });
});

describe('sự kiện thừa', () => {
  it('up/move khi idle và cancel khi idle không phát gì', () => {
    const t = rig();
    expect(t.move(1, 1)).toEqual([]);
    expect(t.up(1, 1)).toEqual([]);
    expect(t.send({ type: 'cancel' })).toEqual([]);
  });
  it('cancel giữa chừng giống Esc', () => {
    const t = rig();
    t.down(150, 120);
    t.move(170, 130);
    expect(t.send({ type: 'cancel' })).toContainEqual({ kind: 'cancel' });
    expect(t.g.state()).toBe('idle');
  });
});
