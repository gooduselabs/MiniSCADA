// Memory of the S7 simulator (contracts/s7-driver.md §6): areas DB<n>, M, I, Q as plain byte
// buffers, filled from typed values of the map. A DB that is not in the map answers item 0A, a DB in
// `denied` item 03, an address beyond `size` item 05.
//
// map.json:
// {
//   "pduSize": 480,                         // the most the simulator agrees to (default 480)
//   "tsap": { "remote": "0101" },           // optional: a CR with another called TSAP gets a DR
//   "areas": {
//     "DB1": { "size": 512, "data": [ { "byte": 0, "bit": 0, "type": "BOOL", "value": true },
//                                     { "byte": 10, "type": "STRING", "maxLength": 20, "value": "Bom 1" },
//                                     { "byte": 40, "type": "CHAR", "length": 4, "value": "OK" } ] },
//     "M": { "size": 256 }, "I": { "size": 64 }, "Q": { "size": 64 }
//   },
//   "denied": ["DB3"],
//   "putGetDisabled": false,
//   "animate": [ { "area": "DB10", "byte": 0, "type": "INT", "count": 250, "stride": 2 } ]
// }
// animate: value i of the list (at byte + i * stride) is (seconds since the start) + i, wrapped to
// the type (INT, WORD, DINT, REAL), so every value changes each second and no two are equal. An
// animated value is rewritten before every read: a write to it does not stick.
import { encodeValue, setBit, sizeOf, TYPES } from './codec.mjs';

export const DEFAULT_PDU = 480;
const ANIMATE_TYPES = ['INT', 'WORD', 'DINT', 'REAL'];

/** "db1" -> "DB1", "m" -> "M"; null when it is not an area name. */
export function areaName(name) {
  const n = String(name ?? '').toUpperCase();
  if (n === 'M' || n === 'I' || n === 'Q') return n;
  const m = /^DB([1-9][0-9]{0,4})$/.exec(n);
  return m && Number(m[1]) <= 65535 ? n : null;
}

export class Memory {
  constructor(json, now = Date.now) {
    this.json = json;
    this.now = now;
    this.pduSize = json.pduSize ?? DEFAULT_PDU;
    if (!Number.isInteger(this.pduSize) || this.pduSize < 240 || this.pduSize > 960)
      throw new Error('pduSize must be 240-960');
    const remote = json.tsap?.remote;
    if (remote !== undefined && !/^[0-9A-Fa-f]{4}$/.test(remote))
      throw new Error('tsap.remote must be 4 hex digits');
    this.remoteTsap = remote ? remote.toUpperCase() : null;
    this.denied = new Set((json.denied ?? []).map((d) => areaName(d) ?? d));
    this.putGetDisabled = json.putGetDisabled === true;
    this.reload();
  }

  /** Back to the values of the map. */
  reload() {
    this.areas = new Map();
    for (const [key, spec] of Object.entries(this.json.areas ?? {})) {
      const name = areaName(key);
      if (!name) throw new Error(`bad area name: ${key}`);
      if (!Number.isInteger(spec.size) || spec.size < 1 || spec.size > 65536)
        throw new Error(`${key}: size must be 1-65536`);
      this.areas.set(name, Buffer.alloc(spec.size));
      for (const d of spec.data ?? []) this.set(name, d);
    }
    this.animate = (this.json.animate ?? []).map((a) => {
      const name = areaName(a.area);
      if (!this.areas.has(name)) throw new Error(`animate: no area ${a.area}`);
      if (!ANIMATE_TYPES.includes(a.type)) throw new Error(`animate: type ${a.type}`);
      return { ...a, area: name, stride: a.stride ?? sizeOf(a.type) };
    });
    this.start = this.now();
  }

  area(name) {
    return this.areas.get(name);
  }

  /** Writes one typed value: { byte, bit?, type, value, maxLength? (STRING), length? (CHAR) }. */
  set(name, { byte, bit, type, value, maxLength, length }) {
    const buf = this.areas.get(areaName(name));
    if (!buf) throw new Error(`no area ${name}`);
    if (!TYPES.includes(type)) throw new Error(`unknown type: ${type}`);
    if (!Number.isInteger(byte) || byte < 0) throw new Error('byte must be an integer >= 0');
    if (type === 'BOOL') {
      if (!Number.isInteger(bit) || bit < 0 || bit > 7) throw new Error('BOOL needs bit 0-7');
      if (byte >= buf.length) throw new Error(`${name}: byte ${byte} beyond the size`);
      buf[byte] = setBit(buf[byte], bit, value === true || value === 1);
      return;
    }
    if (type === 'STRING' && !Number.isInteger(maxLength))
      throw new Error('STRING needs maxLength');
    const bytes = encodeValue(type, value, type === 'STRING' ? maxLength : length);
    if (byte + bytes.length > buf.length) throw new Error(`${name}: byte ${byte} beyond the size`);
    bytes.copy(buf, byte);
  }

  /** Rewrites the animated values for the time `now`. */
  tick(now = this.now()) {
    const s = Math.floor((now - this.start) / 1000);
    for (const a of this.animate) {
      const buf = this.areas.get(a.area);
      for (let i = 0; i < a.count; i++) {
        const at = a.byte + i * a.stride;
        const v = s + i;
        if (at + sizeOf(a.type) > buf.length) break;
        if (a.type === 'INT')
          buf.writeInt16BE(((((v + 32768) % 65536) + 65536) % 65536) - 32768, at);
        else if (a.type === 'WORD') buf.writeUInt16BE(v & 0xffff, at);
        else if (a.type === 'DINT') buf.writeInt32BE(v | 0, at);
        else buf.writeFloatBE(v % 1000000, at);
      }
    }
  }
}

export const loadMap = (json, now = Date.now) => new Memory(json, now);
