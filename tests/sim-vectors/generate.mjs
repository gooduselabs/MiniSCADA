// Sinh bộ vector bộ sinh mô phỏng dùng chung TS (@mat/tag-sim) và C++ (drivers/simulation):
// specs/006-tags-modbus/contracts/value-tables-simulation.md §2, §3. Tất định, không phụ thuộc gói ngoài.
//
//   node tests/sim-vectors/generate.mjs
//
// Ra (mỗi file { "suites": [ { "name", "sim", "type", "cases" } ] }, trừ hai file ghi chú dưới):
// - const.json, ramp.json, sine.json, random.json, square.json, manual.json: mỗi bộ sinh x mỗi kiểu Tag hợp
//   lệ >= 10 ca (t gồm 0, m = 0, m = T - 1, năm 2026, năm 2100, k >= 2^32).
//   `cases[i]` = { t, value } hoặc, với manual, { t, writes: [giá trị ghi...], value }. Giá trị INT64/UINT64
//   là chuỗi thập phân; số khác là số JSON; BOOL là true/false; STRING là chuỗi.
// - sin-turns.json: { "cases": [ { "f", "value" } ] } cho sinTurns(f), so từng bit.
// - hash.json: { "cases": [ { "seed", "k", "u" } ] } cho U(seed, k); k có thể >= 2^32 (số JSON < 2^53).
// - legacy.json không sinh ở đây (sinh từ bản C++ ở T027).
// Bộ tính tham chiếu viết riêng trong script này: số nguyên chính xác bằng BigInt, hàm băm bằng BigInt
// (không dùng Math.imul), sinTurns theo đúng thứ tự phép tính của contract §2.1.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(here, { recursive: true });

// ---- sinTurns (fdlibm __kernel_sin, __kernel_cos; contract §2.1) ----
const HALF_PI = 1.5707963267948966;
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

function kSin(x) {
  const z = x * x;
  const poly = S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6))));
  return x + x * z * poly;
}
function kCos(x) {
  const z = x * x;
  const poly = C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6))));
  return 1 - (0.5 * z - z * (z * poly));
}
function sinTurns(f) {
  const f4 = f * 4;
  const q = Math.floor(f4);
  let r = f4 - q;
  let other = false;
  if (r > 0.5) {
    r = 1 - r;
    other = true;
  }
  const x = r * HALF_PI;
  // q chẵn: S (cặp trái) hoặc C (cặp phải); q lẻ: C hoặc S
  const useSin = (q % 2 === 0) !== other;
  const v = useSin ? kSin(x) : kCos(x);
  return q >= 2 ? -v : v;
}

// ---- U(seed, k) bằng BigInt ----
const M32 = 0xffffffffn;
function mix(x) {
  x ^= x >> 16n;
  x = (x * 0x7feb352dn) & M32;
  x ^= x >> 15n;
  x = (x * 0x846ca68bn) & M32;
  x ^= x >> 16n;
  return x;
}
function U(seed, k) {
  const kk = BigInt(k);
  let h = mix((BigInt(seed) ^ 0x9e3779b9n) & M32);
  h = mix(h ^ (kk & M32));
  h = mix(h ^ (kk >> 32n));
  return Number(h >> 8n) / 16777216;
}

// ---- Bộ sinh và đổi về kiểu Tag ----
const INT = {
  INT16: [-(2n ** 15n), 2n ** 15n - 1n],
  UINT16: [0n, 2n ** 16n - 1n],
  INT32: [-(2n ** 31n), 2n ** 31n - 1n],
  UINT32: [0n, 2n ** 32n - 1n],
  INT64: [-(2n ** 63n), 2n ** 63n - 1n],
  UINT64: [0n, 2n ** 64n - 1n],
};
const NUMERIC = ['INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64', 'FLOAT32', 'FLOAT64'];
const ALL = ['BOOL', ...NUMERIC, 'STRING'];

function round(x) {
  const r = Math.trunc(x);
  return Math.abs(x - r) >= 0.5 ? r + (x > 0 ? 1 : -1) : r;
}

/** Đổi giá trị (số, bool hoặc chuỗi) về giá trị JSON của Tag kiểu `type`. */
function toType(v, type) {
  if (type === 'BOOL') return v;
  if (type === 'STRING') return v;
  const x = typeof v === 'boolean' ? (v ? 1 : 0) : v;
  if (type === 'FLOAT64') return x === 0 ? 0 : x;
  if (type === 'FLOAT32') {
    const f = Math.fround(x);
    return f === 0 ? 0 : f;
  }
  const [lo, hi] = INT[type];
  let b = BigInt(round(x));
  if (b < lo) b = lo;
  if (b > hi) b = hi;
  return type === 'INT64' || type === 'UINT64' ? b.toString() : Number(b);
}

function raw(sim, t, type, writes = []) {
  const T = BigInt(sim.periodMs ?? 1);
  const tb = BigInt(t);
  const m = tb % T;
  const k = (tb - m) / T;
  const mn = Number(m);
  const Tn = Number(T);
  switch (sim.kind) {
    case 'const':
      return sim.value;
    case 'ramp': {
      const p = mn / Tn;
      return sim.from + (sim.to - sim.from) * p;
    }
    case 'sine': {
      let f = mn / Tn + (sim.phase ?? 0);
      if (f >= 1) f = f - 1;
      return sim.center + sim.amplitude * sinTurns(f);
    }
    case 'random': {
      const u = U(sim.seed ?? 1, k);
      return type === 'BOOL' ? u >= 0.5 : sim.min + (sim.max - sim.min) * u;
    }
    case 'square': {
      const on = mn < (sim.duty ?? 0.5) * Tn;
      return type === 'BOOL' ? on : on ? 1 : 0;
    }
    case 'manual':
      return writes.length > 0 ? writes[writes.length - 1] : sim.initial;
    default:
      throw new Error(sim.kind);
  }
}

const value = (sim, t, type, writes) => toType(raw(sim, t, type, writes), type);

// ---- Thời điểm thử ----
const T2026 = 1791601205123; // 2026-10-09T...
const T2100 = 4102444800123; // 2100-01-01T00:00:00.123Z
function times(T) {
  const k32 = 2 ** 32;
  return [
    0,
    1,
    Math.floor(T / 2),
    T - 1, // m = T - 1
    T, // m = 0, k = 1
    5 * T, // m = 0
    5 * T + T - 1,
    T2026,
    T2026 - (T2026 % T), // m = 0 ở năm 2026
    T2100,
    k32 * T + 7, // k = 2^32 (k_hi = 1)
    (k32 * 3 + 1) * T + (T - 1), // k_hi = 3
  ].filter((t) => Number.isSafeInteger(t));
}

function suite(name, sim, type, extraTimes = []) {
  const T = sim.periodMs ?? 1000;
  const ts = [...times(T), ...extraTimes];
  const cases = ts.map((t) => ({ t, value: value(sim, t, type) }));
  return { name, sim, type, cases };
}

// ---- Dựng các file ----
const files = {};
const add = (file, s) => (files[file] ??= []).push(s);

// const: mọi kiểu
const CONST = {
  BOOL: true,
  INT16: -123,
  UINT16: 65535,
  INT32: -2147483648,
  UINT32: 4294967295,
  INT64: 123456789012,
  UINT64: 9007199254740991,
  FLOAT32: 3.14159,
  FLOAT64: 2.718281828459045,
  STRING: 'Xin chào',
};
for (const ty of ALL) add('const', suite(`const-${ty}`, { kind: 'const', value: CONST[ty] }, ty));
add('const', suite('const-INT16-clamp-high', { kind: 'const', value: 70000 }, 'INT16'));
add('const', suite('const-UINT16-clamp-low', { kind: 'const', value: -5 }, 'UINT16'));
add('const', suite('const-INT32-round', { kind: 'const', value: 2.5 }, 'INT32'));
add('const', suite('const-FLOAT32-round', { kind: 'const', value: 0.1 }, 'FLOAT32'));

// ramp: mọi kiểu số
const RAMP = {
  INT16: { from: -1000, to: 1000, periodMs: 20000 },
  UINT16: { from: 0, to: 4000, periodMs: 100 },
  INT32: { from: -100000, to: 100000, periodMs: 86400000 },
  UINT32: { from: 0, to: 1e6, periodMs: 3700 },
  INT64: { from: -1e12, to: 1e12, periodMs: 20000 },
  UINT64: { from: 0, to: 1e15, periodMs: 20000 },
  FLOAT32: { from: 0, to: 1, periodMs: 20000 },
  FLOAT64: { from: -5.5, to: 5.5, periodMs: 3700 },
};
for (const ty of NUMERIC) add('ramp', suite(`ramp-${ty}`, { kind: 'ramp', ...RAMP[ty] }, ty));
add(
  'ramp',
  suite('ramp-INT16-clamp', { kind: 'ramp', from: 0, to: 100000, periodMs: 20000 }, 'INT16'),
);
add(
  'ramp',
  suite(
    'ramp-UINT32-descending-clamp',
    { kind: 'ramp', from: 10, to: -10, periodMs: 100 },
    'UINT32',
  ),
);
add(
  'ramp',
  suite('ramp-FLOAT32-descending', { kind: 'ramp', from: 100, to: 0, periodMs: 20000 }, 'FLOAT32'),
);

// sine
for (const ty of NUMERIC)
  add(
    'sine',
    suite(
      `sine-${ty}`,
      { kind: 'sine', center: 50, amplitude: 25, periodMs: 20000, phase: 0.25 },
      ty,
    ),
  );
add(
  'sine',
  suite('sine-FLOAT64-unit', { kind: 'sine', center: 0, amplitude: 1, periodMs: 100 }, 'FLOAT64'),
);
add(
  'sine',
  suite(
    'sine-FLOAT64-phase-wrap',
    { kind: 'sine', center: 0, amplitude: 1, periodMs: 1000, phase: 0.9 },
    'FLOAT64',
  ),
);
add(
  'sine',
  suite(
    'sine-FLOAT64-day',
    { kind: 'sine', center: -3.5, amplitude: 120, periodMs: 86400000, phase: 0.6180339887498949 },
    'FLOAT64',
  ),
);
add(
  'sine',
  suite('sine-INT16-clamp', { kind: 'sine', center: 0, amplitude: 40000, periodMs: 5000 }, 'INT16'),
);
add(
  'sine',
  suite(
    'sine-FLOAT32-3700',
    { kind: 'sine', center: 10, amplitude: 3, periodMs: 3700, phase: 0.125 },
    'FLOAT32',
  ),
);

// random: số + BOOL
const RANDOM = { min: 0, max: 100, seed: 1, periodMs: 2000 };
for (const ty of [...NUMERIC, 'BOOL'])
  add('random', suite(`random-${ty}`, { kind: 'random', ...RANDOM }, ty));
add(
  'random',
  suite('random-seed-0', { kind: 'random', min: -1, max: 1, seed: 0, periodMs: 100 }, 'FLOAT64'),
);
add(
  'random',
  suite(
    'random-seed-max',
    { kind: 'random', min: 0, max: 1, seed: 4294967295, periodMs: 100 },
    'FLOAT32',
  ),
);
add(
  'random',
  suite(
    'random-seed-12345-int',
    { kind: 'random', min: -50, max: 50, seed: 12345, periodMs: 250 },
    'INT16',
  ),
);
add(
  'random',
  suite('random-BOOL-seed-7', { kind: 'random', min: 0, max: 1, seed: 7, periodMs: 100 }, 'BOOL'),
);

// square: BOOL + số
for (const ty of ['BOOL', ...NUMERIC])
  add('square', suite(`square-${ty}`, { kind: 'square', periodMs: 10000, duty: 0.5 }, ty));
add(
  'square',
  suite('square-BOOL-duty-quarter', { kind: 'square', periodMs: 1000, duty: 0.25 }, 'BOOL'),
);
add('square', suite('square-BOOL-duty-0', { kind: 'square', periodMs: 1000, duty: 0 }, 'BOOL'));
add('square', suite('square-BOOL-duty-1', { kind: 'square', periodMs: 1000, duty: 1 }, 'BOOL'));
add(
  'square',
  suite(
    'square-INT16-duty-third',
    { kind: 'square', periodMs: 3000, duty: 0.3333333333333333 },
    'INT16',
  ),
);

// manual: chuỗi lệnh ghi
{
  const MAN = {
    BOOL: { initial: false, writes: [true, false, true] },
    INT16: { initial: 5, writes: [100, -3, 2.5, 40000] },
    UINT16: { initial: 0, writes: [7, 65535, -1] },
    INT32: { initial: 1, writes: [-5, 2147483647, 1.5] },
    UINT32: { initial: 1, writes: [3, 4294967295] },
    INT64: { initial: 10, writes: [9007199254740991, -9007199254740991] },
    UINT64: { initial: 10, writes: [1e15, 0] },
    FLOAT32: { initial: 1.5, writes: [0.1, -2.75] },
    FLOAT64: { initial: 0.1, writes: [0.2, 0.30000000000000004] },
    STRING: { initial: 'abc', writes: ['Bơm 1', '', 'ệ'] },
  };
  for (const ty of ALL) {
    const { initial, writes } = MAN[ty];
    const sim = { kind: 'manual', initial };
    const cases = [{ t: 0, writes: [], value: value(sim, 0, ty, []) }];
    for (let i = 1; i <= writes.length; i++)
      cases.push({
        t: 1000 * i,
        writes: writes.slice(0, i),
        value: value(sim, 1000 * i, ty, writes.slice(0, i)),
      });
    for (let i = 0; i < 8; i++) {
      const w = writes.slice(0, (i % writes.length) + 1);
      cases.push({ t: T2026 + i, writes: w, value: value(sim, T2026 + i, ty, w) });
    }
    add('manual', { name: `manual-${ty}`, sim, type: ty, cases });
  }
}

// ---- Tự kiểm: hai giá trị của contract §3 ----
{
  const sim = { kind: 'sine', center: 50, amplitude: 25, periodMs: 20000, phase: 0.25 };
  if (value(sim, 0, 'FLOAT32') !== 75) throw new Error('sine t=0 phải bằng 75');
  if (value(sim, 1791601205123, 'FLOAT32') !== 49.03419876098633)
    throw new Error('sine t=1791601205123');
  if (Math.abs(sinTurns(0.5)) > 1e-15 || sinTurns(0.25) !== 1 || sinTurns(0.75) !== -1)
    throw new Error('sinTurns điểm đặc biệt');
}

// ---- Số ca tối thiểu ----
for (const [file, suites] of Object.entries(files))
  for (const s of suites)
    if (s.cases.length < 7) throw new Error(`${file}/${s.name}: ${s.cases.length} ca`);
const need = {
  const: ALL,
  ramp: NUMERIC,
  sine: NUMERIC,
  random: [...NUMERIC, 'BOOL'],
  square: ['BOOL', ...NUMERIC],
  manual: ALL,
};
for (const [file, types] of Object.entries(need))
  for (const ty of types) {
    const n = files[file].filter((s) => s.type === ty).reduce((a, s) => a + s.cases.length, 0);
    if (n < 10) throw new Error(`${file} x ${ty}: ${n} ca < 10`);
  }

const lineJson = (v) =>
  JSON.stringify(v, (_k, x) => (Object.is(x, -0) ? '__NEGZERO__' : x)).replace(
    /"__NEGZERO__"/g,
    '-0.0',
  );
let total = 0;
for (const [file, suites] of Object.entries(files)) {
  const body = suites
    .map(
      (s) =>
        `{ "name": ${lineJson(s.name)}, "sim": ${lineJson(s.sim)}, "type": ${lineJson(s.type)}, "cases": [\n${s.cases.map((c) => '    ' + lineJson(c)).join(',\n')}\n  ] }`,
    )
    .join(',\n');
  writeFileSync(join(here, `${file}.json`), `{ "suites": [\n${body}\n] }\n`);
  total += suites.reduce((a, s) => a + s.cases.length, 0);
}

// sinTurns và U riêng
{
  const fs = [
    0, 1e-9, 0.0625, 0.125, 0.1875, 0.25, 0.3125, 0.375, 0.4375, 0.5, 0.5000000000000001, 0.5625,
    0.625, 0.6875, 0.75, 0.8125, 0.875, 0.9375, 0.99999999999999989, 0.3333333333333333,
    0.6180339887498949, 0.1, 0.2, 0.7, 0.9, 0.05615, 0.50615,
  ];
  // f cách đều và f quanh biên r = 0.5 của từng góc phần tư
  for (let i = 0; i < 64; i++) fs.push(i / 64, (i + 0.5) / 64, ((i + 1) / 64) * 0.9999999999999999);
  for (let q = 0; q < 4; q++)
    fs.push((q + 0.5) / 4, (q + 0.5000000000000001) / 4, (q + 0.4999999999999999) / 4);
  const uniq = [...new Set(fs.filter((f) => f >= 0 && f < 1))].sort((a, b) => a - b);
  writeFileSync(
    join(here, 'sin-turns.json'),
    `{ "cases": [\n${uniq.map((f) => '  ' + lineJson({ f, value: sinTurns(f) })).join(',\n')}\n] }\n`,
  );
  total += uniq.length;
  const hs = [];
  for (const seed of [0, 1, 2, 12345, 0x9e3779b9, 4294967295])
    for (const k of [
      0,
      1,
      2,
      3,
      100,
      65535,
      2 ** 31,
      2 ** 32 - 1,
      2 ** 32,
      2 ** 32 + 1,
      2 ** 33 + 5,
      3 * 2 ** 32 + 1,
      1791601205123 / 2000 - 0.5 * 0,
      2 ** 52,
      2 ** 53 - 1,
    ])
      hs.push({ seed, k: Math.floor(k), u: U(seed, Math.floor(k)) });
  writeFileSync(
    join(here, 'hash.json'),
    `{ "cases": [\n${hs.map((c) => '  ' + lineJson(c)).join(',\n')}\n] }\n`,
  );
  total += hs.length;
}
console.log(`sim-vectors: ${total} ca`);
