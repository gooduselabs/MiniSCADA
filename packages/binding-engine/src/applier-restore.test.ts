// @vitest-environment jsdom
// DomApplier: `restoreOnDispose` trả phần tử về đúng trạng thái lúc nhận binding (feature 008, T077, SC-018): Studio dựng lại
// binding trên cùng DOM đã dựng (gắn Tag, hoàn tác) thay vì dựng lại cả SVG 20.000 phần tử (≈ 340 ms).
import type { Binding04 } from './types04.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { DomApplier } from './applier.ts';

const NS = 'http://www.w3.org/2000/svg';

class FakeAnim {
  playState = 'running';
  playbackRate = 1;
  startTime: number | null = null;
  cancelled = false;
  effect = { setKeyframes: () => undefined, updateTiming: () => undefined };
  updatePlaybackRate(r: number) {
    this.playbackRate = r;
  }
  play() {}
  pause() {}
  cancel() {
    this.cancelled = true;
  }
}

const b = (id: string, target: string, tag: string, extra: object = {}): Binding04 =>
  ({
    id,
    target,
    source: { type: 'tag', tagId: tag },
    transform: { kind: 'direct' },
    ...extra,
  }) as Binding04;
const good = (id: string, value: boolean | number | string) => ({
  id,
  value,
  quality: 'GOOD' as const,
});

let frames: Array<() => void> = [];
const raf = (cb: () => void) => {
  frames.push(cb);
  return frames.length;
};
const flush = () => {
  const f = frames;
  frames = [];
  f.forEach((cb) => cb());
};

function scene() {
  const root = document.createElementNS(NS, 'svg');
  const mk = (tag: string, uid: string, attrs: Record<string, string>, text?: string) => {
    const el = document.createElementNS(NS, tag);
    el.setAttribute('data-mat-uid', uid);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    root.append(el);
    return el;
  };
  const els = new Map<string, Element>([
    [
      'box',
      mk('rect', 'box', {
        x: '1',
        y: '2',
        width: '30',
        height: '40',
        fill: '#123456',
        style: 'stroke:#abc',
      }),
    ],
    ['txt', mk('text', 'txt', { x: '5' }, 'gốc')],
    ['lvl', mk('rect', 'lvl', { x: '0', y: '0', width: '10', height: '100' })],
    ['vis', mk('rect', 'vis', { tabindex: '0' })],
    ['spin', mk('g', 'spin', { transform: 'translate(10 20)' })],
    ['pipe', mk('path', 'pipe', { d: 'M0 0 L 100 0', stroke: '#fff' })],
  ]);
  return { root, els };
}

beforeEach(() => {
  frames = [];
  (Element.prototype as unknown as { animate: unknown }).animate = () => new FakeAnim();
});

describe('DomApplier restoreOnDispose', () => {
  it('trả style, thuộc tính, nội dung chữ và tabindex về như lúc nhận binding', () => {
    const { root, els } = scene();
    const before = root.outerHTML;
    const ap = new DomApplier({
      elements: els,
      bindings: [
        { elementUid: 'box', bindings: [b('f', 'style.fill', 'F'), b('o', 'style.opacity', 'O')] },
        { elementUid: 'txt', bindings: [b('t', 'text.content', 'T')] },
        { elementUid: 'lvl', bindings: [b('l', 'geometry.levelPercent', 'L')] },
        { elementUid: 'vis', bindings: [b('v', 'style.visibility', 'V')] },
        { elementUid: 'spin', bindings: [b('s', 'transform.translateX', 'S')] },
        { elementUid: 'pipe', bindings: [b('p', 'effect.flow', 'P')] },
      ] as never,
      raf,
      measure: () => ({ x: 0, y: 0, width: 10, height: 100 }),
      reducedMotion: () => false,
      now: () => 1,
      restoreOnDispose: true,
    });
    ap.update([
      good('F', '#ff0000'),
      good('O', 0.4),
      good('T', 'đang chạy'),
      good('L', 50),
      good('V', false),
      good('S', 7),
      good('P', true),
    ]);
    flush();
    expect(root.outerHTML).not.toBe(before);
    ap.dispose();
    expect(root.outerHTML).toBe(before);
  });

  it('mặc định (không đặt tùy chọn): dispose không đụng DOM như trước', () => {
    const { root, els } = scene();
    const ap = new DomApplier({
      elements: els,
      bindings: [{ elementUid: 'txt', bindings: [b('t', 'text.content', 'T')] }] as never,
      raf,
      reducedMotion: () => false,
      now: () => 1,
    });
    ap.update([good('T', 'mới')]);
    flush();
    const after = root.outerHTML;
    ap.dispose();
    expect(root.outerHTML).toBe(after);
  });

  it('dựng lại bộ áp khác trên cùng DOM sau khi khôi phục: binding cũ không để lại dấu vết', () => {
    const { root, els } = scene();
    const before = root.outerHTML;
    const first = new DomApplier({
      elements: els,
      bindings: [{ elementUid: 'box', bindings: [b('f', 'style.fill', 'F')] }] as never,
      raf,
      reducedMotion: () => false,
      now: () => 1,
      restoreOnDispose: true,
    });
    first.update([good('F', '#00ff00')]);
    flush();
    first.dispose();
    const second = new DomApplier({
      elements: els,
      bindings: [{ elementUid: 'txt', bindings: [b('t', 'text.content', 'T')] }] as never,
      raf,
      reducedMotion: () => false,
      now: () => 1,
      restoreOnDispose: true,
    });
    second.update([good('T', 'x')]);
    flush();
    expect(els.get('box')!.getAttribute('style')).toBe('stroke:#abc');
    second.dispose();
    expect(root.outerHTML).toBe(before);
  });
});
