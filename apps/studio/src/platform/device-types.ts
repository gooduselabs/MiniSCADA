// Giao diện giữa Studio và lớp Rust nói chuyện với thiết bị (feature 005, contracts/tauri-commands.md §2–7,
// §9, research R6). Bản Tauri: tauri-device.ts (lệnh Rust, `Channel`). Bản giả cho e2e: mock-device.ts
// (alias Vite ở chế độ `e2e`, như mock.ts của 004).
//
// Giao diện chỉ gọi thiết bị theo `id` của thiết bị đã lưu; riêng chế độ theo dõi chỉ đọc (như 004) gọi theo
// địa chỉ. Token phiên không bao giờ quay lại giao diện; mật khẩu chỉ đi vào ở `login`.
import type { SocketLike } from '@mat/live-client';
import type { Issue, PackageFile } from '@mat/project-schema';
import { ipcError, type ReadOutcome } from './types.ts';

/** `net_interfaces`: một card mạng IPv4 của máy kỹ sư. */
export interface NetInterface {
  index: number;
  name: string;
  address: string;
  prefix: number;
  broadcast: string | null;
  /** `false` khi prefix ≥ 31 hoặc không có địa chỉ broadcast. */
  canBroadcast: boolean;
  /** Tên card có dạng VPN thường gặp: chỉ để hiện gợi ý "Thêm theo địa chỉ". */
  hint: 'vpn' | null;
}

/** Trạng thái thiết bị báo trong gói tìm. Mã lạ vẫn hiện thiết bị, ghi "không rõ" (discovery §5a). */
export type DeviceStatus = 'running' | 'no-project' | 'project-error' | 'activating';

export interface DiscoveredProject {
  id: string;
  /** Có thể bị bỏ khi gói trả lời thiếu chỗ (`truncated`). */
  name?: string | null;
  version: string;
  digest?: string | null;
}

/**
 * Một thiết bị trả lời gói tìm (data-model §1). Chỉ sống trong hộp thoại Thiết bị trong mạng. Khóa tùy chọn
 * của gói trả lời (`model`, `mac`, `api`, `prefix`, `http`, `fp`, `project`) có thể thiếu.
 */
export interface DiscoveredDevice {
  /** Card đã gửi gói hỏi. */
  iface: number;
  /** Địa chỉ nguồn UDP (không lấy trường `ip` của JSON). */
  ip: string;
  deviceId: string;
  name: string;
  model?: string | null;
  mac?: string | null;
  prefix?: number | null;
  runtime: string;
  api?: string | null;
  status: string;
  project: DiscoveredProject | null;
  /** `0`: thiết bị tắt HTTPS hoặc chứng chỉ lỗi. */
  httpsPort: number;
  httpPort?: number | null;
  /** Chỉ để tham khảo: không dùng để ghim (R6). */
  fingerprint: string | null;
  receivedAt: number;
}

export type DiscoverEvent = { kind: 'found'; device: DiscoveredDevice };

export interface DiscoverSummary {
  scanned: number;
  found: number;
  failed: Array<{ index: number; reason: 'bind' | 'send' | string }>;
}

export interface DevicePin {
  /** 64 hex chữ thường. */
  fingerprint: string;
  pinnedAt: string;
}

/** Thiết bị đã dùng (data-model §2, `devices.json` do Rust giữ). Không có mật khẩu, không có token. */
export interface KnownDevice {
  id: string;
  name: string;
  host: string;
  httpsPort: number;
  httpPort: number;
  deviceId?: string | null;
  mac?: string | null;
  pin: DevicePin | null;
  lastUser?: string | null;
  lastSeenAt?: string | null;
  lastRuntime?: string | null;
}

export interface AddDeviceInput {
  host: string;
  httpsPort?: number;
  httpPort?: number;
  name?: string;
  fromDiscovery?: { deviceId: string; mac: string | null; fingerprint: string | null };
}

export interface UpdateDeviceInput {
  id: string;
  name?: string;
  host?: string;
  httpsPort?: number;
  httpPort?: number;
}

/** `device_probe`: fingerprint thấy khi bắt tay TLS, so với ghim. */
export interface ProbeResult {
  fingerprint: string;
  pinned: string | null;
  state: 'unpinned' | 'match' | 'mismatch';
  /** Fingerprint của gói tìm gần nhất (chỉ tham khảo); khác `fingerprint` thì giao diện cảnh báo đỏ. */
  discovered: string | null;
}

export type Role = 'viewer' | 'operator' | 'engineer' | 'administrator';

/** `GET /api/v1/device/identity` (device-api §3). */
export interface DeviceIdentity {
  deviceId: string;
  name: string;
  model: string;
  runtimeVersion: string;
  apiVersion: string;
  protocolVersion: string;
  httpPort: number;
  httpsPort: number;
  fingerprint: string;
  setupRequired: boolean;
  features: string[];
}

/** `device_login`, `device_session`: không có trường token. */
export interface SessionInfo {
  user: string;
  role: Role;
  idleTimeoutS: number;
  maxLifetimeS: number;
  identity: DeviceIdentity;
}

/** `device_get`, `monitor_get`. */
export interface ApiResult {
  status: number;
  body: unknown;
}

/**
 * Lỗi của lệnh Rust: `error` là mã kebab-case (`auth-failed`, `cert-mismatch`, `locked`…), `detail` là dữ
 * liệu kèm (`{ locked: 287 }` → `detail: 287`; `{ "cert-mismatch": { pinned, seen } }` → `detail: { … }`).
 */
export interface DeviceError {
  error: string;
  detail?: unknown;
}

export type LiveTarget = { id: string } | { address: string };

// ---------- US2: gói, nạp xuống, khôi phục (contracts/tauri-commands.md §8; data-model §8, §10) ----------

/** Bốn trường của `project.json` mà manifest lặp lại (`E_PKG_IDENTITY`). */
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

/** Sự kiện của `device_deploy`, `device_restore` (qua `Channel`): `send` là tiến trình gửi gói của Studio. */
export type DeployEvent =
  | { kind: 'send'; sent: number; total: number }
  | { kind: 'operation'; op: DeployOperation }
  | { kind: 'restarting' };

/** Sự kiện của `live_open` (qua `Channel`, đúng thứ tự gửi). */
export type LiveEvent =
  | { kind: 'open' }
  | { kind: 'message'; data: string }
  | { kind: 'close'; code: number; reason: string };

/**
 * Giao diện DeviceLink (contract §9): US1 (thiết bị, ghim, đăng nhập, gọi API, dữ liệu sống) và US2 (gói, nạp
 * xuống, khôi phục, đọc lên; sau Mốc bảo mật, Constitution V). `extractPackage` (đọc lên thành project mới) thêm
 * khi làm US3.
 *
 * Phương thức trả `Promise<X>` (không có `| DeviceError`) thì lỗi làm promise bị từ chối với `DeviceError`.
 */
export interface DeviceLink {
  netInterfaces(): Promise<NetInterface[]>;
  /** Một lượt quét (~2,5 s); `found` đẩy dần qua `onFound`. Lỗi `busy` khi đang có lượt quét khác. */
  discover(
    ifaces: number[] | null,
    onFound: (d: DiscoveredDevice) => void,
  ): Promise<DiscoverSummary>;
  devices(): Promise<KnownDevice[]>;
  addDevice(input: AddDeviceInput): Promise<KnownDevice | DeviceError>;
  updateDevice(input: UpdateDeviceInput): Promise<KnownDevice | DeviceError>;
  forgetDevice(id: string): Promise<void>;
  probe(id: string): Promise<ProbeResult | DeviceError>;
  pin(id: string, fingerprint: string): Promise<KnownDevice | DeviceError>;
  unpin(id: string, fingerprint: string): Promise<KnownDevice | DeviceError>;
  /** Mật khẩu được chuẩn hóa NFC trước khi gửi (`loginPassword`, ADR-011). */
  login(id: string, user: string, password: string): Promise<SessionInfo | DeviceError>;
  /** Luôn xóa token phía Rust, kể cả khi thiết bị không trả lời. */
  logout(id: string): Promise<void>;
  /** `device_session` (contract §5; §9 chưa liệt kê): phiên Rust đang giữ cho thiết bị, hoặc `null`. */
  session(id: string): Promise<SessionInfo | null>;
  get(id: string, path: string, query?: Record<string, string>): Promise<ApiResult | DeviceError>;
  /** Chế độ theo dõi chỉ đọc: HTTP thường, chỉ `GET /api/v1/system/info`; `address` dạng `host:cổng`. */
  monitorGet(address: string): Promise<ApiResult | DeviceError>;
  /** Bọc `live_open`, `live_send`, `live_close` thành SocketLike cho `LiveConnection`. */
  openLive(target: LiveTarget): SocketLike;
  /**
   * `package_build`: đóng gói project đang mở từ file trên đĩa. `hash` là SHA-256 giao diện đã đọc; file khác
   * hash thì lỗi `changed` (`detail` = file).
   */
  buildPackage(files: { rel: string; hash: string }[]): Promise<PackageInfo | DeviceError>;
  /** `device_deploy`: gửi gói, theo dõi tới khi thao tác kết thúc. Trả `DeployOperation` cuối. */
  deploy(
    id: string,
    packageId: string,
    baseDigest: string,
    onEvent: (e: DeployEvent) => void,
  ): Promise<DeployOperation | DeviceError>;
  /** `device_restore`: khôi phục bản `seq` trong kho của thiết bị. */
  restore(
    id: string,
    seq: number,
    baseDigest: string,
    onEvent: (e: DeployEvent) => void,
  ): Promise<DeployOperation | DeviceError>;
  /** `device_fetch_package`: đọc lên (thiếu `seq` thì bản đang chạy), Rust đã kiểm gói. */
  fetchPackage(id: string, seq?: number): Promise<PackageInfo | DeviceError>;
  /** `package_read`: một file trong gói tạm, cùng định dạng với `project_read` của 004. */
  readPackageFile(packageId: string, rel: string): Promise<ReadOutcome>;
  /** `package_discard`: xóa gói tạm. */
  discardPackage(packageId: string): Promise<void>;
}

/**
 * Mật khẩu gửi `device_login` ở dạng Unicode dựng sẵn (NFC; ADR-011 "Mật khẩu có dấu", T085c). Hai bộ gõ có thể cho
 * cùng chữ "ă" dưới hai dạng byte: dựng sẵn (U+0103) và tổ hợp ("a" + U+0306). Thiết bị so đúng byte, không chuẩn
 * hóa; lệnh đặt mật khẩu trên thiết bị từ chối dấu tổ hợp, nên mật khẩu đã lưu luôn ở dạng dựng sẵn.
 */
export const loginPassword = (password: string): string => password.normalize('NFC');

export const isDeviceError = (x: unknown): x is DeviceError =>
  typeof x === 'object' &&
  x !== null &&
  typeof (x as { error?: unknown }).error === 'string' &&
  !('status' in x);

/**
 * Lỗi IPC → DeviceError. Dùng `ipcError` của 004 để lấy mã, nhưng giữ cả dữ liệu kèm không phải chuỗi
 * (`{ locked: 287 }`, `{ "cert-mismatch": { pinned, seen } }`, `{ http: 500 }`). Lỗi không nhận ra (lỗi JS,
 * IPC hỏng) thành `{ error: 'ipc', detail: <thông báo> }`.
 */
export function deviceError(e: unknown): DeviceError {
  if (isDeviceError(e)) return e;
  const err = ipcError(e);
  if (!err) return { error: 'ipc', detail: e instanceof Error ? e.message : String(e) };
  if (typeof e === 'string') return { error: err.code };
  const raw = (e as Record<string, unknown>)[err.code];
  return raw === undefined || raw === null ? { error: err.code } : { error: err.code, detail: raw };
}
