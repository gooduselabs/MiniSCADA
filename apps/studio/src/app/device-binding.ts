// Thiết bị gắn với project (feature 005, T085a, FR-031): Ctrl+K và nút Online kết nối tới thiết bị này. Giữ
// `id` của thiết bị đã lưu (`devices.json` do Rust giữ) trong thiết lập cục bộ của Studio (localStorage của
// WebView2, như bố cục của 004), khóa theo thư mục project; không ghi vào file project (thiết bị là cấu hình
// của máy kỹ sư, như địa chỉ thiết bị của 004). Mất hay hỏng thì project coi như chưa gắn; thiết lập cục bộ bị
// chặn thì chỉ nhớ trong phiên này.
import type { StorageLike } from './workspace.ts';

export const BINDINGS_KEY = 'mat-studio.projectDevices';
/** Số project nhớ tối đa (mới nhất trước), như trần 64 thiết bị đã lưu. */
export const MAX_BINDINGS = 64;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Khóa của thư mục project: bỏ khoảng trắng hai đầu, `/` thành `\`, bỏ `\` cuối, chữ thường (đường dẫn
 * Windows không phân biệt hoa thường; Studio chỉ chạy trên Windows).
 */
export function projectKey(display: string): string {
  return display.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

type Entry = [project: string, device: string];

const isEntry = (x: unknown): x is Entry =>
  Array.isArray(x) &&
  x.length === 2 &&
  typeof x[0] === 'string' &&
  x[0] !== '' &&
  typeof x[1] === 'string' &&
  UUID.test(x[1]);

export class DeviceBindings {
  private readonly storage: StorageLike | null;
  /** Danh sách trong bộ nhớ (mới nhất trước); đọc từ thiết lập cục bộ ở lần dùng đầu. */
  private list: Entry[] | null = null;

  constructor(storage: StorageLike | null) {
    this.storage = storage;
  }

  /** `id` của thiết bị đã lưu gắn với project, hoặc `null`. */
  get(project: string): string | null {
    const key = projectKey(project);
    return this.entries().find(([p]) => p === key)?.[1] ?? null;
  }

  /** Gắn thiết bị (`id` của thiết bị đã lưu) với project; `null` để gỡ. Project vừa gắn lên đầu danh sách. */
  set(project: string, device: string | null): void {
    const key = projectKey(project);
    if (!key || (device !== null && !UUID.test(device))) return;
    const rest = this.entries().filter(([p]) => p !== key);
    this.list = (device === null ? rest : [[key, device] as Entry, ...rest]).slice(0, MAX_BINDINGS);
    try {
      this.storage?.setItem(BINDINGS_KEY, JSON.stringify(this.list));
    } catch {
      /* thiết lập cục bộ bị chặn: chỉ nhớ trong phiên này */
    }
  }

  private entries(): Entry[] {
    if (this.list) return this.list;
    let raw: unknown;
    try {
      raw = JSON.parse(this.storage?.getItem(BINDINGS_KEY) ?? 'null');
    } catch {
      raw = null;
    }
    this.list = Array.isArray(raw) ? raw.filter(isEntry).slice(0, MAX_BINDINGS) : [];
    return this.list;
  }
}
