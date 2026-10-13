// Sao chép, dán, nhân bản (feature 007, T102; D12 của spec).
import { describe, expect, it } from 'vitest';
import type { Item, ScreenModel } from '@mat/project-schema';
import {
  ClipboardStore,
  copyItems,
  duplicateItems,
  idKindOf,
  nextItemId,
  pasteItems,
} from './clipboard.ts';

const deepFreeze = <T>(o: T): T => {
  if (o !== null && typeof o === 'object') {
    Object.values(o as object).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};
const w = (id: string, widget: string, x: number, y: number, extra: Partial<Item> = {}): Item =>
  ({ id, type: 'widget', widget, x, y, width: 100, height: 60, ...extra }) as Item;
const svg: Item = {
  id: 'svg_1',
  type: 'svg',
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  svgFile: 'a.svg',
  bindingFile: 'a.binding.json',
  viewBox: [0, 0, 200, 100],
  elements: [],
};
const doc = (items: Item[], id = 'main'): ScreenModel =>
  deepFreeze({
    schemaVersion: '0.3.0',
    id,
    name: id,
    kind: 'screen',
    size: { width: 1280, height: 720 },
    items,
  });
const ids = (items: readonly Item[]) => items.map((i) => i.id);

describe('idKindOf / nextItemId', () => {
  it('loại = widget id; svg = "svg"; gạch nối đổi thành gạch dưới (id item hợp lệ)', () => {
    expect(idKindOf(w('x', 'card', 0, 0))).toBe('card');
    expect(idKindOf(svg)).toBe('svg');
    expect(idKindOf(w('x', 'tag-table', 0, 0))).toBe('tag_table');
  });
  it('số nhỏ nhất chưa dùng (lấp khoảng trống)', () => {
    expect(nextItemId('card', new Set())).toBe('card_1');
    expect(nextItemId('card', new Set(['card_1', 'card_2']))).toBe('card_3');
    expect(nextItemId('card', new Set(['card_2', 'card_3']))).toBe('card_1');
    expect(nextItemId('card', new Set(['card_1', 'card_3']))).toBe('card_2');
  });
});

describe('copyItems', () => {
  const d = doc([w('card_1', 'card', 10, 10), w('button_1', 'button', 50, 50), svg]);
  it('theo thứ tự lớp, bản sao sâu', () => {
    const clip = copyItems(d, ['button_1', 'card_1'])!;
    expect(ids(clip.items)).toEqual(['card_1', 'button_1']);
    expect(clip.sourceScreen).toBe('main');
    expect(clip.items[0]).not.toBe(d.items[0]);
  });
  it('rỗng hoặc id lạ: null', () => {
    expect(copyItems(d, [])).toBeNull();
    expect(copyItems(d, ['nope'])).toBeNull();
  });
});

describe('pasteItems', () => {
  const rich = w('button_1', 'button', 50, 60, {
    name: 'Bơm 1',
    tags: { target: 'pump.run' },
    events: { click: { action: 'toggle' } },
    props: { label: 'Chạy' },
  });
  it('id mới, lệch (+20,+20), giữ Tag, hành động, thuộc tính', () => {
    const d = doc([rich]);
    const r = pasteItems(d, copyItems(d, ['button_1'])!);
    expect(r.rejected).toBeUndefined();
    expect(r.ids).toEqual(['button_2']);
    expect(r.items).toHaveLength(2);
    expect(r.items[1]).toEqual({ ...rich, id: 'button_2', x: 70, y: 80 });
    expect(d.items).toHaveLength(1);
  });
  it('lấp id còn trống và không trùng trong cùng đợt', () => {
    const d = doc([w('card_2', 'card', 0, 0), w('card_3', 'card', 0, 0)]);
    const clip = copyItems(d, ['card_2', 'card_3'])!;
    expect(pasteItems(d, clip).ids).toEqual(['card_1', 'card_4']);
  });
  it('mọi loại: tag-table, svg', () => {
    const d = doc([w('tag_table_1', 'tag-table', 0, 0), svg]);
    const r = pasteItems(d, copyItems(d, ['tag_table_1', 'svg_1'])!);
    expect(r.ids).toEqual(['tag_table_2', 'svg_2']);
  });
  it('offset tùy chọn', () => {
    const d = doc([w('card_1', 'card', 5, 5)]);
    const r = pasteItems(d, copyItems(d, ['card_1'])!, { offset: { x: 0, y: 0 } });
    expect(r.items[1]).toMatchObject({ x: 5, y: 5 });
  });
  it('dán nhiều lần: id luôn mới', () => {
    let d = doc([w('card_1', 'card', 0, 0)]);
    const clip = copyItems(d, ['card_1'])!;
    for (let i = 0; i < 5; i++) d = doc(pasteItems(d, clip).items as Item[]);
    expect(new Set(ids(d.items)).size).toBe(6);
  });
  it('đạt 250 item: từ chối, không thêm gì', () => {
    const many = Array.from({ length: 249 }, (_, i) => w(`panel_${i + 1}`, 'panel', 0, 0));
    const d = doc([...many, w('card_1', 'card', 0, 0)].slice(0, 249));
    const clip = copyItems(doc([w('card_1', 'card', 0, 0), w('card_2', 'card', 0, 0)]), [
      'card_1',
      'card_2',
    ])!;
    const r = pasteItems(d, clip);
    expect(r.rejected).toBe('max-items');
    expect(r.items).toBe(d.items);
    expect(r.ids).toEqual([]);
  });
  it('sang màn hình khác: báo hành động trỏ tới màn hình không có ở đích', () => {
    const src = doc([
      w('button_1', 'button', 0, 0, {
        events: { click: { action: 'navigate', screen: 'main-2' } },
      }),
      w('button_2', 'button', 0, 0, { events: { click: { action: 'popup', screen: 'p1' } } }),
      w('button_3', 'button', 0, 0, {
        events: { click: { action: 'navigate', screen: 'main-2' } },
      }),
      w('button_4', 'button', 0, 0, { events: { click: { action: 'toggle' } } }),
    ]);
    const clip = copyItems(src, ['button_1', 'button_2', 'button_3', 'button_4'])!;
    const dest = doc([], 'other');
    const r = pasteItems(dest, clip, { knownScreens: ['other', 'p1'] });
    expect(r.missingTargets).toEqual(['main-2']);
    expect(r.items).toHaveLength(4);
    // vẫn giữ hành động
    expect(r.items[0]).toMatchObject({
      events: { click: { action: 'navigate', screen: 'main-2' } },
    });
    expect(pasteItems(dest, clip).missingTargets).toEqual([]); // không có danh sách: không kiểm
  });
});

describe('duplicateItems', () => {
  it('nhân bản ngay trong màn hình, lệch (+20,+20)', () => {
    const d = doc([w('card_1', 'card', 10, 10), w('card_2', 'card', 0, 0)]);
    const r = duplicateItems(d, ['card_1']);
    expect(r.ids).toEqual(['card_3']);
    expect(r.items[2]).toMatchObject({ x: 30, y: 30, widget: 'card' });
  });
  it('id lạ: từ chối "empty"', () => {
    expect(duplicateItems(doc([]), ['x']).rejected).toBe('empty');
  });
});

describe('ClipboardStore', () => {
  it('giữ trong bộ nhớ, không đụng clipboard hệ thống', () => {
    const s = new ClipboardStore();
    expect(s.get()).toBeNull();
    const clip = { sourceScreen: 'main', items: [w('card_1', 'card', 0, 0)] };
    s.set(clip);
    expect(s.get()).toBe(clip);
    s.clear();
    expect(s.get()).toBeNull();
  });
});
