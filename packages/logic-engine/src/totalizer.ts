// Totalizer (contracts/logic-engine.md §5). Hình thang trên thời gian monotonic; số học double theo đúng thứ tự
//   total = total + ((factor * ((r0 + r1) / 2)) * (dtMs / 1000)) / unitSeconds
// (không FMA; bản C++ biên dịch với -ffp-contract=off) để TS và C++ trùng từng bit. Khoảng có một đầu mút unknown
// hoặc dtMs > maxGapMs: không cộng, cộng dtMs vào khoảng trống (số nguyên ms; gapSeconds = gapMs / 1000). Cùng quét:
// cộng, rồi rolloverAt (một lần trừ), rồi cạnh lên của reset (total = 0, gap = 0). Lần quét đầu chỉ ghi mốc.
import type { TableSet } from '@mat/expression';
import { retainNum, type Block, type ScanCtx } from './block.ts';
import { evalBool, type Expr } from './expr.ts';
import type { BlockState, LogicTotalizer, RetainStore } from './types.ts';

const UNIT_SECONDS: Record<string, number> = { s: 1, min: 60, h: 3600, d: 86400 };
export const DEFAULT_MAX_GAP_MS = 5000;

export class TotalizerBlock implements Block {
  readonly id: string;
  private total = 0;
  private gapMs = 0;
  private prev: { t: number; rate: number | null } | null = null;
  private prevReset: boolean | undefined;
  private readonly def: LogicTotalizer;
  private readonly source: Expr;
  private readonly reset: Expr | null;
  private readonly tables: TableSet;
  private readonly factor: number;
  private readonly cutoff: number;
  private readonly maxGapMs: number;
  private readonly unit: number;

  constructor(
    def: LogicTotalizer,
    source: Expr,
    reset: Expr | null,
    tables: TableSet,
    store?: RetainStore,
  ) {
    this.id = def.id;
    this.def = def;
    this.source = source;
    this.reset = reset;
    this.tables = tables;
    this.factor = def.factor ?? 1;
    this.cutoff = def.cutoff ?? 0;
    this.maxGapMs = def.maxGapMs ?? DEFAULT_MAX_GAP_MS;
    this.unit = UNIT_SECONDS[def.rateUnit] ?? 1;
    if (store && def.retain !== false) {
      this.total = retainNum(store, `logic/${def.id}/total`);
      this.gapMs = Math.round(retainNum(store, `logic/${def.id}/gapSeconds`) * 1000);
    }
  }

  init(ctx: Pick<ScanCtx, 'setOut'>): void {
    this.publish(ctx);
  }

  private cut(r: number): number {
    return r < this.cutoff ? 0 : r;
  }

  step(ctx: ScanCtx): void {
    const s = this.source.eval(ctx.read, this.tables);
    const rate = s.ok ? Number(s.value) : null;
    if (this.prev !== null) {
      const dtMs = ctx.now - this.prev.t;
      if (rate === null || this.prev.rate === null || dtMs > this.maxGapMs) this.gapMs += dtMs;
      else {
        const r0 = this.cut(this.prev.rate);
        const r1 = this.cut(rate);
        const inc = (this.factor * ((r0 + r1) / 2) * (dtMs / 1000)) / this.unit;
        this.total = this.total + inc;
      }
      const roll = this.def.rolloverAt;
      if (roll !== undefined && this.total >= roll) this.total = this.total - roll;
    }
    this.prev = { t: ctx.now, rate };
    if (this.reset !== null) {
      const v = evalBool(this.reset, ctx.read, this.tables);
      if (v !== undefined) {
        if (this.prevReset === false && v) {
          this.total = 0;
          this.gapMs = 0;
        }
        this.prevReset = v;
      }
    }
    this.publish(ctx);
  }

  private publish(ctx: Pick<ScanCtx, 'setOut'>): void {
    ctx.setOut(this.def.total, this.total);
    if (this.def.gapSeconds !== undefined) ctx.setOut(this.def.gapSeconds, this.gapMs / 1000);
  }

  state(): BlockState {
    return { kind: 'totalizer', state: 'OK' };
  }

  retain(out: RetainStore): void {
    if (this.def.retain === false) return;
    out[`logic/${this.id}/total`] = this.total;
    out[`logic/${this.id}/gapSeconds`] = this.gapMs / 1000;
  }
}
