// @vitest-environment jsdom
// Rà code 008: blink tắt không được xóa giá trị inline do binding khác (style.fill/style.opacity) đã ghi.
import { beforeEach, describe, expect, it } from 'vitest';
import { DomApplier } from './applier.ts';
import type { Binding04 } from './types04.ts';

const NS = 'http://www.w3.org/2000/svg';
const b = (id: string, target: string, tag: string, extra: object = {}): Binding04 =>
  ({
    id,
    target,
    source: { type: 'tag', tagId: tag },
    transform: { kind: 'direct' },
    ...extra,
  }) as Binding04;

let frames: Array<() => void>;
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

beforeEach(() => {
  frames = [];
  (Element.prototype as unknown as { animate: unknown }).animate = function () {
    return {
      playState: 'running',
      playbackRate: 1,
      startTime: 0,
      effect: { setKeyframes() {}, updateTiming() {} },
      updatePlaybackRate() {},
      play() {},
      pause() {},
      cancel() {},
    };
  };
});

function run(bindings: Binding04[], reduced: boolean) {
  const el = document.createElementNS(NS, 'rect');
  const ap = new DomApplier({
    elements: new Map([['e', el]]),
    bindings: [{ elementUid: 'e', bindings }] as never,
    raf: (cb) => frames.push(cb),
    reducedMotion: () => reduced,
    now: () => 0,
  });
  return { ap, style: (el as SVGElement).style };
}

describe('rà code 008: blink tắt giữ giá trị của binding khác', () => {
  for (const reduced of [false, true]) {
    it(`mode fill + style.fill (giảm chuyển động=${reduced})`, () => {
      const { ap, style } = run(
        [
          b('f', 'style.fill', 'A'),
          b('k', 'effect.blink', 'B', { mode: 'fill', color: '#ff0000' }),
        ],
        reduced,
      );
      ap.update([good('A', '#00ff00')]);
      flush();
      ap.update([good('B', 1)]);
      flush();
      ap.update([good('B', 0)]);
      flush();
      expect(style.getPropertyValue('fill')).toBe('rgb(0, 255, 0)'); // jsdom chuẩn hóa #00ff00
    });
    it(`mode opacity + style.opacity (giảm chuyển động=${reduced})`, () => {
      const { ap, style } = run([b('o', 'style.opacity', 'A'), b('k', 'effect.blink', 'B')], reduced);
      ap.update([good('A', 0.5)]);
      flush();
      ap.update([good('B', 1)]);
      flush();
      ap.update([good('B', 0)]);
      flush();
      expect(style.getPropertyValue('opacity')).toBe('0.5');
    });
  }
});
