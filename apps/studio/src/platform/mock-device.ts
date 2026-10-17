// DeviceLink giả cho chế độ build `e2e` (feature 005, T074, contracts/tauri-commands.md §10; như mock.ts của
// 004). Script e2e điều khiển qua `window.__matMock.device`. Không vào bộ cài.
// - Card mạng: Ethernet, Wi-Fi, một card VPN (không broadcast).
// - Thiết bị giả: BL335-01 và BL335-02 trả lời gói tìm trong LAN; TRAM-XA chỉ thêm theo địa chỉ (qua VPN);
//   BL335-07 chạy runtime 0.3.0 (chưa có tìm thiết bị và HTTPS, chỉ theo dõi chỉ đọc qua HTTP 8080).
// - Chứng chỉ: ghim theo đúng lần dò gần nhất; `rotateCert` giả lập `mat-runtime --regen-cert`.
// - Tài khoản kysu1 (engineer), xem1 (viewer), admin (administrator). Mật khẩu do test đặt lúc chạy
//   (`setPassword`, sinh ngẫu nhiên mỗi lần chạy, không ghi vào repo); sai 5 lần thì khóa 5 phút. Mật khẩu gõ vào
//   được chuẩn hóa NFC như bản Tauri rồi mới so (ADR-011, T085c).
// - Dữ liệu sống giả theo giao thức live 1.x cho thiết bị giả. Địa chỉ không thuộc thiết bị giả nào mà test đã khai
//   bằng `realRuntime` (runtime giả của e2e 004) thì đi thẳng ra mạng bằng fetch/WebSocket của trình duyệt, như Rust
//   làm thật. Địa chỉ lạ chưa khai coi như không có gì nghe: lỗi mạng ngay, không gọi ra mạng (trình duyệt ghi lỗi
//   "Failed to load resource" vào console cho mỗi kết nối bị từ chối; bản Tauri gọi trong Rust, không có lỗi này).
// - US2 (T123): nạp xuống, khôi phục, đọc lên trên kho project giả của từng thiết bị (project mẫu `tank-demo` là
//   bản 1 của BL335-01), theo từng bước như thiết bị thật; cờ gây lỗi ở bước bất kỳ (`failDeploy`), gây rollback
//   (lỗi ở `health`), gây DEVICE_BUSY (`setBusy`), BASE_CHANGED (`changeBase`), mất theo dõi (`loseDeploy`).
// - US4 (T148): chẩn đoán đúng dạng contract §6 (số liệu đổi được, độ lệch giờ, lỗi) và audit §7 (administrator;
//   lọc, phân trang, mỗi lần đọc ghi audit.read) trên nhật ký giả có sẵn đăng nhập thất bại và truy cập bị từ chối.
// - T085b: cổng đã lưu trả lời HTTP thường (cổng HTTP của thiết bị giả, hoặc runtime thật đã khai) → `not-tls`;
//   runtime < 0.4.0 thì cổng đó thành `httpPort` của thiết bị đã lưu, như `adopt_old_http_port` của Rust.
import {
  compareSemver,
  compareUtf8,
  digestText,
  isSafeRelPath,
  type PackageFile,
} from '@mat/project-schema';
import { liveSocket, type LiveIpc } from '../model/device-adapters.ts';
import { loginPassword } from './device-types.ts';
import type {
  AddDeviceInput,
  ApiResult,
  DeployEvent,
  DeployOperation,
  DeployStep,
  DeviceError,
  DeviceIdentity,
  DeviceLink,
  DeviceStatus,
  DiscoveredDevice,
  DiscoverSummary,
  KnownDevice,
  LiveEvent,
  LiveTarget,
  NetInterface,
  PackageInfo,
  PackageManifest,
  ProbeResult,
  Role,
  SessionInfo,
  UpdateDeviceInput,
} from './device-types.ts';
import * as m6 from './mock-device-006.ts';
import * as mlogic from './mock-device-logic.ts';
import { platform as mockPlatform, sha256Sync, type MockPlatform } from './mock.ts';
import type { ReadOutcome } from './types.ts';

const SAMPLE = import.meta.glob('../../../../projects/tank-demo/**/*.{json,svg}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const SAMPLE_PREFIX = '../../../../projects/tank-demo/';
/** File của project mẫu theo đường dẫn tương đối (bản 1 trong kho của BL335-01). */
const SAMPLE_FILES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SAMPLE).map(([k, v]) => [k.slice(SAMPLE_PREFIX.length), v]),
);
const SAMPLE_PROJECT = JSON.parse(SAMPLE_FILES['project.json'] ?? '{}') as {
  projectId?: string;
  projectName?: string;
  projectVersion?: string;
  minRuntimeVersion?: string;
};

// ---------- Kho project giả (data-model §9) và gói ----------

const encoder = new TextEncoder();
const GENERATOR = { name: 'mAT Studio', version: 'e2e' };
/** Các bước của thao tác (data-model §10). */
const STEP_IDS = ['receive', 'verify-package', 'validate', 'backup', 'activate', 'health'] as const;
const BACKUPS_MAX = 3;
const MAX_PACKAGES = 4;
const OWN_ADDRESS = '192.168.1.20';

function filesOf(files: Readonly<Record<string, string>>): PackageFile[] {
  return Object.keys(files)
    .sort(compareUtf8)
    .map((path) => ({
      path,
      size: encoder.encode(files[path]).length,
      sha256: sha256Sync(files[path]),
    }));
}

/** Digest nội dung (contract matscada-package §4), đồng bộ. */
const digestOf = (list: readonly PackageFile[]): string => `sha256:${sha256Sync(digestText(list))}`;

function manifestOf(files: Readonly<Record<string, string>>): PackageManifest | null {
  let id: Record<string, unknown>;
  try {
    id = JSON.parse(files['project.json'] ?? '') as Record<string, unknown>;
  } catch {
    return null;
  }
  const s = (k: string) => (typeof id[k] === 'string' ? (id[k] as string) : null);
  const [projectId, projectName, projectVersion, minRuntimeVersion] = [
    s('projectId'),
    s('projectName'),
    s('projectVersion'),
    s('minRuntimeVersion'),
  ];
  if (!projectId || !projectName || !projectVersion || !minRuntimeVersion) return null;
  const list = filesOf(files);
  return {
    format: 'matscada-package',
    formatVersion: '1.0.0',
    project: { projectId, projectName, projectVersion, minRuntimeVersion },
    createdAt: new Date().toISOString(),
    generator: { ...GENERATOR },
    files: list,
    digest: digestOf(list),
  };
}

/** Một bản trong kho của thiết bị giả (`v/<seq>`): các file và manifest. */
interface StoredVersion {
  seq: number;
  digest: string;
  projectId: string;
  projectName: string;
  projectVersion: string;
  minRuntimeVersion: string;
  size: number;
  activatedAt: string;
  clockOk: boolean;
  deployedBy: string;
  deployedFrom: string;
  source: 'studio' | 'runtime-package' | 'restore';
  files: Record<string, string>;
  manifest: PackageManifest;
}

interface FakeStore {
  active: number | null;
  nextSeq: number;
  versions: StoredVersion[];
}

const packageSize = (files: Readonly<Record<string, string>>): number =>
  Math.round(filesOf(files).reduce((n, f) => n + f.size, 0) * 0.35) + 400;

function versionOf(
  seq: number,
  files: Record<string, string>,
  by: { user: string; from: string; source: StoredVersion['source'] },
): StoredVersion {
  const manifest = manifestOf(files);
  if (!manifest) throw new Error('mock-device: project.json lacks identity fields');
  return {
    seq,
    digest: manifest.digest,
    projectId: manifest.project.projectId,
    projectName: manifest.project.projectName,
    projectVersion: manifest.project.projectVersion,
    minRuntimeVersion: manifest.project.minRuntimeVersion,
    size: packageSize(files),
    activatedAt: new Date().toISOString(),
    clockOk: true,
    deployedBy: by.user,
    deployedFrom: by.from,
    source: by.source,
    files: { ...files },
    manifest,
  };
}

const IFACES: readonly NetInterface[] = [
  {
    index: 0,
    name: 'Ethernet 2',
    address: '192.168.1.20',
    prefix: 24,
    broadcast: '192.168.1.255',
    canBroadcast: true,
    hint: null,
  },
  {
    index: 1,
    name: 'Wi-Fi',
    address: '10.0.0.15',
    prefix: 24,
    broadcast: '10.0.0.255',
    canBroadcast: true,
    hint: null,
  },
  {
    index: 2,
    name: 'WireGuard',
    address: '10.8.0.2',
    prefix: 32,
    broadcast: null,
    canBroadcast: false,
    hint: 'vpn',
  },
];

const FEATURES = ['auth', 'deploy', 'upload', 'restore', 'diagnostics', 'audit'];
/** Đường dẫn `device_get` được phép (contract §6). */
const ALLOWED = [
  /^\/api\/v1\/(system\/info|device\/identity|auth\/session|diagnostics|audit)$/,
  /^\/api\/v1\/project\/(versions|manifest|operation)$/,
  /^\/api\/v1\/project\/deployments\/[0-9a-f-]{36}$/,
  // Feature 006 (tauri-commands-006 §2).
  /^\/api\/v1\/(projects\/active|tags\/write|drivers\/diagnostics|serial\/ports)$/,
  /^\/api\/v1\/tags\/write\/[0-9a-f-]{36}$/,
];
/** Đường dẫn `device_post` được phép (tauri-commands-006 §3). */
const ALLOWED_POST = ['/api/v1/tags/write', '/api/v1/drivers/test'];
const RANK: Readonly<Record<Role, number>> = {
  viewer: 0,
  operator: 1,
  engineer: 2,
  administrator: 3,
};
const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const LOCK_MS = 5 * 60_000;
const MAX_FAILURES = 5;
/** Runtime đầu tiên có HTTPS, đăng nhập (như `ONLINE_RUNTIME` của device-session.ts). */
const ONLINE_RUNTIME = '0.4.0';

/**
 * Như `runtime_before_online` của Rust (T085b): phần `MAJOR.MINOR.PATCH` cũ hơn 0.4.0, bỏ hậu tố pre-release và build;
 * chuỗi không đúng dạng ba số thì không coi là cũ.
 */
function runtimeBeforeOnline(version: unknown): boolean {
  const core = typeof version === 'string' ? /^(\d+\.\d+\.\d+)(?:[-+]|$)/.exec(version)?.[1] : null;
  return !!core && compareSemver(core, ONLINE_RUNTIME) < 0;
}

/** Mã lỗi mặc định của từng bước khi `failDeploy` không nêu mã (device-api §5). */
function defaultFailCode(step: string): string {
  switch (step) {
    case 'receive':
      return 'RECEIVE_TIMEOUT';
    case 'verify-package':
      return 'E_PKG_CHECKSUM';
    case 'validate':
      return 'E_VALIDATION';
    case 'backup':
      return 'STORE_IO';
    case 'activate':
      return 'EXEC_FAILED';
    default:
      return 'HEALTH_TIMEOUT';
  }
}

/** Đưa `files` vào kho thành bản mới đang chạy; giữ tối đa `BACKUPS_MAX` bản lưu. Trả bản mới. */
function commit(
  f: FakeDev,
  files: Record<string, string>,
  by: { user: string; from: string; source: StoredVersion['source'] },
): StoredVersion {
  const v = versionOf(f.store.nextSeq++, files, by);
  f.store.versions.push(v);
  f.store.active = v.seq;
  const backups = f.store.versions
    .filter((x) => x.seq !== v.seq)
    .sort((a, b) => b.seq - a.seq)
    .slice(0, BACKUPS_MAX);
  f.store.versions = [v, ...backups].sort((a, b) => a.seq - b.seq);
  f.project = {
    id: v.projectId,
    name: v.projectName,
    version: v.projectVersion,
    digest: v.digest,
  };
  f.status = 'running';
  return v;
}

/** Digest đang chạy trong kho, hoặc `none` (`X-Mat-Base-Digest`). */
const baseOf = (f: FakeDev): string =>
  f.store.versions.find((v) => v.seq === f.store.active)?.digest ?? 'none';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

interface Fail {
  failures: number;
  lockedUntil: number;
}

interface FakeDev {
  name: string;
  deviceId: string;
  model: string;
  mac: string;
  ip: string;
  prefix: number;
  /** Card nhận được gói trả lời; `null`: không trả lời gói tìm (khác subnet, runtime cũ). */
  iface: number | null;
  /** Thời điểm trả lời gói hỏi đầu (ms); hai gói hỏi sau ở +600, +1200 ms. */
  replyMs: number;
  runtime: string;
  protocol: string;
  status: DeviceStatus;
  project: { id: string; name: string; version: string; digest: string } | null;
  /** `0`: không có cổng HTTPS (runtime cũ). */
  httpsPort: number;
  httpPort: number;
  fingerprint: string | null;
  certGen: number;
  accounts: Map<string, { role: Role; password: string | null }>;
  setupRequired: boolean;
  userFail: Map<string, Fail>;
  srcFail: Fail;
  lives: Set<FakeLive>;
  uptimeS: number;
  /** Kho project (rỗng khi chưa có project). */
  store: FakeStore;
  /** Thao tác đang chạy hoặc gần nhất. */
  op: DeployOperation | null;
  /** Cờ gây DEVICE_BUSY: có người khác đang nạp xuống. */
  busy: { user: string; source: string } | null;
  /** Số client khác (trình duyệt) đang xem, cộng với phiên live của Studio. */
  extraClients: number;
  freeBytes: number;
  diag: MockDiagnostics;
  audit: MockAuditRow[];
  /** Lần đọc audit kế tiếp trả lỗi này (cho tới khi `null`). */
  auditError: string | null;
  /** Cảnh báo của feature 011 trong `system/info` (`warnings`, `warningDetails`; T052). */
  warnings011: Array<{ code: string; message: string; detail: unknown }>;
  /** `device/identity.acceptedHosts` (feature 011, device-api-011 §1); `null`: runtime cũ không có khóa. */
  acceptedHosts: { names: string[]; ips: string[] } | null;
}

/** Một bản ghi audit giả (device-api §7, dạng JSON của `GET /api/v1/audit`). */
export interface MockAuditRow {
  id: number;
  ts: number;
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
  count: number;
}

/** Bản ghi muốn thêm: chỉ `action` và `result` là bắt buộc. */
export type MockAuditInput = Partial<Omit<MockAuditRow, 'id'>> &
  Pick<MockAuditRow, 'action' | 'result'>;

/** Số liệu chẩn đoán giả (device-api §6); `skewMs`: giờ thiết bị lệch bao nhiêu so với máy này. */
export interface MockDiagnostics {
  cpu: { systemPct1m: number; runtimePct1m: number; loadAvg1: number; cores: number };
  memory: { runtimeRssBytes: number; systemTotalBytes: number; systemAvailableBytes: number };
  skewMs: number;
  timeSynced: boolean;
  /** Lần hỏi chẩn đoán trả lỗi này (cho tới khi `null`). */
  fail: string | null;
  /** Khối của 006 (device-api-1.1 §2), chỉ trả khi runtime từ 0.5.0; vắng thì mặc định (trang xem theo `viewerAccess`). */
  viewer?: { access: string; blockedTotal: number; lastBlockedAt: number | null };
  tags?: { total: number; good: number; uncertain: number; bad: number };
  retain?: { state: string; tags: number; lastSaveAt: number | null; saves: number };
}

interface Token {
  user: string;
  role: Role;
  /** Trạng thái phía thiết bị; Rust chỉ biết khi gọi tới. */
  device: 'ok' | 'expired' | 'invalid';
}

export interface FakeDeviceView {
  name: string;
  deviceId: string;
  ip: string;
  mac: string;
  httpsPort: number;
  httpPort: number;
  runtime: string;
  fingerprint: string;
}

export interface MockDeviceControl {
  /** Thời gian một lượt quét (ms); mặc định 2500 như Rust. */
  scanMs: number;
  /** Đặt mật khẩu cho tài khoản giả trên mọi thiết bị giả có tài khoản đó. */
  setPassword(user: string, password: string): void;
  /** Thông tin hiện tại của thiết bị giả theo tên (BL335-01, BL335-02, TRAM-XA, BL335-07). */
  device(name: string): FakeDeviceView;
  /** Đổi chứng chỉ (như `mat-runtime --regen-cert`); trả fingerprint mới. */
  rotateCert(name: string): string;
  /** Đổi cổng HTTP thiết bị giả nghe (như port-forward :9080 tới cổng 8080 của thiết bị), T085b. */
  setHttpPort(name: string, port: number): void;
  /**
   * Khai `host:cổng` của một runtime nghe HTTP ngoài trình duyệt (runtime giả của e2e): system/info, dữ liệu sống và
   * dò chứng chỉ tới địa chỉ này đi thẳng ra mạng. Địa chỉ lạ chưa khai coi như không có gì nghe.
   */
  realRuntime(address: string): void;
  /** Phiên trên thiết bị hết hạn (30 phút không thao tác): lần gọi sau trả `session-expired`. */
  expireSession(name: string): void;
  /** Phiên bị hủy (tài khoản tắt, đổi IP): lần gọi sau trả `session-invalid`. */
  invalidateSession(name: string): void;
  /** Thiết bị chưa có tài khoản nào: đăng nhập trả `setup-required`. */
  setSetupRequired(name: string, on: boolean): void;
  /** Ngắt mọi kết nối dữ liệu sống tới thiết bị giả (mạng rớt): close 1006. */
  dropLive(name: string): void;
  /** Bản sao danh sách thiết bị đã lưu (như devices.json). */
  saved(): KnownDevice[];
  /**
   * Thêm thẳng vào danh sách đã lưu, không qua lệnh (như devices.json có sẵn từ lần chạy trước), ví dụ thiết bị
   * trỏ tới runtime giả của e2e 004 ở cổng HTTP ngẫu nhiên. Địa chỉ sai thì ném lỗi `bad-address`.
   */
  addSaved(input: AddDeviceInput): KnownDevice;
  /** Thời gian mỗi bước nạp xuống (ms); mặc định 150. */
  deployStepMs: number;
  /**
   * Lần nạp xuống hay khôi phục kế tiếp lỗi ở `step` (`receive`, `verify-package`, `validate`, `backup`,
   * `activate`: thao tác `failed`; `health`: thiết bị tự rollback, `rolled-back`) với mã `code`. Dùng một lần;
   * `null` để hủy.
   */
  failDeploy(step: (typeof STEP_IDS)[number] | null, code?: string): void;
  /** Có người khác đang nạp xuống (`DEVICE_BUSY` kèm `{ opId, kind, user, source, since }`); `null` để hết bận. */
  setBusy(name: string, by: { user: string; source: string } | null): void;
  /** Người khác vừa nạp xuống: bản đang chạy đổi digest (`BASE_CHANGED` cho Studio còn giữ digest cũ). */
  changeBase(name: string): void;
  /** Nạp xuống xong nhưng Studio mất theo dõi (`lost`): thao tác trên thiết bị vẫn hoàn tất. */
  loseDeploy(on: boolean): void;
  /** Lần `package_build` kế tiếp trả lỗi này (một lần). */
  failBuild(error: DeviceError | null): void;
  /** Sửa một file của bản đang chạy trong kho (để thử So sánh); đổi digest. */
  editStored(name: string, rel: string, content: string): void;
  /**
   * Thư mục mà hộp thoại của `package_extract` trả về lần sau: `empty` (mặc định: thư mục rỗng, giải nén được),
   * `not-empty` (lỗi `not-empty`), `cancel` (người dùng hủy: `null`).
   */
  setExtractFolder(mode: 'empty' | 'not-empty' | 'cancel'): void;
  /** Đổi số liệu chẩn đoán của thiết bị giả (device-api §6); `fail` gây lỗi cho các lần hỏi sau. */
  setDiagnostics(
    name: string,
    patch: Partial<Omit<MockDiagnostics, 'fail'>> & { fail?: string | null },
  ): void;
  /** Thêm bản ghi vào audit của thiết bị giả (mới hơn các bản ghi có sẵn). */
  addAudit(name: string, rows: readonly MockAuditInput[]): void;
  /** Lần đọc audit kế tiếp trả lỗi này (một mã lỗi của lệnh Rust); `null` để hết lỗi. */
  setAuditError(name: string, code: string | null): void;
  /** Chỗ trống của phân vùng dữ liệu báo trong `/api/v1/diagnostics`. */
  setFreeBytes(name: string, bytes: number): void;
  /** Số client trình duyệt khác đang xem (cộng vào `system/info.clients`). */
  setClients(name: string, count: number): void;
  // ---- Feature 006 ----
  /** Đổi phiên bản runtime của thiết bị giả: từ 0.5.0 có API 1.1, live 1.2, schema 0.1 và 0.2, ghi Tag, Thử kết nối. */
  setRuntime(name: string, version: string): void;
  /** `viewerAccess` của thiết bị giả (ADR-018); `any` thì `system/info.warnings` có `VIEWER_PUBLIC`. */
  setViewerAccess(name: string, access: 'private' | 'any' | 'off'): void;
  /** Cảnh báo của feature 011 trong `system/info` (T052): mã, thông điệp, `detail`. */
  setWarnings(
    name: string,
    list: Array<{ code: string; message?: string; detail?: unknown }>,
  ): void;
  /** `device/identity.acceptedHosts` (feature 011); `null` để bỏ khóa (runtime cũ). */
  setAcceptedHosts(name: string, hosts: { names: string[]; ips: string[] } | null): void;
  /** Theo dõi theo địa chỉ bị 403 vì lọc nguồn (lý do của Rust: `viewer-private`, `viewer-off`); `null` để bỏ. */
  setViewerBlock(name: string, block: 'viewer-private' | 'viewer-off' | null): void;
  /** Đặt mẫu sống của một Tag (giá trị, quality, lý do); `null` để về giá trị mặc định. */
  setTag(name: string, id: string, sample: m6.Sample | null): void;
  /** Phiên hết hạn: kết nối live mở bằng token bị đóng 4401, lần gọi sau trả `session-expired`. */
  endSession(name: string): void;
  /** Cách thiết bị trả lời lệnh ghi (kết quả cuối, độ trễ, mã), cố định hoặc theo từng lệnh. */
  setWriteBehavior(
    name: string,
    behavior: m6.WriteBehavior | ((req: m6.WriteRequestView) => m6.WriteBehavior),
  ): void;
  /** Giới hạn số lệnh ghi mỗi phút toàn thiết bị (mặc định 20; 0 = không giới hạn). */
  setWriteRate(name: string, perMin: number): void;
  /**
   * Mất mạng sau khi gửi (US2-10): `tags/write` kế tiếp được thiết bị nhận và xử lý nhưng câu trả lời không về tới Studio
   * (`device_post` trả `timeout`). Studio phải hỏi kết quả theo mã, không gửi lại.
   */
  loseNextWriteReply(name: string): void;
  /** Các lệnh ghi đã được nhận (không gồm lệnh bị từ chối), theo thứ tự. */
  writeLog(name: string): m6.WriteRequestView[];
  /** Lần `drivers/test` kế tiếp trả lỗi này (một lần): `TEST_BUSY`, `TEST_RATE_LIMITED`, `AUDIT_UNAVAILABLE`. */
  setProbeError(name: string, code: string | null): void;
  /** Thay trả lời của `drivers/test` (nhận thân gửi lên); `null` về mặc định theo máy chủ/cổng/địa chỉ. */
  setProbe(name: string, fn: ((body: Record<string, unknown>) => m6.ProbeReply) | null): void;
  /** Các thân `drivers/test` đã nhận. */
  probeLog(name: string): Record<string, unknown>[];
  /** Đặt chẩn đoán driver (kênh, Tag xấu, lỗi). */
  setDriverDiagnostics(
    name: string,
    patch: { channels?: m6.DiagChannel[]; badTags?: m6.DiagBadTag[]; fail?: string | null },
  ): void;
  /** Tiêm lỗi vào số đếm của một thiết bị trường. */
  injectDriverFault(
    name: string,
    deviceId: string,
    patch: {
      timeouts?: number;
      exceptions?: Record<string, number>;
      badFrames?: Partial<m6.DiagDevice['badFrames']>;
      state?: m6.DiagDevice['state'];
      overloaded?: boolean;
    },
  ): void;
  /** `GET projects/active` trả danh sách Tag này (khác bản trên máy: thử cảnh báo khác biệt của hộp xác nhận ghi). */
  setActiveOverride(
    name: string,
    override: { tags?: unknown[]; project?: Record<string, unknown> } | null,
  ): void;
  // ---- Feature 011 ----
  /** Logic của thiết bị giả (runtime ≥ 1.0.0): `logic.writes`, các khối của `GET /api/v1/logic`. */
  setLogic(name: string, config: mlogic.MockLogicConfig): void;
  /** Hành động audit logic đã ghi (`logic.writes.disabled`, `logic.reset`), theo thứ tự. */
  logicAudit(name: string): string[];
  /** Lệnh đã gọi, theo thứ tự: tên lệnh Rust tương ứng và tham số (không có mật khẩu). */
  readonly calls: Array<{ cmd: string; args: Record<string, unknown> }>;
}

export type MockDevice = DeviceLink & { readonly control: MockDeviceControl };

/** Fingerprint mới sau mỗi lần tạo lại chứng chỉ (tất định, 64 hex chữ thường). */
function rotateHex(fp: string, gen: number): string {
  return [...fp].map((c, i) => ((parseInt(c, 16) + 7 * gen + i) % 16).toString(16)).join('');
}

const DAY_MS = 86_400_000;
/** Đầu nhật ký giả: 2026-10-09 01:00 UTC. */
const AUDIT_T0 = Date.UTC(2026, 9, 9, 1, 0, 0);

function defaultDiagnostics(): MockDiagnostics {
  return {
    cpu: { systemPct1m: 11.7, runtimePct1m: 4.2, loadAvg1: 0.42, cores: 2 },
    memory: {
      runtimeRssBytes: 9_900_032,
      systemTotalBytes: 1_041_235_968,
      systemAvailableBytes: 909_115_392,
    },
    skewMs: 0,
    timeSynced: true,
    fail: null,
  };
}

/** Nhật ký có sẵn: đăng nhập thành công, thất bại, truy cập bị từ chối, nạp xuống, đọc lên, đăng xuất. */
function seedAudit(): MockAuditRow[] {
  const rows: MockAuditRow[] = [];
  const add = (minute: number, partial: MockAuditInput): void =>
    void rows.push({
      id: rows.length + 1,
      ts: AUDIT_T0 + minute * 60_000,
      clockOk: true,
      user: null,
      role: null,
      source: '192.168.1.20:51234',
      channel: 'https',
      target: null,
      code: null,
      detail: null,
      count: 1,
      ...partial,
    });
  add(0, { action: 'auth.login', result: 'ok', user: 'admin', role: 'administrator' });
  add(2, { action: 'auth.login', result: 'ok', user: 'kysu1', role: 'engineer' });
  add(3, {
    action: 'auth.login',
    result: 'failed',
    user: 'kysu1',
    code: 'AUTH_FAILED',
    source: '192.168.1.77:40021',
    count: 3,
  });
  add(4, {
    action: 'access.denied',
    result: 'denied',
    user: 'xem1',
    role: 'viewer',
    code: 'FORBIDDEN',
    target: '/api/v1/project/deployments',
  });
  add(5, {
    action: 'project.deploy',
    result: 'started',
    user: 'kysu1',
    role: 'engineer',
    target: 'sha256:9ba112c6',
    detail: { opId: 'op-1' },
  });
  add(6, {
    action: 'project.deploy',
    result: 'ok',
    user: 'kysu1',
    role: 'engineer',
    target: 'sha256:9ba112c6',
    detail: { opId: 'op-1' },
  });
  add(8, {
    action: 'project.read',
    result: 'ok',
    user: 'kysu1',
    role: 'engineer',
    target: 'sha256:9ba112c6',
  });
  add(9, { action: 'auth.logout', result: 'ok', user: 'kysu1', role: 'engineer' });
  add(60 + DAY_MS / 60_000, {
    action: 'access.denied',
    result: 'denied',
    code: 'AUTH_REQUIRED',
    target: '/api/v1/project/versions',
    source: '10.0.0.8:50001',
  });
  return rows;
}

function fakeDevices(): FakeDev[] {
  const projectId = SAMPLE_PROJECT.projectId ?? 'tank-demo';
  const sample = versionOf(
    1,
    { ...SAMPLE_FILES },
    { user: 'kysu1', from: OWN_ADDRESS, source: 'runtime-package' },
  );
  sample.activatedAt = '2026-10-09T08:00:00Z';
  const tank = {
    id: projectId,
    name: SAMPLE_PROJECT.projectName ?? projectId,
    version: SAMPLE_PROJECT.projectVersion ?? '0.1.0',
    digest: sample.digest,
  };
  const accounts = () =>
    new Map<string, { role: Role; password: string | null }>([
      ['kysu1', { role: 'engineer', password: null }],
      ['xem1', { role: 'viewer', password: null }],
      ['admin', { role: 'administrator', password: null }],
    ]);
  const base = {
    model: 'BL335',
    prefix: 24,
    certGen: 0,
    setupRequired: false,
    lives: new Set<FakeLive>(),
    srcFail: { failures: 0, lockedUntil: 0 },
  };
  const make = (
    d: Partial<FakeDev> & Pick<FakeDev, 'name' | 'deviceId' | 'mac' | 'ip'>,
  ): FakeDev => ({
    ...base,
    iface: null,
    replyMs: 300,
    runtime: '0.4.0',
    protocol: '1.1.0',
    status: 'running',
    project: tank,
    httpsPort: 8443,
    httpPort: 8080,
    fingerprint: null,
    accounts: accounts(),
    userFail: new Map(),
    uptimeS: 3 * 86400 + 4 * 3600,
    ...d,
    lives: new Set<FakeLive>(),
    srcFail: { failures: 0, lockedUntil: 0 },
    store: { active: null, nextSeq: 1, versions: [] },
    op: null,
    busy: null,
    extraClients: 0,
    freeBytes: 6_512_341_504,
    diag: defaultDiagnostics(),
    audit: seedAudit(),
    auditError: null,
    warnings011: [],
    acceptedHosts: null,
  });
  const devices = [
    make({
      name: 'BL335-01',
      deviceId: '4f9c2a8e-6d1b-4c3a-9e57-0b2f1d6c8a10',
      mac: '02:4E:1C:5A:33:01',
      ip: '192.168.1.110',
      iface: 0,
      replyMs: 300,
      fingerprint: 'a35f1c9e4207b8d16c20e4937a0f58c2194bd760e82a913c5d7f0b66a412c98e',
    }),
    make({
      name: 'BL335-02',
      deviceId: '7d3e9b21-5a4c-4f8e-b1d2-3c6a9e0f7b52',
      mac: '02:4E:1C:5A:33:02',
      ip: '192.168.1.111',
      iface: 0,
      replyMs: 700,
      status: 'no-project',
      project: null,
      uptimeS: 12 * 3600,
      fingerprint: '5ce02b719d440af3861bc729e5503fd8620eb49713af7c58d1269be3046af03d',
    }),
    make({
      name: 'TRAM-XA',
      deviceId: 'c2a7f4e9-1b3d-4e6a-8f5c-9d0b2e4a6c71',
      mac: '02:4E:1C:5A:33:21',
      ip: '10.8.0.21',
      uptimeS: 9 * 86400,
      fingerprint: '7e21c40b935ae816d07f42a93c65b1082df4976e13c85ba0e239740dbf612895',
    }),
    make({
      name: 'BL335-07',
      deviceId: '9b1e5d3c-7f2a-4c8e-a6b4-1e3d5f7a9c02',
      mac: '02:4E:1C:5A:33:07',
      ip: '192.168.1.117',
      runtime: '0.3.0',
      protocol: '1.0.0',
      httpsPort: 0,
      fingerprint: null,
      accounts: new Map(),
      uptimeS: 41 * 86400,
    }),
  ];
  // Thiết bị có project trong kho: bản 1 là project mẫu (như thiết bị đã nhận project cài theo cách cũ).
  for (const d of devices) {
    if (d.project && d.httpsPort !== 0)
      d.store = { active: 1, nextSeq: 2, versions: [{ ...sample, files: { ...sample.files } }] };
  }
  return devices;
}

/** Giá trị sống của thiết bị giả (project mẫu); TANK01.LEVEL đổi 42 ↔ 43. */
function liveValue(id: string, tick: number): unknown {
  switch (id) {
    case 'TANK01.LEVEL':
      return tick % 4 < 2 ? 42 : 43;
    case 'MOTOR01.RUN':
      return true;
    case 'MOTOR01.SPEED':
      return 1440;
    case 'TANK01.INFLOW':
      return 9.5;
    case 'TANK01.TEMP':
      return 25.3;
    default:
      return undefined;
  }
}

/** Một phiên dữ liệu sống tới thiết bị giả: hello, subscribe → snapshot, delta mỗi 500 ms, heartbeat 5 s. */
class FakeLive {
  private tick = 0;
  private sub: { id: string; ids: string[]; sent: string[]; seq: number } | null = null;
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private ended = false;
  private readonly dev: FakeDev;
  private readonly emit: (e: LiveEvent) => void;

  /** Mở bằng phiên đăng nhập (target `{ id }`, có token): máy chủ 1.2 đóng 4401 khi phiên hết. */
  readonly viaSession: boolean;

  constructor(dev: FakeDev, emit: (e: LiveEvent) => void, viaSession = false) {
    this.dev = dev;
    this.emit = emit;
    this.viaSession = viaSession;
    dev.lives.add(this);
    setTimeout(() => {
      if (this.ended) return;
      this.emit({ kind: 'open' });
      this.send({
        type: 'hello',
        protocolVersion: dev.protocol,
        serverVersion: `${dev.runtime}-mock`,
        maxClients: 10,
        heartbeatMs: 5000,
        timeoutMs: 15000,
        project: dev.project
          ? { projectId: dev.project.id, projectVersion: dev.project.version }
          : null,
      });
      this.timers.push(setInterval(() => this.onTick(), 500));
      this.timers.push(setInterval(() => this.send({ type: 'heartbeat', ts: Date.now() }), 5000));
    }, 20);
  }

  private send(m: object): void {
    if (!this.ended) this.emit({ kind: 'message', data: JSON.stringify(m) });
  }

  private sample(id: string, tick: number): m6.Sample | undefined {
    return m6.sampleOf(this.dev, id, tick, liveValue);
  }

  private static sig(v: m6.Sample): string {
    return JSON.stringify([v.value, v.quality, v.reason ?? null]);
  }

  /** Bản tin của client tới sau `hello` (như máy chủ thật: hello đã gửi ngay khi nhận phiên). */
  receive(text: string): void {
    setTimeout(() => {
      if (!this.ended) this.handle(text);
    }, 5);
  }

  private handle(text: string): void {
    let m: { type?: unknown; requestId?: unknown; tags?: unknown };
    try {
      m = JSON.parse(text) as typeof m;
    } catch {
      return;
    }
    if (m.type !== 'subscribe' || !Array.isArray(m.tags)) return;
    const asked = m.tags.map(String);
    const ids = asked.filter((id) => this.sample(id, 0) !== undefined);
    const unknown = asked.filter((id) => this.sample(id, 0) === undefined);
    if (!ids.length) {
      this.send({
        type: 'error',
        code: 'NO_VALID_TAGS',
        message: 'no valid tags',
        requestId: m.requestId,
      });
      return;
    }
    const seq = (this.sub?.seq ?? 0) + 1;
    const samples = ids.map((id) => this.sample(id, this.tick)!);
    this.sub = { id: String(m.requestId), ids, sent: samples.map((v) => FakeLive.sig(v)), seq };
    const now = Date.now();
    this.send({
      type: 'snapshot',
      subscriptionId: this.sub.id,
      sequence: seq,
      ts: now,
      tags: ids.map((id, i) => ({
        id,
        value: samples[i].value,
        quality: samples[i].quality,
        ...(samples[i].reason ? { reason: samples[i].reason } : {}),
        sourceTimestamp: now,
        serverTimestamp: now,
        revision: 1,
      })),
      unknown,
    });
  }

  private onTick(): void {
    this.tick++;
    const sub = this.sub;
    if (!sub) return;
    const changes: Array<[number, unknown, string] | [number, unknown, string, string]> = [];
    sub.ids.forEach((id, i) => {
      const v = this.sample(id, this.tick);
      if (!v) return;
      const sig = FakeLive.sig(v);
      if (sig !== sub.sent[i]) {
        sub.sent[i] = sig;
        changes.push(v.reason ? [i, v.value, v.quality, v.reason] : [i, v.value, v.quality]);
      }
    });
    if (!changes.length) return;
    sub.seq++;
    this.send({
      type: 'delta',
      subscriptionId: sub.id,
      sequence: sub.seq,
      ts: Date.now(),
      tags: changes,
    });
  }

  stop(code: number, reason: string): void {
    if (this.ended) return;
    this.ended = true;
    for (const t of this.timers) clearInterval(t);
    this.dev.lives.delete(this);
    setTimeout(() => this.emit({ kind: 'close', code, reason }), 0);
  }
}

interface LiveHandle {
  receive(text: string): void;
  stop(code: number, reason: string): void;
}

/** Kết nối thật tới địa chỉ không thuộc thiết bị giả (runtime giả của e2e 004), như Rust làm thật. */
function realLive(address: string, emit: (e: LiveEvent) => void): LiveHandle {
  const ws = new WebSocket(`ws://${address}/api/v1/live`);
  ws.onopen = () => emit({ kind: 'open' });
  ws.onmessage = (ev) => emit({ kind: 'message', data: String(ev.data) });
  ws.onclose = (ev) => emit({ kind: 'close', code: ev.code, reason: ev.reason });
  return {
    receive: (text) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
    },
    stop: (code, reason) => {
      // WebSocket của trình duyệt chỉ nhận 1000 hoặc 3000–4999.
      const valid = code === 1000 || (code >= 3000 && code <= 4999);
      ws.close(valid ? code : 1000, reason.slice(0, 120));
    },
  };
}

async function realMonitorGet(address: string): Promise<ApiResult | DeviceError> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    const res = await fetch(`http://${address}/api/v1/system/info`, {
      signal: ctl.signal,
      cache: 'no-store',
    });
    if (!res.ok) return { error: 'http', detail: res.status };
    try {
      return { status: res.status, body: (await res.json()) as unknown };
    } catch {
      return { error: 'bad-response' };
    }
  } catch (e) {
    return ctl.signal.aborted
      ? { error: 'timeout' }
      : { error: 'network', detail: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export interface MockDeviceOptions {
  /**
   * Nơi `package_build` đọc lại file project và `package_extract` đặt project vừa giải nén; mặc định là platform giả
   * dùng chung của e2e.
   */
  platform?: Pick<MockPlatform, 'read' | 'pickProject' | 'control'>;
  /** Trả lời chậm như thiết bị thật (dò, đăng nhập: 60–150 ms). Tắt trong test đơn vị. Mặc định bật. */
  latency?: boolean;
}

export function createMockDevice(opts: MockDeviceOptions = {}): MockDevice {
  const latency = opts.latency ?? true;
  const projectFiles = opts.platform ?? mockPlatform;
  const later = <T>(ms: number, value: T): Promise<T> =>
    latency
      ? new Promise((resolve) => setTimeout(() => resolve(value), ms))
      : Promise.resolve(value);
  const fakes = fakeDevices();
  const known: KnownDevice[] = [];
  const lastProbe = new Map<string, string>();
  const discovered = new Map<string, string>();
  const tokens = new Map<string, Token>();
  const lives = new Map<number, LiveHandle>();
  let idSeq = 0;
  let liveSeq = 0;
  let scanning = false;
  /** `host:cổng` đã khai bằng `realRuntime` (tên máy chữ thường). */
  const realAddrs = new Set<string>();
  const addrKey = (host: string, port: number) => `${host.toLowerCase()}:${port}`;

  /** Cờ lỗi của lần nạp xuống kế tiếp (một lần). */
  let failPlan: { step: string; code: string } | null = null;
  let loseOnce = false;
  let buildFailure: DeviceError | null = null;
  let extractMode: 'empty' | 'not-empty' | 'cancel' = 'empty';
  /** Gói tạm (tối đa 4), theo thứ tự tạo. */
  const packages = new Map<string, { info: PackageInfo; files: Record<string, string> }>();

  const control: MockDeviceControl = {
    scanMs: 2500,
    deployStepMs: 150,
    calls: [],
    failDeploy(step, code) {
      failPlan = step ? { step, code: code ?? defaultFailCode(step) } : null;
    },
    setBusy(name, by) {
      byName(name).busy = by ? { ...by } : null;
    },
    changeBase(name) {
      const f = byName(name);
      const cur = f.store.versions.find((v) => v.seq === f.store.active);
      if (!cur) return;
      const files = { ...cur.files, 'tags.json': `${cur.files['tags.json'] ?? ''}\n` };
      commit(f, files, { user: 'kysu2', from: '192.168.1.77', source: 'studio' });
    },
    loseDeploy(on) {
      loseOnce = on;
    },
    failBuild(error) {
      buildFailure = error;
    },
    editStored(name, rel, content) {
      const f = byName(name);
      const cur = f.store.versions.find((v) => v.seq === f.store.active);
      if (!cur) throw new Error(`mock-device: ${name} has no project`);
      const v = versionOf(
        cur.seq,
        { ...cur.files, [rel]: content },
        { user: cur.deployedBy, from: cur.deployedFrom, source: cur.source },
      );
      v.activatedAt = cur.activatedAt;
      f.store.versions = f.store.versions.map((x) => (x.seq === cur.seq ? v : x));
      if (f.project) f.project = { ...f.project, digest: v.digest };
    },
    setExtractFolder(mode) {
      extractMode = mode;
    },
    setDiagnostics(name, patch) {
      const f = byName(name);
      const { fail, ...rest } = patch;
      f.diag = { ...f.diag, ...rest, ...(fail === undefined ? {} : { fail }) };
    },
    addAudit(name, rows) {
      const f = byName(name);
      for (const r of rows) appendAudit(f, r);
    },
    setAuditError(name, code) {
      byName(name).auditError = code;
    },
    setFreeBytes(name, bytes) {
      byName(name).freeBytes = bytes;
    },
    setClients(name, count) {
      byName(name).extraClients = Math.max(0, Math.floor(count));
    },
    setPassword(user, password) {
      for (const f of fakes) {
        const a = f.accounts.get(user);
        if (a) a.password = password;
      }
    },
    device: (name) => {
      const f = byName(name);
      return {
        name: f.name,
        deviceId: f.deviceId,
        ip: f.ip,
        mac: f.mac,
        httpsPort: f.httpsPort,
        httpPort: f.httpPort,
        runtime: f.runtime,
        fingerprint: f.fingerprint ?? '',
      };
    },
    rotateCert(name) {
      const f = byName(name);
      f.certGen++;
      f.fingerprint = rotateHex(f.fingerprint ?? '0'.repeat(64), f.certGen);
      return f.fingerprint;
    },
    setHttpPort(name, port) {
      byName(name).httpPort = port;
    },
    realRuntime(address) {
      const t = monitorTarget(address);
      if (!t) throw new Error('bad-address');
      realAddrs.add(addrKey(t[0], t[1]));
    },
    expireSession: (name) => markTokens(name, 'expired'),
    invalidateSession: (name) => markTokens(name, 'invalid'),
    setSetupRequired(name, on) {
      byName(name).setupRequired = on;
    },
    dropLive(name) {
      for (const l of [...byName(name).lives]) l.stop(1006, '');
    },
    setRuntime(name, version) {
      const f = byName(name);
      f.runtime = version;
      f.protocol = compareSemver(version, '0.5.0') >= 0 ? '1.2.0' : '1.1.0';
    },
    setViewerAccess(name, access) {
      m6.stateOf(byName(name)).viewerAccess = access;
    },
    setWarnings(name, list) {
      byName(name).warnings011 = list.map((w) => ({
        code: w.code,
        message: w.message ?? '',
        detail: w.detail ?? null,
      }));
    },
    setAcceptedHosts(name, hosts) {
      byName(name).acceptedHosts = hosts;
    },
    setViewerBlock(name, block) {
      m6.stateOf(byName(name)).viewerBlock = block;
    },
    setTag(name, id, sample) {
      const s = m6.stateOf(byName(name));
      if (sample) s.overrides.set(id, sample);
      else s.overrides.delete(id);
    },
    endSession(name) {
      const f = byName(name);
      for (const l of [...f.lives]) if (l.viaSession) l.stop(4401, 'SESSION_ENDED');
      markTokens(name, 'expired');
    },
    setWriteBehavior(name, behavior) {
      m6.stateOf(byName(name)).behavior = behavior;
    },
    setWriteRate(name, perMin) {
      m6.stateOf(byName(name)).writeRatePerMin = perMin;
    },
    loseNextWriteReply(name) {
      m6.stateOf(byName(name)).dropNextWriteReply = true;
    },
    writeLog: (name) => m6.stateOf(byName(name)).log.map((x) => ({ ...x })),
    setProbeError(name, code) {
      m6.stateOf(byName(name)).probeError = code;
    },
    setProbe(name, fn) {
      m6.stateOf(byName(name)).probeFn = fn;
    },
    probeLog: (name) => m6.stateOf(byName(name)).probes.map((x) => ({ ...x })),
    setDriverDiagnostics(name, patch) {
      const s = m6.stateOf(byName(name));
      if (patch.channels !== undefined) s.diagChannels = patch.channels;
      if (patch.badTags !== undefined) s.diagBadTags = patch.badTags;
      if (patch.fail !== undefined) s.diagFail = patch.fail;
    },
    injectDriverFault(name, deviceId, patch) {
      m6.injectDiag(byName(name), deviceId, patch, Date.now());
    },
    setLogic(name, config) {
      mlogic.configure(byName(name), config);
    },
    logicAudit: (name) => mlogic.auditOf(byName(name)),
    setActiveOverride(name, override) {
      m6.stateOf(byName(name)).activeOverride = override;
    },
    saved: () => known.map((k) => ({ ...k, pin: k.pin ? { ...k.pin } : null })),
    addSaved(input) {
      const r = add(input);
      if ('error' in r) throw new Error(r.error);
      return r;
    },
  };

  function byName(name: string): FakeDev {
    const f = fakes.find((x) => x.name === name);
    if (!f) throw new Error(`mock-device: no fake device ${name}`);
    return f;
  }

  /** Thêm một bản ghi vào audit của `f`: id kế tiếp, giờ lớn hơn bản ghi cuối (thứ tự theo id). */
  function appendAudit(f: FakeDev, input: MockAuditInput): void {
    const last = f.audit[f.audit.length - 1];
    f.audit.push({
      id: (last?.id ?? 0) + 1,
      ts: Math.max(Date.now(), (last?.ts ?? 0) + 1),
      clockOk: true,
      user: null,
      role: null,
      source: '192.168.1.20:51234',
      channel: 'https',
      target: null,
      code: null,
      detail: null,
      count: 1,
      ...input,
    });
  }

  const hooks006: m6.Hooks006 = {
    audit: (f, row) => appendAudit(f as unknown as FakeDev, row),
  };

  function markTokens(name: string, state: Token['device']): void {
    const f = byName(name);
    for (const k of known) {
      const t = tokens.get(k.id);
      if (t && fakeFor(k) === f) t.device = state;
    }
  }

  const record = (cmd: string, args: Record<string, unknown> = {}) =>
    control.calls.push({ cmd, args });

  const nextId = () => `00000000-0000-4000-8000-${String(++idSeq).padStart(12, '0')}`;

  /** Thiết bị giả ở `host` (IP hoặc tên); cổng không khớp thì coi như không có gì nghe. */
  const fakeAt = (host: string): FakeDev | undefined =>
    fakes.find((f) => f.ip === host || f.name.toLowerCase() === host.toLowerCase());

  const fakeFor = (k: KnownDevice): FakeDev | undefined => fakeAt(k.host);

  const findKnown = (id: string): KnownDevice | undefined => known.find((k) => k.id === id);

  const copy = (k: KnownDevice): KnownDevice => ({ ...k, pin: k.pin ? { ...k.pin } : null });

  const validPort = (p: unknown): boolean =>
    p === undefined || (typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 65535);

  /** Như `Registry::add` của Rust: trùng `host:httpsPort` trả mục cũ; tên mặc định là `host`. */
  function add(input: AddDeviceInput): KnownDevice | DeviceError {
    const host = input.host.trim();
    if (!HOST.test(host) || !validPort(input.httpsPort) || !validPort(input.httpPort))
      return { error: 'bad-address' };
    const httpsPort = input.httpsPort ?? 8443;
    const same = known.find(
      (k) => k.host.toLowerCase() === host.toLowerCase() && k.httpsPort === httpsPort,
    );
    if (same) return copy(same);
    if (known.length >= 64) return { error: 'too-many' };
    const k: KnownDevice = {
      id: nextId(),
      name: (input.name ?? host).slice(0, 64),
      host,
      httpsPort,
      httpPort: input.httpPort ?? 8080,
      deviceId: input.fromDiscovery?.deviceId ?? null,
      mac: input.fromDiscovery?.mac ?? null,
      pin: null,
      lastUser: null,
      lastSeenAt: null,
      lastRuntime: null,
    };
    known.push(k);
    return copy(k);
  }

  /**
   * Như `apply_identity` của Rust (T085a): định danh đọc qua kết nối đã ghim cập nhật `deviceId`,
   * `lastRuntime`; tên mặc định (bằng `host`) thành tên thiết bị báo, tên người dùng đặt thì giữ.
   */
  function applyIdentity(k: KnownDevice, f: FakeDev): void {
    k.deviceId = f.deviceId;
    k.lastRuntime = f.runtime;
    if (k.name === k.host) k.name = f.name;
  }

  /**
   * Như `adopt_old_http_port` của Rust (T085b): cổng HTTPS đã lưu trả lời HTTP thường; system/info báo runtime < 0.4.0
   * thì cổng đó thành `httpPort`.
   */
  function adoptHttpPort(k: KnownDevice, body: unknown): void {
    const v = (body as { runtimeVersion?: unknown } | null)?.runtimeVersion;
    if (runtimeBeforeOnline(v)) k.httpPort = k.httpsPort;
  }

  /**
   * Như `parse_monitor_address` của Rust: `host`, `host:cổng`, `http://host:cổng[/]`, cổng mặc định 8080; scheme
   * khác (`https://`, `wss://`…) hoặc địa chỉ sai → `null` (lỗi `bad-address`).
   */
  function monitorTarget(address: string): [string, number] | null {
    let s = address.trim();
    const m = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
    if (m) {
      if (m[1].toLowerCase() !== 'http') return null;
      s = s.slice(m[0].length);
    }
    s = s.replace(/\/$/, '');
    const hp = /^([^:/]+)(?::(\d{1,5}))?$/.exec(s);
    const port = hp?.[2] ? Number(hp[2]) : 8080;
    if (!hp || !HOST.test(hp[1]) || port < 1 || port > 65535) return null;
    return [hp[1], port];
  }

  const is05 = (f: FakeDev): boolean => compareSemver(f.runtime, '0.5.0') >= 0;

  function identity(f: FakeDev): DeviceIdentity {
    return {
      deviceId: f.deviceId,
      name: f.name,
      model: f.model,
      runtimeVersion: f.runtime,
      apiVersion: is05(f) ? '1.1.0' : '1.0.0',
      protocolVersion: f.protocol,
      httpPort: f.httpPort,
      httpsPort: f.httpsPort,
      fingerprint: f.fingerprint ?? '',
      setupRequired: f.setupRequired || f.accounts.size === 0,
      features: is05(f) ? [...FEATURES, 'tag-write', 'drivers', 'serial-ports'] : FEATURES,
      ...(f.acceptedHosts ? { acceptedHosts: f.acceptedHosts } : {}),
    };
  }

  /** Thiết bị đã ghim, TLS khớp, có phiên còn hạn (như Rust trước khi gửi yêu cầu có token). */
  function logicAuth(id: string): { f: FakeDev; t: Token } | DeviceError {
    const k = findKnown(id);
    if (!k) return { error: 'no-such-device' };
    const f = tls(k, fakeFor(k));
    if ('error' in f) return f;
    const t = tokens.get(id);
    if (!t) return { error: 'auth-required' };
    if (t.device !== 'ok') {
      tokens.delete(id);
      return { error: t.device === 'expired' ? 'session-expired' : 'session-invalid' };
    }
    return { f, t };
  }

  /** `warnings` (mã) và `warningDetails` (feature 011) của `system/info`; vắng khi không có cảnh báo. */
  function warningsBlock(f: FakeDev): Record<string, unknown> {
    const list = [
      ...(is05(f) && m6.stateOf(f).viewerAccess === 'any'
        ? [{ code: 'VIEWER_PUBLIC', message: '', detail: null }]
        : []),
      ...f.warnings011,
    ];
    if (list.length === 0) return {};
    return {
      warnings: list.map((w) => w.code),
      ...(f.warnings011.length > 0
        ? {
            warningDetails: list.map((w) => ({
              code: w.code,
              message: w.message,
              since: 1,
              detail: w.detail,
            })),
          }
        : {}),
    };
  }

  function systemInfo(f: FakeDev): Record<string, unknown> {
    const modern = f.httpsPort !== 0;
    const project = f.project
      ? {
          status: 'active',
          projectId: f.project.id,
          projectVersion: f.project.version,
          projectName: f.project.name,
          ...(modern ? { digest: f.project.digest } : {}),
          errors: [],
        }
      : { status: 'missing' };
    return {
      runtimeVersion: f.runtime,
      protocolVersion: f.protocol,
      schemaVersions: is05(f) ? ['0.1', '0.2'] : ['0.1'],
      clients: f.lives.size + f.extraClients,
      maxClients: 10,
      uptimeS: f.uptimeS,
      project,
      historian: { enabled: false },
      ...(modern
        ? {
            device: {
              deviceId: f.deviceId,
              name: f.name,
              model: f.model,
              apiVersion: is05(f) ? '1.1.0' : '1.0.0',
              httpsPort: f.httpsPort,
              https: 'ok',
              discovery: true,
              ...(is05(f) ? { viewerAccess: m6.stateOf(f).viewerAccess } : {}),
            },
            ...(compareSemver(f.runtime, '1.0.0') >= 0 ? { logic: mlogic.systemInfoBlock(f) } : {}),
            ...warningsBlock(f),
            operation:
              f.op && f.op.result === 'running'
                ? {
                    kind: f.op.kind,
                    step: f.op.steps.find((s) => s.state === 'running')?.id ?? 'receive',
                    since: f.op.startedAt,
                  }
                : null,
          }
        : {}),
    };
  }

  function sessionInfo(f: FakeDev, t: Token): SessionInfo {
    return {
      user: t.user,
      role: t.role,
      idleTimeoutS: 1800,
      maxLifetimeS: 43200,
      identity: identity(f),
    };
  }

  /** Kiểm như Rust: chưa ghim thì không kết nối; cổng có nghe HTTPS không; ghim có khớp không. */
  function tls(k: KnownDevice, f: FakeDev | undefined): DeviceError | FakeDev {
    if (!k.pin) return { error: 'cert-unpinned' };
    if (!f || !f.fingerprint || f.httpsPort !== k.httpsPort) return { error: 'unreachable' };
    if (k.pin.fingerprint !== f.fingerprint)
      return { error: 'cert-mismatch', detail: { pinned: k.pin.fingerprint, seen: f.fingerprint } };
    return f;
  }

  const remainingS = (until: number) => Math.ceil((until - Date.now()) / 1000);

  function fail(entry: Fail): void {
    entry.failures++;
    if (entry.failures >= MAX_FAILURES) {
      entry.lockedUntil = Date.now() + LOCK_MS;
      entry.failures = 0;
    }
  }

  /** Như `transfer_target` của Rust: thiết bị, ghim, phiên (không có phiên: `session-expired`), role. */
  function authorize(
    id: string,
    need: Role,
  ): { k: KnownDevice; f: FakeDev; t: Token } | DeviceError {
    const k = findKnown(id);
    if (!k) return { error: 'no-such-device' };
    const f = tls(k, fakeFor(k));
    if ('error' in f) return f;
    const t = tokens.get(id);
    if (!t) return { error: 'session-expired' };
    if (t.device !== 'ok') {
      tokens.delete(id);
      return { error: t.device === 'expired' ? 'session-expired' : 'session-invalid' };
    }
    if (RANK[t.role] < RANK[need]) return { error: 'forbidden' };
    return { k, f, t };
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  /** Kiểm trước khi nhận yêu cầu (device-api §4): bận, rồi base đã đổi. */
  function refusal(f: FakeDev, kind: 'deploy' | 'restore', base: string): DeviceError | null {
    const running = f.op && f.op.result === 'running' ? f.op : null;
    if (running || f.busy) {
      return {
        error: 'busy',
        detail: running
          ? {
              opId: running.opId,
              kind: running.kind,
              user: running.user,
              source: running.source,
              since: running.startedAt,
            }
          : {
              opId: nextId(),
              kind,
              user: f.busy?.user,
              source: f.busy?.source,
              since: new Date(Date.now() - 20_000).toISOString(),
            },
      };
    }
    if (base !== baseOf(f)) return { error: 'base-changed' };
    return null;
  }

  /**
   * Chạy các bước của một thao tác như thiết bị thật, báo từng lần đổi trạng thái. `apply` đưa bản mới vào kho
   * khi tới `activate` xong. Cờ `failDeploy` làm bước tương ứng lỗi (`health` → rollback).
   */
  async function execute(
    f: FakeDev,
    op: DeployOperation,
    onEvent: (e: DeployEvent) => void,
    apply: () => void,
  ): Promise<DeployOperation | DeviceError> {
    const emit = () => onEvent({ kind: 'operation', op: clone(op) });
    const plan = failPlan;
    failPlan = null;
    const fixedSteps = new Set<string>(STEP_IDS);
    // Trạng thái trước khi kích hoạt, để rollback quay về.
    const before = { store: clone(f.store), project: f.project ? { ...f.project } : null };
    const mark = (s: DeployStep, state: DeployStep['state']) => {
      s.state = state;
      if (state === 'running') s.startedAt = new Date().toISOString();
      else s.endedAt = new Date().toISOString();
    };
    emit();
    for (const s of op.steps) {
      if (!fixedSteps.has(s.id) || s.state === 'skipped') continue;
      mark(s, 'running');
      emit();
      await sleep(control.deployStepMs);
      if (plan?.step === s.id) {
        mark(s, 'failed');
        s.code = plan.code;
        s.message = `simulated failure at step ${s.id}`;
        op.error = { code: plan.code, message: s.message };
        if (s.id === 'validate') {
          op.error.issues = [
            {
              code: 'E_TAG_RANGE',
              file: 'tags.json',
              path: '/tags/3',
              message: 'min must be less than max',
            },
          ];
          s.issues = op.error.issues;
        }
        if (s.id === 'health') {
          const rollback: DeployStep = { id: 'rollback', state: 'running' };
          rollback.startedAt = new Date().toISOString();
          op.steps.push(rollback);
          emit();
          await sleep(control.deployStepMs);
          mark(rollback, 'ok');
          f.store = before.store;
          f.project = before.project;
          op.result = 'rolled-back';
        } else op.result = 'failed';
        op.endedAt = new Date().toISOString();
        emit();
        return op;
      }
      mark(s, 'ok');
      if (s.id === 'activate') {
        apply();
        if (loseOnce) {
          // Thiết bị chạy lại và xong việc, nhưng Studio không theo dõi được nữa.
          for (const rest of op.steps) if (rest.state === 'pending') mark(rest, 'ok');
          op.result = 'committed';
          op.endedAt = new Date().toISOString();
          op.clientsNotified = f.lives.size + f.extraClients;
          onEvent({ kind: 'restarting' });
          return { error: 'lost' };
        }
        emit();
        onEvent({ kind: 'restarting' });
      } else emit();
    }
    op.result = 'committed';
    op.endedAt = new Date().toISOString();
    op.clientsNotified = f.lives.size + f.extraClients;
    emit();
    return op;
  }

  function newOperation(
    f: FakeDev,
    t: Token,
    kind: 'deploy' | 'restore',
    to: DeployOperation['to'],
  ): DeployOperation {
    const from = f.store.versions.find((v) => v.seq === f.store.active);
    const steps: DeployStep[] = STEP_IDS.map((id) => ({
      id,
      state:
        kind === 'restore' && (id === 'receive' || id === 'verify-package') ? 'skipped' : 'pending',
    }));
    const op: DeployOperation = {
      opId: nextId(),
      kind,
      user: t.user,
      role: t.role,
      source: OWN_ADDRESS,
      startedAt: new Date().toISOString(),
      endedAt: null,
      clockOk: true,
      from: from
        ? { seq: from.seq, digest: from.digest, projectVersion: from.projectVersion }
        : null,
      to,
      steps,
      result: 'running',
      error: null,
      clientsNotified: 0,
    };
    f.op = op;
    return op;
  }

  /** Lọc nguồn của trang xem (ADR-018) khi theo dõi theo địa chỉ: mã lý do của Rust, hoặc `null` khi cho xem. */
  function viewerBlocked(f: FakeDev): 'viewer-private' | 'viewer-off' | null {
    const s = m6.stateOf(f);
    if (s.viewerBlock) return s.viewerBlock;
    return s.viewerAccess === 'off' ? 'viewer-off' : null;
  }

  const liveIpc: LiveIpc = {
    async open(target: LiveTarget, onEvent: (e: LiveEvent) => void) {
      record('live_open', { target });
      const liveId = ++liveSeq;
      const refuse = (reason: string) => {
        setTimeout(() => onEvent({ kind: 'close', code: 1006, reason }), 10);
        lives.set(liveId, { receive: () => undefined, stop: () => undefined });
      };
      if ('id' in target) {
        const k = findKnown(target.id);
        if (!k) throw 'no-such-device';
        const f = tls(k, fakeFor(k));
        if ('error' in f) refuse(f.error);
        else lives.set(liveId, new FakeLive(f, onEvent, tokens.get(target.id)?.device === 'ok'));
      } else {
        const t = monitorTarget(target.address);
        // Như Rust: địa chỉ sai hoặc không phải HTTP (https://, wss://) → lỗi trả thẳng từ lệnh.
        if (!t) throw 'bad-address';
        const [host, port] = t;
        const f = fakeAt(host);
        if (!f) {
          if (realAddrs.has(addrKey(host, port)))
            lives.set(liveId, realLive(`${host}:${port}`, onEvent));
          else refuse('unreachable');
        } else if (port !== f.httpPort) refuse('unreachable');
        else if (viewerBlocked(f)) refuse(viewerBlocked(f)!);
        else lives.set(liveId, new FakeLive(f, onEvent));
      }
      return liveId;
    },
    async send(liveId, text) {
      lives.get(liveId)?.receive(text);
    },
    async close(liveId, code, reason) {
      record('live_close', { liveId, code, reason });
      lives.get(liveId)?.stop(code ?? 1000, reason ?? '');
      lives.delete(liveId);
    },
  };

  return {
    control,

    async netInterfaces() {
      record('net_interfaces');
      return IFACES.map((i) => ({ ...i }));
    },

    discover(ifaces, onFound): Promise<DiscoverSummary> {
      record('discover_run', { interfaces: ifaces });
      if (scanning) return Promise.reject({ error: 'busy' } satisfies DeviceError);
      scanning = true;
      const chosen = ifaces ?? IFACES.filter((i) => i.canBroadcast).map((i) => i.index);
      const failed = chosen
        .filter((i) => !IFACES[i]?.canBroadcast)
        .map((index) => ({ index, reason: 'send' }));
      const sent = chosen.filter((i) => IFACES[i]?.canBroadcast);
      const seen = new Set<string>();
      const started = Date.now();
      for (const f of fakes) {
        if (f.iface === null || !sent.includes(f.iface)) continue;
        for (const extra of [0, 600, 1200]) {
          const at = f.replyMs + extra;
          if (at >= control.scanMs) continue;
          setTimeout(() => {
            seen.add(f.deviceId);
            if (f.fingerprint) discovered.set(f.deviceId, f.fingerprint);
            const d: DiscoveredDevice = {
              iface: f.iface ?? 0,
              ip: f.ip,
              deviceId: f.deviceId,
              name: f.name,
              model: f.model,
              mac: f.mac,
              prefix: f.prefix,
              runtime: f.runtime,
              api: '1.0.0',
              status: f.status,
              project: f.project
                ? {
                    id: f.project.id,
                    name: f.project.name,
                    version: f.project.version,
                    digest: f.project.digest,
                  }
                : null,
              httpsPort: f.httpsPort,
              httpPort: f.httpPort,
              fingerprint: f.fingerprint,
              receivedAt: started + at,
            };
            onFound(d);
          }, at);
        }
      }
      return new Promise((resolve) =>
        setTimeout(() => {
          scanning = false;
          resolve({ scanned: sent.length, found: seen.size, failed });
        }, control.scanMs),
      );
    },

    async devices() {
      record('devices_list');
      return known.map(copy);
    },

    async addDevice(input: AddDeviceInput) {
      record('device_add', { ...input });
      return add(input);
    },

    async updateDevice(input: UpdateDeviceInput) {
      record('device_update', { ...input });
      const k = findKnown(input.id);
      if (!k) return { error: 'no-such-device' };
      if (
        (input.host !== undefined && !HOST.test(input.host)) ||
        !validPort(input.httpsPort) ||
        !validPort(input.httpPort)
      )
        return { error: 'bad-address' };
      // Như Rust: đổi host hoặc cổng HTTPS thì bỏ phiên và kết quả dò cũ; ghim giữ nguyên.
      if (
        (input.host !== undefined && input.host !== k.host) ||
        (input.httpsPort !== undefined && input.httpsPort !== k.httpsPort)
      ) {
        tokens.delete(k.id);
        lastProbe.delete(k.id);
      }
      // Như Rust (T085a): tên còn là tên mặc định thì theo `host` mới.
      const defaultName = k.name === k.host;
      Object.assign(k, {
        ...(input.name !== undefined ? { name: input.name.slice(0, 64) } : {}),
        ...(input.host !== undefined ? { host: input.host } : {}),
        ...(input.httpsPort !== undefined ? { httpsPort: input.httpsPort } : {}),
        ...(input.httpPort !== undefined ? { httpPort: input.httpPort } : {}),
      });
      if (input.name === undefined && defaultName) k.name = k.host;
      return copy(k);
    },

    async forgetDevice(id) {
      record('device_forget', { id });
      const i = known.findIndex((k) => k.id === id);
      if (i < 0) throw { error: 'no-such-device' } satisfies DeviceError;
      known.splice(i, 1);
      tokens.delete(id);
      lastProbe.delete(id);
    },

    async probe(id): Promise<ProbeResult | DeviceError> {
      record('device_probe', { id });
      const k = findKnown(id);
      if (!k) return { error: 'no-such-device' };
      const f = fakeFor(k);
      // Như Rust: lần dò lỗi xóa kết quả dò cũ.
      lastProbe.delete(id);
      if (!f) {
        // Runtime thật đã khai (runtime giả của e2e): trình duyệt không bắt tay TLS thô được, nên hỏi system/info bằng
        // HTTP; cổng trả lời HTTP thường thì như Rust là `not-tls` (T085b).
        if (!realAddrs.has(addrKey(k.host, k.httpsPort)))
          return later(150, { error: 'unreachable' });
        const plain = await realMonitorGet(`${k.host}:${k.httpsPort}`);
        if ('error' in plain) {
          if (plain.error === 'network') return { error: 'unreachable' };
          if (plain.error === 'timeout') return { error: 'timeout' };
          return { error: 'not-tls' };
        }
        adoptHttpPort(k, plain.body);
        return { error: 'not-tls' };
      }
      // Cổng HTTP thường của thiết bị giả ghi vào chỗ cổng HTTPS (T085b).
      if (k.httpsPort === f.httpPort && k.httpsPort !== f.httpsPort) {
        adoptHttpPort(k, systemInfo(f));
        return later(60, { error: 'not-tls' });
      }
      if (!f.fingerprint || f.httpsPort !== k.httpsPort)
        return later(150, { error: 'unreachable' });
      lastProbe.set(id, f.fingerprint);
      const pinned = k.pin?.fingerprint ?? null;
      return later(80, {
        fingerprint: f.fingerprint,
        pinned,
        state: pinned === null ? 'unpinned' : pinned === f.fingerprint ? 'match' : 'mismatch',
        discovered: discovered.get(f.deviceId) ?? null,
      });
    },

    async pin(id, fingerprint) {
      record('device_pin', { id, fingerprint });
      const k = findKnown(id);
      if (!k) return { error: 'no-such-device' };
      if (lastProbe.get(id) !== fingerprint) return { error: 'not-observed' };
      k.pin = { fingerprint, pinnedAt: new Date().toISOString() };
      const f = fakeFor(k);
      if (f) {
        k.deviceId = k.deviceId || f.deviceId;
        k.mac = k.mac || f.mac;
      }
      return copy(k);
    },

    async unpin(id, fingerprint) {
      record('device_unpin', { id, fingerprint });
      const k = findKnown(id);
      if (!k) return { error: 'no-such-device' };
      if (k.pin?.fingerprint !== fingerprint) return { error: 'pin-mismatch' };
      k.pin = null;
      tokens.delete(id);
      return copy(k);
    },

    async login(id, user, typed) {
      // Không ghi mật khẩu vào nhật ký lệnh.
      record('device_login', { id, user });
      // Như bản Tauri: mật khẩu tới thiết bị ở dạng dựng sẵn (NFC, ADR-011); thiết bị so đúng byte.
      const password = loginPassword(typed);
      const k = findKnown(id);
      if (!k) return { error: 'no-such-device' };
      const f = tls(k, fakeFor(k));
      if ('error' in f) return f;
      if (f.setupRequired || f.accounts.size === 0) return { error: 'setup-required' };
      // Như Rust: tên > 64 byte hay mật khẩu > 512 byte bị từ chối tại chỗ, không gửi đi (không tính lần sai).
      const bytes = (x: string) => new TextEncoder().encode(x).length;
      if (bytes(user) > 64 || bytes(password) > 512) return { error: 'auth-failed' };
      const uf = f.userFail.get(user) ?? { failures: 0, lockedUntil: 0 };
      f.userFail.set(user, uf);
      const lockedUntil = Math.max(uf.lockedUntil, f.srcFail.lockedUntil);
      if (lockedUntil > Date.now())
        return later(60, { error: 'locked', detail: remainingS(lockedUntil) });
      const account = f.accounts.get(user);
      if (!account || account.password === null || account.password !== password) {
        fail(uf);
        fail(f.srcFail);
        return later(60, { error: 'auth-failed' });
      }
      uf.failures = 0;
      f.srcFail.failures = 0;
      const t: Token = { user, role: account.role, device: 'ok' };
      tokens.set(id, t);
      k.lastUser = user;
      k.lastSeenAt = new Date().toISOString();
      applyIdentity(k, f);
      appendAudit(f, { action: 'auth.login', result: 'ok', user, role: account.role });
      return later(120, sessionInfo(f, t));
    },

    async logout(id) {
      record('device_logout', { id });
      tokens.delete(id);
    },

    async session(id) {
      record('device_session', { id });
      const k = findKnown(id);
      const t = tokens.get(id);
      const f = k ? fakeFor(k) : undefined;
      if (!k || !t || !f) return null;
      // Như Rust: hỏi thiết bị (GET /auth/session); 401 thì bỏ token, trả null.
      if (t.device !== 'ok') {
        tokens.delete(id);
        return null;
      }
      return sessionInfo(f, t);
    },

    async get(id, path, query) {
      record('device_get', { id, path, ...(query ? { query } : {}) });
      if (!ALLOWED.some((re) => re.test(path))) return { error: 'bad-path' };
      const k = findKnown(id);
      if (!k) return { error: 'no-such-device' };
      const f = tls(k, fakeFor(k));
      if ('error' in f) return f;
      if (path === '/api/v1/system/info') return { status: 200, body: systemInfo(f) };
      if (path === '/api/v1/device/identity') {
        applyIdentity(k, f);
        return { status: 200, body: identity(f) };
      }
      // Trang xem công khai (lọc nguồn): không cần phiên (006).
      if (path === '/api/v1/projects/active' && is05(f)) return m6.activeProject(f);
      const t = tokens.get(id);
      if (!t) return { error: 'auth-required' };
      if (t.device !== 'ok') {
        tokens.delete(id);
        return { error: t.device === 'expired' ? 'session-expired' : 'session-invalid' };
      }
      const need: Role = path.startsWith('/api/v1/audit')
        ? 'administrator'
        : path.startsWith('/api/v1/project/') || path === '/api/v1/serial/ports'
          ? 'engineer'
          : path.startsWith('/api/v1/tags/write')
            ? 'operator'
            : 'viewer';
      if (RANK[t.role] < RANK[need]) return { error: 'forbidden' };
      if (path === '/api/v1/projects/active') return { error: 'http', detail: 404 };
      if (is05(f)) {
        if (path.startsWith('/api/v1/tags/write'))
          return m6.getWrite(f, hooks006, { user: t.user, role: t.role }, path, query, Date.now());
        if (path === '/api/v1/drivers/diagnostics') return m6.driverDiagnostics(f, Date.now());
        if (path === '/api/v1/serial/ports') return m6.serialPorts(query?.probe === '1');
      }
      if (path === '/api/v1/auth/session')
        return {
          status: 200,
          body: { user: t.user, role: t.role, idleRemainingS: 1790, lifetimeRemainingS: 40100 },
        };
      if (path === '/api/v1/diagnostics') {
        if (f.diag.fail) return { error: f.diag.fail };
        const sessions = [...tokens.entries()].filter(([tid, tok]) => {
          const tk = findKnown(tid);
          return tk !== undefined && fakeFor(tk) === f && tok.device === 'ok';
        }).length;
        return {
          status: 200,
          body: {
            at: Date.now() + f.diag.skewMs,
            timeSynced: f.diag.timeSynced,
            cpu: { ...f.diag.cpu },
            memory: { ...f.diag.memory },
            disk: {
              path: '/var/lib/mat-runtime',
              totalBytes: 7_301_234_688,
              freeBytes: f.freeBytes,
            },
            uptime: { systemS: f.uptimeS, runtimeS: 3600 },
            clients: { live: f.lives.size + f.extraClients, max: 10, sessions },
            discovery: {
              enabled: true,
              replies: 42,
              dropped: { subnet: 0, format: 3, rate: 0, port: 0 },
            },
            versions: { runtime: f.runtime, protocol: f.protocol, api: '1.0.0' },
            ...(is05(f)
              ? {
                  viewer: f.diag.viewer ?? {
                    access: m6.stateOf(f).viewerAccess,
                    blockedTotal: 0,
                    lastBlockedAt: null,
                  },
                  tags: f.diag.tags ?? { total: 0, good: 0, uncertain: 0, bad: 0 },
                  retain: f.diag.retain ?? { state: 'off', tags: 0, lastSaveAt: null, saves: 0 },
                }
              : {}),
          },
        };
      }
      if (path === '/api/v1/audit') {
        if (f.auditError) return { error: f.auditError };
        const num = (v: string | undefined): number | null | undefined =>
          v === undefined ? undefined : /^\d{1,15}$/.test(v) ? Number(v) : null;
        const known = ['from', 'to', 'user', 'action', 'before', 'limit', 'target'];
        const q = query ?? {};
        const from = num(q.from);
        const to = num(q.to);
        const before = num(q.before);
        const limit = q.limit === undefined ? 100 : num(q.limit);
        if (
          Object.keys(q).some((k) => !known.includes(k)) ||
          from === null ||
          to === null ||
          before === null ||
          before === 0 ||
          limit === null ||
          limit === undefined ||
          limit < 1 ||
          limit > 200 ||
          (q.user !== undefined && (q.user === '' || q.user.length > 64)) ||
          (q.action !== undefined && !/^[a-z0-9.-]{1,64}$/.test(q.action))
        )
          return { error: 'http', detail: 400 };
        const found = [...f.audit]
          .reverse()
          .filter(
            (r) =>
              (from === undefined || r.ts >= from) &&
              (to === undefined || r.ts < to) &&
              (q.user === undefined || r.user === q.user) &&
              (q.action === undefined || r.action.startsWith(q.action)) &&
              (q.target === undefined || r.target === q.target) &&
              (before === undefined || r.id < before),
          );
        const records = found.slice(0, limit).map((r) => clone(r));
        const next = found.length > limit ? records[records.length - 1].id : null;
        // Như thiết bị: ghi audit.read sau khi đọc, nên trang trả về không chứa bản ghi của chính lần gọi.
        appendAudit(f, {
          action: 'audit.read',
          result: 'ok',
          user: t.user,
          role: t.role,
          target: '/api/v1/audit',
          ...(Object.keys(q).length ? { detail: { ...q } } : {}),
        });
        return { status: 200, body: { records, next } };
      }
      if (path === '/api/v1/project/versions')
        return {
          status: 200,
          body: {
            active: f.store.active,
            backupsMax: BACKUPS_MAX,
            versions: [...f.store.versions]
              .sort((a, b) => b.seq - a.seq)
              .map((v) => ({
                seq: v.seq,
                state: v.seq === f.store.active ? 'active' : 'backup',
                digest: v.digest,
                projectId: v.projectId,
                projectName: v.projectName,
                projectVersion: v.projectVersion,
                minRuntimeVersion: v.minRuntimeVersion,
                size: v.size,
                activatedAt: v.activatedAt,
                clockOk: v.clockOk,
                deployedBy: v.deployedBy,
                deployedFrom: v.deployedFrom,
                source: v.source,
                ...(v.seq === f.store.active ? {} : { restorable: true }),
              })),
          },
        };
      if (path === '/api/v1/project/manifest') {
        const want = query?.seq === undefined ? f.store.active : Number(query.seq);
        const v = f.store.versions.find((x) => x.seq === want);
        return v ? { status: 200, body: clone(v.manifest) } : { error: 'http', detail: 404 };
      }
      if (path === '/api/v1/project/operation')
        return { status: 200, body: f.op ? clone(f.op) : null };
      if (path.startsWith('/api/v1/project/deployments/'))
        return f.op && path.endsWith(f.op.opId)
          ? { status: 200, body: clone(f.op) }
          : { error: 'http', detail: 404 };
      // Audit: thuộc US4, thiết bị giả chưa có.
      return { error: 'http', detail: 404 };
    },

    async post(id, path, body) {
      record('device_post', { id, path, body });
      if (!ALLOWED_POST.includes(path)) return { error: 'bad-path' };
      if (JSON.stringify(body).length > 16 * 1024) return { error: 'too-large' };
      const k = findKnown(id);
      if (!k) return { error: 'no-such-device' };
      const f = tls(k, fakeFor(k));
      if ('error' in f) return f;
      const t = tokens.get(id);
      if (!t) return { error: 'auth-required' };
      if (t.device !== 'ok') {
        tokens.delete(id);
        return { error: t.device === 'expired' ? 'session-expired' : 'session-invalid' };
      }
      if (!is05(f)) return { error: 'http', detail: 404 };
      const need: Role = path === '/api/v1/tags/write' ? 'operator' : 'engineer';
      if (RANK[t.role] < RANK[need]) {
        return path === '/api/v1/tags/write'
          ? {
              status: 403,
              body: {
                error: 'FORBIDDEN',
                results: (Array.isArray((body as { requests?: unknown[] }).requests)
                  ? (body as { requests: Array<{ requestId?: string }> }).requests
                  : []
                ).map((r) => ({ requestId: r.requestId, status: 'REJECTED', reason: 'FORBIDDEN' })),
              },
            }
          : { error: 'forbidden' };
      }
      if (path === '/api/v1/tags/write') {
        const reply = m6.postWrite(
          f,
          hooks006,
          { user: t.user, role: t.role },
          body,
          Date.now(),
          liveValue,
        );
        const s6 = m6.stateOf(f);
        if (s6.dropNextWriteReply) {
          s6.dropNextWriteReply = false;
          return { error: 'timeout' };
        }
        return reply;
      }
      const s = m6.stateOf(f);
      if (s.probeDelayMs) await sleep(s.probeDelayMs);
      appendAudit(f, {
        action: 'driver.test',
        result: 'ok',
        user: t.user,
        role: t.role,
        target: 'probe',
        code: 'OK',
      });
      return m6.postProbe(f, body);
    },

    // ---- Feature 011 (T145): logic (device-api-011 §4), cùng kiểm phiên như `device_get`/`device_post` ----
    async logicGet(id) {
      record('logic_get', { id });
      const a = logicAuth(id);
      if ('error' in a) return a;
      if (compareSemver(a.f.runtime, '1.0.0') < 0) return { error: 'http', detail: 404 };
      return mlogic.get(a.f);
    },
    async logicStopWrites(id) {
      record('logic_writes_stop', { id, body: { enabled: false } });
      const a = logicAuth(id);
      if ('error' in a) return a;
      if (compareSemver(a.f.runtime, '1.0.0') < 0) return { error: 'http', detail: 404 };
      const r = mlogic.stopWrites(a.f, a.t.role);
      if (!('error' in r))
        appendAudit(a.f, {
          action: 'logic.writes.disabled',
          result: 'ok',
          user: a.t.user,
          role: a.t.role,
          target: 'logic',
        });
      return r;
    },
    async logicReset(id, block, value) {
      record('logic_reset', { id, block, value });
      const a = logicAuth(id);
      if ('error' in a) return a;
      if (compareSemver(a.f.runtime, '1.0.0') < 0) return { error: 'http', detail: 404 };
      const r = mlogic.reset(a.f, a.t.role, block, value);
      if (!('error' in r))
        appendAudit(a.f, {
          action: 'logic.reset',
          result: 'ok',
          user: a.t.user,
          role: a.t.role,
          target: block,
        });
      return r;
    },

    async monitorGet(address) {
      record('monitor_get', { address });
      const t = monitorTarget(address);
      if (!t) return { error: 'bad-address' };
      const [host, port] = t;
      const f = fakeAt(host);
      if (!f)
        return realAddrs.has(addrKey(host, port))
          ? realMonitorGet(`${host}:${port}`)
          : later(100, { error: 'network', detail: 'mock' });
      if (port !== f.httpPort) return later(100, { error: 'network', detail: 'mock' });
      const blocked = viewerBlocked(f);
      if (blocked) return later(60, { error: blocked });
      return later(60, { status: 200, body: systemInfo(f) });
    },

    openLive: (target) => liveSocket(liveIpc, target),

    // ---------- US2: gói, nạp xuống, khôi phục, đọc lên (tauri-commands §8) ----------

    async buildPackage(list) {
      record('package_build', { files: list.map((f) => ({ ...f })) });
      if (buildFailure) {
        const e = buildFailure;
        buildFailure = null;
        return e;
      }
      const files: Record<string, string> = {};
      for (const f of list) {
        const r = await projectFiles.read(f.rel);
        if (!('text' in r) || r.hash !== f.hash) return { error: 'changed', detail: f.rel };
        files[f.rel] = r.text;
      }
      const manifest = manifestOf(files);
      if (!manifest) return { error: 'package', detail: 'E_PKG_IDENTITY' };
      const info: PackageInfo = {
        packageId: nextId(),
        origin: 'built',
        digest: manifest.digest,
        size: packageSize(files),
        manifest,
      };
      packages.set(info.packageId, { info, files });
      while (packages.size > MAX_PACKAGES) packages.delete(packages.keys().next().value as string);
      return clone(info);
    },

    async deploy(id, packageId, baseDigest, onEvent) {
      record('device_deploy', { id, packageId, baseDigest });
      const auth = authorize(id, 'engineer');
      if ('error' in auth) return auth;
      const { f, t } = auth;
      const pkg = packages.get(packageId);
      if (!pkg) return { error: 'no-such-package' };
      const refused = refusal(f, 'deploy', baseDigest);
      if (refused) return refused;
      const m = pkg.info.manifest;
      const op = newOperation(f, t, 'deploy', {
        digest: pkg.info.digest,
        projectId: m.project.projectId,
        projectVersion: m.project.projectVersion,
      });
      // Gửi gói: thiết bị đã bận từ lúc nhận request.
      const total = pkg.info.size;
      for (const part of [0.25, 0.5, 0.75, 1]) {
        await sleep(control.deployStepMs / 2);
        onEvent({ kind: 'send', sent: Math.round(total * part), total });
      }
      return execute(f, op, onEvent, () => {
        const v = commit(f, pkg.files, { user: t.user, from: OWN_ADDRESS, source: 'studio' });
        op.to.seq = v.seq;
      });
    },

    async restore(id, seq, baseDigest, onEvent) {
      record('device_restore', { id, seq, baseDigest });
      const auth = authorize(id, 'engineer');
      if ('error' in auth) return auth;
      const { f, t } = auth;
      const target = f.store.versions.find((v) => v.seq === seq);
      if (!target) return { error: 'no-such-version' };
      if (f.store.active === seq) return { error: 'already-active' };
      const refused = refusal(f, 'restore', baseDigest);
      if (refused) return refused;
      const op = newOperation(f, t, 'restore', {
        seq,
        digest: target.digest,
        projectId: target.projectId,
        projectVersion: target.projectVersion,
      });
      return execute(f, op, onEvent, () => {
        f.store.active = seq;
        target.activatedAt = new Date().toISOString();
        target.deployedBy = t.user;
        target.deployedFrom = OWN_ADDRESS;
        target.source = 'restore';
        f.project = {
          id: target.projectId,
          name: target.projectName,
          version: target.projectVersion,
          digest: target.digest,
        };
      });
    },

    async fetchPackage(id, seq) {
      record('device_fetch_package', { id, ...(seq === undefined ? {} : { seq }) });
      const auth = authorize(id, 'engineer');
      if ('error' in auth) return auth;
      const { f } = auth;
      if (!f.store.versions.length && seq === undefined) return { error: 'no-project-package' };
      const v = f.store.versions.find((x) => x.seq === (seq ?? f.store.active));
      if (!v) return { error: seq === undefined ? 'no-project-package' : 'no-such-version' };
      const info: PackageInfo = {
        packageId: nextId(),
        origin: 'fetched',
        deviceId: f.deviceId,
        ...(seq === undefined ? {} : { seq }),
        digest: v.digest,
        size: v.size,
        manifest: clone(v.manifest),
      };
      packages.set(info.packageId, { info, files: { ...v.files } });
      while (packages.size > MAX_PACKAGES) packages.delete(packages.keys().next().value as string);
      return clone(info);
    },

    async readPackageFile(packageId, rel): Promise<ReadOutcome> {
      record('package_read', { packageId, rel });
      if (!isSafeRelPath(rel) || !/\.(json|svg)$/.test(rel)) return { error: 'bad-path' };
      const text = packages.get(packageId)?.files[rel];
      return text === undefined ? { error: 'missing' } : { text, hash: sha256Sync(text) };
    },

    async discardPackage(packageId) {
      record('package_discard', { packageId });
      packages.delete(packageId);
    },

    async extractPackage(packageId) {
      record('package_extract', { packageId });
      const pkg = packages.get(packageId);
      if (!pkg) return { error: 'no-such-package' };
      if (extractMode === 'cancel') return null;
      if (extractMode === 'not-empty') return { error: 'not-empty' };
      // Thư mục rỗng giả: lớp platform giả nạp đúng các file của gói rồi coi đó là project đang mở.
      const from = fakes.find((f) => f.deviceId === pkg.info.deviceId)?.name ?? 'thiet-bi';
      const display = `D:\\Projects\\${pkg.info.manifest.project.projectId}-doc-len-${from}`;
      projectFiles.control.useProject(pkg.files, display);
      const picked = await projectFiles.pickProject();
      return picked ? { display: picked.display } : null;
    },
  };
}

/** Bản dùng cho e2e (alias của tauri-device.ts). */
export const deviceLink: MockDevice = createMockDevice();

// Gắn vào cùng đối tượng điều khiển của mock.ts (`window.__matMock`), không phụ thuộc thứ tự nạp module.
Object.assign(mockPlatform.control, { device: deviceLink.control });
