// Sinh bộ vector báo cáo và kỳ widget dùng chung (feature 010, T096, T108). Chạy lại khi đổi luật:
//   node tests/report-vectors/generate.mjs
// `expect` sinh bằng tools/history-ref (độc lập với @mat/history-math); ca có `hand` còn kiểm với số tính tay.
// Định dạng: README.md cùng thư mục.
import assert from 'node:assert/strict';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAY_MS,
  HOUR_MS,
  MIN_MS,
  aggregateStore,
  evalFn,
  formatVi,
  reportPeriod,
  reportTable,
  tzOffsetMs,
  windowsFromMinutes,
} from '../../tools/history-ref/ref.mjs';
import {
  barRequest,
  periodRangeRef,
  pieRequest,
  pieSlices,
} from '../../tools/history-ref/widget-ref.mjs';

const here = dirname(fileURLToPath(import.meta.url));
for (const f of readdirSync(here))
  if (/^(report|period|bar|pie)-.*\.json$/.test(f)) rmSync(join(here, f));

/** JSON dễ đọc: mảng toàn số/chuỗi/null nằm trên một dòng. */
function dump(v) {
  const s = JSON.stringify(v, null, 2);
  return (
    s.replace(
      /\[\s*((?:(?:-?[\d.eE+-]+|null|true|false|"(?:[^"\\]|\\.)*")(?:,\s*)?\s*)+)\]/g,
      (_, body) => {
        const items = body
          .split(/,\s*/)
          .map((x) => x.trim())
          .filter(Boolean);
        return `[${items.join(', ')}]`;
      },
    ) + '\n'
  );
}
const out = (name, v) => writeFileSync(join(here, `${name}.json`), dump(v));

// ---------------------------------------------------------------------------------------------
// Dữ liệu thô giả lập
const r3 = (x) => Math.round(x * 1000) / 1000;
const SIG = {
  kw: (t) => r3(100 + 20 * Math.sin(t / 1800000)),
  kwh: (t0) => (t) => r3(1000 + ((t - t0) / HOUR_MS) * 100),
  run: (t) => (Math.floor(t / MIN_MS) % 300 < 210 ? 1 : 0),
  lvl: (t) => r3(50 + 30 * Math.cos(t / 7200000)),
};

/**
 * Dãy sự kiện từ `start` tới `end` (UTC ms), dòng mỗi `step` ms, `gaps` [[a, b)] là lúc runtime tắt (break rồi chạy lại).
 */
function events(tagId, gen, start, end, step, gaps = []) {
  const ev = [{ t: start, op: 'break' }];
  const inGap = (t) => gaps.some(([a, b]) => t >= a && t < b);
  for (const [a] of gaps) if (a > start && a < end) ev.push({ t: a, op: 'break', _gap: true });
  const rows = [];
  for (let t = start; t < end; t += step)
    if (!inGap(t)) rows.push({ t, op: 'row', values: { [tagId]: gen(t) } });
  const all = [...ev, ...rows].sort((x, y) => x.t - y.t || (x.op === 'break' ? -1 : 1));
  all.push({ t: end, op: 'advance' });
  return all.map(({ _gap, ...e }) => e);
}

/** Phản hồi `aggregate` giả cho một nhóm Tag trên các cửa sổ [start + k * bucketMs). */
function aggregateOf(tags, signals, start, count, bucketMs, now) {
  const end = Math.min(now, start + count * bucketMs);
  const series = tags.map((tagId) => {
    const s = signals[tagId];
    const store = aggregateStore(
      s.dead
        ? [
            { t: start, op: 'break' },
            { t: end, op: 'advance' },
          ]
        : events(tagId, s.gen, s.from ?? start, end, s.step ?? MIN_MS, s.gaps ?? []),
      tagId,
    );
    const wins = windowsFromMinutes(store[MIN_MS], start, bucketMs, count);
    const pick = (k) => wins.map((b) => (b === null ? null : b[k]));
    return {
      tagId,
      n: wins.map((b) => (b === null ? 0 : b.n)),
      min: pick('min'),
      max: pick('max'),
      first: pick('first'),
      last: pick('last'),
      sumw: pick('sumw'),
      wms: wins.map((b) => (b === null ? 0 : b.wms)),
    };
  });
  return { start, count, bucketMs, series };
}
const bucketAt = (series, k) =>
  series.n[k] === 0 && series.wms[k] === 0
    ? null
    : {
        n: series.n[k],
        min: series.min[k],
        max: series.max[k],
        first: series.first[k],
        last: series.last[k],
        sumw: series.sumw[k],
        wms: series.wms[k],
      };

// ---------------------------------------------------------------------------------------------
// Báo cáo
const chunk = (a, n) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
let nReport = 0;
function report(name, description, { template, tz, select, now, signals, tagInfo = {}, hand }) {
  const tzMs = tzOffsetMs(tz);
  const period = reportPeriod(template, select, tzMs, 'Ca');
  const tagIds = [...new Set(template.columns.map((c) => c.tagId))];
  const batches = chunk(tagIds, 16);
  const aggregates = batches.map((b) =>
    aggregateOf(b, signals, period.from, period.rows.length, period.bucketMs, now),
  );
  const buckets = {};
  for (const a of aggregates)
    for (const s of a.series) buckets[s.tagId] = period.rows.map((_, k) => bucketAt(s, k));
  const t = reportTable(template, period, buckets, now, tagInfo);
  const table = {
    title: template.title ?? template.name,
    footer: template.footer ?? '',
    periodLabel: t.periodLabel,
    columns: t.columns,
    rows: t.rows.map((r) => ({
      label: r.label,
      cells: r.cells,
      text: r.cells.map((c, i) => (c === null ? '' : formatVi(c, t.columns[i].decimals))),
      coverage: r.coverage,
      pending: r.pending,
    })),
    totals: t.totals,
    totalsText:
      t.totals === null
        ? null
        : t.totals.map((c, i) => (c === null ? '' : formatVi(c, t.columns[i].decimals))),
    coverage: t.coverage,
    generatedAt: now,
    tz,
  };
  if (hand) hand(table, period);
  out(`report-${name}`, {
    name,
    description,
    kind: 'report',
    template,
    tz,
    select,
    now,
    shiftWord: 'Ca',
    tagInfo,
    aggregates,
    expect: {
      request: {
        from: period.from,
        to: period.to,
        bucketMs: period.bucketMs,
        offsetMs: period.offsetMs,
        count: period.rows.length,
        batches,
      },
      table,
    },
  });
  nReport++;
}

const UTC = (y, m, d, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi);
const T = (over) => ({
  id: 'mau',
  name: 'Mẫu',
  group: 'dien',
  period: 'day',
  totals: true,
  ...over,
});
const colKw = {
  tagId: 'METER1.KW',
  label: 'Công suất',
  unit: 'kW',
  decimals: 1,
  functions: ['avg', 'max'],
};
const colKwh = {
  tagId: 'METER1.KWH',
  label: 'Điện năng',
  unit: 'kWh',
  decimals: 1,
  functions: ['delta'],
};
const colRun = {
  tagId: 'PUMP1.RUN',
  label: 'Bơm chạy',
  unit: 'giờ',
  decimals: 2,
  functions: ['sum'],
};
const sigs = (t0) => ({
  'METER1.KW': { gen: SIG.kw },
  'METER1.KWH': { gen: SIG.kwh(t0) },
  'PUMP1.RUN': { gen: SIG.run },
});
const DONE = UTC(2027, 1, 1); // sau mọi kỳ thử: mọi hàng đã tới

// Ngày: 60, 30, 15 phút (+07:00; 12/10/2026 giờ địa phương = 11/10 17:00Z)
for (const rm of [60, 30, 15]) {
  const from = UTC(2026, 10, 11, 17);
  report(
    `day-${rm}min`,
    `Ngày 12/10/2026, hàng ${rm} phút (${(24 * 60) / rm} hàng), +07:00; kW, bộ đếm kWh, giờ chạy bơm.`,
    {
      template: T({
        id: 'ngay',
        name: 'Điện năng theo ngày',
        rowMinutes: rm,
        columns: [colKw, colKwh, colRun],
      }),
      tz: '+07:00',
      select: { d: '2026-10-12' },
      now: DONE,
      signals: sigs(from),
      hand: (tb) => {
        assert.equal(tb.rows.length, (24 * 60) / rm);
        assert.equal(
          tb.rows[0].label,
          rm === 60 ? '12/10 00:00–01:00' : rm === 30 ? '12/10 00:00–00:30' : '12/10 00:00–00:15',
        );
      },
    },
  );
}
// Ca
const shiftT = (count, start) =>
  T({
    id: 'ca',
    name: 'Điện năng theo ca',
    period: 'shift',
    shifts: { count, start },
    columns: [colKw, colKwh, colRun],
  });
for (const [count, start] of [
  [3, '06:00'],
  [2, '22:00'],
  [4, '06:00'],
  [6, '00:00'],
  [8, '07:30'],
  [12, '06:00'],
]) {
  const from =
    UTC(2026, 10, 11, 17) + (Number(start.slice(0, 2)) * 60 + Number(start.slice(3))) * MIN_MS;
  report(
    `shift-${count}-${start.replace(':', '')}`,
    `Ngày làm việc 12/10/2026, ${count} ca bắt đầu ${start} (ca cuối qua nửa đêm khi cần), +07:00.`,
    {
      template: shiftT(count, start),
      tz: '+07:00',
      select: { d: '2026-10-12' },
      now: DONE,
      signals: sigs(from),
      hand:
        count === 3 && start === '06:00'
          ? (tb) =>
              assert.deepEqual(
                tb.rows.map((r) => r.label),
                ['Ca 1 06:00–14:00', 'Ca 2 14:00–22:00', 'Ca 3 22:00–06:00'],
              )
          : undefined,
    },
  );
}
// Tháng 28, 29, 30, 31 ngày
for (const [m, days] of [
  ['2027-02', 28],
  ['2028-02', 29],
  ['2026-11', 30],
  ['2026-10', 31],
]) {
  const [y, mo] = m.split('-').map(Number);
  const from = UTC(y, mo, 1) - 7 * HOUR_MS;
  report(`month-${m}`, `Tháng ${m} (${days} ngày), hàng theo ngày, +07:00.`, {
    template: T({
      id: 'thang',
      name: 'Điện năng theo tháng',
      period: 'month',
      columns: [colKw, colKwh, colRun],
    }),
    tz: '+07:00',
    select: { m },
    now: UTC(y + (mo === 12 ? 1 : 0), (mo % 12) + 2, 5),
    signals: {
      'METER1.KW': { gen: SIG.kw, step: 5 * MIN_MS },
      'METER1.KWH': { gen: SIG.kwh(from), step: 5 * MIN_MS },
      'PUMP1.RUN': { gen: SIG.run, step: 5 * MIN_MS },
    },
    hand: (tb) => assert.equal(tb.rows.length, days),
  });
}
// Kỳ đang chạy
{
  const from = UTC(2026, 10, 11, 17);
  report(
    'running-day',
    'Ngày đang chạy: bây giờ 12/10/2026 10:30 (+07:00); hàng bắt đầu từ 11:00 là "chưa tới" (ô trống, không vào dòng tổng).',
    {
      template: T({ id: 'ngay', name: 'Đang chạy', columns: [colKw, colKwh] }),
      tz: '+07:00',
      select: { d: '2026-10-12' },
      now: UTC(2026, 10, 12, 3, 30),
      signals: sigs(from),
      hand: (tb) => {
        assert.equal(tb.rows.filter((r) => r.pending).length, 13);
        assert.equal(tb.rows[10].pending, false);
        assert.equal(tb.rows[10].coverage, 0.5);
      },
    },
  );
  const m0 = UTC(2026, 9, 30, 17);
  report(
    'running-month',
    'Tháng đang chạy: bây giờ 13/10/2026 10:30 (+07:00); 18 ngày "chưa tới"; ngày hôm nay chỉ phủ một phần.',
    {
      template: T({ id: 'thang', name: 'Đang chạy', period: 'month', columns: [colKw, colKwh] }),
      tz: '+07:00',
      select: { m: '2026-10' },
      now: UTC(2026, 10, 13, 3, 30),
      signals: {
        'METER1.KW': { gen: SIG.kw, step: 5 * MIN_MS },
        'METER1.KWH': { gen: SIG.kwh(m0), step: 5 * MIN_MS },
      },
      hand: (tb) => assert.equal(tb.rows.filter((r) => r.pending).length, 18),
    },
  );
}
// Thiếu dữ liệu
{
  const from = UTC(2026, 10, 11, 17);
  report(
    'missing-data',
    'Runtime tắt 02:00-04:30 giờ địa phương: hàng 02, 03, 04 thiếu dữ liệu (coverage < 0,95); cả báo cáo hiện "Dữ liệu đủ X %".',
    {
      template: T({ id: 'ngay', name: 'Thiếu dữ liệu', columns: [colKw, colKwh] }),
      tz: '+07:00',
      select: { d: '2026-10-12' },
      now: DONE,
      signals: {
        'METER1.KW': { gen: SIG.kw, gaps: [[from + 2 * HOUR_MS, from + 4.5 * HOUR_MS]] },
        'METER1.KWH': { gen: SIG.kwh(from), gaps: [[from + 2 * HOUR_MS, from + 4.5 * HOUR_MS]] },
      },
      hand: (tb) =>
        assert.ok(
          tb.rows.slice(2, 5).every((r) => r.coverage < 0.95) &&
            tb.rows[1].coverage === 1 &&
            tb.coverage < 1,
        ),
    },
  );
  report(
    'empty-window',
    'Tag không có dữ liệu cả buổi 08:00-12:00: ô của các hàng đó trống (null), không bịa số; dòng tổng bỏ qua hàng rỗng.',
    {
      template: T({ id: 'ngay', name: 'Hàng rỗng', columns: [colKw, colKwh] }),
      tz: '+07:00',
      select: { d: '2026-10-12' },
      now: DONE,
      signals: {
        'METER1.KW': {
          gen: (t) => (t >= from + 8 * HOUR_MS && t < from + 12 * HOUR_MS ? null : SIG.kw(t)),
        },
        'METER1.KWH': { gen: SIG.kwh(from) },
      },
      hand: (tb) => assert.ok(tb.rows[9].cells[0] === null && tb.rows[9].cells[2] !== null),
    },
  );
  report('no-data-at-all', 'Kỳ chưa có dữ liệu nào: mọi ô trống, coverage 0.', {
    template: T({ id: 'ngay', name: 'Không dữ liệu', columns: [colKw] }),
    tz: '+07:00',
    select: { d: '2026-10-12' },
    now: DONE,
    signals: { 'METER1.KW': { gen: SIG.kw, dead: true } },
    hand: (tb) => assert.equal(tb.coverage, 0),
  });
}
// Hàm, dòng tổng
{
  const from = UTC(2026, 10, 11, 17);
  report(
    'all-functions',
    'Cả tám hàm trên một Tag (min, max, avg, sum, first, last, delta, count) và dòng tổng ghép: delta tổng = cuối kỳ - đầu kỳ.',
    {
      template: T({
        id: 'hamdu',
        name: 'Đủ hàm',
        rowMinutes: 60,
        columns: [
          {
            tagId: 'METER1.KWH',
            label: 'Bộ đếm',
            unit: 'kWh',
            decimals: 3,
            functions: ['min', 'max', 'avg', 'sum', 'first', 'last', 'delta', 'count'],
          },
        ],
      }),
      tz: '+07:00',
      select: { d: '2026-10-12' },
      now: DONE,
      signals: { 'METER1.KWH': { gen: SIG.kwh(from) } },
      hand: (tb) => {
        assert.equal(tb.columns.length, 8);
        const d = tb.columns.findIndex((c) => c.fn === 'delta');
        near(
          tb.totals[d],
          tb.rows.reduce((s, r) => s + r.cells[d], 0),
        );
      },
    },
  );
  report('totals-false', 'totals:false: không có dòng tổng.', {
    template: T({ id: 'khongtong', name: 'Không tổng', totals: false, columns: [colKw] }),
    tz: '+07:00',
    select: { d: '2026-10-12' },
    now: DONE,
    signals: { 'METER1.KW': { gen: SIG.kw } },
    hand: (tb) => assert.equal(tb.totals, null),
  });
  report(
    'default-label-unit',
    'Nhãn và đơn vị mặc định: label theo mô tả Tag, unit theo Tag.unit; Tag không có mô tả dùng id.',
    {
      template: T({
        id: 'macdinh',
        name: 'Mặc định',
        columns: [
          { tagId: 'METER1.KW', functions: ['avg'] },
          { tagId: 'METER1.KWH', functions: ['delta'], decimals: 0 },
        ],
      }),
      tz: '+07:00',
      select: { d: '2026-10-12' },
      now: DONE,
      signals: sigs(from),
      tagInfo: {
        'METER1.KW': { description: 'Công suất tác dụng', unit: 'kW' },
        'METER1.KWH': { unit: 'kWh' },
      },
      hand: (tb) => {
        assert.equal(tb.columns[0].label, 'Công suất tác dụng');
        assert.equal(tb.columns[1].label, 'METER1.KWH');
        assert.equal(tb.columns[1].unit, 'kWh');
      },
    },
  );
  report('bool-run-hours', 'BOOL giờ chạy theo ca: sum = giờ chạy (sumw / 3.600.000).', {
    template: shiftT(3, '06:00'),
    tz: '+07:00',
    select: { d: '2026-10-12' },
    now: DONE,
    signals: sigs(UTC(2026, 10, 11, 23)),
  });
  const names = Array.from({ length: 20 }, (_, i) => `TAG.T${String(i + 1).padStart(2, '0')}`);
  report(
    'batches-20-tags',
    '20 Tag khác nhau: chia lô <= 16 Tag mỗi yêu cầu (hai yêu cầu: 16 và 4).',
    {
      template: T({
        id: 'nhieutag',
        name: '20 Tag',
        rowMinutes: 60,
        columns: names.map((tagId) => ({ tagId, decimals: 1, functions: ['avg'] })),
      }),
      tz: '+07:00',
      select: { d: '2026-10-12' },
      now: DONE,
      signals: Object.fromEntries(
        names.map((n, i) => [n, { gen: (t) => r3(i + 10 + 5 * Math.sin(t / 3600000 + i)) }]),
      ),
      hand: (tb) => assert.equal(tb.columns.length, 20),
    },
  );
}
// Múi giờ lẻ và âm
{
  report(
    'tz-0530-day',
    'Ngày 12/10/2026 theo +05:30: hàng bắt đầu 18:30Z, offsetMs của yêu cầu theo giờ địa phương.',
    {
      template: T({ id: 'ngay', name: 'IST', rowMinutes: 30, columns: [colKw, colKwh] }),
      tz: '+05:30',
      select: { d: '2026-10-12' },
      now: DONE,
      signals: sigs(UTC(2026, 10, 11, 18, 30)),
    },
  );
  report('tz-0530-shift', 'Ca 3 x 8 giờ từ 06:00 theo +05:30 (ca 1 bắt đầu 00:30Z).', {
    template: shiftT(3, '06:00'),
    tz: '+05:30',
    select: { d: '2026-10-12' },
    now: DONE,
    signals: sigs(UTC(2026, 10, 12, 0, 30)),
  });
  report('tz-0330w-month', 'Tháng 10/2026 theo -03:30: ranh giới ngày lệch 3,5 giờ so với UTC.', {
    template: T({ id: 'thang', name: 'Tây', period: 'month', columns: [colKw, colKwh] }),
    tz: '-03:30',
    select: { m: '2026-10' },
    now: UTC(2026, 11, 3),
    signals: {
      'METER1.KW': { gen: SIG.kw, step: 5 * MIN_MS },
      'METER1.KWH': { gen: SIG.kwh(UTC(2026, 10, 1, 3, 30)), step: 5 * MIN_MS },
    },
  });
}
function near(a, b) {
  assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
}

// ---------------------------------------------------------------------------------------------
// Kỳ widget (periodRange)
const ISO = (ts) => new Date(ts).toISOString();
let nPeriod = 0;
function period(
  name,
  description,
  { period: p, now, tz, shiftCount = 3, shiftStart = '06:00', hand },
) {
  const [from, to] = periodRangeRef(p, now, tzOffsetMs(tz), shiftCount, shiftStart);
  if (hand) assert.deepEqual([ISO(from), ISO(to)], hand, name);
  out(`period-${name}`, {
    name,
    description,
    kind: 'period',
    period: p,
    now,
    tz,
    shiftCount,
    shiftStart,
    expect: { from, to, fromIso: ISO(from), toIso: ISO(to) },
  });
  nPeriod++;
}
const NOW = Date.UTC(2026, 9, 13, 3, 30, 45, 678); // 13/10/2026 10:30:45,678 giờ +07:00
const P = [
  ['last24h', ['2026-10-12T03:30:00.000Z', '2026-10-13T03:30:00.000Z']],
  ['last7d', ['2026-10-06T03:30:00.000Z', '2026-10-13T03:30:00.000Z']],
  ['last30d', ['2026-09-13T03:30:00.000Z', '2026-10-13T03:30:00.000Z']],
  ['today', ['2026-10-12T17:00:00.000Z', '2026-10-13T03:30:00.000Z']],
  ['yesterday', ['2026-10-11T17:00:00.000Z', '2026-10-12T17:00:00.000Z']],
  ['thisMonth', ['2026-09-30T17:00:00.000Z', '2026-10-31T17:00:00.000Z']],
  ['lastMonth', ['2026-08-31T17:00:00.000Z', '2026-09-30T17:00:00.000Z']],
  ['thisShift', ['2026-10-12T23:00:00.000Z', '2026-10-13T07:00:00.000Z']],
  ['lastShift', ['2026-10-12T15:00:00.000Z', '2026-10-12T23:00:00.000Z']],
];
for (const [p, hand] of P)
  period(
    `${p}-0700`,
    `${p} lúc 13/10/2026 10:30:45,678 (+07:00); làm tròn xuống phút (số tính tay).`,
    { period: p, now: NOW, tz: '+07:00', hand },
  );
for (const p of [
  'today',
  'yesterday',
  'thisMonth',
  'lastMonth',
  'thisShift',
  'lastShift',
  'last24h',
])
  period(`${p}-0530`, `${p} lúc 13/10/2026 07:15 UTC theo +05:30 (12:45 địa phương).`, {
    period: p,
    now: Date.UTC(2026, 9, 13, 7, 15, 59, 999),
    tz: '+05:30',
  });
period('lastMonth-leap', 'Tháng trước của 10/03/2028 theo +05:30: tháng 2 năm nhuận 29 ngày.', {
  period: 'lastMonth',
  now: Date.UTC(2028, 2, 10, 12),
  tz: '+05:30',
  hand: ['2028-01-31T18:30:00.000Z', '2028-02-29T18:30:00.000Z'],
});
period('lastMonth-year', 'Tháng trước của 15/01/2028 theo +05:30: qua năm (tháng 12/2027).', {
  period: 'lastMonth',
  now: Date.UTC(2028, 0, 15, 12),
  tz: '+05:30',
  hand: ['2027-11-30T18:30:00.000Z', '2027-12-31T18:30:00.000Z'],
});
period('thisMonth-leap', 'Tháng này của 20/02/2028 theo +07:00: 29 ngày.', {
  period: 'thisMonth',
  now: Date.UTC(2028, 1, 20, 5),
  tz: '+07:00',
  hand: ['2028-01-31T17:00:00.000Z', '2028-02-29T17:00:00.000Z'],
});
period(
  'thisShift-before-start',
  'Ca 3 x 8 giờ từ 06:00; bây giờ 03:10 địa phương, trước giờ bắt đầu: ca chứa là ca 3 của ngày làm việc hôm trước (22:00-06:00).',
  {
    period: 'thisShift',
    now: Date.UTC(2026, 9, 12, 20, 10),
    tz: '+07:00',
    hand: ['2026-10-12T15:00:00.000Z', '2026-10-12T23:00:00.000Z'],
  },
);
period(
  'thisShift-2x12-2200',
  'Hai ca 12 giờ từ 22:00; bây giờ 09:00 địa phương: ca 1 (22:00 hôm trước tới 10:00).',
  {
    period: 'thisShift',
    now: Date.UTC(2026, 9, 13, 2),
    tz: '+07:00',
    shiftCount: 2,
    shiftStart: '22:00',
    hand: ['2026-10-12T15:00:00.000Z', '2026-10-13T03:00:00.000Z'],
  },
);
period('lastShift-2x12-2200', 'Ca trước của ca trên.', {
  period: 'lastShift',
  now: Date.UTC(2026, 9, 13, 2),
  tz: '+07:00',
  shiftCount: 2,
  shiftStart: '22:00',
  hand: ['2026-10-12T03:00:00.000Z', '2026-10-12T15:00:00.000Z'],
});
period('thisShift-12x2h', '12 ca 2 giờ từ 06:00; 10:30 thuộc ca 3 (10:00-12:00).', {
  period: 'thisShift',
  now: Date.UTC(2026, 9, 13, 3, 30),
  tz: '+07:00',
  shiftCount: 12,
  hand: ['2026-10-13T03:00:00.000Z', '2026-10-13T05:00:00.000Z'],
});
period('today-midnight', 'Đúng nửa đêm địa phương: today rỗng ([nửa đêm, nửa đêm)).', {
  period: 'today',
  now: Date.UTC(2026, 9, 12, 17),
  tz: '+07:00',
  hand: ['2026-10-12T17:00:00.000Z', '2026-10-12T17:00:00.000Z'],
});

// ---------------------------------------------------------------------------------------------
// Biểu đồ cột
let nBar = 0;
function bar(name, description, { cfg, now, tz, tagIds, labels, signals, hand }) {
  const tzMs = tzOffsetMs(tz);
  const req = barRequest(cfg, now, tzMs, 'Ca');
  assert.ok(req.categories.length <= 48, `${name}: quá 48 hạng mục`);
  const aggregate = aggregateOf(
    tagIds,
    signals,
    req.from,
    req.categories.length,
    req.bucketMs,
    now,
  );
  const fn = cfg.fn ?? 'delta';
  const series = aggregate.series.map((s, i) => ({
    tagId: s.tagId,
    label: labels?.[i] ?? s.tagId,
    values: req.categories.map((_, k) => evalFn(fn, bucketAt(s, k))),
  }));
  if (hand) hand(req, series);
  out(`bar-${name}`, {
    name,
    description,
    kind: 'bar',
    cfg,
    now,
    tz,
    shiftWord: 'Ca',
    tagIds,
    labels: labels ?? [],
    aggregate,
    expect: {
      request: {
        from: req.from,
        to: req.to,
        bucketMs: req.bucketMs,
        offsetMs: req.offsetMs,
        count: req.categories.length,
      },
      categories: req.categories,
      series,
    },
  });
  nBar++;
}
const barSig = {
  'METER1.KWH': { gen: SIG.kwh(0) },
  'METER1.KW': { gen: SIG.kw },
  'PUMP1.RUN': { gen: SIG.run },
};
bar(
  'shift-last7d',
  'Điện năng (delta) theo ca, 7 ngày gần nhất, 3 ca từ 06:00: 21 hạng mục, nhãn "dd/MM Ca n" theo ngày làm việc; hạng mục cuối là ca đang chạy.',
  {
    cfg: { fn: 'delta', bucket: 'shift', period: 'last7d', shiftCount: 3, shiftStart: '06:00' },
    now: NOW,
    tz: '+07:00',
    tagIds: ['METER1.KWH'],
    signals: {
      'METER1.KWH': { gen: SIG.kwh(NOW - 8 * DAY_MS), from: NOW - 8 * DAY_MS, step: 5 * MIN_MS },
    },
    hand: (r) => {
      assert.equal(r.categories.length, 21);
      assert.equal(r.categories[0].label, '06/10 Ca 2');
      assert.equal(r.categories.at(-1).label, '13/10 Ca 1');
      assert.equal(r.offsetMs, 7 * HOUR_MS);
    },
  },
);
bar(
  'hour-last24h',
  'Công suất trung bình theo giờ, 24 giờ gần nhất: 24 hạng mục từ 11:00 hôm qua, giờ cuối chưa trọn.',
  {
    cfg: { fn: 'avg', bucket: 'hour', period: 'last24h' },
    now: NOW,
    tz: '+07:00',
    tagIds: ['METER1.KW'],
    signals: { 'METER1.KW': { gen: SIG.kw, from: NOW - 2 * DAY_MS, step: 5 * MIN_MS } },
    hand: (r) => {
      assert.equal(r.categories.length, 24);
      assert.equal(r.categories[0].label, '11:00');
      assert.equal(r.categories.at(-1).label, '10:00');
    },
  },
);
bar(
  'hour-today',
  'Giờ chạy bơm (sum) theo giờ, hôm nay: 11 hạng mục (00:00-10:00), giờ 10 chưa trọn.',
  {
    cfg: { fn: 'sum', bucket: 'hour', period: 'today' },
    now: NOW,
    tz: '+07:00',
    tagIds: ['PUMP1.RUN'],
    signals: { 'PUMP1.RUN': { gen: SIG.run, from: NOW - 2 * DAY_MS, step: MIN_MS } },
    hand: (r) => assert.equal(r.categories.length, 11),
  },
);
bar(
  'day-thismonth',
  'Điện năng theo ngày, tháng này (10/2026): 31 hạng mục, ngày chưa tới trống.',
  {
    cfg: { fn: 'delta', bucket: 'day', period: 'thisMonth' },
    now: NOW,
    tz: '+07:00',
    tagIds: ['METER1.KWH'],
    signals: { 'METER1.KWH': { gen: SIG.kwh(0), from: UTC(2026, 9, 30, 17), step: 15 * MIN_MS } },
    hand: (r, s) => {
      assert.equal(r.categories.length, 31);
      assert.equal(s[0].values[30], null);
    },
  },
);
bar('day-lastmonth', 'Công suất lớn nhất (max) theo ngày, tháng trước (09/2026): 30 hạng mục.', {
  cfg: { fn: 'max', bucket: 'day', period: 'lastMonth' },
  now: NOW,
  tz: '+07:00',
  tagIds: ['METER1.KW'],
  signals: { 'METER1.KW': { gen: SIG.kw, from: UTC(2026, 7, 31, 17), step: 15 * MIN_MS } },
  hand: (r) => assert.equal(r.categories.length, 30),
});
bar('shift-thisshift', 'Ca đang chạy: một hạng mục (ca 1, 06:00-14:00 hôm nay).', {
  cfg: { fn: 'delta', bucket: 'shift', period: 'thisShift', shiftCount: 3, shiftStart: '06:00' },
  now: NOW,
  tz: '+07:00',
  tagIds: ['METER1.KWH'],
  signals: { 'METER1.KWH': { gen: SIG.kwh(0), from: NOW - 2 * DAY_MS, step: MIN_MS } },
  hand: (r) =>
    assert.deepEqual(
      r.categories.map((c) => c.label),
      ['13/10 Ca 1'],
    ),
});
bar('shift-lastshift-2200', 'Ca trước, 4 ca từ 22:00: hạng mục "12/10 Ca n" theo ngày làm việc.', {
  cfg: { fn: 'sum', bucket: 'shift', period: 'lastShift', shiftCount: 4, shiftStart: '22:00' },
  now: NOW,
  tz: '+07:00',
  tagIds: ['PUMP1.RUN'],
  signals: { 'PUMP1.RUN': { gen: SIG.run, from: NOW - 2 * DAY_MS, step: MIN_MS } },
  hand: (r) => assert.equal(r.categories.length, 1),
});
bar(
  'shift-yesterday-0530',
  'Hôm qua theo +05:30, 3 ca từ 06:00: ranh giới ca lệch 30 phút so với UTC.',
  {
    cfg: { fn: 'avg', bucket: 'shift', period: 'yesterday', shiftCount: 3, shiftStart: '06:00' },
    now: Date.UTC(2026, 9, 13, 7, 15),
    tz: '+05:30',
    tagIds: ['METER1.KW'],
    signals: { 'METER1.KW': { gen: SIG.kw, from: UTC(2026, 10, 10), step: 5 * MIN_MS } },
  },
);
bar(
  'multi-series',
  'Hai Tag: điện năng và giờ chạy cùng cửa sổ; nhãn thuộc tính labels đặt cho từng Tag.',
  {
    cfg: { fn: 'delta', bucket: 'day', period: 'last7d' },
    now: NOW,
    tz: '+07:00',
    tagIds: ['METER1.KWH', 'PUMP1.RUN'],
    labels: ['Điện năng', 'Bơm 1'],
    signals: {
      'METER1.KWH': { gen: SIG.kwh(0), from: NOW - 9 * DAY_MS, step: 15 * MIN_MS },
      'PUMP1.RUN': { gen: SIG.run, from: NOW - 9 * DAY_MS, step: 15 * MIN_MS },
    },
  },
);
bar('with-hole', 'Tag không có dữ liệu ở vài ngày: giá trị null giữa chừng.', {
  cfg: { fn: 'avg', bucket: 'day', period: 'last7d' },
  now: NOW,
  tz: '+07:00',
  tagIds: ['METER1.KW'],
  signals: {
    'METER1.KW': {
      gen: (t) => (t > NOW - 5 * DAY_MS && t < NOW - 3 * DAY_MS ? null : SIG.kw(t)),
      from: NOW - 9 * DAY_MS,
      step: 15 * MIN_MS,
    },
  },
});

// ---------------------------------------------------------------------------------------------
// Biểu đồ tròn
let nPie = 0;
function pie(name, description, { cfg, now, tz, tagIds, labels, signals, hand }) {
  const tzMs = tzOffsetMs(tz);
  const req = pieRequest(cfg, now, tzMs);
  const aggregate = aggregateOf(tagIds, signals, req.from, 1, req.bucketMs, now);
  const fn = cfg.fn ?? 'delta';
  const values = aggregate.series.map((s) => ({
    tagId: s.tagId,
    value: evalFn(fn, bucketAt(s, 0)),
  }));
  const model = pieSlices(values, labels ?? []);
  if (hand) hand(model, req);
  out(`pie-${name}`, {
    name,
    description,
    kind: 'pie',
    cfg,
    now,
    tz,
    tagIds,
    labels: labels ?? [],
    aggregate,
    expect: { request: req, values, ...model },
  });
  nPie++;
}
const dayFrom = UTC(2026, 10, 12, 17);
const pieSig = (extra = {}) => ({
  'M1.KWH': { gen: SIG.kwh(0), from: dayFrom, step: 15 * MIN_MS },
  'M2.KWH': {
    gen: (t) => r3(500 + ((t - dayFrom) / HOUR_MS) * 30),
    from: dayFrom,
    step: 15 * MIN_MS,
  },
  'M3.KWH': {
    gen: (t) => r3(200 + ((t - dayFrom) / HOUR_MS) * 10),
    from: dayFrom,
    step: 15 * MIN_MS,
  },
  ...extra,
});
pie(
  'today-three',
  'Điện năng hôm nay của ba đồng hồ (delta): phần trăm theo tổng, nhãn theo labels.',
  {
    cfg: { fn: 'delta', period: 'today' },
    now: NOW,
    tz: '+07:00',
    tagIds: ['M1.KWH', 'M2.KWH', 'M3.KWH'],
    labels: ['Dây chuyền 1', 'Dây chuyền 2', 'Dây chuyền 3'],
    signals: pieSig(),
    hand: (m) => {
      assert.equal(m.slices.length, 3);
      near(
        m.slices.reduce((s, x) => s + x.percent, 0),
        100,
      );
    },
  },
);
pie(
  'missing-tag',
  'Một Tag không có dữ liệu trong kỳ: bị loại (excluded missing), phần trăm theo tổng còn lại.',
  {
    cfg: { fn: 'delta', period: 'today' },
    now: NOW,
    tz: '+07:00',
    tagIds: ['M1.KWH', 'M2.KWH', 'M3.KWH'],
    signals: pieSig({ 'M2.KWH': { gen: SIG.kw, dead: true } }),
    hand: (m) => assert.deepEqual(m.excluded, [{ tagId: 'M2.KWH', reason: 'missing' }]),
  },
);
pie('negative-delta', 'Bộ đếm về 0 giữa kỳ làm delta âm: loại (excluded negative).', {
  cfg: { fn: 'delta', period: 'today' },
  now: NOW,
  tz: '+07:00',
  tagIds: ['M1.KWH', 'M3.KWH'],
  signals: pieSig({
    'M3.KWH': {
      gen: (t) => (t < dayFrom + 5 * HOUR_MS ? 900 : 10),
      from: dayFrom,
      step: 15 * MIN_MS,
    },
  }),
  hand: (m) =>
    assert.deepEqual(
      m.excluded.map((x) => x.reason),
      ['negative'],
    ),
});
pie('total-zero', 'Mọi Tag đứng yên (delta 0): tổng 0, không có phần nào.', {
  cfg: { fn: 'delta', period: 'today' },
  now: NOW,
  tz: '+07:00',
  tagIds: ['M1.KWH', 'M2.KWH'],
  signals: {
    'M1.KWH': { gen: () => 5, from: dayFrom, step: 15 * MIN_MS },
    'M2.KWH': { gen: () => 7, from: dayFrom, step: 15 * MIN_MS },
  },
  hand: (m) => assert.equal(m.slices.length, 0),
});
pie(
  'sum-lastmonth',
  'Giờ chạy (sum) tháng trước của hai bơm; kỳ dài 30 ngày, bucketMs = độ dài kỳ.',
  {
    cfg: { fn: 'sum', period: 'lastMonth' },
    now: NOW,
    tz: '+07:00',
    tagIds: ['PUMP1.RUN', 'PUMP2.RUN'],
    signals: {
      'PUMP1.RUN': { gen: SIG.run, from: UTC(2026, 7, 31, 17), step: 15 * MIN_MS },
      'PUMP2.RUN': {
        gen: (t) => (Math.floor(t / HOUR_MS) % 3 === 0 ? 1 : 0),
        from: UTC(2026, 7, 31, 17),
        step: 15 * MIN_MS,
      },
    },
    hand: (m, r) => assert.equal(r.bucketMs, 30 * DAY_MS),
  },
);
pie('avg-thisshift', 'Công suất trung bình ca đang chạy (06:00-14:00, 3 ca) của hai tải.', {
  cfg: { fn: 'avg', period: 'thisShift', shiftCount: 3, shiftStart: '06:00' },
  now: NOW,
  tz: '+07:00',
  tagIds: ['L1.KW', 'L2.KW'],
  labels: ['Tải 1'],
  signals: {
    'L1.KW': { gen: SIG.kw, from: NOW - DAY_MS, step: MIN_MS },
    'L2.KW': { gen: (t) => r3(SIG.kw(t) / 2), from: NOW - DAY_MS, step: MIN_MS },
  },
  hand: (m) => assert.equal(m.slices[1].label, 'L2.KW'),
});
pie('yesterday-0530', 'Hôm qua theo +05:30: offsetMs khác 0 so với độ dài kỳ.', {
  cfg: { fn: 'delta', period: 'yesterday' },
  now: Date.UTC(2026, 9, 13, 7, 15),
  tz: '+05:30',
  tagIds: ['M1.KWH', 'M2.KWH'],
  signals: {
    'M1.KWH': { gen: SIG.kwh(0), from: UTC(2026, 10, 10), step: 15 * MIN_MS },
    'M2.KWH': {
      gen: (t) => r3(((t - 1) / HOUR_MS) * 3),
      from: UTC(2026, 10, 10),
      step: 15 * MIN_MS,
    },
  },
});
pie('single-tag', 'Một Tag: một phần 100 %.', {
  cfg: { fn: 'delta', period: 'last24h' },
  now: NOW,
  tz: '+07:00',
  tagIds: ['M1.KWH'],
  signals: { 'M1.KWH': { gen: SIG.kwh(0), from: NOW - 2 * DAY_MS, step: 15 * MIN_MS } },
  hand: (m) => near(m.slices[0].percent, 100),
});

console.log(`${nReport} báo cáo, ${nPeriod} kỳ, ${nBar} cột, ${nPie} tròn trong ${here}`);
