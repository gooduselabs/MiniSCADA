// Engine logic v2 (contracts/logic-engine.md; ADR-037; R20-R23). Thuần: đồng hồ monotonic (`now`) và giờ thực
// (`wall`) do bên gọi tiêm vào mỗi lần quét, không đọc Date.now(); không I/O. Tài liệu phải đã qua validator
// (checkLogic không lỗi): biểu thức không biên dịch được hoặc có vòng thì constructor ném lỗi.
//
// Một lần quét `step(now, read, wall)`: các khối chạy theo thứ tự tô-pô ổn định (logicOrder của @mat/project-schema,
// hòa thì theo id); khối đọc đầu ra của khối đứng trước thấy giá trị của chính quét này; mọi Tag khác đọc từ ảnh
// chụp `read` (setTag/toggle do bên gọi áp sau quét, có hiệu lực ở quét sau).
import type { TableSet } from '@mat/expression';
import { logicOrder, logicOutputs, type LogicEnv, type LogicOutput } from '@mat/project-schema';
import type { Block, ScanCtx } from './block.ts';
import { CounterBlock } from './counters.ts';
import { Expr } from './expr.ts';
import { Bucket, RuleBlock, WriteGate, type CompiledAction, type RuleEnv } from './rules.ts';
import { RunhoursBlock } from './runhours.ts';
import { ScheduleBlock } from './schedule.ts';
import { TimerBlock } from './timers.ts';
import { TotalizerBlock } from './totalizer.ts';
import {
  DEFAULT_CONFIG,
  type ActionOut,
  type BlockState,
  type EngineOptions,
  type LogicConfig,
  type LogicDoc,
  type LogicOutValue,
  type LogicRule,
  type LogicTagInfo,
  type OutputValue,
  type ReadTag,
  type RetainStore,
  type WallClock,
} from './types.ts';

const isExprValue = (v: unknown): v is { expr: string } =>
  typeof v === 'object' && v !== null && typeof (v as { expr?: unknown }).expr === 'string';

export class LogicEngine {
  readonly config: LogicConfig;
  /** Kho retain hỏng lúc khởi động (cảnh báo LOGIC_RETAIN_LOST, audit `logic.retain.lost`). */
  readonly retainLost: boolean;
  private readonly blocks = new Map<string, Block>();
  private readonly order: Block[];
  private readonly outputs = new Map<string, OutputValue>();
  private readonly outputDefs: ReadonlyMap<string, LogicOutput>;
  private readonly tables: TableSet;
  private now = 0;

  constructor(doc: LogicDoc, opts: EngineOptions) {
    this.config = { ...DEFAULT_CONFIG, ...opts.config };
    this.tables = opts.tables ?? new Map();
    const tags: ReadonlyMap<string, LogicTagInfo> =
      opts.tags instanceof Map ? opts.tags : new Map(Object.entries(opts.tags));
    this.retainLost = opts.retain === 'lost';
    const store = opts.retain === 'lost' ? undefined : opts.retain;
    const outs = new Map<string, LogicOutput>();
    for (const o of logicOutputs(doc)) if (!outs.has(o.tag)) outs.set(o.tag, o);
    this.outputDefs = outs;
    const env: LogicEnv = {
      tagType: (id) => tags.get(id)?.type ?? outs.get(id)?.type,
      hasTable: (name) => this.tables.has(name),
    };
    const ex = (src: string, target: 'BOOL' | 'FLOAT64', where: string) =>
      new Expr(src, target, env, where);
    const exOpt = (src: string | null | undefined, where: string) =>
      typeof src === 'string' ? ex(src, 'BOOL', where) : null;
    const tables = this.tables;

    const gates = new Map((doc.writes ?? []).map((w) => [w.id, new WriteGate(w)]));
    const ruleEnv: RuleEnv = {
      tables,
      config: this.config,
      bucket: new Bucket(this.config.maxWritesPerMin),
    };
    const compileActions = (list: LogicRule, edge: 'onRise' | 'onFall') =>
      (list[edge] ?? []).map((a, i): CompiledAction => {
        const where = `${list.id}.${edge}[${i}]`;
        const gate = a.write !== undefined ? gates.get(a.write) : undefined;
        if ((a.do === 'write' || a.do === 'pulse') && !gate)
          throw new Error(`logic: ${where}: writes '${a.write}' không có`);
        const tag = gate ? gate.def.tag : a.tag!;
        const type = tags.get(tag)?.type;
        if (type === undefined) throw new Error(`logic: ${where}: Tag '${tag}' không có`);
        const c: CompiledAction = { do: a.do as CompiledAction['do'], tag };
        if (gate) c.write = gate;
        if (a.ms !== undefined) c.ms = a.ms;
        if (isExprValue(a.value)) c.expr = new Expr(a.value.expr, type, env, where);
        else if (a.value !== undefined) c.value = a.value;
        return c;
      });

    for (const r of doc.rules ?? [])
      this.add(
        new RuleBlock(
          r,
          ex(r.when, 'BOOL', `${r.id}.when`),
          compileActions(r, 'onRise'),
          compileActions(r, 'onFall'),
          ruleEnv,
          store,
        ),
      );
    for (const t of doc.timers ?? [])
      this.add(new TimerBlock(t, ex(t.in, 'BOOL', `${t.id}.in`), this.config.scanMs, tables));
    for (const c of doc.counters ?? [])
      this.add(
        new CounterBlock(
          c,
          [
            ex(c.up, 'BOOL', `${c.id}.up`),
            exOpt(c.down, `${c.id}.down`),
            exOpt(c.reset, `${c.id}.reset`),
          ],
          tables,
          store,
        ),
      );
    for (const z of doc.totalizers ?? [])
      this.add(
        new TotalizerBlock(
          z,
          ex(z.source, 'FLOAT64', `${z.id}.source`),
          exOpt(z.reset, `${z.id}.reset`),
          tables,
          store,
        ),
      );
    for (const h of doc.runhours ?? [])
      this.add(
        new RunhoursBlock(
          h,
          ex(h.run, 'BOOL', `${h.id}.run`),
          exOpt(h.reset, `${h.id}.reset`),
          tables,
          store,
        ),
      );
    for (const s of doc.schedules ?? []) this.add(new ScheduleBlock(s));

    const { order, cycles } = logicOrder(doc, env, outs);
    if (cycles.length > 0)
      throw new Error(`logic: vòng phụ thuộc ${cycles.map((c) => c.join(', ')).join('; ')}`);
    this.order = order.map((id) => this.blocks.get(id)!);
    const init = {
      setOut: (tag: string, value: LogicOutValue | null, bad?: string) =>
        this.setOut(tag, value, bad),
    };
    for (const b of this.order) b.init(init);
  }

  private add(b: Block): void {
    if (this.blocks.has(b.id)) throw new Error(`logic: id '${b.id}' trùng`);
    this.blocks.set(b.id, b);
  }

  private setOut(tag: string, value: LogicOutValue | null, bad?: string): void {
    this.outputs.set(
      tag,
      bad === undefined ? { value, quality: 'GOOD' } : { value, quality: 'BAD', reason: bad },
    );
  }

  /** Một lần quét tại `now` (ms monotonic, tăng dần). Trả các hành động phát sinh theo thứ tự chạy. */
  step(now: number, read: ReadTag, wall?: WallClock): ActionOut[] {
    this.now = now;
    const actions: ActionOut[] = [];
    const ctx: ScanCtx = {
      now,
      wall,
      tables: this.tables,
      config: this.config,
      read: (id) => {
        const o = this.outputs.get(id);
        if (o === undefined) return read(id);
        const v = o.value;
        return {
          value: typeof v === 'bigint' ? Number(v) : v,
          quality: o.quality,
          ...(o.reason !== undefined ? { reason: o.reason } : {}),
        };
      },
      setOut: (tag, value, bad) => this.setOut(tag, value, bad),
      emit: (a) => actions.push(a),
    };
    for (const b of this.order) b.step(ctx);
    return actions;
  }

  /** Giá trị hiện tại của một Tag logic; undefined nếu không phải Tag logic. */
  output(tag: string): OutputValue | undefined {
    return this.outputs.get(tag);
  }

  outputTags(): ReadonlyMap<string, LogicOutput> {
    return this.outputDefs;
  }

  /** Trạng thái một khối (GET /logic) tại lần quét gần nhất. */
  state(id: string): BlockState | undefined {
    return this.blocks.get(id)?.state(this.now);
  }

  blockIds(): string[] {
    return this.order.map((b) => b.id);
  }

  /** Kết quả cuối của một lệnh ghi do WriteCoordinator báo lại (FAILED, REJECTED…): ghi vào lastError của luật. */
  writeResult(rule: string, result: string): void {
    const b = this.blocks.get(rule);
    if (b instanceof RuleBlock) b.writeResult(result);
  }

  /** Ảnh chụp kho retain (khóa `logic/<id>/<trường>`) để ghi mỗi `logic.flushS` và khi dừng. */
  retainSnapshot(): RetainStore {
    const out: RetainStore = {};
    for (const b of this.order) b.retain(out);
    return out;
  }
}
