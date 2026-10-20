// Widget dashboard của feature 014: kpi, progress, status-list, clock, text, image.
import { afterEach, describe, expect, it } from 'vitest';
import { clockParts, offsetMinutes } from './clock.ts';
import { kpiCompare } from './kpi.ts';
import { cleanup, makeSource, mount, tagInfo, textOf, widgetItem, type El } from './test-util.ts';

afterEach(cleanup);

describe('mat-w-kpi', () => {
  it('kpiCompare: phần trăm theo |mục tiêu|, hướng, đạt theo higherIsBetter, tỷ lệ kẹp', () => {
    expect(kpiCompare(110, 100, true)).toEqual({ pct: 10, dir: 'up', meets: true, ratio: 1 });
    expect(kpiCompare(80, 100, true)).toMatchObject({ pct: -20, dir: 'down', meets: false });
    expect(kpiCompare(80, 100, true).ratio).toBeCloseTo(0.8);
    expect(kpiCompare(80, 100, false).meets).toBe(true);
    expect(kpiCompare(5, 0, true).pct).toBeNull();
  });

  it('số đọc, mục tiêu từ thuộc tính, chênh lệch có mũi tên và màu theo đạt/không đạt', async () => {
    const src = makeSource([tagInfo('v', { unit: 'm3/h' })]);
    src.set('v', { value: 90, quality: 'GOOD' });
    const el = await mount(
      widgetItem('kpi', { value: 'v' }, { label: 'Sản lượng', goal: 100 }),
      src,
    );
    expect(textOf(el, '.value')).toBe('90.0');
    expect(textOf(el, '.goal .t')).toBe('Mục tiêu: 100.0 m3/h');
    expect(textOf(el, '.delta')).toBe('▼ 10.0 %');
    expect(el.shadowRoot!.querySelector('.delta')!.classList.contains('bad')).toBe(true);
    const g = el.shadowRoot!.querySelector('[role="group"]')!.getAttribute('aria-label')!;
    expect(g).toContain('Sản lượng: 90.0 m3/h');
    expect(g).toContain('10.0 % so với mục tiêu');
  });

  it('khe goal (Tag) thắng thuộc tính; không có mục tiêu thì không có dòng mục tiêu', async () => {
    const src = makeSource([tagInfo('v'), tagInfo('g')]);
    src.set('v', { value: 90, quality: 'GOOD' });
    src.set('g', { value: 80, quality: 'GOOD' });
    const el = await mount(widgetItem('kpi', { value: 'v', goal: 'g' }, { goal: 100 }), src);
    expect(textOf(el, '.delta')).toBe('▲ 12.5 %');
    expect(el.shadowRoot!.querySelector('.delta')!.classList.contains('good')).toBe(true);
    const none = await mount(widgetItem('kpi', { value: 'v' }), src);
    expect(none.shadowRoot!.querySelector('.goal')).toBeNull();
  });

  it('quality xấu: nhãn chữ, không tính chênh lệch', async () => {
    const src = makeSource([tagInfo('v')]);
    src.set('v', { value: 90, quality: 'BAD' });
    const el = await mount(widgetItem('kpi', { value: 'v' }, { goal: 100 }), src);
    expect(textOf(el, '.badge')).toBe('BAD');
    expect(el.shadowRoot!.querySelector('.delta')).toBeNull();
  });
});

describe('mat-w-progress', () => {
  it('thanh: phần trăm theo thang của Tag, độ rộng phần tô, role=meter', async () => {
    const src = makeSource([tagInfo('v', { min: 0, max: 200, unit: 'kW' })]);
    src.set('v', { value: 50, quality: 'GOOD' });
    const el = await mount(widgetItem('progress', { value: 'v' }, { label: 'Công suất' }), src);
    expect(textOf(el, '.pct')).toBe('25 %');
    expect(el.shadowRoot!.querySelector<HTMLElement>('.fill')!.style.width).toBe('25%');
    const m = el.shadowRoot!.querySelector('[role="meter"]')!;
    expect(m.getAttribute('aria-valuenow')).toBe('50');
    expect(m.getAttribute('aria-valuetext')).toBe('50.0 kW (25 %)');
  });

  it('vòng: cung theo phần trăm; giá trị ngoài thang kẹp; màu đặt tay qua biến', async () => {
    const src = makeSource([tagInfo('v')]);
    src.set('v', { value: 150, quality: 'GOOD' });
    const el = await mount(
      widgetItem('progress', { value: 'v' }, { shape: 'ring', color: '#112233' }),
      src,
    );
    expect(textOf(el, '.big')).toBe('100 %');
    expect(el.shadowRoot!.querySelector('circle.fg')).not.toBeNull();
    expect(el.shadowRoot!.querySelector<HTMLElement>('.w')!.style.getPropertyValue('--fc')).toMatch(
      /#112233/i,
    );
  });
});

describe('mat-w-status-list', () => {
  it('Tag BOOL: Bật/Tắt (hoặc chữ đặt), Tag số: chữ của bảng giá trị; nhãn theo labels', async () => {
    const src = makeSource(
      [
        tagInfo('a', { type: 'BOOL', description: 'Bơm 1' }),
        tagInfo('b', { type: 'BOOL' }),
        tagInfo('s', { type: 'INT16', valueTable: 'tt' }),
      ],
      { tt: { entries: [{ value: 1, text: 'Chạy', color: '#15703a' }] } },
    );
    src.set('a', { value: true, quality: 'GOOD' });
    src.set('b', { value: false, quality: 'GOOD' });
    src.set('s', { value: 1, quality: 'GOOD' });
    const el = await mount(
      widgetItem(
        'status-list',
        { items: ['a', 'b', 's'] },
        { labels: ['', 'Quạt'], onText: 'Chạy' },
      ),
      src,
    );
    const rows = [...el.shadowRoot!.querySelectorAll('li')].map((li) =>
      (li.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    expect(rows).toEqual(['Bơm 1 Chạy', 'Quạt Tắt', 's Chạy']);
  });

  it('quality xấu: chữ trạng thái và nhãn BAD; tiêu đề tạo khung có header; số cột', async () => {
    const src = makeSource([tagInfo('a', { type: 'BOOL' })]);
    src.set('a', { value: true, quality: 'BAD' });
    const el = await mount(
      widgetItem('status-list', { items: ['a'] }, { title: 'Trạng thái bơm', columns: 2 }),
      src,
    );
    expect(textOf(el, 'li .state')).toBe('Lỗi');
    expect(textOf(el, 'li .q')).toBe('BAD');
    expect(textOf(el, '.head')).toBe('Trạng thái bơm');
    expect(el.shadowRoot!.querySelector<HTMLElement>('ul')!.style.gridTemplateColumns).toBe(
      'repeat(2, minmax(0, 1fr))',
    );
  });
});

describe('mat-w-clock', () => {
  it('offsetMinutes: ±HH:MM, sai dạng về +07:00', () => {
    expect(offsetMinutes('+07:00')).toBe(420);
    expect(offsetMinutes('-03:30')).toBe(-210);
    expect(offsetMinutes('7')).toBe(420);
  });

  it('clockParts: giờ theo múi của project, thứ tiếng Việt', () => {
    const ms = Date.UTC(2026, 9, 20, 3, 4, 5); // 10:04:05 giờ Việt Nam, thứ Ba
    expect(clockParts(ms, 420, true)).toEqual({
      time: '10:04:05',
      date: '20/10/2026',
      weekday: 'Thứ Ba',
    });
    expect(clockParts(ms, 0, false).time).toBe('03:04');
  });

  it('vẽ theo giờ của nguồn (giờ thiết bị) và định dạng', async () => {
    const src = makeSource([], {}, Date.UTC(2026, 9, 20, 3, 4, 5));
    const el = await mount(widgetItem('clock', {}, { label: 'Giờ thiết bị' }), src);
    expect(textOf(el, '.big')).toBe('10:04:05');
    expect(textOf(el, '.sub')).toBe('Thứ Ba, 20/10/2026');
    const d = await mount(widgetItem('clock', {}, { format: 'date' }), src);
    expect(textOf(d, '.big')).toBe('20/10/2026');
  });
});

describe('mat-w-text', () => {
  it('chữ thuần nhiều dòng (không HTML), tiêu đề, căn lề', async () => {
    const src = makeSource([]);
    const el = await mount(
      widgetItem(
        'text',
        {},
        { title: 'Ghi chú ca', text: 'Dòng 1\n<b>Dòng 2</b>', align: 'center' },
      ),
      src,
    );
    const t = el.shadowRoot!.querySelector<HTMLElement>('.txt')!;
    expect(t.textContent).toBe('Dòng 1\n<b>Dòng 2</b>');
    expect(t.querySelector('b')).toBeNull();
    expect(t.style.textAlign).toBe('center');
    expect(textOf(el, '.head')).toBe('Ghi chú ca');
  });
});

describe('mat-w-image', () => {
  const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" fill="#0b7285"/><script>alert(1)</script></svg>';
  const withLoader = async (
    props: Record<string, string>,
    load: (p: string) => Promise<string>,
  ) => {
    const src = makeSource([]);
    const el = (await mount(widgetItem('image', {}, props), src)) as El & {
      loadSvg?: unknown;
      imageReady: Promise<void>;
      requestUpdate(): void;
    };
    el.loadSvg = load;
    el.requestUpdate();
    await el.updateComplete;
    await el.imageReady;
    await el.updateComplete;
    return el;
  };

  it('tải tệp của project qua loadSvg, dựng SVG đã lọc (bỏ script)', async () => {
    const asked: string[] = [];
    const el = await withLoader({ src: 'graphics/logo.svg' }, async (p) => (asked.push(p), SVG));
    expect(asked).toEqual(['graphics/logo.svg']);
    const pic = el.shadowRoot!.querySelector('.pic')!;
    expect(pic.shadowRoot!.querySelector('svg rect')).not.toBeNull();
    expect(pic.shadowRoot!.querySelector('script')).toBeNull();
    expect(pic.shadowRoot!.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 40 20');
    expect(el.shadowRoot!.querySelector('.msg')).toBeNull();
  });

  it('chưa chọn ảnh, tải lỗi: chữ báo, không ném', async () => {
    const empty = await withLoader({}, async () => SVG);
    expect(textOf(empty, '.msg')).toBe('Chưa chọn ảnh');
    const bad = await withLoader({ src: 'graphics/x.svg' }, async () => {
      throw new Error('404');
    });
    expect(textOf(bad, '.msg')).toBe('Không tải được ảnh');
  });
});
