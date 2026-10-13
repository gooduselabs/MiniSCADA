// Allowlist SVG của sản phẩm (Constitution V, FR-013, FR-014; ADR-023; contract svg-import §2-§4).
// Mọi quyết định giữ hay bỏ là TRA BẢNG (Set, Map) và gọi hàm kiểm giá trị của css-value.ts; không
// biểu thức chính quy; không có thuộc tính nào được giữ chỉ vì tên.

import {
  isFontFamily,
  isHref,
  isId,
  isLength,
  isLengthList,
  isNumber,
  isNumberList,
  isNumberOrPercent,
  isPaint,
  isPathData,
  isPoints,
  isColor,
  isTransform,
  isUrlOrNone,
  isViewBox,
  parseDeclarations,
} from './css-value.ts';
import { isWs } from './scan.ts';

/**
 * Luật cho một giá trị thuộc tính: trả giá trị đã chuẩn hóa (cắt khoảng trắng, có thể kẹp số) nếu
 * hợp lệ, hoặc `null` để loại thuộc tính.
 */
export type ValueRule = (value: string) => string | null;

/** Phần tử được giữ (so khớp CHÍNH XÁC `localName` và namespace SVG; có phân biệt hoa thường). */
export const ALLOW_ELEMENTS: ReadonlySet<string> = new Set([
  // cấu trúc
  'svg', 'g', 'defs', 'symbol', 'use', 'title',
  // hình
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  // chữ
  'text', 'tspan', 'textPath',
  // sơn
  'linearGradient', 'radialGradient', 'stop', 'pattern',
  // cắt, mặt nạ, mũi tên
  'clipPath', 'mask', 'marker',
  // ảnh
  'image',
  // bộ lọc
  'filter', 'feGaussianBlur', 'feOffset', 'feColorMatrix', 'feFlood', 'feComposite', 'feMerge',
  'feMergeNode', 'feBlend', 'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA',
  'feDropShadow',
]); // prettier-ignore

/** "Mở vỏ": bỏ phần tử, giữ con. */
export const UNWRAP_ELEMENTS: ReadonlySet<string> = new Set(['a']);

/** Phần tử bị loại thuộc nhóm mã lý do riêng (chỉ để báo cáo, không ảnh hưởng quyết định). */
export const SMIL_ELEMENTS: ReadonlySet<string> = new Set([
  'animate',
  'animateMotion',
  'animateTransform',
  'set',
  'mpath',
  'discard',
]);
export const META_ELEMENTS: ReadonlySet<string> = new Set(['metadata', 'desc']);

/** Phần tử gắn được (con của chúng được giữ `title`; contract §5). */
export const BINDABLE_ELEMENTS: ReadonlySet<string> = new Set([
  'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'use', 'image',
]); // prettier-ignore

/** Phần tử chứa nút chữ được giữ. */
export const TEXT_ELEMENTS: ReadonlySet<string> = new Set(['text', 'tspan', 'textPath', 'title']);

// --- Luật giá trị -------------------------------------------------------------------------------

const pred =
  (fn: (v: string) => boolean): ValueRule =>
  (v) =>
    fn(v) ? v.trim() : null;

const oneOf = (words: string[], inherit = false): ValueRule => {
  const set = new Set(words);
  if (inherit) set.add('inherit');
  return (v) => {
    const s = v.trim();
    return set.has(s) ? s : null;
  };
};

/** Danh sách từ khóa cách nhau bằng khoảng trắng (text-decoration, paint-order). */
const wordSet = (words: string[]): ValueRule => {
  const set = new Set(words);
  return (v) => {
    const parts: string[] = [];
    let cur = '';
    for (let i = 0; i <= v.length; i++) {
      if (i === v.length || isWs(v.charCodeAt(i))) {
        if (cur !== '') parts.push(cur);
        cur = '';
      } else {
        cur += v[i];
      }
    }
    if (parts.length === 0 || parts.length > 4) return null;
    for (const p of parts) if (!set.has(p)) return null;
    return parts.join(' ');
  };
};

const either =
  (a: ValueRule, b: ValueRule): ValueRule =>
  (v) =>
    a(v) ?? b(v);

const NUM = pred(isNumber);
const LEN = pred(isLength);
const LENLIST = pred(isLengthList);
const NUMLIST = pred(isNumberList);
const OPACITY = pred(isNumberOrPercent);
const COLOR = pred(isColor);
const PAINT = pred(isPaint);
const URLNONE = either(pred(isUrlOrNone), oneOf(['inherit']));
const TRANSFORM = pred(isTransform);
const VIEWBOX = pred(isViewBox);
const HREF = pred((v) => isHref(v));
const HREF_IMAGE = pred((v) => isHref(v, true));
const ID_REF = pred(isId);
const UNITS = oneOf(['userSpaceOnUse', 'objectBoundingBox']);

const ALIGN = [
  'none',
  'xMinYMin',
  'xMidYMin',
  'xMaxYMin',
  'xMinYMid',
  'xMidYMid',
  'xMaxYMid',
  'xMinYMax',
  'xMidYMax',
  'xMaxYMax',
];
const ASPECT: ValueRule = (v) => {
  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i <= v.length; i++) {
    if (i === v.length || isWs(v.charCodeAt(i))) {
      if (cur !== '') parts.push(cur);
      cur = '';
    } else {
      cur += v[i];
    }
  }
  let k = 0;
  if (parts[k] === 'defer') k++;
  if (k >= parts.length || ALIGN.indexOf(parts[k]) < 0) return null;
  k++;
  if (k < parts.length && (parts[k] === 'meet' || parts[k] === 'slice')) k++;
  return k === parts.length ? parts.join(' ') : null;
};

/** stdDeviation: một hoặc hai số không âm; kẹp ≤ 30 (nhẹ cho BL335). Trả giá trị kẹp. */
export const MAX_STD_DEVIATION = 30;
const STD_DEVIATION: ValueRule = (v) => {
  if (!isNumberList(v)) return null;
  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i <= v.length; i++) {
    const c = i < v.length ? v.charCodeAt(i) : 32;
    if (isWs(c) || c === 44) {
      if (cur !== '') parts.push(cur);
      cur = '';
    } else {
      cur += v[i];
    }
  }
  if (parts.length < 1 || parts.length > 2) return null;
  const out: string[] = [];
  for (const p of parts) {
    const x = Number(p);
    if (!(x >= 0)) return null;
    out.push(String(Math.min(x, MAX_STD_DEVIATION)));
  }
  return out.join(' ');
};

const FONT_SIZE_WORDS = [
  'xx-small',
  'x-small',
  'small',
  'medium',
  'large',
  'x-large',
  'xx-large',
  'smaller',
  'larger',
];

/** Thuộc tính trình bày (dùng chung mọi phần tử giữ; cũng là bảng giá trị cho `style`). */
export const PRESENTATION: ReadonlyMap<string, ValueRule> = new Map<string, ValueRule>([
  ['fill', PAINT],
  ['fill-opacity', OPACITY],
  ['fill-rule', oneOf(['nonzero', 'evenodd'], true)],
  ['stroke', PAINT],
  ['stroke-width', LEN],
  ['stroke-opacity', OPACITY],
  ['stroke-linecap', oneOf(['butt', 'round', 'square'], true)],
  ['stroke-linejoin', oneOf(['miter', 'round', 'bevel', 'miter-clip', 'arcs'], true)],
  ['stroke-miterlimit', NUM],
  ['stroke-dasharray', either(oneOf(['none', 'inherit']), LENLIST)],
  ['stroke-dashoffset', LEN],
  ['opacity', OPACITY],
  ['display', oneOf(['none', 'inline', 'block', 'inline-block'], true)],
  ['visibility', oneOf(['visible', 'hidden', 'collapse'], true)],
  ['clip-path', URLNONE],
  ['clip-rule', oneOf(['nonzero', 'evenodd'], true)],
  ['mask', URLNONE],
  ['filter', URLNONE],
  ['marker-start', URLNONE],
  ['marker-mid', URLNONE],
  ['marker-end', URLNONE],
  ['color', COLOR],
  ['stop-color', COLOR],
  ['stop-opacity', OPACITY],
  ['flood-color', COLOR],
  ['flood-opacity', OPACITY],
  ['font-family', pred(isFontFamily)],
  ['font-size', either(oneOf(FONT_SIZE_WORDS, true), LEN)],
  ['font-style', oneOf(['normal', 'italic', 'oblique'], true)],
  [
    'font-weight',
    oneOf(
      ['normal', 'bold', 'bolder', 'lighter', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
      true,
    ),
  ],
  [
    'font-stretch',
    either(
      oneOf(
        [
          'normal',
          'ultra-condensed',
          'extra-condensed',
          'condensed',
          'semi-condensed',
          'semi-expanded',
          'expanded',
          'extra-expanded',
          'ultra-expanded',
        ],
        true,
      ),
      OPACITY,
    ),
  ],
  ['text-anchor', oneOf(['start', 'middle', 'end'], true)],
  ['text-decoration', wordSet(['none', 'underline', 'overline', 'line-through'])],
  ['letter-spacing', either(oneOf(['normal', 'inherit']), LEN)],
  ['word-spacing', either(oneOf(['normal', 'inherit']), LEN)],
  [
    'dominant-baseline',
    oneOf(
      [
        'auto',
        'text-bottom',
        'alphabetic',
        'ideographic',
        'middle',
        'central',
        'mathematical',
        'hanging',
        'text-top',
        'use-script',
        'no-change',
        'reset-size',
      ],
      true,
    ),
  ],
  [
    'alignment-baseline',
    oneOf(
      [
        'auto',
        'baseline',
        'before-edge',
        'after-edge',
        'text-before-edge',
        'text-after-edge',
        'middle',
        'central',
        'alphabetic',
        'ideographic',
        'mathematical',
        'hanging',
      ],
      true,
    ),
  ],
  ['baseline-shift', either(oneOf(['baseline', 'sub', 'super', 'inherit']), LEN)],
  ['writing-mode', oneOf(['lr-tb', 'rl-tb', 'tb-rl', 'lr', 'rl', 'tb', 'horizontal-tb', 'vertical-rl', 'vertical-lr'], true)],
  ['direction', oneOf(['ltr', 'rtl'], true)],
  ['shape-rendering', oneOf(['auto', 'optimizeSpeed', 'crispEdges', 'geometricPrecision'], true)],
  ['text-rendering', oneOf(['auto', 'optimizeSpeed', 'optimizeLegibility', 'geometricPrecision'], true)],
  ['image-rendering', oneOf(['auto', 'optimizeSpeed', 'optimizeQuality', 'pixelated', 'crisp-edges'], true)],
  ['color-interpolation-filters', oneOf(['auto', 'sRGB', 'linearRGB'], true)],
  ['paint-order', wordSet(['normal', 'fill', 'stroke', 'markers'])],
  [
    'vector-effect',
    oneOf(['none', 'non-scaling-stroke', 'non-scaling-size', 'non-rotation', 'fixed-position'], true),
  ],
]); // prettier-ignore

/** Thuộc tính CSS được đọc từ `style` hoặc luật `<style>`: thuộc tính trình bày cộng `transform`. */
export const CSS_PROPS: ReadonlySet<string> = new Set([...PRESENTATION.keys(), 'transform']);

/** Thuộc tính dùng chung mọi phần tử giữ (ngoài `style`, `data-mat-*`, thuộc tính trình bày). */
export const COMMON_ATTRS: ReadonlyMap<string, ValueRule> = new Map<string, ValueRule>([
  ['id', ID_REF],
  ['transform', TRANSFORM],
]);

const FE_COMMON: Record<string, ValueRule> = {
  x: LEN,
  y: LEN,
  width: LEN,
  height: LEN,
  result: ID_REF,
};
const FUNC_ATTRS: Record<string, ValueRule> = {
  type: oneOf(['identity', 'table', 'discrete', 'linear', 'gamma']),
  tableValues: NUMLIST,
  slope: NUM,
  intercept: NUM,
  amplitude: NUM,
  exponent: NUM,
  offset: NUM,
};

const RAW_RULES: Record<string, Record<string, ValueRule>> = {
  svg: { viewBox: VIEWBOX, preserveAspectRatio: ASPECT, width: LEN, height: LEN, x: LEN, y: LEN },
  g: {},
  defs: {},
  title: {},
  rect: { x: LEN, y: LEN, width: LEN, height: LEN, rx: LEN, ry: LEN },
  circle: { cx: LEN, cy: LEN, r: LEN },
  ellipse: { cx: LEN, cy: LEN, rx: LEN, ry: LEN },
  line: { x1: LEN, y1: LEN, x2: LEN, y2: LEN },
  polyline: { points: pred(isPoints) },
  polygon: { points: pred(isPoints) },
  path: { d: pred(isPathData) },
  text: {
    x: LENLIST,
    y: LENLIST,
    dx: LENLIST,
    dy: LENLIST,
    rotate: NUMLIST,
    'xml:space': oneOf(['default', 'preserve']),
  },
  tspan: {
    x: LENLIST,
    y: LENLIST,
    dx: LENLIST,
    dy: LENLIST,
    rotate: NUMLIST,
    'xml:space': oneOf(['default', 'preserve']),
  },
  textPath: {
    href: HREF,
    startOffset: LEN,
    method: oneOf(['align', 'stretch']),
    spacing: oneOf(['auto', 'exact']),
  },
  use: { x: LEN, y: LEN, width: LEN, height: LEN, href: HREF },
  image: { x: LEN, y: LEN, width: LEN, height: LEN, href: HREF_IMAGE, preserveAspectRatio: ASPECT },
  symbol: { viewBox: VIEWBOX, preserveAspectRatio: ASPECT, refX: LEN, refY: LEN },
  marker: {
    markerWidth: LEN,
    markerHeight: LEN,
    refX: LEN,
    refY: LEN,
    orient: either(oneOf(['auto', 'auto-start-reverse']), NUM),
    markerUnits: oneOf(['strokeWidth', 'userSpaceOnUse']),
    viewBox: VIEWBOX,
    preserveAspectRatio: ASPECT,
  },
  pattern: {
    x: LEN,
    y: LEN,
    width: LEN,
    height: LEN,
    patternUnits: UNITS,
    patternContentUnits: UNITS,
    patternTransform: TRANSFORM,
    viewBox: VIEWBOX,
    preserveAspectRatio: ASPECT,
    href: HREF,
  },
  linearGradient: {
    x1: LEN,
    y1: LEN,
    x2: LEN,
    y2: LEN,
    gradientUnits: UNITS,
    gradientTransform: TRANSFORM,
    spreadMethod: oneOf(['pad', 'reflect', 'repeat']),
    href: HREF,
  },
  radialGradient: {
    cx: LEN,
    cy: LEN,
    r: LEN,
    fx: LEN,
    fy: LEN,
    fr: LEN,
    gradientUnits: UNITS,
    gradientTransform: TRANSFORM,
    spreadMethod: oneOf(['pad', 'reflect', 'repeat']),
    href: HREF,
  },
  stop: { offset: OPACITY },
  clipPath: { clipPathUnits: UNITS },
  mask: { maskUnits: UNITS, maskContentUnits: UNITS, x: LEN, y: LEN, width: LEN, height: LEN },
  filter: { x: LEN, y: LEN, width: LEN, height: LEN, filterUnits: UNITS, primitiveUnits: UNITS },
  feGaussianBlur: { ...FE_COMMON, in: ID_REF, stdDeviation: STD_DEVIATION },
  feOffset: { ...FE_COMMON, in: ID_REF, dx: NUM, dy: NUM },
  feColorMatrix: {
    ...FE_COMMON,
    in: ID_REF,
    type: oneOf(['matrix', 'saturate', 'hueRotate', 'luminanceToAlpha']),
    values: NUMLIST,
  },
  feFlood: { ...FE_COMMON },
  feComposite: {
    ...FE_COMMON,
    in: ID_REF,
    in2: ID_REF,
    operator: oneOf(['over', 'in', 'out', 'atop', 'xor', 'arithmetic', 'lighter']),
    k1: NUM,
    k2: NUM,
    k3: NUM,
    k4: NUM,
  },
  feMerge: { ...FE_COMMON },
  feMergeNode: { in: ID_REF },
  feBlend: {
    ...FE_COMMON,
    in: ID_REF,
    in2: ID_REF,
    mode: oneOf(['normal', 'multiply', 'screen', 'darken', 'lighten']),
  },
  feComponentTransfer: { ...FE_COMMON, in: ID_REF },
  feFuncR: FUNC_ATTRS,
  feFuncG: FUNC_ATTRS,
  feFuncB: FUNC_ATTRS,
  feFuncA: FUNC_ATTRS,
  feDropShadow: { ...FE_COMMON, in: ID_REF, dx: NUM, dy: NUM, stdDeviation: STD_DEVIATION },
};

/** Luật thuộc tính riêng của từng phần tử (hình học và tham số). */
export const ATTR_RULES: ReadonlyMap<string, ReadonlyMap<string, ValueRule>> = new Map(
  Object.entries(RAW_RULES).map(([el, rules]) => [el, new Map(Object.entries(rules))]),
);

/** Tra luật của thuộc tính `attr` trên phần tử `el`: riêng phần tử, rồi chung, rồi trình bày. */
export function ruleFor(el: string, attr: string): ValueRule | undefined {
  return ATTR_RULES.get(el)?.get(attr) ?? COMMON_ATTRS.get(attr) ?? PRESENTATION.get(attr);
}

// --- style --------------------------------------------------------------------------------------

export interface StyleResult {
  /** `prop:value;prop:value` đã chuẩn hóa (không `!important`, không `transform`). */
  css: string;
  /** Giá trị `transform` hợp lệ lấy ra từ style (để chuyển thành thuộc tính), hoặc null. */
  transform: string | null;
  /** Khai báo bị bỏ, kèm mã lý do. */
  dropped: Array<{ prop: string; code: 'R_CSS_PROP' | 'R_URL_EXTERNAL' | 'R_VALUE_INVALID' }>;
}

/**
 * Chuẩn hóa thuộc tính `style` qua bộ tách từ vựng: giữ khai báo có thuộc tính trong CSS_PROPS và giá
 * trị qua cùng luật với thuộc tính trình bày (`url()` chỉ `#id`).
 */
export function sanitizeStyleAttr(css: string): StyleResult {
  const kept: string[] = [];
  const dropped: StyleResult['dropped'] = [];
  let transform: string | null = null;
  for (const d of parseDeclarations(css)) {
    if (!CSS_PROPS.has(d.prop)) {
      dropped.push({ prop: d.prop, code: 'R_CSS_PROP' });
      continue;
    }
    if (d.prop === 'transform') {
      if (isTransform(d.value)) transform = d.value;
      else dropped.push({ prop: d.prop, code: 'R_VALUE_INVALID' });
      continue;
    }
    const norm = PRESENTATION.get(d.prop)!(d.value);
    if (norm === null) {
      dropped.push({
        prop: d.prop,
        code: d.value.toLowerCase().includes('url(') ? 'R_URL_EXTERNAL' : 'R_VALUE_INVALID',
      });
      continue;
    }
    kept.push(d.prop + ':' + norm);
  }
  return { css: kept.join(';'), transform, dropped };
}
