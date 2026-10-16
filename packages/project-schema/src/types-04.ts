// Định dạng 0.4 (specs/008-svg-import-binding/data-model.md, contracts/project-format-0.4.md, binding-animation.md,
// svg-events.md). Màn hình 0.4 có cấu trúc như 0.3 (`ScreenModel`); khác ở binding: 13 đích, phép biến đổi
// `rangeMap`, tham số theo đích và sự kiện `events.click` của phần tử.
import type { ScreenModel, Project03 } from './types-03.ts';
import type { ConnectionsConfig, TagListV1, ValueTableDoc, WatchTableDoc } from './types-02.ts';
import type { LoggingConfig, Scalar } from './types.ts';

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
  | 'effect.flow'
  /** Schema nhận nhưng chưa hỗ trợ: luật báo E_TARGET_UNSUPPORTED. */
  | 'component.state';

export interface RangeEntry04 {
  from?: number;
  to?: number;
  value: Scalar;
}

export type Transform04 =
  | { kind: 'direct' }
  | { kind: 'discreteMap'; cases: Array<{ equals: Scalar; value: Scalar }>; default?: Scalar }
  | {
      kind: 'linearScale';
      inMin: number;
      inMax: number;
      outMin: number;
      outMax: number;
      clamp?: boolean;
    }
  | { kind: 'valueTable'; table?: string; output: 'text' | 'color' }
  | { kind: 'rangeMap'; ranges: RangeEntry04[]; default?: Scalar };

export interface Binding04 {
  id: string;
  target: Target04;
  source: { type: 'tag'; tagId: string };
  transform: Transform04;
  onBadQuality?: { mode: 'hold' | 'override'; value?: Scalar };
  // tham số theo đích (miền do luật E_BIND_PARAM kiểm)
  /** `transform.rotate`. */
  animation?: 'spin';
  /** `animation: 'spin'`, `effect.flow`. */
  reverse?: boolean;
  /** `transform.rotate`, `transform.scale`; mặc định [0.5, 0.5]. */
  pivot?: [number, number];
  /** `transform.scale`; mặc định `xy`. */
  axis?: 'xy' | 'x' | 'y';
  /** `geometry.levelPercent`, `geometry.clipLevel`; mặc định `up`. */
  direction?: 'up' | 'down' | 'left' | 'right';
  /** `text.content`. */
  format?: { decimals?: number; prefix?: string; suffix?: string; unitFromTag?: boolean };
  /** `effect.blink`. */
  period?: number;
  mode?: 'opacity' | 'fill' | 'stroke';
  minOpacity?: number;
  color?: string;
  /** `effect.flow`. */
  dash?: string;
  speed?: number;
  byValueSign?: boolean;
}

/** Hành động của sự kiện `click` (svg-events.md §2). `tag`, `confirm`, `minRole`, `label` tùy hành động. */
export type ElementAction =
  | ({ action: 'write'; tag: string; value: boolean | number | string } & ActionExtras)
  | ({ action: 'toggle'; tag: string } & ActionExtras)
  | ({ action: 'pulse'; tag: string; value: boolean; durationMs: number } & ActionExtras)
  | { action: 'navigate'; screen: string; label?: string }
  | { action: 'popup'; screen: string; label?: string; args?: Record<string, string> }
  | { action: 'closePopup'; label?: string };
export type ElementActionName = ElementAction['action'];

export interface ActionExtras {
  confirm?: 'always' | 'none';
  minRole?: 'operator' | 'engineer' | 'administrator';
  label?: string;
}

/** Một phần tử của file binding 0.4: cần ít nhất một trong `bindings` (1-16), `events`. */
export interface ElementEntry04 {
  elementUid: string;
  bindings?: Binding04[];
  events?: { click?: ElementAction };
}

export interface BindingSet04 {
  schemaVersion: string;
  screenId: string;
  itemId?: string;
  elements: ElementEntry04[];
}

export interface LoadedScreen04 {
  screen: ScreenModel;
  /** Binding theo `id` item `svg`. */
  bindings: Record<string, BindingSet04>;
}

/** Project 0.4 đã nạp và qua kiểm tra. */
export interface LoadedProject04 {
  project: Project03;
  tags: TagListV1;
  connections?: ConnectionsConfig;
  valueTables: Record<string, ValueTableDoc>;
  watchTables: Record<string, WatchTableDoc>;
  screens: Record<string, LoadedScreen04>;
  logging?: LoggingConfig;
}
