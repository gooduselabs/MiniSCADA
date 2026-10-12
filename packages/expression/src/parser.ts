// Parser đệ quy xuống (contract expression-language §2, R17). Lỗi cú pháp là lỗi đầu tiên theo vị trí:
// bộ tách từ chạy lười nên token lỗi chỉ gây lỗi khi parser tới đó.
import { lex, type Tok } from './lexer.ts';
import type { ExprType } from './types.ts';

export type Span = [number, number];

interface Base {
  s: number;
  e: number;
  /** Kiểu do checker gán. */
  ty?: ExprType;
}
export type Node =
  | (Base & { t: 'num'; v: number })
  | (Base & { t: 'bool'; v: boolean })
  | (Base & { t: 'str'; v: string })
  | (Base & { t: 'tag'; id: string })
  | (Base & { t: 'paren'; x: Node })
  | (Base & { t: 'un'; op: '-' | '!'; x: Node })
  | (Base & { t: 'bin'; op: string; l: Node; r: Node })
  | (Base & { t: 'cond'; c: Node; a: Node; b: Node })
  | (Base & { t: 'call'; name: string; nameSpan: Span; args: Node[] });

export interface Issue {
  code: string;
  span: Span;
}

/** Ném khi gặp lỗi; parse() bắt và trả về. */
class Abort {
  issue: Issue;
  constructor(issue: Issue) {
    this.issue = issue;
  }
}

export interface ParseResult {
  root: Node;
  /** Mức lồng thứ 33 đầu tiên (E_EXPR_LIMIT), kiểm ở giai đoạn giới hạn. */
  limitIssue: Issue | null;
}

const NEST_LIMIT = 32;
const NEST_ABORT = 100;

export function parse(cps: readonly string[]): ParseResult | { error: Issue } {
  try {
    return parseOrThrow(cps);
  } catch (e) {
    if (e instanceof Abort) return { error: e.issue };
    throw e;
  }
}

function parseOrThrow(cps: readonly string[]): ParseResult {
  const toks = lex(cps);
  let p = 0;
  let limitIssue: Issue | null = null;
  const peek = (): Tok => toks[p]!;
  const fail = (t: Tok): never => {
    // token lexerr mang đúng vị trí lỗi tách từ; còn lại là token không mong đợi (hoặc hết chuỗi: [len, len])
    throw new Abort({ code: 'E_EXPR_SYNTAX', span: [t.s, t.e] });
  };
  const isOp = (t: Tok, ...ops: string[]): boolean => t.k === 'op' && ops.includes(t.text);
  const take = (): Tok => toks[p++]!;
  const expectOp = (op: string): Tok => {
    const t = peek();
    if (!isOp(t, op)) fail(t);
    p++;
    return t;
  };
  const enter = (depth: number, tok: Tok): void => {
    if (depth > NEST_LIMIT && !limitIssue)
      limitIssue = { code: 'E_EXPR_LIMIT', span: [tok.s, tok.e] };
    if (depth > NEST_ABORT) throw new Abort(limitIssue!);
  };

  function expr(d: number): Node {
    const c = orExpr(d);
    if (isOp(peek(), '?')) {
      const q = take();
      enter(d + 1, q);
      const a = expr(d + 1);
      const col = expectOp(':');
      enter(d + 1, col);
      const b = expr(d + 1);
      return { t: 'cond', c, a, b, s: c.s, e: b.e };
    }
    return c;
  }
  function orExpr(d: number): Node {
    let l = andExpr(d);
    while (isOp(peek(), '||')) {
      take();
      const r = andExpr(d);
      l = { t: 'bin', op: '||', l, r, s: l.s, e: r.e };
    }
    return l;
  }
  function andExpr(d: number): Node {
    let l = eqExpr(d);
    while (isOp(peek(), '&&')) {
      take();
      const r = eqExpr(d);
      l = { t: 'bin', op: '&&', l, r, s: l.s, e: r.e };
    }
    return l;
  }
  function eqExpr(d: number): Node {
    let l = relExpr(d);
    if (isOp(peek(), '==', '!=')) {
      const op = (take() as { text: string }).text;
      const r = relExpr(d);
      l = { t: 'bin', op, l, r, s: l.s, e: r.e };
      if (isOp(peek(), '==', '!=')) fail(peek()); // không kết hợp
    }
    return l;
  }
  function relExpr(d: number): Node {
    let l = addExpr(d);
    if (isOp(peek(), '<', '<=', '>', '>=')) {
      const op = (take() as { text: string }).text;
      const r = addExpr(d);
      l = { t: 'bin', op, l, r, s: l.s, e: r.e };
      if (isOp(peek(), '<', '<=', '>', '>=')) fail(peek()); // không kết hợp
    }
    return l;
  }
  function addExpr(d: number): Node {
    let l = mulExpr(d);
    while (isOp(peek(), '+', '-')) {
      const op = (take() as { text: string }).text;
      const r = mulExpr(d);
      l = { t: 'bin', op, l, r, s: l.s, e: r.e };
    }
    return l;
  }
  function mulExpr(d: number): Node {
    let l = unary(d);
    while (isOp(peek(), '*', '/', '%')) {
      const op = (take() as { text: string }).text;
      const r = unary(d);
      l = { t: 'bin', op, l, r, s: l.s, e: r.e };
    }
    return l;
  }
  function unary(d: number): Node {
    if (isOp(peek(), '-', '!')) {
      const o = take() as Tok & { k: 'op' };
      enter(d + 1, o);
      const x = unary(d + 1);
      return { t: 'un', op: o.text as '-' | '!', x, s: o.s, e: x.e };
    }
    return primary(d);
  }
  function primary(d: number): Node {
    const t = peek();
    if (t.k === 'num') {
      take();
      return { t: 'num', v: t.v, s: t.s, e: t.e };
    }
    if (t.k === 'str') {
      take();
      return { t: 'str', v: t.text, s: t.s, e: t.e };
    }
    if (t.k === 'word') {
      take();
      const nx = peek();
      if (!t.text.includes('.') && isOp(nx, '(')) {
        take();
        enter(d + 1, nx);
        const args: Node[] = [];
        if (!isOp(peek(), ')')) {
          for (;;) {
            args.push(expr(d + 1));
            if (isOp(peek(), ',')) {
              take();
              continue;
            }
            break;
          }
        }
        const rp = expectOp(')');
        return { t: 'call', name: t.text, nameSpan: [t.s, t.e], args, s: t.s, e: rp.e };
      }
      if (t.text === 'true' || t.text === 'false')
        return { t: 'bool', v: t.text === 'true', s: t.s, e: t.e };
      return { t: 'tag', id: t.text, s: t.s, e: t.e };
    }
    if (isOp(t, '(')) {
      take();
      enter(d + 1, t);
      const x = expr(d + 1);
      const rp = expectOp(')');
      return { t: 'paren', x, s: t.s, e: rp.e };
    }
    return fail(t);
  }

  const root = expr(0);
  if (peek().k !== 'end') fail(peek());
  return { root, limitIssue };
}

/** Duyệt tiền thứ tự (theo vị trí nguồn). */
export function* preorder(n: Node): Generator<Node> {
  yield n;
  switch (n.t) {
    case 'bin':
      yield* preorder(n.l);
      yield* preorder(n.r);
      break;
    case 'un':
    case 'paren':
      yield* preorder(n.x);
      break;
    case 'cond':
      yield* preorder(n.c);
      yield* preorder(n.a);
      yield* preorder(n.b);
      break;
    case 'call':
      for (const a of n.args) yield* preorder(a);
      break;
    default:
      break;
  }
}
