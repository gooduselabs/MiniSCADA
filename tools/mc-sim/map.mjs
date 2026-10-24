// Memory of the MC protocol simulator (specs/017-driver-mc/contracts/mc-protocol.md §1, §5): one
// typed array per device that the map declares. A device that is not declared answers end code
// C05C, an address beyond its `size` C056.
//
// map.json:
// {
//   "xyNotation": "hex" | "octal",                // how X/Y numbers are written in ASCII frames
//   "routes": [{ "network": 0, "station": 255, "moduleIo"?: 1023, "moduleStation"?: 0 }],
//   "devices": {
//     "D":  { "size": 12288,
//             "values": [{ "at": 100, "type": "INT32", "value": -5 },
//                        { "at": 200, "type": "STRING", "value": "MITSU-01", "length"?: 10 },
//                        { "at": 300, "words": [1, 2, 3] }],
//             "bits": [{ "at": 400, "bit": 5, "value": true }] },
//     "M":  { "size": 8192, "on": [10, 11] },
//     "X":  { "size": 8192, "on": ["1A0"] }      // a string is read in the device notation
//   },
//   "scripts": [{ "device": "D", "from": 0, "to": 999, "kind": "everySecond" }]
// }
// Types: INT16 UINT16 INT32 UINT32 INT64 UINT64 FLOAT32 FLOAT64 STRING. Multi-word values are
// stored low word first (INT32 at D300: D300 = low 16 bits, D301 = high). STRING: first char in the
// low byte of the first word, `length` in chars (default: the string), padded with 0.
// INT64/UINT64 take a number or a decimal string (BigInt).
// everySecond: (floor(now / 1000) + number - from) & 0xFFFF (bit devices: its low bit), so that
// every value changes each second. A write to a point stops its script for that point.
// everySecond with "type": "FLOAT32" (word device): the words from `from` are pairs, pair k holds the
// FLOAT32 (floor(now / 1000) % 100000) + k (low word first), a finite number that changes each second.

/** code: binary device code; ascii: 2-char code; bit: bit device; radix: ASCII number radix. */
export const DEVICES = {
  SM: { code: 0x91, ascii: 'SM', bit: true, radix: 10 },
  SD: { code: 0xa9, ascii: 'SD', bit: false, radix: 10 },
  X: { code: 0x9c, ascii: 'X*', bit: true, radix: 16, xy: true },
  Y: { code: 0x9d, ascii: 'Y*', bit: true, radix: 16, xy: true },
  M: { code: 0x90, ascii: 'M*', bit: true, radix: 10 },
  L: { code: 0x92, ascii: 'L*', bit: true, radix: 10 },
  B: { code: 0xa0, ascii: 'B*', bit: true, radix: 16 },
  D: { code: 0xa8, ascii: 'D*', bit: false, radix: 10 },
  W: { code: 0xb4, ascii: 'W*', bit: false, radix: 16 },
  TN: { code: 0xc2, ascii: 'TN', bit: false, radix: 10 },
  CN: { code: 0xc5, ascii: 'CN', bit: false, radix: 10 },
  R: { code: 0xaf, ascii: 'R*', bit: false, radix: 10 },
  ZR: { code: 0xb0, ascii: 'ZR', bit: false, radix: 16, tagRadix: 10 },
};
export const DEVICE_BY_CODE = new Map(Object.entries(DEVICES).map(([n, d]) => [d.code, n]));
export const DEVICE_BY_ASCII = new Map(Object.entries(DEVICES).map(([n, d]) => [d.ascii, n]));
export const TYPES = [
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
  'STRING',
];
export const MAX_POINTS = 1_048_576;
const DEFAULT_SIZE = 8192;

/** Radix of a device number in an ASCII frame (contract §1 "Số trong ASCII"). */
export function asciiRadix(name, xyNotation = 'hex') {
  const d = DEVICES[name];
  return d.xy && xyNotation === 'octal' ? 8 : d.radix;
}

/** Radix of a device number as a Tag address writes it (map strings use it). */
export function tagRadix(name, xyNotation = 'hex') {
  const d = DEVICES[name];
  if (d.xy) return xyNotation === 'octal' ? 8 : 16;
  return d.tagRadix ?? d.radix;
}

const DIGITS = { 8: /^[0-7]+$/, 10: /^[0-9]+$/, 16: /^[0-9A-Fa-f]+$/ };

export function parseNumber(text, radix) {
  if (!DIGITS[radix].test(text)) return null;
  return parseInt(text, radix);
}

/** Words of a typed value, low word first. */
export function encodeTyped(type, value, length) {
  const buf = (n) => Buffer.alloc(n * 2);
  const words = (b) => {
    const out = [];
    for (let i = 0; i < b.length; i += 2) out.push(b.readUInt16LE(i));
    return out;
  };
  switch (type) {
    case 'INT16':
    case 'UINT16':
      return [Number(value) & 0xffff];
    case 'INT32':
    case 'UINT32':
      return [Number(value) & 0xffff, Math.floor(Number(value) / 65536) & 0xffff];
    case 'INT64':
    case 'UINT64': {
      const b = buf(4);
      b.writeBigUInt64LE(BigInt.asUintN(64, BigInt(value)));
      return words(b);
    }
    case 'FLOAT32': {
      const b = buf(2);
      b.writeFloatLE(Number(value));
      return words(b);
    }
    case 'FLOAT64': {
      const b = buf(4);
      b.writeDoubleLE(Number(value));
      return words(b);
    }
    case 'STRING': {
      const text = Buffer.from(String(value), 'latin1');
      const n = length ?? text.length;
      const b = buf(Math.ceil(n / 2));
      text.copy(b, 0, 0, Math.min(n, text.length));
      return words(b);
    }
    default:
      throw new Error(`unknown type: ${type}`);
  }
}

/** Value of a typed read from words (low word first). */
export function decodeTyped(type, words, length) {
  const b = Buffer.alloc(words.length * 2);
  words.forEach((w, i) => b.writeUInt16LE(w & 0xffff, i * 2));
  switch (type) {
    case 'INT16':
      return b.readInt16LE(0);
    case 'UINT16':
      return b.readUInt16LE(0);
    case 'INT32':
      return b.readInt32LE(0);
    case 'UINT32':
      return b.readUInt32LE(0);
    case 'INT64':
      return b.readBigInt64LE(0).toString();
    case 'UINT64':
      return b.readBigUInt64LE(0).toString();
    case 'FLOAT32':
      return b.readFloatLE(0);
    case 'FLOAT64':
      return b.readDoubleLE(0);
    case 'STRING': {
      const s = b.subarray(0, length ?? b.length).toString('latin1');
      const z = s.indexOf('\0');
      return z < 0 ? s : s.slice(0, z);
    }
    default:
      throw new Error(`unknown type: ${type}`);
  }
}

export function wordCount(type, length) {
  if (type === 'STRING') return Math.ceil((length ?? 0) / 2);
  return { INT16: 1, UINT16: 1, INT32: 2, UINT32: 2, FLOAT32: 2 }[type] ?? 4;
}

class Device {
  constructor(name, size) {
    this.name = name;
    this.info = DEVICES[name];
    this.size = size;
    this.data = this.info.bit ? new Uint8Array(size) : new Uint16Array(size);
  }
}

export class Memory {
  constructor({ xyNotation = 'hex', routes } = {}) {
    this.xyNotation = xyNotation;
    this.routes = routes ?? [{ network: 0, station: 255 }];
    this.devices = new Map();
    this.scripts = [];
    this.overridden = new Set();
  }

  declare(name, size = DEFAULT_SIZE) {
    if (!DEVICES[name]) throw new Error(`unknown device: ${name}`);
    if (!Number.isInteger(size) || size < 1 || size > MAX_POINTS)
      throw new Error(`${name}: size must be 1-${MAX_POINTS}`);
    const d = new Device(name, size);
    this.devices.set(name, d);
    return d;
  }

  device(name) {
    return this.devices.get(name);
  }

  /** True when [at, at + count) lies inside the device. */
  inRange(name, at, count) {
    const d = this.devices.get(name);
    return !!d && Number.isInteger(at) && at >= 0 && count >= 0 && at + count <= d.size;
  }

  routeAllowed(r) {
    return this.routes.some(
      (x) =>
        x.network === r.network &&
        x.station === r.station &&
        (x.moduleIo === undefined || x.moduleIo === r.moduleIo) &&
        (x.moduleStation === undefined || x.moduleStation === r.moduleStation),
    );
  }

  scriptFor(name, at) {
    if (this.scripts.length === 0 || this.overridden.has(`${name}:${at}`)) return null;
    return this.scripts.find((s) => s.device === name && at >= s.from && at <= s.to) ?? null;
  }

  /** Point `at` of a device (word value, or 0/1 for a bit device). */
  get(name, at, now = 0) {
    const d = this.devices.get(name);
    const s = this.scriptFor(name, at);
    if (s && s.type === 'FLOAT32') {
      const pair = Math.floor((at - s.from) / 2);
      const b = Buffer.alloc(4);
      b.writeFloatLE((Math.floor(now / 1000) % 100000) + pair);
      return b.readUInt16LE(((at - s.from) % 2) * 2);
    }
    if (s) {
      const v = (Math.floor(now / 1000) + (at - s.from) + (s.base ?? 0)) & 0xffff;
      return d.info.bit ? v & 1 : v;
    }
    return d.data[at];
  }

  set(name, at, value) {
    const d = this.devices.get(name);
    d.data[at] = d.info.bit ? (value ? 1 : 0) : Number(value) & 0xffff;
    if (this.scripts.length > 0) this.overridden.add(`${name}:${at}`);
  }

  /** Word `i` of a run that starts at `at`: a word device's word, or 16 points of a bit device. */
  getWord(name, at, now = 0) {
    if (!DEVICES[name].bit) return this.get(name, at, now);
    let w = 0;
    for (let j = 0; j < 16; j++) if (this.get(name, at + j, now)) w |= 1 << j;
    return w;
  }

  setWord(name, at, w) {
    if (!DEVICES[name].bit) return this.set(name, at, w);
    for (let j = 0; j < 16; j++) this.set(name, at + j, (w >> j) & 1);
  }

  /** Typed write (map entry or control API); returns the words written. */
  setTyped(name, at, type, value, length) {
    const words = encodeTyped(type, value, length);
    if (!this.inRange(name, at, words.length)) throw new Error(`${name}${at}: out of range`);
    words.forEach((w, i) => this.set(name, at + i, w));
    return words;
  }

  getTyped(name, at, type, length, now = 0) {
    const n = wordCount(type, length);
    if (!this.inRange(name, at, n)) throw new Error(`${name}${at}: out of range`);
    const words = [];
    for (let i = 0; i < n; i++) words.push(this.get(name, at + i, now));
    return decodeTyped(type, words, length);
  }

  /** A device number from the map or the control API: a number, or a string in the Tag notation. */
  number(name, at) {
    if (typeof at === 'number') return at;
    if (typeof at === 'string') {
      const n = parseNumber(at, tagRadix(name, this.xyNotation));
      if (n !== null) return n;
    }
    throw new Error(`${name}: bad device number ${JSON.stringify(at)}`);
  }
}

export function loadMap(json) {
  const xyNotation = json.xyNotation ?? 'hex';
  if (xyNotation !== 'hex' && xyNotation !== 'octal')
    throw new Error('xyNotation must be "hex" or "octal"');
  const routes = (json.routes ?? [{ network: 0, station: 255 }]).map((r) => ({ ...r }));
  const mem = new Memory({ xyNotation, routes });
  for (const [name, spec] of Object.entries(json.devices ?? {})) {
    const d = mem.declare(name, spec.size ?? DEFAULT_SIZE);
    if (d.info.bit) {
      for (const at of spec.on ?? []) {
        const n = mem.number(name, at);
        if (!mem.inRange(name, n, 1)) throw new Error(`${name}${at}: out of range`);
        mem.set(name, n, 1);
      }
      continue;
    }
    for (const v of spec.values ?? []) {
      const at = mem.number(name, v.at);
      if (v.words) {
        if (!mem.inRange(name, at, v.words.length)) throw new Error(`${name}${v.at}: out of range`);
        v.words.forEach((w, i) => mem.set(name, at + i, w));
      } else {
        if (!TYPES.includes(v.type)) throw new Error(`${name}${v.at}: unknown type ${v.type}`);
        mem.setTyped(name, at, v.type, v.value, v.length);
      }
    }
    for (const b of spec.bits ?? []) {
      const at = mem.number(name, b.at);
      if (!mem.inRange(name, at, 1) || !(b.bit >= 0 && b.bit <= 15))
        throw new Error(`${name}${b.at}.${b.bit}: out of range`);
      const cur = mem.get(name, at);
      mem.set(name, at, b.value ? cur | (1 << b.bit) : cur & ~(1 << b.bit));
    }
  }
  for (const s of json.scripts ?? []) {
    if (!mem.device(s.device)) throw new Error(`script: device ${s.device} is not declared`);
    if (s.type !== undefined && (s.type !== 'FLOAT32' || DEVICES[s.device].bit))
      throw new Error('script: type may only be FLOAT32, on a word device');
    const from = mem.number(s.device, s.from ?? s.at);
    const to = mem.number(s.device, s.to ?? s.at);
    mem.scripts.push({ ...s, from, to });
  }
  mem.overridden.clear();
  return mem;
}
