// Trang xem tự tải lại khi project trên thiết bị đổi (feature 005, FR-025; contracts/live-protocol-1.1.md §3).
// Lúc mở trang nhớ project của /api/v1/projects/active (cả khóa `digest` cấp đầu của runtime 0.4.0). Mỗi lần
// kết nối dữ liệu sống có `hello`, project thiết bị báo khác project trang đang hiện thì báo "Đang nạp project
// mới…" rồi tải lại trang một lần, sau 0–1000 ms ngẫu nhiên để 10 trang không cùng gọi thiết bị một lúc.
// Máy chủ 1.0.0 không gửi digest: so projectId + projectVersion.
// Trang mở lúc thiết bị chưa có project hợp lệ (T104a): không mở kết nối dữ liệu sống (không chiếm 1 trong 10 phiên,
// Constitution IV); ProjectPoller hỏi lại /api/v1/projects/active, có project thì tải lại trang.
import type { HelloInfo, LiveConnection } from '@mat/live-client';

export const RELOAD_MESSAGE = 'Đang nạp project mới…';
export const RELOAD_MAX_DELAY_MS = 1000;

/** Project trang đã nạp, hoặc project thiết bị báo trong `hello`. `null` (thay cho stamp) = không có project. */
export interface ProjectStamp {
  projectId: string;
  projectVersion: string;
  /** Digest nội dung (protocol 1.1.0); `null` khi thiết bị báo null; không có khóa khi máy chủ 1.0.0. */
  digest?: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function stamp(projectId: unknown, projectVersion: unknown, digest: unknown): ProjectStamp {
  const s: ProjectStamp = { projectId: str(projectId), projectVersion: str(projectVersion) };
  if (typeof digest === 'string' || digest === null) s.digest = digest;
  return s;
}

/**
 * Project trang đã nạp, từ phản hồi `GET /api/v1/projects/active`: 200 thì lấy `project` và khóa `digest` cấp
 * đầu (nếu có); mã khác (503 `NO_VALID_PROJECT`) hoặc thân lạ thì `null`.
 */
export function activeStamp(status: number, body: unknown): ProjectStamp | null {
  if (status !== 200 || !isObject(body) || !isObject(body.project)) return null;
  return stamp(body.project.projectId, body.project.projectVersion, body.digest);
}

/** Project thiết bị báo trong `hello`. */
export function helloStamp(hello: HelloInfo): ProjectStamp | null {
  const p = hello.project;
  return p ? stamp(p.projectId, p.projectVersion, p.digest) : null;
}

/**
 * Project thiết bị đang chạy khác project trang đang hiện:
 * - một bên không có project, bên kia có (kể cả `null` ↔ có giá trị);
 * - hai bên đều có digest (chuỗi hoặc null) và ít nhất một bên là chuỗi: so digest;
 * - còn lại (máy chủ 1.0.0, hoặc hai digest đều null): so projectId + projectVersion.
 */
export function projectChanged(loaded: ProjectStamp | null, current: ProjectStamp | null): boolean {
  if (!loaded || !current) return loaded !== current;
  const a = loaded.digest;
  const b = current.digest;
  if (a !== undefined && b !== undefined && (a !== null || b !== null)) return a !== b;
  return loaded.projectId !== current.projectId || loaded.projectVersion !== current.projectVersion;
}

export interface ReloadDeps {
  /** `location.reload()` */
  reload: () => void;
  /** Hiện câu báo cho người xem. */
  show: (text: string) => void;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
}

export class ReloadWatcher {
  private readonly loaded: ProjectStamp | null;
  private readonly deps: Required<ReloadDeps>;
  private scheduled = false;

  constructor(loaded: ProjectStamp | null, deps: ReloadDeps) {
    this.loaded = loaded;
    this.deps = { random: Math.random, setTimer: (fn, ms) => setTimeout(fn, ms), ...deps };
  }

  /** Đã hẹn tải lại. */
  get pending(): boolean {
    return this.scheduled;
  }

  /**
   * Gọi với `hello` của kết nối hiện tại. Project đổi thì báo và hẹn tải lại; chỉ hẹn một lần, các `hello` sau
   * (kết nối lại trước khi trang kịp tải) bỏ qua. Trả `true` khi đã hẹn tải lại (lần này hoặc trước đó).
   */
  check(hello: HelloInfo | null): boolean {
    if (this.scheduled) return true;
    if (!hello || !projectChanged(this.loaded, helloStamp(hello))) return false;
    this.scheduled = true;
    this.deps.show(RELOAD_MESSAGE);
    const r = Math.min(1, Math.max(0, this.deps.random()));
    this.deps.setTimer(() => this.deps.reload(), Math.round(r * RELOAD_MAX_DELAY_MS));
    return true;
  }
}

/**
 * Nối vào LiveConnection: mỗi lần đăng ký có kết quả trên một socket (máy chủ gửi `hello` ngay khi nhận phiên,
 * trước kết quả đăng ký; danh sách Tag rỗng thì có kết quả ngay ở `hello`), so `hello` của socket đó. Người nghe
 * `onSubscribed` có sẵn vẫn được gọi.
 */
export function watchProject(conn: LiveConnection, watcher: ReloadWatcher): void {
  const previous = conn.onSubscribed;
  conn.onSubscribed = (c) => {
    previous?.(c);
    watcher.check(c.live.hello);
  };
}

// ---- Trang mở lúc thiết bị chưa có project hợp lệ (T104a, Constitution IV) ----

/** Chu kỳ hỏi lại `/api/v1/projects/active` khi thiết bị chưa có project hợp lệ. */
export const PROJECT_POLL_MS = 5000;
/** Cộng ngẫu nhiên 0–1 s mỗi lượt, để các trang mở cùng lúc không cùng hỏi thiết bị một lúc. */
export const PROJECT_POLL_JITTER_MS = 1000;
/** Một lượt hỏi không xong trong hạn này thì hủy rồi hẹn lượt sau (không phụ thuộc lớp mạng). */
export const PROJECT_POLL_TIMEOUT_MS = 5000;
/** Nhãn trạng thái khi chờ project: trang không mở kết nối dữ liệu sống. */
export const WAIT_BADGE = 'Chờ project';
export const WAIT_MESSAGE = 'Trang tự tải lại khi thiết bị có project hợp lệ.';

/** Phản hồi của `GET /api/v1/projects/active`: mã HTTP và thân JSON (`null` khi không đọc được). */
export interface ActiveResponse {
  status: number;
  body: unknown;
}

export interface ProjectPollDeps {
  /** `GET /api/v1/projects/active`; hủy theo `signal` khi quá hạn hoặc khi dừng. */
  fetchActive: (signal: AbortSignal) => Promise<ActiveResponse>;
  /** `location.reload()` */
  reload: () => void;
  /** Hiện câu báo cho người xem. */
  show: (text: string) => void;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Trang mở lúc thiết bị chưa có project hợp lệ (503): không mở WebSocket, để không chiếm 1 trong 10 phiên dữ liệu sống
 * (Constitution IV). Hỏi lại `/api/v1/projects/active` mỗi 5 s cộng ngẫu nhiên 0–1 s, mỗi lần một lượt: lượt trước
 * trả lời hoặc quá hạn 5 s mới hẹn lượt sau. Có project thì báo "Đang nạp project mới…" và tải lại trang đúng một lần.
 */
export class ProjectPoller {
  private readonly deps: Required<ProjectPollDeps>;
  private running = false;
  /** Đã tải lại trang: không hỏi nữa. */
  private done = false;
  private timer: unknown = null;
  /** Lượt hỏi đang chờ trả lời. */
  private ctl: AbortController | null = null;

  constructor(deps: ProjectPollDeps) {
    this.deps = {
      random: Math.random,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...deps,
    };
  }

  /** Bắt đầu hỏi (lượt đầu sau 5–6 s: trang vừa hỏi lúc mở). Đang chạy hoặc đã tải lại thì không làm gì. */
  start(): void {
    if (this.running || this.done) return;
    this.running = true;
    this.schedule();
  }

  /** Thôi hỏi; hủy lượt đang chờ (trả lời đến sau cũng bỏ qua). */
  stop(): void {
    this.running = false;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.ctl?.abort();
    this.ctl = null;
  }

  private schedule(): void {
    const r = Math.min(1, Math.max(0, this.deps.random()));
    this.timer = this.deps.setTimer(
      () => {
        this.timer = null;
        void this.poll();
      },
      PROJECT_POLL_MS + Math.round(r * PROJECT_POLL_JITTER_MS),
    );
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    const ctl = new AbortController();
    this.ctl = ctl;
    let deadline: unknown = null;
    // Hạn chót không phụ thuộc lớp mạng: lượt hỏi treo mà bỏ qua tín hiệu hủy vẫn không chặn các lượt sau.
    const timeout = new Promise<null>((resolve) => {
      deadline = this.deps.setTimer(() => {
        ctl.abort();
        resolve(null);
      }, PROJECT_POLL_TIMEOUT_MS);
    });
    const answer = await Promise.race([
      this.deps.fetchActive(ctl.signal).catch(() => null),
      timeout,
    ]);
    this.deps.clearTimer(deadline);
    // Đã dừng, hoặc lượt này đã bị thay: bỏ kết quả.
    if (!this.running || this.ctl !== ctl) return;
    this.ctl = null;
    if (answer && activeStamp(answer.status, answer.body)) {
      this.running = false;
      this.done = true;
      this.deps.show(RELOAD_MESSAGE);
      this.deps.reload();
      return;
    }
    this.schedule();
  }
}
