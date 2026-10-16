// Test của bản tham chiếu kỳ widget (feature 010, T108): ca tính tay theo contracts/widget-catalog-010.md §2.2.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tzOffsetMs } from './ref.mjs';
import { barRequest, periodRangeRef, pieRequest, pieSlices } from './widget-ref.mjs';

const tz = tzOffsetMs('+07:00');
const now = Date.UTC(2026, 9, 13, 3, 30, 45, 678); // 10:30:45 ngày 13/10 giờ Việt Nam
const iso = (r) => r.map((x) => new Date(x).toISOString());

test('periodRange: các kỳ, làm tròn xuống phút, múi +07:00', () => {
  assert.deepEqual(iso(periodRangeRef('last24h', now, tz)), [
    '2026-10-12T03:30:00.000Z',
    '2026-10-13T03:30:00.000Z',
  ]);
  assert.deepEqual(iso(periodRangeRef('today', now, tz)), [
    '2026-10-12T17:00:00.000Z',
    '2026-10-13T03:30:00.000Z',
  ]);
  assert.deepEqual(iso(periodRangeRef('yesterday', now, tz)), [
    '2026-10-11T17:00:00.000Z',
    '2026-10-12T17:00:00.000Z',
  ]);
  assert.deepEqual(iso(periodRangeRef('thisMonth', now, tz)), [
    '2026-09-30T17:00:00.000Z',
    '2026-10-31T17:00:00.000Z',
  ]);
  assert.deepEqual(iso(periodRangeRef('lastMonth', now, tz)), [
    '2026-08-31T17:00:00.000Z',
    '2026-09-30T17:00:00.000Z',
  ]);
  // ca 3 x 8 giờ từ 06:00: 10:30 thuộc ca 1 (06:00-14:00)
  assert.deepEqual(iso(periodRangeRef('thisShift', now, tz, 3, '06:00')), [
    '2026-10-12T23:00:00.000Z',
    '2026-10-13T07:00:00.000Z',
  ]);
  assert.deepEqual(iso(periodRangeRef('lastShift', now, tz, 3, '06:00')), [
    '2026-10-12T15:00:00.000Z',
    '2026-10-12T23:00:00.000Z',
  ]);
});

test('periodRange: lastMonth qua năm, tháng nhuận, +05:30', () => {
  const ist = tzOffsetMs('+05:30');
  const jan = Date.UTC(2028, 0, 15, 12);
  assert.deepEqual(iso(periodRangeRef('lastMonth', jan, ist)), [
    '2027-11-30T18:30:00.000Z',
    '2027-12-31T18:30:00.000Z',
  ]);
  const mar = Date.UTC(2028, 2, 10, 12);
  const [a, b] = periodRangeRef('lastMonth', mar, ist);
  assert.equal((b - a) / 86400000, 29);
});

test('barRequest: ca 7 ngày, giờ 24 giờ, ngày tháng', () => {
  const b = barRequest(
    { bucket: 'shift', period: 'last7d', shiftCount: 3, shiftStart: '06:00' },
    now,
    tz,
  );
  assert.equal(b.offsetMs, 7 * 3600000); // 06:00 +07 = 23:00 UTC mod 8 giờ
  assert.equal(b.categories[0].label, '06/10 Ca 2');
  assert.equal(b.categories.at(-1).label, '13/10 Ca 1');
  assert.equal(b.categories.length, 21);
  const h = barRequest({ bucket: 'hour', period: 'last24h' }, now, tz);
  assert.equal(h.categories.length, 24);
  assert.equal(h.categories[0].label, '11:00');
  const d = barRequest({ bucket: 'day', period: 'thisMonth' }, now, tz);
  assert.equal(d.categories.length, 31);
  assert.equal(d.categories[0].label, '01/10');
  assert.equal(d.offsetMs, 17 * 3600000);
});

test('pieRequest và pieSlices', () => {
  const p = pieRequest({ period: 'today' }, now, tz);
  assert.equal(p.bucketMs, 10.5 * 3600000);
  assert.equal(p.offsetMs, p.from % p.bucketMs);
  const s = pieSlices(
    [
      { tagId: 'A', value: 30 },
      { tagId: 'B', value: null },
      { tagId: 'C', value: -2 },
      { tagId: 'D', value: 10 },
    ],
    ['Máy A'],
  );
  assert.equal(s.total, 40);
  assert.deepEqual(
    s.slices.map((x) => [x.label, x.percent]),
    [
      ['Máy A', 75],
      ['D', 25],
    ],
  );
  assert.deepEqual(
    s.excluded.map((x) => x.reason),
    ['missing', 'negative'],
  );
  assert.deepEqual(pieSlices([{ tagId: 'A', value: 0 }]).slices, []);
});
