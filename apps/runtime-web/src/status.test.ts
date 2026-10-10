// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { StatusView, statusModel } from './status.ts';

describe('statusModel', () => {
  it('nhãn theo trạng thái kết nối', () => {
    expect(statusModel({ state: 'connecting', retryAt: null, now: 0 }).label).toBe('Đang kết nối…');
    expect(statusModel({ state: 'live', retryAt: null, now: 0 })).toMatchObject({
      label: 'Trực tuyến',
      tone: 'ok',
      banner: null,
    });
    expect(statusModel({ state: 'offline', retryAt: 5000, now: 2000 })).toMatchObject({
      label: 'Mất kết nối — dữ liệu đang hiển thị là cũ',
      tone: 'bad',
    });
  });

  it('đầy: thông báo Master Plan §10.2 + đếm ngược giây', () => {
    const m = statusModel({ state: 'full', retryAt: 30000, now: 1200 });
    expect(m.tone).toBe('bad');
    expect(m.label).toBe('Đầy');
    expect(m.banner).toEqual({
      text: 'Hệ thống đã đạt tối đa 10 kết nối. Vui lòng thử lại sau.',
      countdownS: 29,
      canRetry: true,
    });
    expect(statusModel({ state: 'full', retryAt: 30000, now: 31000 }).banner?.countdownS).toBe(0);
  });

  it('giao thức không tương thích: không thử lại', () => {
    const m = statusModel({ state: 'incompatible', retryAt: null, now: 0 });
    expect(m.banner?.canRetry).toBe(false);
    expect(m.banner?.text).toMatch(/không tương thích/);
  });
});

describe('StatusView', () => {
  const dom = () => {
    document.body.innerHTML = `
      <span id="badge"></span><span id="updated"></span>
      <div id="banner" hidden><p id="banner-text"></p><span id="banner-count"></span>
      <button id="banner-retry">Thử lại ngay</button></div>`;
    const $ = (id: string) => document.getElementById(id)!;
    return {
      badge: $('badge'),
      updated: $('updated'),
      banner: $('banner'),
      bannerText: $('banner-text'),
      bannerCount: $('banner-count'),
      retry: $('banner-retry') as HTMLButtonElement,
    };
  };

  it('hiện banner đầy với đếm ngược; nút gọi retry', () => {
    const els = dom();
    let retried = 0;
    const v = new StatusView(els, () => retried++);
    v.render({ state: 'full', retryAt: 10_000, now: 0 });
    expect(els.banner.hidden).toBe(false);
    expect(els.bannerText.textContent).toBe(
      'Hệ thống đã đạt tối đa 10 kết nối. Vui lòng thử lại sau.',
    );
    expect(els.bannerCount.textContent).toBe('Tự thử lại sau 10 s');
    expect(els.badge.className).toBe('badge bad');
    els.retry.click();
    expect(retried).toBe(1);
    v.render({ state: 'live', retryAt: null, now: 0, lastUpdate: Date.UTC(2026, 9, 10, 3, 4, 5) });
    expect(els.banner.hidden).toBe(true);
    expect(els.badge.textContent).toBe('Trực tuyến');
    expect(els.updated.textContent).toMatch(/^Cập nhật lúc /);
  });

  it('mất kết nối: badge đỏ, hiện thời điểm cập nhật cuối', () => {
    const els = dom();
    const v = new StatusView(els, () => {});
    v.render({ state: 'offline', retryAt: 1000, now: 0, lastUpdate: 1 });
    expect(els.badge.className).toBe('badge bad');
    expect(els.badge.textContent).toBe('Mất kết nối — dữ liệu đang hiển thị là cũ');
    expect(els.updated.textContent).toMatch(/^Cập nhật cuối /);
    expect(els.banner.hidden).toBe(true);
  });
});
