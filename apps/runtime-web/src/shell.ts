// Khung của trang vận hành (feature 007, FR-013, FR-016, FR-021, FR-022): thanh trên, menu, dải thông báo, vùng màn hình.
// DOM tĩnh nằm ở index.html (các id `app-*` giữ từ Sprint 1 cho status.ts, reload.ts, test cũ); lớp này chỉ gán chữ bằng
// `textContent` và dựng nút/menu bằng createElement. Mọi chuỗi tiếng Việt ở i18n/vi.ts.
import type { SessionInfo } from '@mat/ui-components';
import { vi } from './i18n/vi.ts';
import { createIcon } from './icons.ts';
import { renderMenu, type MenuModel } from './menu.ts';

export const NAV_BREAKPOINT_PX = 900;

export type ViewOnly =
  { kind: 'insecure'; httpsUrl: string | null } | { kind: 'https-down' } | null;

export interface ShellHandlers {
  onLogin: () => void;
  onLogout: () => void;
  onSelect: (screen: string) => void;
  /** Feature 013: mục "Đổi mật khẩu của tôi" của menu tài khoản. */
  onChangePassword?: () => void;
}

const must = <T extends HTMLElement>(doc: Document, id: string): T => {
  const e = doc.getElementById(id);
  if (!e) throw new Error(`Thiếu phần tử #${id} trong index.html`);
  return e as T;
};

export class Shell {
  readonly screenHost: HTMLElement;
  readonly modalRoot: HTMLElement;
  readonly #doc: Document;
  readonly #h: ShellHandlers;
  readonly #root: HTMLElement;
  readonly #bar: HTMLElement;
  readonly #body: HTMLElement;
  readonly #nav: HTMLElement;
  readonly #scrim: HTMLElement;
  readonly #menuBtn: HTMLButtonElement;
  readonly #title: HTMLElement;
  readonly #screenName: HTMLElement;
  readonly #user: HTMLElement;
  readonly #loginBtn: HTMLButtonElement;
  readonly #logoutBtn: HTMLButtonElement;
  readonly #viewOnly: HTMLElement;
  readonly #sessionBanner: HTMLElement;
  readonly #notice: HTMLElement;
  readonly #accountBtn: HTMLButtonElement | null;
  readonly #accountMenu: HTMLElement | null;
  #menu: MenuModel | null = null;
  #current = '';
  #account: { info: SessionInfo; groups: readonly string[] } | null = null;

  constructor(h: ShellHandlers, doc: Document = document) {
    this.#doc = doc;
    this.#h = h;
    this.#root = must(doc, 'app-shell');
    this.#bar = must(doc, 'app-bar');
    this.#body = must(doc, 'app-body');
    this.#nav = must(doc, 'app-nav');
    this.#scrim = must(doc, 'app-nav-scrim');
    this.#menuBtn = must(doc, 'app-menu-btn');
    this.#title = must(doc, 'app-title');
    this.#screenName = must(doc, 'app-screen-name');
    this.#user = must(doc, 'app-user');
    this.#loginBtn = must(doc, 'app-login-btn');
    this.#logoutBtn = must(doc, 'app-logout-btn');
    this.#viewOnly = must(doc, 'app-viewonly');
    this.#sessionBanner = must(doc, 'app-session-banner');
    this.#notice = must(doc, 'app-notice');
    this.screenHost = must(doc, 'app-screen');
    this.modalRoot = must(doc, 'app-modal-root');

    this.#menuBtn.append(createIcon('menu', 20));
    this.#menuBtn.setAttribute('aria-label', vi.menuOpen);
    this.#menuBtn.addEventListener('click', () => this.toggleNav());
    this.#scrim.addEventListener('click', () => this.toggleNav(false));
    this.#nav.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.navOpen) {
        this.toggleNav(false);
        this.#menuBtn.focus();
      }
    });
    this.#loginBtn.textContent = vi.login;
    this.#logoutBtn.textContent = vi.logout;
    this.#loginBtn.prepend(createIcon('login'));
    this.#logoutBtn.prepend(createIcon('logout'));
    this.#loginBtn.addEventListener('click', () => h.onLogin());
    this.#logoutBtn.addEventListener('click', () => h.onLogout());

    const sl = must<HTMLButtonElement>(doc, 'app-session-login');
    sl.textContent = vi.sessionLoginAgain;
    sl.addEventListener('click', () => h.onLogin());
    must(doc, 'app-session-text').textContent = vi.sessionExpiredBanner;
    const nc = must<HTMLButtonElement>(doc, 'app-notice-close');
    nc.textContent = vi.dismiss;
    nc.addEventListener('click', () => this.setNotice(null));

    // Menu tài khoản (feature 013): nút mở menu (role=menu), mục là nút role=menuitem; mũi tên lên/xuống, Esc đóng.
    this.#accountBtn = doc.getElementById('app-account-btn') as HTMLButtonElement | null;
    this.#accountMenu = doc.getElementById('app-account-menu');
    const ab = this.#accountBtn;
    const am = this.#accountMenu;
    if (ab && am) {
      ab.append(createIcon('user', 18));
      ab.setAttribute('aria-label', vi.access.account);
      ab.title = vi.access.account;
      ab.addEventListener('click', () => this.toggleAccountMenu());
      am.addEventListener('keydown', (e) => this.#menuKey(e));
      am.addEventListener('focusout', (e) => {
        const to = e.relatedTarget as Node | null;
        if (to && !am.contains(to) && to !== ab) this.toggleAccountMenu(false);
      });
      doc.addEventListener('pointerdown', (e) => {
        const t = e.target as Node | null;
        if (!am.hidden && t && !am.contains(t) && !ab.contains(t)) this.toggleAccountMenu(false);
      });
    }
  }

  get accountMenuOpen(): boolean {
    return this.#accountMenu ? !this.#accountMenu.hidden : false;
  }

  /** Mở/đóng menu tài khoản; mở thì focus mục đầu, đóng bằng phím thì focus về nút. */
  toggleAccountMenu(open: boolean = !this.accountMenuOpen, focusBack = false): void {
    const ab = this.#accountBtn;
    const am = this.#accountMenu;
    if (!ab || !am) return;
    const on = open && this.#account !== null;
    if (on) this.#renderAccountMenu();
    am.hidden = !on;
    ab.setAttribute('aria-expanded', String(on));
    if (on) am.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    else if (focusBack) ab.focus();
  }

  #menuKey(e: KeyboardEvent): void {
    const items = [
      ...(this.#accountMenu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    ];
    const i = items.indexOf(this.#doc.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      this.toggleAccountMenu(false, true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      if (n) items[(i + (e.key === 'ArrowDown' ? 1 : n - 1) + n) % n]!.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? items[0] : items.at(-1))?.focus();
    } else if (e.key === 'Tab') this.toggleAccountMenu(false);
  }

  #renderAccountMenu(): void {
    const am = this.#accountMenu;
    const a = this.#account;
    if (!am || !a) return;
    const head = this.#doc.createElement('div');
    head.className = 'account-head';
    const name = this.#doc.createElement('strong');
    name.textContent = a.info.user;
    const role = this.#doc.createElement('span');
    role.className = `role-badge role-${a.info.role}`;
    role.textContent = a.info.role;
    const groups = this.#doc.createElement('span');
    groups.className = 'muted';
    groups.textContent = a.groups.length
      ? vi.access.accountGroups(a.groups.join(', '))
      : vi.access.accountNoGroup;
    head.append(name, role, groups);
    const item = (label: string, icon: 'lock' | 'logout', fn: () => void) => {
      const b = this.#doc.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.tabIndex = -1;
      b.append(createIcon(icon));
      const t = this.#doc.createElement('span');
      t.textContent = label;
      b.append(t);
      b.addEventListener('click', () => {
        this.toggleAccountMenu(false, true);
        fn();
      });
      return b;
    };
    const menu = this.#doc.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', vi.access.accountMenu(a.info.user));
    menu.append(
      item(vi.access.changePassword, 'lock', () => this.#h.onChangePassword?.()),
      item(vi.logout, 'logout', () => this.#h.onLogout()),
    );
    am.replaceChildren(head, menu);
  }

  get navOpen(): boolean {
    return this.#root.classList.contains('nav-open');
  }

  /** `?kiosk=1`: ẩn thanh trên và menu; màn hình chiếm hết cửa sổ. */
  setKiosk(on: boolean): void {
    this.#root.classList.toggle('kiosk', on);
    this.#bar.hidden = on;
    must(this.#doc, 'app-kiosk-dot').hidden = !on;
    this.#syncNav();
  }

  setProject(name: string): void {
    this.#title.textContent = name;
    this.#doc.title = vi.windowTitle(name);
  }

  setScreenName(name: string): void {
    this.#screenName.textContent = name;
  }

  setMenu(model: MenuModel | null, current: string): void {
    this.#menu = model;
    this.#current = current;
    this.#nav.replaceChildren();
    if (model) {
      this.#nav.append(
        renderMenu(
          model,
          current,
          (id) => {
            this.toggleNav(false);
            this.#h.onSelect(id);
          },
          vi.navLabel,
        ),
      );
    }
    this.#body.classList.toggle('nav-top', model?.position === 'top');
    this.#syncNav();
  }

  /** Đổi mục đang hiện mà không dựng lại menu. */
  setCurrent(screen: string): void {
    if (screen === this.#current) return;
    this.#current = screen;
    if (this.#menu) this.setMenu(this.#menu, screen);
  }

  /** Mở/đóng menu kiểu ngăn kéo (cửa sổ hẹp). */
  toggleNav(open: boolean = !this.navOpen): void {
    const on = open && this.#menu !== null;
    this.#root.classList.toggle('nav-open', on);
    this.#menuBtn.setAttribute('aria-expanded', String(on));
    this.#menuBtn.setAttribute('aria-label', on ? vi.menuClose : vi.menuOpen);
    this.#scrim.hidden = !on;
  }

  #syncNav(): void {
    const has = this.#menu !== null && !this.#root.classList.contains('kiosk');
    this.#nav.hidden = !has;
    this.#menuBtn.hidden = !has;
    if (!has) this.toggleNav(false);
  }

  /** Người dùng: có phiên → tên (role) và Đăng xuất; không → Đăng nhập (nếu đăng nhập được). */
  setUser(info: SessionInfo | null, canLogin: boolean, groups: readonly string[] = []): void {
    this.#user.hidden = info === null;
    this.#user.textContent = info ? vi.userLabel(info.user, info.role) : '';
    this.#logoutBtn.hidden = info === null;
    this.#loginBtn.hidden = info !== null || !canLogin;
    this.#account = info ? { info, groups } : null;
    if (this.#accountBtn) this.#accountBtn.hidden = info === null || !this.#h.onChangePassword;
    if (!info) this.toggleAccountMenu(false);
  }

  /** Dải "Chế độ chỉ xem" khi mở bằng HTTP (hoặc HTTPS không chạy). */
  setViewOnly(v: ViewOnly): void {
    this.#viewOnly.hidden = v === null;
    this.#viewOnly.replaceChildren();
    if (!v) return;
    this.#viewOnly.append(createIcon('lock'));
    const t = this.#doc.createElement('span');
    t.textContent = v.kind === 'https-down' ? vi.viewOnlyHttpsDown : `${vi.viewOnlyBand} `;
    this.#viewOnly.append(t);
    if (v.kind === 'insecure' && v.httpsUrl) {
      const a = this.#doc.createElement('a');
      a.href = v.httpsUrl;
      a.textContent = vi.viewOnlyLink;
      this.#viewOnly.append(a);
    }
  }

  setSessionExpired(show: boolean): void {
    this.#sessionBanner.hidden = !show;
  }

  /** Thông báo ngắn (vd. id màn hình lạ); `null` để ẩn. */
  setNotice(text: string | null): void {
    this.#notice.hidden = text === null;
    must(this.#doc, 'app-notice-text').textContent = text ?? '';
  }

  showError(title: string, lines: readonly string[]): void {
    const panel = must(this.#doc, 'app-errors');
    panel.hidden = false;
    must(this.#doc, 'app-errors-title').textContent = title;
    must(this.#doc, 'app-errors-list').replaceChildren(
      ...lines.map((l) => {
        const li = this.#doc.createElement('li');
        li.textContent = l;
        return li;
      }),
    );
  }

  clearErrors(): void {
    must(this.#doc, 'app-errors').hidden = true;
  }
}
