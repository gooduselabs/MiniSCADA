// Hộp thoại Nạp xuống của Studio (feature 005, data-model §13, FR-020–FR-024; contracts/tauri-commands.md §8):
// mô hình thuần, không DOM, không gọi lệnh Tauri. Phần project (lưu, kiểm, tập file) và phần thiết bị, gói
// (`package_build`, `device_deploy`…) đi qua `DownloadEnv` tiêm được; bản thật bọc store của 004 và `DeviceLink`
// (T117, T124). Không chứa chuỗi giao diện: dòng xem trước, bước, kết quả là mã và số liệu; giao diện đổi sang chữ
// qua i18n.
//
//   closed ──open (Ctrl+L)──▶ preparing (lưu? → kiểm tra → đóng gói → so sánh với thiết bị) ──▶ preview
//   preview ──có lỗi, hoặc có cảnh báo chưa đánh dấu "đã đọc"──▶ preview (nút Nạp xuống khóa)
//   preview ──deploy──▶ running (theo DeployEvent) ──▶ result (committed | failed | rolled-back | …)
//   running ──BASE_CHANGED, DEVICE_BUSY, phiên hết hạn, thiếu quyền──▶ preparing ──▶ preview (kèm `notice`)
//   result ──restore (Khôi phục bản trước)──▶ running (kind = restore) ──▶ result
//   closed ──restore(seq) (chọn trong danh sách bản lưu)──▶ running ──▶ result
//
// Gói luôn đóng từ file trên đĩa: Rust đọc lại từng file và so SHA-256 với lần đọc của 004; lệch thì đọc lại, kiểm
// lại rồi đóng gói lại (tối đa `MAX_PACK_ATTEMPTS` lần).
import {
  compareProjects,
  compareSemver,
  loggingImpact,
  summarizeCompare,
  type CompareResult,
  type CompareSummary,
  type Issue,
  type LocalSide,
  type LoggingImpact,
  type PackageFile,
  type ProjectSource,
} from '@mat/project-schema';
import {
  deviceError,
  isDeviceError,
  type DeviceError,
  type Role,
} from '../platform/device-types.ts';
import type { ReadOutcome } from '../platform/types.ts';
import type { DeviceInfo } from './device.ts';

/** Trần gói (device-api §4: `Content-Length` > 52.428.800 → 413 `PACKAGE_TOO_LARGE`). */
export const MAX_PACKAGE_BYTES = 52_428_800;
/** Số lần đóng gói tối đa khi file trên đĩa cứ khác lần đọc của 004. */
export const MAX_PACK_ATTEMPTS = 3;
/** `X-Mat-Base-Digest` khi thiết bị chưa chạy project nào trong kho (device-api §4). */
export const NO_BASE = 'none';
/** Các dòng xem trước theo thứ tự hiện (FR-020, data-model §13). */
export const PREVIEW_ROWS = [
  'check',
  'runtime',
  'replace',
  'clients',
  'size',
  'logging',
  'device',
] as const;
export type RowId = (typeof PREVIEW_ROWS)[number];
/** Các bước của thao tác trên thiết bị (data-model §10); `rollback` thêm khi cần. */
export const DEPLOY_STEPS = [
  'receive',
  'verify-package',
  'validate',
  'backup',
  'activate',
  'health',
] as const;

// ---------- Kiểu của lệnh Rust và API thiết bị (data-model §8, §10; tauri-commands §8) ----------

export interface ProjectIdentity {
  projectId: string;
  projectName: string;
  projectVersion: string;
  minRuntimeVersion: string;
}

/** `matscada.json` (contract matscada-package §3). */
export interface PackageManifest {
  format: string;
  formatVersion: string;
  project: ProjectIdentity;
  createdAt: string;
  generator: { name: string; version: string };
  files: PackageFile[];
  digest: string;
}

/** Gói tạm do Rust giữ (`package_build`, `device_fetch_package`): giao diện chỉ thấy id, không thấy đường dẫn. */
export interface PackageInfo {
  packageId: string;
  origin: 'built' | 'fetched';
  digest: string;
  size: number;
  manifest: PackageManifest;
  deviceId?: string;
  seq?: number;
}

export type DeployStepState = 'pending' | 'running' | 'ok' | 'failed' | 'skipped';

export interface DeployStep {
  id: string;
  state: DeployStepState;
  startedAt?: string | null;
  endedAt?: string | null;
  code?: string;
  message?: string;
  issues?: Issue[];
}

export type DeployResult = 'running' | 'committed' | 'failed' | 'rolled-back' | 'interrupted';

/** `GET /api/v1/project/deployments/{opId}` (device-api §4, data-model §10). */
export interface DeployOperation {
  opId: string;
  kind: 'deploy' | 'restore';
  user?: string;
  role?: string;
  source?: string;
  startedAt?: string;
  endedAt?: string | null;
  clockOk?: boolean;
  from: { seq: number; digest: string; projectVersion: string } | null;
  to: { seq?: number; digest: string; projectId: string; projectVersion: string };
  steps: DeployStep[];
  result: DeployResult;
  error: { code: string; message?: string; issues?: Issue[] } | null;
  clientsNotified: number;
}

/** Sự kiện của `device_deploy`, `device_restore` (tauri-commands §8): `send` là tiến trình gửi gói của Studio. */
export type DeployEvent =
  | { kind: 'send'; sent: number; total: number }
  | { kind: 'operation'; op: DeployOperation }
  | { kind: 'restarting' };

// ---------- Phần tiêm vào ----------

/** Project đang mở (store và lệnh lưu của 004). */
export interface DownloadProject {
  /** Còn thay đổi chưa lưu. */
  dirty(): boolean;
  /** Lưu mọi file (004 hỏi khi xung đột); `true` khi đã lưu hết. */
  save(): Promise<boolean>;
  /** Đọc lại file trên đĩa rồi kiểm lại (F7): khi gói lệch với lần đọc của 004. */
  reload(): Promise<void>;
  /** Lỗi và cảnh báo của lần kiểm mới nhất trên nội dung đã lưu (chờ kiểm xong). */
  check(): Promise<{ errors: readonly Issue[]; warnings: readonly Issue[] }>;
  /** Thiết lập của project (`project.json`); `null` khi không đọc được. */
  identity(): ProjectIdentity | null;
  /** Tập file của project (`projectFiles`) kèm SHA-256 lúc đọc; `null` khi chưa đọc được `project.json`. */
  files(): Array<{ rel: string; hash: string }> | null;
  /** Nội dung đã lưu (đúng như trên đĩa), để so với thiết bị. */
  source(): ProjectSource;
}

/**
 * Thiết bị đang Online và các lệnh gói (bọc `DeviceLink` theo id của thiết bị, T117). Phương thức có `| DeviceError`
 * trả lỗi thay vì từ chối promise.
 */
export interface DownloadDevice {
  /** `GET /api/v1/system/info` qua kết nối online. */
  info(): Promise<DeviceInfo | DeviceError>;
  /** Phiên Rust đang giữ (`device_session`); `null` khi không còn (hết hạn, đã đăng xuất). */
  session(): Promise<{ user: string; role: Role } | null>;
  /** Chỗ trống của phân vùng dữ liệu (`GET /api/v1/diagnostics` › `disk.freeBytes`); `null` khi không biết. */
  freeBytes(): Promise<number | null>;
  /** Số phiên live của chính Studio tới thiết bị (0 hoặc 1), trừ khỏi số client sẽ tải lại. */
  ownLiveSessions(): number;
  /** `package_build`; file trên đĩa khác `hash` thì lỗi `changed` (`detail` = file). */
  buildPackage(files: Array<{ rel: string; hash: string }>): Promise<PackageInfo | DeviceError>;
  /** `GET /api/v1/project/manifest` của bản đang chạy. */
  manifest(): Promise<PackageManifest | DeviceError>;
  /** `device_fetch_package` của bản đang chạy. */
  fetchPackage(): Promise<PackageInfo | DeviceError>;
  /** `package_read`. */
  readPackageFile(packageId: string, rel: string): Promise<ReadOutcome>;
  /** `package_discard`. */
  discardPackage(packageId: string): Promise<void>;
  /** `device_deploy`. */
  deploy(
    packageId: string,
    baseDigest: string,
    onEvent: (e: DeployEvent) => void,
  ): Promise<DeployOperation | DeviceError>;
  /** `device_restore`. */
  restore(
    seq: number,
    baseDigest: string,
    onEvent: (e: DeployEvent) => void,
  ): Promise<DeployOperation | DeviceError>;
  /** `GET /api/v1/project/operation`: thao tác đang chạy hoặc gần nhất (khi mất theo dõi). */
  operation(): Promise<DeployOperation | null | DeviceError>;
}

export interface DownloadEnv {
  project: DownloadProject;
  device: DownloadDevice;
  /** Đồng hồ (ms) để tính thời gian của thao tác. */
  now?: () => number;
}

// ---------- Trạng thái và các dòng xem trước ----------

export type FlowState = 'closed' | 'preparing' | 'preview' | 'running' | 'result';
/** Bước con của `preparing`: chờ hỏi lưu, đang lưu, kiểm tra, đóng gói, so sánh với thiết bị. */
export type PrepareStep = 'ask-save' | 'saving' | 'checking' | 'packing' | 'comparing';

/** `ok`; `notice`: cần chú ý, không khóa; `warn`: phải đánh dấu "đã đọc cảnh báo"; `error`: khóa nạp xuống. */
export type RowStatus = 'ok' | 'notice' | 'warn' | 'error' | 'unknown';

/** Thao tác đang chạy trên thiết bị: từ `DEVICE_BUSY` (ai, từ đâu) và/hoặc `system/info.operation` (bước). */
export interface BusyInfo {
  opId: string | null;
  kind: string | null;
  step: string | null;
  user: string | null;
  source: string | null;
  /** ms UTC */
  since: number | null;
}

export type DeviceProblem = 'unreachable' | 'session' | 'role' | 'busy';
/** Lý do khóa nút Nạp xuống. */
export type Blocker = 'errors' | 'runtime' | 'package' | 'too-large' | 'no-space' | DeviceProblem;

export interface CheckRow {
  id: 'check';
  status: RowStatus;
  errors: readonly Issue[];
  warnings: readonly Issue[];
}

export interface RuntimeRow {
  id: 'runtime';
  status: RowStatus;
  /** `minRuntimeVersion` của project. */
  required: string | null;
  /** `system/info.runtimeVersion`. */
  device: string | null;
}

/** Project đang chạy trên thiết bị (`system/info.project`). */
export interface DeviceProjectView {
  state: 'active' | 'none' | 'invalid' | 'unknown';
  projectId?: string;
  projectName?: string;
  projectVersion?: string;
  digest?: string | null;
}

export interface ReplaceRow {
  id: 'replace';
  status: RowStatus;
  device: DeviceProjectView;
  local: ProjectIdentity | null;
  /** Thiết bị đang chạy một project khác (khác `projectId`). */
  otherProject: boolean;
  /** Mở So sánh (US3) từ đây. */
  compare: CompareResult | null;
  summary: CompareSummary | null;
  /** Không so được: mã lỗi (`forbidden`, `no-project-package`, `changed`…); không khóa nạp xuống. */
  compareError: string | null;
}

export interface ClientsRow {
  id: 'clients';
  status: RowStatus;
  /** Client trình duyệt sẽ tự tải lại: `system/info.clients` trừ phiên của Studio. */
  count: number | null;
}

export interface SizeRow {
  id: 'size';
  status: RowStatus;
  /** Kích thước gói. */
  bytes: number | null;
  limit: number;
  /** Chỗ trống của thiết bị. */
  freeBytes: number | null;
  /** Chỗ tối thiểu thiết bị cần: gói và các file sau khi giải nén (thiết bị còn giữ thêm `historianMinFreeMB`). */
  needBytes: number | null;
  problem: 'too-large' | 'no-space' | 'package' | null;
  /** Lỗi đóng gói (`changed`, `{ package: E_PKG_… }`, `too-large`…) khi `problem = package`. */
  error: DeviceError | null;
}

export interface LoggingRow {
  id: 'logging';
  status: RowStatus;
  impact: LoggingImpact | null;
}

export interface DeviceRow {
  id: 'device';
  status: RowStatus;
  user: string | null;
  role: Role | null;
  problems: DeviceProblem[];
  busy: BusyInfo | null;
  /** Lỗi khi hỏi `system/info`. */
  error: DeviceError | null;
}

export interface PreviewRows {
  check: CheckRow;
  runtime: RuntimeRow;
  replace: ReplaceRow;
  clients: ClientsRow;
  size: SizeRow;
  logging: LoggingRow;
  device: DeviceRow;
}

/** Lý do quay lại bước xem trước sau khi bấm Nạp xuống. */
export type PreviewNotice =
  { code: 'base-changed' | 'session-expired' | 'forbidden' } | { code: 'busy'; busy: BusyInfo };

export interface Preview {
  rows: PreviewRows;
  blockers: readonly Blocker[];
  /** Có cảnh báo kiểm tra project: phải đánh dấu "đã đọc cảnh báo". */
  needsAck: boolean;
  acknowledged: boolean;
  canDeploy: boolean;
  /** Digest đang chạy đã xem trước, gửi trong `X-Mat-Base-Digest` (`none` khi chưa có project). */
  baseDigest: string;
  package: PackageInfo | null;
  notice: PreviewNotice | null;
}

export interface StepView {
  id: string;
  state: DeployStepState;
  code?: string;
  message?: string;
  issues?: Issue[];
}

export interface RunningView {
  kind: 'deploy' | 'restore';
  /** ms, theo `now()` */
  startedAt: number;
  send: { sent: number; total: number } | null;
  op: DeployOperation | null;
  /** Thiết bị đang chạy lại (Studio thử lại tối đa 60 s). */
  restarting: boolean;
  /** 6 bước theo thứ tự, thêm `rollback` khi thiết bị báo. */
  steps: StepView[];
}

/**
 * Kết quả: `committed`, `failed`, `rolled-back`, `interrupted` theo thiết bị; `error`: yêu cầu bị từ chối trước khi
 * thao tác bắt đầu (bản đang chạy không đổi); `lost`: không theo dõi được sau khi thiết bị chạy lại.
 */
export type Outcome = Exclude<DeployResult, 'running'> | 'error' | 'lost';

export interface OperationError {
  code: string;
  message?: string;
  issues?: Issue[];
  detail?: unknown;
}

export interface ResultView {
  kind: 'deploy' | 'restore';
  outcome: Outcome;
  op: DeployOperation | null;
  error: OperationError | null;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  /** Bản đang chạy sau thao tác: bản mới khi committed, bản cũ khi failed, rolled-back ("đã quay về bản X"). */
  running: { seq?: number; digest: string; projectVersion: string } | null;
  /** Số client đã được báo tải lại (mã đóng 1012). */
  clientsNotified: number | null;
  /** Bản chạy trước thao tác (khi committed): "Khôi phục bản trước". */
  previousSeq: number | null;
  steps: StepView[];
}

// ---------- Hàm phụ ----------

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const ENGINEER: ReadonlySet<string> = new Set(['engineer', 'administrator']);
const STEP_STATES: ReadonlySet<string> = new Set(['pending', 'running', 'ok', 'failed', 'skipped']);
const EMPTY_SOURCE: ProjectSource = { read: async () => ({ error: 'missing' }) };

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const semver = (v: unknown): string | null => (typeof v === 'string' && SEMVER.test(v) ? v : null);
function msOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = typeof v === 'string' ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) ? t : null;
}

/** Lỗi kèm mã khi so với thiết bị. */
class CodedError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
const codeOf = (e: unknown): string =>
  e instanceof CodedError ? e.code : isDeviceError(e) ? e.error : 'failed';

/** `{ busy: { opId, kind, user, source, since } }` của `DEVICE_BUSY`. */
function busyOf(detail: unknown): BusyInfo {
  const d = isObject(detail) ? detail : {};
  return {
    opId: str(d.opId),
    kind: str(d.kind),
    step: null,
    user: str(d.user),
    source: str(d.source),
    since: msOf(d.since),
  };
}

/** `system/info.operation` (`{ kind, step, since }`, không có tài khoản hay địa chỉ). */
function operationOf(info: DeviceInfo): BusyInfo | null {
  const o = info.operation;
  if (!isObject(o)) return null;
  return {
    opId: str(o.opId),
    kind: str(o.kind),
    step: str(o.step),
    user: null,
    source: null,
    since: msOf(o.since),
  };
}

function mergeBusy(a: BusyInfo | null, b: BusyInfo): BusyInfo {
  return {
    opId: a?.opId ?? b.opId,
    kind: a?.kind ?? b.kind,
    step: b.step ?? a?.step ?? null,
    user: a?.user ?? b.user,
    source: a?.source ?? b.source,
    since: a?.since ?? b.since,
  };
}

function projectView(info: DeviceInfo | null): DeviceProjectView {
  const p = info?.project;
  if (!isObject(p)) return { state: 'unknown' };
  const state: DeviceProjectView['state'] =
    p.status === 'active'
      ? 'active'
      : p.status === 'missing'
        ? 'none'
        : p.status === 'invalid'
          ? 'invalid'
          : 'unknown';
  const out: DeviceProjectView = { state };
  if (state === 'none') return out;
  for (const k of ['projectId', 'projectName', 'projectVersion'] as const) {
    const v = str(p[k]);
    if (v !== null) out[k] = v;
  }
  if (typeof p.digest === 'string' || (state === 'active' && p.digest === null))
    out.digest = p.digest;
  return out;
}

const deviceDigestOf = (info: DeviceInfo | null): string | null =>
  typeof info?.project?.digest === 'string' ? info.project.digest : null;

const hasLoggingChanges = (i: LoggingImpact): boolean =>
  (i.settings !== null && i.settings !== '=') ||
  i.added.length + i.removed.length + i.changed.length + i.newColumns.length > 0 ||
  i.connections.added.length + i.connections.removed.length + i.connections.changed.length > 0;

function stepView(s: DeployStep): StepView {
  const out: StepView = { id: s.id, state: STEP_STATES.has(s.state) ? s.state : 'pending' };
  if (s.code !== undefined) out.code = s.code;
  if (s.message !== undefined) out.message = s.message;
  if (s.issues !== undefined) out.issues = s.issues;
  return out;
}

/**
 * 6 bước theo thứ tự với trạng thái của thao tác; `restore` bỏ qua `receive`, `verify-package`. Chưa có thao tác
 * trên thiết bị thì bước đầu đang chạy (đang gửi gói, đang chờ thiết bị), hoặc lỗi khi yêu cầu bị từ chối. Bước
 * thiết bị báo thêm (`rollback`, bước mới) đứng sau, theo thứ tự thiết bị gửi.
 */
function stepsOf(
  kind: 'deploy' | 'restore',
  op: DeployOperation | null,
  rejected = false,
): StepView[] {
  const known = new Map((op?.steps ?? []).map((s) => [s.id, s]));
  const out = DEPLOY_STEPS.map((id): StepView => {
    const s = known.get(id);
    if (s) return stepView(s);
    const skipped = kind === 'restore' && (id === 'receive' || id === 'verify-package');
    return { id, state: skipped ? 'skipped' : 'pending' };
  });
  if (!op) {
    const first = out.find((s) => s.state !== 'skipped');
    if (first) first.state = rejected ? 'failed' : 'running';
  }
  const fixed: ReadonlySet<string> = new Set(DEPLOY_STEPS);
  for (const s of op?.steps ?? []) if (!fixed.has(s.id)) out.push(stepView(s));
  return out;
}

function errorOf(e: { code: string; message?: string; issues?: Issue[] }): OperationError {
  const out: OperationError = { code: e.code };
  if (e.message !== undefined) out.message = e.message;
  if (e.issues !== undefined) out.issues = e.issues;
  return out;
}

type Checked = { errors: readonly Issue[]; warnings: readonly Issue[] };

interface PreviewInput {
  checked: Checked;
  pkg: PackageInfo | DeviceError;
  info: DeviceInfo | DeviceError;
  session: { user: string; role: Role } | null;
  free: number | null;
  own: number;
  local: ProjectIdentity | null;
  compare: CompareResult | null;
  compareError: string | null;
  notice: PreviewNotice | null;
  acknowledged: boolean;
}

/** Các dòng xem trước và điều kiện khóa (FR-020, data-model §13). Hàm thuần. */
function buildPreview(i: PreviewInput): Preview {
  const blockers: Blocker[] = [];
  const info = isDeviceError(i.info) ? null : i.info;
  const pkg = isDeviceError(i.pkg) ? null : i.pkg;

  const { errors, warnings } = i.checked;
  if (errors.length) blockers.push('errors');
  const check: CheckRow = {
    id: 'check',
    status: errors.length ? 'error' : warnings.length ? 'warn' : 'ok',
    errors: [...errors],
    warnings: [...warnings],
  };

  const required = semver(i.local?.minRuntimeVersion);
  const deviceRuntime = semver(info?.runtimeVersion);
  const tooOld =
    required !== null && deviceRuntime !== null && compareSemver(required, deviceRuntime) > 0;
  if (tooOld) blockers.push('runtime');
  const runtime: RuntimeRow = {
    id: 'runtime',
    status: required === null || deviceRuntime === null ? 'unknown' : tooOld ? 'error' : 'ok',
    required,
    device: deviceRuntime,
  };

  const device = projectView(info);
  const replace: ReplaceRow = {
    id: 'replace',
    status: device.state === 'active' ? 'notice' : device.state === 'unknown' ? 'unknown' : 'ok',
    device,
    local: i.local,
    otherProject:
      device.state === 'active' &&
      i.local !== null &&
      device.projectId !== undefined &&
      device.projectId !== i.local.projectId,
    compare: i.compare,
    summary: i.compare ? summarizeCompare(i.compare) : null,
    compareError: i.compareError,
  };

  const total = info?.clients;
  const count =
    typeof total === 'number' && Number.isFinite(total) ? Math.max(0, total - i.own) : null;
  const clients: ClientsRow = {
    id: 'clients',
    status: count === null ? 'unknown' : count > 0 ? 'notice' : 'ok',
    count,
  };

  let size: SizeRow;
  if (!pkg) {
    blockers.push('package');
    size = {
      id: 'size',
      status: 'error',
      bytes: null,
      limit: MAX_PACKAGE_BYTES,
      freeBytes: i.free,
      needBytes: null,
      problem: 'package',
      error: i.pkg as DeviceError,
    };
  } else {
    const need = pkg.size + pkg.manifest.files.reduce((n, f) => n + f.size, 0);
    const problem =
      pkg.size > MAX_PACKAGE_BYTES
        ? 'too-large'
        : i.free !== null && i.free < need
          ? 'no-space'
          : null;
    if (problem) blockers.push(problem);
    size = {
      id: 'size',
      status: problem ? 'error' : 'ok',
      bytes: pkg.size,
      limit: MAX_PACKAGE_BYTES,
      freeBytes: i.free,
      needBytes: need,
      problem,
      error: null,
    };
  }

  const impact = i.compare ? loggingImpact(i.compare) : null;
  const logging: LoggingRow = {
    id: 'logging',
    status: impact === null ? 'unknown' : hasLoggingChanges(impact) ? 'notice' : 'ok',
    impact,
  };

  const problems: DeviceProblem[] = [];
  if (!info) problems.push('unreachable');
  if (!i.session) problems.push('session');
  else if (!ENGINEER.has(i.session.role)) problems.push('role');
  const running = info ? operationOf(info) : null;
  if (running) problems.push('busy');
  const reported = i.notice?.code === 'busy' ? i.notice.busy : null;
  const busy = running ? mergeBusy(reported, running) : null;
  blockers.push(...problems);
  const deviceRow: DeviceRow = {
    id: 'device',
    status: problems.length ? 'error' : 'ok',
    user: i.session?.user ?? null,
    role: i.session?.role ?? null,
    problems,
    busy,
    error: isDeviceError(i.info) ? i.info : null,
  };

  const notice: PreviewNotice | null =
    i.notice?.code === 'busy' ? { code: 'busy', busy: busy ?? i.notice.busy } : i.notice;
  const needsAck = warnings.length > 0;
  return {
    rows: { check, runtime, replace, clients, size, logging, device: deviceRow },
    blockers,
    needsAck,
    acknowledged: i.acknowledged,
    canDeploy: blockers.length === 0 && pkg !== null && (!needsAck || i.acknowledged),
    baseDigest: deviceDigestOf(info) ?? NO_BASE,
    package: pkg,
    notice,
  };
}

/** Lỗi của `device_deploy` đưa về bước xem trước thay vì kết thúc (người dùng xem lại hoặc đăng nhập lại). */
function noticeOf(e: DeviceError): PreviewNotice | null {
  switch (e.error) {
    case 'base-changed':
    case 'session-expired':
    case 'forbidden':
      return { code: e.error };
    case 'busy':
      return { code: 'busy', busy: busyOf(e.detail) };
    default:
      return null;
  }
}

// ---------- Máy trạng thái ----------

type Listener = (flow: DownloadFlow) => void;
type Call = (onEvent: (e: DeployEvent) => void) => Promise<DeployOperation | DeviceError>;

export class DownloadFlow {
  private readonly project: DownloadProject;
  private readonly device: DownloadDevice;
  private readonly now: () => number;
  private readonly listeners = new Set<Listener>();
  private st: FlowState = 'closed';
  private sub: PrepareStep | null = null;
  private pv: Preview | null = null;
  private run: RunningView | null = null;
  private res: ResultView | null = null;
  /** Gói của lần xem trước hiện tại; bỏ (`package_discard`) khi đóng hộp thoại hoặc đóng gói lại. */
  private built: PackageInfo | null = null;
  /** Lý do quay lại bước xem trước, dùng ở lần xem trước kế tiếp. */
  private nextNotice: PreviewNotice | null = null;
  /** Tăng khi bắt đầu lại hoặc đóng hộp thoại: kết quả của việc cũ còn đang chờ bị bỏ. */
  private cycle = 0;

  constructor(env: DownloadEnv) {
    this.project = env.project;
    this.device = env.device;
    this.now = env.now ?? (() => Date.now());
  }

  get state(): FlowState {
    return this.st;
  }

  /** Bước con khi `preparing`. */
  get step(): PrepareStep | null {
    return this.sub;
  }

  get preview(): Preview | null {
    return this.pv;
  }

  get running(): RunningView | null {
    return this.run;
  }

  get result(): ResultView | null {
    return this.res;
  }

  /** Esc không đóng hộp thoại khi thao tác đang chạy. */
  get canClose(): boolean {
    return this.st !== 'running';
  }

  /** Nghe mọi thay đổi; trả hàm hủy. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Ctrl+L: mở hộp thoại. Còn thay đổi chưa lưu thì dừng ở bước hỏi (`step = ask-save`). */
  async open(): Promise<void> {
    if (this.st !== 'closed') return;
    await this.start(null);
  }

  /** "Lưu rồi nạp xuống". Lưu không được (hủy khi xung đột, lỗi ghi) thì đóng hộp thoại. */
  async saveAndContinue(): Promise<void> {
    if (this.st !== 'preparing' || this.sub !== 'ask-save') return;
    const cycle = this.cycle;
    this.update({ sub: 'saving' });
    const saved = await this.project.save().catch(() => false);
    if (cycle !== this.cycle) return;
    if (!saved || this.project.dirty()) {
      this.close();
      return;
    }
    await this.prepare(cycle);
  }

  /** Ô "đã đọc cảnh báo". */
  acknowledge(on: boolean): void {
    const pv = this.pv;
    if (this.st !== 'preview' || !pv || pv.acknowledged === on) return;
    this.pv = {
      ...pv,
      acknowledged: on,
      canDeploy: pv.blockers.length === 0 && pv.package !== null && (!pv.needsAck || on),
    };
    this.emit();
  }

  /** Làm lại bước xem trước (sau khi đăng nhập lại, thiết bị hết bận…). */
  async refresh(): Promise<void> {
    if (this.st === 'preview') await this.start(null);
  }

  /** Nạp xuống gói đã xem trước. */
  async deploy(): Promise<void> {
    const pv = this.pv;
    const pkg = this.built;
    if (this.st !== 'preview' || !pv || !pv.canDeploy || !pkg) return;
    await this.execute('deploy', (on) => this.device.deploy(pkg.packageId, pv.baseDigest, on));
  }

  /**
   * Khôi phục bản `seq` (danh sách bản lưu), hoặc bản chạy trước thao tác vừa xong (từ `result` khi đã committed).
   * `baseDigest`: digest đang chạy người dùng đã thấy; thiếu thì lấy bản đang chạy theo kết quả, hoặc hỏi thiết bị.
   */
  async restore(seq?: number, baseDigest?: string): Promise<void> {
    if (this.st !== 'closed' && this.st !== 'result') return;
    const fromResult = this.st === 'result' ? this.res : null;
    const target = seq ?? fromResult?.previousSeq ?? null;
    if (target === null) return;
    const known = baseDigest ?? fromResult?.running?.digest;
    await this.execute('restore', async (on) =>
      this.device.restore(target, known ?? (await this.currentDigest()), on),
    );
  }

  /** Đóng hộp thoại (Esc, Hủy, Đóng); không được khi đang chạy. Bỏ gói tạm đã đóng. */
  close(): boolean {
    if (this.st === 'running') return false;
    this.cycle++;
    this.discardBuilt();
    const changed = this.st !== 'closed';
    this.st = 'closed';
    this.sub = null;
    this.pv = null;
    this.run = null;
    this.res = null;
    this.nextNotice = null;
    if (changed) this.emit();
    return true;
  }

  // ---------- Bên trong ----------

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this);
      } catch (err) {
        console.error(err); // lỗi của một người nghe không làm hỏng máy trạng thái
      }
    }
  }

  private update(p: { st?: FlowState; sub?: PrepareStep | null }): void {
    if (p.st !== undefined) this.st = p.st;
    if (p.sub !== undefined) this.sub = p.sub;
    this.emit();
  }

  private discard(pkg: PackageInfo | DeviceError | null): void {
    if (pkg && !isDeviceError(pkg))
      void this.device.discardPackage(pkg.packageId).catch(() => undefined);
  }

  private discardBuilt(): void {
    this.discard(this.built);
    this.built = null;
  }

  /** Bắt đầu (lại) từ đầu bước chuẩn bị. */
  private async start(notice: PreviewNotice | null): Promise<void> {
    const cycle = ++this.cycle;
    this.discardBuilt();
    this.pv = null;
    this.run = null;
    this.res = null;
    this.nextNotice = notice;
    if (this.project.dirty()) {
      this.update({ st: 'preparing', sub: 'ask-save' });
      return;
    }
    await this.prepare(cycle);
  }

  private async prepare(cycle: number): Promise<void> {
    try {
      await this.prepareSteps(cycle);
    } catch (err) {
      // Lỗi lập trình của phần tiêm vào: không để hộp thoại treo ở bước chuẩn bị.
      console.error(err);
      if (cycle === this.cycle) this.close();
    }
  }

  /**
   * Kiểm rồi đóng gói. File trên đĩa khác lần đọc của 004 (bị sửa ngoài Studio): đọc lại, kiểm lại, đóng gói lại.
   * `null` khi hộp thoại đã đóng hoặc bắt đầu lại giữa chừng.
   */
  private async pack(
    cycle: number,
  ): Promise<{ checked: Checked; pkg: PackageInfo | DeviceError } | null> {
    for (let attempt = 1; ; attempt++) {
      this.update({ st: 'preparing', sub: 'checking' });
      const checked = await this.project.check();
      if (cycle !== this.cycle) return null;
      const files = this.project.files();
      this.update({ sub: 'packing' });
      const pkg: PackageInfo | DeviceError = files
        ? await this.device.buildPackage(files).catch((e: unknown) => deviceError(e))
        : { error: 'no-project' };
      if (cycle !== this.cycle) {
        this.discard(pkg);
        return null;
      }
      if (!isDeviceError(pkg) || pkg.error !== 'changed' || attempt >= MAX_PACK_ATTEMPTS)
        return { checked, pkg };
      await this.project.reload();
      if (cycle !== this.cycle) return null;
    }
  }

  private async prepareSteps(cycle: number): Promise<void> {
    const packed = await this.pack(cycle);
    if (!packed) return;
    const { checked, pkg } = packed;
    this.built = isDeviceError(pkg) ? null : pkg;

    this.update({ sub: 'comparing' });
    const [info, session, free] = await Promise.all([
      this.device.info().catch((e: unknown) => deviceError(e)),
      this.device.session().catch(() => null),
      this.device.freeBytes().catch(() => null),
    ]);
    if (cycle !== this.cycle) return;
    let compare: CompareResult | null = null;
    let compareError: string | null = null;
    if (this.built && !isDeviceError(info)) {
      try {
        compare = await this.compareWith(this.built, info);
      } catch (e) {
        compareError = codeOf(e);
      }
      if (cycle !== this.cycle) return;
    }
    this.pv = buildPreview({
      checked,
      pkg,
      info,
      session,
      free,
      own: this.device.ownLiveSessions(),
      local: this.built?.manifest.project ?? this.project.identity(),
      compare,
      compareError,
      notice: this.nextNotice,
      acknowledged: false,
    });
    this.nextNotice = null;
    this.update({ st: 'preview', sub: null });
  }

  /**
   * So gói vừa đóng với project đang chạy (R15): digest giống thì chỉ cần `system/info`; khác thì tải manifest, rồi
   * tải gói nếu có file JSON khác. Gói đọc lên bỏ ngay sau khi so. Thiết bị chưa có project: mọi thứ là `+`.
   */
  private async compareWith(pkg: PackageInfo, info: DeviceInfo): Promise<CompareResult> {
    const local: LocalSide = {
      digest: pkg.digest,
      files: pkg.manifest.files,
      source: this.project.source(),
    };
    const digest = deviceDigestOf(info);
    if (digest === null) {
      // Project cài theo cách cũ chưa vào kho: không đọc lên được để so (device-api §4).
      if (info.project?.status === 'active') throw new CodedError('no-project-package');
      return compareProjects(local, {
        digest: NO_BASE,
        files: async () => [],
        source: async () => EMPTY_SOURCE,
      });
    }
    const device = this.device;
    const fetched: { id: string | null } = { id: null };
    try {
      return await compareProjects(local, {
        digest,
        files: async () => {
          const m = await device.manifest();
          if (isDeviceError(m)) throw new CodedError(m.error);
          if (m.digest !== digest) throw new CodedError('changed');
          return m.files;
        },
        source: async () => {
          const p = await device.fetchPackage();
          if (isDeviceError(p)) throw new CodedError(p.error);
          fetched.id = p.packageId;
          if (p.digest !== digest) throw new CodedError('changed');
          return { read: (rel) => device.readPackageFile(p.packageId, rel) };
        },
      });
    } finally {
      if (fetched.id !== null) void device.discardPackage(fetched.id).catch(() => undefined);
    }
  }

  /** Digest đang chạy trên thiết bị, cho `X-Mat-Base-Digest` khi không có sẵn. */
  private async currentDigest(): Promise<string> {
    const info = await this.device.info().catch((e: unknown) => deviceError(e));
    return (isDeviceError(info) ? null : deviceDigestOf(info)) ?? NO_BASE;
  }

  private async execute(kind: 'deploy' | 'restore', call: Call): Promise<void> {
    const startedAt = this.now();
    this.res = null;
    this.run = {
      kind,
      startedAt,
      send: null,
      op: null,
      restarting: false,
      steps: stepsOf(kind, null),
    };
    this.update({ st: 'running', sub: null });
    const r = await call((e) => this.onEvent(e)).catch((e: unknown) => deviceError(e));
    const last = this.run?.op ?? null;
    if (!isDeviceError(r)) {
      this.finish(kind, startedAt, r);
      return;
    }
    const notice = kind === 'deploy' ? noticeOf(r) : null;
    if (notice) {
      // Về bước xem trước: so lại với thiết bị; cảnh báo phải đánh dấu lại (data-model §13).
      this.run = null;
      await this.start(notice);
      return;
    }
    if (r.error === 'lost') {
      // Không theo dõi được sau khi thiết bị chạy lại: thao tác có thể đã xong (tauri-commands §8).
      const op = await this.device.operation().catch(() => null);
      if (op && !isDeviceError(op) && op.opId === last?.opId && op.result !== 'running') {
        this.finish(kind, startedAt, op);
        return;
      }
      this.fail(kind, startedAt, { code: 'lost' }, last, 'lost');
      return;
    }
    const error: OperationError = { code: r.error };
    if (r.detail !== undefined) error.detail = r.detail;
    this.fail(kind, startedAt, error, null, 'error');
  }

  private onEvent(e: DeployEvent): void {
    const run = this.run;
    if (!run || this.st !== 'running') return;
    switch (e.kind) {
      case 'send':
        this.run = { ...run, send: { sent: e.sent, total: e.total } };
        break;
      case 'operation':
        this.run = { ...run, op: e.op, restarting: false, steps: stepsOf(run.kind, e.op) };
        break;
      case 'restarting':
        this.run = { ...run, restarting: true };
        break;
      default:
        return;
    }
    this.emit();
  }

  private finish(kind: 'deploy' | 'restore', startedAt: number, op: DeployOperation): void {
    const endedAt = this.now();
    const committed = op.result === 'committed';
    const at = committed ? op.to : op.from;
    const running = at
      ? {
          ...(typeof at.seq === 'number' ? { seq: at.seq } : {}),
          digest: at.digest,
          projectVersion: at.projectVersion,
        }
      : null;
    this.res = {
      kind,
      outcome: op.result === 'running' ? 'lost' : op.result,
      op,
      error: op.error ? errorOf(op.error) : null,
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      running,
      clientsNotified: typeof op.clientsNotified === 'number' ? op.clientsNotified : null,
      previousSeq: committed && op.from ? op.from.seq : null,
      steps: stepsOf(kind, op),
    };
    this.run = null;
    this.update({ st: 'result' });
  }

  private fail(
    kind: 'deploy' | 'restore',
    startedAt: number,
    error: OperationError,
    op: DeployOperation | null,
    outcome: 'error' | 'lost',
  ): void {
    const endedAt = this.now();
    this.res = {
      kind,
      outcome,
      op,
      error,
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      running: null,
      clientsNotified: null,
      previousSeq: null,
      steps: stepsOf(kind, op, op === null),
    };
    this.run = null;
    this.update({ st: 'result' });
  }
}
