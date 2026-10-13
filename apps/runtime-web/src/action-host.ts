// WebActionHost (feature 007, FR-034, FR-039, FR-040, FR-049, FR-050; contracts/web-session.md §4, device-api-1.2.md §6):
// cài ActionHost của @mat/ui-components cho trang vận hành.
//  - Ghi Tag: `POST /api/v1/tags/write` (cookie + `X-MAT-CSRF`; Origin do trình duyệt đặt), `requestId` UUID v4 mới cho mỗi
//    lệnh; rồi hỏi `GET /api/v1/tags/write/<requestId>` mỗi 200 ms tới kết quả cuối, tối đa 30 s (hết hạn → UNKNOWN).
//  - KHÔNG BAO GIỜ gửi lại: lỗi mạng hay hết hạn đều trả UNKNOWN để người vận hành kiểm tra giá trị thực.
//  - 401 từ bất kỳ yêu cầu nào → hủy phiên (`WebSession.expire`) và báo người nghe để widget tính lại khóa, đóng hộp xác nhận.
import type {
  ActionHost,
  SessionInfo,
  WriteBlockCode,
  WriteOutcome,
  WriteSpec,
} from '@mat/ui-components';
import { vi } from './i18n/vi.ts';
import type { WebSession } from './session.ts';

export const POLL_MS = 200;
export const RESULT_DEADLINE_MS = 30_000;

export interface Navigator3 {
  navigate(screenId: string): void;
  openPopup(screenId: string): void;
  closePopup(): void;
}

export interface WebActionHostOptions {
  session: WebSession;
  nav: Navigator3;
  /** Mở hộp Đăng nhập. */
  requestLogin: () => void;
  fetch?: typeof fetch;
  uuid?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const FINAL = new Set(['CONFIRMED', 'REJECTED', 'FAILED', 'TIMEOUT']);

/** Phần tử kết quả của `tags/write` (một yêu cầu): thân `{results:[…]}` hoặc chính phần tử. */
function firstResult(body: unknown): Obj | null {
  if (!isObj(body)) return null;
  if (Array.isArray(body.results)) return isObj(body.results[0]) ? body.results[0] : null;
  return typeof body.status === 'string' ? body : null;
}

function outcomeOf(r: Obj): WriteOutcome {
  const status = String(r.status) as WriteOutcome['status'];
  const o: WriteOutcome = { status };
  const code =
    typeof r.code === 'string' ? r.code : typeof r.reason === 'string' ? r.reason : undefined;
  if (code) o.code = code;
  if (typeof r.message === 'string') o.message = r.message;
  if (typeof r.retryAfterMs === 'number') o.retryAfterMs = r.retryAfterMs;
  if ('readback' in r) {
    const rb = r.readback;
    if (rb === null || ['boolean', 'number', 'string'].includes(typeof rb))
      o.readback = rb as WriteOutcome['readback'];
  }
  return o;
}

export class WebActionHost implements ActionHost {
  readonly #o: WebActionHostOptions;
  readonly #fetch: typeof fetch;
  readonly #uuid: () => string;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #listeners = new Set<() => void>();
  #httpsDown = false;
  #projectChanging = false;

  constructor(o: WebActionHostOptions) {
    this.#o = o;
    this.#fetch = o.fetch ?? ((...a) => fetch(...a));
    this.#uuid = o.uuid ?? (() => crypto.randomUUID());
    this.#sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    o.session.subscribe(() => this.#emit());
  }

  /** Báo khi khóa chung hoặc phiên đổi (widget gọi `recompute`). Trả hàm hủy. */
  onChange(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  #emit(): void {
    for (const fn of [...this.#listeners]) fn();
  }

  /** `system/info.warnings` có `HTTPS_DOWN`. */
  setHttpsDown(v: boolean): void {
    if (this.#httpsDown === v) return;
    this.#httpsDown = v;
    this.#emit();
  }

  /** Thiết bị đang đổi project (live đóng 1012 hoặc `hello` báo project khác). */
  setProjectChanging(v: boolean): void {
    if (this.#projectChanging === v) return;
    this.#projectChanging = v;
    this.#emit();
  }

  session(): SessionInfo | null {
    return this.#o.session.info;
  }

  writeBlocked(): { code: WriteBlockCode; message: string } | null {
    const s = this.#o.session;
    const block = (code: WriteBlockCode) => ({ code, message: vi.blocked[code] });
    if (!s.https) return block(this.#httpsDown ? 'HTTPS_DOWN' : 'INSECURE');
    if (this.#projectChanging) return block('PROJECT_CHANGING');
    if (s.expired) return block('SESSION_EXPIRED');
    return null;
  }

  navigate(screenId: string): void {
    this.#o.nav.navigate(screenId);
  }

  openPopup(screenId: string): void {
    this.#o.nav.openPopup(screenId);
  }

  closePopup(): void {
    this.#o.nav.closePopup();
  }

  requestLogin(): void {
    this.#o.requestLogin();
  }

  async write(spec: WriteSpec, onPhase: (o: WriteOutcome) => void): Promise<WriteOutcome> {
    const blocked = this.writeBlocked();
    if (blocked) return { status: 'REJECTED', code: blocked.code, message: blocked.message };
    if (!this.#o.session.info)
      return { status: 'REJECTED', code: 'NO_SESSION', message: vi.writeNoSession };

    const requestId = this.#uuid();
    const req: Obj = { requestId, tag: spec.tag, value: spec.value, context: spec.context };
    if (spec.pulseMs !== undefined) req.pulseMs = spec.pulseMs;
    if (spec.expect !== undefined) req.expect = spec.expect;

    let res: Response;
    try {
      res = await this.#fetch('/api/v1/tags/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.#o.session.csrfHeaders() },
        body: JSON.stringify({ requests: [req] }),
        cache: 'no-store',
      });
    } catch {
      // Không biết lệnh đã tới thiết bị hay chưa: không gửi lại.
      return { status: 'UNKNOWN', code: 'NETWORK', message: vi.writeNetwork };
    }
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 401) {
      this.#o.session.expire();
      return { status: 'REJECTED', code: 'SESSION_EXPIRED', message: vi.blocked.SESSION_EXPIRED };
    }
    const first = firstResult(body);
    if (!res.ok) {
      const code =
        isObj(body) && typeof body.error === 'string' ? body.error : `HTTP_${res.status}`;
      const out: WriteOutcome = { status: 'REJECTED', code };
      if (first && typeof first.message === 'string') out.message = first.message;
      else if (isObj(body) && typeof body.message === 'string') out.message = body.message;
      return out;
    }
    if (!first) return { status: 'UNKNOWN', code: 'BAD_RESPONSE', message: vi.writeNoAnswer };
    const accepted = outcomeOf(first);
    if (accepted.status !== 'ACCEPTED') return accepted;
    onPhase({ status: 'ACCEPTED' });
    return this.#poll(requestId);
  }

  /** Hỏi kết quả mỗi 200 ms tới kết quả cuối hoặc 30 s. Lỗi mạng thoáng qua chỉ làm lượt đó thất bại. */
  async #poll(requestId: string): Promise<WriteOutcome> {
    const deadline = Date.now() + RESULT_DEADLINE_MS;
    const url = `/api/v1/tags/write/${encodeURIComponent(requestId)}`;
    for (;;) {
      await this.#sleep(POLL_MS);
      if (Date.now() > deadline) break;
      try {
        const res = await this.#fetch(url, { cache: 'no-store' });
        if (res.status === 401) {
          this.#o.session.expire();
          return { status: 'UNKNOWN', code: 'SESSION_EXPIRED', message: vi.writeNoAnswer };
        }
        if (res.status === 404)
          return { status: 'UNKNOWN', code: 'NO_SUCH_REQUEST', message: vi.writeNoAnswer };
        if (res.ok) {
          const r = firstResult(await res.json().catch(() => null));
          if (r) {
            const o = outcomeOf(r);
            if (FINAL.has(o.status)) return o;
            if (o.status === 'UNKNOWN')
              return { ...o, code: o.code ?? 'NO_SUCH_REQUEST', message: vi.writeNoAnswer };
          }
        }
      } catch {
        /* thử lại ở lượt sau */
      }
    }
    return { status: 'UNKNOWN', code: 'NO_RESULT', message: vi.writeNoAnswer };
  }
}
