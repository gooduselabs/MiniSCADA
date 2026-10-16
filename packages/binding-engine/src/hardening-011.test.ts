// @vitest-environment jsdom
// Feature 011 (T214, T218): mục Low F10 và F14 của docs/reports/008-security-review.md. Viết trước, phải đỏ.
import type { Binding } from '@mat/project-schema';
import { describe, expect, it, vi } from 'vitest';
import { DomApplier } from './applier.ts';
import { evaluateBinding } from './transforms.ts';
import type { Binding04 } from './types04.ts';

const NS = 'http://www.w3.org/2000/svg';

describe('F10 (T214): màu của binding đi qua isColor của svg-renderer, không regex', () => {
  const fill = (target: 'style.fill' | 'style.stroke' = 'style.fill'): Binding => ({
    id: 'x',
    target,
    source: { type: 'tag', tagId: 'T' },
    transform: { kind: 'direct' },
  });
  it.each(['#fff', '#2E7D32', 'red', 'DarkGreen', 'rgb(1, 2, 3)', 'transparent', ''])(
    'nhận %j',
    (v) => {
      expect(evaluateBinding(fill(), v, 'GOOD')).toEqual({ hold: false, value: v });
      expect(evaluateBinding(fill('style.stroke'), v, 'GOOD')).toEqual({ hold: false, value: v });
    },
  );
  it.each(['inherit', 'initial', 'unset', 'revert', 'blahblah', 'url(#a)', 'red;x:y', '#12345'])(
    'từ chối %j (giữ màu hiện tại như giá trị xấu)',
    (v) => {
      const out = evaluateBinding(fill(), v, 'GOOD');
      expect(out.value).not.toBe(v);
    },
  );
  it('bảng giá trị có màu `initial`: không áp', () => {
    const b = {
      ...fill(),
      transform: { kind: 'valueTable', table: 'E', output: 'color' },
    } as unknown as Binding;
    const tables = { E: { entries: [{ value: 1, text: 'x', color: 'initial' }] } };
    expect(evaluateBinding(b, 1, 'GOOD', { tables }).value).toBe('');
    const ok = { E: { entries: [{ value: 1, text: 'x', color: 'rgb(0,128,0)' }] } };
    expect(evaluateBinding(b, 1, 'GOOD', { tables: ok }).value).toBe('rgb(0,128,0)');
  });
});

describe('F14 (T218): id clipPath sinh ra không đụng id do SVG tự khai', () => {
  const setup = () => {
    const root = document.createElementNS(NS, 'svg') as SVGSVGElement;
    const defs = document.createElementNS(NS, 'defs');
    // SVG tự khai id giống id mã sẽ sinh, kèm hậu tố đầu tiên
    for (const id of ['mat-clip-el_x', 'mat-clip-el_x-2']) {
      const cp = document.createElementNS(NS, 'clipPath');
      cp.setAttribute('id', id);
      cp.append(document.createElementNS(NS, 'rect'));
      defs.append(cp);
    }
    root.append(defs);
    const el = document.createElementNS(NS, 'path');
    el.setAttribute('data-mat-uid', 'el_x');
    el.setAttribute('d', 'M0 0 L 100 0 L 100 50 Z');
    root.append(el);
    const binding = {
      id: 'c',
      target: 'geometry.clipLevel',
      source: { type: 'tag', tagId: 'LV' },
      transform: { kind: 'direct' },
    } as Binding04;
    const frames: Array<() => void> = [];
    const ap = new DomApplier({
      elements: new Map([['el_x', el]]),
      bindings: [{ elementUid: 'el_x', bindings: [binding] }] as never,
      raf: (cb: () => void) => frames.push(cb),
      measure: vi.fn(() => ({ x: 0, y: 0, width: 100, height: 50 })),
      reducedMotion: () => false,
      now: () => 1,
    });
    const flush = () => frames.splice(0).forEach((cb) => cb());
    return { root, el, ap, flush };
  };

  it('chọn id chưa có trong cây; clip-path trỏ đúng clipPath do mã sinh', () => {
    const { root, el, ap, flush } = setup();
    ap.update([{ id: 'LV', value: 50, quality: 'GOOD' }]);
    flush();
    const ref = el.getAttribute('clip-path') ?? '';
    expect(ref.startsWith('url(#')).toBe(true);
    const id = ref.slice(5, -1);
    expect(['mat-clip-el_x', 'mat-clip-el_x-2']).not.toContain(id);
    const withId = Array.from(root.querySelectorAll('[id]')).filter((e) => e.id === id);
    expect(withId).toHaveLength(1);
    expect(withId[0].localName).toBe('clipPath');
    expect(withId[0].querySelector('rect')?.getAttribute('height')).toBe('25');
    ap.dispose();
    // gỡ đúng clipPath của mã; hai clipPath của SVG còn nguyên
    expect(Array.from(root.querySelectorAll('clipPath')).map((c) => c.id)).toEqual([
      'mat-clip-el_x',
      'mat-clip-el_x-2',
    ]);
  });
});
