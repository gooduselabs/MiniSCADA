// T130 (feature 010, US8; contracts/studio-010.md §2 và §3): nguồn lịch sử mô phỏng của Studio. Tất định (cùng cấu hình, cùng
// đồng hồ → cùng kết quả), có khoảng thiếu dữ liệu giả để thử cảnh báo, bucket tính bằng `Aggregator` của history-math (cùng
// quy tắc với runtime), trả đúng dạng `SeriesResult` / `AggregateResult` của API 1.4.0, không có dữ liệu tương lai.
import {
  Aggregator,
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  buildReport,
  reportRequest,
} from '@mat/history-math';
import { describe, expect, it } from 'vitest';
import { SimHistorySource, simGaps, type SimHistoryGroup } from './sim-history.ts';

const NOW = Date.UTC(2026, 9, 14, 10, 0, 0); // 2026-10-14 10:00 UTC = 17:00 +07:00
const DAY0 = Date.UTC(2026, 9, 12, 0, 0, 0);
const ac = () => new AbortController().signal;

const group = (over: Partial<SimHistoryGroup> = {}): SimHistoryGroup => ({
  id: 'dien',
  name: 'Điện năng',
  mode: 'cyclic',
  timeZone: '+07:00',
  periodMs: 60_000,
  aggregates: true,
  tags: [
    { tagId: 'CONST', type: 'FLOAT32', unit: 'kW', sim: { kind: 'const', value: 5 } },
    {
      tagId: 'RAMP',
      type: 'FLOAT64',
      unit: 'kWh',
      sim: { kind: 'ramp', from: 0, to: 1440, periodMs: DAY_MS },
    },
    { tagId: 'RUN', type: 'BOOL', sim: { kind: 'square', periodMs: 2 * HOUR_MS, duty: 0.5 } },
  ],
  ...over,
});
const mk = (g = group(), now = NOW, gaps = false) =>
  new SimHistorySource({ groups: [g], now: () => now, gaps });

describe('SimHistorySource', () => {
  it('tất định: hai nguồn cùng cấu hình cho cùng kết quả', async () => {
    const a = mk(group(), NOW, true);
    const b = mk(group(), NOW, true);
    const q = {
      group: 'dien',
      tags: ['CONST', 'RAMP', 'RUN'],
      from: DAY0,
      to: DAY0 + DAY_MS,
      bucketMs: HOUR_MS,
    };
    expect(await a.aggregate(q, ac())).toEqual(await b.aggregate(q, ac()));
    const s = { group: 'dien', tags: ['RAMP'], from: DAY0, to: DAY0 + DAY_MS };
    expect(await a.series(s, ac())).toEqual(await b.series(s, ac()));
  });

  it('catalog: nhóm, múi giờ, Tag có tổng hợp, giới hạn như API', async () => {
    const c = await mk().catalog();
    expect(c.enabled).toBe(true);
    expect(c.apiVersion).toMatch(/^1\./);
    expect(c.groups[0]).toMatchObject({ id: 'dien', timeZone: '+07:00', mode: 'cyclic' });
    expect(c.groups[0]!.tags.map((t) => [t.tagId, t.aggregated, t.type])).toEqual([
      ['CONST', true, 'FLOAT32'],
      ['RAMP', true, 'FLOAT64'],
      ['RUN', true, 'BOOL'],
    ]);
    expect(c.limits.maxTags).toBeGreaterThanOrEqual(16);
  });

  it('aggregate: bucket giờ của Tag hằng đúng quy tắc bộ cộng dồn (n, min, max, first, last, sumw, wms)', async () => {
    const r = await mk().aggregate(
      { group: 'dien', tags: ['CONST'], from: DAY0, to: DAY0 + 3 * HOUR_MS, bucketMs: HOUR_MS },
      ac(),
    );
    expect(r).toMatchObject({
      start: DAY0,
      count: 3,
      bucketMs: HOUR_MS,
      group: 'dien',
      timeZone: '+07:00',
    });
    const s = r.series[0]!;
    expect(s.n).toEqual([60, 60, 60]);
    expect(s.min).toEqual([5, 5, 5]);
    expect(s.max).toEqual([5, 5, 5]);
    expect(s.first).toEqual([5, 5, 5]);
    expect(s.last).toEqual([5, 5, 5]);
    expect(s.wms).toEqual([HOUR_MS, HOUR_MS, HOUR_MS]);
    expect(s.sumw).toEqual([5 * HOUR_MS, 5 * HOUR_MS, 5 * HOUR_MS]);
    expect(s.avg).toEqual([5, 5, 5]);
    expect(s.sum).toEqual([5, 5, 5]); // kW × giờ = kWh
  });

  it('aggregate khớp bộ cộng dồn chạy trực tiếp trên cùng các dòng (delta của đường dốc)', async () => {
    const r = await mk().aggregate(
      { group: 'dien', tags: ['RAMP'], from: DAY0, to: DAY0 + DAY_MS, bucketMs: DAY_MS },
      ac(),
    );
    const agg = new Aggregator();
    // đường dốc 0 → 1440 trong 1 ngày: mỗi phút một dòng, giá trị = số phút trôi qua
    for (let t = DAY0; t < DAY0 + DAY_MS; t += MINUTE_MS) agg.row(t, (t - DAY0) / MINUTE_MS);
    agg.advance(DAY0 + DAY_MS);
    const rows = agg.drain();
    const s = r.series[0]!;
    expect(s.n[0]).toBe(rows.reduce((a, x) => a + x.n, 0));
    expect(s.first[0]).toBe(rows[0]!.first);
    expect(s.last[0]).toBe(rows.at(-1)!.last);
    expect(s.wms[0]).toBe(DAY_MS);
  });

  it('khoảng thiếu giả: có cửa sổ thiếu dữ liệu (wms < cửa sổ), trùng với simGaps; tắt được', async () => {
    const g = group();
    const gaps = simGaps('dien', DAY0, DAY0 + 2 * DAY_MS);
    expect(gaps.length).toBeGreaterThan(0);
    for (const [a, b] of gaps) expect(b).toBeGreaterThan(a);
    const withGaps = await mk(g, NOW, true).aggregate(
      { group: 'dien', tags: ['CONST'], from: DAY0, to: DAY0 + 2 * DAY_MS, bucketMs: HOUR_MS },
      ac(),
    );
    const lacking = withGaps.series[0]!.wms.filter((w) => w < HOUR_MS).length;
    expect(lacking).toBeGreaterThan(0);
    const without = await mk(g, NOW, false).aggregate(
      { group: 'dien', tags: ['CONST'], from: DAY0, to: DAY0 + 2 * DAY_MS, bucketMs: HOUR_MS },
      ac(),
    );
    expect(without.series[0]!.wms.every((w) => w === HOUR_MS)).toBe(true);
    const s = await mk(g, NOW, true).series(
      { group: 'dien', tags: ['CONST'], from: DAY0, to: DAY0 + 2 * DAY_MS },
      ac(),
    );
    expect(s.gaps).toEqual(gaps.filter(([a, b]) => b > DAY0 && a < DAY0 + 2 * DAY_MS));
  });

  it('không có dữ liệu tương lai: cửa sổ sau `now` rỗng (null), cửa sổ chứa `now` chỉ tới `now`', async () => {
    const r = await mk().aggregate(
      {
        group: 'dien',
        tags: ['CONST'],
        from: NOW - 2 * HOUR_MS,
        to: NOW + 2 * HOUR_MS,
        bucketMs: HOUR_MS,
      },
      ac(),
    );
    const s = r.series[0]!;
    expect(r.count).toBe(4);
    expect(s.n.slice(2)).toEqual([0, 0]);
    expect(s.wms.slice(2)).toEqual([0, 0]);
    expect(s.min.slice(2)).toEqual([null, null]);
    expect(s.avg.slice(2)).toEqual([null, null]);
    const ser = await mk().series(
      { group: 'dien', tags: ['CONST'], from: NOW - HOUR_MS, to: NOW + HOUR_MS },
      ac(),
    );
    expect(Math.max(...ser.series[0]!.t)).toBeLessThanOrEqual(NOW);
  });

  it('series: dạng SeriesResult, giảm điểm theo maxPoints, t tăng dần, BOOL là 0/1', async () => {
    const r = await mk().series(
      { group: 'dien', tags: ['RAMP', 'RUN'], from: DAY0, to: DAY0 + DAY_MS, maxPoints: 200 },
      ac(),
    );
    expect(r).toMatchObject({
      group: 'dien',
      timeZone: '+07:00',
      from: DAY0,
      to: DAY0 + DAY_MS,
      res: 'raw',
      maxPoints: 200,
    });
    expect(r.approximate).toBe(true);
    for (const line of r.series) {
      expect(line.t.length).toBeLessThanOrEqual(200);
      expect(line.t.length).toBe(line.v.length);
      expect([...line.t].sort((a, b) => a - b)).toEqual(line.t);
    }
    expect(r.series[1]!.v.every((v) => v === 0 || v === 1 || v === null)).toBe(true);
    expect(r.coverage).not.toBeNull();
  });

  it('rows: hàng [seq, ts, giá trị...], thứ tự và phân trang theo after', async () => {
    const q = { group: 'dien', from: DAY0, to: DAY0 + HOUR_MS, tags: ['CONST'], limit: 10 };
    const a = await mk().rows(q, ac());
    expect(a.columns.map((c) => c.tagId)).toEqual(['CONST']);
    expect(a.rows).toHaveLength(10);
    expect(a.rows[0]![2]).toBe(5);
    expect(a.next).toBe(a.rows.at(-1)![0]);
    const b = await mk().rows({ ...q, after: a.next! }, ac());
    expect(b.rows[0]![1]).toBeGreaterThan(a.rows.at(-1)![1] as number);
  });

  it('hủy: tín hiệu đã hủy bị từ chối bằng AbortError; nhóm lạ báo lỗi rõ', async () => {
    const c = new AbortController();
    c.abort();
    await expect(
      mk().series({ group: 'dien', tags: ['CONST'], from: DAY0, to: NOW }, c.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(
      mk().aggregate(
        { group: 'khong-co', tags: ['X'], from: DAY0, to: NOW, bucketMs: HOUR_MS },
        ac(),
      ),
    ).rejects.toMatchObject({ code: 'UNKNOWN_GROUP' });
  });

  it('dựng báo cáo từ nguồn mô phỏng: đúng số hàng và ô, dữ liệu thiếu làm tụt độ phủ', async () => {
    const src = mk(group(), NOW, true);
    const template = {
      id: 'dien-ngay',
      name: 'Điện năng theo ngày',
      period: 'day' as const,
      rowMinutes: 60,
      columns: [
        { tagId: 'CONST', unit: 'kW', decimals: 1, functions: ['avg' as const, 'max' as const] },
        { tagId: 'RAMP', unit: 'kWh', decimals: 1, functions: ['delta' as const] },
      ],
    };
    const req = reportRequest(template, { d: '2026-10-12' }, 7 * HOUR_MS);
    const aggregates = [];
    for (const tags of req.batches)
      aggregates.push(
        await src.aggregate(
          {
            group: 'dien',
            tags,
            from: req.from,
            to: req.to,
            bucketMs: req.bucketMs,
            offsetMs: req.offsetMs,
          },
          ac(),
        ),
      );
    const table = buildReport({
      template,
      select: { d: '2026-10-12' },
      tz: '+07:00',
      now: NOW,
      aggregates,
    });
    expect(table.rows).toHaveLength(24);
    expect(table.columns.map((c) => c.key)).toEqual(['CONST.avg', 'CONST.max', 'RAMP.delta']);
    expect(table.rows[0]!.text[0]).toBe('5,0');
    expect(table.coverage).toBeLessThan(1);
    expect(table.coverage).toBeGreaterThan(0.8);
  });
});
