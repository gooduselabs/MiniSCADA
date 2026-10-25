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
  /**
   * Số byte của tệp (feature 024: logo PNG của báo cáo, không đọc được như văn bản), null khi không có. Nguồn không
   * cài thì luật kích thước chỉ áp cho tệp đọc được như văn bản.
   */
  size?(rel: string): Promise<number | null>;
}

/** Nội dung file, hoặc null khi không đọc được. */
export const textOf = (r: ReadResult): string | null => ('text' in r ? r.text : null);

/** Bỏ đúng một BOM UTF-8 ở đầu văn bản, như parser của bản C++ (nlohmann). */
export const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/**
 * Tên thiết bị của Windows: `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`, kèm đuôi hay
 * không (`nul.svg`), mọi kiểu chữ; khoảng trắng trước đuôi cũng bị Windows bỏ (`con .json`).
 */
function isWindowsDeviceName(segment: string): boolean {
  const stem = segment.split('.')[0].replace(/ +$/, '');
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem);
}

/**
 * Đường dẫn an toàn (data-model.md): tương đối, dùng `/`, không `..`, không bắt đầu `/` hay ổ đĩa,
 * không `\`, `:`, ký tự điều khiển; dài ≤ 128 byte. T062 (rà soát bảo mật S2): không đoạn nào kết
 * thúc bằng `.` hoặc khoảng trắng (Windows bỏ đi, nên hai tên khác nhau trỏ cùng một file) hay là tên
 * thiết bị của Windows. Cùng luật với bản C++ (project_validator, project-store) và Rust (check_rel).
 */
export function isSafeRelPath(p: string): boolean {
  // Độ dài tính theo byte UTF-8, giống bản C++ và Rust (review minor-5).
  if (typeof p !== 'string' || p.length === 0 || new TextEncoder().encode(p).length > 128)
    return false;
  // eslint-disable-next-line no-control-regex
  if (/[\\:\u0000-\u001f\u007f]/.test(p)) return false;
  if (p.startsWith('/')) return false;
  return p
    .split('/')
    .every(
      (seg) =>
        seg !== '' &&
        seg !== '.' &&
        seg !== '..' &&
        !seg.endsWith('.') &&
        !seg.endsWith(' ') &&
        !isWindowsDeviceName(seg),
    );
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
  async size(rel: string): Promise<number | null> {
    const r = await this.read(rel);
    return 'text' in r ? new TextEncoder().encode(r.text).length : null;
  }
}
