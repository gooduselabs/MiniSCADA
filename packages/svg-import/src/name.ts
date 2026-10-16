// Tên phần tử (contract svg-import §5): inkscape:label, data-name, id có nghĩa, "<thẻ> <số>". Không regex.
import { isBidiOrInvisible, isControl } from '@mat/svg-renderer';

const AUTO_TAGS = [
  'path',
  'rect',
  'g',
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline',
  'text',
  'use',
  'image',
  'tspan',
];
const MAX_NAME = 80;

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isHex = (c: number): boolean => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);

function allDigits(s: string, from = 0, to = s.length): boolean {
  if (to <= from) return false;
  for (let i = from; i < to; i++) if (!isDigit(s.charCodeAt(i))) return false;
  return true;
}

/** `_xHHHH_` thành ký tự (Illustrator, CorelDRAW): `_x0020_` thành khoảng trắng, `_x002F_` thành `/`. */
export function decodeIdEscapes(id: string): string {
  if (id.indexOf('_x') < 0) return id;
  let out = '';
  let i = 0;
  while (i < id.length) {
    if (
      id.charCodeAt(i) === 95 &&
      id.charCodeAt(i + 1) === 120 &&
      id.charCodeAt(i + 6) === 95 &&
      isHex(id.charCodeAt(i + 2)) &&
      isHex(id.charCodeAt(i + 3)) &&
      isHex(id.charCodeAt(i + 4)) &&
      isHex(id.charCodeAt(i + 5))
    ) {
      const cp = parseInt(id.slice(i + 2, i + 6), 16);
      if (cp >= 32 && !isControl(cp)) out += String.fromCodePoint(cp);
      i += 7;
    } else out += id[i++];
  }
  return out;
}

/** id do phần mềm tự sinh, không mang nghĩa (path1234, SVGID_1_, Layer_1, _0_, chỉ gồm số...). */
export function isMeaninglessId(id: string): boolean {
  if (id === '' || decodeIdEscapes(id).trim() === '') return true;
  if (allDigits(id)) return true;
  // hậu tố "-<số>" do công cụ thêm khi trùng
  let base = id;
  const dash = id.lastIndexOf('-');
  if (dash > 0 && allDigits(id, dash + 1)) base = id.slice(0, dash);
  for (const t of AUTO_TAGS) if (base.startsWith(t) && allDigits(base, t.length)) return true;
  if (base.startsWith('SVGID_') && base.endsWith('_') && allDigits(base, 6, base.length - 1))
    return true;
  if (base.startsWith('Layer_') && allDigits(base, 6)) return true;
  if (base.charCodeAt(0) === 95) {
    const end = base.endsWith('_') ? base.length - 1 : base.length;
    if (allDigits(base, 1, end)) return true;
  }
  return false;
}

/** Bỏ ký tự điều khiển, ký tự hướng và rộng 0 (U+200B-200F, U+202A-202E, U+2066-2069; F13), cắt khoảng trắng hai đầu, tối đa 80 ký tự. */
export function cleanName(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (!isControl(c) && !isBidiOrInvisible(c)) out += s[i];
  }
  out = out.trim();
  if (out.length > MAX_NAME) {
    let cut = MAX_NAME;
    const c = out.charCodeAt(cut - 1);
    if (c >= 0xd800 && c <= 0xdbff) cut--; // không cắt giữa cặp thay thế
    out = out.slice(0, cut).trim();
  }
  return out;
}

export interface NameInput {
  label?: string | null;
  dataName?: string | null;
  id?: string | null;
  tag: string;
  /** Số thứ tự (từ 1) trong các anh em cùng thẻ. */
  index: number;
}

/** Tên theo ưu tiên; `labelled` = tên đến từ nhãn thật (sẽ ghi thành `data-mat-name`). */
export function deriveName(input: NameInput): { name: string; labelled: boolean } {
  for (const v of [input.label, input.dataName]) {
    if (v) {
      const c = cleanName(v);
      if (c !== '') return { name: c, labelled: true };
    }
  }
  if (input.id && !isMeaninglessId(input.id)) {
    const c = cleanName(decodeIdEscapes(input.id));
    if (c !== '') return { name: c, labelled: true };
  }
  return { name: `${input.tag} ${input.index}`, labelled: false };
}
