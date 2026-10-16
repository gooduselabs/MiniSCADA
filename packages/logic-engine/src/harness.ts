// Bộ chạy mô phỏng quanh LogicEngine (dùng cho mô phỏng Studio T143, test và bộ vector): kho Tag (giá trị +
// quality), đồng hồ giả, quét ở mọi bội của scanMs, áp setTag/toggle sau mỗi quét (có hiệu lực ở quét sau), retain
// (flush, khởi động lại). Ngữ nghĩa giống bộ chạy vector của C++ (tests/logic-vectors/README.md).
import type { InputValue } from '@mat/expression';
import { LogicEngine } from './engine.ts';
import type {
  ActionOut,
  BlockState,
  EngineOptions,
  LogicDoc,
  LogicOutValue,
  OutputValue,
  RetainStore,
} from './types.ts';

export type HarnessOptions = EngineOptions;
export type HarnessValue = boolean | number | bigint | string | null | InputValue;

const NO_VALUE: InputValue = { value: null, quality: 'BAD', reason: 'NO_VALUE' };

export class LogicHarness {
  engine: LogicEngine;
  private doc: LogicDoc;
  private readonly opts: HarnessOptions;
  private readonly store = new Map<string, InputValue>();
  private lastScan: number | null = null;
  private wall: { base: number; at: number } | null = null;
  private synced = true;
  private flushed: RetainStore | null = null;

  constructor(doc: LogicDoc, opts: HarnessOptions) {
    this.doc = doc;
    this.opts = opts;
    this.engine = new LogicEngine(doc, opts);
  }

  get scanMs(): number {
    return this.engine.config.scanMs;
  }

  /** Thời điểm quét kế tiếp. */
  get nextScan(): number {
    return this.lastScan === null ? 0 : this.lastScan + this.scanMs;
  }

  set(id: string, v: HarnessValue): void {
    if (v === null) this.store.set(id, NO_VALUE);
    else if (typeof v === 'object' && 'quality' in v) this.store.set(id, v);
    else this.store.set(id, { value: typeof v === 'bigint' ? Number(v) : v, quality: 'GOOD' });
  }

  /** Giờ thực: bằng `epochMs` tại thời điểm `at` (mặc định quét kế tiếp), trôi cùng đồng hồ monotonic. */
  setWall(epochMs: number | null, synced = true, at = this.nextScan): void {
    this.wall = epochMs === null ? null : { base: epochMs, at };
    this.synced = synced;
  }

  setSynced(synced: boolean): void {
    this.synced = synced;
  }

  private read = (id: string): InputValue => this.store.get(id) ?? NO_VALUE;

  private scan(t: number): ActionOut[] {
    const wall = {
      epochMs: this.wall === null ? null : this.wall.base + (t - this.wall.at),
      synced: this.synced,
    };
    const actions = this.engine.step(t, this.read, wall);
    for (const a of actions)
      if ((a.do === 'setTag' || a.do === 'toggle') && a.result === 'OK' && a.value !== undefined)
        this.set(a.tag, a.value);
    this.lastScan = t;
    return actions;
  }

  /** Quét mọi bội của scanMs trong (lần quét trước, t]. */
  runTo(t: number): ActionOut[] {
    const out: ActionOut[] = [];
    for (let s = this.nextScan; s <= t; s += this.scanMs) out.push(...this.scan(s));
    return out;
  }

  /** Quét mọi bội của scanMs trong (lần quét trước, t). */
  runBefore(t: number): ActionOut[] {
    const out: ActionOut[] = [];
    for (let s = this.nextScan; s < t; s += this.scanMs) out.push(...this.scan(s));
    return out;
  }

  /** Ghi kho retain (như mỗi logic.flushS hoặc SIGTERM). */
  flush(): void {
    this.flushed = this.engine.retainSnapshot();
  }

  /**
   * Khởi động lại: engine mới (tài liệu mới nếu có: nạp xuống giữ khối theo id), kho Tag trống (mọi Tag chưa có giá
   * trị), retain = lần flush gần nhất (`flushed`, mặc định; chưa flush lần nào: kho trống), `lost` (hỏng) hoặc kho
   * cho sẵn. `at`: thời điểm quét đầu của engine mới (mặc định quét kế tiếp; không quét bù khoảng tắt máy).
   */
  restart(
    o: { doc?: LogicDoc; retain?: 'flushed' | 'lost' | RetainStore; at?: number } = {},
  ): void {
    if (o.doc) this.doc = o.doc;
    const r = o.retain ?? 'flushed';
    const retain = r === 'flushed' ? (this.flushed ?? {}) : r;
    if (o.at !== undefined) this.lastScan = o.at - this.scanMs;
    this.store.clear();
    this.engine = new LogicEngine(this.doc, { ...this.opts, retain });
  }

  writeResult(rule: string, result: string): void {
    this.engine.writeResult(rule, result);
  }

  output(tag: string): OutputValue | undefined {
    return this.engine.output(tag);
  }

  /** Giá trị của Tag logic, hoặc của Tag trong kho (setTag/toggle). */
  value(tag: string): LogicOutValue | null | undefined {
    const o = this.engine.output(tag);
    if (o !== undefined) return o.value;
    return this.store.get(tag)?.value;
  }

  state(id: string): BlockState {
    const s = this.engine.state(id);
    if (!s) throw new Error(`logic: không có khối '${id}'`);
    return s;
  }

  retainSnapshot(): RetainStore {
    return this.engine.retainSnapshot();
  }
}
