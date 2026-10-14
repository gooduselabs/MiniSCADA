// T109 (pie): history-pie với FakeHistorySource: một cửa sổ bao cả kỳ, phần trăm khớp mô hình, loại Tag âm/thiếu,
// tổng 0, làm mới, trạng thái FR-035, bảng tương đương.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseUtcOffset, pieModel } from '@mat/history-math';
import type { WidgetItem } from '@mat/project-schema';
import { FakeActionHost, MemoryTagSource } from '../host/memory-source.ts';
import { FakeHistorySource } from '../host/fake-history-source.ts';
import { HistoryError, type AggregateQuery, type AggregateResult } from '../host/history-source.ts';
import { MatHistoryPie } from './history-pie.ts';
import { registerWidgets } from './register.ts';
import { widgetItem } from './test-util.ts';

const NOW = Date.UTC(2026, 9, 12, 3, 30, 0); // 10:30 +07:00
const TZ = '+07:00';

/** Một cửa sổ: delta theo Tag (first = 0, last = delta[tag]); null = cửa sổ rỗng. */
function aggFor(deltas: Record<string, number | null>) {
  return (q: AggregateQuery): AggregateResult => ({
    group: q.group,
    timeZone: TZ,
    from: q.from,
    to: q.to,
    bucketMs: q.bucketMs,
    offsetMs: q.offsetMs ?? 0,
    start: Math.floor((q.from - (q.offsetMs ?? 0)) / q.bucketMs) * q.bucketMs + (q.offsetMs ?? 0),
    count: 1,
    source: 'minute',
    series: q.tags.map((tagId) => {
      const d = deltas[tagId] ?? null;
      return {
        tagId,
        n: [d === null ? 0 : 60],
        min: [d === null ? null : 0],
        max: [d],
        first: [d === null ? null : 0],
        last: [d],
        sumw: [d === null ? null : 1],
        wms: [d === null ? 0 : q.bucketMs],
        avg: [d],
        sum: [d],
      };
    }),
  });
}

type El = MatHistoryPie & { updateComplete: Promise<boolean> };

const TAGS = ['A', 'B', 'C', 'D'];
function item(props: WidgetItem['props'] = {}, tags = TAGS) {
  return widgetItem('history-pie', { series: tags }, { group: 'dien', period: 'today', ...props });
}

function setup(deltas: Record<string, number | null> = { A: 10, B: 30, C: -5, D: null }) {
  const hist = new FakeHistorySource();
  hist.catalogData.groups[0]!.id = 'dien';
  hist.catalogData.groups[0]!.tags = TAGS.map((t) => ({
    tagId: t,
    column: t,
    type: 'FLOAT64',
    unit: 'kWh',
    aggregated: true,
    orphan: false,
  }));
  hist.aggregateFn = aggFor(deltas);
  return hist;
}

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

async function mountPie(
  it_: WidgetItem,
  hist: FakeHistorySource,
  src?: MemoryTagSource,
): Promise<El> {
  registerWidgets();
  const el = document.createElement('mat-w-history-pie') as El;
  Object.assign(el, {
    item: it_,
    source: src ?? new MemoryTagSource({ now: NOW }),
    host: new FakeActionHost(),
    history: hist,
    mode: 'run',
    context: { screen: 's', widget: 'w' },
  });
  document.body.append(el);
  await el.updateComplete;
  await flush();
  await el.updateComplete;
  return el;
}

const q = (el: Element, s: string) => el.shadowRoot!.querySelector(s);
const qa = (el: Element, s: string) => [...el.shadowRoot!.querySelectorAll(s)];
const text = (el: Element, s: string) => (q(el, s)?.textContent ?? '').replace(/\s+/g, ' ').trim();

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('history-pie', () => {
  it('một lần aggregate với bucketMs = độ dài kỳ làm tròn lên (khớp pieModel)', async () => {
    const hist = setup();
    await mountPie(item(), hist);
    const m = pieModel({ period: 'today' }, NOW, parseUtcOffset(TZ), undefined, TAGS);
    expect(hist.aggregateCalls.length).toBe(1);
    expect(hist.aggregateCalls[0]).toMatchObject({
      group: 'dien',
      tags: TAGS,
      from: m.request.from,
      to: m.request.to,
      bucketMs: m.request.bucketMs,
      offsetMs: m.request.offsetMs,
    });
  });

  it('phần trăm đúng; Tag âm và Tag thiếu bị loại có chữ "bị loại" (không chỉ màu)', async () => {
    const hist = setup();
    const el = await mountPie(item(), hist);
    expect(qa(el, 'path.slice').length).toBe(2);
    const rows = qa(el, '.legend li').map((l) => l.textContent!.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('25.0%'); // 10 / 40
    expect(rows[1]).toContain('75.0%');
    expect(rows[2]).toContain('bị loại');
    expect(rows[3]).toContain('bị loại');
  });

  it('tổng 0: "Không có dữ liệu" (không chia cho 0)', async () => {
    const hist = setup({ A: 0, B: 0, C: 0, D: 0 });
    const el = await mountPie(item(), hist);
    expect(qa(el, 'path.slice').length).toBe(0);
    expect(text(el, '[role="status"]')).toContain('Không có dữ liệu');
  });

  it('donut=false vẽ đĩa; showTotal hiện tổng giữa vòng', async () => {
    const hist = setup();
    const el = await mountPie(item({ showTotal: true }), hist);
    expect(text(el, 'text.total')).toContain('40');
    document.body.replaceChildren();
    const el2 = await mountPie(item({ donut: false, showTotal: true }), hist);
    expect(q(el2, 'text.total')).toBeNull();
  });

  it('showPercent=false ẩn phần trăm; labels thay tên', async () => {
    const hist = setup();
    const el = await mountPie(item({ showPercent: false, labels: ['Máy 1'] }), hist);
    const first = text(el, '.legend li');
    expect(first).toContain('Máy 1');
    expect(first).not.toContain('%');
  });

  it('làm mới mỗi refreshSec; gỡ khỏi DOM thì ngừng', async () => {
    const hist = setup();
    const src = new MemoryTagSource({ now: NOW });
    const el = await mountPie(item({ refreshSec: 30 }), hist, src);
    src.advance(30_000);
    await flush(30_000);
    expect(hist.aggregateCalls.length).toBe(2);
    el.remove();
    await flush(120_000);
    expect(hist.aggregateCalls.length).toBe(2);
  });

  it('chưa đăng nhập, lỗi, nhóm không tổng hợp', async () => {
    const hist = setup();
    hist.state = 'login-required';
    hist.failWith = new HistoryError('AUTH_REQUIRED', 'x', 401);
    const el = await mountPie(item(), hist);
    expect(text(el, '[role="status"]')).toContain('Đăng nhập để xem lịch sử');
    document.body.replaceChildren();
    const h2 = setup();
    h2.catalogData.groups[0]!.aggregates = null;
    const e2 = await mountPie(item(), h2);
    expect(text(e2, '[role="status"]')).toContain('tổng hợp');
    expect(h2.aggregateCalls.length).toBe(0);
  });

  it('role=img và bảng tương đương, không đăng ký live', async () => {
    const hist = setup();
    const el = await mountPie(item(), hist);
    expect(q(el, '[role="img"]')?.getAttribute('aria-label')).toContain('Biểu đồ tròn lịch sử');
    expect(qa(el, 'table.sr-only tbody tr').length).toBe(4);
    expect(el.tagIds()).toEqual([]);
  });
});
