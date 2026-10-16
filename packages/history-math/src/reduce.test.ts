// T053: giảm điểm (minmax, decimate, lttb, ghép bucket); duyệt tests/downsample-vectors.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AggBucket } from './agg.ts';
import { decimate, mergeToPoints, reduceLttb, reduceMinMax } from './reduce.ts';

const DIR = resolve(__dirname, '../../../tests/downsample-vectors');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
type Row = [number, number | null];
const cols = (p: Row[]) => ({ t: p.map((x) => x[0]), v: p.map((x) => x[1]) });
const close = (a: Array<number | null>, b: Array<number | null>, what: string) => {
  expect(a.length, what).toBe(b.length);
  a.forEach((x, i) => {
    const y = b[i]!;
    if (x === null || y === null) return expect(x, `${what}[${i}]`).toBe(y);
    expect(Math.abs(x - y), `${what}[${i}]`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(y)));
  });
};

describe('tests/downsample-vectors', () => {
  it('có đủ ca (>= 20)', () => expect(files.length).toBeGreaterThanOrEqual(20));
  for (const f of files)
    it(f, () => {
      const v = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
      if (v.kind === 'merge') {
        const got = mergeToPoints(
          v.buckets as Array<AggBucket & { bucket: number }>,
          v.from,
          v.to,
          v.res,
          v.maxPoints,
        );
        close(got.t, v.expect.t, 't');
        close(got.v, v.expect.v, 'v');
        close(got.min, v.expect.min, 'min');
        close(got.max, v.expect.max, 'max');
        return;
      }
      const out =
        v.kind === 'minmax'
          ? reduceMinMax(v.rows, v.from, v.to, v.maxPoints)
          : v.kind === 'decimate'
            ? decimate(v.rows, v.from, v.to, v.maxPoints)
            : reduceLttb(v.points, v.maxPoints);
      const got = cols(out);
      close(got.t, v.expect.t, 't');
      close(got.v, v.expect.v, 'v');
      if (v.kind !== 'lttb') expect(out.length).toBeLessThanOrEqual(v.maxPoints);
    });

  it('tính chất minmax: tất định, t tăng, giữ cực trị mỗi cửa sổ', () => {
    const rows: Row[] = Array.from({ length: 500 }, (_, i) => [i * 100, (i * 37) % 101]);
    const a = reduceMinMax(rows, 0, 50000, 40);
    expect(reduceMinMax(rows, 0, 50000, 40)).toEqual(a);
    for (let i = 1; i < a.length; i++) expect(a[i]![0]).toBeGreaterThanOrEqual(a[i - 1]![0]);
    expect(Math.max(...a.map((p) => p[1]!))).toBe(100);
    expect(Math.min(...a.map((p) => p[1]!))).toBe(0);
  });
});
