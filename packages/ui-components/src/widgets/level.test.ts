import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, makeSource, mount, tagInfo, textOf, widgetItem } from './test-util.ts';

afterEach(cleanup);

const level = (props?: Record<string, unknown>, tag = 't1') =>
  widgetItem('level', { value: tag }, props as never);
const fill = (el: Element) => el.shadowRoot!.querySelector<HTMLElement>('.fill')!;

describe('mat-w-level (FR-027)', () => {
  it('dọc: chiều cao phần đầy theo %; ngang: chiều rộng', async () => {
    const src = makeSource([tagInfo('t1', { unit: 'm' })]);
    src.set('t1', { value: 25, quality: 'GOOD' });
    const v = await mount(level({ min: 0, max: 100 }), src);
    expect(fill(v).style.height).toBe('25%');
    expect(v.shadowRoot!.querySelector('.w')!.classList.contains('vertical')).toBe(true);
    const h = await mount(level({ orientation: 'horizontal' }), src);
    expect(fill(h).style.width).toBe('25%');
    expect(h.shadowRoot!.querySelector('.w')!.classList.contains('horizontal')).toBe(true);
  });

  it('kẹp 0–100 % khi ngoài thang', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 250, quality: 'GOOD' });
    const el = await mount(level(), src);
    expect(fill(el).style.height).toBe('100%');
    src.set('t1', { value: -4, quality: 'GOOD' });
    await el.updateComplete;
    expect(fill(el).style.height).toBe('0%');
  });

  it('min/max theo Tag rồi 0–100; mặc định chỉ hiện %, showRaw hiện thêm giá trị (044)', async () => {
    const src = makeSource([tagInfo('t1', { min: 0, max: 8, unit: 'm' })]);
    src.set('t1', { value: 2, quality: 'GOOD' });
    const el = await mount(level({ decimals: 1 }), src);
    expect(fill(el).style.height).toBe('25%');
    expect(textOf(el, '.percent')).toBe('25%');
    expect(el.shadowRoot!.querySelector('.value')).toBeNull();
    const raw = await mount(level({ decimals: 1, showRaw: true }), src);
    expect(textOf(raw, '.percent')).toBe('25%');
    expect(textOf(raw, '.value')).toBe('2.0');
    expect(textOf(raw, '.unit')).toBe('m');
  });

  it('role=meter, aria-valuemin/max/now', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 60, quality: 'GOOD' });
    const el = await mount(level({ label: 'Bể 1' }), src);
    const m = el.shadowRoot!.querySelector('.w')!;
    expect(m.getAttribute('role')).toBe('meter');
    expect(m.getAttribute('aria-valuemin')).toBe('0');
    expect(m.getAttribute('aria-valuemax')).toBe('100');
    expect(m.getAttribute('aria-valuenow')).toBe('60');
    expect(m.getAttribute('aria-label')).toBe('Bể 1');
  });

  it('màu phần đầy theo vùng chứa giá trị; vùng hiện thành dải nền', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 70, quality: 'GOOD' });
    const el = await mount(
      level({
        zones: [
          { from: 0, to: 50, color: '#15703a' },
          { from: 50, to: 100, color: '#c42b2b' },
        ],
      }),
      src,
    );
    expect(fill(el).style.getPropertyValue('--lq')).toMatch(/#c42b2b|rgb\(196, 43, 43\)/);
    expect(el.shadowRoot!.querySelectorAll('.zone-seg')).toHaveLength(2);
    src.set('t1', { value: 10, quality: 'GOOD' });
    await el.updateComplete;
    expect(fill(el).style.getPropertyValue('--lq')).toMatch(/#15703a|rgb\(21, 112, 58\)/);
  });

  it('quality BAD: nhãn chữ, phần đầy mờ; UNKNOWN: "?", aria-valuenow = min (role=meter bắt buộc có)', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 50, quality: 'BAD' });
    const bad = await mount(level(), src);
    expect(textOf(bad, '.badge')).toBe('BAD');
    expect(fill(bad).classList.contains('dim')).toBe(true);
    const unk = await mount(level(undefined, 'lạ'), src);
    expect(textOf(unk, '.percent')).toBe('?');
    expect(unk.shadowRoot!.querySelector('.value')).toBeNull();
    expect(unk.shadowRoot!.querySelector('.w')!.getAttribute('aria-valuenow')).toBe('0');
    expect(fill(unk).style.height).toBe('0%');
  });

  it('showValue=false ẩn chữ giá trị', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 50, quality: 'GOOD' });
    const el = await mount(level({ showValue: false }), src);
    expect(el.shadowRoot!.querySelector('.value')).toBeNull();
  });
});

// Feature 037: kiểu bồn, màu chất lỏng, gợn sóng.
describe('mat-w-level 037', () => {
  const lv = (props: Record<string, string | number | boolean>) =>
    widgetItem('level', { value: 't1' }, props);
  it('style=tank: bồn có vạch chia; sóng chỉ ở chế độ chạy, tắt được', async () => {
    const src = makeSource([tagInfo('t1', { min: 0, max: 100 })]);
    src.set('t1', { value: 50, quality: 'GOOD' });
    const el = await mount(lv({ style: 'tank', wave: true }), src);
    expect(el.shadowRoot!.querySelector('.w.tank')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('.ticks')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('.wave')).not.toBeNull();
    const off = await mount(lv({ style: 'tank' }), src);
    expect(off.shadowRoot!.querySelector('.wave')).toBeNull();
    const ed = await mount(lv({ style: 'tank', wave: true }), src, 'edit');
    expect(ed.shadowRoot!.querySelector('.wave')).toBeNull();
    const bar = await mount(lv({}), src);
    expect(bar.shadowRoot!.querySelector('.wave')).toBeNull();
  });
  it('color đặt màu chất lỏng; vùng màu thắng', async () => {
    const src = makeSource([tagInfo('t1', { min: 0, max: 100 })]);
    src.set('t1', { value: 50, quality: 'GOOD' });
    const el = await mount(lv({ color: '#112233' }), src);
    expect(fill(el).style.getPropertyValue('--lq')).toMatch(/#112233|rgb\(17, 34, 51\)/);
  });
});
