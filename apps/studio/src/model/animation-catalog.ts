// Danh sách 13 mục động hóa của inspector Gắn Tag (feature 008, T068; contract studio-svg-editor §5, binding-animation §2).
// Dữ liệu và hàm thuần: đích, loại phần tử hợp, kiểu Tag hợp, phép biến đổi hợp, đặc tả tham số và giá trị mặc định lấy từ
// Tag. Không chuỗi hiển thị (nhãn tra i18n theo khóa `svg.row.<id>`). Luật cuối cùng vẫn là rules-04 của @mat/project-schema;
// danh sách này chỉ để giao diện không cho đặt thứ chắc chắn sai.
import type { Binding04, Scalar, Target04, Transform04 } from '@mat/project-schema';
import { t } from '../i18n/index.ts';
import type { TagInfo } from './screen-catalog.ts';

/** Loại phần tử SVG theo thẻ: `line` = đường, đường gấp khúc, `path` chỉ có nét. */
export type ElementKind = 'text' | 'rect' | 'shape' | 'line' | 'group';
export type TagClass04 = 'number' | 'bool' | 'string';
export type TransformKind04 = Transform04['kind'];

export type RowId =
  | 'text'
  | 'fill'
  | 'stroke'
  | 'level'
  | 'rotate'
  | 'spin'
  | 'translateX'
  | 'translateY'
  | 'scale'
  | 'blink'
  | 'flow'
  | 'visibility'
  | 'opacity';

export type ParamSpec =
  | { key: string; kind: 'int'; min: number; max: number; default?: number }
  | { key: string; kind: 'number'; min: number; max: number; default?: number }
  | { key: string; kind: 'bool'; default?: boolean }
  | { key: string; kind: 'enum'; options: readonly string[]; default?: string }
  | { key: string; kind: 'string'; maxLength: number; default?: string }
  | { key: string; kind: 'color' }
  | { key: string; kind: 'pivot' };

export interface AnimationRow {
  id: RowId;
  /** Đích mặc định (mục `level` đổi theo loại phần tử: xem `targetOf`). */
  target: Target04;
  /** Loại phần tử hợp. */
  kinds: readonly ElementKind[];
  /** Kiểu Tag hợp. */
  tagClasses: readonly TagClass04[];
  /** Phép biến đổi hiển thị thành nút (theo thứ tự). */
  transforms: readonly TransformKind04[];
  params: readonly ParamSpec[];
  /** Nhóm đích (một binding mỗi nhóm trên một phần tử). */
  group: string;
}

const ANY: readonly ElementKind[] = ['text', 'rect', 'shape', 'line', 'group'];
const PAINT: readonly ElementKind[] = ['text', 'rect', 'shape', 'group'];
const NUM: readonly TagClass04[] = ['number'];
const BOOL_NUM: readonly TagClass04[] = ['number', 'bool'];
const ALL_TAG: readonly TagClass04[] = ['number', 'bool', 'string'];

export const ANIMATION_ROWS: readonly AnimationRow[] = [
  {
    id: 'text',
    target: 'text.content',
    group: 'text',
    kinds: ['text'],
    tagClasses: ALL_TAG,
    transforms: ['direct', 'valueTable', 'rangeMap', 'discreteMap'],
    params: [
      { key: 'format.decimals', kind: 'int', min: 0, max: 6 },
      { key: 'format.prefix', kind: 'string', maxLength: 16 },
      { key: 'format.suffix', kind: 'string', maxLength: 16 },
      { key: 'format.unitFromTag', kind: 'bool' },
    ],
  },
  {
    id: 'fill',
    target: 'style.fill',
    group: 'fill',
    kinds: PAINT,
    tagClasses: ALL_TAG,
    transforms: ['discreteMap', 'valueTable', 'rangeMap'],
    params: [],
  },
  {
    id: 'stroke',
    target: 'style.stroke',
    group: 'stroke',
    kinds: PAINT,
    tagClasses: ALL_TAG,
    transforms: ['discreteMap', 'valueTable', 'rangeMap'],
    params: [],
  },
  {
    id: 'level',
    target: 'geometry.clipLevel',
    group: 'level',
    kinds: ['rect', 'shape', 'group'],
    tagClasses: NUM,
    transforms: ['direct', 'linearScale'],
    params: [
      { key: 'direction', kind: 'enum', options: ['up', 'down', 'left', 'right'], default: 'up' },
    ],
  },
  {
    id: 'rotate',
    target: 'transform.rotate',
    group: 'rotate',
    kinds: ANY,
    tagClasses: NUM,
    transforms: ['direct', 'linearScale', 'rangeMap'],
    params: [{ key: 'pivot', kind: 'pivot' }],
  },
  {
    id: 'spin',
    target: 'transform.rotate',
    group: 'rotate',
    kinds: ANY,
    tagClasses: BOOL_NUM,
    transforms: ['direct', 'linearScale', 'discreteMap'],
    params: [
      { key: 'pivot', kind: 'pivot' },
      { key: 'reverse', kind: 'bool', default: false },
    ],
  },
  {
    id: 'translateX',
    target: 'transform.translateX',
    group: 'translateX',
    kinds: ANY,
    tagClasses: NUM,
    transforms: ['direct', 'linearScale', 'rangeMap'],
    params: [],
  },
  {
    id: 'translateY',
    target: 'transform.translateY',
    group: 'translateY',
    kinds: ANY,
    tagClasses: NUM,
    transforms: ['direct', 'linearScale', 'rangeMap'],
    params: [],
  },
  {
    id: 'scale',
    target: 'transform.scale',
    group: 'scale',
    kinds: ANY,
    tagClasses: NUM,
    transforms: ['direct', 'linearScale', 'rangeMap'],
    params: [
      { key: 'axis', kind: 'enum', options: ['xy', 'x', 'y'], default: 'xy' },
      { key: 'pivot', kind: 'pivot' },
    ],
  },
  {
    id: 'blink',
    target: 'effect.blink',
    group: 'blink',
    kinds: ANY,
    tagClasses: BOOL_NUM,
    transforms: ['direct', 'discreteMap', 'rangeMap'],
    params: [
      { key: 'period', kind: 'int', min: 400, max: 5000, default: 1000 },
      { key: 'mode', kind: 'enum', options: ['opacity', 'fill', 'stroke'], default: 'opacity' },
      { key: 'minOpacity', kind: 'number', min: 0, max: 0.9, default: 0.2 },
      { key: 'color', kind: 'color' },
    ],
  },
  {
    id: 'flow',
    target: 'effect.flow',
    group: 'flow',
    kinds: ['line', 'shape', 'rect'],
    tagClasses: BOOL_NUM,
    transforms: ['direct', 'linearScale', 'discreteMap'],
    params: [
      { key: 'dash', kind: 'string', maxLength: 64, default: '12 8' },
      { key: 'speed', kind: 'number', min: 0, max: 300, default: 60 },
      { key: 'reverse', kind: 'bool', default: false },
      { key: 'byValueSign', kind: 'bool', default: false },
    ],
  },
  {
    id: 'visibility',
    target: 'style.visibility',
    group: 'visibility',
    kinds: ANY,
    tagClasses: BOOL_NUM,
    transforms: ['direct', 'discreteMap', 'rangeMap'],
    params: [],
  },
  {
    id: 'opacity',
    target: 'style.opacity',
    group: 'opacity',
    kinds: ANY,
    tagClasses: NUM,
    transforms: ['direct', 'linearScale'],
    params: [],
  },
];

const BY_ID = new Map<RowId, AnimationRow>(ANIMATION_ROWS.map((r) => [r.id, r]));

export const rowById = (id: string): AnimationRow | undefined => BY_ID.get(id as RowId);

/** Mục của một binding đã có (`transform.rotate` + `animation: spin` là mục `spin`). */
export function rowOfBinding(b: Pick<Binding04, 'target' | 'animation'>): AnimationRow | undefined {
  if (b.target === 'transform.rotate') return BY_ID.get(b.animation === 'spin' ? 'spin' : 'rotate');
  const id =
    b.target === 'geometry.levelPercent' || b.target === 'geometry.clipLevel' ? 'level' : null;
  return id !== null ? BY_ID.get('level') : ANIMATION_ROWS.find((r) => r.target === b.target);
}

/** Đích thật của mục: mức chất lỏng dùng `levelPercent` cho `rect`, `clipLevel` cho hình khác. */
export function targetOf(row: AnimationRow, kind: ElementKind): Target04 {
  return row.id === 'level' && kind === 'rect' ? 'geometry.levelPercent' : row.target;
}

export const rowAcceptsKind = (row: AnimationRow, kind: ElementKind): boolean =>
  row.kinds.includes(kind);

export function tagClassOf04(type: string): TagClass04 {
  return type === 'BOOL' ? 'bool' : type === 'STRING' ? 'string' : 'number';
}

export const rowAcceptsTag = (row: AnimationRow, tag: Pick<TagInfo, 'type'>): boolean =>
  row.tagClasses.includes(tagClassOf04(tag.type));

/** Phép biến đổi dùng được cho Tag này ở mục này (bỏ phép cần số cho Tag chữ, bảng giá trị cho Tag chữ...). */
export function transformsFor(
  row: AnimationRow,
  tag: Pick<TagInfo, 'type'> | undefined,
): TransformKind04[] {
  const c = tag === undefined ? null : tagClassOf04(tag.type);
  return row.transforms.filter((k) => {
    if (c === null) return true;
    if (k === 'linearScale' || k === 'rangeMap') return c === 'number';
    if (k === 'valueTable') return c !== 'string';
    if (k === 'direct') return directOk(row, c);
    return true; // discreteMap
  });
}

function directOk(row: AnimationRow, c: TagClass04): boolean {
  switch (row.id) {
    case 'text':
      return true;
    case 'fill':
    case 'stroke':
      return c === 'string';
    case 'visibility':
      return c === 'bool' || c === 'string';
    case 'spin':
    case 'blink':
    case 'flow':
      return c !== 'string';
    default:
      return c === 'number';
  }
}

/** Lý do dòng không dùng được (để làm mờ kèm lý do); `null` khi dùng được. */
export type RowBlock = 'element-kind' | 'tag-type';
export function rowBlock(
  row: AnimationRow,
  kind: ElementKind,
  tag?: Pick<TagInfo, 'type'>,
): RowBlock | null {
  if (!rowAcceptsKind(row, kind)) return 'element-kind';
  if (tag !== undefined && !rowAcceptsTag(row, tag)) return 'tag-type';
  return null;
}

// ---- Mặc định ----

/** Khoảng ra mặc định của phép tuyến tính theo mục. */
export const DEFAULT_OUT: Readonly<Record<RowId, readonly [number, number]>> = {
  text: [0, 100],
  fill: [0, 1],
  stroke: [0, 1],
  level: [0, 100],
  rotate: [0, 360],
  spin: [0, 60],
  translateX: [0, 100],
  translateY: [0, 100],
  scale: [0.01, 10],
  blink: [0, 1],
  flow: [0, 60],
  visibility: [0, 1],
  opacity: [0, 1],
};

/** Khoảng vào của Tag: `limits`, rồi `min`/`max`, rồi 0–100. */
export function tagRange(
  tag: Pick<TagInfo, 'min' | 'max' | 'limits'> | undefined,
): [number, number] {
  const lo = tag?.limits?.min ?? tag?.min ?? 0;
  const hi = tag?.limits?.max ?? tag?.max ?? 100;
  return hi === lo ? [lo, lo + 1] : [lo, hi];
}

const COLOR_ON = '#43a047';
const COLOR_OFF = '#9e9e9e';

/** Giá trị ra mặc định của hai trạng thái (bật, tắt) cho phép rời rạc và khoảng. */
function stateValues(row: AnimationRow): [Scalar, Scalar] {
  switch (row.id) {
    case 'text':
      return [t('svg.on'), t('svg.off')];
    case 'fill':
    case 'stroke':
      return [COLOR_ON, COLOR_OFF];
    case 'visibility':
      return ['visible', 'hidden'];
    case 'opacity':
      return [1, 0.2];
    case 'rotate':
      return [90, 0];
    case 'spin':
      return [60, 0];
    case 'translateX':
    case 'translateY':
      return [10, 0];
    case 'scale':
      return [1.5, 1];
    case 'flow':
      return [60, 0];
    case 'level':
      return [100, 0];
    default:
      return [true, false];
  }
}

/** Phép biến đổi mặc định của `kind` cho Tag (tham số lấy từ Tag: khoảng vào, bảng giá trị, kiểu). */
export function defaultTransform(
  row: AnimationRow,
  kind: TransformKind04,
  tag: TagInfo | undefined,
): Transform04 {
  const [on, off] = stateValues(row);
  switch (kind) {
    case 'direct':
      return { kind: 'direct' };
    case 'linearScale': {
      const [inMin, inMax] = tagRange(tag);
      const [outMin, outMax] = DEFAULT_OUT[row.id];
      return { kind: 'linearScale', inMin, inMax, outMin, outMax, clamp: true };
    }
    case 'valueTable':
      return { kind: 'valueTable', output: row.id === 'text' ? 'text' : 'color' };
    case 'rangeMap': {
      const [lo, hi] = tagRange(tag);
      const mid = (lo + hi) / 2;
      return {
        kind: 'rangeMap',
        ranges: [
          { to: mid, value: off },
          { from: mid, value: on },
        ],
        default: off,
      };
    }
    case 'discreteMap': {
      const bool = tag !== undefined && tagClassOf04(tag.type) === 'bool';
      return bool
        ? {
            kind: 'discreteMap',
            cases: [
              { equals: true, value: on },
              { equals: false, value: off },
            ],
            default: off,
          }
        : { kind: 'discreteMap', cases: [], default: off };
    }
  }
}

/** Tham số mặc định của mục khi gắn Tag (chỉ tham số có giá trị mặc định lấy từ Tag). */
export function defaultParams(row: AnimationRow, tag: TagInfo | undefined): Partial<Binding04> {
  if (row.id === 'text' && tag !== undefined && tagClassOf04(tag.type) === 'number') {
    const format: NonNullable<Binding04['format']> = { decimals: 1 };
    if (tag.unit !== undefined && tag.unit !== '') format.unitFromTag = true;
    return { format };
  }
  if (row.id === 'spin') return { animation: 'spin' };
  return {};
}

/** Phép biến đổi mặc định chọn trước khi người dùng bấm nút: phần tử đầu của `transformsFor`. */
export function firstTransform(
  row: AnimationRow,
  tag: TagInfo | undefined,
): TransformKind04 | null {
  return transformsFor(row, tag)[0] ?? null;
}

/**
 * Binding mới (chưa có `id`) cho mục `rowId` trên phần tử loại `kind` với `tag`; `transformKind` vắng thì phép đầu
 * hợp Tag. Trả `null` khi mục lạ hoặc không có phép nào hợp.
 */
export function newBinding(
  rowId: RowId,
  kind: ElementKind,
  tag: TagInfo,
  transformKind?: TransformKind04,
): Omit<Binding04, 'id'> | null {
  const row = BY_ID.get(rowId);
  if (row === undefined) return null;
  const k = transformKind ?? firstTransform(row, tag);
  if (k === null) return null;
  return {
    target: targetOf(row, kind),
    source: { type: 'tag', tagId: tag.id },
    transform: defaultTransform(row, k, tag),
    ...defaultParams(row, tag),
  };
}
