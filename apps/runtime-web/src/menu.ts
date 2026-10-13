// Menu điều hướng của trang vận hành (feature 007, FR-013; data-model §7).
//  - `buildMenu` (thuần): dựng mô hình từ `navigation` của project và danh sách màn hình. Một màn hình (không tính popup)
//    thì không có menu; `position: hidden` thì không có menu; thiếu `navigation` thì danh sách tự động mọi màn hình.
//    Mục trỏ màn hình không có/popup, nhóm rỗng và biểu tượng lạ bị bỏ (validator đã chặn; đây là lớp phòng thủ).
//  - `renderMenu`: <nav> với danh sách (nhóm một cấp), mỗi mục lá là <button>; `aria-current="page"` ở mục đang hiện.
import type { Navigation, NavigationItem } from '@mat/project-schema';
import { viHist } from './i18n/vi-history.ts';
import { createIcon, isIconName, type IconName } from './icons.ts';
import type { ScreenSummary } from './project-store.ts';

export interface MenuLeaf {
  label: string;
  screen: string;
  icon?: IconName;
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

export function buildMenu(
  nav: Navigation | null,
  screens: readonly ScreenSummary[],
  extra: MenuExtra = {},
): MenuModel | null {
  const routable = screens.filter((s) => s.kind === 'screen');
  const reports = new Map((extra.reports ?? []).map((r) => [r.id, r.name]));
  if (routable.length + reports.size + (extra.history ? 1 : 0) <= 1) return null;
  if (nav?.position === 'hidden') return null;
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
  if (extra.history)
    entries.push({ kind: 'item', label: viHist.menuHistory, screen: '@history', icon: 'chart' });
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
