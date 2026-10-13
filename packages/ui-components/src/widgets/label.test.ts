import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, makeSource, mount, tagInfo, textOf, widgetItem } from './test-util.ts';

afterEach(cleanup);

describe('mat-w-label (FR-026)', () => {
  it('chữ tĩnh không Tag', async () => {
    const el = await mount(widgetItem('label', {}, { text: 'Bể chứa số 1' }), makeSource([]));
    expect(textOf(el, '.line')).toBe('Bể chứa số 1');
    expect(el.shadowRoot!.querySelector('.badge')).toBeNull();
  });

  it('chữ hiện trước giá trị, cách một khoảng trắng; số theo decimals và đơn vị', async () => {
    const src = makeSource([tagInfo('t1', { unit: '°C' })]);
    src.set('t1', { value: 21.456, quality: 'GOOD' });
    const el = await mount(
      widgetItem('label', { value: 't1' }, { text: 'Nhiệt độ', decimals: 2 }),
      src,
    );
    expect(textOf(el, '.line')).toBe('Nhiệt độ 21.46 °C');
  });

  it('Tag STRING hiện nguyên chuỗi', async () => {
    const src = makeSource([tagInfo('s', { type: 'STRING' })]);
    src.set('s', { value: 'Sẵn sàng', quality: 'GOOD' });
    const el = await mount(widgetItem('label', { value: 's' }), src);
    expect(textOf(el, '.line')).toBe('Sẵn sàng');
  });

  it('bảng giá trị: chữ của bảng, màu của bảng', async () => {
    const src = makeSource([tagInfo('t1', { type: 'UINT16', valueTable: 'm' })], {
      m: { entries: [{ value: 2, text: 'Tự động', color: '#0b5cad' }] },
    });
    src.set('t1', { value: 2, quality: 'GOOD' });
    const el = await mount(widgetItem('label', { value: 't1' }, { text: 'Chế độ:' }), src);
    expect(textOf(el, '.line')).toBe('Chế độ: Tự động');
    expect(el.shadowRoot!.querySelector<HTMLElement>('.value')!.style.color).toMatch(
      /#0b5cad|rgb\(11, 92, 173\)/,
    );
  });

  it('kiểu chữ: cỡ, đậm, căn lề, màu, wrap', async () => {
    const el = await mount(
      widgetItem(
        'label',
        {},
        { text: 'A', fontSize: 24, bold: true, align: 'center', color: '#336699', wrap: true },
      ),
      makeSource([]),
    );
    const s = el.shadowRoot!.querySelector<HTMLElement>('.line')!.style;
    expect(s.fontSize).toBe('24px');
    expect(s.fontWeight).toBe('700');
    expect(s.textAlign).toBe('center');
    expect(s.color).toMatch(/#336699|rgb\(51, 102, 153\)/);
    expect(s.whiteSpace).toBe('normal');
  });

  it('wrap tắt: một dòng', async () => {
    const el = await mount(widgetItem('label', {}, { text: 'A' }), makeSource([]));
    expect(el.shadowRoot!.querySelector<HTMLElement>('.line')!.style.whiteSpace).toBe('nowrap');
  });

  it('quality xấu của Tag: có nhãn chữ', async () => {
    const src = makeSource([tagInfo('t1')]);
    src.set('t1', { value: 1, quality: 'BAD' });
    const el = await mount(widgetItem('label', { value: 't1' }, { text: 'X' }), src);
    expect(textOf(el, '.badge')).toBe('BAD');
  });

  it('Tag lạ: "?" và nhãn "?"', async () => {
    const el = await mount(widgetItem('label', { value: 'lạ' }, { text: 'X' }), makeSource([]));
    expect(textOf(el, '.line')).toContain('?');
    expect(textOf(el, '.badge')).toBe('?');
  });

  it('XSS: chữ và Tag STRING chứa HTML hiện dạng chữ', async () => {
    const src = makeSource([tagInfo('s', { type: 'STRING' })]);
    src.set('s', { value: '<img src=x onerror=1>', quality: 'GOOD' });
    const el = await mount(
      widgetItem('label', { value: 's' }, { text: '<script>1</script>' }),
      src,
    );
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(el.shadowRoot!.querySelector('script')).toBeNull();
    expect(textOf(el, '.line')).toBe('<script>1</script> <img src=x onerror=1>');
  });

  it('ARIA: role=group, aria-label là chữ hiển thị', async () => {
    const el = await mount(widgetItem('label', {}, { text: 'Tiêu đề' }), makeSource([]));
    const w = el.shadowRoot!.querySelector('.w')!;
    expect(w.getAttribute('role')).toBe('group');
    expect(w.getAttribute('aria-label')).toBe('Tiêu đề');
  });
});
