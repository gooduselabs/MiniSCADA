// Sinh bộ vector bảng giá trị dùng chung TS (@mat/expression) và C++ (core/expression):
// specs/006-tags-modbus/contracts/value-tables-simulation.md §1, §3. Tất định, không phụ thuộc gói ngoài.
//
//   node tests/value-table-vectors/generate.mjs
//
// Ra:
// - lookup-*.json: { "table", "cases": [ { "input", "expect": { text, color, entry } } ] }.
//   `input` là số, true/false, hoặc chuỗi "NaN"; số âm không là -0 mất dấu: viết -0.0.
// - validate.json: { "cases": [ { "name", "table", "expect": [ { "code", "entry" } ] } ] }; `entry` là chỉ
//   số mục báo lỗi (mục SAU trong cặp chồng nhau), -1 cho `default`. expect rỗng = bảng hợp lệ.
// Kết quả do bộ tra và bộ kiểm tham chiếu viết riêng trong script (không import @mat/expression).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(here, { recursive: true });

const num = (e) => (typeof e.value === 'boolean' ? (e.value ? 1 : 0) : e.value);

function refLookup(table, input) {
  let x = input === 'NaN' ? NaN : input;
  if (typeof x === 'boolean') x = x ? 1 : 0;
  if (!Number.isNaN(x)) {
    for (let i = 0; i < table.entries.length; i++) {
      const e = table.entries[i];
      const hit =
        e.value !== undefined
          ? x === num(e)
          : (e.from === undefined || x >= e.from) && (e.to === undefined || x < e.to);
      if (hit) return { text: e.text, color: e.color ?? null, entry: i };
    }
  }
  if (table.default)
    return { text: table.default.text ?? '', color: table.default.color ?? null, entry: 'default' };
  return { text: '', color: null, entry: null };
}

/** Khoảng [lo, hi) của một mục; điểm v là [v, v] đóng. */
function refIssues(table) {
  const out = [];
  const iv = table.entries.map((e) => {
    if (e.value !== undefined) return { point: true, v: num(e) };
    return { point: false, lo: e.from ?? -Infinity, hi: e.to ?? Infinity };
  });
  table.entries.forEach((e, i) => {
    if (e.value === undefined && !(iv[i].lo < iv[i].hi)) out.push({ code: 'E_VT_RANGE', entry: i });
    if ([...e.text].length > 64) out.push({ code: 'E_VT_TEXT', entry: i });
  });
  if (table.default?.text !== undefined && [...table.default.text].length > 64)
    out.push({ code: 'E_VT_TEXT', entry: -1 });
  for (let j = 1; j < iv.length; j++) {
    if (table.entries[j].value === undefined && !(iv[j].lo < iv[j].hi)) continue; // khoảng rỗng đã báo
    for (let i = 0; i < j; i++) {
      if (table.entries[i].value === undefined && !(iv[i].lo < iv[i].hi)) continue;
      const a = iv[i];
      const b = iv[j];
      let hit;
      if (a.point && b.point) hit = a.v === b.v;
      else if (a.point) hit = b.lo <= a.v && a.v < b.hi;
      else if (b.point) hit = a.lo <= b.v && b.v < a.hi;
      else hit = Math.max(a.lo, b.lo) < Math.min(a.hi, b.hi);
      if (hit) {
        out.push({ code: 'E_VT_OVERLAP', entry: j });
        break;
      }
    }
  }
  return out.sort((p, q) => (p.entry === q.entry ? (p.code < q.code ? -1 : 1) : p.entry - q.entry));
}

const lineJson = (v) =>
  JSON.stringify(v, (_k, x) => (Object.is(x, -0) ? '__NEGZERO__' : x)).replace(
    /"__NEGZERO__"/g,
    '-0.0',
  );

function writeLookup(name, table, inputs) {
  const cases = inputs.map((input) => ({ input, expect: refLookup(table, input) }));
  const body = cases.map((c) => '  ' + lineJson(c)).join(',\n');
  writeFileSync(
    join(here, `lookup-${name}.json`),
    `{\n"table": ${lineJson(table)},\n"cases": [\n${body}\n]\n}\n`,
  );
  return cases.length;
}

let total = 0;

// 1. Bảng chung: điểm, khoảng, khoảng một đầu, mặc định
const pump = {
  name: 'TrangThaiBom',
  entries: [
    { value: 0, text: 'Dừng', color: '#808080' },
    { value: 1, text: 'Chạy', color: '#2E7D32' },
    { value: 2, text: 'Lỗi', color: '#C62828' },
    { from: 10, to: 20, text: 'Bảo trì' },
    { from: 100, text: 'Quá lớn', color: '#FF0000' },
    { to: -50, text: 'Quá nhỏ' },
  ],
  default: { text: 'Không rõ', color: '#B26A00' },
};
total += writeLookup('basic', pump, [
  0,
  1,
  2,
  3,
  5,
  9.999999999999998,
  10,
  10.0000000001,
  15,
  19.999999999999996,
  20,
  99.99999999999999,
  100,
  1e9,
  -49.99999999999999,
  -50,
  -50.0000001,
  -1e9,
  -0.0,
  0.0,
  true,
  false,
  'NaN',
  1.5,
  -1,
]);

// 2. Không có mục mặc định
const nodef = {
  name: 'KhongMacDinh',
  entries: [
    { value: 1, text: 'Một' },
    { from: 5, to: 6, text: 'Năm' },
  ],
};
total += writeLookup('no-default', nodef, [0, 1, 2, 5, 5.5, 6, 'NaN', true, false, -0.0]);

// 3. BOOL: true trùng 1, false trùng 0 (cả hai hướng)
const boolTable = {
  name: 'BatTat',
  entries: [
    { value: false, text: 'Tắt', color: '#808080' },
    { value: true, text: 'Bật', color: '#00AA00' },
  ],
};
total += writeLookup('bool-entries', boolTable, [true, false, 1, 0, -0.0, 2, 0.5, 'NaN']);
const numTable = {
  name: 'SoMot',
  entries: [
    { value: 0, text: 'Không' },
    { value: 1, text: 'Một' },
  ],
};
total += writeLookup('bool-input', numTable, [true, false, 1, 0]);

// 4. -0 và 0
const zero = {
  name: 'Zero',
  entries: [
    { value: 0, text: 'Zero' },
    { from: -10, to: 0, text: 'Âm' },
  ],
};
total += writeLookup(
  'negative-zero',
  zero,
  [-0.0, 0.0, -1e-300, 1e-300, -10, -10.0000000001, -9.999999999999998],
);

// 5. NaN với bảng chỉ có mặc định và bảng rỗng
total += writeLookup(
  'only-default',
  { name: 'ChiMacDinh', entries: [], default: { text: 'Mặc định' } },
  [0, 'NaN', true],
);
total += writeLookup('empty', { name: 'Rong', entries: [] }, [0, 'NaN', true, -0.0]);

// 6. Mục không màu, mặc định chỉ có màu
total += writeLookup(
  'colors',
  {
    name: 'Mau',
    entries: [
      { value: 1, text: 'A' },
      { value: 2, text: 'B', color: '#112233' },
    ],
    default: { color: '#FFFFFF' },
  },
  [1, 2, 3],
);

// 7. Khoảng liền kề: to của khoảng này trùng from của khoảng sau
const adjacent = {
  name: 'LienKe',
  entries: [
    { from: 0, to: 10, text: 'Thấp' },
    { from: 10, to: 20, text: 'Vừa' },
    { from: 20, text: 'Cao' },
  ],
};
total += writeLookup(
  'adjacent',
  adjacent,
  [-1, 0, 9.999999999999998, 10, 19.999999999999996, 20, 1e300, -1e300],
);

// 8. Bảng 256 mục
const big = {
  name: 'Lon',
  entries: Array.from({ length: 256 }, (_, i) => ({
    value: i,
    text: `M${i}`,
    ...(i % 2 ? { color: '#0000FF' } : {}),
  })),
  default: { text: 'Ngoài' },
};
total += writeLookup('entries-256', big, [0, 1, 100, 254, 255, 256, -1, 127.5, true, false]);

// 9. Chữ tiếng Việt 64 ký tự (đúng trần), mục khoảng với số lớn
total += writeLookup(
  'text-64',
  { name: 'Chu64', entries: [{ value: 1, text: 'ệ'.repeat(64) }] },
  [1, 2],
);

// ---- Ca kiểm ----
const vcases = [];
const v = (name, table) => vcases.push({ name, table, expect: refIssues(table) });
const mk = (entries, extra = {}) => ({ name: 'T', entries, ...extra });
v('valid-basic', pump);
v('valid-adjacent-ranges', adjacent);
v(
  'valid-point-at-range-end',
  mk([
    { from: 0, to: 10, text: 'a' },
    { value: 10, text: 'b' },
  ]),
);
v('valid-empty', mk([]));
v(
  'overlap-point-point',
  mk([
    { value: 1, text: 'a' },
    { value: 1, text: 'b' },
  ]),
);
v(
  'overlap-bool-true-vs-1',
  mk([
    { value: true, text: 'a' },
    { value: 1, text: 'b' },
  ]),
);
v(
  'overlap-bool-false-vs-0',
  mk([
    { value: 0, text: 'a' },
    { value: false, text: 'b' },
  ]),
);
v(
  'overlap-point-in-range',
  mk([
    { from: 0, to: 10, text: 'a' },
    { value: 5, text: 'b' },
  ]),
);
v(
  'overlap-point-at-range-start',
  mk([
    { value: 0, text: 'a' },
    { from: 0, to: 10, text: 'b' },
  ]),
);
v(
  'overlap-range-range',
  mk([
    { from: 0, to: 10, text: 'a' },
    { from: 9, to: 20, text: 'b' },
  ]),
);
v(
  'overlap-range-contains',
  mk([
    { from: 0, to: 100, text: 'a' },
    { from: 10, to: 20, text: 'b' },
  ]),
);
v(
  'overlap-open-ranges',
  mk([
    { from: 0, text: 'a' },
    { to: 5, text: 'b' },
  ]),
);
v(
  'overlap-reports-later-entry',
  mk([
    { value: 1, text: 'a' },
    { value: 2, text: 'b' },
    { value: 1, text: 'c' },
  ]),
);
v(
  'overlap-two-later-entries',
  mk([
    { value: 1, text: 'a' },
    { value: 1, text: 'b' },
    { value: 1, text: 'c' },
  ]),
);
v('range-empty-equal', mk([{ from: 5, to: 5, text: 'a' }]));
v('range-empty-reversed', mk([{ from: 10, to: 0, text: 'a' }]));
v(
  'range-empty-not-overlap',
  mk([
    { from: 0, to: 10, text: 'a' },
    { from: 5, to: 5, text: 'b' },
  ]),
);
v('text-65-chars', mk([{ value: 1, text: 'x'.repeat(65) }]));
v('text-65-vietnamese', mk([{ value: 1, text: 'ệ'.repeat(65) }]));
v('text-64-supplementary', mk([{ value: 1, text: '😀'.repeat(64) }]));
v('text-65-supplementary', mk([{ value: 1, text: '😀'.repeat(65) }]));
v('default-text-65', mk([], { default: { text: 'y'.repeat(65) } }));
writeFileSync(
  join(here, 'validate.json'),
  `{ "cases": [\n${vcases.map((c) => '  ' + lineJson(c)).join(',\n')}\n] }\n`,
);
total += vcases.length;

console.log(`value-table-vectors: ${total} ca (tra + kiểm)`);
