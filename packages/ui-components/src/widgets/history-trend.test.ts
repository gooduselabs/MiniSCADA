// T078: widget history-trend (với FakeHistorySource và bộ vẽ giả): dựng đường, khoảng đứt, vùng min–max, bậc thang,
// kéo chọn phóng, cuộn, Shift+kéo, bấm đúp, con trỏ, chú giải, bàn phím, gọi lại API sau 250 ms, hủy yêu cầu cũ,
// giữ hình cũ khi chờ, theo dõi mỗi 10 s và mọi trạng thái FR-035.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetItem } from '@mat/project-schema';
import type {
  AlignedData,
  HistoryPlotAdapter,
  HistoryPlotFactory,
  HistoryPlotOptions,
} from '../chart/history-plot.ts';
import { FakeActionHost, MemoryTagSource } from '../host/memory-source.ts';
import { FakeHistorySource, lineSeries } from '../host/fake-history-source.ts';
import { HistoryError, type SeriesQuery, type SeriesResult } from '../host/history-source.ts';
import { historyEnv, MatHistoryTrend } from './history-trend.ts';
import { registerWidgets } from './register.ts';
import { widgetItem } from './test-util.ts';

const NOW = 1_790_000_000_000;
const H = 3_600_000;

interface FakePlot {
  opts: HistoryPlotOptions;
  datas: AlignedData[];
  shows: [number, boolean][];
  adapter: HistoryPlotAdapter;
  destroyed: boolean;
}
let plots: FakePlot[] = [];

const factory: HistoryPlotFactory = (_host, opts, data) => {
  const p: FakePlot = {
    opts,
    datas: [data],
    shows: [],
    destroyed: false,
    adapter: {
      setData: (d) => p.datas.push(d),
      setSize: () => {},
      redraw: () => {},
      setSeriesShow: (i, s) => p.shows.push([i, s]),
      plotBox: () => ({ left: 50, top: 0, width: 400, height: 180 }),
      destroy: () => {
        p.destroyed = true;
      },
    },
  };
  plots.push(p);
  return p.adapter;
};

type El = MatHistoryTrend & { updateComplete: Promise<boolean> };

function item(props: WidgetItem['props'] = {}, tags: string[] = ['LINE1.PRESS', 'LINE1.TEMP']) {
  return widgetItem('history-trend', { series: tags }, { group: 'ap-suat', ...props });
}

async function flush(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

async function mountTrend(
  it_: WidgetItem,
  hist: FakeHistorySource,
  host = new FakeActionHost(),
): Promise<El> {
  registerWidgets();
  const el = document.createElement('mat-w-history-trend') as El;
  Object.assign(el, {
    item: it_,
    source: new MemoryTagSource({ now: NOW }),
    host,
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

function pointer(target: Element, type: string, x: number, extra: object = {}) {
  target.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: 10, bubbles: true, button: 0, ...extra }),
  );
}

let rectSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  plots = [];
  historyEnv.loadPlot = async () => factory;
  rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 500,
    bottom: 200,
    width: 500,
    height: 200,
    x: 0,
    y: 0,
    toJSON() {},
  });
});
afterEach(() => {
  document.body.replaceChildren();
  rectSpy.mockRestore();
  vi.useRealTimers();
});

describe('history-trend: dữ liệu và vẽ', () => {
  it('gọi series 24 giờ với maxPoints = min(2000, 2 × bề rộng vùng vẽ) và dựng một đường mỗi Tag', async () => {
    const hist = new FakeHistorySource();
    await mountTrend(item(), hist);
    expect(hist.seriesCalls.length).toBe(1);
    const c = hist.seriesCalls[0]!;
    expect(c).toMatchObject({
      group: 'ap-suat',
      tags: ['LINE1.PRESS', 'LINE1.TEMP'],
      to: NOW,
      from: NOW - 24 * H,
      maxPoints: 800,
    });
    expect(plots.length).toBe(1);
    expect(plots[0]!.opts.series.map((s) => s.label)).toEqual(['LINE1.PRESS', 'LINE1.TEMP']);
    const d = plots[0]!.datas.at(-1)!;
    expect(d.y.length).toBe(2);
    expect(d.x.length).toBe(20);
  });

  it('maxPoints bị chặn ở 2000', async () => {
    const hist = new FakeHistorySource();
    await mountTrend(item(), hist);
    plots[0]!.adapter.plotBox = () => ({ left: 0, top: 0, width: 3000, height: 100 });
    const el = document.querySelector('mat-w-history-trend') as El;
    pointer(q(el, '.plot')!, 'dblclick', 100);
    await flush(260);
    expect(hist.seriesCalls.at(-1)!.maxPoints).toBe(2000);
  });

  it('null và gaps thành khoảng đứt (NaN) trong dữ liệu đưa cho bộ vẽ', async () => {
    const hist = new FakeHistorySource();
    hist.seriesFn = (qq: SeriesQuery): SeriesResult => ({
      ...lineSeries(qq),
      gaps: [[NOW - 12 * H, NOW - 10 * H]],
      series: [
        { tagId: 'LINE1.PRESS', t: [NOW - 20 * H, NOW - 15 * H, NOW - 5 * H], v: [1, null, 3] },
      ],
    });
    await mountTrend(item({}, ['LINE1.PRESS']), hist);
    const d = plots[0]!.datas.at(-1)!;
    const idx = (t: number) => [...d.x].indexOf(t);
    expect(Number.isNaN(d.y[0]![idx(NOW - 15 * H)]!)).toBe(true);
    expect(Number.isNaN(d.y[0]![idx(NOW - 12 * H)]!)).toBe(true);
    expect(d.y[0]![idx(NOW - 20 * H)]).toBe(1);
  });

  it('nguồn tổng hợp (có min, max) và showBand: truyền vùng min–max; showBand=false thì không', async () => {
    const hist = new FakeHistorySource();
    hist.seriesFn = (qq) => {
      const r = lineSeries(qq);
      r.res = '1m';
      r.series = r.series.map((s) => ({
        ...s,
        min: s.v.map((v) => (v ?? 0) - 1),
        max: s.v.map((v) => (v ?? 0) + 1),
      }));
      return r;
    };
    await mountTrend(item(), hist);
    expect(plots[0]!.opts.showBand).toBe(true);
    expect(plots[0]!.datas.at(-1)!.lo[0]).not.toBeNull();
    document.body.replaceChildren();
    plots = [];
    await mountTrend(item({ showBand: false }), hist);
    expect(plots[0]!.opts.showBand).toBe(false);
  });

  it('step auto: bậc thang cho nhóm onChange; on/off ép; nhóm cyclic không bậc thang', async () => {
    const hist = new FakeHistorySource();
    await mountTrend(item(), hist);
    expect(plots[0]!.opts.series.every((s) => s.step)).toBe(true);
    document.body.replaceChildren();
    plots = [];
    await mountTrend(item({ step: 'off' }), hist);
    expect(plots[0]!.opts.series.some((s) => s.step)).toBe(false);
    document.body.replaceChildren();
    plots = [];
    hist.catalogData.groups[0]!.mode = 'cyclic';
    await mountTrend(item(), hist);
    expect(plots[0]!.opts.series.some((s) => s.step)).toBe(false);
    document.body.replaceChildren();
    plots = [];
    await mountTrend(item({ step: 'on' }), hist);
    expect(plots[0]!.opts.series.every((s) => s.step)).toBe(true);
  });

  it('trục phải: axes right đưa đường sang thang phải', async () => {
    const hist = new FakeHistorySource();
    await mountTrend(item({ axes: ['left', 'right'] }), hist);
    expect(plots[0]!.opts.series.map((s) => s.axis)).toEqual(['left', 'right']);
  });

  it('nhãn từ labels, mặc định là Tag; yMin/yMax cố định trục Y', async () => {
    const hist = new FakeHistorySource();
    await mountTrend(item({ labels: ['Áp suất'], yMin: 0, yMax: 10 }), hist);
    expect(plots[0]!.opts.series[0]!.label).toBe('Áp suất');
    expect(plots[0]!.opts.series[1]!.label).toBe('LINE1.TEMP');
    expect(plots[0]!.opts.yRange('left', 3, 4)).toEqual([0, 10]);
  });
});

describe('history-trend: tương tác', () => {
  it('kéo chọn vùng = phóng X; gọi lại API sau 250 ms (gộp nhiều thao tác), hủy yêu cầu cũ, giữ hình cũ', async () => {
    const hist = new FakeHistorySource();
    const el = await mountTrend(item(), hist);
    hist.hold = true;
    const plot = q(el, '.plot')!;
    // vùng vẽ: left 50, rộng 400 → x = 50 + 400 × tỉ lệ
    pointer(plot, 'pointerdown', 50 + 100);
    pointer(plot, 'pointermove', 50 + 300);
    pointer(plot, 'pointerup', 50 + 300);
    const span = 24 * H;
    const from = NOW - span + (100 / 400) * span;
    const to = NOW - span + (300 / 400) * span;
    await flush(100);
    expect(hist.seriesCalls.length).toBe(1); // chưa tới 250 ms
    await flush(160);
    expect(hist.seriesCalls.length).toBe(2);
    expect(hist.seriesCalls[1]!.from).toBeCloseTo(from, -3);
    expect(hist.seriesCalls[1]!.to).toBeCloseTo(to, -3);
    // trong lúc chờ: hình cũ còn, có chỉ báo đang cập nhật, không lớp phủ trắng
    expect(plots[0]!.destroyed).toBe(false);
    expect(q(el, '.updating')).not.toBeNull();
    // thao tác tiếp: yêu cầu cũ bị hủy
    const firstSignal = hist.seriesSignals[1]!;
    pointer(plot, 'dblclick', 100);
    await flush(260);
    expect(firstSignal.aborted).toBe(true);
    expect(hist.seriesCalls.length).toBe(3);
    expect(hist.seriesCalls[2]!.to).toBe(NOW);
  });

  it('cuộn chuột: phóng quanh con trỏ (±25 % mỗi nấc), đúng hướng', async () => {
    const hist = new FakeHistorySource();
    const el = await mountTrend(item(), hist);
    const plot = q(el, '.plot')!;
    plot.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -100, clientX: 50 + 200, bubbles: true, cancelable: true }),
    );
    await flush(260);
    const c = hist.seriesCalls.at(-1)!;
    expect(c.to - c.from).toBeCloseTo(24 * H * 0.75, -3);
    // neo ở giữa: tâm khoảng không đổi
    expect((c.from + c.to) / 2).toBeCloseTo(NOW - 12 * H, -3);
    plot.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 100, clientX: 50 + 200, bubbles: true, cancelable: true }),
    );
    await flush(260);
    const c2 = hist.seriesCalls.at(-1)!;
    expect(c2.to - c2.from).toBeCloseTo(24 * H * 0.75 * 1.25, -3);
  });

  it('Shift+kéo dịch khoảng, giữ nguyên độ rộng', async () => {
    const hist = new FakeHistorySource();
    const el = await mountTrend(item({ follow: false }), hist);
    const plot = q(el, '.plot')!;
    pointer(plot, 'pointerdown', 250, { shiftKey: true });
    pointer(plot, 'pointermove', 150, { shiftKey: true });
    pointer(plot, 'pointerup', 150, { shiftKey: true });
    await flush(260);
    const c = hist.seriesCalls.at(-1)!;
    expect(c.to - c.from).toBeCloseTo(24 * H, -3);
    expect(c.from).toBeCloseTo(NOW - 24 * H + (100 / 400) * 24 * H, -3); // kéo sang trái 100 px = tiến 25 % khoảng
  });

  it('bấm đúp về khoảng ban đầu', async () => {
    const hist = new FakeHistorySource();
    const el = await mountTrend(item(), hist);
    const plot = q(el, '.plot')!;
    plot.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -100, clientX: 250, bubbles: true, cancelable: true }),
    );
    await flush(260);
    pointer(plot, 'dblclick', 250);
    await flush(260);
    const c = hist.seriesCalls.at(-1)!;
    expect(c.to - c.from).toBe(24 * H);
  });

  it('chọn khoảng ở thanh điều khiển đổi khoảng gốc; controls=false ẩn thanh', async () => {
    const hist = new FakeHistorySource();
    const el = await mountTrend(item(), hist);
    (q(el, 'button[data-range="1h"]') as HTMLButtonElement).click();
    await flush(260);
    const c = hist.seriesCalls.at(-1)!;
    expect(c.to - c.from).toBe(H);
    document.body.replaceChildren();
    const el2 = await mountTrend(item({ controls: false }), hist);
    expect(q(el2, '.controls')).toBeNull();
  });

  it('Hôm nay bắt đầu từ nửa đêm theo múi giờ NHÓM; Hôm qua đủ 24 giờ', async () => {
    const hist = new FakeHistorySource();
    const el = await mountTrend(item(), hist);
    (q(el, 'button[data-range="today"]') as HTMLButtonElement).click();
    await flush(260);
    const off = 7 * H;
    const midnight = Math.floor((NOW + off) / (24 * H)) * 24 * H - off;
    expect(hist.seriesCalls.at(-1)!.from).toBe(midnight);
    (q(el, 'button[data-range="yesterday"]') as HTMLButtonElement).click();
    await flush(260);
    const c = hist.seriesCalls.at(-1)!;
    expect([c.from, c.to]).toEqual([midnight - 24 * H, midnight]);
  });

  it('con trỏ: hiện thời điểm theo giờ địa phương của nhóm và giá trị mỗi đường', async () => {
    const hist = new FakeHistorySource();
    const el = await mountTrend(item(), hist);
    plots[0]!.opts.onCursor(3);
    await el.updateComplete;
    const t = [...plots[0]!.datas.at(-1)!.x][3]!;
    const cur = text(el, '.cursor');
    expect(cur).toContain('LINE1.PRESS');
    expect(cur).toContain('LINE1.TEMP');
    const d = new Date(t + 7 * H);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    expect(cur).toContain(`${hh}:`);
  });

  it('con trỏ theo chuột tìm điểm gần nhất', async () => {
    const hist = new FakeHistorySource();
    const el = await mountTrend(item(), hist);
    const plot = q(el, '.plot')!;
    pointer(plot, 'pointermove', 50); // đầu vùng vẽ → điểm đầu tiên
    await el.updateComplete;
    const cur = text(el, '.cursor');
    expect(cur).toContain('LINE1.PRESS 10');
  });

  it('chú giải bật/tắt đường', async () => {
    const hist = new FakeHistorySource();
    const el = await mountTrend(item(), hist);
    const b = q(el, '.legend button[data-i="1"]') as HTMLButtonElement;
    expect(b.getAttribute('aria-pressed')).toBe('true');
    b.click();
    await el.updateComplete;
    expect(plots[0]!.shows).toContainEqual([1, false]);
    expect(b.getAttribute('aria-pressed')).toBe('false');
  });

  it('bàn phím: + thu phóng, - thu nhỏ, Shift+mũi tên dịch khung, Home về gốc; mũi tên dịch con trỏ', async () => {
    const hist = new FakeHistorySource();
    const el = await mountTrend(item({ follow: false }), hist);
    const root = q(el, '.plot') as HTMLElement;
    const key = (k: string, shiftKey = false) =>
      root.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }),
      );
    key('+');
    await flush(260);
    expect(hist.seriesCalls.at(-1)!.to - hist.seriesCalls.at(-1)!.from).toBeCloseTo(
      24 * H * 0.75,
      -3,
    );
    key('-');
    await flush(260);
    key('ArrowRight', true);
    await flush(260);
    const c = hist.seriesCalls.at(-1)!;
    expect(c.to).toBeGreaterThan(NOW - 1);
    key('Home');
    await flush(260);
    const h = hist.seriesCalls.at(-1)!;
    expect([h.from, h.to]).toEqual([NOW - 24 * H, NOW]);
    key('ArrowRight');
    await el.updateComplete;
    key('ArrowRight');
    await el.updateComplete;
    expect(text(el, '.cursor')).toContain('LINE1.PRESS 11');
  });
});

describe('history-trend: theo dõi', () => {
  it('follow làm mới mỗi 10 s với khoảng mới tới bây giờ; phóng ra khỏi bây giờ thì ngừng; nút bật lại', async () => {
    const hist = new FakeHistorySource();
    const src = new MemoryTagSource({ now: NOW });
    const el = await mountTrend(item(), hist);
    Object.assign(el, { source: src });
    const n0 = hist.seriesCalls.length;
    src.advance(10_000);
    await flush(10_000);
    expect(hist.seriesCalls.length).toBe(n0 + 1);
    expect(hist.seriesCalls.at(-1)!.to).toBe(NOW + 10_000);
    // dịch ra khỏi "bây giờ"
    const plot = q(el, '.plot')!;
    pointer(plot, 'pointerdown', 150, { shiftKey: true });
    pointer(plot, 'pointermove', 250, { shiftKey: true });
    pointer(plot, 'pointerup', 250, { shiftKey: true });
    await flush(260);
    const n1 = hist.seriesCalls.length;
    await flush(30_000);
    expect(hist.seriesCalls.length).toBe(n1);
    const btn = q(el, 'button.follow') as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    btn.click();
    await flush(260);
    expect(hist.seriesCalls.at(-1)!.to).toBe(NOW + 10_000);
  });

  it('follow=false: không làm mới tự động', async () => {
    const hist = new FakeHistorySource();
    await mountTrend(item({ follow: false }), hist);
    const n = hist.seriesCalls.length;
    await flush(60_000);
    expect(hist.seriesCalls.length).toBe(n);
  });
});

describe('history-trend: trạng thái FR-035', () => {
  it('đang tải: lớp phủ role=status', async () => {
    const hist = new FakeHistorySource();
    hist.hold = true;
    const el = await mountTrend(item(), hist);
    expect(q(el, '[role="status"]')?.textContent).toContain('Đang tải');
  });

  it('chưa đăng nhập: chữ + nút Đăng nhập gọi requestLogin của nơi chứa', async () => {
    const hist = new FakeHistorySource();
    hist.state = 'login-required';
    hist.failWith = new HistoryError('AUTH_REQUIRED', 'x', 401);
    const el = await mountTrend(item(), hist);
    expect(text(el, '[role="status"]')).toContain('Đăng nhập để xem lịch sử');
    (q(el, '[role="status"] button') as HTMLButtonElement).click();
    expect(hist.loginRequests).toBe(1);
  });

  it('đăng nhập xong (state → ready) tự tải lại', async () => {
    const hist = new FakeHistorySource();
    hist.state = 'login-required';
    hist.failWith = new HistoryError('AUTH_REQUIRED', 'x', 401);
    const el = await mountTrend(item(), hist);
    hist.failWith = null;
    hist.setState('ready');
    await flush(10);
    await el.updateComplete;
    expect(q(el, '[role="status"]')).toBeNull();
    expect(plots.length).toBe(1);
  });

  it('thiết bị bận: chữ "sẽ tự thử lại", không nút lỗi', async () => {
    const hist = new FakeHistorySource();
    hist.hold = true;
    const el = await mountTrend(item(), hist);
    hist.setState('busy');
    await el.updateComplete;
    expect(text(el, '[role="status"]')).toContain('bận');
  });

  it('chưa bật lưu trữ (disabled)', async () => {
    const hist = new FakeHistorySource();
    hist.state = 'disabled';
    hist.failWith = new HistoryError('NO_HISTORY', 'x', 404);
    const el = await mountTrend(item(), hist);
    expect(text(el, '[role="status"]')).toContain('Chưa bật lưu trữ');
  });

  it('lỗi tải: chữ + nút Thử lại gọi lại', async () => {
    const hist = new FakeHistorySource();
    hist.failWith = new HistoryError('HISTORY_UNAVAILABLE', 'x', 503);
    const el = await mountTrend(item(), hist);
    expect(text(el, '[role="status"]')).toContain('Không tải được lịch sử');
    hist.failWith = null;
    (q(el, '[role="status"] button') as HTMLButtonElement).click();
    await flush(10);
    await el.updateComplete;
    expect(q(el, '[role="status"]')).toBeNull();
  });

  it('khoảng không có dữ liệu: "Không có dữ liệu trong khoảng này"', async () => {
    const hist = new FakeHistorySource();
    hist.seriesFn = (qq) => ({
      ...lineSeries(qq),
      coverage: null,
      series: qq.tags.map((tagId) => ({ tagId, t: [], v: [] })),
    });
    const el = await mountTrend(item(), hist);
    expect(text(el, '[role="status"]')).toContain('Không có dữ liệu');
  });

  it('nhóm không có trong catalog: báo chưa chọn nhóm hợp lệ, không gọi series', async () => {
    const hist = new FakeHistorySource();
    const el = await mountTrend(
      widgetItem('history-trend', { series: ['X'] }, { group: 'khong-co' }),
      hist,
    );
    expect(text(el, '[role="status"]')).toContain('nhóm');
    expect(hist.seriesCalls.length).toBe(0);
  });

  it('khoảng quá lớn (RANGE_TOO_LARGE) hiện câu của máy chủ, không phải lỗi mạng', async () => {
    const hist = new FakeHistorySource();
    hist.failWith = new HistoryError('SCAN_LIMIT', 'Khoảng quá lớn cho dữ liệu thô', 422);
    const el = await mountTrend(item(), hist);
    expect(text(el, '[role="status"]')).toContain('Khoảng quá lớn');
  });
});

describe('history-trend: nền và trợ năng', () => {
  it('không đăng ký live: tagIds() rỗng', async () => {
    const hist = new FakeHistorySource();
    const el = await mountTrend(item(), hist);
    expect(el.tagIds()).toEqual([]);
  });

  it('role=img có tên và bảng tương đương cho trình đọc màn hình', async () => {
    const hist = new FakeHistorySource();
    const el = await mountTrend(item(), hist);
    expect(q(el, '[role="img"]')?.getAttribute('aria-label')).toContain('Biểu đồ lịch sử');
    expect(qa(el, 'table.sr-only tbody tr').length).toBe(2);
  });

  it('gỡ khỏi DOM: hủy yêu cầu, hủy bộ đếm, hủy bộ vẽ', async () => {
    const hist = new FakeHistorySource();
    hist.hold = true;
    const el = await mountTrend(item(), hist);
    const sig = hist.seriesSignals[0]!;
    el.remove();
    expect(sig.aborted).toBe(true);
    await flush(60_000);
    expect(hist.seriesCalls.length).toBe(1);
  });

  it('lớp MatHistoryTrend được xuất', () => {
    expect(typeof MatHistoryTrend).toBe('function');
  });
});
