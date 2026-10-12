// Sinh bộ vector biểu thức dùng chung TS (packages/expression) và C++ (core/expression):
// specs/006-tags-modbus/contracts/expression-language.md §8. Tất định, không phụ thuộc gói ngoài.
//
//   node tests/expression-vectors/generate.mjs
//
// - Ca sinh tự động: kết quả do BỘ TÍNH THAM CHIẾU viết riêng trong script này (duyệt cây trực tiếp,
//   không import @mat/expression), để vector không tự xác nhận chính nó.
// - Ca viết tay: handwritten/<nhóm>.json, kết quả ghi sẵn. Script chạy bộ tham chiếu trên từng ca viết
//   tay và dừng nếu khác kết quả đã ghi (hai nguồn độc lập phải trùng nhau).
// - Ra: tests/expression-vectors/<nhóm>.json = { group, cases } (ca viết tay trước, ca sinh sau).
// - Script tự kiểm số ca tối thiểu của từng nhóm và tổng (SC-008: >= 300).
//
// Quy ước vị trí (span): chỉ số ký tự Unicode (code point), [đầu, cuối). Xem contract §6 và
// "Quy ước chốt khi cài" trong specs/006-tags-modbus/tasks.md (T008, T017).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// ======================================================================================
// Bộ tính tham chiếu (cây cú pháp, đệ quy trực tiếp)
// ======================================================================================

const FUNCS = {
  min: [2, 16],
  max: [2, 16],
  abs: [1, 1],
  round: [1, 2],
  clamp: [3, 3],
  text: [2, 2],
};
const INT_RANGE = {
  INT16: [-(2n ** 15n), 2n ** 15n - 1n],
  UINT16: [0n, 2n ** 16n - 1n],
  INT32: [-(2n ** 31n), 2n ** 31n - 1n],
  UINT32: [0n, 2n ** 32n - 1n],
  INT64: [-(2n ** 63n), 2n ** 63n - 1n],
  UINT64: [0n, 2n ** 64n - 1n],
};
const kindOfTag = (t) => (t === 'BOOL' ? 'bool' : t === 'STRING' ? 'string' : 'number');

const isDigit = (c) => c !== undefined && c >= '0' && c <= '9';
const isAlpha = (c) => c !== undefined && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'));
const isWord = (c) => isDigit(c) || isAlpha(c) || c === '_';

/** Bộ tách từ lười: dừng ở lỗi đầu tiên (token 'lexerr'). */
function lex(cps) {
  const toks = [];
  const n = cps.length;
  let i = 0;
  const err = (s, e) => toks.push({ k: 'lexerr', issue: { code: 'E_EXPR_SYNTAX', span: [s, e] } });
  for (;;) {
    while (i < n && (cps[i] === ' ' || cps[i] === '\t' || cps[i] === '\r' || cps[i] === '\n')) i++;
    if (i >= n) {
      toks.push({ k: 'end', s: n, e: n });
      return toks;
    }
    const c = cps[i];
    if (isDigit(c)) {
      let j = i;
      while (isDigit(cps[j])) j++;
      if (cps[j] === '.' && isDigit(cps[j + 1])) {
        j++;
        while (isDigit(cps[j])) j++;
      }
      if (cps[j] === 'e' || cps[j] === 'E') {
        let k = j + 1;
        if (cps[k] === '+' || cps[k] === '-') k++;
        if (isDigit(cps[k])) {
          while (isDigit(cps[k])) k++;
          j = k;
        }
      }
      const v = Number(cps.slice(i, j).join(''));
      if (!Number.isFinite(v)) return (err(i, j), toks);
      toks.push({ k: 'num', s: i, e: j, v });
      i = j;
      continue;
    }
    if (isAlpha(c)) {
      let j = i + 1;
      while (isWord(cps[j])) j++;
      while (cps[j] === '.' && isWord(cps[j + 1])) {
        j += 2;
        while (isWord(cps[j])) j++;
      }
      toks.push({ k: 'word', s: i, e: j, text: cps.slice(i, j).join('') });
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let text = '';
      for (;;) {
        if (j >= n) return (err(i, n), toks);
        const d = cps[j];
        if (d === '"') break;
        if (d === '\\') {
          if (cps[j + 1] === '"' || cps[j + 1] === '\\') {
            text += cps[j + 1];
            j += 2;
            continue;
          }
          return (err(j, Math.min(j + 2, n)), toks);
        }
        if (d.codePointAt(0) < 0x20) return (err(j, j + 1), toks);
        text += d;
        j++;
      }
      toks.push({ k: 'str', s: i, e: j + 1, text });
      i = j + 1;
      continue;
    }
    const two = c + (cps[i + 1] ?? '');
    if (['||', '&&', '==', '!=', '<=', '>='].includes(two)) {
      toks.push({ k: 'op', s: i, e: i + 2, text: two });
      i += 2;
      continue;
    }
    if ('+-*/%<>!?:(),'.includes(c)) {
      toks.push({ k: 'op', s: i, e: i + 1, text: c });
      i++;
      continue;
    }
    return (err(i, i + 1), toks);
  }
}

class Abort {
  constructor(issue) {
    this.issue = issue;
  }
}

function parse(cps) {
  const toks = lex(cps);
  let p = 0;
  let limitIssue = null; // mức lồng thứ 33 đầu tiên
  const peek = () => toks[p];
  const fail = (t) => {
    if (t.k === 'lexerr') throw new Abort(t.issue);
    throw new Abort({ code: 'E_EXPR_SYNTAX', span: [t.s, t.e] });
  };
  const isOp = (t, ...ops) => t.k === 'op' && ops.includes(t.text);
  const take = () => toks[p++];
  const expectOp = (op) => {
    const t = peek();
    if (!isOp(t, op)) fail(t);
    p++;
    return t;
  };
  const enter = (depth, tok) => {
    if (depth > 32 && !limitIssue) limitIssue = { code: 'E_EXPR_LIMIT', span: [tok.s, tok.e] };
    if (depth > 100) throw new Abort(limitIssue);
  };

  function expr(d) {
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
  function orExpr(d) {
    let l = andExpr(d);
    while (isOp(peek(), '||')) {
      take();
      const r = andExpr(d);
      l = { t: 'bin', op: '||', l, r, s: l.s, e: r.e };
    }
    return l;
  }
  function andExpr(d) {
    let l = eqExpr(d);
    while (isOp(peek(), '&&')) {
      take();
      const r = eqExpr(d);
      l = { t: 'bin', op: '&&', l, r, s: l.s, e: r.e };
    }
    return l;
  }
  function eqExpr(d) {
    let l = relExpr(d);
    if (isOp(peek(), '==', '!=')) {
      const op = take().text;
      const r = relExpr(d);
      l = { t: 'bin', op, l, r, s: l.s, e: r.e };
      if (isOp(peek(), '==', '!=')) fail(peek());
    }
    return l;
  }
  function relExpr(d) {
    let l = addExpr(d);
    if (isOp(peek(), '<', '<=', '>', '>=')) {
      const op = take().text;
      const r = addExpr(d);
      l = { t: 'bin', op, l, r, s: l.s, e: r.e };
      if (isOp(peek(), '<', '<=', '>', '>=')) fail(peek());
    }
    return l;
  }
  function addExpr(d) {
    let l = mulExpr(d);
    while (isOp(peek(), '+', '-')) {
      const op = take().text;
      const r = mulExpr(d);
      l = { t: 'bin', op, l, r, s: l.s, e: r.e };
    }
    return l;
  }
  function mulExpr(d) {
    let l = unary(d);
    while (isOp(peek(), '*', '/', '%')) {
      const op = take().text;
      const r = unary(d);
      l = { t: 'bin', op, l, r, s: l.s, e: r.e };
    }
    return l;
  }
  function unary(d) {
    if (isOp(peek(), '-', '!')) {
      const o = take();
      enter(d + 1, o);
      const x = unary(d + 1);
      return { t: 'un', op: o.text, x, s: o.s, e: x.e };
    }
    return primary(d);
  }
  function primary(d) {
    const t = peek();
    if (t.k === 'num') return (take(), { t: 'num', v: t.v, s: t.s, e: t.e });
    if (t.k === 'str') return (take(), { t: 'str', v: t.text, s: t.s, e: t.e });
    if (t.k === 'word') {
      take();
      const nx = peek();
      if (!t.text.includes('.') && isOp(nx, '(')) {
        take();
        enter(d + 1, nx);
        const args = [];
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

/** Duyệt tiền thứ tự theo vị trí nguồn. */
function* preorder(n) {
  yield n;
  if (n.t === 'bin') {
    yield* preorder(n.l);
    yield* preorder(n.r);
  } else if (n.t === 'un' || n.t === 'paren') yield* preorder(n.x);
  else if (n.t === 'cond') {
    yield* preorder(n.c);
    yield* preorder(n.a);
    yield* preorder(n.b);
  } else if (n.t === 'call') for (const a of n.args) yield* preorder(a);
}

const isBareWord = (n) => n.t === 'tag' && !n.id.includes('.');

/** Độ sâu ngăn xếp của bytecode (contract §7): công thức cố định, hai bản phải giống nhau. */
function stackDepth(n) {
  switch (n.t) {
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
      if (n.name === 'text') return stackDepth(n.args[0]);
      let m = 0;
      let pushed = 0;
      n.args.forEach((a, i) => {
        if (n.name === 'round' && i === 1) return;
        m = Math.max(m, pushed + stackDepth(a));
        pushed++;
      });
      return m;
    }
    default:
      return 1;
  }
}

function refCompile(src, env) {
  const cps = Array.from(src);
  if (cps.length > 100000)
    return { ok: false, errors: [{ code: 'E_EXPR_LIMIT', span: [1000, 1001] }] };
  let parsed;
  try {
    parsed = parse(cps);
  } catch (e) {
    if (e instanceof Abort) return { ok: false, errors: [e.issue] };
    throw e;
  }
  const { root, limitIssue } = parsed;
  const bad = (code, span) => ({ ok: false, errors: [{ code, span }] });

  // 1) tên (một lượt theo thứ tự vị trí nguồn)
  const inputs = [];
  const tableArgs = new Set();
  for (const n of preorder(root))
    if (n.t === 'call' && n.name === 'text' && n.args.length === 2 && isBareWord(n.args[1]))
      tableArgs.add(n.args[1]);
  for (const n of preorder(root)) {
    if (n.t === 'call' && !(n.name in FUNCS)) return bad('E_EXPR_UNKNOWN_FUNC', n.nameSpan);
    if (n.t === 'tag') {
      if (tableArgs.has(n)) {
        if (!env.hasTable(n.id)) return bad('E_EXPR_UNKNOWN_TABLE', [n.s, n.e]);
      } else {
        if (env.tagType(n.id) === undefined) return bad('E_EXPR_UNKNOWN_TAG', [n.s, n.e]);
        if (!inputs.includes(n.id)) inputs.push(n.id);
      }
    }
  }
  // 2) số tham số
  for (const n of preorder(root)) {
    if (n.t === 'call') {
      const [lo, hi] = FUNCS[n.name];
      if (n.args.length < lo || n.args.length > hi) return bad('E_EXPR_ARITY', [n.s, n.e]);
    }
  }
  // 3) kiểu (hậu thứ tự)
  const nb = (ty) => ty === 'number' || ty === 'bool';
  let err = null;
  const sp = (n) => [n.s, n.e];
  const typeErr = (n) => {
    err = err ?? { code: 'E_EXPR_TYPE', span: sp(n) };
  };
  function ty(n) {
    if (err) return 'number';
    switch (n.t) {
      case 'num':
        return (n.ty = 'number');
      case 'bool':
        return (n.ty = 'bool');
      case 'str':
        return (n.ty = 'string');
      case 'tag':
        return (n.ty = kindOfTag(env.tagType(n.id)));
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
        if ('+-*/%'.includes(n.op) && n.op.length === 1) {
          if (!nb(l)) typeErr(n.l);
          else if (!nb(r)) typeErr(n.r);
          return (n.ty = 'number');
        }
        if (['<', '<=', '>', '>='].includes(n.op)) {
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
          const x = ty(n.args[0]);
          if (err) return 'string';
          if (!nb(x)) typeErr(n.args[0]);
          else if (!isBareWord(n.args[1])) typeErr(n.args[1]);
          return 'string';
        }
        for (let i = 0; i < n.args.length; i++) {
          const a = n.args[i];
          if (n.name === 'round' && i === 1) {
            const okLit = a.t === 'num' && Number.isInteger(a.v) && a.v >= 0 && a.v <= 9;
            if (!okLit) typeErr(a);
            else a.digits = a.v;
            continue;
          }
          const x = ty(a);
          if (err) return 'number';
          if (!nb(x)) typeErr(a);
        }
        return 'number';
      }
    }
    throw new Error('node');
  }
  const rootTy = ty(root);
  if (err) return { ok: false, errors: [err] };
  const target = env.target;
  const okAssign =
    (target === 'BOOL' && rootTy === 'bool') ||
    (target === 'STRING' && rootTy === 'string') ||
    (target !== 'BOOL' && target !== 'STRING' && nb(rootTy));
  if (!okAssign) return bad('E_EXPR_TYPE', sp(root));
  // 4) giới hạn
  if (cps.length > 1000) return bad('E_EXPR_LIMIT', [1000, 1001]);
  if (Buffer.byteLength(src, 'utf8') > 4096) return bad('E_EXPR_LIMIT', [1000, 1001]);
  if (limitIssue) return { ok: false, errors: [limitIssue] };
  if (inputs.length > 32) {
    const id33 = inputs[32];
    const node = [...preorder(root)].find((x) => x.t === 'tag' && x.id === id33);
    return bad('E_EXPR_LIMIT', sp(node));
  }
  if (stackDepth(root) > 64) return bad('E_EXPR_LIMIT', sp(root));
  const warnings = [];
  if (inputs.some((id) => ['INT64', 'UINT64'].includes(env.tagType(id))))
    warnings.push({ code: 'W_EXPR_INT64' });
  return { ok: true, root, inputs, warnings, rootTy };
}

// ---- Số, làm tròn, bảng giá trị ----

function refRound(x) {
  const r = Math.trunc(x);
  if (Math.abs(x - r) >= 0.5) return r + (x > 0 ? 1 : -1);
  return r;
}

function refLookup(table, x) {
  if (typeof x === 'boolean') x = x ? 1 : 0;
  if (!Number.isNaN(x)) {
    for (const e of table.entries) {
      if (e.value !== undefined) {
        const v = typeof e.value === 'boolean' ? (e.value ? 1 : 0) : e.value;
        if (x === v) return e.text;
      } else if ((e.from === undefined || x >= e.from) && (e.to === undefined || x < e.to))
        return e.text;
    }
  }
  return table.default?.text ?? '';
}

class EvalError {
  constructor(reason) {
    this.reason = reason;
  }
}

function refEval(c, inputs, tables, target) {
  const st = { unc: null };
  const num = (x) => (typeof x === 'boolean' ? (x ? 1 : 0) : x);
  const chk = (v) => {
    if (v === Infinity || v === -Infinity) throw new EvalError('OVERFLOW');
    if (Number.isNaN(v)) throw new EvalError('NOT_A_NUMBER');
    return v;
  };
  function ev(n) {
    switch (n.t) {
      case 'num':
      case 'bool':
      case 'str':
        return n.v;
      case 'paren':
        return ev(n.x);
      case 'tag': {
        const i = inputs[n.id];
        if (i.quality === 'BAD')
          throw new EvalError(i.reason === 'NO_VALUE' ? 'NO_VALUE' : 'INPUT_BAD');
        if (i.quality === 'UNCERTAIN' && st.unc === null) st.unc = i.reason ?? 'UNCERTAIN';
        if (i.type === 'BOOL' || i.type === 'STRING') return i.value;
        return typeof i.value === 'number' ? i.value : Number(i.value);
      }
      case 'un': {
        const x = ev(n.x);
        return n.op === '!' ? !x : -num(x);
      }
      case 'bin': {
        if (n.op === '&&') return ev(n.l) ? ev(n.r) : false;
        if (n.op === '||') return ev(n.l) ? true : ev(n.r);
        const l = ev(n.l);
        const r = ev(n.r);
        if (n.op === '==' || n.op === '!=') {
          const eq = typeof l === 'string' ? l === r : num(l) === num(r);
          return n.op === '==' ? eq : !eq;
        }
        const a = num(l);
        const b = num(r);
        switch (n.op) {
          case '+':
            return chk(a + b);
          case '-':
            return chk(a - b);
          case '*':
            return chk(a * b);
          case '/':
            if (b === 0) throw new EvalError('DIV_ZERO');
            return chk(a / b);
          case '%':
            if (b === 0) throw new EvalError('MOD_ZERO');
            return chk(a % b);
          case '<':
            return a < b;
          case '<=':
            return a <= b;
          case '>':
            return a > b;
          case '>=':
            return a >= b;
        }
        throw new Error('op');
      }
      case 'cond': {
        const r = ev(n.c) ? ev(n.a) : ev(n.b);
        return n.ty === 'number' ? num(r) : r;
      }
      case 'call': {
        const a = [];
        if (n.name === 'text') {
          const x = num(ev(n.args[0]));
          return refLookup(tables[n.args[1].id], x);
        }
        for (let i = 0; i < n.args.length; i++) {
          if (n.name === 'round' && i === 1) continue;
          a.push(num(ev(n.args[i])));
        }
        if (n.name === 'min') return a.reduce((m, v) => (v < m ? v : m));
        if (n.name === 'max') return a.reduce((m, v) => (v > m ? v : m));
        if (n.name === 'abs') return a[0] < 0 ? -a[0] : a[0];
        if (n.name === 'clamp') {
          if (a[1] > a[2]) throw new EvalError('CLAMP_RANGE');
          const lo = a[0] < a[1] ? a[1] : a[0];
          return lo > a[2] ? a[2] : lo;
        }
        if (n.name === 'round') {
          if (n.args.length === 1) return refRound(a[0]);
          const p = 10 ** n.args[1].digits;
          const m = chk(a[0] * p);
          return refRound(m) / p;
        }
      }
    }
    throw new Error('eval');
  }
  try {
    let v = ev(c.root);
    let out;
    if (target === 'BOOL' || target === 'STRING') out = v;
    else {
      v = num(v);
      if (Number.isNaN(v)) throw new EvalError('NOT_A_NUMBER');
      if (v === Infinity || v === -Infinity) throw new EvalError('OVERFLOW');
      if (target === 'FLOAT64') out = v;
      else if (target === 'FLOAT32') {
        out = Math.fround(v);
        if (!Number.isFinite(out)) throw new EvalError('OVERFLOW');
      } else {
        // bool vào số nguyên là 1/0, số thì làm tròn
        const r = typeof v === 'number' ? refRound(v) : v;
        const b = BigInt(r);
        const [lo, hi] = INT_RANGE[target];
        if (b < lo || b > hi) throw new EvalError('OUT_OF_RANGE');
        out = b;
      }
    }
    if (target === 'STRING' && Buffer.byteLength(out, 'utf8') > 1024)
      throw new EvalError('OUT_OF_RANGE');
    let value;
    if (typeof out === 'bigint')
      value = target === 'INT64' || target === 'UINT64' ? out.toString() : Number(out);
    else if (typeof out === 'number') value = out === 0 ? 0 : out;
    else value = out;
    if (st.unc !== null) return { value, quality: 'UNCERTAIN', reason: st.unc };
    return { value, quality: 'GOOD' };
  } catch (e) {
    if (e instanceof EvalError) return { value: null, quality: 'BAD', reason: e.reason };
    throw e;
  }
}

/** Kết quả mong đợi của một ca theo bộ tham chiếu. */
function refExpect(cs) {
  const env = {
    target: cs.target,
    tagType: (id) => cs.inputs[id]?.type,
    hasTable: (name) => name in cs.tables,
  };
  const c = refCompile(cs.expr, env);
  if (!c.ok) return { error: c.errors[0].code, span: c.errors[0].span };
  const r = refEval(c, cs.inputs, cs.tables, cs.target);
  if (c.warnings.length > 0) r.warnings = c.warnings.map((w) => w.code);
  return r;
}

// ======================================================================================
// Dựng ca
// ======================================================================================

const FLOAT_TYPES = ['FLOAT32', 'FLOAT64'];
function normInput(v) {
  if (v !== null && typeof v === 'object') {
    const o = { type: v.type, value: v.value ?? null, quality: v.quality ?? 'GOOD' };
    if (v.reason !== undefined) o.reason = v.reason;
    return o;
  }
  if (typeof v === 'boolean') return { type: 'BOOL', value: v, quality: 'GOOD' };
  if (typeof v === 'string') return { type: 'STRING', value: v, quality: 'GOOD' };
  return { type: 'FLOAT64', value: v, quality: 'GOOD' };
}
function validateInput(name, id, i) {
  if (FLOAT_TYPES.includes(i.type) && typeof i.value === 'number') {
    if (!Number.isFinite(i.value)) throw new Error(`${name}: ${id} không hữu hạn`);
    if (i.type === 'FLOAT32' && Math.fround(i.value) !== i.value)
      throw new Error(`${name}: ${id} không phải số 32 bit`);
  }
  if (i.quality === 'BAD' && i.value !== null)
    throw new Error(`${name}: ${id} BAD phải có value null`);
  if (i.quality !== 'GOOD' && !i.reason) throw new Error(`${name}: ${id} thiếu reason`);
}
function normCase(c) {
  const inputs = {};
  for (const [id, v] of Object.entries(c.inputs ?? {})) {
    inputs[id] = normInput(v);
    validateInput(c.name, id, inputs[id]);
  }
  return {
    name: c.name,
    expr: c.expr,
    inputs,
    tables: c.tables ?? {},
    target: c.target ?? 'FLOAT64',
    ...(c.expect ? { expect: c.expect } : {}),
  };
}
const withExpect = (c) => ({
  name: c.name,
  expr: c.expr,
  inputs: c.inputs,
  tables: c.tables,
  target: c.target,
  expect: refExpect(c),
});

const auto = (name, expr, inputs = {}, target = 'FLOAT64', tables = {}) =>
  withExpect(normCase({ name, expr, inputs, target, tables }));

const canon = (v) =>
  v !== null && typeof v === 'object'
    ? Array.isArray(v)
      ? v.map(canon)
      : Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canon(v[k])]),
        )
    : v;
const sameExpect = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** JSON một ca một dòng; số âm không được viết thành -0 mất dấu: viết -0.0. */
function lineJson(v) {
  return JSON.stringify(v, (_k, x) => (Object.is(x, -0) ? '__NEGZERO__' : x)).replace(
    /"__NEGZERO__"/g,
    '-0.0',
  );
}
function writeGroup(path, group, cases) {
  const body = cases.map((c) => '  ' + lineJson(c)).join(',\n');
  writeFileSync(path, `{ "group": "${group}", "cases": [\n${body}\n] }\n`);
}

// ---- Nhóm ----

const MIN = {
  arith: 50,
  'mod-round': 40,
  compare: 30,
  'logic-quality': 50,
  ternary: 25,
  functions: 35,
  text: 20,
  strings: 15,
  assign: 25,
  'syntax-errors': 30,
  'type-errors': 25,
  limits: 10,
};

const groups = Object.fromEntries(Object.keys(MIN).map((g) => [g, []]));
const num = (v, type = 'FLOAT64') => ({ type, value: v, quality: 'GOOD' });
const bad = (type, reason = 'DISCONNECTED') => ({ type, value: null, quality: 'BAD', reason });
const unc = (type, value, reason = 'CLAMPED') => ({ type, value, quality: 'UNCERTAIN', reason });

// arith
{
  const g = groups.arith;
  const pairs = [
    [2, 3],
    [-7, 0.5],
    [0.1, 0.2],
    [1e308, 1e308],
    [1, 3],
    [0, 0],
    [5, 0],
    [-0, 0],
  ];
  for (const op of ['+', '-', '*', '/'])
    pairs.forEach(([a, b], i) =>
      g.push(
        auto(
          `arith-${op === '+' ? 'add' : op === '-' ? 'sub' : op === '*' ? 'mul' : 'div'}-${i}`,
          `A ${op} B`,
          { A: num(a), B: num(b) },
        ),
      ),
    );
  const t = true;
  const f = false;
  g.push(auto('arith-bool-add', 'T + T', { T: t }));
  g.push(auto('arith-bool-mul', 'T * 5', { T: t }));
  g.push(auto('arith-bool-sub', 'F - T', { F: f, T: t }));
  g.push(auto('arith-bool-neg', '-T', { T: t }));
  g.push(auto('arith-not-plus', '!F + 1', { F: f }));
  g.push(auto('arith-literals-prec', '1 + 2 * 3'));
  g.push(auto('arith-literals-paren', '(1 + 2) * 3'));
  g.push(auto('arith-left-assoc-sub', '10 - 4 - 3'));
  g.push(auto('arith-left-assoc-div', '100 / 10 / 5'));
  g.push(auto('arith-neg-neg', '-2 * -3'));
  g.push(auto('arith-double-minus', '- - 4'));
  g.push(auto('arith-minus-neg', '2 - -3'));
  g.push(auto('arith-sci', '1.5e3 + 2E-1'));
  g.push(auto('arith-unary-prec', '-2 * 3 + 4'));
  g.push(auto('arith-div-overflow', '1e300 * 1e300'));
  g.push(auto('arith-underflow', '1e-300 / 1e300'));
  g.push(auto('arith-int-input', 'A + B', { A: num(40000, 'UINT16'), B: num(-5, 'INT32') }));
  g.push(auto('arith-int64-input', 'A + 1', { A: num('9007199254740993', 'INT64') }, 'FLOAT64'));
}

// mod-round
{
  const g = groups['mod-round'];
  [
    [7, 3],
    [-7, 3],
    [7, -3],
    [-7, -3],
    [5.5, 2],
    [-5.5, 2],
    [1, 0],
    [1, -0],
    [0, 5],
    [1e308, 3],
    [0.3, 0.1],
    [2, 7],
  ].forEach(([a, b], i) => g.push(auto(`mod-${i}`, 'A % B', { A: num(a), B: num(b) })));
  [
    2.5, -2.5, 0.5, -0.5, 1.5, 0.49999999999999994, -0.49999999999999994, 4503599627370495.5, 1e300,
    0, -0, 2.4999999999999996,
  ].forEach((x, i) => g.push(auto(`round-half-${i}`, 'round(X)', { X: num(x) })));
  [
    [1.005, 2],
    [2.675, 2],
    [1.5, 0],
    [123.456, 1],
    [-123.456, 2],
    [1234567.891, 3],
    [5, 9],
    [1e308, 9],
    [0.1 + 0.2, 1],
    [-0.05, 1],
  ].forEach(([x, n], i) => g.push(auto(`round-digits-${i}`, `round(X, ${n})`, { X: num(x) })));
  g.push(auto('round-digits-neg-zero', 'round(-0.4, 0)'));
  g.push(auto('round-expr-arg', 'round(A / 3, 2)', { A: num(10) }));
}

// compare
{
  const g = groups.compare;
  const ops = ['<', '<=', '>', '>=', '==', '!='];
  const name = { '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge', '==': 'eq', '!=': 'ne' };
  for (const op of ops)
    [
      [1, 2],
      [2, 2],
      [3, 2],
      [-0, 0],
    ].forEach(([a, b], i) =>
      g.push(auto(`cmp-${name[op]}-${i}`, `A ${op} B`, { A: num(a), B: num(b) }, 'BOOL')),
    );
  g.push(auto('cmp-bool-eq-bool', 'A == B', { A: true, B: true }, 'BOOL'));
  g.push(auto('cmp-bool-ne-bool', 'A != B', { A: true, B: false }, 'BOOL'));
  g.push(auto('cmp-bool-eq-number', 'A == 1', { A: true }, 'BOOL'));
  g.push(auto('cmp-bool-lt-number', 'A < 2', { A: true }, 'BOOL'));
  g.push(auto('cmp-string-eq', 'S == "AUTO"', { S: 'AUTO' }, 'BOOL'));
  g.push(auto('cmp-string-ne', 'S != "AUTO"', { S: 'MAN' }, 'BOOL'));
  g.push(auto('cmp-string-case', 'S == "auto"', { S: 'AUTO' }, 'BOOL'));
  g.push(auto('cmp-chain-lt', 'A < B < C', { A: 1, B: 2, C: 3 }, 'BOOL'));
  g.push(auto('cmp-chain-eq', 'A == B == C', { A: 1, B: 1, C: 1 }, 'BOOL'));
  g.push(auto('cmp-mixed-ok', 'A < B == (C < D)', { A: 1, B: 2, C: 3, D: 4 }, 'BOOL'));
}

// logic-quality
{
  const g = groups['logic-quality'];
  const vals = [
    ['t', { type: 'BOOL', value: true, quality: 'GOOD' }],
    ['f', { type: 'BOOL', value: false, quality: 'GOOD' }],
    ['tu', unc('BOOL', true, 'CLAMPED')],
    ['fu', unc('BOOL', false, 'RETAIN_LOST')],
    ['bad', bad('BOOL')],
    ['nov', { type: 'BOOL', value: null, quality: 'BAD', reason: 'NO_VALUE' }],
  ];
  for (const [opn, op] of [
    ['and', '&&'],
    ['or', '||'],
  ])
    for (const [an, a] of vals)
      for (const [bn, b] of vals)
        g.push(auto(`lq-${opn}-${an}-${bn}`, `A ${op} B`, { A: a, B: b }, 'BOOL'));
  g.push(auto('lq-not-true', '!A', { A: true }, 'BOOL'));
  g.push(auto('lq-not-bad', '!A', { A: bad('BOOL') }, 'BOOL'));
  g.push(auto('lq-not-unc', '!A', { A: unc('BOOL', false, 'CLAMPED') }, 'BOOL'));
  g.push(
    auto('lq-arith-unc-first-reason', 'A + B', {
      A: unc('FLOAT64', 1, 'CLAMPED'),
      B: unc('FLOAT64', 2, 'RETAIN_LOST'),
    }),
  );
  g.push(auto('lq-arith-unc-bad', 'A + B', { A: unc('FLOAT64', 1), B: bad('FLOAT64') }));
  g.push(auto('lq-div-zero-over-unc', 'A / B', { A: unc('FLOAT64', 1), B: num(0) }));
  g.push(auto('lq-same-input-twice', 'A * A', { A: unc('FLOAT64', 3, 'CLAMPED') }));
  g.push(
    auto('lq-no-value-vs-bad', 'A + B', {
      A: bad('FLOAT64', 'TIMEOUT'),
      B: { type: 'FLOAT64', value: null, quality: 'BAD', reason: 'NO_VALUE' },
    }),
  );
}

// ternary
{
  const g = groups.ternary;
  const cond = { t: true, f: false };
  for (const [cn, cv] of Object.entries(cond))
    for (const an of ['good', 'bad'])
      for (const bn of ['good', 'bad'])
        g.push(
          auto(`tern-${cn}-a${an}-b${bn}`, 'C ? A : B', {
            C: cv,
            A: an === 'good' ? num(1.5) : bad('FLOAT64'),
            B: bn === 'good' ? num(2.5) : bad('FLOAT64'),
          }),
        );
  g.push(auto('tern-cond-bad', 'C ? 1 : 2', { C: bad('BOOL') }));
  g.push(auto('tern-cond-unc', 'C ? 1 : 2', { C: unc('BOOL', true) }));
  g.push(
    auto('tern-cond-unc-branch-unc', 'C ? A : 2', {
      C: unc('BOOL', true, 'RETAIN_LOST'),
      A: unc('FLOAT64', 9, 'CLAMPED'),
    }),
  );
  for (const [x, y] of [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])
    g.push(auto(`tern-right-assoc-${x}-${y}`, 'A ? 1 : B ? 2 : 3', { A: x, B: y }));
  g.push(auto('tern-nested-then', 'A ? B ? 1 : 2 : 3', { A: true, B: false }));
  g.push(auto('tern-mixed-bool-number-true', 'C ? true : 5', { C: true }));
  g.push(auto('tern-mixed-bool-number-false', 'C ? true : 5', { C: false }));
  g.push(auto('tern-bool-bool', 'C ? true : false', { C: true }, 'BOOL'));
  g.push(auto('tern-string', 'C ? "bat" : "tat"', { C: false }, 'STRING'));
  g.push(auto('tern-cond-compare', 'A > 5 ? A : 5', { A: num(7) }));
  g.push(auto('tern-in-arith', '1 + (C ? 2 : 3) * 2', { C: true }));
  g.push(auto('tern-low-prec', 'A || B ? 1 : 2', { A: false, B: true }));
}

// functions
{
  const g = groups.functions;
  g.push(auto('fn-min-2', 'min(A, B)', { A: num(3), B: num(2) }));
  g.push(auto('fn-min-3', 'min(5, 2, 9)'));
  g.push(auto('fn-min-first-on-equal-neg-zero', 'min(-0, 0)'));
  g.push(auto('fn-min-equal-pos-first', 'min(0, -0)'));
  g.push(auto('fn-max-2', 'max(A, B)', { A: num(3), B: num(2) }));
  g.push(auto('fn-max-3', 'max(5, 2, 9)'));
  g.push(auto('fn-max-bool', 'max(T, 0)', { T: true }));
  g.push(auto('fn-min-16', 'min(16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1)'));
  g.push(auto('fn-max-16', 'max(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16)'));
  g.push(auto('fn-min-17-arity', 'min(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17)'));
  g.push(auto('fn-abs-neg', 'abs(A)', { A: num(-4.5) }));
  g.push(auto('fn-abs-pos', 'abs(A)', { A: num(4.5) }));
  g.push(auto('fn-abs-zero', 'abs(-0)'));
  g.push(auto('fn-abs-bool', 'abs(T)', { T: true }));
  g.push(auto('fn-clamp-low', 'clamp(A, 0, 100)', { A: num(-5) }));
  g.push(auto('fn-clamp-mid', 'clamp(A, 0, 100)', { A: num(50) }));
  g.push(auto('fn-clamp-high', 'clamp(A, 0, 100)', { A: num(105) }));
  g.push(auto('fn-clamp-eq-bounds', 'clamp(A, 5, 5)', { A: num(9) }));
  g.push(auto('fn-clamp-lo-gt-hi', 'clamp(A, 10, 0)', { A: num(5) }));
  g.push(auto('fn-clamp-lo-gt-hi-bad-input-first', 'clamp(A, 10, 0)', { A: bad('FLOAT64') }));
  g.push(auto('fn-clamp-expr', 'clamp(TANK01.LEVEL - 5, 0, 100)', { 'TANK01.LEVEL': num(103.5) }));
  g.push(auto('fn-arity-abs-2', 'abs(A, B)', { A: num(1), B: num(2) }));
  g.push(auto('fn-arity-abs-0', 'abs()'));
  g.push(auto('fn-arity-min-1', 'min(A)', { A: num(1) }));
  g.push(auto('fn-arity-clamp-2', 'clamp(A, 1)', { A: num(1) }));
  g.push(auto('fn-arity-round-3', 'round(A, 1, 2)', { A: num(1) }));
  g.push(auto('fn-arity-round-0', 'round()'));
  g.push(auto('fn-arity-text-1', 'text(A)', { A: num(1) }));
  g.push(auto('fn-unknown', 'sqrt(A)', { A: num(4) }));
  g.push(auto('fn-unknown-uppercase', 'ABS(A)', { A: num(4) }));
  g.push(auto('fn-nested', 'max(abs(A), min(B, 3))', { A: num(-8), B: num(5) }));
  g.push(
    auto('fn-round-in-expr', 'round((FLOW_A + FLOW_B) / 2, 1)', {
      FLOW_A: num(10.26),
      FLOW_B: num(11.31),
    }),
  );
  g.push(auto('fn-clamp-unc', 'clamp(A, 0, 10)', { A: unc('FLOAT64', 50) }));
  g.push(auto('fn-tag-call-like', 'A.B(1)', { 'A.B': num(1) }));
  g.push(auto('fn-round-n-nonliteral', 'round(A, B)', { A: num(1), B: num(2) }));
  g.push(auto('fn-round-n-10', 'round(A, 10)', { A: num(1) }));
  g.push(auto('fn-round-n-fraction', 'round(A, 1.5)', { A: num(1) }));
  g.push(auto('fn-round-n-negative', 'round(A, -1)', { A: num(1) }));
}

// text
{
  const g = groups.text;
  const TB = {
    TrangThaiBom: {
      entries: [
        { value: 0, text: 'Dừng', color: '#808080' },
        { value: 1, text: 'Chạy', color: '#2E7D32' },
        { value: 2, text: 'Lỗi', color: '#C62828' },
        { from: 10, to: 20, text: 'Bảo trì' },
        { from: 100, text: 'Quá lớn' },
      ],
      default: { text: 'Không rõ' },
    },
    NoDefault: { entries: [{ value: 1, text: 'Một' }] },
    OnOff: {
      entries: [
        { value: false, text: 'Tắt' },
        { value: true, text: 'Bật' },
      ],
    },
  };
  const t = (n, x, tbl = 'TrangThaiBom', extra = {}) =>
    g.push(auto(n, `text(X, ${tbl})`, { X: num(x), ...extra }, 'STRING', TB));
  t('text-match-0', 0);
  t('text-match-1', 1);
  t('text-match-2', 2);
  t('text-range-low', 10);
  t('text-range-mid', 15.5);
  t('text-range-high-excl', 20);
  t('text-range-below', 9.999999);
  t('text-open-high', 100);
  t('text-open-high-big', 1e9);
  t('text-default', 5);
  t('text-default-negative', -1);
  t('text-neg-zero', -0);
  t('text-nodefault-match', 1, 'NoDefault');
  t('text-nodefault-miss', 2, 'NoDefault');
  g.push(auto('text-bool-true-table', 'text(X, OnOff)', { X: true }, 'STRING', TB));
  g.push(auto('text-bool-false-table', 'text(X, OnOff)', { X: false }, 'STRING', TB));
  g.push(auto('text-bool-as-1', 'text(X, TrangThaiBom)', { X: true }, 'STRING', TB));
  g.push(auto('text-bad-input', 'text(X, TrangThaiBom)', { X: bad('INT16') }, 'STRING', TB));
  g.push(
    auto(
      'text-unc-input',
      'text(X, TrangThaiBom)',
      { X: unc('INT16', 2, 'CLAMPED') },
      'STRING',
      TB,
    ),
  );
  g.push(auto('text-expr-arg', 'text(A + 1, TrangThaiBom)', { A: num(0) }, 'STRING', TB));
  g.push(auto('text-unknown-table', 'text(X, KhongCo)', { X: num(1) }, 'STRING', TB));
  g.push(auto('text-table-case-sensitive', 'text(X, trangthaibom)', { X: num(1) }, 'STRING', TB));
  g.push(auto('text-in-compare', 'text(X, TrangThaiBom) == "Chạy"', { X: num(1) }, 'BOOL', TB));
  g.push(auto('text-string-input', 'text(S, TrangThaiBom)', { S: 'abc' }, 'STRING', TB));
  g.push(
    auto(
      'text-table-not-bare',
      'text(X, TrangThaiBom.Con)',
      { X: num(1), 'TrangThaiBom.Con': num(1) },
      'STRING',
      TB,
    ),
  );
  g.push(auto('text-table-literal', 'text(X, 1)', { X: num(1) }, 'STRING', TB));
}

// strings
{
  const g = groups.strings;
  g.push(auto('str-eq-literal', '"abc" == "abc"', {}, 'BOOL'));
  g.push(auto('str-ne-literal', '"abc" != "abd"', {}, 'BOOL'));
  g.push(auto('str-escape-quote', '"a\\"b"', {}, 'STRING'));
  g.push(auto('str-escape-backslash', '"a\\\\b"', {}, 'STRING'));
  g.push(auto('str-escape-eq', 'S == "a\\"b"', { S: 'a"b' }, 'BOOL'));
  g.push(auto('str-vietnamese-eq', 'S == "Mức nước bồn 1"', { S: 'Mức nước bồn 1' }, 'BOOL'));
  g.push(auto('str-vietnamese-literal', '"Bơm 1 đang chạy"', {}, 'STRING'));
  g.push(auto('str-nfc-vs-nfd', 'S == "\u00e9"', { S: 'e\u0301' }, 'BOOL'));
  g.push(auto('str-empty', '""', {}, 'STRING'));
  g.push(auto('str-empty-eq', 'S == ""', { S: '' }, 'BOOL'));
  g.push(auto('str-input-pass', 'S', { S: 'TRẠM BƠM' }, 'STRING'));
  g.push(auto('str-supplementary', 'S == "😀"', { S: '😀' }, 'BOOL'));
  g.push(auto('str-spaces-significant', 'S == "a b"', { S: 'a  b' }, 'BOOL'));
  g.push(
    auto('str-mode-ternary', 'MODE == "AUTO" ? SP_AUTO : SP_MAN', {
      MODE: 'AUTO',
      SP_AUTO: num(50),
      SP_MAN: num(10),
    }),
  );
  g.push(
    auto(
      'str-bad-input',
      'S == "x"',
      { S: { type: 'STRING', value: null, quality: 'BAD', reason: 'TIMEOUT' } },
      'BOOL',
    ),
  );
  g.push(auto('str-with-operators-inside', '"a + b && c"', {}, 'STRING'));
  g.push(auto('str-unterminated', '"abc', {}, 'STRING'));
  g.push(auto('str-bad-escape', '"a\\nb"', {}, 'STRING'));
}

// assign
{
  const g = groups.assign;
  const T = ['INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64', 'FLOAT32', 'FLOAT64'];
  for (const ty of T) {
    g.push(auto(`assign-${ty}-round-half`, 'X', { X: num(2.5) }, ty));
    g.push(auto(`assign-${ty}-neg`, 'X', { X: num(-2.5) }, ty));
  }
  g.push(auto('assign-INT16-max', 'X', { X: num(32767.4) }, 'INT16'));
  g.push(auto('assign-INT16-over', 'X', { X: num(32767.5) }, 'INT16'));
  g.push(auto('assign-INT16-under', 'X', { X: num(-32768.5) }, 'INT16'));
  g.push(auto('assign-UINT16-neg-tiny', 'X', { X: num(-0.4) }, 'UINT16'));
  g.push(auto('assign-UINT16-neg-real', 'X', { X: num(-1) }, 'UINT16'));
  g.push(auto('assign-UINT32-max', 'X', { X: num(4294967295) }, 'UINT32'));
  g.push(auto('assign-UINT32-over', 'X', { X: num(4294967296) }, 'UINT32'));
  g.push(auto('assign-INT64-big', 'X * 1', { X: num(9007199254740992) }, 'INT64'));
  g.push(auto('assign-INT64-2pow63', 'X', { X: num(9223372036854775808) }, 'INT64'));
  g.push(auto('assign-UINT64-2pow64', 'X', { X: num(18446744073709551616) }, 'UINT64'));
  g.push(auto('assign-UINT64-below-2pow64', 'X', { X: num(18446744073709549568) }, 'UINT64'));
  g.push(auto('assign-FLOAT32-round', 'X', { X: num(0.1) }, 'FLOAT32'));
  g.push(auto('assign-FLOAT32-overflow', 'X', { X: num(1e39) }, 'FLOAT32'));
  g.push(auto('assign-FLOAT32-max', 'X', { X: num(3.4028234663852886e38) }, 'FLOAT32'));
  g.push(auto('assign-FLOAT32-tiny', 'X', { X: num(1e-50) }, 'FLOAT32'));
  g.push(auto('assign-neg-zero', '-X', { X: num(0) }, 'FLOAT64'));
  g.push(auto('assign-neg-zero-int', '-X', { X: num(0) }, 'INT16'));
  g.push(auto('assign-bool-to-int', 'B', { B: true }, 'INT16'));
  g.push(auto('assign-bool-to-float', 'B', { B: false }, 'FLOAT32'));
  g.push(auto('assign-bool-to-bool', 'B', { B: true }, 'BOOL'));
  g.push(auto('assign-number-to-bool', 'X', { X: num(1) }, 'BOOL'));
  g.push(auto('assign-string-to-string', 'S', { S: 'ok' }, 'STRING'));
  g.push(auto('assign-string-too-long', 'S', { S: 'ệ'.repeat(342) }, 'STRING'));
  g.push(auto('assign-string-1024-bytes', 'S', { S: 'a'.repeat(1024) }, 'STRING'));
  g.push(auto('assign-string-1025-bytes', 'S', { S: 'a'.repeat(1025) }, 'STRING'));
  g.push(auto('assign-string-to-number', 'S', { S: 'a' }, 'INT16'));
  g.push(auto('assign-bool-to-string', 'B', { B: true }, 'STRING'));
  g.push(auto('assign-int64-warning', 'X + 1', { X: num('12345678901', 'INT64') }, 'FLOAT64'));
  g.push(
    auto(
      'assign-uint64-input-to-uint64',
      'X',
      { X: num('18446744073709551615', 'UINT64') },
      'UINT64',
    ),
  );
}

// syntax-errors
{
  const g = groups['syntax-errors'];
  const syn = [
    ['missing-paren', '(A + B'],
    ['trailing-op', 'A +'],
    ['empty', ''],
    ['whitespace-only', '   '],
    ['chain-lt', 'A < B < C'],
    ['chain-eq', 'A == B == C'],
    ['chain-ne-eq', 'A != B == C'],
    ['chain-ge', 'A >= B > C'],
    ['exp-overflow', '1e400'],
    ['leading-dot', '.5'],
    ['trailing-dot', '5.'],
    ['unterminated-string', '"abc'],
    ['bad-escape', '"a\\tb"'],
    ['control-char-in-string', '"a\u0001b"'],
    ['unknown-char', 'A @ B'],
    ['single-ampersand', 'A & B'],
    ['single-pipe', 'A | B'],
    ['single-equal', 'A = B'],
    ['hex', '0x10'],
    ['two-operands', 'A B'],
    ['stray-close', 'A )'],
    ['empty-parens', '()'],
    ['ternary-no-colon', 'A ? 1'],
    ['ternary-missing-else', 'A ? 1 :'],
    ['double-comma', 'min(1,,2)'],
    ['trailing-comma', 'min(1, 2,)'],
    ['dot-end', 'A.'],
    ['dot-dot', 'A..B'],
    ['vietnamese-outside-string', 'Mức + 1'],
    ['nbsp', 'A\u00a0+ 1'],
    ['operator-first', '* 3'],
    ['unicode-span', '"😀" + 😀'],
    ['quote-single', "'a'"],
  ];
  for (const [n, e] of syn) g.push(auto(`syn-${n}`, e, { A: num(1), B: num(2), C: num(3) }));
}

// type-errors
{
  const g = groups['type-errors'];
  const I = { A: num(1), B: num(2), S: 'chuỗi', T: true, 'TANK01.LEVEL': num(50) };
  const te = [
    ['string-plus-number', '"a" + 1'],
    ['number-plus-string', '1 + S'],
    ['and-number', 'A && T'],
    ['and-right-number', 'T && A'],
    ['or-number', 'T || 1'],
    ['not-number', '!A'],
    ['neg-string', '-S'],
    ['lt-string', 'S < S'],
    ['lt-string-number', 'A < S'],
    ['eq-string-number', 'S == 1'],
    ['eq-number-string', '1 == S'],
    ['ternary-cond-number', 'A ? 1 : 2'],
    ['ternary-branch-mix', 'T ? 1 : "a"'],
    ['ternary-branch-mix-2', 'T ? "a" : 1'],
    ['min-string', 'min(A, S)'],
    ['abs-string', 'abs(S)'],
    ['clamp-bool-ok-string-bad', 'clamp(A, 0, S)'],
    ['round-n-var', 'round(A, B)'],
    ['round-string', 'round(S)'],
    ['text-string-x', 'text(S, Tbl)'],
    ['text-table-expr', 'text(A, A + 1)'],
    ['paren-span', '("a") + 1'],
    ['nested-first', '("a" + 1) && 2'],
    ['mod-string', 'S % 2'],
    ['mul-bool-string', 'T * S'],
  ];
  for (const [n, e] of te)
    g.push(auto(`type-${n}`, e, I, 'FLOAT64', { Tbl: { entries: [{ value: 1, text: 'x' }] } }));
  g.push(auto('type-result-number-to-bool', 'A + 1', I, 'BOOL'));
  g.push(auto('type-result-string-to-number', 'S', I, 'FLOAT64'));
  g.push(auto('type-result-bool-to-string', 'T', I, 'STRING'));
  g.push(auto('type-result-number-to-string', 'A', I, 'STRING'));
  g.push(auto('type-result-paren-span', '  ( A + 1 )  ', I, 'BOOL'));
  g.push(auto('type-unknown-tag', 'TANK9.LEVEL', I));
  g.push(auto('type-unknown-tag-in-expr', 'TANK01.LEVEL * 12.5 + TANK9.LEVEL', I));
  g.push(auto('type-unknown-tag-before-type', '"a" + 1 + Z', I));
  g.push(auto('type-names-before-arity', 'abs(Z, 1)', I));
}

// limits
{
  const g = groups.limits;
  const rep = (s, n) => s.repeat(n);
  // 1000 ký tự: 998 ký tự của "1+" x 499, "1", một khoảng trắng
  const e1000 = rep('1+', 499) + '1' + ' ';
  const e1001 = rep('1+', 499) + '1' + '  ';
  g.push(auto('limit-chars-1000', e1000, {}, 'FLOAT64'));
  g.push(auto('limit-chars-1001', e1001, {}, 'FLOAT64'));
  // 4.096 và 4.097 byte: chuỗi tiếng Việt 3 byte trong dấu ngoặc kép; 1.366 ký tự = 4.098 byte nên dùng
  // 1.363 ký tự (4.089) + 'a' x 7 = 4.096 byte; vượt giới hạn ký tự trước nên cùng một lỗi tại ký tự 1.001.
  const lit = (s) => `"${s}"`;
  g.push(auto('limit-bytes-4096-chars-over', lit(rep('ệ', 1362) + rep('a', 8)), {}, 'STRING'));
  g.push(auto('limit-bytes-4097-chars-over', lit(rep('ệ', 1362) + rep('a', 9)), {}, 'STRING'));
  const nest = (n) => rep('(', n) + '1' + rep(')', n);
  g.push(auto('limit-nest-32', nest(32)));
  g.push(auto('limit-nest-33', nest(33)));
  g.push(auto('limit-nest-unary-32', rep('-', 32) + '1'));
  g.push(auto('limit-nest-unary-33', rep('-', 33) + '1'));
  g.push(auto('limit-nest-call-33', rep('abs(', 33) + '1' + rep(')', 33)));
  g.push(auto('limit-nest-ternary-33', rep('T ? ', 33) + '1' + rep(' : 2', 33), { T: true }));
  const long333 = 'T' + rep('&&T', 332); // chuỗi hai ngôi dài (997 ký tự): không tính mức lồng
  g.push(auto('limit-binary-chain-333', long333, { T: true }, 'BOOL'));
  // ngăn xếp: min 15 tham số lồng nhau, mỗi tầng giữ 15 giá trị (4 tầng = 60 + 2 = 62 ok; 5 tầng = 77 > 64)
  const minNest = (levels) => {
    const pre = 'min(1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,';
    return rep(pre, levels) + 'min(1,2)' + rep(')', levels);
  };
  g.push(auto('limit-stack-4-levels-ok', minNest(4)));
  g.push(auto('limit-stack-5-levels-error', minNest(5)));
  const tags = (n) => Array.from({ length: n }, (_, i) => `T${i + 1}`);
  const mkInputs = (n) => Object.fromEntries(tags(n).map((t, i) => [t, num(i + 1)]));
  g.push(auto('limit-tags-32', tags(32).join(' + '), mkInputs(33)));
  g.push(auto('limit-tags-33', tags(33).join(' + '), mkInputs(33)));
  g.push(auto('limit-tags-repeat-ok', rep('T1 + ', 40) + 'T2', mkInputs(2)));
}

// ======================================================================================
// Ca viết tay: kiểm bằng bộ tham chiếu rồi gộp
// ======================================================================================

const outDir = here;
mkdirSync(join(here, 'handwritten'), { recursive: true });
let total = 0;
const summary = [];
for (const group of Object.keys(MIN)) {
  let hand = [];
  try {
    const text = readFileSync(join(here, 'handwritten', `${group}.json`), 'utf8');
    hand = JSON.parse(text).cases.map((c) => {
      const n = normCase(c);
      if (!c.expect) throw new Error(`${group}/${c.name}: ca viết tay thiếu expect`);
      return n;
    });
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  for (const c of hand) {
    const ref = refExpect(c);
    if (!sameExpect(ref, c.expect))
      throw new Error(
        `Ca viết tay ${group}/${c.name} lệch bộ tham chiếu:\n  ghi sẵn: ${JSON.stringify(c.expect)}\n  tham chiếu: ${JSON.stringify(ref)}`,
      );
  }
  const names = new Set();
  const cases = [...hand, ...groups[group]];
  for (const c of cases) {
    if (names.has(c.name)) throw new Error(`Trùng tên ca: ${group}/${c.name}`);
    names.add(c.name);
  }
  if (cases.length < MIN[group]) throw new Error(`Nhóm ${group}: ${cases.length} < ${MIN[group]}`);
  writeGroup(join(outDir, `${group}.json`), group, cases);
  summary.push(`${group}=${cases.length} (tay ${hand.length})`);
  total += cases.length;
}
if (total < 300) throw new Error(`Tổng ${total} < 300`);
console.log(`expression-vectors: ${total} ca. ${summary.join(', ')}`);
