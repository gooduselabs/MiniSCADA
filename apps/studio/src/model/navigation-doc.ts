// Thao tác bất biến trên `navigation` của project.json (feature 007, T107; FR-066; research R4).
// Đường dẫn nút: `[i]` ở gốc, `[g, j]` cho mục `j` của nhóm `g`. Nhóm chỉ một cấp, ≤ 32 lá.
import type { Navigation, NavigationItem, ScreenKind } from '@mat/project-schema';

export const NAV_ICONS = [
  'home',
  'tank',
  'pump',
  'chart',
  'table',
  'gear',
  'bell',
  'bolt',
  'thermo',
  'drop',
  'valve',
  'motor',
  'list',
  'map',
  'doc',
  'user',
] as const;
export const NAV_MAX_LEAVES = 32;
export const NAV_LABEL_MAX = 40;

export type NavPath = readonly number[];
export type NavRejection =
  | 'max-leaves'
  | 'bad-label'
  | 'bad-path'
  | 'bad-target'
  | 'bad-icon'
  | 'bad-position'
  | 'nested-group'
  | 'not-a-group'
  | 'is-group';
export interface NavResult {
  nav: Navigation;
  rejected?: NavRejection;
}
export interface ScreenRef {
  id: string;
  kind: ScreenKind;
  /** Tên hiển thị, dùng làm nhãn mặc định. */
  name?: string;
}

const clone = (n: Navigation): Navigation => JSON.parse(JSON.stringify(n)) as Navigation;
const reject = (nav: Navigation, rejected: NavRejection): NavResult => ({ nav, rejected });
const isGroup = (n: NavigationItem): boolean => n.items !== undefined;
const labelOk = (label: string): boolean => {
  const len = [...label].length;
  return label.trim() !== '' && len >= 1 && len <= NAV_LABEL_MAX;
};
const iconOk = (icon: string): boolean => (NAV_ICONS as readonly string[]).includes(icon);

/** Danh sách chứa nút ở `path` (gốc hoặc `items` của nhóm) và chỉ số của nút trong đó. */
function locate(
  nav: Navigation,
  path: NavPath,
): { list: NavigationItem[]; index: number; node: NavigationItem } | null {
  if (path.length === 1) {
    const node = nav.items[path[0]!];
    return node ? { list: nav.items, index: path[0]!, node } : null;
  }
  if (path.length === 2) {
    const group = nav.items[path[0]!];
    const node = group?.items?.[path[1]!];
    return group?.items && node ? { list: group.items, index: path[1]!, node } : null;
  }
  return null;
}

/** Danh sách đích: `[]` là gốc, `[g]` là `items` của nhóm `g`. */
function listAt(nav: Navigation, parent: NavPath): { list: NavigationItem[] } | NavRejection {
  if (parent.length === 0) return { list: nav.items };
  if (parent.length > 1) return 'bad-path';
  const g = nav.items[parent[0]!];
  if (g === undefined) return 'bad-path';
  return g.items === undefined ? 'not-a-group' : { list: g.items };
}

export function countLeaves(nav: Navigation): number {
  let n = 0;
  for (const it of nav.items) n += it.items === undefined ? 1 : it.items.length;
  return n;
}

export function usesScreen(nav: Navigation, id: string): boolean {
  return nav.items.some((it) => it.screen === id || (it.items ?? []).some((c) => c.screen === id));
}

/** Menu mặc định: mỗi màn hình `screen` một lá (≤ 32), nhãn là tên (hoặc id), vị trí trái. */
export function defaultNavigation(screens: readonly ScreenRef[]): Navigation {
  const items = screens
    .filter((s) => s.kind === 'screen')
    .slice(0, NAV_MAX_LEAVES)
    .map((s) => ({
      label: s.name?.trim() ? [...s.name].slice(0, NAV_LABEL_MAX).join('') : s.id,
      screen: s.id,
    }));
  return { position: 'left', items };
}

const targetOk = (screens: readonly ScreenRef[], id: string): boolean =>
  screens.some((s) => s.id === id && s.kind === 'screen');

/** Thêm lá (mặc định cuối gốc; `parent: [g]` vào nhóm). Đích phải là màn hình `screen` có thật. */
export function addLeaf(
  nav: Navigation,
  leaf: { label: string; screen: string; icon?: string },
  screens: readonly ScreenRef[],
  at: { parent?: NavPath; index?: number } = {},
): NavResult {
  if (!labelOk(leaf.label)) return reject(nav, 'bad-label');
  if (!targetOk(screens, leaf.screen)) return reject(nav, 'bad-target');
  if (leaf.icon !== undefined && !iconOk(leaf.icon)) return reject(nav, 'bad-icon');
  const next = clone(nav);
  const dest = listAt(next, at.parent ?? []);
  if (typeof dest === 'string') return reject(nav, dest);
  if (countLeaves(nav) >= NAV_MAX_LEAVES) return reject(nav, 'max-leaves');
  const node: NavigationItem = { label: leaf.label, screen: leaf.screen };
  if (leaf.icon !== undefined) node.icon = leaf.icon;
  const idx = Math.min(dest.list.length, Math.max(0, at.index ?? dest.list.length));
  dest.list.splice(idx, 0, node);
  return { nav: next };
}

/** Thêm nhóm rỗng ở gốc (UI nên thêm lá ngay; nhóm rỗng chưa hợp lệ cho tới lúc đó). */
export function addGroup(nav: Navigation, label: string, index?: number): NavResult {
  if (!labelOk(label)) return reject(nav, 'bad-label');
  const next = clone(nav);
  const idx = Math.min(next.items.length, Math.max(0, index ?? next.items.length));
  next.items.splice(idx, 0, { label, items: [] });
  return { nav: next };
}

/** Gom các lá ở gốc thành một nhóm, đặt tại vị trí của lá đầu tiên (theo thứ tự trong menu). */
export function groupItems(nav: Navigation, paths: readonly NavPath[], label: string): NavResult {
  if (!labelOk(label)) return reject(nav, 'bad-label');
  if (paths.length === 0) return reject(nav, 'bad-path');
  const idx = new Set<number>();
  for (const p of paths) {
    if (p.length === 0) return reject(nav, 'bad-path');
    if (p.length > 1) return reject(nav, 'nested-group');
    const node = nav.items[p[0]!];
    if (node === undefined) return reject(nav, 'bad-path');
    if (isGroup(node)) return reject(nav, 'nested-group');
    idx.add(p[0]!);
  }
  const order = [...idx].sort((a, b) => a - b);
  const next = clone(nav);
  const moved = order.map((i) => next.items[i]!);
  const rest = next.items.filter((_, i) => !idx.has(i));
  rest.splice(order[0]!, 0, { label, items: moved });
  return { nav: { ...next, items: rest } };
}

export function removeAt(nav: Navigation, path: NavPath): NavResult {
  const next = clone(nav);
  const at = locate(next, path);
  if (at === null) return reject(nav, 'bad-path');
  at.list.splice(at.index, 1);
  return { nav: next };
}

export function renameAt(nav: Navigation, path: NavPath, label: string): NavResult {
  if (!labelOk(label)) return reject(nav, 'bad-label');
  const next = clone(nav);
  const at = locate(next, path);
  if (at === null) return reject(nav, 'bad-path');
  if (at.node.label === label) return { nav };
  at.node.label = label;
  return { nav: next };
}

/**
 * Kéo sắp xếp: đưa nút `path` vào danh sách `toParent` (`[]` = gốc, `[g]` = nhóm) sao cho nó ở vị trí
 * `index` trong danh sách đích sau khi chuyển (kẹp trong khoảng hợp lệ). Nhóm chỉ ở gốc; chỉ nhóm mới
 * nhận con. Không đổi vị trí thì trả đúng `nav` cũ.
 */
export function moveNode(
  nav: Navigation,
  path: NavPath,
  toParent: NavPath,
  index: number,
): NavResult {
  const next = clone(nav);
  const src = locate(next, path);
  if (src === null) return reject(nav, 'bad-path');
  const dest = listAt(next, toParent);
  if (typeof dest === 'string') return reject(nav, dest);
  if (isGroup(src.node) && toParent.length > 0) return reject(nav, 'nested-group');
  src.list.splice(src.index, 1);
  const at = Math.min(dest.list.length, Math.max(0, Math.trunc(index)));
  if (dest.list === src.list && at === src.index) return { nav };
  dest.list.splice(at, 0, src.node);
  return { nav: next };
}

/** Đổi màn hình đích của lá: chỉ màn hình `screen` có trong `screens`. */
export function setScreenAt(
  nav: Navigation,
  path: NavPath,
  screen: string,
  screens: readonly ScreenRef[],
): NavResult {
  const next = clone(nav);
  const at = locate(next, path);
  if (at === null) return reject(nav, 'bad-path');
  if (isGroup(at.node)) return reject(nav, 'is-group');
  if (!targetOk(screens, screen)) return reject(nav, 'bad-target');
  if (at.node.screen === screen) return { nav };
  at.node.screen = screen;
  return { nav: next };
}

/** Đặt biểu tượng (trong bộ 16) hoặc bỏ bằng `null`. */
export function setIconAt(nav: Navigation, path: NavPath, icon: string | null): NavResult {
  if (icon !== null && !iconOk(icon)) return reject(nav, 'bad-icon');
  const next = clone(nav);
  const at = locate(next, path);
  if (at === null) return reject(nav, 'bad-path');
  if (icon === null) delete at.node.icon;
  else at.node.icon = icon;
  return { nav: next };
}

export function setPositionOf(nav: Navigation, position: 'left' | 'top' | 'hidden'): NavResult {
  if (position !== 'left' && position !== 'top' && position !== 'hidden')
    return reject(nav, 'bad-position');
  return nav.position === position ? { nav } : { nav: { ...clone(nav), position } };
}

/** Khi xóa màn hình: bỏ các lá trỏ tới nó và nhóm vì thế trở nên rỗng. Không dính tới thì trả `nav` cũ. */
export function removeScreenRefs(nav: Navigation, id: string): Navigation {
  if (!usesScreen(nav, id)) return nav;
  const items: NavigationItem[] = [];
  for (const it of nav.items) {
    if (it.items === undefined) {
      if (it.screen !== id) items.push(it);
      continue;
    }
    const kids = it.items.filter((c) => c.screen !== id);
    if (kids.length === 0 && it.items.length > 0) continue;
    items.push({ ...it, items: kids });
  }
  return { ...nav, items };
}
