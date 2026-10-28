import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, makeSource, mount, tagInfo, textOf, widgetItem } from './test-util.ts';

afterEach(cleanup);

const lamp = (props?: Record<string, string | number | boolean>, tag = 'b') =>
  widgetItem('lamp', { state: tag }, props);
const dot = (el: Element) => el.shadowRoot!.querySelector<HTMLElement>('.dot')!;

describe('mat-w-lamp (FR-026)', () => {
  it('BOOL bật/tắt: chữ trạng thái và lớp on/off; màu auto theo token', async () => {
    const src = makeSource([tagInfo('b', { type: 'BOOL' })]);
    src.set('b', { value: true, quality: 'GOOD' });
    const el = await mount(lamp({ label: 'Bơm 1' }), src);
    expect(textOf(el, '.state-text')).toBe('Bật');
    expect(dot(el).classList.contains('on')).toBe(true);
    expect(dot(el).getAttribute('style') ?? '').not.toContain('background');
    expect(textOf(el, '.label')).toBe('Bơm 1');
    src.set('b', { value: false, quality: 'GOOD' });
    await el.updateComplete;
    expect(textOf(el, '.state-text')).toBe('Tắt');
    expect(dot(el).classList.contains('off')).toBe(true);
  });

  it('onColor/offColor đặt tay', async () => {
    const src = makeSource([tagInfo('b', { type: 'BOOL' })]);
    src.set('b', { value: true, quality: 'GOOD' });
    const el = await mount(lamp({ onColor: '#00aa00', offColor: '#555555' }), src);
    expect(dot(el).style.getPropertyValue('--lc')).toMatch(/#00aa00|rgb\(0, 170, 0\)/);
    src.set('b', { value: false, quality: 'GOOD' });
    await el.updateComplete;
    expect(dot(el).style.background).toMatch(/#555555|rgb\(85, 85, 85\)/);
  });

  it('số: khác 0 là bật', async () => {
    const src = makeSource([tagInfo('n', { type: 'UINT16' })]);
    src.set('n', { value: 3, quality: 'GOOD' });
    const el = await mount(lamp(undefined, 'n'), src);
    expect(dot(el).classList.contains('on')).toBe(true);
    src.set('n', { value: 0, quality: 'GOOD' });
    await el.updateComplete;
    expect(dot(el).classList.contains('off')).toBe(true);
  });

  it('invert đảo trạng thái khi không có bảng', async () => {
    const src = makeSource([tagInfo('b', { type: 'BOOL' })]);
    src.set('b', { value: true, quality: 'GOOD' });
    const el = await mount(lamp({ invert: true }), src);
    expect(dot(el).classList.contains('off')).toBe(true);
    expect(textOf(el, '.state-text')).toBe('Tắt');
  });

  it('bảng giá trị: chữ và màu của bảng (useValueTable mặc định bật)', async () => {
    const src = makeSource([tagInfo('n', { type: 'UINT16', valueTable: 'st' })], {
      st: {
        entries: [
          { value: 0, text: 'Dừng', color: '#777777' },
          { value: 1, text: 'Chạy', color: '#15703a' },
          { value: 2, text: 'Sự cố', color: '#c42b2b' },
        ],
      },
    });
    src.set('n', { value: 2, quality: 'GOOD' });
    const el = await mount(lamp(undefined, 'n'), src);
    expect(textOf(el, '.state-text')).toBe('Sự cố');
    expect(dot(el).style.getPropertyValue('--lc')).toMatch(/#c42b2b|rgb\(196, 43, 43\)/);
  });

  it('useValueTable=false bỏ qua bảng của Tag', async () => {
    const src = makeSource([tagInfo('n', { type: 'UINT16', valueTable: 'st' })], {
      st: { entries: [{ value: 1, text: 'Chạy', color: '#15703a' }] },
    });
    src.set('n', { value: 1, quality: 'GOOD' });
    const el = await mount(lamp({ useValueTable: false }, 'n'), src);
    expect(textOf(el, '.state-text')).toBe('Bật');
  });

  it('showText=false: không có chữ trạng thái nhìn thấy nhưng vẫn có cho trình đọc màn hình', async () => {
    const src = makeSource([tagInfo('b', { type: 'BOOL' })]);
    src.set('b', { value: true, quality: 'GOOD' });
    const el = await mount(lamp({ showText: false, label: 'Bơm' }), src);
    expect(el.shadowRoot!.querySelector('.state-text')).toBeNull();
    expect(el.shadowRoot!.querySelector('.w')!.getAttribute('aria-label')).toBe('Bơm: Bật');
  });

  it('hình: tròn hoặc vuông', async () => {
    const src = makeSource([tagInfo('b', { type: 'BOOL' })]);
    expect(dot(await mount(lamp(), src)).classList.contains('square')).toBe(false);
    expect(dot(await mount(lamp({ shape: 'square' }), src)).classList.contains('square')).toBe(
      true,
    );
  });

  it('quality: BAD/STALE/UNCERTAIN/UNKNOWN có nhãn chữ và lamp không còn màu bật/tắt', async () => {
    const src = makeSource([tagInfo('b', { type: 'BOOL' })]);
    src.set('b', { value: true, quality: 'BAD' });
    const bad = await mount(lamp(), src);
    expect(textOf(bad, '.badge')).toBe('BAD');
    expect(dot(bad).classList.contains('on')).toBe(false);
    src.set('b', { value: true, quality: 'STALE' });
    await bad.updateComplete;
    expect(textOf(bad, '.badge')).toBe('STALE');
    src.set('b', { value: true, quality: 'UNCERTAIN' });
    await bad.updateComplete;
    expect(textOf(bad, '.badge')).toBe('●');
    expect(dot(bad).classList.contains('on')).toBe(true);
    const unknown = await mount(lamp(undefined, 'lạ'), src);
    expect(textOf(unknown, '.badge')).toBe('?');
    expect(textOf(unknown, '.state-text')).toBe('?');
  });

  it('ARIA: role=group và aria-label "nhãn: trạng thái"', async () => {
    const src = makeSource([tagInfo('b', { type: 'BOOL' })]);
    src.set('b', { value: false, quality: 'GOOD' });
    const el = await mount(lamp({ label: 'Van 2' }), src);
    const w = el.shadowRoot!.querySelector('.w')!;
    expect(w.getAttribute('role')).toBe('group');
    expect(w.getAttribute('aria-label')).toBe('Van 2: Tắt');
  });

  it('XSS: nhãn và chữ bảng giá trị hiện dạng chữ', async () => {
    const src = makeSource([tagInfo('n', { type: 'UINT16', valueTable: 'st' })], {
      st: { entries: [{ value: 1, text: '<img src=x onerror=1>' }] },
    });
    src.set('n', { value: 1, quality: 'GOOD' });
    const el = await mount(lamp({ label: '<script>1</script>' }, 'n'), src);
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(el.shadowRoot!.querySelector('script')).toBeNull();
    expect(textOf(el, '.state-text')).toBe('<img src=x onerror=1>');
  });
});

// Feature 037: quầng sáng khi bật, tắt được.
describe('mat-w-lamp 037', () => {
  it('glow=true có quầng khi đèn sáng; mặc định (project cũ) không', async () => {
    const src = makeSource([tagInfo('b', { type: 'BOOL' })]);
    src.set('b', { value: true, quality: 'GOOD' });
    expect(dot(await mount(lamp({ glow: true }), src)).classList.contains('glow')).toBe(true);
    expect(dot(await mount(lamp(), src)).classList.contains('glow')).toBe(false);
    src.set('b', { value: false, quality: 'GOOD' });
    expect(dot(await mount(lamp({ glow: true }), src)).classList.contains('glow')).toBe(false);
  });
});
