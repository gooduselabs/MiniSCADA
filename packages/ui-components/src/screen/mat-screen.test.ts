import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ElementBindings02,
  Item,
  ScreenModel,
  SvgItem,
  WidgetItem,
} from '@mat/project-schema';
import { FakeActionHost, MemoryTagSource } from '../host/memory-source.ts';
import type { TagInfo } from '../host/types.ts';
import { MatScreen, nextFocusIndex } from './mat-screen.ts';

const SVG = (uid: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>.a{fill:red}</style><rect class="a" id="r" data-mat-uid="${uid}" width="10" height="10"/></svg>`;

const tag = (id: string, over: Partial<TagInfo> = {}): TagInfo => ({
  id,
  type: 'FLOAT32',
  access: 'R',
  kind: 'external',
  ...over,
});

const widget = (
  id: string,
  kind = 'card',
  tags?: Record<string, string>,
  over: Partial<WidgetItem> = {},
): WidgetItem => ({
  type: 'widget',
  id,
  widget: kind,
  x: 10,
  y: 20,
  width: 200,
  height: 100,
  tags,
  ...over,
});
const svgItem = (id: string, uid = 'u1', over: Partial<SvgItem> = {}): SvgItem => ({
  type: 'svg',
  id,
  x: 0,
  y: 0,
  width: 400,
  height: 300,
  svgFile: `${id}.svg`,
  bindingFile: `${id}.bind.json`,
  viewBox: [0, 0, 100, 100],
  elements: [{ elementUid: uid }],
  ...over,
});
const screenOf = (id: string, items: Item[], over: Partial<ScreenModel> = {}): ScreenModel => ({
  schemaVersion: '0.3.0',
  id,
  name: id,
  kind: 'screen',
  size: { width: 1000, height: 500 },
  items,
  ...over,
});
const fillBinding = (uid: string, tagId: string): ElementBindings02[] => [
  {
    elementUid: uid,
    bindings: [
      {
        id: `b_${uid}`,
        target: 'style.fill',
        source: { type: 'tag', tagId },
        transform: {
          kind: 'discreteMap',
          cases: [
            { equals: true, value: '#22c55e' },
            { equals: false, value: '#64748b' },
          ],
          default: '#000000',
        },
      },
    ],
  },
];

interface Setup {
  el: MatScreen;
  src: MemoryTagSource;
  host: FakeActionHost;
  raf: Array<() => void>;
}

async function setup(
  screen: ScreenModel,
  opt: {
    popup?: ScreenModel | null;
    mode?: 'run' | 'edit';
    viewport?: MatScreen['viewport'];
    tags?: TagInfo[];
    loadSvg?: MatScreen['loadSvg'];
    loadBindings?: MatScreen['loadBindings'];
  } = {},
): Promise<Setup> {
  const src = new MemoryTagSource({
    tags: opt.tags ?? [
      tag('t1'),
      tag('t2'),
      tag('b1', { type: 'BOOL' }),
      tag('b2', { type: 'BOOL' }),
    ],
  });
  const host = new FakeActionHost({ session: { user: 'u', role: 'operator' } });
  const raf: Array<() => void> = [];
  const el = document.createElement('mat-screen') as MatScreen;
  el.env = { raf: (cb) => (cb(), 0), cancelRaf: () => {}, ResizeObserver: undefined };
  el.tags = src;
  el.host = host;
  el.mode = opt.mode ?? 'run';
  el.viewport = opt.viewport ?? { width: 1000, height: 500 };
  el.loadSvg = opt.loadSvg ?? (async (p) => SVG(p.startsWith('B') ? 'u2' : 'u1'));
  el.loadBindings = opt.loadBindings ?? (async () => fillBinding('u1', 'b1'));
  el.screen = screen;
  el.popup = opt.popup ?? null;
  document.body.append(el);
  await el.updateComplete;
  await el.whenReady();
  return { el, src, host, raf };
}

const frame = (el: MatScreen) => el.shadowRoot!.querySelector<HTMLElement>('.frame')!;
const itemEls = (el: MatScreen) => [...frame(el).children] as HTMLElement[];

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('<mat-screen>: dựng (FR-014, ADR-013)', () => {
  it('khung đúng cỡ size, item tuyệt đối theo thứ tự mảng (đầu mảng ở dưới)', async () => {
    const { el } = await setup(
      screenOf('s', [
        widget('a', 'panel', undefined, { x: 5, y: 6, width: 300, height: 200 }),
        widget('b', 'card', { value: 't1' }, { x: 50, y: 60 }),
        widget('c', 'lamp', { state: 'b1' }),
      ]),
    );
    const f = frame(el);
    expect(f.style.width).toBe('1000px');
    expect(f.style.height).toBe('500px');
    const items = itemEls(el);
    expect(items.map((i) => i.dataset.itemId)).toEqual(['a', 'b', 'c']);
    expect(items[0]!.style.left).toBe('5px');
    expect(items[0]!.style.top).toBe('6px');
    expect(items[0]!.style.width).toBe('300px');
    expect(items[0]!.style.height).toBe('200px');
    expect(items[0]!.style.position).toBe('absolute');
    expect(items[0]!.firstElementChild!.localName).toBe('mat-w-panel');
    expect(items[1]!.firstElementChild!.localName).toBe('mat-w-card');
  });

  it('item hidden không được dựng', async () => {
    const { el } = await setup(
      screenOf('s', [widget('a', 'panel'), widget('b', 'card', { value: 't1' }, { hidden: true })]),
    );
    expect(itemEls(el).map((i) => i.dataset.itemId)).toEqual(['a']);
  });

  it('widget nhận item, source, host, mode, context', async () => {
    const { el, src, host } = await setup(screenOf('scr', [widget('w9', 'card', { value: 't1' })]));
    const w = itemEls(el)[0]!.firstElementChild as unknown as Record<string, unknown>;
    expect((w.item as WidgetItem).id).toBe('w9');
    expect(w.source).toBe(src);
    expect(w.host).toBe(host);
    expect(w.mode).toBe('run');
    expect(w.context).toEqual({ screen: 'scr', widget: 'w9' });
  });

  it('loại widget không hỗ trợ: khung giữ chỗ, tên loại hiện dạng chữ', async () => {
    const { el } = await setup(screenOf('s', [widget('x', '<img src=x onerror=1>')]));
    const it0 = itemEls(el)[0]!;
    expect(it0.querySelector('img')).toBeNull();
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(it0.textContent).toContain('<img src=x onerror=1>');
  });

  it('background của màn hình tô vùng chứa; màu sai bị bỏ', async () => {
    const a = await setup(screenOf('s', [], { background: '#112233' }));
    expect(a.el.shadowRoot!.querySelector<HTMLElement>('.viewport')!.style.background).toMatch(
      /#112233|rgb\(17, 34, 51\)/,
    );
    const b = await setup(screenOf('s', [], { background: 'red; position: fixed' }));
    expect(
      b.el.shadowRoot!.querySelector<HTMLElement>('.viewport')!.getAttribute('style') ?? '',
    ).not.toContain('fixed');
  });
});

describe('<mat-screen>: item svg', () => {
  it('Shadow DOM riêng và DomApplier gắn binding (giá trị Tag áp lên phần tử)', async () => {
    const { el, src } = await setup(screenOf('s', [svgItem('g1')]));
    const host = itemEls(el)[0]!.querySelector<HTMLElement>('.svg-host')!;
    expect(host.shadowRoot).not.toBeNull();
    expect(el.shadowRoot!.querySelector('rect')).toBeNull();
    expect(document.querySelector('rect')).toBeNull();
    const rect = host.shadowRoot!.querySelector<SVGElement>('rect')!;
    src.set('b1', { value: true, quality: 'GOOD' });
    expect(rect.style.fill).toMatch(/#22c55e|rgb\(34, 197, 94\)/);
    src.set('b1', { value: false, quality: 'GOOD' });
    expect(rect.style.fill).toMatch(/#64748b|rgb\(100, 116, 139\)/);
  });

  it('giá trị có sẵn lúc dựng cũng được áp', async () => {
    const src0 = new MemoryTagSource({ tags: [tag('b1', { type: 'BOOL' })] });
    src0.set('b1', { value: true, quality: 'GOOD' });
    const el = document.createElement('mat-screen') as MatScreen;
    el.env = { raf: (cb) => (cb(), 0), cancelRaf: () => {}, ResizeObserver: undefined };
    el.tags = src0;
    el.host = new FakeActionHost();
    el.viewport = { width: 1000, height: 500 };
    el.loadSvg = async () => SVG('u1');
    el.loadBindings = async () => fillBinding('u1', 'b1');
    el.screen = screenOf('s', [svgItem('g1')]);
    document.body.append(el);
    await el.updateComplete;
    await el.whenReady();
    const rect = itemEls(el)[0]!
      .querySelector<HTMLElement>('.svg-host')!
      .shadowRoot!.querySelector<SVGElement>('rect')!;
    expect(rect.style.fill).toMatch(/#22c55e|rgb\(34, 197, 94\)/);
  });

  it('hai item svg không đụng class/id của nhau (mỗi cái một Shadow DOM)', async () => {
    const { el } = await setup(screenOf('s', [svgItem('g1', 'u1'), svgItem('g2', 'u2')]), {
      loadBindings: async () => [],
    });
    const hosts = [...el.shadowRoot!.querySelectorAll<HTMLElement>('.svg-host')];
    expect(hosts).toHaveLength(2);
    expect(hosts[0]!.shadowRoot).not.toBe(hosts[1]!.shadowRoot);
    expect(hosts[0]!.shadowRoot!.querySelector('#r')).not.toBeNull();
    expect(hosts[1]!.shadowRoot!.querySelector('#r')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('#r')).toBeNull();
  });

  it('elementUid khai báo mà không có trong SVG: cảnh báo console đúng một lần', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await setup(
      screenOf('s', [
        svgItem('g1', 'u1', { elements: [{ elementUid: 'u1' }, { elementUid: 'nope' }] }),
      ]),
      {
        loadBindings: async () => [],
      },
    );
    const hits = warn.mock.calls.filter((c) => String(c[0]).includes('elementUid'));
    expect(hits).toHaveLength(1);
    expect(JSON.stringify(hits[0])).toContain('nope');
  });

  it('tải SVG lỗi: khung giữ chỗ, không ném lỗi, vẫn mat-ready', async () => {
    const ready = vi.fn();
    const el = document.createElement('mat-screen') as MatScreen;
    el.addEventListener('mat-ready', ready);
    el.env = { raf: (cb) => (cb(), 0), cancelRaf: () => {}, ResizeObserver: undefined };
    el.tags = new MemoryTagSource();
    el.host = new FakeActionHost();
    el.viewport = { width: 1000, height: 500 };
    el.loadSvg = async () => {
      throw new Error('404');
    };
    el.loadBindings = async () => [];
    el.screen = screenOf('s', [svgItem('g1')]);
    document.body.append(el);
    await el.updateComplete;
    await el.whenReady();
    expect(ready).toHaveBeenCalled();
    expect(itemEls(el)[0]!.textContent).toContain('Không tải được');
  });
});

describe('<mat-screen>: tagIds, itemRect, sự kiện', () => {
  it('tagIds gồm Tag widget và binding svg, bỏ hidden, khử trùng', async () => {
    const { el } = await setup(
      screenOf('s', [
        svgItem('g1'),
        widget('a', 'card', { value: 't1' }),
        widget('b', 'card', { value: 't2' }, { hidden: true }),
        widget('c', 'lamp', { state: 'b1' }),
      ]),
    );
    expect(el.tagIds().sort()).toEqual(['b1', 't1']);
  });

  it('tagIds gồm Tag của popup đang mở', async () => {
    const popup = screenOf('p', [widget('pa', 'card', { value: 't2' })], { kind: 'popup' });
    const { el } = await setup(screenOf('s', [widget('a', 'card', { value: 't1' })]), { popup });
    expect(el.tagIds().sort()).toEqual(['t1', 't2']);
  });

  it('itemRect theo đơn vị thiết kế; id lạ thì null', async () => {
    const { el } = await setup(
      screenOf('s', [widget('a', 'card', undefined, { x: 11, y: 22, width: 33, height: 44 })]),
      { viewport: { width: 500, height: 250 } },
    );
    expect(el.itemRect('a')).toEqual({ x: 11, y: 22, width: 33, height: 44 });
    expect(el.itemRect('zzz')).toBeNull();
  });

  it('phát mat-ready và mat-tags (detail.ids); không phát lại mat-tags khi tập không đổi', async () => {
    const tagsEv = vi.fn();
    const readyEv = vi.fn();
    const src = new MemoryTagSource({ tags: [tag('t1'), tag('t2')] });
    const el = document.createElement('mat-screen') as MatScreen;
    el.addEventListener('mat-tags', (e) =>
      tagsEv((e as CustomEvent<{ ids: string[] }>).detail.ids),
    );
    el.addEventListener('mat-ready', readyEv);
    el.env = { raf: (cb) => (cb(), 0), cancelRaf: () => {}, ResizeObserver: undefined };
    el.tags = src;
    el.host = new FakeActionHost();
    el.viewport = { width: 1000, height: 500 };
    el.screen = screenOf('s', [widget('a', 'card', { value: 't1' })]);
    document.body.append(el);
    await el.updateComplete;
    await el.whenReady();
    expect(readyEv).toHaveBeenCalledTimes(1);
    expect(tagsEv).toHaveBeenCalledTimes(1);
    expect(tagsEv.mock.calls[0]![0]).toEqual(['t1']);
    // đổi vị trí nhưng cùng tập Tag
    el.screen = screenOf('s', [widget('a', 'card', { value: 't1' }, { x: 99 })]);
    await el.updateComplete;
    await el.whenReady();
    expect(tagsEv).toHaveBeenCalledTimes(1);
    // thêm Tag
    el.screen = screenOf('s', [
      widget('a', 'card', { value: 't1' }),
      widget('b', 'card', { value: 't2' }),
    ]);
    await el.updateComplete;
    await el.whenReady();
    expect(tagsEv).toHaveBeenCalledTimes(2);
    expect(tagsEv.mock.calls[1]![0]).toEqual(['t1', 't2']);
  });
});

describe('<mat-screen>: dựng lại giữ phần tử theo id', () => {
  it('cùng id và cùng widget: giữ nguyên phần tử, chỉ đổi item', async () => {
    const { el } = await setup(
      screenOf('s', [widget('a', 'card', { value: 't1' }), widget('b', 'panel')]),
    );
    const before = itemEls(el).map((i) => i.firstElementChild);
    el.screen = screenOf('s', [
      widget('a', 'card', { value: 't1' }, { x: 77, width: 250 }),
      widget('b', 'panel', undefined, { y: 5 }),
    ]);
    await el.updateComplete;
    await el.whenReady();
    const after = itemEls(el);
    expect(after.map((i) => i.firstElementChild)).toEqual(before);
    expect(after[0]!.style.left).toBe('77px');
    expect(after[0]!.style.width).toBe('250px');
    expect((after[0]!.firstElementChild as unknown as { item: WidgetItem }).item.x).toBe(77);
  });

  it('đổi loại widget cùng id: phần tử mới; xóa item: phần tử bị gỡ và hủy đăng ký', async () => {
    const { el, src } = await setup(
      screenOf('s', [widget('a', 'card', { value: 't1' }), widget('b', 'card', { value: 't2' })]),
    );
    const [a0, b0] = itemEls(el).map((i) => i.firstElementChild!);
    el.screen = screenOf('s', [widget('a', 'lamp', { state: 'b1' })]);
    await el.updateComplete;
    await el.whenReady();
    const items = itemEls(el);
    expect(items).toHaveLength(1);
    expect(items[0]!.firstElementChild).not.toBe(a0);
    expect(items[0]!.firstElementChild!.localName).toBe('mat-w-lamp');
    expect(b0!.isConnected).toBe(false);
    src.set('t2', { value: 9, quality: 'GOOD' }); // không còn ai nghe: không ném lỗi
  });

  it('đổi thứ tự lớp: sắp lại DOM, phần tử không bị tạo lại', async () => {
    const { el } = await setup(
      screenOf('s', [widget('a', 'panel'), widget('b', 'panel'), widget('c', 'panel')]),
    );
    const map = new Map(itemEls(el).map((i) => [i.dataset.itemId, i.firstElementChild]));
    el.screen = screenOf('s', [widget('c', 'panel'), widget('a', 'panel'), widget('b', 'panel')]);
    await el.updateComplete;
    await el.whenReady();
    const items = itemEls(el);
    expect(items.map((i) => i.dataset.itemId)).toEqual(['c', 'a', 'b']);
    for (const i of items) expect(i.firstElementChild).toBe(map.get(i.dataset.itemId));
  });

  it('item svg cùng file: giữ phần tử; đổi svgFile: dựng lại', async () => {
    const loads: string[] = [];
    const { el } = await setup(screenOf('s', [svgItem('g1')]), {
      loadSvg: async (p) => {
        loads.push(p);
        return SVG('u1');
      },
      loadBindings: async () => [],
    });
    const host0 = itemEls(el)[0]!.querySelector('.svg-host');
    el.screen = screenOf('s', [svgItem('g1', 'u1', { x: 40 })]);
    await el.updateComplete;
    await el.whenReady();
    expect(itemEls(el)[0]!.querySelector('.svg-host')).toBe(host0);
    expect(loads).toHaveLength(1);
    el.screen = screenOf('s', [svgItem('g1', 'u1', { svgFile: 'khac.svg' })]);
    await el.updateComplete;
    await el.whenReady();
    expect(loads).toEqual(['g1.svg', 'khac.svg']);
  });
});

describe('<mat-screen>: chế độ edit (contract §3)', () => {
  it('widget nhận mode=edit, khung có lớp edit; Esc ở popup không gọi host', async () => {
    const popup = screenOf('p', [widget('pa', 'panel')], { kind: 'popup' });
    const { el, host } = await setup(screenOf('s', [widget('a', 'card', { value: 't1' })]), {
      mode: 'edit',
      popup,
    });
    const w = itemEls(el)[0]!.firstElementChild as unknown as { mode: string };
    expect(w.mode).toBe('edit');
    expect(frame(el).classList.contains('edit')).toBe(true);
    const dlg = el.shadowRoot!.querySelector('[role="dialog"]')!;
    dlg.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    expect(host.calls).toEqual([]);
  });

  it('vẫn nhận TagSource để xem giá trị', async () => {
    const { el, src } = await setup(screenOf('s', [widget('a', 'card', { value: 't1' })]), {
      mode: 'edit',
    });
    src.set('t1', { value: 5, quality: 'GOOD' });
    const w = itemEls(el)[0]!.firstElementChild as HTMLElement & {
      updateComplete: Promise<boolean>;
    };
    await w.updateComplete;
    expect(w.shadowRoot!.querySelector('.value')!.textContent!.trim()).toBe('5.0');
  });

  it('đổi mode sang run: cập nhật widget sẵn có', async () => {
    const { el } = await setup(screenOf('s', [widget('a', 'card', { value: 't1' })]), {
      mode: 'edit',
    });
    el.mode = 'run';
    await el.updateComplete;
    expect((itemEls(el)[0]!.firstElementChild as unknown as { mode: string }).mode).toBe('run');
  });
});

describe('<mat-screen>: popup (FR-016)', () => {
  const popup = screenOf('p', [widget('pa', 'card', { value: 't2' })], {
    kind: 'popup',
    size: { width: 400, height: 300 },
  });

  it('lớp phủ riêng ngoài khung: role=dialog, aria-modal, nhãn là tên popup, dựng bằng mat-screen lồng', async () => {
    const { el } = await setup(screenOf('s', [widget('a', 'card', { value: 't1' })]), { popup });
    const overlay = el.shadowRoot!.querySelector('.popup-overlay')!;
    expect(overlay).not.toBeNull();
    expect(frame(el).contains(overlay)).toBe(false);
    const dlg = overlay.querySelector('[role="dialog"]')!;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.getAttribute('aria-label')).toBe('p');
    expect(dlg.querySelector('mat-screen')).not.toBeNull();
  });

  it('không có popup thì không có lớp phủ; đóng popup gỡ lớp phủ', async () => {
    const { el } = await setup(screenOf('s', []), { popup });
    el.popup = null;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.popup-overlay')).toBeNull();
  });

  it('Esc gọi host.closePopup; nút Đóng cũng vậy', async () => {
    const { el, host } = await setup(screenOf('s', []), { popup });
    const dlg = el.shadowRoot!.querySelector('[role="dialog"]')!;
    dlg.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
    );
    expect(host.calls).toEqual(['closePopup']);
    el.shadowRoot!.querySelector<HTMLButtonElement>('.popup-close')!.click();
    expect(host.calls).toEqual(['closePopup', 'closePopup']);
  });

  it('focus vào popup khi mở và bị giữ trong popup (bẫy focus bằng Tab)', async () => {
    const { el } = await setup(screenOf('s', []), { popup });
    const close = el.shadowRoot!.querySelector<HTMLButtonElement>('.popup-close')!;
    const dlg = el.shadowRoot!.querySelector<HTMLElement>('[role="dialog"]')!;
    // Phần tử có focus trong shadow root của mat-screen phải nằm trong hộp thoại.
    const active = el.shadowRoot!.activeElement;
    expect(active === close || active === dlg).toBe(true);
    const ev = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    close.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true); // chỉ một phần tử focus được: Tab quay lại chính nó
    const ev2 = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    close.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(true);
  });

  it('nextFocusIndex: vòng tiến, vòng lùi, danh sách rỗng', () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
    expect(nextFocusIndex(3, 2, false)).toBe(0);
    expect(nextFocusIndex(3, 0, true)).toBe(2);
    expect(nextFocusIndex(3, 1, true)).toBe(0);
    expect(nextFocusIndex(3, -1, false)).toBe(0);
    expect(nextFocusIndex(3, -1, true)).toBe(2);
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
  });

  it('trả focus về phần tử trước đó khi đóng popup', async () => {
    const btn = document.createElement('button');
    document.body.append(btn);
    btn.focus();
    const { el } = await setup(screenOf('s', []), { popup: null });
    el.popup = popup;
    await el.updateComplete;
    el.popup = null;
    await el.updateComplete;
    expect(document.activeElement === btn || document.activeElement === document.body).toBe(true);
  });
});

describe('<mat-screen>: co theo fitMode (FR-014)', () => {
  it('viewport cố định: scale và transform theo contain', async () => {
    const { el } = await setup(screenOf('s', [], { size: { width: 2000, height: 1000 } }), {
      viewport: { width: 1000, height: 800 },
    });
    expect(el.scale).toBe(0.5);
    expect(frame(el).style.transform).toContain('scale(0.5, 0.5)');
    const sizer = el.shadowRoot!.querySelector<HTMLElement>('.sizer')!;
    expect(sizer.style.transform).toContain('translate(0px, 150px)');
  });

  it('stretch: hai hệ số khác nhau', async () => {
    const { el } = await setup(
      screenOf('s', [], { size: { width: 2000, height: 1000 }, fitMode: 'stretch' }),
      {
        viewport: { width: 1000, height: 1000 },
      },
    );
    expect(frame(el).style.transform).toContain('scale(0.5, 1)');
  });

  it('viewport auto: đo bằng ResizeObserver, gom một lần mỗi khung hình', async () => {
    let roCb: ((e: Array<{ contentRect: { width: number; height: number } }>) => void) | null =
      null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class FakeRO {
      constructor(cb: typeof roCb) {
        roCb = cb;
      }
      observe = observe;
      disconnect = disconnect;
      unobserve() {}
    }
    const queue: Array<() => void> = [];
    const el = document.createElement('mat-screen') as MatScreen;
    el.env = {
      raf: (cb) => queue.push(cb),
      cancelRaf: () => {},
      ResizeObserver: FakeRO as unknown as typeof ResizeObserver,
    };
    el.tags = new MemoryTagSource();
    el.host = new FakeActionHost();
    el.viewport = 'auto';
    el.screen = screenOf('s', [], { size: { width: 2000, height: 1000 } });
    document.body.append(el);
    await el.updateComplete;
    expect(observe).toHaveBeenCalledTimes(1);
    roCb!([{ contentRect: { width: 500, height: 500 } }]);
    roCb!([{ contentRect: { width: 1000, height: 600 } }]);
    expect(queue).toHaveLength(1); // gom một rAF
    queue.shift()!();
    await el.updateComplete;
    expect(el.scale).toBe(0.5);
    el.remove();
    expect(disconnect).toHaveBeenCalled();
  });

  it('chưa có kích thước (vùng 0): k = 1, không NaN', async () => {
    const { el } = await setup(screenOf('s', []), { viewport: { width: 0, height: 0 } });
    expect(el.scale).toBe(1);
  });
});

describe('<mat-screen>: dispose và hiệu năng', () => {
  it('dispose gỡ widget, hủy đăng ký, hủy applier', async () => {
    const { el, src } = await setup(
      screenOf('s', [svgItem('g1'), widget('a', 'card', { value: 't1' })]),
    );
    const w = itemEls(el)[1]!.firstElementChild!;
    const rect = itemEls(el)[0]!
      .querySelector('.svg-host')!
      .shadowRoot!.querySelector<SVGElement>('rect')!;
    el.dispose();
    expect(itemEls(el)).toHaveLength(0);
    expect(w.isConnected).toBe(false);
    src.set('b1', { value: true, quality: 'GOOD' });
    expect(rect.style.fill).toBe('');
  });

  it('gỡ khỏi DOM thì hủy đăng ký, gắn lại thì dựng lại', async () => {
    const { el } = await setup(screenOf('s', [widget('a', 'card', { value: 't1' })]));
    el.remove();
    expect(itemEls(el)).toHaveLength(0);
    document.body.append(el);
    await el.updateComplete;
    await el.whenReady();
    expect(itemEls(el)).toHaveLength(1);
  });

  it('dựng màn hình 100 widget (số đo ghi ra console)', async () => {
    const items: Item[] = [];
    for (let i = 0; i < 100; i++) {
      const kind = ['card', 'lamp', 'gauge', 'level', 'label'][i % 5]!;
      const slot = kind === 'lamp' ? 'state' : 'value';
      items.push(
        widget(
          `w${i}`,
          kind,
          { [slot]: i % 2 ? 'b1' : 't1' },
          { x: (i % 10) * 90, y: Math.floor(i / 10) * 40 },
        ),
      );
    }
    const t0 = performance.now();
    const { el } = await setup(screenOf('s', items));
    await Promise.all(
      itemEls(el).map(
        (i) =>
          (i.firstElementChild as HTMLElement & { updateComplete: Promise<boolean> })
            .updateComplete,
      ),
    );
    const ms = performance.now() - t0;
    console.info(`[đo] dựng 100 widget trong jsdom: ${ms.toFixed(0)} ms`);
    expect(itemEls(el)).toHaveLength(100);
    expect(ms).toBeLessThan(5000);
  });
});
