import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, makeSource, mount, tagInfo, textOf, widgetItem } from './test-util.ts';

afterEach(cleanup);

const pie = (tags: string[], props?: Record<string, unknown>) =>
  widgetItem('pie', { series: tags }, props as never, { width: 280, height: 280 });
const slices = (el: Element) => [...el.shadowRoot!.querySelectorAll<SVGPathElement>('path.slice')];
const legend = (el: Element) =>
  [...el.shadowRoot!.querySelectorAll('.legend li')].map((li) =>
    li.textContent!.replace(/\s+/g, ' ').trim(),
  );

describe('mat-w-pie (FR-030)', () => {
  it('phần trăm đúng và tổng 100 %', async () => {
    const src = makeSource([tagInfo('a'), tagInfo('b'), tagInfo('c')]);
    src.set('a', { value: 10, quality: 'GOOD' });
    src.set('b', { value: 30, quality: 'GOOD' });
    src.set('c', { value: 60, quality: 'GOOD' });
    const el = await mount(pie(['a', 'b', 'c'], { decimals: 0 }), src);
    const rows = legend(el);
    expect(rows[0]).toContain('10%');
    expect(rows[1]).toContain('30%');
    expect(rows[2]).toContain('60%');
    const pcts = [...el.shadowRoot!.querySelectorAll('.pct')].map((p) =>
      Number(p.textContent!.replace('%', '')),
    );
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(slices(el)).toHaveLength(3);
  });

  it('giá trị đổi thì cung đổi theo', async () => {
    const src = makeSource([tagInfo('a'), tagInfo('b')]);
    src.set('a', { value: 1, quality: 'GOOD' });
    src.set('b', { value: 1, quality: 'GOOD' });
    const el = await mount(pie(['a', 'b'], { decimals: 0 }), src);
    expect(legend(el)[0]).toContain('50%');
    src.set('a', { value: 3, quality: 'GOOD' });
    await el.updateComplete;
    expect(legend(el)[0]).toContain('75%');
  });

  it('donut hiện tổng ở giữa khi showTotal; pie đặc thì không có lỗ', async () => {
    const src = makeSource([tagInfo('a', { unit: 'kg' }), tagInfo('b')]);
    src.set('a', { value: 20, quality: 'GOOD' });
    src.set('b', { value: 30, quality: 'GOOD' });
    const donut = await mount(pie(['a', 'b'], { donut: true, showTotal: true, decimals: 1 }), src);
    expect(textOf(donut, '.total')).toContain('50.0');
    const solid = await mount(pie(['a', 'b'], { donut: false, showTotal: true }), src);
    expect(solid.shadowRoot!.querySelector('.total')).toBeNull();
    const noTotal = await mount(pie(['a', 'b'], { donut: true }), src);
    expect(noTotal.shadowRoot!.querySelector('.total')).toBeNull();
  });

  it('showPercent=false ẩn phần trăm', async () => {
    const src = makeSource([tagInfo('a')]);
    src.set('a', { value: 1, quality: 'GOOD' });
    const el = await mount(pie(['a'], { showPercent: false }), src);
    expect(el.shadowRoot!.querySelector('.pct')).toBeNull();
  });

  it('tổng 0: "Không có dữ liệu", không cung, không NaN', async () => {
    const src = makeSource([tagInfo('a'), tagInfo('b')]);
    src.set('a', { value: 0, quality: 'GOOD' });
    src.set('b', { value: 0, quality: 'GOOD' });
    const el = await mount(pie(['a', 'b']), src);
    expect(textOf(el, '.empty')).toBe('Không có dữ liệu');
    expect(slices(el)).toHaveLength(0);
    expect(el.shadowRoot!.textContent).not.toContain('NaN');
  });

  it('âm và BAD bị loại khỏi tổng, có dấu "bị loại" trong chú giải', async () => {
    const src = makeSource([tagInfo('a'), tagInfo('b'), tagInfo('c'), tagInfo('d')]);
    src.set('a', { value: 10, quality: 'GOOD' });
    src.set('b', { value: -5, quality: 'GOOD' });
    src.set('c', { value: 7, quality: 'BAD' });
    src.set('d', { value: 30, quality: 'GOOD' });
    const el = await mount(pie(['a', 'b', 'c', 'd'], { decimals: 0 }), src);
    const rows = legend(el);
    expect(rows[0]).toContain('25%');
    expect(rows[3]).toContain('75%');
    expect(rows[1]).toContain('bị loại');
    expect(rows[2]).toContain('bị loại');
    expect(rows[2]).toContain('BAD');
    expect(slices(el)).toHaveLength(2);
  });

  it('một phần tử 100 %: vẽ được cả vòng', async () => {
    const src = makeSource([tagInfo('a')]);
    src.set('a', { value: 9, quality: 'GOOD' });
    const el = await mount(pie(['a'], { decimals: 0 }), src);
    expect(legend(el)[0]).toContain('100%');
    expect(slices(el)[0]!.getAttribute('d')).not.toContain('NaN');
  });

  it('nhãn: labels, mô tả Tag, id Tag', async () => {
    const src = makeSource([tagInfo('a', { description: 'Mô tả' }), tagInfo('b'), tagInfo('c')]);
    for (const id of ['a', 'b', 'c']) src.set(id, { value: 1, quality: 'GOOD' });
    const el = await mount(pie(['a', 'b', 'c'], { labels: ['Một'] }), src);
    const rows = legend(el);
    expect(rows[0]).toContain('Một');
    expect(rows[1]).toContain('b');
    expect(rows[2]).toContain('c');
  });

  it('role=img, aria-label và bảng dữ liệu ẩn', async () => {
    const src = makeSource([tagInfo('a'), tagInfo('b')]);
    src.set('a', { value: 1, quality: 'GOOD' });
    src.set('b', { value: 3, quality: 'GOOD' });
    const el = await mount(pie(['a', 'b'], { labels: ['X', 'Y'], decimals: 0 }), src);
    const img = el.shadowRoot!.querySelector('[role="img"]')!;
    expect(img.getAttribute('aria-label')).toContain('X 25%');
    expect(img.getAttribute('aria-label')).toContain('Y 75%');
    const t = el.shadowRoot!.querySelector('table.sr-only')!;
    expect(t.textContent).toContain('Y');
  });

  it('XSS: nhãn hiện dạng chữ', async () => {
    const src = makeSource([tagInfo('a')]);
    src.set('a', { value: 1, quality: 'GOOD' });
    const el = await mount(pie(['a'], { labels: ['<img src=x onerror=1>'] }), src);
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(legend(el)[0]).toContain('<img src=x onerror=1>');
  });
});
