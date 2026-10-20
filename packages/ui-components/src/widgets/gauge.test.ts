// Widget `gauge` vẽ bằng ECharts lite (feature 012, T044, FR-033, FR-037): label, min, max, decimals, unit, zones, showValue
// giữ ý nghĩa; nhãn, số đọc và phần truy cập (role=meter) do Lit vẽ. Kim và vùng màu đọc từ option đưa cho ECharts (bản giả)
// thay cho SVG tự vẽ trước đây: góc kim = startAngle 180° ... endAngle 0° theo phân số của giá trị đã kẹp trong thang.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

type GaugeSeries = {
  type: string;
  min: number;
  max: number;
  startAngle: number;
  endAngle: number;
  pointer: { show: boolean };
  axisLine: { lineStyle: { color: Array<[number, string]> } };
  data: Array<{ value: number }>;
};
const gs = () => (ec.option().series as GaugeSeries[])[0]!;

const gauge = (props?: Record<string, unknown>, tag = 't1') =>
  widgetItem('gauge', { value: tag }, props as never);
/** Góc kim theo cách cũ (-90° = min, 0° = giữa, +90° = max) suy từ option ECharts. */
const angle = (el: Element) => {
  void el;
  const s = gs();
  const f = (s.data[0]!.value - s.min) / (s.max - s.min);
  const deg = s.startAngle + (s.endAngle - s.startAngle) * f; // 180 -> 0
  return 90 - deg;
};
const meter = (el: Element) => el.shadowRoot!.querySelector('.w')!;

describe('mat-w-gauge (FR-027)', () => {
  it('kim theo khoảng min–max: min = -90°, giữa = 0°, max = +90°', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 0, quality: 'GOOD' });
    const el = await mount(gauge({ min: 0, max: 200 }), src);
    expect(angle(el)).toBe(-90);
    src.set('t1', { value: 100, quality: 'GOOD' });
    await el.updateComplete;
    expect(angle(el)).toBe(0);
    src.set('t1', { value: 200, quality: 'GOOD' });
    await el.updateComplete;
    expect(angle(el)).toBe(90);
  });

  it('giá trị ngoài khoảng: kim kẹp ở đầu thang', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 500, quality: 'GOOD' });
    const el = await mount(gauge({ min: 0, max: 100 }), src);
    expect(angle(el)).toBe(90);
    src.set('t1', { value: -5, quality: 'GOOD' });
    await el.updateComplete;
    expect(angle(el)).toBe(-90);
  });

  it('min/max vắng: theo Tag rồi 0–100', async () => {
    const src = makeSource([tagInfo('t1', { min: 10, max: 30 }), tagInfo('t2')]);
    src.set('t1', { value: 20, quality: 'GOOD' });
    src.set('t2', { value: 50, quality: 'GOOD' });
    const a = await mount(gauge(undefined, 't1'), src);
    expect(meter(a).getAttribute('aria-valuemin')).toBe('10');
    expect(meter(a).getAttribute('aria-valuemax')).toBe('30');
    expect(angle(a)).toBe(0);
    const b = await mount(gauge(undefined, 't2'), src);
    expect(meter(b).getAttribute('aria-valuemin')).toBe('0');
    expect(meter(b).getAttribute('aria-valuemax')).toBe('100');
    expect(angle(b)).toBe(0);
  });

  it('role=meter với aria-valuenow, aria-valuetext và nhãn', async () => {
    const src = makeSource([tagInfo('t1', { unit: 'bar' })]);
    src.set('t1', { value: 42.46, quality: 'GOOD' });
    const el = await mount(gauge({ label: 'Áp suất' }), src);
    const m = meter(el);
    expect(m.getAttribute('role')).toBe('meter');
    expect(m.getAttribute('aria-valuenow')).toBe('42.46');
    expect(m.getAttribute('aria-valuetext')).toBe('42.5 bar');
    expect(m.getAttribute('aria-label')).toBe('Áp suất');
  });

  it('vùng màu: cung theo khoảng, cắt theo thang', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 10, quality: 'GOOD' });
    const el = await mount(
      gauge({
        min: 0,
        max: 100,
        zones: [
          { from: -20, to: 60, color: '#15703a' },
          { from: 60, to: 90, color: '#8f5e00' },
          { from: 90, to: 150, color: '#c42b2b' },
        ],
      }),
      src,
    );
    void el;
    expect(gs().axisLine.lineStyle.color).toEqual([
      [0.6, '#15703a'],
      [0.9, '#8f5e00'],
      [1, '#c42b2b'],
    ]);
  });

  it('vùng màu sai màu bị bỏ', async () => {
    const src = makeSource([tagInfo('t1')]);
    const el = await mount(
      gauge({ zones: [{ from: 0, to: 10, color: 'url(javascript:1)' }] }),
      src,
    );
    void el;
    const stops = gs().axisLine.lineStyle.color;
    expect(stops).toHaveLength(1);
    expect(stops[0]![0]).toBe(1);
    expect(stops.some(([, c]) => c.includes('url'))).toBe(false);
  });

  it('hiện giá trị và đơn vị; showValue=false ẩn chữ giá trị', async () => {
    const src = makeSource([tagInfo('t1', { unit: 'kPa' })]);
    src.set('t1', { value: 3.14159, quality: 'GOOD' });
    const el = await mount(gauge({ decimals: 2 }), src);
    expect(textOf(el, '.value')).toBe('3.14');
    expect(textOf(el, '.unit')).toBe('kPa');
    const hidden = await mount(gauge({ showValue: false }), src);
    expect(hidden.shadowRoot!.querySelector('.value')).toBeNull();
  });

  it('quality: BAD hiện nhãn chữ và giá trị mờ; UNKNOWN hiện "?", không có aria-valuenow', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 50, quality: 'BAD' });
    const bad = await mount(gauge(), src);
    expect(textOf(bad, '.badge')).toBe('BAD');
    expect(bad.shadowRoot!.querySelector('.value')!.classList.contains('dim')).toBe(true);
    const unk = await mount(gauge(undefined, 'lạ'), src);
    expect(textOf(unk, '.value')).toBe('?');
    expect(meter(unk).hasAttribute('aria-valuenow')).toBe(false);
    expect(gs().pointer.show).toBe(false);
  });

  it('vùng màu có khoảng trống: phần trống là màu rãnh, theo thứ tự tăng', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 10, quality: 'GOOD' });
    await mount(
      gauge({
        min: 0,
        max: 100,
        zones: [
          { from: 80, to: 100, color: '#c42b2b' },
          { from: 20, to: 40, color: '#15703a' },
        ],
      }),
      src,
    );
    const stops = gs().axisLine.lineStyle.color;
    expect(stops.map(([f]) => f)).toEqual([0.2, 0.4, 0.8, 1]);
    expect(stops[1]![1]).toBe('#15703a');
    expect(stops[3]![1]).toBe('#c42b2b');
    expect(stops[0]![1]).toBe(stops[2]![1]);
  });

  it('nửa vòng 180° -> 0°, chữ min và max ở hai đầu thang', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 5, quality: 'GOOD' });
    await mount(gauge({ min: 0, max: 50 }), src);
    const s = gs() as GaugeSeries & { axisLabel: { formatter: (v: number) => string } };
    expect([s.type, s.startAngle, s.endAngle]).toEqual(['gauge', 180, 0]);
    // không tooltip (số đọc đã hiện; tooltip mặc định của ECharts dựng HTML từ chuỗi)
    expect(ec.option().tooltip).toMatchObject({ show: false });
    expect(s.axisLabel.formatter(0)).toBe('0');
    expect(s.axisLabel.formatter(50)).toBe('50');
    expect(s.axisLabel.formatter(25)).toBe('');
  });

  // Bán kính theo cả rộng và cao của khung (px), không theo nửa cạnh ngắn ('92%'): khung rộng thấp không còn đồng hồ
  // nhỏ hẳn bản SVG trước 012 (compat-008 dashboard-demo).
  // Tâm cách đáy 10 px (núm kim đường kính 10): núm không đè số đọc bên dưới (T054, ảnh trước/sau 012).
  it('bán kính lấy hết khung: min(rộng/2, cao) trừ lề, tâm cách đáy đủ cho núm kim', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 5, quality: 'GOOD' });
    const wide = { ...gauge(), width: 300, height: 100 };
    await mount(wide, src);
    const s = gs() as GaugeSeries & {
      radius: number;
      center: [string, number];
      anchor: { size: number };
    };
    expect(s.radius).toBe(100 - 10 - 6);
    expect(s.center).toEqual(['50%', 100 - 10]);
    expect(s.center[1] + s.anchor.size / 2).toBeLessThanOrEqual(100 - 4);
    const tall = { ...gauge(), width: 120, height: 300 };
    await mount(tall, src);
    expect((gs() as GaugeSeries & { radius: number }).radius).toBe(120 / 2 - 6);
  });

  // Nạp ECharts thật lần đầu (biến đổi ~600 KB mã) chậm khi nhiều worker chạy song song: hạn 30 s.
  it('vẽ thật bằng ECharts lite (SVG)', { timeout: 30_000 }, async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    cleanup();
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 30, quality: 'GOOD' });
    const el = await mount(gauge(), src);
    expect(el.shadowRoot!.querySelector('.ec svg path')).not.toBeNull();
  });

  it('XSS: nhãn và tên Tag hiện dạng chữ', async () => {
    const evil = '<img src=x onerror=1>';
    const src = makeSource([tagInfo(evil)]);
    src.set(evil, { value: 1, quality: 'GOOD' });
    const el = await mount(gauge({ label: '<script>1</script>' }, evil), src);
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(el.shadowRoot!.querySelector('script')).toBeNull();
    expect(textOf(el, '.label')).toBe('<script>1</script>');
  });
});
