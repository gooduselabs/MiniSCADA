// Thao tác bất biến trên `navigation` của project.json (feature 007, T107; FR-066; research R4).
import { describe, expect, it } from 'vitest';
import type { Navigation } from '@mat/project-schema';
import {
  NAV_ICONS,
  NAV_MAX_LEAVES,
  addGroup,
  addLeaf,
  countLeaves,
  defaultNavigation,
  groupItems,
  moveNode,
  removeAt,
  removeScreenRefs,
  renameAt,
  setIconAt,
  setPositionOf,
  setScreenAt,
  usesScreen,
  type ScreenRef,
} from './navigation-doc.ts';

const deepFreeze = <T>(o: T): T => {
  if (o !== null && typeof o === 'object') {
    Object.values(o as object).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};
const screens: ScreenRef[] = [
  { id: 'main', kind: 'screen', name: 'Chính' },
  { id: 'tank', kind: 'screen', name: 'Bồn' },
  { id: 'trend', kind: 'screen', name: 'Xu hướng' },
  { id: 'alarm', kind: 'popup', name: 'Cảnh báo' },
];
const nav = (): Navigation =>
  deepFreeze({
    position: 'left',
    items: [
      { label: 'Chính', screen: 'main', icon: 'home' },
      { label: 'Giám sát', icon: 'chart', items: [{ label: 'Bồn', screen: 'tank' }] },
      { label: 'Xu hướng', screen: 'trend' },
    ],
  });
const labels = (n: Navigation) => n.items.map((i) => i.label);

describe('hằng số', () => {
  it('16 biểu tượng, 32 lá', () => {
    expect(NAV_ICONS).toHaveLength(16);
    expect(NAV_ICONS).toContain('home');
    expect(NAV_MAX_LEAVES).toBe(32);
  });
});

describe('defaultNavigation', () => {
  it('menu từ danh sách màn hình thường (bỏ popup), vị trí trái', () => {
    expect(defaultNavigation(screens)).toEqual({
      position: 'left',
      items: [
        { label: 'Chính', screen: 'main' },
        { label: 'Bồn', screen: 'tank' },
        { label: 'Xu hướng', screen: 'trend' },
      ],
    });
  });
  it('nhãn: dùng id khi tên rỗng, cắt 40 ký tự; tối đa 32 lá', () => {
    const many: ScreenRef[] = Array.from({ length: 40 }, (_, i) => ({
      id: `s${i}`,
      kind: 'screen' as const,
      name: i === 0 ? '' : 'x'.repeat(60),
    }));
    const d = defaultNavigation(many);
    expect(d.items).toHaveLength(32);
    expect(d.items[0]!.label).toBe('s0');
    expect(d.items[1]!.label).toHaveLength(40);
  });
  it('không có màn hình thường: menu rỗng', () => {
    expect(defaultNavigation([{ id: 'p', kind: 'popup' }]).items).toEqual([]);
  });
});

describe('đếm và tra cứu', () => {
  it('countLeaves chỉ đếm lá, kể cả trong nhóm', () => {
    expect(countLeaves(nav())).toBe(3);
    expect(countLeaves({ items: [] })).toBe(0);
  });
  it('usesScreen', () => {
    expect(usesScreen(nav(), 'tank')).toBe(true);
    expect(usesScreen(nav(), 'nope')).toBe(false);
  });
});

describe('addLeaf', () => {
  it('thêm vào cuối gốc, hoặc vào nhóm, hoặc theo vị trí', () => {
    const r = addLeaf(nav(), { label: 'Bồn 2', screen: 'tank', icon: 'tank' }, screens);
    expect(r.rejected).toBeUndefined();
    expect(r.nav.items.at(-1)).toEqual({ label: 'Bồn 2', screen: 'tank', icon: 'tank' });
    const g = addLeaf(nav(), { label: 'X', screen: 'main' }, screens, { parent: [1] });
    expect(g.nav.items[1]!.items!.map((i) => i.label)).toEqual(['Bồn', 'X']);
    const at = addLeaf(nav(), { label: 'Đầu', screen: 'main' }, screens, { index: 0 });
    expect(labels(at.nav)).toEqual(['Đầu', 'Chính', 'Giám sát', 'Xu hướng']);
  });
  it('nhãn 1–40 ký tự', () => {
    expect(addLeaf(nav(), { label: '', screen: 'main' }, screens).rejected).toBe('bad-label');
    expect(addLeaf(nav(), { label: '  ', screen: 'main' }, screens).rejected).toBe('bad-label');
    expect(addLeaf(nav(), { label: 'x'.repeat(41), screen: 'main' }, screens).rejected).toBe(
      'bad-label',
    );
    expect(
      addLeaf(nav(), { label: 'x'.repeat(40), screen: 'main' }, screens).rejected,
    ).toBeUndefined();
  });
  it('đích chỉ là màn hình kind screen có thật', () => {
    expect(addLeaf(nav(), { label: 'A', screen: 'alarm' }, screens).rejected).toBe('bad-target');
    expect(addLeaf(nav(), { label: 'A', screen: 'zz' }, screens).rejected).toBe('bad-target');
  });
  it('icon trong bộ 16', () => {
    expect(addLeaf(nav(), { label: 'A', screen: 'main', icon: 'rocket' }, screens).rejected).toBe(
      'bad-icon',
    );
  });
  it('nhóm cha phải là nhóm; chỉ số kẹp', () => {
    expect(addLeaf(nav(), { label: 'A', screen: 'main' }, screens, { parent: [0] }).rejected).toBe(
      'not-a-group',
    );
    expect(addLeaf(nav(), { label: 'A', screen: 'main' }, screens, { parent: [9] }).rejected).toBe(
      'bad-path',
    );
    expect(
      labels(addLeaf(nav(), { label: 'A', screen: 'main' }, screens, { index: 99 }).nav).at(-1),
    ).toBe('A');
  });
  it('giới hạn 32 lá', () => {
    const full: Navigation = {
      items: Array.from({ length: 32 }, (_, i) => ({ label: `m${i}`, screen: 'main' })),
    };
    const r = addLeaf(full, { label: 'thừa', screen: 'main' }, screens);
    expect(r.rejected).toBe('max-leaves');
    expect(r.nav).toBe(full);
  });
});

describe('addGroup / groupItems', () => {
  it('addGroup tạo nhóm rỗng ở vị trí chỉ định', () => {
    const r = addGroup(nav(), 'Nhóm', 1);
    expect(r.nav.items[1]).toEqual({ label: 'Nhóm', items: [] });
    expect(addGroup(nav(), '').rejected).toBe('bad-label');
  });
  it('groupItems gom lá gốc thành nhóm một cấp tại vị trí của lá đầu', () => {
    const r = groupItems(nav(), [[2], [0]], 'Nhóm');
    expect(r.rejected).toBeUndefined();
    expect(labels(r.nav)).toEqual(['Nhóm', 'Giám sát']);
    expect(r.nav.items[0]!.items!.map((i) => i.label)).toEqual(['Chính', 'Xu hướng']);
  });
  it('không lồng nhóm trong nhóm: chỉ gom lá ở gốc', () => {
    expect(groupItems(nav(), [[1]], 'N').rejected).toBe('nested-group');
    expect(groupItems(nav(), [[1, 0]], 'N').rejected).toBe('nested-group');
    expect(groupItems(nav(), [], 'N').rejected).toBe('bad-path');
    expect(groupItems(nav(), [[9]], 'N').rejected).toBe('bad-path');
  });
});

describe('removeAt / renameAt', () => {
  it('xóa lá và nhóm (cả nội dung)', () => {
    expect(labels(removeAt(nav(), [0]).nav)).toEqual(['Giám sát', 'Xu hướng']);
    expect(labels(removeAt(nav(), [1]).nav)).toEqual(['Chính', 'Xu hướng']);
    expect(removeAt(nav(), [1, 0]).nav.items[1]).toEqual({
      label: 'Giám sát',
      icon: 'chart',
      items: [],
    });
    expect(removeAt(nav(), [7]).rejected).toBe('bad-path');
  });
  it('đổi nhãn lá và nhóm', () => {
    expect(renameAt(nav(), [0], 'Trang chủ').nav.items[0]!.label).toBe('Trang chủ');
    expect(renameAt(nav(), [1, 0], 'Bồn A').nav.items[1]!.items![0]!.label).toBe('Bồn A');
    expect(renameAt(nav(), [0], '').rejected).toBe('bad-label');
    expect(renameAt(nav(), [0], 'Chính').nav).toEqual(nav());
  });
});

describe('moveNode (kéo sắp xếp); chỉ số = vị trí cuối trong danh sách đích', () => {
  it('đổi chỗ trong gốc', () => {
    expect(labels(moveNode(nav(), [0], [], 2).nav)).toEqual(['Giám sát', 'Xu hướng', 'Chính']);
    expect(labels(moveNode(nav(), [2], [], 0).nav)).toEqual(['Xu hướng', 'Chính', 'Giám sát']);
    expect(labels(moveNode(nav(), [2], [], 99).nav)).toEqual(['Chính', 'Giám sát', 'Xu hướng']);
  });
  it('cùng chỗ: trả đúng đối tượng cũ', () => {
    const n = nav();
    expect(moveNode(n, [0], [], 0).nav).toBe(n);
    expect(moveNode(n, [2], [], 2).nav).toBe(n);
  });
  it('đưa lá vào nhóm (chỉ số nhóm tính trước khi gỡ) và ra khỏi nhóm', () => {
    const into = moveNode(nav(), [0], [1], 0);
    expect(labels(into.nav)).toEqual(['Giám sát', 'Xu hướng']);
    expect(into.nav.items[0]!.items!.map((i) => i.label)).toEqual(['Chính', 'Bồn']);
    const out = moveNode(nav(), [1, 0], [], 0);
    expect(labels(out.nav)).toEqual(['Bồn', 'Chính', 'Giám sát', 'Xu hướng']);
  });
  it('sắp xếp trong nhóm', () => {
    const two = addLeaf(nav(), { label: 'B2', screen: 'main' }, screens, { parent: [1] }).nav;
    const r = moveNode(two, [1, 1], [1], 0);
    expect(r.nav.items[1]!.items!.map((i) => i.label)).toEqual(['B2', 'Bồn']);
  });
  it('không lồng nhóm trong nhóm, không vào lá, đường dẫn sai', () => {
    expect(moveNode(nav(), [1], [1], 0).rejected).toBe('nested-group');
    const two: Navigation = {
      items: [
        { label: 'G1', items: [{ label: 'a', screen: 'main' }] },
        { label: 'G2', items: [{ label: 'b', screen: 'tank' }] },
      ],
    };
    expect(moveNode(two, [0], [1], 0).rejected).toBe('nested-group');
    expect(moveNode(nav(), [0], [2], 0).rejected).toBe('not-a-group');
    expect(moveNode(nav(), [9], [], 0).rejected).toBe('bad-path');
    expect(moveNode(nav(), [0], [9], 0).rejected).toBe('bad-path');
  });
  it('số lá không đổi', () => {
    expect(countLeaves(moveNode(nav(), [0], [1], 1).nav)).toBe(3);
  });
});

describe('setScreenAt / setIconAt / setPositionOf', () => {
  it('đổi màn hình đích của lá: chỉ screen có thật', () => {
    expect(setScreenAt(nav(), [0], 'tank', screens).nav.items[0]!.screen).toBe('tank');
    expect(setScreenAt(nav(), [0], 'alarm', screens).rejected).toBe('bad-target');
    expect(setScreenAt(nav(), [0], 'zz', screens).rejected).toBe('bad-target');
    expect(setScreenAt(nav(), [1], 'tank', screens).rejected).toBe('is-group');
    expect(setScreenAt(nav(), [1, 0], 'main', screens).nav.items[1]!.items![0]!.screen).toBe(
      'main',
    );
  });
  it('biểu tượng: trong bộ 16 hoặc null để bỏ', () => {
    expect(setIconAt(nav(), [0], 'pump').nav.items[0]!.icon).toBe('pump');
    expect('icon' in setIconAt(nav(), [0], null).nav.items[0]!).toBe(false);
    expect(setIconAt(nav(), [0], 'rocket').rejected).toBe('bad-icon');
    expect(setIconAt(nav(), [1], 'gear').nav.items[1]!.icon).toBe('gear');
  });
  it('vị trí menu', () => {
    expect(setPositionOf(nav(), 'top').nav.position).toBe('top');
    expect(setPositionOf(nav(), 'hidden').nav.position).toBe('hidden');
    expect(setPositionOf(nav(), 'bottom' as 'left').rejected).toBe('bad-position');
  });
});

describe('removeScreenRefs', () => {
  it('bỏ lá trỏ tới màn hình; nhóm trở thành rỗng cũng bị bỏ', () => {
    const r = removeScreenRefs(nav(), 'tank');
    expect(labels(r)).toEqual(['Chính', 'Xu hướng']);
    expect(labels(removeScreenRefs(nav(), 'main'))).toEqual(['Giám sát', 'Xu hướng']);
  });
  it('không dính tới: trả đúng đối tượng cũ', () => {
    const n = nav();
    expect(removeScreenRefs(n, 'zz')).toBe(n);
  });
  it('nhóm còn lá khác được giữ', () => {
    const n = deepFreeze<Navigation>({
      items: [
        {
          label: 'G',
          items: [
            { label: 'a', screen: 'tank' },
            { label: 'b', screen: 'main' },
          ],
        },
      ],
    });
    expect(removeScreenRefs(n, 'tank').items[0]!.items!.map((i) => i.label)).toEqual(['b']);
  });
});
