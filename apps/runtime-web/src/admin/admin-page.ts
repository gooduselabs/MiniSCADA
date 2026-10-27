// Trang Quản trị của trang vận hành (feature 013, FR-040 đến FR-044; contracts/admin-api.md). Tải lười (chunk riêng) khi
// administrator mở `#/quan-tri/...`. Bố cục bảng điều khiển: đầu trang và thẻ số liệu, dải cảnh báo (xem không cần
// đăng nhập, kho quyền hỏng, quy tắc mồ côi, dữ liệu đã đổi), thanh tab (role=tablist, mũi tên trái/phải), nội dung
// tab, thanh "thay đổi chưa lưu" của hai tab quyền. Máy chủ kiểm mọi thứ (vai trò, CSRF, rev, reauth): trang chỉ hiển
// thị lỗi rõ ràng. Mọi chữ qua textContent.
import type { AlarmSource, HistorySource, TagSource } from '@mat/ui-components';
import { createIcon } from '../icons.ts';
import { viAdmin } from '../i18n/vi-admin.ts';
import type { ProjectStore, ProjectSummary } from '../project-store.ts';
import type { WebSession } from '../session.ts';
import {
  AdminApi,
  AdminApiError,
  fetchTransport,
  type AccessStore,
  type AdminGroup,
  type AdminUser,
} from './api.ts';
import { RuleDraft } from './model.ts';
import { ApiKeysTab } from './tab-apikeys.ts';
import { AuditTab } from './tab-audit.ts';
import { ComponentsTab } from './tab-components.ts';
import { EmailTab } from './tab-email.ts';
import { DeviceTab } from './tab-device.ts';
import { GroupsTab } from './tab-groups.ts';
import { PagesTab } from './tab-pages.ts';
import { UsersTab } from './tab-users.ts';
import { ViewAsTab } from './tab-view-as.ts';
import { Toaster, button, errorText, h, reauthDialog } from './ui.ts';
import './admin.css';

export const TABS = [
  'nguoi-dung',
  'nhom',
  'quyen-trang',
  'quyen-thanh-phan',
  'xem-voi-tu-cach',
  'thong-bao-email',
  'api-key',
  'thiet-bi',
  'nhat-ky',
] as const;
export type TabId = (typeof TABS)[number];

export interface AdminPageDeps {
  container: HTMLElement;
  session: WebSession;
  store: ProjectStore;
  summary: ProjectSummary;
  tags: TagSource & { subscribe: TagSource['subscribe'] };
  alarms: AlarmSource;
  history: HistorySource;
  onUnauthorized: () => void;
  /** Đổi hash (`#/quan-tri/<tab>`): router báo lại trang. */
  go: (hash: string) => void;
  fetch?: typeof fetch;
}

export interface AdminData {
  users: AdminUser[];
  usersRev: number;
  groups: AdminGroup[];
  accessRev: number;
  access: AccessStore | null;
}

/** Ngữ cảnh chung cho các tab. */
export interface AdminCtx {
  readonly api: AdminApi;
  readonly deps: AdminPageDeps;
  readonly data: AdminData;
  readonly draft: RuleDraft;
  readonly modalRoot: HTMLElement;
  readonly me: string;
  reload(...which: ('users' | 'groups' | 'access')[]): Promise<void>;
  fail(e: unknown): void;
  toast(text: string, tone?: 'ok' | 'bad'): void;
  /** Kết quả `signedOut: true` (admin vừa sửa chính mình): phiên đã hết. */
  signedOut(): void;
  /** Mở tab khác (đổi hash). */
  openTab(tab: TabId, query?: string): void;
}

export interface AdminTab {
  readonly el: HTMLElement;
  /** Dựng lại theo dữ liệu hiện có (sau tải lại). */
  render(params: URLSearchParams): void;
  hide?(): void;
}

export class AdminPage implements AdminCtx {
  readonly api: AdminApi;
  readonly deps: AdminPageDeps;
  readonly data: AdminData = {
    users: [],
    usersRev: 0,
    groups: [],
    accessRev: 0,
    access: null,
  };
  readonly draft = new RuleDraft();
  readonly modalRoot: HTMLElement;
  readonly #root: HTMLElement;
  readonly #stats: HTMLElement;
  readonly #banners: HTMLElement;
  readonly #tablist: HTMLElement;
  readonly #panel: HTMLElement;
  readonly #pending: HTMLElement;
  readonly #toaster = new Toaster();
  readonly #tabs = new Map<TabId, AdminTab>();
  #current: TabId = 'nguoi-dung';
  #params = new URLSearchParams();
  #conflict = false;
  #loaded = false;
  #saving = false;

  constructor(deps: AdminPageDeps) {
    this.deps = deps;
    this.api = new AdminApi({
      transport: fetchTransport({
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        csrf: () => deps.session.csrfHeaders(),
      }),
      onUnauthorized: deps.onUnauthorized,
    });
    this.#root = h('section', { class: 'ad-page', attrs: { 'aria-labelledby': 'ad-title' } });
    const head = h(
      'header',
      { class: 'ad-head' },
      h(
        'div',
        { class: 'ad-head-text' },
        h('h2', { id: 'ad-title', class: 'ad-title', text: viAdmin.title }),
        h('p', { class: 'ad-subtitle', text: viAdmin.subtitle }),
      ),
      button(viAdmin.reload, () => void this.reload(), { kind: 'subtle', icon: 'list' }),
    );
    this.#stats = h('div', { class: 'ad-stats' });
    this.#banners = h('div', { class: 'ad-banners' });
    this.#tablist = h('div', {
      class: 'ad-tabs',
      attrs: { role: 'tablist', 'aria-label': viAdmin.tabsLabel },
    });
    for (const t of TABS) {
      const b = h('button', {
        type: 'button',
        class: 'ad-tab',
        id: `ad-tab-${t}`,
        text: viAdmin.tabs[t] ?? t,
        attrs: {
          role: 'tab',
          'aria-selected': 'false',
          'aria-controls': 'ad-panel',
          tabindex: '-1',
          'data-tab': t,
        },
        on: { click: () => this.openTab(t) },
      });
      this.#tablist.append(b);
    }
    this.#tablist.addEventListener('keydown', (e) => this.#tabKey(e as KeyboardEvent));
    this.#panel = h('div', {
      class: 'ad-panel',
      id: 'ad-panel',
      attrs: { role: 'tabpanel', tabindex: '-1' },
    });
    this.#pending = h('div', { class: 'ad-pending', hidden: true });
    this.modalRoot = h('div', { class: 'ad-modals' });
    this.#root.append(
      head,
      this.#stats,
      this.#banners,
      this.#tablist,
      this.#panel,
      this.#pending,
      this.#toaster.el,
      this.modalRoot,
    );
    deps.container.replaceChildren(this.#root);
    this.draft.onChange(() => this.#renderPending());
  }

  get me(): string {
    return this.deps.session.info?.user ?? '';
  }

  async show(tab: string | null, params: URLSearchParams): Promise<void> {
    const t = (TABS as readonly string[]).includes(tab ?? '') ? (tab as TabId) : 'nguoi-dung';
    if (tab !== t) {
      // `#/quan-tri` hoặc tab lạ: sửa hash (replace) về tab mặc định.
      history.replaceState(history.state, '', `#/quan-tri/${t}`);
    }
    this.#current = t;
    this.#params = params;
    this.#syncTabs();
    if (!this.#loaded) {
      this.#panel.replaceChildren(h('p', { class: 'ad-loading', text: viAdmin.loading }));
      await this.reload();
      return;
    }
    this.#renderTab();
  }

  hide(): void {
    for (const t of this.#tabs.values()) t.hide?.();
  }

  openTab(tab: TabId, query = ''): void {
    this.deps.go(`#/quan-tri/${tab}${query ? `?${query}` : ''}`);
  }

  toast(text: string, tone: 'ok' | 'bad' = 'ok'): void {
    this.#toaster.show(text, tone);
  }

  signedOut(): void {
    this.toast(viAdmin.done.signedOut);
    this.deps.onUnauthorized();
  }

  async reload(...which: ('users' | 'groups' | 'access')[]): Promise<void> {
    const all = which.length === 0;
    const want = new Set(all ? ['users', 'groups', 'access'] : which);
    try {
      const [u, g, a] = await Promise.all([
        want.has('users') ? this.api.users() : null,
        want.has('groups') ? this.api.groups() : null,
        want.has('access') ? this.api.access() : null,
      ]);
      if (u) {
        this.data.users = u.users;
        this.data.usersRev = u.rev;
      }
      if (g) {
        this.data.groups = g.groups;
        this.data.accessRev = g.rev;
      }
      if (a) {
        this.data.access = a;
        this.data.accessRev = a.rev;
        this.draft.load(a.rules, !all);
      }
      if (all) this.#conflict = false;
      this.#loaded = true;
    } catch (e) {
      this.fail(e);
      if (!this.#loaded) {
        this.#panel.replaceChildren(h('p', { class: 'ad-error', text: errorText(e) }));
        return;
      }
    }
    this.#renderChrome();
    this.#renderTab();
  }

  fail(e: unknown): void {
    if (e instanceof AdminApiError) {
      if (e.status === 401) return; // onUnauthorized đã chạy
      if (e.code === 'CONFLICT') {
        this.#conflict = true;
        this.#renderBanners();
        this.#banners.querySelector<HTMLElement>('[data-banner="conflict"] button')?.focus();
        return;
      }
      if (e.code === 'STORE_INVALID') void this.reload('access');
    }
    this.toast(errorText(e), 'bad');
  }

  // ---- khung ----

  #syncTabs(): void {
    for (const b of this.#tablist.querySelectorAll<HTMLElement>('[role="tab"]')) {
      const on = b.dataset.tab === this.#current;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    this.#panel.setAttribute('aria-labelledby', `ad-tab-${this.#current}`);
    const perm = this.#current === 'quyen-trang' || this.#current === 'quyen-thanh-phan';
    this.#root.classList.toggle('with-pending', perm);
    this.#renderPending();
  }

  #tabKey(e: KeyboardEvent): void {
    const tabs = [...this.#tablist.querySelectorAll<HTMLElement>('[role="tab"]')];
    const i = tabs.findIndex((t) => t === document.activeElement);
    if (i < 0) return;
    let j: number;
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = tabs.length - 1;
    else return;
    e.preventDefault();
    tabs[j]!.focus();
    this.openTab(tabs[j]!.dataset.tab as TabId);
  }

  #renderChrome(): void {
    this.#renderStats();
    this.#renderBanners();
    this.#renderPending();
  }

  #renderStats(): void {
    const d = this.data;
    const s = viAdmin.stats;
    const enabled = d.users.filter((u) => u.enabled).length;
    const admins = d.users.filter((u) => u.enabled && u.role === 'administrator').length;
    const members = new Set(d.groups.flatMap((g) => g.members)).size;
    const now = Date.now();
    const locked = d.users.filter((u) => u.locked && u.locked.until > now).length;
    const card = (
      label: string,
      value: number,
      sub: string,
      hue: number,
      icon: Parameters<typeof createIcon>[0],
    ) =>
      h(
        'div',
        { class: `ad-stat hue-${hue}` },
        h(
          'span',
          { class: 'ad-stat-icon', attrs: { 'aria-hidden': 'true' } },
          createIcon(icon, 20),
        ),
        h(
          'div',
          {},
          h('p', { class: 'ad-stat-value', text: String(value) }),
          h('p', { class: 'ad-stat-label', text: label }),
          h('p', { class: 'ad-stat-sub', text: sub }),
        ),
      );
    this.#stats.replaceChildren(
      card(s.users, d.users.length, s.usersSub(enabled), 0, 'user'),
      card(s.admins, admins, s.adminsSub, 5, 'gear'),
      card(s.groups, d.groups.length, s.groupsSub(members), 2, 'list'),
      card(
        s.rules,
        d.access?.rules.length ?? 0,
        s.rulesSub(d.access?.orphans.length ?? 0),
        8,
        'lock',
      ),
      card(s.locked, locked, s.lockedSub, 3, 'warn'),
    );
  }

  #renderBanners(): void {
    const a = this.data.access;
    const out: HTMLElement[] = [];
    const banner = (
      kind: string,
      tone: 'warn' | 'bad' | 'info',
      title: string,
      text: string,
      action?: HTMLElement,
    ) =>
      h(
        'div',
        {
          class: `ad-banner ${tone}`,
          attrs: { role: tone === 'bad' ? 'alert' : 'status', 'data-banner': kind },
        },
        h(
          'span',
          { class: 'ad-banner-icon', attrs: { 'aria-hidden': 'true' } },
          createIcon(tone === 'info' ? 'list' : 'warn', 20),
        ),
        h(
          'div',
          { class: 'ad-banner-text' },
          h('strong', { text: title }),
          h('span', { text: text }),
        ),
        action ?? null,
      );
    if (this.#conflict)
      out.push(
        banner(
          'conflict',
          'bad',
          viAdmin.banner.conflictTitle,
          viAdmin.banner.conflict,
          button(viAdmin.reload, () => void this.reload(), { kind: 'primary' }),
        ),
      );
    if (a?.storeState === 'invalid')
      out.push(
        banner(
          'store',
          'bad',
          viAdmin.banner.storeInvalidTitle,
          viAdmin.banner.storeInvalid,
          button(viAdmin.banner.restore, () => this.#restore(), { kind: 'danger' }),
        ),
      );
    if (a?.viewerLogin === 'off')
      out.push(
        banner('viewer-off', 'warn', viAdmin.banner.viewerOffTitle, viAdmin.banner.viewerOff),
      );
    if (a && a.orphans.length)
      out.push(
        banner(
          'orphans',
          'info',
          viAdmin.stats.rules,
          viAdmin.banner.orphans(a.orphans.length),
          button(viAdmin.banner.cleanup, () => void this.#cleanup(), { kind: 'subtle' }),
        ),
      );
    this.#banners.replaceChildren(...out);
  }

  #restore(): void {
    reauthDialog(this.modalRoot, {
      title: viAdmin.banner.restore,
      body: viAdmin.banner.storeInvalid,
      confirm: viAdmin.banner.restore,
      danger: true,
      run: async (reauth) => {
        await this.api.restore(reauth);
        this.toast(viAdmin.banner.restored);
        await this.reload();
      },
      onError: (e) => this.fail(e),
    });
  }

  async #cleanup(): Promise<void> {
    try {
      const r = await this.api.cleanup(this.data.accessRev);
      this.toast(viAdmin.banner.cleaned(r.removed));
      await this.reload('access', 'groups');
    } catch (e) {
      this.fail(e);
    }
  }

  #renderPending(): void {
    const perm = this.#current === 'quyen-trang' || this.#current === 'quyen-thanh-phan';
    const n = this.draft.count;
    this.#pending.hidden = !perm || n === 0;
    if (this.#pending.hidden) return;
    const p = viAdmin.pending;
    const save = button(this.#saving ? p.busy : p.save, () => void this.#savePending(), {
      kind: 'primary',
    });
    save.disabled = this.#saving;
    save.setAttribute('data-save', '');
    this.#pending.replaceChildren(
      h('span', { class: 'ad-pending-dot', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'ad-pending-text', text: p.count(n), attrs: { role: 'status' } }),
      button(p.discard, () => this.draft.discard(), { kind: 'subtle' }),
      save,
    );
  }

  async #savePending(): Promise<void> {
    if (this.#saving) return;
    const set = this.draft.changes();
    if (!set.length) return;
    this.#saving = true;
    this.#renderPending();
    try {
      let rev = this.data.accessRev;
      for (let i = 0; i < set.length; i += 500) {
        rev = (await this.api.setAccess({ rev, set: set.slice(i, i + 500) })).rev;
        this.data.accessRev = rev;
      }
      this.toast(viAdmin.done.rules(set.length));
      this.#saving = false;
      await this.reload('access', 'groups');
    } catch (e) {
      this.#saving = false;
      this.#renderPending();
      this.fail(e);
    }
  }

  #tabFor(t: TabId): AdminTab {
    let tab = this.#tabs.get(t);
    if (!tab) {
      tab =
        t === 'nguoi-dung'
          ? new UsersTab(this)
          : t === 'nhom'
            ? new GroupsTab(this)
            : t === 'quyen-trang'
              ? new PagesTab(this)
              : t === 'quyen-thanh-phan'
                ? new ComponentsTab(this)
                : t === 'xem-voi-tu-cach'
                  ? new ViewAsTab(this)
                  : t === 'thong-bao-email'
                    ? new EmailTab(this)
                    : t === 'api-key'
                      ? new ApiKeysTab(this)
                      : t === 'thiet-bi'
                        ? new DeviceTab(this)
                        : new AuditTab(this);
      this.#tabs.set(t, tab);
    }
    return tab;
  }

  #renderTab(): void {
    for (const [id, t] of this.#tabs) if (id !== this.#current) t.hide?.();
    const tab = this.#tabFor(this.#current);
    if (this.#panel.firstElementChild !== tab.el) this.#panel.replaceChildren(tab.el);
    tab.render(this.#params);
  }
}
