// Luật liên file của bộ kiểm tra 0.4 (specs/008-svg-import-binding/contracts/project-format-0.4.md §5-§6,
// binding-animation.md §2, svg-events.md §2). Bản C++ (core/project-manager) cài CÙNG luật; vector chung ở
// tests/project-vectors (ca `v04-*`; quy ước `path` ghi ở đầu tests/project-vectors/v04.mjs).
//
// Cấu trúc: luật màn hình, item, widget, popup, Tag của màn hình dùng lại nguyên của 0.3 (rules-03.ts) qua điểm mở
// rộng `Rule03Ext`; file này thêm luật binding (đích x phép biến đổi x tham số x kiểu Tag, nhóm đích, rangeMap),
// luật sự kiện `events.click`, đếm hoạt ảnh vô hạn. Schema (schemas/binding.schema.json) chỉ kiểm khung: kiểu và miền
// của tham số do luật ở đây kiểm (E_BIND_PARAM), nên bản C++ dùng cùng schema mà không phải lặp lại miền.
//
// Mã chỉ ở bản TS (cần nội dung SVG: E_SVG_UNSAFE, E_SVG_LIMIT, W_SVG_HEAVY, W_UID_NOT_IN_SVG, W_BIND_ELEMENT_KIND,
// W_BIND_CLIP_EXISTS) được khai báo ở codes.ts; luật của chúng làm ở rules-04-svg.ts (T060), không ở đây.
import { validateValueTable } from '@mat/expression';
import { tagClassOf } from './catalog.ts';
import type { ErrorCode, Issue, WarningCode } from './codes.ts';
import {
  runRules03,
  writable,
  writeValueError,
  type Rule03Ext,
  type Rule03Input,
  type Rule03Screen,
} from './rules-03.ts';
import type { BindingCtx } from './rules-02.ts';
import { isNumericTag } from './rules.ts';
import type { Scalar, TagDataType } from './types.ts';
import type { TagV1 } from './types-02.ts';
import type { BindingSet04 } from './types-04.ts';

/** Giới hạn của 0.4 (contract §3, §6): như 0.3 trừ item `svg` (64) và hoạt ảnh vô hạn mỗi màn hình. */
export const LIMITS_04 = {
  screens: 32,
  items: 250,
  svgItems: 64,
  charts: 16,
  navLeaves: 32,
  screenTags: 1000,
  /** Hoạt ảnh vô hạn mỗi màn hình: quá số này là E_LIMIT. */
  animations: 256,
  /** Quá số này là cảnh báo W_ANIM_MANY. */
  animWarn: 64,
  ranges: 64,
} as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const cpLen = (s: string) => [...s].length;

// ---- Bảng của contract §5 ----

/** Nhóm đích: một binding mỗi nhóm trên một phần tử (E_DUP_BINDING). */
const GROUP: Readonly<Record<string, string>> = {
  'text.content': 'text',
  'style.fill': 'fill',
  'style.stroke': 'stroke',
  'style.opacity': 'opacity',
  'style.visibility': 'visibility',
  'transform.rotate': 'rotate',
  'transform.translateX': 'translateX',
  'transform.translateY': 'translateY',
  'transform.scale': 'scale',
  'geometry.levelPercent': 'level',
  'geometry.clipLevel': 'level',
  'effect.blink': 'blink',
  'effect.flow': 'flow',
};

const NUMERIC_KINDS = ['direct', 'linearScale', 'discreteMap', 'rangeMap'];
const ALLOWED_KINDS: Readonly<Record<string, readonly string[]>> = {
  'text.content': ['direct', 'discreteMap', 'valueTable', 'rangeMap'],
  // `direct` (Tag STRING chứa màu) giữ từ 0.2 để nâng cấp 0.3 -> 0.4 không đổi binding
  'style.fill': ['direct', 'discreteMap', 'valueTable', 'rangeMap'],
  'style.stroke': ['direct', 'discreteMap', 'valueTable', 'rangeMap'],
  'style.opacity': NUMERIC_KINDS,
  'style.visibility': ['direct', 'discreteMap', 'rangeMap'],
  'transform.rotate': NUMERIC_KINDS,
  'transform.translateX': NUMERIC_KINDS,
  'transform.translateY': NUMERIC_KINDS,
  'transform.scale': NUMERIC_KINDS,
  'geometry.levelPercent': ['direct', 'linearScale'],
  'geometry.clipLevel': ['direct', 'linearScale'],
  'effect.blink': ['direct', 'discreteMap', 'rangeMap'],
  'effect.flow': NUMERIC_KINDS,
};

/** Tham số riêng của từng đích (cạnh `transform`). */
const PARAMS_OF: Readonly<Record<string, readonly string[]>> = {
  'text.content': ['format'],
  'transform.rotate': ['pivot', 'animation', 'reverse'],
  'transform.scale': ['axis', 'pivot'],
  'geometry.levelPercent': ['direction'],
  'geometry.clipLevel': ['direction'],
  'effect.blink': ['period', 'mode', 'minOpacity', 'color'],
  'effect.flow': ['dash', 'speed', 'reverse', 'byValueSign'],
};
const PARAM_KEYS = [
  'animation',
  'reverse',
  'pivot',
  'axis',
  'direction',
  'format',
  'period',
  'mode',
  'minOpacity',
  'color',
  'dash',
  'speed',
  'byValueSign',
] as const;
/** Đích nhận Tag STRING (qua `discreteMap`; `direct` chỉ cho chữ). */
const STRING_TARGETS: ReadonlySet<string> = new Set([
  'text.content',
  'style.fill',
  'style.stroke',
  'style.visibility',
]);
const TEXT_SOURCES: ReadonlySet<string> = new Set(['text.content', 'style.fill', 'style.stroke']);

const isHex = (c: string) => /^[0-9a-fA-F]$/.test(c);
const isAlpha = (c: string) => /^[A-Za-z]$/.test(c);
/** `#RGB`, `#RRGGBB` hoặc tên 3-20 chữ cái. */
export function isBlinkColor(v: unknown): boolean {
  if (!isStr(v)) return false;
  if (v.startsWith('#')) return (v.length === 4 || v.length === 7) && [...v.slice(1)].every(isHex);
  return v.length >= 3 && v.length <= 20 && [...v].every(isAlpha);
}
/** `dash`: 1-8 số không âm cách nhau một dấu cách, tổng > 0, dài ≤ 64. */
export function isDashPattern(v: unknown): boolean {
  if (!isStr(v) || v.length === 0 || v.length > 64) return false;
  const parts = v.split(' ');
  if (parts.length > 8) return false;
  let sum = 0;
  for (const p of parts) {
    if (!/^[0-9]+(\.[0-9]+)?$/.test(p)) return false;
    sum += Number(p);
  }
  return sum > 0;
}

type AddB = (code: ErrorCode, file: string, path: string, message: string) => void;
type WarnB = (code: WarningCode, file: string, path: string, message: string) => void;

/** Mô tả lỗi của một khóa tham số (không phải `format`), hoặc null. */
function paramError(key: string, v: unknown): string | null {
  switch (key) {
    case 'animation':
      return v === 'spin' ? null : "animation must be 'spin'";
    case 'reverse':
    case 'byValueSign':
      return typeof v === 'boolean' ? null : `${key} must be a boolean`;
    case 'pivot':
      return Array.isArray(v) && v.length === 2 && v.every((x) => isNum(x) && x >= 0 && x <= 1)
        ? null
        : 'pivot must be [x, y] with both in 0-1';
    case 'axis':
      return v === 'xy' || v === 'x' || v === 'y' ? null : "axis must be 'xy', 'x' or 'y'";
    case 'direction':
      return v === 'up' || v === 'down' || v === 'left' || v === 'right'
        ? null
        : 'direction must be up, down, left or right';
    case 'period':
      return typeof v === 'number' && Number.isInteger(v) && v >= 400 && v <= 5000
        ? null
        : 'period must be an integer 400-5000';
    case 'mode':
      return v === 'opacity' || v === 'fill' || v === 'stroke'
        ? null
        : "mode must be 'opacity', 'fill' or 'stroke'";
    case 'minOpacity':
      return isNum(v) && v >= 0 && v <= 0.9 ? null : 'minOpacity must be 0-0.9';
    case 'color':
      return isBlinkColor(v) ? null : 'color must be #RGB, #RRGGBB or a color name';
    case 'dash':
      return isDashPattern(v) ? null : 'dash must be 1-8 numbers separated by spaces';
    case 'speed':
      return isNum(v) && v >= 0 && v <= 300 ? null : 'speed must be 0-300';
    default:
      return `unknown parameter '${key}'`;
  }
}

/** Luật `format` của `text.content`: `[khóa, mô tả]` cho từng khóa sai. */
function formatErrors(v: unknown): Array<[string, string]> {
  if (!isObj(v)) return [['', 'format must be an object']];
  const out: Array<[string, string]> = [];
  for (const [k, x] of Object.entries(v)) {
    if (k === 'decimals') {
      if (!(typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 6))
        out.push([k, 'decimals must be an integer 0-6']);
    } else if (k === 'prefix' || k === 'suffix') {
      if (!(isStr(x) && cpLen(x) <= 16))
        out.push([k, `${k} must be a string of at most 16 characters`]);
    } else if (k === 'unitFromTag') {
      if (typeof x !== 'boolean') out.push([k, 'unitFromTag must be a boolean']);
    } else out.push([k, `unknown format key '${k}'`]);
  }
  return out;
}

/** Số hoạt ảnh vô hạn của một file binding: `spin`, `effect.blink`, `effect.flow` (mỗi binding một). */
export function countAnimations(b: BindingSet04 | undefined): number {
  let n = 0;
  for (const e of b?.elements ?? [])
    for (const x of e.bindings ?? []) {
      if (x.target === 'effect.blink' || x.target === 'effect.flow') n++;
      else if (x.target === 'transform.rotate' && x.animation === 'spin') n++;
    }
  return n;
}

export interface BindingCtx04 extends BindingCtx {
  tagInfo: ReadonlyMap<string, TagV1>;
  /** Id các màn hình của project (cho `navigate`, `popup`). */
  screens: readonly string[];
}

/** Luật của một file binding 0.4 (contract §4-§6). */
export function bindingRules04(
  bindings: BindingSet04,
  bfile: string,
  uids: ReadonlySet<string>,
  ctx: BindingCtx04,
  add: AddB,
  warn: WarnB,
  kindOf: (screenId: string) => string | undefined,
): void {
  const { tagType, tagTable, tableSet } = ctx;
  const bindingIds = new Set<string>();
  const boundUids = new Set<string>();
  bindings.elements.forEach((eb, i) => {
    const ep = `/elements/${i}`;
    if (boundUids.has(eb.elementUid))
      add(
        'E_DUP_UID',
        bfile,
        `${ep}/elementUid`,
        `elementUid '${eb.elementUid}' repeats in bindings`,
      );
    boundUids.add(eb.elementUid);
    if (!uids.has(eb.elementUid))
      add(
        'E_REF_UID',
        bfile,
        `${ep}/elementUid`,
        `elementUid '${eb.elementUid}' is not in the item`,
      );

    const groups = new Set<string>();
    (eb.bindings ?? []).forEach((b, j) => {
      const bp = `${ep}/bindings/${j}`;
      const err = (code: ErrorCode, sub: string, message: string) =>
        add(code, bfile, `${bp}${sub}`, message);
      if (bindingIds.has(b.id)) err('E_DUP_BINDING', '/id', `binding id '${b.id}' is duplicated`);
      bindingIds.add(b.id);
      if (b.target === 'component.state') {
        err('E_TARGET_UNSUPPORTED', '/target', `target '${b.target}' is not supported`);
        return;
      }
      const kind = (b.transform as { kind: string }).kind;
      if (kind === 'format' || kind === 'expression') {
        err('E_TRANSFORM_UNSUPPORTED', '/transform/kind', `transform '${kind}' is not supported`);
        return;
      }
      const group = GROUP[b.target]!;
      if (groups.has(group))
        err('E_DUP_BINDING', '/target', `two bindings of the same group '${group}' on one element`);
      groups.add(group);

      // phép biến đổi cho phép của đích
      const kindOk = ALLOWED_KINDS[b.target]!.includes(kind);
      if (!kindOk)
        err(
          'E_BIND_TRANSFORM',
          '/transform/kind',
          `transform '${kind}' is not allowed for '${b.target}'`,
        );

      // tham số
      const allowed = PARAMS_OF[b.target] ?? [];
      const raw = b as unknown as Obj;
      for (const key of PARAM_KEYS) {
        if (!(key in raw)) continue;
        const v = raw[key];
        if (!allowed.includes(key)) {
          err('E_BIND_PARAM', `/${key}`, `parameter '${key}' does not belong to '${b.target}'`);
        } else if (key === 'format') {
          for (const [k, m] of formatErrors(v))
            err('E_BIND_PARAM', k === '' ? '/format' : `/format/${k}`, m);
        } else if (
          key === 'reverse' &&
          b.target === 'transform.rotate' &&
          raw.animation !== 'spin'
        ) {
          err('E_BIND_PARAM', '/reverse', 'reverse needs animation spin');
        } else {
          const m = paramError(key, v);
          if (m !== null) err('E_BIND_PARAM', `/${key}`, m);
        }
      }
      if (
        b.target === 'effect.blink' &&
        (raw.mode === 'fill' || raw.mode === 'stroke') &&
        !('color' in raw)
      )
        err('E_BIND_PARAM', '/color', `mode '${String(raw.mode)}' needs color`);

      // rangeMap
      if (kind === 'rangeMap') rangeErrors(b.transform as { ranges: unknown[] }, bp, bfile, add);

      if (!ctx.hasTags) return;
      const t = tagType.get(b.source.tagId);
      if (!t) {
        err('E_REF_TAG', '/source/tagId', `Tag '${b.source.tagId}' does not exist`);
        return;
      }
      if (!kindOk) return; // đã báo E_BIND_TRANSFORM: bỏ kiểm kiểu theo phép biến đổi

      // kiểu Tag theo đích
      if (t === 'STRING' && !STRING_TARGETS.has(b.target)) {
        err('E_TYPE_MISMATCH', '/source/tagId', `a STRING tag cannot be used for '${b.target}'`);
        return;
      }
      const tr = b.transform;
      if (tr.kind === 'valueTable') {
        const name = tr.table ?? tagTable.get(b.source.tagId);
        if (name === undefined || !tableSet.has(name))
          err(
            'E_REF_TABLE',
            '/transform/table',
            name === undefined
              ? 'no value table (neither table nor the Tag valueTable)'
              : `value table '${name}' does not exist`,
          );
        if (t === 'STRING')
          err('E_TYPE_MISMATCH', '/transform', 'valueTable needs a numeric or BOOL tag');
        const okTarget =
          tr.output === 'text'
            ? b.target === 'text.content'
            : b.target === 'style.fill' || b.target === 'style.stroke';
        if (!okTarget)
          err(
            'E_TYPE_MISMATCH',
            '/transform/output',
            `output '${tr.output}' cannot be applied to '${b.target}'`,
          );
      } else if (tr.kind === 'linearScale') {
        if (!isNumericTag(t))
          err(
            'E_TYPE_MISMATCH',
            '/transform',
            `linearScale needs a numeric tag, '${b.source.tagId}' is ${t}`,
          );
        if (tr.inMin === tr.inMax)
          err('E_SCALE_RANGE', '/transform', 'inMin must differ from inMax');
      } else if (tr.kind === 'rangeMap') {
        if (!isNumericTag(t))
          err(
            'E_TYPE_MISMATCH',
            '/transform',
            `rangeMap needs a numeric tag, '${b.source.tagId}' is ${t}`,
          );
      } else if (tr.kind === 'discreteMap') {
        if (tr.cases.some((c) => !scalarMatches(t, c.equals)))
          err('E_TYPE_MISMATCH', '/transform/cases', `equals must have the type of tag ${t}`);
      } else if (!directAccepts(b.target, raw.animation === 'spin', t)) {
        err(
          'E_TYPE_MISMATCH',
          '/source/tagId',
          `tag ${t} cannot be used directly for '${b.target}'`,
        );
      }
    });

    // W_BLINK_ONLY: nhấp nháy là tín hiệu duy nhất (không có chữ, màu nền, màu viền cùng Tag)
    (eb.bindings ?? []).forEach((b, j) => {
      if (b.target !== 'effect.blink') return;
      const shown = (eb.bindings ?? []).some(
        (o) => TEXT_SOURCES.has(o.target) && o.source.tagId === b.source.tagId,
      );
      if (!shown)
        warn(
          'W_BLINK_ONLY',
          bfile,
          `${ep}/bindings/${j}`,
          'the blink is the only signal of this tag on the element',
        );
    });

    if (eb.events !== undefined)
      eventRules(eb.events, `${ep}/events`, bfile, ctx, add, warn, kindOf);
  });
}

const scalarMatches = (t: TagDataType, v: Scalar) =>
  t === 'BOOL'
    ? typeof v === 'boolean'
    : t === 'STRING'
      ? typeof v === 'string'
      : typeof v === 'number';

/** Kiểu Tag dùng được với `direct` cho từng đích (contract binding-animation §2). */
function directAccepts(target: string, spin: boolean, t: TagDataType): boolean {
  switch (target) {
    case 'text.content':
      return true;
    case 'style.fill':
    case 'style.stroke':
      return t === 'STRING'; // màu nằm trong Tag (như 0.2)
    case 'style.visibility':
      return t === 'BOOL' || t === 'STRING'; // STRING: 'visible' | 'hidden' (như 0.2)
    case 'transform.rotate':
      return spin ? isNumericTag(t) || t === 'BOOL' : isNumericTag(t);
    case 'effect.blink':
    case 'effect.flow':
      return isNumericTag(t) || t === 'BOOL';
    default:
      return isNumericTag(t); // opacity, translate, scale, levelPercent, clipLevel
  }
}

/** `rangeMap`: số khoảng, từng khoảng, chồng nhau (dùng lại luật của bảng giá trị). */
function rangeErrors(tr: { ranges: unknown[] }, bp: string, bfile: string, add: AddB): void {
  const ranges = Array.isArray(tr.ranges) ? tr.ranges : [];
  if (ranges.length < 1 || ranges.length > LIMITS_04.ranges)
    add('E_RANGE', bfile, `${bp}/transform/ranges`, `rangeMap needs 1-${LIMITS_04.ranges} ranges`);
  const entries = ranges.slice(0, LIMITS_04.ranges * 4).map((r) => {
    const o = isObj(r) ? r : {};
    return {
      ...(o.from !== undefined ? { from: o.from as number } : {}),
      ...(o.to !== undefined ? { to: o.to as number } : {}),
      text: '',
    };
  });
  for (const i of validateValueTable({ entries }))
    add('E_RANGE', bfile, `${bp}/transform/ranges/${i.entry}`, i.message);
}

const EVENT_KEYS: Readonly<Record<string, { all: string[]; required: string[] }>> = {
  write: { all: ['tag', 'value', 'confirm', 'minRole', 'label'], required: ['tag', 'value'] },
  toggle: { all: ['tag', 'confirm', 'minRole', 'label'], required: ['tag'] },
  pulse: {
    all: ['tag', 'value', 'durationMs', 'confirm', 'minRole', 'label'],
    required: ['tag', 'value', 'durationMs'],
  },
  navigate: { all: ['screen', 'label'], required: ['screen'] },
  popup: { all: ['screen', 'label'], required: ['screen'] },
  closePopup: { all: ['label'], required: [] },
};
const MIN_ROLES = ['operator', 'engineer', 'administrator'];

/** Luật `events` của một phần tử (contract svg-events §2). `ep` là `/elements/<i>/events`. */
function eventRules(
  ev: unknown,
  ep: string,
  bfile: string,
  ctx: BindingCtx04,
  add: AddB,
  warn: WarnB,
  kindOf: (screenId: string) => string | undefined,
): void {
  if (!isObj(ev)) return;
  const keys = Object.keys(ev);
  for (const k of keys)
    if (k !== 'click')
      add('E_EVENT_ACTION', bfile, `${ep}/${k}`, `only the click event exists, not '${k}'`);
  if (!('click' in ev)) {
    if (keys.length === 0) add('E_EVENT_ACTION', bfile, ep, 'events needs a click action');
    return;
  }
  const base = `${ep}/click`;
  const err = (code: ErrorCode, sub: string, message: string) =>
    add(code, bfile, `${base}${sub}`, message);
  const c = ev.click;
  if (!isObj(c) || !('action' in c)) {
    err('E_EVENT_ACTION', '', 'the click event needs an action');
    return;
  }
  const name = c.action;
  if (!isStr(name) || !Object.prototype.hasOwnProperty.call(EVENT_KEYS, name)) {
    err(
      'E_EVENT_ACTION',
      '/action',
      'action must be one of write, toggle, pulse, navigate, popup, closePopup',
    );
    return;
  }
  const spec = EVENT_KEYS[name]!;
  for (const k of Object.keys(c))
    if (k !== 'action' && !spec.all.includes(k))
      err('E_EVENT_ACTION', `/${k}`, `'${k}' is not a parameter of '${name}'`);
  for (const k of spec.required)
    if (!(k in c)) err('E_EVENT_ACTION', '', `action '${name}' needs '${k}'`);

  // kiểu từng trường
  const tagOk = isStr(c.tag);
  if ('tag' in c && !tagOk) err('E_EVENT_ACTION', '/tag', 'tag must be a string');
  let valueOk = false;
  if ('value' in c) {
    valueOk =
      name === 'pulse'
        ? typeof c.value === 'boolean'
        : typeof c.value === 'boolean' || isNum(c.value) || isStr(c.value);
    if (!valueOk)
      err(
        'E_EVENT_ACTION',
        '/value',
        name === 'pulse'
          ? 'pulse value must be a boolean'
          : 'value must be a boolean, number or string',
      );
  }
  if ('durationMs' in c) {
    const d = c.durationMs;
    if (!(typeof d === 'number' && Number.isInteger(d) && d >= 100 && d <= 10000))
      err('E_EVENT_ACTION', '/durationMs', 'durationMs must be an integer 100-10000');
  }
  if ('label' in c && !(isStr(c.label) && cpLen(c.label) <= 80))
    err('E_EVENT_ACTION', '/label', 'label must be a string of at most 80 characters');
  const confirmOk = !('confirm' in c) || c.confirm === 'always' || c.confirm === 'none';
  if (!confirmOk) err('E_EVENT_CONFIRM', '/confirm', "confirm must be 'always' or 'none'");
  if ('minRole' in c && !(isStr(c.minRole) && MIN_ROLES.includes(c.minRole)))
    err('E_EVENT_MINROLE', '/minRole', 'minRole must be operator, engineer or administrator');

  // Tag của hành động ghi
  if (name === 'write' || name === 'toggle' || name === 'pulse') {
    if (tagOk && ctx.hasTags) {
      const t = ctx.tagInfo.get(c.tag as string);
      if (!t) {
        err('E_EVENT_TAG', '/tag', `Tag '${String(c.tag)}' does not exist`);
      } else {
        if (!writable(t))
          err('E_EVENT_TAG', '/tag', `tag '${t.id}' is not writable (needs a real RW tag)`);
        else if ((name === 'toggle' || name === 'pulse') && tagClassOf(t.type) !== 'bool')
          err('E_EVENT_TAG', '/tag', `${name} needs a BOOL tag, '${t.id}' is ${t.type}`);
        else if (name === 'write' && valueOk) {
          const m = writeValueError(t, c.value);
          if (m !== null) err('E_EVENT_TAG', '/value', m);
        }
        if (c.confirm === 'none') {
          if (tagClassOf(t.type) !== 'bool')
            err('E_EVENT_CONFIRM', '/confirm', 'confirm none is only valid for a BOOL tag');
          else
            warn(
              'W_EVENT_CONFIRM_NONE',
              bfile,
              `${base}/confirm`,
              'confirm none skips the confirmation',
            );
        }
        if (name === 'pulse' && t.kind === 'external' && t.source?.readback !== false)
          warn(
            'W_EVENT_PULSE_READBACK',
            bfile,
            base,
            `tag '${t.id}' reads back: the pulse may be seen as a change`,
          );
      }
    }
  }
  // màn hình đích
  if ((name === 'navigate' || name === 'popup') && 'screen' in c) {
    if (!isStr(c.screen)) err('E_EVENT_ACTION', '/screen', 'screen must be a string');
    else if (!ctx.screens.includes(c.screen))
      err('E_EVENT_TARGET', '/screen', `screen '${c.screen}' does not exist`);
    else {
      const want = name === 'navigate' ? 'screen' : 'popup';
      const k = kindOf(c.screen);
      if (k !== undefined && k !== want)
        err('E_EVENT_TARGET', '/screen', `'${name}' needs a ${want}, '${c.screen}' is a ${k}`);
    }
  }
}

/** Điểm mở rộng của 0.4 cho runRules03. */
const EXT: Rule03Ext = {
  svgItems: LIMITS_04.svgItems,
  bindingRules: bindingRules04,
  screenRules(s: Rule03Screen, add, warn) {
    let anims = 0;
    s.screen.items.forEach((item, i) => {
      if (item.type !== 'svg' || item.hidden === true) return;
      anims += countAnimations(s.svg[i]?.bindings as BindingSet04 | undefined);
    });
    if (anims > LIMITS_04.animations)
      add('E_LIMIT', '/items', `more than ${LIMITS_04.animations} infinite animations`);
    if (anims > LIMITS_04.animWarn)
      warn('W_ANIM_MANY', '/items', `${anims} infinite animations on the screen`);
  },
};

export type Rule04Input = Omit<Rule03Input, 'ext'>;
export type { Rule03Screen as Rule04Screen };

/** Luật của project 0.4 (project, Tag, kết nối, bảng giá trị, logging, màn hình, item, widget, binding, sự kiện). */
export function runRules04(input: Rule04Input): { errors: Issue[]; warnings: Issue[] } {
  return runRules03({ schema: '0.4', ...input, ext: EXT });
}
