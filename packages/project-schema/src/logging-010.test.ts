// Feature 010 (T011): logging.json chế độ trigger, tổng hợp, ước tính ghi v2, định dạng 0.6.
// Duyệt các vector tests/project-vectors/v06-logging-010-* và logging-010-*; mô tả ở README-010.md.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateLogging, validateProject } from './index.ts';
import { NodeDirSource } from './node-source.ts';
import type { TagDataType } from './types.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors');
const cases = readdirSync(DIR).filter(
  (d) => /^(v06-)?logging-010-/.test(d) && statSync(join(DIR, d)).isDirectory(),
);

interface Exp {
  valid: boolean;
  errors: string[];
  warnings?: string[];
  issues?: Array<{ code: string; file: string; path: string }>;
  estimate?: Record<string, unknown> & { groups: Array<Record<string, unknown>> };
}
const expOf = (d: string): Exp => JSON.parse(readFileSync(join(DIR, d, 'expected.json'), 'utf8'));

describe('tests/project-vectors: logging-010-*', () => {
  it('đủ ca theo contract §6', () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    const codes = new Set(cases.flatMap((c) => expOf(c).errors));
    for (const c of ['E_LOG_TRIGGER', 'E_LOG_AGG', 'E_LOG_REF_TAG', 'E_SCHEMA', 'E_SCHEMA_VERSION'])
      expect(codes.has(c), c).toBe(true);
    const warns = new Set(cases.flatMap((c) => expOf(c).warnings ?? []));
    for (const c of ['W_LOG_WRITE_BUDGET', 'W_LOG_WRITE_EXTREME', 'W_LOG_SIZE_CAP'])
      expect(warns.has(c), c).toBe(true);
  });

  for (const c of cases)
    it(c, async () => {
      const exp = expOf(c);
      const r = await validateProject(new NodeDirSource(join(DIR, c)), { checkSvg: false });
      const codes = [...new Set(r.errors.map((e) => e.code))].sort();
      expect(codes, JSON.stringify(r.errors, null, 1)).toEqual([...exp.errors].sort());
      expect(r.valid).toBe(exp.valid);
      if (exp.warnings)
        expect([...new Set(r.warnings.map((w) => w.code))].sort()).toEqual(
          [...exp.warnings].sort(),
        );
      const all = [...r.errors, ...r.warnings].map(({ code, file, path }) => ({
        code,
        file,
        path,
      }));
      for (const i of exp.issues ?? []) expect(all).toContainEqual(i);
      if (exp.estimate) {
        const p = r.project03!;
        const types = new Map<string, TagDataType>(p.tags.tags.map((t) => [t.id, t.type]));
        const e = estimateLogging(p.logging!, types);
        const want = exp.estimate;
        for (const k of [
          'writeBytesPerDay',
          'rawWriteBytesPerDay',
          'aggWriteBytesPerDay',
          'storageBytes',
          'dailyGrowthBytes',
        ] as const)
          expect(Math.abs((e[k] as number) - (want[k] as number)), k).toBeLessThanOrEqual(1);
        expect(e.daysToFillCap).toBe(want.daysToFillCap);
        expect(e.groups.length).toBe(want.groups.length);
        want.groups.forEach((g, i) => {
          for (const k of [
            'rowsPerDay',
            'rowBytes',
            'rawWrite',
            'aggWrite',
            'rawStorage',
            'aggStorage',
            'aggTags',
          ])
            expect(
              Math.abs((e.groups[i] as unknown as Record<string, number>)[k]! - (g[k] as number)),
              `${k}[${i}]`,
            ).toBeLessThanOrEqual(1);
          expect(e.groups[i]!.basis).toBe(g.basis);
        });
      }
    });
});
