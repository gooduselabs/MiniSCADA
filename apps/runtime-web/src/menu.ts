// Menu điều hướng của trang vận hành (feature 007, FR-013; data-model §7).
//  - `buildMenu` (thuần): dựng mô hình từ `navigation` của project và danh sách màn hình. Một màn hình (không tính popup)
//    thì không có menu; `position: hidden` thì không có menu; thiếu `navigation` thì danh sách tự động mọi màn hình.
//    Mục trỏ màn hình không có/popup, nhóm rỗng và biểu tượng lạ bị bỏ (validator đã chặn; đây là lớp phòng thủ).
//  - `renderMenu`: <nav> với danh sách (nhóm một cấp), mỗi mục lá là <button>; `aria-current="page"` ở mục đang hiện.
import type { Navigation, NavigationItem } from '@mat/project-schema';
import { vi } from './i18n/vi.ts';
import { viHist } from './i18n/vi-history.ts';
import { viRecipe } from './i18n/vi-recipe.ts';
import { createIcon, isIconName, type IconName } from './icons.ts';
import type { ScreenSummary } from './project-store.ts';

export interface MenuLeaf {
  label: string;
  screen: string;
  icon?: IconName;
  /** Feature 009: mục hệ thống (alarms, alarm-history); `badge` có chỗ cho huy hiệu số alarm, `note` là chú thích nhỏ. */
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
  /** Hiện mục "Lịch sử" (lưu trữ bật và có phiên). */
  history?: boolean;
  /** Feature 013: màn hình được xem (EffectiveAccess.screens); vắng = mọi màn hình. */
  canView?: (screen: string) => boolean;
  /** Feature 013: administrator → mục "Quản trị" (`@quan-tri`) cuối menu. */
  admin?: boolean;
  /** Feature 024: project có recipe → mục "Recipe" (`@recipes`). */
  recipes?: boolean;
}
type NavItem = NavigationItem & { report?: string };

function leaf(
  it: NavItem,
  ok: ReadonlySet<string>,
  reports: ReadonlyMap<string, string> = new Map(),
): MenuLeaf | null {
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

/** Mục alarm của menu (contracts/ui-alarm.md §11): có khi status ≠ none và `navigation.alarms` ≠ false. */
export interface AlarmMenuOptions {
  /** Nguồn alarm có nghĩa với project này (status khác none). */
  show: boolean;
  /** Thiết bị chưa hỗ trợ alarm: mục có chú thích, không huy hiệu. */
  unsupported?: boolean;
}

export function buildMenu(
  nav: Navigation | null,
  screens: readonly ScreenSummary[],
  opts: Partial<AlarmMenuOptions> & MenuExtra = {},
): MenuModel | null {
  const alarm = opts;
  const extra = opts;
  const canView = extra.canView ?? (() => true);
  const routable = screens.filter((s) => s.kind === 'screen' && canView(s.id));
  const withAlarm = alarm?.show === true && (nav as { alarms?: boolean } | null)?.alarms !== false;
  const reports = new Map((extra.reports ?? []).map((r) => [r.id, r.name]));
  const admin = extra.admin === true;
  if (
    routable.length + reports.size + (extra.history ? 1 : 0) + (extra.recipes ? 1 : 0) <= 1 &&
    !withAlarm &&
    !admin
  )
    return null;
  // Quản trị viên luôn có đường vào trang Quản trị, kể cả khi project ẩn menu.
  if (nav?.position === 'hidden' && !admin) return null;
  const ok = new Set(routable.map((s) => s.id));
  const entries: MenuEntry[] = [];
  for (const it of nav?.items ?? []) {
    if (it.items) {
      const items = it.items
        .map((c) => leaf(c, ok, reports))
        .filter((l): l is MenuLeaf => l !== null);
      if (!items.length) continue;
      const g: MenuEntry = { kind: 'group', label: it.label.trim(), items };
      if (isIconName(it.icon)) g.icon = it.icon;
      entries.push(g);
    } else {
      const l = leaf(it, ok, reports);
      if (l) entries.push({ kind: 'item', ...l });
    }
  }
  if (!entries.length) {
    for (const s of routable) entries.push({ kind: 'item', label: s.name, screen: s.id });
    for (const [id, name] of reports)
      entries.push({ kind: 'item', label: name, screen: `@report/${id}`, icon: 'doc' });
  }
  if (withAlarm) {
    const a: MenuLeaf = {
      label: vi.alarm.menu,
      screen: 'alarms',
      icon: 'bell',
      system: true,
      badge: alarm?.unsupported !== true,
    };
    if (alarm?.unsupported) a.note = vi.alarm.menuUnsupported;
    entries.push({ kind: 'item', ...a });
    entries.push({
      kind: 'item',
      label: vi.alarm.menuHistory,
      screen: 'alarm-history',
      icon: 'list',
      system: true,
    });
  }
  if (extra.history)
    entries.push({ kind: 'item', label: viHist.menuHistory, screen: '@history', icon: 'chart' });
  if (extra.recipes)
    entries.push({ kind: 'item', label: viRecipe.menu, screen: '@recipes', icon: 'list' });
  if (admin)
    entries.push({
      kind: 'item',
      label: vi.access.adminMenu,
      screen: '@quan-tri',
      icon: 'gear',
      system: true,
    });
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
