// Bộ cộng dồn tổng hợp (specs/010-history-reports/contracts/history-db.md §3), bản TS dùng cho nguồn mô phỏng
// của Studio. Cùng quy tắc với core/historian/aggregator.* và cùng vector tests/agg-vectors (README.md ở đó).
import { HOUR_MS, MINUTE_MS, mergeAll, type AggBucket } from './agg.ts';

/** Hàng bucket kèm khóa `bucket` (đầu cửa sổ, UTC ms). */
export type BucketRow = AggBucket & { bucket: number };

interface Window {
  b: number;
  n: number;
  min: number;
  max: number;
  first: number | undefined;
  last: number | undefined;
  sumw: number;
  wms: number;
}

/** Bộ cộng dồn cho một cột; đầu ra là danh sách cửa sổ phút đã đóng (`drain`). */
export class Aggregator {
  private held: number | undefined;
  private since = 0;
  private cur: Window | undefined;
  private pending: BucketRow[] = [];

  /** Dòng thô tại `t` (UTC ms): `v` là số (BOOL 0/1) hoặc `null`. */
  row(t: number, v: number | null): void {
    this.advance(t);
    if (this.cur === undefined) this.open(Math.floor(t / MINUTE_MS) * MINUTE_MS);
    if (v === null) {
      this.held = undefined;
      return;
    }
    const w = this.cur!;
    w.n += 1;
    w.min = Math.min(w.min, v);
    w.max = Math.max(w.max, v);
    if (w.first === undefined) w.first = v;
    w.last = v;
    this.held = v;
    this.since = t;
  }

  /** Thời gian trôi tới `now`: cộng đoạn giữ, đóng các cửa sổ phút đã qua. */
  advance(now: number): void {
    while (this.cur !== undefined) {
      const end = this.cur.b + MINUTE_MS;
      if (end > now) break;
      if (this.held !== undefined) this.addSegment(this.since, end);
      this.close();
      if (this.held === undefined) return;
      this.since = end;
      this.open(end); // tín hiệu còn giữ: first của cửa sổ mới là giá trị mang
    }
    if (this.cur !== undefined && this.held !== undefined && now > this.since) {
      this.addSegment(this.since, now);
      this.since = now;
    }
  }

  /** Gián đoạn (khởi động, đồng hồ nhảy, ghi tạm dừng, lỗi, nạp lại cấu hình): đóng cửa sổ dở, bỏ tín hiệu giữ. */
  break(now: number): void {
    this.advance(now);
    this.close();
    this.held = undefined;
  }

  /** Lấy và xóa danh sách cửa sổ phút đã đóng, theo thứ tự đóng. */
  drain(): BucketRow[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  private open(b: number): void {
    this.cur = {
      b,
      n: 0,
      min: Infinity,
      max: -Infinity,
      first: this.held,
      last: undefined,
      sumw: 0,
      wms: 0,
    };
  }

  private addSegment(a: number, b: number): void {
    const w = this.cur!;
    const len = b - a;
    if (len <= 0 || this.held === undefined) return;
    w.wms += len;
    w.sumw += this.held * len;
    w.min = Math.min(w.min, this.held);
    w.max = Math.max(w.max, this.held);
    w.last = this.held;
    if (w.first === undefined) w.first = this.held;
  }

  private close(): void {
    const w = this.cur;
    this.cur = undefined;
    if (w === undefined || (w.n === 0 && w.wms === 0)) return;
    this.pending.push({
      bucket: w.b,
      n: w.n,
      min: w.min,
      max: w.max,
      first: w.first!,
      last: w.last!,
      sumw: w.sumw,
      wms: w.wms,
    });
  }
}

/** Bảng `mat_agg` trong bộ nhớ: upsert ghép hàng phút, dựng hàng giờ khi giờ đóng. */
export class AggStore {
  readonly minute = new Map<number, BucketRow>();
  readonly hour = new Map<number, BucketRow>();

  /** `INSERT ... ON CONFLICT DO UPDATE`: `first` giữ của hàng đầu, `last` lấy của hàng sau. */
  upsertMinute(r: BucketRow): void {
    const old = this.minute.get(r.bucket);
    if (!old) return void this.minute.set(r.bucket, { ...r });
    this.minute.set(r.bucket, {
      bucket: r.bucket,
      n: old.n + r.n,
      min: Math.min(old.min, r.min),
      max: Math.max(old.max, r.max),
      first: old.first,
      last: r.last,
      sumw: old.sumw + r.sumw,
      wms: old.wms + r.wms,
    });
  }

  /** Dựng (thay) hàng giờ cho mọi giờ đã đóng (`h + 3.600.000 <= now`) có hàng phút. */
  closeHours(now: number): void {
    const hours = new Set([...this.minute.keys()].map((b) => Math.floor(b / HOUR_MS) * HOUR_MS));
    for (const h of hours) {
      if (h + HOUR_MS > now) continue;
      const rows = [...this.minute.values()]
        .filter((r) => r.bucket >= h && r.bucket < h + HOUR_MS)
        .sort((a, b) => a.bucket - b.bucket);
      this.hour.set(h, { bucket: h, ...mergeAll(rows)! });
    }
  }

  rows(res: 60000 | 3600000): BucketRow[] {
    return [...(res === 60000 ? this.minute : this.hour).values()].sort(
      (a, b) => a.bucket - b.bucket,
    );
  }
}

/** Sự kiện của vector `tests/agg-vectors` (README.md ở đó). */
export type AggEvent =
  | { t: number; op: 'row'; values: Record<string, number | null> }
  | { t: number; op: 'advance' | 'break' | 'jump'; to?: number };

/** Chạy dãy sự kiện cho một cột; trả hàng phút và hàng giờ đã ghi. */
export function runEvents(events: AggEvent[], col: string): Record<60000 | 3600000, BucketRow[]> {
  const agg = new Aggregator();
  const store = new AggStore();
  let tMax = -Infinity;
  const flush = () => agg.drain().forEach((r) => store.upsertMinute(r));
  for (const e of events) {
    tMax = Math.max(tMax, e.t);
    if (e.op === 'row') {
      if (Object.hasOwn(e.values, col)) agg.row(e.t, e.values[col]!);
      else agg.advance(e.t);
    } else if (e.op === 'advance') agg.advance(e.t);
    else agg.break(e.t); // break và jump
    flush();
  }
  store.closeHours(tMax);
  return { 60000: store.rows(60000), 3600000: store.rows(3600000) };
}
