// T109 (bar): history-bar với FakeHistorySource: số cột, nhãn ngày + ca, giá trị khớp mô hình history-math, làm mới
// theo refreshSec, chuyển ca ≤ 60 s, trạng thái FR-035, bảng tương đương cho trình đọc màn hình.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { barModel, parseUtcOffset } from '@mat/history-math';
import type { WidgetItem } from '@mat/project-schema';
import { FakeActionHost, MemoryTagSource } from '../host/memory-source.ts';
import { FakeHistorySource } from '../host/fake-history-source.ts';
import { HistoryError, type AggregateQuery, type AggregateResult } from '../host/history-source.ts';
import { MatHistoryBar } from './history-bar.ts';
import { registerWidgets } from './register.ts';
import { widgetItem } from './test-util.ts';

// 2026-10-12 10:30 giờ +07:00
const NOW = Date.UTC(2026, 9, 12, 3, 30, 0);
const TZ = '+07:00';

/** Cửa sổ k: first = 100k, last = 100k + (k + 1) → delta = k + 1; sumw = (k+1) × wms. */
function aggFor(q: AggregateQuery): AggregateResult {
  const off = q.offsetMs ?? 0;
  const start = Math.floor((q.from - off) / q.bucketMs) * q.bucketMs + off;
  const count = Math.ceil((q.to - start) / q.bucketMs);
  const col = <T extends number | null>(f: (k: number) => T): T[] => Array.from({ length: count }, (_, k) => f(k));
  return {
    group: q.group,
    timeZone: TZ,
    from: q.from,
    to: q.to,
    bucketMs: q.bucketMs,
    offsetMs: off,
    start,
    count,
    source: 'hour',
    series: q.tags.map((tagId, i) => ({
      tagId,
      n: col(() => 60),
      min: col((k) => 100 * k),
      max: col((k) => 100 * k + k + 1),
      first: col((k) => 100 * k + i),
      last: col((k) => 100 * k + (k + 1) + i),
      sumw: col((k) => (k + 1) * q.bucketMs),
      wms: col(() => q.bucketMs),
      avg: col((k) => k + 1),
      sum: col(() => 0),
    })),
  };
}

type El = MatHistoryBar & { updateComplete: Promise<boolean> };

function item(props: WidgetItem['props'] = {}, tags: string[] = ['METER1.KWH']) {
  return widgetItem(
    'history-bar',
    { series: tags },
    { group: 'dien', bucket: 'shift', period: 'last7d', ...props },
  );
}

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function setup() {
  const hist = new FakeHistorySource();
  hist.catalogData.groups[0]!.id = 'dien';
  hist.catalogData.groups[0]!.name = 'Điện';
  hist.catalogData.groups[0]!.tags = [
    {
      tagId: 'METER1.KWH',
      column: 'K',
      type: 'FLOAT64',
      unit: 'kWh',
      aggregated: true,
      orphan: false,
    },
    {
      tagId: 'METER1.KW',
      column: 'W',
      type: 'FLOAT64',
      unit: 'kW',
      aggregated: true,
      orphan: false,
    },
  ];
  hist.aggregateFn = aggFor;
  return hist;
}

async function mountBar(
  it_: WidgetItem,
  hist: FakeHistorySource,
  src?: MemoryTagSource,
): Promise<El> {
  registerWidgets();
  const el = document.createElement('mat-w-history-bar') as El;
  Object.assign(el, {
    item: it_,
    source: src ?? new MemoryTagSource({ now: NOW }),
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

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('history-bar: dữ liệu', () => {
  it('gọi aggregate đúng cửa sổ theo mô hình (3 ca × 7 ngày), một lần', async () => {
    const hist = setup();
    await mountBar(item(), hist);
    expect(hist.aggregateCalls.length).toBe(1);
    const m = barModel({ bucket: 'shift', period: 'last7d' }, NOW, parseUtcOffset(TZ), undefined, [
      'METER1.KWH',
    ]);
    const c = hist.aggregateCalls[0]!;
    expect(c).toMatchObject({
      group: 'dien',
      tags: ['METER1.KWH'],
      from: m.request.from,
      to: m.request.to,
      bucketMs: m.request.bucketMs,
      offsetMs: m.request.offsetMs,
    });
  });

  it('số cột, nhãn "dd/MM Ca n" và giá trị khớp mô hình (delta = k+1)', async () => {
    const hist = setup();
    const el = await mountBar(item(), hist);
    const m = barModel(
      { bucket: 'shift', period: 'last7d' },
      NOW,
      parseUtcOffset(TZ),
      aggFor(hist.aggregateCalls[0]!),
      ['METER1.KWH'],
    );
    const bars = qa(el, 'rect.bar');
    expect(bars.length).toBe(m.categories.length);
    const labels = qa(el, 'text.cat').map((t) => t.textContent!.trim());
    expect(labels).toEqual(m.categories.map((c) => c.label));
    expect(labels[0]).toMatch(/^\d\d\/\d\d Ca [123]$/);
    // bảng tương đương: giá trị = delta
    const cells = qa(el, 'table.sr-only tbody tr').map((r) => r.querySelectorAll('td'));
    expect(cells.length).toBe(m.categories.length);
    expect(cells[0]![1]!.textContent!.trim()).toBe('1.0');
    expect(cells[2]![1]!.textContent!.trim()).toBe('3.0');
  });

  it('nhiều Tag: cột nhóm, chú giải theo labels', async () => {
    const hist = setup();
    const el = await mountBar(
      item({ labels: ['Điện năng', 'Công suất'], bucket: 'day', period: 'last7d' }, [
        'METER1.KWH',
        'METER1.KW',
      ]),
      hist,
    );
    expect(qa(el, 'rect.bar').length).toBe(14);
    expect(qa(el, '.legend li').map((l) => l.textContent!.trim())).toEqual([
      'Điện năng',
      'Công suất',
    ]);
  });

  it('decimals và showValues: nhãn giá trị trên cột', async () => {
    const hist = setup();
    const el = await mountBar(item({ decimals: 2, bucket: 'day', period: 'last7d' }), hist);
    expect(qa(el, 'text.val')[0]!.textContent!.trim()).toBe('1.00');
    document.body.replaceChildren();
    const el2 = await mountBar(item({ showValues: false, bucket: 'day', period: 'last7d' }), hist);
    expect(qa(el2, 'text.val').length).toBe(0);
  });

  it('ô thiếu (null) không vẽ cột và hiện gạch trong bảng', async () => {
    const hist = setup();
    hist.aggregateFn = (qq) => {
      const r = aggFor(qq);
      r.series[0]!.n[0] = 0;
      r.series[0]!.wms[0] = 0;
      return r;
    };
    const el = await mountBar(item({ bucket: 'day', period: 'last7d' }), hist);
    const rows = qa(el, 'table.sr-only tbody tr');
    expect(rows[0]!.querySelectorAll('td')[1]!.textContent!.trim()).toBe('—');
    expect(qa(el, 'rect.bar').length).toBe(rows.length - 1);
  });
});

describe('history-bar: làm mới', () => {
  it('làm mới mỗi refreshSec (mặc định 60 s) và theo giờ mới của nguồn', async () => {
    const hist = setup();
    const src = new MemoryTagSource({ now: NOW });
    await mountBar(item(), hist, src);
    expect(hist.aggregateCalls.length).toBe(1);
    src.advance(60_000);
    await flush(60_000);
    expect(hist.aggregateCalls.length).toBe(2);
    expect(hist.aggregateCalls[1]!.to).toBeGreaterThanOrEqual(hist.aggregateCalls[0]!.to);
  });

  it('refreshSec tùy chỉnh; chuyển ca trong ≤ 60 s: cửa sổ mới xuất hiện ở lượt làm mới kế', async () => {
    const hist = setup();
    const src = new MemoryTagSource({ now: Date.UTC(2026, 9, 12, 6, 59, 30) }); // 13:59:30 +07, sắp hết ca 1 (06–14)
    const el = await mountBar(
      item({ refreshSec: 30, period: 'thisShift', bucket: 'shift' }),
      hist,
      src,
    );
    const first = hist.aggregateCalls[0]!;
    src.advance(60_000); // 14:00:30 → ca 2
    await flush(30_000);
    await el.updateComplete;
    const last = hist.aggregateCalls.at(-1)!;
    expect(last.from).toBeGreaterThan(first.from);
  });

  it('ngừng làm mới khi gỡ khỏi DOM', async () => {
    const hist = setup();
    const el = await mountBar(item(), hist);
    el.remove();
    await flush(120_000);
    expect(hist.aggregateCalls.length).toBe(1);
  });
});

describe('history-bar: trạng thái FR-035', () => {
  it('chưa đăng nhập', async () => {
    const hist = setup();
    hist.state = 'login-required';
    hist.failWith = new HistoryError('AUTH_REQUIRED', 'x', 401);
    const el = await mountBar(item(), hist);
    expect(text(el, '[role="status"]')).toContain('Đăng nhập để xem lịch sử');
    (q(el, '[role="status"] button') as HTMLButtonElement).click();
    expect(hist.loginRequests).toBe(1);
  });

  it('nhóm không bật tổng hợp: báo chưa bật tổng hợp', async () => {
    const hist = setup();
    hist.catalogData.groups[0]!.aggregates = null;
    const el = await mountBar(item(), hist);
    expect(text(el, '[role="status"]')).toContain('tổng hợp');
    expect(hist.aggregateCalls.length).toBe(0);
  });

  it('lỗi tải: Thử lại', async () => {
    const hist = setup();
    hist.failWith = new HistoryError('HISTORY_UNAVAILABLE', 'x', 503);
    const el = await mountBar(item(), hist);
    expect(text(el, '[role="status"]')).toContain('Không tải được lịch sử');
  });

  it('không đăng ký live; role=img có tên', async () => {
    const hist = setup();
    const el = await mountBar(item(), hist);
    expect(el.tagIds()).toEqual([]);
    expect(q(el, '[role="img"]')?.getAttribute('aria-label')).toContain('Biểu đồ cột lịch sử');
  });
});
