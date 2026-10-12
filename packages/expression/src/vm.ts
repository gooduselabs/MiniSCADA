// Máy ngăn xếp theo dõi quality (contract expression-language §4, §5). Chỉ đầu vào được nạp mới tính.
import { Op } from './compiler.ts';
import { assignToTarget, POW10, roundHalfAway } from './number.ts';
import { lookupValueTable } from './value-table.ts';
import type { EvalResult, InputValue, Program, TableSet } from './types.ts';

type Val = number | boolean | string;

class Stop {
  reason: string;
  constructor(reason: string) {
    this.reason = reason;
  }
}

const finite = (v: number): number => {
  if (v === Infinity || v === -Infinity) throw new Stop('OVERFLOW');
  if (Number.isNaN(v)) throw new Stop('NOT_A_NUMBER');
  return v;
};

/** Chạy chương trình. `input(i)` trả giá trị của Tag đầu vào thứ i (program.inputs[i]). */
export function evaluate(
  p: Program,
  input: (i: number) => InputValue,
  tables: TableSet,
): EvalResult {
  const ops = p.ops;
  const st: Val[] = [];
  let unc: string | null = null;
  try {
    let pc = 0;
    while (pc < ops.length) {
      const op = ops[pc++]!;
      switch (op) {
        case Op.PUSH_NUM:
        case Op.PUSH_STR:
          st.push(p.consts[ops[pc++]!]!);
          break;
        case Op.PUSH_BOOL:
          st.push(ops[pc++] === 1);
          break;
        case Op.LOAD: {
          const iv = input(ops[pc++]!);
          const kind = ops[pc++]!;
          if (iv.quality === 'BAD' || iv.value === null)
            throw new Stop(
              iv.quality === 'BAD' && iv.reason !== 'NO_VALUE' ? 'INPUT_BAD' : 'NO_VALUE',
            );
          if (iv.quality === 'UNCERTAIN' && unc === null) unc = iv.reason ?? 'UNCERTAIN';
          st.push(
            kind === 0 ? Number(iv.value) : kind === 1 ? iv.value === true : String(iv.value),
          );
          break;
        }
        case Op.TONUM: {
          const v = st.pop();
          st.push(v === true ? 1 : v === false ? 0 : (v as number));
          break;
        }
        case Op.NEG:
          st.push(-(st.pop() as number));
          break;
        case Op.NOT:
          st.push(!(st.pop() as boolean));
          break;
        case Op.ADD:
        case Op.SUB:
        case Op.MUL:
        case Op.DIV:
        case Op.MOD:
        case Op.LT:
        case Op.LE:
        case Op.GT:
        case Op.GE:
        case Op.EQN:
        case Op.NEN: {
          const b = st.pop() as number;
          const a = st.pop() as number;
          st.push(binary(op, a, b));
          break;
        }
        case Op.EQS:
          st.push((st.pop() as string) === (st.pop() as string));
          break;
        case Op.NES:
          st.push((st.pop() as string) !== (st.pop() as string));
          break;
        case Op.JF_KEEP: {
          const to = ops[pc++]!;
          if (st[st.length - 1] === false) pc = to;
          break;
        }
        case Op.JT_KEEP: {
          const to = ops[pc++]!;
          if (st[st.length - 1] === true) pc = to;
          break;
        }
        case Op.POP:
          st.pop();
          break;
        case Op.JF: {
          const to = ops[pc++]!;
          if (st.pop() === false) pc = to;
          break;
        }
        case Op.JMP:
          pc = ops[pc]!;
          break;
        case Op.MIN:
        case Op.MAX: {
          const n = ops[pc++]!;
          const args = st.splice(st.length - n, n) as number[];
          let m = args[0]!;
          for (let i = 1; i < n; i++) {
            const v = args[i]!;
            if (op === Op.MIN ? v < m : v > m) m = v;
          }
          st.push(m);
          break;
        }
        case Op.ABS: {
          const x = st.pop() as number;
          st.push(x < 0 ? -x : x);
          break;
        }
        case Op.CLAMP: {
          const hi = st.pop() as number;
          const lo = st.pop() as number;
          const x = st.pop() as number;
          if (lo > hi) throw new Stop('CLAMP_RANGE');
          const t = x < lo ? lo : x;
          st.push(t > hi ? hi : t);
          break;
        }
        case Op.ROUND:
          st.push(roundHalfAway(st.pop() as number));
          break;
        case Op.ROUNDN: {
          const pw = POW10[ops[pc++]!]!;
          const x = st.pop() as number;
          st.push(roundHalfAway(finite(x * pw)) / pw);
          break;
        }
        case Op.TEXT: {
          const tb = tables.get(p.tables[ops[pc++]!]!);
          const x = st.pop() as number;
          st.push(tb ? lookupValueTable(tb, x).text : '');
          break;
        }
        default:
          throw new Error(`bad opcode ${op}`);
      }
    }
    const a = assignToTarget(p.target, st.pop() as Val);
    if (!a.ok) throw new Stop(a.reason);
    return unc !== null
      ? { quality: 'UNCERTAIN', reason: unc, value: a.value }
      : { quality: 'GOOD', value: a.value };
  } catch (e) {
    if (e instanceof Stop) return { quality: 'BAD', reason: e.reason };
    throw e;
  }
}

function binary(op: number, a: number, b: number): Val {
  switch (op) {
    case Op.ADD:
      return finite(a + b);
    case Op.SUB:
      return finite(a - b);
    case Op.MUL:
      return finite(a * b);
    case Op.DIV:
      if (b === 0) throw new Stop('DIV_ZERO');
      return finite(a / b);
    case Op.MOD:
      if (b === 0) throw new Stop('MOD_ZERO');
      return finite(a % b);
    case Op.LT:
      return a < b;
    case Op.LE:
      return a <= b;
    case Op.GT:
      return a > b;
    case Op.GE:
      return a >= b;
    case Op.EQN:
      return a === b;
    default:
      return a !== b;
  }
}
