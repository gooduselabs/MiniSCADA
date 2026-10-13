// T079 (phần bảng): history-table: phân trang theo seq, thứ tự, đổi khoảng, định dạng giá trị (bảng giá trị, đơn vị),
// liên kết Xuất CSV đúng tham số, trạng thái FR-035.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetItem } from '@mat/project-schema';
import { FakeActionHost, MemoryTagSource } from '../host/memory-source.ts';
import { FakeHistorySource } from '../host/fake-history-source.ts';
import { HistoryError, type RowsQuery, type RowsResult } from '../host/history-source.ts';
import { MatHistoryTable } from './history-table.ts';
import { registerWidgets } from './register.ts';
import { tagInfo, widgetItem } from './test-util.ts';

const NOW = 1_790_000_000_000;
const H = 3_600_000;
const TOTAL = 250;

/** 250 dòng seq 1..250, ts tăng 60 s mỗi dòng, cột P = seq / 10, cột B = seq chẵn. */
function rowsFn(q: RowsQuery): RowsResult {
  const order = q.order ?? 'desc';
  const limit = q.limit ?? 100;
  const all: number[] = [];
  if (order === 'desc') for (let s = TOTAL; s >= 1; s--) all.push(s);
  else for (let s = 1; s <= TOTAL; s++) all.push(s);
  let start = 0;
  if (q.after !== undefined) start = all.indexOf(q.after) + 1;
  const page = all.slice(start, start + limit);
  const more = start + limit < all.length;
  const tags = q.tags ?? ['P', 'B'];
  return {
    group: q.group,
    timeZone: '+07:00',
    order,
    columns: tags.map((tagId) => ({ tagId })),
    rows: page.map((s) => [
      s,
      NOW - (TOTAL - s) * 60_000,
      ...tags.map((t) => (t === 'B' ? s % 2 === 0 : t === 'S' ? `v${s}` : s / 10)),
    ]),
    next: more ? page[page.length - 1]! : null,
  };
}

type El = MatHistoryTable & { updateComplete: Promise<boolean> };

function item(props: WidgetItem['props'] = {}, tags: string[] = ['P', 'B']) {
  return widgetItem('history-table', { columns: tags }, { group: 'ap-suat', ...props });
}

function makeSource(): MemoryTagSource {
  return new MemoryTagSource({
    now: NOW,
    tags: [
      tagInfo('P', { type: 'FLOAT32', unit: 'bar', description: 'Áp suất' }),
      tagInfo('B', { type: 'BOOL' }),
      tagInfo('S', { type: 'STRING' }),
    ],
  });
}

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

async function mountTable(it_: WidgetItem, hist: FakeHistorySource): Promise<El> {
  registerWidgets();
  const el = document.createElement('mat-w-history-table') as El;
  Object.assign(el, {
    item: it_,
    source: makeSource(),
    host: new FakeActionHost(),
    history: hist,
    mode: 'run',
    context: { screen: 's', widget: 'w1' },
  });
  document.body.append(el);
  await el.updateComplete;
  await flush();
  await el.updateComplete;
  return el;
}

const q = (el: Element, sel: string) => el.shadowRoot!.querySelector(sel);
const qa = (el: Element, sel: string) => [...el.shadowRoot!.querySelectorAll(sel)];
const text = (el: Element, sel: string) =>
  (q(el, sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const click = (el: Element, sel: string) => (q(el, sel) as HTMLElement).click();

function setup() {
  const hist = new FakeHistorySource();
  hist.catalogData.groups[0]!.tags = [
    { tagId: 'P', column: 'P', type: 'FLOAT32', unit: 'bar', aggregated: true, orphan: false },
    { tagId: 'B', column: 'B', type: 'BOOL', aggregated: true, orphan: false },
    { tagId: 'S', column: 'S', type: 'STRING', aggregated: false, orphan: false },
  ];
  hist.rowsFn = rowsFn;
  return hist;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('history-table: tải và hiển thị', () => {
  it('gọi rows 24 giờ, mới nhất trước, 100 dòng; tiêu đề cột theo mô tả Tag', async () => {
    const hist = setup();
    const el = await mountTable(item(), hist);
    expect(hist.rowsCalls.length).toBe(1);
    expect(hist.rowsCalls[0]).toMatchObject({
      group: 'ap-suat',
      tags: ['P', 'B'],
      from: NOW - 24 * H,
      to: NOW,
      limit: 100,
      order: 'desc',
      priority: 'user',
    });
    expect(hist.rowsCalls[0]!.after).toBeUndefined();
    expect(qa(el, 'tbody tr').length).toBe(100);
    const heads = qa(el, 'thead th').map((h) => h.textContent!.replace(/\s+/g, ' ').trim());
    expect(heads).toEqual(['Thời gian', 'Áp suất (bar)', 'B']);
  });

  it('pageSize và labels theo thuộc tính', async () => {
    const hist = setup();
    const el = await mountTable(item({ pageSize: 25, labels: ['Áp', 'Chạy'] }), hist);
    expect(hist.rowsCalls[0]!.limit).toBe(25);
    expect(qa(el, 'tbody tr').length).toBe(25);
    const heads = qa(el, 'thead th').map((h) => h.textContent!.replace(/\s+/g, ' ').trim());
    expect(heads.slice(1)).toEqual(['Áp (bar)', 'Chạy']);
  });

  it('định dạng: thời gian giờ địa phương của nhóm, số theo formatValue, BOOL bật/tắt, chuỗi nguyên văn, null là gạch', async () => {
    const hist = setup();
    hist.rowsFn = (qq) => ({
      group: qq.group,
      timeZone: '+07:00',
      order: 'desc',
      columns: [{ tagId: 'P' }, { tagId: 'B' }, { tagId: 'S' }],
      rows: [
        [2, NOW, 4.2, true, '<b>x</b>'],
        [1, NOW - 1000, null, false, null],
      ],
      next: null,
    });
    const el = await mountTable(item({}, ['P', 'B', 'S']), hist);
    const cells = qa(el, 'tbody tr:nth-child(1) td').map((c) => c.textContent!.trim());
    const d = new Date(NOW + 7 * H);
    const p2 = (n: number) => String(n).padStart(2, '0');
    expect(cells[0]).toContain(
      `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`,
    );
    expect(cells[1]).toBe('4.2');
    expect(cells[2]).toBe('Bật');
    expect(cells[3]).toBe('<b>x</b>'); // chữ thuần, không HTML
    expect(q(el, 'tbody tr:nth-child(1) td:nth-child(4) b')).toBeNull();
    const c2 = qa(el, 'tbody tr:nth-child(2) td').map((c) => c.textContent!.trim());
    expect(c2[1]).toBe('—');
    expect(c2[2]).toBe('Tắt');
    expect(c2[3]).toBe('—');
  });

  it('không có dòng: thông báo, không bảng trống', async () => {
    const hist = setup();
    hist.rowsFn = (qq) => ({ ...rowsFn(qq), rows: [], next: null });
    const el = await mountTable(item(), hist);
    expect(text(el, '[role="status"]')).toContain('Không có');
  });
});

describe('history-table: phân trang theo seq', () => {
  it('đi hết 250 dòng qua 3 trang: đủ, không trùng, đúng thứ tự; về trang trước', async () => {
    const hist = setup();
    const el = await mountTable(item(), hist);
    const seen: string[] = [];
    const collect = () => qa(el, 'tbody tr').map((r) => r.getAttribute('data-seq')!);
    seen.push(...collect());
    expect((q(el, 'button.prev') as HTMLButtonElement).disabled).toBe(true);
    click(el, 'button.next');
    await flush();
    await el.updateComplete;
    expect(hist.rowsCalls[1]!.after).toBe(151);
    seen.push(...collect());
    click(el, 'button.next');
    await flush();
    await el.updateComplete;
    seen.push(...collect());
    expect((q(el, 'button.next') as HTMLButtonElement).disabled).toBe(true);
    expect(seen.length).toBe(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL);
    expect(seen[0]).toBe('250');
    expect(seen[TOTAL - 1]).toBe('1');
    click(el, 'button.prev');
    await flush();
    await el.updateComplete;
    expect(collect()[0]).toBe('150');
    expect(text(el, '.page')).toContain('2');
  });

  it('đổi thứ tự về cũ nhất trước: quay về trang đầu và gọi lại với order=asc', async () => {
    const hist = setup();
    const el = await mountTable(item(), hist);
    click(el, 'button.next');
    await flush();
    await el.updateComplete;
    click(el, 'button.order');
    await flush();
    await el.updateComplete;
    const c = hist.rowsCalls.at(-1)!;
    expect(c.order).toBe('asc');
    expect(c.after).toBeUndefined();
    expect(qa(el, 'tbody tr')[0]!.getAttribute('data-seq')).toBe('1');
  });

  it('order=asc ban đầu theo thuộc tính', async () => {
    const hist = setup();
    await mountTable(item({ order: 'asc' }), hist);
    expect(hist.rowsCalls[0]!.order).toBe('asc');
  });

  it('đổi khoảng: gọi lại từ trang đầu với from/to mới', async () => {
    const hist = setup();
    const el = await mountTable(item(), hist);
    click(el, 'button.next');
    await flush();
    click(el, 'button[data-range="1h"]');
    await flush();
    await el.updateComplete;
    const c = hist.rowsCalls.at(-1)!;
    expect(c.after).toBeUndefined();
    expect(c.to - c.from).toBe(H);
  });

  it('controls=false ẩn thanh điều khiển nhưng vẫn có phân trang', async () => {
    const hist = setup();
    const el = await mountTable(item({ controls: false }), hist);
    expect(q(el, '.controls')).toBeNull();
    expect(q(el, 'button.next')).not.toBeNull();
  });
});

describe('history-table: xuất CSV và trạng thái', () => {
  it('liên kết Xuất CSV dùng exportUrl của nguồn với nhóm, khoảng, Tag, res=raw', async () => {
    const hist = setup();
    const el = await mountTable(item(), hist);
    const a = q(el, 'a.export') as HTMLAnchorElement;
    const call = hist.exportCalls.at(-1)!;
    expect(call).toMatchObject({
      group: 'ap-suat',
      from: NOW - 24 * H,
      to: NOW,
      tags: ['P', 'B'],
      res: 'raw',
    });
    expect(a.getAttribute('href')).toContain('/api/v1/history/export.csv?group=ap-suat');
    expect(a.textContent).toContain('Xuất CSV');
    expect(a.hasAttribute('download')).toBe(true);
  });

  it('chưa đăng nhập: chữ và nút Đăng nhập', async () => {
    const hist = setup();
    hist.state = 'login-required';
    hist.failWith = new HistoryError('AUTH_REQUIRED', 'x', 401);
    const el = await mountTable(item(), hist);
    expect(text(el, '[role="status"]')).toContain('Đăng nhập để xem lịch sử');
    click(el, '[role="status"] button');
    expect(hist.loginRequests).toBe(1);
  });

  it('lỗi: Thử lại gọi lại trang hiện tại', async () => {
    const hist = setup();
    hist.failWith = new HistoryError('HISTORY_UNAVAILABLE', 'x', 503);
    const el = await mountTable(item(), hist);
    expect(text(el, '[role="status"]')).toContain('Không tải được lịch sử');
    hist.failWith = null;
    click(el, '[role="status"] button');
    await flush();
    await el.updateComplete;
    expect(qa(el, 'tbody tr').length).toBe(100);
  });

  it('không đăng ký live', async () => {
    const hist = setup();
    const el = await mountTable(item(), hist);
    expect(el.tagIds()).toEqual([]);
  });

  it('gỡ khỏi DOM hủy yêu cầu đang chạy', async () => {
    const hist = setup();
    hist.hold = true;
    const el = await mountTable(item(), hist);
    const call = hist.pendingRows[0]!;
    el.remove();
    expect(call.signal!.aborted).toBe(true);
  });
});
