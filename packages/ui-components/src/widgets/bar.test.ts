import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, makeSource, mount, tagInfo, textOf, widgetItem } from './test-util.ts';

afterEach(cleanup);

const bar = (tags: string[], props?: Record<string, unknown>) =>
  widgetItem('bar', { series: tags }, props as never, { width: 400, height: 260 });
const bars = (el: Element) => [...el.shadowRoot!.querySelectorAll<SVGRectElement>('rect.bar')];

describe('mat-w-bar (FR-030)', () => {
  it('cột đổi theo giá trị: chiều cao tỉ lệ, cột lớn hơn cao hơn', async () => {
    const src = makeSource([tagInfo('a'), tagInfo('b')]);
    src.set('a', { value: 25, quality: 'GOOD' });
    src.set('b', { value: 75, quality: 'GOOD' });
    const el = await mount(bar(['a', 'b'], { min: 0, max: 100 }), src);
    const [a, b] = bars(el);
    expect(Number(b!.getAttribute('height'))).toBeCloseTo(3 * Number(a!.getAttribute('height')), 1);
    src.set('a', { value: 100, quality: 'GOOD' });
    await el.updateComplete;
    expect(Number(bars(el)[0]!.getAttribute('height'))).toBeGreaterThan(
      Number(b!.getAttribute('height')),
    );
  });

  it('nhãn và số hiện đúng; showValues=false ẩn số', async () => {
    const src = makeSource([tagInfo('a', { description: 'Mô tả A', unit: 'm3' })]);
    src.set('a', { value: 12.345, quality: 'GOOD' });
    const el = await mount(bar(['a'], { decimals: 2 }), src);
    expect(textOf(el, '.cat')).toBe('Mô tả A');
    expect(textOf(el, '.val')).toBe('12.35');
    const off = await mount(bar(['a'], { showValues: false }), src);
    expect(off.shadowRoot!.querySelector('.val')).toBeNull();
    const lab = await mount(bar(['a'], { labels: ['Nhãn riêng'] }), src);
    expect(textOf(lab, '.cat')).toBe('Nhãn riêng');
  });

  it('ngang: dùng chiều rộng thay vì chiều cao', async () => {
    const src = makeSource([tagInfo('a')]);
    src.set('a', { value: 50, quality: 'GOOD' });
    const el = await mount(bar(['a'], { orientation: 'horizontal', min: 0, max: 100 }), src);
    const r = bars(el)[0]!;
    expect(Number(r.getAttribute('width'))).toBeGreaterThan(0);
    expect(el.shadowRoot!.querySelector('.w')!.classList.contains('horizontal')).toBe(true);
  });

  it('BAD/STALE/UNKNOWN: không vẽ cột, có chữ BAD/STALE/? tại chỗ (không chỉ màu)', async () => {
    const src = makeSource([tagInfo('a'), tagInfo('b'), tagInfo('c')]);
    src.set('a', { value: 5, quality: 'BAD' });
    src.set('b', { value: 5, quality: 'STALE' });
    const el = await mount(bar(['a', 'b', 'c']), src);
    const marks = [...el.shadowRoot!.querySelectorAll('.mark')].map((m) => m.textContent!.trim());
    expect(marks).toEqual(['BAD', 'STALE', '?']);
    expect(bars(el).every((b) => Number(b.getAttribute('height')) === 0)).toBe(true);
  });

  it('role=img, aria-label mô tả và bảng dữ liệu ẩn', async () => {
    const src = makeSource([tagInfo('a', { unit: 'kW' }), tagInfo('b')]);
    src.set('a', { value: 3, quality: 'GOOD' });
    src.set('b', { value: 4, quality: 'BAD' });
    const el = await mount(bar(['a', 'b'], { labels: ['Bơm 1', 'Bơm 2'] }), src);
    const img = el.shadowRoot!.querySelector('[role="img"]')!;
    const label = img.getAttribute('aria-label')!;
    expect(label).toContain('Bơm 1');
    expect(label).toContain('3.0');
    expect(label).toContain('BAD');
    const t = el.shadowRoot!.querySelector('table.sr-only')!;
    expect(t.textContent).toContain('Bơm 2');
    expect(t.contains(img)).toBe(false);
  });

  it('không có Tag: không ném lỗi, hiện "Không có dữ liệu"', async () => {
    const el = await mount(widgetItem('bar', {}), makeSource([]));
    expect(textOf(el, '.empty')).toBe('Không có dữ liệu');
  });

  it('XSS: nhãn và tên Tag hiện dạng chữ', async () => {
    const evil = '<img src=x onerror=1>';
    const src = makeSource([tagInfo(evil)]);
    src.set(evil, { value: 1, quality: 'GOOD' });
    const el = await mount(bar([evil], { labels: ['<script>1</script>'] }), src);
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(el.shadowRoot!.querySelector('script')).toBeNull();
    expect(textOf(el, '.cat')).toContain('<script>1</script>');
    const noLabel = await mount(bar([evil]), src);
    expect(noLabel.shadowRoot!.querySelector('img')).toBeNull();
  });

  it('nhãn dài bị cắt cho vừa dải nhưng đủ chữ trong tooltip', async () => {
    const long = 'Rất rất rất rất rất rất dài nhãn của một cột';
    const src = makeSource([tagInfo('a'), tagInfo('b'), tagInfo('c'), tagInfo('d')]);
    src.set('a', { value: 1, quality: 'GOOD' });
    const el = await mount(bar(['a', 'b', 'c', 'd'], { labels: [long] }), src);
    const t = el.shadowRoot!.querySelector('.cat')!;
    expect(t.textContent!.length).toBeLessThan(long.length);
    expect(el.shadowRoot!.querySelector('.catg title')!.textContent).toBe(long);
  });
});
