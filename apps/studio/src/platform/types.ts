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

// ---- Feature 006 (contracts/tauri-commands-006.md §5, §6) ----

/** `project_backup`: thư mục sao lưu mới (`dir` tương đối để hiện, `abs` chỉ để hiện và mở bằng Explorer). */
export type BackupOutcome =
  | { dir: string; abs: string }
  | { error: 'exists' | 'bad-path' | 'no-project' }
  /** `changed`: `detail` là file khác hash lúc đọc (hoặc không còn). */
  | { error: 'changed' | 'io'; detail: string };

/** `project_remove`: xóa một file `.json` của project khi hash khớp. */
export type RemoveOutcome =
  | { ok: true }
  | { error: 'missing' | 'bad-path' }
  | { error: 'changed' | 'io'; detail: string };

/** File CSV người dùng chọn: tên (không có đường dẫn) và byte gốc (giao diện tự giải mã). */
export interface CsvFileData {
  name: string;
  bytes: Uint8Array;
}
export type CsvOpenOutcome = CsvFileData | null | { error: 'too-large' | 'io'; detail?: string };
export type CsvSaveOutcome = { name: string } | null | { error: 'io'; detail: string };

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
  /**
   * Chép đúng các file của project 0.1 (`rel` + SHA-256 lúc đọc) vào `.mat-backup/<label>-<UTC>/` trước khi nâng
   * cấp lên 0.2 (FR-004); không bao giờ ghi đè. `label` là phiên bản gốc, ví dụ `0.1.0`.
   */
  projectBackup(files: { rel: string; hash: string }[], label: string): Promise<BackupOutcome>;
  /** Xóa file `.json` (bảng giá trị, bảng theo dõi đã xóa) khi hash trên đĩa khớp; không xóa project.json, file Tag. */
  projectRemove(rel: string, hash: string): Promise<RemoveOutcome>;
  /** Hộp thoại mở file CSV; `null` khi hủy. */
  csvOpen(): Promise<CsvOpenOutcome>;
  /** Hộp thoại lưu file CSV (`text` ghi đúng như đưa vào); `null` khi hủy. */
  csvSave(suggestedName: string, text: string): Promise<CsvSaveOutcome>;
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

/** Lỗi `project_backup` của Rust → BackupOutcome. */
export function asBackupFailure(e: unknown): Extract<BackupOutcome, { error: string }> {
  const err = ipcError(e);
  if (err?.code === 'exists' || err?.code === 'bad-path' || err?.code === 'no-project')
    return { error: err.code };
  if (err?.code === 'changed') return { error: 'changed', detail: err.detail ?? '' };
  return { error: 'io', detail: err?.detail ?? (e instanceof Error ? e.message : String(e)) };
}

/** Lỗi `project_remove` của Rust → RemoveOutcome. */
export function asRemoveFailure(e: unknown): Extract<RemoveOutcome, { error: string }> {
  const err = ipcError(e);
  if (err?.code === 'missing' || err?.code === 'bad-path') return { error: err.code };
  if (err?.code === 'changed') return { error: 'changed', detail: err.detail ?? '' };
  return { error: 'io', detail: err?.detail ?? (e instanceof Error ? e.message : String(e)) };
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
