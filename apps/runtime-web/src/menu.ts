// Menu điều hướng của trang vận hành (feature 007, FR-013; data-model §7).
//  - `buildMenu` (thuần): dựng mô hình từ `navigation` của project và danh sách màn hình. Một mục màn hình duy nhất
//    thì không có menu; `position: hidden` thì không có menu; không khai báo mục nào thì danh sách tự động mọi màn hình
//    và báo cáo. Mục trỏ màn hình không có/popup, nhóm rỗng và biểu tượng lạ bị bỏ (validator đã chặn; lớp phòng thủ).
//  - Feature 030: menu 100 % theo cấu hình. Trang hệ thống (Alarm, Lịch sử alarm, Lịch sử, Công thức, Quản trị) chỉ có
//    khi `navigation.items` khai báo mục `system`; mục bị bỏ khi tính năng tương ứng không có (Quản trị: chỉ administrator).
//    Project dưới 1.1 không khai báo được mục `system`: `legacySystem` giữ cách tự thêm cũ để project đã triển khai không mất trang.
//  - `renderMenu`: <nav> với danh sách (nhóm một cấp), mỗi mục lá là <button>; `aria-current="page"` ở mục đang hiện.
import type { Navigation, NavigationItem, SystemPageId } from '@mat/project-schema';
import { vi } from './i18n/vi.ts';
import { viHist } from './i18n/vi-history.ts';
import { viRecipe } from './i18n/vi-recipe.ts';
import { createIcon, isIconName, type IconName } from './icons.ts';
import type { ScreenSummary } from './project-store.ts';

export interface MenuLeaf {
  label: string;
  screen: string;
  icon?: IconName;
  /** Mục trang hệ thống (alarms, alarm-history, @history, @recipes, @quan-tri); `badge`: huy hiệu số alarm, `note`: chú thích. */
  system?: true;
  badge?: boolean;
  note?: string;
}
export type MenuEntry =
  | ({ kind: 'item' } & MenuLeaf)
  | { kind: 'group'; label: string; icon?: IconName; items: MenuLeaf[] };

export interface MenuModel {
  position: 'left' | 'top';
  entries: MenuEntry[];
}

/** Trang lịch sử và báo cáo (feature 010): khóa mục là `@history`, `@report/<id>`. */
export interface MenuExtra {
  reports?: readonly { id: string; name: string }[];
  /** Mục `system: history` dùng được (lưu trữ bật và có phiên). */
  history?: boolean;
  /** Feature 013: màn hình được xem (EffectiveAccess.screens); vắng = mọi màn hình. */
  canView?: (screen: string) => boolean;
  /** Feature 013: administrator; feature 030: mục `system: admin` chỉ hiện khi true. */
  admin?: boolean;
  /** Feature 024: project có recipe; feature 030: mục `system: recipes` chỉ hiện khi true. */
  recipes?: boolean;
  /**
   * Feature 030: project định dạng dưới 1.1 (không khai báo được mục `system`): giữ hành vi cũ, tự thêm Alarm, Lịch sử
   * alarm (trừ khi `navigation.alarms` là false), Lịch sử, Công thức, Quản trị cuối menu khi tính năng có.
   */
  legacySystem?: boolean;
}
type NavItem = NavigationItem & { report?: string };

/** Feature 030: khóa route, nhãn và biểu tượng mặc định của mỗi trang hệ thống. */
export const SYSTEM_PAGES: Readonly<
  Record<SystemPageId, { screen: string; label: () => string; icon: IconName }>
> = {
  alarms: { screen: 'alarms', label: () => vi.alarm.menu, icon: 'bell' },
  'alarm-history': { screen: 'alarm-history', label: () => vi.alarm.menuHistory, icon: 'list' },
  history: { screen: '@history', label: () => viHist.menuHistory, icon: 'chart' },
  recipes: { screen: '@recipes', label: () => viRecipe.menu, icon: 'list' },
  admin: { screen: '@quan-tri', label: () => vi.access.adminMenu, icon: 'gear' },
};

type MenuOpts = Partial<AlarmMenuOptions> & MenuExtra;

function systemLeaf(it: NavItem, opts: MenuOpts): MenuLeaf | null {
  const id = it.system as SystemPageId;
  const def = Object.hasOwn(SYSTEM_PAGES, id) ? SYSTEM_PAGES[id] : undefined;
  if (!def) return null;
  const on =
    id === 'alarms' || id === 'alarm-history'
      ? opts.show === true
      : id === 'history'
        ? opts.history === true
        : id === 'recipes'
          ? opts.recipes === true
          : opts.admin === true;
  if (!on) return null;
  const out: MenuLeaf = {
    label: it.label.trim() || def.label(),
    screen: def.screen,
    icon: isIconName(it.icon) ? it.icon : def.icon,
    system: true,
  };
  if (id === 'alarms') {
    out.badge = opts.unsupported !== true;
    if (opts.unsupported) out.note = vi.alarm.menuUnsupported;
  }
  return out;
}

function leaf(
  it: NavItem,
  ok: ReadonlySet<string>,
  reports: ReadonlyMap<string, string>,
  opts: MenuOpts,
): MenuLeaf | null {
  if (it.system !== undefined) return systemLeaf(it, opts);
  if (it.report !== undefined) {
    const name = reports.get(it.report);
    if (name === undefined) return null;
    const r: MenuLeaf = {
      label: it.label.trim() || name,
      screen: `@report/${it.report}`,
      icon: 'doc',
    };
    if (isIconName(it.icon)) r.icon = it.icon;
    return r;
  }
  if (!it.screen || !ok.has(it.screen)) return null;
  const out: MenuLeaf = { label: it.label.trim() || it.screen, screen: it.screen };
  if (isIconName(it.icon)) out.icon = it.icon;
  return out;
}

/** Trạng thái nguồn alarm (contracts/ui-alarm.md §11): mục `system: alarms|alarm-history` dùng được khi status ≠ none. */
export interface AlarmMenuOptions {
  /** Nguồn alarm có nghĩa với project này (status khác none) và phiên được xem trang alarm. */
  show: boolean;
  /** Thiết bị chưa hỗ trợ alarm: mục có chú thích, không huy hiệu. */
  unsupported?: boolean;
}

/** Feature 030: project định dạng dưới 1.1 (hoặc không rõ) không khai báo được mục `system`: menu tự thêm như cũ. */
export function legacySystemMenu(schemaVersion: string | undefined): boolean {
  const m = /^(\d+)\.(\d+)\./.exec(schemaVersion ?? '');
  if (!m) return true;
  const major = Number(m[1]);
  return major === 0 || (major === 1 && Number(m[2]) < 1);
}

export function buildMenu(
  nav: Navigation | null,
  screens: readonly ScreenSummary[],
  opts: MenuOpts = {},
): MenuModel | null {
  if (nav?.position === 'hidden') return null;
  const canView = opts.canView ?? (() => true);
  const routable = screens.filter((s) => s.kind === 'screen' && canView(s.id));
  const reports = new Map((opts.reports ?? []).map((r) => [r.id, r.name]));
  const ok = new Set(routable.map((s) => s.id));
  const entries: MenuEntry[] = [];
  for (const it of nav?.items ?? []) {
    if (it.items) {
      const items = it.items
        .map((c) => leaf(c, ok, reports, opts))
        .filter((l): l is MenuLeaf => l !== null);
      if (!items.length) continue;
      const g: MenuEntry = { kind: 'group', label: it.label.trim(), items };
      if (isIconName(it.icon)) g.icon = it.icon;
      entries.push(g);
    } else {
      const l = leaf(it, ok, reports, opts);
      if (l) entries.push({ kind: 'item', ...l });
    }
  }
  // Không khai báo mục nào (hoặc không mục nào dùng được): tự liệt kê màn hình và báo cáo, không thêm trang hệ thống.
  if (!entries.length) {
    for (const s of routable) entries.push({ kind: 'item', label: s.name, screen: s.id });
    for (const [id, name] of reports)
      entries.push({ kind: 'item', label: name, screen: `@report/${id}`, icon: 'doc' });
  }
  if (opts.legacySystem) {
    const ids: SystemPageId[] = ['history', 'recipes', 'admin'];
    if (nav?.alarms !== false) ids.unshift('alarms', 'alarm-history');
    for (const id of ids) {
      const l = systemLeaf({ label: '', system: id }, opts);
      if (l) entries.push({ kind: 'item', ...l });
    }
  }
  const leaves = entries.flatMap((e) => (e.kind === 'item' ? [e] : e.items));
  // Một mục màn hình duy nhất: không cần menu. Một trang hệ thống đơn lẻ vẫn là menu (đường vào của nó).
  if (leaves.length === 0 || (leaves.length === 1 && leaves[0]!.system !== true)) return null;
  return { position: nav?.position === 'top' ? 'top' : 'left', entries };
}

function button(
  l: MenuLeaf,
  current: string,
  onSelect: (screen: string) => void,
): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  if (l.icon) b.append(createIcon(l.icon));
  const t = document.createElement('span');
  t.textContent = l.label;
  b.append(t);
  if (l.note) {
    const n = document.createElement('span');
    n.className = 'nnote';
    n.textContent = `(${l.note})`;
    b.append(n);
  }
  if (l.badge) {
    const badge = document.createElement('span');
    badge.className = 'nbadge';
    badge.dataset.badge = l.screen;
    badge.hidden = true;
    b.append(badge);
  }
  if (l.screen === current) b.setAttribute('aria-current', 'page');
  b.dataset.screen = l.screen;
  b.addEventListener('click', () => onSelect(l.screen));
  return b;
}

export function renderMenu(
  model: MenuModel,
  current: string,
  onSelect: (screen: string) => void,
  label: string,
): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = `app-nav-list pos-${model.position}`;
  nav.setAttribute('aria-label', label);
  const ul = document.createElement('ul');
  let n = 0;
  for (const e of model.entries) {
    const li = document.createElement('li');
    if (e.kind === 'item') li.append(button(e, current, onSelect));
    else {
      const head = document.createElement('div');
      head.className = 'grp';
      head.id = `nav-grp-${++n}`;
      if (e.icon) head.append(createIcon(e.icon));
      const t = document.createElement('span');
      t.textContent = e.label;
      head.append(t);
      const inner = document.createElement('ul');
      inner.setAttribute('aria-labelledby', head.id);
      for (const c of e.items) {
        const cli = document.createElement('li');
        cli.append(button(c, current, onSelect));
        inner.append(cli);
      }
      li.append(head, inner);
    }
    ul.append(li);
  }
  nav.append(ul);
  return nav;
}
