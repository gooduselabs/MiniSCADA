// Nguồn dữ liệu của trang vận hành (feature 007, FR-017, FR-018; research R10): LiveTagSource cài TagSource của
// @mat/ui-components, bọc một LiveConnection duy nhất (một phiên trong 10 phiên của thiết bị).
//  - Mỗi widget/màn hình gọi `subscribe(ids, fn)`; nguồn hợp mọi tập Tag, bỏ trùng, và đổi đăng ký trên CÙNG socket
//    (`setTags`). Hủy và đăng ký lại trong cùng một lượt (đổi màn hình) gom thành một bản tin `subscribe`.
//  - Mất kết nối: giữ giá trị cuối, quality STALE (live-client phát). Tag thiết bị báo lạ: UNKNOWN. INT64 ngoài ±2^53
//    giữ nguyên chuỗi như giao thức.
//  - `now()`: giờ BL335, lấy từ `ts` của bản tin máy chủ (snapshot, delta, heartbeat) cộng thời gian trôi cục bộ;
//    chưa có bản tin thì giờ cục bộ.
import type { ValueTable } from '@mat/expression';
import { LiveConnection, type ConnState, type SocketLike, type TagChange } from '@mat/live-client';
import type { TagInfo, TagSource, TagState } from '@mat/ui-components';

export interface LiveTagSourceOptions {
  url: string;
  /** Tag của project (tags.json): `info()`. */
  tags: readonly TagInfo[];
  valueTables?: Readonly<Record<string, ValueTable>>;
  createSocket?: (url: string) => SocketLike;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

type Listener = { ids: ReadonlySet<string>; fn: (changed: readonly string[]) => void };
type Connection = TagSource['connection'];

const UNKNOWN: TagState = Object.freeze({ value: null, quality: 'UNKNOWN' as const });
const NO_DATA: TagState = Object.freeze({ value: null, quality: 'STALE' as const });
/** `"ts":<số>` nằm ở đầu bản tin snapshot/delta/heartbeat; chỉ nhìn đoạn đầu cho rẻ. */
const TS_RE = /"ts":\s*(\d+)/;

export class LiveTagSource implements TagSource {
  readonly conn: LiveConnection;
  #infos = new Map<string, TagInfo>();
  #tables: Readonly<Record<string, ValueTable>>;
  #states = new Map<string, TagState>();
  #listeners = new Set<Listener>();
  #connListeners = new Set<(c: Connection) => void>();
  #stateListeners = new Set<(s: ConnState) => void>();
  /** Giờ (BL335 nếu có) nhận dữ liệu mới gần nhất; 0 khi chưa có. Bản tin STALE khi mất kết nối không tính. */
  lastUpdate = 0;
  #localNow: () => number;
  #offset: number | null = null;
  #connection: Connection = 'offline';
  #everLive = false;
  #flushQueued = false;

  constructor(opt: LiveTagSourceOptions) {
    for (const t of opt.tags) this.#infos.set(t.id, t);
    this.#tables = opt.valueTables ?? {};
    this.#localNow = opt.now ?? (() => Date.now());
    const inner = opt.createSocket ?? ((u: string) => new WebSocket(u) as unknown as SocketLike);
    const live: ConstructorParameters<typeof LiveConnection>[0] = {
      url: opt.url,
      tags: [],
      createSocket: (u) => this.#wrap(inner(u)),
      now: this.#localNow,
    };
    if (opt.random) live.random = opt.random;
    if (opt.setTimer) live.setTimer = opt.setTimer;
    if (opt.clearTimer) live.clearTimer = opt.clearTimer;
    this.conn = new LiveConnection(live);
    this.conn.onChange = (changes) => this.#apply(changes);
    this.conn.onState = (s) => this.#onState(s);
    this.conn.onSubscribed = () => this.#markUnknown();
  }

  /** Bọc socket: đọc `ts` của máy chủ trước khi LiveConnection xử lý bản tin. */
  #wrap(inner: SocketLike): SocketLike {
    const w: SocketLike = {
      send: (d) => inner.send(d),
      close: (c, r) => inner.close(c, r),
      onopen: null,
      onmessage: null,
      onclose: null,
    };
    inner.onopen = () => w.onopen?.();
    inner.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const m = TS_RE.exec(ev.data.length > 200 ? ev.data.slice(0, 200) : ev.data);
        if (m) this.#offset = Number(m[1]) - this.#localNow();
      }
      w.onmessage?.(ev);
    };
    inner.onclose = (ev) => w.onclose?.(ev);
    return w;
  }

  start(): void {
    this.#flush();
    this.conn.start();
  }

  stop(): void {
    this.conn.stop();
  }

  info(id: string): TagInfo | undefined {
    return this.#infos.get(id);
  }

  get(id: string): TagState {
    const st = this.#states.get(id);
    if (st) return st;
    return this.#infos.has(id) ? NO_DATA : UNKNOWN;
  }

  valueTable(name: string): ValueTable | undefined {
    return Object.hasOwn(this.#tables, name) ? this.#tables[name] : undefined;
  }

  get connection(): Connection {
    return this.#connection;
  }

  now(): number {
    return this.#localNow() + (this.#offset ?? 0);
  }

  /** Báo mỗi lần `connection` đổi (live ↔ stale ↔ offline). Trả hàm hủy. */
  onConnection(fn: (c: Connection) => void): () => void {
    this.#connListeners.add(fn);
    return () => {
      this.#connListeners.delete(fn);
    };
  }

  /** Trạng thái thô của LiveConnection (connecting, open, live, offline, full, incompatible…), cho thanh trạng thái. */
  onState(fn: (s: ConnState) => void): () => void {
    this.#stateListeners.add(fn);
    return () => {
      this.#stateListeners.delete(fn);
    };
  }

  /** Báo mọi người đăng ký như thể Tag của họ vừa đổi: widget tính lại (khóa điều khiển khi phiên đổi). */
  refresh(): void {
    for (const l of [...this.#listeners]) if (l.ids.size) l.fn([...l.ids]);
  }

  subscribe(ids: readonly string[], onChange: (changed: readonly string[]) => void): () => void {
    const l: Listener = { ids: new Set(ids), fn: onChange };
    this.#listeners.add(l);
    this.#queueFlush();
    return () => {
      if (this.#listeners.delete(l)) this.#queueFlush();
    };
  }

  #queueFlush(): void {
    if (this.#flushQueued) return;
    this.#flushQueued = true;
    queueMicrotask(() => {
      this.#flushQueued = false;
      this.#flush();
    });
  }

  /** Hợp tập Tag của mọi người đăng ký → LiveConnection.setTags (không gửi lại khi không đổi). */
  #flush(): void {
    const union = new Set<string>();
    for (const l of this.#listeners) for (const id of l.ids) union.add(id);
    this.conn.setTags([...union]);
    for (const id of this.#states.keys()) if (!union.has(id)) this.#states.delete(id);
  }

  #apply(changes: readonly TagChange[]): void {
    const at = this.now();
    const ids: string[] = [];
    if (changes.some((c) => c.quality !== 'STALE')) this.lastUpdate = at;
    for (const c of changes) {
      const st: TagState = { value: c.value, quality: c.quality, updatedAt: at };
      if (c.reason) st.reason = c.reason;
      this.#states.set(c.id, st);
      ids.push(c.id);
    }
    this.#notify(ids);
  }

  /** Tag thiết bị báo lạ theo kết quả đăng ký gần nhất → UNKNOWN. */
  #markUnknown(): void {
    const ids: string[] = [];
    for (const id of this.conn.unknown) {
      this.#states.set(id, UNKNOWN);
      ids.push(id);
    }
    this.#notify(ids);
  }

  #notify(ids: readonly string[]): void {
    if (!ids.length) return;
    for (const l of [...this.#listeners]) {
      const hit = ids.filter((id) => l.ids.has(id));
      if (hit.length) l.fn(hit);
    }
  }

  #onState(s: ConnState): void {
    for (const fn of [...this.#stateListeners]) fn(s);
    if (s === 'live') this.#everLive = true;
    const next: Connection = s === 'live' ? 'live' : this.#everLive ? 'stale' : 'offline';
    if (next === this.#connection) return;
    this.#connection = next;
    for (const fn of [...this.#connListeners]) fn(next);
  }
}
