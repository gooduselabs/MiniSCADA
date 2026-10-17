// Mục tiêu fuzz `expression` (T058): parser, bộ kiểm và VM của @mat/expression (ADR-015) trên biểu thức đột biến
// (kho mầm tests/fuzz-corpus/expression.json, từ tests/expression-vectors). Bất biến:
//  - compile và tokens không ném; lỗi có mã E_EXPR_*, span [a, b) số nguyên 0 ≤ a ≤ b;
//  - token phủ trong chuỗi (span trong [0, số ký tự]);
//  - biên dịch được thì evaluate với đầu vào HỮU HẠN không ném; quality GOOD/UNCERTAIN/BAD; khác BAD thì giá trị đúng
//    kiểu đích: BOOL → boolean, STRING → string, INT64/UINT64 → bigint trong phạm vi, số khác → số hữu hạn (không NaN,
//    không ±Infinity), kiểu nguyên thì nguyên và trong phạm vi;
//  - tất định: evaluate hai lần cùng kết quả.
import { finiteFor, int, loadCorpus, mutateString, pick } from '../ts-lib.mjs';

const ex = await import('../../../packages/expression/src/index.ts');

const TYPES = [
  'BOOL',
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
  'STRING',
];
const RANGE = {
  INT16: [-32768, 32767],
  UINT16: [0, 65535],
  INT32: [-2147483648, 2147483647],
  UINT32: [0, 4294967295],
  INT64: [-(2n ** 63n), 2n ** 63n - 1n],
  UINT64: [0n, 2n ** 64n - 1n],
};
const PIECES = [
  ' + ', ' - ', ' * ', ' / ', ' % ', ' && ', ' || ', '!', ' == ', ' != ', ' < ', ' >= ', ' ? ', ' : ', '(', ')', ',',
  'min(', 'max(', 'abs(', 'round(', 'clamp(', 'text(', '"', "'", '\\', '.', '1e308', '1e309', '-0', '0.1', '9007199254740993',
  '2147483648', 'true', 'false', 'NaN', 'Infinity', '"Đ"', '""', '\u0000', '\u00a0', '((((', '))))', '-'.repeat(40),
  'A', 'B', 'X', 'TANK01.LEVEL', 'Q.', '.Q', '1/0', '0/0', '%0', '1e-320', '"a" + "b"',
]; // prettier-ignore

export async function setup() {
  const seeds = loadCorpus('expression.json');
  const tableNames = [...new Set(seeds.flatMap((s) => Object.keys(s.tables)))];
  return { seeds, tableNames };
}

function mutateExpr(s, r) {
  let out = s;
  const n = r() < 0.5 ? 1 : int(r, 2, 6);
  for (let k = 0; k < n; k++) {
    const i = Math.floor(r() * (out.length + 1));
    const op = r();
    if (op < 0.45) out = out.slice(0, i) + pick(r, PIECES) + out.slice(i);
    else if (op < 0.6) out = out.slice(0, i) + out.slice(i + int(r, 1, 4));
    else if (op < 0.7) out = out.slice(0, i) + out.slice(i, i + int(r, 1, 30)) + out.slice(i);
    else if (op < 0.8) out = `(${out})${pick(r, PIECES)}(${out})`;
    else if (op < 0.85) out = pick(r, ['min', 'max', 'round', 'clamp', 'abs']) + `(${out}, ${out})`;
    else out = mutateString(out, r, null);
  }
  return out;
}

export function generate(ctx, r) {
  const base = pick(r, ctx.seeds);
  const expr = r() < 0.1 ? base.expr : mutateExpr(base.expr, r);
  const types = { ...base.types };
  // Tag thêm (tên dùng trong PIECES) với kiểu ngẫu nhiên; có khi đổi kiểu Tag sẵn có
  for (const id of ['A', 'B', 'X', 'TANK01.LEVEL'])
    if (!(id in types) && r() < 0.7) types[id] = pick(r, TYPES);
  if (r() < 0.2) {
    const ids = Object.keys(types);
    if (ids.length) types[pick(r, ids)] = pick(r, TYPES);
  }
  const target = r() < 0.7 ? base.target : pick(r, TYPES);
  // đầu vào hữu hạn, chất lượng ngẫu nhiên
  const values = {};
  for (const [id, t] of Object.entries(types)) {
    const q = r();
    values[id] =
      q < 0.8
        ? { value: finiteFor(t, r), quality: 'GOOD' }
        : q < 0.9
          ? { value: finiteFor(t, r), quality: 'UNCERTAIN', reason: 'CLAMPED' }
          : { value: null, quality: 'BAD', reason: pick(r, ['NO_VALUE', 'DISCONNECTED']) };
  }
  return { expr, types, target, tables: base.tables, values };
}

function same(a, b) {
  return (
    JSON.stringify(a, (_k, v) =>
      typeof v === 'bigint' ? `${v}n` : Object.is(v, -0) ? '-0' : v,
    ) ===
    JSON.stringify(b, (_k, v) => (typeof v === 'bigint' ? `${v}n` : Object.is(v, -0) ? '-0' : v))
  );
}

export function check(_ctx, input) {
  const problems = [];
  const counters = [];
  const { expr, types, target, values } = input;
  const tables = new Map(Object.entries(input.tables ?? {}));
  const env = {
    tagType: (id) => (Object.prototype.hasOwnProperty.call(types, id) ? types[id] : undefined),
    hasTable: (n) => tables.has(n),
    target,
  };
  const cps = Array.from(expr).length;
  const toks = ex.tokens(expr);
  for (const t of toks)
    if (!(
      Number.isInteger(t.span[0]) &&
      t.span[0] >= 0 &&
      t.span[0] <= t.span[1] &&
      t.span[1] <= cps
    ))
      problems.push(`token span sai: ${JSON.stringify(t)}`);
  const res = ex.compile(expr, env);
  if (!res.ok) {
    const e = res.errors[0];
    if (!e || !/^E_EXPR_[A-Z_]+$/.test(e.code)) problems.push(`mã lỗi lạ: ${JSON.stringify(e)}`);
    else if (!(
      Number.isInteger(e.span[0]) &&
      Number.isInteger(e.span[1]) &&
      e.span[0] >= 0 &&
      e.span[0] <= e.span[1]
    ))
      problems.push(`span lỗi sai: ${JSON.stringify(e.span)}`);
    counters.push('rejected', 'code:' + e?.code);
    return { problems, counters };
  }
  counters.push('compiled');
  for (const id of res.inputs)
    if (env.tagType(id) === undefined) problems.push(`đầu vào lạ: ${id}`);
  const input_ = (i) =>
    values[res.program.inputs[i]] ?? { value: null, quality: 'BAD', reason: 'NO_VALUE' };
  const out = ex.evaluate(res.program, input_, tables);
  const again = ex.evaluate(res.program, input_, tables);
  if (!same(out, again)) problems.push('evaluate không tất định');
  if (!['GOOD', 'UNCERTAIN', 'BAD'].includes(out.quality))
    problems.push(`quality lạ: ${out.quality}`);
  counters.push('q:' + out.quality);
  if (out.quality !== 'BAD') {
    const v = out.value;
    const bad = (why) =>
      problems.push(`giá trị sai kiểu đích ${target}: ${String(v)} (${typeof v}) ${why}`);
    if (target === 'BOOL') {
      if (typeof v !== 'boolean') bad('');
    } else if (target === 'STRING') {
      if (typeof v !== 'string') bad('');
    } else if (target === 'INT64' || target === 'UINT64') {
      if (typeof v !== 'bigint') bad('');
      else if (v < RANGE[target][0] || v > RANGE[target][1]) bad('ngoài phạm vi');
    } else if (typeof v !== 'number') bad('');
    else if (!Number.isFinite(v)) bad('không hữu hạn');
    else if (
      RANGE[target] &&
      (!Number.isInteger(v) || v < RANGE[target][0] || v > RANGE[target][1])
    )
      bad('không nguyên hoặc ngoài phạm vi');
    else if (target === 'FLOAT32' && Math.abs(v) > 3.4028234663852886e38) bad('vượt FLOAT32');
  }
  return { problems, counters };
}
