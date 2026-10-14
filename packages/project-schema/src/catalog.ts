// Danh mục widget (specs/007-screens-widgets/contracts/widget-catalog.md). Nguồn duy nhất là
// schemas/widgets.catalog.json; mô-đun này nạp, tra cứu và kiểm giá trị thuộc tính theo `kind`.
import catalogJson from '../../../schemas/widgets.catalog.json' with { type: 'json' };

export type TagClass = 'number' | 'bool' | 'string';
export type WidgetGroup = 'display' | 'chart' | 'table' | 'control' | 'history';
export type PropKind =
  | 'string'
  | 'int'
  | 'number'
  | 'bool'
  | 'enum'
  | 'color'
  | 'array'
  | 'object'
  | 'tableRef'
  /** Danh mục 0.5.0 (feature 010): id nhóm lưu trữ trong logging.json. */
  | 'logGroup';

export interface PropSpec {
  name: string;
  kind: PropKind;
  group?: 'general' | 'display' | 'security';
  default?: unknown;
  maxLength?: number;
  /** Chuỗi phải khớp regex (danh mục 0.5.0: `shiftStart`). */
  pattern?: string;
  min?: number;
  max?: number;
  exclusiveMin?: number;
  options?: string[];
  allowAuto?: boolean;
  maxItems?: number;
  unique?: boolean;
  items?: PropSpec | { kind: PropKind; [k: string]: unknown };
  fields?: PropSpec[];
  /** Giá trị mặc định lấy từ Tag khi thuộc tính vắng (`unit`, `min`, `max`, `limits.min`, `valueTable`). */
  fromTag?: string;
  /** Giá trị cuối cùng khi cả thuộc tính và Tag đều vắng. */
  fallback?: number;
}

export interface SlotSpec {
  name: string;
  required: boolean;
  multi: boolean;
  max?: number;
  types: TagClass[];
  needsWrite: boolean;
  /** Danh mục 0.5.0 (feature 010): Tag của khe phải thuộc nhóm lưu trữ ở thuộc tính này. */
  inGroup?: string;
  /** Danh mục 0.5.0: Tag phải có tổng hợp trong nhóm. */
  needsAggregate?: boolean;
}

export interface EventSpec {
  name: string;
  actions: ActionNameCatalog[];
}

export type ActionNameCatalog = 'write' | 'toggle' | 'pulse' | 'navigate' | 'popup' | 'closePopup';

export interface WidgetSpec {
  id: string;
  group: WidgetGroup;
  label: string;
  defaultSize: [number, number];
  minSize: [number, number];
  slots: SlotSpec[];
  props: PropSpec[];
  events: EventSpec[];
  security?: { minRole: string[]; default: string };
}

export interface WidgetCatalog {
  catalogVersion: string;
  widgets: WidgetSpec[];
}

export const ACTION_NAMES: readonly ActionNameCatalog[] = [
  'write',
  'toggle',
  'pulse',
  'navigate',
  'popup',
  'closePopup',
];

export const WIDGET_CATALOG: WidgetCatalog = catalogJson as unknown as WidgetCatalog;

const BY_ID = new Map(WIDGET_CATALOG.widgets.map((w) => [w.id, w]));

export function catalogWidget(id: string): WidgetSpec | undefined {
  return BY_ID.get(id);
}

/** Lớp kiểu của Tag v1 (`type` ở tags.json). */
export function tagClassOf(type: string): TagClass {
  if (type === 'BOOL') return 'bool';
  if (type === 'STRING') return 'string';
  return 'number';
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

type Spec = { kind: PropKind } & Partial<PropSpec>;

/** Trả `null` nếu hợp lệ, ngược lại câu mô tả lỗi (tiếng Anh, cho log; mã lỗi do rules-03 gắn). */
export function checkPropValue(spec: Spec, value: unknown): string | null {
  switch (spec.kind) {
    case 'string':
      if (typeof value !== 'string') return 'expected string';
      if (spec.maxLength !== undefined && [...value].length > spec.maxLength) return 'too long';
      if (spec.pattern !== undefined && !new RegExp(spec.pattern).test(value))
        return 'does not match the pattern';
      return null;
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'expected integer';
      return checkRange(spec, value);
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'expected finite number';
      return checkRange(spec, value);
    case 'bool':
      return typeof value === 'boolean' ? null : 'expected boolean';
    case 'enum':
      return typeof value === 'string' && (spec.options ?? []).includes(value)
        ? null
        : 'not an allowed option';
    case 'color':
      if (spec.allowAuto === true && value === 'auto') return null;
      return typeof value === 'string' && COLOR_RE.test(value) ? null : 'expected #RRGGBB';
    case 'tableRef':
      return typeof value === 'string' && value.length > 0 ? null : 'expected table name';
    case 'logGroup':
      return typeof value === 'string' && value.length > 0 ? null : 'expected a logging group id';
    case 'array': {
      if (!Array.isArray(value)) return 'expected array';
      if (spec.maxItems !== undefined && value.length > spec.maxItems) return 'too many items';
      const item = spec.items as Spec | undefined;
      if (item) {
        for (const v of value) {
          const e = checkPropValue(item, v);
          if (e) return e;
        }
      }
      if (
        spec.unique === true &&
        new Set(value.map((v) => JSON.stringify(v))).size !== value.length
      )
        return 'duplicate items';
      if (item?.kind === 'object' && spec.name === 'zones') return checkZones(value as ZoneLike[]);
      return null;
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        return 'expected object';
      const rec = value as Record<string, unknown>;
      const fields = spec.fields ?? [];
      for (const k of Object.keys(rec))
        if (!fields.some((f) => f.name === k)) return `unknown field ${k}`;
      for (const f of fields) {
        if (!(f.name in rec)) return `missing field ${f.name}`;
        const e = checkPropValue(f, rec[f.name]);
        if (e) return e;
      }
      return null;
    }
  }
}

function checkRange(spec: Spec, v: number): string | null {
  if (spec.min !== undefined && v < spec.min) return 'below min';
  if (spec.max !== undefined && v > spec.max) return 'above max';
  if (spec.exclusiveMin !== undefined && v <= spec.exclusiveMin)
    return 'must be greater than limit';
  return null;
}

interface ZoneLike {
  from: number;
  to: number;
}

function checkZones(zones: ZoneLike[]): string | null {
  for (const z of zones) if (!(z.from < z.to)) return 'zone from must be < to';
  const sorted = [...zones].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.from < sorted[i - 1]!.to) return 'zones overlap';
  }
  return null;
}
