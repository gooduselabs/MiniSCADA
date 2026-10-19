import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlotAdapter, PlotFactory, PlotOptions } from '../chart/line-chart.ts';
import { lineEnv } from './line.ts';
import { cleanup, makeSource, mount, tagInfo, textOf, widgetItem, type El } from './test-util.ts';

interface Harness {
  creates: Array<{ opts: PlotOptions; data: Float64Array[]; host: HTMLElement }>;
  sets: Float64Array[][];
  sizes: Array<[number, number]>;
  destroyed: number;
  timers: Array<{ fn: () => void; ms: number; cleared: boolean }>;
  loads: number;
  ro: { cb: ((e: Array<{ contentRect: { width: number; height: number } }>) => void) | null };
}

let h: Harness;
const saved = { ...lineEnv };

beforeEach(() => {
  h = { creates: [], sets: [], sizes: [], destroyed: 0, timers: [], loads: 0, ro: { cb: null } };
  const factory: PlotFactory = (host, opts, data): PlotAdapter => {
    h.creates.push({ opts, data, host });
    return {
      setData: (d) => void h.sets.push(d),
      setSize: (w, hh) => void h.sizes.push([w, hh]),
      destroy: () => void h.destroyed++,
    };
  };
  lineEnv.loadPlot = async () => {
    h.loads++;
    return factory;
  };
  lineEnv.setInterval = (fn, ms) => {
    const t = { fn, ms, cleared: false };
    h.timers.push(t);
    return t;
  };
  lineEnv.clearInterval = (t) => {
    (t as { cleared: boolean }).cleared = true;
  };
  lineEnv.raf = (cb) => (cb(), 0);
  lineEnv.cancelRaf = () => {};
  class FakeRO {
    constructor(cb: Harness['ro']['cb']) {
      h.ro.cb = cb;
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  lineEnv.ResizeObserver = FakeRO as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  Object.assign(lineEnv, saved);
  vi.restoreAllMocks();
});

const line = (tags: string[], props?: Record<string, unknown>) =>
  widgetItem('line', { series: tags }, props as never);
const tick = (el: El, ms = 0) => {
  const t = h.timers.filter((x) => !x.cleared).at(-1)!;
  void el;
  void ms;
  t.fn();
};
const lastData = () => h.sets.at(-1)!;
const plotReady = async (el: El) => {
  await (el as unknown as { whenPlotReady(): Promise<void> }).whenPlotReady();
};

describe('mat-w-line (FR-029, SC-018)', () => {
  it('tải lười: không import uPlot cho tới khi gắn vào DOM; chỉ tải một lần', async () => {
    const src = makeSource([tagInfo('a')]);
    expect(h.loads).toBe(0);
    const el = await mount(line(['a']), src);
    await plotReady(el);
    expect(h.loads).toBe(1);
    expect(h.creates).toHaveLength(1);
    expect(h.creates[0]!.host.getRootNode()).toBe(el.shadowRoot);
  });

  it('điểm dữ liệu khớp giá trị Tag lúc lấy mẫu (SC-018)', async () => {
    const src = makeSource([tagInfo('a'), tagInfo('b')], {}, 10_000);
    src.set('a', { value: 1, quality: 'GOOD' });
    src.set('b', { value: 10, quality: 'GOOD' });
    const el = await mount(line(['a', 'b']), src);
    await plotReady(el);
    tick(el);
    src.advance(1000);
    src.set('a', { value: 2, quality: 'GOOD' });
    src.set('b', { value: 20, quality: 'GOOD' });
    tick(el);
    src.advance(1000);
    src.set('a', { value: 3.5, quality: 'GOOD' });
    tick(el);
    const d = lastData();
    expect(d).toHaveLength(3);
    expect([...d[0]!]).toEqual([10, 11, 12]);
    expect([...d[1]!]).toEqual([1, 2, 3.5]);
    expect([...d[2]!]).toEqual([10, 20, 20]);
  });

  it('chu kỳ lấy mẫu theo sampleMs', async () => {
    const src = makeSource([tagInfo('a')]);
    const el = await mount(line(['a'], { sampleMs: 500 }), src);
    await plotReady(el);
    expect(h.timers.at(-1)!.ms).toBe(500);
    const def = await mount(line(['a']), src);
    await plotReady(def);
    expect(h.timers.at(-1)!.ms).toBe(1000);
  });

  it('quality BAD/STALE/UNKNOWN: đứt đoạn (NaN), GOOD trở lại thì nối tiếp', async () => {
    const src = makeSource([tagInfo('a')], {}, 0);
    src.set('a', { value: 5, quality: 'GOOD' });
    const el = await mount(line(['a']), src);
    await plotReady(el);
    tick(el);
    src.advance(1000);
    src.set('a', { quality: 'BAD' });
    tick(el);
    src.advance(1000);
    src.set('a', { quality: 'STALE' });
    tick(el);
    src.advance(1000);
    src.set('a', { value: 7, quality: 'GOOD' });
    tick(el);
    const y = [...lastData()[1]!];
    expect(y[0]).toBe(5);
    expect(Number.isNaN(y[1]!)).toBe(true);
    expect(Number.isNaN(y[2]!)).toBe(true);
    expect(y[3]).toBe(7);
  });

  it('mỗi đường có màu và kiểu nét khác nhau; tối đa 8 đường', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const src = makeSource(ids.map((i) => tagInfo(i)));
    const el = await mount(line(ids), src);
    await plotReady(el);
    const s = h.creates[0]!.opts.series;
    expect(s).toHaveLength(8);
    expect(new Set(s.map((x) => x.color)).size).toBe(8);
    expect(new Set(s.map((x) => x.dash.join(','))).size).toBe(8);
    expect(h.creates[0]!.data).toHaveLength(9);
  });

  it('giao diện mới (feature 012): phông và bề mặt từ token; tô vùng nhạt chỉ khi một đường', async () => {
    const one = await mount(line(['a']), makeSource([tagInfo('a')]));
    await plotReady(one);
    const o1 = h.creates[0]!.opts;
    expect(o1.font).toBeTruthy();
    expect(o1.surfaceColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(o1.series[0]!.fill).toMatch(/^rgba\(/);
    const two = await mount(line(['a', 'b']), makeSource([tagInfo('a'), tagInfo('b')]));
    await plotReady(two);
    expect(h.creates[1]!.opts.series.every((s) => s.fill === undefined)).toBe(true);
  });

  it('chú giải dạng thẻ: nền nhạt theo màu đường (--mat-chart-N-soft); con trỏ có chấm màu từng đường', async () => {
    const src = makeSource([tagInfo('a'), tagInfo('b')]);
    src.set('a', { value: 1, quality: 'GOOD' });
    src.set('b', { value: 2, quality: 'GOOD' });
    const el = await mount(line(['a', 'b']), src);
    await plotReady(el);
    const li = [...el.shadowRoot!.querySelectorAll<HTMLElement>('.legend li')];
    expect(li[1]!.getAttribute('style')).toContain('--mat-chart-2-soft');
    tick(el);
    h.creates[0]!.opts.onCursor(0);
    await el.updateComplete;
    const dots = [...el.shadowRoot!.querySelectorAll<HTMLElement>('.cursor .dot')];
    expect(dots).toHaveLength(2);
    expect(dots[0]!.getAttribute('style')).toContain('--mat-chart-1');
  });

  it('chú giải: nhãn, giá trị hiện tại, đơn vị; labels ghi đè mô tả Tag', async () => {
    const src = makeSource([
      tagInfo('a', { unit: 'bar', description: 'Áp suất vào' }),
      tagInfo('b'),
    ]);
    src.set('a', { value: 4.2, quality: 'GOOD' });
    src.set('b', { value: 1, quality: 'GOOD' });
    const el = await mount(line(['a', 'b'], { labels: ['Đầu vào'] }), src);
    const rows = [...el.shadowRoot!.querySelectorAll('.legend li')].map((r) =>
      r.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(rows[0]).toContain('Đầu vào');
    expect(rows[0]).toContain('4.2');
    expect(rows[0]).toContain('bar');
    expect(rows[1]).toContain('b'); // không nhãn, không mô tả: id Tag
  });

  it('legend=false ẩn chú giải', async () => {
    const el = await mount(line(['a'], { legend: false }), makeSource([tagInfo('a')]));
    expect(el.shadowRoot!.querySelector('.legend')).toBeNull();
  });

  it('Tag không có trên thiết bị: "không có Tag" trong chú giải, không vẽ, đường khác vẫn chạy', async () => {
    const src = makeSource([tagInfo('a')], {}, 0);
    src.set('a', { value: 3, quality: 'GOOD' });
    const el = await mount(line(['a', 'lạ']), src);
    await plotReady(el);
    tick(el);
    const rows = [...el.shadowRoot!.querySelectorAll('.legend li')].map((r) => r.textContent!);
    expect(rows[1]).toContain('không có Tag');
    expect(h.creates[0]!.opts.series[1]!.show).toBe(false);
    expect(h.creates[0]!.opts.series[0]!.show).toBe(true);
    expect(lastData()[1]![0]).toBe(3);
    expect(Number.isNaN(lastData()[2]![0]!)).toBe(true);
  });

  it('trục: x theo cửa sổ windowSec đến giờ nguồn; y cố định hoặc tự co', async () => {
    const src = makeSource([tagInfo('a')], {}, 100_000);
    src.set('a', { value: 5, quality: 'GOOD' });
    const el = await mount(line(['a'], { windowSec: 30, yMin: 0, yMax: 50 }), src);
    await plotReady(el);
    tick(el);
    expect(h.creates[0]!.opts.xRange()).toEqual([70, 100]);
    expect(h.creates[0]!.opts.yRange(1, 2)).toEqual([0, 50]);
    const auto = await mount(line(['a']), src);
    await plotReady(auto);
    expect(h.creates[1]!.opts.yRange(0, 100)).toEqual([-5, 105]);
  });

  it('chỉ một trong yMin/yMax: tự co (cặp không đủ không áp)', async () => {
    const src = makeSource([tagInfo('a')]);
    const el = await mount(line(['a'], { yMin: 0 }), src);
    await plotReady(el);
    expect(h.creates[0]!.opts.yRange(0, 100)).toEqual([-5, 105]);
  });

  it('tab ẩn: ngừng vẽ nhưng vẫn lấy mẫu theo giờ thật; hiện lại thì vẽ một lần đủ dữ liệu', async () => {
    const src = makeSource([tagInfo('a')], {}, 0);
    src.set('a', { value: 1, quality: 'GOOD' });
    const el = await mount(line(['a']), src);
    await plotReady(el);
    tick(el);
    const before = h.sets.length;
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    src.advance(2000);
    src.set('a', { value: 2, quality: 'GOOD' });
    tick(el);
    src.advance(2000);
    src.set('a', { value: 3, quality: 'GOOD' });
    tick(el);
    expect(h.sets.length).toBe(before);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(h.sets.length).toBe(before + 1);
    const d = lastData();
    // Mẫu vừa lấy lại khi hiện (4000) cùng 0, 2000 (và điểm đứt vì thiếu > 3 x sampleMs không xảy ra ở 2000)
    expect(d[0]![0]).toBe(0);
    expect(d[1]!.at(-1)).toBe(3);
    expect([...d[0]!].every((t, i, a) => i === 0 || t > a[i - 1]!)).toBe(true);
  });

  it('đổi cỡ: setSize được gọi, dữ liệu không mất', async () => {
    const src = makeSource([tagInfo('a')], {}, 0);
    src.set('a', { value: 1, quality: 'GOOD' });
    const el = await mount(line(['a']), src);
    await plotReady(el);
    tick(el);
    src.advance(1000);
    tick(el);
    h.ro.cb!([{ contentRect: { width: 640, height: 320 } }]);
    expect(h.sizes.at(-1)).toEqual([640, 320]);
    expect(lastData()[0]!.length).toBe(2);
    h.ro.cb!([{ contentRect: { width: 700, height: 300 } }]);
    expect(h.sizes.at(-1)).toEqual([700, 300]);
    expect(lastData()[0]!.length).toBe(2);
  });

  it('con trỏ đọc giá trị: onCursor hiện thời điểm và giá trị từng đường', async () => {
    const src = makeSource([tagInfo('a', { unit: 'V' })], {}, 5000);
    src.set('a', { value: 12.34, quality: 'GOOD' });
    const el = await mount(line(['a']), src);
    await plotReady(el);
    tick(el);
    src.advance(1000);
    src.set('a', { value: 20, quality: 'GOOD' });
    tick(el);
    h.creates[0]!.opts.onCursor(0);
    await el.updateComplete;
    const cur = textOf(el, '.cursor');
    expect(cur).toContain('12.3');
    h.creates[0]!.opts.onCursor(null);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.cursor')).toBeNull();
  });

  it('gỡ khỏi DOM: hủy timer và hủy đồ thị', async () => {
    const el = await mount(line(['a']), makeSource([tagInfo('a')]));
    await plotReady(el);
    el.remove();
    expect(h.timers.every((t) => t.cleared)).toBe(true);
    expect(h.destroyed).toBe(1);
  });

  it('gỡ trước khi tải xong: không dựng đồ thị', async () => {
    let release!: (f: PlotFactory) => void;
    lineEnv.loadPlot = () =>
      new Promise<PlotFactory>((r) => {
        release = r;
      });
    const el = await mount(line(['a']), makeSource([tagInfo('a')]));
    el.remove();
    release((() => {
      throw new Error('không được gọi');
    }) as unknown as PlotFactory);
    await Promise.resolve();
    expect(h.creates).toHaveLength(0);
  });

  it('tải uPlot lỗi: widget không ném, hiện thông báo chữ', async () => {
    lineEnv.loadPlot = async () => {
      throw new Error('chunk');
    };
    const el = await mount(line(['a']), makeSource([tagInfo('a')]));
    await plotReady(el);
    await el.updateComplete;
    expect(textOf(el, '.plot-error')).not.toBe('');
  });

  it('ARIA: role=img có aria-label mô tả, kèm bảng dữ liệu ẩn đọc được', async () => {
    const src = makeSource([tagInfo('a', { unit: 'bar' })]);
    src.set('a', { value: 4.2, quality: 'GOOD' });
    const el = await mount(line(['a'], { labels: ['Áp suất'] }), src);
    const img = el.shadowRoot!.querySelector('[role="img"]')!;
    expect(img.getAttribute('aria-label')).toContain('Áp suất');
    expect(img.getAttribute('aria-label')).toContain('4.2');
    const table = el.shadowRoot!.querySelector('table.sr-only')!;
    expect(table.contains(img)).toBe(false);
    expect(img.contains(table)).toBe(false);
    expect(table.textContent).toContain('Áp suất');
    expect(table.textContent).toContain('4.2');
  });

  it('XSS: nhãn và tên Tag hiện dạng chữ', async () => {
    const evil = '<img src=x onerror=1>';
    const src = makeSource([tagInfo(evil)]);
    src.set(evil, { value: 1, quality: 'GOOD' });
    const el = await mount(line([evil], { labels: ['<script>1</script>'] }), src);
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(el.shadowRoot!.querySelector('script')).toBeNull();
    expect(el.shadowRoot!.querySelector('.legend')!.textContent).toContain('<script>1</script>');
  });

  it('không có Tag nào: không ném lỗi', async () => {
    const el = await mount(widgetItem('line', {}), makeSource([]));
    await plotReady(el);
    expect(el.shadowRoot!.querySelector('[role="img"]')).not.toBeNull();
  });

  it('uPlot thật nạp được qua import() lười (không dựng vì jsdom không có canvas)', async () => {
    // uPlot đọc matchMedia khi nạp module; jsdom không có (trình duyệt thật có).
    (globalThis as { matchMedia?: unknown }).matchMedia ??= () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
    const mod = await import('../chart/line-chart.ts');
    const f = await mod.loadUPlot();
    expect(typeof f).toBe('function');
  });
});
