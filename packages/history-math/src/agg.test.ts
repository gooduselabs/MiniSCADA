// T015: phép ghép bucket và đại lượng suy ra; duyệt tests/agg-vectors/merge-*.json, derive-*.json.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { avg, coverage, delta, mergeAll, mergeBuckets, sum, type AggBucket } from './agg.ts';

const DIR = resolve(__dirname, '../../../tests/agg-vectors');
const near = (a: number, b: number) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b)));
const same = (a: AggBucket | null, b: AggBucket | null) => {
  if (b === null) return expect(a).toBeNull();
  expect(a).not.toBeNull();
  expect(a!.n).toBe(b.n);
  expect(a!.wms).toBe(b.wms);
  for (const k of ['min', 'max', 'first', 'last', 'sumw'] as const) near(a![k], b[k]);
};

const files = readdirSync(DIR).filter((f) => /^(merge|derive)-.*\.json$/.test(f));

describe('tests/agg-vectors: merge-*, derive-*', () => {
  it('có đủ ca (>= 15)', () => expect(files.length).toBeGreaterThanOrEqual(15));
  for (const f of files)
    it(f, () => {
      const v = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
      if (v.kind === 'merge') same(mergeAll(v.inputs), v.expect);
      else {
        const fn = { avg, sum, delta } as Record<string, (b: AggBucket | null) => number | null>;
        const got = v.fn === 'coverage' ? coverage(v.bucket, v.windowMs) : fn[v.fn]!(v.bucket);
        if (v.expect === null) expect(got).toBeNull();
        else near(got as number, v.expect);
      }
    });

  it('mergeBuckets: null là phần tử đơn vị, hai đầu vào rỗng cho null', () => {
    expect(mergeBuckets(null, null)).toBeNull();
    const b = { n: 1, min: 1, max: 1, first: 1, last: 1, sumw: 1, wms: 1 };
    expect(mergeBuckets(null, b)).toEqual(b);
    expect(mergeBuckets(b, null)).toEqual(b);
  });
});
