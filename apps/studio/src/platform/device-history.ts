// Nguồn lịch sử từ thiết bị cho Studio (feature 010, T131; contracts/studio-010.md §2 và §3, history-api.md): gọi
// `/api/v1/history/*` qua `DeviceLink.get`. Token Bearer do lớp Rust giữ và gắn vào yêu cầu (giao diện không thấy token). MỘT hàng
// đợi dùng chung: tối đa 2 yêu cầu bay, yêu cầu người dùng đi trước yêu cầu nền, hủy bằng AbortSignal; http 429 (BUSY): cả hàng
// đợi nghỉ theo bậc lùi 1→2→4→8→16→30 s (±25 %); 401 → login-required; 404 → disabled; 5xx và lỗi mạng → error.
// Lớp Rust trả lỗi HTTP khác 2xx dưới dạng `{ error: 'http', detail: mã }` nên mã lỗi của API suy ra từ mã HTTP.
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
import {
  isDeviceError,
  type ApiResult,
  type DeviceError,
  type DeviceLink,
} from './device-types.ts';

export interface DeviceHistoryOptions {
  link: Pick<DeviceLink, 'get'>;
  /** Id thiết bị đang Online (null: chưa chọn thiết bị). */
  deviceId: () => string | null;
  /** [0,1): nguồn ngẫu nhiên cho jitter của khoảng lùi. */
  random?: () => number;
  maxInflight?: number;
  /** Nút Đăng nhập của khung xem trước (mở hộp đăng nhập Online). */
  requestLogin?: () => void;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;
const BASE = '/api/v1/history';

type Priority = 'user' | 'background';
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

interface Job {
  path: string;
  query: Record<string, string>;
  priority: Priority;
  signal: AbortSignal | undefined;
  parse: (body: unknown) => unknown;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  onAbort: (() => void) | null;
}

const list = (vals: readonly string[]): string => vals.join(',');
const enc = encodeURIComponent;

export class DeviceHistorySource implements HistorySource {
  #state: HistoryState = 'ready';
  readonly #o: DeviceHistoryOptions;
  readonly #random: () => number;
  readonly #max: number;
  readonly #listeners = new Set<(s: HistoryState) => void>();
  readonly #queue: Job[] = [];
  #inflight = 0;
  #pauseTimer: ReturnType<typeof setTimeout> | null = null;
  #backoff = 0;
  #catalog: HistoryCatalog | null = null;

  constructor(o: DeviceHistoryOptions) {
    this.#o = o;
    this.#random = o.random ?? (() => Math.random());
    this.#max = o.maxInflight ?? 2;
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
    const c = (await this.#enqueue('catalog', {}, 'user', signal, (b) =>
      isObj(b) && Array.isArray(b.groups) && typeof b.enabled === 'boolean' ? b : null,
    )) as HistoryCatalog;
    this.#catalog = c.enabled ? c : null;
    this.#setState(c.enabled ? 'ready' : 'disabled');
    return c;
  }

  async series(q: SeriesQuery, signal: AbortSignal): Promise<SeriesResult> {
    const query: Record<string, string> = {
      group: q.group,
      tags: list(q.tags),
      from: String(q.from),
      to: String(q.to),
    };
    if (q.maxPoints !== undefined) query.maxPoints = String(q.maxPoints);
    if (q.res) query.res = q.res;
    if (q.reduce) query.reduce = q.reduce;
    return (await this.#enqueue('series', query, q.priority ?? 'background', signal, (b) =>
      isObj(b) && Array.isArray(b.series) ? b : null,
    )) as SeriesResult;
  }

  async aggregate(q: AggregateQuery, signal: AbortSignal): Promise<AggregateResult> {
    const query: Record<string, string> = {
      group: q.group,
      tags: list(q.tags),
      from: String(q.from),
      to: String(q.to),
      bucketMs: String(q.bucketMs),
    };
    if (q.offsetMs) query.offsetMs = String(q.offsetMs);
    return (await this.#enqueue('aggregate', query, q.priority ?? 'background', signal, (b) =>
      isObj(b) && Array.isArray(b.series) && typeof b.count === 'number' ? b : null,
    )) as AggregateResult;
  }

  async rows(q: RowsQuery, signal: AbortSignal): Promise<RowsResult> {
    const query: Record<string, string> = {
      group: q.group,
      from: String(q.from),
      to: String(q.to),
    };
    if (q.tags?.length) query.tags = list(q.tags);
    if (q.limit !== undefined) query.limit = String(q.limit);
    if (q.order) query.order = q.order;
    if (q.after !== undefined) query.after = String(q.after);
    return (await this.#enqueue('rows', query, q.priority ?? 'user', signal, (b) =>
      isObj(b) && Array.isArray(b.rows) && Array.isArray(b.columns) ? b : null,
    )) as RowsResult;
  }

  /** Dạng đường dẫn của API; Studio xuất file bằng `ReportTable` rồi lưu qua lệnh của Tauri nên không mở URL này. */
  exportUrl(q: ExportQuery): string {
    const p = [`group=${enc(q.group)}`, `from=${q.from}`, `to=${q.to}`];
    if (q.tags?.length) p.push(`tags=${enc(list(q.tags))}`);
    if (q.res) p.push(`res=${q.res}`);
    if (q.fields?.length) p.push(`fields=${enc(list(q.fields))}`);
    if (q.bom === false) p.push('bom=0');
    return `${BASE}/export.csv?${p.join('&')}`;
  }

  // ---- hàng đợi ----------------------------------------------------------------------------------------------

  #enqueue(
    endpoint: string,
    query: Record<string, string>,
    priority: Priority,
    signal: AbortSignal | undefined,
    parse: (body: unknown) => unknown,
  ): Promise<unknown> {
    if (this.#o.deviceId() === null)
      return Promise.reject(new HistoryError('NO_DEVICE', 'NO_DEVICE'));
    if (signal?.aborted) return Promise.reject(new HistoryError('ABORTED', 'ABORTED'));
    return new Promise((resolve, reject) => {
      const job: Job = {
        path: `${BASE}/${endpoint}`,
        query,
        priority,
        signal,
        parse,
        resolve,
        reject,
        onAbort: null,
      };
      if (signal) {
        job.onAbort = () => {
          const i = this.#queue.indexOf(job);
          if (i >= 0) {
            this.#queue.splice(i, 1);
            reject(new HistoryError('ABORTED', 'ABORTED'));
          }
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
    while (this.#inflight < this.#max && this.#queue.length > 0) void this.#send(this.#next()!);
  }

  #finish(job: Job): void {
    if (job.onAbort) job.signal?.removeEventListener('abort', job.onAbort);
  }

  async #send(job: Job): Promise<void> {
    this.#inflight++;
    const id = this.#o.deviceId();
    let reply: ApiResult | DeviceError;
    try {
      reply =
        id === null ? { error: 'no-such-device' } : await this.#o.link.get(id, job.path, job.query);
    } catch (e) {
      reply = isDeviceError(e) ? e : { error: 'network' };
    }
    if (isDeviceError(reply) && reply.error === 'http' && reply.detail === 429) {
      this.#inflight--;
      this.#retryLater(job);
      return;
    }
    this.#finish(job);
    if (job.signal?.aborted) job.reject(new HistoryError('ABORTED', 'ABORTED'));
    else if (isDeviceError(reply)) job.reject(this.#failure(reply));
    else {
      const parsed = job.parse(reply.body);
      if (parsed === null)
        job.reject(new HistoryError('BAD_RESPONSE', 'BAD_RESPONSE', reply.status));
      else {
        this.#backoff = 0;
        if (this.#state === 'busy' || this.#state === 'error') this.#setState('ready');
        job.resolve(parsed);
      }
    }
    this.#inflight--;
    this.#pump();
  }

  /** Lỗi của lớp Rust → HistoryError (mã của API suy từ mã HTTP) và state của nguồn. */
  #failure(e: DeviceError): HistoryError {
    switch (e.error) {
      case 'auth-required':
        this.#setState('login-required');
        return new HistoryError('AUTH_REQUIRED', 'AUTH_REQUIRED', 401);
      case 'session-expired':
        this.#setState('login-required');
        return new HistoryError('SESSION_EXPIRED', 'SESSION_EXPIRED', 401);
      case 'session-invalid':
        this.#setState('login-required');
        return new HistoryError('SESSION_INVALID', 'SESSION_INVALID', 401);
      case 'forbidden':
        return new HistoryError('FORBIDDEN', 'FORBIDDEN', 403);
      case 'http': {
        const status = typeof e.detail === 'number' ? e.detail : 0;
        if (status === 404) {
          this.#setState('disabled');
          return new HistoryError('NO_HISTORY', 'NO_HISTORY', 404);
        }
        if (status === 422) return new HistoryError('RANGE_TOO_LARGE', 'RANGE_TOO_LARGE', 422);
        if (status === 400) return new HistoryError('BAD_REQUEST', 'BAD_REQUEST', 400);
        if (status >= 500) {
          this.#setState('error');
          return new HistoryError('HISTORY_UNAVAILABLE', 'HISTORY_UNAVAILABLE', status);
        }
        return new HistoryError(`HTTP_${status}`, `HTTP_${status}`, status);
      }
      default:
        this.#setState('error');
        return new HistoryError('NETWORK', 'NETWORK');
    }
  }

  /** 429: trả yêu cầu về đầu hàng đợi, cả hàng đợi nghỉ theo bậc lùi ± 25 %. */
  #retryLater(job: Job): void {
    this.#queue.unshift(job);
    if (this.#pauseTimer !== null) return;
    const step = BACKOFF_MS[Math.min(this.#backoff, BACKOFF_MS.length - 1)]!;
    this.#backoff++;
    const jitter = 1 + (this.#random() * 0.5 - 0.25);
    this.#setState('busy');
    this.#pauseTimer = setTimeout(
      () => {
        this.#pauseTimer = null;
        this.#pump();
      },
      Math.round(Math.min(30_000, step) * jitter),
    );
  }
}
