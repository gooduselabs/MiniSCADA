// Kiểm tên, số tham số, kiểu và giới hạn (contract expression-language §3, §6, §7).
// Thứ tự lỗi đầu tiên: cú pháp (parser) -> tên -> số tham số -> kiểu -> giới hạn.
import { preorder, type Issue, type Node } from './parser.ts';
import type { CompileEnv, ExprType, TagDataType } from './types.ts';

/** Số tham số [tối thiểu, tối đa] của 6 hàm. */
export const FUNCS: Readonly<Record<string, readonly [number, number]>> = {
  min: [2, 16],
  max: [2, 16],
  abs: [1, 1],
  round: [1, 2],
  clamp: [3, 3],
  text: [2, 2],
};

export const MAX_CHARS = 1000;
export const MAX_BYTES = 4096;
export const MAX_INPUTS = 32;
export const MAX_STACK = 64;

export const kindOfTag = (t: TagDataType): ExprType =>
  t === 'BOOL' ? 'bool' : t === 'STRING' ? 'string' : 'number';

export const isBareWord = (n: Node): boolean => n.t === 'tag' && !n.id.includes('.');

/** Tham số thứ hai của text(x, B) viết bằng một tên trần: nút này là tên bảng, không phải Tag. */
export function isTableArg(parent: Node, idx: number): boolean {
  return (
    parent.t === 'call' &&
    parent.name === 'text' &&
    parent.args.length === 2 &&
    idx === 1 &&
    isBareWord(parent.args[1]!)
  );
}

export function tableArgNodes(root: Node): Set<Node> {
  const set = new Set<Node>();
  for (const n of preorder(root))
    if (n.t === 'call' && n.name === 'text' && n.args.length === 2 && isBareWord(n.args[1]!))
      set.add(n.args[1]!);
  return set;
}

export type CheckResult =
  | { ok: true; inputs: string[]; warnings: string[]; rootType: ExprType; stack: number }
  | { ok: false; error: Issue };

const span = (n: Node): [number, number] => [n.s, n.e];

/** Độ sâu ngăn xếp tối đa của bytecode (công thức cố định, contract §7). */
export function stackDepth(n: Node): number {
  switch (n.t) {
    case 'num':
    case 'bool':
    case 'str':
    case 'tag':
      return 1;
    case 'paren':
    case 'un':
      return stackDepth(n.x);
    case 'bin': {
      const l = stackDepth(n.l);
      const r = stackDepth(n.r);
      return n.op === '&&' || n.op === '||' ? Math.max(l, r) : Math.max(l, 1 + r);
    }
    case 'cond':
      return Math.max(stackDepth(n.c), stackDepth(n.a), stackDepth(n.b));
    case 'call': {
      if (n.name === 'text') return stackDepth(n.args[0]!);
      let m = 0;
      let pushed = 0;
      n.args.forEach((a, i) => {
        if (n.name === 'round' && i === 1) return;
        m = Math.max(m, pushed + stackDepth(a));
        pushed++;
      });
      return m;
    }
  }
}

export function check(
  root: Node,
  limitIssue: Issue | null,
  src: { chars: number; bytes: number },
  env: CompileEnv,
): CheckResult {
  const bad = (code: string, sp: [number, number]): CheckResult => ({
    ok: false,
    error: { code, span: sp },
  });

  // 1) tên
  const inputs: string[] = [];
  const tableArgs = tableArgNodes(root);
  for (const n of preorder(root)) {
    if (n.t === 'call' && !(n.name in FUNCS)) return bad('E_EXPR_UNKNOWN_FUNC', n.nameSpan);
    if (n.t === 'tag') {
      if (tableArgs.has(n)) {
        if (!env.hasTable(n.id)) return bad('E_EXPR_UNKNOWN_TABLE', span(n));
      } else {
        if (env.tagType(n.id) === undefined) return bad('E_EXPR_UNKNOWN_TAG', span(n));
        if (!inputs.includes(n.id)) inputs.push(n.id);
      }
    }
  }
  // 2) số tham số
  for (const n of preorder(root)) {
    if (n.t === 'call') {
      const [lo, hi] = FUNCS[n.name]!;
      if (n.args.length < lo || n.args.length > hi) return bad('E_EXPR_ARITY', span(n));
    }
  }
  // 3) kiểu (hậu thứ tự; lỗi đầu tiên)
  let err: Issue | null = null;
  const typeErr = (n: Node): void => {
    err ??= { code: 'E_EXPR_TYPE', span: span(n) };
  };
  const nb = (t: ExprType): boolean => t === 'number' || t === 'bool';
  const ty = (n: Node): ExprType => {
    if (err) return 'number';
    switch (n.t) {
      case 'num':
        return (n.ty = 'number');
      case 'bool':
        return (n.ty = 'bool');
      case 'str':
        return (n.ty = 'string');
      case 'tag':
        return (n.ty = kindOfTag(env.tagType(n.id)!));
      case 'paren':
        return (n.ty = ty(n.x));
      case 'un': {
        const x = ty(n.x);
        if (err) return 'number';
        if (n.op === '-') {
          if (!nb(x)) typeErr(n.x);
          return (n.ty = 'number');
        }
        if (x !== 'bool') typeErr(n.x);
        return (n.ty = 'bool');
      }
      case 'bin': {
        const l = ty(n.l);
        if (err) return 'number';
        const r = ty(n.r);
        if (err) return 'number';
        if (n.op === '+' || n.op === '-' || n.op === '*' || n.op === '/' || n.op === '%') {
          if (!nb(l)) typeErr(n.l);
          else if (!nb(r)) typeErr(n.r);
          return (n.ty = 'number');
        }
        if (n.op === '<' || n.op === '<=' || n.op === '>' || n.op === '>=') {
          if (!nb(l)) typeErr(n.l);
          else if (!nb(r)) typeErr(n.r);
          return (n.ty = 'bool');
        }
        if (n.op === '==' || n.op === '!=') {
          if ((l === 'string') !== (r === 'string')) typeErr(n.r);
          return (n.ty = 'bool');
        }
        if (l !== 'bool') typeErr(n.l);
        else if (r !== 'bool') typeErr(n.r);
        return (n.ty = 'bool');
      }
      case 'cond': {
        const c = ty(n.c);
        if (err) return 'number';
        if (c !== 'bool') {
          typeErr(n.c);
          return 'number';
        }
        const a = ty(n.a);
        if (err) return 'number';
        const b = ty(n.b);
        if (err) return 'number';
        if ((a === 'string') !== (b === 'string')) {
          typeErr(n.b);
          return 'number';
        }
        return (n.ty = a === b ? a : 'number');
      }
      case 'call': {
        n.ty = n.name === 'text' ? 'string' : 'number';
        if (n.name === 'text') {
          const x = ty(n.args[0]!);
          if (err) return 'string';
          if (!nb(x)) typeErr(n.args[0]!);
          else if (!isBareWord(n.args[1]!)) typeErr(n.args[1]!);
          return 'string';
        }
        for (let i = 0; i < n.args.length; i++) {
          const a = n.args[i]!;
          if (n.name === 'round' && i === 1) {
            // n: số nguyên 0–9 viết thẳng
            if (!(a.t === 'num' && Number.isInteger(a.v) && a.v >= 0 && a.v <= 9)) typeErr(a);
            continue;
          }
          const x = ty(a);
          if (err) return 'number';
          if (!nb(x)) typeErr(a);
        }
        return 'number';
      }
    }
  };
  const rootType = ty(root);
  if (err) return { ok: false, error: err };
  const target = env.target;
  const okAssign =
    (target === 'BOOL' && rootType === 'bool') ||
    (target === 'STRING' && rootType === 'string') ||
    (target !== 'BOOL' && target !== 'STRING' && nb(rootType));
  if (!okAssign) return bad('E_EXPR_TYPE', span(root));
  // 4) giới hạn: ký tự, byte, mức lồng, số Tag đầu vào, ngăn xếp
  if (src.chars > MAX_CHARS) return bad('E_EXPR_LIMIT', [MAX_CHARS, MAX_CHARS + 1]);
  if (src.bytes > MAX_BYTES) return bad('E_EXPR_LIMIT', [MAX_CHARS, MAX_CHARS + 1]);
  if (limitIssue) return { ok: false, error: limitIssue };
  if (inputs.length > MAX_INPUTS) {
    const id = inputs[MAX_INPUTS]!;
    const node = [...preorder(root)].find((x) => x.t === 'tag' && x.id === id)!;
    return bad('E_EXPR_LIMIT', span(node));
  }
  const stack = stackDepth(root);
  if (stack > MAX_STACK) return bad('E_EXPR_LIMIT', span(root));
  const warnings: string[] = [];
  if (inputs.some((id) => ['INT64', 'UINT64'].includes(env.tagType(id)!)))
    warnings.push('W_EXPR_INT64');
  return { ok: true, inputs, warnings, rootType, stack };
}
