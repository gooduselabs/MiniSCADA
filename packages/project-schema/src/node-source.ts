// Đọc project từ thư mục trên đĩa (Node: CLI, test). Không dùng trong trình duyệt.
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { isSafeRelPath, type ProjectSource } from './source.ts';

export class NodeDirSource implements ProjectSource {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  async readText(rel: string): Promise<string | null> {
    if (!isSafeRelPath(rel)) return null;
    try {
      const rootReal = await realpath(this.root);
      const real = await realpath(resolve(this.root, rel));
      if (!real.startsWith(rootReal + sep)) return null; // symlink ra ngoài project
      return await readFile(real, 'utf8');
    } catch {
      return null;
    }
  }
}
