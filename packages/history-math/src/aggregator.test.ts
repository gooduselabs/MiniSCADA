// T038: bộ cộng dồn tổng hợp (bản TS cho nguồn mô phỏng của Studio); duyệt tests/agg-vectors/agg-*.json.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runEvents, type AggEvent } from './aggregator.ts';

const DIR = resolve(__dirname, '../../../tests/agg-vectors');
const files = readdirSync(DIR).filter((f) => /^agg-.*\.json$/.test(f));
const near = (a: number, b: number, what: string) =>
  expect(Math.abs(a - b), what).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b)));

interface Vec {
  tags: { col: string }[];
  events: AggEvent[];
  expect: Record<string, Record<string, Array<Record<string, number>>>>;
}

describe('tests/agg-vectors: agg-*', () => {
  it('có đủ ca (>= 40)', () => expect(files.length).toBeGreaterThanOrEqual(40));
  for (const f of files)
    it(f, () => {
      const v = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Vec;
      for (const { col } of v.tags) {
        const got = runEvents(v.events, col);
        for (const res of ['60000', '3600000']) {
          const want = v.expect[col]![res]!;
          const have = got[res === '60000' ? 60000 : 3600000];
          expect(have.length, `${col}/${res}: số hàng`).toBe(want.length);
          want.forEach((w, i) => {
            const g = have[i]! as unknown as Record<string, number>;
            expect(g.bucket).toBe(w.bucket);
            expect(g.n).toBe(w.n);
            expect(g.wms).toBe(w.wms);
            for (const k of ['min', 'max', 'first', 'last', 'sumw'])
              near(g[k]!, w[k]!, `${col}/${res}[${i}].${k}`);
          });
        }
      }
    });
});
