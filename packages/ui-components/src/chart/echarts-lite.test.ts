// ECharts lite (feature 012, T041, contracts/ui-theme.md §3): nạp lười một lần, theme từ token, tắt hoạt ảnh khi giảm
// chuyển động, tooltip dựng bằng DOM (không chuỗi HTML).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  baseOption,
  loadECharts,
  prefersReducedMotion,
  readChartTheme,
  setEChartsLoader,
  tooltipContent,
  type ChartTheme,
  type EChartsLite,
} from './echarts-lite.ts';

afterEach(() => {
  vi.restoreAllMocks();
  setEChartsLoader(null);
  document.body.replaceChildren();
});

const theme = (over: Partial<ChartTheme> = {}): ChartTheme => ({
  ...readChartTheme(document.body),
  ...over,
});

describe('loadECharts', () => {
  it('nạp một lần, gọi lại trả cùng thư viện', async () => {
    const fake: EChartsLite = { init: vi.fn() };
    const loader = vi.fn(async () => fake);
    setEChartsLoader(loader);
    const [a, b] = await Promise.all([loadECharts(), loadECharts()]);
    expect(a).toBe(fake);
    expect(b).toBe(fake);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('nạp lỗi thì lần sau thử lại', async () => {
    let n = 0;
    setEChartsLoader(async () => {
      if (n++ === 0) throw new Error('mạng');
      return { init: vi.fn() };
    });
    await expect(loadECharts()).rejects.toThrow('mạng');
    await expect(loadECharts()).resolves.toBeTruthy();
  });

  it('bản thật: vẽ được biểu đồ cột SVG (renderer SVG, không cần canvas)', async () => {
    // jsdom không có canvas: zrender đo chữ bằng ước lượng (tránh lỗi 'Not implemented' trên console).
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const lib = await loadECharts();
    const box = document.createElement('div');
    document.body.append(box);
    const chart = lib.init(box, { width: 300, height: 200 });
    chart.setOption({
      animation: false,
      xAxis: { type: 'category', data: ['a', 'b'] },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: [1, 2] }],
    });
    expect(box.querySelector('svg')).not.toBeNull();
    expect(box.querySelectorAll('svg path').length).toBeGreaterThan(1);
    chart.dispose();
  });
});

describe('theme từ token', () => {
  it('đọc --mat-chart-1..12, chữ, nền, phông, chuyển động từ CSS; thiếu thì dùng giá trị industrial', () => {
    const el = document.createElement('div');
    el.style.setProperty('--mat-chart-1', '#123456');
    el.style.setProperty('--mat-text', '#010203');
    el.style.setProperty('--mat-motion', '200ms');
    document.body.append(el);
    const t = readChartTheme(el);
    expect(t.colors).toHaveLength(12);
    expect(t.colors[0]).toBe('#123456');
    expect(t.colors[1]).toBe('#c2410c'); // mặc định industrial
    expect(t.text).toBe('#010203');
    expect(t.motionMs).toBe(200);
  });

  it('baseOption: màu chuỗi, chữ theo token, hoạt ảnh vào nhẹ theo --mat-motion', () => {
    const o = baseOption(theme({ motionMs: 200 }), false) as Record<string, unknown>;
    expect(o.color).toHaveLength(12);
    expect(o.animation).toBe(true);
    expect(o.animationDuration).toBeGreaterThan(0);
    expect((o.textStyle as { fontFamily: string }).fontFamily).toBeTruthy();
  });

  it('giảm chuyển động hoặc --mat-motion = 0: tắt hoạt ảnh', () => {
    expect((baseOption(theme(), true) as { animation: boolean }).animation).toBe(false);
    expect((baseOption(theme({ motionMs: 0 }), false) as { animation: boolean }).animation).toBe(
      false,
    );
  });

  it('prefersReducedMotion theo matchMedia', () => {
    const win = (m: boolean) =>
      ({
        matchMedia: (q: string) => ({ matches: m && q.includes('reduce') }),
      }) as unknown as Window;
    expect(prefersReducedMotion(win(true))).toBe(true);
    expect(prefersReducedMotion(win(false))).toBe(false);
    expect(prefersReducedMotion({} as Window)).toBe(false);
  });
});

describe('tooltipContent', () => {
  it('dựng bằng DOM: tên Tag độc hại hiện dạng chữ, có ô màu và giá trị', () => {
    const el = tooltipContent(document, 'Tiêu đề <b>', [
      { color: '#ff0000', name: '<img src=x onerror=1>', value: '12.5 kW' },
    ]);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=1>');
    expect(el.textContent).toContain('Tiêu đề <b>');
    expect(el.textContent).toContain('12.5 kW');
    expect((el.querySelector('.mk') as HTMLElement).style.background).toBeTruthy();
  });

  it('màu không hợp lệ không được đưa vào style', () => {
    const el = tooltipContent(document, '', [
      { color: 'red;background:url(x)', name: 'a', value: '1' },
    ]);
    expect((el.querySelector('.mk') as HTMLElement).style.background).toBe('');
  });
});
