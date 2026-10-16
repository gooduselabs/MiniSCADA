// Sinh bộ vector tổng hợp dùng chung TS ↔ C++ (feature 010, T013, T036). Chạy lại khi đổi luật:
//   node tests/agg-vectors/generate.mjs
// `merge-*`, `derive-*`: số tính tay (chú thích từng ca). `agg-*`: `expect` sinh bằng tools/history-ref
// (thuật toán độc lập); mười ca đánh dấu "hand" còn được kiểm với số tính tay ngay khi sinh.
// Định dạng: README.md cùng thư mục.
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateStore } from '../../tools/history-ref/ref.mjs';

const here = dirname(fileURLToPath(import.meta.url));
for (const f of readdirSync(here))
  if (/^(merge|derive|agg)-.*\.json$/.test(f)) rmSync(join(here, f));
void resolve;

const M = 60_000;
const H = 3_600_000;

const bucketLine = (b) => JSON.stringify(b);
/** JSON dễ đọc: mỗi sự kiện và mỗi bucket một dòng. */
function format(v) {
  const events = v.events.map((e) => '    ' + JSON.stringify(e)).join(',\n');
  const expect = Object.entries(v.expect)
    .map(([col, res]) => {
      const inner = Object.entries(res)
        .map(
          ([r, list]) =>
            `      "${r}": [${list.length ? '\n' + list.map((b) => '        ' + bucketLine(b)).join(',\n') + '\n      ' : ''}]`,
        )
        .join(',\n');
      return `    ${JSON.stringify(col)}: {\n${inner}\n    }`;
    })
    .join(',\n');
  const head = ['name', 'description', 'note']
    .filter((k) => v[k] !== undefined)
    .map((k) => `  "${k}": ${JSON.stringify(v[k])},`)
    .join('\n');
  return `{\n${head}\n  "tags": ${JSON.stringify(v.tags)},\n  "events": [\n${events}\n  ],\n  "expect": {\n${expect}\n  }\n}\n`;
}

// ---------------------------------------------------------------------------------------------
// merge-*, derive-*: tính tay.

const B = (n, min, max, first, last, sumw, wms) => ({ n, min, max, first, last, sumw, wms });
const out = (name, v) =>
  writeFileSync(join(here, name + '.json'), JSON.stringify(v, null, 2) + '\n');

const mergeCase = (name, description, inputs, expect) =>
  out(`merge-${name}`, { name, description, kind: 'merge', inputs, expect });

// Gấp trái: acc = merge(acc, input[i]); null là bucket rỗng (phần tử đơn vị).
mergeCase(
  'two-adjacent',
  'Hai cửa sổ liền kề: n và sumw, wms cộng; min, max lấy cực trị; first của A, last của B.',
  [B(2, 1, 5, 1, 5, 6000, 2000), B(1, 0, 9, 5, 9, 3000, 1000)],
  B(3, 0, 9, 1, 9, 9000, 3000),
);
mergeCase(
  'three-windows',
  'Ba cửa sổ: first của cửa sổ đầu, last của cửa sổ cuối; sumw 100+200+300, wms 10+20+30.',
  [B(1, 2, 2, 2, 2, 100, 10), B(2, 1, 8, 2, 8, 200, 20), B(1, 3, 3, 8, 3, 300, 30)],
  B(4, 1, 8, 2, 3, 600, 60),
);
mergeCase(
  'empty-first',
  'Hàng rỗng đứng trước là phần tử đơn vị: kết quả bằng B (first của B).',
  [null, B(2, 4, 6, 4, 6, 1000, 200)],
  B(2, 4, 6, 4, 6, 1000, 200),
);
mergeCase(
  'empty-last',
  'Hàng rỗng đứng sau: kết quả bằng A (last của A).',
  [B(2, 4, 6, 4, 6, 1000, 200), null],
  B(2, 4, 6, 4, 6, 1000, 200),
);
mergeCase('all-empty', 'Toàn hàng rỗng: kết quả rỗng (null).', [null, null, null], null);
mergeCase(
  'gap-window',
  'Cửa sổ lỗ ở giữa (null): bỏ qua, ghép phần còn lại như hai cửa sổ liền kề.',
  [B(1, 3, 3, 3, 3, 90, 30), null, B(1, 7, 7, 7, 7, 70, 10)],
  B(2, 3, 7, 3, 7, 160, 40),
);
mergeCase(
  'single',
  'Một đầu vào: kết quả bằng chính nó.',
  [B(5, -2, 4, 0, 1, 12, 6)],
  B(5, -2, 4, 0, 1, 12, 6),
);
mergeCase(
  'zero-wms',
  'Cửa sổ có dòng nhưng chưa có đoạn giữ (wms = 0): vẫn tính n, min, max; sumw 0.',
  [B(1, 7, 7, 7, 7, 0, 0), B(2, 3, 9, 7, 9, 600, 100)],
  B(3, 3, 9, 7, 9, 600, 100),
);
mergeCase(
  'negative-values',
  'Giá trị âm: min lấy giá trị âm nhỏ nhất, max lấy giá trị lớn nhất (tiến tới 0).',
  [B(2, -10, -3, -10, -3, -650, 100), B(1, -8, -1, -3, -1, -450, 100)],
  B(3, -10, -1, -10, -1, -1100, 200),
);
mergeCase(
  'second-has-extremes',
  'Cực trị nằm hết ở cửa sổ sau.',
  [B(1, 5, 5, 5, 5, 50, 10), B(1, 0, 100, 5, 100, 400, 4)],
  B(2, 0, 100, 5, 100, 450, 14),
);
mergeCase(
  'four-with-gaps',
  'Bốn cửa sổ có hai hàng rỗng xen kẽ; thứ tự ghép giữ nguyên (first của hàng đầu có dữ liệu).',
  [null, B(1, 1, 1, 1, 1, 10, 10), null, B(1, 2, 2, 2, 2, 40, 20)],
  B(2, 1, 2, 1, 2, 50, 30),
);

const deriveCase = (name, description, fn, bucket, expect, windowMs) =>
  out(`derive-${name}`, {
    name,
    description,
    kind: 'derive',
    fn,
    bucket,
    ...(windowMs === undefined ? {} : { windowMs }),
    expect,
  });

deriveCase(
  'avg-weighted',
  'avg = sumw / wms (theo thời gian).',
  'avg',
  B(3, 1, 9, 1, 9, 60, 20),
  3,
);
deriveCase(
  'avg-wms-zero',
  'wms = 0: avg = last (không chia cho 0).',
  'avg',
  B(1, 7, 7, 7, 7, 0, 0),
  7,
);
deriveCase('avg-empty', 'Bucket rỗng (null): không có avg.', 'avg', null, null);
deriveCase(
  'sum-kw-hour',
  'sum = sumw / 3.600.000: 100 kW giữ đúng một giờ = 100 kWh.',
  'sum',
  B(60, 100, 100, 100, 100, 360000000, 3600000),
  100,
);
deriveCase(
  'sum-bool-hours',
  'BOOL bật 30 phút (sumw = 1 × 1.800.000): 0,5 giờ chạy.',
  'sum',
  B(3, 0, 1, 0, 0, 1800000, 3600000),
  0.5,
);
deriveCase('sum-empty', 'Bucket rỗng: không có sum.', 'sum', null, null);
deriveCase(
  'delta-up',
  'delta = last − first, bộ đếm tăng.',
  'delta',
  B(4, 100, 190, 100, 190, 1, 1),
  90,
);
deriveCase(
  'delta-reset',
  'Bộ đếm về 0 giữa chừng: delta âm.',
  'delta',
  B(3, 0, 500, 500, 20, 1, 1),
  -480,
);
deriveCase('delta-zero', 'Một giá trị không đổi: delta 0.', 'delta', B(5, 4, 4, 4, 4, 240, 60), 0);
deriveCase('delta-empty', 'Bucket rỗng: không có delta.', 'delta', null, null);
deriveCase(
  'coverage-full',
  'coverage = wms / độ dài cửa sổ: phủ đủ.',
  'coverage',
  B(1, 1, 1, 1, 1, 60, 3600000),
  1,
  3600000,
);
deriveCase(
  'coverage-half',
  'wms = 1.800.000 trên cửa sổ 1 giờ: 0,5.',
  'coverage',
  B(1, 1, 1, 1, 1, 60, 1800000),
  0.5,
  3600000,
);
deriveCase('coverage-empty', 'Bucket rỗng: coverage 0.', 'coverage', null, 0, 60000);

// ---------------------------------------------------------------------------------------------
// agg-*: dãy sự kiện -> bucket (ref).

const cases = [];
const add = (name, description, cols, events, extra = {}) =>
  cases.push({ name, description, cols, events, ...extra });
const A1 = [{ col: 'A', type: 'FLOAT64' }];
const row = (t, v) => ({ t, op: 'row', values: { A: v } });
const brk = (t) => ({ t, op: 'break' });
const adv = (t) => ({ t, op: 'advance' });
const every = (t0, t1, step, f) => {
  const r = [];
  for (let t = t0; t < t1; t += step) r.push(row(t, f(t)));
  return r;
};

add(
  'hold-across-bucket',
  'Giá trị 10 giữ qua ranh giới phút; 20 đến ở giữa phút kế (số tính tay).',
  A1,
  [brk(0), row(1000, 10), row(70000, 20), adv(130000)],
  {
    hand: {
      A: {
        [M]: [
          { bucket: 0, ...B(1, 10, 10, 10, 10, 590000, 59000) },
          { bucket: 60000, ...B(1, 10, 20, 10, 20, 1100000, 60000) },
        ],
      },
    },
  },
);
add(
  'null-middle',
  'NULL giữa cửa sổ: tín hiệu mất 20 s; n không đếm dòng NULL; phút kế mang giá trị 7.',
  A1,
  [brk(0), row(10000, 5), row(30000, null), row(50000, 7), adv(120000)],
  {
    hand: {
      A: {
        [M]: [
          { bucket: 0, ...B(2, 5, 7, 5, 7, 170000, 30000) },
          { bucket: 60000, ...B(0, 7, 7, 7, 7, 420000, 60000) },
        ],
      },
    },
  },
);
add(
  'null-end-of-window',
  'NULL gần cuối cửa sổ: phần còn lại của cửa sổ và các cửa sổ sau không có tín hiệu.',
  A1,
  [brk(0), row(10000, 6), row(50000, null), adv(180000)],
  { hand: { A: { [M]: [{ bucket: 0, ...B(1, 6, 6, 6, 6, 240000, 40000) }] } } },
);
add(
  'null-start-of-window',
  'Dòng NULL đầu: giá trị đến sau, first là giá trị đầu tiên có tín hiệu.',
  A1,
  [brk(0), row(0, null), row(20000, 3), adv(60000)],
  { hand: { A: { [M]: [{ bucket: 0, ...B(1, 3, 3, 3, 3, 120000, 40000) }] } } },
);
add(
  'all-null',
  'Chỉ có dòng NULL: không có bucket nào.',
  A1,
  [brk(0), row(0, null), row(30000, null), adv(180000)],
  {
    hand: { A: { [M]: [], [H]: [] } },
  },
);
add('advance-only', 'Không có dòng nào: không có bucket.', A1, [brk(0), adv(300000)], {
  hand: { A: { [M]: [], [H]: [] } },
});
add(
  'counter-ramp',
  'Bộ đếm tăng 30 kWh mỗi 30 s; dòng đến đúng ranh giới phút: first của phút sau là giá trị mang (130), nên Σ delta = 190 - 100.',
  [{ col: 'A', type: 'FLOAT64' }],
  [brk(0), row(0, 100), row(30000, 130), row(60000, 160), row(90000, 190), adv(120000)],
  {
    hand: {
      A: {
        [M]: [
          { bucket: 0, ...B(2, 100, 130, 100, 130, 6900000, 60000) },
          { bucket: 60000, ...B(2, 160, 190, 130, 190, 10500000, 60000) },
        ],
      },
    },
  },
);
add(
  'break-halves',
  'Dừng giữa phút (break) rồi chạy lại trong cùng phút: hai nửa ghép bằng upsert, first giữ của nửa đầu.',
  A1,
  [brk(0), row(10000, 4), brk(30000), row(40000, 6), adv(120000)],
  {
    hand: {
      A: {
        [M]: [
          { bucket: 0, ...B(2, 4, 6, 4, 6, 200000, 40000) },
          { bucket: 60000, ...B(0, 6, 6, 6, 6, 360000, 60000) },
        ],
      },
    },
  },
);
add(
  'break-at-boundary',
  'break đúng đầu cửa sổ: cửa sổ rỗng không ghi; tín hiệu không mang qua break.',
  A1,
  [brk(0), row(10000, 8), brk(60000), row(90000, 9), adv(180000)],
  {
    hand: {
      A: {
        [M]: [
          { bucket: 0, ...B(1, 8, 8, 8, 8, 400000, 50000) },
          { bucket: 60000, ...B(1, 9, 9, 9, 9, 270000, 30000) },
          { bucket: 120000, ...B(0, 9, 9, 9, 9, 540000, 60000) },
        ],
      },
    },
  },
);
add(
  'three-restarts-one-minute',
  'Ba lần chạy trong cùng một phút (hai break): ba nửa ghép lần lượt.',
  A1,
  [brk(0), row(2000, 1), brk(10000), row(20000, 2), brk(30000), row(40000, 3), adv(60000)],
);
add(
  'zero-wms',
  'Dòng đến rồi break đúng cùng ms: n = 1, wms = 0 (avg suy ra = last).',
  A1,
  [brk(0), row(5000, 7), brk(5000), adv(120000)],
  { hand: { A: { [M]: [{ bucket: 0, ...B(1, 7, 7, 7, 7, 0, 0) }] } } },
);
add(
  'row-at-window-start',
  'Dòng đúng đầu cửa sổ, chưa có giá trị mang: first = giá trị dòng đó; phút kế chỉ mang tín hiệu.',
  A1,
  [brk(0), row(60000, 4), adv(180000)],
  {
    hand: {
      A: {
        [M]: [
          { bucket: 60000, ...B(1, 4, 4, 4, 4, 240000, 60000) },
          { bucket: 120000, ...B(0, 4, 4, 4, 4, 240000, 60000) },
        ],
      },
    },
  },
);
add(
  'row-at-boundary-with-carry',
  'Dòng đúng đầu cửa sổ khi đang giữ giá trị 5: first của cửa sổ = 5 (mang), min/max chỉ tính đoạn có trong cửa sổ.',
  A1,
  [brk(0), row(10000, 5), row(60000, 8), adv(120000)],
  {
    hand: {
      A: {
        [M]: [
          { bucket: 0, ...B(1, 5, 5, 5, 5, 250000, 50000) },
          { bucket: 60000, ...B(1, 8, 8, 5, 8, 480000, 60000) },
        ],
      },
    },
  },
);
add(
  'boundary-null-then-row',
  'NULL đúng đầu cửa sổ rồi giá trị đến sau: theo luật mang của history-db.md §3.3 first = giá trị đang giữ trước NULL (5). Ca ranh giới, ghi rõ để hai bản cùng cách hiểu.',
  A1,
  [brk(0), row(10000, 5), row(60000, null), row(80000, 9), adv(120000)],
);
add('close-exactly-at-advance', 'advance đúng cuối cửa sổ (60000) đóng cửa sổ 0.', A1, [
  brk(0),
  row(10000, 2),
  adv(60000),
]);
add('not-closed-before-end', 'advance 59999: cửa sổ 0 chưa đóng, không có bucket.', A1, [
  brk(0),
  row(10000, 2),
  adv(59999),
]);
add(
  'carry-only-windows',
  'Giữ giá trị 3 trong 4 phút không có dòng: các phút giữa chỉ có tín hiệu mang (n = 0, wms = 60000).',
  A1,
  [brk(0), row(5000, 3), row(5000 + 4 * M, null), adv(8 * M)],
);
add(
  'long-hold-no-rows',
  'Một dòng rồi im lặng 3 giờ: 180 cửa sổ phút mang tín hiệu, 2 cửa sổ giờ đã đóng.',
  A1,
  [brk(0), row(0, 12), adv(3 * H)],
);
add('even-rows-1s', 'Dòng đều mỗi 1 s trong 2 phút (giá trị tăng dần).', A1, [
  brk(0),
  ...every(0, 2 * M, 1000, (t) => t / 1000),
  adv(2 * M),
]);
add('even-rows-100ms', 'Dòng mỗi 100 ms trong 3 s (n lớn trong một cửa sổ).', A1, [
  brk(0),
  ...every(0, 3000, 100, (t) => 1 + (t % 700) / 100),
  adv(M),
]);
add('sparse-rows-20s', 'Dòng thưa mỗi 20 s qua 3 phút (giữa các dòng tín hiệu được giữ).', A1, [
  brk(0),
  ...every(0, 3 * M, 20000, (t) => (t / 20000) % 4),
  adv(3 * M),
]);
add('ramp-10s', 'Dốc tuyến tính mỗi 10 s trong 5 phút.', A1, [
  brk(0),
  ...every(0, 5 * M, 10000, (t) => t / 1000),
  adv(5 * M),
]);
add('midnight-utc', 'Qua nửa đêm UTC: giờ 23:00 đóng, ngày mới bắt đầu bucket 86400000.', A1, [
  brk(86400000 - 90000),
  row(86400000 - 90000, 1),
  row(86400000 + 30000, 2),
  adv(86400000 + 2 * H),
]);
add(
  'start-mid-window',
  'Runtime bắt đầu giữa phút: first là dòng thô đầu tiên (không có tín hiệu mang).',
  A1,
  [brk(0), row(2 * M + 37000, 11), adv(5 * M)],
);
add(
  'bool-on-off',
  'BOOL bật/tắt (0/1) qua nhiều phút.',
  [{ col: 'A', type: 'BOOL' }],
  [brk(0), row(0, 0), row(45000, 1), row(100000, 0), row(130000, 1), row(200000, 0), adv(4 * M)],
);
add(
  'bool-hour-15min',
  'BOOL chạy 15 phút trong một giờ: sumw giờ = 900000, sum = 0,25 giờ chạy (số tính tay).',
  [{ col: 'A', type: 'BOOL' }],
  [brk(0), row(0, 0), row(900000, 1), row(1800000, 0), adv(H)],
  {
    hand: {
      A: {
        [H]: [{ bucket: 0, ...B(3, 0, 1, 0, 0, 900000, 3600000) }],
      },
    },
  },
);
add(
  'bool-shift-8h',
  'BOOL chạy 6 giờ trong ca 8 giờ (06:00-14:00 UTC): dùng cho báo cáo giờ chạy.',
  [{ col: 'A', type: 'BOOL' }],
  [brk(0), row(6 * H, 0), row(7 * H, 1), row(13 * H, 0), adv(14 * H)],
);
add(
  'huge-and-tiny',
  'Số rất lớn (1e15) và rất nhỏ (1e-12) trong cùng cửa sổ: sumw 3e19 (phần nhỏ mất do làm tròn), dung sai tương đối 1e-9.',
  A1,
  [brk(0), row(0, 1e15), row(30000, 1e-12), adv(M)],
  { hand: { A: { [M]: [{ bucket: 0, ...B(2, 1e-12, 1e15, 1e15, 1e-12, 3e19, 60000) }] } } },
);
add('negative-values', 'Giá trị âm và đổi dấu.', A1, [
  brk(0),
  row(0, -5),
  row(20000, 3),
  row(40000, -1.5),
  adv(M),
]);
add('fractional-ms', 'Dòng ở mili giây lẻ (1001, 1999, 30007).', A1, [
  brk(0),
  row(1001, 1),
  row(1999, 2),
  row(30007, 3),
  adv(M),
]);
add('minute-to-hour-ramp', 'Dốc mỗi 30 s trong 2 giờ: 120 hàng phút ghép thành 2 hàng giờ.', A1, [
  brk(0),
  ...every(0, 2 * H, 30000, (t) => t / 30000),
  adv(2 * H),
]);
add(
  'hour-partial-data',
  'Dữ liệu chỉ ở 10 phút của giờ 0 và 5 phút của giờ 2; giờ 1 không có hàng.',
  A1,
  [brk(0), row(0, 4), row(10 * M, null), row(2 * H, 6), row(2 * H + 5 * M, null), adv(3 * H)],
);
add(
  'hour-open-no-row',
  'Giờ chưa đóng (advance 3599999): có hàng phút nhưng không có hàng giờ.',
  A1,
  [brk(0), row(0, 1), row(1800000, 2), adv(3599999)],
);
add(
  'restart-in-hour',
  'Dừng 20 phút giữa giờ rồi chạy lại: hàng giờ ghép từ hàng phút, first của phút đầu, last của phút cuối.',
  A1,
  [brk(0), row(0, 5), brk(20 * M), row(40 * M, 8), adv(H)],
);
add(
  'jump-back',
  'Đồng hồ nhảy lùi: lần chạy sau ghi vào bucket đã có (upsert ghép); wms có thể vượt độ dài cửa sổ. Quy ước của ref: jump = break tại t, đồng hồ mới = to.',
  A1,
  [
    brk(0),
    row(100000, 1),
    row(130000, 2),
    { t: 200000, op: 'jump', to: 50000 },
    row(50000, 9),
    adv(130000),
  ],
  {
    hand: {
      A: {
        [M]: [
          { bucket: 0, ...B(1, 9, 9, 9, 9, 90000, 10000) },
          { bucket: 60000, ...B(1, 1, 9, 1, 9, 560000, 80000) },
          { bucket: 120000, ...B(1, 1, 2, 1, 2, 110000, 60000) },
          { bucket: 180000, ...B(0, 2, 2, 2, 2, 40000, 20000) },
        ],
      },
    },
  },
);
add(
  'jump-forward',
  'Đồng hồ nhảy tiến (đồng bộ thời gian): break tại t cũ, dòng sau ở thời gian mới; tín hiệu không mang qua nhảy.',
  A1,
  [brk(0), row(10000, 3), { t: 40000, op: 'jump', to: 3 * M }, row(3 * M + 5000, 4), adv(5 * M)],
);
add('counter-reset', 'Bộ đếm về 0 (thay thiết bị): delta của cửa sổ âm.', A1, [
  brk(0),
  row(0, 500),
  row(30000, 20),
  adv(M),
]);
add(
  'delta-24h',
  'Bộ đếm tăng 5 mỗi 30 phút trong 24 giờ (dòng ở 0, 1800000, ...): mỗi giờ first là giá trị mang; Σ delta 24 giờ = 335 − 100 = 235.',
  A1,
  [brk(0), ...Array.from({ length: 48 }, (_, i) => row(i * 1800000, 100 + i * 5)), adv(86400000)],
);
add(
  'two-columns',
  'Hai cột, một cột NULL lệch pha với cột kia.',
  [
    { col: 'A', type: 'FLOAT32' },
    { col: 'B', type: 'INT32' },
  ],
  [
    brk(0),
    { t: 0, op: 'row', values: { A: 1.5, B: 10 } },
    { t: 20000, op: 'row', values: { A: null, B: 11 } },
    { t: 70000, op: 'row', values: { A: 2.5, B: null } },
    adv(2 * M),
  ],
);
add(
  'int-big',
  'Số nguyên 64 bit lớn lưu REAL (chấp nhận mất chính xác trên 2^53, ADR-031).',
  [{ col: 'A', type: 'INT64' }],
  [brk(0), row(0, 9007199254740992), row(30000, Number('9007199254740993')), adv(M)],
);
add('saw-signal', 'Tín hiệu răng cưa mỗi 15 s trong 4 phút.', A1, [
  brk(0),
  ...every(0, 4 * M, 15000, (t) => (t / 15000) % 5),
  adv(4 * M),
]);
add('many-nulls', 'NULL xen kẽ dày: bucket có n đếm đúng và wms chỉ đoạn có giá trị.', A1, [
  brk(0),
  ...every(0, 90000, 5000, (t) => ((t / 5000) % 3 === 0 ? null : t / 5000)),
  adv(2 * M),
]);
add(
  'second-run-new-minute',
  'Dừng giữa phút, chạy lại ở phút sau: không trùng bucket, mỗi bucket một nửa.',
  A1,
  [brk(0), row(10000, 1), brk(30000), row(70000, 2), adv(3 * M)],
);
add(
  'row-exactly-at-end-of-window-sequence',
  'Nhiều dòng đúng ranh giới phút (0, 60000, 120000): mỗi dòng mở cửa sổ mới, first = giá trị mang.',
  A1,
  [brk(0), row(0, 1), row(60000, 2), row(120000, 3), row(180000, 4), adv(240000)],
);

let count = 0;
for (const c of cases) {
  const expect = {};
  for (const t of c.cols) {
    const s = aggregateStore(c.events, t.col);
    expect[t.col] = { [M]: s[M], [H]: s[H] };
  }
  if (c.hand) {
    for (const [col, res] of Object.entries(c.hand))
      for (const [r, list] of Object.entries(res)) {
        const got = expect[col][r];
        assert.equal(got.length, list.length, `${c.name}/${col}/${r}: số bucket`);
        list.forEach((want, i) =>
          assert.deepEqual(got[i], want, `${c.name}/${col}/${r}[${i}] khác số tính tay`),
        );
      }
  }
  const vec = {
    name: c.name,
    description: c.description,
    ...(c.hand ? { note: 'Số mong đợi được kiểm với số tính tay khi sinh vector.' } : {}),
    tags: c.cols,
    events: c.events,
    expect,
  };
  writeFileSync(join(here, `agg-${c.name}.json`), format(vec));
  count++;
}
mkdirSync(here, { recursive: true });
console.log(`${count} vector agg-*, ${11 + 13} vector merge/derive trong ${here}`);
