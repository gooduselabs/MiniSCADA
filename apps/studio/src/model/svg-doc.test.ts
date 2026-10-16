// Tài liệu SVG của item (feature 008, T056): cây phần tử từ ElementInfo, đặt tên file `graphics/<slug>.svg`, đổi tên phần
// tử bằng cách ghi `data-mat-name` qua bộ ghi tất định, đổi tên là một bước hoàn tác.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenModel, SvgItem } from '@mat/project-schema';
import { importSvg, makeSeededUid, type ElementInfo } from '@mat/svg-import';
import { StudioStore } from '../app/store.ts';
import { createMockPlatform } from '../platform/mock.ts';
import {
  elementTree,
  flattenTree,
  planRenameElement,
  renameElementInSvg,
  svgSlug,
  uniqueSvgPath,
} from './svg-doc.ts';
import { dashboardDemo } from './test-fixtures.ts';

const NS = 'http://www.w3.org/2000/svg';
const SAMPLE = `<svg xmlns="${NS}" width="400" height="300" viewBox="0 0 400 300"><g id="Bon_nuoc"><rect id="Muc" x="10" y="10" width="50" height="80"/><text x="5" y="5">12</text></g><circle cx="200" cy="100" r="30"/></svg>`;
const imported = () => {
  const r = importSvg(SAMPLE, { fileName: 'a.svg', uid: makeSeededUid('t') });
  if (!r.ok) throw new Error('fixture hỏng');
  return r;
};

describe('svgSlug và uniqueSvgPath', () => {
  it.each([
    ['Sơ đồ Bồn Nước.svg', 'so-do-bon-nuoc'],
    ['ĐÈN_báo (1).SVG', 'den-bao-1'],
    ['tank-process.svg', 'tank-process'],
    ['---.svg', 'do-hoa'],
    ['Đường ống 2.svg', 'duong-ong-2'],
  ])('%s → %s', (name, slug) => expect(svgSlug(name)).toBe(slug));

  it('trùng tên thêm -2, -3; so khớp không phân biệt hoa thường', () => {
    expect(uniqueSvgPath('a.svg', [])).toBe('graphics/a.svg');
    expect(uniqueSvgPath('a.svg', ['graphics/a.svg'])).toBe('graphics/a-2.svg');
    expect(uniqueSvgPath('a.svg', ['graphics/a.svg', 'graphics/A-2.svg'])).toBe('graphics/a-3.svg');
  });

  it('slug dài bị cắt 48 ký tự và không kết thúc bằng gạch ngang', () => {
    const s = svgSlug(`${'a'.repeat(47)}-${'b'.repeat(20)}.svg`);
    expect(s).toBe('a'.repeat(47));
    expect(s.length).toBeLessThanOrEqual(48);
  });
});

describe('elementTree', () => {
  it('dựng cây theo parent, giữ thứ tự tài liệu và độ sâu', () => {
    const r = imported();
    const tree = elementTree(r.elements);
    const flat = flattenTree(tree);
    expect(flat.map((n) => n.uid)).toEqual(r.elements.map((e) => e.uid));
    const root = tree.filter((n) => n.depth === 0);
    expect(root.map((n) => n.tag)).toEqual(['g', 'circle']);
    const g = root[0]!;
    expect(g.children.map((c) => c.tag)).toEqual(['rect', 'text']);
    expect(g.children.every((c) => c.depth === 1)).toBe(true);
  });

  it('phần tử có nhãn mang `label`; cha không có trong danh sách thì thành gốc', () => {
    const els: ElementInfo[] = [
      { uid: 'el_a', tag: 'g', name: 'Bồn', parent: null, depth: 0, label: 'Bồn' },
      { uid: 'el_b', tag: 'rect', name: 'rect 1', parent: 'el_ghost', depth: 1 },
    ];
    const tree = elementTree(els);
    expect(tree.map((n) => n.uid)).toEqual(['el_a', 'el_b']);
    expect(tree[0]!.label).toBe('Bồn');
  });

  it('danh sách rỗng cho cây rỗng', () => expect(elementTree([])).toEqual([]));
});

describe('renameElementInSvg', () => {
  const uidOf = (tag: string) => imported().elements.find((e) => e.tag === tag)!.uid;

  it('ghi data-mat-name đúng phần tử, giữ nguyên phần còn lại, tất định', () => {
    const r = imported();
    const uid = uidOf('rect');
    const a = renameElementInSvg(r.svg, uid, 'Mức nước');
    const b = renameElementInSvg(r.svg, uid, 'Mức nước');
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(a).toContain('data-mat-name="Mức nước"');
    // Bản ghi lại khi chưa đổi gì thì giống từng byte (bộ ghi tất định, idempotent).
    expect(renameElementInSvg(a!, uid, 'Mức nước')).toBe(a);
    // Đúng một thuộc tính data-mat-name mới so với bản gốc.
    const count = (s: string) => (s.match(/data-mat-name="/g) ?? []).length;
    expect(count(a!)).toBe(
      count(r.svg) + (r.svg.includes(`data-mat-uid="${uid}" data-mat-name`) ? 0 : 1),
    );
  });

  it('thoát ký tự đặc biệt trong tên; không thể tạo markup', () => {
    const r = imported();
    const out = renameElementInSvg(r.svg, uidOf('rect'), 'A "B" <x> & y')!;
    expect(out).toContain('data-mat-name="A &quot;B&quot; &lt;x&gt; &amp; y"');
    expect(out).not.toContain('<x>');
  });

  it('tên rỗng gỡ data-mat-name; uid lạ trả null; tên quá 80 ký tự bị cắt', () => {
    const r = imported();
    const uid = uidOf('rect');
    const named = renameElementInSvg(r.svg, uid, 'Mức nước')!;
    const cleared = renameElementInSvg(named, uid, '  ')!;
    expect(cleared).not.toContain('Mức nước');
    expect(renameElementInSvg(r.svg, 'el_khong_co', 'x')).toBeNull();
    const long = renameElementInSvg(r.svg, uid, 'x'.repeat(200))!;
    expect(long).toContain(`data-mat-name="${'x'.repeat(80)}"`);
  });
});

describe('planRenameElement: một bước hoàn tác trong store', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('đổi tên ghi SVG chờ ghi và tên trong item.elements; Ctrl+Z về như cũ', async () => {
    const platform = createMockPlatform();
    platform.control.useProject(dashboardDemo());
    const store = new StudioStore({ platform });
    expect(await store.openProject()).toBe(true);
    await store.validateNow();
    const o = store.state.outline.screens.find((s) => s.id === 'tong-quan')!;
    const item = o.model!.items.find((i): i is SvgItem => i.type === 'svg')!;
    const svgText = store.state.docs[item.svgFile]!.diskText;
    const uid = /data-mat-uid="([^"]+)"/.exec(svgText)![1]!;
    const plan = planRenameElement({
      screen: o.model as ScreenModel,
      itemId: item.id,
      svgText,
      uid,
      name: 'Bơm số 1',
    });
    if (!plan) throw new Error('kế hoạch rỗng');
    store.applyChange(plan.change);
    expect(store.dirtyFiles()).toContain(item.svgFile);
    expect(store.state.docs[item.svgFile]!.pending).toContain('data-mat-name="Bơm số 1"');
    const after = store.state.outline.screens.find((s) => s.id === 'tong-quan')!.model!;
    const it2 = after.items.find((i) => i.id === item.id) as SvgItem;
    expect(it2.elements.find((e) => e.elementUid === uid)?.name).toBe('Bơm số 1');
    store.undo();
    expect(store.dirtyFiles()).toEqual([]);
    store.redo();
    expect(store.dirtyFiles()).toContain(item.svgFile);
  });

  it('uid không có trong SVG hoặc item lạ: không có kế hoạch', () => {
    const r = imported();
    const screen = { id: 's', items: [] } as unknown as ScreenModel;
    expect(
      planRenameElement({ screen, itemId: 'svg_1', svgText: r.svg, uid: 'x', name: 'a' }),
    ).toBeNull();
  });
});
