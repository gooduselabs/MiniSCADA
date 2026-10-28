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
    // Đường, đường gấp khúc, path chỉ có nét: màu viền là màu duy nhất của chúng (contract binding-animation §2: đích hợp "mọi").
    kinds: ANY,
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

const COLOR_ON = '#2e9e44';
const COLOR_OFF = '#9aa5b1';
/** Ba màu của phép Khoảng cho màu: bình thường, cảnh báo, nguy hiểm. */
const COLOR_RANGES = ['#2e9e44', '#f39c12', '#d64541'] as const;

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

/**
 * Phép biến đổi mặc định của `kind` cho Tag (tham số lấy từ Tag: khoảng vào, bảng giá trị, kiểu). Kết quả luôn hợp
 * schema và luật rules-04 ngay khi chọn (không bảng rỗng): Rời rạc có sẵn các dòng giá trị, Khoảng có sẵn các khoảng,
 * Bảng giá trị lấy bảng của Tag hoặc bảng đầu tiên của project (`tables`).
 */
export function defaultTransform(
  row: AnimationRow,
  kind: TransformKind04,
  tag: TagInfo | undefined,
  tables: readonly string[] = [],
): Transform04 {
  const [on, off] = stateValues(row);
  const color = row.id === 'fill' || row.id === 'stroke';
  switch (kind) {
    case 'direct':
      return { kind: 'direct' };
    case 'linearScale': {
      const [inMin, inMax] = tagRange(tag);
      const [outMin, outMax] = DEFAULT_OUT[row.id];
      return { kind: 'linearScale', inMin, inMax, outMin, outMax, clamp: true };
    }
    case 'valueTable': {
      // Tag có bảng riêng: để trống (dùng bảng của Tag); chưa có: bảng đầu tiên của project.
      const table = tag?.valueTable === undefined ? tables[0] : undefined;
      return {
        kind: 'valueTable',
        ...(table !== undefined ? { table } : {}),
        output: row.id === 'text' ? 'text' : 'color',
      };
    }
    case 'rangeMap': {
      const [lo, hi] = tagRange(tag);
      if (color) {
        const a = round6(lo + (hi - lo) * 0.6);
        const c = round6(lo + (hi - lo) * 0.85);
        return {
          kind: 'rangeMap',
          ranges: [
            { to: a, value: COLOR_RANGES[0] },
            { from: a, to: c, value: COLOR_RANGES[1] },
            { from: c, value: COLOR_RANGES[2] },
          ],
          default: COLOR_OFF,
        };
      }
      const mid = round6((lo + hi) / 2);
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
      const c = tag === undefined ? 'number' : tagClassOf04(tag.type);
      const cases =
        c === 'bool'
          ? [
              { equals: true, value: on },
              { equals: false, value: off },
            ]
          : c === 'string'
            ? [
                { equals: 'ON', value: on },
                { equals: 'OFF', value: off },
              ]
            : [
                { equals: 0, value: off },
                { equals: 1, value: on },
              ];
      return { kind: 'discreteMap', cases, default: off };
    }
  }
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Phép biến đổi cho ô chọn: bỏ Bảng giá trị khi Tag không có bảng và project chưa có bảng nào (trừ phép đang dùng). */
export function transformChoices(
  row: AnimationRow,
  tag: Pick<TagInfo, 'type' | 'valueTable'> | undefined,
  tables: readonly string[],
  current?: TransformKind04,
): TransformKind04[] {
  return transformsFor(row, tag).filter(
    (k) =>
      k !== 'valueTable' || k === current || tag?.valueTable !== undefined || tables.length > 0,
  );
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
    // Quay khi chạy: mặc định tốc độ Vừa (Tag Bật → quay), không bắt người dùng nhập vòng/phút.
    transform:
      rowId === 'spin' && transformKind === undefined
        ? spinPresetTransform('medium', tag)
        : defaultTransform(row, k, tag),
    ...defaultParams(row, tag),
  };
}

// ---- Nhóm theo mục đích và tốc độ quay (033-animation-ux) ----

/** Nhóm hiển thị theo mục đích (thứ tự hiển thị; kiểu phổ biến lên đầu mỗi nhóm). */
export type RowSection = 'state' | 'number' | 'motion';

export const ROW_SECTIONS: readonly { id: RowSection; rows: readonly RowId[] }[] = [
  { id: 'state', rows: ['fill', 'visibility', 'blink', 'stroke', 'opacity'] },
  { id: 'number', rows: ['text', 'level'] },
  { id: 'motion', rows: ['spin', 'rotate', 'flow', 'translateX', 'translateY', 'scale'] },
];

/** Mục phù hợp với kiểu Tag (để đánh dấu "Hợp Tag này" khi chọn Tag). */
export function recommendedRows(tag: Pick<TagInfo, 'type'>): readonly RowId[] {
  switch (tagClassOf04(tag.type)) {
    case 'bool':
      return ['fill', 'visibility', 'blink', 'spin', 'flow', 'stroke'];
    case 'string':
      return ['text'];
    default:
      return ['text', 'level', 'rotate', 'fill'];
  }
}

/**
 * Tốc độ quay có sẵn của "Quay khi chạy" (vòng/phút ghi vào binding). Runtime hiển thị chậm lại: 600 vòng/phút = 1 vòng/giây
 * trên màn hình (`spinRps` của binding-engine), nên số nhỏ như 10 gần như đứng yên.
 */
export const SPIN_PRESETS = { slow: 150, medium: 300, fast: 900 } as const;
export type SpinPreset = keyof typeof SPIN_PRESETS;
/** Cách đặt tốc độ: preset, theo giá trị Tag (`direct`), hoặc thiết lập tự do (giữ nguyên dữ liệu cũ). */
export type SpinSpeed = SpinPreset | 'tag' | 'custom';

/** Phép biến đổi của preset: Bật (hoặc khác 0) → quay ở tốc độ preset, Tắt/0 → đứng. Không đổi schema. */
export function spinPresetTransform(
  preset: SpinPreset,
  tag: Pick<TagInfo, 'type'> | undefined,
): Transform04 {
  const rpm = SPIN_PRESETS[preset];
  const c = tag === undefined ? 'number' : tagClassOf04(tag.type);
  const cases =
    c === 'bool'
      ? [
          { equals: true, value: rpm },
          { equals: false, value: 0 },
        ]
      : [{ equals: 0, value: 0 }];
  return { kind: 'discreteMap', cases, default: c === 'bool' ? 0 : rpm };
}

/** Nhận ra cách đặt tốc độ của binding quay đã có (dự án cũ: `direct`, rời rạc tự đặt... → `tag`/`custom`). */
export function spinSpeedOf(
  b: Pick<Binding04, 'transform'>,
  tag: Pick<TagInfo, 'type'> | undefined,
): SpinSpeed {
  const tr = b.transform;
  if (tr.kind === 'direct')
    return tag !== undefined && tagClassOf04(tag.type) === 'bool' ? 'custom' : 'tag';
  for (const p of Object.keys(SPIN_PRESETS) as SpinPreset[]) {
    if (JSON.stringify(spinPresetTransform(p, tag)) === JSON.stringify(tr)) return p;
  }
  return 'custom';
}

/** Đơn vị của giá trị thử cho mục (nhãn thanh Thử giá trị). */
export function rowUnit(row: RowId, b: Pick<Binding04, 'transform'>): 'deg' | 'rpm' | null {
  if (b.transform.kind !== 'direct') return null;
  return row === 'rotate' ? 'deg' : row === 'spin' ? 'rpm' : null;
}
