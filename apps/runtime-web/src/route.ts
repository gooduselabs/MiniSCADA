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
  /** Feature 009: trang dựng sẵn của hệ thống (alarms, alarm-history), không phải màn hình của project. */
  system?: true;
}

/** Trang hệ thống có route riêng (feature 009; contracts/ui-alarm.md §11). Ưu tiên hơn màn hình trùng id. */
export const SYSTEM_ROUTES: readonly string[] = ['alarms', 'alarm-history'];

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
  system: readonly string[] = [],
): ResolvedRoute {
  const kiosk = new URLSearchParams(search).get('kiosk') === '1';
  const id = parseHash(hash);
  if (id !== null && system.includes(id)) return { screen: id, kiosk, notice: null, system: true };
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
  /** Id trang hệ thống hợp lệ (mặc định không có): route tới chúng mang system: true. */
  system?: readonly string[];
  win?: Window;
}

export class Router {
  #popup: string | null = null;
  #current: string | null = null;
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
    const r = resolveRoute(
      loc.hash,
      loc.search,
      this.#o.screens,
      this.#o.entry,
      this.#o.system ?? [],
    );
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
