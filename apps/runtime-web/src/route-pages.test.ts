// T087: trang lịch sử và báo cáo trên route (feature 010): `#/history[?…]`, `#/report/<id>[?…]`, khóa menu `@…`,
// chuyển qua lại với màn hình, F5 giữ đường dẫn, id màn hình tên `history` thắng trang.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Router, pageKey, parsePageHash, type PageRoute, type ResolvedRoute } from './route.ts';

describe('parsePageHash', () => {
  it('trang lịch sử và tham số', () => {
    const p = parsePageHash('#/history?g=ap-suat&t=A,B&r=24h');
    expect(p?.kind).toBe('history');
    expect(p?.params.get('g')).toBe('ap-suat');
    expect(p?.params.get('t')).toBe('A,B');
    expect(parsePageHash('#/history')?.params.toString()).toBe('');
  });

  it('trang báo cáo: id và kỳ', () => {
    const p = parsePageHash('#/report/dien-ca?d=2026-10-12');
    expect(p).toMatchObject({ kind: 'report', id: 'dien-ca' });
    expect(p?.params.get('d')).toBe('2026-10-12');
    expect(parsePageHash('#/report/dien-thang?m=2026-10')?.params.get('m')).toBe('2026-10');
  });

  it('sai dạng thì null: id lạ, thiếu id, ký tự cấm, phần trăm hỏng, màn hình thường', () => {
    for (const h of [
      '',
      '#/',
      '#/report',
      '#/report/',
      '#/report/Dien',
      '#/report/a/b',
      '#/report/%E0%A4%A',
      '#/report/<script>',
      '#/historyx',
      '#/bom1',
      'history',
    ])
      expect(parsePageHash(h), h).toBeNull();
  });

  it('pageKey', () => {
    expect(pageKey(parsePageHash('#/history')!)).toBe('@history');
    expect(pageKey(parsePageHash('#/report/x1')!)).toBe('@report/x1');
  });
});

describe('Router với trang', () => {
  let routes: ResolvedRoute[];
  let pages: PageRoute[];
  let router: Router;
  const mk = (screens = ['tong-quan', 'bom1']) =>
    new Router({
      screens,
      entry: 'tong-quan',
      onRoute: (r) => routes.push(r),
      onPage: (p) => pages.push(p),
    });

  beforeEach(() => {
    history.replaceState(null, '', '/');
    routes = [];
    pages = [];
    router = mk();
  });
  afterEach(() => router.stop());

  it('F5 trên #/report/<id>?d=… báo trang, không đổi hash, không báo màn hình', () => {
    history.replaceState(null, '', '/#/report/dien-ca?d=2026-10-12');
    router.start();
    expect(routes).toHaveLength(0);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ kind: 'report', id: 'dien-ca' });
    expect(location.hash).toBe('#/report/dien-ca?d=2026-10-12');
    expect(router.current).toBe('@report/dien-ca');
  });

  it('go("@history") đặt hash và báo trang đúng một lần (hashchange sau đó bị bỏ)', async () => {
    router.start();
    router.go('@history');
    await new Promise((r) => setTimeout(r, 10));
    expect(location.hash).toBe('#/history');
    expect(pages.filter((p) => p.kind === 'history')).toHaveLength(1);
  });

  it('từ trang sang màn hình và ngược lại', async () => {
    router.start();
    router.go('@report/dien-ca');
    router.go('bom1');
    await new Promise((r) => setTimeout(r, 10));
    expect(routes.at(-1)?.screen).toBe('bom1');
    router.go('@report/dien-ca');
    expect(pages.at(-1)).toMatchObject({ kind: 'report', id: 'dien-ca' });
  });

  it('không có onPage: #/history là id màn hình lạ như trước', () => {
    router.stop();
    history.replaceState(null, '', '/#/history');
    const r2: ResolvedRoute[] = [];
    const legacy = new Router({
      screens: ['tong-quan'],
      entry: 'tong-quan',
      onRoute: (r) => r2.push(r),
    });
    legacy.start();
    expect(r2[0]?.notice).toEqual({ kind: 'unknown-screen', id: 'history' });
    legacy.stop();
  });

  it('màn hình của project tên "history" thắng trang lịch sử', () => {
    router.stop();
    history.replaceState(null, '', '/#/history');
    router = mk(['tong-quan', 'history']);
    router.start();
    expect(routes[0]?.screen).toBe('history');
    expect(pages).toHaveLength(0);
  });

  it('popup đóng khi vào trang', () => {
    const ps: Array<string | null> = [];
    router.stop();
    router = new Router({
      screens: ['tong-quan'],
      entry: 'tong-quan',
      onRoute: () => {},
      onPage: () => {},
      onPopup: (id) => ps.push(id),
    });
    router.start();
    router.openPopup('pop');
    router.go('@history');
    expect(ps).toEqual(['pop', null]);
  });
});
