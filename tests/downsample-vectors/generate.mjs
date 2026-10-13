// Sinh bộ vector giảm điểm dùng chung TS ↔ C++ (feature 010, T051). Chạy lại khi đổi luật:
//   node tests/downsample-vectors/generate.mjs
// `expect` sinh bằng tools/history-ref/downsample.mjs (độc lập); các ca có `hand` còn được kiểm với số tính tay.
// Định dạng: README.md cùng thư mục.
import assert from 'node:assert/strict';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decimate, lttb, mergeBuckets, minmax } from '../../tools/history-ref/downsample.mjs';

const here = dirname(fileURLToPath(import.meta.url));
for (const f of readdirSync(here))
  if (/^(minmax|lttb|decimate|merge)-.*\.json$/.test(f)) rmSync(join(here, f));

const MIN = 60000;
const HOUR = 3600000;

/** Số giả ngẫu nhiên tất định (LCG), để dữ liệu có nhiễu mà vẫn cố định. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const round = (x) => Math.round(x * 1e6) / 1e6;
const series = (n, step, f, t0 = 0) => Array.from({ length: n }, (_, i) => [t0 + i * step, f(i)]);

const line = (rows) => `[${rows.map((r) => JSON.stringify(r)).join(',')}]`;
const cols = (pts) => ({ t: pts.map((p) => p[0]), v: pts.map((p) => p[1]) });
const arr = (a) => `[${a.map((x) => JSON.stringify(x)).join(',')}]`;

function write(v) {
  const head = `  "name": ${JSON.stringify(v.name)},\n  "description": ${JSON.stringify(v.description)},\n  "kind": "${v.kind}",\n`;
  const params = ['from', 'to', 'maxPoints', 'res']
    .filter((k) => v[k] !== undefined)
    .map((k) => `  "${k}": ${v[k]},\n`)
    .join('');
  let input;
  if (v.rows) input = `  "rows": ${line(v.rows)},\n`;
  else if (v.points) input = `  "points": ${line(v.points)},\n`;
  else
    input = `  "buckets": [\n${v.buckets.map((b) => '    ' + JSON.stringify(b)).join(',\n')}\n  ],\n`;
  const e = v.expect;
  const expect = Object.keys(e)
    .map((k) => `    "${k}": ${arr(e[k])}`)
    .join(',\n');
  writeFileSync(
    join(here, `${v.kind}-${v.name}.json`),
    `{\n${head}${params}${input}  "expect": {\n${expect}\n  }\n}\n`,
  );
}

let count = 0;
const emit = (v) => {
  write(v);
  count++;
};

// ---------------------------------------------------------------------------------------------
// minmax
const mm = (name, description, rows, from, to, maxPoints, hand) => {
  const out = minmax(rows, from, to, maxPoints);
  assert.ok(out.length <= maxPoints, `${name}: vượt maxPoints`);
  if (hand) assert.deepEqual(out, hand, `${name}: khác số tính tay`);
  emit({ kind: 'minmax', name, description, from, to, maxPoints, rows, expect: cols(out) });
};

mm(
  'hand-2-windows',
  'Tám dòng, maxPoints 6: W = 2 cửa sổ [0,4000) và [4000,8000); mỗi cửa sổ giữ dòng nhỏ nhất và lớn nhất, cộng dòng đầu và cuối (số tính tay).',
  [
    [0, 5],
    [1000, 1],
    [2000, 9],
    [3000, 4],
    [4000, 7],
    [5000, 2],
    [6000, 8],
    [7000, 3],
  ],
  0,
  8000,
  6,
  [
    [0, 5],
    [1000, 1],
    [2000, 9],
    [5000, 2],
    [6000, 8],
    [7000, 3],
  ],
);
{
  const rows = series(1000, 1000, () => 10);
  rows[500][1] = 99;
  const out = minmax(rows, 0, 1000000, 20);
  assert.ok(
    out.some((p) => p[1] === 99),
    'gai đơn phải còn',
  );
  mm(
    'single-spike',
    'Một gai 99 giữa chuỗi hằng 10 (1.000 dòng, maxPoints 20): gai không bị mất.',
    rows,
    0,
    1000000,
    20,
  );
}
mm(
  'constant',
  'Chuỗi hằng: nhỏ nhất và lớn nhất cùng một dòng (dòng đầu của cửa sổ), mỗi cửa sổ một điểm.',
  series(200, 500, () => 7),
  0,
  100000,
  12,
);
mm(
  'ramp-100',
  'Dốc 0..99 (100 dòng), maxPoints 12: W = 5 cửa sổ; mỗi cửa sổ lấy dòng đầu và dòng cuối của cửa sổ.',
  series(100, 1000, (i) => i),
  0,
  100000,
  12,
);
{
  const r = rng(1);
  const rows = series(2000, 500, (i) => round(50 + 40 * Math.sin(i / 25) + 5 * (r() - 0.5)));
  mm('sine-noise-2000', 'Sin có nhiễu, 2.000 dòng, maxPoints 100.', rows, 0, 1000000, 100);
}
mm(
  'exact-maxpoints',
  'Số dòng bằng đúng maxPoints: trả nguyên, không giảm.',
  series(10, 1000, (i) => i * i),
  0,
  10000,
  10,
);
mm(
  'fewer-rows',
  'Số dòng ít hơn maxPoints: trả nguyên.',
  series(5, 1000, (i) => 5 - i),
  0,
  10000,
  50,
);
mm(
  'with-null',
  'Dòng NULL: mỗi cửa sổ có NULL thêm một điểm null tại ts của NULL đầu tiên của cửa sổ.',
  series(60, 1000, (i) => (i % 10 === 4 || i % 10 === 5 ? null : i % 7)),
  0,
  60000,
  22,
);
mm(
  'null-over-budget',
  'NULL dày làm tổng vượt maxPoints: bỏ điểm null từ cửa sổ cuối lùi về đầu cho tới khi đủ (dòng đầu/cuối của khoảng được giữ).',
  series(40, 1000, (i) => (i % 2 === 0 ? i : null)),
  0,
  40000,
  14,
);
mm(
  'empty-windows',
  'Có khoảng dài không có dòng (cửa sổ rỗng không sinh điểm).',
  [...series(20, 1000, (i) => i % 5), ...series(20, 1000, (i) => 100 + (i % 5), 80000)],
  0,
  100000,
  16,
);
mm(
  'negative-values',
  'Giá trị âm và đổi dấu.',
  series(120, 1000, (i) => Math.round(30 * Math.cos(i / 6) - 10)),
  0,
  120000,
  20,
);
mm(
  'first-last-nonextreme',
  'Dòng đầu và cuối của khoảng luôn được giữ dù không phải cực trị.',
  [
    [0, 5],
    [1000, 9],
    [2000, 1],
    [3000, 9],
    [4000, 1],
    [5000, 9],
    [6000, 1],
    [7000, 4],
  ],
  0,
  8000,
  6,
);
mm(
  'min-maxpoints-10',
  'maxPoints nhỏ nhất (10): W = 4 cửa sổ.',
  series(300, 100, (i) => Math.round(20 * Math.sin(i / 10))),
  0,
  30000,
  10,
);
mm(
  'odd-maxpoints',
  'maxPoints lẻ (11): W = floor(9 / 2) = 4, tối đa 10 điểm.',
  series(300, 100, (i) => (i * 37) % 23),
  0,
  30000,
  11,
);
mm(
  'from-offset',
  'Khoảng bắt đầu khác 0 (from = 1.000.000): cửa sổ tính theo (t - from).',
  series(400, 250, (i) => (i * 13) % 29, 1000000),
  1000000,
  1100000,
  16,
);

// ---------------------------------------------------------------------------------------------
// lttb (chuỗi không có NULL; đoạn NULL do bản C++ cài theo history-api.md §3.2, chưa có vector)
const lt = (name, description, points, threshold) => {
  const out = lttb(points, threshold);
  assert.ok(out.length <= threshold || threshold >= points.length, `${name}: vượt ngưỡng`);
  assert.deepEqual(out[0], points[0]);
  assert.deepEqual(out.at(-1), points.at(-1));
  emit({ kind: 'lttb', name, description, maxPoints: threshold, points, expect: cols(out) });
};
lt(
  'line',
  'Đường thẳng 500 điểm, ngưỡng 20.',
  series(500, 1000, (i) => i * 2 + 1),
  20,
);
lt(
  'sine',
  'Sin 1.000 điểm, ngưỡng 40.',
  series(1000, 100, (i) => round(Math.sin(i / 30) * 100)),
  40,
);
lt(
  'step',
  'Bậc thang (hằng từng đoạn 100 điểm), ngưỡng 30.',
  series(1000, 100, (i) => Math.floor(i / 100) * 10),
  30,
);
lt(
  'threshold-ge-n',
  'Ngưỡng bằng số điểm: trả nguyên.',
  series(8, 1000, (i) => i % 3),
  8,
);
lt(
  'threshold-10-of-12',
  'Ngưỡng 10 trên 12 điểm (maxPoints tối thiểu của API là 10): giảm nhẹ.',
  series(12, 1000, (i) => (i * 5) % 7),
  10,
);

// ---------------------------------------------------------------------------------------------
// decimate
const de = (name, description, rows, from, to, maxPoints, hand) => {
  const out = decimate(rows, from, to, maxPoints);
  assert.ok(out.length <= maxPoints);
  if (hand) assert.deepEqual(out, hand, `${name}: khác số tính tay`);
  emit({ kind: 'decimate', name, description, from, to, maxPoints, rows, expect: cols(out) });
};
de(
  'hand-even',
  'Dòng đều mỗi 1.000 ms, 10 cửa sổ 2.000 ms: lấy dòng đầu tiên có t >= đầu cửa sổ (số tính tay).',
  series(20, 1000, (i) => i),
  0,
  20000,
  10,
  [
    [0, 0],
    [2000, 2],
    [4000, 4],
    [6000, 6],
    [8000, 8],
    [10000, 10],
    [12000, 12],
    [14000, 14],
    [16000, 16],
    [18000, 18],
  ],
);
de(
  'hand-with-hole',
  'Có lỗ 6.000-14.000 ms: cửa sổ không có dòng (dòng kế đã vượt cuối cửa sổ) không sinh điểm.',
  [...series(6, 1000, (i) => i), ...series(6, 1000, (i) => 50 + i, 14000)],
  0,
  20000,
  10,
  [
    [0, 0],
    [2000, 2],
    [4000, 4],
    [14000, 50],
    [16000, 52],
    [18000, 54],
  ],
);
de(
  'fewer-rows',
  'Ít dòng hơn số cửa sổ: nhiều cửa sổ rỗng.',
  series(5, 7000, (i) => i * 3),
  0,
  40000,
  20,
);
de(
  'null-row',
  'Dòng được chọn là NULL thì thành điểm null.',
  series(20, 1000, (i) => (i % 4 === 0 ? null : i)),
  0,
  20000,
  5,
);
de(
  'range-offset',
  'Khoảng không bắt đầu ở 0 và độ dài không chia hết cho số cửa sổ (biên cửa sổ làm tròn xuống).',
  series(500, 130, (i) => (i * 7) % 11, 777),
  777,
  66000,
  30,
);
de(
  'dense',
  'Dòng dày mỗi 10 ms, 1.000 cửa sổ (maxPoints tối đa 5.000 trong API; ở đây 1.000).',
  series(20000, 10, (i) => i % 100),
  0,
  200000,
  1000,
);

// ---------------------------------------------------------------------------------------------
// merge (ghép bucket nguồn tổng hợp)
const B = (bucket, n, min, max, first, last, sumw, wms) => ({
  bucket,
  n,
  min,
  max,
  first,
  last,
  sumw,
  wms,
});
const mg = (name, description, buckets, from, to, res, maxPoints, hand) => {
  const out = mergeBuckets(buckets, from, to, res, maxPoints);
  assert.ok(out.t.length <= maxPoints);
  if (hand) assert.deepEqual(out, hand, `${name}: khác số tính tay`);
  emit({ kind: 'merge', name, description, from, to, res, maxPoints, buckets, expect: out });
};
mg(
  'hand-identity',
  'Ít ô hơn maxPoints: mỗi hàng một điểm, v = sumw / wms, min, max của hàng (số tính tay).',
  [
    B(0, 2, 1, 5, 1, 5, 180000, 60000),
    B(60000, 1, 4, 4, 4, 4, 240000, 60000),
    B(180000, 1, 2, 9, 2, 9, 300000, 60000),
  ],
  0,
  240000,
  MIN,
  10,
  { t: [0, 60000, 180000], v: [3, 4, 5], min: [1, 4, 2], max: [5, 4, 9] },
);
mg(
  'hand-pairs',
  '6 ô phút, maxPoints 3: nhóm 2 ô; điểm tại đầu nhóm; v = sumw / wms của hàng ghép (số tính tay).',
  [
    B(0, 1, 2, 2, 2, 2, 120000, 60000),
    B(60000, 1, 4, 4, 4, 4, 240000, 60000),
    B(120000, 1, 6, 6, 6, 6, 360000, 60000),
    B(180000, 1, 8, 8, 8, 8, 480000, 60000),
    B(240000, 1, 1, 1, 1, 1, 60000, 60000),
    B(300000, 1, 3, 3, 3, 3, 180000, 60000),
  ],
  0,
  360000,
  MIN,
  3,
  { t: [0, 120000, 240000], v: [3, 7, 2], min: [2, 6, 1], max: [4, 8, 3] },
);
mg(
  'with-hole',
  'Ô rỗng giữa chừng: nhóm không có hàng không sinh điểm, nhóm có một hàng giữ nguyên.',
  [
    B(0, 1, 2, 2, 2, 2, 120000, 60000),
    B(60000, 1, 4, 4, 4, 4, 240000, 60000),
    B(360000, 1, 9, 9, 9, 9, 540000, 60000),
    B(420000, 1, 7, 7, 7, 7, 420000, 60000),
  ],
  0,
  480000,
  MIN,
  4,
);
{
  const r = rng(7);
  const rows = Array.from({ length: 1440 }, (_, i) => {
    const v = 20 + 10 * Math.sin(i / 90) + r() * 2;
    return B(
      i * MIN,
      60,
      round(v - 1),
      round(v + 1),
      round(v - 0.5),
      round(v + 0.5),
      round(v * 60000),
      60000,
    );
  });
  mg(
    'day-minutes-to-100',
    '1.440 bucket phút (một ngày) ghép thành 100 điểm.',
    rows,
    0,
    86400000,
    MIN,
    100,
  );
}
mg(
  'hours-week-to-50',
  '168 bucket giờ (7 ngày) ghép thành 50 điểm: nhóm 4 ô.',
  Array.from({ length: 168 }, (_, i) =>
    B(
      i * HOUR,
      3600,
      i % 24,
      (i % 24) + 5,
      (i % 24) + 1,
      (i % 24) + 2,
      ((i % 24) + 2.5) * HOUR,
      HOUR,
    ),
  ),
  0,
  168 * HOUR,
  HOUR,
  50,
);
mg(
  'from-unaligned',
  'from không thẳng hàng với bucket: ô đầu là ô chứa from; điểm đầu nhóm có thể sớm hơn from.',
  Array.from({ length: 30 }, (_, i) =>
    B(3 * HOUR + i * MIN, 1, i, i + 1, i, i + 1, (i + 0.5) * 60000, 60000),
  ),
  3 * HOUR + 20000,
  3 * HOUR + 30 * MIN,
  MIN,
  7,
);
mg(
  'single-group',
  'maxPoints rất nhỏ so với số ô: một nhóm duy nhất khi g lớn.',
  Array.from({ length: 10 }, (_, i) => B(i * MIN, 1, i, i, i, i, i * 60000, 60000)),
  0,
  10 * MIN,
  MIN,
  10,
);
mg(
  'wms-zero-bucket',
  'Bucket có dòng nhưng wms = 0: avg = last.',
  [B(0, 1, 7, 7, 7, 7, 0, 0), B(MIN, 1, 3, 3, 3, 3, 180000, 60000)],
  0,
  2 * MIN,
  MIN,
  10,
  { t: [0, 60000], v: [7, 3], min: [7, 3], max: [7, 3] },
);

console.log(`${count} vector giảm điểm trong ${here}`);
