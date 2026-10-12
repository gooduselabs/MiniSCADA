// Bảng giá trị: mọi ca tests/value-table-vectors (tra và kiểm), luật chồng, E_VT_RANGE, E_VT_TEXT.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookupValueTable, validateValueTable, type ValueTable } from './index.ts';

const DIR = resolve(__dirname, '../../../tests/value-table-vectors');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

describe('tests/value-table-vectors: lookup', () => {
  for (const f of files.filter((x) => x.startsWith('lookup-'))) {
    const j = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as {
      table: ValueTable;
      cases: { input: number | boolean | string; expect: unknown }[];
    };
    describe(f, () => {
      j.cases.forEach((c, i) => {
        it(`case ${i}: ${JSON.stringify(c.input)}`, () => {
          const x = c.input === 'NaN' ? NaN : (c.input as number | boolean);
          expect(lookupValueTable(j.table, x)).toEqual(c.expect);
        });
      });
    });
  }
});

describe('tests/value-table-vectors: validate', () => {
  const j = JSON.parse(readFileSync(join(DIR, 'validate.json'), 'utf8')) as {
    cases: { name: string; table: ValueTable; expect: { code: string; entry: number }[] }[];
  };
  for (const c of j.cases) {
    it(c.name, () => {
      const got = validateValueTable(c.table)
        .map((i) => ({ code: i.code, entry: i.entry }))
        .sort((a, b) => (a.entry === b.entry ? a.code.localeCompare(b.code) : a.entry - b.entry));
      expect(got).toEqual(c.expect);
    });
  }
  it('has at least one case for each of E_VT_OVERLAP, E_VT_RANGE, E_VT_TEXT', () => {
    const codes = new Set(j.cases.flatMap((c) => c.expect.map((e) => e.code)));
    expect([...codes].sort()).toEqual(['E_VT_OVERLAP', 'E_VT_RANGE', 'E_VT_TEXT']);
  });
});

describe('lookup details', () => {
  it('returns the entry index, "default" or null', () => {
    const t: ValueTable = { entries: [{ value: 3, text: 'x' }], default: { text: 'd' } };
    expect(lookupValueTable(t, 3).entry).toBe(0);
    expect(lookupValueTable(t, 4).entry).toBe('default');
    expect(lookupValueTable({ entries: [] }, 4).entry).toBeNull();
  });
  it('does not depend on the entry order', () => {
    const a: ValueTable = {
      entries: [
        { value: 1, text: 'a' },
        { from: 5, to: 9, text: 'b' },
      ],
    };
    const b: ValueTable = { entries: [...a.entries].reverse() };
    for (const x of [0, 1, 5, 8.9, 9])
      expect(lookupValueTable(a, x).text).toBe(lookupValueTable(b, x).text);
  });
});
