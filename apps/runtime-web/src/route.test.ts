// Route của trang vận hành (feature 007, FR-015; research R4): `#/<id>`, `?kiosk=1`, id lạ → màn hình đầu kèm thông báo,
// hashchange, Back/Forward qua location.hash, popup không nằm trong URL, chuyển màn hình đóng popup.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router, parseHash, resolveRoute, type ResolvedRoute } from './route.ts';

const SCREENS = ['tong-quan', 'bom1', 'bon-nuoc'];

describe('parseHash', () => {
  it('đọc #/<id>', () => {
    expect(parseHash('#/bom1')).toBe('bom1');
    expect(parseHash('#/bon-nuoc')).toBe('bon-nuoc');
  });
  it('rỗng hoặc sai dạng thì null', () => {
    expect(parseHash('')).toBeNull();
    expect(parseHash('#')).toBeNull();
    expect(parseHash('#/')).toBeNull();
    expect(parseHash('#bom1')).toBeNull();
    expect(parseHash('#/a/b')).toBeNull();
  });
  it('giải mã phần trăm; chuỗi hỏng thì null', () => {
    expect(parseHash('#/b%C3%B4m')).toBe('bôm');
    expect(parseHash('#/%E0%A4%A')).toBeNull();
  });
});

describe('resolveRoute', () => {
  it('rỗng → màn hình đầu, không thông báo', () => {
    const r = resolveRoute('', '', SCREENS, 'tong-quan');
    expect(r).toEqual({ screen: 'tong-quan', kiosk: false, notice: null });
  });
  it('id có thật', () => {
    expect(resolveRoute('#/bom1', '', SCREENS, 'tong-quan').screen).toBe('bom1');
  });
  it('id lạ → màn hình đầu kèm thông báo mang id đã xin', () => {
    const r = resolveRoute('#/khong-co', '', SCREENS, 'tong-quan');
    expect(r.screen).toBe('tong-quan');
    expect(r.notice).toEqual({ kind: 'unknown-screen', id: 'khong-co' });
  });
  it('id của popup không phải đích của route', () => {
    const r = resolveRoute('#/pop', '', SCREENS, 'tong-quan');
    expect(r.screen).toBe('tong-quan');
    expect(r.notice?.kind).toBe('unknown-screen');
  });
  it('kiosk chỉ khi ?kiosk=1', () => {
    expect(resolveRoute('', '?kiosk=1', SCREENS, 'tong-quan').kiosk).toBe(true);
    expect(resolveRoute('', '?kiosk=0', SCREENS, 'tong-quan').kiosk).toBe(false);
    expect(resolveRoute('', '?kiosk=true', SCREENS, 'tong-quan').kiosk).toBe(false);
    expect(resolveRoute('', '?debug=1&kiosk=1', SCREENS, 'tong-quan').kiosk).toBe(true);
  });
});

const nextRoute = (routes: ResolvedRoute[], n: number) =>
  vi.waitFor(() => {
    if (routes.length < n) throw new Error(`chưa đủ ${n} route (có ${routes.length})`);
  });

describe('Router', () => {
  let routes: ResolvedRoute[];
  let popups: Array<string | null>;
  let router: Router;

  beforeEach(() => {
    history.replaceState(null, '', '/');
    routes = [];
    popups = [];
    router = new Router({
      screens: SCREENS,
      entry: 'tong-quan',
      onRoute: (r) => routes.push(r),
      onPopup: (id) => popups.push(id),
    });
  });
  afterEach(() => router.stop());

  it('start() báo route hiện tại, và đặt hash của màn hình đầu khi URL trống', () => {
    router.start();
    expect(routes).toHaveLength(1);
    expect(routes[0].screen).toBe('tong-quan');
    expect(location.hash).toBe('#/tong-quan');
  });

  it('F5: hash có sẵn được giữ', () => {
    history.replaceState(null, '', '/#/bom1');
    router.start();
    expect(routes[0].screen).toBe('bom1');
    expect(location.hash).toBe('#/bom1');
  });

  it('id lạ: màn hình đầu, hash sửa lại, có thông báo', () => {
    history.replaceState(null, '', '/#/xxx');
    router.start();
    expect(routes[0].screen).toBe('tong-quan');
    expect(routes[0].notice).toEqual({ kind: 'unknown-screen', id: 'xxx' });
    expect(location.hash).toBe('#/tong-quan');
  });

  it('hashchange đổi màn hình; thông báo không dính sang route sau', async () => {
    history.replaceState(null, '', '/#/xxx');
    router.start();
    location.hash = '#/bom1';
    await nextRoute(routes, 2);
    expect(routes[1].screen).toBe('bom1');
    expect(routes[1].notice).toBeNull();
  });

  it('go() đặt location.hash và báo một lần', async () => {
    router.start();
    router.go('bon-nuoc');
    expect(location.hash).toBe('#/bon-nuoc');
    await nextRoute(routes, 2);
    await new Promise((r) => setTimeout(r, 20));
    expect(routes.map((r) => r.screen)).toEqual(['tong-quan', 'bon-nuoc']);
  });

  it('go() tới màn hình đang hiện không báo lại', async () => {
    router.start();
    router.go('tong-quan');
    await new Promise((r) => setTimeout(r, 20));
    expect(routes).toHaveLength(1);
  });

  it('Back và Forward đi qua lịch sử của location.hash', async () => {
    router.start();
    router.go('bom1');
    await nextRoute(routes, 2);
    router.go('bon-nuoc');
    await nextRoute(routes, 3);
    history.back();
    await nextRoute(routes, 4);
    expect(routes[3].screen).toBe('bom1');
    history.forward();
    await nextRoute(routes, 5);
    expect(routes[4].screen).toBe('bon-nuoc');
  });

  it('kiosk đọc từ query lúc start và giữ trong mọi route', async () => {
    history.replaceState(null, '', '/?kiosk=1');
    router.start();
    router.go('bom1');
    await nextRoute(routes, 2);
    expect(routes.every((r) => r.kiosk)).toBe(true);
  });

  it('popup không nằm trong URL', () => {
    router.start();
    const before = location.href;
    router.openPopup('pop');
    expect(location.href).toBe(before);
    expect(router.popup).toBe('pop');
    expect(popups).toEqual(['pop']);
    router.closePopup();
    expect(router.popup).toBeNull();
    expect(popups).toEqual(['pop', null]);
    router.closePopup(); // đóng khi chưa mở: không báo
    expect(popups).toEqual(['pop', null]);
  });

  it('chuyển màn hình đóng popup (go và hashchange)', async () => {
    router.start();
    router.openPopup('pop');
    router.go('bom1');
    expect(router.popup).toBeNull();
    expect(popups).toEqual(['pop', null]);
    router.openPopup('pop');
    location.hash = '#/bon-nuoc';
    await vi.waitFor(() => expect(router.popup).toBeNull());
    expect(popups).toEqual(['pop', null, 'pop', null]);
  });

  it('stop() gỡ người nghe hashchange', async () => {
    router.start();
    router.stop();
    location.hash = '#/bom1';
    await new Promise((r) => setTimeout(r, 20));
    expect(routes).toHaveLength(1);
  });
});
