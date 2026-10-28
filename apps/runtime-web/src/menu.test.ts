// Menu điều hướng (feature 007, FR-013; data-model §7): theo `navigation`; một màn hình thì không có menu; nhóm một cấp;
// biểu tượng từ bộ 16 tên; mọi chữ là chữ.
import { describe, expect, it, vi } from 'vitest';
import { ICON_NAMES, createIcon } from './icons.ts';
import { buildMenu, legacySystemMenu, renderMenu } from './menu.ts';
import type { ScreenSummary } from './project-store.ts';

const scr = (id: string, kind: 'screen' | 'popup' = 'screen'): ScreenSummary => ({
  id,
  name: id.toUpperCase(),
  kind,
});
const SCREENS = [scr('a'), scr('b'), scr('c'), scr('pop', 'popup')];

describe('buildMenu', () => {
  it('một màn hình (popup không tính) → không menu', () => {
    expect(buildMenu(null, [scr('a'), scr('p', 'popup')])).toBeNull();
    expect(
      buildMenu({ position: 'left', items: [{ label: 'A', screen: 'a' }] }, [scr('a')]),
    ).toBeNull();
  });

  it('không có navigation: danh sách tự động mọi màn hình (bỏ popup), bên trái', () => {
    const m = buildMenu(null, SCREENS)!;
    expect(m.position).toBe('left');
    expect(m.entries.map((e) => (e.kind === 'item' ? e.screen : '?'))).toEqual(['a', 'b', 'c']);
    expect(m.entries[0]).toMatchObject({ label: 'A' });
  });

  it('position hidden → không menu', () => {
    expect(
      buildMenu({ position: 'hidden', items: [{ label: 'A', screen: 'a' }] }, SCREENS),
    ).toBeNull();
  });

  it('theo navigation: mục lá, nhóm một cấp, biểu tượng hợp lệ', () => {
    const m = buildMenu(
      {
        position: 'top',
        items: [
          { label: ' Tổng quan ', screen: 'a', icon: 'home' },
          {
            label: 'Giám sát',
            icon: 'chart',
            items: [
              { label: 'B', screen: 'b', icon: 'table' },
              { label: 'C', screen: 'c' },
            ],
          },
        ],
      },
      SCREENS,
    )!;
    expect(m.position).toBe('top');
    expect(m.entries[0]).toEqual({ kind: 'item', label: 'Tổng quan', screen: 'a', icon: 'home' });
    expect(m.entries[1]).toMatchObject({ kind: 'group', label: 'Giám sát', icon: 'chart' });
    expect((m.entries[1] as { items: unknown[] }).items).toHaveLength(2);
  });

  it('bỏ mục trỏ màn hình không có hoặc là popup; nhóm rỗng bị bỏ; icon lạ bị bỏ', () => {
    const m = buildMenu(
      {
        position: 'left',
        items: [
          { label: 'A', screen: 'a', icon: 'khong-co' as never },
          { label: 'Ma', screen: 'ma' },
          { label: 'Pop', screen: 'pop' },
          { label: 'Nhóm rỗng', items: [{ label: 'x', screen: 'zzz' }] },
          { label: 'B', screen: 'b' },
        ],
      },
      SCREENS,
    )!;
    expect(m.entries.map((e) => e.label)).toEqual(['A', 'B']);
    expect((m.entries[0] as { icon?: string }).icon).toBeUndefined();
  });

  it('navigation không còn mục hợp lệ nào → danh sách tự động', () => {
    const m = buildMenu({ position: 'left', items: [{ label: 'x', screen: 'zzz' }] }, SCREENS)!;
    expect(m.entries).toHaveLength(3);
  });
});

describe('icons', () => {
  it('đủ 16 tên, mỗi tên ra một <svg> aria-hidden có path', () => {
    expect(ICON_NAMES).toHaveLength(16);
    for (const n of ICON_NAMES) {
      const svg = createIcon(n);
      expect(svg.tagName.toLowerCase()).toBe('svg');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.querySelector('path')?.getAttribute('d')).toBeTruthy();
    }
  });
});

describe('renderMenu', () => {
  const model = buildMenu(
    {
      position: 'left',
      items: [
        { label: 'Tổng quan', screen: 'a', icon: 'home' },
        {
          label: 'Giám sát',
          items: [
            { label: 'Bồn', screen: 'b' },
            { label: '<b>c</b>', screen: 'c' },
          ],
        },
      ],
    },
    SCREENS,
  )!;

  it('nút cho mỗi mục lá, tiêu đề nhóm, aria-current ở mục đang hiện', () => {
    const nav = renderMenu(model, 'b', () => {}, 'Điều hướng');
    expect(nav.tagName).toBe('NAV');
    expect(nav.getAttribute('aria-label')).toBe('Điều hướng');
    const btns = [...nav.querySelectorAll('button')];
    expect(btns.map((b) => b.textContent?.trim())).toEqual(['Tổng quan', 'Bồn', '<b>c</b>']);
    expect(btns.map((b) => b.getAttribute('aria-current'))).toEqual([null, 'page', null]);
    expect(nav.querySelector('.grp')?.textContent).toBe('Giám sát');
    expect(nav.querySelector('b')).toBeNull(); // nhãn là chữ
    expect(btns[0].querySelector('svg')).not.toBeNull();
  });

  it('nhấp gọi onSelect(id màn hình)', () => {
    const onSelect = vi.fn();
    const nav = renderMenu(model, 'a', onSelect, 'x');
    (nav.querySelectorAll('button')[2] as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('nhóm là danh sách lồng được gắn nhãn bằng tiêu đề', () => {
    const nav = renderMenu(model, 'a', () => {}, 'x');
    const grp = nav.querySelector('.grp')!;
    const inner = nav.querySelector('ul ul')!;
    expect(inner.getAttribute('aria-labelledby')).toBe(grp.id);
  });
});

describe('trang hệ thống trong menu (feature 030: chỉ theo navigation; ui-alarm.md §11)', () => {
  const SYS = {
    position: 'left',
    items: [
      { label: 'A', screen: 'a' },
      { label: 'Cảnh báo', system: 'alarms' },
      {
        label: 'Hệ thống',
        items: [
          { label: 'Lịch sử alarm', system: 'alarm-history' },
          { label: 'Lịch sử', system: 'history' },
          { label: 'Công thức', system: 'recipes', icon: 'table' },
          { label: 'Quản trị', system: 'admin' },
        ],
      },
    ],
  } as const;
  const leaves = (m: ReturnType<typeof buildMenu>) =>
    (m?.entries ?? []).flatMap((e) => (e.kind === 'item' ? [e] : e.items));

  it('không khai báo navigation: không tự thêm trang hệ thống nào', () => {
    const m = buildMenu(null, SCREENS, { show: true, history: true, recipes: true, admin: true })!;
    expect(leaves(m).map((l) => l.screen)).toEqual(['a', 'b', 'c']);
    expect(buildMenu(null, [scr('a')], { show: true, admin: true })).toBeNull();
  });
  it('mục system theo thứ tự, nhãn và icon cấu hình; icon mặc định khi thiếu; huy hiệu chỉ ở Alarm', () => {
    const m = buildMenu(SYS as never, SCREENS, {
      show: true,
      history: true,
      recipes: true,
      admin: true,
    })!;
    expect(leaves(m).map((l) => [l.screen, l.label, l.icon])).toEqual([
      ['a', 'A', undefined],
      ['alarms', 'Cảnh báo', 'bell'],
      ['alarm-history', 'Lịch sử alarm', 'list'],
      ['@history', 'Lịch sử', 'chart'],
      ['@recipes', 'Công thức', 'table'],
      ['@quan-tri', 'Quản trị', 'gear'],
    ]);
    const nav = renderMenu(m, 'a', () => undefined, 'Menu');
    expect(nav.querySelectorAll('[data-badge="alarms"]')).toHaveLength(1);
    expect((nav.querySelector('[data-badge="alarms"]') as HTMLElement).hidden).toBe(true);
  });
  it('tính năng không có: mục bị bỏ (Quản trị chỉ với administrator)', () => {
    const plain = buildMenu(SYS as never, SCREENS, {});
    expect(plain).toBeNull();
    const admin = buildMenu(SYS as never, SCREENS, { admin: true })!;
    expect(leaves(admin).map((l) => l.screen)).toEqual(['a', '@quan-tri']);
  });
  it('mục system id lạ bị bỏ (lớp phòng thủ)', () => {
    const nav = {
      position: 'left',
      items: [
        { label: 'A', screen: 'a' },
        { label: 'X', system: 'toString' },
        { label: 'B', screen: 'b' },
      ],
    } as never;
    expect(leaves(buildMenu(nav, SCREENS, { admin: true })).map((l) => l.screen)).toEqual([
      'a',
      'b',
    ]);
  });
  it('một trang hệ thống đơn lẻ vẫn là menu', () => {
    const nav = { position: 'top', items: [{ label: 'Alarm', system: 'alarms' }] } as never;
    expect(buildMenu(nav, [scr('a')], { show: true })!.entries).toHaveLength(1);
  });
  it('position hidden: không menu, kể cả administrator', () => {
    expect(buildMenu({ ...SYS, position: 'hidden' } as never, SCREENS, { admin: true })).toBeNull();
  });
  it('thiết bị chưa hỗ trợ: chú thích "chưa hỗ trợ", không huy hiệu', () => {
    const m = buildMenu(SYS as never, SCREENS, { show: true, unsupported: true })!;
    const nav = renderMenu(m, 'a', () => undefined, 'Menu');
    expect(nav.querySelector('[data-badge]')).toBeNull();
    expect(nav.textContent).toContain('(chưa hỗ trợ)');
  });
});

describe('project dưới 1.1 (feature 030: legacySystem giữ cách tự thêm cũ)', () => {
  it('legacySystemMenu: dưới 1.1 hoặc không rõ là true; 1.1 trở lên là false', () => {
    expect(['0.5.0', '0.6.2', '1.0.0', undefined, 'x'].map(legacySystemMenu)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(['1.1.0', '1.12.3', '2.0.0'].map(legacySystemMenu)).toEqual([false, false, false]);
  });
  it('tự thêm Alarm, Lịch sử alarm, Lịch sử, Công thức, Quản trị cuối menu khi tính năng có', () => {
    const m = buildMenu(null, SCREENS, {
      legacySystem: true,
      show: true,
      history: true,
      admin: true,
    })!;
    expect(m.entries.map((e) => (e.kind === 'item' ? e.screen : '?'))).toEqual([
      'a',
      'b',
      'c',
      'alarms',
      'alarm-history',
      '@history',
      '@quan-tri',
    ]);
  });
  it('navigation.alarms = false ẩn hai mục alarm', () => {
    const nav = { position: 'left', items: [{ label: 'A', screen: 'a' }], alarms: false } as never;
    const m = buildMenu(nav, SCREENS, { legacySystem: true, show: true });
    expect(m).toBeNull();
  });
  it('một màn hình mà có alarm: vẫn có menu', () => {
    const m = buildMenu(null, [scr('a')], { legacySystem: true, show: true })!;
    expect(m.entries.map((e) => e.label)).toEqual(['A', 'Alarm', 'Lịch sử alarm']);
  });
});
