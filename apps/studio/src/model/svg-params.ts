// Tham số của binding SVG ở inspector (feature 008, T072; contract binding-animation §4, studio-svg-editor §5). Hàm thuần:
// đọc và ghi khóa tham số (khóa `format.<x>` nằm trong khối `format`), kiểm giá trị cục bộ theo đặc tả của mục để ô báo lỗi ngay
// (luật cuối cùng vẫn là rules-04 của @mat/project-schema), kiểm khoảng của phép Khoảng, giá trị ra theo mục.
import type { Binding04, Scalar } from '@mat/project-schema';
import type { ParamSpec, RowId } from './animation-catalog.ts';

type Dict = Record<string, unknown>;
const FORMAT = 'format.';

/** Giá trị của khóa tham số (`format.decimals` đọc trong khối `format`). */
export function readParam(b: Binding04, key: string): unknown {
  if (key.startsWith(FORMAT)) return (b.format as Dict | undefined)?.[key.slice(FORMAT.length)];
  return (b as unknown as Dict)[key];
}

/** Bản vá cho `updateBinding`; `value` là `undefined` thì bỏ khóa (khối `format` rỗng thì bỏ cả khối). */
export function paramPatch(b: Binding04, key: string, value: unknown): Partial<Binding04> {
  if (key.startsWith(FORMAT)) {
    const k = key.slice(FORMAT.length);
    const f: Dict = { ...(b.format as Dict | undefined) };
    if (value === undefined) delete f[k];
    else f[k] = value;
    return { format: Object.keys(f).length > 0 ? (f as Binding04['format']) : undefined };
  }
  return { [key]: value } as Partial<Binding04>;
}

export type ParamError = 'type' | 'int' | 'range';

/** Kiểm cục bộ một giá trị tham số theo đặc tả; `null` là hợp. */
export function checkParam(spec: ParamSpec, value: unknown): ParamError | null {
  switch (spec.kind) {
    case 'int':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'type';
      if (spec.kind === 'int' && !Number.isInteger(value)) return 'int';
      return value < spec.min || value > spec.max ? 'range' : null;
    }
    case 'bool':
      return typeof value === 'boolean' ? null : 'type';
    case 'enum':
      return typeof value === 'string' && spec.options.includes(value) ? null : 'type';
    case 'string':
      if (typeof value !== 'string') return 'type';
      return [...value].length > spec.maxLength ? 'range' : null;
    case 'color':
      return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? null : 'type';
    case 'pivot':
      return Array.isArray(value) &&
        value.length === 2 &&
        value.every((n) => typeof n === 'number' && n >= 0 && n <= 1)
        ? null
        : 'range';
  }
}

// ---- Phép Khoảng ----

export interface RangeRow {
  from?: number;
  to?: number;
  value: Scalar;
}
export interface RangeIssue {
  index: number;
  error: 'order' | 'overlap';
}

/** Khoảng theo thứ tự `từ` tăng dần (khoảng mở đầu `từ` vắng đứng đầu). */
export function sortRanges<T extends { from?: number }>(ranges: readonly T[]): T[] {
  return ranges
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.from ?? -Infinity) - (b.r.from ?? -Infinity) || a.i - b.i)
    .map((x) => x.r);
}

/**
 * Lỗi của bảng khoảng: `từ` ≥ `đến` (báo ở dòng đó) và chồng nhau (báo ở khoảng đứng sau theo thứ tự `từ`, như `E_RANGE`
 * của bảng giá trị). `từ` bao gồm, `đến` không bao gồm nên khoảng liền kề không chồng. Chỉ số là chỉ số trong mảng đầu vào.
 */
export function checkRanges(ranges: readonly RangeRow[]): RangeIssue[] {
  const out: RangeIssue[] = [];
  const order = ranges
    .map((r, index) => ({ r, index }))
    .sort((a, b) => (a.r.from ?? -Infinity) - (b.r.from ?? -Infinity) || a.index - b.index);
  const bad = new Set<number>();
  for (const { r, index } of order)
    if (r.from !== undefined && r.to !== undefined && r.from >= r.to) {
      out.push({ index, error: 'order' });
      bad.add(index);
    }
  let end = -Infinity;
  for (const { r, index } of order) {
    if (bad.has(index)) continue;
    const from = r.from ?? -Infinity;
    if (from < end) out.push({ index, error: 'overlap' });
    end = Math.max(end, r.to ?? Infinity);
  }
  return out.sort((a, b) => a.index - b.index);
}

// ---- Giá trị ra ----

export type OutputKind = 'text' | 'color' | 'number' | 'visibility' | 'bool';

/** Loại giá trị ra của phép Rời rạc/Khoảng theo mục (ô nhập đổi theo loại). */
export function outputKindOf(row: RowId): OutputKind {
  switch (row) {
    case 'text':
      return 'text';
    case 'fill':
    case 'stroke':
      return 'color';
    case 'visibility':
      return 'visibility';
    case 'blink':
      return 'bool';
    default:
      return 'number';
  }
}

/** Đọc giá trị gõ tay theo loại: số dùng dấu chấm (từ chối dấu phẩy), màu `#rrggbb`. */
export function parseScalar(
  text: string,
  kind: OutputKind,
): { ok: true; value: Scalar } | { ok: false } {
  const s = text.trim();
  switch (kind) {
    case 'text':
      return { ok: true, value: text };
    case 'number': {
      if (s === '' || s.includes(',')) return { ok: false };
      const n = Number(s);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case 'color':
      return /^#[0-9a-fA-F]{6}$/.test(s) ? { ok: true, value: s.toLowerCase() } : { ok: false };
    case 'visibility':
      return s === 'visible' || s === 'hidden' ? { ok: true, value: s } : { ok: false };
    case 'bool':
      return s === 'true' || s === 'false' ? { ok: true, value: s === 'true' } : { ok: false };
  }
}
