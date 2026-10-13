// Route của trang vận hành (feature 007, FR-015; research R4): màn hình nằm trong `location.hash` (`#/<id>`), nên F5,
// Back/Forward và liên kết dán lại đều chạy mà không cần máy chủ định tuyến. `?kiosk=1` ẩn thanh trên và menu.
// Popup KHÔNG nằm trong URL (là trạng thái tạm); chuyển màn hình đóng popup.

export interface RouteNotice {
  kind: 'unknown-screen';
  /** id người dùng xin nhưng project không có (hoặc là popup). */
  id: string;
}

export interface ResolvedRoute {
  screen: string;
  kiosk: boolean;
  notice: RouteNotice | null;
}

/** Trang lịch sử và báo cáo (feature 010): `#/history[?…]`, `#/report/<id>[?…]`; không phải màn hình của project. */
export type PageRoute =
  | { kind: 'history'; params: URLSearchParams }
  | { kind: 'report'; id: string; params: URLSearchParams };

const REPORT_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** `#/history?g=…` hoặc `#/report/<id>?d=…` → trang; sai dạng → null. */
export function parsePageHash(hash: string): PageRoute | null {
  if (!hash.startsWith('#/')) return null;
  const raw = hash.slice(2);
  const q = raw.indexOf('?');
  const path = q < 0 ? raw : raw.slice(0, q);
  const params = new URLSearchParams(q < 0 ? '' : raw.slice(q + 1));
  if (path === 'history') return { kind: 'history', params };
  const m = /^report\/([^/]+)$/.exec(path);
  if (!m) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
  return REPORT_ID.test(id) ? { kind: 'report', id, params } : null;
}

/** Khóa mục menu của trang: `@history`, `@report/<id>` (không trùng id màn hình vì id màn hình không có `@`). */
export const pageKey = (p: PageRoute): string =>
  p.kind === 'history' ? '@history' : `@report/${p.id}`;

/** `#/<id>` → id; rỗng, sai dạng hay chuỗi phần trăm hỏng → null. */
export function parseHash(hash: string): string | null {
  if (!hash.startsWith('#/')) return null;
  const raw = hash.slice(2);
  if (!raw || raw.includes('/')) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** `screens`: id các màn hình chọn được (không gồm popup); `entry`: màn hình đầu của project. */
export function resolveRoute(
  hash: string,
  search: string,
  screens: readonly string[],
  entry: string,
): ResolvedRoute {
  const kiosk = new URLSearchParams(search).get('kiosk') === '1';
  const id = parseHash(hash);
  // Hash rỗng hoặc không phải `#/<id>`: màn hình đầu, không thông báo.
  if (id === null) return { screen: entry, kiosk, notice: null };
  if (screens.includes(id)) return { screen: id, kiosk, notice: null };
  return { screen: entry, kiosk, notice: { kind: 'unknown-screen', id } };
}

export interface RouterOptions {
  screens: readonly string[];
  entry: string;
  onRoute: (route: ResolvedRoute) => void;
  /** Popup mở (id) hoặc đóng (null). */
  onPopup?: (id: string | null) => void;
  /** Trang lịch sử/báo cáo (feature 010); vắng thì `#/history` được coi là id màn hình như trước. */
  onPage?: (page: PageRoute) => void;
  win?: Window;
}

export class Router {
  #popup: string | null = null;
  #current: string | null = null;
  #pageHash = '';
  #started = false;
  readonly #o: RouterOptions;
  readonly #win: Window;
  readonly #listener = () => this.#sync();

  constructor(o: RouterOptions) {
    this.#o = o;
    this.#win = o.win ?? window;
  }

  get popup(): string | null {
    return this.#popup;
  }

  get current(): string | null {
    return this.#current;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#win.addEventListener('hashchange', this.#listener);
    this.#sync();
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    this.#win.removeEventListener('hashchange', this.#listener);
  }

  /** Chuyển màn hình: đặt hash (hashchange báo route). Cùng màn hình đang hiện thì không làm gì. */
  go(id: string): void {
    this.closePopup();
    if (id.startsWith('@') && this.#o.onPage) {
      this.#win.location.hash = `#/${id.slice(1)}`;
      this.#sync();
      return;
    }
    if (id === this.#current && parseHash(this.#win.location.hash) === id) return;
    this.#win.location.hash = `#/${encodeURIComponent(id)}`;
    // jsdom và Chrome gửi hashchange bất đồng bộ; gọi đồng bộ ngay để người gọi thấy route mới và bỏ lần gửi trùng.
    this.#sync();
  }

  openPopup(id: string): void {
    if (this.#popup === id) return;
    this.#popup = id;
    this.#o.onPopup?.(id);
  }

  closePopup(): void {
    if (this.#popup === null) return;
    this.#popup = null;
    this.#o.onPopup?.(null);
  }

  #sync(): void {
    const loc = this.#win.location;
    const page = this.#o.onPage ? parsePageHash(loc.hash) : null;
    if (page && !(page.kind === 'history' && this.#o.screens.includes('history'))) {
      // jsdom/Chrome gửi hashchange sau lần gọi đồng bộ: bỏ lần trùng.
      if (this.#current === pageKey(page) && this.#pageHash === loc.hash) return;
      this.closePopup();
      this.#current = pageKey(page);
      this.#pageHash = loc.hash;
      this.#o.onPage!(page);
      return;
    }
    const r = resolveRoute(loc.hash, loc.search, this.#o.screens, this.#o.entry);
    const hashId = parseHash(loc.hash);
    // Hash trống hoặc id lạ: sửa thành màn hình đầu (replace để Back không quay lại id lạ).
    if (hashId !== r.screen)
      this.#win.history.replaceState(history.state, '', `#/${encodeURIComponent(r.screen)}`);
    if (r.screen === this.#current && !r.notice) return;
    this.closePopup();
    this.#current = r.screen;
    this.#o.onRoute(r);
  }
}
