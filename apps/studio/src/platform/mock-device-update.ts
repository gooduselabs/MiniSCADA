// Cập nhật runtime (OTA) của thiết bị giả (feature 011, T119; contracts/device-api-011.md §3, §5): `system/info.update`,
// `POST/GET /api/v1/system/update`, `apply`, `cancel`, `rollback`. Runtime chưa có endpoint này ở nhánh Studio: thiết bị giả theo
// đúng contract để test và e2e thử trước. Sau `apply`/`rollback`, thiết bị giả "chạy lại": vài lần hỏi trạng thái trả
// `unreachable` rồi có kết quả (`committed`, `rolled-back`), hoặc không bao giờ trả lời (`lost`). Trạng thái giữ riêng theo thiết
// bị giả. Mật khẩu không được ghi lại ở đâu.
import type { ApiResult, DeployEvent, DeviceError, Role, UpdateFile } from './device-types.ts';

export interface MockUpdateConfig {
  /** `update.enabled` của runtime.json (false thì 404 UPDATE_DISABLED). */
  enabled: boolean;
  /** Kế hoạch của gói tải lên (ghép vào kế hoạch mặc định 1.0.0 → 1.0.1). */
  plan?: Record<string, unknown>;
  /** Thiết bị từ chối gói với mã này (UPDATE_DOWNGRADE…). */
  uploadError?: string;
  /** Kết quả sau khi áp dụng (mặc định committed). */
  outcome?: 'committed' | 'rolled-back' | 'lost';
  /** Lý do khi rolled-back. */
  reason?: string;
  /** Số lần hỏi trạng thái còn "applying" trước khi dịch vụ dừng (mặc định 1). */
  applyPolls?: number;
  /** Số lần hỏi trạng thái không trả lời (dịch vụ đang chạy lại; mặc định 2). */
  restartPolls?: number;
  /** Bản trước (`/opt/mat-runtime.prev`); mặc định 0.9.0 có sẵn. */
  previous?: { version: string; available: boolean } | null;
  /** Thời gian gửi gói (ms, chia 4 sự kiện tiến trình). */
  uploadMs?: number;
}

interface Last {
  updateId: string;
  result: 'committed' | 'rolled-back';
  from: string;
  to: string;
  finishedAt: string;
  reason: string;
}

interface UpdateState {
  config: MockUpdateConfig;
  state: 'idle' | 'verified' | 'applying' | 'committed' | 'rolled-back' | 'failed';
  updateId: string | null;
  plan: Record<string, unknown> | null;
  step: string | null;
  startedAt: string | null;
  last: Last | null;
  previous: { version: string; available: boolean } | null;
  /** Thao tác đang áp dụng: cập nhật hay quay về. */
  mode: 'update' | 'rollback' | null;
  applyPolls: number;
  restartPolls: number;
  seq: number;
}

const states = new WeakMap<object, UpdateState>();

/** Thiết bị giả có khối `update` trong system/info (null: thiết bị cũ). */
export function configure(dev: object, c: MockUpdateConfig | null): void {
  if (!c) {
    states.delete(dev);
    return;
  }
  states.set(dev, {
    config: { ...c },
    state: 'idle',
    updateId: null,
    plan: null,
    step: null,
    startedAt: null,
    last: null,
    previous: c.previous === undefined ? { version: '0.9.0', available: true } : c.previous,
    mode: null,
    applyPolls: 0,
    restartPolls: 0,
    seq: 0,
  });
}

/** Khối `update` của system/info, hoặc `null` (thiết bị cũ không có khóa này). */
export function systemInfoBlock(dev: object): { enabled: boolean; supported: true } | null {
  const s = states.get(dev);
  return s ? { enabled: s.config.enabled, supported: true } : null;
}

const refuse = (code: string, detail: unknown = null): DeviceError => ({
  error: 'update',
  detail: { code, detail },
});

/** Kiểm chung của mọi endpoint (contract §3): thiết bị hỗ trợ, administrator, OTA bật. */
function guard(dev: object, role: Role): UpdateState | DeviceError {
  const s = states.get(dev);
  if (!s) return { error: 'http', detail: 404 };
  if (role !== 'administrator') return { error: 'forbidden' };
  if (!s.config.enabled) return refuse('UPDATE_DISABLED');
  return s;
}

const isErr = (x: UpdateState | DeviceError): x is DeviceError => 'error' in x;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function upload(
  dev: object,
  role: Role,
  runtime: string,
  file: UpdateFile,
  onEvent: (e: DeployEvent) => void,
): Promise<ApiResult | DeviceError> {
  const s = guard(dev, role);
  if (isErr(s)) return s;
  if (s.state === 'applying') return { error: 'busy', detail: { kind: 'update' } };
  const total = file.size;
  const parts = 4;
  for (let i = 1; i <= parts; i++) {
    if (s.config.uploadMs) await delay(s.config.uploadMs / parts);
    onEvent({ kind: 'send', sent: Math.round((total * i) / parts), total });
  }
  if (s.config.uploadError) return refuse(s.config.uploadError);
  s.seq++;
  s.state = 'verified';
  s.updateId = `upd_${s.seq.toString(16).padStart(16, '0')}`;
  s.plan = {
    from: runtime,
    to: '1.0.1',
    releaseSeq: 12,
    signer: { keyId: 'sha256:9f2c4e7a1b3d5f60', label: 'release-primary' },
    projectCompatible: true,
    estimatedDowntimeS: 25,
    restartRequired: true,
    notes: 'Modbus reconnect fix.',
    kind: 'runtime',
    ...s.config.plan,
  };
  return { status: 201, body: { updateId: s.updateId, state: 'verified', plan: s.plan } };
}

function body(s: UpdateState): Record<string, unknown> {
  return {
    enabled: s.config.enabled,
    state: s.state,
    updateId: s.updateId,
    plan: s.plan,
    step: s.step,
    startedAt: s.startedAt,
    last: s.last,
    previous: s.previous,
  };
}

/** Kết thúc lần áp dụng (lúc "chạy lại" xong). Trả phiên bản runtime mới. */
function finish(s: UpdateState, runtime: string): string {
  const now = new Date().toISOString();
  const id = s.updateId ?? `upd_${(++s.seq).toString(16).padStart(16, '0')}`;
  if (s.mode === 'rollback') {
    const to = s.previous?.version ?? runtime;
    s.last = {
      updateId: id,
      result: 'rolled-back',
      from: runtime,
      to,
      finishedAt: now,
      reason: 'manual',
    };
    s.previous = null;
    s.state = 'idle';
    runtime = to;
  } else {
    const to = String(s.plan?.to ?? runtime);
    const committed = s.config.outcome !== 'rolled-back';
    s.last = {
      updateId: id,
      result: committed ? 'committed' : 'rolled-back',
      from: runtime,
      to,
      finishedAt: now,
      reason: committed ? '' : (s.config.reason ?? 'health-check'),
    };
    s.state = committed ? 'committed' : 'rolled-back';
    if (committed) {
      s.previous = { version: runtime, available: true };
      runtime = to;
    }
  }
  s.mode = null;
  s.updateId = null;
  s.plan = null;
  s.step = null;
  s.startedAt = null;
  return runtime;
}

/** `GET /system/update`. `setRuntime` nhận phiên bản mới khi cập nhật xong. */
export function status(
  dev: object,
  role: Role,
  runtime: string,
  setRuntime: (v: string) => void,
): ApiResult | DeviceError {
  const s = states.get(dev);
  if (s?.state === 'applying') {
    if (s.applyPolls > 0) {
      s.applyPolls--;
      s.step = 'switching';
    } else if (s.config.outcome === 'lost' && s.mode === 'update') {
      return { error: 'unreachable' };
    } else if (s.restartPolls > 0) {
      s.restartPolls--;
      return { error: 'unreachable' };
    } else {
      setRuntime(finish(s, runtime));
    }
  }
  const g = guard(dev, role);
  if (isErr(g)) return g;
  return { status: 200, body: body(g) };
}

function startApplying(s: UpdateState, mode: 'update' | 'rollback'): ApiResult {
  s.state = 'applying';
  s.mode = mode;
  s.step = 'request';
  s.startedAt = new Date().toISOString();
  s.applyPolls = s.config.applyPolls ?? 1;
  s.restartPolls = s.config.restartPolls ?? 2;
  return { status: 202, body: { state: 'applying' } };
}

export function apply(
  dev: object,
  role: Role,
  updateId: string,
  passwordOk: boolean,
): ApiResult | DeviceError {
  const s = guard(dev, role);
  if (isErr(s)) return s;
  if (!passwordOk) return refuse('REAUTH_FAILED');
  if (s.state !== 'verified' || s.updateId !== updateId) return refuse('UPDATE_NOT_FOUND');
  return startApplying(s, 'update');
}

export function cancel(dev: object, role: Role, updateId: string): ApiResult | DeviceError {
  const s = guard(dev, role);
  if (isErr(s)) return s;
  if (s.state === 'verified' && s.updateId === updateId) {
    s.state = 'idle';
    s.updateId = null;
    s.plan = null;
  }
  return { status: 200, body: { state: 'idle' } };
}

export function rollback(dev: object, role: Role, passwordOk: boolean): ApiResult | DeviceError {
  const s = guard(dev, role);
  if (isErr(s)) return s;
  if (!passwordOk) return refuse('REAUTH_FAILED');
  if (!s.previous?.available) return refuse('UPDATE_NO_PREVIOUS');
  if (s.state === 'applying') return { error: 'busy', detail: { kind: 'update' } };
  return startApplying(s, 'rollback');
}
