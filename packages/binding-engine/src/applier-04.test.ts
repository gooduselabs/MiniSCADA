// @vitest-environment jsdom
// DomApplier 0.4 (feature 008, T063; contract binding-animation §3-§5, §7): jsdom, `measure` giả, Web Animations giả.
import type { Binding04 } from './types04.ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DomApplier, type DomApplierOptions } from './applier.ts';

const NS = 'http://www.w3.org/2000/svg';
const BOX = { x: 0, y: 0, width: 100, height: 50 };

class FakeAnim {
  el!: Element;
  keyframes: unknown;
  options: Record<string, unknown>;
  playState = 'running';
  playbackRate = 1;
  startTime: number | null = null;
  rates: number[] = [];
  kfSets: unknown[] = [];
  effect = {
    setKeyframes: (k: unknown) => {
      this.keyframes = k;
      this.kfSets.push(k);
    },
    updateTiming: (t: Record<string, unknown>) => Object.assign(this.options, t),
  };
  constructor(keyframes: unknown, options: Record<string, unknown>) {
    this.keyframes = keyframes;
    this.options = options;
  }
  updatePlaybackRate(r: number) {
    this.playbackRate = r;
    this.rates.push(r);
  }
  play() {
    this.playState = 'running';
  }
  pause() {
    this.playState = 'paused';
  }
  cancel() {
    this.playState = 'idle';
  }
}

function scene() {
  const root = document.createElementNS(NS, 'svg') as SVGSVGElement;
  const mk = (tag: string, uid: string, attrs: Record<string, string> = {}) => {
    const el = document.createElementNS(NS, tag);
    el.setAttribute('data-mat-uid', uid);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    root.append(el);
    return el;
  };
  const els = new Map<string, Element>([
    ['xf', mk('g', 'xf', { transform: 'translate(10 20)' })],
    ['plain', mk('g', 'plain')],
    ['clip', mk('path', 'clip', { d: 'M0 0 C 10 50 90 50 100 0 Z' })],
    ['blink', mk('rect', 'blink')],
    ['blink2', mk('rect', 'blink2')],
    ['pipe', mk('path', 'pipe', { d: 'M0 0 L 100 0', stroke: '#fff' })],
    ['vis', mk('rect', 'vis', { tabindex: '0' })],
    ['txt', mk('text', 'txt')],
    ['lvl', mk('rect', 'lvl', { x: '0', y: '0', width: '10', height: '100' })],
  ]);
  return { root, els };
}

const b = (id: string, target: string, tag: string, extra: object = {}): Binding04 =>
  ({
    id,
    target,
    source: { type: 'tag', tagId: tag },
    transform: { kind: 'direct' },
    ...extra,
  }) as Binding04;
const eb = (uid: string, ...bs: Binding04[]) => ({ elementUid: uid, bindings: bs });

let frames: Array<() => void>;
let anims: FakeAnim[];
const raf = (cb: () => void) => {
  frames.push(cb);
  return frames.length;
};
const flush = () => {
  const f = frames;
  frames = [];
  f.forEach((cb) => cb());
};
const good = (id: string, value: boolean | number | string) => ({
  id,
  value,
  quality: 'GOOD' as const,
});

function make(
  bindings: ReturnType<typeof eb>[],
  over: Partial<DomApplierOptions> = {},
  sc = scene(),
) {
  const measure = vi.fn(() => BOX);
  const ap = new DomApplier({
    elements: sc.els,
    bindings: bindings as never,
    raf,
    measure,
    reducedMotion: () => false,
    now: () => 12345,
    ...over,
  });
  return { ap, els: sc.els, root: sc.root, measure };
}

/** Các giá trị `transform` đã ghi qua style.setProperty. */
const transformWrites = (el: Element) => {
  const spy = vi.spyOn((el as SVGElement).style, 'setProperty');
  return {
    all: () => spy.mock.calls.filter((c) => c[0] === 'transform').map((c) => String(c[1])),
  };
};

beforeEach(() => {
  frames = [];
  anims = [];
  (Element.prototype as unknown as { animate: unknown }).animate = function (
    this: Element,
    keyframes: unknown,
    options: Record<string, unknown>,
  ) {
    const a = new FakeAnim(keyframes, options);
    a.el = this;
    anims.push(a);
    return a;
  };
});

describe('DomApplier 0.4: hợp biến đổi', () => {
  it('dời X, dời Y, co giãn cùng flush: một lần ghi, M0 được giữ, thuộc tính gốc không đổi', () => {
    const { ap, els } = make([
      eb(
        'xf',
        b('a', 'transform.translateX', 'TX'),
        b('b', 'transform.translateY', 'TY'),
        b('c', 'transform.scale', 'SC'),
      ),
    ]);
    const w = transformWrites(els.get('xf')!);
    ap.update([good('TX', 5), good('TY', 6), good('SC', 2)]);
    flush();
    expect(w.all()).toEqual([
      'translate(5px, 6px) matrix(1, 0, 0, 1, 10, 20) translate(50px, 25px) scale(2, 2) translate(-50px, -25px)',
    ]);
    expect(els.get('xf')!.getAttribute('transform')).toBe('translate(10 20)');
    const st = (els.get('xf') as SVGElement).style;
    expect(st.getPropertyValue('transform-origin')).toBe('0 0');
    expect(st.getPropertyValue('transform-box')).toBe('view-box');
    ap.update([good('TX', 7)]);
    flush();
    expect(w.all()).toHaveLength(2);
  });

  it('kẹp: dời ±100000, co giãn [0,01; 10]', () => {
    const { ap, els } = make([
      eb('plain', b('a', 'transform.translateX', 'TX'), b('c', 'transform.scale', 'SC')),
    ]);
    const w = transformWrites(els.get('plain')!);
    ap.update([good('TX', 1e9), good('SC', 99)]);
    flush();
    expect(w.all()[0]).toBe(
      'translate(100000px, 0px) translate(50px, 25px) scale(10, 10) translate(-50px, -25px)',
    );
  });

  it('axis và pivot của co giãn', () => {
    const { ap, els } = make([
      eb('plain', b('c', 'transform.scale', 'SC', { axis: 'x', pivot: [0, 0] })),
    ]);
    const w = transformWrites(els.get('plain')!);
    ap.update([good('SC', 2)]);
    flush();
    expect(w.all()).toEqual(['translate(0px, 0px) scale(2, 1) translate(0px, 0px)']);
  });

  it('ca tương thích 0.2: quay tĩnh, không có transform gốc: quay quanh tâm hộp bao', () => {
    const { ap, els } = make([eb('plain', b('r', 'transform.rotate', 'ANG'))]);
    const w = transformWrites(els.get('plain')!);
    ap.update([good('ANG', 30)]);
    flush();
    expect(w.all()).toEqual(['translate(50px, 25px) rotate(30deg) translate(-50px, -25px)']);
  });

  it('ca khác 0.2 có chủ ý: có transform gốc thì giữ M0 khi quay', () => {
    const { ap, els } = make([eb('xf', b('r', 'transform.rotate', 'ANG', { pivot: [0, 0] }))]);
    const w = transformWrites(els.get('xf')!);
    ap.update([good('ANG', 90)]);
    flush();
    expect(w.all()).toEqual([
      'matrix(1, 0, 0, 1, 10, 20) translate(0px, 0px) rotate(90deg) translate(0px, 0px)',
    ]);
  });

  it('không gọi measure mỗi lần cập nhật; hộp rỗng hoãn tới lần áp kế, không ném lỗi', () => {
    let calls = 0;
    const measure = vi.fn(() => (++calls <= 2 ? { x: 0, y: 0, width: 0, height: 0 } : BOX));
    const { ap, els } = make([eb('plain', b('r', 'transform.rotate', 'ANG'))], { measure });
    expect(measure).toHaveBeenCalledTimes(1); // dựng
    const w = transformWrites(els.get('plain')!);
    ap.update([good('ANG', 10)]);
    expect(() => flush()).not.toThrow();
    expect(w.all().join('')).not.toContain('rotate');
    ap.update([good('ANG', 20)]);
    flush();
    expect(w.all().at(-1)).toBe('translate(50px, 25px) rotate(20deg) translate(-50px, -25px)');
    const n = measure.mock.calls.length;
    ap.update([good('ANG', 30)]);
    flush();
    ap.update([good('ANG', 40)]);
    flush();
    expect(measure.mock.calls.length).toBe(n);
  });
});

describe('DomApplier 0.4: spin', () => {
  const spinB = (extra: object = {}) =>
    b('s', 'transform.rotate', 'SPD', { animation: 'spin', ...extra });

  it('hoạt ảnh hai khung cùng cấu trúc, 1000 ms, vô hạn, linear; tốc độ bằng updatePlaybackRate', () => {
    const { ap } = make([eb('plain', spinB())]);
    ap.update([good('SPD', 300)]);
    flush();
    expect(anims).toHaveLength(1);
    const a = anims[0]!;
    expect(a.options).toMatchObject({ duration: 1000, iterations: Infinity, easing: 'linear' });
    const kf = a.keyframes as Array<{ transform: string }>;
    expect(kf[0]!.transform).toBe('translate(50px, 25px) rotate(0deg) translate(-50px, -25px)');
    expect(kf[1]!.transform).toBe('translate(50px, 25px) rotate(360deg) translate(-50px, -25px)');
    expect(a.playbackRate).toBe(0.5);
    ap.update([good('SPD', 1450)]);
    flush();
    expect(anims).toHaveLength(1); // không tạo lại
    expect(a.playbackRate).toBe(2); // kẹp 2 vòng/giây
    ap.update([good('SPD', 0)]);
    flush();
    expect(a.playState).toBe('paused');
    ap.update([good('SPD', 600)]);
    flush();
    expect(a.playState).toBe('running');
  });

  it('reverse dùng -360deg; BOOL true = 1 vòng/giây', () => {
    const { ap } = make([eb('plain', spinB({ reverse: true }))]);
    ap.update([good('SPD', true)]);
    flush();
    const kf = anims[0]!.keyframes as Array<{ transform: string }>;
    expect(kf[1]!.transform).toContain('rotate(-360deg)');
    expect(anims[0]!.playbackRate).toBe(1);
  });

  it('đổi tx khi đang quay: setKeyframes, giữ cùng hoạt ảnh', () => {
    const { ap } = make([eb('plain', spinB(), b('t', 'transform.translateX', 'TX'))]);
    ap.update([good('SPD', 600)]);
    flush();
    ap.update([good('TX', 40)]);
    flush();
    expect(anims).toHaveLength(1);
    expect(anims[0]!.kfSets).toHaveLength(1);
    const kf = anims[0]!.keyframes as Array<{ transform: string }>;
    expect(kf[0]!.transform.startsWith('translate(40px, 0px)')).toBe(true);
  });

  it('chất lượng xấu dừng; tab ẩn tạm dừng; reducedMotion không tạo hoạt ảnh', () => {
    let hidden = false;
    const { ap } = make([eb('plain', spinB())], { isHidden: () => hidden });
    ap.update([good('SPD', 600)]);
    flush();
    ap.update([{ id: 'SPD', value: 600, quality: 'BAD' }]);
    flush();
    expect(anims[0]!.playState).toBe('paused');
    ap.update([good('SPD', 600)]);
    flush();
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(anims[0]!.playState).toBe('paused');
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(anims[0]!.playState).toBe('running');
    ap.dispose();

    anims.length = 0;
    const r = make([eb('plain', spinB())], { reducedMotion: () => true });
    r.ap.update([good('SPD', 600)]);
    flush();
    expect(anims).toHaveLength(0);
    expect(r.ap.animationCount()).toBe(0);
  });
});

describe('DomApplier 0.4: clipLevel và levelPercent', () => {
  it('tạo một clipPath trong defs, một lần; cập nhật rect; dispose gỡ', () => {
    const { ap, els, root } = make([eb('clip', b('c', 'geometry.clipLevel', 'LV'))]);
    const clip = els.get('clip')!;
    expect(clip.getAttribute('clip-path')).toBe('url(#mat-clip-clip)');
    const cp = root.querySelector('defs > clipPath#mat-clip-clip')!;
    expect(cp.getAttribute('clipPathUnits')).toBe('userSpaceOnUse');
    ap.update([good('LV', 50)]);
    flush();
    const r = cp.querySelector('rect')!;
    expect(['x', 'y', 'width', 'height'].map((k) => r.getAttribute(k))).toEqual([
      '0',
      '25',
      '100',
      '25',
    ]);
    ap.update([good('LV', 100)]);
    flush();
    expect(root.querySelectorAll('clipPath')).toHaveLength(1);
    expect(r.getAttribute('y')).toBe('0');
    ap.dispose();
    expect(root.querySelector('clipPath')).toBeNull();
    expect(clip.hasAttribute('clip-path')).toBe(false);
  });

  it('hướng right và kẹp; sai kiểu thì giữ', () => {
    const { ap, root } = make([
      eb('clip', b('c', 'geometry.clipLevel', 'LV', { direction: 'right' })),
    ]);
    ap.update([good('LV', 250)]);
    flush();
    expect(root.querySelector('clipPath rect')!.getAttribute('width')).toBe('100');
    ap.update([good('LV', 'abc')]);
    flush();
    expect(root.querySelector('clipPath rect')!.getAttribute('width')).toBe('100');
  });

  it('levelPercent trên phần tử không phải rect: bỏ qua, cảnh báo một lần', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { ap, els } = make([eb('plain', b('l', 'geometry.levelPercent', 'LV'))]);
    ap.update([good('LV', 10)]);
    flush();
    ap.update([good('LV', 20)]);
    flush();
    expect(els.get('plain')!.getAttribute('height')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('DomApplier 0.4: blink', () => {
  const bl = (extra: object = {}) => b('k', 'effect.blink', 'B', extra);

  it('bật: hoạt ảnh opacity hai trạng thái, chung pha theo now(); tắt: hủy và trả giá trị gốc', () => {
    const { ap, els } = make([eb('blink', bl()), eb('blink2', bl({ minOpacity: 0.5 }))]);
    ap.update([good('B', true)]);
    flush();
    expect(anims).toHaveLength(2);
    expect(anims[0]!.keyframes).toEqual([{ opacity: '1' }, { opacity: '0.2' }]);
    expect(anims[1]!.keyframes).toEqual([{ opacity: '1' }, { opacity: '0.5' }]);
    expect(anims[0]!.options).toMatchObject({ duration: 1000, iterations: Infinity });
    expect(String(anims[0]!.options.easing)).toContain('steps');
    expect(anims[0]!.startTime).toBe(12000);
    expect(anims[1]!.startTime).toBe(12000);
    expect(ap.animationCount()).toBe(2);
    ap.update([good('B', 0)]);
    flush();
    expect(anims.every((a) => a.playState === 'idle')).toBe(true);
    expect(ap.animationCount()).toBe(0);
    expect((els.get('blink') as SVGElement).style.getPropertyValue('opacity')).toBe('');
  });

  it('period riêng và mode fill', () => {
    const { ap } = make([eb('blink', bl({ period: 500, mode: 'fill', color: '#ff0000' }))]);
    ap.update([good('B', 1)]);
    flush();
    expect(anims[0]!.options.duration).toBe(500);
    expect(anims[0]!.startTime).toBe(12000);
    const kf = anims[0]!.keyframes as Array<Record<string, string>>;
    expect(kf[1]!.fill).toBe('#ff0000');
  });

  it('chất lượng xấu: tắt; tab ẩn: tạm dừng, hiện lại: chạy lại', () => {
    let hidden = false;
    const { ap } = make([eb('blink', bl())], { isHidden: () => hidden });
    ap.update([good('B', true)]);
    flush();
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(anims[0]!.playState).toBe('paused');
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(anims[0]!.playState).toBe('running');
    ap.update([{ id: 'B', value: true, quality: 'BAD' }]);
    flush();
    expect(anims[0]!.playState).toBe('idle');
  });

  it('reducedMotion: không hoạt ảnh; bật = opacity 1; tắt = trả về gốc', () => {
    const { ap, els } = make([eb('blink', bl())], { reducedMotion: () => true });
    ap.update([good('B', true)]);
    flush();
    expect(anims).toHaveLength(0);
    expect((els.get('blink') as SVGElement).style.getPropertyValue('opacity')).toBe('1');
    ap.update([good('B', false)]);
    flush();
    expect((els.get('blink') as SVGElement).style.getPropertyValue('opacity')).toBe('');
  });
});

describe('DomApplier 0.4: flow', () => {
  const fl = (extra: object = {}) => b('f', 'effect.flow', 'F', extra);

  it('BOOL true: dasharray mặc định, hoạt ảnh strokeDashoffset 0 → -P, tốc độ 1', () => {
    const { ap, els } = make([eb('pipe', fl())]);
    ap.update([good('F', true)]);
    flush();
    expect((els.get('pipe') as SVGElement).style.getPropertyValue('stroke-dasharray')).toBe('12 8');
    const a = anims[0]!;
    expect(a.keyframes).toEqual([{ strokeDashoffset: '0' }, { strokeDashoffset: '-20' }]);
    expect(a.options).toMatchObject({
      iterations: Infinity,
      easing: 'linear',
      direction: 'normal',
    });
    expect(a.options.duration).toBeCloseTo(333.333, 2);
    expect(a.playbackRate).toBe(1);
  });

  it('số: updatePlaybackRate theo tốc độ; 0 đứng yên; kẹp 300', () => {
    const { ap } = make([eb('pipe', fl({ dash: '10 5 5' }))]);
    ap.update([good('F', 120)]);
    flush();
    const a = anims[0]!;
    expect(a.keyframes).toEqual([{ strokeDashoffset: '0' }, { strokeDashoffset: '-40' }]); // 10+5+5 lẻ nên nhân đôi
    expect(a.playbackRate).toBe(2);
    ap.update([good('F', 9999)]);
    flush();
    expect(a.playbackRate).toBe(5);
    ap.update([good('F', 0)]);
    flush();
    expect(a.playState).toBe('paused');
    expect(anims).toHaveLength(1);
  });

  it('byValueSign: giá trị âm đảo chiều; reverse cố định', () => {
    const { ap } = make([eb('pipe', fl({ byValueSign: true }))]);
    ap.update([good('F', 60)]);
    flush();
    expect(anims[0]!.options.direction).toBe('normal');
    ap.update([good('F', -60)]);
    flush();
    expect(anims[0]!.options.direction).toBe('reverse');
    expect(anims[0]!.playbackRate).toBe(1);
    const r = make([eb('pipe', fl({ reverse: true }))]);
    r.ap.update([good('F', 60)]);
    flush();
    expect(anims.at(-1)!.options.direction).toBe('reverse');
  });

  it('reducedMotion: đứng yên nhưng vẫn đặt dasharray; chất lượng xấu dừng', () => {
    const { ap, els } = make([eb('pipe', fl())], { reducedMotion: () => true });
    ap.update([good('F', true)]);
    flush();
    expect(anims).toHaveLength(0);
    expect((els.get('pipe') as SVGElement).style.getPropertyValue('stroke-dasharray')).toBe('12 8');
    ap.dispose();
    anims.length = 0;
    const r = make([eb('pipe', fl())]);
    r.ap.update([good('F', true)]);
    flush();
    r.ap.update([{ id: 'F', value: true, quality: 'BAD' }]);
    flush();
    expect(anims[0]!.playState).toBe('paused');
  });

  it('dispose hủy mọi hoạt ảnh và animationCount', () => {
    const { ap } = make([eb('pipe', fl()), eb('blink', b('k', 'effect.blink', 'B'))]);
    ap.update([good('F', true), good('B', true)]);
    flush();
    expect(ap.animationCount()).toBe(2);
    ap.dispose();
    expect(anims.every((a) => a.playState === 'idle')).toBe(true);
    expect(ap.animationCount()).toBe(0);
  });
});

describe('DomApplier 0.4: đích khác', () => {
  it('visibility hidden đặt pointer-events none và tabindex -1; hiện lại khôi phục', () => {
    const { ap, els } = make([eb('vis', b('v', 'style.visibility', 'V'))]);
    const el = els.get('vis') as SVGElement;
    ap.update([good('V', false)]);
    flush();
    expect(el.style.getPropertyValue('visibility')).toBe('hidden');
    expect(el.style.getPropertyValue('pointer-events')).toBe('none');
    expect(el.getAttribute('tabindex')).toBe('-1');
    ap.update([good('V', true)]);
    flush();
    expect(el.style.getPropertyValue('visibility')).toBe('visible');
    expect(el.style.getPropertyValue('pointer-events')).toBe('');
    expect(el.getAttribute('tabindex')).toBe('0');
  });

  it('text.content với tagUnits (unitFromTag) và format', () => {
    const { ap, els } = make(
      [eb('txt', b('t', 'text.content', 'T', { format: { decimals: 1, unitFromTag: true } }))],
      { tagUnits: { T: 'bar' } },
    );
    ap.update([good('T', 3.14159)]);
    flush();
    expect(els.get('txt')!.textContent).toBe('3.1 bar');
  });

  it('chất lượng xấu mặc định: dời và co giãn giữ, text --', () => {
    const { ap, els } = make([
      eb('plain', b('a', 'transform.translateX', 'TX')),
      eb('txt', b('t', 'text.content', 'T')),
    ]);
    const w = transformWrites(els.get('plain')!);
    ap.update([good('TX', 5), good('T', 1)]);
    flush();
    ap.update([
      { id: 'TX', value: 5, quality: 'BAD' },
      { id: 'T', value: 1, quality: 'BAD' },
    ]);
    flush();
    expect(w.all()).toHaveLength(1);
    expect(els.get('txt')!.textContent).toBe('--');
  });
});
