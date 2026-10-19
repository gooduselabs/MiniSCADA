// Feature 013: route `#/quan-tri[/<tab>]` của trang Quản trị, route bị từ chối (không có quyền) giữ hash, menu lọc theo
// quyền và có mục Quản trị cho administrator.
import { afterEach, describe, expect, it } from 'vitest';
import { buildMenu } from './menu.ts';
import type { ScreenSummary } from './project-store.ts';
import { Router, pageKey, parsePageHash, type PageRoute, type ResolvedRoute } from './route.ts';

describe('parsePageHash: Quản trị', () => {
  it('#/quan-tri và #/quan-tri/<tab>', () => {
    expect(parsePageHash('#/quan-tri')).toMatchObject({ kind: 'admin', tab: null });
    expect(parsePageHash('#/quan-tri/nhom')).toMatchObject({ kind: 'admin', tab: 'nhom' });
    expect(parsePageHash('#/quan-tri/nhat-ky?u=vh1')?.params.get('u')).toBe('vh1');
  });
  it('tab sai dạng → null', () => {
    expect(parsePageHash('#/quan-tri/A')).toBeNull();
    expect(parsePageHash('#/quan-tri/a/b')).toBeNull();
  });
  it('khóa menu @quan-tri', () => {
    expect(pageKey(parsePageHash('#/quan-tri/nhom')!)).toBe('@quan-tri');
  });
});

describe('Router: deny', () => {
  let router: Router | null = null;
  afterEach(() => router?.stop());

  it('id không có trong danh sách và deny(id) → route denied, giữ hash', () => {
    history.replaceState(null, '', '/#/bao-tri');
    const routes: ResolvedRoute[] = [];
    router = new Router({
      screens: ['tong-quan'],
      entry: 'tong-quan',
      onRoute: (r) => routes.push(r),
      deny: (id) => id === 'bao-tri',
    });
    router.start();
    expect(routes[0]).toMatchObject({ screen: 'bao-tri', denied: true, notice: null });
    expect(location.hash).toBe('#/bao-tri');
  });

  it('deny trả false: như cũ (màn hình đầu, thông báo id lạ)', () => {
    history.replaceState(null, '', '/#/zz');
    const routes: ResolvedRoute[] = [];
    router = new Router({
      screens: ['tong-quan'],
      entry: 'tong-quan',
      onRoute: (r) => routes.push(r),
      deny: () => false,
    });
    router.start();
    expect(routes[0]).toMatchObject({ screen: 'tong-quan', notice: { id: 'zz' } });
    expect(routes[0]?.denied).toBeUndefined();
  });

  it('resync báo lại route hiện tại (quyền đổi)', () => {
    history.replaceState(null, '', '/#/tong-quan');
    const routes: ResolvedRoute[] = [];
    const pages: PageRoute[] = [];
    router = new Router({
      screens: ['tong-quan'],
      entry: 'tong-quan',
      onRoute: (r) => routes.push(r),
      onPage: (p) => pages.push(p),
    });
    router.start();
    router.resync();
    expect(routes).toHaveLength(2);
    history.replaceState(null, '', '/#/quan-tri/nhom');
    router.resync();
    router.resync();
    expect(pages).toHaveLength(2);
  });
});

const scr = (id: string): ScreenSummary => ({ id, name: id.toUpperCase(), kind: 'screen' });

describe('buildMenu: quyền (013)', () => {
  const nav = {
    position: 'left' as const,
    items: [
      { label: 'A', screen: 'a' },
      {
        label: 'Nhóm',
        items: [
          { label: 'B', screen: 'b' },
          { label: 'C', screen: 'c' },
        ],
      },
    ],
  };
  it('canView bỏ mục và nhóm rỗng', () => {
    const m = buildMenu(nav, [scr('a'), scr('b'), scr('c')], { canView: (id) => id !== 'b' })!;
    expect(JSON.stringify(m.entries)).not.toContain('"b"');
    const m2 = buildMenu(nav, [scr('a'), scr('b'), scr('c')], {
      canView: (id) => id === 'a',
      admin: true,
    })!;
    expect(m2.entries.map((e) => e.label)).toEqual(['A', 'Quản trị']);
  });
  it('admin: mục Quản trị cuối menu, kể cả khi chỉ có một màn hình', () => {
    const m = buildMenu(null, [scr('a')], { admin: true })!;
    expect(m.entries.at(-1)).toMatchObject({
      screen: '@quan-tri',
      label: 'Quản trị',
      icon: 'gear',
    });
  });
  it('không admin: không có mục Quản trị', () => {
    const m = buildMenu(nav, [scr('a'), scr('b'), scr('c')])!;
    expect(JSON.stringify(m)).not.toContain('quan-tri');
  });
});
