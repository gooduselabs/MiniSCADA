// Nguồn đọc file project: Node (CLI/test), Tauri (Studio), bộ nhớ (test, trình duyệt).

/**
 * Lý do không đọc được file, cùng cách phân loại với Studio (Rust `project_fs.rs`). Bộ kiểm tra đổi
 * sang mã lỗi giống bản C++ (contracts/project-format.md, "Kiểm tra trước schema"):
 * `missing` (không có, khác chữ hoa/thường, không phải file), `bad-path` (đường dẫn bị từ chối, ra
 * ngoài thư mục project), `too-large` (> 1 MB với JSON, > 5 MB với SVG), `bad-utf8`.
 */
export type ReadFailure = 'missing' | 'bad-path' | 'too-large' | 'bad-utf8';
export const READ_FAILURES: readonly ReadFailure[] = [
  'missing',
  'bad-path',
  'too-large',
  'bad-utf8',
];
/**
 * Kết quả đọc. `hash` (SHA-256 hex chữ thường của nội dung) chỉ nguồn đọc của Studio có, để lệnh ghi
 * phát hiện file bị sửa ngoài Studio (contracts/tauri-commands.md của feature 004); bộ kiểm tra
 * không dùng.
 */
export type ReadResult = { text: string; hash?: string } | { error: ReadFailure };

export interface ProjectSource {
  /** Nội dung file theo đường dẫn tương đối trong project (giữ BOM nếu có), hoặc lý do lỗi. */
  read(rel: string): Promise<ReadResult>;
}

/** Nội dung file, hoặc null khi không đọc được. */
export const textOf = (r: ReadResult): string | null => ('text' in r ? r.text : null);

/** Bỏ đúng một BOM UTF-8 ở đầu văn bản, như parser của bản C++ (nlohmann). */
export const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/**
 * Đường dẫn an toàn (data-model.md): tương đối, dùng `/`, không `..`, không bắt đầu `/` hay ổ đĩa,
 * không `\`, `:`, ký tự điều khiển; dài ≤ 128.
 */
export function isSafeRelPath(p: string): boolean {
  // Độ dài tính theo byte UTF-8, giống bản C++ và Rust (review minor-5).
  if (typeof p !== 'string' || p.length === 0 || new TextEncoder().encode(p).length > 128)
    return false;
  // eslint-disable-next-line no-control-regex
  if (/[\\:\u0000-\u001f\u007f]/.test(p)) return false;
  if (p.startsWith('/')) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

export class MemorySource implements ProjectSource {
  private readonly files: Record<string, string>;
  constructor(files: Record<string, string>) {
    this.files = files;
  }
  async read(rel: string): Promise<ReadResult> {
    if (!isSafeRelPath(rel)) return { error: 'bad-path' };
    return Object.prototype.hasOwnProperty.call(this.files, rel)
      ? { text: this.files[rel] }
      : { error: 'missing' };
  }
}
