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
  #menu: MenuModel | null = null;
  #current = '';

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
  setUser(info: SessionInfo | null, canLogin: boolean): void {
    this.#user.hidden = info === null;
    this.#user.textContent = info ? vi.userLabel(info.user, info.role) : '';
    this.#logoutBtn.hidden = info === null;
    this.#loginBtn.hidden = info !== null || !canLogin;
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
