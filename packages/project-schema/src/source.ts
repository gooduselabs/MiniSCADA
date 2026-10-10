// Nguồn đọc file project: Node (CLI/test), Tauri (Studio), bộ nhớ (test, trình duyệt).

export interface ProjectSource {
  /** Nội dung file theo đường dẫn tương đối trong project; null nếu không có/không đọc được. */
  readText(rel: string): Promise<string | null>;
}

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
  async readText(rel: string): Promise<string | null> {
    if (!isSafeRelPath(rel)) return null;
    return Object.prototype.hasOwnProperty.call(this.files, rel) ? this.files[rel] : null;
  }
}
