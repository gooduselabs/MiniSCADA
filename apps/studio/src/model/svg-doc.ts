// Tài liệu SVG của item `svg` (feature 008, T057; contract studio-svg-editor §1): tên file `graphics/<slug>.svg`, cây phần
// tử dựng từ `ElementInfo` của importer, đổi tên phần tử bằng cách ghi `data-mat-name` qua bộ ghi tất định của
// @mat/svg-import (không XMLSerializer, không innerHTML). Hàm thuần; phần ghi vào project do `store.applyChange` làm
// thành một bước hoàn tác.
import type { ScreenModel, SvgItem } from '@mat/project-schema';
import { parseXml, writeSvg, type ElementInfo } from '@mat/svg-import';
import { fold } from '../i18n/index.ts';
import type { StoreChange } from './import-flow.ts';

export const SLUG_MAX = 48;
export const NAME_MAX = 80;
const FALLBACK_SLUG = 'do-hoa';
const UID_SAFE = /^[A-Za-z0-9_-]{1,64}$/;

/** `<slug>`: tên file gốc không dấu, chữ thường, số, dấu gạch ngang, ≤ 48 ký tự; rỗng thì `do-hoa`. */
export function svgSlug(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.svg$/i, '');
  const slug = fold(base)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
  return slug === '' ? FALLBACK_SLUG : slug;
}

/** `graphics/<slug>.svg` chưa có trong `taken` (so không phân biệt hoa thường); trùng thì `-2`, `-3`. */
export function uniqueSvgPath(fileName: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const p of taken) used.add(p.toLowerCase());
  const slug = svgSlug(fileName);
  const path = (s: string) => `graphics/${s}.svg`;
  if (!used.has(path(slug))) return path(slug);
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const s = slug.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '') + suffix;
    if (!used.has(path(s))) return path(s);
  }
}

export interface ElementNode extends ElementInfo {
  children: ElementNode[];
}

/** Cây phần tử theo `parent`; giữ thứ tự tài liệu; phần tử có cha không có trong danh sách thì thành gốc. */
export function elementTree(elements: readonly ElementInfo[]): ElementNode[] {
  const nodes = new Map<string, ElementNode>();
  for (const e of elements) nodes.set(e.uid, { ...e, children: [] });
  const roots: ElementNode[] = [];
  for (const e of elements) {
    const node = nodes.get(e.uid)!;
    const parent = e.parent === null ? undefined : nodes.get(e.parent);
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Duyệt trước (cha trước con). */
export function flattenTree(tree: readonly ElementNode[]): ElementNode[] {
  const out: ElementNode[] = [];
  const stack = [...tree].reverse();
  while (stack.length > 0) {
    const n = stack.pop()!;
    out.push(n);
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]!);
  }
  return out;
}

/** Tên sạch: bỏ ký tự điều khiển, cắt khoảng trắng, tối đa 80 ký tự (theo điểm mã). */
export function cleanName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const s = name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return [...s].slice(0, NAME_MAX).join('').trim();
}

/**
 * Ghi `data-mat-name` cho phần tử `uid` (tên rỗng thì gỡ thuộc tính) và trả SVG mới bằng bộ ghi tất định. `null` khi
 * không có phần tử đó hoặc văn bản không phải SVG hợp lệ.
 */
export function renameElementInSvg(svgText: string, uid: string, name: string): string | null {
  if (!UID_SAFE.test(uid)) return null;
  const parsed = parseXml(svgText);
  if (!parsed.ok) return null;
  const target = parsed.root.querySelector(`[data-mat-uid="${uid}"]`);
  if (!target) return null;
  const clean = cleanName(name);
  if (clean === '') target.removeAttribute('data-mat-name');
  else target.setAttribute('data-mat-name', clean);
  return writeSvg(parsed.root);
}

export interface RenamePlan {
  change: StoreChange;
  svg: string;
}

/**
 * Đổi tên phần tử của item: SVG mới (nội dung chờ ghi) và tên trong `elements[]` của item, MỘT bước hoàn tác khi đưa
 * `change` cho `store.applyChange`. `null` khi không có item `svg` hoặc phần tử.
 */
export function planRenameElement(a: {
  screen: ScreenModel;
  itemId: string;
  svgText: string;
  uid: string;
  name: string;
}): RenamePlan | null {
  const item = a.screen.items.find((i): i is SvgItem => i.type === 'svg' && i.id === a.itemId);
  if (!item) return null;
  const svg = renameElementInSvg(a.svgText, a.uid, a.name);
  if (svg === null) return null;
  const clean = cleanName(a.name);
  const elements = item.elements.map((e) => ({ ...e }));
  const at = elements.findIndex((e) => e.elementUid === a.uid);
  if (clean !== '') {
    if (at >= 0) elements[at]!.name = clean;
    else elements.push({ elementUid: a.uid, name: clean });
  } else if (at >= 0) delete elements[at]!.name;
  const screen: ScreenModel = {
    ...a.screen,
    items: a.screen.items.map((i) => (i === item ? { ...item, elements } : i)),
  };
  return {
    svg,
    change: {
      edits: [{ kind: 'screenUpsert', screen }],
      replace: { [item.svgFile]: svg },
    },
  };
}
