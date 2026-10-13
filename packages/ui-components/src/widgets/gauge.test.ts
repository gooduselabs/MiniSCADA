import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, makeSource, mount, tagInfo, textOf, widgetItem } from './test-util.ts';

afterEach(cleanup);

const gauge = (props?: Record<string, unknown>, tag = 't1') =>
  widgetItem('gauge', { value: tag }, props as never);
const needle = (el: Element) => el.shadowRoot!.querySelector<SVGElement>('.needle')!;
const angle = (el: Element) => Number(needle(el).getAttribute('data-angle'));
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
    const zones = [...el.shadowRoot!.querySelectorAll<SVGElement>('.zone')];
    expect(zones).toHaveLength(3);
    expect(zones.map((z) => z.getAttribute('stroke'))).toEqual(['#15703a', '#8f5e00', '#c42b2b']);
    expect(zones[0]!.getAttribute('data-from')).toBe('0');
    expect(zones[2]!.getAttribute('data-to')).toBe('100');
  });

  it('vùng màu sai màu bị bỏ', async () => {
    const src = makeSource([tagInfo('t1')]);
    const el = await mount(
      gauge({ zones: [{ from: 0, to: 10, color: 'url(javascript:1)' }] }),
      src,
    );
    expect(el.shadowRoot!.querySelectorAll('.zone')).toHaveLength(0);
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
