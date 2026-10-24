// BACnet/IP encoding for the simulator of feature 020 (the device side): BVLC, NPDU, APDU headers and the
// application / context tags of clause 20.2. The same vectors as the C++ codec (tests/bacnet-vectors/frames.json).
// Values: { tag: 'null' | 'boolean' | 'unsigned' | 'signed' | 'real' | 'double' | 'string' | 'bits' | 'enumerated'
// | 'object', value }; bits: { value: number (bit 0 first), count }; object: { type, instance }.

export const BVLC = {
  RESULT: 0x00,
  FORWARDED: 0x04,
  REGISTER_FD: 0x05,
  DISTRIBUTE: 0x09,
  UNICAST: 0x0a,
  BROADCAST: 0x0b,
};
export const PDU = {
  CONFIRMED: 0,
  UNCONFIRMED: 1,
  SIMPLE_ACK: 2,
  COMPLEX_ACK: 3,
  ERROR: 5,
  REJECT: 6,
  ABORT: 7,
};
export const SERVICE = {
  I_AM: 0,
  WHO_IS: 8,
  READ_PROPERTY: 12,
  READ_PROPERTY_MULTIPLE: 14,
  WRITE_PROPERTY: 15,
};
export const APP = {
  null: 0,
  boolean: 1,
  unsigned: 2,
  signed: 3,
  real: 4,
  double: 5,
  octets: 6,
  string: 7,
  bits: 8,
  enumerated: 9,
  date: 10,
  time: 11,
  object: 12,
};
const APP_NAME = Object.fromEntries(Object.entries(APP).map(([k, v]) => [v, k]));

export const OBJECT = {
  AI: 0,
  AO: 1,
  AV: 2,
  BI: 3,
  BO: 4,
  BV: 5,
  DEV: 8,
  MSI: 13,
  MSO: 14,
  MSV: 19,
};
export const OBJECT_NAME = Object.fromEntries(Object.entries(OBJECT).map(([k, v]) => [v, k]));
export const PROP = {
  description: 28,
  'event-state': 36,
  'max-apdu-length-accepted': 62,
  'model-name': 70,
  'object-identifier': 75,
  'object-list': 76,
  'object-name': 77,
  'object-type': 79,
  'out-of-service': 81,
  'present-value': 85,
  'priority-array': 87,
  reliability: 103,
  'relinquish-default': 104,
  'status-flags': 111,
  units: 117,
  'vendor-identifier': 120,
  'vendor-name': 121,
};
export const ERROR_CODE = {
  INVALID_DATA_TYPE: 9,
  UNKNOWN_OBJECT: 31,
  UNKNOWN_PROPERTY: 32,
  VALUE_OUT_OF_RANGE: 37,
  WRITE_ACCESS_DENIED: 40,
  INVALID_ARRAY_INDEX: 42,
};

const objRaw = (o) => ((o.type << 22) | (o.instance & 0x3fffff)) >>> 0;
export const objOf = (raw) => ({ type: raw >>> 22, instance: raw & 0x3fffff });

function uintBytes(n) {
  const out = [];
  let v = BigInt(n);
  do {
    out.unshift(Number(v & 0xffn));
    v >>= 8n;
  } while (v > 0n);
  return out;
}
function intBytes(n) {
  const out = [];
  let v = BigInt(n);
  for (;;) {
    out.unshift(Number(v & 0xffn));
    const rest = v >> 8n;
    const sign = (out[0] & 0x80) !== 0;
    if ((rest === 0n && !sign) || (rest === -1n && sign)) break;
    v = rest;
  }
  return out;
}

export function tagHeader(number, context, length) {
  const out = [];
  const ext = number > 14;
  let first = (context ? 0x08 : 0) | ((ext ? 15 : number) << 4);
  if (length <= 4) {
    out.push(first | length);
    if (ext) out.push(number);
    return out;
  }
  out.push(first | 5);
  if (ext) out.push(number);
  if (length <= 253) out.push(length);
  else if (length <= 65535) out.push(254, length >> 8, length & 0xff);
  else
    out.push(
      255,
      (length >>> 24) & 0xff,
      (length >> 16) & 0xff,
      (length >> 8) & 0xff,
      length & 0xff,
    );
  return out;
}
const tagged = (number, context, content) => [
  ...tagHeader(number, context, content.length),
  ...content,
];

export function encodeValue(v) {
  switch (v.tag) {
    case 'null':
      return [0x00];
    case 'boolean':
      return [v.value ? 0x11 : 0x10];
    case 'unsigned':
    case 'enumerated':
      return tagged(APP[v.tag], false, uintBytes(v.value));
    case 'signed':
      return tagged(APP.signed, false, intBytes(v.value));
    case 'real': {
      const b = Buffer.alloc(4);
      b.writeFloatBE(v.value);
      return tagged(APP.real, false, [...b]);
    }
    case 'double': {
      const b = Buffer.alloc(8);
      b.writeDoubleBE(v.value);
      return tagged(APP.double, false, [...b]);
    }
    case 'string':
      return tagged(APP.string, false, [0, ...Buffer.from(v.value, 'utf8')]);
    case 'bits': {
      const count = v.count ?? 4;
      const bytes = Math.ceil(count / 8);
      const content = [bytes * 8 - count];
      for (let i = 0; i < bytes; i++) {
        let byte = 0;
        for (let k = 0; k < 8; k++)
          if (i * 8 + k < count && (v.value >> (i * 8 + k)) & 1) byte |= 0x80 >> k;
        content.push(byte);
      }
      return tagged(APP.bits, false, content);
    }
    case 'object': {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(objRaw(v.value));
      return tagged(APP.object, false, [...b]);
    }
    default:
      throw new Error(`value tag ${v.tag}`);
  }
}
export const contextUnsigned = (tag, n) => tagged(tag, true, uintBytes(n));
export function contextObject(tag, o) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(objRaw(o));
  return tagged(tag, true, [...b]);
}
export const opening = (tag) => [(tag << 4) | 0x0e];
export const closing = (tag) => [(tag << 4) | 0x0f];

/** A reader of tags over a Buffer; every method throws on a malformed input. */
export class Reader {
  constructor(buf, pos = 0, end = buf.length) {
    this.buf = buf;
    this.pos = pos;
    this.end = end;
  }
  atEnd() {
    return this.pos >= this.end;
  }
  peek() {
    const save = this.pos;
    try {
      return this.next();
    } finally {
      this.pos = save;
    }
  }
  next() {
    if (this.pos >= this.end) throw new Error('end of data');
    const first = this.buf[this.pos++];
    const context = (first & 0x08) !== 0;
    let number = first >> 4;
    if (number === 15) number = this.byte();
    const lvt = first & 7;
    if (context && lvt === 6) return { number, context, opening: true };
    if (context && lvt === 7) return { number, context, closing: true };
    if (!context && number === APP.boolean) return { number, context, length: 0, bool: lvt === 1 };
    let length = lvt;
    if (lvt === 5) {
      length = this.byte();
      if (length === 254) length = (this.byte() << 8) | this.byte();
      else if (length === 255)
        length =
          ((this.byte() << 24) | (this.byte() << 16) | (this.byte() << 8) | this.byte()) >>> 0;
    }
    if (length > this.end - this.pos) throw new Error('length past the end');
    return { number, context, length };
  }
  byte() {
    if (this.pos >= this.end) throw new Error('end of data');
    return this.buf[this.pos++];
  }
  take(n) {
    if (n > this.end - this.pos) throw new Error('length past the end');
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  uint(n) {
    let v = 0;
    for (const x of this.take(n)) v = v * 256 + x;
    return v;
  }
  isContext(tag) {
    if (this.atEnd()) return false;
    const h = this.peek();
    return h.context && !h.opening && !h.closing && h.number === tag;
  }
  isOpening(tag) {
    if (this.atEnd()) return false;
    const h = this.peek();
    return !!h.opening && h.number === tag;
  }
  isClosing(tag) {
    if (this.atEnd()) return false;
    const h = this.peek();
    return !!h.closing && h.number === tag;
  }
  contextUnsigned(tag) {
    const h = this.next();
    if (!h.context || h.number !== tag || h.opening || h.closing)
      throw new Error(`context ${tag} expected`);
    return this.uint(h.length);
  }
  contextObject(tag) {
    return objOf(this.contextUnsigned(tag) >>> 0);
  }
  expectOpening(tag) {
    const h = this.next();
    if (!h.opening || h.number !== tag) throw new Error(`opening ${tag} expected`);
  }
  expectClosing(tag) {
    const h = this.next();
    if (!h.closing || h.number !== tag) throw new Error(`closing ${tag} expected`);
  }
  value() {
    const h = this.next();
    if (h.context) throw new Error('application tag expected');
    const tag = APP_NAME[h.number] ?? 'other';
    switch (tag) {
      case 'null':
        return { tag };
      case 'boolean':
        return { tag, value: h.bool };
      case 'unsigned':
      case 'enumerated':
        return { tag, value: this.uint(h.length) };
      case 'signed': {
        const b = this.take(h.length);
        let v = b[0] & 0x80 ? -1n : 0n;
        for (const x of b) v = (v << 8n) | BigInt(x);
        return { tag, value: Number(BigInt.asIntN(64, v)) };
      }
      case 'real':
        return { tag, value: this.take(4).readFloatBE(0) };
      case 'double':
        return { tag, value: this.take(8).readDoubleBE(0) };
      case 'string':
        return { tag, value: this.take(h.length).subarray(1).toString('utf8') };
      case 'bits': {
        const b = this.take(h.length);
        const count = (b.length - 1) * 8 - b[0];
        let value = 0;
        for (let i = 0; i < count && i < 31; i++)
          if (b[1 + (i >> 3)] & (0x80 >> (i & 7))) value |= 1 << i;
        return { tag, value, count };
      }
      case 'object':
        return { tag, value: objOf(this.uint(4) >>> 0) };
      default:
        return { tag, value: [...this.take(h.length)] };
    }
  }
}

/** Parses a datagram. Throws on a malformed one. */
export function parseFrame(buf) {
  if (buf.length < 4 || buf[0] !== 0x81) throw new Error('not BVLC');
  if (buf.readUInt16BE(2) !== buf.length) throw new Error('BVLC length');
  const f = { bvlc: buf[1] };
  let pos = 4;
  if (f.bvlc === BVLC.RESULT) {
    f.result = buf.readUInt16BE(4);
    return f;
  }
  if (f.bvlc === BVLC.REGISTER_FD) {
    f.ttl = buf.readUInt16BE(4);
    return f;
  }
  if (f.bvlc === BVLC.FORWARDED) pos = 10;
  else if (![BVLC.UNICAST, BVLC.BROADCAST, BVLC.DISTRIBUTE].includes(f.bvlc))
    throw new Error('BVLC function');
  if (buf[pos] !== 1) throw new Error('NPDU version');
  const control = buf[pos + 1];
  pos += 2;
  if (control & 0x20) {
    f.dnet = buf.readUInt16BE(pos);
    const dlen = buf[pos + 2];
    f.dadr = [...buf.subarray(pos + 3, pos + 3 + dlen)];
    pos += 3 + dlen;
  }
  if (control & 0x08) {
    f.snet = buf.readUInt16BE(pos);
    const slen = buf[pos + 2];
    f.sadr = [...buf.subarray(pos + 3, pos + 3 + slen)];
    pos += 3 + slen;
  }
  if (control & 0x20) pos += 1;
  if (control & 0x80) return f;
  const a = buf[pos];
  f.pdu = a >> 4;
  if (f.pdu === PDU.CONFIRMED) {
    f.segmented = (a & 0x08) !== 0;
    f.maxApdu = [50, 128, 206, 480, 1024, 1476][buf[pos + 1] & 0x0f] ?? 50;
    f.invokeId = buf[pos + 2];
    f.service = buf[pos + (f.segmented ? 5 : 3)];
    f.data = buf.subarray(pos + (f.segmented ? 6 : 4));
  } else if (f.pdu === PDU.UNCONFIRMED) {
    f.service = buf[pos + 1];
    f.data = buf.subarray(pos + 2);
  } else {
    f.invokeId = buf[pos + 1];
    f.service = buf[pos + 2];
    f.data = buf.subarray(pos + 3);
  }
  return f;
}

/** BVLC + NPDU around an APDU; `route` { snet, sadr } puts the source of a device behind a router. */
export function frame(apdu, { bvlc = BVLC.UNICAST, route = null, dnetBroadcast = false } = {}) {
  const npdu = [1, 0];
  if (dnetBroadcast) {
    npdu[1] |= 0x20;
    npdu.push(0xff, 0xff, 0);
  }
  if (route) {
    npdu[1] |= 0x08;
    npdu.push(route.snet >> 8, route.snet & 0xff, route.sadr.length, ...route.sadr);
  }
  if (dnetBroadcast) npdu.push(0xff);
  const body = [...npdu, ...apdu];
  return Buffer.from([0x81, bvlc, (body.length + 4) >> 8, (body.length + 4) & 0xff, ...body]);
}
