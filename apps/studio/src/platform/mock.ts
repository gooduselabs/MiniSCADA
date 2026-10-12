// Lớp platform giả cho chế độ build `e2e` (feature 004, research R14): project mẫu `projects/tank-demo` nạp
// lúc build, giữ trong bộ nhớ; ghi lại các lần ghi; giả lập file bị sửa ngoài Studio, lỗi ghi, yêu cầu đóng
// cửa sổ. Script e2e điều khiển qua `window.__matMock`. Không vào bộ cài.
import type {
  AppInfo,
  BackupOutcome,
  Platform,
  ReadOutcome,
  RecentEntry,
  RemoveOutcome,
  WriteOutcome,
} from './types.ts';

const SAMPLE = import.meta.glob('../../../../projects/tank-demo/**/*.{json,svg}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const PREFIX = '../../../../projects/tank-demo/';

/** SHA-256 hex chữ thường của chuỗi UTF-8 (thuần JS, chạy cả trong jsdom lẫn Chrome). */
export async function sha256Hex(text: string): Promise<string> {
  return sha256Sync(text);
}

/** Như `sha256Hex` nhưng đồng bộ: lớp giả thiết bị dựng digest ngay lúc tạo. */
export function sha256Sync(text: string): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const bytes = new TextEncoder().encode(text);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    H[0] += a;
    H[1] += b;
    H[2] += c;
    H[3] += d;
    H[4] += e;
    H[5] += f;
    H[6] += g;
    H[7] += h;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}

export interface MockControl {
  /** Các lần ghi thành công, theo thứ tự. */
  writes: Array<{ rel: string; content: string }>;
  /** Đặt để mọi lần ghi sau trả lỗi này. */
  failWrites: 'io' | 'bad-path' | null;
  /** Giả lập một chương trình khác sửa file trên đĩa. */
  editOutside(rel: string, content: string): void;
  /**
   * Lần mở project sau dùng bộ file này (đường dẫn tương đối → nội dung) thay project mẫu; `null` để
   * quay về project mẫu. Dùng cho e2e đo hiệu năng với 500 Tag (T081).
   */
  useProject(files: Record<string, string> | null, display?: string): void;
  /** Giả lập người dùng bấm nút đóng cửa sổ; trả `true` nếu cửa sổ được đóng. */
  requestClose(): Promise<boolean>;
  // ---- Feature 006 ----
  /** Các file đã xóa bằng `projectRemove`, theo thứ tự. */
  removes: string[];
  /** Các lần sao lưu khi nâng cấp (`project_backup`). */
  backups: Array<{ label: string; dir: string; files: string[] }>;
  /** Đặt để lần sao lưu sau trả lỗi này (ví dụ `exists`). */
  backupFailure: 'exists' | 'bad-path' | 'io' | null;
  /** Kết quả của `csvOpen` lần sau (`null`: người dùng hủy). */
  csvOpenResult: { name: string; bytes: Uint8Array } | null;
  /** Các file CSV đã xuất qua `csvSave`. */
  savedCsv: Array<{ name: string; text: string }>;
}

export type MockPlatform = Platform & { readonly control: MockControl };

export function createMockPlatform(): MockPlatform {
  const files = new Map<string, string>();
  let open = false;
  let closeHandler: (() => Promise<boolean>) | null = null;
  let override: { files: Record<string, string>; display: string } | null = null;
  const control: MockControl = {
    writes: [],
    failWrites: null,
    editOutside: (rel, content) => void files.set(rel, content),
    useProject: (next, display = 'D:\\Projects\\fixture') =>
      void (override = next ? { files: { ...next }, display } : null),
    requestClose: async () => (closeHandler ? closeHandler() : true),
    removes: [],
    backups: [],
    backupFailure: null,
    csvOpenResult: null,
    savedCsv: [],
  };
  const recent: RecentEntry[] = [
    {
      index: 0,
      display: 'D:\\Projects\\tank-demo',
      name: 'tank-demo',
      openedAt: '2026-10-11T02:00:00Z',
      exists: true,
    },
    {
      index: 1,
      display: 'D:\\Projects\\plant-a',
      name: 'plant-a',
      openedAt: '2026-10-08T09:00:00Z',
      exists: false,
    },
  ];
  const load = () => {
    files.clear();
    if (override) {
      for (const [k, v] of Object.entries(override.files)) files.set(k, v);
      open = true;
      return { display: override.display };
    }
    for (const [k, v] of Object.entries(SAMPLE)) files.set(k.slice(PREFIX.length), v);
    open = true;
    return { display: recent[0].display };
  };
  return {
    kind: 'mock',
    control,
    appInfo: async (): Promise<AppInfo> => ({ name: 'mAT Studio', version: 'e2e', tauri: 'mock' }),
    pickProject: async () => load(),
    recentProjects: async () => recent.map((r) => ({ ...r })),
    openRecent: async (index) => {
      const r = recent[index];
      if (!r) return { error: 'no-such-entry' };
      if (!r.exists) return { error: 'missing' };
      return load();
    },
    forgetRecent: async (index) => {
      recent.splice(index, 1);
      recent.forEach((r, i) => (r.index = i));
    },
    read: async (rel): Promise<ReadOutcome> => {
      const text = open ? files.get(rel) : undefined;
      return text === undefined ? { error: 'missing' } : { text, hash: await sha256Hex(text) };
    },
    write: async (rel, content, expectedHash, force): Promise<WriteOutcome> => {
      if (!open) return { error: 'no-project' };
      if (!/\.(json|svg)$/.test(rel)) return { error: 'bad-path' };
      if (control.failWrites) return { error: control.failWrites, detail: 'mock' };
      const current = files.get(rel);
      const currentHash = current === undefined ? null : await sha256Hex(current);
      if (!force && currentHash !== expectedHash) return { error: 'changed' };
      files.set(rel, content);
      control.writes.push({ rel, content });
      return { hash: await sha256Hex(content) };
    },
    projectBackup: async (list, label): Promise<BackupOutcome> => {
      if (!open) return { error: 'no-project' };
      if (control.backupFailure)
        return control.backupFailure === 'io'
          ? { error: 'io', detail: 'mock' }
          : { error: control.backupFailure };
      for (const f of list) {
        const current = files.get(f.rel);
        if (current === undefined || (await sha256Hex(current)) !== f.hash)
          return { error: 'changed', detail: f.rel };
      }
      const stamp = new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d+Z$/, 'Z');
      const dir = `.mat-backup/${label}-${stamp}`;
      control.backups.push({ label, dir, files: list.map((f) => f.rel) });
      return { dir, abs: `D:\\Projects\\fixture\\${dir.replace(/\//g, '\\')}` };
    },
    projectRemove: async (rel, hash): Promise<RemoveOutcome> => {
      if (!open || rel === 'project.json' || !rel.endsWith('.json')) return { error: 'bad-path' };
      const current = files.get(rel);
      if (current === undefined) return { error: 'missing' };
      if ((await sha256Hex(current)) !== hash) return { error: 'changed', detail: rel };
      files.delete(rel);
      control.removes.push(rel);
      return { ok: true };
    },
    csvOpen: async () => control.csvOpenResult,
    csvSave: async (name, text) => {
      control.savedCsv.push({ name, text });
      return { name };
    },
    openDeviceWeb: async () => undefined,
    onCloseRequested: (handler) => void (closeHandler = handler),
    setTitle: async (title) => {
      if (typeof document !== 'undefined') document.title = title;
    },
  };
}

export const platform: MockPlatform = createMockPlatform();

if (typeof window !== 'undefined')
  (window as unknown as { __matMock: MockControl }).__matMock = platform.control;
