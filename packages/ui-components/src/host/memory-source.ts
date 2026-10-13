// Nguồn thử cho test và xem trước (contracts/ui-components-api.md §2): MemoryTagSource, FakeActionHost.
import type { ValueTable } from '@mat/expression';
import type {
  ActionHost,
  SessionInfo,
  TagInfo,
  TagSource,
  TagState,
  WriteBlockCode,
  WriteOutcome,
  WriteSpec,
} from './types.ts';

type Listener = { ids: ReadonlySet<string>; fn: (changed: readonly string[]) => void };

export interface MemorySourceOptions {
  tags?: TagInfo[];
  tables?: Record<string, ValueTable>;
  now?: number;
  connection?: 'live' | 'stale' | 'offline';
}

export class MemoryTagSource implements TagSource {
  connection: 'live' | 'stale' | 'offline';
  #infos = new Map<string, TagInfo>();
  #states = new Map<string, TagState>();
  #tables = new Map<string, ValueTable>();
  #listeners = new Set<Listener>();
  #now: number;
  #batch: Set<string> | null = null;

  constructor(opt: MemorySourceOptions = {}) {
    for (const t of opt.tags ?? []) this.#infos.set(t.id, t);
    for (const [k, v] of Object.entries(opt.tables ?? {})) this.#tables.set(k, v);
    this.#now = opt.now ?? 0;
    this.connection = opt.connection ?? 'live';
  }

  define(info: TagInfo): void {
    this.#infos.set(info.id, info);
  }

  info(id: string): TagInfo | undefined {
    return this.#infos.get(id);
  }

  get(id: string): TagState {
    return this.#states.get(id) ?? { value: null, quality: 'UNKNOWN' };
  }

  valueTable(name: string): ValueTable | undefined {
    return this.#tables.get(name);
  }

  now(): number {
    return this.#now;
  }

  advance(ms: number): void {
    this.#now += ms;
  }

  setNow(t: number): void {
    this.#now = t;
  }

  subscribe(ids: readonly string[], onChange: (changed: readonly string[]) => void): () => void {
    const l: Listener = { ids: new Set(ids), fn: onChange };
    this.#listeners.add(l);
    return () => {
      this.#listeners.delete(l);
    };
  }

  /** Đặt giá trị (gộp vào trạng thái cũ). Tag chưa có trạng thái bắt đầu từ `GOOD`. */
  set(id: string, patch: Partial<TagState>): void {
    const prev = this.#states.get(id) ?? { value: null, quality: 'GOOD' as const };
    this.#states.set(id, { ...prev, ...patch });
    this.#changed([id]);
  }

  batch(fn: () => void): void {
    const outer = this.#batch;
    const acc = outer ?? new Set<string>();
    this.#batch = acc;
    try {
      fn();
    } finally {
      this.#batch = outer;
    }
    if (!outer && acc.size > 0) this.#emit([...acc]);
  }

  setConnection(c: 'live' | 'stale' | 'offline'): void {
    this.connection = c;
    // Báo mọi người đăng ký: trạng thái khóa phụ thuộc kết nối.
    this.#emit([...this.#infos.keys()]);
  }

  #changed(ids: string[]): void {
    if (this.#batch) {
      for (const i of ids) this.#batch.add(i);
      return;
    }
    this.#emit(ids);
  }

  #emit(ids: string[]): void {
    for (const l of [...this.#listeners]) {
      const hit = ids.filter((i) => l.ids.has(i));
      if (hit.length > 0) l.fn(hit);
    }
  }
}

export interface FakeHostOptions {
  session?: SessionInfo | null;
  blocked?: { code: WriteBlockCode; message: string } | null;
}

/** ActionHost giả: ghi lại lời gọi; `resolve` phát kết quả (ACCEPTED qua onPhase, còn lại trả về). */
export class FakeActionHost implements ActionHost {
  sessionInfo: SessionInfo | null;
  blocked: { code: WriteBlockCode; message: string } | null;
  readonly writes: WriteSpec[] = [];
  readonly calls: string[] = [];
  #pending: Array<{ onPhase: (o: WriteOutcome) => void; done: (o: WriteOutcome) => void }> = [];

  constructor(opt: FakeHostOptions = {}) {
    this.sessionInfo = opt.session ?? null;
    this.blocked = opt.blocked ?? null;
  }

  session(): SessionInfo | null {
    return this.sessionInfo;
  }

  writeBlocked(): { code: WriteBlockCode; message: string } | null {
    return this.blocked;
  }

  write(spec: WriteSpec, onPhase: (o: WriteOutcome) => void): Promise<WriteOutcome> {
    this.writes.push(spec);
    return new Promise((done) => {
      this.#pending.push({ onPhase, done });
    });
  }

  /** Phát một kết quả cho lệnh ghi cũ nhất đang chờ: ACCEPTED là pha giữa, trạng thái khác là kết quả cuối. */
  resolve(o: WriteOutcome): void {
    const p = this.#pending[0];
    if (!p) throw new Error('no pending write');
    if (o.status === 'ACCEPTED') {
      p.onPhase(o);
      return;
    }
    this.#pending.shift();
    p.done(o);
  }

  navigate(id: string): void {
    this.calls.push(`navigate:${id}`);
  }
  openPopup(id: string): void {
    this.calls.push(`popup:${id}`);
  }
  closePopup(): void {
    this.calls.push('closePopup');
  }
  requestLogin(): void {
    this.calls.push('login');
  }
}
