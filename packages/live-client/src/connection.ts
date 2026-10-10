// Kết nối /api/v1/live theo protocol 1.0.0 (contracts/live-ws.md): subscribe danh sách Tag,
// echo heartbeat, watchdog 15 s, STALE khi mất kết nối, backoff 1→30 s có jitter, 4429 → chờ 30 s
// có đếm ngược (Master Plan §10.2), sequence nhảy → subscribe lại. WebSocket/timer inject được.
import {
  CLOSE_MAX_CLIENTS,
  CLOSE_SILENT_SERVER,
  applyMessage,
  createLiveState,
  heartbeatReply,
  isCompatibleProtocol,
  parseServerMessage,
  staleChanges,
  type LiveState,
  type TagChange,
} from './state.ts';

export type ConnState =
  'idle' | 'connecting' | 'open' | 'live' | 'offline' | 'full' | 'incompatible' | 'stopped';

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
}

export interface LiveConnectionOptions {
  url: string;
  tags: string[];
  createSocket?: (url: string) => SocketLike;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  fullRetryMs?: number;
  watchdogMs?: number;
}

export const FULL_RETRY_MS = 30_000;
export const WATCHDOG_MS = 15_000;

/** 1, 2, 4, 8, 16, 30, 30… s, nhân hệ số ngẫu nhiên [0,5; 1]. */
export function backoffDelay(attempt: number, random: () => number): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 10));
  return Math.round(base * (0.5 + 0.5 * random()));
}

export class LiveConnection {
  state: ConnState = 'idle';
  /** Thời điểm sẽ thử lại khi `full` (theo `now()`), để giao diện đếm ngược. */
  retryAt: number | null = null;
  readonly live: LiveState = createLiveState();
  onChange: ((changes: TagChange[]) => void) | null = null;
  onState: ((state: ConnState, conn: LiveConnection) => void) | null = null;

  private readonly opt: Required<LiveConnectionOptions>;
  private socket: SocketLike | null = null;
  private attempt = 0;
  private requestSeq = 0;
  private retryTimer: unknown = null;
  private watchdog: unknown = null;

  constructor(opt: LiveConnectionOptions) {
    this.opt = {
      createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      now: () => Date.now(),
      random: Math.random,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      fullRetryMs: FULL_RETRY_MS,
      watchdogMs: WATCHDOG_MS,
      ...opt,
    };
  }

  start(): void {
    if (this.state !== 'idle' && this.state !== 'stopped') return;
    this.connect();
  }

  stop(): void {
    this.setState('stopped');
    this.clearTimers();
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onclose = s.onmessage = s.onopen = null;
      s.close(1000, 'stop');
    }
  }

  /** Nút "Thử lại ngay" khi đầy hoặc mất kết nối. */
  retryNow(): void {
    if (this.state === 'full' || this.state === 'offline') this.connect();
  }

  private setState(s: ConnState): void {
    if (this.state === s) return;
    this.state = s;
    this.onState?.(s, this);
  }

  private clearTimers(): void {
    if (this.retryTimer !== null) this.opt.clearTimer(this.retryTimer);
    if (this.watchdog !== null) this.opt.clearTimer(this.watchdog);
    this.retryTimer = this.watchdog = null;
  }

  private connect(): void {
    this.clearTimers();
    this.retryAt = null;
    this.live.lastError = null;
    this.live.hasSnapshot = false;
    this.setState('connecting');
    const s = this.opt.createSocket(this.opt.url);
    this.socket = s;
    s.onopen = () => {
      this.setState('open');
      this.armWatchdog();
      this.subscribe();
    };
    s.onmessage = (ev) => this.onMessage(String(ev.data));
    s.onclose = (ev) => this.onClosed(ev.code);
  }

  private subscribe(): void {
    const requestId = `r${++this.requestSeq}`;
    this.live.expectedSubscription = requestId;
    this.socket?.send(
      JSON.stringify({ type: 'subscribe', requestId, tags: this.opt.tags, mode: 'delta' }),
    );
  }

  private armWatchdog(): void {
    if (this.watchdog !== null) this.opt.clearTimer(this.watchdog);
    this.watchdog = this.opt.setTimer(() => {
      // Máy chủ im lặng quá lâu (mạng chết): coi như mất kết nối ngay, không chờ TCP báo.
      const s = this.socket;
      if (!s) return;
      s.onclose = s.onmessage = s.onopen = null;
      s.close(CLOSE_SILENT_SERVER, 'silent server');
      this.onClosed(CLOSE_SILENT_SERVER);
    }, this.opt.watchdogMs);
  }

  private onMessage(raw: string): void {
    this.armWatchdog();
    const msg = parseServerMessage(raw);
    if (!msg) return;
    const reply = heartbeatReply(msg, this.opt.now());
    if (reply) {
      this.socket?.send(JSON.stringify(reply));
      return;
    }
    const changes = applyMessage(this.live, msg);
    if (msg.type === 'hello' && !isCompatibleProtocol(this.live.hello?.protocolVersion ?? '')) {
      this.setState('incompatible');
      const s = this.socket;
      this.socket = null;
      this.clearTimers();
      if (s) {
        s.onclose = s.onmessage = s.onopen = null;
        s.close(1000, 'incompatible protocol');
      }
      return;
    }
    if (changes.length) this.onChange?.(changes);
    if (msg.type === 'snapshot' && this.live.hasSnapshot) {
      this.attempt = 0;
      this.setState('live');
    }
    if (this.live.needResync) {
      this.live.needResync = false;
      this.subscribe();
    }
  }

  private onClosed(code: number): void {
    if (this.watchdog !== null) this.opt.clearTimer(this.watchdog);
    this.watchdog = null;
    this.socket = null;
    if (this.state === 'stopped' || this.state === 'incompatible') return;
    if (this.live.ids.length) this.onChange?.(staleChanges(this.live));
    this.live.hasSnapshot = false;
    if (code === CLOSE_MAX_CLIENTS || this.live.lastError?.code === 'MAX_CLIENTS_REACHED') {
      this.retryAt = this.opt.now() + this.opt.fullRetryMs;
      this.setState('full');
      this.retryTimer = this.opt.setTimer(() => this.connect(), this.opt.fullRetryMs);
      return;
    }
    this.setState('offline');
    const delay = backoffDelay(this.attempt++, this.opt.random);
    this.retryAt = this.opt.now() + delay;
    this.retryTimer = this.opt.setTimer(() => this.connect(), delay);
  }
}
