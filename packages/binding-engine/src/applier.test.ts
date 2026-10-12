// @vitest-environment jsdom
import type { ValueTable } from '@mat/expression';
import type { ElementBindings, ElementBindings02 } from '@mat/project-schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomApplier } from './applier.ts';

const NS = 'http://www.w3.org/2000/svg';

interface FakeAnim {
  keyframes: unknown;
  options: { duration: number; iterations: number };
  playState: string;
  play: () => void;
  pause: () => void;
  cancel: () => void;
}

function svg(): { root: SVGSVGElement; els: Map<string, Element> } {
  const root = document.createElementNS(NS, 'svg') as SVGSVGElement;
  const mk = (tag: string, uid: string, attrs: Record<string, string> = {}) => {
    const el = document.createElementNS(NS, tag);
    el.setAttribute('data-mat-uid', uid);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    root.append(el);
    return el;
  };
  const els = new Map<string, Element>([
    ['el_level', mk('rect', 'el_level', { x: '200', y: '150', width: '280', height: '420' })],
    ['el_body', mk('rect', 'el_body')],
    ['el_fan', mk('g', 'el_fan')],
    ['el_txt', mk('text', 'el_txt')],
  ]);
  return { root, els };
}

const bindings = (extra: Partial<Record<string, object>> = {}): ElementBindings[] => [
  {
    elementUid: 'el_level',
    bindings: [
      {
        id: 'lv',
        target: 'geometry.levelPercent',
        source: { type: 'tag', tagId: 'LEVEL' },
        transform: { kind: 'direct' },
        ...(extra.lv ?? {}),
      },
    ],
  },
  {
    elementUid: 'el_body',
    bindings: [
      {
        id: 'c',
        target: 'style.fill',
        source: { type: 'tag', tagId: 'RUN' },
        transform: {
          kind: 'discreteMap',
          cases: [
            { equals: true, value: '#22c55e' },
            { equals: false, value: '#64748b' },
          ],
        },
      },
      {
        id: 'v',
        target: 'style.visibility',
        source: { type: 'tag', tagId: 'VIS' },
        transform: { kind: 'direct' },
      },
    ],
  },
  {
    elementUid: 'el_fan',
    bindings: [
      {
        id: 's',
        target: 'transform.rotate',
        source: { type: 'tag', tagId: 'SPEED' },
        transform: { kind: 'direct' },
        animation: 'spin',
      },
    ],
  },
  {
    elementUid: 'el_txt',
    bindings: [
      {
        id: 't',
        target: 'text.content',
        source: { type: 'tag', tagId: 'LEVEL' },
        transform: { kind: 'direct' },
        format: { decimals: 1, suffix: ' %' },
      },
      {
        id: 'r',
        target: 'transform.rotate',
        source: { type: 'tag', tagId: 'ANGLE' },
        transform: { kind: 'direct' },
      },
    ],
  },
];

let frames: Array<() => void>;
let anims: FakeAnim[];
const raf = (cb: () => void) => {
  frames.push(cb);
  return frames.length;
};
const runFrames = () => {
  const f = frames;
  frames = [];
  f.forEach((cb) => cb());
};

beforeEach(() => {
  frames = [];
  anims = [];
  (Element.prototype as unknown as { animate: unknown }).animate = function (
    keyframes: unknown,
    options: { duration: number; iterations: number },
  ) {
    const a: FakeAnim = {
      keyframes,
      options,
      playState: 'running',
      play: () => (a.playState = 'running'),
      pause: () => (a.playState = 'paused'),
      cancel: () => (a.playState = 'idle'),
    };
    anims.push(a);
    return a;
  };
});

describe('DomApplier', () => {
  it('liệt kê Tag cần subscribe (không trùng)', () => {
    const { els } = svg();
    const ap = new DomApplier({ elements: els, bindings: bindings(), raf });
    expect(ap.tagIds().sort()).toEqual(['ANGLE', 'LEVEL', 'RUN', 'SPEED', 'VIS']);
  });

  it('gom thay đổi vào một frame và chỉ ghi khi giá trị đổi', () => {
    const { els } = svg();
    const ap = new DomApplier({ elements: els, bindings: bindings(), raf });
    ap.update([{ id: 'RUN', value: false, quality: 'GOOD' }]);
    ap.update([{ id: 'RUN', value: true, quality: 'GOOD' }]);
    expect(frames.length).toBe(1);
    const body = els.get('el_body') as SVGElement;
    expect(body.style.fill).toBe('');
    runFrames();
    expect(body.style.fill).toBe('rgb(34, 197, 94)');
    const spy = vi.spyOn(body.style, 'setProperty');
    ap.update([{ id: 'RUN', value: true, quality: 'GOOD' }]);
    runFrames();
    expect(spy).not.toHaveBeenCalled();
    expect(ap.writes).toBe(1);
  });

  it('levelPercent theo hộp bao gốc, 4 hướng', () => {
    for (const [direction, expected] of [
      ['up', { x: '200', y: '360', width: '280', height: '210' }],
      ['down', { x: '200', y: '150', width: '280', height: '210' }],
      ['right', { x: '200', y: '150', width: '140', height: '420' }],
      ['left', { x: '340', y: '150', width: '140', height: '420' }],
    ] as const) {
      frames = [];
      const { els } = svg();
      const ap = new DomApplier({ elements: els, bindings: bindings({ lv: { direction } }), raf });
      ap.update([{ id: 'LEVEL', value: 50, quality: 'GOOD' }]);
      runFrames();
      const r = els.get('el_level')!;
      expect(
        {
          x: r.getAttribute('x'),
          y: r.getAttribute('y'),
          width: r.getAttribute('width'),
          height: r.getAttribute('height'),
        },
        direction,
      ).toEqual(expected);
      ap.update([{ id: 'LEVEL', value: 100, quality: 'GOOD' }]);
      runFrames();
      expect(r.getAttribute('height')).toBe('420');
    }
  });

  it('chữ có định dạng; quay tĩnh theo độ quanh tâm', () => {
    const { els } = svg();
    const ap = new DomApplier({ elements: els, bindings: bindings(), raf });
    ap.update([
      { id: 'LEVEL', value: 65.24, quality: 'GOOD' },
      { id: 'ANGLE', value: 30, quality: 'GOOD' },
    ]);
    runFrames();
    const t = els.get('el_txt') as SVGElement;
    expect(t.textContent).toBe('65.2 %');
    expect(t.style.transform).toBe('rotate(30deg)');
    expect(t.style.transformOrigin).toBe('center');
    expect(t.style.transformBox).toBe('fill-box');
  });

  it('visibility', () => {
    const { els } = svg();
    const ap = new DomApplier({ elements: els, bindings: bindings(), raf });
    ap.update([{ id: 'VIS', value: false, quality: 'GOOD' }]);
    runFrames();
    expect((els.get('el_body') as SVGElement).style.visibility).toBe('hidden');
  });

  it('spin: tạo animation khi > 0, đổi tốc độ, dừng khi 0/BAD; tạm dừng khi tab ẩn', () => {
    const { els } = svg();
    let hidden = false;
    const ap = new DomApplier({ elements: els, bindings: bindings(), raf, isHidden: () => hidden });
    ap.update([{ id: 'SPEED', value: 1450, quality: 'GOOD' }]);
    runFrames();
    expect(anims.length).toBe(1);
    expect(anims[0].options.iterations).toBe(Infinity);
    expect(anims[0].options.duration).toBe(500); // 2 vòng/giây
    expect((els.get('el_fan') as SVGElement).style.transformBox).toBe('fill-box');
    ap.update([{ id: 'SPEED', value: 300, quality: 'GOOD' }]);
    runFrames();
    expect(anims.at(-1)!.options.duration).toBe(2000);
    expect(anims.at(-1)!.playState).toBe('running');
    ap.update([{ id: 'SPEED', value: 300, quality: 'BAD' }]);
    runFrames();
    expect(anims.at(-1)!.playState).toBe('paused');
    ap.update([{ id: 'SPEED', value: 600, quality: 'GOOD' }]);
    runFrames();
    expect(anims.at(-1)!.playState).toBe('running');
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(anims.at(-1)!.playState).toBe('paused');
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(anims.at(-1)!.playState).toBe('running');
  });

  it('STALE dùng quy tắc chất lượng xấu (màu trung tính, chữ --)', () => {
    const { els } = svg();
    const ap = new DomApplier({ elements: els, bindings: bindings(), raf });
    ap.update([
      { id: 'RUN', value: true, quality: 'GOOD' },
      { id: 'LEVEL', value: 40, quality: 'GOOD' },
    ]);
    runFrames();
    ap.update([
      { id: 'RUN', value: true, quality: 'STALE' },
      { id: 'LEVEL', value: 40, quality: 'STALE' },
    ]);
    runFrames();
    expect((els.get('el_body') as SVGElement).style.fill).toBe('rgb(141, 153, 163)');
    expect(els.get('el_txt')!.textContent).toBe('--');
    expect(els.get('el_level')!.getAttribute('height')).toBe('168'); // level giữ nguyên
  });

  it('bỏ binding có elementUid không có trong SVG và báo lại', () => {
    const { els } = svg();
    els.delete('el_fan');
    const ap = new DomApplier({ elements: els, bindings: bindings(), raf });
    expect(ap.missing).toEqual(['el_fan']);
    expect(ap.tagIds()).not.toContain('SPEED');
  });

  it('một giá trị lỗi không làm dừng các binding khác', () => {
    const { els } = svg();
    const ap = new DomApplier({ elements: els, bindings: bindings(), raf });
    ap.update([
      { id: 'ANGLE', value: 'abc', quality: 'GOOD' },
      { id: 'RUN', value: false, quality: 'GOOD' },
    ]);
    runFrames();
    expect((els.get('el_body') as SVGElement).style.fill).toBe('rgb(100, 116, 139)');
  });

  it('INT64/UINT64 đến dạng chuỗi được đổi sang số trước transform (review minor-1)', () => {
    const { els } = svg();
    const ap = new DomApplier({
      elements: els,
      bindings: bindings(),
      raf,
      tagTypes: { LEVEL: 'INT64', ANGLE: 'STRING' },
    });
    ap.update([
      { id: 'LEVEL', value: '50', quality: 'GOOD' },
      { id: 'ANGLE', value: '30', quality: 'GOOD' }, // STRING: giữ nguyên chuỗi → không quay
    ]);
    runFrames();
    expect(els.get('el_level')!.getAttribute('height')).toBe('210');
    expect(els.get('el_txt')!.textContent).toBe('50.0 %');
    expect((els.get('el_txt') as SVGElement).style.transform).toBe('');
  });

  it('dispose() hủy animation và listener', () => {
    const { els } = svg();
    const ap = new DomApplier({ elements: els, bindings: bindings(), raf, isHidden: () => false });
    ap.update([{ id: 'SPEED', value: 600, quality: 'GOOD' }]);
    runFrames();
    ap.dispose();
    expect(anims[0].playState).toBe('idle');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(anims[0].playState).toBe('idle');
    ap.update([{ id: 'RUN', value: true, quality: 'GOOD' }]);
    expect(frames.length).toBe(0);
  });
});

describe('DomApplier: transform valueTable (feature 006 T178)', () => {
  const table: ValueTable = {
    entries: [
      { value: 0, text: 'Dừng', color: '#808080' },
      { value: 1, text: 'Chạy', color: '#2E7D32' },
      { value: 2, text: 'Lỗi' },
    ],
  };
  const vt: ElementBindings02[] = [
    {
      elementUid: 'el_txt',
      bindings: [
        {
          id: 'vt-text',
          target: 'text.content',
          source: { type: 'tag', tagId: 'PUMP01.STATE' },
          transform: { kind: 'valueTable', output: 'text' }, // bảng của Tag
        },
      ],
    },
    {
      elementUid: 'el_body',
      bindings: [
        {
          id: 'vt-color',
          target: 'style.fill',
          source: { type: 'tag', tagId: 'PUMP01.STATE' },
          transform: { kind: 'valueTable', table: 'TrangThaiBom', output: 'color' },
        },
      ],
    },
  ];

  it('chữ và màu theo bảng; mục không có màu thì phần tử giữ màu gốc', () => {
    const { els } = svg();
    const body = els.get('el_body') as SVGElement;
    body.setAttribute('fill', '#abcdef'); // màu gốc của SVG (thuộc tính trình bày)
    const ap = new DomApplier({
      elements: els,
      bindings: vt,
      raf,
      valueTables: { TrangThaiBom: table },
      tagValueTables: { 'PUMP01.STATE': 'TrangThaiBom' },
    });
    ap.update([{ id: 'PUMP01.STATE', value: 1, quality: 'GOOD' }]);
    runFrames();
    expect(els.get('el_txt')!.textContent).toBe('Chạy');
    expect(body.style.getPropertyValue('fill')).toBe('rgb(46, 125, 50)'); // jsdom chuẩn hóa màu
    ap.update([{ id: 'PUMP01.STATE', value: 2, quality: 'GOOD' }]);
    runFrames();
    expect(els.get('el_txt')!.textContent).toBe('Lỗi');
    expect(body.style.getPropertyValue('fill')).toBe(''); // kiểu bị bỏ: màu gốc của SVG hiện lại
    expect(body.getAttribute('fill')).toBe('#abcdef');
    ap.update([{ id: 'PUMP01.STATE', value: 7, quality: 'GOOD' }]);
    runFrames();
    expect(els.get('el_txt')!.textContent).toBe(''); // không khớp, không mặc định
    ap.update([{ id: 'PUMP01.STATE', value: 0, quality: 'BAD' }]);
    runFrames();
    expect(els.get('el_txt')!.textContent).toBe('--'); // chất lượng xấu như mọi binding
    ap.dispose();
  });

  it('thiếu bảng thì không ném lỗi và hiện như chất lượng xấu', () => {
    const { els } = svg();
    const ap = new DomApplier({ elements: els, bindings: vt, raf });
    ap.update([{ id: 'PUMP01.STATE', value: 1, quality: 'GOOD' }]);
    runFrames();
    expect(els.get('el_txt')!.textContent).toBe('--');
    ap.dispose();
  });
});
