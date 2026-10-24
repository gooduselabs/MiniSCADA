// The memory of the FINS simulator: words by (word area code, address), the completion flags of the
// timers and counters, and the addresses past which the PLC answers 1103 (a smaller PLC).
//
// Map file (JSON):
//   { "node": 20,
//     "words": { "D": { "100": [1, 2, 3] }, "CIO": {...}, "W": {...}, "H": {...}, "A": {...},
//                "E0": {...} ... "EC": {...}, "T": {...}, "C": {...} },
//     "flags": { "T": { "5": true }, "C": { "12": false } },
//     "limits": { "D": 20000 },
//     "fill": [ { "area": "D", "from": 0, "to": 999, "value": 0 } ],
//     "ramps": [ { "area": "D", "address": 0, "periodMs": 10000, "max": 1000 } ] }
// Addresses are decimal; a counter's word address on the wire is 0x8000 + its number.
import { AREA_CODES, wordCodeOf } from './codec.mjs';

export const AREAS = Object.keys(AREA_CODES);

const wireOf = (area, address) => (area === 'C' ? 0x8000 + address : address);

export class FinsMemory {
  constructor(map = {}) {
    this.node = map.node ?? 20;
    this.words = new Map(); // `${code}:${address}` -> word
    this.flags = new Map(); // wire address -> boolean
    this.limits = new Map(); // word code -> first address that is outside
    this.ramps = [];
    for (const f of map.fill ?? [])
      for (let a = f.from; a <= f.to; a++) this.set(f.area, a, f.value ?? 0);
    for (const [area, byAddr] of Object.entries(map.words ?? {}))
      for (const [addr, values] of Object.entries(byAddr))
        values.forEach((v, i) => this.set(area, Number(addr) + i, v));
    for (const [area, byAddr] of Object.entries(map.flags ?? {}))
      for (const [addr, v] of Object.entries(byAddr)) this.setFlag(area, Number(addr), v);
    for (const [area, first] of Object.entries(map.limits ?? {}))
      this.limits.set(AREA_CODES[area].word, first);
    this.ramps = (map.ramps ?? []).map((r) => ({ ...r, code: AREA_CODES[r.area].word }));
  }
  static check(area) {
    if (!AREA_CODES[area]) throw new Error(`unknown area ${area}`);
  }
  set(area, address, value) {
    FinsMemory.check(area);
    this.words.set(`${AREA_CODES[area].word}:${wireOf(area, address)}`, Number(value) & 0xffff);
  }
  get(area, address) {
    FinsMemory.check(area);
    return this.words.get(`${AREA_CODES[area].word}:${wireOf(area, address)}`) ?? 0;
  }
  setFlag(area, address, v) {
    if (area !== 'T' && area !== 'C') throw new Error('flags are T or C');
    this.flags.set(wireOf(area, address), Boolean(v));
  }
  /** Outside the memory of this PLC (end code 1103). */
  outside(code, wire) {
    const limit = this.limits.get(wordCodeOf(code));
    return limit !== undefined && wire >= limit;
  }
  /** A word by its wire code and address (the ramps move with time). */
  word(code, wire, nowMs) {
    const wc = wordCodeOf(code);
    for (const r of this.ramps)
      if (r.code === wc && r.address === wire)
        return Math.floor(((nowMs % r.periodMs) / r.periodMs) * (r.max ?? 65535)) & 0xffff;
    return this.words.get(`${wc}:${wire}`) ?? 0;
  }
  setWord(code, wire, value) {
    this.words.set(`${wordCodeOf(code)}:${wire}`, value & 0xffff);
  }
  flag(wire) {
    return this.flags.get(wire) ?? false;
  }
}
