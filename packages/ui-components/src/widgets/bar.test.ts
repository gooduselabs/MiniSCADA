// Widget `bar` vẽ bằng ECharts lite (feature 012, T042, FR-033, FR-037): thuộc tính cũ giữ nguyên ý nghĩa (orientation,
// min, max, decimals, showValues, labels); test đọc option đưa cho ECharts (bản giả) thay cho hình SVG tự vẽ trước đây,
// cộng một ca vẽ thật. Phần truy cập (role=img, aria-label, bảng ẩn) và chữ BAD/STALE/? tại chỗ như cũ.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callFormatter,
  cleanup,
  fakeECharts,
  makeSource,
  mount,
  mountChart,
  tagInfo,
  textOf,
  widgetItem,
} from './test-util.ts';

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const bar = (tags: string[], props?: Record<string, unknown>) =>
  widgetItem('bar', { series: tags }, props as never, { width: 400, height: 260 });

type Axis = { type: string; data?: string[]; min?: number; max?: number; inverse?: boolean };
type Datum = {
  value: number;
  itemStyle: { color: string; opacity: number };
  label?: { show?: boolean; formatter?: unknown };
};
const series = (o: Record<string, unknown>) =>
  (
    o.series as Array<{ type: string; data: Datum[]; label: { show: boolean; formatter: unknown } }>
  )[0]!;
const axes = (o: Record<string, unknown>) => ({ x: o.xAxis as Axis, y: o.yAxis as Axis });

describe('mat-w-bar (FR-030, FR-033)', () => {
  it('cột theo giá trị trên thang min–max; giá trị đổi thì option đổi', async () => {
    const ec = fakeECharts();
    const src = makeSource([tagInfo('a'), tagInfo('b')]);
    src.set('a', { value: 25, quality: 'GOOD' });
    src.set('b', { value: 75, quality: 'GOOD' });
    const el = await mountChart(bar(['a', 'b'], { min: 0, max: 100 }), src);
    const s = series(ec.option());
    expect(s.type).toBe('bar');
    expect(s.data.map((d) => d.value)).toEqual([25, 75]);
    expect(axes(ec.option()).y).toMatchObject({ type: 'value', min: 0, max: 100 });
    expect(axes(ec.option()).x.type).toBe('category');
    src.set('a', { value: 100, quality: 'GOOD' });
    await el.updateComplete;
    expect(series(ec.option()).data[0]!.value).toBe(100);
    expect(ec.charts).toHaveLength(1);
  });

  it('thang tự co từ 0 khi không đặt min/max (như trước)', async () => {
    const ec = fakeECharts();
    const src = makeSource([tagInfo('a'), tagInfo('b')]);
    src.set('a', { value: -5, quality: 'GOOD' });
    src.set('b', { value: 20, quality: 'GOOD' });
    await mountChart(bar(['a', 'b']), src);
    expect(axes(ec.option()).y).toMatchObject({ min: -5, max: 20 });
  });

  it('nhãn và số hiện đúng; showValues=false ẩn số; labels thắng mô tả Tag', async () => {
    const ec = fakeECharts();
    const src = makeSource([tagInfo('a', { description: 'Mô tả A', unit: 'm3' })]);
    src.set('a', { value: 12.345, quality: 'GOOD' });
    await mountChart(bar(['a'], { decimals: 2 }), src);
    expect(axes(ec.option()).x.data).toEqual(['Mô tả A']);
    const s = series(ec.option());
    expect(s.label.show).toBe(true);
    expect(callFormatter(s.label.formatter, { dataIndex: 0 })).toBe('12.35');
    await mountChart(bar(['a'], { showValues: false }), src);
    expect(series(ec.option()).label.show).toBe(false);
    await mountChart(bar(['a'], { labels: ['Nhãn riêng'] }), src);
    expect(axes(ec.option()).x.data).toEqual(['Nhãn riêng']);
  });

  it('ngang: trục giá trị nằm ngang, trục loại dọc (cột đầu ở trên)', async () => {
    const ec = fakeECharts();
    const src = makeSource([tagInfo('a')]);
    src.set('a', { value: 50, quality: 'GOOD' });
    const el = await mountChart(bar(['a'], { orientation: 'horizontal', min: 0, max: 100 }), src);
    const { x, y } = axes(ec.option());
    expect(x).toMatchObject({ type: 'value', min: 0, max: 100 });
    expect(y).toMatchObject({ type: 'category', inverse: true });
    expect(el.shadowRoot!.querySelector('.w')!.classList.contains('horizontal')).toBe(true);
  });

  it('màu chuỗi lấy từ 12 token theo thứ tự; UNCERTAIN vẫn vẽ, kèm dấu ● cạnh số', async () => {
    const ec = fakeECharts();
    const ids = Array.from({ length: 12 }, (_, i) => `t${i}`);
    const src = makeSource(ids.map((id) => tagInfo(id)));
    ids.forEach((id) => src.set(id, { value: 1, quality: 'GOOD' }));
    src.set('t1', { value: 2, quality: 'UNCERTAIN' });
    await mountChart(bar(ids), src);
    const s = series(ec.option());
    expect(s.data[0]!.itemStyle.color).toBe('#0b7285'); // --mat-chart-1 industrial
    expect(new Set(s.data.map((d) => d.itemStyle.color)).size).toBe(12);
    expect(s.data[1]!.value).toBe(2);
    expect(s.data[1]!.itemStyle.opacity).toBe(1);
    expect(callFormatter(s.label.formatter, { dataIndex: 1 })).toBe('2.0 ●');
    expect(callFormatter(s.label.formatter, { dataIndex: 0 })).toBe('1.0');
  });

  it('BAD/STALE/UNKNOWN: không vẽ cột, có chữ BAD/STALE/? tại chỗ (không chỉ màu)', async () => {
    const ec = fakeECharts();
    const src = makeSource([tagInfo('a'), tagInfo('b'), tagInfo('c')]);
    src.set('a', { value: 5, quality: 'BAD' });
    src.set('b', { value: 5, quality: 'STALE' });
    await mountChart(bar(['a', 'b', 'c']), src);
    const data = series(ec.option()).data;
    expect(data.map((d) => d.value)).toEqual([0, 0, 0]);
    expect(data.every((d) => d.itemStyle.opacity === 0)).toBe(true);
    expect(data.map((d) => d.label?.show && d.label.formatter)).toEqual(['BAD', 'STALE', '?']);
  });

  it('role=img, aria-label mô tả và bảng dữ liệu ẩn', async () => {
    fakeECharts();
    const src = makeSource([tagInfo('a', { unit: 'kW' }), tagInfo('b')]);
    src.set('a', { value: 3, quality: 'GOOD' });
    src.set('b', { value: 4, quality: 'BAD' });
    const el = await mountChart(bar(['a', 'b'], { labels: ['Bơm 1', 'Bơm 2'] }), src);
    const img = el.shadowRoot!.querySelector('[role="img"]')!;
    const label = img.getAttribute('aria-label')!;
    expect(label).toContain('Bơm 1');
    expect(label).toContain('3.0');
    expect(label).toContain('BAD');
    const t = el.shadowRoot!.querySelector('table.sr-only')!;
    expect(t.textContent).toContain('Bơm 2');
    expect(t.contains(img)).toBe(false);
  });

  it('không có Tag: không ném lỗi, hiện "Không có dữ liệu", không nạp ECharts', async () => {
    const ec = fakeECharts();
    const el = await mountChart(widgetItem('bar', {}), makeSource([]));
    expect(textOf(el, '.empty')).toBe('Không có dữ liệu');
    expect(ec.charts).toHaveLength(0);
  });

  it('XSS: nhãn và tên Tag là chữ thuần (trục, tooltip dựng bằng DOM)', async () => {
    const ec = fakeECharts();
    const evil = '<img src=x onerror=1>';
    const src = makeSource([tagInfo(evil)]);
    src.set(evil, { value: 1, quality: 'GOOD' });
    const el = await mountChart(bar([evil], { labels: ['<script>1</script>'] }), src);
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(el.shadowRoot!.querySelector('script')).toBeNull();
    expect(axes(ec.option()).x.data).toEqual(['<script>1</script>']);
    const tip = callFormatter((ec.option().tooltip as { formatter: unknown }).formatter, {
      dataIndex: 0,
    }) as HTMLElement;
    expect(tip).toBeInstanceOf(HTMLElement);
    expect(tip.querySelector('script')).toBeNull();
    expect(tip.textContent).toContain('<script>1</script>');
  });

  it('nhãn dài bị cắt cho vừa dải nhưng đủ chữ trong tooltip', async () => {
    const ec = fakeECharts();
    const long = 'Rất rất rất rất rất rất dài nhãn của một cột';
    const src = makeSource([tagInfo('a'), tagInfo('b'), tagInfo('c'), tagInfo('d')]);
    src.set('a', { value: 1, quality: 'GOOD' });
    await mountChart(bar(['a', 'b', 'c', 'd'], { labels: [long] }), src);
    const x = ec.option().xAxis as { axisLabel: { overflow: string; width: number } };
    expect(x.axisLabel.overflow).toBe('truncate');
    expect(x.axisLabel.width).toBeGreaterThan(0);
    const tip = callFormatter((ec.option().tooltip as { formatter: unknown }).formatter, {
      dataIndex: 0,
    }) as HTMLElement;
    expect(tip.textContent).toContain(long);
  });

  it('gỡ khỏi trang thì giải phóng biểu đồ', async () => {
    const ec = fakeECharts();
    const src = makeSource([tagInfo('a')]);
    src.set('a', { value: 1, quality: 'GOOD' });
    const el = await mountChart(bar(['a']), src);
    expect(ec.charts[0]!.init).toEqual({ width: 400, height: 260 });
    el.remove();
    expect(ec.charts[0]!.disposed).toBe(true);
  });

  it('vẽ thật bằng ECharts lite (SVG) trong Shadow DOM', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const src = makeSource([tagInfo('a'), tagInfo('b')]);
    src.set('a', { value: 3, quality: 'GOOD' });
    src.set('b', { value: 6, quality: 'GOOD' });
    const el = await mountChart(bar(['a', 'b']), src);
    expect(el.shadowRoot!.querySelector('.ec svg')).not.toBeNull();
    const before = await mount(widgetItem('bar', {}), makeSource([]));
    expect(before.shadowRoot!.querySelector('.ec')).toBeNull();
  });
});
