// Feature 015 (specs/015-reports/plan.md): kỳ tuần và khoảng tùy chọn, hàm onTime, thẻ tổng hợp và biểu đồ của
// ReportTable mở rộng (cùng một bảng cho web, Studio, CSV, XLSX, PDF).
import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS } from './agg.ts';
import { localMidnight, parseUtcOffset } from './format.ts';
import {
  buildReport,
  isoWeekStart,
  reportChart,
  reportRequest,
  validSelection,
  type ReportTemplate,
} from './report.ts';
import type { AggregateResult } from './types.ts';

const TZ = '+07:00';
const tz = parseUtcOffset(TZ);
const FN = {
  min: 'nhỏ nhất',
  max: 'lớn nhất',
  avg: 'trung bình',
  sum: 'tổng',
  first: 'đầu kỳ',
  last: 'cuối kỳ',
  delta: 'chênh lệch',
  count: 'số mẫu',
  onTime: 'thời gian ON',
  starts: 'số lần bật',
};

/** aggregate giả: mỗi cửa sổ đủ dữ liệu, giá trị không đổi `v(k)` (sumw = v × wms). */
function agg(
  tagId: string,
  start: number,
  count: number,
  bucketMs: number,
  v: (k: number) => number,
): AggregateResult {
  const arr = (f: (k: number) => number) => Array.from({ length: count }, (_, k) => f(k));
  return {
    start,
    count,
    bucketMs,
    series: [
      {
        tagId,
        n: arr(() => 10),
        min: arr(v),
        max: arr(v),
        first: arr(v),
        last: arr(v),
        sumw: arr((k) => v(k) * bucketMs),
        wms: arr(() => bucketMs),
      },
    ],
  };
}

const WEEK: ReportTemplate = {
  id: 'dien-tuan',
  name: 'Điện tuần',
  period: 'week',
  columns: [{ tagId: 'P', label: 'Công suất', unit: 'kW', decimals: 1, functions: ['avg', 'max'] }],
};

describe('kỳ tuần (ISO) và khoảng tùy chọn', () => {
  it('isoWeekStart: thứ Hai của tuần ISO (tuần 1 chứa ngày 4/1)', () => {
    expect(isoWeekStart('2026-W43', tz)).toBe(localMidnight(2026, 10, 19, tz));
    expect(isoWeekStart('2026-W01', tz)).toBe(localMidnight(2025, 12, 29, tz));
    expect(isoWeekStart('2020-W53', tz)).toBe(localMidnight(2020, 12, 28, tz));
    expect(() => isoWeekStart('2026-43', tz)).toThrow();
  });

  it('tuần: 7 hàng theo ngày từ thứ Hai, cửa sổ 1 ngày, nhãn kỳ', () => {
    const r = reportRequest(WEEK, { w: '2026-W43' }, tz);
    expect(r.rows).toHaveLength(7);
    expect(r.from).toBe(localMidnight(2026, 10, 19, tz));
    expect(r.to - r.from).toBe(7 * DAY_MS);
    expect(r.bucketMs).toBe(DAY_MS);
    expect(r.rows[0]!.label).toBe('T2 19/10');
    expect(r.rows[6]!.label).toBe('CN 25/10');
    expect(r.periodLabel).toBe('Tuần 43/2026 (19/10–25/10)');
  });

  it('khoảng: từ–đến (gồm cả ngày cuối), tối đa 31 ngày', () => {
    const tpl: ReportTemplate = { ...WEEK, period: 'range' };
    const r = reportRequest(tpl, { from: '2026-10-01', to: '2026-10-10' }, tz);
    expect(r.rows).toHaveLength(10);
    expect(r.from).toBe(localMidnight(2026, 10, 1, tz));
    expect(r.to).toBe(localMidnight(2026, 10, 11, tz));
    expect(r.periodLabel).toBe('01/10/2026–10/10/2026');
    expect(validSelection(tpl, { from: '2026-10-01', to: '2026-10-31' })).toBe(true);
    expect(validSelection(tpl, { from: '2026-10-01', to: '2026-11-01' })).toBe(false);
    expect(validSelection(tpl, { from: '2026-10-05', to: '2026-10-04' })).toBe(false);
    expect(validSelection(WEEK, { w: '2026-W43' })).toBe(true);
    expect(validSelection(WEEK, { w: '2026-W54' })).toBe(false);
    expect(validSelection({ ...WEEK, period: 'day' }, { d: '2026-10-19' })).toBe(true);
    expect(validSelection({ ...WEEK, period: 'month' }, { m: '2026-10' })).toBe(true);
    expect(validSelection({ ...WEEK, period: 'month' }, { d: '2026-10-01' })).toBe(false);
  });

  it('mẫu alarm/logic không có cột: kỳ vẫn tính, không có lô Tag', () => {
    const r = reportRequest(
      { id: 'a', name: 'A', kind: 'alarm', period: 'day' },
      { d: '2026-10-19' },
      tz,
    );
    expect(r.rows).toHaveLength(24);
    expect(r.batches).toEqual([]);
  });
});

describe('onTime, thẻ tổng hợp, biểu đồ', () => {
  const tpl: ReportTemplate = {
    id: 'bom',
    name: 'Bơm',
    period: 'day',
    rowMinutes: 60,
    columns: [
      { tagId: 'E', label: 'Điện năng', unit: 'kWh', decimals: 1, functions: ['delta'] },
      { tagId: 'RUN', label: 'Bơm 1', unit: 'giờ', decimals: 2, functions: ['onTime'] },
    ],
  };
  const from = localMidnight(2026, 10, 19, tz);
  const aggs = [
    agg('E', from, 24, HOUR_MS, (k) => 100 + k),
    agg('RUN', from, 24, HOUR_MS, (k) => (k % 2 === 0 ? 1 : 0)),
  ];
  // E có first = last trong mỗi cửa sổ (delta 0) nên dùng đường tăng thật: first k, last k + 1
  aggs[0]!.series[0]!.last = aggs[0]!.series[0]!.last.map((v) => v! + 1);
  const t = buildReport({
    template: tpl,
    select: { d: '2026-10-19' },
    tz: TZ,
    now: from + DAY_MS + 1,
    aggregates: aggs,
    fnNames: FN,
  });

  it('onTime của BOOL = giờ ON (tích phân), tổng kỳ cộng dồn', () => {
    expect(t.rows[0]!.cells[1]).toBeCloseTo(1, 9);
    expect(t.rows[1]!.cells[1]).toBeCloseTo(0, 9);
    expect(t.totals![1]).toBeCloseTo(12, 9);
    expect(t.totals![0]).toBeCloseTo(124 - 100, 9);
  });

  it('thẻ: tổng kỳ của các cột (tối đa 4) và độ đủ dữ liệu, màu xoay vòng', () => {
    expect(t.tiles!.map((x) => x.label)).toEqual([
      'Điện năng · chênh lệch',
      'Bơm 1 · thời gian ON',
      'Dữ liệu đủ',
    ]);
    expect(t.tiles![0]!.text).toBe('24,0');
    expect(t.tiles![0]!.unit).toBe('kWh');
    expect(t.tiles![2]!.text).toBe('100,0');
    expect(t.tiles![2]!.unit).toBe('%');
    expect(new Set(t.tiles!.map((x) => x.color)).size).toBe(3);
  });

  it('tiles: false → không thẻ; chart: none → không biểu đồ; totals: false vẫn có thẻ', () => {
    const off = buildReport({
      template: { ...tpl, tiles: false, chart: 'none', totals: false },
      select: { d: '2026-10-19' },
      tz: TZ,
      now: from + DAY_MS + 1,
      aggregates: aggs,
      fnNames: FN,
    });
    expect(off.tiles).toEqual([]);
    expect(off.chart).toBeNull();
    expect(off.totals).toBeNull();
    const tilesOnly = buildReport({
      template: { ...tpl, totals: false },
      select: { d: '2026-10-19' },
      tz: TZ,
      now: from + DAY_MS + 1,
      aggregates: aggs,
      fnNames: FN,
    });
    expect(tilesOnly.tiles![0]!.text).toBe('24,0');
  });

  it('biểu đồ tự chọn: cột cùng đơn vị với cột đầu, hàm cộng dồn → cột; chart: line ép đường', () => {
    expect(t.chart!.kind).toBe('bar');
    expect(t.chart!.series.map((s) => s.name)).toEqual(['Điện năng · chênh lệch']);
    expect(t.chart!.unit).toBe('kWh');
    expect(t.chart!.categories).toHaveLength(24);
    const line = reportChart(t, 'line');
    expect(line!.kind).toBe('line');
  });

  it('kỳ chưa tới: thẻ dựa trên phần đã tới, hàng chưa tới là null trong biểu đồ', () => {
    const half = buildReport({
      template: tpl,
      select: { d: '2026-10-19' },
      tz: TZ,
      now: from + 12 * HOUR_MS,
      aggregates: aggs,
      fnNames: FN,
    });
    expect(half.tiles![1]!.text).toBe('6,00');
    expect(half.chart!.series[0]!.values[20]).toBeNull();
  });
});

describe('shortLabels', () => {
  it('bỏ ngày chung ở đầu nhãn giờ; nhãn khác giữ nguyên', async () => {
    const { shortLabels } = await import('./report.ts');
    expect(shortLabels(['19/10 00:00–01:00', '19/10 01:00–02:00'])).toEqual([
      '00:00–01:00',
      '01:00–02:00',
    ]);
    expect(shortLabels(['T2 19/10', 'T3 20/10'])).toEqual(['T2 19/10', 'T3 20/10']);
    expect(shortLabels(['19/10 00:00', '20/10 00:00'])).toEqual(['19/10 00:00', '20/10 00:00']);
  });
});
