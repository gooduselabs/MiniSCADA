// Audit của thiết bị cho editor Audit (feature 005, US4, device-api §7; FR-032): đọc `GET /api/v1/audit` theo bộ lọc
// (thời gian, tài khoản, tiền tố hành động), mới nhất trước, trang tiếp bằng `before` = `next` của trang trước.
// Chỉ administrator xem được: thiết bị trả 403 thì trạng thái là `forbidden`. Không DOM, không chuỗi giao diện.
import { isDeviceError, type ApiResult, type DeviceError } from '../platform/device-types.ts';

/** Số bản ghi mỗi trang (mặc định của thiết bị; tối đa 200). */
export const AUDIT_PAGE = 100;

export interface AuditRecord {
  id: number;
  /** ms UTC của sự kiện (của sự kiện đầu với dòng gộp). */
  ts: number;
  /** `false`: giờ thiết bị chưa đồng bộ lúc ghi. */
  clockOk: boolean;
  user: string | null;
  role: string | null;
  source: string;
  channel: string;
  action: string;
  target: string | null;
  result: string;
  code: string | null;
  detail: Record<string, unknown> | null;
  /** Số sự kiện gộp trong dòng (đăng nhập sai, truy cập bị từ chối trong 60 s). */
  count: number;
}

export interface AuditFilter {
  /** ms UTC, gồm. */
  from?: number;
  /** ms UTC, không gồm. */
  to?: number;
  user?: string;
  /** Tiền tố hành động, ví dụ `project.`. */
  action?: string;
  /** Đối tượng đúng tên, ví dụ id Tag `TANK01.SP` (feature 006, lệnh ghi Tag). */
  target?: string;
}

export type AuditStatus = 'idle' | 'loading' | 'ready' | 'error' | 'forbidden';

export interface AuditState {
  status: AuditStatus;
  filter: AuditFilter;
  /** Mới nhất trước; trang sau nối vào cuối. */
  rows: readonly AuditRecord[];
  /** `before` của trang tiếp; `null` khi hết. */
  next: number | null;
  /** Đang tải trang tiếp (bản ghi đang hiện vẫn giữ). */
  loadingMore: boolean;
  /** Mã lỗi khi `status` là `error`. */
  error: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function record(v: unknown): AuditRecord | null {
  if (!isObject(v)) return null;
  const text = (x: unknown): string | null => (typeof x === 'string' ? x : null);
  if (
    typeof v.id !== 'number' ||
    typeof v.ts !== 'number' ||
    typeof v.action !== 'string' ||
    typeof v.result !== 'string'
  )
    return null;
  return {
    id: v.id,
    ts: v.ts,
    clockOk: v.clockOk !== false,
    user: text(v.user),
    role: text(v.role),
    source: text(v.source) ?? '',
    channel: text(v.channel) ?? '',
    action: v.action,
    target: text(v.target),
    result: v.result,
    code: text(v.code),
    detail: isObject(v.detail) ? v.detail : null,
    count: typeof v.count === 'number' && v.count >= 1 ? v.count : 1,
  };
}

/** Đọc thân của `GET /api/v1/audit`; sai dạng thì `null`. */
export function parseAuditPage(
  body: unknown,
): { records: AuditRecord[]; next: number | null } | null {
  if (!isObject(body) || !Array.isArray(body.records)) return null;
  const records: AuditRecord[] = [];
  for (const r of body.records) {
    const rec = record(r);
    if (!rec) return null;
    records.push(rec);
  }
  const next = typeof body.next === 'number' ? body.next : null;
  return { records, next };
}

/** Tham số truy vấn của một trang (chỉ tham số có giá trị). */
export function auditQuery(filter: AuditFilter, before?: number): Record<string, string> {
  const q: Record<string, string> = {};
  if (filter.from !== undefined) q.from = String(Math.trunc(filter.from));
  if (filter.to !== undefined) q.to = String(Math.trunc(filter.to));
  if (filter.user) q.user = filter.user;
  if (filter.action) q.action = filter.action;
  if (filter.target) q.target = filter.target;
  if (before !== undefined) q.before = String(before);
  return q;
}

export interface AuditDeps {
  /** `GET /api/v1/audit` kèm tham số, qua kết nối online. */
  get(query: Record<string, string>): Promise<ApiResult | DeviceError>;
  onChange(state: AuditState): void;
}

export class AuditFeed {
  private st: AuditState = {
    status: 'idle',
    filter: {},
    rows: [],
    next: null,
    loadingMore: false,
    error: null,
  };
  private readonly deps: AuditDeps;
  /** Tăng mỗi lần tải mới: trả lời của lần cũ bị bỏ. */
  private seq = 0;

  constructor(deps: AuditDeps) {
    this.deps = deps;
  }

  get state(): AuditState {
    return this.st;
  }

  private set(patch: Partial<AuditState>): void {
    this.st = { ...this.st, ...patch };
    this.deps.onChange(this.st);
  }

  private fail(r: DeviceError | ApiResult): { status: AuditStatus; error: string } {
    const code = isDeviceError(r) ? r.error : r.status === 403 ? 'forbidden' : 'bad-response';
    return { status: code === 'forbidden' ? 'forbidden' : 'error', error: code };
  }

  /** Tải lại từ trang đầu với bộ lọc `filter` (mặc định: bộ lọc hiện tại). */
  async load(filter: AuditFilter = this.st.filter): Promise<void> {
    const seq = ++this.seq;
    this.set({ status: 'loading', filter, loadingMore: false, error: null });
    let r: ApiResult | DeviceError;
    try {
      r = await this.deps.get(auditQuery(filter));
    } catch {
      r = { error: 'unreachable' };
    }
    if (seq !== this.seq) return;
    const page = !isDeviceError(r) && r.status === 200 ? parseAuditPage(r.body) : null;
    if (!page) {
      this.set({ ...this.fail(r), rows: [], next: null });
      return;
    }
    this.set({ status: 'ready', rows: page.records, next: page.next, error: null });
  }

  /** Tải trang tiếp (bản ghi cũ hơn) và nối vào cuối; không làm gì khi hết. */
  async more(): Promise<void> {
    const { next, status, loadingMore, filter } = this.st;
    if (next === null || status !== 'ready' || loadingMore) return;
    const seq = this.seq;
    this.set({ loadingMore: true });
    let r: ApiResult | DeviceError;
    try {
      r = await this.deps.get(auditQuery(filter, next));
    } catch {
      r = { error: 'unreachable' };
    }
    if (seq !== this.seq) return;
    const page = !isDeviceError(r) && r.status === 200 ? parseAuditPage(r.body) : null;
    if (!page) {
      this.set({ ...this.fail(r), loadingMore: false });
      return;
    }
    // Bản ghi đã có (thiết bị ghi thêm audit.read trong lúc xem) không thành dòng đôi.
    const have = new Set(this.st.rows.map((x) => x.id));
    this.set({
      rows: [...this.st.rows, ...page.records.filter((x) => !have.has(x.id))],
      next: page.next,
      loadingMore: false,
    });
  }

  /** Quên dữ liệu (Offline, đổi thiết bị): lần mở sau tải lại từ đầu. */
  reset(): void {
    this.seq++;
    this.set({
      status: 'idle',
      filter: {},
      rows: [],
      next: null,
      loadingMore: false,
      error: null,
    });
  }
}
