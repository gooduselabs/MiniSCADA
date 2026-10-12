// Memory of the simulator: units and four areas (coils, discrete inputs, holding and input
// registers). An address that is not defined answers exception 02, which is how the tests make a
// "hole" inside a block that the driver merged. Scripts make values that change with time.
//
// map.json:
// {
//   "unknownUnit": "ignore" | "gateway",       // a unit that is not in the map: silence, or exception 0B
//   "units": {
//     "1": {
//       "holding":  { "100": 4660, "200": [1, 2, 3] },   // start address -> value or consecutive values
//       "input":    { },  "coils": { "10": [1, 0] },  "discrete": { },
//       "fill": [ { "area": "holding", "from": 0, "to": 99, "value": 0 } ],
//       "scripts": [
//         { "area": "holding", "from": 0, "to": 499, "kind": "everySecond" },
//         { "area": "holding", "address": 600, "kind": "counter", "step": 1 },
//         { "area": "holding", "address": 601, "kind": "sine", "offset": 1000, "amplitude": 500, "periodMs": 10000 }
//       ]
//     }
//   }
// }
// everySecond: (floor(now / 1000) + address - from) & 0xFFFF (coils: its low bit), so that every
//   value changes each second and no two addresses hold the same value.
// counter: +step on every read that includes the address (counts the requests that reach it).
// sine: round(offset + amplitude * sin(2 pi now / periodMs)), as a 16-bit number.
// A write to an address stops its script for that address.

export const AREAS = ['coils', 'discrete', 'holding', 'input'];
export const AREA_OF_FC = {
  1: 'coils',
  2: 'discrete',
  3: 'holding',
  4: 'input',
  5: 'coils',
  6: 'holding',
  15: 'coils',
  16: 'holding',
  22: 'holding',
};

class Unit {
  constructor() {
    this.areas = Object.fromEntries(AREAS.map((a) => [a, new Map()]));
    this.scripts = [];
    this.overridden = new Set();
    this.counters = new Map();
  }
}

export class Memory {
  constructor() {
    this.units = new Map();
    this.unknownUnit = 'ignore';
  }

  unit(id, create = false) {
    let u = this.units.get(id);
    if (!u && create) {
      u = new Unit();
      this.units.set(id, u);
    }
    return u;
  }

  has(unitId) {
    return this.units.has(unitId);
  }

  scriptFor(u, area, address) {
    return u.scripts.find((s) => s.area === area && address >= s.from && address <= s.to);
  }

  defined(unitId, area, address) {
    const u = this.units.get(unitId);
    if (!u) return false;
    if (u.areas[area].has(address)) return true;
    return !u.overridden.has(`${area}:${address}`) && !!this.scriptFor(u, area, address);
  }

  /** Value at `address` or undefined when it is not defined. `read`: counts a counter. */
  value(unitId, area, address, now, read = false) {
    const u = this.units.get(unitId);
    if (!u) return undefined;
    const key = `${area}:${address}`;
    if (!u.overridden.has(key)) {
      const s = this.scriptFor(u, area, address);
      if (s) return this.scripted(u, s, area, address, now, read);
    }
    return u.areas[area].get(address);
  }

  scripted(u, s, area, address, now, read) {
    let v;
    if (s.kind === 'counter') {
      const key = `${area}:${address}`;
      const cur = u.counters.get(key) ?? s.start ?? 0;
      v = cur;
      if (read) u.counters.set(key, (cur + (s.step ?? 1)) & 0xffff);
    } else if (s.kind === 'sine') {
      v = Math.round(
        (s.offset ?? 0) +
          (s.amplitude ?? 1) * Math.sin((2 * Math.PI * now) / (s.periodMs ?? 10000)),
      );
    } else {
      v = Math.floor(now / 1000) + (address - s.from) + (s.base ?? 0);
    }
    v &= 0xffff;
    return area === 'coils' || area === 'discrete' ? v & 1 : v;
  }

  set(unitId, area, address, value) {
    const u = this.unit(unitId, true);
    const bit = area === 'coils' || area === 'discrete';
    u.areas[area].set(address, bit ? (value ? 1 : 0) : value & 0xffff);
    u.overridden.add(`${area}:${address}`);
  }
}

function setRange(u, area, from, values) {
  const bit = area === 'coils' || area === 'discrete';
  values.forEach((v, i) => u.areas[area].set(from + i, bit ? (v ? 1 : 0) : v & 0xffff));
}

export function loadMap(json) {
  const mem = new Memory();
  mem.unknownUnit = json.unknownUnit === 'gateway' ? 'gateway' : 'ignore';
  for (const [id, spec] of Object.entries(json.units ?? {})) {
    const u = mem.unit(Number(id), true);
    // ranges first, so that the values written by hand after them win
    for (const f of spec.fill ?? []) {
      const n = f.to - f.from + 1;
      setRange(u, f.area, f.from, Array(n).fill(f.value ?? 0));
    }
    for (const area of AREAS)
      for (const [start, v] of Object.entries(spec[area] ?? {}))
        setRange(u, area, Number(start), Array.isArray(v) ? v : [v]);
    for (const s of spec.scripts ?? []) {
      const from = s.from ?? s.address;
      const to = s.to ?? s.address;
      u.scripts.push({ ...s, from, to });
    }
  }
  return mem;
}
