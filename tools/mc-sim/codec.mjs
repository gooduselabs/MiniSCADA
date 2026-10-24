// Frames of the MC protocol simulator (contracts/mc-protocol.md §2, §3), server side: cut a byte
// stream into request frames, parse a request, build a response. 3E and 4E, binary and ASCII.

export const MAX_FRAME = 8192;
export const END = {
  OK: 0,
  POINTS: 0xc051,
  RANGE: 0xc056,
  ASCII: 0xc050,
  COMMAND: 0xc059,
  BIT_WORD: 0xc05b,
  DEVICE: 0xc05c,
  LENGTH: 0xc061,
};

const HEX = /^[0-9A-Fa-f]+$/;
const hexNum = (s) => (HEX.test(s) ? parseInt(s, 16) : NaN);
export const hex4 = (n) => (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');

/** Kind of frame at the head of `buf`: { frame, code, header, lenAt } | 'more' | null (garbage). */
export function detect(buf) {
  if (buf.length === 0) return 'more';
  if (buf[0] === 0x50 || buf[0] === 0x54) {
    if (buf.length < 2) return 'more';
    if (buf[1] !== 0x00) return null;
    return buf[0] === 0x50
      ? { frame: '3E', code: 'binary', header: 9 }
      : { frame: '4E', code: 'binary', header: 13 };
  }
  const head = buf.subarray(0, 4).toString('latin1');
  for (const [text, frame, header] of [
    ['5000', '3E', 18],
    ['5400', '4E', 26],
  ]) {
    if (head === text) return { frame, code: 'ascii', header };
    if (head.length < 4 && text.startsWith(head)) return 'more';
  }
  return null;
}

/** Length of the whole frame at the head of `buf`, 0 when more bytes are needed, -1 for garbage. */
export function frameLength(buf) {
  const k = detect(buf);
  if (k === 'more') return 0;
  if (k === null) return -1;
  if (buf.length < k.header) return 0;
  let len;
  if (k.code === 'binary') len = buf.readUInt16LE(k.header - 2);
  else len = hexNum(buf.subarray(k.header - 4, k.header).toString('latin1'));
  // at least monitoring timer + command + subcommand
  const min = k.code === 'binary' ? 6 : 12;
  if (!Number.isInteger(len) || len < min || k.header + len > MAX_FRAME) return -1;
  return k.header + len;
}

/** Cuts a stream: { frames, rest, lost } (lost: bytes that cannot be framed; close the socket). */
export function splitFrames(buf) {
  const frames = [];
  let off = 0;
  for (;;) {
    const n = frameLength(buf.subarray(off));
    if (n < 0) return { frames, rest: Buffer.alloc(0), lost: true };
    if (n === 0 || off + n > buf.length) break;
    frames.push(buf.subarray(off, off + n));
    off += n;
  }
  return { frames, rest: buf.subarray(off), lost: false };
}

/**
 * Header of one whole frame: { frame, code, serial, route, routeRaw, serialRaw, timer, cmd, sub,
 * data } (data: Buffer for binary, string for ASCII) or null when it is not a request frame.
 */
export function parseFrame(frame) {
  const k = detect(frame);
  if (!k || k === 'more' || frameLength(frame) !== frame.length) return null;
  if (k.code === 'binary') {
    const o = k.frame === '4E' ? 4 : 0;
    return {
      frame: k.frame,
      code: 'binary',
      serial: o ? frame.readUInt16LE(2) : null,
      serialRaw: o ? frame.subarray(2, 6) : null,
      route: {
        network: frame[2 + o],
        station: frame[3 + o],
        moduleIo: frame.readUInt16LE(4 + o),
        moduleStation: frame[6 + o],
      },
      routeRaw: frame.subarray(2 + o, 7 + o),
      timer: frame.readUInt16LE(9 + o),
      cmd: frame.readUInt16LE(11 + o),
      sub: frame.readUInt16LE(13 + o),
      data: frame.subarray(15 + o),
    };
  }
  const t = frame.toString('latin1');
  const o = k.frame === '4E' ? 8 : 0;
  const route = {
    network: hexNum(t.slice(4 + o, 6 + o)),
    station: hexNum(t.slice(6 + o, 8 + o)),
    moduleIo: hexNum(t.slice(8 + o, 12 + o)),
    moduleStation: hexNum(t.slice(12 + o, 14 + o)),
  };
  const timer = hexNum(t.slice(18 + o, 22 + o));
  const cmd = hexNum(t.slice(22 + o, 26 + o));
  const sub = hexNum(t.slice(26 + o, 30 + o));
  const serial = o ? hexNum(t.slice(4, 8)) : null;
  if ([...Object.values(route), timer, cmd, sub].some(Number.isNaN) || Number.isNaN(serial))
    return null;
  return {
    frame: k.frame,
    code: 'ascii',
    serial,
    serialRaw: o ? t.slice(4, 12) : null,
    route,
    routeRaw: t.slice(4 + o, 14 + o),
    timer,
    cmd,
    sub,
    data: t.slice(30 + o),
  };
}

/** Response frame for request header `h`: end code + payload (Buffer for binary, string for ASCII). */
export function encodeResponse(h, endCode, payload) {
  if (h.code === 'binary') {
    const body = payload ?? Buffer.alloc(0);
    const head =
      h.frame === '4E' ? Buffer.from([0xd4, 0x00, ...h.serialRaw]) : Buffer.from([0xd0, 0]);
    const len = Buffer.alloc(4);
    len.writeUInt16LE(2 + body.length, 0);
    len.writeUInt16LE(endCode, 2);
    return Buffer.concat([head, h.routeRaw, len, body]);
  }
  const body = payload ?? '';
  const head = h.frame === '4E' ? 'D400' + h.serialRaw : 'D000';
  return Buffer.from(head + h.routeRaw + hex4(4 + body.length) + hex4(endCode) + body, 'latin1');
}

/** The error information of an end code ≠ 0: routing, command, subcommand. */
export function errorInfo(h) {
  if (h.code === 'binary') {
    const b = Buffer.alloc(4);
    b.writeUInt16LE(h.cmd, 0);
    b.writeUInt16LE(h.sub, 2);
    return Buffer.concat([h.routeRaw, b]);
  }
  return h.routeRaw + hex4(h.cmd) + hex4(h.sub);
}

/** Reader of the request data, the same calls for binary and ASCII. Throws an end code. */
export class DataReader {
  constructor(h, asciiRadixOf) {
    this.h = h;
    this.d = h.data;
    this.pos = 0;
    this.asciiRadixOf = asciiRadixOf;
  }

  get ascii() {
    return this.h.code === 'ascii';
  }

  need(n) {
    if (this.pos + n > this.d.length) throw END.LENGTH;
  }

  hexField(chars) {
    this.need(chars);
    const v = hexNum(this.d.slice(this.pos, this.pos + chars));
    if (Number.isNaN(v)) throw END.ASCII;
    this.pos += chars;
    return v;
  }

  u8() {
    if (this.ascii) return this.hexField(2);
    this.need(1);
    return this.d[this.pos++];
  }

  u16() {
    if (this.ascii) return this.hexField(4);
    this.need(2);
    const v = this.d.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }

  /** Device name + number; `lookupCode`/`lookupAscii` map the code to a name or undefined. */
  device(lookupCode, lookupAscii) {
    if (this.ascii) {
      this.need(8);
      const code = this.d.slice(this.pos, this.pos + 2).replace(' ', '*');
      const name = lookupAscii(code.toUpperCase());
      if (!name) throw END.DEVICE;
      const digits = this.d.slice(this.pos + 2, this.pos + 8);
      const radix = this.asciiRadixOf(name);
      const ok = { 8: /^[0-7]{6}$/, 10: /^[0-9]{6}$/, 16: /^[0-9A-Fa-f]{6}$/ }[radix];
      if (!ok.test(digits)) throw END.ASCII;
      this.pos += 8;
      return { device: name, at: parseInt(digits, radix) };
    }
    this.need(4);
    const at = this.d[this.pos] | (this.d[this.pos + 1] << 8) | (this.d[this.pos + 2] << 16);
    const name = lookupCode(this.d[this.pos + 3]);
    if (!name) throw END.DEVICE;
    this.pos += 4;
    return { device: name, at };
  }

  /** `count` points of a bit write: binary nibbles (first point high), ASCII one char each. */
  bits(count) {
    const out = [];
    if (this.ascii) {
      this.need(count);
      for (let i = 0; i < count; i++) {
        const c = this.d[this.pos + i];
        if (c !== '0' && c !== '1') throw END.ASCII;
        out.push(c === '1' ? 1 : 0);
      }
      this.pos += count;
      return out;
    }
    const n = Math.ceil(count / 2);
    this.need(n);
    for (let i = 0; i < count; i++) {
      const b = this.d[this.pos + (i >> 1)];
      out.push(((i & 1) === 0 ? b >> 4 : b) & 1);
    }
    this.pos += n;
    return out;
  }

  /** Bytes or chars a field list takes; the data must end exactly there. */
  end() {
    if (this.pos !== this.d.length) throw END.LENGTH;
  }
}

/** Response payload writer. */
export class DataWriter {
  constructor(code) {
    this.ascii = code === 'ascii';
    this.parts = [];
  }

  word(w) {
    if (this.ascii) this.parts.push(hex4(w));
    else this.parts.push(Buffer.from([w & 0xff, (w >> 8) & 0xff]));
  }

  dword(lo, hi) {
    if (this.ascii) this.parts.push(hex4(hi) + hex4(lo));
    else this.parts.push(Buffer.from([lo & 0xff, (lo >> 8) & 0xff, hi & 0xff, (hi >> 8) & 0xff]));
  }

  bits(points) {
    if (this.ascii) {
      this.parts.push(points.map((p) => (p ? '1' : '0')).join(''));
      return;
    }
    const b = Buffer.alloc(Math.ceil(points.length / 2));
    points.forEach((p, i) => {
      if (p) b[i >> 1] |= (i & 1) === 0 ? 0x10 : 0x01;
    });
    this.parts.push(b);
  }

  done() {
    return this.ascii ? this.parts.join('') : Buffer.concat(this.parts);
  }
}
