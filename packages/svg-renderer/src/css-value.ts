// Hàm kiểm giá trị thuộc tính SVG/CSS cho allowlist (contract svg-import §3, §4; ADR-023).
// Mọi hàm viết bằng bộ quét ký tự, KHÔNG dùng biểu thức chính quy (FR-013): quyết định giữ hay bỏ
// một giá trị chỉ dựa trên so sánh mã ký tự và tra bảng. Mọi hàm thuần, không ném lỗi, không đệ quy.

import {
  isAsciiLetter,
  isControl,
  isDigit,
  isHexDigit,
  isWs,
  scanNumber,
  scanNumberList,
  skipWs,
} from './scan.ts';
import { isTransform } from './transform-parse.ts';

export { isTransform };

const MAX_PATH_LENGTH = 1024 * 1024;

const LENGTH_UNITS: ReadonlySet<string> = new Set([
  'px',
  'pt',
  'pc',
  'mm',
  'cm',
  'in',
  'em',
  'ex',
  '%',
]);

/** 148 tên màu CSS (kể cả hai cách viết gray/grey). */
const NAMED_COLORS: ReadonlySet<string> = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet ' +
    'brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan ' +
    'darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta ' +
    'darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue ' +
    'darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey ' +
    'dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray ' +
    'green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush ' +
    'lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray ' +
    'lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon ' +
    'mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin ' +
    'navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen ' +
    'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna ' +
    'silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle ' +
    'tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

const COLOR_KEYWORDS: ReadonlySet<string> = new Set(['currentcolor', 'transparent', 'inherit']);
const COLOR_FUNCTIONS: ReadonlySet<string> = new Set(['rgb', 'rgba', 'hsl', 'hsla']);

/** Số hữu hạn, |x| ≤ 1e9, toàn chuỗi (cho phép khoảng trắng hai đầu). */
export function isNumber(v: string): boolean {
  const s = v.trim();
  const n = scanNumber(s, 0);
  return n !== null && n.end === s.length;
}

/** Danh sách số cách nhau bằng khoảng trắng hoặc dấu phẩy; không rỗng. */
export function isNumberList(v: string): boolean {
  return scanNumberList(v) !== null;
}

/** Số, hoặc số kèm `%` (độ mờ, offset). */
export function isNumberOrPercent(v: string): boolean {
  const s = v.trim();
  const n = scanNumber(s, 0);
  if (n === null) return false;
  return n.end === s.length || (n.end === s.length - 1 && s.charCodeAt(n.end) === 37);
}

/** Số kèm đơn vị px, pt, pc, mm, cm, in, em, ex, % hoặc không đơn vị. */
export function isLength(v: string): boolean {
  const s = v.trim();
  const n = scanNumber(s, 0);
  if (n === null) return false;
  if (n.end === s.length) return true;
  return LENGTH_UNITS.has(s.slice(n.end).toLowerCase());
}

/** Danh sách độ dài (stroke-dasharray, x/y của text): phân cách khoảng trắng hoặc dấu phẩy. */
export function isLengthList(v: string): boolean {
  const s = v.trim();
  let i = 0;
  let count = 0;
  while (i < s.length) {
    const n = scanNumber(s, i);
    if (n === null) return false;
    let j = n.end;
    while (j < s.length && !isWs(s.charCodeAt(j)) && s.charCodeAt(j) !== 44) j++;
    if (j > n.end && !LENGTH_UNITS.has(s.slice(n.end, j).toLowerCase())) return false;
    count++;
    i = skipWs(s, j);
    if (s.charCodeAt(i) === 44) {
      i = skipWs(s, i + 1);
      if (i >= s.length) return false;
    }
  }
  return count > 0;
}

/** `#rgb` hoặc `#rrggbb`. */
export function isHexColor(v: string): boolean {
  const s = v.trim();
  if (s.charCodeAt(0) !== 35 || (s.length !== 4 && s.length !== 7)) return false;
  for (let i = 1; i < s.length; i++) if (!isHexDigit(s.charCodeAt(i))) return false;
  return true;
}

function isHexColorAny(s: string): boolean {
  const n = s.length;
  if (s.charCodeAt(0) !== 35 || (n !== 4 && n !== 5 && n !== 7 && n !== 9)) return false;
  for (let i = 1; i < n; i++) if (!isHexDigit(s.charCodeAt(i))) return false;
  return true;
}

/** `rgb()`, `rgba()`, `hsl()`, `hsla()` với số hữu hạn; không `var()`, `calc()`. */
function isColorFunction(s: string): boolean {
  let i = 0;
  while (isAsciiLetter(s.charCodeAt(i))) i++;
  if (i === 0 || s.charCodeAt(i) !== 40 || !COLOR_FUNCTIONS.has(s.slice(0, i).toLowerCase()))
    return false;
  const hsl = s.charCodeAt(0) === 104 || s.charCodeAt(0) === 72;
  i = skipWs(s, i + 1);
  let args = 0;
  for (;;) {
    const n = scanNumber(s, i);
    if (n === null) return false;
    i = n.end;
    const c = s.charCodeAt(i);
    if (c === 37) {
      i++;
    } else if (hsl && args === 0 && isAsciiLetter(c)) {
      // đơn vị góc của sắc độ: chỉ `deg`
      if (s.slice(i, i + 3).toLowerCase() !== 'deg') return false;
      i += 3;
    }
    args++;
    if (args > 4) return false;
    i = skipWs(s, i);
    const d = s.charCodeAt(i);
    if (d === 41) {
      i++;
      break;
    }
    if (d === 44 || d === 47) i = skipWs(s, i + 1);
    else if (i >= s.length) return false;
  }
  return args >= 3 && skipWs(s, i) === s.length;
}

/** Màu: hex 3/4/6/8, hàm màu, tên màu, `currentColor`, `transparent`, `inherit`. */
export function isColor(v: string): boolean {
  const s = v.trim();
  if (s === '') return false;
  if (s.charCodeAt(0) === 35) return isHexColorAny(s);
  const lower = s.toLowerCase();
  if (NAMED_COLORS.has(lower) || COLOR_KEYWORDS.has(lower)) return true;
  return isColorFunction(s);
}

function isIdChar(c: number): boolean {
  return isAsciiLetter(c) || isDigit(c) || c === 95 || c === 46 || c === 58 || c === 45;
}

/** `id`: bắt đầu bằng chữ cái hoặc `_`, ký tự [A-Za-z0-9_.:-], 1..128. Không cắt khoảng trắng. */
export function isId(v: string): boolean {
  if (v.length < 1 || v.length > 128) return false;
  const first = v.charCodeAt(0);
  if (!isAsciiLetter(first) && first !== 95) return false;
  for (let i = 1; i < v.length; i++) if (!isIdChar(v.charCodeAt(i))) return false;
  return true;
}

/** `data-mat-uid`: `el_` + 3..40 ký tự [a-z0-9_] (ADR-003). */
export function isUid(v: string): boolean {
  if (v.length < 6 || v.length > 43 || v.slice(0, 3) !== 'el_') return false;
  for (let i = 3; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (!((c >= 97 && c <= 122) || isDigit(c) || c === 95)) return false;
  }
  return true;
}

/** `data-mat-name`: chữ UTF-8 không ký tự điều khiển, 1..80. */
export function isName(v: string): boolean {
  if (v.length < 1 || v.length > 80) return false;
  for (let i = 0; i < v.length; i++) if (isControl(v.charCodeAt(i))) return false;
  return true;
}

/**
 * Phân tích `url(#id)` ở đầu chuỗi (khoảng trắng và nháy tùy chọn); trả id và phần còn lại sau `)`
 * đã cắt khoảng trắng. null cho mọi URL khác (ngoài, `javascript:`, `data:`, không có `#`).
 */
export function parseLocalUrl(v: string): { id: string; rest: string } | null {
  const s = v.trim();
  if (s.length < 7 || s.slice(0, 3).toLowerCase() !== 'url' || s.charCodeAt(3) !== 40) return null;
  let i = skipWs(s, 4);
  const q = s.charCodeAt(i);
  const quoted = q === 34 || q === 39;
  if (quoted) i++;
  if (s.charCodeAt(i) !== 35) return null;
  const start = ++i;
  while (i < s.length && isIdChar(s.charCodeAt(i))) i++;
  const id = s.slice(start, i);
  if (!isId(id)) return null;
  if (quoted) {
    if (s.charCodeAt(i) !== q) return null;
    i++;
  }
  i = skipWs(s, i);
  if (s.charCodeAt(i) !== 41) return null;
  return { id, rest: s.slice(i + 1).trim() };
}

/** Toàn chuỗi là `url(#id)`. */
export function isLocalUrl(v: string): boolean {
  const p = parseLocalUrl(v);
  return p !== null && p.rest === '';
}

/** Sơn: `none`, màu, hoặc `url(#id)` kèm màu dự phòng (hoặc `none`) tùy chọn. */
export function isPaint(v: string): boolean {
  const s = v.trim();
  if (s.toLowerCase() === 'none' || isColor(s)) return true;
  const p = parseLocalUrl(s);
  if (p === null) return false;
  return p.rest === '' || p.rest.toLowerCase() === 'none' || isColor(p.rest);
}

/** `none` hoặc `url(#id)` (clip-path, mask, filter, marker-*). */
export function isUrlOrNone(v: string): boolean {
  return v.trim().toLowerCase() === 'none' || isLocalUrl(v);
}

// --- Ảnh nhúng ---------------------------------------------------------------------------------

export type DataImageMime = 'png' | 'jpeg' | 'gif' | 'webp';

function b64val(c: number): number {
  if (c >= 65 && c <= 90) return c - 65;
  if (c >= 97 && c <= 122) return c - 71;
  if (isDigit(c)) return c + 4;
  if (c === 43) return 62;
  if (c === 47) return 63;
  return -1;
}

function startsWithBytes(bytes: number[], sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
  return true;
}

const SIG_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SIG_JPEG = [0xff, 0xd8, 0xff];
const SIG_GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const SIG_GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];

function signatureMatches(mime: DataImageMime, b: number[]): boolean {
  switch (mime) {
    case 'png':
      return startsWithBytes(b, SIG_PNG);
    case 'jpeg':
      return startsWithBytes(b, SIG_JPEG);
    case 'gif':
      return startsWithBytes(b, SIG_GIF87) || startsWithBytes(b, SIG_GIF89);
    case 'webp':
      return (
        b.length >= 12 &&
        startsWithBytes(b, [0x52, 0x49, 0x46, 0x46]) &&
        b[8] === 0x57 &&
        b[9] === 0x45 &&
        b[10] === 0x42 &&
        b[11] === 0x50
      );
  }
}

/**
 * `data:image/(png|jpeg|gif|webp);base64,…`: base64 hợp lệ (cho phép ngắt dòng, đệm đúng) và chữ ký
 * tệp khớp loại khai báo. Trả loại và số byte sau giải mã; null nếu không hợp lệ.
 */
export function parseDataImage(v: string): { mime: DataImageMime; bytes: number } | null {
  const s = v.trim();
  if (s.length < 20 || s.slice(0, 11).toLowerCase() !== 'data:image/') return null;
  const semi = s.indexOf(';', 11);
  if (semi < 0) return null;
  const mime = s.slice(11, semi).toLowerCase();
  if (mime !== 'png' && mime !== 'jpeg' && mime !== 'gif' && mime !== 'webp') return null;
  if (s.slice(semi, semi + 8).toLowerCase() !== ';base64,') return null;
  let n = 0;
  let pad = 0;
  const head: number[] = [];
  for (let i = semi + 8; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (isWs(c)) continue;
    if (c === 61) {
      pad++;
      if (pad > 2) return null;
      if (head.length < 16) head.push(0);
      n++;
      continue;
    }
    if (pad > 0) return null; // dữ liệu sau dấu đệm
    const val = b64val(c);
    if (val < 0) return null;
    if (head.length < 16) head.push(val);
    n++;
  }
  if (n === 0 || n % 4 !== 0) return null;
  const bytes = (n / 4) * 3 - pad;
  const decoded: number[] = [];
  for (let g = 0; g + 3 < head.length && decoded.length < 12; g += 4) {
    const v24 = (head[g] << 18) | (head[g + 1] << 12) | (head[g + 2] << 6) | head[g + 3];
    decoded.push((v24 >> 16) & 255, (v24 >> 8) & 255, v24 & 255);
  }
  decoded.length = Math.min(decoded.length, bytes);
  if (!signatureMatches(mime, decoded)) return null;
  return { mime, bytes };
}

export function isDataImage(v: string): boolean {
  return parseDataImage(v) !== null;
}

/** `href`: `#id`, hoặc (khi `allowImage`) ảnh nhúng hợp lệ. Mọi URL khác bị từ chối. */
export function isHref(v: string, allowImage = false): boolean {
  const s = v.trim();
  if (s.charCodeAt(0) === 35) return isId(s.slice(1));
  return allowImage && isDataImage(s);
}

// --- Dữ liệu hình học ---------------------------------------------------------------------------

/** Dữ liệu `d`: lệnh MmLlHhVvCcSsQqTtAaZz và số; bắt đầu bằng M; ≤ 1 MiB. */
export function isPathData(v: string): boolean {
  if (v.length > MAX_PATH_LENGTH) return false;
  let i = 0;
  let first = true;
  const len = v.length;
  for (;;) {
    while (i < len && (isWs(v.charCodeAt(i)) || v.charCodeAt(i) === 44)) i++;
    if (i >= len) break;
    const c = v.charCodeAt(i);
    if (isAsciiLetter(c)) {
      const ch = v[i];
      if ('MmLlHhVvCcSsQqTtAaZz'.indexOf(ch) < 0) return false;
      if (first && ch !== 'M' && ch !== 'm') return false;
      first = false;
      i++;
    } else {
      if (first) return false;
      const n = scanNumber(v, i);
      if (n === null) return false;
      i = n.end;
    }
  }
  return !first;
}

/** `points`: danh sách số chẵn, ít nhất một điểm. */
export function isPoints(v: string): boolean {
  if (v.length > MAX_PATH_LENGTH) return false;
  const nums = scanNumberList(v);
  return nums !== null && nums.length % 2 === 0;
}

/** `viewBox`: bốn số, chiều rộng và cao không âm. */
export function isViewBox(v: string): boolean {
  const nums = scanNumberList(v);
  return nums !== null && nums.length === 4 && nums[2] >= 0 && nums[3] >= 0;
}

// --- Chữ -----------------------------------------------------------------------------------------

function isFontNameChar(c: number): boolean {
  return (
    isAsciiLetter(c) || isDigit(c) || c === 45 || c === 95 || c === 32 || (c > 127 && !isControl(c))
  );
}

/**
 * `font-family`: danh sách tên (định danh nhiều từ hoặc chuỗi trong nháy) cách nhau bằng dấu phẩy.
 * Từ chối `url`, `(`, `)`, `;`, `{`, `}`, `\`, `<`, `>`.
 */
export function isFontFamily(v: string): boolean {
  const s = v.trim();
  if (s.length === 0 || s.length > 256) return false;
  let i = 0;
  for (;;) {
    i = skipWs(s, i);
    const q = s.charCodeAt(i);
    if (q === 34 || q === 39) {
      const start = ++i;
      while (i < s.length && s.charCodeAt(i) !== q) {
        const c = s.charCodeAt(i);
        if (
          isControl(c) ||
          c === 92 ||
          c === 40 ||
          c === 41 ||
          c === 59 ||
          c === 123 ||
          c === 125 ||
          c === 60 ||
          c === 62
        )
          return false;
        i++;
      }
      if (i >= s.length || i === start) return false;
      i++;
    } else {
      const start = i;
      while (i < s.length && isFontNameChar(s.charCodeAt(i))) i++;
      const name = s.slice(start, i).trim();
      if (name === '' || name.toLowerCase() === 'url') return false;
    }
    i = skipWs(s, i);
    if (i >= s.length) return true;
    if (s.charCodeAt(i) !== 44) return false;
    i++;
  }
}

// --- Bộ tách từ vựng CSS ---------------------------------------------------------------------

export interface CssDeclaration {
  /** Tên thuộc tính đã giải escape, chữ thường. */
  prop: string;
  /** Giá trị đã giải escape MỘT lần, đã cắt khoảng trắng, không còn `!important`. */
  value: string;
  important: boolean;
}

const MAX_PAREN_DEPTH = 32;

/** Giải escape CSS một lần: `\75` hoặc `\75 ` thành ký tự, `\x` thành `x`. */
function decodeEscapes(s: string): string {
  if (s.indexOf('\\') < 0) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c !== 92) {
      out += s[i++];
      continue;
    }
    i++;
    if (i >= s.length) break; // `\` ở cuối: bỏ
    if (isHexDigit(s.charCodeAt(i))) {
      let j = i;
      while (j < s.length && j - i < 6 && isHexDigit(s.charCodeAt(j))) j++;
      const cp = parseInt(s.slice(i, j), 16);
      i = j;
      if (i < s.length && isWs(s.charCodeAt(i))) i++;
      out +=
        cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : '�';
    } else {
      out += s[i++];
    }
  }
  return out;
}

/**
 * Tách danh sách khai báo của thuộc tính `style` (hoặc phần thân của một luật): bỏ bình luận, tôn trọng
 * chuỗi, dấu ngoặc và `\` thoát khi tìm `;` và `:`, giải escape một lần. Không đệ quy; khai báo hỏng
 * (không có `:`, rỗng, chuỗi hoặc ngoặc không đóng) bị bỏ, không ném lỗi.
 */
export function parseDeclarations(css: string): CssDeclaration[] {
  const out: CssDeclaration[] = [];
  const n = css.length;
  let seg = '';
  let valid = true;
  let depth = 0;
  let i = 0;

  const flush = (): void => {
    if (valid && depth === 0) {
      const d = toDeclaration(seg);
      if (d) out.push(d);
    }
    seg = '';
    valid = true;
    depth = 0;
  };

  while (i < n) {
    const c = css.charCodeAt(i);
    if (c === 47 && css.charCodeAt(i + 1) === 42) {
      const end = css.indexOf('*/', i + 2);
      if (end < 0) {
        // bình luận không đóng: bỏ phần còn lại, khai báo đang dở không tính
        valid = false;
        break;
      }
      seg += ' ';
      i = end + 2;
    } else if (c === 34 || c === 39) {
      let j = i + 1;
      while (j < n && css.charCodeAt(j) !== c) j += css.charCodeAt(j) === 92 ? 2 : 1;
      if (j >= n) {
        valid = false;
        break;
      }
      seg += css.slice(i, j + 1);
      i = j + 1;
    } else if (c === 92) {
      seg += css.slice(i, i + 2);
      i += 2;
    } else if (c === 40) {
      depth++;
      if (depth > MAX_PAREN_DEPTH) valid = false;
      seg += '(';
      i++;
    } else if (c === 41) {
      if (depth > 0) depth--;
      seg += ')';
      i++;
    } else if (c === 59 && depth === 0) {
      flush();
      i++;
    } else {
      seg += css[i];
      i++;
    }
  }
  if (valid) flush();
  return out;
}

function toDeclaration(seg: string): CssDeclaration | null {
  // Tìm ':' đầu tiên không bị `\` thoát và không nằm trong chuỗi/ngoặc (tên thuộc tính không có chúng).
  let colon = -1;
  for (let i = 0; i < seg.length; i++) {
    const c = seg.charCodeAt(i);
    if (c === 92) {
      i++;
    } else if (c === 58) {
      colon = i;
      break;
    } else if (c === 34 || c === 39 || c === 40) {
      return null;
    }
  }
  if (colon < 0) return null;
  const prop = decodeEscapes(seg.slice(0, colon)).trim().toLowerCase();
  let value = decodeEscapes(seg.slice(colon + 1)).trim();
  if (prop === '' || value === '') return null;
  let important = false;
  if (value.length >= 10 && value.slice(-9).toLowerCase() === 'important') {
    let k = value.length - 10;
    while (k >= 0 && isWs(value.charCodeAt(k))) k--;
    if (k >= 0 && value.charCodeAt(k) === 33) {
      important = true;
      value = value.slice(0, k).trim();
      if (value === '') return null;
    }
  }
  return { prop, value, important };
}
