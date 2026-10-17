// Giao diện giữa Studio và lớp chạy bên dưới (feature 004, contracts/tauri-commands.md). Bản Tauri gọi lệnh
// Rust; bản giả (chế độ e2e) giữ project mẫu trong bộ nhớ. Giao diện không bao giờ gửi đường dẫn tuyệt đối:
// thư mục project chỉ đặt qua hộp thoại hoặc danh sách gần đây do Rust giữ (research R7).

export interface AppInfo {
  name: string;
  version: string;
  tauri: string;
}

/**
 * Chữ ký Authenticode của tệp thực thi Studio (lệnh `app_signature`, feature 011 FR-056). `unsupported`: không phải
 * Windows, không kiểm được; `notTrusted`: chữ ký đúng nhưng gốc chưa tin cậy (chứng chỉ thử).
 */
export interface AppSignature {
  status: 'valid' | 'notTrusted' | 'unsigned' | 'invalid' | 'unsupported' | 'error';
  signer: string | null;
  thumbprint: string | null;
  notAfter: string | null;
  timestamped: boolean | null;
  detail: string | null;
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
  { ok: true } | { error: 'missing' | 'bad-path' } | { error: 'changed' | 'io'; detail: string };

/** File CSV người dùng chọn: tên (không có đường dẫn) và byte gốc (giao diện tự giải mã). */
export interface CsvFileData {
  name: string;
  bytes: Uint8Array;
}
export type CsvOpenOutcome = CsvFileData | null | { error: 'too-large' | 'io'; detail?: string };
/** `svg_open` (feature 008): file SVG người dùng chọn, hủy là null, hoặc lỗi của Rust. */
export type SvgOpenOutcome =
  CsvFileData | null | { error: 'too-large' | 'bad-extension' | 'io'; detail?: string };
export type CsvSaveOutcome = { name: string } | null | { error: 'io'; detail: string };
/** Phần mở rộng của file báo cáo xuất thử (feature 010). */
export type ReportExt = 'csv' | 'xlsx' | 'pdf';

// ---- Feature 011: trình vẽ SVG (contracts/svg-editor.md §6) ----

/** `project_fingerprint`: mtime (ms UTC), cỡ (byte) và SHA-256 của một file project. */
export interface Fingerprint {
  mtimeMs: number;
  size: number;
  hash: string;
}
export type FingerprintOutcome = Fingerprint | { error: ReadFailure };
/** Một tệp của `.mat-editor/autosave/` (`editor_list`). */
export interface EditorFileInfo {
  name: string;
  mtimeMs: number;
  size: number;
}
export type EditorRemoveOutcome =
  { ok: true } | { error: 'bad-path' | 'missing' } | { error: 'io'; detail: string };

export interface Platform {
  readonly kind: 'tauri' | 'mock';
  appInfo(): Promise<AppInfo>;
  /** Chữ ký số của chính Studio (chỉ đọc; Windows chạy Get-AuthenticodeSignature, khoảng 1 s). */
  appSignature(): Promise<AppSignature>;
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
  csvSave(suggestedName: string, text: string, extension?: 'json' | 'md'): Promise<CsvSaveOutcome>;
  /** Hộp thoại mở file SVG (008, `svg_open`): byte gốc ≤ 5 MiB + 64 B; `null` khi hủy. */
  svgOpen(): Promise<SvgOpenOutcome>;
  /**
   * Feature 010 (studio-010 §2): hộp thoại lưu file báo cáo xuất thử (CSV, XLSX, PDF); byte ghi nguyên văn, đường dẫn do người
   * dùng chọn qua hộp thoại (không bao giờ ghi tự động); `null` khi hủy.
   */
  reportSave(suggestedName: string, bytes: Uint8Array, ext: ReportExt): Promise<CsvSaveOutcome>;
  // ---- Feature 011: trình vẽ SVG (contracts/svg-editor.md §6) ----
  /** mtime, cỡ, SHA-256 của file project (phát hiện file SVG đổi trên đĩa, FR-113). */
  fingerprint(rel: string): Promise<FingerprintOutcome>;
  /** Mọi file `.svg` của project (cây "Đồ họa SVG"), bỏ thư mục bắt đầu bằng dấu chấm; tối đa 2000. */
  listSvg(): Promise<string[]>;
  /** Tệp của `.mat-editor/autosave/` (bản tự lưu, FR-112); thư mục chưa có thì rỗng. */
  editorList(dir: 'autosave'): Promise<EditorFileInfo[]>;
  /** Xóa một bản tự lưu `.mat-editor/autosave/<tên>`; đường dẫn khác bị từ chối. */
  editorRemove(rel: string): Promise<EditorRemoveOutcome>;
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
