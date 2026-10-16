// Địa chỉ thiết bị (FR-027, Sprint 1 FR-034): chuẩn hóa, kiểm kết nối qua /api/v1/system/info, ghi nhớ
// cục bộ; so project trên thiết bị với project đang mở. Địa chỉ thiết bị không nằm trong project (cấu hình
// riêng của máy kỹ sư). Không chứa chuỗi giao diện: lý do là mã, giao diện đổi sang chữ qua i18n.

/** Lý do địa chỉ không dùng được: trống, scheme khác http/https, tên máy hay dạng sai, cổng sai. */
export type AddressError = 'empty' | 'scheme' | 'address' | 'port';
export type NormalizeResult = { ok: true; base: string } | { ok: false; error: AddressError };

const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

export function normalizeDevice(input: string): NormalizeResult {
  let s = input.trim();
  if (!s) return { ok: false, error: 'empty' };
  let scheme = 'http';
  const m = /^([a-z]+):\/\//i.exec(s);
  if (m) {
    scheme = m[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return { ok: false, error: 'scheme' };
    s = s.slice(m[0].length);
  }
  s = s.replace(/\/$/, '');
  const hp = /^([^:/]+)(?::(\d{1,5}))?$/.exec(s);
  if (!hp || !HOST.test(hp[1])) return { ok: false, error: 'address' };
  const port = hp[2] ? Number(hp[2]) : 8080;
  if (port < 1 || port > 65535) return { ok: false, error: 'port' };
  return { ok: true, base: `${scheme}://${hp[1]}:${port}` };
}

/** Lý do địa chỉ của chế độ theo dõi không dùng được: như `AddressError`, thêm `https` (feature 005, T085a). */
export type MonitorAddressError = AddressError | 'https';

/**
 * Địa chỉ của chế độ theo dõi chỉ đọc theo địa chỉ (trang Thiết bị của 004, thiết bị runtime cũ, FR-035): như
 * `normalizeDevice` nhưng chỉ HTTP. Gõ `https://` thì báo lỗi `https` ngay (chưa cần gõ xong): thiết bị có HTTPS
 * kết nối bằng Online (ghim chứng chỉ, đăng nhập); không tự bỏ scheme rồi gọi HTTP. Rust cũng từ chối
 * `https://` ở `monitor_get`, `live_open({ address })` (contract tauri-commands §12.7).
 */
export function normalizeMonitor(
  input: string,
): { ok: true; base: string } | { ok: false; error: MonitorAddressError } {
  if (/^\s*https:\/\//i.test(input)) return { ok: false, error: 'https' };
  return normalizeDevice(input);
}

export const liveUrl = (base: string) => base.replace(/^http/, 'ws') + '/api/v1/live';

/** Cổng HTTPS mặc định của thiết bị (feature 005, contract device-config §1). */
export const HTTPS_PORT = 8443;
/** Cổng HTTP mặc định của thiết bị: trang xem, theo dõi chỉ đọc (data-model §2). */
export const HTTP_PORT = 8080;

/**
 * Cổng nhập tay (Thêm theo địa chỉ › Nâng cao › Cổng HTTP, T085b): để trống thì `null` (cổng mặc định); chỉ chữ số,
 * 1–65535.
 */
export function parsePort(input: string): { ok: true; port: number | null } | { ok: false } {
  const s = input.trim();
  if (!s) return { ok: true, port: null };
  if (!/^\d{1,5}$/.test(s)) return { ok: false };
  const port = Number(s);
  return port >= 1 && port <= 65535 ? { ok: true, port } : { ok: false };
}

export type HttpsAddress =
  { ok: true; host: string; port: number; base: string } | { ok: false; error: AddressError };

/**
 * Địa chỉ HTTPS của thiết bị (Thêm theo địa chỉ, feature 005): IP hoặc tên máy theo luật của
 * `normalizeDevice`, cổng mặc định 8443. Nhận `https://`; `http://` thì báo `scheme` vì API kỹ thuật chỉ
 * phục vụ qua HTTPS (FR-007).
 */
export function normalizeHttps(input: string): HttpsAddress {
  let s = input.trim();
  if (!s) return { ok: false, error: 'empty' };
  const m = /^([a-z]+):\/\//i.exec(s);
  if (m) {
    if (m[1].toLowerCase() !== 'https') return { ok: false, error: 'scheme' };
    s = s.slice(m[0].length);
  }
  s = s.replace(/\/$/, '');
  const hp = /^([^:/]+)(?::(\d{1,5}))?$/.exec(s);
  if (!hp || !HOST.test(hp[1])) return { ok: false, error: 'address' };
  const port = hp[2] ? Number(hp[2]) : HTTPS_PORT;
  if (port < 1 || port > 65535) return { ok: false, error: 'port' };
  return { ok: true, host: hp[1], port, base: `https://${hp[1]}:${port}` };
}

/** Một đích của khối historian (specs/003-data-logging/contracts/system-info.md). */
export interface DestinationInfo {
  id: string;
  type?: string;
  state?: string;
  pendingRows?: number;
  lagS?: number;
  outOfRangeValues?: number;
  rejectedRows?: number;
  lastError?: {
    code?: string;
    dbCode?: string | null;
    message?: string;
    at?: number | null;
  } | null;
}

export interface HistorianInfo {
  enabled: boolean;
  state?: string;
  groups?: number;
  rowsWritten?: number;
  dbBytes?: number;
  dbMaxBytes?: number;
  warnings?: string[];
  lastError?: { code?: string; message?: string; at?: number | null } | null;
  destinations?: DestinationInfo[];
  /** Runtime 0.9.0 trở lên (feature 010, contracts/device-010.md §1): số dòng 24 giờ theo nhóm, truy vấn, tổng hợp, ghi đo thực. */
  groupsInfo?: Array<{
    id?: string;
    mode?: string;
    rows24h?: number | null;
    triggerState?: string | null;
    aggregates?: boolean;
  }>;
  query?: {
    enabled?: boolean;
    served?: number;
    rejectedBusy?: number;
    rejectedLimit?: number;
    timeouts?: number;
    errors?: number;
    p95Ms?: number | null;
  };
  aggregates?: {
    enabled?: boolean;
    groups?: number;
    rows?: { minute?: number | null; hour?: number | null } | null;
    backfill?: { active?: boolean; group?: string | null; progress?: number | null };
  };
  io?: {
    source?: string;
    bytesPerDay?: number | null;
    estimateBytesPerDay?: number | null;
    budgetBytesPerDay?: number | null;
    coverageS?: number | null;
  };
}

/** `GET /api/v1/system/info` (specs/002-vertical-slice/contracts/http-api.md, feature 003). */
export interface DeviceInfo {
  runtimeVersion?: string;
  protocolVersion?: string;
  clients?: number;
  maxClients?: number;
  /** Thời gian chạy của runtime (giây). */
  uptimeS?: number;
  project?: {
    status?: string;
    projectId?: string;
    projectVersion?: string;
    /** Runtime 0.4.0 trở lên (feature 005, device-api §2). */
    projectName?: string;
    digest?: string | null;
    errors?: unknown[];
  };
  historian?: HistorianInfo;
  /** Runtime 0.5.0 trở lên (feature 006): phiên bản định dạng project hiểu được, ví dụ `["0.1","0.2"]`. */
  schemaVersions?: string[];
  /** Cảnh báo của thiết bị, ví dụ `VIEWER_PUBLIC` (trang xem mở cho mọi nguồn, ADR-018). */
  warnings?: string[];
  /** Runtime 0.6.0 trở lên (feature 007): trang vận hành, `https` false khi thiết bị không mở được HTTPS. */
  web?: { https?: boolean; [k: string]: unknown };
  device?: { apiVersion?: string; viewerAccess?: 'private' | 'any' | 'off'; [k: string]: unknown };
  [k: string]: unknown;
}

/** Dung lượng: KB, MB, GB; số thập phân theo `locale` (mặc định tiếng Việt: dấu phẩy). */
export function formatBytes(n: number | undefined, locale = 'vi-VN'): string {
  if (n === undefined || !Number.isFinite(n)) return '?';
  const one = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const GIB = 1024 ** 3;
  const MIB = 1024 ** 2;
  if (n >= GIB) return `${one.format(n / GIB)} GB`;
  if (n >= MIB) return `${one.format(n / MIB)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

/**
 * Lỗi kiểm kết nối (máy đọc được; giao diện đổi sang chữ qua i18n):
 * - `timeout`: không xong trong hạn (kể cả khi lớp mạng không trả lời và bỏ qua tín hiệu hủy);
 * - `network`: lỗi mạng (sai địa chỉ, thiết bị tắt, bị chặn); `detail` là thông báo gốc;
 * - `http`: mã HTTP lỗi, `detail` là mã;
 * - `bad-response`: nội dung không phải JSON object.
 */
export type CheckErrorCode = 'timeout' | 'network' | 'http' | 'bad-response';
export type CheckResult =
  { ok: true; info: DeviceInfo } | { ok: false; code: CheckErrorCode; detail?: string };
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Hạn chót kiểm kết nối (FR-027: báo không kết nối được trong ≤ 3 s). Đặt 2,8 s để còn chỗ cho việc vẽ
 * thông báo trong 3 s: với hạn đúng 3 s, e2e đo được 3,006–3,015 s.
 */
export const DEVICE_TIMEOUT_MS = 2800;

export async function checkDevice(
  base: string,
  fetchFn: FetchFn = (u, i) => fetch(u, i),
  timeoutMs = DEVICE_TIMEOUT_MS,
): Promise<CheckResult> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Hạn chót không phụ thuộc lớp mạng: fetch hay thân phản hồi treo mà bỏ qua tín hiệu hủy vẫn báo đúng
  // hạn (FR-027: báo trong ≤ 3 s, giao diện không treo).
  const deadline = new Promise<CheckResult>((resolve) => {
    timer = setTimeout(() => {
      ctl.abort();
      resolve({ ok: false, code: 'timeout' });
    }, timeoutMs);
  });
  const work = (async (): Promise<CheckResult> => {
    let readingBody = false;
    try {
      const res = await fetchFn(`${base}/api/v1/system/info`, {
        signal: ctl.signal,
        cache: 'no-store',
      });
      if (!res.ok) return { ok: false, code: 'http', detail: String(res.status) };
      readingBody = true;
      const info: unknown = await res.json();
      if (info === null || typeof info !== 'object' || Array.isArray(info))
        return { ok: false, code: 'bad-response' };
      return { ok: true, info: info as DeviceInfo };
    } catch (e) {
      if (ctl.signal.aborted) return { ok: false, code: 'timeout' };
      return readingBody
        ? { ok: false, code: 'bad-response', detail: message(e) }
        : { ok: false, code: 'network', detail: message(e) };
    }
  })();
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Project trên thiết bị so với project đang mở (thanh trạng thái, Chẩn đoán; spec Edge Cases):
 * - `unknown`: chưa có system/info hoặc thiết bị không báo khối project;
 * - `none`: thiết bị chưa có project; `invalid`: project trên thiết bị không hợp lệ;
 * - `same`, `version`, `other`: cùng mã và phiên bản / cùng mã khác phiên bản / project khác;
 * - `active`: chưa mở project trên máy này nên không so được.
 *
 * Chỉ so mã và phiên bản; so nội dung từng file thuộc feature 005.
 */
export type DeviceProject =
  | { kind: 'unknown' }
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'same'; id: string; version: string }
  | { kind: 'version'; id: string; device: string; local: string }
  | { kind: 'other'; id: string; version: string }
  | { kind: 'active'; id: string; version: string };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function deviceProject(
  info: Pick<DeviceInfo, 'project'> | null,
  local: { projectId?: unknown; projectVersion?: unknown } | null,
): DeviceProject {
  const p = info?.project;
  if (!p || typeof p !== 'object') return { kind: 'unknown' };
  if (p.status === 'missing') return { kind: 'none' };
  if (p.status === 'invalid') return { kind: 'invalid' };
  if (p.status !== 'active') return { kind: 'unknown' };
  const id = str(p.projectId);
  const version = str(p.projectVersion);
  const localId = str(local?.projectId);
  if (!local || !localId) return { kind: 'active', id, version };
  if (id !== localId) return { kind: 'other', id, version };
  const localVersion = str(local.projectVersion);
  return version === localVersion
    ? { kind: 'same', id, version }
    : { kind: 'version', id, device: version, local: localVersion };
}

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
const KEY = 'mat-studio.device';
const defaultStorage = (): StorageLike | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function loadDevice(storage: StorageLike | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export function saveDevice(address: string, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(KEY, address);
  } catch {
    /* storage bị chặn: chỉ là tiện ích, bỏ qua */
  }
}
