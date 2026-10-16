// Đọc cây phần tử SVG đã dựng của một item `svg` (feature 008, T070/T071; contract studio-svg-editor §10). Hàm thuần trên
// giao diện DOM tối thiểu (`Element`): không sửa DOM, không dùng `innerHTML`. Mọi duyệt đều lặp (không đệ quy) vì cây có thể sâu
// 32 cấp nhưng rộng 20.000 nút. Chỉ phần tử có `data-mat-uid` là "phần tử gắn được"; thẻ trung gian không có UID bị bỏ qua khi
// dựng cây (con của nó nối lên cha gần nhất có UID).
import { fold } from '../i18n/index.ts';
import type { ElementKind } from './animation-catalog.ts';
import { UID_ATTR } from './svg-select.ts';

export const NAME_ATTR = 'data-mat-name';

const isUidChar = (c: string): boolean =>
  (c >= 'a' && c <= 'z') ||
  (c >= 'A' && c <= 'Z') ||
  (c >= '0' && c <= '9') ||
  c === '_' ||
  c === '-';

/** UID hợp lệ để đưa vào bộ chọn thuộc tính (allowlist ký tự; không dựng bộ chọn từ chuỗi lạ). */
export function isSafeUid(uid: string): boolean {
  if (uid === '' || uid.length > 64) return false;
  for (const c of uid) if (!isUidChar(c)) return false;
  return true;
}

/** Phần tử có UID trong `root` (SVG gốc hoặc ShadowRoot); `null` khi không có. */
export function findByUid(root: ParentNode, uid: string): Element | null {
  if (!isSafeUid(uid)) return null;
  return root.querySelector(`[${UID_ATTR}="${uid}"]`);
}

const paintNone = (el: Element, prop: 'fill' | 'stroke'): boolean => {
  const style = el.getAttribute('style') ?? '';
  const at = style.indexOf(`${prop}:`);
  if (at >= 0) {
    const end = style.indexOf(';', at);
    const v = style.slice(at + prop.length + 1, end < 0 ? undefined : end).trim();
    return v === 'none';
  }
  return el.getAttribute(prop) === 'none';
};

/** Loại phần tử cho danh mục động hóa (contract §5): `line` = đường, đường gấp khúc, path chỉ có nét. */
export function elementKindOf(el: Element): ElementKind {
  const tag = el.localName;
  switch (tag) {
    case 'text':
    case 'tspan':
      return 'text';
    case 'rect':
      return 'rect';
    case 'line':
    case 'polyline':
      return 'line';
    case 'path': {
      const hasStroke =
        el.hasAttribute('stroke') || (el.getAttribute('style') ?? '').includes('stroke:');
      return paintNone(el, 'fill') && hasStroke && !paintNone(el, 'stroke') ? 'line' : 'shape';
    }
    case 'g':
    case 'svg':
    case 'a':
    case 'switch':
      return 'group';
    default:
      return 'shape';
  }
}

/** Tên hiển thị: `data-mat-name`, không có thì thẻ và UID. */
export const nameOfElement = (el: Element): string => {
  const n = el.getAttribute(NAME_ATTR);
  return n !== null && n.trim() !== '' ? n.trim() : '';
};

/** Phần tử con gần nhất có UID (bỏ qua thẻ trung gian không UID), theo thứ tự tài liệu. */
export function uidChildren(parent: Element): Element[] {
  const out: Element[] = [];
  const stack: Element[] = [];
  for (let i = parent.children.length - 1; i >= 0; i--) stack.push(parent.children[i]!);
  while (stack.length > 0) {
    const el = stack.pop()!;
    if (el.hasAttribute(UID_ATTR)) {
      out.push(el);
      continue;
    }
    for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]!);
  }
  return out;
}

/** UID của tổ tiên có UID, từ ngoài vào trong, tính tới (không gồm) `el`. */
export function uidAncestors(el: Element, stop: Element | null): string[] {
  const out: string[] = [];
  let cur = el.parentElement;
  while (cur !== null && cur !== stop) {
    const u = cur.getAttribute(UID_ATTR);
    if (u !== null && u !== '') out.push(u);
    cur = cur.parentElement;
  }
  return out.reverse();
}

export interface TreeRow {
  uid: string;
  depth: number;
  tag: string;
  name: string;
  hasChildren: boolean;
  expanded: boolean;
  el: Element;
}

const rowOf = (el: Element, depth: number, expanded: ReadonlySet<string>): TreeRow => {
  const uid = el.getAttribute(UID_ATTR) ?? '';
  const hasChildren = el.querySelector(`[${UID_ATTR}]`) !== null;
  return {
    uid,
    depth,
    tag: el.localName,
    name: nameOfElement(el),
    hasChildren,
    expanded: hasChildren && expanded.has(uid),
    el,
  };
};

/**
 * Các dòng đang thấy của cây: cấp trên cùng cộng con của các nút đã mở (`expanded`). Dựng lười: nút đóng không bị duyệt.
 * `svg` là phần tử `<svg>` gốc của item.
 */
export function flattenTree(svg: Element, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const stack: Array<{ el: Element; depth: number }> = [];
  const top = uidChildren(svg);
  for (let i = top.length - 1; i >= 0; i--) stack.push({ el: top[i]!, depth: 0 });
  while (stack.length > 0) {
    const { el, depth } = stack.pop()!;
    const row = rowOf(el, depth, expanded);
    rows.push(row);
    if (row.expanded) {
      const kids = uidChildren(el);
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ el: kids[i]!, depth: depth + 1 });
    }
  }
  return rows;
}

/** Tối đa dòng kết quả lọc (danh sách dài hơn thì người dùng gõ thêm cho hẹp). */
export const FILTER_LIMIT = 500;

/**
 * Lọc phẳng theo tên, thẻ hoặc UID (không dấu, không phân biệt hoa thường); `bound` đưa lên đầu khi tên trùng như nhau không
 * cần: giữ thứ tự tài liệu. Trả tối đa `FILTER_LIMIT` dòng và tổng số khớp.
 */
export function filterTree(svg: Element, query: string): { rows: TreeRow[]; total: number } {
  const q = fold(query.trim());
  const rows: TreeRow[] = [];
  let total = 0;
  const all = svg.querySelectorAll(`[${UID_ATTR}]`);
  const none: ReadonlySet<string> = new Set();
  for (const el of all) {
    const uid = el.getAttribute(UID_ATTR) ?? '';
    const hay = `${fold(nameOfElement(el))}\n${el.localName}\n${fold(uid)}`;
    if (q !== '' && !hay.includes(q)) continue;
    total++;
    if (rows.length < FILTER_LIMIT) rows.push({ ...rowOf(el, 0, none), hasChildren: false });
  }
  return { rows, total };
}

/** Viền chữ nhật của phần tử theo `getBoundingClientRect`; `null` khi phần tử không có hộp (không dựng). */
export function clientRectOf(
  el: Element,
): { left: number; top: number; width: number; height: number } | null {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}
