// Cây cú pháp (đã kiểm kiểu) -> bytecode máy ngăn xếp. && || ?: biên dịch thành lệnh nhảy: tính lười.
import { stackDepth } from './checker.ts';
import type { Node } from './parser.ts';
import type { Program, TagDataType } from './types.ts';

/** Mã lệnh. Lệnh có tham số chiếm 2 số nguyên liên tiếp (mã, tham số). */
export const Op = {
  PUSH_NUM: 0, // c: chỉ số hằng số
  PUSH_STR: 1, // c
  PUSH_BOOL: 2, // 0 | 1
  LOAD: 3, // i, kind (0 số, 1 bool, 2 chuỗi) -> hai tham số
  TONUM: 4,
  NEG: 5,
  NOT: 6,
  ADD: 7,
  SUB: 8,
  MUL: 9,
  DIV: 10,
  MOD: 11,
  LT: 12,
  LE: 13,
  GT: 14,
  GE: 15,
  EQN: 16,
  NEN: 17,
  EQS: 18,
  NES: 19,
  JF_KEEP: 20, // đích: nếu đỉnh là false thì nhảy, giữ nguyên
  JT_KEEP: 21, // đích: nếu đỉnh là true thì nhảy, giữ nguyên
  POP: 22,
  JF: 23, // đích: lấy đỉnh ra, nếu false thì nhảy
  JMP: 24, // đích
  MIN: 25, // n
  MAX: 26, // n
  ABS: 27,
  CLAMP: 28,
  ROUND: 29,
  ROUNDN: 30, // chữ số
  TEXT: 31, // chỉ số bảng
} as const;

/** Số tham số của từng lệnh. */
export const OP_ARGS: Readonly<Record<number, number>> = {
  [Op.PUSH_NUM]: 1,
  [Op.PUSH_STR]: 1,
  [Op.PUSH_BOOL]: 1,
  [Op.LOAD]: 2,
  [Op.JF_KEEP]: 1,
  [Op.JT_KEEP]: 1,
  [Op.JF]: 1,
  [Op.JMP]: 1,
  [Op.MIN]: 1,
  [Op.MAX]: 1,
  [Op.ROUNDN]: 1,
  [Op.TEXT]: 1,
};

const BINOP: Readonly<Record<string, number>> = {
  '+': Op.ADD,
  '-': Op.SUB,
  '*': Op.MUL,
  '/': Op.DIV,
  '%': Op.MOD,
  '<': Op.LT,
  '<=': Op.LE,
  '>': Op.GT,
  '>=': Op.GE,
};

export function compileNode(
  root: Node,
  inputs: readonly string[],
  target: TagDataType,
  tagKind: (id: string) => 0 | 1 | 2,
): Program {
  const ops: number[] = [];
  const consts: (number | string)[] = [];
  const tables: string[] = [];
  const constIndex = (v: number | string): number => {
    const i = consts.findIndex((c) => Object.is(c, v));
    if (i >= 0) return i;
    consts.push(v);
    return consts.length - 1;
  };
  /** Đẩy giá trị của nút, rồi nếu cần đổi bool thành số. */
  const asNumber = (n: Node): void => {
    gen(n);
    if (n.ty === 'bool') ops.push(Op.TONUM);
  };
  const patch = (at: number, to: number): void => {
    ops[at] = to;
  };

  function gen(n: Node): void {
    switch (n.t) {
      case 'num':
        ops.push(Op.PUSH_NUM, constIndex(n.v));
        return;
      case 'bool':
        ops.push(Op.PUSH_BOOL, n.v ? 1 : 0);
        return;
      case 'str':
        ops.push(Op.PUSH_STR, constIndex(n.v));
        return;
      case 'tag':
        ops.push(Op.LOAD, inputs.indexOf(n.id), tagKind(n.id));
        return;
      case 'paren':
        gen(n.x);
        return;
      case 'un':
        if (n.op === '-') {
          asNumber(n.x);
          ops.push(Op.NEG);
        } else {
          gen(n.x);
          ops.push(Op.NOT);
        }
        return;
      case 'bin': {
        if (n.op === '&&' || n.op === '||') {
          gen(n.l);
          ops.push(n.op === '&&' ? Op.JF_KEEP : Op.JT_KEEP, 0);
          const hole = ops.length - 1;
          ops.push(Op.POP);
          gen(n.r);
          patch(hole, ops.length);
          return;
        }
        if (n.op === '==' || n.op === '!=') {
          const str = n.l.ty === 'string';
          if (str) {
            gen(n.l);
            gen(n.r);
            ops.push(n.op === '==' ? Op.EQS : Op.NES);
          } else {
            asNumber(n.l);
            asNumber(n.r);
            ops.push(n.op === '==' ? Op.EQN : Op.NEN);
          }
          return;
        }
        asNumber(n.l);
        asNumber(n.r);
        ops.push(BINOP[n.op]!);
        return;
      }
      case 'cond': {
        gen(n.c);
        ops.push(Op.JF, 0);
        const holeElse = ops.length - 1;
        gen(n.a);
        if (n.ty === 'number' && n.a.ty === 'bool') ops.push(Op.TONUM);
        ops.push(Op.JMP, 0);
        const holeEnd = ops.length - 1;
        patch(holeElse, ops.length);
        gen(n.b);
        if (n.ty === 'number' && n.b.ty === 'bool') ops.push(Op.TONUM);
        patch(holeEnd, ops.length);
        return;
      }
      case 'call': {
        if (n.name === 'text') {
          asNumber(n.args[0]!);
          const name = (n.args[1] as { id: string }).id;
          let ti = tables.indexOf(name);
          if (ti < 0) {
            tables.push(name);
            ti = tables.length - 1;
          }
          ops.push(Op.TEXT, ti);
          return;
        }
        if (n.name === 'round') {
          asNumber(n.args[0]!);
          if (n.args.length === 1) ops.push(Op.ROUND);
          else ops.push(Op.ROUNDN, (n.args[1] as { v: number }).v);
          return;
        }
        for (const a of n.args) asNumber(a);
        if (n.name === 'min') ops.push(Op.MIN, n.args.length);
        else if (n.name === 'max') ops.push(Op.MAX, n.args.length);
        else if (n.name === 'abs') ops.push(Op.ABS);
        else ops.push(Op.CLAMP);
        return;
      }
    }
  }
  gen(root);
  return { ops, consts, inputs: [...inputs], tables, target, maxStack: stackDepth(root) };
}
