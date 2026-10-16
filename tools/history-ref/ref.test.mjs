// Test của bản tham chiếu độc lập (feature 010, T006): ca tính tay, không dùng mã sản phẩm.
// Chạy: node --test tools/history-ref/*.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aggregateStore,
  avg,
  coverage,
  delta,
  formatVi,
  localMidnight,
  mergeBuckets,
  reportPeriod,
  reportTable,
  sum,
  tzOffsetMs,
  windowsFromMinutes,
} from './ref.mjs';

const near = (a, b) =>
  assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const minutes = (events, col = 'A') => aggregateStore(events, col)[60000];

test('hold-across-bucket: tín hiệu giữ qua ranh giới phút', () => {
  const rows = minutes([
    { t: 0, op: 'break' },
    { t: 1000, op: 'row', values: { A: 10 } },
    { t: 70000, op: 'row', values: { A: 20 } },
    { t: 130000, op: 'advance' },
  ]);
  assert.deepEqual(rows, [
    { bucket: 0, n: 1, min: 10, max: 10, first: 10, last: 10, sumw: 590000, wms: 59000 },
    // 10 giữ 10 s (mang từ phút 0), rồi 20 giữ 50 s: sumw = 10*10000 + 20*50000
    { bucket: 60000, n: 1, min: 10, max: 20, first: 10, last: 20, sumw: 1100000, wms: 60000 },
  ]);
});

test('NULL giữa cửa sổ làm mất tín hiệu, wms chỉ tính đoạn có giá trị', () => {
  const rows = minutes([
    { t: 0, op: 'break' },
    { t: 10000, op: 'row', values: { A: 5 } },
    { t: 30000, op: 'row', values: { A: null } },
    { t: 50000, op: 'row', values: { A: 7 } },
    { t: 120000, op: 'advance' },
  ]);
  assert.deepEqual(rows, [
    { bucket: 0, n: 2, min: 5, max: 7, first: 5, last: 7, sumw: 170000, wms: 30000 },
    { bucket: 60000, n: 0, min: 7, max: 7, first: 7, last: 7, sumw: 420000, wms: 60000 },
  ]);
});

test('bộ đếm tăng: delta từng cửa sổ cộng đúng qua ranh giới (first mang từ cửa sổ trước)', () => {
  const rows = minutes(
    [
      { t: 0, op: 'break' },
      { t: 0, op: 'row', values: { A: 100 } },
      { t: 30000, op: 'row', values: { A: 130 } },
      { t: 60000, op: 'row', values: { A: 160 } },
      { t: 90000, op: 'row', values: { A: 190 } },
      { t: 120000, op: 'advance' },
    ],
    'A',
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    bucket: 0,
    n: 2,
    min: 100,
    max: 130,
    first: 100,
    last: 130,
    sumw: 6900000,
    wms: 60000,
  });
  assert.deepEqual(rows[1], {
    bucket: 60000,
    n: 2,
    min: 160,
    max: 190,
    first: 130,
    last: 190,
    sumw: 10500000,
    wms: 60000,
  });
  assert.equal(delta(rows[0]) + delta(rows[1]), 190 - 100);
});

test('break giữa phút ghi nửa cửa sổ, lần chạy sau ghép vào cùng hàng (upsert)', () => {
  const rows = minutes([
    { t: 0, op: 'break' },
    { t: 10000, op: 'row', values: { A: 4 } },
    { t: 30000, op: 'break' },
    { t: 40000, op: 'row', values: { A: 6 } },
    { t: 120000, op: 'advance' },
  ]);
  assert.deepEqual(rows, [
    { bucket: 0, n: 2, min: 4, max: 6, first: 4, last: 6, sumw: 200000, wms: 40000 },
    { bucket: 60000, n: 0, min: 6, max: 6, first: 6, last: 6, sumw: 360000, wms: 60000 },
  ]);
});

test('cửa sổ chỉ có tín hiệu mang và cửa sổ rỗng', () => {
  const rows = minutes([
    { t: 0, op: 'break' },
    { t: 5000, op: 'row', values: { A: 3 } },
    { t: 5000 + 3 * 60000, op: 'row', values: { A: null } },
    { t: 10 * 60000, op: 'advance' },
  ]);
  // phút 0: n=1; phút 1, 2: chỉ mang; phút 3: mang 5 s rồi NULL; phút 4 trở đi: rỗng
  assert.deepEqual(
    rows.map((r) => [r.bucket / 60000, r.n, r.wms]),
    [
      [0, 1, 55000],
      [1, 0, 60000],
      [2, 0, 60000],
      [3, 0, 5000],
    ],
  );
});

test('giờ ghép từ phút: hàng giờ chỉ có khi giờ đã đóng', () => {
  const ev = [
    { t: 0, op: 'break' },
    { t: 0, op: 'row', values: { A: 2 } },
    { t: 1800000, op: 'row', values: { A: 4 } },
    { t: 3600000, op: 'advance' },
  ];
  const s = aggregateStore(ev, 'A');
  assert.equal(s[60000].length, 60);
  assert.deepEqual(s[3600000], [
    {
      bucket: 0,
      n: 2,
      min: 2,
      max: 4,
      first: 2,
      last: 4,
      sumw: 2 * 1800000 + 4 * 1800000,
      wms: 3600000,
    },
  ]);
  const open = aggregateStore(ev.slice(0, 3).concat({ t: 3599999, op: 'advance' }), 'A');
  assert.equal(open[3600000].length, 0);
});

test('merge, đại lượng suy ra', () => {
  const a = { n: 2, min: 1, max: 5, first: 1, last: 5, sumw: 6000, wms: 2000 };
  const b = { n: 1, min: 0, max: 9, first: 5, last: 9, sumw: 3000, wms: 1000 };
  assert.deepEqual(mergeBuckets(a, b), {
    n: 3,
    min: 0,
    max: 9,
    first: 1,
    last: 9,
    sumw: 9000,
    wms: 3000,
  });
  assert.deepEqual(mergeBuckets(null, b), b);
  assert.equal(mergeBuckets(null, null), null);
  assert.equal(avg(a), 3);
  assert.equal(avg({ ...a, wms: 0, sumw: 0 }), 5); // wms = 0: avg = last
  near(sum({ ...a, sumw: 7200000 }), 2);
  assert.equal(delta(b), 4);
  assert.equal(coverage(a, 4000), 0.5);
});

test('windowsFromMinutes: cửa sổ rỗng là null', () => {
  const rows = minutes([
    { t: 0, op: 'break' },
    { t: 0, op: 'row', values: { A: 1 } },
    { t: 60000, op: 'row', values: { A: null } },
    { t: 300000, op: 'row', values: { A: 2 } },
    { t: 420000, op: 'advance' },
  ]);
  const w = windowsFromMinutes(rows, 0, 120000, 3);
  assert.equal(w[0].wms, 60000);
  assert.equal(w[1], null);
  assert.equal(w[2].n, 1);
});

test('kỳ báo cáo: ca qua nửa đêm, tháng 2 năm nhuận, múi +05:30', () => {
  const tz = tzOffsetMs('+07:00');
  const p = reportPeriod(
    { period: 'shift', shifts: { count: 3, start: '06:00' } },
    { d: '2026-10-12' },
    tz,
  );
  assert.equal(p.from, Date.UTC(2026, 9, 11, 23, 0, 0));
  assert.equal(p.to - p.from, 86400000);
  assert.deepEqual(
    p.rows.map((r) => r.label),
    ['Ca 1 06:00–14:00', 'Ca 2 14:00–22:00', 'Ca 3 22:00–06:00'],
  );
  assert.equal(p.offsetMs, 7 * 3600000); // 23:00 UTC mod 8 giờ
  const feb = reportPeriod({ period: 'month' }, { m: '2028-02' }, tz);
  assert.equal(feb.rows.length, 29);
  assert.equal(feb.rows[28].label, '29/02');
  const ist = reportPeriod(
    { period: 'day', rowMinutes: 30 },
    { d: '2026-10-12' },
    tzOffsetMs('+05:30'),
  );
  assert.equal(ist.from, Date.UTC(2026, 9, 11, 18, 30, 0));
  assert.equal(ist.rows.length, 48);
  assert.equal(ist.offsetMs, (18.5 * 3600000) % 1800000);
  assert.equal(ist.rows[0].label, '12/10 00:00–00:30');
  assert.equal(localMidnight(2026, 10, 12, tz), Date.UTC(2026, 9, 11, 17, 0, 0));
});

test('formatVi: nghìn chấm, thập phân phẩy', () => {
  assert.equal(formatVi(1277.7, 1), '1.277,7');
  assert.equal(formatVi(-0.04, 1), '0,0');
  assert.equal(formatVi(1234567.891, 2), '1.234.567,89');
  assert.equal(formatVi(5, 0), '5');
  assert.equal(formatVi(null, 2), '');
});

test('reportTable: hàng chưa tới, dòng tổng ghép, thiếu dữ liệu', () => {
  const tpl = {
    period: 'shift',
    shifts: { count: 2, start: '00:00' },
    columns: [{ tagId: 'K', label: 'Điện', unit: 'kWh', decimals: 1, functions: ['delta', 'max'] }],
  };
  const tz = tzOffsetMs('+00:00');
  const period = reportPeriod(tpl, { d: '2026-01-02' }, tz);
  const half = period.bucketMs;
  const b0 = { n: 4, min: 10, max: 30, first: 10, last: 30, sumw: 1, wms: half };
  const b1 = { n: 4, min: 30, max: 70, first: 30, last: 70, sumw: 1, wms: half / 2 };
  const table = reportTable(tpl, period, { K: [b0, b1] }, period.from + half + 1000);
  assert.deepEqual(table.rows[0].cells, [20, 30]);
  assert.equal(table.rows[1].coverage, 0.5);
  assert.deepEqual(table.totals, [60, 70]); // delta ghép = 70 - 10
  near(table.coverage, (half + half / 2) / (1 * 2 * half));
  const future = reportTable(tpl, period, { K: [b0, null] }, period.from + 1000);
  assert.equal(future.rows[1].pending, true);
  assert.deepEqual(future.rows[1].cells, [null, null]);
  assert.deepEqual(future.totals, [20, 30]);
  assert.equal(future.coverage, 1 - 0); // chỉ hàng đã tới tính
});
