// Tự lưu của trình vẽ SVG (feature 011, T161; FR-112; contracts/svg-editor.md §6): mỗi 30 s, nếu `doc.version` đổi, ghi bản
// sao hoạt động vào `.mat-editor/autosave/<tệp>.<giờ UTC>.svg` (lớp Rust ghi tạm rồi đổi tên); giữ tối đa 3 bản mỗi tệp; lưu
// thật thành công thì xóa các bản của tệp đó. Mở project mà có bản tự lưu mới hơn tệp thật (hoặc tệp thật chưa từng có):
// `findRestorable` trả danh sách để hộp "Khôi phục bản tự lưu" hỏi. Bản tự lưu không vào gói, không vào digest.
import type { EditorFileInfo, Platform } from '../../platform/types.ts';

export const AUTOSAVE_INTERVAL_MS = 30_000;
export const AUTOSAVE_KEEP = 3;
export const AUTOSAVE_DIR = '.mat-editor/autosave';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** `YYYYMMDDTHHMMSSmmmZ` (UTC, sắp xếp được theo chữ). */
function stamp(at: number): string {
  const d = new Date(at);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}${pad(d.getUTCMilliseconds(), 3)}Z`
  );
}

const STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/;

/** Tên bản tự lưu: đường dẫn tương đối mã hóa `%` và `/` (một đoạn tên tệp), dấu thời gian, `.svg`. */
export function autosaveName(rel: string, at: number): string {
  return `${rel.replace(/%/g, '%25').replace(/\//g, '%2F')}.${stamp(at)}.svg`;
}

export function parseAutosaveName(name: string): { rel: string; at: number } | null {
  const m = /^(.+)\.(\d{8}T\d{9}Z)\.svg$/.exec(name);
  if (!m) return null;
  const s = STAMP.exec(m[2]!);
  if (!s) return null;
  const [, y, mo, d, h, mi, se, ms] = s.map(Number) as number[];
  const at = Date.UTC(y!, mo! - 1, d!, h!, mi!, se!, ms!);
  const rel = m[1]!.replace(/%2F/g, '/').replace(/%25/g, '%');
  if (!rel.endsWith('.svg') || rel.startsWith('/') || rel.includes('..')) return null;
  return { rel, at };
}

export interface AutosaveIo {
  list(): Promise<EditorFileInfo[]>;
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<boolean>;
  remove(name: string): Promise<void>;
}

/** Bản tự lưu qua lớp platform (`project_read`, `project_write` ghi đè, `editor_list`, `editor_remove`). */
export function platformAutosaveIo(
  p: Pick<Platform, 'read' | 'write' | 'editorList' | 'editorRemove'>,
): AutosaveIo {
  return {
    list: () => p.editorList('autosave'),
    async read(name) {
      const r = await p.read(`${AUTOSAVE_DIR}/${name}`);
      return 'text' in r ? r.text : null;
    },
    async write(name, text) {
      const r = await p.write(`${AUTOSAVE_DIR}/${name}`, text, null, true);
      return 'hash' in r;
    },
    async remove(name) {
      await p.editorRemove(`${AUTOSAVE_DIR}/${name}`);
    },
  };
}

export interface AutosaveTimers {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const realTimers: AutosaveTimers = {
  now: () => Date.now(),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
};

/** Nguồn của một tệp đang sửa: phiên bản tài liệu và văn bản tuần tự hóa (chỉ gọi khi cần ghi). */
export interface AutosaveSource {
  version(): number;
  text(): string;
}

interface Tracked {
  source: AutosaveSource;
  last: number;
  timer: unknown;
}

export class Autosaver {
  private readonly tracked = new Map<string, Tracked>();
  private chain: Promise<unknown> = Promise.resolve();
  /** Lần ghi gần nhất theo tệp (ms), cho chip "Tự lưu … trước" của editor. */
  readonly lastSaved = new Map<string, number>();

  private readonly io: AutosaveIo;
  private readonly timers: AutosaveTimers;
  private readonly interval: number;

  constructor(
    io: AutosaveIo,
    timers: AutosaveTimers = realTimers,
    interval = AUTOSAVE_INTERVAL_MS,
  ) {
    this.io = io;
    this.timers = timers;
    this.interval = interval;
  }

  track(rel: string, source: AutosaveSource): void {
    this.untrack(rel);
    const t: Tracked = { source, last: source.version(), timer: null };
    t.timer = this.timers.setInterval(() => void this.tick(rel), this.interval);
    this.tracked.set(rel, t);
  }

  untrack(rel: string): void {
    const t = this.tracked.get(rel);
    if (!t) return;
    this.timers.clearInterval(t.timer);
    this.tracked.delete(rel);
  }

  untrackAll(): void {
    for (const rel of [...this.tracked.keys()]) this.untrack(rel);
  }

  /** Coi trạng thái hiện tại là đã lưu (sau khi lưu thật, nạp lại, khôi phục). */
  settle(rel: string): void {
    const t = this.tracked.get(rel);
    if (t) t.last = t.source.version();
  }

  /** Ghi một bản nếu tài liệu đổi từ lần trước; giữ 3 bản mới nhất. */
  tick(rel: string): Promise<unknown> {
    this.chain = this.chain.then(async () => {
      const t = this.tracked.get(rel);
      if (!t) return;
      const v = t.source.version();
      if (v === t.last) return;
      const at = this.timers.now();
      if (await this.io.write(autosaveName(rel, at), t.source.text())) {
        t.last = v;
        this.lastSaved.set(rel, at);
        await this.prune(rel);
      }
    });
    return this.chain;
  }

  /** Lưu thật xong (hoặc người dùng bỏ bản tự lưu): xóa mọi bản của tệp. */
  discard(rel: string): Promise<unknown> {
    this.chain = this.chain.then(async () => {
      for (const n of await this.namesOf(rel)) await this.io.remove(n);
      this.lastSaved.delete(rel);
    });
    return this.chain;
  }

  idle(): Promise<unknown> {
    return this.chain;
  }

  private async namesOf(rel: string): Promise<string[]> {
    return (await this.io.list())
      .map((f) => f.name)
      .filter((n) => parseAutosaveName(n)?.rel === rel)
      .sort();
  }

  private async prune(rel: string): Promise<void> {
    const names = await this.namesOf(rel);
    for (const n of names.slice(0, Math.max(0, names.length - AUTOSAVE_KEEP)))
      await this.io.remove(n);
  }
}

export interface AutosaveVersion {
  name: string;
  /** Thời điểm ghi theo tên (ms UTC). */
  at: number;
  mtimeMs: number;
  text: string;
}

export interface RestoreOffer {
  rel: string;
  /** mtime của tệp thật; null khi tệp chưa có trên đĩa (tệp mới chưa từng lưu). */
  diskMtimeMs: number | null;
  /** Mới nhất trước. */
  versions: AutosaveVersion[];
}

/**
 * Bản tự lưu đáng khôi phục: mới hơn tệp thật và khác nội dung tệp thật (hoặc tệp thật không có). Chỉ đọc, không xóa gì
 * (người dùng chọn Khôi phục hoặc Bỏ).
 */
export async function findRestorable(
  io: AutosaveIo,
  disk: Pick<Platform, 'fingerprint' | 'read'>,
): Promise<RestoreOffer[]> {
  const byRel = new Map<string, Array<EditorFileInfo & { at: number }>>();
  for (const f of await io.list()) {
    const p = parseAutosaveName(f.name);
    if (!p) continue;
    const list = byRel.get(p.rel) ?? [];
    list.push({ ...f, at: p.at });
    byRel.set(p.rel, list);
  }
  const out: RestoreOffer[] = [];
  for (const [rel, list] of [...byRel].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const fp = await disk.fingerprint(rel);
    const onDisk = 'hash' in fp ? fp : null;
    const diskText = onDisk ? await disk.read(rel) : null;
    const current = diskText && 'text' in diskText ? diskText.text : null;
    const versions: AutosaveVersion[] = [];
    for (const f of list.sort((a, b) => b.at - a.at)) {
      if (onDisk && f.mtimeMs <= onDisk.mtimeMs) continue;
      const text = await io.read(f.name);
      if (text === null || text === current) continue;
      versions.push({ name: f.name, at: f.at, mtimeMs: f.mtimeMs, text });
    }
    if (versions.length) out.push({ rel, diskMtimeMs: onDisk ? onDisk.mtimeMs : null, versions });
  }
  return out;
}
