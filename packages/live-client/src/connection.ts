// Kết nối /api/v1/live theo protocol 1.0.0 (contracts/live-ws.md): subscribe danh sách Tag,
// echo heartbeat, watchdog 15 s, STALE khi mất kết nối, backoff 1→30 s có jitter, 4429 → chờ 30 s
// có đếm ngược (Master Plan §10.2), sequence nhảy → subscribe lại. WebSocket/timer inject được.
// Feature 004 (research R10): đổi danh sách Tag trên cùng socket (`setTags`), đọc Tag lạ (`unknown`).
// Feature 005 (protocol 1.1.0, specs/005-device-online/contracts/live-protocol-1.1.md): mã đóng 1012 → thử lại
// mỗi 1 s cộng 0–250 ms, tối đa 30 lần, rồi về backoff thường; `hello.project.digest` đọc qua `live.hello`.
// Feature 006 (protocol 1.2.0, specs/006-tags-modbus/contracts/live-protocol-1.2.md): `reason` của quality (state.ts);
// mã đóng 4401 → trạng thái `session-ended` và gọi `onSessionEnded`, không tự kết nối lại bằng token cũ.
// Feature 009 (protocol 1.3.0, specs/009-alarms/contracts/live-protocol-1.3.md): `subscribeAlarms` riêng (alarms.ts), chỉ gửi
// khi `hello.features` có "alarms"; tự đăng ký lại sau mỗi lần kết nối lại.
import {
  AlarmFeed,
  type AlarmDeltaMsg,
  type AlarmSnapshotMsg,
  type AlarmSupport,
} from './alarms.ts';
import {
  CLOSE_MAX_CLIENTS,
  CLOSE_SERVICE_RESTART,
  CLOSE_SESSION_ENDED,
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
  | 'idle'
  | 'connecting'
  | 'open'
  | 'live'
  | 'offline'
  | 'full'
  | 'incompatible'
  | 'stopped'
  /** Protocol 1.2.0: phiên hết hạn (mã đóng 4401); chờ `start()` sau khi đăng nhập lại. */
  | 'session-ended';

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
/**
 * Sau mã đóng 1012, thử lại mỗi `RESTART_RETRY_MS` cộng ngẫu nhiên 0–`RESTART_JITTER_MS` (để 10 client không
 * cùng gọi một lúc), tối đa `RESTART_MAX_RETRIES` lần, rồi mới về backoff thường. Thiết bị chạy lại sau khoảng
 * 1–3 s, nên trang tải lại kịp trong 10 s (FR-025 của feature 005).
 */
export const RESTART_RETRY_MS = 1000;
export const RESTART_JITTER_MS = 250;
export const RESTART_MAX_RETRIES = 30;

/** 1, 2, 4, 8, 16, 30, 30… s, nhân hệ số ngẫu nhiên [0,5; 1]. */
export function backoffDelay(attempt: number, random: () => number): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 10));
  return Math.round(base * (0.5 + 0.5 * random()));
}

/** Bỏ Tag trùng, giữ thứ tự (giao thức yêu cầu Tag duy nhất trong subscribe). */
const uniqueTags = (tags: readonly string[]): string[] => [...new Set(tags)];
const sameTags = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((t, i) => t === b[i]);

export class LiveConnection {
  state: ConnState = 'idle';
  /** Thời điểm sẽ thử lại khi `full` hoặc `offline` (theo `now()`), để giao diện đếm ngược. */
  retryAt: number | null = null;
  readonly live: LiveState = createLiveState();
  onChange: ((changes: TagChange[]) => void) | null = null;
  onState: ((state: ConnState, conn: LiveConnection) => void) | null = null;
  /**
   * Danh sách Tag hiện tại vừa có hiệu lực trên socket đang mở: nhận snapshot của đăng ký mới nhất,
   * thiết bị trả NO_VALID_TAGS cho đăng ký đó (mọi Tag đều lạ), hoặc danh sách rỗng và thiết bị đã
   * nhận phiên (`hello`). Đọc `unknown` trong lúc này.
   */
  onSubscribed: ((conn: LiveConnection) => void) | null = null;
  /**
   * Máy chủ đóng bằng 4401 (protocol 1.2.0): phiên đã dùng để mở kết nối hết hạn hoặc bị thu hồi. Kết nối không tự
   * mở lại; người nghe hỏi đăng nhập lại rồi gọi `start()`.
   */
  onSessionEnded: ((conn: LiveConnection) => void) | null = null;
  /**
   * Feature 013 (admin-api §6): quyền của phiên đổi (`{"type":"access-changed"}`). Máy chủ đã gỡ Tag không còn được
   * phép; người nghe tải lại quyền và dựng lại menu, màn hình.
   */
  onAccessChanged: ((conn: LiveConnection) => void) | null = null;

  private readonly opt: Required<LiveConnectionOptions>;
  private readonly alarmFeed: AlarmFeed;
  private tagList: string[];
  private socket: SocketLike | null = null;
  private attempt = 0;
  /** Số lần thử lại nhanh còn lại sau mã đóng 1012; hết thì về backoff thường. */
  private restartLeft = 0;
  private requestSeq = 0;
  private retryTimer: unknown = null;
  private watchdog: unknown = null;
  /** Đã nhận `hello` hợp lệ trên socket hiện tại (thiết bị đã cấp phiên). */
  private accepted = false;
  /** Đăng ký hiện tại đã có kết quả trên socket hiện tại. */
  private answered = false;

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
    this.tagList = uniqueTags(opt.tags);
    this.alarmFeed = new AlarmFeed({
      send: (m) => this.socket?.send(JSON.stringify(m)),
      setTimer: this.opt.setTimer,
      clearTimer: this.opt.clearTimer,
      now: this.opt.now,
    });
  }

  // ---- alarm (protocol 1.3.0) ----

  /** Hỗ trợ alarm theo `hello` của kết nối hiện tại (`unknown` khi chưa có `hello` hoặc đã mất kết nối). */
  get alarmSupport(): AlarmSupport | 'unknown' {
    return this.alarmFeed.support;
  }

  /** Đã đăng ký nhận alarm (sẽ gửi `subscribeAlarms` sau `hello` nếu thiết bị hỗ trợ, và sau mỗi lần kết nối lại). */
  get alarmsWanted(): boolean {
    return this.alarmFeed.wanted;
  }

  /** `hello` báo thiết bị hỗ trợ, không hỗ trợ (< 1.3.0), hoặc project không có alarm; gọi mỗi lần nhận `hello`. */
  set onAlarmSupport(fn: ((s: AlarmSupport) => void) | null) {
    this.alarmFeed.onSupport = fn;
  }
  /** Snapshot đầy đủ (đã ghép mảnh): thay hoàn toàn trạng thái alarm cũ. */
  set onAlarmSnapshot(fn: ((s: AlarmSnapshotMsg) => void) | null) {
    this.alarmFeed.onSnapshot = fn;
  }
  set onAlarmDelta(fn: ((d: AlarmDeltaMsg) => void) | null) {
    this.alarmFeed.onDelta = fn;
  }
  /** Sequence đứt hoặc thiếu mảnh: đã xin lại snapshot; dữ liệu đang có là cũ cho tới khi snapshot mới tới. */
  set onAlarmResync(fn: (() => void) | null) {
    this.alarmFeed.onResync = fn;
  }

  subscribeAlarms(): void {
    this.alarmFeed.want();
  }

  unsubscribeAlarms(): void {
    this.alarmFeed.unwant();
  }

  /** Danh sách Tag đang đăng ký (đã bỏ trùng). */
  get tags(): readonly string[] {
    return this.tagList;
  }

  /**
   * Tag thiết bị báo không có, theo kết quả đăng ký gần nhất: `unknown` của snapshot, hoặc mọi Tag
   * khi thiết bị trả NO_VALID_TAGS. Giữ nguyên tới khi đăng ký mới có kết quả.
   */
  get unknown(): readonly string[] {
    return this.live.unknown;
  }

  /** Đăng ký hiện tại đã có kết quả trên socket đang mở (xem `onSubscribed`). */
  get subscribed(): boolean {
    return this.answered;
  }

  /**
   * Đổi danh sách Tag. Socket đang mở thì gửi `subscribe` mới (`requestId` mới, thay đăng ký cũ;
   * dữ liệu của đăng ký cũ bị bỏ). Chưa mở thì đăng ký khi mở. Danh sách không đổi thì không gửi lại;
   * danh sách rỗng thì không gửi gì.
   */
  setTags(tags: readonly string[]): void {
    const next = uniqueTags(tags);
    if (sameTags(next, this.tagList)) return;
    this.tagList = next;
    if (this.state === 'open' || this.state === 'live') this.subscribe();
  }

  start(): void {
    if (this.state !== 'idle' && this.state !== 'stopped' && this.state !== 'session-ended') return;
    this.connect();
  }

  stop(): void {
    this.setState('stopped');
    this.clearTimers();
    this.restartLeft = 0;
    this.accepted = this.answered = false;
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
    this.accepted = this.answered = false;
    this.alarmFeed.reset();
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
    // Từ đây snapshot và delta của đăng ký cũ bị bỏ (state.ts so với `expectedSubscription`).
    this.live.expectedSubscription = requestId;
    this.answered = false;
    if (!this.tagList.length) {
      // Giao thức cần 1–1000 Tag: danh sách rỗng thì không gửi, chỉ bỏ dữ liệu của đăng ký cũ.
      // Mã yêu cầu này không được gửi nên không snapshot nào khớp nó.
      this.clearTags();
      this.live.unknown = [];
      if (this.accepted) this.markAnswered();
      return;
    }
    this.socket?.send(
      JSON.stringify({ type: 'subscribe', requestId, tags: this.tagList, mode: 'delta' }),
    );
  }

  /** Bỏ Tag của đăng ký cũ: không còn delta nào được áp, mất kết nối không phát STALE cho chúng. */
  private clearTags(): void {
    const l = this.live;
    l.ids = [];
    l.values = [];
    l.qualities = [];
    l.reasons = [];
    l.hasSnapshot = false;
  }

  private markAnswered(): void {
    this.answered = true;
    this.onSubscribed?.(this);
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
    if (this.alarmFeed.handle(msg)) return;
    if (msg.type === 'access-changed') {
      this.onAccessChanged?.(this);
      return;
    }
    const changes = applyMessage(this.live, msg);
    if (msg.type === 'hello') {
      if (!isCompatibleProtocol(this.live.hello?.protocolVersion ?? '')) {
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
      this.accepted = true;
      if (!this.tagList.length && !this.answered) {
        // Không có Tag nào để chờ snapshot (trang alarm, trang hệ thống): `hello` hợp lệ là đủ để coi là trực tuyến.
        this.attempt = 0;
        this.restartLeft = 0;
        this.setState('live');
        this.markAnswered();
      }
      if (this.live.hello) this.alarmFeed.onHello(this.live.hello);
      return;
    }
    if (changes.length) this.onChange?.(changes);
    const current = this.live.subscriptionId === this.live.expectedSubscription;
    if (msg.type === 'snapshot' && this.live.hasSnapshot && current) {
      this.attempt = 0;
      this.restartLeft = 0;
      this.setState('live');
      this.markAnswered();
    }
    if (
      msg.type === 'error' &&
      msg.code === 'NO_VALID_TAGS' &&
      msg.requestId === this.live.expectedSubscription &&
      this.tagList.length
    ) {
      // Thiết bị không có Tag nào trong danh sách. Máy chủ giữ đăng ký cũ, client bỏ dữ liệu của nó.
      this.clearTags();
      this.live.unknown = [...this.tagList];
      this.markAnswered();
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
    this.accepted = this.answered = false;
    this.alarmFeed.reset();
    if (this.state === 'stopped' || this.state === 'incompatible') return;
    // 1008/1009: chính client vi phạm giao thức hoặc gửi frame quá lớn (lỗi của trang/Studio).
    if (code === 1008 || code === 1009)
      console.error(`live: máy chủ đóng ${code} (vi phạm giao thức hoặc bản tin quá lớn)`);
    if (this.live.ids.length) this.onChange?.(staleChanges(this.live));
    this.live.hasSnapshot = false;
    if (code === CLOSE_SESSION_ENDED) {
      // Token cũ không dùng lại được: không hẹn giờ kết nối lại.
      this.restartLeft = 0;
      this.retryAt = null;
      this.setState('session-ended');
      this.onSessionEnded?.(this);
      return;
    }
    // Hẹn giờ thử lại trước khi báo trạng thái: người nghe gọi stop() trong onState thì hủy được.
    if (code === CLOSE_MAX_CLIENTS || this.live.lastError?.code === 'MAX_CLIENTS_REACHED') {
      this.restartLeft = 0; // máy chủ đã chạy lại và trả lời: hết lượt thử nhanh
      this.retryAt = this.opt.now() + this.opt.fullRetryMs;
      this.retryTimer = this.opt.setTimer(() => this.connect(), this.opt.fullRetryMs);
      this.setState('full');
      return;
    }
    // 1012: máy chủ sắp chạy lại. Các lần kết nối bị từ chối trong lúc chờ (1006) vẫn thử nhanh tới hết lượt;
    // 1012 mới (ví dụ quay về bản cũ sau khi kiểm tra sức khỏe lỗi) thì đếm lại từ đầu.
    if (code === CLOSE_SERVICE_RESTART) this.restartLeft = RESTART_MAX_RETRIES;
    let delay: number;
    if (this.restartLeft > 0) {
      this.restartLeft--;
      delay = Math.round(RESTART_RETRY_MS + RESTART_JITTER_MS * this.opt.random());
    } else delay = backoffDelay(this.attempt++, this.opt.random);
    this.retryAt = this.opt.now() + delay;
    this.retryTimer = this.opt.setTimer(() => this.connect(), delay);
    this.setState('offline');
  }
}
