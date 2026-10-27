// Widget `pie` vẽ bằng ECharts lite (feature 012, T043, FR-033, FR-037): donut, decimals, showPercent, showTotal, labels giữ
// ý nghĩa; chú giải, phần trăm, tổng giữa vành khuyên và phần truy cập vẫn do Lit vẽ. Cung đọc từ option đưa cho ECharts
// (bản giả) thay cho path SVG tự vẽ trước đây.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callFormatter,
  cleanup,
  fakeECharts,
  makeSource,
  mountChart as mount,
  tagInfo,
  textOf,
  widgetItem,
} from './test-util.ts';

let ec: ReturnType<typeof fakeECharts>;
beforeEach(() => {
  ec = fakeECharts();
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const pie = (tags: string[], props?: Record<string, unknown>) =>
  widgetItem('pie', { series: tags }, props as never, { width: 280, height: 280 });
type Slice = { name: string; value: number; itemStyle: { color: string } };
type PieSeries = { type: string; radius: [string | number, string]; data: Slice[] };
const pieSeries = () => (ec.option().series as PieSeries[])[0]!;
/** Cung đang vẽ (phần tử dữ liệu của series pie); chưa có biểu đồ thì rỗng. */
const slices = (el: Element) => {
  void el;
  return ec.charts.length && ec.charts.at(-1)!.options.length ? pieSeries().data : [];
};
const legend = (el: Element) =>
  [...el.shadowRoot!.querySelectorAll('.legend li')].map((li) =>
    li.textContent!.replace(/\s+/g, ' ').trim(),
  );

describe('mat-w-pie (FR-030)', () => {
  it('phần trăm đúng và tổng 100 %', async () => {
    const src = makeSource([tagInfo('a'), tagInfo('b'), tagInfo('c')]);
    src.set('a', { value: 10, quality: 'GOOD' });
    src.set('b', { value: 30, quality: 'GOOD' });
    src.set('c', { value: 60, quality: 'GOOD' });
    const el = await mount(pie(['a', 'b', 'c'], { decimals: 0 }), src);
    const rows = legend(el);
    expect(rows[0]).toContain('10%');
    expect(rows[1]).toContain('30%');
    expect(rows[2]).toContain('60%');
    const pcts = [...el.shadowRoot!.querySelectorAll('.pct')].map((p) =>
      Number(p.textContent!.replace('%', '')),
    );
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(slices(el)).toHaveLength(3);
  });

  it('giá trị đổi thì cung đổi theo', async () => {
    const src = makeSource([tagInfo('a'), tagInfo('b')]);
    src.set('a', { value: 1, quality: 'GOOD' });
    src.set('b', { value: 1, quality: 'GOOD' });
    const el = await mount(pie(['a', 'b'], { decimals: 0 }), src);
    expect(legend(el)[0]).toContain('50%');
    src.set('a', { value: 3, quality: 'GOOD' });
    await el.updateComplete;
    expect(legend(el)[0]).toContain('75%');
    expect(slices(el).map((x) => x.value)).toEqual([3, 1]);
  });

  it('donut hiện tổng ở giữa khi showTotal; pie đặc thì không có lỗ', async () => {
    const src = makeSource([tagInfo('a', { unit: 'kg' }), tagInfo('b')]);
    src.set('a', { value: 20, quality: 'GOOD' });
    src.set('b', { value: 30, quality: 'GOOD' });
    const donut = await mount(pie(['a', 'b'], { donut: true, showTotal: true, decimals: 1 }), src);
    expect(textOf(donut, '.total')).toContain('50.0');
    const solid = await mount(pie(['a', 'b'], { donut: false, showTotal: true }), src);
    expect(solid.shadowRoot!.querySelector('.total')).toBeNull();
    const noTotal = await mount(pie(['a', 'b'], { donut: true }), src);
    expect(noTotal.shadowRoot!.querySelector('.total')).toBeNull();
  });

  it('donut (mặc định true): vành khuyên có lỗ; donut=false: tròn đặc', async () => {
    const src = makeSource([tagInfo('a'), tagInfo('b')]);
    src.set('a', { value: 1, quality: 'GOOD' });
    src.set('b', { value: 2, quality: 'GOOD' });
    await mount(pie(['a', 'b']), src);
    expect(pieSeries().type).toBe('pie');
    expect(parseFloat(String(pieSeries().radius[0]))).toBeGreaterThan(0);
    await mount(pie(['a', 'b'], { donut: false }), src);
    expect(parseFloat(String(pieSeries().radius[0]))).toBe(0);
  });

  it('màu cung theo token chuỗi, khớp ô màu của chú giải; tooltip có tên, giá trị, phần trăm', async () => {
    const src = makeSource([tagInfo('a', { unit: 'kWh' }), tagInfo('b', { unit: 'kWh' })]);
    src.set('a', { value: 1, quality: 'GOOD' });
    src.set('b', { value: 3, quality: 'GOOD' });
    const el = await mount(pie(['a', 'b'], { labels: ['<b>X</b>', 'Y'], decimals: 0 }), src);
    expect(slices(el).map((x) => x.itemStyle.color)).toEqual(['#348fe2', '#00a5a5']);
    const sw = [...el.shadowRoot!.querySelectorAll<HTMLElement>('.legend .sw')];
    expect(sw[1]!.getAttribute('style')).toContain('--mat-chart-2');
    const tip = callFormatter((ec.option().tooltip as { formatter: unknown }).formatter, {
      dataIndex: 0,
    }) as HTMLElement;
    expect(tip.querySelector('b')).toBeNull();
    expect(tip.textContent).toContain('<b>X</b>');
    expect(tip.textContent).toContain('1 kWh');
    expect(tip.textContent).toContain('25%');
  });

  // Nạp ECharts thật lần đầu (biến đổi ~600 KB mã) chậm khi nhiều worker chạy song song: hạn 30 s.
  it('vẽ thật bằng ECharts lite (SVG)', { timeout: 30_000 }, async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    cleanup();
    const src = makeSource([tagInfo('a'), tagInfo('b')]);
    src.set('a', { value: 1, quality: 'GOOD' });
    src.set('b', { value: 2, quality: 'GOOD' });
    const el = await mount(pie(['a', 'b']), src);
    expect(el.shadowRoot!.querySelector('.ec svg path')).not.toBeNull();
  });

  it('showPercent=false ẩn phần trăm', async () => {
    const src = makeSource([tagInfo('a')]);
    src.set('a', { value: 1, quality: 'GOOD' });
    const el = await mount(pie(['a'], { showPercent: false }), src);
    expect(el.shadowRoot!.querySelector('.pct')).toBeNull();
  });

  it('tổng 0: "Không có dữ liệu", không cung, không NaN', async () => {
    const src = makeSource([tagInfo('a'), tagInfo('b')]);
    src.set('a', { value: 0, quality: 'GOOD' });
    src.set('b', { value: 0, quality: 'GOOD' });
    const el = await mount(pie(['a', 'b']), src);
    expect(textOf(el, '.empty')).toBe('Không có dữ liệu');
    expect(slices(el)).toHaveLength(0);
    expect(ec.charts).toHaveLength(0);
    expect(el.shadowRoot!.textContent).not.toContain('NaN');
  });

  it('âm và BAD bị loại khỏi tổng, có dấu "bị loại" trong chú giải', async () => {
    const src = makeSource([tagInfo('a'), tagInfo('b'), tagInfo('c'), tagInfo('d')]);
    src.set('a', { value: 10, quality: 'GOOD' });
    src.set('b', { value: -5, quality: 'GOOD' });
    src.set('c', { value: 7, quality: 'BAD' });
    src.set('d', { value: 30, quality: 'GOOD' });
    const el = await mount(pie(['a', 'b', 'c', 'd'], { decimals: 0 }), src);
    const rows = legend(el);
    expect(rows[0]).toContain('25%');
    expect(rows[3]).toContain('75%');
    expect(rows[1]).toContain('bị loại');
    expect(rows[2]).toContain('bị loại');
    expect(rows[2]).toContain('BAD');
    expect(slices(el)).toHaveLength(2);
  });

  it('một phần tử 100 %: vẽ được cả vòng', async () => {
    const src = makeSource([tagInfo('a')]);
    src.set('a', { value: 9, quality: 'GOOD' });
    const el = await mount(pie(['a'], { decimals: 0 }), src);
    expect(legend(el)[0]).toContain('100%');
    expect(slices(el)).toHaveLength(1);
    expect(slices(el)[0]!.value).toBe(9);
  });

  it('nhãn: labels, mô tả Tag, id Tag', async () => {
    const src = makeSource([tagInfo('a', { description: 'Mô tả' }), tagInfo('b'), tagInfo('c')]);
    for (const id of ['a', 'b', 'c']) src.set(id, { value: 1, quality: 'GOOD' });
    const el = await mount(pie(['a', 'b', 'c'], { labels: ['Một'] }), src);
    const rows = legend(el);
    expect(rows[0]).toContain('Một');
    expect(rows[1]).toContain('b');
    expect(rows[2]).toContain('c');
  });

  it('role=img, aria-label và bảng dữ liệu ẩn', async () => {
    const src = makeSource([tagInfo('a'), tagInfo('b')]);
    src.set('a', { value: 1, quality: 'GOOD' });
    src.set('b', { value: 3, quality: 'GOOD' });
    const el = await mount(pie(['a', 'b'], { labels: ['X', 'Y'], decimals: 0 }), src);
    const img = el.shadowRoot!.querySelector('[role="img"]')!;
    expect(img.getAttribute('aria-label')).toContain('X 25%');
    expect(img.getAttribute('aria-label')).toContain('Y 75%');
    const t = el.shadowRoot!.querySelector('table.sr-only')!;
    expect(t.textContent).toContain('Y');
  });

  it('XSS: nhãn hiện dạng chữ', async () => {
    const src = makeSource([tagInfo('a')]);
    src.set('a', { value: 1, quality: 'GOOD' });
    const el = await mount(pie(['a'], { labels: ['<img src=x onerror=1>'] }), src);
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(legend(el)[0]).toContain('<img src=x onerror=1>');
  });
});
