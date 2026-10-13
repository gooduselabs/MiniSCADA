// Phiên web của trang vận hành (feature 007, FR-039, FR-040, FR-049, FR-050; contracts/web-session.md §2, §4).
//  - Cookie `__Host-mat_sid` là HttpOnly: trang không thấy. Trang chỉ giữ `csrfToken` TRONG BIẾN RIÊNG của lớp này
//    (`#csrf`): không localStorage, sessionStorage, URL, biến toàn cục hay thuộc tính công khai.
//  - Không đặt header `Origin` (trình duyệt tự gửi); `credentials` mặc định `same-origin`.
//  - HTTP: cookie `Secure` không tồn tại nên không gọi `web/session`, không đăng nhập (chỉ xem).
//  - `touch` (làm mới hạn rảnh) tối đa 1 lần/phút và chỉ khi người có thao tác chuột/phím trong phút đó.
import type { Role, SessionInfo } from '@mat/ui-components';

export type LoginResult =
  | { ok: true; info: SessionInfo }
  | { ok: false; code: string; message?: string; retryAfterS?: number };

export interface WebSessionOptions {
  fetch?: typeof fetch;
  /** Trang đang mở bằng HTTPS (đăng nhập chỉ có ở HTTPS). */
  https: boolean;
  /** Phiên đổi (đăng nhập, đăng xuất, hết hạn, khôi phục). */
  onChange?: () => void;
  touchIntervalMs?: number;
}

const ROLES: readonly string[] = ['viewer', 'operator', 'engineer', 'administrator'];
export const TOUCH_INTERVAL_MS = 60_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Đọc thân phiên của `web/login` và `web/session`; hình dạng sai → null. */
function parseSession(body: unknown): { info: SessionInfo; csrf: string } | null {
  if (!isObj(body)) return null;
  const { user, role, csrfToken } = body;
  if (
    typeof user !== 'string' ||
    typeof role !== 'string' ||
    typeof csrfToken !== 'string' ||
    !csrfToken
  )
    return null;
  if (!ROLES.includes(role)) return null;
  return { info: { user, role: role as Role }, csrf: csrfToken };
}

export class WebSession {
  #csrf: string | null = null;
  #info: SessionInfo | null = null;
  #expired = false;
  #active = false;
  #timer: ReturnType<typeof setInterval> | null = null;
  readonly #fetch: typeof fetch;
  readonly #https: boolean;
  readonly #listeners = new Set<() => void>();
  readonly #touchMs: number;

  constructor(opt: WebSessionOptions) {
    this.#fetch = opt.fetch ?? ((...a) => fetch(...a));
    this.#https = opt.https;
    if (opt.onChange) this.#listeners.add(opt.onChange);
    this.#touchMs = opt.touchIntervalMs ?? TOUCH_INTERVAL_MS;
  }

  get info(): SessionInfo | null {
    return this.#info;
  }

  /** Phiên từng có đã hết hạn hoặc bị hủy (chưa đăng nhập lại): hiện banner, khóa điều khiển. */
  get expired(): boolean {
    return this.#expired;
  }

  /** Báo mỗi lần phiên đổi. Trả hàm hủy. */
  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  #emit(): void {
    for (const fn of [...this.#listeners]) fn();
  }

  get https(): boolean {
    return this.#https;
  }

  /** Header cho yêu cầu đổi trạng thái; rỗng khi không có phiên. */
  csrfHeaders(): Record<string, string> {
    return this.#csrf ? { 'X-MAT-CSRF': this.#csrf } : {};
  }

  /** Mọi `pointerdown` và `keydown` của người dùng đánh dấu "có hoạt động" cho lượt `touch` kế tiếp. */
  watchActivity(target: EventTarget): () => void {
    const mark = () => {
      this.#active = true;
    };
    target.addEventListener('pointerdown', mark, { capture: true, passive: true });
    target.addEventListener('keydown', mark, { capture: true, passive: true });
    return () => {
      target.removeEventListener('pointerdown', mark, { capture: true });
      target.removeEventListener('keydown', mark, { capture: true });
    };
  }

  /** Khởi động trang (HTTPS): hỏi `web/session`; 401, 404 hay lỗi mạng đều là chế độ chỉ xem. */
  async restore(): Promise<void> {
    if (!this.#https) return;
    try {
      const res = await this.#fetch('/api/v1/web/session', { cache: 'no-store' });
      if (!res.ok) return;
      const s = parseSession(await res.json().catch(() => null));
      if (s) this.#begin(s);
    } catch {
      /* chỉ xem */
    }
  }

  async login(username: string, password: string): Promise<LoginResult> {
    if (!this.#https) return { ok: false, code: 'INSECURE' };
    let res: Response;
    try {
      res = await this.#fetch('/api/v1/web/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: password.normalize('NFC') }),
        cache: 'no-store',
      });
    } catch {
      return { ok: false, code: 'NETWORK' };
    }
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const out: { ok: false; code: string; message?: string; retryAfterS?: number } = {
        ok: false,
        code: isObj(body) && typeof body.error === 'string' ? body.error : `HTTP_${res.status}`,
      };
      if (isObj(body) && typeof body.message === 'string') out.message = body.message;
      if (isObj(body) && typeof body.retryAfterS === 'number') out.retryAfterS = body.retryAfterS;
      return out;
    }
    const s = parseSession(body);
    if (!s) return { ok: false, code: 'BAD_RESPONSE' };
    this.#begin(s);
    return { ok: true, info: s.info };
  }

  async logout(): Promise<void> {
    const headers = this.csrfHeaders();
    if (this.#info) {
      try {
        await this.#fetch('/api/v1/web/logout', { method: 'POST', headers, cache: 'no-store' });
      } catch {
        /* phiên phía trang vẫn xóa; cookie còn hạn tới khi hết hạn rảnh */
      }
    }
    this.#end(false);
  }

  /** Một yêu cầu nhận 401 (SESSION_EXPIRED, SESSION_INVALID, AUTH_REQUIRED) hoặc live đóng 4401. */
  expire(): void {
    if (!this.#info) return;
    this.#end(true);
  }

  #begin(s: { info: SessionInfo; csrf: string }): void {
    this.#csrf = s.csrf;
    this.#info = s.info;
    this.#expired = false;
    this.#active = false;
    this.#startTimer();
    this.#emit();
  }

  #end(expired: boolean): void {
    const had = this.#info !== null || this.#expired !== expired;
    this.#csrf = null;
    this.#info = null;
    this.#expired = expired;
    this.#active = false;
    this.#stopTimer();
    if (had) this.#emit();
  }

  #startTimer(): void {
    this.#stopTimer();
    this.#timer = setInterval(() => void this.#touch(), this.#touchMs);
  }

  #stopTimer(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  async #touch(): Promise<void> {
    if (!this.#active || !this.#info) return;
    this.#active = false;
    try {
      const res = await this.#fetch('/api/v1/web/touch', {
        method: 'POST',
        headers: this.csrfHeaders(),
        cache: 'no-store',
      });
      if (res.status === 401) this.expire();
    } catch {
      /* lần sau thử lại nếu còn hoạt động */
    }
  }
}
