// Parser, checker, bytecode: thứ tự ưu tiên, không kết hợp, mức lồng theo độ sâu đệ quy, span theo ký tự
// Unicode, thứ tự lỗi, ngăn xếp <= 64, lệnh nhảy lười.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile, evaluate, type CompileEnv, type InputValue, type TagDataType } from './index.ts';
import { Op, OP_ARGS } from './compiler.ts';

const tags: Record<string, TagDataType> = {
  A: 'FLOAT64',
  B: 'FLOAT64',
  C: 'FLOAT64',
  T: 'BOOL',
  F: 'BOOL',
  S: 'STRING',
  'TANK01.LEVEL': 'FLOAT32',
};
const envFor = (target: TagDataType = 'FLOAT64'): CompileEnv => ({
  target,
  tagType: (id) => tags[id],
  hasTable: (n) => n === 'Tbl',
});
const good = (value: number | boolean | string): InputValue => ({ value, quality: 'GOOD' });

/** Biên dịch và chạy; đầu vào theo bảng `vals`. */
function run(
  src: string,
  vals: Record<string, number | boolean | string> = {},
  target: TagDataType = 'FLOAT64',
) {
  const r = compile(src, envFor(target));
  if (!r.ok) throw new Error(`${r.errors[0]!.code} ${r.errors[0]!.span}`);
  return evaluate(r.program, (i) => good(vals[r.program.inputs[i]!]!), new Map());
}
const err = (src: string, target: TagDataType = 'FLOAT64') => {
  const r = compile(src, envFor(target));
  if (r.ok) throw new Error('expected an error');
  return { code: r.errors[0]!.code, span: r.errors[0]!.span };
};

describe('precedence and associativity (contract §2)', () => {
  it('multiplication binds tighter than addition', () => {
    expect(run('1 + 2 * 3').value).toBe(7);
    expect(run('2 * 3 + 4').value).toBe(10);
  });
  it('left associative: - and /', () => {
    expect(run('10 - 4 - 3').value).toBe(3);
    expect(run('100 / 10 / 5').value).toBe(2);
    expect(run('2 * 3 % 4').value).toBe(2);
  });
  it('unary binds tighter than binary: -2 * 3 and !x && y', () => {
    expect(run('-2 * 3').value).toBe(-6);
    expect(run('!F && F', { F: false }, 'BOOL').value).toBe(false);
  });
  it('comparison binds looser than arithmetic and tighter than equality', () => {
    expect(run('1 + 1 < 3 == T', { T: true }, 'BOOL').value).toBe(true);
  });
  it('&& binds tighter than ||', () => {
    expect(run('T || F && F', { T: true, F: false }, 'BOOL').value).toBe(true);
    expect(run('(T || F) && F', { T: true, F: false }, 'BOOL').value).toBe(false);
  });
  it('ternary is right associative and lowest', () => {
    expect(run('F ? 1 : F ? 2 : 3', { F: false }).value).toBe(3);
    expect(run('T ? 1 : T ? 2 : 3', { T: true }).value).toBe(1);
    expect(run('F || T ? 1 : 2', { F: false, T: true }).value).toBe(1);
  });
  it('comparison and equality are not associative', () => {
    expect(err('A < B < C').code).toBe('E_EXPR_SYNTAX');
    expect(err('A == B == C').code).toBe('E_EXPR_SYNTAX');
    expect(err('A < B > C').code).toBe('E_EXPR_SYNTAX');
    expect(err('A != B == C').span).toEqual([7, 9]);
    expect(compile('(A < B) == (B < C)', envFor('BOOL')).ok).toBe(true);
  });
  it('numbers: 12, 12.5, 1.5e3, 2E-1; no .5, 5., hex', () => {
    expect(run('1.5e3').value).toBe(1500);
    expect(run('2E-1').value).toBe(0.2);
    expect(run('1e+2').value).toBe(100);
    for (const bad of ['.5', '5.', '0x10', '1e400']) expect(err(bad).code).toBe('E_EXPR_SYNTAX');
  });
});

describe('nesting is counted by parser recursion depth (contract §7)', () => {
  const rep = (s: string, n: number) => s.repeat(n);
  it('a binary chain of 333 operands is not nesting', () => {
    expect(compile('T' + rep('&&T', 332), envFor('BOOL')).ok).toBe(true);
  });
  it('a chain of 500 additions is not nesting', () => {
    const r = compile('1' + rep('+1', 499), envFor());
    expect(r.ok).toBe(true);
    if (r.ok) expect(evaluate(r.program, () => good(0), new Map()).value).toBe(500);
  });
  it('parentheses, call arguments, unary operators and ternary branches each add a level', () => {
    expect(compile(rep('(', 32) + '1' + rep(')', 32), envFor()).ok).toBe(true);
    expect(err(rep('(', 33) + '1' + rep(')', 33))).toEqual({
      code: 'E_EXPR_LIMIT',
      span: [32, 33],
    });
    expect(compile(rep('-', 32) + '1', envFor()).ok).toBe(true);
    expect(err(rep('!', 33) + 'T', 'BOOL')).toEqual({ code: 'E_EXPR_LIMIT', span: [32, 33] });
    expect(compile(rep('abs(', 32) + '1' + rep(')', 32), envFor()).ok).toBe(true);
    expect(err(rep('abs(', 33) + '1' + rep(')', 33)).code).toBe('E_EXPR_LIMIT');
    expect(err(rep('T ? ', 33) + '1' + rep(' : 2', 33)).code).toBe('E_EXPR_LIMIT');
  });
  it('a very deep expression does not overflow the stack', () => {
    expect(err(rep('(', 900) + '1' + rep(')', 900)).code).toBe('E_EXPR_LIMIT');
  });
});

describe('spans are in Unicode characters (code points)', () => {
  it('counts a supplementary character as one', () => {
    expect(err('"😀" + 😀')).toEqual({ code: 'E_EXPR_SYNTAX', span: [6, 7] });
    expect(err('"😀😀" + 1', 'STRING').span).toEqual([0, 4]);
  });
  it('counts precomposed and combining characters separately', () => {
    expect(err('"é" + 1').span).toEqual([0, 4]);
  });
  it('the end of input is the empty span [len, len]', () => {
    expect(err('(A + B')).toEqual({ code: 'E_EXPR_SYNTAX', span: [6, 6] });
    expect(err('')).toEqual({ code: 'E_EXPR_SYNTAX', span: [0, 0] });
  });
});

describe('the first error follows the order syntax, names, arity, types, limits', () => {
  it('syntax beats everything', () => {
    expect(err('Z + ').code).toBe('E_EXPR_SYNTAX');
  });
  it('names beat arity and types', () => {
    expect(err('abs(Z, 1)').code).toBe('E_EXPR_UNKNOWN_TAG');
    expect(err('"a" + 1 + Z').code).toBe('E_EXPR_UNKNOWN_TAG');
    expect(err('sqrt(1, 2)').code).toBe('E_EXPR_UNKNOWN_FUNC');
    expect(err('text(A, Nope)').code).toBe('E_EXPR_UNKNOWN_TABLE');
  });
  it('names are reported in source order', () => {
    expect(err('Z + sqrt(1)').code).toBe('E_EXPR_UNKNOWN_TAG');
    expect(err('sqrt(1) + Z').code).toBe('E_EXPR_UNKNOWN_FUNC');
  });
  it('arity beats types', () => {
    expect(err('abs("a", 1)').code).toBe('E_EXPR_ARITY');
  });
  it('types beat limits', () => {
    expect(err('"a" + 1 + ' + '('.repeat(40) + '1' + ')'.repeat(40)).code).toBe('E_EXPR_TYPE');
    expect(err('S + 1 + ' + '-'.repeat(40) + '1').code).toBe('E_EXPR_TYPE');
  });
  it('reports the innermost wrong operand first (post-order)', () => {
    expect(err('("a" + 1) && 2')).toEqual({ code: 'E_EXPR_TYPE', span: [1, 4] });
  });
  it('the 33rd distinct tag is reported with its span; repeated tags do not count', () => {
    const ids = Array.from({ length: 33 }, (_, i) => `X${i}`);
    const env: CompileEnv = { target: 'FLOAT64', tagType: () => 'FLOAT64', hasTable: () => false };
    const joined = ids.join('+');
    const at = joined.lastIndexOf('X32');
    const r = compile(joined, env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ code: 'E_EXPR_LIMIT', span: [at, at + 3] });
    expect(compile(ids.slice(0, 32).join('+') + '+X0+X1', env).ok).toBe(true);
  });
});

describe('bytecode', () => {
  const programOf = (src: string, target: TagDataType = 'FLOAT64') => {
    const r = compile(src, envFor(target));
    if (!r.ok) throw new Error('compile');
    return r.program;
  };
  /** Mã lệnh theo thứ tự, bỏ tham số. */
  const opcodes = (p: ReturnType<typeof programOf>): number[] => {
    const out: number[] = [];
    for (let i = 0; i < p.ops.length;) {
      out.push(p.ops[i]!);
      i += 1 + (OP_ARGS[p.ops[i]!] ?? 0);
    }
    return out;
  };
  it('&&, || and ?: are jumps', () => {
    expect(opcodes(programOf('T && F', 'BOOL'))).toContain(Op.JF_KEEP);
    expect(opcodes(programOf('T || F', 'BOOL'))).toContain(Op.JT_KEEP);
    const c = opcodes(programOf('T ? A : B'));
    expect(c).toContain(Op.JF);
    expect(c).toContain(Op.JMP);
  });
  it('does not load an input of a branch that is not taken', () => {
    const p = programOf('T ? A : B');
    const loaded: string[] = [];
    const res = evaluate(
      p,
      (i) => {
        loaded.push(p.inputs[i]!);
        return {
          value: p.inputs[i] === 'T' ? false : 5,
          quality: p.inputs[i] === 'A' ? 'BAD' : 'GOOD',
          reason: 'X',
        };
      },
      new Map(),
    );
    expect(loaded).toEqual(['T', 'B']);
    expect(res).toEqual({ quality: 'GOOD', value: 5 });
  });
  it('checks the stack depth at compile time (<= 64)', () => {
    const pre = 'min(1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,';
    const src = (n: number) => pre.repeat(n) + 'min(1,2)' + ')'.repeat(n);
    const ok = compile(src(4), envFor());
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.program.maxStack).toBeLessThanOrEqual(64);
    expect(err(src(5)).code).toBe('E_EXPR_LIMIT');
  });
  it('lists inputs once, in order of first use', () => {
    const r = compile('B + A + B * A', envFor());
    expect(r.ok && r.inputs).toEqual(['B', 'A']);
  });
  it('warns W_EXPR_INT64 for INT64 and UINT64 inputs', () => {
    const env: CompileEnv = { target: 'FLOAT64', tagType: () => 'INT64', hasTable: () => false };
    const r = compile('X + 1', env);
    expect(r.ok && r.warnings.map((w) => w.code)).toEqual(['W_EXPR_INT64']);
  });
  it('messages are English codes-with-text only (no Vietnamese in the package)', () => {
    const r = compile('A +', envFor());
    expect(!r.ok && /^[\x20-\x7e]+$/.test(r.errors[0]!.message)).toBe(true);
  });
});

describe('source rules (Constitution V)', () => {
  it('the package sources contain neither eval nor new Function', () => {
    const dir = resolve(__dirname);
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(/\beval\s*\(/.test(text), `${f} eval`).toBe(false);
      expect(/new\s+Function\b/.test(text), `${f} new Function`).toBe(false);
    }
  });
  it('does not call Math.round (round is its own function)', () => {
    const dir = resolve(__dirname);
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts')))
      expect(/Math\.round\s*\(/.test(readFileSync(join(dir, f), 'utf8')), f).toBe(false);
  });
});
