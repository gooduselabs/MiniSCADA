// Widget `stat-tile` (feature 014): thẻ chỉ số tô màu đặc, số to, dòng trạng thái theo quality hoặc Tag cảnh báo, biểu
// tượng lớn mờ ở góc phải, đường nhỏ và mũi tên tùy chọn.
import { afterEach, describe, expect, it } from 'vitest';
import { catalogWidget } from '@mat/project-schema';
import { DASH_ICON_NAMES } from './icons.ts';
import { cleanup, makeSource, mount, tagInfo, textOf, widgetItem } from './test-util.ts';

afterEach(cleanup);

type P = Record<string, string | number | boolean>;
const tile = (props?: P, tags: Record<string, string> = { value: 't1' }) =>
  widgetItem('stat-tile', tags, props);

describe('mat-w-stat-tile (feature 014)', () => {
  it('nhãn, số đọc theo decimals, đơn vị của Tag; aria-label đủ ý', async () => {
    const src = makeSource([tagInfo('t1', { unit: '°C' })]);
    src.set('t1', { value: 28.14, quality: 'GOOD' });
    const el = await mount(tile({ label: 'Nhiệt độ', decimals: 1 }), src);
    expect(textOf(el, '.label')).toBe('Nhiệt độ');
    expect(textOf(el, '.value')).toBe('28.1');
    expect(textOf(el, '.unit')).toBe('°C');
    const g = el.shadowRoot!.querySelector('[role="group"]')!;
    expect(g.getAttribute('aria-label')).toBe('Nhiệt độ: 28.1 °C, Trạng thái: Tốt');
  });

  it('màu nền theo bảng có tên (token --mat-tile-*), màu lạ về teal; chữ trắng', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 1, quality: 'GOOD' });
    const el = await mount(tile({ color: 'violet' }), src);
    const w = el.shadowRoot!.querySelector<HTMLElement>('.tile')!;
    expect(w.style.getPropertyValue('--c')).toBe('var(--mat-tile-violet)');
    const odd = await mount(tile({ color: 'red; background:url(x)' }), src);
    expect(odd.shadowRoot!.querySelector<HTMLElement>('.tile')!.style.getPropertyValue('--c')).toBe(
      'var(--mat-tile-teal)',
    );
  });

  it('biểu tượng lớn mờ: có khi chọn, không có khi none hoặc tên lạ', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 1, quality: 'GOOD' });
    const el = await mount(tile({ icon: 'flame' }), src);
    const icon = el.shadowRoot!.querySelector('svg.icon')!;
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.querySelectorAll('path').length).toBeGreaterThan(0);
    expect(
      (await mount(tile({ icon: 'none' }), src)).shadowRoot!.querySelector('svg.icon'),
    ).toBeNull();
    expect(
      (await mount(tile({ icon: '<img>' }), src)).shadowRoot!.querySelector('svg.icon'),
    ).toBeNull();
  });

  it('danh mục liệt kê đúng các biểu tượng có hình (≥ 16), thêm none', () => {
    const opts = catalogWidget('stat-tile')!.props.find((p) => p.name === 'icon')!.options!;
    expect(opts).toEqual(['none', ...DASH_ICON_NAMES]);
    expect(DASH_ICON_NAMES.length).toBeGreaterThanOrEqual(16);
  });

  for (const [q, word, cls] of [
    ['GOOD', 'Tốt', 'q-good'],
    ['UNCERTAIN', 'Không chắc', 'q-uncertain'],
    ['BAD', 'Lỗi', 'q-bad'],
    ['STALE', 'Mất dữ liệu', 'q-stale'],
  ] as const)
    it(`trạng thái theo quality ${q}: chữ "${word}", lớp ${cls}`, async () => {
      const src = makeSource([tagInfo('t1')]);
      src.set('t1', { value: 5, quality: q });
      const el = await mount(tile(), src);
      expect(textOf(el, '.status')).toBe(`Trạng thái: ${word}`);
      expect(el.shadowRoot!.querySelector('.tile')!.classList.contains(cls)).toBe(true);
    });

  it('BAD, STALE: số mờ; UNKNOWN: "?" và trạng thái Không rõ', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 5, quality: 'BAD' });
    const el = await mount(tile(), src);
    expect(el.shadowRoot!.querySelector('.value')!.classList.contains('dim')).toBe(true);
    const u = makeSource([]);
    const el2 = await mount(tile(), u);
    expect(textOf(el2, '.status')).toBe('Trạng thái: Không rõ');
  });

  it('statusText=false ẩn dòng trạng thái khi Tốt, vẫn hiện khi lỗi (không chỉ màu)', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 5, quality: 'GOOD' });
    const el = await mount(tile({ statusText: false }), src);
    expect(el.shadowRoot!.querySelector('.status')).toBeNull();
    src.set('t1', { value: 5, quality: 'BAD' });
    await el.updateComplete;
    expect(textOf(el, '.status')).toBe('Trạng thái: Lỗi');
  });

  it('khe alarm: Tag BOOL bật thì trạng thái "Cảnh báo" (khi giá trị tốt)', async () => {
    const src = makeSource([tagInfo('t1'), tagInfo('a', { type: 'BOOL' })]);
    src.set('t1', { value: 90, quality: 'GOOD' });
    src.set('a', { value: false, quality: 'GOOD' });
    const el = await mount(tile({}, { value: 't1', alarm: 'a' }), src);
    expect(textOf(el, '.status')).toBe('Trạng thái: Tốt');
    src.set('a', { value: true, quality: 'GOOD' });
    await el.updateComplete;
    expect(textOf(el, '.status')).toBe('Trạng thái: Cảnh báo');
    expect(el.shadowRoot!.querySelector('.tile')!.classList.contains('alarm')).toBe(true);
  });

  it('sparkline và trend: đường nhỏ khi đủ hai điểm, mũi tên theo hướng', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 1, quality: 'GOOD', updatedAt: 1 });
    const el = await mount(tile({ sparkline: true, trend: true }), src);
    expect(el.shadowRoot!.querySelector('.spark polyline')).toBeNull();
    src.set('t1', { value: 3, quality: 'GOOD', updatedAt: 2 });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.spark polyline')).not.toBeNull();
    expect(textOf(el, '.trend')).toBe('▲');
  });

  it('XSS: nhãn chứa HTML hiện dạng chữ', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 1, quality: 'GOOD' });
    const el = await mount(tile({ label: '<img src=x onerror=alert(1)>' }), src);
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(textOf(el, '.label')).toContain('<img');
  });
});
