// Phiên thiết bị duy nhất của Studio (data-model §9, research R10): một LiveConnection đăng ký mọi
// Tag của project, cộng một vòng hỏi /api/v1/system/info mỗi 5 s khi đang theo dõi. Bảng Tag và xem
// trước cùng đọc giá trị ở đây, nên Studio chỉ chiếm 1 trong 10 phiên của thiết bị (FR-030).
// Không chứa chuỗi giao diện: trạng thái và lý do lỗi là mã, giao diện đổi sang chữ qua i18n.
//
// Feature 005 (data-model §6, contracts/tauri-commands.md §4–7, research R6) thêm chế độ `online`: theo id
// của thiết bị đã lưu, qua HTTPS có ghim fingerprint và đăng nhập (dò chứng chỉ → xác nhận ghim → đăng
// nhập → kết nối). Chế độ `monitor` của 004 (theo địa chỉ, HTTP, chỉ đọc) giữ nguyên; thiết bị runtime cũ
// (< 0.4.0) rơi về chế độ này kèm mã `runtime-old` (FR-035).
import {
  LiveConnection,
  type ConnState,
  type Quality,
  type SocketLike,
  type TagChange,
  type TagValue,
} from '@mat/live-client';
import { compareSemver, type CompareResult } from '@mat/project-schema';
import {
  isDeviceError,
  type DeviceError,
  type DeviceIdentity,
  type DeviceLink,
  type KnownDevice,
  type ProbeResult,
  type Role,
  type SessionInfo,
} from '../platform/device-types.ts';
import { onlineFetch, onlineSocket, type CloseInfo } from './device-adapters.ts';
import { StudioAlarmSource } from './alarm-live.ts';
import {
  checkDevice,
  DEVICE_TIMEOUT_MS,
  liveUrl,
  normalizeMonitor,
  parseLogicStatus,
  type CheckErrorCode,
  type DeviceInfo,
  type FetchFn,
  type LogicStatus,
} from './device.ts';

/**
 * Trạng thái của phiên:
 *
 * ```text
 * idle ──connect──▶ connecting ──system/info ok + đăng ký Tag có kết quả──▶ monitoring
 * connecting ──system/info lỗi, quá 3 s, socket đóng trước khi theo dõi──▶ error (không tự thử lại)
 * monitoring ──socket đóng──▶ lost ──có lại──▶ monitoring (backoff của live-client)
 * connecting, lost ──4429──▶ full ──30 s──▶ connecting
 * ──giao thức khác MAJOR──▶ incompatible (không tự thử lại)
 * mọi trạng thái ──disconnect──▶ idle
 * ```
 *
 * Chế độ online (feature 005, data-model §6) thêm các bước trước `connecting`:
 *
 * ```text
 * idle ──goOnline──▶ probing ──chưa ghim──▶ pin-confirm ──confirmPin──▶ login ──đúng──▶ connecting
 *                    probing ──ghim khớp──▶ login (còn phiên Rust thì thẳng connecting)
 *                    probing ──ghim không khớp──▶ error (cert-mismatch, `mismatch` có F và G)
 *                    probing ──HTTPS không trả lời, HTTP là runtime < 0.4.0──▶ connecting (monitor, runtime-old)
 *                    probing ──not-tls (Rust lưu httpPort, T085b)──▶ đọc lại thiết bị ──▶ như dòng trên
 * login ──AUTH_FAILED, AUTH_LOCKED…──▶ login (`loginError`)
 * monitoring ──SESSION_EXPIRED──▶ relogin (dữ liệu sống vẫn chạy) ──đăng nhập lại──▶ monitoring
 * monitoring ──SESSION_INVALID──▶ idle (`error` = session-invalid)
 * monitoring ──cert-mismatch khi kết nối lại──▶ error
 * ```
 */
export type SessionState =
  | 'idle'
  | 'probing'
  | 'pin-confirm'
  | 'login'
  | 'connecting'
  | 'monitoring'
  | 'relogin'
  | 'error'
  | 'lost'
  | 'full'
  | 'incompatible';

/** `monitor`: theo địa chỉ, HTTP, chỉ đọc (004). `online`: theo id, HTTPS có ghim, đã đăng nhập (005). */
export type SessionMode = 'monitor' | 'online';

/**
 * Lý do của trạng thái `error`:
 * - `invalid-address`: địa chỉ không chuẩn hóa được (`normalizeDevice`);
 * - `timeout`: không theo dõi được trong 3 s (system/info hoặc dữ liệu sống không trả lời);
 * - `network`, `http`, `bad-response`: system/info lỗi mạng, trả mã HTTP lỗi, nội dung hỏng;
 * - `live-closed`: kết nối dữ liệu sống bị đóng trước khi theo dõi được (ví dụ thiết bị từ chối
 *   Origin của Studio).
 *
 * Feature 005 (data-model §6): `cert-unpinned`, `cert-mismatch` (chặn kết nối, `mismatch` có F và G),
 * `tls`, `auth-required`, `session-expired`, `session-invalid` (trạng thái `idle` kèm lý do), `forbidden`,
 * `https-unreachable`. `runtime-old` không phải lỗi: là `notice` khi theo dõi chỉ đọc thiết bị cũ.
 */
export type SessionErrorCode =
  | CheckErrorCode
  | 'invalid-address'
  | 'live-closed'
  | 'cert-unpinned'
  | 'cert-mismatch'
  | 'tls'
  | 'auth-required'
  | 'session-expired'
  | 'session-invalid'
  | 'forbidden'
  | 'runtime-old'
  | 'https-unreachable'
  /** Feature 006 (ADR-018): theo dõi theo địa chỉ từ ngoài mạng riêng bị lọc nguồn; hãy Online (đăng nhập). */
  | 'viewer-private';

/**
 * Phiên đang có dữ liệu sống tốt: đang theo dõi, hoặc chờ đăng nhập lại (feature 005: dữ liệu sống công khai,
 * FR-033, vẫn chạy trong lúc phiên đăng nhập hết hạn).
 */
export const isLive = (s: SessionState): boolean => s === 'monitoring' || s === 'relogin';

/** Ghi chú của phiên đang chạy (không phải lỗi): thiết bị chạy runtime cũ, chỉ theo dõi chỉ đọc. */
export type SessionNotice = Extract<SessionErrorCode, 'runtime-old'>;

/** Tài khoản đang đăng nhập (không có token: token chỉ nằm trong Rust). */
export interface SessionAuth {
  user: string;
  role: Role;
  idleTimeoutS: number;
  maxLifetimeS: number;
}

/**
 * Lý do đăng nhập không được (ở lại bước đăng nhập): `auth-failed` (không nói sai tên hay sai mật khẩu),
 * `locked` (kèm `retryAfterS`), `auth-busy`, `audit-unavailable`, `setup-required`, `unreachable`,
 * `timeout`; `failed` cho mã khác (`detail`).
 */
export type LoginErrorCode =
  | 'auth-failed'
  | 'locked'
  | 'auth-busy'
  | 'audit-unavailable'
  | 'setup-required'
  | 'unreachable'
  | 'timeout'
  | 'failed';

export interface LoginError {
  code: LoginErrorCode;
  retryAfterS?: number;
  /** Thời điểm nhận lỗi (ms, theo `now()`): để đếm ngược thời gian khóa. */
  at: number;
  detail?: string;
  /** Lỗi gốc của Rust khi `code === 'failed'` (giao diện nói câu theo mã, kèm chi tiết). */
  cause?: DeviceError;
}

/**
 * Kết quả so project trên máy với thiết bị (feature 005, US3, data-model §11). `result` chỉ có khi tài khoản từ
 * engineer trở lên (manifest và gói đọc lên cần quyền); viewer chỉ biết hai digest có khớp không.
 */
export interface CompareInfo {
  /** Thời điểm so xong (ms theo `now()`). */
  at: number;
  localDigest: string;
  /** `none` khi thiết bị chưa có project. */
  deviceDigest: string;
  same: boolean;
  result: CompareResult | null;
}

/** Trạng thái phép so: `busy` đang so, `info` kết quả gần nhất, `error` mã lỗi của lần so gần nhất. */
export interface CompareState {
  busy: boolean;
  info: CompareInfo | null;
  error: string | null;
}

/** Giá trị sống của một Tag. */
export interface LiveValue {
  value: TagValue;
  /** `STALE` khi phiên không còn theo dõi: vẫn là giá trị cuối nhưng không còn tốt. */
  quality: Quality;
  /** Thời điểm Studio nhận giá trị (ms, theo `now()`); giữ nguyên khi chuyển `STALE`. */
  ts: number;
  /** Mã lý do khi quality khác GOOD (protocol 1.2.0, data-model §6); giữ nguyên mã lạ. Vắng khi GOOD. */
  reason?: string;
}

/**
 * Sự kiện cho store và giao diện:
 * - `state`: trạng thái phiên đổi (đọc kèm `error`, `retryAt`);
 * - `live`: trạng thái LiveConnection đổi (`null` khi không còn kết nối);
 * - `values`: giá trị của các Tag này đổi, được thêm hoặc bị bỏ;
 * - `unknown`: tập Tag thiết bị không có đổi;
 * - `info`: có kết quả hỏi system/info (đọc `info`, `infoAt`, `infoError`);
 * - `online`: thông tin của chế độ online đổi mà trạng thái không đổi (`probe`, `loginError`, `busy`,
 *   `auth`…);
 * - `compare`: `compare` đổi (feature 005, US3).
 */
export type SessionEvent =
  | { type: 'state'; state: SessionState }
  | { type: 'live'; live: ConnState | null }
  | { type: 'values'; tags: readonly string[] }
  | { type: 'unknown' }
  | { type: 'info' }
  | { type: 'online' }
  | { type: 'compare' };

export interface DeviceSessionOptions {
  createSocket?: (url: string) => SocketLike;
  fetch?: FetchFn;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Lớp nói chuyện với thiết bị qua Rust (feature 005): cần cho chế độ online. */
  link?: DeviceLink;
}

/** Kết nối không xong trong hạn thì báo lỗi; hạn 2,8 s để thông báo hiện trong ≤ 3 s (FR-027). */
export const CONNECT_TIMEOUT_MS = DEVICE_TIMEOUT_MS;
/** Chu kỳ hỏi system/info khi đang theo dõi (FR-029). */
export const INFO_POLL_MS = 5000;
/**
 * Hạn kết nối ở chế độ online: chứng chỉ đã dò được ngay trước đó, nhưng bắt tay TLS và WebSocket qua Rust
 * (kết nối 3 s, bắt tay 5 s) cần dài hơn hạn 2,8 s của chế độ theo dõi.
 */
export const ONLINE_CONNECT_TIMEOUT_MS = 10_000;
/** Runtime đầu tiên có HTTPS, đăng nhập (feature 005). Cũ hơn thì chỉ theo dõi chỉ đọc (FR-035). */
export const ONLINE_RUNTIME = '0.4.0';

const httpsBase = (d: KnownDevice) => `https://${d.host}:${d.httpsPort}`;

const isPinPair = (x: unknown): x is { pinned: string; seen: string } =>
  typeof x === 'object' &&
  x !== null &&
  typeof (x as { pinned?: unknown }).pinned === 'string' &&
  typeof (x as { seen?: unknown }).seen === 'string';

export class DeviceSession {
  private readonly opt: Required<Omit<DeviceSessionOptions, 'link'>>;
  private readonly link: DeviceLink | null;
  private readonly listeners = new Set<(e: SessionEvent) => void>();
  private st: SessionState = 'idle';
  private err: SessionErrorCode | null = null;
  /** Lỗi gốc của Rust gây ra `err` (TLS, mã lạ…), nếu có. */
  private errInfo: DeviceError | null = null;
  private base: string | null = null;
  private tagList: string[] = [];
  private tagSet = new Set<string>();
  private readonly vals = new Map<string, LiveValue>();
  private unknownSet = new Set<string>();
  private lastInfo: DeviceInfo | null = null;
  private lastInfoAt: number | null = null;
  private lastInfoError: CheckErrorCode | null = null;
  private conn: LiveConnection | null = null;
  /** Alarm sống của thiết bị (feature 009, chỉ đọc): lưới alarm và xem trước Thiết bị đăng ký bằng `alarms.want(true)`. */
  readonly alarms = new StudioAlarmSource();
  /** Đã vào monitoring trong lần kết nối này: từ đó socket đóng là `lost`, không phải `error`. */
  private established = false;
  /** Tăng mỗi lần bỏ một kết nối: kết quả system/info của kết nối cũ bị bỏ. */
  private cycle = 0;
  private infoPending = false;
  private deadline: unknown = null;
  private pollTimer: unknown = null;

  // ---- Chế độ online (feature 005) ----
  private md: SessionMode = 'monitor';
  /** Thiết bị đã lưu đang làm việc (online, hoặc theo dõi thiết bị runtime cũ). */
  private dev: KnownDevice | null = null;
  private authInfo: SessionAuth | null = null;
  private feats: string[] = [];
  private ident: DeviceIdentity | null = null;
  private probeRes: ProbeResult | null = null;
  private mis: { pinned: string; seen: string | null } | null = null;
  private loginErr: LoginError | null = null;
  /** Đang chờ Rust (ghim, đăng nhập, gỡ ghim). */
  private pending = false;
  private note: SessionNotice | null = null;
  private cmp: CompareState = { busy: false, info: null, error: null };
  /** Phiên hết hạn trong lúc mất kết nối: có lại thì vào `relogin` thay vì `monitoring`. */
  private reloginPending = false;
  /** Kết nối live đã bị đóng 4401 (phiên hết): đăng nhập lại xong thì mở lại live (live-protocol-1.2 §3). */
  private liveEnded = false;
  private authPending = false;
  /** FetchFn của chế độ online (device_get theo id), dựng mỗi lần kết nối. */
  private infoFetch: FetchFn | null = null;

  constructor(opt: DeviceSessionOptions = {}) {
    const { link, ...rest } = opt;
    this.link = link ?? null;
    this.opt = {
      createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      fetch: (u, i) => fetch(u, i),
      now: () => Date.now(),
      random: Math.random,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...rest,
    };
  }

  get state(): SessionState {
    return this.st;
  }

  /** Lý do khi `state === 'error'` (và khi về `idle` vì `session-invalid`). */
  get error(): SessionErrorCode | null {
    return this.err;
  }

  /** Lỗi gốc của Rust gây ra `error` (ví dụ `{ tls: "…" }`), để giao diện nói chi tiết; `null` nếu không có. */
  get errorInfo(): DeviceError | null {
    return this.errInfo;
  }

  /** Gốc URL đã chuẩn hóa của thiết bị (`https://…` ở chế độ online). */
  get address(): string | null {
    return this.base;
  }

  /** Tag của project đang đăng ký (đã bỏ trùng). */
  get tags(): readonly string[] {
    return this.tagList;
  }

  /** Tag → giá trị sống. Chỉ có Tag đã nhận giá trị; Tag thiết bị không có nằm trong `unknown`. */
  get values(): ReadonlyMap<string, LiveValue> {
    return this.vals;
  }

  /** Tag thiết bị báo không có (snapshot `unknown`): bảng Tag ghi "không có trên thiết bị". */
  get unknown(): ReadonlySet<string> {
    return this.unknownSet;
  }

  /** Bản system/info mới nhất của lần kết nối này. */
  get info(): DeviceInfo | null {
    return this.lastInfo;
  }

  /** Thời điểm nhận `info` (ms, theo `now()`). */
  get infoAt(): number | null {
    return this.lastInfoAt;
  }

  /** Lỗi của lần hỏi system/info gần nhất; `null` khi lần đó thành công. */
  get infoError(): CheckErrorCode | null {
    return this.lastInfoError;
  }

  /** Trạng thái LiveConnection (trường `live` của data-model §9); `null` khi không kết nối. */
  get live(): ConnState | null {
    return this.conn?.state ?? null;
  }

  /** Thời điểm live-client tự thử lại (đầy: sau 30 s; mất kết nối: theo backoff), để đếm ngược. */
  get retryAt(): number | null {
    return this.conn?.retryAt ?? null;
  }

  /** `monitor` (004) hoặc `online` (005). */
  get mode(): SessionMode {
    return this.md;
  }

  /** `KnownDevice.id` của thiết bị đang làm việc (online, hoặc theo dõi thiết bị runtime cũ). */
  get deviceId(): string | null {
    return this.dev?.id ?? null;
  }

  get device(): KnownDevice | null {
    return this.dev;
  }

  /** Tài khoản đã đăng nhập; giữ trong lúc `relogin` để hiện tên. */
  get auth(): SessionAuth | null {
    return this.authInfo;
  }

  /** `features` của `GET /api/v1/device/identity` (`auth`, `deploy`, `upload`, `restore`…). */
  get features(): readonly string[] {
    return this.feats;
  }

  get identity(): DeviceIdentity | null {
    return this.ident;
  }

  /** Kết quả dò chứng chỉ gần nhất (bước xác nhận ghim). */
  get probe(): ProbeResult | null {
    return this.probeRes;
  }

  /** Khi `error === 'cert-mismatch'`: fingerprint đã ghim (F) và fingerprint thấy (G, `null` nếu dò lại lỗi). */
  get mismatch(): { pinned: string; seen: string | null } | null {
    return this.mis;
  }

  get loginError(): LoginError | null {
    return this.loginErr;
  }

  /** Đang chờ Rust trả lời (ghim, đăng nhập, gỡ ghim): giao diện khóa nút. */
  get busy(): boolean {
    return this.pending;
  }

  /** Kết quả so project máy kỹ sư với thiết bị (do `CompareRunner` đặt); trống khi Offline. */
  get compare(): CompareState {
    return this.cmp;
  }

  /** Cập nhật `compare`; chỉ báo khi có gì đổi. */
  setCompare(patch: Partial<CompareState>): void {
    const next = { ...this.cmp, ...patch };
    if (next.busy === this.cmp.busy && next.info === this.cmp.info && next.error === this.cmp.error)
      return;
    this.cmp = next;
    this.emit({ type: 'compare' });
  }

  /** Thiết bị cho mọi nguồn xem trang xem (`viewerAccess = any`, cảnh báo `VIEWER_PUBLIC`, ADR-018). */
  get viewerPublic(): boolean {
    const i = this.lastInfo;
    const warnings = Array.isArray(i?.warnings) ? (i.warnings as unknown[]) : [];
    return warnings.includes('VIEWER_PUBLIC') || i?.device?.viewerAccess === 'any';
  }

  get notice(): SessionNotice | null {
    return this.note;
  }

  /** Đăng ký nghe sự kiện; trả hàm hủy đăng ký. */
  subscribe(listener: (e: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Kết nối theo dõi theo địa chỉ (004; từ feature 005 là "Kết nối theo dõi" của trang Thiết bị, cho thiết bị
   * runtime cũ). Đang kết nối hoặc theo dõi cùng địa chỉ thì không làm gì; địa chỉ khác thì đóng kết nối cũ
   * trước, nên Studio luôn chỉ có một WebSocket tới thiết bị. Chỉ HTTP: `https://` là `invalid-address`
   * (thiết bị có HTTPS dùng `goOnline`), không tự bỏ scheme rồi gọi HTTP (T085a).
   */
  connect(address: string): void {
    const n = normalizeMonitor(address);
    if (n.ok && n.base === this.base && this.isActive() && this.md === 'monitor') return;
    this.teardown();
    this.clearData();
    this.resetOnline();
    this.established = false;
    this.err = null;
    this.errInfo = null;
    if (!n.ok) {
      this.base = null;
      this.fail('invalid-address');
      return;
    }
    this.startMonitor(n.base);
  }

  /** Ngắt theo dõi (Ctrl+M): đóng WebSocket ngay để thiết bị trả phiên, về `idle`. */
  disconnect(): void {
    this.teardown();
    this.clearData();
    this.resetOnline();
    this.established = false;
    this.base = null;
    this.err = null;
    this.errInfo = null;
    this.setState('idle');
  }

  /**
   * Danh sách Tag của project đổi: đăng ký lại trên cùng socket (live-client `setTags`). Tag bỏ đi
   * mất giá trị ngay; Tag mới chờ snapshot của đăng ký mới.
   */
  setTags(tags: readonly string[]): void {
    const next = [...new Set(tags)];
    if (next.length === this.tagList.length && next.every((t, i) => t === this.tagList[i])) return;
    this.tagList = next;
    this.tagSet = new Set(next);
    const removed = [...this.vals.keys()].filter((t) => !this.tagSet.has(t));
    for (const t of removed) this.vals.delete(t);
    if (removed.length) this.emit({ type: 'values', tags: removed });
    const unknown = [...this.unknownSet].filter((t) => this.tagSet.has(t));
    if (unknown.length !== this.unknownSet.size) {
      this.unknownSet = new Set(unknown);
      this.emit({ type: 'unknown' });
    }
    this.conn?.setTags(next);
  }

  /** "Thử lại ngay" khi thiết bị đầy hoặc mất kết nối. */
  retryNow(): void {
    if (this.st === 'full' || this.st === 'lost') this.conn?.retryNow();
  }

  // ---------- Chế độ online (feature 005) ----------

  /**
   * Online tới thiết bị đã lưu (Thiết bị trong mạng › Online): đóng kết nối đang có, dò chứng chỉ rồi đi
   * tiếp theo kết quả (ghim, đăng nhập, hoặc theo dõi chỉ đọc nếu runtime cũ).
   */
  goOnline(device: KnownDevice): void {
    this.requireLink();
    this.teardown();
    this.clearData();
    this.resetOnline();
    this.established = false;
    this.err = null;
    this.errInfo = null;
    this.md = 'online';
    this.dev = device;
    this.base = httpsBase(device);
    this.setState('probing');
    this.runProbe();
  }

  /** Người dùng xác nhận fingerprint đúng (FR-008): ghim đúng fingerprint vừa dò, rồi tới bước đăng nhập. */
  async confirmPin(): Promise<void> {
    const link = this.link;
    const d = this.dev;
    const p = this.probeRes;
    if (!link || !d || !p || this.st !== 'pin-confirm' || this.pending) return;
    const cycle = this.cycle;
    this.setPending(true);
    const r = await link.pin(d.id, p.fingerprint);
    if (cycle !== this.cycle) return;
    this.pending = false;
    if (isDeviceError(r)) {
      // Rust chỉ ghim đúng lần dò gần nhất: dò lại để người dùng xác nhận đúng chứng chỉ đang thấy.
      if (r.error === 'not-observed') this.reprobe();
      else this.fail(r.error === 'no-such-device' ? 'invalid-address' : 'https-unreachable', r);
      return;
    }
    this.dev = r;
    this.setState('login');
  }

  /**
   * Đăng nhập (bước `login`) hoặc đăng nhập lại (`relogin`). Mật khẩu chỉ chuyển thẳng cho Rust, không giữ
   * ở đâu. Lỗi thì ở lại bước đăng nhập kèm `loginError`.
   */
  async login(user: string, password: string): Promise<void> {
    const link = this.link;
    const d = this.dev;
    const relogin = this.st === 'relogin' || this.reloginPending;
    if (!link || !d || this.pending || (this.st !== 'login' && !relogin)) return;
    const cycle = this.cycle;
    this.loginErr = null;
    this.setPending(true);
    const r = await link.login(d.id, user, password);
    if (cycle !== this.cycle) return;
    if (isDeviceError(r)) {
      this.pending = false;
      this.onLoginError(r);
      return;
    }
    // Thiết bị thêm theo địa chỉ mang tên mặc định (bằng `host`): Rust vừa đặt tên thiết bị báo
    // (`device/identity`, T085a). Đọc lại để thanh trạng thái, thông báo dùng đúng tên.
    if (d.name === d.host) {
      const fresh = (await link.devices().catch(() => [])).find((k) => k.id === d.id);
      if (cycle !== this.cycle) return;
      if (fresh) this.dev = fresh;
    }
    this.pending = false;
    this.setAuth(r);
    if (!relogin) {
      this.connectOnline();
      return;
    }
    this.reloginPending = false;
    if (this.liveEnded && this.conn) {
      // Kết nối live đã bị đóng 4401: mở lại bằng token mới (Rust gắn lúc mở).
      this.liveEnded = false;
      this.setState('connecting');
      this.conn.start();
    } else if (this.st === 'relogin') this.setState('monitoring');
    else this.emit({ type: 'online' });
  }

  /**
   * Gỡ ghim sau khi người dùng xác nhận rõ (FR-008), chỉ khi đang chặn vì chứng chỉ đổi. Rồi dò lại: người
   * dùng phải xác nhận fingerprint mới như lần đầu.
   */
  async unpin(): Promise<void> {
    const link = this.link;
    const d = this.dev;
    const m = this.mis;
    if (!link || !d || !m || this.st !== 'error' || this.err !== 'cert-mismatch' || this.pending)
      return;
    const cycle = this.cycle;
    this.setPending(true);
    const r = await link.unpin(d.id, m.pinned);
    if (cycle !== this.cycle) return;
    this.pending = false;
    if (!isDeviceError(r)) this.dev = r;
    this.mis = null;
    this.err = null;
    this.errInfo = null;
    this.reprobe();
  }

  /** Đăng xuất: về Offline ngay; Rust xóa token (kể cả khi thiết bị không trả lời) và thiết bị ghi audit. */
  async logout(): Promise<void> {
    const link = this.link;
    const d = this.dev;
    const online = this.md === 'online';
    this.disconnect();
    if (link && d && online) await link.logout(d.id);
  }

  // ---- Logic của thiết bị (feature 011, T145; device-api-011 §4) ----

  /** `GET /api/v1/logic` của thiết bị đang Online (trạng thái từng khối, ghi PLC, vòng quét). */
  async logicStatus(): Promise<LogicStatus | DeviceError> {
    const d = this.dev;
    if (!this.link || !d || this.md !== 'online') return { error: 'no-such-device' };
    const r = await this.link.logicGet(d.id);
    return isDeviceError(r) ? r : parseLogicStatus(r.body);
  }

  /**
   * "Dừng ghi của logic" (administrator): `POST /api/v1/logic/writes {"enabled": false}`, có hiệu lực ngay và giữ qua khởi
   * động lại. Không có đường bật lại từ Studio (root sửa runtime.json). Xong thì hỏi lại system/info để chip đổi ngay.
   */
  async stopLogicWrites(): Promise<true | DeviceError> {
    const d = this.dev;
    if (!this.link || !d || this.md !== 'online') return { error: 'no-such-device' };
    const r = await this.link.logicStopWrites(d.id);
    if (isDeviceError(r)) return r;
    this.lastInfoAt = null;
    this.fetchInfo();
    return true;
  }

  /** Đặt lại counter, totalizer, giờ chạy (engineer; audit `logic.reset` trên thiết bị). */
  async resetLogicBlock(block: string, value = 0): Promise<true | DeviceError> {
    const d = this.dev;
    if (!this.link || !d || this.md !== 'online') return { error: 'no-such-device' };
    const r = await this.link.logicReset(d.id, block, value);
    return isDeviceError(r) ? r : true;
  }

  private requireLink(): DeviceLink {
    if (!this.link) throw new Error('DeviceSession: online mode needs a DeviceLink');
    return this.link;
  }

  private setPending(on: boolean): void {
    this.pending = on;
    this.emit({ type: 'online' });
  }

  /** Đưa các trường của chế độ online về mặc định; chỉ báo khi có gì đổi (giữ chuỗi sự kiện của 004). */
  private resetOnline(): void {
    const changed =
      this.md !== 'monitor' ||
      this.dev !== null ||
      this.authInfo !== null ||
      this.probeRes !== null ||
      this.mis !== null ||
      this.loginErr !== null ||
      this.note !== null ||
      this.pending;
    this.md = 'monitor';
    this.dev = null;
    this.authInfo = null;
    this.feats = [];
    this.ident = null;
    this.probeRes = null;
    this.mis = null;
    this.loginErr = null;
    this.pending = false;
    this.note = null;
    this.reloginPending = false;
    this.authPending = false;
    this.infoFetch = null;
    const hadCompare = this.cmp.busy || this.cmp.info !== null || this.cmp.error !== null;
    this.cmp = { busy: false, info: null, error: null };
    if (changed) this.emit({ type: 'online' });
    if (hadCompare) this.emit({ type: 'compare' });
  }

  private setAuth(s: SessionInfo): void {
    this.authInfo = {
      user: s.user,
      role: s.role,
      idleTimeoutS: s.idleTimeoutS,
      maxLifetimeS: s.maxLifetimeS,
    };
    this.ident = s.identity ?? null;
    this.feats = Array.isArray(s.identity?.features) ? [...s.identity.features] : [];
    this.loginErr = null;
  }

  private reprobe(): void {
    this.probeRes = null;
    this.setState('probing');
    this.runProbe();
  }

  private runProbe(): void {
    const link = this.requireLink();
    const d = this.dev;
    if (!d) return;
    const cycle = this.cycle;
    void link.probe(d.id).then(async (r) => {
      if (cycle !== this.cycle) return;
      if (isDeviceError(r)) {
        await this.onProbeError(r, cycle);
        return;
      }
      this.probeRes = r;
      if (r.state === 'mismatch') {
        this.mis = { pinned: r.pinned ?? '', seen: r.fingerprint };
        this.fail('cert-mismatch');
        return;
      }
      if (r.state === 'unpinned') {
        this.setState('pin-confirm');
        return;
      }
      // Ghim khớp. Rust còn giữ phiên của thiết bị (Online lại sau khi ngắt): vào thẳng.
      const s = await link.session(d.id).catch(() => null);
      if (cycle !== this.cycle) return;
      if (s) {
        this.setAuth(s);
        this.connectOnline();
      } else this.setState('login');
    });
  }

  /**
   * Dò chứng chỉ không được. Cổng HTTPS không trả lời hoặc trả lời HTTP thường: hỏi system/info qua HTTP
   * (`host:httpPort`, đọc lại sau `not-tls` vì Rust có thể vừa đổi cổng này, T085b); runtime < 0.4.0 thì theo dõi chỉ
   * đọc như 004 kèm `runtime-old` (FR-035).
   */
  private async onProbeError(r: DeviceError, cycle: number): Promise<void> {
    let d = this.dev;
    if (!d) return;
    if (r.error === 'tls') return this.fail('tls', r);
    if (r.error === 'bad-address') return this.fail('invalid-address', r);
    if (r.error === 'no-such-device') return this.fail('invalid-address');
    const link = this.requireLink();
    if (r.error === 'not-tls') {
      // T085b: cổng đã lưu trả lời HTTP thường. Rust vừa hỏi system/info trên cùng cổng; runtime cũ thì đã lưu cổng
      // đó làm httpPort (thiết bị cũ thêm theo địa chỉ với cổng HTTP, ví dụ port-forward :9080): đọc lại thiết bị.
      const id = d.id;
      const fresh = (await link.devices().catch(() => [] as KnownDevice[])).find(
        (k) => k.id === id,
      );
      if (cycle !== this.cycle) return;
      if (fresh) this.dev = d = fresh;
    }
    const res = await link.monitorGet(`${d.host}:${d.httpPort}`);
    if (cycle !== this.cycle) return;
    const body = isDeviceError(res) ? null : (res.body as { runtimeVersion?: unknown } | null);
    const runtime =
      !isDeviceError(res) && res.status >= 200 && res.status < 300 && body
        ? body.runtimeVersion
        : undefined;
    if (typeof runtime === 'string' && compareSemver(runtime, ONLINE_RUNTIME) < 0) {
      this.md = 'monitor';
      this.note = 'runtime-old';
      this.startMonitor(`http://${d.host}:${d.httpPort}`);
      return;
    }
    this.fail('https-unreachable');
  }

  private onLoginError(r: DeviceError): void {
    const at = this.opt.now();
    switch (r.error) {
      case 'auth-failed':
      case 'auth-busy':
      case 'audit-unavailable':
      case 'setup-required':
      case 'unreachable':
      case 'timeout':
        this.loginErr = { code: r.error, at };
        break;
      case 'locked':
        this.loginErr = {
          code: 'locked',
          retryAfterS: typeof r.detail === 'number' && r.detail > 0 ? r.detail : 300,
          at,
        };
        break;
      case 'cert-mismatch':
        this.mis = isPinPair(r.detail) ? { ...r.detail } : null;
        if (this.mis) this.fail('cert-mismatch');
        else this.certMismatch(this.cycle);
        return;
      case 'cert-unpinned':
        this.reprobe();
        return;
      case 'no-such-device':
        this.fail('invalid-address');
        return;
      default:
        this.loginErr = { code: 'failed', at, detail: r.error, cause: r };
    }
    this.emit({ type: 'online' });
  }

  /** Đã đăng nhập: wss + system/info qua HTTPS theo id; vào monitoring như chế độ theo dõi. */
  private connectOnline(): void {
    const link = this.requireLink();
    const d = this.dev;
    if (!d) return;
    const cycle = this.cycle;
    this.md = 'online';
    this.base = httpsBase(d);
    this.infoFetch = onlineFetch(link, d.id, (e) => this.onDeviceError(e, cycle));
    this.established = false;
    this.setState('connecting');
    this.armDeadline();
    this.fetchInfo();
    this.openLive(liveUrl(this.base), (url) => this.socketFor(link, d.id, cycle, url));
  }

  /** SocketLike theo id; bắt tay lỗi vì chứng chỉ (close 1006, lý do là mã) thì phiên xử lý, không thử lại. */
  private socketFor(link: DeviceLink, id: string, cycle: number, url: string): SocketLike {
    const inner = onlineSocket(link, id)(url);
    const outer: SocketLike = {
      onopen: null,
      onmessage: null,
      onclose: null,
      send: (data) => inner.send(data),
      close: (code, reason) => inner.close(code, reason),
    };
    inner.onopen = () => outer.onopen?.();
    inner.onmessage = (ev) => outer.onmessage?.(ev);
    inner.onclose = (ev) => {
      const reason = (ev as CloseInfo).reason;
      if (cycle === this.cycle && (reason === 'cert-mismatch' || reason === 'cert-unpinned')) {
        this.onDeviceError({ error: reason }, cycle);
        return;
      }
      outer.onclose?.(ev);
    };
    return outer;
  }

  /** Lỗi của thiết bị khi đang làm việc online (hỏi định kỳ, system/info, kết nối lại). */
  private onDeviceError(e: DeviceError, cycle: number): void {
    if (cycle !== this.cycle || this.md !== 'online') return;
    switch (e.error) {
      case 'session-expired':
      case 'auth-required':
        // Không đụng tài liệu đang sửa (FR-031): chỉ hỏi đăng nhập lại; dữ liệu sống vẫn chạy.
        if (this.st === 'monitoring') this.setState('relogin');
        else if (this.st !== 'relogin') this.reloginPending = true;
        break;
      case 'session-invalid':
        // Tài khoản bị tắt hoặc đổi IP: về Offline, giữ lý do (Rust đã bỏ token).
        this.teardown();
        this.clearData();
        this.resetOnline();
        this.established = false;
        this.base = null;
        this.err = 'session-invalid';
        this.setState('idle');
        break;
      case 'cert-mismatch':
        if (isPinPair(e.detail)) {
          this.mis = { ...e.detail };
          this.fail('cert-mismatch');
        } else this.certMismatch(cycle);
        break;
      case 'cert-unpinned':
        this.fail('cert-unpinned');
        break;
      default:
        // Lỗi mạng: socket quyết định mất kết nối như chế độ theo dõi.
        break;
    }
  }

  /** Chứng chỉ đổi khi đang làm việc: dừng kết nối ngay, dò lại để có F và G rồi chặn. */
  private certMismatch(cycle: number): void {
    const link = this.link;
    const d = this.dev;
    if (cycle !== this.cycle || !link || !d) return;
    this.teardown();
    this.markStale();
    const c = this.cycle;
    void link.probe(d.id).then((r) => {
      if (c !== this.cycle) return;
      this.mis = isDeviceError(r)
        ? { pinned: d.pin?.fingerprint ?? '', seen: null }
        : { pinned: r.pinned ?? d.pin?.fingerprint ?? '', seen: r.fingerprint };
      this.fail('cert-mismatch');
    });
  }

  /** Hỏi `/api/v1/auth/session` (không làm mới hạn phiên): phát hiện phiên hết hạn hay bị hủy. */
  private pollAuth(): void {
    const link = this.link;
    const d = this.dev;
    if (!link || !d || this.md !== 'online' || this.authPending) return;
    this.authPending = true;
    const cycle = this.cycle;
    void link.get(d.id, '/api/v1/auth/session').then(
      (r) => {
        if (cycle !== this.cycle) return;
        this.authPending = false;
        if (isDeviceError(r)) this.onDeviceError(r, cycle);
      },
      () => {
        if (cycle === this.cycle) this.authPending = false;
      },
    );
  }

  // ---------- Bên trong ----------

  private isActive(): boolean {
    return (
      this.st === 'connecting' ||
      this.st === 'monitoring' ||
      this.st === 'relogin' ||
      this.st === 'lost' ||
      this.st === 'full'
    );
  }

  private emit(e: SessionEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(e);
      } catch (err) {
        // Lỗi của một người nghe không được làm hỏng máy trạng thái (ví dụ bỏ quên socket).
        console.error(err);
      }
    }
  }

  private setState(s: SessionState): void {
    if (this.st === s) return;
    this.st = s;
    this.emit({ type: 'state', state: s });
  }

  /** Bắt đầu theo dõi theo địa chỉ HTTP (004; cũng dùng cho thiết bị runtime cũ). */
  private startMonitor(base: string): void {
    this.base = base;
    this.setState('connecting');
    this.armDeadline();
    this.fetchInfo();
    this.openLive(liveUrl(base), (url) => this.guardViewer(this.opt.createSocket(url)));
  }

  /**
   * Chế độ theo dõi theo địa chỉ: bắt tay 403 vì lọc nguồn (Rust báo close 1006, lý do `viewer-private` hoặc
   * `viewer-off`) là lỗi cuối, không thử lại.
   */
  private guardViewer(inner: SocketLike): SocketLike {
    const cycle = this.cycle;
    const outer: SocketLike = {
      onopen: null,
      onmessage: null,
      onclose: null,
      send: (data) => inner.send(data),
      close: (code, reason) => inner.close(code, reason),
    };
    inner.onopen = () => outer.onopen?.();
    inner.onmessage = (ev) => outer.onmessage?.(ev);
    inner.onclose = (ev) => {
      const reason = (ev as CloseInfo).reason;
      if (cycle === this.cycle && (reason === 'viewer-private' || reason === 'viewer-off')) {
        this.fail('viewer-private');
        return;
      }
      outer.onclose?.(ev);
    };
    return outer;
  }

  private openLive(url: string, createSocket: (url: string) => SocketLike): void {
    const conn = new LiveConnection({
      url,
      tags: this.tagList,
      createSocket,
      now: this.opt.now,
      random: this.opt.random,
      setTimer: this.opt.setTimer,
      clearTimer: this.opt.clearTimer,
    });
    conn.onState = (s) => {
      this.alarms.onConnState(s);
      this.onLiveState(s);
    };
    conn.onChange = (changes) => this.onLiveChange(changes);
    this.alarms.attach(conn);
    conn.onSubscribed = () => this.onSubscribed();
    this.conn = conn;
    conn.start();
  }

  /** Dừng mọi việc của kết nối hiện tại: đóng socket ngay, hủy hẹn giờ, bỏ kết quả đang chờ. */
  private teardown(): void {
    this.cycle++;
    this.infoPending = false;
    this.authPending = false;
    this.clearDeadline();
    this.stopPolling();
    const c = this.conn;
    if (!c) return;
    this.conn = null;
    this.alarms.detach();
    c.onState = null;
    c.onChange = null;
    c.onSubscribed = null;
    c.stop(); // close 1000, không kết nối lại
    this.emit({ type: 'live', live: null });
  }

  /** Bỏ dữ liệu của kết nối trước: giá trị, Tag lạ, system/info. */
  private clearData(): void {
    this.liveEnded = false;
    this.alarms.clear();
    if (this.vals.size) {
      const tags = [...this.vals.keys()];
      this.vals.clear();
      this.emit({ type: 'values', tags });
    }
    if (this.unknownSet.size) {
      this.unknownSet = new Set();
      this.emit({ type: 'unknown' });
    }
    if (this.lastInfo || this.lastInfoError) {
      this.lastInfo = null;
      this.lastInfoAt = null;
      this.lastInfoError = null;
      this.emit({ type: 'info' });
    }
  }

  private fail(code: SessionErrorCode, info: DeviceError | null = null): void {
    this.teardown();
    this.markStale();
    this.pending = false;
    this.err = code;
    this.errInfo = info;
    // Đang error mà có lý do mới: vẫn báo để giao diện đổi câu hiển thị.
    if (this.st === 'error') this.emit({ type: 'state', state: 'error' });
    else this.setState('error');
  }

  private armDeadline(): void {
    this.clearDeadline();
    const ms = this.md === 'online' ? ONLINE_CONNECT_TIMEOUT_MS : CONNECT_TIMEOUT_MS;
    this.deadline = this.opt.setTimer(() => {
      this.deadline = null;
      if (this.st === 'connecting' && !this.established) this.fail('timeout');
    }, ms);
  }

  private clearDeadline(): void {
    if (this.deadline !== null) this.opt.clearTimer(this.deadline);
    this.deadline = null;
  }

  private fetchInfo(): void {
    const base = this.base;
    if (!base || this.infoPending) return;
    this.infoPending = true;
    const cycle = this.cycle;
    const online = this.md === 'online' && this.infoFetch !== null;
    const fetchFn = online ? this.infoFetch! : this.opt.fetch;
    const timeout = online ? ONLINE_CONNECT_TIMEOUT_MS - 1000 : CONNECT_TIMEOUT_MS;
    void checkDevice(base, fetchFn, timeout).then((r) => {
      if (cycle !== this.cycle) return; // đã ngắt hoặc đã kết nối lại
      this.infoPending = false;
      if (r.ok) {
        this.lastInfo = r.info;
        this.lastInfoAt = this.opt.now();
        this.lastInfoError = null;
      } else {
        this.lastInfoError = r.code;
      }
      this.emit({ type: 'info' });
      // Lần kết nối đầu: báo lỗi và dừng. Đã theo dõi: giữ trạng thái, socket quyết định mất kết nối.
      // Trang xem bị lọc nguồn (403 khi theo dõi theo địa chỉ, ADR-018): hãy Online (đăng nhập).
      if (
        !r.ok &&
        this.md === 'monitor' &&
        r.code === 'http' &&
        r.detail === '403' &&
        !this.established
      )
        this.fail('viewer-private');
      else if (!r.ok && this.st === 'connecting' && !this.established) this.fail(r.code);
      else this.tryMonitoring();
    });
  }

  /** Vào monitoring: hỏi system/info ngay nếu bản đang có đã cũ hơn một chu kỳ, rồi mỗi 5 s. */
  private startPolling(): void {
    this.stopPolling();
    const age = this.lastInfoAt === null ? INFO_POLL_MS : this.opt.now() - this.lastInfoAt;
    if (age < INFO_POLL_MS) {
      this.schedulePoll(INFO_POLL_MS - age);
      return;
    }
    this.fetchInfo();
    this.schedulePoll(INFO_POLL_MS);
  }

  private schedulePoll(ms: number): void {
    this.pollTimer = this.opt.setTimer(() => {
      this.pollTimer = null;
      if (this.st !== 'monitoring' && this.st !== 'relogin') return;
      this.fetchInfo(); // lần trước chưa xong (≤ 3 s) thì bỏ qua lượt này
      // Chế độ online: hỏi phiên đăng nhập để biết hết hạn (đang chờ đăng nhập lại thì thôi).
      if (this.st === 'monitoring') this.pollAuth();
      this.schedulePoll(INFO_POLL_MS);
    }, ms);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) this.opt.clearTimer(this.pollTimer);
    this.pollTimer = null;
  }

  private onLiveState(s: ConnState): void {
    this.emit({ type: 'live', live: s });
    switch (s) {
      case 'connecting':
        // Hết 30 s chờ khi đầy (hoặc "Thử lại ngay"): live-client tự kết nối lại.
        if (this.st === 'full') this.enterConnecting();
        break;
      case 'offline':
        // Chưa theo dõi được lần nào: báo lỗi, không thử lại (thiết bị từ chối Origin…).
        // Đã theo dõi: mất kết nối, live-client tự kết nối lại theo backoff.
        if (this.established) this.leaveMonitoring('lost');
        else this.fail('live-closed');
        break;
      case 'full':
        this.clearDeadline();
        this.leaveMonitoring('full');
        break;
      case 'session-ended':
        // 4401 (protocol 1.2.0): phiên đã dùng để mở kết nối hết hạn. Không tự kết nối lại bằng token cũ: hỏi đăng nhập
        // lại như SESSION_EXPIRED, rồi mở lại live.
        if (this.md !== 'online') break;
        this.stopPolling();
        this.markStale();
        this.liveEnded = true;
        if (this.st === 'monitoring' || this.st === 'connecting') this.setState('relogin');
        else if (this.st !== 'relogin') this.reloginPending = true;
        break;
      case 'incompatible':
        // live-client đã đóng socket và không tự thử lại.
        this.teardown();
        this.markStale();
        this.setState('incompatible');
        break;
      default:
        // `open`, `live`: chờ onSubscribed. `idle`, `stopped`: chỉ do chính phiên gây ra.
        break;
    }
  }

  private enterConnecting(): void {
    this.setState('connecting');
    if (!this.established) this.armDeadline();
    if (!this.lastInfo) this.fetchInfo();
  }

  /** Giá trị không còn tốt khi rời monitoring; ngừng hỏi system/info. */
  private leaveMonitoring(next: 'lost' | 'full'): void {
    if (this.st === 'relogin') this.reloginPending = true;
    this.stopPolling();
    this.markStale();
    this.setState(next);
  }

  private onLiveChange(changes: TagChange[]): void {
    // Ngoài monitoring giá trị đã được đánh dấu mất kết nối; vào monitoring thì nạp lại toàn bộ.
    // Đang chờ đăng nhập lại (relogin): dữ liệu sống (công khai, FR-033) vẫn chạy.
    if (this.st === 'monitoring' || this.st === 'relogin') this.apply(changes);
  }

  private onSubscribed(): void {
    const c = this.conn;
    if (!c) return;
    this.setUnknown(c.unknown);
    this.tryMonitoring();
  }

  private setUnknown(list: readonly string[]): void {
    const next = new Set(list);
    // Tag thiết bị không có thì không có giá trị.
    const dropped: string[] = [];
    for (const t of next) if (this.vals.delete(t)) dropped.push(t);
    if (dropped.length) this.emit({ type: 'values', tags: dropped });
    if (next.size !== this.unknownSet.size || [...next].some((t) => !this.unknownSet.has(t))) {
      this.unknownSet = next;
      this.emit({ type: 'unknown' });
    }
  }

  private tryMonitoring(): void {
    const c = this.conn;
    if (!c || (this.st !== 'connecting' && this.st !== 'lost')) return;
    if (!c.subscribed || !this.lastInfo) return;
    this.established = true;
    this.clearDeadline();
    this.setState(this.reloginPending ? 'relogin' : 'monitoring');
    // Nạp giá trị từ snapshot hiện tại của live-client (đã nhận trước khi vào monitoring).
    const l = c.live;
    this.apply(
      l.ids.map((id, i) => ({
        id,
        value: l.values[i],
        quality: l.qualities[i],
        ...(l.reasons[i] ? { reason: l.reasons[i] } : {}),
      })),
    );
    this.startPolling();
  }

  private apply(changes: readonly TagChange[]): void {
    const now = this.opt.now();
    const tags: string[] = [];
    for (const c of changes) {
      if (!this.tagSet.has(c.id)) continue;
      const prev = this.vals.get(c.id);
      const ts = c.quality === 'STALE' && prev ? prev.ts : now;
      this.vals.set(c.id, {
        value: c.value,
        quality: c.quality,
        ts,
        ...(c.reason ? { reason: c.reason } : {}),
      });
      tags.push(c.id);
    }
    if (tags.length) this.emit({ type: 'values', tags });
  }

  private markStale(): void {
    const tags: string[] = [];
    for (const [id, v] of this.vals) {
      if (v.quality === 'STALE') continue;
      this.vals.set(id, { ...v, quality: 'STALE' });
      tags.push(id);
    }
    if (tags.length) this.emit({ type: 'values', tags });
  }
}
