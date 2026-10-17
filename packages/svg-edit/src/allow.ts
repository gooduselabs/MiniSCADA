// Allowlist trên mô hình: cùng bảng và hàm kiểm giá trị của @mat/svg-renderer (ADR-023), không bảng riêng. Dùng khi
// đọc tệp (parse.ts) và trước mỗi lệnh (command.ts). Không biểu thức chính quy.
import {
  ALLOW_ELEMENTS,
  ATTR_RULES,
  BINDABLE_ELEMENTS,
  DEFAULT_KEEP_DATA_ATTRIBUTES,
  META_ELEMENTS,
  SMIL_ELEMENTS,
  SVG_NS,
  countEffectiveTree,
  isDataAttrValue,
  parseDataImage,
  MAX_DOC_IMAGE_PIXELS,
  ruleFor,
  sanitizeStyleAttr,
  useLimitProblem,
} from '@mat/svg-renderer';
import type { DrawDoc, DrawNode, NodeId } from './node.ts';
import { isElement } from './node.ts';

export const XLINK_NS = 'http://www.w3.org/1999/xlink';
export { SVG_NS };

const KEEP_DATA: ReadonlySet<string> = new Set(DEFAULT_KEEP_DATA_ATTRIBUTES);

export type AttrVerdict = { ok: true; value: string } | { ok: false; code: string };

/** Bỏ mọi khoảng trắng và dấu `;` cuối (so hai cách viết `style`). */
function squash(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9 && c !== 10 && c !== 13) out += s[i];
  }
  while (out.endsWith(';')) out = out.slice(0, -1);
  return out;
}

/** Ký tự không biểu diễn được trong XML 1.0 (điều khiển trừ tab/xuống dòng, surrogate lẻ, U+FFFE/U+FFFF). */
export function hasInvalidXmlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) return true;
    if (c === 0xfffe || c === 0xffff) return true;
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
}

/**
 * Kiểm một thuộc tính theo allowlist. `value` trả về là giá trị sẽ lưu: giữ nguyên cách viết khi chỉ khác khoảng trắng
 * đầu cuối (và với `style`, chỉ khác khoảng trắng), ngược lại là giá trị đã chuẩn hóa của luật.
 * Mã lỗi như bộ lọc của trang (`R_*`, contract svg-import §6).
 */
export function checkAttr(tag: string, name: string, value: string, isRoot = false): AttrVerdict {
  if (hasInvalidXmlChar(value)) return { ok: false, code: 'R_VALUE_INVALID' };
  if (name === 'xmlns')
    return isRoot && value === SVG_NS ? { ok: true, value } : { ok: false, code: 'R_NAMESPACE' };
  if (name === 'xmlns:xlink')
    return isRoot && value === XLINK_NS ? { ok: true, value } : { ok: false, code: 'R_NAMESPACE' };
  if (name === 'xlink:href') return applyRule(ruleFor(tag, 'href'), value, 'href');
  if (name === 'xml:space') {
    const r = ATTR_RULES.get(tag)?.get('xml:space');
    return r ? applyRule(r, value, name) : { ok: false, code: 'R_ATTR_NOT_ALLOWED' };
  }
  if (name.indexOf(':') >= 0)
    return { ok: false, code: name.endsWith(':href') ? 'R_HREF_EXTERNAL' : 'R_ATTR_NOT_ALLOWED' };
  if (name.startsWith('data-')) {
    if (!KEEP_DATA.has(name)) return { ok: false, code: 'R_DATA_ATTR' };
    return isDataAttrValue(tag, name, value)
      ? { ok: true, value }
      : { ok: false, code: 'R_VALUE_INVALID' };
  }
  if (name === 'style') {
    const res = sanitizeStyleAttr(value);
    if (res.dropped.length > 0) return { ok: false, code: res.dropped[0].code };
    if (res.transform !== null) return { ok: false, code: 'R_CSS_PROP' };
    if (res.css === '') return { ok: false, code: 'R_VALUE_INVALID' };
    return { ok: true, value: squash(value) === squash(res.css) ? value : res.css };
  }
  const rule = ruleFor(tag, name);
  if (!rule) {
    return {
      ok: false,
      code: name.startsWith('on')
        ? 'R_EVENT_ATTR'
        : name === 'href'
          ? 'R_HREF_EXTERNAL'
          : 'R_ATTR_NOT_ALLOWED',
    };
  }
  return applyRule(rule, value, name);
}

function applyRule(
  rule: ((v: string) => string | null) | undefined,
  value: string,
  name: string,
): AttrVerdict {
  if (!rule) return { ok: false, code: 'R_ATTR_NOT_ALLOWED' };
  const norm = rule(value);
  if (norm === null) {
    const code =
      name === 'href'
        ? 'R_HREF_EXTERNAL'
        : value.toLowerCase().includes('url(')
          ? 'R_URL_EXTERNAL'
          : 'R_VALUE_INVALID';
    return { ok: false, code };
  }
  return { ok: true, value: norm === value.trim() ? value : norm };
}

/** Mã loại phần tử như bộ lọc của trang; null nếu phần tử được giữ. `a` được xử lý riêng (mở vỏ) khi đọc tệp. */
export function elementProblem(tag: string): string | null {
  if (ALLOW_ELEMENTS.has(tag)) return null;
  if (tag === 'script') return 'R_SCRIPT';
  if (tag === 'foreignObject') return 'R_FOREIGN';
  if (SMIL_ELEMENTS.has(tag)) return 'R_SMIL';
  if (META_ELEMENTS.has(tag)) return 'R_META';
  return 'R_ELEMENT_NOT_ALLOWED';
}

/** Luật đặt phần tử con (như bộ lọc): không gì nằm trong `title`; `title` chỉ dưới phần tử gắn được. */
export function placementProblem(parentTag: string, childTag: string): string | null {
  if (parentTag === 'title') return 'R_ELEMENT_NOT_ALLOWED';
  if (childTag === 'title' && !BINDABLE_ELEMENTS.has(parentTag)) return 'R_ELEMENT_NOT_ALLOWED';
  return null;
}

/** Giới hạn của bộ lọc trang (contract svg-import §10) áp cho cả tài liệu. */
export const MAX_FILTERS = 8;
export const MAX_FE = 64;
export const MAX_IMAGES = 16;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** `href` (hoặc `xlink:href`) của nút. */
export function hrefOf(n: DrawNode): string | null {
  return n.attrs.get('href') ?? n.attrs.get('xlink:href') ?? null;
}

/**
 * Kiểm giới hạn cấu trúc trên cả tài liệu: ảnh (chỉ `data:` ảnh, ≤ 16 ảnh, ≤ 2 MiB, tổng ≤ 32 triệu điểm ảnh), bộ lọc (≤ 8 `filter`, ≤ 64
 * `fe*`), bom `use` (cùng hàm đếm của trang). Trả lý do hoặc null.
 */
export function structuralProblem(doc: DrawDoc): string | null {
  let images = 0;
  let imageBytes = 0;
  let imagePixels = 0;
  let filters = 0;
  let fe = 0;
  for (const n of doc.nodes.values()) {
    if (n.tag === 'image') {
      const img = parseDataImage(hrefOf(n) ?? '');
      if (img === null) return 'ảnh không phải data: hợp lệ';
      images++;
      imageBytes += img.bytes;
      imagePixels += img.pixels;
    } else if (n.tag === 'filter') filters++;
    else if (n.tag.startsWith('fe')) fe++;
  }
  if (images > MAX_IMAGES || imageBytes > MAX_IMAGE_BYTES || imagePixels > MAX_DOC_IMAGE_PIXELS)
    return 'vượt giới hạn ảnh';
  if (filters > MAX_FILTERS || fe > MAX_FE) return 'vượt giới hạn bộ lọc';
  const eff = countEffectiveTree<NodeId>(
    doc.root,
    {
      children: (id) => doc.nodes.get(id)!.children.filter((c) => isElement(doc.nodes.get(c)!)),
      localName: (id) => doc.nodes.get(id)!.tag,
      id: (id) => doc.nodes.get(id)!.attrs.get('id') ?? null,
      useTarget: (id) => {
        const n = doc.nodes.get(id)!;
        if (n.tag !== 'use') return null;
        const h = (hrefOf(n) ?? '').trim();
        return h.charCodeAt(0) === 35 ? h.slice(1) : null;
      },
    },
    100_000,
  );
  return useLimitProblem(eff);
}
