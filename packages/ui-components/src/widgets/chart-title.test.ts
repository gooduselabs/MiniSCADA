// Feature 014: khung có tiêu đề của biểu đồ cột, tròn, đồng hồ và panel kiểu card (thanh tiêu đề như dashboard tham khảo).
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanup,
  fakeECharts,
  makeSource,
  mount,
  mountChart,
  tagInfo,
  textOf,
  widgetItem,
} from './test-util.ts';

afterEach(cleanup);

describe('khung có tiêu đề (feature 014)', () => {
  const cases: Array<[string, Record<string, string | string[]>]> = [
    ['bar', { series: ['a', 'b'] }],
    ['pie', { series: ['a', 'b'] }],
    ['gauge', { value: 'a' }],
  ];
  for (const [widget, tags] of cases)
    it(`${widget}: title vẽ thanh tiêu đề, vùng vẽ nằm trong thân khung; không title giữ như cũ`, async () => {
      fakeECharts();
      const src = makeSource([tagInfo('a'), tagInfo('b')]);
      src.set('a', { value: 3, quality: 'GOOD' });
      src.set('b', { value: 5, quality: 'GOOD' });
      const el = await mountChart(widgetItem(widget, tags, { title: 'Lưu lượng các bơm' }), src);
      expect(textOf(el, '.head')).toBe('Lưu lượng các bơm');
      expect(el.shadowRoot!.querySelector('.w.framed .body .ec')).not.toBeNull();
      const plain = await mountChart(widgetItem(widget, tags), src);
      expect(plain.shadowRoot!.querySelector('.head')).toBeNull();
      expect(plain.shadowRoot!.querySelector('.ec')).not.toBeNull();
    });

  it('tag-table: title vẽ thanh tiêu đề, bảng trong thân khung', async () => {
    const src = makeSource([tagInfo('a')]);
    src.set('a', { value: 3, quality: 'GOOD' });
    const el = await mount(
      widgetItem('tag-table', { rows: ['a'] }, { title: 'Giá trị sống' }),
      src,
    );
    expect(textOf(el, '.head')).toBe('Giá trị sống');
    expect(el.shadowRoot!.querySelector('.framed .body table')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('table')!.getAttribute('aria-label')).toBe('Giá trị sống');
  });

  it('tiêu đề là chữ thuần (không HTML)', async () => {
    fakeECharts();
    const src = makeSource([tagInfo('a')]);
    const el = await mountChart(widgetItem('bar', { series: ['a'] }, { title: '<b>x</b>' }), src);
    expect(el.shadowRoot!.querySelector('.head b')).toBeNull();
    expect(textOf(el, '.head')).toBe('<b>x</b>');
  });

  it('panel variant card: thanh tiêu đề; plain giữ tiêu đề nhỏ như cũ', async () => {
    const src = makeSource([]);
    const card = await mount(widgetItem('panel', {}, { title: 'Bơm', variant: 'card' }), src);
    expect(textOf(card, '.head')).toBe('Bơm');
    expect(card.shadowRoot!.querySelector('.w.framed')).not.toBeNull();
    const plain = await mount(widgetItem('panel', {}, { title: 'Bơm' }), src);
    expect(plain.shadowRoot!.querySelector('.head')).toBeNull();
    expect(textOf(plain, '.title')).toBe('Bơm');
  });
});
