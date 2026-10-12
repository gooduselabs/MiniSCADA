// Đọc project từ thư mục trên đĩa (Node: CLI, test). Không dùng trong trình duyệt.
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { MAX_FILE_BYTES, MAX_SVG_BYTES } from './codes.ts';
import { isSafeRelPath, type ProjectSource, type ReadResult } from './source.ts';

/**
 * Mỗi đoạn của `rel` phải là một mục có đúng tên đó trong thư mục cha, như ext4 trên thiết bị:
 * NTFS/APFS không phân biệt hoa thường nên `realpath` vẫn mở `main.svg` cho `Main.svg` (audit FR-032).
 */
async function exactCase(root: string, rel: string): Promise<boolean> {
  let dir = root;
  for (const part of rel.split('/')) {
    if (!(await readdir(dir)).includes(part)) return false;
    dir = join(dir, part);
  }
  return true;
}

export class NodeDirSource implements ProjectSource {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  async read(rel: string): Promise<ReadResult> {
    if (!isSafeRelPath(rel)) return { error: 'bad-path' };
    try {
      if (!(await exactCase(this.root, rel))) return { error: 'missing' };
      const rootReal = await realpath(this.root);
      const real = await realpath(resolve(this.root, rel));
      if (!real.startsWith(rootReal + sep)) return { error: 'bad-path' }; // symlink ra ngoài project
      const st = await stat(real);
      if (!st.isFile()) return { error: 'missing' };
      if (st.size > (rel.endsWith('.svg') ? MAX_SVG_BYTES : MAX_FILE_BYTES))
        return { error: 'too-large' };
      const bytes = await readFile(real);
      try {
        // fatal: byte hỏng là lỗi (bản C++ báo E_JSON); ignoreBOM: giữ BOM để bộ kiểm tra bỏ đúng một.
        return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) };
      } catch {
        return { error: 'bad-utf8' };
      }
    } catch {
      return { error: 'missing' };
    }
  }
}
