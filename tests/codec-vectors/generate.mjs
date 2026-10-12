// Sinh bộ vector đổi giá trị thô <-> giá trị dùng chung TS (@mat/tag-codec) và C++ (drivers/modbus codec,
// core/tag-engine scaling): contracts/modbus-driver.md §6, contracts/project-format-0.2.md §3, research R6.
// Tất định, không phụ thuộc gói ngoài.
//
//   node tests/codec-vectors/generate.mjs
//
// Ra: address.json, numeric.json, string.json, scaling.json, bits.json (định dạng ở đầu từng phần dưới).
// Bộ tính tham chiếu viết riêng trong script (Buffer/BigInt, không import @mat/tag-codec).
//
// Quy ước chốt khi cài (T011, T021; cần ghi vào contract khi C++ cài):
// - Thanh ghi viết dạng hex 4 chữ hoa; số nguyên 64 bit là chuỗi thập phân; -0 viết -0.0.
// - Thứ tự byte của kiểu 32/64 bit: ABCD là chuẩn Modbus (lớn trước); BADC đảo byte trong từng word; CDAB đảo
//   thứ tự các word; DCBA đảo cả hai (= đảo toàn bộ byte). Kiểu 16 bit luôn lớn trước.
// - STRING: byte thứ nhất của mỗi thanh ghi là byte cao với AB, byte thấp với BA. Đọc: lấy L byte đầu, dừng ở
//   byte 0 đầu tiên, giải mã UTF-8; MỖI byte không thuộc một dãy UTF-8 hợp lệ thành một U+FFFD (không gộp theo
//   "maximal subpart" của TextDecoder). Dãy hợp lệ: không overlong, không đại diện (U+D800..DFFF), <= U+10FFFF.
//   L lẻ: byte đệm ở cuối thanh ghi cuối bị bỏ qua. Ghi: UTF-8, đệm 0 tới L rồi tới số chẵn; dài hơn L thì lỗi.
// - Địa chỉ: `.bit` > 15 là E_ADDR_SYNTAX; `.bit` với kiểu không phải BOOL, hay trên C/DI/Modicon 0,1 là
//   E_ADDR_AREA; không cắt khoảng trắng (Studio cắt trước); chữ thường được đổi thành chữ hoa.
// - Scaling: eng = engMin + ((raw - rawMin) * (engMax - engMin)) / (rawMax - rawMin). Có clamp và raw ngoài
//   [min(rawMin, rawMax), max(rawMin, rawMax)] thì trả đúng cận kỹ thuật tương ứng (không qua công thức),
//   quality UNCERTAIN lý do CLAMPED. Ghi: raw = rawMin + ((eng - engMin) * (rawMax - rawMin)) / (engMax -
//   engMin); số nguyên thì round nửa ra xa số 0 rồi so với khoảng của kiểu thô bằng số nguyên chính xác.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(here, { recursive: true });
const lineJson = (v) =>
  JSON.stringify(v, (_k, x) => (Object.is(x, -0) ? '__NEGZERO__' : x)).replace(
    /"__NEGZERO__"/g,
    '-0.0',
  );
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
const writeCases = (file, cases, extra = {}) => {
  const head = Object.entries(extra)
    .map(([k, v]) => `"${k}": ${lineJson(v)},\n`)
    .join('');
  writeFileSync(
    join(here, file),
    `{\n${head}"cases": [\n${cases.map((c) => '  ' + lineJson(c)).join(',\n')}\n]\n}\n`,
  );
};

// ======================================================================================
// address.json
// { name, address, addressBase, rawType, stringLength?, access?, expect }
// expect = { normalized, area, fcRead, fcWrite: [..], offset, registers, bit: n|null, warnings? } | { error }
// registers: số thanh ghi (kiểu 16/32/64 bit, STRING) hoặc 1 (bit trong thanh ghi) hoặc 1 bit cho C/DI.
// ======================================================================================
const REGS = {
  BOOL: 1,
  INT16: 1,
  UINT16: 1,
  INT32: 2,
  UINT32: 2,
  FLOAT32: 2,
  INT64: 4,
  UINT64: 4,
  FLOAT64: 4,
};
const AREA = {
  C: { fcRead: 1, fcWrite: [5, 15] },
  DI: { fcRead: 2, fcWrite: [] },
  IR: { fcRead: 4, fcWrite: [] },
  HR: { fcRead: 3, fcWrite: [6, 16] },
};
const MODICON = { 0: 'C', 1: 'DI', 3: 'IR', 4: 'HR' };

function refAddress({ address, addressBase, rawType, stringLength, access }) {
  const up = address.toUpperCase();
  let area;
  let number;
  let bit = null;
  let modicon = false;
  let m = /^(C|DI|IR|HR)([0-9]{1,5})(?:\.([0-9]{1,2}))?$/.exec(up);
  if (m) {
    area = m[1];
    number = Number(m[2]);
    if (m[3] !== undefined) bit = Number(m[3]);
  } else {
    m = /^([0134])([0-9]{4,5})(?:\.([0-9]{1,2}))?$/.exec(up);
    if (!m) return { error: 'E_ADDR_SYNTAX' };
    area = MODICON[m[1]];
    number = Number(m[2]);
    modicon = true;
    if (m[3] !== undefined) bit = Number(m[3]);
  }
  if (bit !== null && bit > 15) return { error: 'E_ADDR_SYNTAX' };
  // kiểu và vùng
  const bitArea = area === 'IR' || area === 'HR';
  if (bit !== null) {
    if (!bitArea || rawType !== 'BOOL') return { error: 'E_ADDR_AREA' };
  } else if (area === 'C' || area === 'DI') {
    if (rawType !== 'BOOL') return { error: 'E_ADDR_AREA' };
  } else if (rawType === 'BOOL') return { error: 'E_ADDR_AREA' };
  if ((access ?? 'R') === 'RW' && (area === 'DI' || area === 'IR')) return { error: 'E_ADDR_AREA' };
  const offset = number - addressBase;
  let registers;
  if (rawType === 'STRING') registers = Math.ceil(stringLength / 2);
  else if (area === 'C' || area === 'DI') registers = 1;
  else registers = REGS[rawType];
  if (offset < 0 || offset > 65535 || offset + registers > 65536) return { error: 'E_ADDR_RANGE' };
  const out = { normalized: up, area, ...AREA[area], offset, registers, bit };
  if (modicon && addressBase === 0) out.warnings = ['W_ADDR_MODICON_BASE0'];
  return out;
}

const addr = [];
const A = (name, address, rawType, addressBase = 1, extra = {}) => {
  const c = { name, address, addressBase, rawType, ...extra };
  addr.push({ ...c, expect: refAddress(c) });
};
// dạng vùng
A('hr100-base1', 'HR100', 'INT16');
A('hr100-base0', 'HR100', 'INT16', 0);
A('hr1-base1', 'HR1', 'INT16');
A('hr0-base0', 'HR0', 'UINT16', 0);
A('hr0-base1-range', 'HR0', 'INT16');
A('ir5', 'IR5', 'FLOAT32');
A('c12', 'C12', 'BOOL');
A('c12-base0', 'C12', 'BOOL', 0);
A('di0-base0', 'DI0', 'BOOL', 0);
A('di1-base1', 'DI1', 'BOOL');
A('hr12-bit3', 'HR12.3', 'BOOL');
A('ir7-bit15', 'IR7.15', 'BOOL');
A('hr12-bit0', 'HR12.0', 'BOOL');
A('hr-leading-zeros', 'HR00100', 'INT16');
A('hr-5digits', 'HR65535', 'INT16');
A('lowercase-hr', 'hr100', 'INT16');
A('lowercase-di-bit', 'ir7.3', 'BOOL');
A('mixed-case', 'Hr100', 'INT16');
// Modicon
A('modicon-40001-base1', '40001', 'INT16');
A('modicon-40001-base0-warning', '40001', 'INT16', 0);
A('modicon-40101-base1', '40101', 'FLOAT32');
A('modicon-400101-6digits', '400101', 'FLOAT32');
A('modicon-30013', '30013', 'FLOAT32');
A('modicon-300013-6digits', '300013', 'UINT16');
A('modicon-00012-coil', '00012', 'BOOL');
A('modicon-000012-coil', '000012', 'BOOL');
A('modicon-10001-di', '10001', 'BOOL');
A('modicon-100001-di', '100001', 'BOOL');
A('modicon-40012-bit', '40012.5', 'BOOL');
A('modicon-30012-bit', '30012.5', 'BOOL');
A('modicon-00012-base0', '00012', 'BOOL', 0);
A('modicon-49999-max5', '49999', 'INT16');
A('modicon-465536-6digits-base1', '465536', 'INT16');
A('modicon-465537-6digits-range', '465537', 'INT16');
A('modicon-465535-base0', '465535', 'INT16', 0);
A('modicon-499999-range', '499999', 'INT16');
A('modicon-40000-base1-range', '40000', 'INT16');
A('modicon-40000-base0', '40000', 'INT16', 0);
// số thanh ghi theo kiểu
for (const [t, n] of Object.entries(REGS).filter(([t]) => t !== 'BOOL'))
  A(`regs-${t}`, 'HR10', t, 1, { expectRegs: n });
A('regs-string-16', 'HR300', 'STRING', 1, { stringLength: 16 });
A('regs-string-odd-5', 'HR300', 'STRING', 1, { stringLength: 5 });
A('regs-string-250', 'HR300', 'STRING', 1, { stringLength: 250 });
A('regs-string-at-end', 'HR65531', 'STRING', 1, { stringLength: 10 });
A('regs-string-over-end', 'HR65532', 'STRING', 1, { stringLength: 10 });
// biên khoảng
A('hr65536-base1-edge', 'HR65536', 'INT16');
A('hr65536-base0-range', 'HR65536', 'INT16', 0);
A('hr65535-base0-last', 'HR65535', 'INT16', 0);
A('hr65535-base0-int32-range', 'HR65535', 'INT32', 0);
A('hr65535-base0-int32-base1', 'HR65535', 'INT32');
A('hr65535-base1-int32-last', 'HR65535', 'INT32', 1);
A('hr65535-base1-int32-range', 'HR65536', 'INT32', 1);
A('hr65534-base0-int32', 'HR65534', 'INT32', 0);
A('hr65533-base0-int64-last', 'HR65532', 'INT64', 0);
A('hr65533-base0-int64-range', 'HR65533', 'INT64', 0);
A('c65535-base0-last', 'C65535', 'BOOL', 0);
A('c65536-base0-range', 'C65536', 'BOOL', 0);
A('c65536-base1-last', 'C65536', 'BOOL', 1);
A('c65537-base1-range', 'C65537', 'BOOL', 1);
// lỗi cú pháp
for (const [n, s] of [
  ['empty', ''],
  ['space-leading', ' HR1'],
  ['space-trailing', 'HR1 '],
  ['space-inside', 'HR 1'],
  ['no-number', 'HR'],
  ['unknown-area', 'XR100'],
  ['bad-char', 'HR1A'],
  ['six-digits-area', 'HR100000'],
  ['negative', 'HR-1'],
  ['dot-no-bit', 'HR12.'],
  ['dot-dot', 'HR12..3'],
  ['bit-three-digits', 'HR12.100'],
  ['bit-16', 'HR12.16'],
  ['bit-99', 'HR12.99'],
  ['modicon-3digits', '400'],
  ['modicon-4digits', '4000'],
  ['modicon-7digits', '4000001'],
  ['modicon-first-digit-2', '20001'],
  ['modicon-first-digit-5', '50001'],
  ['modicon-first-digit-9', '90001'],
  ['hex', '0x10'],
  ['arabic-indic-digits', 'HR١٢'],
  ['fullwidth-digits', 'HR１２'],
  ['two-areas', 'HRC1'],
  ['percent', '%MW100'],
  ['s7-style', 'DB1.DBW0'],
  ['modicon-with-letters', '4000A'],
  ['tab', 'HR1\t'],
  ['newline', 'HR1\n'],
  ['float', 'HR1.5.2'],
])
  A(`syntax-${n}`, s, 'INT16');
// lỗi vùng
A('area-bool-hr-no-bit', 'HR100', 'BOOL');
A('area-bool-ir-no-bit', 'IR100', 'BOOL');
A('area-bool-modicon-4-no-bit', '40100', 'BOOL');
A('area-number-c', 'C12', 'INT16');
A('area-number-di', 'DI12', 'FLOAT32');
A('area-string-c', 'C12', 'STRING', 1, { stringLength: 4 });
A('area-bit-on-c', 'C12.1', 'BOOL');
A('area-bit-on-di', 'DI12.1', 'BOOL');
A('area-bit-modicon-coil', '00012.1', 'BOOL');
A('area-bit-modicon-di', '10012.1', 'BOOL');
A('area-bit-non-bool', 'HR12.3', 'INT16');
A('area-rw-di', 'DI1', 'BOOL', 1, { access: 'RW' });
A('area-rw-ir', 'IR1', 'INT16', 1, { access: 'RW' });
A('area-rw-modicon-3', '30001', 'INT16', 1, { access: 'RW' });
A('area-rw-modicon-1', '10001', 'BOOL', 1, { access: 'RW' });
A('area-rw-hr-ok', 'HR1', 'INT16', 1, { access: 'RW' });
A('area-rw-c-ok', 'C1', 'BOOL', 1, { access: 'RW' });
A('area-rw-hr-bit-ok', 'HR1.2', 'BOOL', 1, { access: 'RW' });
A('area-r-ir-ok', 'IR1', 'INT16', 1, { access: 'R' });
// kiểm: expectRegs của vòng kiểu số (tự kiểm)
for (const c of addr)
  if (c.expectRegs !== undefined && c.expect.registers !== c.expectRegs)
    throw new Error(`regs ${c.name}`);
for (const c of addr) delete c.expectRegs;
writeCases('address.json', addr);

// ======================================================================================
// numeric.json
// { name, type, byteOrder, registers: [hex], expect: { value } | { invalid: "INVALID_VALUE" }, encode: bool }
// Giải mã (registers -> value) luôn kiểm. `encode: true`: mã hóa value với cùng kiểu và thứ tự phải ra
// đúng `registers` (dùng cho giá trị biểu diễn được và không phải NaN/vô cực/số chuẩn hóa khác).
// ======================================================================================
const WORDS = {
  INT16: 1,
  UINT16: 1,
  INT32: 2,
  UINT32: 2,
  FLOAT32: 2,
  INT64: 4,
  UINT64: 4,
  FLOAT64: 4,
};
/** Dãy byte lớn trước -> mảng thanh ghi theo thứ tự byte. */
function bytesToRegs(bytes, order) {
  const n = bytes.length / 2;
  let words = [];
  for (let i = 0; i < n; i++) words.push([bytes[2 * i], bytes[2 * i + 1]]);
  if (n > 1) {
    if (order === 'CDAB' || order === 'DCBA') words = [...words].reverse();
    if (order === 'BADC' || order === 'DCBA') words = words.map(([a, b]) => [b, a]);
  }
  return words.map(([a, b]) => (a << 8) | b);
}
function refEncode(type, order, v) {
  const buf = Buffer.alloc(WORDS[type] * 2);
  if (type === 'INT16') buf.writeInt16BE(v);
  else if (type === 'UINT16') buf.writeUInt16BE(v);
  else if (type === 'INT32') buf.writeInt32BE(v);
  else if (type === 'UINT32') buf.writeUInt32BE(v);
  else if (type === 'FLOAT32') buf.writeFloatBE(v);
  else if (type === 'INT64') buf.writeBigInt64BE(BigInt(v));
  else if (type === 'UINT64') buf.writeBigUInt64BE(BigInt(v));
  else buf.writeDoubleBE(v);
  return bytesToRegs([...buf], order).map(hex4);
}
function refDecode(type, order, regsHex) {
  let words = regsHex.map((h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2), 16)]);
  if (words.length > 1) {
    if (order === 'BADC' || order === 'DCBA') words = words.map(([a, b]) => [b, a]);
    if (order === 'CDAB' || order === 'DCBA') words = [...words].reverse();
  }
  const buf = Buffer.from(words.flat());
  switch (type) {
    case 'INT16':
      return buf.readInt16BE();
    case 'UINT16':
      return buf.readUInt16BE();
    case 'INT32':
      return buf.readInt32BE();
    case 'UINT32':
      return buf.readUInt32BE();
    case 'FLOAT32':
      return buf.readFloatBE();
    case 'INT64':
      return buf.readBigInt64BE().toString();
    case 'UINT64':
      return buf.readBigUInt64BE().toString();
    default:
      return buf.readDoubleBE();
  }
}
const num = [];
const ORDERS = ['ABCD', 'CDAB', 'BADC', 'DCBA'];
const N = (name, type, order, regs, { encode = true } = {}) => {
  const v = refDecode(type, order, regs);
  const invalid = typeof v === 'number' && !Number.isFinite(v);
  const c = {
    name,
    type,
    byteOrder: order,
    registers: regs,
    expect: invalid ? { invalid: 'INVALID_VALUE' } : { value: v },
    encode: encode && !invalid,
  };
  if (c.encode && JSON.stringify(refEncode(type, order, v)) !== JSON.stringify(regs))
    throw new Error(`numeric ${name}: mã hóa không khứ hồi`);
  num.push(c);
};
// Mọi kiểu x 4 thứ tự với một giá trị "khó đoán" (byte khác nhau)
const SAMPLE = {
  INT16: [0x0102],
  UINT16: [0xfedc],
  INT32: [0x0102, 0x0304],
  UINT32: [0xdead, 0xbeef],
  FLOAT32: [0x42f6, 0xe979],
  INT64: [0x0102, 0x0304, 0x0506, 0x0708],
  UINT64: [0xfedc, 0xba98, 0x7654, 0x3210],
  FLOAT64: [0x4009, 0x21fb, 0x5444, 0x2d18],
};
for (const [t, regs] of Object.entries(SAMPLE))
  for (const o of ORDERS)
    N(`sample-${t}-${o}`, t, o, regs.map(hex4), { encode: WORDS[t] > 1 || o === 'ABCD' });
// 16 bit: thứ tự byte không ảnh hưởng (luôn lớn trước)
for (const t of ['INT16', 'UINT16'])
  for (const o of ORDERS) N(`order-ignored-${t}-${o}`, t, o, ['1234'], { encode: true });
// Ví dụ của contract: FLOAT32 123,456 = 42F6E979 và INT64 0x0102030405060708
{
  const f32 = Math.fround(123.456);
  for (const o of ORDERS) {
    const regs = refEncode('FLOAT32', o, f32);
    N(`contract-FLOAT32-123.456-${o}`, 'FLOAT32', o, regs);
  }
  const expectF = {
    ABCD: ['42F6', 'E979'],
    CDAB: ['E979', '42F6'],
    BADC: ['F642', '79E9'],
    DCBA: ['79E9', 'F642'],
  };
  for (const o of ORDERS)
    if (JSON.stringify(refEncode('FLOAT32', o, f32)) !== JSON.stringify(expectF[o]))
      throw new Error('contract f32 ' + o);
  const expectI = {
    ABCD: ['0102', '0304', '0506', '0708'],
    CDAB: ['0708', '0506', '0304', '0102'],
    BADC: ['0201', '0403', '0605', '0807'],
    DCBA: ['0807', '0605', '0403', '0201'],
  };
  for (const o of ORDERS) {
    if (JSON.stringify(refEncode('INT64', o, '72623859790382856')) !== JSON.stringify(expectI[o]))
      throw new Error('contract i64 ' + o);
    N(`contract-INT64-0x0102030405060708-${o}`, 'INT64', o, expectI[o]);
  }
}
// Biên khoảng của từng kiểu
const edges = {
  INT16: ['8000', '7FFF', '0000', 'FFFF', '0001'],
  UINT16: ['0000', 'FFFF', '8000', '7FFF'],
  INT32: [
    ['8000', '0000'],
    ['7FFF', 'FFFF'],
    ['0000', '0000'],
    ['FFFF', 'FFFF'],
  ],
  UINT32: [
    ['0000', '0000'],
    ['FFFF', 'FFFF'],
    ['8000', '0000'],
  ],
  INT64: [
    ['8000', '0000', '0000', '0000'],
    ['7FFF', 'FFFF', 'FFFF', 'FFFF'],
    ['0000', '0000', '0000', '0000'],
    ['FFFF', 'FFFF', 'FFFF', 'FFFF'],
    ['0020', '0000', '0000', '0001'],
    ['0020', '0000', '0000', '0000'],
  ],
  UINT64: [
    ['0000', '0000', '0000', '0000'],
    ['FFFF', 'FFFF', 'FFFF', 'FFFF'],
    ['8000', '0000', '0000', '0000'],
    ['0020', '0000', '0000', '0001'],
  ],
  FLOAT32: [
    ['0000', '0000'], // +0
    ['8000', '0000'], // -0
    ['0000', '0001'], // số nhỏ nhất (denormal)
    ['0080', '0000'], // nhỏ nhất chuẩn hóa
    ['7F7F', 'FFFF'], // lớn nhất
    ['FF7F', 'FFFF'],
    ['3F80', '0000'],
    ['BF80', '0000'],
    ['3DCC', 'CCCD'], // 0,1
  ],
  FLOAT64: [
    ['0000', '0000', '0000', '0000'],
    ['8000', '0000', '0000', '0000'],
    ['0000', '0000', '0000', '0001'],
    ['0010', '0000', '0000', '0000'],
    ['7FEF', 'FFFF', 'FFFF', 'FFFF'],
    ['FFEF', 'FFFF', 'FFFF', 'FFFF'],
    ['3FF0', '0000', '0000', '0000'],
    ['3FB9', '9999', '9999', '999A'], // 0,1
  ],
};
for (const [t, list] of Object.entries(edges))
  list.forEach((regsAbcd, i) => {
    const regs = Array.isArray(regsAbcd) ? regsAbcd : [regsAbcd];
    for (const o of ORDERS) {
      // regs là dạng ABCD; đổi sang thứ tự `o` bằng cách mã hóa lại giá trị ABCD
      const v = refDecode(t, 'ABCD', regs);
      N(`edge-${t}-${i}-${o}`, t, o, refEncode(t, o, v));
    }
  });
// NaN và vô cực (chỉ giải mã): BAD INVALID_VALUE
for (const [n, regs] of Object.entries({
  'f32-nan-quiet': ['7FC0', '0000'],
  'f32-nan-signalling': ['7F80', '0001'],
  'f32-nan-negative': ['FFC0', '0000'],
  'f32-inf-pos': ['7F80', '0000'],
  'f32-inf-neg': ['FF80', '0000'],
}))
  for (const o of ORDERS)
    N(
      `invalid-${n}-${o}`,
      'FLOAT32',
      o,
      bytesToRegs(Buffer.from(regs.join(''), 'hex'), o).map(hex4),
    );
for (const [n, regs] of Object.entries({
  'f64-nan-quiet': ['7FF8', '0000', '0000', '0000'],
  'f64-nan-signalling': ['7FF0', '0000', '0000', '0001'],
  'f64-inf-pos': ['7FF0', '0000', '0000', '0000'],
  'f64-inf-neg': ['FFF0', '0000', '0000', '0000'],
}))
  for (const o of ORDERS)
    N(
      `invalid-${n}-${o}`,
      'FLOAT64',
      o,
      bytesToRegs(Buffer.from(regs.join(''), 'hex'), o).map(hex4),
    );
writeCases('numeric.json', num);

// ======================================================================================
// string.json
// decode: { name, length, byteOrder: "AB"|"BA", registers, expect: { text } }
// encode: { name, length, byteOrder, text, expect: { registers } | { error: "STRING_TOO_LONG" } }
// ======================================================================================
function refUtf8Decode(bytes) {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCodePoint(b);
      i++;
      continue;
    }
    let need;
    let cp;
    let min;
    if (b >= 0xc2 && b <= 0xdf) [need, cp, min] = [1, b & 0x1f, 0x80];
    else if (b >= 0xe0 && b <= 0xef) [need, cp, min] = [2, b & 0x0f, 0x800];
    else if (b >= 0xf0 && b <= 0xf4) [need, cp, min] = [3, b & 0x07, 0x10000];
    else {
      out += '�';
      i++;
      continue;
    }
    let valid = true;
    for (let j = 1; j <= need; j++) {
      if (i + j >= bytes.length || (bytes[i + j] & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      cp = (cp << 6) | (bytes[i + j] & 0x3f);
    }
    if (valid && (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))) valid = false;
    if (!valid) {
      out += '�';
      i++;
      continue;
    }
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}
function strBytes(regsHex, order) {
  const bytes = [];
  for (const h of regsHex) {
    const hi = parseInt(h.slice(0, 2), 16);
    const lo = parseInt(h.slice(2), 16);
    if (order === 'AB') bytes.push(hi, lo);
    else bytes.push(lo, hi);
  }
  return bytes;
}
function refStrDecode(length, order, regsHex) {
  let bytes = strBytes(regsHex, order).slice(0, length);
  const z = bytes.indexOf(0);
  if (z >= 0) bytes = bytes.slice(0, z);
  return refUtf8Decode(bytes);
}
function refStrEncode(length, order, text) {
  const bytes = [...Buffer.from(text, 'utf8')];
  if (bytes.length > length) return { error: 'STRING_TOO_LONG' };
  const total = Math.ceil(length / 2) * 2;
  while (bytes.length < total) bytes.push(0);
  const regs = [];
  for (let i = 0; i < total; i += 2)
    regs.push(
      hex4(order === 'AB' ? (bytes[i] << 8) | bytes[i + 1] : (bytes[i + 1] << 8) | bytes[i]),
    );
  return { registers: regs };
}
const strCases = [];
const D = (name, length, order, regs) =>
  strCases.push({
    name,
    kind: 'decode',
    length,
    byteOrder: order,
    registers: regs,
    expect: { text: refStrDecode(length, order, regs) },
  });
const E = (name, length, order, text) =>
  strCases.push({
    name,
    kind: 'encode',
    length,
    byteOrder: order,
    text,
    expect: refStrEncode(length, order, text),
  });
// "Bơm 1" của contract
D('contract-AB', 8, 'AB', ['42C6', 'A16D', '2031', '0000']);
D('contract-BA', 8, 'BA', ['C642', '6DA1', '3120', '0000']);
E('contract-AB-encode', 8, 'AB', 'Bơm 1');
E('contract-BA-encode', 8, 'BA', 'Bơm 1');
if (
  JSON.stringify(refStrEncode(8, 'AB', 'Bơm 1').registers) !==
  JSON.stringify(['42C6', 'A16D', '2031', '0000'])
)
  throw new Error('contract string AB');
if (
  JSON.stringify(refStrEncode(8, 'BA', 'Bơm 1').registers) !==
  JSON.stringify(['C642', '6DA1', '3120', '0000'])
)
  throw new Error('contract string BA');
// thông thường
D('ascii-full', 4, 'AB', ['4142', '4344']);
D('ascii-full-BA', 4, 'BA', ['4241', '4443']);
D('ascii-short-zero-padded', 8, 'AB', ['4142', '4300', '0000', '0000']);
D('empty-all-zero', 6, 'AB', ['0000', '0000', '0000']);
D('zero-in-the-middle-stops', 6, 'AB', ['4100', '4243', '4445']);
D('zero-first-byte', 4, 'AB', ['0041', '4243']);
D('odd-length-ignores-padding-byte', 5, 'AB', ['4142', '4344', '4500']);
D('odd-length-padding-nonzero-ignored', 5, 'AB', ['4142', '4344', '45FF']);
D('odd-length-padding-nonzero-BA', 5, 'BA', ['4241', '4443', 'FF45']);
D('odd-length-1', 1, 'AB', ['4100']);
D('odd-length-1-padding-nonzero', 1, 'AB', ['41FF']);
D('length-shorter-than-registers', 2, 'AB', ['4142', '4344']);
D('vietnamese', 16, 'AB', ['4DE1', 'BBA9', '6320', '6EC6', 'B0E1', 'BB9B', '6300', '0000']);
D('vietnamese-diacritics', 12, 'AB', ['C490', 'C3A9', '6E20', '7468', 'C3B4', '6E67']);
D('supplementary-emoji', 6, 'AB', ['F09F', '9880', '4100']);
// UTF-8 lỗi: mỗi byte lỗi thành một U+FFFD
D('invalid-lone-ff', 4, 'AB', ['41FF', '4200']);
D('invalid-lone-continuation', 4, 'AB', ['4180', '4200']);
D('invalid-truncated-3-byte', 4, 'AB', ['41E1', 'BB42']);
D('invalid-truncated-at-end', 4, 'AB', ['4142', 'E1BB']);
D('invalid-truncated-4-byte-at-end', 4, 'AB', ['4142', 'F09F']);
D('invalid-overlong-2-byte', 4, 'AB', ['C080', '4100']);
D('invalid-overlong-3-byte', 4, 'AB', ['E080', '80FF']);
D('invalid-surrogate', 4, 'AB', ['EDA0', '8041']);
D('invalid-over-10ffff', 4, 'AB', ['F490', '8080']);
D('invalid-c0-c1', 4, 'AB', ['C0C1', '4100']);
D('invalid-f5', 4, 'AB', ['F541', '0000']);
D('invalid-bom-not-special', 4, 'AB', ['EFBB', 'BF41']);
D('invalid-then-valid', 6, 'AB', ['FFC3', 'A941', '0000']);
// ghi
E('write-empty', 4, 'AB', '');
E('write-ascii-fits-exactly', 4, 'AB', 'ABCD');
E('write-ascii-short', 8, 'AB', 'AB');
E('write-ascii-short-BA', 8, 'BA', 'AB');
E('write-odd-length', 5, 'AB', 'abcd');
E('write-odd-length-exact', 5, 'AB', 'abcde');
E('write-odd-length-BA', 5, 'BA', 'abcde');
E('write-length-1', 1, 'AB', 'x');
E('write-vietnamese', 16, 'AB', 'Mức nước');
E('write-vietnamese-BA', 16, 'BA', 'Mức nước');
E('write-emoji', 6, 'AB', '😀A');
E('write-too-long-by-one', 4, 'AB', 'ABCDE');
E('write-too-long-multibyte', 5, 'AB', 'ơơơ');
E('write-multibyte-exact', 6, 'AB', 'ơơơ');
E('write-too-long-odd', 5, 'AB', 'abcdef');
E('write-max-246', 246, 'AB', 'x'.repeat(246));
E('write-max-246-too-long', 246, 'AB', 'x'.repeat(247));
E('write-max-250', 250, 'AB', 'ệ'.repeat(83));
writeCases('string.json', strCases);

// ======================================================================================
// scaling.json: { "read": [...], "write": [...] }
// read:  { name, scaling, rawType, tagType, raw, expect: { value, quality, reason? } }
//        raw: số, hoặc chuỗi thập phân cho INT64/UINT64
// write: { name, scaling, rawType, tagType, eng, expect: { raw } | { error } }  (raw: số, hoặc chuỗi cho 64 bit)
// ======================================================================================
const INT = {
  INT16: [-(2n ** 15n), 2n ** 15n - 1n],
  UINT16: [0n, 2n ** 16n - 1n],
  INT32: [-(2n ** 31n), 2n ** 31n - 1n],
  UINT32: [0n, 2n ** 32n - 1n],
  INT64: [-(2n ** 63n), 2n ** 63n - 1n],
  UINT64: [0n, 2n ** 64n - 1n],
};
function refRound(x) {
  const r = Math.trunc(x);
  return Math.abs(x - r) >= 0.5 ? r + (x > 0 ? 1 : -1) : r;
}
function refScaleRead(sc, rawType, tagType, raw) {
  const x = Number(raw);
  const lo = Math.min(sc.rawMin, sc.rawMax);
  const hi = Math.max(sc.rawMin, sc.rawMax);
  let eng;
  let clamped = false;
  if (sc.clamp && x < lo) {
    eng = sc.rawMin < sc.rawMax ? sc.engMin : sc.engMax;
    clamped = true;
  } else if (sc.clamp && x > hi) {
    eng = sc.rawMin < sc.rawMax ? sc.engMax : sc.engMin;
    clamped = true;
  } else eng = sc.engMin + ((x - sc.rawMin) * (sc.engMax - sc.engMin)) / (sc.rawMax - sc.rawMin);
  if (tagType === 'FLOAT32') eng = Math.fround(eng);
  if (eng === 0) eng = 0;
  return clamped
    ? { value: eng, quality: 'UNCERTAIN', reason: 'CLAMPED' }
    : { value: eng, quality: 'GOOD' };
}
function refScaleWrite(sc, rawType, eng) {
  if (!Number.isFinite(eng)) return { error: 'NOT_FINITE' };
  let x = sc.rawMin + ((eng - sc.engMin) * (sc.rawMax - sc.rawMin)) / (sc.engMax - sc.engMin);
  if (!Number.isFinite(x)) return { error: 'OUT_OF_RAW_RANGE' };
  if (rawType === 'FLOAT32') {
    x = Math.fround(x);
    return Number.isFinite(x) ? { raw: x === 0 ? 0 : x } : { error: 'OUT_OF_RAW_RANGE' };
  }
  if (rawType === 'FLOAT64') return { raw: x === 0 ? 0 : x };
  const b = BigInt(refRound(x));
  const [lo, hi] = INT[rawType];
  if (b < lo || b > hi) return { error: 'OUT_OF_RAW_RANGE' };
  return { raw: rawType === 'INT64' || rawType === 'UINT64' ? b.toString() : Number(b) };
}
const reads = [];
const writes = [];
const std = { rawMin: 0, rawMax: 27648, engMin: 0, engMax: 100 };
const R = (name, sc, rawType, tagType, raw) =>
  reads.push({
    name,
    scaling: sc,
    rawType,
    tagType,
    raw,
    expect: refScaleRead(sc, rawType, tagType, raw),
  });
const W = (name, sc, rawType, tagType, eng) =>
  writes.push({
    name,
    scaling: sc,
    rawType,
    tagType,
    eng,
    expect: refScaleWrite(sc, rawType, eng),
  });
// US1-10
R('us1-10-half', std, 'INT16', 'FLOAT32', 13824);
R('us1-10-zero', std, 'INT16', 'FLOAT32', 0);
R('us1-10-full', std, 'INT16', 'FLOAT32', 27648);
R('us1-10-quarter', std, 'INT16', 'FLOAT64', 6912);
R('us1-10-third-float32', std, 'INT16', 'FLOAT32', 9216);
R('us1-10-third-float64', std, 'INT16', 'FLOAT64', 9217);
R('extrapolate-above', std, 'INT16', 'FLOAT32', 30000);
R('extrapolate-below', std, 'INT16', 'FLOAT32', -1000);
R('clamp-above', { ...std, clamp: true }, 'INT16', 'FLOAT32', 30000);
R('clamp-below', { ...std, clamp: true }, 'INT16', 'FLOAT32', -1);
R('clamp-at-low-bound', { ...std, clamp: true }, 'INT16', 'FLOAT32', 0);
R('clamp-at-high-bound', { ...std, clamp: true }, 'INT16', 'FLOAT32', 27648);
R('clamp-inside', { ...std, clamp: true }, 'INT16', 'FLOAT32', 100);
R('clamp-false-explicit', { ...std, clamp: false }, 'INT16', 'FLOAT32', 30000);
// 4–20 mA đảo chiều và khoảng âm
const inv = { rawMin: 27648, rawMax: 0, engMin: 0, engMax: 100, clamp: true };
R('reversed-raw-mid', inv, 'INT16', 'FLOAT32', 13824);
R('reversed-raw-clamp-above-low', inv, 'INT16', 'FLOAT32', 30000);
R('reversed-raw-clamp-below', inv, 'INT16', 'FLOAT32', -5);
const invEng = { rawMin: 0, rawMax: 1000, engMin: 100, engMax: -100, clamp: true };
R('reversed-eng-mid', invEng, 'UINT16', 'FLOAT64', 250);
R('reversed-eng-clamp', invEng, 'UINT16', 'FLOAT64', 2000);
R(
  'mA-4-20',
  { rawMin: 4, rawMax: 20, engMin: 0, engMax: 6.5, clamp: true },
  'FLOAT32',
  'FLOAT32',
  12.5,
);
R(
  'mA-4-20-low',
  { rawMin: 4, rawMax: 20, engMin: 0, engMax: 6.5, clamp: true },
  'FLOAT32',
  'FLOAT32',
  3.5,
);
R(
  'negative-range',
  { rawMin: -32768, rawMax: 32767, engMin: -50, engMax: 150 },
  'INT16',
  'FLOAT64',
  0,
);
R('uint16-to-float', { rawMin: 0, rawMax: 65535, engMin: 0, engMax: 1 }, 'UINT16', 'FLOAT64', 1);
R(
  'uint32-large',
  { rawMin: 0, rawMax: 4294967295, engMin: 0, engMax: 1000 },
  'UINT32',
  'FLOAT64',
  2147483648,
);
R(
  'int64-string',
  { rawMin: 0, rawMax: 1000000, engMin: 0, engMax: 1 },
  'INT64',
  'FLOAT64',
  '500000',
);
R(
  'int64-large-loses-precision',
  { rawMin: 0, rawMax: 1e18, engMin: 0, engMax: 1 },
  'INT64',
  'FLOAT64',
  '9007199254740993',
);
R(
  'uint64-max',
  { rawMin: 0, rawMax: 1e19, engMin: 0, engMax: 1, clamp: true },
  'UINT64',
  'FLOAT64',
  '18446744073709551615',
);
R(
  'uint64-beyond-clamp',
  { rawMin: 0, rawMax: 1e18, engMin: 0, engMax: 1, clamp: true },
  'UINT64',
  'FLOAT64',
  '18446744073709551615',
);
R(
  'float32-raw',
  { rawMin: 0, rawMax: 10, engMin: 0, engMax: 100 },
  'FLOAT32',
  'FLOAT64',
  Math.fround(3.3),
);
R(
  'float64-raw-tag-float32',
  { rawMin: 0, rawMax: 3, engMin: 0, engMax: 1 },
  'FLOAT64',
  'FLOAT32',
  1,
);
R('neg-zero-normalized', { rawMin: -10, rawMax: 10, engMin: -1, engMax: 1 }, 'INT16', 'FLOAT64', 0);
R('order-of-operations', { rawMin: 1, rawMax: 3, engMin: 0.1, engMax: 0.7 }, 'INT16', 'FLOAT64', 2);
R('tiny-span', { rawMin: 0, rawMax: 1, engMin: 0, engMax: 1e-300 }, 'INT16', 'FLOAT64', 1);
// ghi
W('us1-10-half', std, 'INT16', 'FLOAT32', 50);
W('us1-10-zero', std, 'INT16', 'FLOAT32', 0);
W('us1-10-full', std, 'INT16', 'FLOAT32', 100);
W('round-half-up', { rawMin: 0, rawMax: 10, engMin: 0, engMax: 10 }, 'INT16', 'FLOAT64', 2.5);
W(
  'round-half-negative',
  { rawMin: 0, rawMax: 10, engMin: 0, engMax: 10 },
  'INT16',
  'FLOAT64',
  -2.5,
);
W(
  'round-just-below-half',
  { rawMin: 0, rawMax: 10, engMin: 0, engMax: 10 },
  'INT16',
  'FLOAT64',
  0.49999999999999994,
);
W('round-quarter', std, 'INT16', 'FLOAT32', 33.33);
W('above-raw-type-range', std, 'INT16', 'FLOAT32', 200);
W('below-raw-type-range', std, 'INT16', 'FLOAT32', -200);
W(
  'exactly-int16-max',
  { rawMin: 0, rawMax: 32767, engMin: 0, engMax: 100 },
  'INT16',
  'FLOAT64',
  100,
);
W(
  'just-over-int16-max',
  { rawMin: 0, rawMax: 32767, engMin: 0, engMax: 100 },
  'INT16',
  'FLOAT64',
  100.0016,
);
W(
  'rounds-to-int16-max',
  { rawMin: 0, rawMax: 32767, engMin: 0, engMax: 100 },
  'INT16',
  'FLOAT64',
  100.0015,
);
W(
  'uint16-negative',
  { rawMin: 0, rawMax: 1000, engMin: 0, engMax: 1000 },
  'UINT16',
  'FLOAT64',
  -0.6,
);
W(
  'uint16-negative-rounds-to-zero',
  { rawMin: 0, rawMax: 1000, engMin: 0, engMax: 1000 },
  'UINT16',
  'FLOAT64',
  -0.4,
);
W(
  'uint16-over',
  { rawMin: 0, rawMax: 1000, engMin: 0, engMax: 1000 },
  'UINT16',
  'FLOAT64',
  65535.5,
);
W('reversed-raw', inv, 'INT16', 'FLOAT32', 25);
W('reversed-eng', invEng, 'UINT16', 'FLOAT64', 0);
W('int32-edge', { rawMin: 0, rawMax: 1, engMin: 0, engMax: 1 }, 'INT32', 'FLOAT64', 2147483647);
W('int32-over', { rawMin: 0, rawMax: 1, engMin: 0, engMax: 1 }, 'INT32', 'FLOAT64', 2147483647.5);
W('uint32-edge', { rawMin: 0, rawMax: 1, engMin: 0, engMax: 1 }, 'UINT32', 'FLOAT64', 4294967295);
W('uint32-over', { rawMin: 0, rawMax: 1, engMin: 0, engMax: 1 }, 'UINT32', 'FLOAT64', 4294967295.5);
W(
  'int64-exact',
  { rawMin: 0, rawMax: 1, engMin: 0, engMax: 1 },
  'INT64',
  'FLOAT64',
  9007199254740992,
);
W(
  'int64-max-double-is-2pow63',
  { rawMin: 0, rawMax: 1, engMin: 0, engMax: 1 },
  'INT64',
  'FLOAT64',
  2 ** 63,
);
W(
  'int64-below-2pow63',
  { rawMin: 0, rawMax: 1, engMin: 0, engMax: 1 },
  'INT64',
  'FLOAT64',
  9223372036854774784,
);
W(
  'int64-min',
  { rawMin: 0, rawMax: 1, engMin: 0, engMax: 1 },
  'INT64',
  'FLOAT64',
  -9223372036854775808,
);
W(
  'uint64-below-2pow64',
  { rawMin: 0, rawMax: 1, engMin: 0, engMax: 1 },
  'UINT64',
  'FLOAT64',
  18446744073709549568,
);
W('uint64-2pow64', { rawMin: 0, rawMax: 1, engMin: 0, engMax: 1 }, 'UINT64', 'FLOAT64', 2 ** 64);
W('uint64-negative', { rawMin: 0, rawMax: 1, engMin: 0, engMax: 1 }, 'UINT64', 'FLOAT64', -1);
W('float32-raw', { rawMin: 0, rawMax: 10, engMin: 0, engMax: 100 }, 'FLOAT32', 'FLOAT64', 33.3);
W(
  'float32-raw-overflow',
  { rawMin: 0, rawMax: 1, engMin: 0, engMax: 1 },
  'FLOAT32',
  'FLOAT64',
  1e39,
);
W(
  'float32-raw-neg-zero',
  { rawMin: -1, rawMax: 1, engMin: -1, engMax: 1 },
  'FLOAT32',
  'FLOAT64',
  -0.0,
);
W('float64-raw', { rawMin: 0, rawMax: 3, engMin: 0, engMax: 1 }, 'FLOAT64', 'FLOAT64', 1 / 3);
W(
  'float64-raw-overflow',
  { rawMin: 0, rawMax: 1e308, engMin: 0, engMax: 1e-10 },
  'FLOAT64',
  'FLOAT64',
  1,
);
W('not-finite-nan', std, 'INT16', 'FLOAT64', NaN);
W('not-finite-inf', std, 'INT16', 'FLOAT64', Infinity);
// NaN/Infinity viết dạng chuỗi trong JSON
for (const c of writes)
  if (typeof c.eng === 'number' && !Number.isFinite(c.eng))
    c.eng = Number.isNaN(c.eng) ? 'NaN' : c.eng > 0 ? 'Infinity' : '-Infinity';
writeFileSync(
  join(here, 'scaling.json'),
  `{\n"read": [\n${reads.map((c) => '  ' + lineJson(c)).join(',\n')}\n],\n"write": [\n${writes.map((c) => '  ' + lineJson(c)).join(',\n')}\n]\n}\n`,
);

// ======================================================================================
// bits.json
// unpack: { name, bytes: [hex2], count, expect: { bits: [0|1] } }       coil/DI đóng gói, bit thấp trước
// pack:   { name, bits: [0|1], expect: { bytes: [hex2] } }
// register: { name, reg: hex4, bit, expect: { value: bool } }            (reg >> b) & 1
// mask:   { name, bit, value, expect: { and: hex4, or: hex4 } }         mã 22: and = ~(1 << b), or = v << b
// rmw:    { name, reg, bit, value, expect: { reg: hex4 } }              đọc-sửa-ghi
// ======================================================================================
const unpack = [];
const pack = [];
const regBit = [];
const mask = [];
const rmw = [];
const refUnpack = (bytes, count) =>
  Array.from({ length: count }, (_, i) => (parseInt(bytes[i >> 3], 16) >> (i & 7)) & 1);
const refPack = (bits) => {
  const out = Array(Math.ceil(bits.length / 8)).fill(0);
  bits.forEach((b, i) => (out[i >> 3] |= b << (i & 7)));
  return out.map((v) => v.toString(16).toUpperCase().padStart(2, '0'));
};
const U = (name, bytes, count) =>
  unpack.push({ name, bytes, count, expect: { bits: refUnpack(bytes, count) } });
const P = (name, bits) => pack.push({ name, bits, expect: { bytes: refPack(bits) } });
U('one-byte-all', ['FF'], 8);
U('one-byte-low-first', ['01'], 8);
U('one-byte-high-last', ['80'], 8);
U('count-less-than-byte', ['FF'], 3);
U('count-1', ['01'], 1);
U('two-bytes', ['A5', '0F'], 16);
U('two-bytes-partial', ['A5', '03'], 10);
U('contract-example-0x4D-0x6B', ['CD', '6B', '01'], 19);
U('count-9', ['00', '01'], 9);
U('extra-bits-ignored', ['FF', 'FF'], 12);
U('zero', ['00', '00'], 16);
for (let n = 1; n <= 17; n++)
  P(
    `pack-pattern-${n}`,
    Array.from({ length: n }, (_, i) => ((i * 7 + n) % 3 === 0 ? 1 : 0)),
  );
P('pack-all-ones-8', Array(8).fill(1));
P('pack-all-ones-9', Array(9).fill(1));
P('pack-single-one', [1]);
P('pack-single-zero', [0]);
P(
  'pack-2000',
  Array.from({ length: 2000 }, (_, i) => (i % 5 === 0 ? 1 : 0)),
);
for (const [reg, b] of [
  ['0008', 3],
  ['0008', 2],
  ['FFFF', 15],
  ['8000', 15],
  ['8000', 14],
  ['0001', 0],
  ['0000', 7],
  ['FFF7', 3],
  ['1234', 2],
  ['1234', 4],
  ['ABCD', 0],
  ['ABCD', 1],
  ['ABCD', 15],
])
  regBit.push({
    name: `reg-${reg}-bit${b}`,
    reg,
    bit: b,
    expect: { value: ((parseInt(reg, 16) >> b) & 1) === 1 },
  });
for (let b = 0; b < 16; b++)
  for (const v of [false, true])
    mask.push({
      name: `mask-bit${b}-${v}`,
      bit: b,
      value: v,
      expect: { and: hex4(~(1 << b) & 0xffff), or: hex4((v ? 1 : 0) << b) },
    });
for (const [reg, b, v] of [
  ['FFFF', 3, false],
  ['0000', 3, true],
  ['FFFF', 15, false],
  ['0000', 15, true],
  ['1234', 0, true],
  ['1235', 0, false],
  ['ABCD', 7, false],
  ['ABCD', 7, true],
  ['FFF7', 3, true],
])
  rmw.push({
    name: `rmw-${reg}-bit${b}-${v}`,
    reg,
    bit: b,
    value: v,
    expect: { reg: hex4((parseInt(reg, 16) & ~(1 << b) & 0xffff) | ((v ? 1 : 0) << b)) },
  });
// mã 22 và đọc-sửa-ghi phải cho cùng kết quả: (reg & and) | or
for (const c of rmw) {
  const m = mask.find((x) => x.bit === c.bit && x.value === c.value);
  const viaMask = hex4(
    ((parseInt(c.reg, 16) & parseInt(m.expect.and, 16)) | parseInt(m.expect.or, 16)) & 0xffff,
  );
  if (viaMask !== c.expect.reg) throw new Error('mask vs rmw ' + c.name);
}
writeFileSync(
  join(here, 'bits.json'),
  `{\n"unpack": [\n${unpack.map((c) => '  ' + lineJson(c)).join(',\n')}\n],\n"pack": [\n${pack.map((c) => '  ' + lineJson(c)).join(',\n')}\n],\n"register": [\n${regBit.map((c) => '  ' + lineJson(c)).join(',\n')}\n],\n"mask": [\n${mask.map((c) => '  ' + lineJson(c)).join(',\n')}\n],\n"rmw": [\n${rmw.map((c) => '  ' + lineJson(c)).join(',\n')}\n]\n}\n`,
);

console.log(
  `codec-vectors: address ${addr.length}, numeric ${num.length}, string ${strCases.length}, scaling ${reads.length + writes.length}, bits ${unpack.length + pack.length + regBit.length + mask.length + rmw.length}`,
);
