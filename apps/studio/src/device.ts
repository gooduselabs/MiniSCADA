// Địa chỉ thiết bị (FR-034): chuẩn hóa, kiểm kết nối qua /api/v1/system/info, ghi nhớ cục bộ.
// Địa chỉ thiết bị không nằm trong project (cấu hình riêng của máy kỹ sư).

export type NormalizeResult = { ok: true; base: string } | { ok: false; error: string };

const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

export function normalizeDevice(input: string): NormalizeResult {
  let s = input.trim();
  let scheme = 'http';
  const m = /^([a-z]+):\/\//i.exec(s);
  if (m) {
    scheme = m[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https')
      return { ok: false, error: 'Chỉ hỗ trợ http/https' };
    s = s.slice(m[0].length);
  }
  s = s.replace(/\/$/, '');
  const hp = /^([^:/]+)(?::(\d{1,5}))?$/.exec(s);
  if (!hp || !HOST.test(hp[1])) return { ok: false, error: 'Địa chỉ thiết bị không hợp lệ' };
  const port = hp[2] ? Number(hp[2]) : 8080;
  if (port < 1 || port > 65535) return { ok: false, error: 'Cổng không hợp lệ' };
  return { ok: true, base: `${scheme}://${hp[1]}:${port}` };
}

export const liveUrl = (base: string) => base.replace(/^http/, 'ws') + '/api/v1/live';

export interface DeviceInfo {
  runtimeVersion?: string;
  protocolVersion?: string;
  clients?: number;
  maxClients?: number;
  project?: { status?: string; projectId?: string; projectVersion?: string };
  [k: string]: unknown;
}

export type CheckResult = { ok: true; info: DeviceInfo } | { ok: false; error: string };
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export async function checkDevice(
  base: string,
  fetchFn: FetchFn = (u, i) => fetch(u, i),
  timeoutMs = 3000,
): Promise<CheckResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${base}/api/v1/system/info`, {
      signal: ctl.signal,
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, error: `Không kết nối được: HTTP ${res.status}` };
    return { ok: true, info: (await res.json()) as DeviceInfo };
  } catch (e) {
    return {
      ok: false,
      error: `Không kết nối được tới ${base} (${e instanceof Error ? e.message : String(e)})`,
    };
  } finally {
    clearTimeout(timer);
  }
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
