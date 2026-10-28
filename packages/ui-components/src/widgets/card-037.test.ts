// Feature 037: Thẻ giá trị hợp nhất (màu nhấn, kiểu nền, biểu tượng, ngưỡng, nháy khi đổi giá trị).
import { afterEach, describe, expect, it } from 'vitest';
import { accentCss, thresholdLevel } from './card.ts';
import { cleanup, makeSource, mount, tagInfo, textOf, widgetItem } from './test-util.ts';

afterEach(cleanup);

const card = (props?: Record<string, string | number | boolean>, tags = { value: 't1' }) =>
  widgetItem('card', tags, props);
const w = (el: Element) => el.shadowRoot!.querySelector<HTMLElement>('.w')!;

describe('thresholdLevel, accentCss', () => {
  it('alarm thắng warn; quality xấu và chuỗi là ok', () => {
    const p = { warnAbove: 50, alarmAbove: 80, warnBelow: 10 };
    expect(thresholdLevel(p, 40, 'GOOD')).toBe('ok');
    expect(thresholdLevel(p, 60, 'GOOD')).toBe('warn');
    expect(thresholdLevel(p, 90, 'UNCERTAIN')).toBe('alarm');
    expect(thresholdLevel(p, 5, 'GOOD')).toBe('warn');
    expect(thresholdLevel(p, 90, 'BAD')).toBe('ok');
    expect(thresholdLevel(p, '90', 'GOOD')).toBe('ok');
    expect(thresholdLevel(undefined, 90, 'GOOD')).toBe('ok');
  });
  it('màu tự chọn thắng bảng; tên lạ về mặc định; màu không an toàn bị bỏ', () => {
    expect(accentCss('rose')).toBe('var(--mat-tile-rose)');
    expect(accentCss('rose', '#112233')).toBe('#112233');
    expect(accentCss('xx')).toBe('var(--mat-tile-blue)');
    expect(accentCss('teal', 'red;x:url(a)')).toBe('var(--mat-tile-teal)');
  });
});

describe('mat-w-card 037', () => {
  it('mặc định (project cũ) giữ kiểu trơn; fill=soft thì nền nhạt màu xanh dương', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 1, quality: 'GOOD' });
    expect(w(await mount(card(), src)).classList.contains('fill-plain')).toBe(true);
    const el = await mount(card({ fill: 'soft' }), src);
    expect(w(el).classList.contains('fill-soft')).toBe(true);
    expect(w(el).style.getPropertyValue('--c')).toBe('var(--mat-tile-blue)');
  });

  it('kiểu nền đặc, màu nhấn và biểu tượng', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 1, quality: 'GOOD' });
    const el = await mount(card({ fill: 'solid', accent: 'green', icon: 'pump' }), src);
    expect(w(el).classList.contains('fill-solid')).toBe(true);
    expect(w(el).classList.contains('has-ico')).toBe(true);
    expect(w(el).style.getPropertyValue('--c')).toBe('var(--mat-tile-green)');
    expect(el.shadowRoot!.querySelector('svg.ico')).not.toBeNull();
  });

  it('ngưỡng đổi màu và có chữ trạng thái (không chỉ màu)', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 60, quality: 'GOOD' });
    const el = await mount(card({ warnAbove: 50, alarmAbove: 80, statusText: true }), src);
    expect(w(el).classList.contains('lv-warn')).toBe(true);
    expect(textOf(el, '.stat')).toContain('Chú ý');
    expect(w(el).getAttribute('aria-label')).toContain('Chú ý');
    src.set('t1', { value: 90, quality: 'GOOD' });
    await el.updateComplete;
    expect(w(el).classList.contains('lv-alarm')).toBe(true);
    expect(textOf(el, '.stat')).toContain('Cảnh báo');
    expect(w(el).style.getPropertyValue('--c')).toBe('');
  });

  it('khe alarm bật thì thẻ chuyển đỏ', async () => {
    const src = makeSource([tagInfo('t1'), tagInfo('a', { type: 'BOOL' })]);
    src.set('t1', { value: 1, quality: 'GOOD' });
    src.set('a', { value: true, quality: 'GOOD' });
    const el = await mount(card({}, { value: 't1', alarm: 'a' } as never), src);
    expect(w(el).classList.contains('lv-alarm')).toBe(true);
  });

  it('showUnit=false ẩn đơn vị; statusText mặc định tắt', async () => {
    const src = makeSource([tagInfo('t1', { unit: 'bar' })]);
    src.set('t1', { value: 1, quality: 'GOOD' });
    const el = await mount(card({ showUnit: false }), src);
    expect(el.shadowRoot!.querySelector('.unit')).toBeNull();
    expect(el.shadowRoot!.querySelector('.stat')).toBeNull();
  });

  it('nháy nhẹ khi giá trị đổi ở chế độ chạy (flash=true); không nháy lần đầu, mặc định hoặc ở edit', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 1, quality: 'GOOD' });
    const el = await mount(card({ flash: true }), src);
    const v = () => el.shadowRoot!.querySelector('.value')!.classList;
    expect(v().contains('fl-a') || v().contains('fl-b')).toBe(false);
    src.set('t1', { value: 2, quality: 'GOOD' });
    await el.updateComplete;
    expect(v().contains('fl-a')).toBe(true);
    src.set('t1', { value: 3, quality: 'GOOD' });
    await el.updateComplete;
    expect(v().contains('fl-b')).toBe(true);
    const off = await mount(card(), src);
    src.set('t1', { value: 4, quality: 'GOOD' });
    await off.updateComplete;
    expect(off.shadowRoot!.querySelector('.value')!.className).not.toMatch(/fl-/);
    const ed = await mount(card({ flash: true }), src, 'edit');
    src.set('t1', { value: 5, quality: 'GOOD' });
    await ed.updateComplete;
    expect(ed.shadowRoot!.querySelector('.value')!.className).not.toMatch(/fl-/);
  });

  it('dự án cũ: stat-tile vẫn vẽ (bí danh trong runtime)', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 1, quality: 'GOOD' });
    const el = await mount(widgetItem('stat-tile', { value: 't1' }, { color: 'rose' }), src);
    expect(el.shadowRoot!.querySelector('.tile')).not.toBeNull();
  });
});
