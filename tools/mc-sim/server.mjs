// The PLC model of the MC protocol simulator, without sockets: a request frame goes in, a plan
// comes out (answer, silence or close, with a delay). The socket layer (sim.mjs) carries the plan
// out, so every rule here is testable on plain buffers. Contract: contracts/mc-protocol.md §2, §5.
import {
  DataReader,
  DataWriter,
  END,
  encodeResponse,
  errorInfo,
  hex4,
  parseFrame,
} from './codec.mjs';
import { DEVICE_BY_ASCII, DEVICE_BY_CODE, DEVICES, asciiRadix } from './map.mjs';

export const FAULT_MODES = ['silent', 'close', 'endcode', 'delay', 'garbage', 'refuse'];
const LOG_LIMIT = 20000;
const LIMIT = { words: 960, bits: 7168, random: 192 };
const CMD = { READ: 0x0401, WRITE: 0x1401, RANDOM: 0x0403 };

/** An end code from JSON: a number (0xC056 = 49238) or a hex string ("C056", "0xC056"). */
export function parseEndCode(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 0xffff) return v;
  if (typeof v === 'string' && /^(0x)?[0-9A-Fa-f]{1,4}$/.test(v)) {
    const n = parseInt(v.replace(/^0x/, ''), 16);
    if (n > 0) return n;
  }
  throw new Error('code must be an end code 0x0001-0xFFFF (number or hex string)');
}

export class SimServer {
  constructor({
    memory,
    now = Date.now,
    rand = Math.random,
    onLog = null,
    onRefuseChange = null,
    accept = {},
  }) {
    this.memory = memory;
    this.accept = { frame: accept.frame ?? 'auto', code: accept.code ?? 'auto' };
    this.now = now;
    this.rand = rand;
    this.onLog = onLog;
    this.onRefuseChange = onRefuseChange;
    this.faults = [];
    this.refusing = false;
    this.reset();
  }

  reset() {
    this.faults = [];
    this.setRefusing(false);
    this.stats = {
      requests: 0,
      responses: 0,
      unanswered: 0,
      badFrames: 0,
      faults: 0,
      byCommand: {},
      endCodes: {},
      bytesIn: 0,
      bytesOut: 0,
    };
    this.conn = { accepted: 0, closed: 0, current: 0 };
    this.log = [];
    this.seq = 0;
  }

  setRefusing(on) {
    if (this.refusing === on) return;
    this.refusing = on;
    if (this.onRefuseChange) this.onRefuseChange(on);
  }

  /**
   * { mode, code?, device?, from?, to?, at?, count?, delayMs?, bytes?, cmd?, transport?, frame?,
   * encoding? }: cmd ("1401"), transport (tcp|udp), frame (3E|4E) and encoding (binary|ascii) limit
   * the fault to the requests of that kind (e.g. a write only, or one channel of a runtime).
   */
  addFault(f) {
    if (f.mode === 'none' || f.mode === 'clear') {
      this.clearFaults();
      return;
    }
    if (!FAULT_MODES.includes(f.mode)) throw new Error(`unknown fault mode: ${f.mode}`);
    if (f.mode === 'refuse') {
      this.setRefusing(true);
      return;
    }
    const fault = { mode: f.mode };
    if (f.mode === 'endcode') fault.code = parseEndCode(f.code);
    if (f.device !== undefined) {
      if (!DEVICES[f.device]) throw new Error(`unknown device: ${f.device}`);
      fault.device = f.device;
    }
    const from = f.from ?? f.at;
    const to = f.to ?? f.at;
    if (from !== undefined) fault.from = this.memory.number(f.device ?? 'D', from);
    if (to !== undefined) fault.to = this.memory.number(f.device ?? 'D', to);
    if (f.count !== undefined) {
      if (!Number.isInteger(f.count) || f.count < 1) throw new Error('count must be >= 1');
      fault.count = f.count;
    }
    if (f.delayMs !== undefined || f.mode === 'delay') {
      const d = f.delayMs ?? 1000;
      if (!Number.isInteger(d) || d < 0 || d > 600000) throw new Error('delayMs must be 0-600000');
      fault.delayMs = d;
    }
    if (f.cmd !== undefined) {
      if (typeof f.cmd !== 'string' || !/^[0-9A-Fa-f]{4}$/.test(f.cmd))
        throw new Error('cmd must be 4 hex digits ("1401")');
      fault.cmd = f.cmd.toUpperCase();
    }
    for (const [key, values] of [
      ['transport', ['tcp', 'udp']],
      ['frame', ['3E', '4E']],
      ['encoding', ['binary', 'ascii']],
    ]) {
      if (f[key] === undefined) continue;
      if (!values.includes(f[key])) throw new Error(`${key} must be ${values.join(' or ')}`);
      fault[key] = f[key];
    }
    if (f.bytes !== undefined) {
      if (!Number.isInteger(f.bytes) || f.bytes < 1 || f.bytes > 4096)
        throw new Error('bytes must be 1-4096');
      fault.bytes = f.bytes;
    }
    this.faults.push(fault);
  }

  clearFaults() {
    this.faults = [];
    this.setRefusing(false);
  }

  connOpened() {
    this.conn.accepted++;
    this.conn.current++;
  }

  connClosed() {
    this.conn.closed++;
    this.conn.current = Math.max(0, this.conn.current - 1);
  }

  counters() {
    return {
      ...this.stats,
      byCommand: { ...this.stats.byCommand },
      endCodes: { ...this.stats.endCodes },
      connections: { ...this.conn },
      last: this.log.length > 0 ? this.log[this.log.length - 1] : null,
    };
  }

  logEntries(since = 0) {
    return this.log.filter((e) => e.seq > since);
  }

  record(entry) {
    entry.seq = ++this.seq;
    entry.ts = this.now();
    this.log.push(entry);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
    if (this.onLog) this.onLog(entry);
  }

  /** The plan for one request frame: { action: 'respond' | 'silent' | 'close', delayMs, buffers }. */
  handleFrame(frame, transport = 'tcp') {
    const silent = { action: 'silent', delayMs: 0, buffers: [] };
    this.stats.bytesIn += frame.length;
    const h = parseFrame(frame);
    const { frame: af, code: ac } = this.accept;
    if (!h || (af !== 'auto' && af !== h.frame) || (ac !== 'auto' && ac !== h.code)) {
      this.stats.badFrames++;
      return silent;
    }
    const cmd = hex4(h.cmd);
    const entry = {
      transport,
      frame: h.frame,
      code: h.code,
      cmd,
      sub: hex4(h.sub),
      route: { ...h.route },
      endCode: null,
      result: 'ok',
    };
    if (h.serial !== null) entry.serial = h.serial;
    this.stats.requests++;
    this.stats.byCommand[cmd] = (this.stats.byCommand[cmd] ?? 0) + 1;

    let plan;
    if (!this.memory.routeAllowed(h.route)) {
      entry.result = 'route';
      plan = silent;
    } else {
      const req = this.parseRequest(h);
      for (const k of ['device', 'at', 'points', 'n', 'm', 'data'])
        if (req[k] !== undefined) entry[k] = req[k];
      const fault = this.matchFault(req, { cmd, transport, frame: h.frame, encoding: h.code });
      if (fault) {
        this.stats.faults++;
        entry.result = `fault:${fault.mode}`;
        plan = this.applyFault(fault, h, req, entry, transport);
      } else {
        const r = this.execute(req);
        plan = this.respond(h, r, entry);
      }
    }
    if (plan.action === 'respond') {
      this.stats.responses++;
      for (const b of plan.buffers) this.stats.bytesOut += b.length;
    } else {
      this.stats.unanswered++;
    }
    this.record(entry);
    return plan;
  }

  respond(h, r, entry, delayMs = 0) {
    const payload = r.endCode === END.OK ? r.payload : errorInfo(h);
    entry.endCode = hex4(r.endCode);
    this.stats.endCodes[entry.endCode] = (this.stats.endCodes[entry.endCode] ?? 0) + 1;
    return { action: 'respond', delayMs, buffers: [encodeResponse(h, r.endCode, payload)] };
  }

  applyFault(f, h, req, entry, transport) {
    switch (f.mode) {
      case 'silent':
        return { action: 'silent', delayMs: 0, buffers: [] };
      case 'close':
        return { action: transport === 'tcp' ? 'close' : 'silent', delayMs: 0, buffers: [] };
      case 'endcode':
        return this.respond(h, { endCode: f.code }, entry, f.delayMs ?? 0);
      case 'garbage': {
        const n = f.bytes ?? 12;
        const b = Buffer.alloc(n);
        for (let i = 0; i < n; i++) b[i] = Math.floor(this.rand() * 256);
        // never a response by accident: no response starts with 0xFF
        b[0] = 0xff;
        return { action: 'respond', delayMs: f.delayMs ?? 0, buffers: [b] };
      }
      default:
        return this.respond(h, this.execute(req), entry, f.delayMs ?? 0);
    }
  }

  /** Point ranges a request touches: [{ device, from, to }]. */
  ranges(req) {
    const span = (device, words) => (DEVICES[device].bit ? words * 16 : words);
    if (req.cmd === CMD.RANDOM)
      return [
        ...(req.randomWords ?? []).map((p) => ({ ...p, n: span(p.device, 1) })),
        ...(req.randomDwords ?? []).map((p) => ({ ...p, n: span(p.device, 2) })),
      ].map((p) => ({ device: p.device, from: p.at, to: p.at + p.n - 1 }));
    if (req.device === undefined) return [];
    const n = req.sub === 1 ? req.points : span(req.device, req.points ?? 1);
    return [{ device: req.device, from: req.at, to: req.at + Math.max(1, n) - 1 }];
  }

  matchFault(req, kind = {}) {
    const rs = this.ranges(req);
    const i = this.faults.findIndex((f) => {
      for (const key of ['cmd', 'transport', 'frame', 'encoding'])
        if (f[key] !== undefined && f[key] !== kind[key]) return false;
      if (f.device === undefined && f.from === undefined && f.to === undefined) return true;
      return rs.some(
        (r) =>
          (f.device === undefined || f.device === r.device) &&
          (f.from === undefined || r.to >= f.from) &&
          (f.to === undefined || r.from <= f.to),
      );
    });
    if (i < 0) return null;
    const f = this.faults[i];
    if (f.count !== undefined && --f.count <= 0) this.faults.splice(i, 1);
    return f;
  }

  /** The request data, checked: { cmd, sub, error?, device?, at?, points?, words?, bits?, ... }. */
  parseRequest(h) {
    const mem = this.memory;
    const req = { cmd: h.cmd, sub: h.sub, code: h.code };
    const r = new DataReader(h, (name) => asciiRadix(name, mem.xyNotation));
    const byCode = (c) => {
      const n = DEVICE_BY_CODE.get(c);
      return n && mem.device(n) ? n : undefined;
    };
    const byAscii = (c) => {
      const n = DEVICE_BY_ASCII.get(c);
      return n && mem.device(n) ? n : undefined;
    };
    try {
      if (h.cmd === CMD.READ || h.cmd === CMD.WRITE) {
        if (h.sub !== 0 && h.sub !== 1) throw END.COMMAND;
        Object.assign(req, r.device(byCode, byAscii));
        req.points = r.u16();
        const limit = h.sub === 1 ? LIMIT.bits : LIMIT.words;
        if (req.points < 1 || req.points > limit) throw END.POINTS;
        if (h.cmd === CMD.WRITE) {
          if (h.sub === 1) req.bits = r.bits(req.points);
          else {
            req.words = [];
            for (let i = 0; i < req.points; i++) req.words.push(r.u16());
          }
          req.data = req.bits ?? req.words;
        }
        r.end();
      } else if (h.cmd === CMD.RANDOM) {
        if (h.sub !== 0) throw END.COMMAND;
        req.n = r.u8();
        req.m = r.u8();
        if (req.n + req.m < 1 || req.n + req.m > LIMIT.random) throw END.POINTS;
        req.randomWords = [];
        req.randomDwords = [];
        for (let i = 0; i < req.n; i++) req.randomWords.push(r.device(byCode, byAscii));
        for (let i = 0; i < req.m; i++) req.randomDwords.push(r.device(byCode, byAscii));
        r.end();
      } else {
        throw END.COMMAND;
      }
    } catch (e) {
      if (typeof e !== 'number') throw e;
      req.error = e;
    }
    return req;
  }

  /** Carries out a parsed request on the memory: { endCode, payload }. */
  execute(req) {
    if (req.error) return { endCode: req.error };
    const mem = this.memory;
    const t = this.now();
    const out = new DataWriter(req.code);
    if (req.cmd === CMD.RANDOM) {
      for (const r of this.ranges(req))
        if (!mem.inRange(r.device, r.from, r.to - r.from + 1)) return { endCode: END.RANGE };
      for (const p of req.randomWords) out.word(mem.getWord(p.device, p.at, t));
      for (const p of req.randomDwords) {
        const step = DEVICES[p.device].bit ? 16 : 1;
        out.dword(mem.getWord(p.device, p.at, t), mem.getWord(p.device, p.at + step, t));
      }
      return { endCode: END.OK, payload: out.done() };
    }
    const bitDevice = DEVICES[req.device].bit;
    if (req.sub === 1 && !bitDevice) return { endCode: END.BIT_WORD };
    const [r] = this.ranges(req);
    if (!mem.inRange(req.device, r.from, r.to - r.from + 1)) return { endCode: END.RANGE };
    const step = bitDevice ? 16 : 1;
    if (req.cmd === CMD.READ) {
      if (req.sub === 1) {
        const points = [];
        for (let i = 0; i < req.points; i++) points.push(mem.get(req.device, req.at + i, t));
        out.bits(points);
      } else {
        for (let i = 0; i < req.points; i++)
          out.word(mem.getWord(req.device, req.at + i * step, t));
      }
      return { endCode: END.OK, payload: out.done() };
    }
    if (req.sub === 1) req.bits.forEach((b, i) => mem.set(req.device, req.at + i, b));
    else req.words.forEach((w, i) => mem.setWord(req.device, req.at + i * step, w));
    return { endCode: END.OK, payload: out.done() };
  }
}
