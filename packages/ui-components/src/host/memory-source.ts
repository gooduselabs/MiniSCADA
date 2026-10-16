// Nguồn thử cho test và xem trước (contracts/ui-components-api.md §2): MemoryTagSource, FakeActionHost.
import type { ValueTable } from '@mat/expression';
import { AlarmNotifier } from '../alarm/alarm-source.ts';
import { computeCounts } from '../alarm/alarm-format.ts';
import type {
  ActionHost,
  AlarmAckOutcome,
  AlarmAckRequest,
  AlarmActionOutcome,
  AlarmAreaInfo,
  AlarmClassInfo,
  AlarmCounts,
  AlarmInstance,
  AlarmShelveRequest,
  AlarmSnapshot,
  AlarmSource,
  AlarmSourceStatus,
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
  openPopup(id: string, args?: Record<string, string>): void {
    this.calls.push(args ? `popup:${id} ${JSON.stringify(args)}` : `popup:${id}`);
  }
  closePopup(): void {
    this.calls.push('closePopup');
  }
  requestLogin(): void {
    this.calls.push('login');
  }

  // ---- alarm (feature 009) ----
  readonly ackCalls: AlarmAckRequest[] = [];
  readonly shelveCalls: AlarmShelveRequest[] = [];
  readonly unshelveCalls: string[] = [];
  /** Kết quả của ba hàm alarm; mặc định: mọi mục ACKED, shelve và unshelve thành công. Có thể trả Promise treo. */
  ackHandler: (req: AlarmAckRequest) => AlarmAckOutcome | Promise<AlarmAckOutcome> = (req) => {
    const items = 'items' in req ? req.items : [];
    return {
      ok: true,
      results: items.map((i) => ({ id: i.id, occurrence: i.occurrence, result: 'ACKED' as const })),
      acked: items.length,
      skippedNewer: 0,
    };
  };
  shelveHandler: (req: AlarmShelveRequest) => AlarmActionOutcome | Promise<AlarmActionOutcome> =
    () => ({ ok: true, changed: true });
  unshelveHandler: (id: string) => AlarmActionOutcome | Promise<AlarmActionOutcome> = () => ({
    ok: true,
    changed: true,
  });

  ackAlarms(req: AlarmAckRequest): Promise<AlarmAckOutcome> {
    this.ackCalls.push(req);
    return Promise.resolve(this.ackHandler(req));
  }
  shelveAlarm(req: AlarmShelveRequest): Promise<AlarmActionOutcome> {
    this.shelveCalls.push(req);
    return Promise.resolve(this.shelveHandler(req));
  }
  unshelveAlarm(id: string): Promise<AlarmActionOutcome> {
    this.unshelveCalls.push(id);
    return Promise.resolve(this.unshelveHandler(id));
  }
}

export interface MemoryAlarmOptions {
  instances?: readonly AlarmInstance[];
  classes?: readonly AlarmClassInfo[];
  areas?: readonly AlarmAreaInfo[];
  status?: AlarmSourceStatus;
  now?: number;
  revision?: number;
}

/** AlarmSource giữ bản chụp do test đặt (contracts/ui-alarm.md §2). Thông báo gộp ở cuối microtask; `flush()` gọi ngay. */
export class MemoryAlarmSource implements AlarmSource {
  #snap: AlarmSnapshot;
  #status: AlarmSourceStatus;
  #now: number;
  readonly #n = new AlarmNotifier();

  constructor(opt: MemoryAlarmOptions = {}) {
    const instances = opt.instances ?? [];
    this.#snap = {
      instances,
      classes: opt.classes ?? [],
      areas: opt.areas ?? [],
      counts: computeCounts(instances),
      revision: opt.revision ?? Math.max(0, ...instances.map((i) => i.rev)),
    };
    this.#status = opt.status ?? 'live';
    this.#now = opt.now ?? 0;
  }

  snapshot(): AlarmSnapshot {
    return this.#snap;
  }
  counts(): AlarmCounts {
    return this.#snap.counts;
  }
  classes(): readonly AlarmClassInfo[] {
    return this.#snap.classes;
  }
  areas(): readonly AlarmAreaInfo[] {
    return this.#snap.areas;
  }
  status(): AlarmSourceStatus {
    return this.#status;
  }
  now(): number {
    return this.#now;
  }
  subscribe(fn: (c: readonly string[] | 'all') => void): () => void {
    return this.#n.subscribe(fn);
  }
  flush(): void {
    this.#n.flush();
  }

  setNow(t: number): void {
    this.#now = t;
  }
  advance(ms: number): void {
    this.#now += ms;
  }

  /** Thay toàn bộ instance (snapshot mới): người nghe nhận 'all'. */
  set(instances: readonly AlarmInstance[], over: Partial<AlarmSnapshot> = {}): void {
    this.#snap = {
      ...this.#snap,
      instances,
      counts: computeCounts(instances),
      revision: Math.max(this.#snap.revision, ...instances.map((i) => i.rev)),
      ...over,
    };
    this.#n.notify('all');
  }

  /** Thêm hoặc thay một instance theo `id`. */
  upsert(i: AlarmInstance): void {
    const next = [...this.#snap.instances.filter((x) => x.id !== i.id), i];
    this.#snap = {
      ...this.#snap,
      instances: next,
      counts: computeCounts(next),
      revision: Math.max(this.#snap.revision, i.rev),
    };
    this.#n.notify([i.id]);
  }

  remove(id: string): void {
    const next = this.#snap.instances.filter((x) => x.id !== id);
    if (next.length === this.#snap.instances.length) return;
    this.#snap = { ...this.#snap, instances: next, counts: computeCounts(next) };
    this.#n.notify([id]);
  }

  setStatus(s: AlarmSourceStatus): void {
    if (s === this.#status) return;
    this.#status = s;
    this.#snap = { ...this.#snap };
    this.#n.notify('all');
  }
}
