// Nguồn giá trị mô phỏng cho xem trước màn hình khi không có thiết bị (feature 004, research R11,
// FR-032). Phát cùng kiểu cập nhật (TagUpdate) với LiveConnection nên DomApplier dùng y hệt:
// Tag số dao động hình sin trong Min–Max (thiếu thì 0–100), BOOL đổi mỗi 5 s, STRING cố định, quality
// luôn GOOD. Đây là dữ liệu xem trước của Studio, không phải mô phỏng Tag của GĐ 2.
// Đồng hồ và hẹn giờ truyền vào được để test.
import type { TagUpdate, TagValue } from '@mat/binding-engine';
import type { TagDataType } from '@mat/project-schema';

/** Phần của Tag mà mô phỏng cần; TagDefinition dùng thẳng được. */
export interface SimTag {
  id: string;
  type: TagDataType;
  min?: number;
  max?: number;
}

export interface SimClock {
  now(): number;
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface SimSourceOptions {
  tags: readonly SimTag[];
  /** Chu kỳ phát (ms), mặc định 500. */
  intervalMs?: number;
  clock?: SimClock;
}

export const BOOL_TOGGLE_MS = 5000;
/** Chu kỳ hình sin của Tag số. */
export const SIM_PERIOD_MS = 20_000;
export const SIM_INTERVAL_MS = 500;

const INTEGER: ReadonlySet<TagDataType> = new Set([
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
]);

const finite = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** Khoảng giá trị mô phỏng: [Min, Max]; thiếu một đầu thì lấy 100 đơn vị từ đầu kia; còn lại 0–100. */
export function simRange(tag: SimTag): [number, number] {
  const lo = finite(tag.min);
  const hi = finite(tag.max);
  if (lo !== undefined && hi !== undefined) return lo < hi ? [lo, hi] : [0, 100];
  if (lo !== undefined) return [lo, lo + 100];
  if (hi !== undefined) return [hi - 100, hi];
  return [0, 100];
}

/** Giá trị của Tag thứ `index` sau `elapsedMs` kể từ lúc bắt đầu (lệch pha theo index). */
export function simValue(tag: SimTag, index: number, elapsedMs: number): TagValue {
  if (tag.type === 'BOOL') return Math.floor(elapsedMs / BOOL_TOGGLE_MS) % 2 === 0;
  if (tag.type === 'STRING') return tag.id;
  const [lo, hi] = simRange(tag);
  const phase = (index * 0.618034) % 1;
  const x = 0.5 + 0.5 * Math.sin(2 * Math.PI * (elapsedMs / SIM_PERIOD_MS + phase));
  const v = lo + (hi - lo) * x;
  if (INTEGER.has(tag.type)) {
    const a = Math.ceil(lo);
    const b = Math.floor(hi);
    return a <= b ? Math.min(b, Math.max(a, Math.round(v))) : lo;
  }
  return Math.min(hi, Math.max(lo, Math.round(v * 1000) / 1000));
}

const systemClock: SimClock = {
  now: () => Date.now(),
  setInterval: (cb, ms) => setInterval(cb, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export class SimSource {
  /** Nhận cập nhật: lần đầu đủ mọi Tag, sau đó chỉ Tag đổi giá trị. */
  onChange: ((changes: TagUpdate[]) => void) | null = null;
  private tags: readonly SimTag[];
  private readonly intervalMs: number;
  private readonly clock: SimClock;
  private timer: unknown = null;
  private t0 = 0;
  private readonly last = new Map<string, TagValue>();

  constructor(opts: SimSourceOptions) {
    this.tags = opts.tags;
    this.intervalMs = opts.intervalMs ?? SIM_INTERVAL_MS;
    this.clock = opts.clock ?? systemClock;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.t0 = this.clock.now();
    this.emit(true);
    this.timer = this.clock.setInterval(() => this.emit(false), this.intervalMs);
  }

  stop(): void {
    if (this.timer === null) return;
    this.clock.clearInterval(this.timer);
    this.timer = null;
  }

  /** Danh sách Tag của project đổi: đang chạy thì phát ngay bản đủ cho danh sách mới. */
  setTags(tags: readonly SimTag[]): void {
    this.tags = tags;
    if (this.running) this.emit(true);
  }

  private emit(all: boolean): void {
    if (all) this.last.clear();
    const elapsed = this.clock.now() - this.t0;
    const out: TagUpdate[] = [];
    this.tags.forEach((tag, i) => {
      const value = simValue(tag, i, elapsed);
      if (!all && this.last.get(tag.id) === value) return;
      this.last.set(tag.id, value);
      out.push({ id: tag.id, value, quality: 'GOOD' });
    });
    if (out.length) this.onChange?.(out);
  }
}
