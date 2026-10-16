// Giờ chạy (contracts/logic-engine.md §6). Khoảng (k-1, k] được tính khi cả hai quét hợp lệ và `run` ở quét k-1 là
// true (giữ bằng ms số nguyên, hours = runMs / 3.600.000). `starts`: cạnh lên giữa hai giá trị hợp lệ (lần thấy
// đầu tiên không phải cạnh, trừ khi retain có `lastRun`). Cùng quét: cộng, đếm khởi động, rồi cạnh lên của reset
// (hours = 0, due = false; starts giữ). Retain: `hours`, `starts`, `lastRun` (khi đã biết).
import type { TableSet } from '@mat/expression';
import { retainNum, type Block, type ScanCtx } from './block.ts';
import { evalBool, type Expr } from './expr.ts';
import type { BlockState, LogicRunhours, RetainStore } from './types.ts';

const MS_PER_HOUR = 3_600_000;

export class RunhoursBlock implements Block {
  readonly id: string;
  private runMs = 0;
  private starts = 0;
  private prevRun: boolean | undefined;
  private lastT: number | null = null;
  private lastValid = false;
  private prevReset: boolean | undefined;
  private readonly def: LogicRunhours;
  private readonly run: Expr;
  private readonly reset: Expr | null;
  private readonly tables: TableSet;

  constructor(
    def: LogicRunhours,
    run: Expr,
    reset: Expr | null,
    tables: TableSet,
    store?: RetainStore,
  ) {
    this.id = def.id;
    this.def = def;
    this.run = run;
    this.reset = reset;
    this.tables = tables;
    if (store && def.retain !== false) {
      this.runMs = Math.round(retainNum(store, `logic/${def.id}/hours`) * MS_PER_HOUR);
      this.starts = retainNum(store, `logic/${def.id}/starts`);
      const last = store[`logic/${def.id}/lastRun`];
      if (typeof last === 'boolean') this.prevRun = last;
    }
  }

  init(ctx: Pick<ScanCtx, 'setOut'>): void {
    this.publish(ctx);
  }

  step(ctx: ScanCtx): void {
    const v = evalBool(this.run, ctx.read, this.tables);
    if (v === undefined) this.lastValid = false;
    else {
      if (this.lastValid && this.lastT !== null && this.prevRun === true)
        this.runMs += ctx.now - this.lastT;
      if (this.prevRun === false && v) this.starts += 1;
      this.prevRun = v;
      this.lastValid = true;
    }
    this.lastT = ctx.now;
    if (this.reset !== null) {
      const r = evalBool(this.reset, ctx.read, this.tables);
      if (r !== undefined) {
        if (this.prevReset === false && r) this.runMs = 0;
        this.prevReset = r;
      }
    }
    this.publish(ctx);
  }

  private publish(ctx: Pick<ScanCtx, 'setOut'>): void {
    const hours = this.runMs / MS_PER_HOUR;
    ctx.setOut(this.def.hours, hours);
    if (this.def.starts !== undefined) ctx.setOut(this.def.starts, this.starts);
    if (this.def.due !== undefined) {
      const s = this.def.serviceEveryHours ?? null;
      ctx.setOut(this.def.due, s !== null && hours >= s);
    }
  }

  state(): BlockState {
    return { kind: 'runhours', state: 'OK' };
  }

  retain(out: RetainStore): void {
    if (this.def.retain === false) return;
    out[`logic/${this.id}/hours`] = this.runMs / MS_PER_HOUR;
    out[`logic/${this.id}/starts`] = this.starts;
    if (this.prevRun !== undefined) out[`logic/${this.id}/lastRun`] = this.prevRun;
  }
}
