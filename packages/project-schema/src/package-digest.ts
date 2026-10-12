// Digest nội dung của gói .matscada và của project (specs/005-device-online/contracts/matscada-package.md
// §4). Bản C++ (core/package/digest.cpp) và Rust (Studio) cho cùng kết quả trên tests/package-vectors và
// tests/project-vectors. Hàm băm SHA-256 được truyền vào: WebCrypto trong Studio, node:crypto trong CLI và test.

/** Một file của gói, như một mục `files[]` của manifest: đường dẫn, số byte, SHA-256 hex chữ thường. */
export interface PackageFile {
  path: string;
  size: number;
  sha256: string;
}

/** SHA-256 của dãy byte, trả 64 hex chữ thường. Đồng bộ hay bất đồng bộ đều được. */
export type Sha256 = (data: Uint8Array) => string | Promise<string>;

const HEX64 = /^[0-9a-f]{64}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const encoder = new TextEncoder();

/** So byte; độ dài khác nhau mà phần chung bằng nhau thì chuỗi ngắn đứng trước. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/**
 * So hai chuỗi theo byte UTF-8 (cũng là thứ tự điểm mã): thứ tự của `files[]` trong manifest và của
 * digest. Khác `localeCompare` (chữ hoa, dấu câu) và khác so mặc định của JS (đơn vị UTF-16).
 */
export function compareUtf8(a: string, b: string): number {
  return compareBytes(encoder.encode(a), encoder.encode(b));
}

const hasLoneSurrogate = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xdc00 && c <= 0xdfff) return true;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    }
  }
  return false;
};

/** Mục sai dạng là lỗi lập trình của bên gọi (đường dẫn đã qua bộ kiểm tra project), nên ném lỗi. */
function checkFile(f: PackageFile): void {
  if (
    typeof f.path !== 'string' ||
    f.path === '' ||
    CONTROL.test(f.path) ||
    hasLoneSurrogate(f.path)
  )
    throw new Error(`Đường dẫn không dùng được trong digest: ${JSON.stringify(f.path)}`);
  if (!Number.isSafeInteger(f.size) || f.size < 0)
    throw new Error(`Kích thước không hợp lệ của ${f.path}: ${f.size}`);
  if (typeof f.sha256 !== 'string' || !HEX64.test(f.sha256))
    throw new Error(`SHA-256 phải là 64 hex chữ thường: ${f.path}`);
}

/**
 * Văn bản đem băm: mỗi file một dòng `<sha256> <size> <path>\n` (size thập phân, không có số 0 ở đầu),
 * sắp theo path (byte UTF-8). Đường dẫn trùng thì ném lỗi.
 */
export function digestText(files: readonly PackageFile[]): string {
  files.forEach(checkFile);
  const keyed = files
    .map((f) => ({ f, key: encoder.encode(f.path) }))
    .sort((a, b) => compareBytes(a.key, b.key));
  for (let i = 1; i < keyed.length; i++)
    if (compareBytes(keyed[i - 1].key, keyed[i].key) === 0)
      throw new Error(`Đường dẫn trùng: ${keyed[i].f.path}`);
  return keyed.map(({ f }) => `${f.sha256} ${f.size} ${f.path}\n`).join('');
}

const checkHex = async (hex: string | Promise<string>): Promise<string> => {
  const h = await hex;
  if (typeof h !== 'string' || !HEX64.test(h))
    throw new Error('Hàm băm phải trả SHA-256 dạng 64 hex chữ thường');
  return h;
};

/**
 * Digest nội dung `sha256:<64 hex>`: không phụ thuộc cách nén, thời điểm hay công cụ đóng gói, nên so được
 * project trên máy với thiết bị mà không cần đóng gói. Manifest không nằm trong digest.
 */
export async function packageDigest(
  files: readonly PackageFile[],
  sha256: Sha256,
): Promise<string> {
  const text = digestText(files);
  return `sha256:${await checkHex(sha256(encoder.encode(text)))}`;
}

/** Mục `PackageFile` của một file. Chuỗi được tính theo byte UTF-8 (BOM nếu có vẫn giữ). */
export async function packageFile(
  path: string,
  content: Uint8Array | string,
  sha256: Sha256,
): Promise<PackageFile> {
  const bytes = typeof content === 'string' ? encoder.encode(content) : content;
  return { path, size: bytes.length, sha256: await checkHex(sha256(bytes)) };
}

/**
 * SHA-256 bằng WebCrypto: Studio (WebView của Tauri), Node ≥ 19. Trình duyệt chỉ có `crypto.subtle` trong
 * secure context (HTTPS, localhost), nên trang xem phục vụ qua HTTP của thiết bị không dùng được hàm này.
 */
export const sha256WebCrypto: Sha256 = async (data) => {
  if (!globalThis.crypto?.subtle) throw new Error('WebCrypto (crypto.subtle) không có ở đây');
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(data)),
  );
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
};
