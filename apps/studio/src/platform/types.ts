// Giao diện giữa Studio và lớp chạy bên dưới (feature 004, contracts/tauri-commands.md). Bản Tauri gọi lệnh
// Rust; bản giả (chế độ e2e) giữ project mẫu trong bộ nhớ. Giao diện không bao giờ gửi đường dẫn tuyệt đối:
// thư mục project chỉ đặt qua hộp thoại hoặc danh sách gần đây do Rust giữ (research R7).

export interface AppInfo {
  name: string;
  version: string;
  tauri: string;
}

export interface PickResult {
  display: string;
}

export interface RecentEntry {
  index: number;
  display: string;
  name: string;
  /** ISO 8601 UTC */
  openedAt: string;
  exists: boolean;
}

export type ReadFailure = 'missing' | 'bad-path' | 'too-large' | 'bad-utf8';
export type ReadOutcome = { text: string; hash: string } | { error: ReadFailure };

export type WriteFailure = 'changed' | 'bad-path' | 'no-project' | 'io';
export type WriteOutcome = { hash: string } | { error: WriteFailure; detail?: string };

export type RecentFailure = 'no-such-entry' | 'missing';

export interface Platform {
  readonly kind: 'tauri' | 'mock';
  appInfo(): Promise<AppInfo>;
  /** Hộp thoại chọn thư mục; `null` khi hủy. */
  pickProject(): Promise<PickResult | null>;
  recentProjects(): Promise<RecentEntry[]>;
  openRecent(index: number): Promise<PickResult | { error: RecentFailure }>;
  forgetRecent(index: number): Promise<void>;
  read(rel: string): Promise<ReadOutcome>;
  /** `expectedHash` = hash lúc đọc (`null` khi tạo file mới); `force` ghi đè cả khi file đã đổi. */
  write(
    rel: string,
    content: string,
    expectedHash: string | null,
    force: boolean,
  ): Promise<WriteOutcome>;
  openDeviceWeb(url: string): Promise<void>;
  /** Handler trả `true` thì cho đóng cửa sổ (FR-024). */
  onCloseRequested(handler: () => Promise<boolean>): void;
  setTitle(title: string): Promise<void>;
}

const READ_FAILURES: readonly ReadFailure[] = ['missing', 'bad-path', 'too-large', 'bad-utf8'];
const WRITE_FAILURES: readonly WriteFailure[] = ['changed', 'bad-path', 'no-project', 'io'];

/**
 * Lỗi của lệnh Rust qua IPC: enum serde kebab-case thành chuỗi (`"changed"`), biến thể có dữ liệu thành
 * đối tượng một khóa (`{ "io": "chi tiết" }`). Trả mã và chi tiết, hoặc `null` nếu không nhận ra.
 */
export function ipcError(e: unknown): { code: string; detail?: string } | null {
  if (typeof e === 'string') return { code: e };
  if (e && typeof e === 'object' && !(e instanceof Error)) {
    const keys = Object.keys(e);
    if (keys.length === 1) {
      const v = (e as Record<string, unknown>)[keys[0]];
      return { code: keys[0], detail: typeof v === 'string' ? v : undefined };
    }
  }
  return null;
}

export const asReadFailure = (e: unknown): ReadFailure => {
  const code = ipcError(e)?.code;
  return READ_FAILURES.includes(code as ReadFailure) ? (code as ReadFailure) : 'missing';
};

export const asWriteFailure = (e: unknown): { error: WriteFailure; detail?: string } => {
  const err = ipcError(e);
  if (err && WRITE_FAILURES.includes(err.code as WriteFailure)) {
    return err.detail === undefined
      ? { error: err.code as WriteFailure }
      : { error: err.code as WriteFailure, detail: err.detail };
  }
  return { error: 'io', detail: e instanceof Error ? e.message : String(e) };
};
