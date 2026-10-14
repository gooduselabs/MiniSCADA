// Nguồn lịch sử của trang vận hành (feature 010, T086; contracts/widget-catalog-010.md §4, history-api.md).
// `fetch` bằng cookie phiên tới /api/v1/history/*. MỘT hàng đợi dùng chung của trang: tối đa 2 yêu cầu bay, yêu cầu
// người dùng đi trước yêu cầu nền, hủy bằng AbortSignal. 429 BUSY: cả hàng đợi nghỉ theo Retry-After và lùi
// 1→2→4→8→16→30 s (±25 %, hạt giống tiêm được); 401 và HTTP → login-required; 404 NO_HISTORY → disabled;
// 503/lỗi mạng → error. Bộ nhớ đệm series (≤ 32 mục; khoảng chạm "bây giờ" hết hạn sau 30 s).
import {
  HistoryError,
  type AggregateQuery,
  type AggregateResult,
  type ExportQuery,
  type HistoryCatalog,
  type HistorySource,
  type HistoryState,
  type RowsQuery,
  type RowsResult,
  type SeriesQuery,
  type SeriesResult,
} from '@mat/ui-components';

export interface HttpHistoryOptions {
  fetch?: typeof fetch;
  /** Trang đang mở bằng HTTPS (lịch sử chỉ có ở HTTPS). */
  https: boolean;
  /** Ms UTC hiện hành (giờ thiết bị khi có). */
  now?: () => number;
  /** [0,1): nguồn ngẫu nhiên cho jitter của khoảng lùi. */
  random?: () => number;
  /** Máy chủ trả 401: phiên hết hạn (trang gọi WebSession.expire). */
  onUnauthorized?: () => void;
  /** Nút Đăng nhập của widget (mở hộp đăng nhập của 007). */
  requestLogin?: () => void;
  maxInflight?: number;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;
const CACHE_MAX = 32;
const VOLATILE_TTL_MS = 30_000;
const VOLATILE_WINDOW_MS = 60_000;
const BASE = '/api/v1/history';

type Priority = 'user' | 'background';

interface Job {
  url: string;
  priority: Priority;
  signal: AbortSignal | undefined;
  parse: (body: unknown) => unknown;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  onAbort: (() => void) | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

function enc(v: string): string {
  return encodeURIComponent(v);
}

function list(vals: readonly string[]): string {
  return vals.map(enc).join(',');
}

export class HttpHistorySource implements HistorySource {
  #state: HistoryState;
  readonly #fetch: typeof fetch;
  readonly #https: boolean;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #o: HttpHistoryOptions;
  readonly #max: number;
  readonly #listeners = new Set<(s: HistoryState) => void>();
  readonly #queue: Job[] = [];
  readonly #cache = new Map<string, { at: number; volatile: boolean; value: SeriesResult }>();
  #inflight = 0;
  #pauseTimer: ReturnType<typeof setTimeout> | null = null;
  #backoff = 0;
  #catalog: HistoryCatalog | null = null;

  constructor(o: HttpHistoryOptions) {
    this.#o = o;
    this.#https = o.https;
    this.#fetch = o.fetch ?? ((...a) => fetch(...a));
    this.#now = o.now ?? (() => Date.now());
    this.#random = o.random ?? (() => Math.random());
    this.#max = o.maxInflight ?? 2;
    this.#state = o.https ? 'ready' : 'login-required';
  }

  get state(): HistoryState {
    return this.#state;
  }

  onState(cb: (s: HistoryState) => void): () => void {
    this.#listeners.add(cb);
    return () => {
      this.#listeners.delete(cb);
    };
  }

  requestLogin(): void {
    this.#o.requestLogin?.();
  }

  #setState(s: HistoryState): void {
    if (s === this.#state) return;
    const from = this.#state;
    this.#state = s;
    if (s === 'ready' && from !== 'busy') this.#catalog = null;
    for (const l of [...this.#listeners]) l(s);
  }

  // ---- API ---------------------------------------------------------------------------------------------------

  async catalog(signal?: AbortSignal): Promise<HistoryCatalog> {
    if (this.#catalog && this.#state === 'ready') return this.#catalog;
    const c = (await this.#enqueue(`${BASE}/catalog`, 'user', signal, (b) => {
      if (!isObj(b) || !Array.isArray(b.groups) || typeof b.enabled !== 'boolean') return null;
      return b as unknown as HistoryCatalog;
    })) as HistoryCatalog;
    this.#catalog = c.enabled ? c : null;
    this.#setState(c.enabled ? 'ready' : 'disabled');
    return c;
  }

  async series(q: SeriesQuery, signal: AbortSignal): Promise<SeriesResult> {
    const key = this.#key(q);
    const hit = this.#cache.get(key);
    if (hit) {
      if (!hit.volatile || this.#now() - hit.at < VOLATILE_TTL_MS) {
        this.#cache.delete(key);
        this.#cache.set(key, hit); // làm mới thứ tự LRU
        return hit.value;
      }
      this.#cache.delete(key);
    }
    const p = [`group=${enc(q.group)}`, `tags=${list(q.tags)}`, `from=${q.from}`, `to=${q.to}`];
    if (q.maxPoints !== undefined) p.push(`maxPoints=${q.maxPoints}`);
    if (q.res) p.push(`res=${q.res}`);
    if (q.reduce) p.push(`reduce=${q.reduce}`);
    const value = (await this.#enqueue(
      `${BASE}/series?${p.join('&')}`,
      q.priority ?? 'background',
      signal,
      (b) => (isObj(b) && Array.isArray(b.series) ? b : null),
    )) as SeriesResult;
    this.#cache.set(key, {
      at: this.#now(),
      volatile: q.to > this.#now() - VOLATILE_WINDOW_MS,
      value,
    });
    while (this.#cache.size > CACHE_MAX) this.#cache.delete(this.#cache.keys().next().value!);
    return value;
  }

  async aggregate(q: AggregateQuery, signal: AbortSignal): Promise<AggregateResult> {
    const p = [
      `group=${enc(q.group)}`,
      `tags=${list(q.tags)}`,
      `from=${q.from}`,
      `to=${q.to}`,
      `bucketMs=${q.bucketMs}`,
    ];
    if (q.offsetMs) p.push(`offsetMs=${q.offsetMs}`);
    return (await this.#enqueue(
      `${BASE}/aggregate?${p.join('&')}`,
      q.priority ?? 'background',
      signal,
      (b) => (isObj(b) && Array.isArray(b.series) && typeof b.count === 'number' ? b : null),
    )) as AggregateResult;
  }

  async rows(q: RowsQuery, signal: AbortSignal): Promise<RowsResult> {
    const p = [`group=${enc(q.group)}`, `from=${q.from}`, `to=${q.to}`];
    if (q.tags?.length) p.push(`tags=${list(q.tags)}`);
    if (q.limit !== undefined) p.push(`limit=${q.limit}`);
    if (q.order) p.push(`order=${q.order}`);
    if (q.after !== undefined) p.push(`after=${q.after}`);
    return (await this.#enqueue(`${BASE}/rows?${p.join('&')}`, q.priority ?? 'user', signal, (b) =>
      isObj(b) && Array.isArray(b.rows) && Array.isArray(b.columns) ? b : null,
    )) as RowsResult;
  }

  exportUrl(q: ExportQuery): string {
    const p = [`group=${enc(q.group)}`, `from=${q.from}`, `to=${q.to}`];
    if (q.tags?.length) p.push(`tags=${list(q.tags)}`);
    if (q.res) p.push(`res=${q.res}`);
    if (q.fields?.length) p.push(`fields=${list(q.fields)}`);
    if (q.bom === false) p.push('bom=0');
    return `${BASE}/export.csv?${p.join('&')}`;
  }

  // ---- hàng đợi ----------------------------------------------------------------------------------------------

  #key(q: SeriesQuery): string {
    return [
      q.group,
      q.tags.join(','),
      Math.round(q.from / 1000),
      Math.round(q.to / 1000),
      q.maxPoints ?? '',
      q.res ?? '',
      q.reduce ?? '',
    ].join('|');
  }

  #enqueue(
    url: string,
    priority: Priority,
    signal: AbortSignal | undefined,
    parse: (body: unknown) => unknown,
  ): Promise<unknown> {
    if (!this.#https) {
      this.#setState('login-required');
      return Promise.reject(
        new HistoryError('HTTPS_REQUIRED', 'Lịch sử chỉ xem được qua HTTPS', 403),
      );
    }
    if (signal?.aborted) return Promise.reject(new HistoryError('ABORTED', 'Đã hủy'));
    return new Promise((resolve, reject) => {
      const job: Job = { url, priority, signal, parse, resolve, reject, onAbort: null };
      if (signal) {
        job.onAbort = () => {
          const i = this.#queue.indexOf(job);
          if (i >= 0) {
            this.#queue.splice(i, 1);
            reject(new HistoryError('ABORTED', 'Đã hủy'));
          }
          // Yêu cầu đang bay: fetch tự ném AbortError qua `signal`.
        };
        signal.addEventListener('abort', job.onAbort, { once: true });
      }
      this.#queue.push(job);
      this.#pump();
    });
  }

  #next(): Job | undefined {
    let at = this.#queue.findIndex((j) => j.priority === 'user');
    if (at < 0) at = 0;
    return this.#queue.splice(at, 1)[0];
  }

  #pump(): void {
    if (this.#pauseTimer !== null) return;
    while (this.#inflight < this.#max && this.#queue.length > 0) {
      const job = this.#next()!;
      void this.#send(job);
    }
  }

  async #send(job: Job): Promise<void> {
    this.#inflight++;
    const done = () => {
      this.#inflight--;
      this.#pump();
    };
    let res: Response;
    try {
      res = await this.#fetch(job.url, { signal: job.signal ?? null });
    } catch (e) {
      this.#finish(job);
      if (job.signal?.aborted || (e as { name?: string })?.name === 'AbortError') {
        job.reject(new HistoryError('ABORTED', 'Đã hủy'));
      } else {
        this.#setState('error');
        job.reject(new HistoryError('NETWORK', 'Không kết nối được thiết bị'));
      }
      done();
      return;
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const code = isObj(body) && typeof body.error === 'string' ? body.error : `HTTP_${res.status}`;
    const msg = isObj(body) && typeof body.message === 'string' ? body.message : code;

    if (res.status === 429) {
      this.#retryLater(job, Number(res.headers.get('Retry-After')));
      this.#inflight--;
      return;
    }
    this.#finish(job);
    if (res.ok) {
      const parsed = job.parse(body);
      if (parsed === null) {
        job.reject(new HistoryError('BAD_RESPONSE', 'Phản hồi lịch sử sai hình dạng', res.status));
      } else {
        this.#backoff = 0;
        if (this.#state === 'busy' || this.#state === 'error') this.#setState('ready');
        job.resolve(parsed);
      }
    } else if (res.status === 401) {
      this.#setState('login-required');
      this.#o.onUnauthorized?.();
      job.reject(new HistoryError(code, msg, 401));
    } else if (res.status === 403 && code === 'HTTPS_REQUIRED') {
      this.#setState('login-required');
      job.reject(new HistoryError(code, msg, 403));
    } else if (res.status === 404 && code === 'NO_HISTORY') {
      this.#setState('disabled');
      job.reject(new HistoryError(code, msg, 404));
    } else if (res.status >= 500) {
      this.#setState('error');
      job.reject(new HistoryError(code, msg, res.status));
    } else {
      job.reject(new HistoryError(code, msg, res.status));
    }
    done();
  }

  #finish(job: Job): void {
    if (job.onAbort) job.signal?.removeEventListener('abort', job.onAbort);
  }

  /** 429: trả yêu cầu về đầu hàng đợi, cả hàng đợi nghỉ max(Retry-After, bậc lùi) ± 25 %. */
  #retryLater(job: Job, retryAfterS: number): void {
    this.#queue.unshift(job);
    if (this.#pauseTimer !== null) return; // đã nghỉ vì một yêu cầu 429 khác
    const step = BACKOFF_MS[Math.min(this.#backoff, BACKOFF_MS.length - 1)]!;
    this.#backoff++;
    const ra = Number.isFinite(retryAfterS) && retryAfterS > 0 ? retryAfterS * 1000 : 0;
    const jitter = 1 + (this.#random() * 0.5 - 0.25);
    const delay = Math.round(Math.min(30_000, Math.max(ra, step)) * jitter);
    this.#setState('busy');
    this.#pauseTimer = setTimeout(() => {
      this.#pauseTimer = null;
      this.#pump();
    }, delay);
  }
}
