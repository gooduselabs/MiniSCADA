// T088: <mat-screen> với widget lịch sử: nhận HistorySource từ nơi chứa (kể cả popup), không đăng ký live và không tính
// vào tập Tag của màn hình (giới hạn 1.000 Tag của 007).
import { afterEach, describe, expect, it } from 'vitest';
import type { Item, ScreenModel, WidgetItem } from '@mat/project-schema';
import { FakeActionHost, MemoryTagSource } from '../host/memory-source.ts';
import { FakeHistorySource } from '../host/fake-history-source.ts';
import { collectTagIds, itemTagIds } from './layers.ts';
import { registerScreen, type MatScreen } from './mat-screen.ts';

registerScreen();

const hw = (id: string, widget: string, tags: Record<string, string | string[]>): WidgetItem => ({
  type: 'widget',
  id,
  widget,
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  tags,
  props: { group: 'ap-suat' },
});
const card = (id: string, tag: string): WidgetItem => ({
  type: 'widget',
  id,
  widget: 'card',
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  tags: { value: tag },
});
const screenOf = (id: string, items: Item[], kind: 'screen' | 'popup' = 'screen'): ScreenModel => ({
  schemaVersion: '0.3.0',
  id,
  name: id,
  kind,
  size: { width: 1000, height: 500 },
  items,
});

describe('itemTagIds với widget lịch sử', () => {
  it('bốn widget lịch sử không đóng góp Tag live, widget thường vẫn có', () => {
    for (const w of ['history-trend', 'history-table', 'history-bar', 'history-pie']) {
      expect(itemTagIds(hw('a', w, { series: ['T1', 'T2'], columns: ['T3'] }))).toEqual([]);
    }
    expect(itemTagIds(card('c', 'T9'))).toEqual(['T9']);
  });

  it('collectTagIds chỉ gom Tag của widget thường', () => {
    const s = screenOf('s', [hw('a', 'history-trend', { series: ['T1'] }), card('c', 'T9')]);
    expect(collectTagIds([s])).toEqual(['T9']);
  });
});

describe('<mat-screen> cấp HistorySource', () => {
  afterEach(() => document.body.replaceChildren());

  async function setup(items: Item[], history: FakeHistorySource | undefined) {
    const el = document.createElement('mat-screen') as MatScreen;
    el.screen = screenOf('s', items);
    el.tags = new MemoryTagSource({ now: 1_790_000_000_000 });
    el.host = new FakeActionHost();
    el.history = history;
    el.viewport = { width: 1000, height: 500 };
    el.env = { raf: (cb) => (cb(), 0), cancelRaf: () => {}, ResizeObserver: undefined };
    document.body.append(el);
    await el.updateComplete;
    await el.whenReady();
    return el;
  }

  const widgetEl = (el: MatScreen, id: string) =>
    el.shadowRoot!.querySelector(`[data-item-id="${id}"] > *`) as HTMLElement & {
      history?: unknown;
    };

  it('widget lịch sử nhận history; widget thường thì không', async () => {
    const h = new FakeHistorySource();
    const el = await setup(
      [hw('t', 'history-trend', { series: ['LINE1.PRESS'] }), card('c', 'T9')],
      h,
    );
    expect(widgetEl(el, 't').history).toBe(h);
    expect(widgetEl(el, 'c').history).toBeUndefined();
  });

  it('đổi nguồn lịch sử cập nhật widget đang có; tagIds của màn hình không có Tag lịch sử', async () => {
    const h1 = new FakeHistorySource();
    const el = await setup([hw('t', 'history-table', { columns: ['LINE1.PRESS'] })], h1);
    expect(el.tagIds()).toEqual([]);
    const h2 = new FakeHistorySource();
    el.history = h2;
    await el.whenReady();
    expect(widgetEl(el, 't').history).toBe(h2);
  });

  it('không có nguồn: widget hiện "xem trước", không ném lỗi', async () => {
    const el = await setup([hw('t', 'history-trend', { series: ['LINE1.PRESS'] })], undefined);
    const w = widgetEl(el, 't');
    await (w as unknown as { updateComplete: Promise<boolean> }).updateComplete;
    expect(w.shadowRoot!.textContent).toContain('Chưa có nguồn lịch sử');
  });
});
