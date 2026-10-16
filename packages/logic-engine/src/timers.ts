// Timer ton/tof/tp (contracts/logic-engine.md §3). `et` cộng dồn khoảng giữa hai quét hợp lệ liên tiếp (đầu vào
// unknown: giữ đầu ra, dừng đếm, khoảng chứa quét unknown không tính). `in` trước lần quét hợp lệ đầu coi là false
// (như PLC): tp/ton thấy true ở lần đầu là cạnh lên. Không retain (về q = false, et = 0 khi khởi động).
import type { TableSet } from '@mat/expression';
import type { Block, ScanCtx } from './block.ts';
import { evalBool, type Expr } from './expr.ts';
import type { BlockState, LogicTimer } from './types.ts';

export class TimerBlock implements Block {
  readonly id: string;
  private readonly kind: 'ton' | 'tof' | 'tp';
  private readonly pt: number;
  private q = false;
  private et = 0;
  private prevIn = false;
  private running = false;
  private lastT: number | null = null;
  private lastValid = false;
  private degraded = false;
  private readonly def: LogicTimer;
  private readonly input: Expr;
  private readonly tables: TableSet;

  constructor(def: LogicTimer, input: Expr, scanMs: number, tables: TableSet) {
    this.id = def.id;
    this.def = def;
    this.kind = def.kind as 'ton' | 'tof' | 'tp';
    this.pt = Math.max(def.pt, scanMs);
    this.input = input;
    this.tables = tables;
  }

  init(ctx: Pick<ScanCtx, 'setOut'>): void {
    this.publish(ctx);
  }

  step(ctx: ScanCtx): void {
    const cur = evalBool(this.input, ctx.read, this.tables);
    if (cur === undefined) {
      this.degraded = true;
      this.lastValid = false;
      this.lastT = ctx.now;
      return;
    }
    const dt = this.lastValid && this.lastT !== null ? ctx.now - this.lastT : 0;
    const pt = this.pt;
    if (this.kind === 'ton') {
      if (cur) {
        this.et = this.prevIn ? Math.min(pt, this.et + dt) : 0;
        this.q = this.et >= pt;
      } else {
        this.et = 0;
        this.q = false;
      }
    } else if (this.kind === 'tof') {
      if (cur) {
        this.q = true;
        this.et = 0;
        this.running = false;
      } else if (this.prevIn) {
        this.running = true;
        this.et = 0;
      } else if (this.running) {
        this.et = Math.min(pt, this.et + dt);
        if (this.et >= pt) {
          this.q = false;
          this.running = false;
        }
      }
    } else if (this.running) {
      this.et = Math.min(pt, this.et + dt);
      if (this.et >= pt) {
        this.q = false;
        this.running = false;
      }
    } else if (cur && !this.prevIn) {
      this.running = true;
      this.q = true;
      this.et = 0;
    } else if (!cur) this.et = 0;
    this.prevIn = cur;
    this.lastT = ctx.now;
    this.lastValid = true;
    this.degraded = false;
    this.publish(ctx);
  }

  private publish(ctx: Pick<ScanCtx, 'setOut'>): void {
    ctx.setOut(this.def.q, this.q);
    if (this.def.et !== undefined) ctx.setOut(this.def.et, this.et);
  }

  state(): BlockState {
    return { kind: 'timer', state: 'OK', degraded: this.degraded };
  }

  retain(): void {}
}
