// Quay liên tục (contract binding-animation §3 mục 4): hai khung hình cùng cấu trúc, 1.000 ms/vòng.
import { buildTransform, type TransformState } from './transform-state.ts';

export const SPIN_DURATION = 1000;

export interface SpinFrames {
  frames: Array<{ transform: string }>;
  /** Khóa so sánh để biết có phải `setKeyframes`. */
  key: string;
}

export function spinFrames(st: TransformState, reverse: boolean): SpinFrames {
  const a = buildTransform(st, '0deg');
  const b = buildTransform(st, reverse ? '-360deg' : '360deg');
  return { frames: [{ transform: a }, { transform: b }], key: `${a}|${b}` };
}
