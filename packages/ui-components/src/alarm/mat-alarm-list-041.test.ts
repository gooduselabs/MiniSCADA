// Feature 041: Bảng alarm kiểu Đầy đủ (chính bảng của trang Alarm hệ thống) và kiểu Lịch sử (bảng của trang Lịch sử alarm).
import { afterEach, describe, expect, it } from 'vitest';
import type { WidgetItem } from '@mat/project-schema';
import { FakeActionHost, MemoryAlarmSource, MemoryTagSource } from '../host/memory-source.ts';
import { registerWidgets } from '../widgets/register.ts';
import { AREAS, CLASSES, inst } from '../fixtures/alarm-fixtures.ts';
import { previewHistoryFetch } from './panels/history-preview.ts';

afterEach(() => document.body.replaceChildren());
const frame = (ms = 40) => new Promise<void>((r) => setTimeout(r, ms));
type El = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<
    string,
    unknown
  >;

const item = (props: Record<string, unknown> = {}): WidgetItem =>
  ({
    type: 'widget',
    id: 'w1',
    widget: 'alarm-list',
    x: 0,
    y: 0,
    width: 640,
    height: 400,
    props,
  }) as WidgetItem;

const LIST = () => [
  inst({
    id: 'A',
    area: 'bon',
    class: 'critical',
    priority: 'critical',
    tsActive: 9,
    text: 'Mức bồn',
  }),
  inst({ id: 'B', area: null, class: 'major', priority: 'major', tsActive: 8, text: 'Bơm' }),
  inst({
    id: 'C',
    area: 'dien',
    class: 'minor',
    priority: 'minor',
    tsActive: 7,
    state: 'ACTIVE_ACK',
    text: 'Điện áp',
  }),
  inst({
    id: 'S',
    class: 'critical',
    priority: 'critical',
    state: 'ACTIVE_UNACK',
    shelved: { until: 9, remainingMs: 1000, reason: 'r', user: 'u', system: false },
  }),
];

function source(withHistory = false): MemoryAlarmSource {
  const s = new MemoryAlarmSource({
    instances: LIST(),
    classes: CLASSES,
    areas: AREAS,
    status: 'live',
    now: 1_000_000,
  });
  if (withHistory)
    (s as unknown as { historyFetch: unknown }).historyFetch = previewHistoryFetch(s);
  return s;
}

async function mount(
  props: Record<string, unknown>,
  alarms = source(),
  host = new FakeActionHost({ session: { user: 'vh', role: 'operator' } }),
): Promise<{ el: El; host: FakeActionHost }> {
  registerWidgets();
  const el = document.createElement('mat-w-alarm-list') as El;
  el.item = item(props);
  el.source = new MemoryTagSource({ now: 1 });
  el.host = host;
  el.mode = 'run';
  el.context = { screen: 's1', widget: 'w1' };
  el.alarms = alarms;
  document.body.append(el);
  await el.updateComplete;
  await frame();
  return { el, host };
}

const table = (el: El) =>
  el.shadowRoot.querySelector('mat-alarm-table') as
    (HTMLElement & { shadowRoot: ShadowRoot }) | null;
const rowIds = (el: El) =>
  [...(table(el)?.shadowRoot.querySelectorAll<HTMLElement>('tbody tr[data-id]') ?? [])].map(
    (r) => r.dataset.id,
  );
const values = (el: El, sel: string) =>
  [...el.shadowRoot.querySelectorAll<HTMLOptionElement>(`${sel} option`)].map((o) => o.value);

describe('alarm-list kiểu Gọn (mặc định)', () => {
  it('không có tab, bộ lọc của trang; có Xác nhận tất cả', async () => {
    const { el } = await mount({});
    expect(el.shadowRoot.querySelector('.al-tabs')).toBeNull();
    expect(el.shadowRoot.querySelector('[data-act="ack-all"]')).not.toBeNull();
    expect(rowIds(el)).toEqual(['A', 'B', 'C']);
  });
});

describe('alarm-list kiểu Đầy đủ', () => {
  it('có tab Đang có/Tạm ẩn, bộ lọc, Xóa lọc, nút Xác nhận/Xác nhận tất cả/Tạm ẩn', async () => {
    const { el } = await mount({ mode: 'full' });
    const r = el.shadowRoot;
    const tabs = [...r.querySelectorAll('.al-tabs button')].map((b) => b.textContent);
    expect(tabs).toEqual(['Đang có (3)', 'Tạm ẩn (1)']);
    for (const f of ['area', 'cls', 'prio', 'state'])
      expect(r.querySelector(`select[data-f="${f}"]`)).not.toBeNull();
    for (const a of ['clear', 'ack', 'ackall', 'shelve'])
      expect(r.querySelector(`[data-act="${a}"]`)).not.toBeNull();
    expect(r.querySelector('h2')).toBeNull();
    expect(rowIds(el).sort()).toEqual(['A', 'B', 'C']);
    (r.querySelector('.al-tabs button[data-tab="shelved"]') as HTMLButtonElement).click();
    await frame();
    expect(rowIds(el)).toEqual(['S']);
  });

  it('bộ lọc cố định (khu vực, mức) vẫn áp dụng; danh sách chọn chỉ trong phạm vi cố định', async () => {
    const { el } = await mount({ mode: 'full', areas: ['bon', 'dien'], minPriority: 'minor' });
    expect(rowIds(el).sort()).toEqual(['A', 'C']);
    expect(values(el, 'select[data-f="area"]')).toEqual(['', 'bon', 'dien']);
    expect(values(el, 'select[data-f="prio"]')).toEqual(['', 'critical', 'major', 'minor']);
    const q = el.shadowRoot.querySelector('input[type="search"]') as HTMLInputElement;
    q.value = 'dien ap';
    q.dispatchEvent(new Event('input'));
    await frame();
    expect(rowIds(el)).toEqual(['C']);
  });

  it('Xác nhận tất cả: hộp thoại trong shadow root, gửi bộ lọc gồm phạm vi cố định', async () => {
    const { el, host } = await mount({ mode: 'full', areas: ['bon'] });
    (el.shadowRoot.querySelector('[data-act="ackall"]') as HTMLButtonElement).click();
    await frame();
    const dlg = el.shadowRoot.querySelector('[role="dialog"]');
    expect(dlg).not.toBeNull();
    (dlg!.querySelector('[data-act="confirm"]') as HTMLButtonElement).click();
    await frame();
    const req = host.ackCalls[0] as unknown as { all: true; filter: { areas: string[] } };
    expect(req.all).toBe(true);
    expect(req.filter.areas).toEqual(['bon']);
  });

  it('không giữ bộ lọc vào sessionStorage (khác trang hệ thống)', async () => {
    sessionStorage.clear();
    const { el } = await mount({ mode: 'full' });
    const s = el.shadowRoot.querySelector('select[data-f="prio"]') as HTMLSelectElement;
    s.value = 'critical';
    s.dispatchEvent(new Event('change'));
    expect(sessionStorage.length).toBe(0);
  });
});

describe('alarm-list kiểu Lịch sử', () => {
  it('Đầy đủ: khoảng thời gian, bộ lọc, Xuất CSV; dòng từ nguồn lịch sử', async () => {
    const { el } = await mount({ source: 'history', mode: 'full' }, source(true));
    await frame(60);
    const r = el.shadowRoot;
    expect(r.querySelector('[data-range="24h"]')).not.toBeNull();
    expect(r.querySelector('[data-act="csv"]')).not.toBeNull();
    expect(r.querySelectorAll('.al-hist tbody tr').length).toBeGreaterThan(0);
  });

  it('Gọn: chỉ bảng, tối đa maxRows dòng gần nhất', async () => {
    const { el } = await mount({ source: 'history', maxRows: 2 }, source(true));
    await frame(60);
    const r = el.shadowRoot;
    expect(r.querySelector('[data-range]')).toBeNull();
    expect(r.querySelectorAll('.al-hist tbody tr').length).toBe(2);
  });

  it('khu vực cố định (một khu vực) gửi lên API', async () => {
    const urls: string[] = [];
    const s = source();
    const real = previewHistoryFetch(s);
    (s as unknown as { historyFetch: unknown }).historyFetch = (u: string) => {
      urls.push(u);
      return real(u);
    };
    await mount({ source: 'history', mode: 'full', areas: ['bon'] }, s);
    await frame(60);
    expect(urls[0]).toContain('area=bon');
  });
});
