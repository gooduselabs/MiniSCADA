// Mô hình inspector sinh từ danh mục widget và kiểm gắn Tag (feature 007, T105; contract
// widget-catalog §4; research R21). Không có chuỗi hiển thị: mỗi mục mang khóa i18n
// (`widget.<id>.prop.<name>`, `.slot.<name>`, `.event.<name>`) và lý do từ chối là mã.
import {
  catalogWidget,
  tagClassOf,
  type Action,
  type ActionNameCatalog,
  type Item,
  type PropKind,
  type PropSpec,
  type PropValue,
  type SlotSpec,
  type TagClass,
  type TagKind,
  type TagLimits,
  type TagV1,
  type WidgetItem,
  type WidgetSpec,
} from '@mat/project-schema';

// ---------------------------------------------------------------------------------------------
// Thông tin Tag tối thiểu cho Studio

export interface TagInfo {
  id: string;
  /** Kiểu giá trị của Tag v1 (`BOOL`, `INT16`, ..., `STRING`). */
  type: string;
  access: 'R' | 'RW';
  kind: TagKind;
  unit?: string;
  valueTable?: string;
  min?: number;
  max?: number;
  limits?: TagLimits;
  sim?: { kind: string };
}

export function tagInfoOf(t: TagV1): TagInfo {
  const out: TagInfo = { id: t.id, type: t.type, access: t.access ?? 'R', kind: t.kind };
  if (t.unit !== undefined) out.unit = t.unit;
  if (t.min !== undefined) out.min = t.min;
  if (t.max !== undefined) out.max = t.max;
  if (t.limits !== undefined) out.limits = { ...t.limits };
  if (t.valueTable !== undefined) out.valueTable = t.valueTable;
  if (t.sim !== undefined) out.sim = { kind: t.sim.kind };
  return out;
}

// ---------------------------------------------------------------------------------------------
// Kiểm gắn Tag

export type BindReason =
  | 'type-mismatch'
  | 'needs-write'
  | 'calculated'
  | 'simulation'
  | 'multi-full'
  | 'duplicate'
  | 'unknown-tag';
export type BindResult = { ok: true } | { ok: false; reason: BindReason };

const fail = (reason: BindReason): BindResult => ({ ok: false, reason });

/**
 * Tag có gắn được vào khe không (`current` = Tag đang gắn ở khe, để kiểm khe `multi`). Thứ tự:
 * Tag có thật, lớp kiểu, quyền ghi (`calculated`, `simulation` không nhập tay, rồi RW), khe `multi`.
 */
export function canBind(
  tag: TagInfo | undefined,
  slot: SlotSpec,
  current?: string | readonly string[],
): BindResult {
  if (tag === undefined) return fail('unknown-tag');
  if (!slot.types.includes(tagClassOf(tag.type))) return fail('type-mismatch');
  if (slot.needsWrite) {
    if (tag.kind === 'calculated') return fail('calculated');
    if (tag.kind === 'simulation' && tag.sim?.kind !== 'manual') return fail('simulation');
    if (tag.access !== 'RW') return fail('needs-write');
  }
  if (slot.multi && current !== undefined) {
    const list = typeof current === 'string' ? [current] : current;
    if (list.includes(tag.id)) return fail('duplicate');
    if (slot.max !== undefined && list.length >= slot.max) return fail('multi-full');
  }
  return { ok: true };
}

/** Khe `target` của nút chỉ dùng cho hành động ghi. */
export const actionUsesTarget = (a: Action | undefined): boolean =>
  a?.action === 'write' || a?.action === 'toggle' || a?.action === 'pulse';

/** Như `canBind`, thêm luật của hành động: `toggle` và `pulse` cần Tag BOOL. */
export function canBindForAction(
  tag: TagInfo | undefined,
  slot: SlotSpec,
  action: Action,
  current?: string | readonly string[],
): BindResult {
  const base = canBind(tag, slot, current);
  if (!base.ok) return base;
  if ((action.action === 'toggle' || action.action === 'pulse') && tagClassOf(tag!.type) !== 'bool')
    return fail('type-mismatch');
  return base;
}

// ---------------------------------------------------------------------------------------------
// "Dùng của Tag"

export type TagDefaults = Partial<{
  unit: string;
  valueTable: string;
  min: number;
  max: number;
  'limits.min': number;
  'limits.max': number;
}>;

/** Giá trị Tag có thể đề xuất làm mặc định (đúng khóa `fromTag` của danh mục). */
export function tagDefaults(tag: TagInfo): TagDefaults {
  const out: TagDefaults = {};
  if (tag.unit !== undefined) out.unit = tag.unit;
  if (tag.valueTable !== undefined) out.valueTable = tag.valueTable;
  if (tag.min !== undefined) out.min = tag.min;
  if (tag.max !== undefined) out.max = tag.max;
  if (tag.limits?.min !== undefined) out['limits.min'] = tag.limits.min;
  if (tag.limits?.max !== undefined) out['limits.max'] = tag.limits.max;
  return out;
}

/**
 * Thuộc tính của widget có `fromTag` mà item chưa đặt và Tag có giá trị: `{ tên thuộc tính: giá trị }`
 * (để nút "Dùng đơn vị, bảng, giới hạn của Tag" ghi bằng `setProp`).
 */
export function suggestFromTag(
  widget: string,
  props: Readonly<Record<string, PropValue>> | undefined,
  tag: TagInfo,
): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  const defaults = tagDefaults(tag) as Record<string, PropValue | undefined>;
  for (const p of catalogWidget(widget)?.props ?? []) {
    if (p.fromTag === undefined || props?.[p.name] !== undefined) continue;
    const v = defaults[p.fromTag];
    if (v !== undefined) out[p.name] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Mô hình ô của inspector

export type FieldGroup = 'general' | 'display' | 'security';

export interface FieldModel {
  name: string;
  kind: PropKind;
  group: FieldGroup;
  i18nKey: string;
  default?: unknown;
  options?: string[];
  min?: number;
  max?: number;
  exclusiveMin?: number;
  maxLength?: number;
  allowAuto?: boolean;
  maxItems?: number;
  unique?: boolean;
  items?: PropSpec['items'];
  fields?: PropSpec[];
  fromTag?: string;
  fallback?: number;
}
export interface SlotModel {
  name: string;
  required: boolean;
  multi: boolean;
  max?: number;
  types: TagClass[];
  needsWrite: boolean;
  i18nKey: string;
}
export interface EventModel {
  name: string;
  actions: ActionNameCatalog[];
  i18nKey: string;
}
export interface InspectorModel {
  widget: string;
  labelKey: string;
  groups: Record<FieldGroup, FieldModel[]>;
  slots: SlotModel[];
  events: EventModel[];
  /** Vai trò chọn được cho `security.minRole` (widget điều khiển). */
  minRoles?: string[];
  defaultRole?: string;
}

const COPY_KEYS = [
  'default',
  'options',
  'min',
  'max',
  'exclusiveMin',
  'maxLength',
  'allowAuto',
  'maxItems',
  'unique',
  'items',
  'fields',
  'fromTag',
  'fallback',
] as const;

function fieldOf(widget: string, p: PropSpec): FieldModel {
  const f: FieldModel = {
    name: p.name,
    kind: p.kind,
    group: p.group ?? 'display',
    i18nKey: `widget.${widget}.prop.${p.name}`,
  };
  const rec = f as unknown as Record<string, unknown>;
  for (const k of COPY_KEYS) if (p[k] !== undefined) rec[k] = p[k];
  return f;
}

/** Mô hình inspector của một loại widget; `undefined` nếu loại không có trong danh mục. */
export function inspectorModelOf(widget: string): InspectorModel | undefined {
  const spec = catalogWidget(widget);
  if (spec === undefined) return undefined;
  const groups: Record<FieldGroup, FieldModel[]> = { general: [], display: [], security: [] };
  for (const p of spec.props) {
    const f = fieldOf(widget, p);
    groups[f.group].push(f);
  }
  const model: InspectorModel = {
    widget,
    labelKey: spec.label,
    groups,
    slots: spec.slots.map((s) => {
      const m: SlotModel = {
        name: s.name,
        required: s.required,
        multi: s.multi,
        types: [...s.types],
        needsWrite: s.needsWrite,
        i18nKey: `widget.${widget}.slot.${s.name}`,
      };
      if (s.max !== undefined) m.max = s.max;
      return m;
    }),
    events: spec.events.map((e) => ({
      name: e.name,
      actions: [...e.actions],
      i18nKey: `widget.${widget}.event.${e.name}`,
    })),
  };
  if (spec.security !== undefined) {
    model.minRoles = [...spec.security.minRole];
    model.defaultRole = spec.security.default;
  }
  return model;
}

// ---------------------------------------------------------------------------------------------
// Thuộc tính chung khi chọn nhiều

export interface Shared<T> {
  /** Giá trị chung; `undefined` khi các item khác nhau (`mixed`) hoặc cùng chưa đặt. */
  value: T | undefined;
  mixed: boolean;
}
export interface CommonModel {
  count: number;
  /** Loại widget nếu mọi item là cùng một loại widget, ngược lại `null`. */
  widget: string | null;
  geometry: Record<'x' | 'y' | 'width' | 'height', Shared<number>>;
  locked: Shared<boolean>;
  hidden: Shared<boolean>;
  props: Array<{ field: FieldModel } & Shared<PropValue>>;
}

function shared<T>(values: readonly (T | undefined)[]): Shared<T> {
  const first = values[0];
  const key = (v: T | undefined) => JSON.stringify(v ?? null);
  const mixed = values.some((v) => key(v) !== key(first));
  return { value: mixed ? undefined : first, mixed };
}

export function commonProps(items: readonly Item[]): CommonModel {
  const num = (k: 'x' | 'y' | 'width' | 'height') => shared(items.map((i) => i[k]));
  const kinds = new Set(items.map((i) => (i.type === 'widget' ? i.widget : null)));
  const widget = items.length > 0 && kinds.size === 1 ? ([...kinds][0] ?? null) : null;
  const model = widget !== null ? inspectorModelOf(widget) : undefined;
  const fields = model
    ? [...model.groups.general, ...model.groups.display, ...model.groups.security]
    : [];
  return {
    count: items.length,
    widget: model ? widget : null,
    geometry: { x: num('x'), y: num('y'), width: num('width'), height: num('height') },
    locked: shared(items.map((i) => i.locked === true)),
    hidden: shared(items.map((i) => i.hidden === true)),
    props: fields.map((field) => ({
      field,
      ...shared(items.map((i) => (i as WidgetItem).props?.[field.name])),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Thả Tag lên widget

export interface SlotChoice {
  slot: string;
  /** `set` đặt vào khe trống, `append` nối vào khe `multi`, `replace` thay Tag của khe chính. */
  mode: 'set' | 'append' | 'replace';
}

const boundOf = (item: WidgetItem, slot: string): string[] => {
  const v = item.tags?.[slot];
  return v === undefined ? [] : typeof v === 'string' ? [v] : v;
};

/**
 * Khe nhận Tag khi thả lên widget: khe đầu tiên chưa có Tag (hoặc khe `multi` còn chỗ) mà hợp kiểu.
 * Còn khe trống mà không khe nào hợp kiểu: `null`. Mọi khe đã gắn: thay khe chính nếu hợp kiểu. Khe
 * `multi` đầy cũng cho `null` (không xóa cả danh sách chuỗi dữ liệu).
 */
export function firstFreeSlot(spec: WidgetSpec, item: WidgetItem, tag: TagInfo): SlotChoice | null {
  let anyFree = false;
  for (const slot of spec.slots) {
    const cur = boundOf(item, slot.name);
    const free = cur.length === 0 || (slot.multi && cur.length < (slot.max ?? Infinity));
    if (!free) continue;
    anyFree = true;
    if (canBind(tag, slot, slot.multi ? cur : undefined).ok)
      return { slot: slot.name, mode: cur.length === 0 ? 'set' : 'append' };
  }
  if (anyFree) return null;
  const main = spec.slots[0];
  if (main !== undefined && !main.multi && canBind(tag, main).ok)
    return { slot: main.name, mode: 'replace' };
  return null;
}
