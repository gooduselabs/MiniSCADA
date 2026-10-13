import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, makeSource, mount, tagInfo, widgetItem, type El } from './test-util.ts';

afterEach(cleanup);

const table = (tags: string[], props?: Record<string, unknown>) =>
  widgetItem('tag-table', { rows: tags }, props as never);
const rows = (el: Element) => [...el.shadowRoot!.querySelectorAll('tbody tr')];
const cells = (tr: Element) =>
  [...tr.querySelectorAll('td')].map((c) => c.textContent!.replace(/\s+/g, ' ').trim());
const headers = (el: Element) =>
  [...el.shadowRoot!.querySelectorAll('thead th')].map((h) => h.textContent!.trim());
const click = async (el: El, col: string) => {
  el.shadowRoot!.querySelector<HTMLElement>(`th button[data-col="${col}"]`)!.click();
  await el.updateComplete;
};

describe('mat-w-tag-table (FR-030)', () => {
  it('cột mặc định label, value, unit, quality; role=table', async () => {
    const src = makeSource([tagInfo('a', { description: 'Áp suất', unit: 'bar' })]);
    src.set('a', { value: 4.567, quality: 'GOOD' });
    const el = await mount(table(['a']), src);
    expect(headers(el)).toEqual(['Tag', 'Giá trị', 'Đơn vị', 'Chất lượng']);
    expect(cells(rows(el)[0]!)).toEqual(['Áp suất', '4.6', 'bar', 'Tốt']);
    expect(el.shadowRoot!.querySelector('table')!.getAttribute('role')).toBe('table');
  });

  it('columns tùy chọn, đúng thứ tự, gồm cột thời điểm cập nhật', async () => {
    const src = makeSource([tagInfo('a')]);
    const ts = new Date(2026, 9, 13, 8, 5, 9).getTime();
    src.set('a', { value: 1, quality: 'GOOD', updatedAt: ts });
    const el = await mount(table(['a'], { columns: ['updated', 'label', 'value'] }), src);
    expect(headers(el)).toEqual(['Cập nhật', 'Tag', 'Giá trị']);
    expect(cells(rows(el)[0]!)).toEqual(['08:05:09', 'a', '1.0']);
  });

  it('chưa có thời điểm cập nhật: dấu gạch', async () => {
    const src = makeSource([tagInfo('a')]);
    src.set('a', { value: 1, quality: 'GOOD' });
    const el = await mount(table(['a'], { columns: ['updated'] }), src);
    expect(cells(rows(el)[0]!)).toEqual(['—']);
  });

  it('cột sai tên hoặc trùng bị bỏ; rỗng thì dùng mặc định', async () => {
    const src = makeSource([tagInfo('a')]);
    const el = await mount(table(['a'], { columns: ['value', 'value', 'bậy'] }), src);
    expect(headers(el)).toEqual(['Giá trị']);
    const def = await mount(table(['a'], { columns: [] }), src);
    expect(headers(def)).toEqual(['Tag', 'Giá trị', 'Đơn vị', 'Chất lượng']);
  });

  it('bảng giá trị: chữ và màu của bảng', async () => {
    const src = makeSource([tagInfo('a', { type: 'UINT16', valueTable: 'st' })], {
      st: { entries: [{ value: 1, text: 'Chạy', color: '#15703a' }] },
    });
    src.set('a', { value: 1, quality: 'GOOD' });
    const el = await mount(table(['a']), src);
    expect(cells(rows(el)[0]!)[1]).toBe('Chạy');
    const v = rows(el)[0]!.querySelector<HTMLElement>('td.value')!;
    expect(v.style.color).toMatch(/#15703a|rgb\(21, 112, 58\)/);
  });

  it('tối đa 50 dòng', async () => {
    const ids = Array.from({ length: 55 }, (_, i) => `t${i}`);
    const src = makeSource(ids.map((i) => tagInfo(i)));
    const el = await mount(table(ids), src);
    expect(rows(el)).toHaveLength(50);
  });

  it('dữ liệu đổi thì dòng đổi theo, quality hiện chữ', async () => {
    const src = makeSource([tagInfo('a'), tagInfo('b'), tagInfo('c')]);
    src.set('a', { value: 1, quality: 'GOOD' });
    src.set('b', { value: 2, quality: 'GOOD' });
    src.set('c', { value: 3, quality: 'GOOD' });
    const el = await mount(table(['a', 'b', 'c']), src);
    src.set('a', { value: 9, quality: 'BAD' });
    src.set('b', { quality: 'STALE' });
    src.set('c', { quality: 'UNCERTAIN' });
    await el.updateComplete;
    const r = rows(el).map(cells);
    expect(r[0]![1]).toBe('9.0');
    expect(r[0]![3]).toBe('BAD');
    expect(r[1]![3]).toBe('STALE');
    expect(r[2]![3]).toBe('Không chắc');
    expect(rows(el)[0]!.classList.contains('q-bad')).toBe(true);
    expect(rows(el)[0]!.querySelector('td.value')!.classList.contains('dim')).toBe(true);
  });

  it('Tag lạ: "?" ở giá trị và chất lượng', async () => {
    const el = await mount(table(['lạ']), makeSource([]));
    expect(cells(rows(el)[0]!)).toEqual(['lạ', '?', '', '?']);
  });

  describe('sắp xếp tại chỗ (không đổi project)', () => {
    const setup = async () => {
      const src = makeSource([
        tagInfo('b', { description: 'Bơm' }),
        tagInfo('a', { description: 'An toàn' }),
        tagInfo('c', { description: 'Cảm biến' }),
      ]);
      src.set('b', { value: 10, quality: 'GOOD' });
      src.set('a', { value: 2, quality: 'GOOD' });
      src.set('c', { value: 33, quality: 'GOOD' });
      const item = table(['b', 'a', 'c']);
      const el = await mount(item, src);
      return { el, item, src };
    };
    const labels = (el: Element) => rows(el).map((r) => cells(r)[0]);

    it('mặc định theo thứ tự cấu hình; bấm tiêu đề: tăng dần rồi giảm dần', async () => {
      const { el } = await setup();
      expect(labels(el)).toEqual(['Bơm', 'An toàn', 'Cảm biến']);
      await click(el, 'label');
      expect(labels(el)).toEqual(['An toàn', 'Bơm', 'Cảm biến']);
      expect(el.shadowRoot!.querySelector('th[aria-sort]')!.getAttribute('aria-sort')).toBe(
        'ascending',
      );
      await click(el, 'label');
      expect(labels(el)).toEqual(['Cảm biến', 'Bơm', 'An toàn']);
      expect(el.shadowRoot!.querySelector('th[aria-sort]')!.getAttribute('aria-sort')).toBe(
        'descending',
      );
    });

    it('sắp xếp số theo giá trị số (2, 10, 33), không theo chữ', async () => {
      const { el } = await setup();
      await click(el, 'value');
      expect(rows(el).map((r) => cells(r)[1])).toEqual(['2.0', '10.0', '33.0']);
    });

    it('giữ sắp xếp khi dữ liệu đổi; không đổi item của project', async () => {
      const { el, item, src } = await setup();
      const before = JSON.stringify(item);
      await click(el, 'value');
      src.set('a', { value: 100, quality: 'GOOD' });
      await el.updateComplete;
      expect(rows(el).map((r) => cells(r)[1])).toEqual(['10.0', '33.0', '100.0']);
      expect(JSON.stringify(item)).toBe(before);
    });

    it('sortable=false: không có nút sắp xếp', async () => {
      const src = makeSource([tagInfo('a')]);
      const el = await mount(table(['a'], { sortable: false }), src);
      expect(el.shadowRoot!.querySelector('th button')).toBeNull();
      expect(headers(el)[0]).toBe('Tag');
    });
  });

  it('dense: lớp dense', async () => {
    const el = await mount(table(['a'], { dense: true }), makeSource([tagInfo('a')]));
    expect(el.shadowRoot!.querySelector('.w')!.classList.contains('dense')).toBe(true);
  });

  it('labels thay nhãn dòng', async () => {
    const src = makeSource([tagInfo('a', { description: 'Mô tả' })]);
    const el = await mount(table(['a'], { labels: ['Nhãn tay'] }), src);
    expect(cells(rows(el)[0]!)[0]).toBe('Nhãn tay');
  });

  it('XSS: tên Tag, nhãn, chữ STRING hiện dạng chữ', async () => {
    const evil = '<script>window.__t=1</script>';
    const src = makeSource([tagInfo(evil), tagInfo('s', { type: 'STRING' })]);
    src.set(evil, { value: 1, quality: 'GOOD' });
    src.set('s', { value: '"><img src=x onerror=1>', quality: 'GOOD' });
    const el = await mount(table([evil, 's'], { labels: ['x', '<b>đậm</b>'] }), src);
    expect(el.shadowRoot!.querySelector('script')).toBeNull();
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(el.shadowRoot!.querySelector('b')).toBeNull();
    expect(cells(rows(el)[1]!)[0]).toBe('<b>đậm</b>');
    expect(cells(rows(el)[1]!)[1]).toBe('"><img src=x onerror=1>');
    const noLabel = await mount(table([evil]), src);
    expect(cells(rows(noLabel)[0]!)[0]).toBe(evil);
  });

  it('không có Tag: thông báo rỗng, không ném lỗi', async () => {
    const el = await mount(widgetItem('tag-table', {}), makeSource([]));
    expect(el.shadowRoot!.querySelector('.empty')!.textContent).toBe('Không có Tag');
  });
});
