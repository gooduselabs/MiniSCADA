// T097: dựng báo cáo (kỳ, yêu cầu, ô, dòng tổng, thiếu dữ liệu, nhãn, vi-VN, chia lô); duyệt tests/report-vectors/report-*.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReport, reportRequest, type ReportTemplate } from './report.ts';
import { parseUtcOffset } from './format.ts';
import type { AggregateResult } from './types.ts';

const DIR = resolve(__dirname, '../../../tests/report-vectors');
const files = readdirSync(DIR).filter((f) => /^report-.*\.json$/.test(f));
const near = (a: number | null, b: number | null, what: string) => {
  if (a === null || b === null) return expect(a, what).toBe(b);
  expect(Math.abs(a - b), `${what}: ${a} != ${b}`).toBeLessThanOrEqual(
    1e-9 * Math.max(1, Math.abs(b)),
  );
};

interface Vec {
  template: ReportTemplate;
  tz: string;
  select: { d?: string; m?: string };
  now: number;
  shiftWord: string;
  tagInfo: Record<string, { description?: string; unit?: string }>;
  aggregates: AggregateResult[];
  expect: {
    request: {
      from: number;
      to: number;
      bucketMs: number;
      offsetMs: number;
      count: number;
      batches: string[][];
    };
    table: {
      title: string;
      footer: string;
      periodLabel: string;
      columns: Array<{
        key: string;
        tagId: string;
        fn: string;
        label: string;
        unit: string;
        decimals: number;
      }>;
      rows: Array<{
        label: string;
        cells: Array<number | null>;
        text: string[];
        coverage: number;
        pending: boolean;
      }>;
      totals: Array<number | null> | null;
      totalsText: string[] | null;
      coverage: number;
      generatedAt: number;
      tz: string;
    };
  };
}

describe('tests/report-vectors: report-*', () => {
  it('có đủ ca (>= 20)', () => expect(files.length).toBeGreaterThanOrEqual(20));
  for (const f of files)
    it(f, () => {
      const v = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Vec;
      const tz = parseUtcOffset(v.tz);
      const req = reportRequest(v.template, v.select, tz, v.shiftWord);
      expect({
        from: req.from,
        to: req.to,
        bucketMs: req.bucketMs,
        offsetMs: req.offsetMs,
        count: req.rows.length,
        batches: req.batches,
      }).toEqual(v.expect.request);

      const got = buildReport({
        template: v.template,
        select: v.select,
        tz: v.tz,
        now: v.now,
        shiftWord: v.shiftWord,
        tagInfo: v.tagInfo,
        aggregates: v.aggregates,
      });
      const want = v.expect.table;
      expect(got.title).toBe(want.title);
      expect(got.footer).toBe(want.footer);
      expect(got.periodLabel).toBe(want.periodLabel);
      expect(got.generatedAt).toBe(want.generatedAt);
      expect(got.tz).toBe(want.tz);
      expect(got.columns).toEqual(want.columns);
      expect(got.rows.length).toBe(want.rows.length);
      want.rows.forEach((w, i) => {
        const g = got.rows[i]!;
        expect(g.label).toBe(w.label);
        expect(g.pending, `${w.label} pending`).toBe(w.pending);
        expect(g.text, `${w.label} text`).toEqual(w.text);
        near(g.coverage, w.coverage, `${w.label} coverage`);
        w.cells.forEach((c, k) => near(g.cells[k]!, c, `${w.label} cell ${k}`));
      });
      if (want.totals === null) expect(got.totals).toBeNull();
      else {
        want.totals.forEach((c, k) => near(got.totals![k]!, c, `totals ${k}`));
        expect(got.totalsText).toEqual(want.totalsText);
      }
      near(got.coverage, want.coverage, 'coverage');
    });

  it('bỏ qua phần tử aggregate thiếu Tag: ô trống, không bịa số', () => {
    const v = JSON.parse(readFileSync(join(DIR, 'report-day-60min.json'), 'utf8')) as Vec;
    const got = buildReport({
      template: v.template,
      select: v.select,
      tz: v.tz,
      now: v.now,
      shiftWord: v.shiftWord,
      tagInfo: v.tagInfo,
      aggregates: [],
    });
    expect(got.rows.every((r) => r.cells.every((c) => c === null))).toBe(true);
    expect(got.coverage).toBe(0);
  });
});
