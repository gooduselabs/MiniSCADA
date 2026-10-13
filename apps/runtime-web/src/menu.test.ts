// Menu điều hướng (feature 007, FR-013; data-model §7): theo `navigation`; một màn hình thì không có menu; nhóm một cấp;
// biểu tượng từ bộ 16 tên; mọi chữ là chữ.
import { describe, expect, it, vi } from 'vitest';
import { ICON_NAMES, createIcon } from './icons.ts';
import { buildMenu, renderMenu } from './menu.ts';
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
