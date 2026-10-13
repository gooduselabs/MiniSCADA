// Kiểu binding 0.4 (contract binding-animation.md §1). TẠM THỜI định nghĩa cục bộ vì
// @mat/project-schema chưa xuất `Binding04` (task T013 làm song song). Khi T013 xong, thay bằng
// `import type { Binding04, Target04, Transform04 } from '@mat/project-schema'` và xóa file này.
export type Scalar04 = boolean | number | string;

export type Target04 =
  | 'style.fill'
  | 'style.stroke'
  | 'style.opacity'
  | 'style.visibility'
  | 'text.content'
  | 'transform.rotate'
  | 'transform.translateX'
  | 'transform.translateY'
  | 'transform.scale'
  | 'geometry.levelPercent'
  | 'geometry.clipLevel'
  | 'effect.blink'
  | 'effect.flow';

export interface RangeMapRange {
  from?: number;
  to?: number;
  value: Scalar04;
}

export type Transform04 =
  | { kind: 'direct' }
  | { kind: 'discreteMap'; cases: Array<{ equals: Scalar04; value: Scalar04 }>; default?: Scalar04 }
  | {
      kind: 'linearScale';
      inMin: number;
      inMax: number;
      outMin: number;
      outMax: number;
      clamp?: boolean;
    }
  | { kind: 'valueTable'; table?: string; output: 'text' | 'color' }
  | { kind: 'rangeMap'; ranges: RangeMapRange[]; default?: Scalar04 };

export interface Binding04 {
  id: string;
  target: Target04;
  source: { type: 'tag'; tagId: string };
  transform: Transform04;
  onBadQuality?: { mode: 'hold' | 'override'; value?: Scalar04 };
  animation?: 'spin';
  reverse?: boolean;
  pivot?: [number, number];
  axis?: 'xy' | 'x' | 'y';
  direction?: 'up' | 'down' | 'left' | 'right';
  format?: { decimals?: number; prefix?: string; suffix?: string; unitFromTag?: boolean };
  period?: number;
  mode?: 'opacity' | 'fill' | 'stroke';
  minOpacity?: number;
  color?: string;
  dash?: string;
  speed?: number;
  byValueSign?: boolean;
}
