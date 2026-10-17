// Thư viện chung của fuzz phía TypeScript (feature 011, T058, T142, T165; FR-029): PRNG tất định, đột biến cây JSON và
// văn bản, đọc kho mầm tests/fuzz-corpus (kiểm SHA-256 theo SHA256SUMS). Không phụ thuộc gói ngoài.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const CORPUS_DIR = resolve(import.meta.dirname, '../../tests/fuzz-corpus');

/** PRNG 32 bit tất định (mulberry32), trả số thực [0, 1). */
export function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** PRNG của ca `c` thuộc seed `seed`: chạy lại đúng một ca bằng `--seed S --case C`. */
export const caseRng = (seed, c) =>
  mulberry32((Math.imul(seed ^ 0x9e3779b9, 2654435761) + Math.imul(c + 1, 40503)) >>> 0);

export const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
export const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

/** SHA-256 hex của một tệp. */
export const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** Đọc một tệp kho mầm (JSON) sau khi kiểm mã băm trong SHA256SUMS; lệch thì ném lỗi. */
export function loadCorpus(rel) {
  const sums = new Map(
    readFileSync(join(CORPUS_DIR, 'SHA256SUMS'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [h, p] = l.split(/\s+\*?/);
        return [p, h];
      }),
  );
  const want = sums.get(rel);
  if (!want) throw new Error(`kho mầm: ${rel} không có trong SHA256SUMS`);
  const got = sha256File(join(CORPUS_DIR, rel));
  if (got !== want) throw new Error(`kho mầm: ${rel} lệch SHA-256 (${got} != ${want})`);
  return JSON.parse(readFileSync(join(CORPUS_DIR, rel), 'utf8'));
}

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

/** Giá trị "độc" chung: lẫn kiểu, biên số, chuỗi lạ. */
export const NASTY_VALUES = [
  null,
  true,
  false,
  0,
  -0,
  -1,
  1,
  0.5,
  -2.5,
  65535,
  65536,
  2147483647,
  2147483648,
  -2147483649,
  4294967296,
  9007199254740992,
  2 ** 63,
  -(2 ** 63),
  2 ** 64,
  1e308,
  -1e308,
  5e-324,
  '',
  ' ',
  '0',
  '1e999',
  'NaN',
  'Infinity',
  '-0',
  'true',
  'null',
  '../x',
  '/abs',
  'C:\\x',
  'a/./b',
  'x\u0000y',
  '\u0007',
  '\ud800',
  '\udfff',
  'a\u202eb',
  'Đường ống',
  '{x}',
  '{prefix}',
  '{a}{b}',
  '{',
  '}',
  '{{x}}',
  '{Bad}',
  '{constructor}',
  '{__proto__}',
  '__proto__',
  'constructor',
  'toString',
  'hasOwnProperty',
  'javascript:alert(1)',
  '<script>',
  'A'.repeat(300),
  'Đ'.repeat(70),
  [],
  {},
  [null],
  { '': '' },
  JSON.parse('{"__proto__":{"x":1},"constructor":1}'),
];

/** Mọi nút của cây JSON: `{ parent, key, value }` (gốc có parent null). */
export function nodesOf(root) {
  const out = [{ parent: null, key: null, value: root }];
  const stack = [root];
  while (stack.length) {
    const v = stack.pop();
    if (Array.isArray(v))
      v.forEach((x, i) => {
        out.push({ parent: v, key: i, value: x });
        if (x !== null && typeof x === 'object') stack.push(x);
      });
    else if (v !== null && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        out.push({ parent: v, key: k, value: x });
        if (x !== null && typeof x === 'object') stack.push(x);
      }
  }
  return out;
}

/** Từ điển khóa và chuỗi của kho mầm (cho đột biến "thật"). */
export function dictionaryOf(values) {
  const keys = new Set();
  const strings = new Set();
  const numbers = new Set();
  for (const v of values)
    for (const n of nodesOf(v)) {
      if (typeof n.key === 'string') keys.add(n.key);
      if (typeof n.value === 'string' && n.value.length < 200) strings.add(n.value);
      if (typeof n.value === 'number') numbers.add(n.value);
    }
  return { keys: [...keys].sort(), strings: [...strings].sort(), numbers: [...numbers] };
}

const STR_PIECES = ['{', '}', '.', '/', '\\', '\u0000', '..', ' ', '#', ':', '"', '%', '~', '\n'];

export function mutateString(s, r, dict) {
  const i = Math.floor(r() * (s.length + 1));
  switch (Math.floor(r() * 8)) {
    case 0:
      return s.slice(0, i) + s.slice(i + 1 + Math.floor(r() * 4));
    case 1:
      return s.slice(0, i) + pick(r, STR_PIECES) + s.slice(i);
    case 2:
      return s.slice(0, i) + (dict ? pick(r, dict.strings) : 'x') + s.slice(i);
    case 3:
      return s + s;
    case 4:
      return s.slice(0, i) + String.fromCharCode(Math.floor(r() * 0x10000)) + s.slice(i + 1);
    case 5:
      return s.toUpperCase();
    case 6:
      return (
        s.slice(0, i) + '{' + pick(r, ['x', 'prefix', 'title', 'p', 'a1', 'B']) + '}' + s.slice(i)
      );
    default:
      return s.repeat(int(r, 2, 40));
  }
}

function randomValue(r, dict, donor) {
  const k = r();
  if (k < 0.35) return clone(pick(r, NASTY_VALUES));
  if (k < 0.6 && dict.strings.length) return pick(r, dict.strings);
  if (k < 0.75 && dict.numbers.length) {
    const n = pick(r, dict.numbers);
    return pick(r, [n, n + 1, n - 1, -n, n * 1000, n / 3, Math.round(n * 1.5)]);
  }
  if (donor !== undefined) {
    const ns = nodesOf(donor);
    return clone(pick(r, ns).value);
  }
  return clone(pick(r, NASTY_VALUES));
}

/**
 * Đột biến một cây JSON (bản sao; không sửa đầu vào): xóa/thêm/đổi khóa, lẫn kiểu, biên số, đột biến chuỗi, lặp
 * phần tử mảng, ghép cây con từ `donor`, lồng sâu.
 */
export function mutateJson(root, r, dict, donor, rounds = 1 + Math.floor(r() * 4)) {
  let doc = clone(root);
  for (let n = 0; n < rounds; n++) {
    const nodes = nodesOf(doc);
    const node = pick(r, nodes);
    const set = (v) => {
      if (node.parent === null) doc = v;
      else node.parent[node.key] = v;
    };
    const op = Math.floor(r() * 12);
    switch (op) {
      case 0: // xóa
        if (node.parent === null) break;
        if (Array.isArray(node.parent)) node.parent.splice(node.key, 1);
        else delete node.parent[node.key];
        break;
      case 1:
      case 2: // thay bằng giá trị khác
        set(randomValue(r, dict, donor));
        break;
      case 3: // đột biến chuỗi
        if (typeof node.value === 'string') set(mutateString(node.value, r, dict));
        else set(randomValue(r, dict, donor));
        break;
      case 4: // số biên
        if (typeof node.value === 'number')
          set(
            pick(r, [
              node.value + 1,
              node.value - 1,
              -node.value,
              node.value * 2 ** int(r, 1, 64),
              node.value + 0.5,
              0,
              -0,
              Number.MAX_SAFE_INTEGER,
            ]),
          );
        else set(randomValue(r, dict, donor));
        break;
      case 5: // thêm khóa
        if (node.value !== null && typeof node.value === 'object' && !Array.isArray(node.value))
          node.value[pick(r, dict.keys.length ? dict.keys : ['x'])] = randomValue(r, dict, donor);
        else if (Array.isArray(node.value)) node.value.push(randomValue(r, dict, donor));
        break;
      case 6: // lặp phần tử mảng
        if (Array.isArray(node.value) && node.value.length) {
          const x = pick(r, node.value);
          const times = r() < 0.2 ? int(r, 10, 300) : 1;
          for (let i = 0; i < times; i++) node.value.push(clone(x));
        } else if (Array.isArray(node.parent)) node.parent.push(clone(node.value));
        break;
      case 7: // đổi tên khóa
        if (node.parent && !Array.isArray(node.parent)) {
          const v = node.parent[node.key];
          delete node.parent[node.key];
          node.parent[r() < 0.5 ? pick(r, dict.keys) : mutateString(node.key, r, dict)] = v;
        }
        break;
      case 8: // ghép cây con từ cùng tài liệu
        set(clone(pick(r, nodes).value));
        break;
      case 9: // lồng sâu
        {
          let v = node.value;
          const depth = int(r, 2, r() < 0.1 ? 200 : 20);
          for (let i = 0; i < depth; i++) v = r() < 0.5 ? [v] : { a: v };
          set(v);
        }
        break;
      case 10: // mảng thành đối tượng và ngược lại
        if (Array.isArray(node.value)) set(Object.fromEntries(node.value.map((x, i) => [i, x])));
        else if (node.value !== null && typeof node.value === 'object')
          set(Object.values(node.value));
        else set(randomValue(r, dict, donor));
        break;
      default: // đảo thứ tự mảng
        if (Array.isArray(node.value)) node.value.reverse();
        else set(randomValue(r, dict, donor));
    }
  }
  return doc;
}

/** Đột biến văn bản (cho đường parse JSON): cắt, lật byte, chèn ký tự cấu trúc, BOM. */
export function mutateText(s, r) {
  const i = Math.floor(r() * (s.length + 1));
  switch (Math.floor(r() * 7)) {
    case 0:
      return s.slice(0, i);
    case 1:
      return (
        s.slice(0, i) + pick(r, ['{', '}', '[', ']', ',', ':', '"', '\\', '\u0000']) + s.slice(i)
      );
    case 2:
      return '\ufeff' + (r() < 0.3 ? '\ufeff' : '') + s;
    case 3:
      return s.slice(0, i) + String.fromCharCode(Math.floor(r() * 0x10000)) + s.slice(i + 1);
    case 4:
      return s.slice(0, i) + '"\\ud800"' + s.slice(i);
    case 5:
      return s.slice(0, i) + '1e400' + s.slice(i);
    default:
      return s.slice(0, i) + s.slice(i, i + int(r, 1, 200)) + s.slice(i);
  }
}

/** Số hữu hạn ngẫu nhiên phù hợp kiểu Tag (đầu vào hữu hạn cho bất biến "không NaN"). */
export function finiteFor(type, r) {
  switch (type) {
    case 'BOOL':
      return r() < 0.5;
    case 'STRING':
      return pick(r, ['', 'a', 'ON', 'Đ', '0', '1.5', 'x'.repeat(int(r, 0, 300))]);
    case 'INT16':
      return int(r, -32768, 32767);
    case 'UINT16':
      return int(r, 0, 65535);
    case 'INT32':
      return int(r, -2147483648, 2147483647);
    case 'UINT32':
      return int(r, 0, 4294967295);
    case 'INT64':
    case 'UINT64':
      return pick(r, [0, 1, -1, 2 ** 53, -(2 ** 53), 2 ** 62, 9.2e18, int(r, -1e6, 1e6)]);
    default:
      return pick(r, [
        0,
        -0,
        1,
        -1,
        0.1,
        1e-300,
        5e-324,
        1e300,
        -1e300,
        1.7976931348623157e308,
        3.4e38,
        (r() - 0.5) * 2 ** int(r, 0, 1000),
        (r() - 0.5) * 1000,
      ]);
  }
}

/** Kiểm "số hữu hạn ở mọi chỗ" của một giá trị lồng (bỏ qua bigint). Trả đường dẫn đầu tiên không hữu hạn. */
export function firstNonFinite(v, path = '') {
  if (typeof v === 'number') return Number.isFinite(v) ? null : `${path}=${v}`;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const p = firstNonFinite(v[i], `${path}/${i}`);
      if (p) return p;
    }
    return null;
  }
  if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const p = firstNonFinite(x, `${path}/${k}`);
      if (p) return p;
    }
  }
  return null;
}
