// Đổi file binding hoặc nguồn giá trị của item `svg` không dựng lại SVG (feature 008, T077, SC-018): `<mat-screen>` giữ cùng
// DOM đã dựng, bộ áp cũ trả phần tử về trạng thái gốc, bộ áp mới nhận binding mới.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElementBindings02, ScreenModel, SvgItem } from '@mat/project-schema';
import { FakeActionHost, MemoryTagSource } from '../host/memory-source.ts';
import { MatScreen } from './mat-screen.ts';
import { svgItemKey } from './svg-item.ts';

// Nạp mat-screen để đăng ký thẻ `<mat-screen>` (chỉ dùng làm kiểu nên trình biên dịch sẽ bỏ import nếu không dùng giá trị).
void MatScreen;

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect data-mat-uid="el_uid1" width="10" height="10" fill="#123456"/><text data-mat-uid="el_uid2" x="5">gốc</text></svg>';

const item = (over: Partial<SvgItem> = {}): SvgItem => ({
  type: 'svg',
  id: 'g1',
  x: 0,
  y: 0,
  width: 400,
  height: 300,
  svgFile: 'g1.svg',
  bindingFile: 'a.json',
  viewBox: [0, 0, 100, 100],
  elements: [{ elementUid: 'el_uid1' }, { elementUid: 'el_uid2' }],
  ...over,
});
const screenOf = (i: SvgItem): ScreenModel => ({
  schemaVersion: '0.4.0',
  id: 's',
  name: 's',
  kind: 'screen',
  size: { width: 1000, height: 500 },
  items: [i],
});

const fill = (tagId: string): ElementBindings02[] => [
  {
    elementUid: 'el_uid1',
    bindings: [
      {
        id: 'f',
        target: 'style.fill',
        source: { type: 'tag', tagId },
        transform: {
          kind: 'discreteMap',
          cases: [{ equals: true, value: '#00ff00' }],
          default: '#ff0000',
        },
      },
    ],
  },
];
const text = (tagId: string): ElementBindings02[] => [
  {
    elementUid: 'el_uid2',
    bindings: [
      {
        id: 't',
        target: 'text.content',
        source: { type: 'tag', tagId },
        transform: { kind: 'direct' },
      },
    ],
  },
];

const BOOL = { type: 'BOOL' as const, access: 'R' as const, kind: 'external' as const };

async function setup() {
  const src = new MemoryTagSource({
    tags: [
      { id: 'b1', ...BOOL },
      { id: 'b2', ...BOOL },
    ],
  });
  src.set('b1', { value: true, quality: 'GOOD' });
  src.set('b2', { value: false, quality: 'GOOD' });
  const files: Record<string, ElementBindings02[]> = { 'a.json': fill('b1'), 'b.json': text('b2') };
  const el = document.createElement('mat-screen') as MatScreen;
  el.env = { raf: (cb) => (cb(), 0), cancelRaf: () => {}, ResizeObserver: undefined };
  el.tags = src;
  el.host = new FakeActionHost({ session: { user: 'u', role: 'operator' } });
  el.mode = 'edit';
  el.viewport = { width: 1000, height: 500 };
  el.loadSvg = async () => SVG;
  el.loadBindings = async (p) => files[p] ?? [];
  el.screen = screenOf(item());
  document.body.append(el);
  await el.updateComplete;
  await el.whenReady();
  const root = () => el.shadowRoot!.querySelector<HTMLElement>('.svg-host')!.shadowRoot!;
  return { el, src, files, root };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('khóa dựng lại của item svg', () => {
  it('không gồm file binding và elements (chỉ dựng lại bộ áp); gồm file SVG và viewBox', () => {
    const k = svgItemKey(item());
    expect(svgItemKey(item({ bindingFile: 'khac.json' }))).toBe(k);
    expect(svgItemKey(item({ svgFile: 'khac.svg' }))).not.toBe(k);
    expect(svgItemKey(item({ viewBox: [0, 0, 10, 10] }))).not.toBe(k);
    expect(svgItemKey(item({ elements: [] }))).toBe(k);
  });
});

describe('<mat-screen>: đổi file binding không dựng lại SVG', () => {
  it('cùng cây DOM sau khi đổi; binding cũ được gỡ sạch, binding mới áp lên cùng phần tử', async () => {
    const { el, root } = await setup();
    const svg0 = root().querySelector('svg')!;
    const rect = root().querySelector('[data-mat-uid="el_uid1"]')!;
    expect(rect.getAttribute('style') ?? '').toContain('0, 255, 0');
    el.screen = screenOf(item({ bindingFile: 'b.json' }));
    await el.updateComplete;
    await el.whenReady();
    await new Promise((r) => setTimeout(r, 20));
    expect(root().querySelector('svg')).toBe(svg0);
    expect(root().querySelector('[data-mat-uid="el_uid1"]')).toBe(rect);
    // binding fill cũ gỡ: trả về như gốc (không còn style fill)
    expect(rect.getAttribute('style')).toBeNull();
    expect(root().querySelector('[data-mat-uid="el_uid2"]')!.textContent).toBe('false');
  });

  it('đổi nguồn giá trị: bộ áp mới đọc nguồn mới; đổi về file cũ trả chữ gốc', async () => {
    const { el, files, src, root } = await setup();
    el.screen = screenOf(item({ bindingFile: 'b.json' }));
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 20));
    const txt = root().querySelector('[data-mat-uid="el_uid2"]')!;
    expect(txt.textContent).toBe('false');
    src.set('b2', { value: true, quality: 'GOOD' });
    await new Promise((r) => setTimeout(r, 5));
    expect(txt.textContent).toBe('true');
    files['c.json'] = [];
    el.screen = screenOf(item({ bindingFile: 'c.json' }));
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 20));
    expect(txt.textContent).toBe('gốc');
  });

  it('khai báo thêm phần tử vào elements: không dựng lại SVG, phần tử mới nhận binding; bỏ khai báo thì thôi nhận', async () => {
    // Chỉ el_uid1 được khai báo: binding chữ của el_uid2 bị bỏ qua (E_REF_UID ở bộ kiểm tra).
    const { el, root, files } = await setup();
    files['b.json'] = text('b2');
    el.screen = screenOf(item({ bindingFile: 'b.json', elements: [{ elementUid: 'el_uid1' }] }));
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 30));
    const svg0 = root().querySelector('svg');
    const txt = root().querySelector('[data-mat-uid="el_uid2"]')!;
    expect(txt.textContent).toBe('gốc');
    el.screen = screenOf(
      item({
        bindingFile: 'b.json',
        elements: [{ elementUid: 'el_uid1' }, { elementUid: 'el_uid2' }],
      }),
    );
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 30));
    expect(root().querySelector('svg')).toBe(svg0);
    expect(txt.textContent).toBe('false');
    el.screen = screenOf(item({ bindingFile: 'b.json', elements: [{ elementUid: 'el_uid1' }] }));
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 30));
    expect(txt.textContent).toBe('gốc');
  });
});
