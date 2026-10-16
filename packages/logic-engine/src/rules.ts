// Luật (contracts/logic-engine.md §2) và bộ chặn tần suất ghi (§8).
//
// Mỗi quét: DISABLED thì bỏ. `cond` unknown ⇒ SUSPENDED (đóng băng: không đổi stable, hủy candidate, không hành
// động). Lần quét hợp lệ đầu tiên đặt `stable = cond` ngay (không hold) và chỉ chạy onRise nếu `fireOnStart` và cond
// đúng. Sau đó: cond = stable ⇒ hủy candidate; khác ⇒ candidate (mốc = quét đầu tiên thấy nó), giữ ≥ hold thì đổi
// stable và bắn cạnh. `repeatMs`: khi stable = true và đã từng chạy onRise, chạy lại khi now - lần chạy trước ≥
// repeatMs (không trong quét đã bắn cạnh). Mỗi lần chạy (cạnh hoặc lặp) tăng edgeId (retain).
//
// Hành động chạy theo thứ tự khai báo: giá trị (hằng, hoặc biểu thức tính lúc bắn với kiểu đích) → write/pulse:
// ngoài `allowed` ⇒ OUT_OF_LIMITS; logic.writes = off ⇒ SUPPRESSED; minIntervalMs, maxPerHour (cửa sổ trượt 1 giờ:
// lệnh có now - t < 3.600.000) của mục writes, rồi token bucket toàn thiết bị ⇒ RATE_LIMITED (luật THROTTLED tới
// 60 s sau lần bị chặn cuối). Chỉ lệnh QUEUED được tính vào giới hạn. lastError: RATE_LIMITED, OUT_OF_LIMITS,
// EXPR_ERROR, NO_VALUE, hoặc kết quả FAILED/REJECTED báo lại bằng writeResult.
import type { TableSet } from '@mat/expression';
import { logicAllowed } from '@mat/project-schema';
import { retainNum, type Block, type ScanCtx } from './block.ts';
import type { Expr } from './expr.ts';
import type {
  ActionOut,
  ActionResult,
  BlockState,
  LogicConfig,
  LogicOutValue,
  LogicRule,
  LogicWrite,
  RetainStore,
} from './types.ts';

const THROTTLE_HOLD_MS = 60_000;
const HOUR_MS = 3_600_000;
/** Đơn vị của token bucket: một lượt = 60.000 đơn vị; nạp `maxWritesPerMin` đơn vị mỗi ms (số nguyên, chính xác). */
const TOKEN = 60_000;

/** Bộ chặn của một mục writes. */
export class WriteGate {
  readonly def: LogicWrite;
  private lastSent: number | null = null;
  private sent: number[] = [];
  constructor(def: LogicWrite) {
    this.def = def;
  }
  allows(now: number): boolean {
    const minI = this.def.minIntervalMs ?? 1000;
    if (this.lastSent !== null && now - this.lastSent < minI) return false;
    this.sent = this.sent.filter((t) => now - t < HOUR_MS);
    return this.sent.length < (this.def.maxPerHour ?? 60);
  }
  take(now: number): void {
    this.lastSent = now;
    this.sent.push(now);
  }
}

/** Token bucket toàn thiết bị (`logic.maxWritesPerMin`), đầy lúc khởi động. */
export class Bucket {
  private level: number;
  private last: number | null = null;
  private readonly cap: number;
  constructor(perMin: number) {
    this.cap = perMin;
    this.level = perMin * TOKEN;
  }
  private refill(now: number): void {
    if (this.last !== null)
      this.level = Math.min(this.cap * TOKEN, this.level + (now - this.last) * this.cap);
    this.last = now;
  }
  allows(now: number): boolean {
    this.refill(now);
    return this.level >= TOKEN;
  }
  take(): void {
    this.level -= TOKEN;
  }
}

export interface CompiledAction {
  do: 'setTag' | 'toggle' | 'write' | 'pulse';
  tag: string;
  write?: WriteGate;
  value?: LogicOutValue;
  expr?: Expr;
  ms?: number;
}

export interface RuleEnv {
  tables: TableSet;
  config: LogicConfig;
  bucket: Bucket;
}

export class RuleBlock implements Block {
  readonly id: string;
  private stable: boolean | null = null;
  private candidate: boolean | null = null;
  private since = 0;
  private suspended: string | null = null;
  private edgeId: number;
  private lastRun: number | null = null;
  private throttledAt: number | null = null;
  private lastError: string | null = null;
  private readonly def: LogicRule;
  private readonly when: Expr;
  private readonly onRise: CompiledAction[];
  private readonly onFall: CompiledAction[];
  private readonly env: RuleEnv;

  constructor(
    def: LogicRule,
    when: Expr,
    onRise: CompiledAction[],
    onFall: CompiledAction[],
    env: RuleEnv,
    store?: RetainStore,
  ) {
    this.id = def.id;
    this.def = def;
    this.when = when;
    this.onRise = onRise;
    this.onFall = onFall;
    this.env = env;
    this.edgeId = retainNum(store, `logic/${def.id}/edgeId`);
  }

  init(): void {}

  step(ctx: ScanCtx): void {
    if (this.def.enabled === false) return;
    const r = this.when.eval(ctx.read, this.env.tables);
    if (!r.ok) {
      this.suspended = r.reason;
      this.candidate = null;
      return;
    }
    this.suspended = null;
    const cond = r.value === true;
    if (this.stable === null) {
      this.stable = cond;
      if (cond && this.def.fireOnStart === true) this.fire(ctx, 'rise');
      return;
    }
    if (cond === this.stable) this.candidate = null;
    else {
      if (this.candidate !== cond) {
        this.candidate = cond;
        this.since = ctx.now;
      }
      if (ctx.now - this.since >= (this.def.hold ?? 0)) {
        this.stable = cond;
        this.candidate = null;
        this.fire(ctx, cond ? 'rise' : 'fall');
        if (!cond) this.lastRun = null;
        return;
      }
    }
    const rep = this.def.repeatMs ?? 0;
    if (this.stable && rep > 0 && this.lastRun !== null && ctx.now - this.lastRun >= rep)
      this.fire(ctx, 'rise');
  }

  private fire(ctx: ScanCtx, edge: 'rise' | 'fall'): void {
    this.edgeId += 1;
    if (edge === 'rise') this.lastRun = ctx.now;
    const list = edge === 'rise' ? this.onRise : this.onFall;
    list.forEach((a, index) => {
      const out: ActionOut = {
        t: ctx.now,
        rule: this.id,
        edgeId: this.edgeId,
        edge,
        index,
        do: a.do,
        tag: a.tag,
        result: 'OK',
      };
      if (a.write) out.write = a.write.def.id;
      if (a.ms !== undefined) out.ms = a.ms;
      out.result = this.run(ctx, a, out);
      if (out.result !== 'OK' && out.result !== 'QUEUED' && out.result !== 'SUPPRESSED')
        this.lastError = out.result;
      ctx.emit(out);
    });
  }

  private run(ctx: ScanCtx, a: CompiledAction, out: ActionOut): ActionResult {
    if (a.do === 'toggle') {
      const cur = ctx.read(a.tag);
      if (cur.quality !== 'GOOD' || typeof cur.value !== 'boolean') return 'NO_VALUE';
      out.value = !cur.value;
      return 'OK';
    }
    let value: LogicOutValue;
    if (a.expr) {
      const r = a.expr.eval(ctx.read, this.env.tables);
      if (!r.ok) return 'EXPR_ERROR';
      value = r.value;
    } else value = a.value!;
    out.value = value;
    if (a.do === 'setTag') return 'OK';
    const gate = a.write!;
    if (!logicAllowed(gate.def.allowed, value)) return 'OUT_OF_LIMITS';
    if (this.env.config.writes === 'off') return 'SUPPRESSED';
    if (!gate.allows(ctx.now) || !this.env.bucket.allows(ctx.now)) {
      this.throttledAt = ctx.now;
      return 'RATE_LIMITED';
    }
    gate.take(ctx.now);
    this.env.bucket.take();
    return 'QUEUED';
  }

  /** Kết quả cuối của lệnh ghi (FAILED, REJECTED…) do WriteCoordinator báo lại. */
  writeResult(result: string): void {
    this.lastError = result;
  }

  state(now: number): BlockState {
    const base = {
      kind: 'rule' as const,
      stable: this.stable,
      edgeId: this.edgeId,
      lastError: this.lastError,
    };
    if (this.def.enabled === false) return { ...base, state: 'DISABLED' };
    if (this.suspended !== null) return { ...base, state: 'SUSPENDED', reason: this.suspended };
    if (this.throttledAt !== null && now - this.throttledAt < THROTTLE_HOLD_MS)
      return { ...base, state: 'THROTTLED' };
    return { ...base, state: 'OK' };
  }

  retain(out: RetainStore): void {
    out[`logic/${this.id}/edgeId`] = this.edgeId;
  }
}
