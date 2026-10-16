// Tham số của template và faceplate (feature 011, T021; FR-122, FR-125; contracts/project-format-1.0.md §3, §5): một
// hàm thuần `substituteParams` dùng chung cho validator TS (bung tĩnh popup có tham số, kiểm bản sao template) và trang
// vận hành (@mat/ui-components, T174). Bản C++ (core/project-manager/rules_10) cài cùng luật; vector chung `v10-*`.
//
// Luật (giống hệt ở C++):
// - Một `{name}` là `{` + tên `^[a-z][A-Za-z0-9]{0,31}$` + `}`; mọi `{` hoặc `}` khác (lồng, không đóng, tên sai) là lỗi.
// - Chỗ dùng được (danh mục widget, khóa `params.places`), đường dẫn tính trong item:
//   `/tags/<khe>` hoặc `/tags/<khe>/<k>`: `{p}` hoặc `{p}.SUFFIX` (SUFFIX `(\.[A-Za-z0-9_]+)+`), `p` kiểu tagPrefix;
//   `/props/<tên>` của thuộc tính `string` (hoặc phần tử chuỗi của thuộc tính `array` có items `string`): nhúng `{p}`
//   kiểu string; thuộc tính `number`/`int`: trọn chuỗi `{p}` kiểu number (thay thành số); `color`: trọn chuỗi `{p}` kiểu
//   color; `/events/click/args/<khóa>` (chỉ trong template): nhúng `{p}` mọi kiểu. Nơi khác (kể cả tên khóa) có `{`, `}`
//   là lỗi.
// - Thay một lần, trái sang phải: giá trị chứa `{x}` không bị thay tiếp.
import { catalogWidget, type PropSpec } from './catalog.ts';

export type ParamKind = 'tagPrefix' | 'string' | 'number' | 'color';
export interface ParamDecl {
  name: string;
  kind: ParamKind;
  default?: string;
}

export const PARAM_NAME_RE = /^[a-z][A-Za-z0-9]{0,31}$/;
export const TAG_PREFIX_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;
const NUMBER_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const SUFFIX_RE = /^(\.[A-Za-z0-9_]+)+$/;
// eslint-disable-next-line no-control-regex -- chính là thứ cần chặn
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export const PARAM_LIMITS = {
  /** Số tham số tối đa của một template hay popup. */
  params: 16,
  tagPrefixBytes: 64,
  stringBytes: 128,
  /** Số bộ `args` khác nhau tối đa của một popup (E_POPUP_ARGS). */
  combinations: 1000,
} as const;

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/** `null` nếu `value` hợp lệ cho `kind`, ngược lại câu mô tả lỗi (tiếng Việt). */
export function paramValueError(kind: ParamKind, value: unknown): string | null {
  if (typeof value !== 'string') return 'giá trị tham số phải là chuỗi';
  switch (kind) {
    case 'tagPrefix':
      if (!TAG_PREFIX_RE.test(value))
        return 'tiền tố Tag chỉ gồm chữ, số, `_` và `.` (bắt đầu bằng chữ)';
      return utf8Length(value) > PARAM_LIMITS.tagPrefixBytes ? 'tiền tố Tag dài hơn 64 byte' : null;
    case 'string':
      if (CONTROL_RE.test(value)) return 'chuỗi có ký tự điều khiển';
      return utf8Length(value) > PARAM_LIMITS.stringBytes ? 'chuỗi dài hơn 128 byte' : null;
    case 'number':
      return NUMBER_RE.test(value) && Number.isFinite(Number(value))
        ? null
        : 'không phải số hữu hạn';
    case 'color':
      return COLOR_RE.test(value) ? null : 'màu phải dạng #RRGGBB';
    default:
      return 'kiểu tham số lạ';
  }
}

export type ParamPart = string | { param: string };

/** Tách chuỗi thành phần chữ và `{name}`; `ok: false` khi có `{`/`}` lạ, lồng, hoặc tên sai dạng. */
export function paramTokens(s: string): { ok: true; parts: ParamPart[] } | { ok: false } {
  const parts: ParamPart[] = [];
  let text = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '}') return { ok: false };
    if (c !== '{') {
      text += c;
      continue;
    }
    const end = s.indexOf('}', i + 1);
    if (end < 0) return { ok: false };
    const name = s.slice(i + 1, end);
    if (!PARAM_NAME_RE.test(name)) return { ok: false };
    if (text) parts.push(text);
    text = '';
    parts.push({ param: name });
    i = end;
  }
  if (text) parts.push(text);
  return { ok: true, parts };
}

const hasBrace = (s: string) => s.includes('{') || s.includes('}');

export interface ParamProblem {
  /** `place`: chỗ đặt `{name}` (E_TEMPLATE_PARAM); `args`: giá trị tham số (E_POPUP_ARGS ở popup, E_TEMPLATE_PARAM ở bản sao). */
  kind: 'place' | 'args';
  /** JSON Pointer: trong item (`place`), hoặc `/<tên tham số>` (`args`). */
  path: string;
  message: string;
}

/** Luật khai báo tham số (ngoài schema): tên trùng, `default` sai kiểu. Đường dẫn `/<i>/name`, `/<i>/default`. */
export function checkParamDecls(
  params: readonly ParamDecl[],
): Array<{ path: string; message: string }> {
  const out: Array<{ path: string; message: string }> = [];
  const seen = new Set<string>();
  params.forEach((p, i) => {
    if (seen.has(p.name)) out.push({ path: `/${i}/name`, message: `tham số '${p.name}' bị trùng` });
    seen.add(p.name);
    if (p.default !== undefined) {
      const e = paramValueError(p.kind, p.default);
      if (e) out.push({ path: `/${i}/default`, message: `default của '${p.name}': ${e}` });
    }
  });
  return out;
}

/**
 * Bộ giá trị đủ của các tham số từ `args` (thiếu thì lấy `default`). Lỗi: khóa không phải tham số (thừa), tham số không
 * default mà thiếu, giá trị không phải chuỗi hoặc sai `kind`. `args` vắng tương đương `{}`.
 */
export function resolveArgs(
  params: readonly ParamDecl[],
  args: unknown,
): { ok: true; values: Record<string, string> } | { ok: false; problems: ParamProblem[] } {
  const problems: ParamProblem[] = [];
  const add = (path: string, message: string) => problems.push({ kind: 'args', path, message });
  const values: Record<string, string> = {};
  let given: Record<string, unknown> = {};
  if (args !== undefined) {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      add('', 'args phải là đối tượng tên tham số -> chuỗi');
      return { ok: false, problems };
    }
    given = args as Record<string, unknown>;
  }
  const byName = new Map(params.map((p) => [p.name, p]));
  for (const k of Object.keys(given))
    if (!byName.has(k)) add(`/${esc(k)}`, `'${k}' không phải tham số`);
  for (const p of params) {
    if (Object.prototype.hasOwnProperty.call(given, p.name)) {
      const v = given[p.name];
      const e = paramValueError(p.kind, v);
      if (e) add(`/${esc(p.name)}`, `tham số '${p.name}': ${e}`);
      else values[p.name] = v as string;
    } else if (p.default !== undefined) values[p.name] = p.default;
    else add(`/${esc(p.name)}`, `thiếu tham số '${p.name}'`);
  }
  return problems.length ? { ok: false, problems } : { ok: true, values };
}

const esc = (k: string) => k.replace(/~/g, '~0').replace(/\//g, '~1');
const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

type Place =
  | { kind: 'tag' }
  | { kind: 'embedded'; kinds: readonly ParamKind[] }
  | { kind: 'whole'; param: ParamKind; asNumber: boolean }
  | { kind: 'none' };

const ALL_KINDS: readonly ParamKind[] = ['tagPrefix', 'string', 'number', 'color'];

/** Chỗ của một chuỗi theo đường dẫn trong item (`segs`: các khóa/chỉ số từ gốc item). */
function placeOf(item: Record<string, unknown>, segs: readonly string[], template: boolean): Place {
  const [a, b, c, d] = segs;
  if (a === 'tags' && b !== undefined && (segs.length === 2 || segs.length === 3))
    return { kind: 'tag' };
  if (a === 'props' && b !== undefined && typeof item.widget === 'string') {
    const spec: PropSpec | undefined = catalogWidget(item.widget)?.props.find((p) => p.name === b);
    if (!spec) return { kind: 'none' };
    if (segs.length === 2) {
      if (spec.kind === 'string') return { kind: 'embedded', kinds: ['string'] };
      if (spec.kind === 'number' || spec.kind === 'int')
        return { kind: 'whole', param: 'number', asNumber: true };
      if (spec.kind === 'color') return { kind: 'whole', param: 'color', asNumber: false };
      return { kind: 'none' };
    }
    if (segs.length === 3 && spec.kind === 'array' && spec.items?.kind === 'string')
      return { kind: 'embedded', kinds: ['string'] };
    return { kind: 'none' };
  }
  if (
    template &&
    a === 'events' &&
    b === 'click' &&
    c === 'args' &&
    d !== undefined &&
    segs.length === 4
  )
    return { kind: 'embedded', kinds: ALL_KINDS };
  return { kind: 'none' };
}

/**
 * Đi qua mọi chuỗi của `item`; với chuỗi có `{`/`}` kiểm chỗ đặt và (nếu có `values`) trả bản đã thay. Trả về giá trị
 * mới (bản sao sâu chỉ ở chỗ đổi) và các lỗi chỗ đặt.
 */
function walk(
  item: unknown,
  params: readonly ParamDecl[],
  template: boolean,
  values: Record<string, string> | null,
): { value: unknown; problems: ParamProblem[] } {
  const problems: ParamProblem[] = [];
  const kinds = new Map(params.map((p) => [p.name, p.kind]));
  const root = isObj(item) ? item : {};
  const ptr = (segs: readonly string[]) => segs.map((s) => '/' + esc(s)).join('');
  const bad = (segs: readonly string[], message: string) =>
    problems.push({ kind: 'place', path: ptr(segs), message });

  const str = (s: string, segs: readonly string[]): unknown => {
    if (!hasBrace(s)) return s;
    const t = paramTokens(s);
    if (!t.ok) {
      bad(segs, `'{' hoặc '}' lạ hoặc tên tham số sai dạng trong '${s}'`);
      return s;
    }
    const names = t.parts.filter((p): p is { param: string } => typeof p !== 'string');
    for (const n of names)
      if (!kinds.has(n.param)) {
        bad(segs, `tham số '${n.param}' không được khai`);
        return s;
      }
    const place = placeOf(root, segs, template);
    const sub = (name: string) => values?.[name] ?? '';
    switch (place.kind) {
      case 'none':
        bad(segs, `không được dùng {tham số} ở đây`);
        return s;
      case 'tag': {
        const [first, ...rest] = t.parts;
        const suffix = rest.join('');
        if (
          typeof first === 'string' ||
          first === undefined ||
          rest.some((x) => typeof x !== 'string') ||
          kinds.get(first.param) !== 'tagPrefix' ||
          (suffix !== '' && !SUFFIX_RE.test(suffix))
        ) {
          bad(segs, `khe Tag chỉ nhận {tiền tố} hoặc {tiền tố}.HẬU_TỐ với tham số kiểu tagPrefix`);
          return s;
        }
        return values ? sub(first.param) + suffix : s;
      }
      case 'whole': {
        const only = t.parts.length === 1 ? t.parts[0] : undefined;
        if (
          only === undefined ||
          typeof only === 'string' ||
          kinds.get(only.param) !== place.param
        ) {
          bad(segs, `thuộc tính này chỉ nhận trọn chuỗi {tham số} kiểu ${place.param}`);
          return s;
        }
        if (!values) return s;
        return place.asNumber ? Number(sub(only.param)) : sub(only.param);
      }
      case 'embedded': {
        for (const n of names)
          if (!place.kinds.includes(kinds.get(n.param)!)) {
            bad(segs, `tham số '${n.param}' kiểu ${kinds.get(n.param)} không dùng được ở đây`);
            return s;
          }
        return values ? t.parts.map((p) => (typeof p === 'string' ? p : sub(p.param))).join('') : s;
      }
    }
  };

  const go = (v: unknown, segs: string[]): unknown => {
    if (typeof v === 'string') return str(v, segs);
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((x, i) => {
        const y = go(x, [...segs, String(i)]);
        if (y !== x) changed = true;
        return y;
      });
      return changed ? out : v;
    }
    if (isObj(v)) {
      let changed = false;
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (hasBrace(k)) bad([...segs, k], `tên khóa '${k}' có '{' hoặc '}'`);
        const y = go(x, [...segs, k]);
        if (y !== x) changed = true;
        out[k] = y;
      }
      return changed ? out : v;
    }
    return v;
  };
  const value = go(item, []);
  return { value, problems };
}

export interface ParamOptions {
  /** Item của template: `{name}` còn được ở giá trị `args` của hành động popup (thay khi bung bản sao). */
  template?: boolean;
}

/** Lỗi chỗ đặt `{name}` trong một item (không cần giá trị tham số). */
export function checkParamPlaces(
  item: unknown,
  params: readonly ParamDecl[],
  opts: ParamOptions = {},
): ParamProblem[] {
  return walk(item, params, opts.template === true, null).problems;
}

/**
 * Thay `{name}` của `item` bằng giá trị từ `args` (thiếu thì `default`). Không sửa `item`; cùng đầu vào cùng kết quả.
 * Lỗi chỗ đặt (`place`) và lỗi giá trị (`args`) cùng được báo; có lỗi thì không trả bản thay.
 */
export function substituteParams<T>(
  item: T,
  params: readonly ParamDecl[],
  args: unknown,
  opts: ParamOptions = {},
): { ok: true; value: T } | { ok: false; problems: ParamProblem[] } {
  const resolved = resolveArgs(params, args);
  const places = walk(item, params, opts.template === true, resolved.ok ? resolved.values : null);
  const problems = [...places.problems, ...(resolved.ok ? [] : resolved.problems)];
  if (problems.length) return { ok: false, problems };
  return { ok: true, value: places.value as T };
}
