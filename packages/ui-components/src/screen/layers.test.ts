import { describe, expect, it } from 'vitest';
import type { Item, ScreenModel } from '@mat/project-schema';
import { collectTagIds, itemTagIds, layersOf } from './layers.ts';

const widget = (id: string, tags?: Record<string, string | string[]>, hidden = false): Item => ({
  type: 'widget',
  id,
  widget: 'card',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  tags,
  hidden,
});
const svg = (id: string): Item => ({
  type: 'svg',
  id,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  svgFile: 'a.svg',
  bindingFile: 'a.json',
  viewBox: [0, 0, 100, 100],
  elements: [],
});
const screen = (id: string, items: Item[], kind: 'screen' | 'popup' = 'screen'): ScreenModel => ({
  schemaVersion: '0.3.0',
  id,
  name: id,
  kind,
  size: { width: 800, height: 600 },
  items,
});

describe('layersOf', () => {
  it('giữ thứ tự mảng items (đầu mảng ở dưới cùng), kèm chỉ số lớp', () => {
    const l = layersOf(screen('s', [widget('a'), svg('b'), widget('c')]));
    expect(l.map((x) => x.item.id)).toEqual(['a', 'b', 'c']);
    expect(l.map((x) => x.index)).toEqual([0, 1, 2]);
  });
  it('bỏ item hidden nhưng giữ chỉ số lớp gốc', () => {
    const l = layersOf(screen('s', [widget('a'), widget('b', undefined, true), widget('c')]));
    expect(l.map((x) => x.item.id)).toEqual(['a', 'c']);
    expect(l.map((x) => x.index)).toEqual([0, 2]);
  });
});

describe('itemTagIds', () => {
  it('trải phẳng khe thường và khe multi', () => {
    expect(itemTagIds(widget('a', { value: 't1', series: ['t2', 't3'] }))).toEqual([
      't1',
      't2',
      't3',
    ]);
  });
  it('item svg và widget không có Tag cho mảng rỗng', () => {
    expect(itemTagIds(svg('a'))).toEqual([]);
    expect(itemTagIds(widget('a'))).toEqual([]);
  });
});

describe('collectTagIds', () => {
  it('hợp Tag của màn hình và popup, bỏ item hidden, khử trùng, giữ thứ tự xuất hiện', () => {
    const main = screen('m', [
      widget('a', { value: 't1' }),
      widget('b', { value: 't9' }, true),
      widget('c', { series: ['t2', 't1'] }),
    ]);
    const pop = screen('p', [widget('d', { value: 't3' }), widget('e', { value: 't2' })], 'popup');
    expect(collectTagIds([main, pop])).toEqual(['t1', 't2', 't3']);
  });
  it('thêm Tag binding của item svg qua hàm tra', () => {
    const main = screen('m', [svg('g'), widget('a', { value: 't1' })]);
    const ids = collectTagIds([main], (sid, iid) =>
      sid === 'm' && iid === 'g' ? ['b1', 't1'] : [],
    );
    expect(ids).toEqual(['b1', 't1']);
  });
  it('bỏ qua màn hình null', () => {
    expect(collectTagIds([null, screen('m', [widget('a', { value: 'x' })])])).toEqual(['x']);
  });
});
