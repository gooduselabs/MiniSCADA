// Counter (contracts/logic-engine.md §4). Cạnh lên giữa hai quét hợp lệ (mốc "trước" chỉ cập nhật khi hợp lệ; lần
// thấy hợp lệ đầu tiên không phải cạnh). Cùng quét: reset trước (bỏ up và down), rồi up, rồi down. INT64 bằng bigint,
// tràn dừng ở max và đặt overflow (reset xóa). Retain: `value` (chuỗi thập phân), `overflow`.
import type { TableSet } from '@mat/expression';
import type { Block, ScanCtx } from './block.ts';
import { evalBool, type Expr } from './expr.ts';
import type { BlockState, LogicCounter, RetainStore } from './types.ts';

export const INT64_MAX = 9223372036854775807n;

export class CounterBlock implements Block {
  readonly id: string;
  private value = 0n;
  private overflow = false;
  private prev: [boolean | undefined, boolean | undefined, boolean | undefined] = [
    undefined,
    undefined,
    undefined,
  ];
  private readonly def: LogicCounter;
  private readonly exprs: [Expr, Expr | null, Expr | null];
  private readonly tables: TableSet;

  constructor(
    def: LogicCounter,
    exprs: [Expr, Expr | null, Expr | null],
    tables: TableSet,
    store?: RetainStore,
  ) {
    this.id = def.id;
    this.def = def;
    this.exprs = exprs;
    this.tables = tables;
    if (store && def.retain !== false) {
      const v = store[`logic/${def.id}/value`];
      if (typeof v === 'string' && /^[0-9]{1,19}$/.test(v)) {
        const b = BigInt(v);
        this.value = b > INT64_MAX ? INT64_MAX : b;
      } else if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) this.value = BigInt(v);
      this.overflow = store[`logic/${def.id}/overflow`] === true;
    }
  }

  init(ctx: Pick<ScanCtx, 'setOut'>): void {
    this.publish(ctx);
  }

  step(ctx: ScanCtx): void {
    const edges = this.exprs.map((e, i) => {
      if (e === null) return false;
      const v = evalBool(e, ctx.read, this.tables);
      if (v === undefined) return false;
      const edge = this.prev[i] === false && v;
      this.prev[i] = v;
      return edge;
    });
    const [up, down, reset] = edges;
    if (reset) {
      this.value = 0n;
      this.overflow = false;
    } else {
      if (up) {
        if (this.value >= INT64_MAX) this.overflow = true;
        else this.value += 1n;
      }
      if (down && this.value > 0n) this.value -= 1n;
    }
    this.publish(ctx);
  }

  private publish(ctx: Pick<ScanCtx, 'setOut'>): void {
    ctx.setOut(this.def.value, this.value);
    if (this.def.reached !== undefined) {
      const p = this.def.preset ?? null;
      ctx.setOut(this.def.reached, p !== null && this.value >= BigInt(p));
    }
  }

  state(): BlockState {
    return { kind: 'counter', state: 'OK', overflow: this.overflow };
  }

  retain(out: RetainStore): void {
    if (this.def.retain === false) return;
    out[`logic/${this.id}/value`] = this.value.toString();
    out[`logic/${this.id}/overflow`] = this.overflow;
  }
}
