// S7comm over ISO-on-TCP, simulator side (contracts/s7-driver.md §3). Written on its own from
// RFC 1006 (TPKT), RFC 905 (COTP class 0) and the public S7comm layout (Wireshark packet-s7comm,
// Snap7 docs): it shares nothing with drivers/s7 of the runtime, so that a misreading of the
// protocol cannot hide on both sides. Both are checked against tests/s7-vectors/frames.json.
// Multi-byte numbers are big endian. "PDU" is the S7 part, from the 0x32 byte on.

export const TPKT_MIN = 7;
export const TPKT_MAX = 4096;
export const MAX_ITEMS = 20;

export const FN = { SETUP: 0xf0, READ: 0x04, WRITE: 0x05 };
export const RC = {
  OK: 0xff,
  HARDWARE: 0x01,
  DENIED: 0x03,
  OUT_OF_RANGE: 0x05,
  TYPE_NOT_SUPPORTED: 0x06,
  TYPE_INCONSISTENT: 0x07,
  NOT_FOUND: 0x0a,
};
export const AREA_CODE = { I: 0x81, Q: 0x82, M: 0x83, DB: 0x84 };
const AREA_OF_CODE = { 0x81: 'I', 0x82: 'Q', 0x83: 'M', 0x84: 'DB' };
export const TS = { BIT: 0x01, BYTE: 0x02, CHAR: 0x03 };

const be16 = (b, at) => (b[at] << 8) | b[at + 1];
const u16 = (n) => [(n >> 8) & 0xff, n & 0xff];
const tsapHex = (n) => n.toString(16).toUpperCase().padStart(4, '0');

/**
 * Cuts TPKT frames out of a byte stream. A frame with a version other than 3 or a length outside
 * 7..4096 cannot be read on: `bad` is set, the rest is kept from that frame on and the caller closes.
 */
export function splitTpkt(buf) {
  const frames = [];
  let at = 0;
  while (buf.length - at >= 4) {
    const len = be16(buf, at + 2);
    if (buf[at] !== 3 || len < TPKT_MIN || len > TPKT_MAX)
      return { frames, rest: buf.subarray(at), bad: true };
    if (buf.length - at < len) break;
    frames.push(buf.subarray(at, at + len));
    at += len;
  }
  return { frames, rest: buf.subarray(at), bad: false };
}

const tpkt = (body) => {
  const out = Buffer.alloc(4 + body.length);
  out[0] = 3;
  out.writeUInt16BE(out.length, 2);
  Buffer.from(body).copy(out, 4);
  return out;
};

/**
 * The COTP part of a whole TPKT frame: { type: 'CR' | 'CC' | 'DR' | 'DT' | 'other', ... }.
 * CR: srcRef, params (code -> Buffer), localTsap / remoteTsap (C1 calling / C2 called, 4 hex digits).
 * DT: eot, payload. null when the frame is too short for the length indicator.
 */
export function parseCotp(frame) {
  if (frame.length < 6) return null;
  const li = frame[4];
  if (frame.length < 5 + li || li < 1) return null;
  const code = frame[5];
  if (code === 0xf0) {
    if (li !== 2) return null;
    return { type: 'DT', eot: (frame[6] & 0x80) !== 0, payload: frame.subarray(5 + li) };
  }
  const kind = code & 0xf0;
  if (kind === 0xe0) {
    if (li < 6) return null;
    const params = new Map();
    for (let at = 11; at + 1 < 5 + li;) {
      const len = frame[at + 1];
      params.set(frame[at], frame.subarray(at + 2, at + 2 + len));
      at += 2 + len;
    }
    const tsap = (c) => (params.get(c)?.length === 2 ? tsapHex(be16(params.get(c), 0)) : null);
    return {
      type: 'CR',
      srcRef: be16(frame, 8),
      params,
      localTsap: tsap(0xc1),
      remoteTsap: tsap(0xc2),
    };
  }
  if (kind === 0xd0) return { type: 'CC' };
  if (code === 0x80) return { type: 'DR' };
  return { type: 'other' };
}

/** COTP CR as a client sends it (TPDU size 1024, class 0). */
export function encodeCr(localTsap, remoteTsap) {
  const l = parseInt(localTsap, 16);
  const r = parseInt(remoteTsap, 16);
  return tpkt([0x11, 0xe0, 0, 0, 0, 1, 0, 0xc0, 1, 0x0a, 0xc1, 2, ...u16(l), 0xc2, 2, ...u16(r)]);
}

/** CC for a parsed CR: references swapped, the parameters of the CR echoed. */
export function encodeCc(cr) {
  const params = [];
  for (const [c, v] of cr.params) params.push(c, v.length, ...v);
  return tpkt([6 + params.length, 0xd0, ...u16(cr.srcRef), 0, 1, 0, ...params]);
}

/** DR (reason 1) for a parsed CR. */
export const encodeDr = (cr) => tpkt([6, 0x80, ...u16(cr.srcRef), 0, 0, 1]);

/** One DT frame with EOT around an S7 PDU. */
export const wrapDt = (pdu) => tpkt([2, 0xf0, 0x80, ...pdu]);

/**
 * An S7 PDU: { rosctr, ref, param, data, eclass, ecode } or null when it does not start with 0x32
 * or its lengths do not fit. ROSCTR 2/3 have the two error bytes in the header.
 */
export function parseS7(pdu) {
  if (pdu.length < 10 || pdu[0] !== 0x32) return null;
  const rosctr = pdu[1];
  const hlen = rosctr === 2 || rosctr === 3 ? 12 : 10;
  if (pdu.length < hlen) return null;
  const plen = be16(pdu, 6);
  const dlen = be16(pdu, 8);
  if (hlen + plen + dlen !== pdu.length) return null;
  return {
    rosctr,
    ref: be16(pdu, 4),
    param: pdu.subarray(hlen, hlen + plen),
    data: pdu.subarray(hlen + plen),
    eclass: hlen === 12 ? pdu[10] : 0,
    ecode: hlen === 12 ? pdu[11] : 0,
  };
}

/** S7 PDU from parts. rosctr 1 (Job) has a 10-byte header, 2/3 a 12-byte one with eclass/ecode. */
export function encodeS7(rosctr, ref, param, data = [], eclass = 0, ecode = 0) {
  const head = [0x32, rosctr, 0, 0, ...u16(ref), ...u16(param.length), ...u16(data.length)];
  if (rosctr !== 1) head.push(eclass, ecode);
  return Buffer.from([...head, ...param, ...data]);
}

/** Header error answer: ROSCTR 3 (or 2), no parameter, no data. */
export const headerError = (ref, eclass, ecode, rosctr = 3) =>
  encodeS7(rosctr, ref, [], [], eclass, ecode);

/** Item spec 12 0A 10 <ts> <len> <db> <area> <addr3> -> { area, db, byte, bit, size, ts } (null if bad). */
function parseItem(p, at) {
  if (p[at] !== 0x12 || p[at + 1] !== 0x0a || p[at + 2] !== 0x10) return null;
  const ts = p[at + 3];
  const len = be16(p, at + 4);
  const db = be16(p, at + 6);
  const area = AREA_OF_CODE[p[at + 8]] ?? null;
  const addr = (p[at + 9] << 16) | (p[at + 10] << 8) | p[at + 11];
  const bit = ts === TS.BIT ? addr & 7 : null;
  return { area, db: area === 'DB' ? db : 0, byte: addr >> 3, bit, size: len, ts };
}

function itemSpec(it) {
  const bit = it.bit !== null && it.bit !== undefined;
  const addr = it.byte * 8 + (bit ? it.bit : 0);
  return [
    0x12,
    0x0a,
    0x10,
    bit ? TS.BIT : TS.BYTE,
    ...u16(bit ? 1 : it.size),
    ...u16(it.area === 'DB' ? it.db : 0),
    AREA_CODE[it.area],
    (addr >> 16) & 0xff,
    (addr >> 8) & 0xff,
    addr & 0xff,
  ];
}

/**
 * A Job PDU: { ref, fn, ... } or { ref, fn, error: 'format' } when it cannot be read.
 * Setup: amqCaller, amqCallee, pduSize. Read: items. Write: items, each with `data` (Buffer).
 */
export function parseJob(pdu) {
  const s7 = parseS7(pdu);
  if (!s7 || s7.rosctr !== 1 || s7.param.length < 1) return null;
  const { ref, param: p, data: d } = s7;
  const fn = p[0];
  const bad = { ref, fn, error: 'format' };
  if (fn === FN.SETUP) {
    if (p.length !== 8) return bad;
    return { ref, fn, amqCaller: be16(p, 2), amqCallee: be16(p, 4), pduSize: be16(p, 6) };
  }
  if (fn !== FN.READ && fn !== FN.WRITE) return { ref, fn };
  const n = p[1];
  if (p.length !== 2 + 12 * n || n < 1) return { ...bad, count: n };
  const items = [];
  for (let i = 0; i < n; i++) {
    const it = parseItem(p, 2 + 12 * i);
    if (!it) return bad;
    items.push(it);
  }
  if (fn === FN.READ) return d.length === 0 ? { ref, fn, items } : bad;
  // write data: per item 00 <dts> <len> <data>, a fill byte after odd data except the last
  let at = 0;
  for (let i = 0; i < n; i++) {
    if (at + 4 > d.length) return bad;
    const dts = d[at + 1];
    const len = be16(d, at + 2);
    const bytes = dts === 0x03 || dts === 0x04 || dts === 0x05 ? Math.ceil(len / 8) : len;
    if (at + 4 + bytes > d.length) return bad;
    items[i].dts = dts;
    items[i].data = d.subarray(at + 4, at + 4 + bytes);
    at += 4 + bytes + (bytes % 2 === 1 && i < n - 1 ? 1 : 0);
  }
  return at === d.length ? { ref, fn, items } : bad;
}

export const setupRequest = (ref, pduSize, amq = 1) =>
  encodeS7(1, ref, [FN.SETUP, 0, ...u16(amq), ...u16(amq), ...u16(pduSize)]);

export const setupResponse = (ref, amqCaller, amqCallee, pduSize) =>
  encodeS7(3, ref, [FN.SETUP, 0, ...u16(amqCaller), ...u16(amqCallee), ...u16(pduSize)]);

export const readRequest = (ref, items) =>
  encodeS7(1, ref, [FN.READ, items.length, ...items.flatMap(itemSpec)]);

/** Write Var Job; each item carries `data` (bytes; one byte 0/1 for a bit). */
export function writeRequest(ref, items) {
  const data = [];
  items.forEach((it, i) => {
    const bit = it.bit !== null && it.bit !== undefined;
    const n = it.data.length;
    data.push(0, bit ? 0x03 : 0x04, ...u16(bit ? 1 : n * 8), ...it.data);
    if (n % 2 === 1 && i < items.length - 1) data.push(0);
  });
  return encodeS7(1, ref, [FN.WRITE, items.length, ...items.flatMap(itemSpec)], data);
}

/** Bytes of the data part of a Read Var answer, for the PDU check before it is built. */
export const readResponseSize = (results) =>
  14 +
  results.reduce(
    (s, r, i) =>
      s + 4 + r.data.length + (r.data.length % 2 === 1 && i < results.length - 1 ? 1 : 0),
    0,
  );

/**
 * Read Var Ack_Data. results: [{ rc, bit: boolean, data: Buffer }]. A good bit item answers ts 03
 * length 1, a good byte item ts 04 with the length in bits; an item error is <rc> 00 00 00.
 */
export function readResponse(ref, results) {
  const data = [];
  results.forEach((r, i) => {
    if (r.rc !== RC.OK) {
      data.push(r.rc, 0, 0, 0);
      return;
    }
    data.push(RC.OK, r.bit ? 0x03 : 0x04, ...u16(r.bit ? 1 : r.data.length * 8), ...r.data);
    if (r.data.length % 2 === 1 && i < results.length - 1) data.push(0);
  });
  return encodeS7(3, ref, [FN.READ, results.length], data);
}

export const writeResponse = (ref, rcs) => encodeS7(3, ref, [FN.WRITE, rcs.length], rcs);

// ---- values (big endian; CHAR and STRING are Latin-1) ----

export const TYPES = [
  'BOOL',
  'BYTE',
  'CHAR',
  'INT',
  'WORD',
  'DINT',
  'DWORD',
  'REAL',
  'LREAL',
  'STRING',
];
const FIXED = { BYTE: 1, INT: 2, WORD: 2, DINT: 4, DWORD: 4, REAL: 4, LREAL: 8 };

/** Bytes a value takes: CHAR `length` (default the text length), STRING length + 2. */
export function sizeOf(type, length) {
  if (type === 'BOOL') return 1;
  if (type === 'CHAR') return length;
  if (type === 'STRING') return length + 2;
  return FIXED[type];
}

function latin1(text, length, type) {
  if (typeof text !== 'string') throw new Error(`${type} value must be a string`);
  if (text.length > length) throw new Error(`${type} value longer than ${length}`);
  for (const ch of text)
    if (ch.charCodeAt(0) > 0xff) throw new Error(`${type} value is not Latin-1: ${ch}`);
  return Buffer.from(text, 'latin1');
}

/**
 * The bytes of a value. `length`: CHAR count / STRING max length. BOOL is not a byte value: use
 * setBit. Throws on a value that does not fit.
 */
export function encodeValue(type, value, length) {
  if (type === 'CHAR' || type === 'STRING') {
    const n = length ?? (typeof value === 'string' ? value.length : 0);
    if (type === 'STRING' && (n < 0 || n > 254)) throw new Error('STRING length must be 0-254');
    const text = latin1(value, n, type);
    const out = Buffer.alloc(sizeOf(type, n));
    if (type === 'CHAR') text.copy(out, 0);
    else {
      out[0] = n;
      out[1] = text.length;
      text.copy(out, 2);
    }
    return out;
  }
  if (!(type in FIXED)) throw new Error(`unknown type: ${type}`);
  const v = Number(value);
  if (!Number.isFinite(v) && type !== 'REAL' && type !== 'LREAL')
    throw new Error(`${type} value must be a number`);
  const out = Buffer.alloc(FIXED[type]);
  const int = (lo, hi) => {
    if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`${type} value out of range`);
  };
  switch (type) {
    case 'BYTE':
      int(0, 0xff);
      out.writeUInt8(v);
      break;
    case 'INT':
      int(-32768, 32767);
      out.writeInt16BE(v);
      break;
    case 'WORD':
      int(0, 0xffff);
      out.writeUInt16BE(v);
      break;
    case 'DINT':
      int(-2147483648, 2147483647);
      out.writeInt32BE(v);
      break;
    case 'DWORD':
      int(0, 0xffffffff);
      out.writeUInt32BE(v);
      break;
    case 'REAL':
      out.writeFloatBE(v);
      break;
    default:
      out.writeDoubleBE(v);
  }
  return out;
}

/** A value from bytes. BOOL takes `bit` of the first byte; CHAR drops trailing zero bytes. */
export function decodeValue(type, bytes, { bit = 0, length } = {}) {
  switch (type) {
    case 'BOOL':
      return ((bytes[0] >> bit) & 1) === 1;
    case 'BYTE':
      return bytes.readUInt8(0);
    case 'INT':
      return bytes.readInt16BE(0);
    case 'WORD':
      return bytes.readUInt16BE(0);
    case 'DINT':
      return bytes.readInt32BE(0);
    case 'DWORD':
      return bytes.readUInt32BE(0);
    case 'REAL':
      return bytes.readFloatBE(0);
    case 'LREAL':
      return bytes.readDoubleBE(0);
    case 'CHAR': {
      let end = Math.min(length ?? bytes.length, bytes.length);
      while (end > 0 && bytes[end - 1] === 0) end--;
      return bytes.subarray(0, end).toString('latin1');
    }
    case 'STRING': {
      // the current length is trusted only as far as the max length, the Tag and the bytes go
      const cur = Math.min(bytes[1], bytes[0], length ?? bytes[0], bytes.length - 2);
      return bytes.subarray(2, 2 + Math.max(0, cur)).toString('latin1');
    }
    default:
      throw new Error(`unknown type: ${type}`);
  }
}

/** A byte with one bit set or cleared. */
export const setBit = (byte, bit, on) => (on ? byte | (1 << bit) : byte & ~(1 << bit)) & 0xff;
