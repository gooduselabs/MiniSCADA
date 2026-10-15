// Nguồn mô phỏng của Studio (feature 006, T202, FR-052, data-model §13.4, contract value-tables-simulation §2.3):
// - Tag có `sim`: chạy theo `sim` (@mat/tag-sim, cùng vector với runtime, SC-017);
// - Tag ngoài chưa có `sim`: bộ sinh mặc định theo kiểu (`defaultSim`); Tag nội bộ: `initial`;
// - Tag tính toán: tính bằng @mat/expression theo thứ tự tô-pô (`buildCalcGraph`), cùng bộ tính với runtime;
// - mỗi lượt 250 ms với `t = Date.now()`; ghi tay áp ngay vào bảng ghi đè (giữ tới khi tắt Mô phỏng) rồi tính lại;
// - project 0.1 mở chỉ đọc: Tag mock chạy bằng `LegacyMock` (bước 250 ms từ lúc bật).
// Thay `sim-source.ts` của 004. Không DOM, không mạng, không DeviceLink: chỉ tính trong bộ nhớ.
import {
  buildCalcGraph,
  compile,
  evaluate,
  type InputValue,
  type Program,
  type TagDataType,
  type ValueTable,
} from '@mat/expression';
import type { TagDefinition, TagV1 } from '@mat/project-schema';
import {
  LegacyMock,
  defaultSim,
  simValue,
  toTagType,
  type SimConfig,
  type SimValue,
} from '@mat/tag-sim';

export const SIM_INTERVAL_MS = 250;

export type SimTagValue = boolean | number | string | null;
export type SimQuality = 'GOOD' | 'BAD' | 'UNCERTAIN';

export interface SimEntry {
  value: SimTagValue;
  quality: SimQuality;
  reason?: string;
  /** ms UTC của lượt tính. */
  ts: number;
}

export interface SimChange extends SimEntry {
  id: string;
}

export type WriteRefusal = 'unknown' | 'calculated' | 'readonly';
export type SimWriteResult = { ok: true } | { ok: false; reason: WriteRefusal };

export interface SimTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface SimEngineOptions {
  /** Đồng hồ (ms UTC); mặc định `Date.now`. */
  clock?: () => number;
  timers?: SimTimers;
}

type Kind = 'external' | 'internal' | 'calculated' | 'simulation';

interface Prepared {
  id: string;
  type: TagDataType;
  kind: Kind;
  sim: SimConfig | null;
  initial: boolean | number | string | undefined;
  writable: boolean;
  /** Tag tính toán: chương trình đã biên dịch (null: lỗi biểu thức); đầu vào theo thứ tự trong chương trình. */
  program: Program | null;
  inputs: readonly string[];
  /** Chỉ số trong LegacyMock (sim `legacy`). */
  legacy: number;
}

const systemTimers: SimTimers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

const emptyOf = (type: TagDataType): boolean | number | string =>
  type === 'BOOL' ? false : type === 'STRING' ? '' : 0;

/** Giá trị cho giao diện: số nguyên 64 bit ngoài khoảng chính xác của số thực thành chuỗi thập phân. */
function present(v: SimValue): SimTagValue {
  if (typeof v !== 'bigint') return v;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : v.toString();
}

const isV02 = (tag: TagV1 | TagDefinition): tag is TagV1 => typeof (tag as TagV1).kind === 'string';

function prepare(tag: TagV1 | TagDefinition): Prepared {
  if (!isV02(tag)) {
    // Project 0.1: Tag mock chạy bằng bản port của MockTagProvider.
    return {
      id: tag.id,
      type: tag.type,
      kind: 'external',
      sim: { kind: 'legacy', signal: tag.source.signal },
      initial: undefined,
      writable: false,
      program: null,
      inputs: [],
      legacy: -1,
    };
  }
  let sim: SimConfig | null = null;
  if (tag.kind === 'simulation') sim = tag.sim ?? { kind: 'const', value: emptyOf(tag.type) };
  else if (tag.kind === 'external')
    sim =
      tag.sim ??
      defaultSim({
        id: tag.id,
        type: tag.type,
        ...(tag.min !== undefined && tag.max !== undefined ? { min: tag.min, max: tag.max } : {}),
      });
  return {
    id: tag.id,
    type: tag.type,
    kind: tag.kind,
    sim,
    initial: tag.initial,
    writable: tag.kind !== 'calculated' && tag.access === 'RW',
    program: null,
    inputs: [],
    legacy: -1,
  };
}

const sameEntry = (a: SimEntry | undefined, b: SimEntry): boolean =>
  a !== undefined && a.value === b.value && a.quality === b.quality && a.reason === b.reason;

export class SimEngine {
  private readonly clock: () => number;
  private readonly timers: SimTimers;
  private tags: Prepared[] = [];
  private byId = new Map<string, Prepared>();
  private order: Prepared[] = [];
  private tables = new Map<string, ValueTable>();
  private legacyTags: Prepared[] = [];
  private mock: LegacyMock | null = null;
  private legacyLast = new Map<
    number,
    { value: SimTagValue; quality: SimQuality; reason?: string }
  >();
  private readonly overrides = new Map<string, boolean | number | string>();
  private current = new Map<string, SimEntry>();
  private listeners = new Set<(changes: SimChange[]) => void>();
  private timer: unknown = null;
  private active = false;

  constructor(opts: SimEngineOptions = {}) {
    this.clock = opts.clock ?? (() => Date.now());
    this.timers = opts.timers ?? systemTimers;
  }

  get running(): boolean {
    return this.active;
  }

  /** Giá trị hiện tại của mọi Tag (chỉ đọc). */
  get entries(): ReadonlyMap<string, SimEntry> {
    return this.current;
  }

  get(id: string): SimEntry | undefined {
    return this.current.get(id);
  }

  subscribe(listener: (changes: SimChange[]) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Nạp danh sách Tag và bảng giá trị; đang chạy thì phát lại đầy đủ cho danh sách mới. */
  load(tags: readonly (TagV1 | TagDefinition)[], tables: readonly ValueTable[]): void {
    this.tags = tags.map(prepare);
    this.byId = new Map(this.tags.map((t) => [t.id, t]));
    this.tables = new Map(tables.filter((t) => t.name).map((t) => [t.name!, t]));
    const types = new Map(this.tags.map((t) => [t.id, t.type]));
    const calcs = this.tags.filter((t) => t.kind === 'calculated');
    const sources = new Map(
      tags.filter(isV02).map((t) => [t.id, typeof t.expression === 'string' ? t.expression : '']),
    );
    for (const c of calcs) {
      const r = compile(sources.get(c.id) ?? '', {
        tagType: (id) => types.get(id),
        hasTable: (name) => this.tables.has(name),
        target: c.type,
      });
      if (r.ok) {
        c.program = r.program;
        c.inputs = r.program.inputs;
      }
    }
    const graph = buildCalcGraph(calcs.map((c) => ({ id: c.id, inputs: c.inputs })));
    this.order = graph.order.map((id) => this.byId.get(id)!);
    this.legacyTags = this.tags.filter((t) => t.sim?.kind === 'legacy');
    this.legacyTags.forEach((t, i) => (t.legacy = i));
    this.mock = null;
    this.legacyLast.clear();
    this.current = new Map();
    if (this.active) this.recompute(this.clock(), true);
  }

  /** Bật: có ngay giá trị đủ mọi Tag, rồi mỗi 250 ms. */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.mock = null;
    this.legacyLast.clear();
    this.recompute(this.clock(), true);
    this.timer = this.timers.setInterval(
      () => this.recompute(this.clock(), false),
      SIM_INTERVAL_MS,
    );
  }

  /** Tắt: ngừng hẹn giờ, bỏ giá trị ghi đè và giá trị đã tính. */
  stop(): void {
    if (this.timer !== null) this.timers.clearInterval(this.timer);
    this.timer = null;
    this.active = false;
    this.overrides.clear();
    this.mock = null;
    this.legacyLast.clear();
    this.current = new Map();
  }

  /** Tính một lượt tại đồng hồ hiện tại (test, xem trước một lần). Trả các Tag đổi. */
  tick(): SimChange[] {
    return this.recompute(this.clock(), false);
  }

  /** Vì sao không ghi được Tag này (không có Tag, Tag tính toán, Tag chỉ đọc); null: ghi được. */
  writable(id: string): WriteRefusal | null {
    const tag = this.byId.get(id);
    if (!tag) return 'unknown';
    if (tag.kind === 'calculated') return 'calculated';
    return tag.writable ? null : 'readonly';
  }

  /** Ghi tay: áp ngay (Tag tính toán phụ thuộc cũng cập nhật ngay), giữ tới khi tắt Mô phỏng. */
  write(id: string, value: boolean | number | string): SimWriteResult {
    const refusal = this.writable(id);
    if (refusal) return { ok: false, reason: refusal };
    this.overrides.set(id, this.normalize(id, value));
    this.recompute(this.clock(), false);
    return { ok: true };
  }

  /**
   * Đặt giá trị thử (feature 008, thanh Thử giá trị): như `write` nhưng cho cả Tag chỉ đọc (thử cách hiển thị không cần quyền
   * ghi); vẫn từ chối Tag lạ và Tag tính toán. Giữ tới `clearOverride` hoặc tắt Mô phỏng; không bao giờ tới thiết bị.
   */
  probe(id: string, value: boolean | number | string): SimWriteResult {
    const tag = this.byId.get(id);
    if (!tag) return { ok: false, reason: 'unknown' };
    if (tag.kind === 'calculated') return { ok: false, reason: 'calculated' };
    this.overrides.set(id, this.normalize(id, value));
    this.recompute(this.clock(), false);
    return { ok: true };
  }

  /** Giá trị ghi tay đang giữ cho Tag (feature 008: thanh Thử giá trị khôi phục giá trị cũ). */
  override(id: string): boolean | number | string | undefined {
    return this.overrides.get(id);
  }

  /** Bỏ giá trị ghi tay của Tag: Tag về giá trị mô phỏng theo cấu hình. Trả `true` khi có giá trị để bỏ. */
  clearOverride(id: string): boolean {
    if (!this.overrides.delete(id)) return false;
    this.recompute(this.clock(), false);
    return true;
  }

  /** Giá trị gõ dạng chữ (INT64 lớn, số) thành giá trị đúng kiểu của Tag. */
  private normalize(id: string, value: boolean | number | string): boolean | number | string {
    const type = this.byId.get(id)?.type;
    if (typeof value === 'string' && type !== undefined && type !== 'STRING' && type !== 'BOOL') {
      const n = Number(value);
      return Number.isFinite(n) ? n : value;
    }
    return value;
  }

  // ---------- Tính ----------

  private sample(tag: Prepared, t: number): SimEntry {
    const override = this.overrides.get(tag.id);
    if (tag.kind === 'internal') {
      const raw = override ?? tag.initial ?? emptyOf(tag.type);
      return { value: present(toTagType(raw, tag.type)), quality: 'GOOD', ts: t };
    }
    const sim = tag.sim!;
    if (sim.kind === 'legacy') {
      const last = this.legacyLast.get(tag.legacy);
      if (override !== undefined)
        return { value: present(toTagType(override, tag.type)), quality: 'GOOD', ts: t };
      if (!last) return { value: null, quality: 'BAD', reason: 'NO_VALUE', ts: t };
      return {
        value: last.value,
        quality: last.quality,
        ...(last.reason !== undefined ? { reason: last.reason } : {}),
        ts: t,
      };
    }
    if (sim.kind === 'manual')
      return { value: present(simValue(sim, t, tag.type, override)), quality: 'GOOD', ts: t };
    if (override !== undefined)
      return { value: present(toTagType(override, tag.type)), quality: 'GOOD', ts: t };
    return { value: present(simValue(sim, t, tag.type)), quality: 'GOOD', ts: t };
  }

  private stepLegacy(t: number): void {
    if (this.legacyTags.length === 0) return;
    this.mock ??= new LegacyMock(
      this.legacyTags.map((tg, i) => ({ tag: i, signal: tg.sim?.signal ?? '' })),
    );
    for (const u of this.mock.step(t))
      this.legacyLast.set(u.tag, {
        value: u.value,
        quality: u.quality,
        ...(u.reason !== undefined ? { reason: u.reason } : {}),
      });
  }

  private recompute(t: number, all: boolean): SimChange[] {
    this.stepLegacy(t);
    const next = new Map<string, SimEntry>();
    for (const tag of this.tags)
      if (tag.kind !== 'calculated') next.set(tag.id, this.sample(tag, t));
    const done = new Set<string>();
    for (const tag of this.order) {
      done.add(tag.id);
      next.set(tag.id, this.calculate(tag, next, t));
    }
    // Tag tính toán nằm trong vòng tham chiếu: không tính được.
    for (const tag of this.tags)
      if (tag.kind === 'calculated' && !done.has(tag.id))
        next.set(tag.id, this.held(tag, 'INPUT_BAD', t));
    const changes: SimChange[] = [];
    for (const tag of this.tags) {
      const e = next.get(tag.id)!;
      if (all || !sameEntry(this.current.get(tag.id), e)) changes.push({ id: tag.id, ...e });
    }
    this.current = next;
    if (changes.length) for (const l of [...this.listeners]) l(changes);
    return changes;
  }

  private held(tag: Prepared, reason: string, t: number): SimEntry {
    const prev = this.current.get(tag.id);
    return { value: prev?.value ?? null, quality: 'BAD', reason, ts: t };
  }

  private calculate(tag: Prepared, values: ReadonlyMap<string, SimEntry>, t: number): SimEntry {
    if (!tag.program) return this.held(tag, 'NO_VALUE', t);
    const r = evaluate(
      tag.program,
      (i): InputValue => {
        const e = values.get(tag.inputs[i]!);
        if (!e) return { value: null, quality: 'BAD', reason: 'NO_VALUE' };
        return {
          value: e.value,
          quality: e.quality,
          ...(e.reason !== undefined ? { reason: e.reason } : {}),
        };
      },
      this.tables,
    );
    if (r.value === undefined) return this.held(tag, r.reason ?? 'INPUT_BAD', t);
    return {
      value: present(r.value),
      quality: r.quality,
      ...(r.reason !== undefined ? { reason: r.reason } : {}),
      ts: t,
    };
  }
}

/** Giá trị mô phỏng của mọi Tag tại thời điểm `now` (xem trước biểu thức khi chưa bật Mô phỏng). */
export function simSnapshot(
  tags: readonly (TagV1 | TagDefinition)[],
  tables: readonly ValueTable[],
  now: number,
): ReadonlyMap<string, SimEntry> {
  const e = new SimEngine({ clock: () => now });
  e.load(tags, tables);
  e.tick();
  return e.entries;
}
