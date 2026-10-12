// Bộ vector chung TS ↔ C++ (tests/expression-vectors): giá trị bằng từng bit, kiểu, quality, lý do;
// lỗi kiểm cùng `code` và `span`. Cũng kiểm số ca tối thiểu theo nhóm (SC-008).
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile, evaluate, type InputValue, type TagDataType, type ValueTable } from './index.ts';

const DIR = resolve(__dirname, '../../../tests/expression-vectors');

interface VInput {
  type: TagDataType;
  value: number | boolean | string | null;
  quality: 'GOOD' | 'UNCERTAIN' | 'BAD';
  reason?: string;
}
interface VCase {
  name: string;
  expr: string;
  inputs: Record<string, VInput>;
  tables: Record<string, ValueTable>;
  target: TagDataType;
  expect: {
    value?: number | boolean | string | null;
    quality?: string;
    reason?: string;
    error?: string;
    span?: [number, number];
    warnings?: string[];
  };
}

const MIN: Record<string, number> = {
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

const groups = new Map<string, VCase[]>();
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { group: string; cases: VCase[] };
  groups.set(j.group, j.cases);
}

const special = (v: unknown): unknown =>
  v === 'NaN' ? NaN : v === 'Infinity' ? Infinity : v === '-Infinity' ? -Infinity : v;

function inputValue(i: VInput): InputValue {
  let value = i.value;
  if (typeof value === 'string' && i.type !== 'STRING')
    value = Number(special(value) as number | string);
  return { value, quality: i.quality, reason: i.reason };
}

function runCase(c: VCase) {
  const env = {
    target: c.target,
    tagType: (id: string) => c.inputs[id]?.type,
    hasTable: (name: string) => name in c.tables,
  };
  const r = compile(c.expr, env);
  if (!r.ok) return { error: r.errors[0]!.code, span: r.errors[0]!.span };
  const tables = new Map(Object.entries(c.tables));
  const res = evaluate(r.program, (i) => inputValue(c.inputs[r.program.inputs[i]!]!), tables);
  return { res, warnings: r.warnings.map((w) => w.code) };
}

describe('tests/expression-vectors', () => {
  it('has at least 300 cases and the minimum per group', () => {
    let total = 0;
    for (const [g, min] of Object.entries(MIN)) {
      const n = groups.get(g)?.length ?? 0;
      expect(n, g).toBeGreaterThanOrEqual(min);
      total += n;
    }
    expect(total).toBeGreaterThanOrEqual(300);
  });

  for (const [group, cases] of groups) {
    describe(group, () => {
      for (const c of cases) {
        it(c.name, () => {
          const out = runCase(c);
          if (c.expect.error !== undefined) {
            expect(out.error, 'error code').toBe(c.expect.error);
            expect(out.span, 'span').toEqual(c.expect.span);
            return;
          }
          expect(out.error, `unexpected compile error ${out.error}`).toBeUndefined();
          const res = out.res!;
          expect(res.quality).toBe(c.expect.quality);
          expect(res.reason).toBe(c.expect.reason);
          if (c.expect.value === null) expect(res.value).toBeUndefined();
          else if (c.target === 'INT64' || c.target === 'UINT64')
            expect(res.value).toBe(BigInt(c.expect.value as string));
          else if (typeof c.expect.value === 'number')
            expect(Object.is(res.value, special(c.expect.value))).toBe(true);
          else expect(res.value).toBe(c.expect.value);
          if (c.expect.warnings) expect(out.warnings).toEqual(c.expect.warnings);
        });
      }
    });
  }
});
