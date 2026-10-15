// T108: kỳ của widget (periodRange), mô hình biểu đồ cột và tròn; duyệt tests/report-vectors/{period,bar,pie}-*.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseUtcOffset } from './format.ts';
import {
  barModel,
  isEmptyRequest,
  periodRange,
  pieModel,
  type BarConfig,
  type PieConfig,
} from './period.ts';
import type { AggregateResult } from './types.ts';

const DIR = resolve(__dirname, '../../../tests/report-vectors');
const list = (p: string) => readdirSync(DIR).filter((f) => new RegExp(`^${p}-.*\\.json$`).test(f));
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const near = (a: number | null, b: number | null, what: string) => {
  if (a === null || b === null) return expect(a, what).toBe(b);
  expect(Math.abs(a - b), `${what}: ${a} != ${b}`).toBeLessThanOrEqual(
    1e-9 * Math.max(1, Math.abs(b)),
  );
};

describe('periodRange', () => {
  const files = list('period');
  it('có đủ ca', () => expect(files.length).toBeGreaterThanOrEqual(20));
  for (const f of files)
    it(f, () => {
      const v = read(f);
      const [from, to] = periodRange(
        v.period,
        v.now,
        parseUtcOffset(v.tz),
        v.shiftCount,
        v.shiftStart,
      );
      expect([from, to]).toEqual([v.expect.from, v.expect.to]);
    });
});

describe('barModel', () => {
  const files = list('bar');
  it('có đủ ca', () => expect(files.length).toBeGreaterThanOrEqual(8));
  for (const f of files)
    it(f, () => {
      const v = read(f) as {
        cfg: BarConfig;
        now: number;
        tz: string;
        shiftWord: string;
        tagIds: string[];
        labels: string[];
        aggregate: AggregateResult;
        expect: {
          request: Record<string, number>;
          categories: Array<{ start: number; end: number; label: string }>;
          series: Array<{ tagId: string; label: string; values: Array<number | null> }>;
        };
      };
      const m = barModel(
        v.cfg,
        v.now,
        parseUtcOffset(v.tz),
        v.aggregate,
        v.tagIds,
        v.labels,
        v.shiftWord,
      );
      expect(m.request).toEqual(v.expect.request);
      expect(m.categories).toEqual(v.expect.categories);
      expect(m.series.length).toBe(v.expect.series.length);
      v.expect.series.forEach((s, i) => {
        expect(m.series[i]!.tagId).toBe(s.tagId);
        expect(m.series[i]!.label).toBe(s.label);
        s.values.forEach((x, k) => near(m.series[i]!.values[k]!, x, `${s.tagId}[${k}]`));
      });
    });

  it('không có dữ liệu: mọi giá trị null nhưng hạng mục và yêu cầu vẫn đủ', () => {
    const v = read('bar-day-thismonth.json');
    const m = barModel(v.cfg, v.now, parseUtcOffset(v.tz), undefined, v.tagIds, [], 'Ca');
    expect(m.categories.length).toBe(31);
    expect(m.series[0]!.values.every((x) => x === null)).toBe(true);
  });
});

describe('pieModel', () => {
  const files = list('pie');
  it('có đủ ca', () => expect(files.length).toBeGreaterThanOrEqual(6));
  for (const f of files)
    it(f, () => {
      const v = read(f) as {
        cfg: PieConfig;
        now: number;
        tz: string;
        tagIds: string[];
        labels: string[];
        aggregate: AggregateResult;
        expect: {
          request: Record<string, number>;
          values: Array<{ tagId: string; value: number | null }>;
          slices: Array<{ tagId: string; label: string; value: number; percent: number }>;
          excluded: Array<{ tagId: string; reason: string }>;
          total: number;
        };
      };
      const m = pieModel(v.cfg, v.now, parseUtcOffset(v.tz), v.aggregate, v.tagIds, v.labels);
      expect(m.request).toEqual(v.expect.request);
      m.values.forEach((x, i) => near(x.value, v.expect.values[i]!.value, `value ${x.tagId}`));
      expect(m.excluded).toEqual(v.expect.excluded);
      near(m.total, v.expect.total, 'total');
      expect(m.slices.length).toBe(v.expect.slices.length);
      v.expect.slices.forEach((s, i) => {
        expect(m.slices[i]!.tagId).toBe(s.tagId);
        expect(m.slices[i]!.label).toBe(s.label);
        near(m.slices[i]!.value, s.value, `slice ${i}`);
        near(m.slices[i]!.percent, s.percent, `percent ${i}`);
      });
    });
});

describe('isEmptyRequest (I2 rà soát 010)', () => {
  const tz = parseUtcOffset('+07:00');
  const at = (h: number, m = 0) => Date.UTC(2026, 9, 12, h - 7, m, 0);
  it('cột ca + today lúc 03:00: from > to nên rỗng', () => {
    const r = barModel({ bucket: 'shift', period: 'today' }, at(3), tz, undefined, ['A']).request;
    expect(r.from).toBeGreaterThan(r.to);
    expect(isEmptyRequest(r)).toBe(true);
  });
  it('tròn today đúng 00:00: from == to nên rỗng', () => {
    const r = pieModel({ period: 'today' }, at(0), tz, undefined, ['A']).request;
    expect(r.from).toBe(r.to);
    expect(isEmptyRequest(r)).toBe(true);
  });
  it('khoảng bình thường không rỗng', () => {
    const r = pieModel({ period: 'today' }, at(10), tz, undefined, ['A']).request;
    expect(isEmptyRequest(r)).toBe(false);
    const b = barModel({ bucket: 'hour', period: 'today' }, at(10, 30), tz, undefined, [
      'A',
    ]).request;
    expect(isEmptyRequest(b)).toBe(false);
  });
  it('count = 0 là rỗng dù from < to', () => {
    expect(isEmptyRequest({ from: 0, to: 10, count: 0 })).toBe(true);
  });
});
