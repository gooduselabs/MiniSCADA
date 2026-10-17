// Luồng "Cập nhật runtime" (OTA, feature 011, T119; FR-068; contracts/device-api-011.md §3, §5): ai thấy chức năng, đọc phản
// hồi của thiết bị, và các bước của hộp thoại: chọn file → tải lên (tiến trình) → xem kế hoạch → xác nhận kèm mật khẩu → theo
// dõi qua lúc dịch vụ chạy lại → kết quả (committed, rolled-back, mất kết nối quá 120 s); "Quay về bản trước" (rollback).
//
// Mật khẩu xác thực lại chỉ đi qua tham số của `apply`/`rollback` tới DeviceLink, không được giữ trong luồng. Theo dõi bằng
// `GET /api/v1/system/update` mỗi `pollMs`: thiết bị không trả lời (đang chạy lại) thì chờ tiếp tới `LOST_AFTER_MS` kể từ lần
// trả lời cuối; kết quả của lần cập nhật được nhận theo `last.updateId` (không lấy nhầm kết quả cũ).
import type {
  ApiResult,
  DeployEvent,
  DeviceError,
  DeviceLink,
  Role,
  UpdateFile,
} from '../platform/device-types.ts';
import { isDeviceError } from '../platform/device-types.ts';
import { deviceSupport } from './device.ts';

/** Không trả lời quá chừng này (kể từ lần trả lời cuối) thì kết luận mất kết nối (FR-070: cả cập nhật ≤ 120 s). */
export const LOST_AFTER_MS = 120_000;
/** Thiết bị cứ trả lời "đang áp dụng" quá chừng này thì cũng dừng theo dõi (mất kết nối, hướng dẫn kiểm tay). */
export const FOLLOW_MAX_MS = 300_000;
export const POLL_MS = 2000;

export type UpdateLink = Pick<
  DeviceLink,
  'updatePick' | 'updateUpload' | 'updateStatus' | 'updateApply' | 'updateCancel' | 'updateRollback'
>;

export interface UpdateSigner {
  keyId: string;
  label: string;
}

/** Kế hoạch của gói đã kiểm (`plan` của 201 và của `GET /system/update`). */
export interface UpdatePlan {
  from: string;
  to: string;
  releaseSeq: number | null;
  signer: UpdateSigner;
  projectCompatible: boolean;
  estimatedDowntimeS: number | null;
  restartRequired: boolean;
  notes: string;
  kind: string;
}

export interface UpdateLast {
  updateId: string;
  result: string;
  from: string;
  to: string;
  finishedAt: string;
  reason: string;
}

export interface UpdatePrevious {
  version: string;
  available: boolean;
}

/** `GET /api/v1/system/update`. `state` lạ (runtime mới hơn) giữ nguyên chuỗi. */
export interface UpdateStatus {
  enabled: boolean;
  state: string;
  updateId: string | null;
  plan: UpdatePlan | null;
  step: string | null;
  startedAt: string | null;
  last: UpdateLast | null;
  previous: UpdatePrevious | null;
}

/** Chức năng với tài khoản và thiết bị này: ẩn, hiện nhưng khóa (OTA tắt trên thiết bị), hay bật. */
export type UpdateAccess = 'hidden' | 'disabled' | 'enabled';

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Chỉ administrator, và chỉ khi system/info báo `update.supported` (thiết bị cũ không có khóa `update`: ẩn). OTA tắt
 * (`update.enabled` false) thì hiện nhưng khóa, kèm gợi ý bật ở runtime.json.
 */
export function updateAccess(
  info: { update?: unknown; [k: string]: unknown } | null | undefined,
  auth: { role: Role } | null | undefined,
): UpdateAccess {
  if (auth?.role !== 'administrator') return 'hidden';
  const s = deviceSupport(info);
  if (!s.update) return 'hidden';
  return s.updateEnabled ? 'enabled' : 'disabled';
}

export function parsePlan(v: unknown): UpdatePlan | null {
  if (!isObj(v) || typeof v.from !== 'string' || typeof v.to !== 'string') return null;
  const signer = isObj(v.signer) ? v.signer : {};
  return {
    from: v.from,
    to: v.to,
    releaseSeq: num(v.releaseSeq),
    signer: { keyId: str(signer.keyId), label: str(signer.label) },
    projectCompatible: v.projectCompatible === true,
    estimatedDowntimeS: num(v.estimatedDowntimeS),
    restartRequired: v.restartRequired !== false,
    notes: str(v.notes),
    kind: typeof v.kind === 'string' ? v.kind : 'runtime',
  };
}

function parseLast(v: unknown): UpdateLast | null {
  if (!isObj(v) || typeof v.result !== 'string') return null;
  return {
    updateId: str(v.updateId),
    result: v.result,
    from: str(v.from),
    to: str(v.to),
    finishedAt: str(v.finishedAt),
    reason: str(v.reason),
  };
}

export function parseStatus(v: unknown): UpdateStatus | null {
  if (!isObj(v) || typeof v.state !== 'string') return null;
  const prev = isObj(v.previous) && typeof v.previous.version === 'string' ? v.previous : null;
  return {
    enabled: v.enabled !== false,
    state: v.state,
    updateId: strOrNull(v.updateId),
    plan: parsePlan(v.plan),
    step: strOrNull(v.step),
    startedAt: strOrNull(v.startedAt),
    last: parseLast(v.last),
    previous: prev ? { version: prev.version as string, available: prev.available === true } : null,
  };
}

/** Mã thiết bị của lỗi OTA (`{ error: 'update', detail: { code } }`), hoặc `null`. */
export function updateErrorCode(e: DeviceError): string | null {
  if (e.error !== 'update' || !isObj(e.detail)) return null;
  return typeof e.detail.code === 'string' ? e.detail.code : null;
}

/** `detail.code` của `UPDATE_PACKAGE_INVALID` (mã lỗi con của gói), hoặc `null`. */
export function updateErrorDetail(e: DeviceError): string | null {
  if (e.error !== 'update' || !isObj(e.detail) || !isObj(e.detail.detail)) return null;
  const c = e.detail.detail.code;
  return typeof c === 'string' ? c : null;
}

export type UpdateStep =
  'loading' | 'pick' | 'uploading' | 'plan' | 'confirm-rollback' | 'following' | 'result';

export type UpdateMode = 'update' | 'rollback';

export interface UpdateFollowing {
  mode: UpdateMode;
  /** `restarting`: thiết bị không trả lời (dịch vụ đang chạy lại). */
  phase: 'applying' | 'restarting';
  /** Bước của thiết bị (`switching`, `health-check`…), nếu có. */
  step: string | null;
  /** Lúc bắt đầu theo dõi (ms theo `now`). */
  since: number;
}

export interface UpdateResult {
  mode: UpdateMode;
  /** Với `rollback`: `committed` là đã quay về xong, `rolled-back` là không quay về được. */
  outcome: 'committed' | 'rolled-back' | 'lost';
  /** Phiên bản đang chạy sau cùng (nếu biết). */
  version: string | null;
  from: string | null;
  reason: string | null;
  /** `timeout`: không trả lời quá 120 s; `session`: phiên đăng nhập mất sau khi chạy lại. */
  lostCause: 'timeout' | 'session' | null;
}

export interface UpdateFlowOptions {
  link: UpdateLink;
  deviceId: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  onChange?: () => void;
}

/** Lỗi coi như thiết bị đang chạy lại (thử tiếp). */
const TRANSIENT = new Set(['unreachable', 'timeout', 'bad-response', 'network', 'closed']);
/** Lỗi phiên: thiết bị đã chạy lại mà phiên không còn (FR-071): đăng nhập lại để xem kết quả. */
const SESSION = new Set(['session-expired', 'session-invalid', 'auth-required']);

const transient = (e: DeviceError): boolean =>
  TRANSIENT.has(e.error) || (e.error === 'http' && typeof e.detail === 'number' && e.detail >= 500);

const sameLast = (a: UpdateLast | null, b: UpdateLast | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.updateId === b.updateId &&
    a.finishedAt === b.finishedAt &&
    a.result === b.result);

export class UpdateFlow {
  step: UpdateStep = 'loading';
  status: UpdateStatus | null = null;
  file: UpdateFile | null = null;
  progress: { sent: number; total: number } | null = null;
  updateId: string | null = null;
  plan: UpdatePlan | null = null;
  error: DeviceError | null = null;
  following: UpdateFollowing | null = null;
  result: UpdateResult | null = null;
  /** Đang chờ thiết bị trả lời một lệnh (khóa nút). */
  busy = false;

  private readonly link: UpdateLink;
  private readonly id: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollMs: number;
  private readonly onChange: () => void;
  private disposed = false;

  constructor(o: UpdateFlowOptions) {
    this.link = o.link;
    this.id = o.deviceId;
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.pollMs = o.pollMs ?? POLL_MS;
    this.onChange = o.onChange ?? (() => {});
  }

  /** Bản trước trên thiết bị (`.prev`), theo lần đọc trạng thái gần nhất. */
  get previous(): UpdatePrevious | null {
    return this.status?.previous ?? null;
  }

  private changed(): void {
    if (!this.disposed) this.onChange();
  }

  /** Dừng theo dõi (đóng hộp thoại); kết quả muộn bị bỏ. */
  dispose(): void {
    this.disposed = true;
  }

  /** Đọc trạng thái lúc mở: gói `verified` còn chờ thì vào bước kế hoạch; đang áp dụng thì theo dõi tiếp. */
  async load(): Promise<void> {
    this.step = 'loading';
    this.changed();
    const r = await this.link.updateStatus(this.id);
    if (this.disposed) return;
    if (isDeviceError(r)) {
      this.error = r;
      this.step = 'pick';
      this.changed();
      return;
    }
    this.status = parseStatus(r.body);
    const s = this.status;
    if (s?.state === 'verified' && s.updateId && s.plan) {
      this.updateId = s.updateId;
      this.plan = s.plan;
      this.step = 'plan';
      this.changed();
      return;
    }
    if (s?.state === 'applying') {
      this.updateId = s.updateId;
      this.plan = s.plan;
      await this.follow(s.updateId ? 'update' : 'rollback', null);
      return;
    }
    this.step = 'pick';
    this.changed();
  }

  async pick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.changed();
    const r = await this.link.updatePick();
    this.busy = false;
    if (isDeviceError(r)) this.error = r;
    else if (r) {
      this.file = r;
      this.error = null;
    }
    this.changed();
  }

  async upload(): Promise<void> {
    const file = this.file;
    if (!file || this.busy) return;
    this.busy = true;
    this.error = null;
    this.progress = { sent: 0, total: file.size };
    this.step = 'uploading';
    this.changed();
    const r = await this.link.updateUpload(this.id, file.fileId, (e: DeployEvent) => {
      if (e.kind !== 'send') return;
      this.progress = { sent: e.sent, total: e.total };
      this.changed();
    });
    this.busy = false;
    if (this.disposed) return;
    const body = isDeviceError(r) ? null : (r.body as Record<string, unknown> | null);
    const plan = body ? parsePlan(body.plan) : null;
    const updateId = body && typeof body.updateId === 'string' ? body.updateId : null;
    if (isDeviceError(r) || !plan || !updateId) {
      this.error = isDeviceError(r) ? r : { error: 'bad-response' };
      this.step = 'pick';
      this.changed();
      return;
    }
    this.updateId = updateId;
    this.plan = plan;
    // Rust bỏ byte của file sau khi thiết bị nhận gói: tải lại thì chọn lại file.
    this.file = null;
    this.step = 'plan';
    this.changed();
  }

  /** Áp dụng gói đang chờ. `password` chỉ được chuyển tiếp, không giữ lại. */
  async apply(password: string): Promise<void> {
    const updateId = this.updateId;
    if (!updateId || this.busy || !password) return;
    this.busy = true;
    this.error = null;
    this.changed();
    const r = await this.link.updateApply(this.id, updateId, password);
    this.busy = false;
    if (this.disposed) return;
    if (isDeviceError(r)) {
      this.error = r;
      if (updateErrorCode(r) === 'UPDATE_NOT_FOUND') {
        // Gói đã hết hạn (30 phút) hay bị hủy ở nơi khác: chọn và tải lại.
        this.updateId = null;
        this.plan = null;
        this.step = 'pick';
      }
      this.changed();
      return;
    }
    await this.follow('update', this.status?.last ?? null);
  }

  /** Hủy gói đang chờ (chưa áp dụng). */
  async cancel(): Promise<void> {
    const updateId = this.updateId;
    if (!updateId || this.busy) return;
    this.busy = true;
    this.changed();
    const r = await this.link.updateCancel(this.id, updateId);
    this.busy = false;
    if (this.disposed) return;
    if (isDeviceError(r)) {
      this.error = r;
      this.changed();
      return;
    }
    this.updateId = null;
    this.plan = null;
    this.error = null;
    this.step = 'pick';
    this.changed();
  }

  /** "Quay về bản trước": sang bước nhập mật khẩu. */
  askRollback(): void {
    if (this.busy) return;
    this.error = null;
    this.step = 'confirm-rollback';
    this.changed();
  }

  /** Thôi quay về: về bước chọn file. */
  backToPick(): void {
    if (this.busy) return;
    this.error = null;
    this.step = this.updateId && this.plan ? 'plan' : 'pick';
    this.changed();
  }

  /** Quay về bản `.prev`. `password` chỉ được chuyển tiếp, không giữ lại. */
  async rollback(password: string): Promise<void> {
    if (this.busy || !password) return;
    this.busy = true;
    this.error = null;
    this.changed();
    const r = await this.link.updateRollback(this.id, password);
    this.busy = false;
    if (this.disposed) return;
    if (isDeviceError(r)) {
      this.error = r;
      this.changed();
      return;
    }
    await this.follow('rollback', this.status?.last ?? null);
  }

  private finish(result: UpdateResult): void {
    this.following = null;
    this.result = result;
    this.step = 'result';
    this.changed();
  }

  /** Kết quả từ một trạng thái của thiết bị, hoặc `null` khi còn đang chạy. */
  private outcomeOf(
    mode: UpdateMode,
    s: UpdateStatus,
    before: UpdateLast | null,
  ): UpdateResult | null {
    if (s.state === 'applying' || s.state === 'verified') return null;
    const base = { mode, lostCause: null } as const;
    if (mode === 'update') {
      const id = this.updateId;
      const last =
        s.last && (id ? s.last.updateId === id : !sameLast(s.last, before)) ? s.last : null;
      if (last) {
        const ok = last.result === 'committed';
        return {
          ...base,
          outcome: ok ? 'committed' : 'rolled-back',
          version: ok ? last.to : last.from || null,
          from: last.from || null,
          reason: last.reason || null,
        };
      }
      if (s.state === 'failed')
        return {
          ...base,
          outcome: 'rolled-back',
          version: this.plan?.from ?? null,
          from: this.plan?.from ?? null,
          reason: s.step,
        };
      if (s.state === 'committed' || s.state === 'rolled-back')
        return {
          ...base,
          outcome: s.state,
          version: s.state === 'committed' ? (this.plan?.to ?? null) : (this.plan?.from ?? null),
          from: this.plan?.from ?? null,
          reason: null,
        };
      return null;
    }
    // Quay về: xong khi có kết quả mới; `failed` là không quay về được.
    if (s.state === 'failed')
      return { ...base, outcome: 'rolled-back', version: null, from: null, reason: s.step };
    if (s.last && !sameLast(s.last, before))
      return {
        ...base,
        outcome: 'committed',
        version: s.last.to || before?.from || null,
        from: s.last.from || null,
        reason: null,
      };
    return null;
  }

  private async follow(mode: UpdateMode, before: UpdateLast | null): Promise<void> {
    const start = this.now();
    let lastOk = start;
    this.following = { mode, phase: 'applying', step: null, since: start };
    this.step = 'following';
    this.changed();
    for (;;) {
      await this.sleep(this.pollMs);
      if (this.disposed) return;
      const r: ApiResult | DeviceError = await this.link.updateStatus(this.id);
      if (this.disposed) return;
      const t = this.now();
      if (isDeviceError(r)) {
        if (SESSION.has(r.error)) {
          this.finish({
            mode,
            outcome: 'lost',
            version: null,
            from: null,
            reason: null,
            lostCause: 'session',
          });
          return;
        }
        if (!transient(r)) {
          this.finish({
            mode,
            outcome: 'lost',
            version: null,
            from: null,
            reason: r.error,
            lostCause: 'timeout',
          });
          return;
        }
        if (this.following.phase !== 'restarting') {
          this.following = { ...this.following, phase: 'restarting' };
          this.changed();
        }
        if (t - lastOk > LOST_AFTER_MS) {
          this.finish({
            mode,
            outcome: 'lost',
            version: null,
            from: null,
            reason: null,
            lostCause: 'timeout',
          });
          return;
        }
        continue;
      }
      lastOk = t;
      const s = parseStatus(r.body);
      if (s) {
        this.status = s;
        const done = this.outcomeOf(mode, s, before);
        if (done) {
          this.finish(done);
          return;
        }
        if (this.following.phase !== 'applying' || this.following.step !== s.step) {
          this.following = { ...this.following, phase: 'applying', step: s.step };
          this.changed();
        }
      }
      if (t - start > FOLLOW_MAX_MS) {
        this.finish({
          mode,
          outcome: 'lost',
          version: null,
          from: null,
          reason: null,
          lostCause: 'timeout',
        });
        return;
      }
    }
  }
}
