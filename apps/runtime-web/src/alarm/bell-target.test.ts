// Feature 041: đích của "Xem tất cả alarm".
import { describe, expect, it } from 'vitest';
import type { MenuModel } from '../menu.ts';
import { alarmListRank, bellTarget, menuScreens } from './bell-target.ts';

const list = (props: Record<string, unknown> = {}) => ({
  type: 'widget',
  id: 'a',
  widget: 'alarm-list',
  props,
});
const screens: Record<string, { items: unknown[] }> = {
  home: { items: [{ type: 'widget', id: 'c', widget: 'card' }] },
  over: { items: [list()] },
  hist: { items: [list({ source: 'history', mode: 'full' })] },
  alm: { items: [list({ mode: 'full' })] },
};
const load = (id: string) =>
  screens[id] ? Promise.resolve(screens[id] as never) : Promise.reject(new Error(id));

const menu = (...ids: string[]): MenuModel => ({
  position: 'left',
  entries: [
    { kind: 'item', label: 'Alarm', screen: 'alarms', system: true },
    { kind: 'group', label: 'G', items: ids.map((s) => ({ label: s, screen: s })) },
  ],
});

describe('bellTarget', () => {
  it('ưu tiên màn hình có alarm-list Đầy đủ (bỏ qua kiểu Lịch sử)', async () => {
    expect(await bellTarget(menu('home', 'over', 'hist', 'alm'), load)).toBe('alm');
  });
  it('chỉ có kiểu Gọn: màn hình đó', async () => {
    expect(await bellTarget(menu('home', 'over', 'hist'), load)).toBe('over');
  });
  it('không có màn hình nào: trang hệ thống alarms (kể cả menu không có mục đó)', async () => {
    expect(await bellTarget(menu('home', 'hist', 'missing'), load)).toBe('alarms');
    expect(await bellTarget(null, load)).toBe('alarms');
  });
  it('menuScreens bỏ trang hệ thống và trang @', () => {
    const m = menu('home', '@history');
    expect(menuScreens(m)).toEqual(['home']);
  });
  it('alarmListRank', () => {
    expect(alarmListRank({ items: [] } as never)).toBe(0);
    expect(alarmListRank(screens.over as never)).toBe(1);
    expect(alarmListRank(screens.alm as never)).toBe(2);
    expect(alarmListRank(screens.hist as never)).toBe(0);
  });
});
