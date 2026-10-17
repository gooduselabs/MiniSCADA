// Bộ chạy "Thử logic" của Studio (feature 011, T143; FR-094; mockup studio-logic.html cảnh 2; Constitution II): ghép
// `@mat/logic-engine` (bản TS, cùng vector với core/logic) với `SimEngine` của 006 bằng một đồng hồ ảo. Mỗi lần quét
// (`scanMs`, mặc định 100 ms) đọc đầu vào từ Tag mô phỏng hoặc giá trị đặt tay (kèm quality); giờ thực cho khối Lịch là
// `epoch0` trôi cùng đồng hồ monotonic (nhảy được, monotonic không đổi), cờ `timeSynced` tắt được. Hành động: setTag,
// toggle, write, pulse được chấp nhận thì áp vào Tag MÔ PHỎNG (không bao giờ tới thiết bị), mọi hành động vào nhật ký.
// Tua ×1/×10/×100 vẫn quét đủ từng chu kỳ (không gộp bước), nên kết quả giống vector chung. Không DOM, không hẹn giờ thật.
import {
  compile,
  evaluate,
  type InputValue,
  type Program,
  type TableSet,
  type TagDataType,
  type ValueTable,
} from '@mat/expression';
import {
  LogicEngine,
  type ActionOut,
  type BlockState,
  type LogicConfig,
  type LogicOutValue,
} from '@mat/logic-engine';
import {
  LOGIC_BLOCK_KINDS,
  logicExpressions,
  logicOutputs,
  logicTagsFromList,
  type LogicDoc,
  type TagV1,
} from '@mat/project-schema';
import { SimEngine } from './sim-engine.ts';

export const LOGIC_SIM_SPEEDS = [1, 10, 100] as const;
export type LogicSimSpeed = (typeof LOGIC_SIM_SPEEDS)[number];
/** Khung nhìn của đường thời gian theo tốc độ (ms): 5 phút, 30 phút, 2 giờ. */
export const LOGIC_SIM_WINDOW: Readonly<Record<LogicSimSpeed, number>> = {
  1: 300_000,
  10: 1_800_000,
  100: 7_200_000,
};
/** Nhịp lấy mẫu cho đường thời gian (~600 điểm mỗi khung nhìn). */
const SAMPLE_MS: Readonly<Record<LogicSimSpeed, number>> = { 1: 500, 10: 3000, 100: 12_000 };
const LOG_MAX = 500;
const MARK_MAX = 2000;
/** Thứ Năm 2026-10-16 05:58:00 giờ thiết bị (UTC+07:00), như mockup. */
const DEFAULT_EPOCH0 = Date.UTC(2026, 9, 15, 22, 58, 0);
const NO_VALUE: InputValue = { value: null, quality: 'BAD', reason: 'NO_VALUE' };
const noopTimers = { setInterval: (): unknown => null, clearInterval: (): void => undefined };

export interface LogicSimOptions {
  doc: LogicDoc;
  tags: readonly TagV1[];
  tables?: readonly ValueTable[];
  scanMs?: number;
  tzOffsetMin?: number;
  writes?: 'on' | 'off';
  maxWritesPerMin?: number;
  /** Giờ thực (ms UTC) tại t = 0. */
  epoch0?: number;
}

export interface SimValue {
  value: LogicOutValue | null;
  quality: 'GOOD' | 'UNCERTAIN' | 'BAD';
  reason?: string;
}

export interface ManualValue {
  value: boolean | number | string | null;
  quality: 'GOOD' | 'UNCERTAIN' | 'BAD';
}

export type SimLogEntry = ActionOut;

export interface SimMark {
  t: number;
  kind: 'write' | 'reject' | 'suppressed';
  rule: string;
  write?: string;
  tag: string;
  value?: LogicOutValue;
}

export interface RuleSample {
  state: BlockState['state'];
  reason: string | null;
  /** Điều kiện tính ở quét này (null: unknown). */
  cond: boolean | null;
  /** Đang đếm hold: điều kiện khác trạng thái ổn định. */
  holding: boolean;
}

export interface SimSample {
  t: number;
  values: Record<string, SimValue>;
  rules: Record<string, RuleSample>;
}

/** Một bước của ca vector (tests/logic-vectors/README.md). */
export interface ScenarioStep {
  t: number;
  wall?: string;
  timeSynced?: boolean;
  set?: Record<string, unknown>;
  expect?: { actions: Array<Record<string, unknown>> };
}

export interface Scenario {
  id: string;
  doc: LogicDoc;
  tags: Record<string, { type: TagDataType; writable: boolean; kind?: string }>;
  config: Pick<LogicConfig, 'scanMs' | 'tzOffsetMin' | 'writes' | 'maxWritesPerMin'>;
  steps: ScenarioStep[];
}

const pad = (n: number) => String(n).padStart(2, '0');
/** ISO 8601 có độ lệch của thiết bị (`+07:00`). */
export function isoWithOffset(epochMs: number, tzOffsetMin: number): string {
  const d = new Date(epochMs + tzOffsetMin * 60_000);
  const sign = tzOffsetMin < 0 ? '-' : '+';
  const off = Math.abs(tzOffsetMin);
  const ms = d.getUTCMilliseconds();
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    (ms ? `.${String(ms).padStart(3, '0')}` : '') +
    `${sign}${pad(Math.floor(off / 60))}:${pad(off % 60)}`
  );
}

const plain = (v: InputValue): SimValue =>
  v.reason !== undefined && v.quality !== 'GOOD'
    ? { value: v.value, quality: v.quality, reason: v.reason }
    : { value: v.value, quality: v.quality };

const toNumberish = (v: LogicOutValue | null): boolean | number | string | null =>
  typeof v === 'bigint' ? Number(v) : v;

export class LogicSim {
  readonly config: LogicConfig;
  readonly epoch0: number;
  /** Lý do không chạy được (logic còn lỗi: biểu thức hỏng, vòng); null khi chạy được. */
  readonly error: string | null;
  /** Tag đầu vào mà biểu thức của logic đọc (không gồm Tag logic), theo id. */
  readonly inputs: readonly string[];
  /** Tag thiết bị mà mục writes ghi tới. */
  readonly writeTargets: readonly string[];
  readonly outputTags: readonly string[];
  readonly ruleIds: readonly string[];
  readonly sim: SimEngine;
  speed: LogicSimSpeed = 1;
  log: SimLogEntry[] = [];
  marks: SimMark[] = [];
  history: SimSample[] = [];
  stats = { writes: 0, rejected: 0, suppressed: 0 };
  private readonly opts: LogicSimOptions;
  private readonly tagTypes: Map<string, TagDataType>;
  private readonly whenProgs = new Map<string, ReturnType<typeof compile>>();
  private engine: LogicEngine | null = null;
  private last: number | null = null;
  private count = 0;
  private realAcc = 0;
  private wall: { epoch: number; at: number } = { epoch: 0, at: 0 };
  private synced = true;
  private readonly manual = new Map<string, ManualValue>();
  private pulses: Array<{ until: number; tag: string }> = [];
  private steps: ScenarioStep[] = [];
  private stepActions: Array<Record<string, unknown>> = [];
  private recorded = new Map<string, string>();
  private pendingWall = true;
  private pendingSynced = false;

  constructor(opts: LogicSimOptions) {
    this.opts = opts;
    this.epoch0 = opts.epoch0 ?? DEFAULT_EPOCH0;
    this.config = {
      scanMs: opts.scanMs ?? 100,
      tzOffsetMin: opts.tzOffsetMin ?? 420,
      writes: opts.writes ?? 'on',
      maxWritesPerMin: opts.maxWritesPerMin ?? 20,
    };
    const doc = opts.doc;
    const outs = logicOutputs(doc);
    this.outputTags = [...new Set(outs.map((o) => o.tag))];
    this.tagTypes = new Map(opts.tags.map((t) => [t.id, t.type]));
    for (const o of outs) if (!this.tagTypes.has(o.tag)) this.tagTypes.set(o.tag, o.type);
    const outSet = new Set(this.outputTags);
    const tables = new Set((opts.tables ?? []).map((t) => t.name).filter(Boolean) as string[]);
    const env = {
      tagType: (id: string) => this.tagTypes.get(id),
      hasTable: (n: string) => tables.has(n),
    };
    const inputs = new Set<string>();
    const take = (src: string, target: TagDataType) => {
      const r = compile(src, { ...env, target });
      if (r.ok) for (const id of r.inputs) if (!outSet.has(id)) inputs.add(id);
      return r;
    };
    for (const kind of LOGIC_BLOCK_KINDS)
      for (const b of (doc[kind] ?? []) as unknown as Array<Record<string, unknown>>)
        for (const [, src, target] of logicExpressions(kind, b)) take(src, target);
    for (const r of doc.rules ?? []) {
      this.whenProgs.set(r.id, compile(r.when, { ...env, target: 'BOOL' }));
      for (const a of [...(r.onRise ?? []), ...(r.onFall ?? [])])
        if (a.value && typeof a.value === 'object')
          take(a.value.expr, this.tagTypes.get(a.tag ?? '') ?? 'FLOAT64');
    }
    this.inputs = [...inputs].sort();
    this.writeTargets = [...new Set((doc.writes ?? []).map((w) => w.tag))];
    this.ruleIds = (doc.rules ?? []).map((r) => r.id).sort();
    let error: string | null = null;
    try {
      this.engine = this.newEngine();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    this.error = error;
    this.sim = new SimEngine({ clock: () => this.epoch0 + this.t, timers: noopTimers });
    this.sim.load(opts.tags, opts.tables ?? []);
    this.sim.start();
    this.reset();
  }

  private newEngine(): LogicEngine {
    return new LogicEngine(this.opts.doc, {
      tags: logicTagsFromList(this.opts.tags as TagV1[]),
      config: this.config,
      tables: new Map((this.opts.tables ?? []).filter((t) => t.name).map((t) => [t.name!, t])),
    });
  }

  get scanMs(): number {
    return this.config.scanMs;
  }

  /** Thời điểm (ms monotonic) của lần quét gần nhất; 0 trước lần quét đầu. */
  get t(): number {
    return this.last ?? 0;
  }

  get scans(): number {
    return this.count;
  }

  get timeSynced(): boolean {
    return this.synced;
  }

  /** Giờ thực giả lập tại lần quét gần nhất (ms UTC). */
  wallMs(at = this.t): number {
    return this.wall.epoch + (at - this.wall.at);
  }

  get windowMs(): number {
    return LOGIC_SIM_WINDOW[this.speed];
  }

  /** Về t = 0: engine mới, xóa đặt tay, nhật ký, mẫu, ghi đè trên Tag mô phỏng. */
  reset(): void {
    this.last = null;
    this.count = 0;
    this.realAcc = 0;
    this.wall = { epoch: this.epoch0, at: 0 };
    this.synced = true;
    this.manual.clear();
    this.pulses = [];
    this.log = [];
    this.marks = [];
    this.stats = { writes: 0, rejected: 0, suppressed: 0 };
    this.steps = [];
    this.stepActions = [];
    this.recorded.clear();
    this.pendingWall = true;
    this.pendingSynced = false;
    for (const id of this.opts.tags.map((t) => t.id)) this.sim.clearOverride(id);
    if (this.engine) this.engine = this.newEngine();
    this.sim.tick();
    this.history = [this.sample(0)];
  }

  setManual(tag: string, v: ManualValue): void {
    this.manual.set(tag, { ...v });
  }

  clearManual(tag: string): void {
    this.manual.delete(tag);
  }

  manualOf(tag: string): ManualValue | undefined {
    return this.manual.get(tag);
  }

  setSynced(on: boolean): void {
    if (on === this.synced) return;
    this.synced = on;
    this.pendingSynced = true;
  }

  /** Đặt giờ thực giả lập (ms UTC) tại quét kế tiếp; đồng hồ monotonic (hold, timer) không nhảy. */
  jumpWall(epochMs: number): void {
    const at = this.last === null ? 0 : this.last + this.scanMs;
    this.wall = { epoch: epochMs, at };
    this.pendingWall = true;
  }

  private read = (id: string): InputValue => {
    const m = this.manual.get(id);
    if (m) return m.value === null ? NO_VALUE : { value: m.value, quality: m.quality };
    const e = this.sim.get(id);
    if (!e || e.value === null) return NO_VALUE;
    return e.reason !== undefined
      ? { value: e.value, quality: e.quality, reason: e.reason }
      : { value: e.value, quality: e.quality };
  };

  /** Giá trị một Tag: đầu ra của engine với Tag logic, không thì đầu vào (đặt tay hoặc mô phỏng). */
  value(tag: string): SimValue | undefined {
    const o = this.engine?.output(tag);
    if (o) return o.reason !== undefined ? { ...o } : { value: o.value, quality: o.quality };
    if (!this.tagTypes.has(tag)) return undefined;
    return plain(this.read(tag));
  }

  state(id: string): BlockState {
    const s = this.engine?.state(id);
    if (!s) throw new Error(`logic-sim: no block '${id}'`);
    return s;
  }

  hasBlock(id: string): boolean {
    return this.engine?.state(id) !== undefined;
  }

  /** Một lần quét. */
  step(): ActionOut[] {
    const engine = this.engine;
    if (!engine) return [];
    const t = this.last === null ? 0 : this.last + this.scanMs;
    this.last = t;
    this.sim.tick();
    for (const p of this.pulses.filter((x) => x.until <= t)) this.sim.clearOverride(p.tag);
    this.pulses = this.pulses.filter((x) => x.until > t);
    this.record(t);
    const actions = engine.step(t, this.read, {
      epochMs: this.wallMs(t),
      synced: this.synced,
    });
    for (const a of actions) this.apply(a);
    this.count++;
    if (t % SAMPLE_MS[this.speed] === 0) this.history.push(this.sample(t));
    const keep = LOGIC_SIM_WINDOW[100] + 60_000;
    if (this.history.length > 4000 || (this.history[0] && this.history[0].t < t - keep))
      this.history = this.history.filter((h) => h.t >= t - keep).slice(-4000);
    return actions;
  }

  /** `n` lần quét liên tiếp; trả số lần đã quét (0 khi logic còn lỗi). */
  run(n: number): number {
    if (!this.engine) return 0;
    for (let i = 0; i < n; i++) this.step();
    return n;
  }

  /** Thời gian thật trôi `ms`: mỗi 100 ms thật chạy `speed` lần quét. */
  advanceRealMs(ms: number): number {
    this.realAcc += ms;
    let n = 0;
    while (this.realAcc >= 100) {
      this.realAcc -= 100;
      n += this.speed;
    }
    return this.run(n);
  }

  private apply(a: ActionOut): void {
    this.log.unshift(a);
    if (this.log.length > LOG_MAX) this.log.length = LOG_MAX;
    this.stepActions.push({
      t: a.t,
      rule: a.rule,
      edge: a.edge,
      do: a.do,
      tag: a.tag,
      ...(a.write !== undefined ? { write: a.write } : {}),
      ...(a.value !== undefined ? { value: toNumberish(a.value) } : {}),
      ...(a.ms !== undefined ? { ms: a.ms } : {}),
      result: a.result,
    });
    const v = a.value === undefined ? undefined : toNumberish(a.value);
    const set = (tag: string, value: boolean | number | string) => {
      const m = this.manual.get(tag);
      if (m) m.value = value;
      this.sim.probe(tag, value);
    };
    if (
      (a.do === 'setTag' || a.do === 'toggle') &&
      a.result === 'OK' &&
      v !== undefined &&
      v !== null
    )
      set(a.tag, v);
    if (a.do === 'write' || a.do === 'pulse') {
      const base = { t: a.t, rule: a.rule, tag: a.tag, ...(a.write ? { write: a.write } : {}) };
      if (a.result === 'QUEUED') {
        this.stats.writes++;
        if (v !== undefined && v !== null) set(a.tag, v);
        if (a.do === 'pulse' && a.ms !== undefined)
          this.pulses.push({ until: a.t + a.ms, tag: a.tag });
        this.mark({ ...base, kind: 'write', ...(a.value !== undefined ? { value: a.value } : {}) });
      } else if (a.result === 'SUPPRESSED') {
        this.stats.suppressed++;
        this.mark({ ...base, kind: 'suppressed' });
      } else {
        this.stats.rejected++;
        this.mark({ ...base, kind: 'reject' });
      }
    }
  }

  private mark(m: SimMark): void {
    this.marks.push(m);
    if (this.marks.length > MARK_MAX) this.marks.splice(0, this.marks.length - MARK_MAX);
  }

  private sample(t: number): SimSample {
    const values: Record<string, SimValue> = {};
    for (const id of [...this.inputs, ...this.writeTargets, ...this.outputTags]) {
      const v = this.value(id);
      if (v) values[id] = v;
    }
    const rules: Record<string, RuleSample> = {};
    for (const id of this.ruleIds) {
      const s = this.engine?.state(id);
      if (!s) continue;
      const cond = this.condOf(id);
      rules[id] = {
        state: s.state,
        reason: s.reason ?? null,
        cond,
        holding:
          s.state === 'OK' &&
          cond !== null &&
          s.stable !== null &&
          s.stable !== undefined &&
          cond !== s.stable,
      };
    }
    return { t, values, rules };
  }

  /** Điều kiện `when` tính lại trên ảnh chụp hiện tại (để vẽ, không ảnh hưởng engine). */
  private condOf(id: string): boolean | null {
    const r = this.whenProgs.get(id);
    if (!r || !r.ok) return null;
    const vals = r.program.inputs.map((tag) => {
      const o = this.engine?.output(tag);
      if (o) return { value: toNumberish(o.value), quality: o.quality } as InputValue;
      return this.read(tag);
    });
    const tables = new Map((this.opts.tables ?? []).filter((x) => x.name).map((x) => [x.name!, x]));
    const out = evaluateSafe(r.program, vals, tables);
    return typeof out === 'boolean' ? out : null;
  }

  // ---------- Lưu kịch bản (ca vector) ----------

  private record(t: number): void {
    const step: ScenarioStep = { t };
    if (this.pendingWall) step.wall = isoWithOffset(this.wallMs(t), this.config.tzOffsetMin);
    if (this.pendingSynced || (t === 0 && !this.synced)) step.timeSynced = this.synced;
    this.pendingWall = false;
    this.pendingSynced = false;
    const set: Record<string, unknown> = {};
    for (const id of this.inputs) {
      const v = this.read(id);
      const repr: unknown =
        v.value === null
          ? null
          : v.quality === 'GOOD'
            ? v.value
            : { value: v.value, quality: v.quality };
      const key = JSON.stringify(repr);
      if (this.recorded.get(id) !== key) {
        this.recorded.set(id, key);
        set[id] = repr;
      }
    }
    if (Object.keys(set).length) step.set = set;
    if (Object.keys(step).length > 1 && this.steps.length < 20_000) this.steps.push(step);
  }

  /** Kịch bản đã chạy thành ca vector (cùng định dạng tests/logic-vectors): kỳ vọng là mọi hành động đã phát sinh. */
  scenario(id: string): Scenario {
    const tags: Scenario['tags'] = {};
    const want = new Set([...this.inputs, ...this.writeTargets]);
    for (const r of this.opts.doc.rules ?? [])
      for (const a of [...(r.onRise ?? []), ...(r.onFall ?? [])]) if (a.tag) want.add(a.tag);
    for (const t of this.opts.tags)
      if (want.has(t.id))
        tags[t.id] = {
          type: t.type,
          writable: t.access === 'RW',
          ...(t.kind !== 'external' ? { kind: t.kind } : {}),
        };
    const steps = this.steps.map((s) => ({ ...s }));
    const end = { actions: this.stepActions.map((a) => ({ ...a })) };
    const last = steps.at(-1);
    if (last && last.t === this.t) last.expect = end;
    else steps.push({ t: this.t, expect: end });
    return {
      id,
      doc: JSON.parse(JSON.stringify(this.opts.doc)) as LogicDoc,
      tags,
      config: {
        scanMs: this.config.scanMs,
        tzOffsetMin: this.config.tzOffsetMin,
        writes: this.config.writes,
        maxWritesPerMin: this.config.maxWritesPerMin,
      },
      steps,
    };
  }
}

function evaluateSafe(p: Program, vals: InputValue[], tables: TableSet): unknown {
  try {
    const r = evaluate(p, (i) => vals[i]!, tables);
    return r.quality === 'GOOD' ? r.value : null;
  } catch {
    return null;
  }
}
