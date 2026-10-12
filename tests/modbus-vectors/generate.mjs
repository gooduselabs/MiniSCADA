// Sinh bộ vector khung Modbus dùng chung C++ (drivers/modbus) và giả lập Node (tools/modbus-sim):
// specs/006-tags-modbus/contracts/modbus-driver.md §2–§4. Tài liệu chuẩn: Modbus Application Protocol
// V1.1b3, Modbus over Serial Line V1.02. Tất định, không phụ thuộc gói ngoài.
//
//   node tests/modbus-vectors/generate.mjs
//
// Ra trong frames/ (hex viết hoa, các byte cách nhau một dấu cách):
// - pdu.json:        { name, fc, request, response }                        PDU (không có địa chỉ, MBAP, CRC)
// - mbap.json:       { name, tid, unit, request, response }                  ADU Modbus TCP (MBAP + PDU)
// - rtu.json:        { name, unit, request, response }                       ADU RTU (địa chỉ + PDU + CRC thấp trước)
// - crc.json:        { name, data, crc }                                    CRC-16/MODBUS: `crc` là hai byte theo thứ tự gửi
// - exceptions.json: { name, fc, code, pdu }                                 phản hồi exception (fc | 0x80, mã)
// - bad-tcp.json:    { name, request: { tid, unit, pdu }, response, expect: { kind, counter } } | { ..., expect: "ok" }
// - bad-rtu.json:    { name, request: { unit, pdu }, response, expect: { kind, counter } } | "ok"
// - rtu-length.json: { name, head, expected }                                độ dài khung RTU mong đợi theo 2–3 byte đầu
// - limits.json:     { name, fc, qty, valid }                                giới hạn số lượng của yêu cầu
// - rtu-timing.json: { name, baud, dataBits, parity, stopBits, charBits, t35Ms }
// `kind` (loại lỗi): TCP: short, tid, protocol, length, unit, function, bytecount, format.
// RTU: short, extra, crc, unit, function, bytecount, format.
// `counter` ánh xạ sang bộ đếm khung hỏng của chẩn đoán (contract §9): crc, format, tid, unit, length, echo.
// Bộ kiểm tra tham chiếu viết riêng trong script; mọi ca lỗi được kiểm bằng nó (một ca phạm đúng một luật).
// Thứ tự kiểm TCP: dài tối thiểu, tid, giao thức, độ dài MBAP, unit, mã hàm, byte count / nhắc lại.
// Thứ tự kiểm RTU: độ dài (thiếu, thừa), CRC, địa chỉ, mã hàm, byte count / nhắc lại.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'frames');
mkdirSync(out, { recursive: true });

const hex = (bytes) => bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const parse = (text) =>
  text.trim() === ''
    ? []
    : text
        .trim()
        .split(/\s+/)
        .map((h) => parseInt(h, 16));
const u16 = (n) => [(n >> 8) & 0xff, n & 0xff];

// ---- CRC-16/MODBUS (đa thức 0xA001 đảo bit, đầu 0xFFFF) ----
function crc16(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return crc;
}
const crcBytes = (bytes) => {
  const c = crc16(bytes);
  return [c & 0xff, c >> 8]; // byte thấp trước
};
// tự kiểm hai ví dụ của tài liệu chuẩn
if (hex(crcBytes([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a])) !== 'C5 CD') throw new Error('CRC ví dụ 1');
if (hex(crcBytes([0x11, 0x03, 0x00, 0x6b, 0x00, 0x03])) !== '76 87') throw new Error('CRC ví dụ 2');

// ---- PDU ----
const rd = (fc, addr, qty) => [fc, ...u16(addr), ...u16(qty)];
const w05 = (addr, on) => [0x05, ...u16(addr), ...(on ? [0xff, 0x00] : [0x00, 0x00])];
const w06 = (addr, v) => [0x06, ...u16(addr), ...u16(v)];
const w15 = (addr, qty, data) => [0x0f, ...u16(addr), ...u16(qty), data.length, ...data];
const w16 = (addr, regs) => [
  0x10,
  ...u16(addr),
  ...u16(regs.length),
  regs.length * 2,
  ...regs.flatMap(u16),
];
const w22 = (addr, and, or) => [0x16, ...u16(addr), ...u16(and), ...u16(or)];
const resp = (fc, data) => [fc, data.length, ...data];

/** Cặp [yêu cầu, phản hồi đúng] theo chuẩn. */
const pairs = [];
const P = (name, request, response) => pairs.push({ name, fc: request[0], request, response });
// ví dụ của tài liệu chuẩn (V1.1b3 mục 6)
P('std-01-read-coils-20-56', rd(0x01, 0x13, 0x25), resp(0x01, [0xcd, 0x6b, 0xb2, 0x0e, 0x1b]));
P('std-02-read-di-197-218', rd(0x02, 0xc4, 0x16), resp(0x02, [0xac, 0xdb, 0x35]));
P('std-03-read-hr-108-110', rd(0x03, 0x6b, 0x03), resp(0x03, [0x02, 0x2b, 0x00, 0x00, 0x00, 0x64]));
P('std-04-read-ir-9', rd(0x04, 0x08, 0x01), resp(0x04, [0x00, 0x0a]));
P('std-05-write-coil-173-on', w05(0xac, true), w05(0xac, true));
P('std-06-write-hr-2', w06(0x01, 0x03), w06(0x01, 0x03));
P('std-15-write-coils-20-29', w15(0x13, 0x0a, [0xcd, 0x01]), [0x0f, ...u16(0x13), ...u16(0x0a)]);
P('std-16-write-hr-2-3', w16(0x01, [0x000a, 0x0102]), [0x10, ...u16(0x01), ...u16(0x02)]);
P('std-22-mask-write-5', w22(0x04, 0x00f2, 0x0025), w22(0x04, 0x00f2, 0x0025));
// các dạng ghi của driver (contract §8)
P('write-05-coil-off', w05(0x000a, false), w05(0x000a, false));
P('write-05-coil-max-address', w05(0xffff, true), w05(0xffff, true));
P('write-06-hr-zero', w06(0x0000, 0x0000), w06(0x0000, 0x0000));
P('write-06-hr-ffff', w06(0xffff, 0xffff), w06(0xffff, 0xffff));
P('write-15-qty1', w15(0x0010, 1, [0x01]), [0x0f, ...u16(0x10), ...u16(1)]);
P('write-15-qty8', w15(0x0010, 8, [0xa5]), [0x0f, ...u16(0x10), ...u16(8)]);
P('write-15-qty9', w15(0x0010, 9, [0xff, 0x01]), [0x0f, ...u16(0x10), ...u16(9)]);
P('write-15-qty1968', w15(0x0000, 1968, Array(246).fill(0x55)), [0x0f, ...u16(0), ...u16(1968)]);
P('write-16-qty1', w16(0x0064, [0x1234]), [0x10, ...u16(0x64), ...u16(1)]);
P('write-16-float32-abcd', w16(0x0064, [0x42f6, 0xe979]), [0x10, ...u16(0x64), ...u16(2)]);
P(
  'write-16-qty123',
  w16(
    0x0000,
    Array.from({ length: 123 }, (_, i) => i * 257),
  ),
  [0x10, ...u16(0), ...u16(123)],
);
P('write-22-set-bit3', w22(0x0010, 0xfff7, 0x0008), w22(0x0010, 0xfff7, 0x0008));
P('write-22-clear-bit15', w22(0x0010, 0x7fff, 0x0000), w22(0x0010, 0x7fff, 0x0000));
// đọc: các số lượng điển hình và biên
const bits = (n, pat) => Array.from({ length: Math.ceil(n / 8) }, (_, i) => (pat + i * 37) & 0xff);
const regs = (n) => Array.from({ length: n }, (_, i) => u16((i * 4099 + 1) & 0xffff)).flat();
P('read-01-qty1', rd(0x01, 0x0000, 1), resp(0x01, [0x01]));
P('read-01-qty8', rd(0x01, 0x0100, 8), resp(0x01, [0xa5]));
P('read-01-qty9', rd(0x01, 0x0100, 9), resp(0x01, [0xff, 0x01]));
P('read-01-qty2000', rd(0x01, 0x0000, 2000), resp(0x01, bits(2000, 0x5a)));
P('read-02-qty1', rd(0x02, 0x0007, 1), resp(0x02, [0x00]));
P('read-02-qty2000', rd(0x02, 0xf000, 2000), resp(0x02, bits(2000, 0x33)));
P('read-03-qty1', rd(0x03, 0x0063, 1), resp(0x03, regs(1)));
P('read-03-qty2-float32', rd(0x03, 0x00c7, 2), resp(0x03, [0x42, 0xf6, 0xe9, 0x79]));
P('read-03-qty4-int64', rd(0x03, 0x012b, 4), resp(0x03, [1, 2, 3, 4, 5, 6, 7, 8]));
P('read-03-qty125', rd(0x03, 0x0000, 125), resp(0x03, regs(125)));
P('read-03-max-address', rd(0x03, 0xffff, 1), resp(0x03, [0x00, 0x01]));
P('read-04-qty1', rd(0x04, 0x000c, 1), resp(0x04, regs(1)));
P('read-04-qty125', rd(0x04, 0x0010, 125), resp(0x04, regs(125)));
// xác nhận độ dài byte count của từng phản hồi (tự kiểm)
for (const p of pairs) {
  if (
    [1, 2].includes(p.fc) &&
    p.response[1] !== Math.ceil(((p.request[3] << 8) | p.request[4]) / 8)
  )
    throw new Error('bc ' + p.name);
  if ([3, 4].includes(p.fc) && p.response[1] !== 2 * ((p.request[3] << 8) | p.request[4]))
    throw new Error('bc ' + p.name);
}

const writeJson = (file, cases) =>
  writeFileSync(
    join(out, file),
    `{ "cases": [\n${cases.map((c) => '  ' + JSON.stringify(c)).join(',\n')}\n] }\n`,
  );

writeJson(
  'pdu.json',
  pairs.map((p) => ({
    name: p.name,
    fc: p.fc,
    request: hex(p.request),
    response: hex(p.response),
  })),
);

// ---- MBAP ----
const mbap = (tid, unit, pdu) => [...u16(tid), 0x00, 0x00, ...u16(pdu.length + 1), unit, ...pdu];
const rtu = (unit, pdu) => {
  const body = [unit, ...pdu];
  return [...body, ...crcBytes(body)];
};
const tcpCases = [];
const rtuCases = [];
const combos = [
  [0x0001, 1],
  [0x1234, 17],
  [0xffff, 255],
  [0x0000, 0],
  [0x8000, 247],
];
pairs.forEach((p, i) => {
  const [tid, unit] = combos[i % combos.length];
  tcpCases.push({
    name: p.name,
    tid,
    unit,
    request: hex(mbap(tid, unit, p.request)),
    response: hex(mbap(tid, unit, p.response)),
  });
  const ru = [1, 17, 247, 2, 100][i % 5];
  rtuCases.push({
    name: p.name,
    unit: ru,
    request: hex(rtu(ru, p.request)),
    response: hex(rtu(ru, p.response)),
  });
});
// ADU tối đa: TCP 260 byte, RTU 256 byte
{
  const big = pairs.find((p) => p.name === 'read-03-qty125');
  if (mbap(1, 1, big.response).length !== 7 + 252) throw new Error('adu size');
  if (rtu(1, big.response).length !== 1 + 252 + 2) throw new Error('rtu adu size');
  const w = pairs.find((p) => p.name === 'write-16-qty123');
  if (mbap(1, 1, w.request).length > 260) throw new Error('adu 260');
}
writeJson('mbap.json', tcpCases);
writeJson('rtu.json', rtuCases);

// ---- CRC ----
{
  const cases = [
    { name: 'std-example-1', data: [0x01, 0x03, 0x00, 0x00, 0x00, 0x0a] },
    { name: 'std-example-2', data: [0x11, 0x03, 0x00, 0x6b, 0x00, 0x03] },
    { name: 'empty', data: [] },
    { name: 'single-zero', data: [0x00] },
    { name: 'single-ff', data: [0xff] },
    { name: 'ascii-123456789', data: [...Buffer.from('123456789')] },
    { name: 'read-fc03-qty125', data: [0x01, ...rd(0x03, 0, 125)] },
    { name: 'all-ff-8', data: Array(8).fill(0xff) },
    { name: 'all-00-256', data: Array(256).fill(0) },
  ];
  // CRC của khung có CRC nối vào luôn bằng 0
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 16) & 0xff;
  for (let n = 1; n <= 40; n++)
    cases.push({ name: `lcg-len-${n}`, data: Array.from({ length: n * 6 - 5 }, rnd) });
  for (const c of cases) c.crc = hex(crcBytes(c.data));
  if (crc16([...Buffer.from('123456789')]) !== 0x4b37) throw new Error('CRC-16/MODBUS check value');
  for (const c of cases)
    if (crc16([...c.data, ...crcBytes(c.data)]) !== 0) throw new Error('CRC dư ' + c.name);
  writeJson(
    'crc.json',
    cases.map((c) => ({ name: c.name, data: hex(c.data), crc: c.crc })),
  );
}

// ---- Exception ----
{
  const cases = [];
  for (const fc of [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x0f, 0x10, 0x16])
    for (const code of [
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x00, 0x0c, 0x7f, 0xff,
    ])
      cases.push({
        name: `exc-${fc.toString(16).padStart(2, '0')}-${code.toString(16).padStart(2, '0')}`,
        fc,
        code,
        pdu: hex([fc | 0x80, code]),
      });
  writeJson('exceptions.json', cases);
}

// ---- Bộ kiểm tra tham chiếu ----
const qtyOf = (req) => (req[3] << 8) | req[4];
/** Kiểm PDU phản hồi theo yêu cầu; trả null nếu đúng, hoặc loại lỗi. */
function pduIssue(req, pdu) {
  const fc = req[0];
  if (pdu.length < 2) return 'format';
  if (pdu[0] === (fc | 0x80)) return pdu.length === 2 ? null : 'format';
  if (pdu[0] !== fc) return 'function';
  switch (fc) {
    case 0x01:
    case 0x02: {
      const n = Math.ceil(qtyOf(req) / 8);
      if (pdu[1] !== n) return 'bytecount';
      return pdu.length === 2 + n ? null : 'bytecount';
    }
    case 0x03:
    case 0x04: {
      const n = 2 * qtyOf(req);
      if (pdu[1] !== n) return 'bytecount';
      return pdu.length === 2 + n ? null : 'bytecount';
    }
    case 0x05:
    case 0x06:
    case 0x16:
      return pdu.length === req.length && pdu.every((b, i) => b === req[i]) ? null : 'format';
    case 0x0f:
    case 0x10:
      return pdu.length === 5 && pdu.every((b, i) => b === req[i]) ? null : 'format';
    default:
      return 'format';
  }
}
const COUNTER = {
  crc: 'crc',
  format: 'format',
  tid: 'tid',
  unit: 'unit',
  length: 'length',
  short: 'length',
  extra: 'length',
  protocol: 'format',
  function: 'format',
  bytecount: 'format',
};
function tcpIssue(req, resp) {
  if (resp.length < 8) return 'short';
  if (((resp[0] << 8) | resp[1]) !== req.tid) return 'tid';
  if (resp[2] !== 0 || resp[3] !== 0) return 'protocol';
  if (((resp[4] << 8) | resp[5]) !== resp.length - 6) return 'length';
  if (resp[6] !== req.unit) return 'unit';
  return pduIssue(req.pdu, resp.slice(7));
}
function rtuExpectedLength(head) {
  const fc = head[1];
  if (fc & 0x80) return 5;
  if ([1, 2, 3, 4].includes(fc)) return 5 + head[2];
  if ([5, 6, 15, 16].includes(fc)) return 8;
  if (fc === 22) return 10;
  return null;
}
function rtuIssue(req, resp) {
  if (resp.length < 4) return 'short';
  const exp = rtuExpectedLength(resp.length >= 3 ? resp.slice(0, 3) : [resp[0], resp[1]]);
  if (exp === null) return 'format';
  if (resp.length < exp) return 'short';
  if (resp.length > exp) return 'extra';
  const body = resp.slice(0, -2);
  const c = crcBytes(body);
  if (resp[resp.length - 2] !== c[0] || resp[resp.length - 1] !== c[1]) return 'crc';
  if (resp[0] !== req.unit) return 'unit';
  return pduIssue(req.pdu, resp.slice(1, -2));
}

// ---- Phản hồi sai: TCP ----
const badTcp = [];
const reqOf = (name) => pairs.find((p) => p.name === name);
function addTcp(name, base, mutate, kind) {
  const p = reqOf(base);
  const request = { tid: 0x1234, unit: 17, pdu: p.request };
  let r = mbap(request.tid, request.unit, p.response);
  r = mutate(r, p) ?? r;
  const got = tcpIssue(request, r);
  if (got !== kind) throw new Error(`bad-tcp ${name}: dự kiến ${kind}, bộ kiểm ra ${got}`);
  badTcp.push({
    name,
    request: { tid: request.tid, unit: request.unit, pdu: hex(request.pdu) },
    response: hex(r),
    expect: kind === null ? 'ok' : { kind, counter: COUNTER[kind] },
  });
}
const set = (i, v) => (r) => {
  const c = [...r];
  c[i] = v;
  return c;
};
addTcp('ok-read-03', 'std-03-read-hr-108-110', (r) => r, null);
addTcp('ok-write-16', 'std-16-write-hr-2-3', (r) => r, null);
addTcp(
  'ok-exception-02',
  'std-03-read-hr-108-110',
  (_r, p) => mbap(0x1234, 17, [p.fc | 0x80, 0x02]),
  null,
);
addTcp('tid-off-by-one', 'std-03-read-hr-108-110', set(1, 0x35), 'tid');
addTcp('tid-high-byte', 'std-03-read-hr-108-110', set(0, 0x13), 'tid');
addTcp('tid-write', 'std-06-write-hr-2', set(1, 0x00), 'tid');
addTcp('protocol-nonzero-low', 'std-03-read-hr-108-110', set(3, 0x01), 'protocol');
addTcp('protocol-nonzero-high', 'std-03-read-hr-108-110', set(2, 0x01), 'protocol');
addTcp('length-too-big', 'std-03-read-hr-108-110', set(5, 0x0a), 'length');
addTcp('length-too-small', 'std-03-read-hr-108-110', set(5, 0x06), 'length');
addTcp('length-zero', 'std-03-read-hr-108-110', set(5, 0x00), 'length');
addTcp('length-high-byte', 'std-03-read-hr-108-110', set(4, 0x01), 'length');
addTcp('extra-trailing-byte', 'std-03-read-hr-108-110', (r) => [...r, 0x00], 'length');
addTcp('missing-last-byte', 'std-03-read-hr-108-110', (r) => r.slice(0, -1), 'length');
addTcp('unit-mismatch', 'std-03-read-hr-108-110', set(6, 18), 'unit');
addTcp('unit-zero', 'std-03-read-hr-108-110', set(6, 0), 'unit');
addTcp('unit-write', 'write-05-coil-off', set(6, 255), 'unit');
addTcp('function-wrong-read', 'std-03-read-hr-108-110', set(7, 0x04), 'function');
addTcp('function-wrong-write', 'std-06-write-hr-2', set(7, 0x10), 'function');
addTcp('function-exception-of-other', 'std-03-read-hr-108-110', set(7, 0x84), 'function');
addTcp('function-zero', 'std-03-read-hr-108-110', set(7, 0x00), 'function');
addTcp(
  'bytecount-03-too-small',
  'std-03-read-hr-108-110',
  (r) => [...set(8, 0x04)(r)],
  'bytecount',
);
addTcp('bytecount-03-odd', 'std-03-read-hr-108-110', (r) => [...set(8, 0x05)(r)], 'bytecount');
addTcp(
  'bytecount-03-too-big-consistent',
  'std-03-read-hr-108-110',
  (r) => [...set(5, 0x0b)(set(8, 0x08)([...r, 0x00, 0x00]))],
  'bytecount',
);
addTcp('bytecount-01-wrong', 'std-01-read-coils-20-56', set(8, 0x04), 'bytecount');
addTcp('bytecount-02-wrong', 'std-02-read-di-197-218', set(8, 0x02), 'bytecount');
addTcp('bytecount-04-zero', 'std-04-read-ir-9', set(8, 0x00), 'bytecount');
addTcp('echo-06-address', 'std-06-write-hr-2', set(9, 0x02), 'format');
addTcp('echo-06-value', 'std-06-write-hr-2', set(11, 0x04), 'format');
addTcp('echo-05-value', 'std-05-write-coil-173-on', set(11, 0x01), 'format');
addTcp('echo-15-quantity', 'std-15-write-coils-20-29', set(11, 0x0b), 'format');
addTcp('echo-16-quantity', 'std-16-write-hr-2-3', set(11, 0x03), 'format');
addTcp('echo-16-address', 'std-16-write-hr-2-3', set(9, 0x02), 'format');
addTcp('echo-22-or', 'std-22-mask-write-5', set(13, 0x26), 'format');
addTcp('echo-22-and', 'std-22-mask-write-5', set(11, 0xf3), 'format');
addTcp('echo-short-pdu', 'std-06-write-hr-2', (r) => [...set(5, 0x05)(r.slice(0, -1))], 'format');
addTcp(
  'exception-with-extra-byte',
  'std-03-read-hr-108-110',
  (_r, p) => mbap(0x1234, 17, [p.fc | 0x80, 0x02, 0x00]),
  'format',
);
addTcp('header-only', 'std-03-read-hr-108-110', (r) => r.slice(0, 7), 'short');
addTcp('truncated-header', 'std-03-read-hr-108-110', (r) => r.slice(0, 5), 'short');
addTcp('empty', 'std-03-read-hr-108-110', () => [], 'short');
writeJson('bad-tcp.json', badTcp);

// ---- Phản hồi sai: RTU ----
const badRtu = [];
function addRtu(name, base, mutate, kind) {
  const p = reqOf(base);
  const request = { unit: 17, pdu: p.request };
  let r = rtu(request.unit, p.response);
  r = mutate(r, p) ?? r;
  const got = rtuIssue(request, r);
  if (got !== kind) throw new Error(`bad-rtu ${name}: dự kiến ${kind}, bộ kiểm ra ${got}`);
  badRtu.push({
    name,
    request: { unit: request.unit, pdu: hex(request.pdu) },
    response: hex(r),
    expect: kind === null ? 'ok' : { kind, counter: COUNTER[kind] },
  });
}
/** Sửa byte rồi tính lại CRC để chỉ phạm một luật. */
const fixCrc = (r) => [...r.slice(0, -2), ...crcBytes(r.slice(0, -2))];
const setCrc = (i, v) => (r) => fixCrc(set(i, v)(r));
addRtu('ok-read-03', 'std-03-read-hr-108-110', (r) => r, null);
addRtu('ok-write-06', 'std-06-write-hr-2', (r) => r, null);
addRtu('ok-write-22', 'std-22-mask-write-5', (r) => r, null);
addRtu('ok-exception', 'std-03-read-hr-108-110', (_r, p) => rtu(17, [p.fc | 0x80, 0x02]), null);
addRtu(
  'crc-low-byte',
  'std-03-read-hr-108-110',
  (r) => set(r.length - 2, r[r.length - 2] ^ 0x01)(r),
  'crc',
);
addRtu(
  'crc-high-byte',
  'std-03-read-hr-108-110',
  (r) => set(r.length - 1, r[r.length - 1] ^ 0x80)(r),
  'crc',
);
addRtu(
  'crc-swapped-bytes',
  'std-03-read-hr-108-110',
  (r) => [...r.slice(0, -2), r[r.length - 1], r[r.length - 2]],
  'crc',
);
addRtu('crc-data-flipped', 'std-03-read-hr-108-110', (r) => set(4, r[4] ^ 0x10)(r), 'crc');
addRtu('crc-write', 'std-06-write-hr-2', (r) => set(5, 0x09)(r), 'crc');
addRtu(
  'crc-exception',
  'std-03-read-hr-108-110',
  (_r, p) => {
    const f = rtu(17, [p.fc | 0x80, 0x02]);
    f[4] ^= 0xff;
    return f;
  },
  'crc',
);
addRtu('unit-mismatch', 'std-03-read-hr-108-110', setCrc(0, 18), 'unit');
addRtu('unit-broadcast-zero', 'std-03-read-hr-108-110', setCrc(0, 0), 'unit');
addRtu('unit-write', 'std-06-write-hr-2', setCrc(0, 1), 'unit');
addRtu('function-wrong-read', 'std-03-read-hr-108-110', setCrc(1, 0x04), 'function');
addRtu('function-wrong-write', 'std-06-write-hr-2', setCrc(1, 0x10), 'function');
addRtu(
  'function-exception-of-other',
  'std-03-read-hr-108-110',
  () => rtu(17, [0x84, 0x02]),
  'function',
);
addRtu(
  'bytecount-01-wrong',
  'std-01-read-coils-20-56',
  (r) => {
    // byte count 4 và đúng 4 byte dữ liệu: khung nhất quán nhưng không khớp ⌈37/8⌉ = 5
    const body = [r[0], r[1], 0x04, ...r.slice(3, 7)];
    return [...body, ...crcBytes(body)];
  },
  'bytecount',
);
addRtu(
  'bytecount-03-consistent-but-wrong',
  'std-03-read-hr-108-110',
  (r) => {
    const body = [r[0], r[1], 0x04, ...r.slice(3, 7)];
    return [...body, ...crcBytes(body)];
  },
  'bytecount',
);
addRtu(
  'bytecount-04-too-many',
  'std-04-read-ir-9',
  (r) => {
    const body = [r[0], r[1], 0x04, 0x00, 0x0a, 0x00, 0x0b];
    return [...body, ...crcBytes(body)];
  },
  'bytecount',
);
addRtu('echo-06-value', 'std-06-write-hr-2', setCrc(5, 0x04), 'format');
addRtu('echo-06-address', 'std-06-write-hr-2', setCrc(3, 0x02), 'format');
addRtu('echo-05-value', 'std-05-write-coil-173-on', setCrc(5, 0x01), 'format');
addRtu('echo-15-quantity', 'std-15-write-coils-20-29', setCrc(5, 0x0b), 'format');
addRtu('echo-16-quantity', 'std-16-write-hr-2-3', setCrc(5, 0x03), 'format');
addRtu('echo-22-or', 'std-22-mask-write-5', setCrc(7, 0x26), 'format');
addRtu('short-missing-crc-byte', 'std-03-read-hr-108-110', (r) => r.slice(0, -1), 'short');
addRtu('short-missing-two-bytes', 'std-03-read-hr-108-110', (r) => r.slice(0, -2), 'short');
addRtu(
  'short-missing-data-byte',
  'std-03-read-hr-108-110',
  (r) => [...r.slice(0, 5), ...r.slice(6)],
  'short',
);
addRtu('short-write-missing-byte', 'std-06-write-hr-2', (r) => r.slice(0, -1), 'short');
addRtu('short-header-only', 'std-03-read-hr-108-110', (r) => r.slice(0, 3), 'short');
addRtu('short-one-byte', 'std-03-read-hr-108-110', (r) => r.slice(0, 1), 'short');
addRtu('short-empty', 'std-03-read-hr-108-110', () => [], 'short');
addRtu(
  'short-exception-missing-byte',
  'std-03-read-hr-108-110',
  (_r, p) => rtu(17, [p.fc | 0x80, 0x02]).slice(0, -1),
  'short',
);
addRtu('extra-one-byte', 'std-03-read-hr-108-110', (r) => [...r, 0x00], 'extra');
addRtu('extra-write', 'std-06-write-hr-2', (r) => [...r, 0xff, 0xff], 'extra');
addRtu(
  'extra-exception',
  'std-03-read-hr-108-110',
  (_r, p) => [...rtu(17, [p.fc | 0x80, 0x02]), 0x00],
  'extra',
);
addRtu('extra-echo-doubled', 'std-06-write-hr-2', (r) => [...r, ...r], 'extra');
writeJson('bad-rtu.json', badRtu);

// ---- Độ dài khung RTU mong đợi ----
{
  const cases = [];
  for (const fc of [1, 2, 3, 4])
    for (const n of [1, 2, 6, 100, 250])
      cases.push({ name: `read-${fc}-n${n}`, head: hex([17, fc, n]), expected: 5 + n });
  for (const fc of [5, 6, 15, 16])
    cases.push({ name: `write-${fc}`, head: hex([17, fc, 0x00]), expected: 8 });
  cases.push({ name: 'mask-write-22', head: hex([17, 22, 0x00]), expected: 10 });
  for (const fc of [1, 2, 3, 4, 5, 6, 15, 16, 22])
    cases.push({ name: `exception-${fc}`, head: hex([17, fc | 0x80, 0x02]), expected: 5 });
  cases.push({ name: 'exception-unknown-function-code', head: hex([17, 0xff, 0x01]), expected: 5 });
  for (const c of cases) {
    const exp = rtuExpectedLength(parse(c.head));
    if (exp !== c.expected) throw new Error('rtu-length ' + c.name);
  }
  writeJson('rtu-length.json', cases);
}

// ---- Giới hạn ----
{
  const cases = [];
  const L = (fc, max, extra = []) => {
    for (const q of [0, 1, 2, max - 1, max, max + 1, ...extra])
      cases.push({
        name: `fc${String(fc).padStart(2, '0')}-qty${q}`,
        fc,
        qty: q,
        valid: q >= 1 && q <= max,
      });
  };
  L(1, 2000, [65535]);
  L(2, 2000, [2001]);
  L(3, 125, [126, 65535]);
  L(4, 125);
  L(15, 1968, [1969]);
  L(16, 123, [124]);
  writeJson('limits.json', cases);
}

// ---- Khoảng lặng RTU (contract §3) ----
{
  const cases = [];
  for (const baud of [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200])
    for (const [dataBits, parity, stopBits] of [
      [8, 'even', 1],
      [8, 'none', 2],
      [8, 'none', 1],
      [7, 'even', 1],
      [8, 'odd', 1],
      [7, 'none', 2],
    ]) {
      const charBits = 1 + dataBits + (parity === 'none' ? 0 : 1) + stopBits;
      const t35Ms = baud <= 19200 ? (3.5 * charBits * 1000) / baud : 1.75;
      cases.push({
        name: `b${baud}-${dataBits}${parity[0].toUpperCase()}${stopBits}`,
        baud,
        dataBits,
        parity,
        stopBits,
        charBits,
        t35Ms,
      });
    }
  writeJson('rtu-timing.json', cases);
}

console.log(
  `modbus-vectors: pdu ${pairs.length}, mbap ${tcpCases.length}, rtu ${rtuCases.length}, bad-tcp ${badTcp.length}, bad-rtu ${badRtu.length}`,
);
