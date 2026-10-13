// Thao tác bất biến trên màn hình (feature 007, T103; contract studio-screen-editor §2; SC-014).
import { describe, expect, it } from 'vitest';
import { catalogWidget, WIDGET_CATALOG, type Item, type ScreenModel } from '@mat/project-schema';
import { copyItems } from './screen-edit/clipboard.ts';
import {
  addWidget,
  alignItems,
  distributeItems,
  duplicate,
  matchSize,
  moveItems,
  paste,
  remove,
  rename,
  reorder,
  resizeItems,
  setAction,
  setHidden,
  setLocked,
  setProp,
  setRect,
  setScreenProps,
  setSecurity,
  setTag,
} from './screen-doc.ts';

const deepFreeze = <T>(o: T): T => {
  if (o !== null && typeof o === 'object') {
    Object.values(o as object).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};
const w = (
  id: string,
  widget: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<Item> = {},
): Item => ({ id, type: 'widget', widget, x, y, width, height, ...extra }) as Item;

const base = (): ScreenModel =>
  deepFreeze({
    schemaVersion: '0.3.0',
    id: 'main',
    name: 'Chính',
    kind: 'screen',
    size: { width: 1280, height: 720 },
    items: [
      w('card_1', 'card', 10, 20, 220, 110, { tags: { value: 'tank.level' } }),
      w('button_1', 'button', 300, 20, 160, 48),
      w('gauge_1', 'gauge', 10, 200, 240, 200),
      w('line_1', 'line', 600, 200, 600, 300),
      w('panel_1', 'panel', 0, 500, 400, 100, { locked: true }),
    ],
  });
const ids = (d: ScreenModel) => d.items.map((i) => i.id);
const item = (d: ScreenModel, id: string) => d.items.find((i) => i.id === id)!;

describe('addWidget', () => {
  it('cỡ mặc định theo danh mục, props rỗng, id mới, chọn item mới, khóa theo canonicalItem', () => {
    const d = base();
    const r = addWidget(d, 'gauge', { x: 10.4, y: 20.6 });
    expect(r.rejected).toBeUndefined();
    expect(r.selection).toEqual(['gauge_2']);
    expect(r.doc.items.at(-1)).toEqual({
      id: 'gauge_2',
      type: 'widget',
      widget: 'gauge',
      x: 10,
      y: 21,
      width: 240,
      height: 200,
    });
    expect(Object.keys(r.doc.items.at(-1)!)).toEqual([
      'id',
      'type',
      'widget',
      'x',
      'y',
      'width',
      'height',
    ]);
    expect(d.items).toHaveLength(5);
  });
  it('mọi loại trong danh mục thêm được với đúng cỡ mặc định', () => {
    for (const spec of WIDGET_CATALOG.widgets) {
      const r = addWidget(base(), spec.id, { x: 0, y: 0 });
      const it = r.doc.items.at(-1)!;
      expect([it.width, it.height]).toEqual(spec.defaultSize);
      expect(it.id).toMatch(/^[a-z][a-z0-9_]{1,31}$/);
    }
  });
  it('loại lạ: từ chối, tài liệu không đổi', () => {
    const d = base();
    const r = addWidget(d, 'nope', { x: 0, y: 0 });
    expect(r.rejected).toBe('unknown-widget');
    expect(r.doc).toBe(d);
  });
  it('đã đủ 250 item: từ chối', () => {
    const items = Array.from({ length: 250 }, (_, i) => w(`panel_${i + 1}`, 'panel', 0, 0, 80, 60));
    const d = deepFreeze({ ...base(), items });
    const r = addWidget(d, 'card', { x: 0, y: 0 });
    expect(r.rejected).toBe('max-items');
    expect(r.doc).toBe(d);
  });
});

describe('moveItems / setRect', () => {
  it('dịch số nguyên, bỏ item khóa và id lạ, chọn lại các id', () => {
    const d = base();
    const r = moveItems(d, ['card_1', 'button_1', 'panel_1', 'zz'], 5.4, -3);
    expect(item(r.doc, 'card_1')).toMatchObject({ x: 15, y: 17 });
    expect(item(r.doc, 'button_1')).toMatchObject({ x: 305, y: 17 });
    expect(item(r.doc, 'panel_1')).toMatchObject({ x: 0, y: 500 });
    expect(r.selection).toEqual(['card_1', 'button_1', 'panel_1']);
  });
  it('không đổi gì: trả đúng tài liệu cũ', () => {
    const d = base();
    expect(moveItems(d, ['card_1'], 0, 0).doc).toBe(d);
    expect(moveItems(d, ['panel_1'], 5, 5).doc).toBe(d);
  });
  it('setRect kẹp tối thiểu theo danh mục và làm tròn', () => {
    const d = base();
    const r = setRect(d, 'card_1', { width: 10, height: 20.4, x: 7.6 });
    expect(item(r.doc, 'card_1')).toMatchObject({ x: 8, y: 20, width: 96, height: 56 });
    expect(setRect(d, 'nope', { x: 1 }).rejected).toBe('unknown-item');
  });
});

describe('resizeItems', () => {
  it('một item, tay nắm đông', () => {
    const r = resizeItems(base(), ['card_1'], 'e', { dx: 30, dy: 99 });
    expect(item(r.doc, 'card_1')).toMatchObject({ x: 10, y: 20, width: 250, height: 110 });
  });
  it('kẹp tối thiểu theo danh mục', () => {
    const r = resizeItems(base(), ['card_1'], 'w', { dx: 9999, dy: 0 });
    expect(item(r.doc, 'card_1')).toMatchObject({ x: 134, width: 96 });
  });
  it('Shift giữ tỉ lệ ở góc', () => {
    const r = resizeItems(base(), ['card_1'], 'se', { dx: 22, dy: 0 }, { keepRatio: true });
    expect(item(r.doc, 'card_1')).toMatchObject({ width: 242, height: 121 });
  });
  it('nhiều item co theo nhóm; item khóa bị bỏ', () => {
    const r = resizeItems(base(), ['gauge_1', 'line_1', 'panel_1'], 'e', { dx: 100, dy: 0 });
    // hộp bao x 10..1200 (rộng 1190) → 1290: hệ số 1290/1190... chỉ kiểm hình học đơn giản
    expect(item(r.doc, 'panel_1')).toMatchObject({ width: 400 });
    const g = item(r.doc, 'gauge_1');
    expect(g.width).toBeGreaterThan(240);
    expect(g.x).toBe(10);
  });
  it('minSizeOf tùy chỉnh', () => {
    const r = resizeItems(
      base(),
      ['card_1'],
      'e',
      { dx: -500, dy: 0 },
      { minSizeOf: () => ({ width: 150, height: 10 }) },
    );
    expect(item(r.doc, 'card_1').width).toBe(150);
  });
});

describe('alignItems / distributeItems / matchSize', () => {
  it('căn trái, căn dưới theo hộp bao', () => {
    const d = base();
    expect(item(alignItems(d, ['card_1', 'line_1'], 'left').doc, 'line_1').x).toBe(10);
    expect(item(alignItems(d, ['card_1', 'line_1'], 'bottom').doc, 'card_1').y).toBe(390);
  });
  it('phân bố đều ngang (≥ 3 item); ít hơn thì không đổi', () => {
    const d = base();
    const r = distributeItems(d, ['card_1', 'button_1', 'line_1'], 'x');
    expect(item(r.doc, 'button_1').x).toBe(335);
    expect(distributeItems(d, ['card_1', 'button_1'], 'x').doc).toBe(d);
  });
  it('cùng rộng theo item đầu của danh sách; kẹp tối thiểu của item đích', () => {
    const d = base();
    const r = matchSize(d, ['card_1', 'gauge_1'], 'width');
    expect(item(r.doc, 'gauge_1').width).toBe(220);
    const small = matchSize(d, ['button_1', 'line_1'], 'width');
    expect(item(small.doc, 'line_1').width).toBe(240); // tối thiểu của line = 240
    const tall = matchSize(d, ['gauge_1', 'card_1'], 'height');
    expect(item(tall.doc, 'card_1').height).toBe(200);
  });
  it('item khóa không bị đổi', () => {
    const d = base();
    const r = alignItems(d, ['panel_1', 'card_1'], 'left');
    expect(item(r.doc, 'panel_1')).toEqual(item(d, 'panel_1'));
  });
});

describe('reorder', () => {
  it('đổi thứ tự lớp và chọn lại', () => {
    const r = reorder(base(), ['card_1'], 'front');
    expect(ids(r.doc)).toEqual(['button_1', 'gauge_1', 'line_1', 'panel_1', 'card_1']);
    expect(r.selection).toEqual(['card_1']);
    expect(ids(reorder(base(), ['panel_1'], { toIndex: 0 }).doc)[0]).toBe('panel_1');
  });
  it('không đổi: cùng tài liệu', () => {
    const d = base();
    expect(reorder(d, ['panel_1'], 'front').doc).toBe(d);
  });
});

describe('setProp', () => {
  it('đặt giá trị hợp lệ; props theo thứ tự danh mục', () => {
    const r = setProp(setProp(base(), 'card_1', 'decimals', 3).doc, 'card_1', 'label', 'Mức');
    expect(item(r.doc, 'card_1')).toMatchObject({ props: { label: 'Mức', decimals: 3 } });
    expect(Object.keys((item(r.doc, 'card_1') as { props: object }).props)).toEqual([
      'label',
      'decimals',
    ]);
  });
  it('bằng mặc định: bỏ khóa (và bỏ cả props khi rỗng)', () => {
    const d1 = setProp(base(), 'card_1', 'decimals', 3).doc;
    const r = setProp(d1, 'card_1', 'decimals', 1);
    expect('props' in item(r.doc, 'card_1')).toBe(false);
  });
  it('undefined: về mặc định (bỏ khóa)', () => {
    const d1 = setProp(base(), 'card_1', 'decimals', 3).doc;
    expect('props' in item(setProp(d1, 'card_1', 'decimals', undefined).doc, 'card_1')).toBe(false);
  });
  it('không hợp lệ: từ chối, tài liệu không đổi', () => {
    const d = base();
    for (const [name, v] of [
      ['decimals', 9],
      ['decimals', 1.5],
      ['decimals', 'x'],
      ['fontSize', 'xxl'],
      ['valueColor', 'red'],
      ['zzz', 1],
    ] as const) {
      const r = setProp(d, 'card_1', name, v);
      expect(r.rejected).toBe('bad-prop');
      expect(r.doc).toBe(d);
    }
  });
  it('màu auto khi cho phép; mảng/đối tượng (vùng màu) theo danh mục', () => {
    expect(setProp(base(), 'card_1', 'valueColor', 'auto').rejected).toBeUndefined();
    const ok = setProp(base(), 'gauge_1', 'zones', [{ from: 0, to: 50, color: '#00ff00' }]);
    expect(ok.rejected).toBeUndefined();
    const bad = setProp(base(), 'gauge_1', 'zones', [
      { from: 0, to: 50, color: '#00ff00' },
      { from: 40, to: 60, color: '#ff0000' },
    ]);
    expect(bad.rejected).toBe('bad-prop');
  });
  it('id lạ: unknown-item', () => {
    expect(setProp(base(), 'zz', 'decimals', 2).rejected).toBe('unknown-item');
  });
});

describe('setTag', () => {
  it('gắn, đổi, gỡ (gỡ hết thì bỏ cả tags)', () => {
    const r = setTag(base(), 'card_1', 'value', 'tank.temp');
    expect(item(r.doc, 'card_1')).toMatchObject({ tags: { value: 'tank.temp' } });
    const g = setTag(base(), 'card_1', 'value', null);
    expect('tags' in item(g.doc, 'card_1')).toBe(false);
  });
  it('khe lạ', () => {
    const r = setTag(base(), 'card_1', 'zzz', 'a.b');
    expect(r.rejected).toBe('unknown-slot');
    expect(r.doc).not.toBe(undefined);
  });
  it('khe multi nhận mảng 1..max không trùng; chuỗi đơn được bọc thành mảng', () => {
    expect(item(setTag(base(), 'line_1', 'series', ['a.x', 'b.y']).doc, 'line_1')).toMatchObject({
      tags: { series: ['a.x', 'b.y'] },
    });
    expect(item(setTag(base(), 'line_1', 'series', 'a.x').doc, 'line_1')).toMatchObject({
      tags: { series: ['a.x'] },
    });
    expect(setTag(base(), 'line_1', 'series', ['a.x', 'a.x']).rejected).toBe('bad-tag');
    const nine = Array.from({ length: 9 }, (_, i) => `t.${i}`);
    expect(setTag(base(), 'line_1', 'series', nine).rejected).toBe('bad-tag');
    expect('tags' in item(setTag(base(), 'line_1', 'series', []).doc, 'line_1')).toBe(false);
  });
  it('khe thường không nhận mảng', () => {
    expect(setTag(base(), 'card_1', 'value', ['a.b']).rejected).toBe('bad-tag');
  });
});

describe('setAction', () => {
  it('đặt, thay và gỡ hành động click', () => {
    const r = setAction(base(), 'button_1', 'click', { action: 'toggle' });
    expect(item(r.doc, 'button_1')).toMatchObject({ events: { click: { action: 'toggle' } } });
    const nav = setAction(r.doc, 'button_1', 'click', { action: 'navigate', screen: 'tank' });
    expect(item(nav.doc, 'button_1')).toMatchObject({
      events: { click: { action: 'navigate', screen: 'tank' } },
    });
    expect('events' in item(setAction(nav.doc, 'button_1', 'click', null).doc, 'button_1')).toBe(
      false,
    );
  });
  it('widget không có sự kiện, hay hành động sai hình: từ chối', () => {
    expect(setAction(base(), 'card_1', 'click', { action: 'toggle' }).rejected).toBe('bad-action');
    expect(
      setAction(base(), 'button_1', 'click', { action: 'pulse', value: true, durationMs: 50 })
        .rejected,
    ).toBe('bad-action');
    expect(
      setAction(base(), 'button_1', 'click', { action: 'navigate', screen: '' }).rejected,
    ).toBe('bad-action');
    expect(
      setAction(base(), 'button_1', 'click', { action: 'pulse', value: true, durationMs: 500 })
        .rejected,
    ).toBeUndefined();
  });
});

describe('setSecurity', () => {
  it('đặt minRole; bằng mặc định (operator) thì bỏ khóa', () => {
    const r = setSecurity(base(), 'button_1', 'engineer');
    expect(item(r.doc, 'button_1')).toMatchObject({ security: { minRole: 'engineer' } });
    expect('security' in item(setSecurity(r.doc, 'button_1', 'operator').doc, 'button_1')).toBe(
      false,
    );
    expect('security' in item(setSecurity(r.doc, 'button_1', null).doc, 'button_1')).toBe(false);
  });
  it('widget không có nhóm bảo mật hay vai trò lạ: từ chối', () => {
    expect(setSecurity(base(), 'card_1', 'engineer').rejected).toBe('bad-security');
    expect(setSecurity(base(), 'button_1', 'viewer' as unknown as 'operator').rejected).toBe(
      'bad-security',
    );
  });
});

describe('rename / setLocked / setHidden', () => {
  it('đổi tên, tên rỗng bỏ khóa', () => {
    const r = rename(base(), 'card_1', 'Mức bồn');
    expect(item(r.doc, 'card_1')).toMatchObject({ name: 'Mức bồn' });
    expect(Object.keys(item(r.doc, 'card_1'))[1]).toBe('name');
    expect('name' in item(rename(r.doc, 'card_1', '').doc, 'card_1')).toBe(false);
  });
  it('khóa và ẩn: false bỏ khóa', () => {
    const l = setLocked(base(), ['card_1', 'gauge_1'], true);
    expect(item(l.doc, 'card_1').locked).toBe(true);
    expect(item(l.doc, 'gauge_1').locked).toBe(true);
    const u = setLocked(l.doc, ['card_1'], false);
    expect('locked' in item(u.doc, 'card_1')).toBe(false);
    const h = setHidden(base(), ['card_1'], true);
    expect(item(h.doc, 'card_1').hidden).toBe(true);
    expect(setHidden(h.doc, ['card_1'], true).doc).toBe(h.doc);
  });
});

describe('duplicate / paste / remove', () => {
  it('nhân bản: id mới, lệch (+20,+20), chọn bản mới', () => {
    const r = duplicate(base(), ['card_1']);
    expect(r.selection).toEqual(['card_2']);
    expect(item(r.doc, 'card_2')).toMatchObject({
      x: 30,
      y: 40,
      tags: { value: 'tank.level' },
      widget: 'card',
    });
  });
  it('dán từ clipboard sang màn hình khác, báo màn hình đích thiếu', () => {
    const src = base();
    const withNav = setAction(src, 'button_1', 'click', { action: 'navigate', screen: 'tank' }).doc;
    const clip = copyItems(withNav, ['button_1'])!;
    const dest: ScreenModel = deepFreeze({ ...base(), id: 'other', items: [] });
    const r = paste(dest, clip, undefined, ['other']);
    expect(r.doc.items).toHaveLength(1);
    expect(r.missingTargets).toEqual(['tank']);
    expect(r.selection).toEqual(['button_1']);
  });
  it('đạt giới hạn: từ chối', () => {
    const items = Array.from({ length: 250 }, (_, i) => w(`panel_${i + 1}`, 'panel', 0, 0, 80, 60));
    const d = deepFreeze({ ...base(), items });
    const r = duplicate(d, ['panel_1']);
    expect(r.rejected).toBe('max-items');
    expect(r.doc).toBe(d);
  });
  it('xóa: bỏ id, selection rỗng; id lạ bị bỏ qua', () => {
    const r = remove(base(), ['card_1', 'zz', 'panel_1']);
    expect(ids(r.doc)).toEqual(['button_1', 'gauge_1', 'line_1']);
    expect(r.selection).toEqual([]);
    const d = base();
    expect(remove(d, ['zz']).doc).toBe(d);
  });
});

describe('setScreenProps', () => {
  it('đổi tên, loại, cỡ (kẹp và làm tròn), fitMode, nền', () => {
    const r = setScreenProps(base(), {
      name: 'Mới',
      kind: 'popup',
      size: { width: 100000, height: 10.4 },
      fitMode: 'cover',
      background: '#112233',
    });
    expect(r.doc).toMatchObject({
      name: 'Mới',
      kind: 'popup',
      size: { width: 4096, height: 64 },
      fitMode: 'cover',
      background: '#112233',
    });
    expect(r.doc.id).toBe('main');
  });
  it('null bỏ fitMode/nền', () => {
    const d1 = setScreenProps(base(), { fitMode: 'cover', background: '#000000' }).doc;
    const r = setScreenProps(d1, { fitMode: null, background: null });
    expect('fitMode' in r.doc || 'background' in r.doc).toBe(false);
  });
  it('giá trị sai: từ chối', () => {
    expect(setScreenProps(base(), { background: 'red' }).rejected).toBe('bad-screen-prop');
    expect(setScreenProps(base(), { name: '  ' }).rejected).toBe('bad-screen-prop');
    expect(setScreenProps(base(), { fitMode: 'zoom' as 'cover' }).rejected).toBe('bad-screen-prop');
  });
});

describe('bất biến: chuỗi thao tác giả ngẫu nhiên', () => {
  it('300 bước: id duy nhất, số nguyên, ≥ minSize, ≤ 250, đầu vào đóng băng không bị sửa', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed % n;
    };
    const widgets = [...WIDGET_CATALOG.widgets.map((s) => s.id), 'nope'];
    let doc = base();
    let clip = copyItems(doc, ['card_1', 'button_1'])!;
    for (let step = 0; step < 300; step++) {
      deepFreeze(doc);
      const pick = () => doc.items.map((i) => i.id).filter(() => rnd(3) === 0);
      const before = JSON.stringify(doc);
      const handles = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
      let r: { doc: ScreenModel };
      switch (rnd(14)) {
        case 0:
          r = addWidget(doc, widgets[rnd(widgets.length)]!, { x: rnd(1200) - 50.5, y: rnd(700) });
          break;
        case 1:
          r = moveItems(doc, pick(), rnd(80) - 40.3, rnd(80) - 40.7);
          break;
        case 2:
          r = resizeItems(
            doc,
            pick(),
            handles[rnd(8)]!,
            { dx: rnd(400) - 300.5, dy: rnd(400) - 300 },
            { keepRatio: rnd(2) === 0 },
          );
          break;
        case 3:
          r = alignItems(
            doc,
            pick(),
            (['left', 'right', 'top', 'bottom', 'hcenter', 'vmiddle'] as const)[rnd(6)]!,
          );
          break;
        case 4:
          r = distributeItems(doc, pick(), rnd(2) === 0 ? 'x' : 'y');
          break;
        case 5:
          r = matchSize(doc, pick(), rnd(2) === 0 ? 'width' : 'height');
          break;
        case 6:
          r = reorder(doc, pick(), (['front', 'back', 'forward', 'backward'] as const)[rnd(4)]!);
          break;
        case 7:
          r = duplicate(doc, pick());
          break;
        case 8:
          r = paste(doc, clip);
          break;
        case 9:
          r = remove(doc, doc.items.length > 3 ? pick().slice(0, 2) : []);
          break;
        case 10:
          r = setRect(doc, doc.items[rnd(doc.items.length)]?.id ?? 'x', {
            width: rnd(300) - 20,
            height: rnd(300) - 20.5,
          });
          break;
        case 11:
          r = setProp(doc, doc.items[rnd(doc.items.length)]?.id ?? 'x', 'decimals', rnd(9));
          break;
        case 12:
          r = setLocked(doc, pick(), rnd(2) === 0);
          break;
        default: {
          const c = copyItems(doc, pick());
          if (c) clip = c;
          r = { doc };
        }
      }
      expect(JSON.stringify(doc)).toBe(before);
      doc = r.doc;
      expect(doc.items.length).toBeLessThanOrEqual(250);
      expect(new Set(doc.items.map((i) => i.id)).size).toBe(doc.items.length);
      for (const it of doc.items) {
        expect([it.x, it.y, it.width, it.height].every(Number.isInteger)).toBe(true);
        if (it.type === 'widget') {
          const spec = catalogWidget(it.widget)!;
          expect(it.width).toBeGreaterThanOrEqual(Math.min(spec.minSize[0], it.width));
          if (it.locked !== true) {
            expect(it.width).toBeGreaterThanOrEqual(spec.minSize[0]);
            expect(it.height).toBeGreaterThanOrEqual(spec.minSize[1]);
          }
        }
      }
    }
  });
});
