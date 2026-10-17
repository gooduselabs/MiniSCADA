// Phát hiện tệp SVG đổi trên đĩa khi đang sửa (feature 011, T161; FR-113; contracts/svg-editor.md §6): lúc cửa sổ lấy focus và
// mỗi 5 s khi tab đang mở, so mtime và băm của tệp với bản đã nạp. Chỉ mtime đổi (chạm tệp, băm như cũ) thì coi là giống. Mỗi
// bản trên đĩa khác chỉ báo một lần (người dùng đã chọn Giữ thì không hỏi lại tới khi tệp đổi tiếp). Không bao giờ ghi gì: việc
// "không ghi đè im lặng" do lần Lưu so băm lúc nạp (`project_write` trả `changed`) và hỏi trước khi ghi đè.
import type { Fingerprint, FingerprintOutcome, Platform } from '../../platform/types.ts';

export const WATCH_INTERVAL_MS = 5_000;

export type DiskState =
  | { kind: 'same'; disk: Fingerprint | null }
  | { kind: 'changed'; disk: Fingerprint }
  | { kind: 'missing' };

/** So dấu vân tay trên đĩa với bản đã nạp (`null`: tệp chưa có trên đĩa lúc nạp, tệp mới). */
export function compareDisk(base: Fingerprint | null, now: FingerprintOutcome): DiskState {
  if ('error' in now) return base === null ? { kind: 'same', disk: null } : { kind: 'missing' };
  if (base !== null && now.hash === base.hash) return { kind: 'same', disk: now };
  return { kind: 'changed', disk: now };
}

export interface WatchTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

interface Watched {
  base: Fingerprint | null;
  /** Băm (hoặc "missing") của bản trên đĩa đã báo gần nhất. */
  reported: string | null;
  onChange: (st: Exclude<DiskState, { kind: 'same' }>) => void;
  timer: unknown;
}

export class DiskWatcher {
  private readonly watched = new Map<string, Watched>();
  private chain: Promise<unknown> = Promise.resolve();

  private readonly io: Pick<Platform, 'fingerprint'>;
  private readonly timers: WatchTimers;
  private readonly interval: number;

  constructor(
    io: Pick<Platform, 'fingerprint'>,
    timers: WatchTimers = {
      setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
      clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
    },
    interval = WATCH_INTERVAL_MS,
  ) {
    this.io = io;
    this.timers = timers;
    this.interval = interval;
  }

  watch(
    rel: string,
    base: Fingerprint | null,
    onChange: (st: Exclude<DiskState, { kind: 'same' }>) => void,
  ): void {
    this.unwatch(rel);
    const w: Watched = { base, reported: null, onChange, timer: null };
    w.timer = this.timers.setInterval(() => void this.check(rel), this.interval);
    this.watched.set(rel, w);
  }

  unwatch(rel: string): void {
    const w = this.watched.get(rel);
    if (!w) return;
    this.timers.clearInterval(w.timer);
    this.watched.delete(rel);
  }

  unwatchAll(): void {
    for (const rel of [...this.watched.keys()]) this.unwatch(rel);
  }

  /** Bản trên đĩa mới là bản nền (sau khi lưu, nạp lại, hoặc ghi đè có hỏi). */
  accept(rel: string, base: Fingerprint | null): void {
    const w = this.watched.get(rel);
    if (!w) return;
    w.base = base;
    w.reported = null;
  }

  /** Kiểm một tệp ngay. */
  check(rel: string): Promise<unknown> {
    this.chain = this.chain.then(async () => {
      const w = this.watched.get(rel);
      if (!w) return;
      const st = compareDisk(w.base, await this.io.fingerprint(rel));
      if (st.kind === 'same') {
        // chạm tệp (mtime đổi, băm như cũ): nhận mtime mới làm nền
        if (st.disk && w.base && st.disk.mtimeMs !== w.base.mtimeMs) w.base = st.disk;
        w.reported = null;
        return;
      }
      const key = st.kind === 'missing' ? 'missing' : st.disk.hash;
      if (w.reported === key || this.watched.get(rel) !== w) return;
      w.reported = key;
      w.onChange(st);
    });
    return this.chain;
  }

  /** Cửa sổ lấy focus: kiểm mọi tệp đang mở. */
  focus(): Promise<unknown> {
    for (const rel of this.watched.keys()) void this.check(rel);
    return this.chain;
  }

  idle(): Promise<unknown> {
    return this.chain;
  }
}
